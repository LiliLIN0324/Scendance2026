// 取坐姿动作：通过本机 LUX3D 代理提交 retarget，轮询到完成，下载 3 个带动画 GLB。
//
// 为什么走本机代理：LUX3D 的 key 只存在于代理进程的环境里（仓库 .env.local），
// 这个脚本只与本机 127.0.0.1:3199 通信，不接触、不打印任何密钥。
//
// 用法：
//   node tools/aholo/fetch-sit-clips.mjs                 # 默认：唐女 R2 地址 + 三条坐姿
//   node tools/aholo/fetch-sit-clips.mjs --proxy http://127.0.0.1:3200
//   node tools/aholo/fetch-sit-clips.mjs --rig <https 已绑骨 GLB> --clips Sit_Idle_Loop
import { mkdirSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const proxy = option('proxy', 'http://127.0.0.1:3199').replace(/\/+$/, '');
const rigModelUrl = option('rig', 'https://pub-048147e4c4ad482d95df092dc8098e1d.r2.dev/people/7a9f1e21-8c34-4d51-a001-b00000000001.glb');
const clips = option('clips', 'Sit_Idle_Loop,Stand_To_Sit,Sit_To_Stand').split(',').map(item => item.trim()).filter(Boolean);
const outDir = option('out', '.cache/aholo/sit');
const waitMs = Number(option('timeout', '900')) * 1000;
const intervalMs = Number(option('interval', '10')) * 1000;

const RESTART_HINT = [
  '本机代理没有 /retarget 路由（多半是改代码前启动的旧进程）。重启一次即可：',
  '  taskkill /PID <旧进程> /T',
  '  cd C:\\幕景\\Scendance2026\\.worktrees\\people06-on-main',
  '  node --env-file-if-exists=.env.local tools/aholo/lux3d-dev-proxy.mjs',
  '（key 会由 --env-file 从 .env.local 加载进代理进程，脚本本身不读密钥。）',
].join('\n');

async function post(path, payload) {
  const response = await fetch(`${proxy}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const text = await response.text();
  let body = null;
  try { body = JSON.parse(text); } catch { /* 保留原文 */ }
  if (response.status === 404) throw new Error(`${text}\n${RESTART_HINT}`);
  if (!response.ok || body?.error) throw new Error(`HTTP ${response.status} ${body?.error ?? text}`);
  return body;
}

async function get(path) {
  const response = await fetch(`${proxy}${path}`);
  const text = await response.text();
  let body = null;
  try { body = JSON.parse(text); } catch { /* 保留原文 */ }
  if (!response.ok || body?.error) throw new Error(`HTTP ${response.status} ${body?.error ?? text}`);
  return body;
}

const started = Date.now();
const created = await post('/retarget', { rigModelUrl, animationIds: clips });
const taskid = created?.taskid;
if (!taskid) throw new Error(`代理没有返回任务号：${JSON.stringify(created)}`);
console.log(`已提交 retarget：taskid=${taskid}，动作 ${clips.join(', ')}`);

let outputs = [];
for (;;) {
  await new Promise(resolve => setTimeout(resolve, intervalMs));
  const detail = await get(`/task?taskid=${encodeURIComponent(taskid)}`);
  const status = Number(detail?.status);
  console.log(`  ${((Date.now() - started) / 1000).toFixed(0)}s status=${status} outputs=${(detail?.outputs ?? []).length}`);
  if (status === 3) { outputs = (detail.outputs ?? []).filter(Boolean); break; }
  if (status === 4 || status === 6) throw new Error(`任务失败或取消（status=${status}），未产出动作。`);
  if (Date.now() - started > waitMs) {
    throw new Error(`等待超时（${waitMs / 1000}s），任务 ${taskid} 可能仍在跑；不要重复提交，先用 /task?taskid=${taskid} 查询。`);
  }
}
if (!outputs.length) throw new Error(`任务完成但没有产物地址：${JSON.stringify(outputs)}`);

mkdirSync(outDir, { recursive: true });
console.log(`下载 ${outputs.length} 个动作文件：`);
for (const [index, url] of outputs.entries()) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`下载失败 HTTP ${response.status}：${url}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  // 用动作名稳定命名（顺序与 animationIds 一致）；拿不到就用序号。
  const label = clips[index] ?? basename(new URL(url).pathname, '.glb');
  const file = join(outDir, `${label}.glb`);
  writeFileSync(file, bytes);
  console.log(`  ${label}.glb  ${(bytes.length / 1048576).toFixed(2)} MB`);
}
console.log(`\n完成：${outDir}\n下一步：\n  node tools/aholo/merge-person-clips.mjs --source ${join(outDir, `${clips[0]}.glb`)} --clips ${clips.join(',')} --from .cache/aholo --out .cache/aholo/with-sit`);
