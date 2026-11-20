// 启动前端 dev，并自动拉起本机高德/Aholo 代理（127.0.0.1:3199）。
// 代理只在 localhost 使用：线上仍然是浏览器直连高德，行为不变。
//
// 3199 是「单例」：多个 dev（3000/3210/…）共用同一个代理。因此：
//  - 启动前先探活，已在跑就复用，不再抢端口；
//  - 并发的 dev 同时启动时会撞上 EADDRINUSE，子进程立刻退出——这不是真故障，
//    退出后重新探活，若已有实例接管就按「复用」处理，而不是报警；
//  - 自己拉起的代理意外退出时自动重启（有限次数），避免 dev 跑着跑着地图断掉；
//  - dev 退出时不杀代理：它是共享单例，留给下次 dev 复用，也避免别的 dev 掉线。
//
// 端口：dev 固定跑 3000（云端服务的允许来源只放行这个本机地址）。
// next dev 在 3000 被占用时会自己顺延到 3001，页面照常打开、跨域请求全被拒，
// 页面只显示 "Failed to fetch"。这里显式钉住端口并把占用说清楚，不偷偷换端口。
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import net from 'node:net';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const frontend = fileURLToPath(new URL('../frontend', import.meta.url));
const proxyScript = fileURLToPath(new URL('../tools/aholo/lux3d-dev-proxy.mjs', import.meta.url));
const nextBin = fileURLToPath(new URL('../frontend/node_modules/next/dist/bin/next', import.meta.url));
const proxyHealth = 'http://127.0.0.1:3199/health';
const START_ATTEMPTS = 3;
const RESTART_ATTEMPTS = 5;
/** 本机 dev 的固定端口：与云端服务的允许来源一致，见文件末尾的端口说明。 */
const DEFAULT_PORT = 3000;

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

/** 命令行里显式指定的端口（-p / --port / --port=）；没有就返回 null。 */
function requestedPort(args) {
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    let value = null;
    if (arg === '-p' || arg === '--port') value = Number(args[i + 1]);
    else if (arg.startsWith('--port=')) value = Number(arg.slice('--port='.length));
    if (Number.isInteger(value) && value > 0) return value;
  }
  return null;
}

/**
 * 端口是否还空着；已被占用返回 false。
 * 绑定方式与 next dev 一致（不指定 host）。Windows 上绑具体地址（如 127.0.0.1）
 * 探不出占用——同一个端口可以被另一个进程用 :: 绑着，所以这里按 next 的方式绑。
 */
function portFree(port) {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once('error', () => resolve(false));
    probe.once('listening', () => probe.close(() => resolve(true)));
    probe.listen(port);
  });
}

/** 端口上已经有服务在应答（另一个 dev 跑着时，next 会自己顺延到下一个端口）。 */
async function portAnswering(port) {
  try {
    await fetch(`http://localhost:${port}/`, { signal: AbortSignal.timeout(1500) });
    return true;
  } catch {
    return false;
  }
}

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

// 云端服务（scene-api）的允许来源是一份固定名单：本机只放行 3000，线上放行两个正式域名。
// next dev 在 3000 被占用时会自己顺延到 3001——页面照常打开，浏览器里所有跨域请求却在预检
// 阶段被拒，fetch 直接抛 "Failed to fetch"，页面上只剩一句看不懂的报错，还查不到根因。
// 这里显式钉住端口：默认 3000；被占用就直说，不再偷偷换端口。
const userArgs = process.argv.slice(2);
const explicitPort = requestedPort(userArgs);
const port = explicitPort ?? DEFAULT_PORT;
if (!(await portFree(port)) || (await portAnswering(port))) {
  console.error(`[dev] 端口 ${port} 已被占用。`);
  console.error('[dev] 云端服务只放行 http://localhost:3000 与 http://127.0.0.1:3000；');
  console.error('[dev] 换到别的端口，页面里的云端功能（案例/归档/分享/项目列表）都会因跨域被拒而失败。');
  console.error(`[dev] 请先停掉占用 ${port} 的旧 dev，或显式 --port <端口> 另起（此时云端功能不可用）。`);
  process.exit(1);
}
if (port !== DEFAULT_PORT) {
  console.warn(`[dev] 本次用 ${port} 端口：云端服务只放行 3000，案例/归档/分享等云端功能会因跨域被拒而失败。`);
}
if (explicitPort === null) args.push('-p', String(port));
console.log(`[dev] 前端地址 http://localhost:${port}`);
devChild = spawn(process.execPath, [nextBin, ...args], { cwd: frontend, stdio: 'inherit' });
devChild.on('exit', (code) => shutdown(code ?? 0));
