#!/usr/bin/env node
// Aholo World(3DGS 世界生成)MVP — docs/AHOLO-INTEGRATION-PLAN.md M3 验证脚本。
// 用法: node tools/aholo/world-mvp.mjs "<室内场景描述>"  (key 自动读仓库根 .env.local 的 LUX3D_API_KEY)
// 注意:world 服务走国内网关 api.aholo3d.cn(国际网关对该 key 返回 BIZ_14001 user not exists)。
// 产物: docs/evidence/aholo/world-<worldId>/ 下存 PLY/SPZ 与 report.json
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const BASE = (process.env.LUX3D_BASE_URL ?? 'https://api.aholo3d.cn').replace(/\/+$/, '');
let KEY = process.env.LUX3D_API_KEY;
if (!KEY) {
  try {
    const line = (await readFile('.env.local', 'utf8')).split('\n').find(l => l.trim().startsWith('LUX3D_API_KEY='));
    KEY = line?.split('=').slice(1).join('=').trim();
  } catch { /* 走环境变量 */ }
}
const OUT_DIR = 'docs/evidence/aholo';
function die(msg) { console.error('[WORLD-FAIL]', msg); process.exit(1); }
const log = (...a) => console.log('[WORLD]', ...a);
if (!KEY) die('缺少 LUX3D_API_KEY(.env.local 或环境变量)。');
const args = process.argv.slice(2);
const resume = args[0] === 'query';
const prompt = resume ? '' : args.join(' ');
if (resume && !args[1]) die('用法: node tools/aholo/world-mvp.mjs query <worldId>');
if (!resume && !prompt) die('用法: node tools/aholo/world-mvp.mjs "<室内场景描述>" 或 query <worldId>');

async function api(url, init) {
  const res = await fetch(url, { ...init, headers: { Authorization: KEY, 'Content-Type': 'application/json', ...init?.headers } });
  const text = await res.text();
  let body; try { body = JSON.parse(text); } catch { die(`HTTP ${res.status} 非JSON: ${text.slice(0, 300)}`); }
  if (!res.ok) die(`HTTP ${res.status}: ${JSON.stringify(body).slice(0, 500)}`);
  return body;
}

const t0 = Date.now();
let worldId;
if (resume) {
  worldId = args[1];
  log('续查已存在任务:', worldId);
} else {
  log('创建世界生成任务:', prompt);
  const created = await api(`${BASE}/world/v1/generations`, { method: 'POST', body: JSON.stringify({ name: 'Scendance-M3-MVP', prompt }) });
  log('create 响应:', JSON.stringify(created).slice(0, 400));
  worldId = created.worldId ?? created.d?.worldId ?? created.data?.worldId;
  if (!worldId) die('响应中找不到 worldId,原始响应见上一行。');
}

let detail;
const maxMinutes = 30;
for (;;) {
  await new Promise(r => setTimeout(r, 10_000));
  detail = await api(`${BASE}/world/v1/${worldId}`);
  const d = detail.d ?? detail.data ?? detail;
  const status = d.status ?? d.state;
  log(`status=${JSON.stringify(status)} elapsed=${Math.round((Date.now() - t0) / 1000)}s`);
  const done = status === 3 || status === 'DONE' || ['succeed', 'succeeded', 'success', 'completed'].includes(String(status).toLowerCase());
  const failed = status === 4 || status === 'FAIL' || ['failed', 'canceled', 6].includes(typeof status === 'string' ? status.toLowerCase() : status);
  if (done || failed) { log('终态详情:', JSON.stringify(detail).slice(0, 900)); if (failed) die('任务失败'); break; }
  if (Date.now() - t0 > maxMinutes * 60_000) die(`超过 ${maxMinutes} 分钟未完成`);
}

const d = detail.d ?? detail.data ?? detail;
const output = d.output ?? {};
const urls = {
  plyPath: output.splat?.urls?.plyPath ?? output.plyPath ?? null,
  spzPath: output.splat?.urls?.spzPath ?? output.spzPath ?? null,
  lodMetaPath: output.splat?.urls?.lodMetaPath ?? output.lodMetaPath ?? null,
};
const dir = path.join(OUT_DIR, `world-${worldId}`);
await mkdir(dir, { recursive: true });
for (const [name, url] of Object.entries(urls)) {
  if (!url) continue;
  log(`下载 ${name} …`);
  const bytes = Buffer.from(await (await fetch(url)).arrayBuffer());
  await writeFile(path.join(dir, name.replace('Path', '') + path.extname(url) || `.${name}`), bytes);
  log(name, Math.round(bytes.length / 1024), 'KB');
}
const report = { worldId, prompt, elapsedMs: Date.now() - t0, urls, detail: d };
await writeFile(path.join(dir, 'report.json'), JSON.stringify(report, null, 2));
console.log('\n===== WORLD MVP REPORT =====\n' + JSON.stringify(report, null, 2).slice(0, 3000));
log(`完成 → ${dir}/report.json`);
