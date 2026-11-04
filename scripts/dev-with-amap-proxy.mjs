// 启动前端 dev，并自动拉起本机高德/Aholo 代理（127.0.0.1:3199）。
// 代理只在 localhost 使用：线上仍然是浏览器直连高德，行为不变。
//
// 3199 是「单例」：多个 dev（3000/3210/…）共用同一个代理。因此：
//  - 启动前先探活，已在跑就复用，不再抢端口；
//  - 并发的 dev 同时启动时会撞上 EADDRINUSE，子进程立刻退出——这不是真故障，
//    退出后重新探活，若已有实例接管就按「复用」处理，而不是报警；
//  - 自己拉起的代理意外退出时自动重启（有限次数），避免 dev 跑着跑着地图断掉；
//  - dev 退出时不杀代理：它是共享单例，留给下次 dev 复用，也避免别的 dev 掉线。
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const frontend = fileURLToPath(new URL('../frontend', import.meta.url));
const proxyScript = fileURLToPath(new URL('../tools/aholo/lux3d-dev-proxy.mjs', import.meta.url));
const nextBin = fileURLToPath(new URL('../frontend/node_modules/next/dist/bin/next', import.meta.url));
const proxyHealth = 'http://127.0.0.1:3199/health';
const START_ATTEMPTS = 3;
const RESTART_ATTEMPTS = 5;

let proxyChild = null;
let restarting = false;
let stopping = false;
let devChild = null;

async function proxyUp() {
  try {
    const res = await fetch(proxyHealth, { signal: AbortSignal.timeout(800) });
    return res.ok;
  } catch {
    return false;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 等到 3199 能响应 /health，或子进程已退出。返回 'up' | 'exited' | 'timeout'。 */
async function waitForProxy(child) {
  for (let i = 0; i < 24; i += 1) {
    await sleep(250);
    if (await proxyUp()) return 'up';
    if (child && child.exitCode !== null) return 'exited';
  }
  return 'timeout';
}

/**
 * 拉起单例代理。返回 'started' | 'reused' | 'failed'。
 * 撞端口（另一个 dev 抢先）时子进程会带着 EADDRINUSE 退出，这里再探活一次：
 * 端口已经被别人占住且 /health 正常，就是复用成功，不是失败。
 */
async function ensureProxy() {
  if (await proxyUp()) {
    console.log('[dev] 复用已在运行的 3199 地图代理');
    return 'reused';
  }
  for (let attempt = 1; attempt <= START_ATTEMPTS; attempt += 1) {
    const child = spawn(process.execPath, [proxyScript], {
      cwd: root,
      stdio: 'inherit',
      windowsHide: true,
    });
    proxyChild = child;
    const state = await waitForProxy(child);
    if (state === 'up') {
      console.log('[dev] 3199 地图代理已随 dev 启动');
      superviseProxy(child);
      return 'started';
    }
    if (state === 'exited' && (await proxyUp())) {
      // 端口被另一个 dev 的实例抢到了：共用它，不当成故障。
      console.log('[dev] 3199 端口已被其它 dev 的代理占用，复用之');
      proxyChild = null;
      return 'reused';
    }
    const reason = child.exitCode !== null ? `code=${child.exitCode}` : '启动超时';
    console.warn(`[dev] 3199 地图代理第 ${attempt} 次启动失败（${reason}）`);
    if (child.exitCode === null) child.kill('SIGKILL');
    proxyChild = null;
    if (attempt < START_ATTEMPTS) await sleep(600);
  }
  console.error('[dev] 3199 地图代理起不来：请手动运行 node tools/aholo/lux3d-dev-proxy.mjs 查看报错（多为端口被占用或端口权限）');
  return 'failed';
}

/** 自拉起的代理意外退出时重启，避免 dev 跑着跑着地图断。 */
function superviseProxy(child) {
  child.on('exit', (code, signal) => {
    if (stopping || child !== proxyChild) return;
    proxyChild = null;
    if (restarting) return;
    restarting = true;
    void (async () => {
      console.warn(`[dev] 3199 地图代理退出（code=${code ?? '?'} signal=${signal ?? '-'}），尝试重启`);
      for (let i = 0; i < RESTART_ATTEMPTS; i += 1) {
        await sleep(800 * (i + 1));
        if (stopping) return;
        if (await proxyUp()) {
          console.log('[dev] 3199 已由其它进程接管');
          return;
        }
        const next = spawn(process.execPath, [proxyScript], { cwd: root, stdio: 'inherit', windowsHide: true });
        proxyChild = next;
        if ((await waitForProxy(next)) === 'up') {
          console.log('[dev] 3199 地图代理已重启');
          superviseProxy(next);
          return;
        }
        if (next.exitCode === null) next.kill('SIGKILL');
      }
      console.error('[dev] 3199 地图代理多次重启失败，地图会降级；请查看上面的代理报错');
    })().finally(() => { restarting = false; });
  });
}

function shutdown(code = 0) {
  if (stopping) return;
  stopping = true;
  // 只停 dev；3199 是共享单例，留在后台给下次 dev / 其它端口复用。
  if (devChild && devChild.exitCode === null) devChild.kill('SIGINT');
  setTimeout(() => process.exit(code), 400);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

await ensureProxy();

if (!existsSync(nextBin)) {
  console.error('[dev] 找不到 next，请先在 frontend 执行 npm install');
  process.exit(1);
}

const args = ['dev', ...process.argv.slice(2)];
devChild = spawn(process.execPath, [nextBin, ...args], { cwd: frontend, stdio: 'inherit' });
devChild.on('exit', (code) => shutdown(code ?? 0));
