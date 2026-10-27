#!/usr/bin/env node
// Lux3D MVP — Aholo 集成 M0 验证脚本(docs/AHOLO-INTEGRATION-PLAN.md)
// 走通 text-to-3D / image-to-3D 全链路:创建任务 → 轮询 → 下载 ZIP → 解包 GLB → 报告。
// 用法:
//   set LUX3D_API_KEY=xxx
//   node tools/aholo/lux3d-mvp.mjs text "一张白色圆桌" [--style cartoon] [--version G1]
//   node tools/aholo/lux3d-mvp.mjs image <图片URL或本地路径>
// 产物:docs/evidence/aholo/<taskid>/ 下存 result.zip、解包文件、report.json
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

const BASE = process.env.LUX3D_BASE_URL ?? 'https://api.aholo.ai/global';
let KEY = process.env.LUX3D_API_KEY;
// 未设环境变量时,从仓库根 .env.local 读(便于 PowerShell 用户直接跑)
if (!KEY) {
  try {
    const line = (await readFile('.env.local', 'utf8')).split('\n').find(l => l.trim().startsWith('LUX3D_API_KEY='));
    KEY = line?.split('=').slice(1).join('=').trim();
  } catch { /* 没有 .env.local 就走环境变量 */ }
}
const OUT_DIR = 'docs/evidence/aholo';

function die(msg) { console.error('[MVP-FAIL]', msg); process.exit(1); }
const log = (...a) => console.log('[MVP]', ...a);

if (!KEY) die('缺少 LUX3D_API_KEY 环境变量(labs.aholo.ai/api-keys 申请)。MVP 目的就是验证真实 key,不要 mock。');

const args = process.argv.slice(2);
const mode = args[0];
const pollIntervalMs = 5000, maxMinutes = 20;

async function api(url, init) {
  const res = await fetch(url, { ...init, headers: { Authorization: KEY, 'Content-Type': 'application/json', ...init?.headers } });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body) die(`HTTP ${res.status}: ${res.statusText} ${JSON.stringify(body)}`);
  return body;
}

async function createTask() {
  if (mode === 'text') {
    const prompt = args[1];
    if (!prompt) die('用法: node tools/aholo/lux3d-mvp.mjs text "<prompt>" [--style s] [--version v]');
    const opt = { style: 'photorealistic', faceCount: 30000, outputFormat: ['zip', 'glb'], version: 'G1' };
    for (let i = 2; i < args.length; i++) {
      if (args[i] === '--style') opt.style = args[++i];
      if (args[i] === '--version') opt.version = args[++i];
    }
    log(`text-to-3d 创建任务: "${prompt}"`);
    return api(`${BASE}/lux3d/v1/generate/text-to-3d/task/create`, { method: 'POST', body: JSON.stringify({ prompt, ...opt }) });
  }
  if (mode === 'image') {
    const src = args[1];
    if (!src) die('用法: node tools/aholo/lux3d-mvp.mjs image <图片URL或本地路径>');
    let img = src;
    if (existsSync(src)) {
      log('本地图片 → data URL(若报错则需改走 Asset 上传接口)');
      img = `data:image/png;base64,${(await readFile(src)).toString('base64')}`;
    }
    log('img-to-3d 创建任务');
    return api(`${BASE}/lux3d/v1/generate/img-to-3d/task/create`, { method: 'POST', body: JSON.stringify({ img, version: 'G1', faceCount: 30000, outputFormat: ['zip', 'glb'] }) });
  }
  die('第一个参数必须是 text、image 或 query');
}

// query 模式:按 taskid 续查已完成任务并下载(不新建任务)
if (mode === 'query') {
  const taskid = args[1];
  if (!taskid) die('用法: node tools/aholo/lux3d-mvp.mjs query <taskid>');
  const t0 = Date.now();
  const done = await poll(taskid);
  const urls = (done.outputs ?? []).map(o => o.content).filter(u => u && u.startsWith('http'));
  if (!urls.length) die(`成功但无结果 URL: ${JSON.stringify(done)}`);
  const dir = path.join(OUT_DIR, String(taskid));
  await mkdir(dir, { recursive: true });
  const zipUrl = urls.find(u => u.endsWith('.zip')) ?? urls[0];
  const zipPath = path.join(dir, 'result.zip');
  log('下载 ZIP…');
  await writeFile(zipPath, Buffer.from(await (await fetch(zipUrl)).arrayBuffer()));
  await rm(dir + '/unpacked', { recursive: true, force: true });
  unzip(path.resolve(zipPath), path.resolve(dir + '/unpacked'));
  const files = execFileSync('powershell', ['-NoProfile', '-Command',
    `Get-ChildItem -Recurse -File '${dir}/unpacked' | ForEach-Object { $_.FullName.Replace('${process.cwd()}\\','') + ' ' + $_.Length }`]).toString().trim();
  const report = { mode, taskid, elapsedMs: Date.now() - t0, outputUrls: urls, files, note: 'resumed by taskid; creation time not included' };
  await writeFile(path.join(dir, 'report.json'), JSON.stringify(report, null, 2));
  console.log('\n===== MVP REPORT =====\n' + JSON.stringify(report, null, 2));
  process.exit(0);
}

async function _createTask() {
}

// 统一响应壳 { c:"0", d, m, f }
function unwrap(body, what) {
  if (body.c !== '0') die(`${what} 失败: c=${body.c} m=${JSON.stringify(body.m)} f=${JSON.stringify(body.f)}`);
  return body.d;
}

async function poll(taskid) {
  const t0 = Date.now();
  for (;;) {
    const d = unwrap(await api(`${BASE}/lux3d/v1/generate/task/get?taskid=${taskid}`), 'query');
    const status = { 0: '初始化', 1: '运行中', 3: '成功', 4: '失败', 6: '已取消' }[d.status];
    log(`status=${d.status}(${status}) elapsed=${Math.round((Date.now() - t0) / 1000)}s`);
    if (d.status === 3) return d;
    if (d.status === 4 || d.status === 6) die(`任务终态 ${status}: ${JSON.stringify(d)}`);
    if (Date.now() - t0 > maxMinutes * 60000) die(`超过 ${maxMinutes} 分钟未完成`);
    await new Promise(r => setTimeout(r, pollIntervalMs));
  }
}

function unzip(zipPath, destDir) {
  // PowerShell 内置解压,零依赖
  execFileSync('powershell', ['-NoProfile', '-Command',
    `Expand-Archive -LiteralPath '${zipPath}' -DestinationPath '${destDir}' -Force`]);
}

const [file1, file2] = await (async () => {
  const t0 = Date.now();
  const created = unwrap(await createTask(), 'create');
  const taskid = created;
  log('taskid =', taskid);
  const done = await poll(taskid);
  const urls = (done.outputs ?? []).map(o => o.content).filter(u => u && u.startsWith('http'));
  if (!urls.length) die(`成功但无结果 URL: ${JSON.stringify(done)}`);
  log('结果 URL 数 =', urls.length);

  const dir = path.join(OUT_DIR, String(taskid));
  await mkdir(dir, { recursive: true });
  const zipUrl = urls.find(u => u.endsWith('.zip')) ?? urls[0];
  const zipPath = path.join(dir, 'result.zip');
  log('下载 ZIP…');
  await writeFile(zipPath, Buffer.from(await (await fetch(zipUrl)).arrayBuffer()));
  await rm(dir + '/unpacked', { recursive: true, force: true });
  unzip(path.resolve(zipPath), path.resolve(dir + '/unpacked'));
  const files = execFileSync('powershell', ['-NoProfile', '-Command',
    `Get-ChildItem -Recurse -File '${dir}/unpacked' | ForEach-Object { $_.FullName.Replace('${process.cwd()}\\','') + ' ' + $_.Length }`]).toString().trim();

  const report = {
    mode, taskid, promptOrImage: args[1], style: args.includes('--style') ? args[args.indexOf('--style') + 1] : undefined,
    version: args.includes('--version') ? args[args.indexOf('--version') + 1] : 'G1',
    elapsedMs: Date.now() - t0, outputUrls: urls, files,
    verdict: { glbDirect: files.split('\n').some(l => /\.glb/i.test(l)), zipUrlExpiresHours: 2 },
  };
  await writeFile(path.join(dir, 'report.json'), JSON.stringify(report, null, 2));
  console.log('\n===== MVP REPORT =====\n' + JSON.stringify(report, null, 2));
  log(`完成 → ${dir}/report.json`);
  return [zipPath, files];
})();
