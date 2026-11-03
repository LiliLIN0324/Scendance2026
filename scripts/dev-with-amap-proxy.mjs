// 启动前端 dev，并自动拉起本机高德/ Aholo 代理（127.0.0.1:3199）。
// 代理只在 localhost 使用：线上仍然是浏览器直连高德，行为不变。
// 代理起不来时只告警并继续启动 dev，地图会在页面里给出降级提示。
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const proxyScript = fileURLToPath(new URL('../tools/aholo/lux3d-dev-proxy.mjs', import.meta.url));
const nextBin = fileURLToPath(new URL('../frontend/node_modules/next/dist/bin/next', import.meta.url));
const proxyHealth = 'http://127.0.0.1:3199/health';
const children = [];
let stopping = false;

async function proxyUp() {
  try {
    const res = await fetch(proxyHealth, { signal: AbortSignal.timeout(800) });
    return res.ok;
  } catch {
    return false;
  }
}

async function startProxy() {
  if (await proxyUp()) {
    console.log('[dev] 复用已在运行的 3199 地图代理');
    return null;
  }
  const child = spawn(process.execPath, [proxyScript], { cwd: root, stdio: 'inherit' });
  children.push(child);
  child.on('exit', (code) => {
    if (stopping) return;
    console.warn(`[dev] 3199 地图代理已退出（code=${code ?? '?'}），地图将显示降级提示`);
  });
  for (let i = 0; i < 20; i += 1) {
    await new Promise((r) => setTimeout(r, 250));
    if (await proxyUp()) {
      console.log('[dev] 3199 地图代理已随 dev 启动');
      return child;
    }
    if (child.exitCode !== null) break;
  }
  console.warn('[dev] 3199 地图代理未能启动，地图会显示降级提示；请检查该端口是否被占用');
  return child;
}

function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) {
    if (child.exitCode === null) child.kill('SIGINT');
  }
  setTimeout(() => process.exit(code), 300);
}

process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));
process.on('exit', () => {
  for (const child of children) {
    if (child.exitCode === null) child.kill('SIGKILL');
  }
});

await startProxy();

if (!existsSync(nextBin)) {
  console.error('[dev] 找不到 next，请先在 frontend 执行 npm install');
  process.exit(1);
}

const args = ['dev', ...process.argv.slice(2)];
const dev = spawn(process.execPath, [nextBin, ...args], {
  cwd: fileURLToPath(new URL('../frontend', import.meta.url)),
  stdio: 'inherit',
});
children.push(dev);
dev.on('exit', (code) => stop(code ?? 0));
