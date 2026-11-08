#!/usr/bin/env node
// Aholo 真实场地重建链路：逐文件先入库（资产 ID）→ 建 reconstruction → 轮询 → 取 spzPath → 落盘。
// 用法：
//   node tools/aholo/recon-chain.mjs --video scene-3d-outdoor/DJI_xxx.MP4
//   node tools/aholo/recon-chain.mjs --frames <目录> [--limit 20]
//   node tools/aholo/recon-chain.mjs --query 3FO4K4RKK337
// 凭据只从环境变量 LUX3D_API_KEY 读取（或 LUX3D_BASE_URL 覆盖网关）。
// 每一步的 HTTP 状态与响应体都会写入 <out>/chain-report.json 与 chain.jsonl。
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';

const BASE = (process.env.LUX3D_BASE_URL ?? 'https://api.aholo3d.cn').replace(/\/+$/, '');
const KEY = process.env.LUX3D_API_KEY;
if (!KEY) {
  console.error('[chain] 缺少 LUX3D_API_KEY 环境变量');
  process.exit(2);
}
const args = process.argv.slice(2);
const getArg = (name, fallback) => {
  const at = args.indexOf(name);
  return at >= 0 && args[at + 1] ? args[at + 1] : fallback;
};
const has = name => args.includes(name);
const START = Date.now();
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const OUT = resolve(getArg('--out', `docs/evidence/aholo/chain-${stamp}`));
const steps = [];
const logs = [];

function redact(value) {
  return String(value).replaceAll(KEY, '[REDACTED]');
}
function logStep(step) {
  steps.push(step);
  const line = JSON.stringify(step);
  logs.push(line);
  console.log(`[${((Date.now() - START) / 1000).toFixed(1)}s] ${step.op} http=${step.http ?? '-'} ${step.note ?? ''}`.trim());
}
async function record(op, res, body, extra = {}) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  logStep({ op, http: res.status, ...extra, response: redact(text).slice(0, 6000) });
  return body;
}
async function call(op, url, init, extra = {}) {
  const res = await fetch(url, { ...init, signal: AbortSignal.timeout(init?.timeoutMs ?? 600000) });
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  await record(op, res, body, extra);
  if (!res.ok) throw new Error(`${op} 上游 HTTP ${res.status}: ${redact(text).slice(0, 500)}`);
  return { body, status: res.status };
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

function pickUrl(value) {
  if (typeof value === 'string') return value.startsWith('https://') ? value : undefined;
  if (Array.isArray(value)) { for (const item of value) { const found = pickUrl(item); if (found) return found; } return undefined; }
  if (value && typeof value === 'object') { for (const item of Object.values(value)) { const found = pickUrl(item); if (found) return found; } }
  return undefined;
}
function unwrap(body) { return body?.d ?? body?.data ?? body; }

// 一次上传会话必须复用同一个 ousToken（跨文件复用会报 Token已被使用）。
async function ousToken() {
  const res = await fetch(`${BASE}/asset/v1/token`, { headers: { Authorization: KEY }, signal: AbortSignal.timeout(30000) });
  const text = await res.text();
  let body; try { body = JSON.parse(text); } catch { body = text; }
  await record('asset.token', res, body);
  if (!res.ok) throw new Error(`asset token HTTP ${res.status}`);
  const d = unwrap(body);
  if (!d?.ousToken || !d?.globalDomain) throw new Error('asset token 响应缺少 ousToken/globalDomain');
  return { token: d.ousToken, domain: String(d.globalDomain).replace(/\/+$/, ''), blockSize: Number(d.blockSize) || 5 * 1024 * 1024 };
}

async function postOus(op, url, token, form) {
  const res = await fetch(url, { method: 'POST', headers: { 'ous-token-v2': token }, body: form, signal: AbortSignal.timeout(600000) });
  const text = await res.text();
  let body; try { body = JSON.parse(text); } catch { body = text; }
  await record(op, res, body);
  if (!res.ok) throw new Error(`${op} HTTP ${res.status}`);
  if (body?.c != null && body.c !== '0' && body.c !== 0) throw new Error(`${op} 被拒: ${body.m ?? body.c}`);
  return unwrap(body);
}

async function uploadOne(file) {
  const bytes = await readFile(file);
  const name = file.split(/[\\/]/).pop();
  const md5 = createHash('md5').update(bytes).digest('hex');
  const { token, domain, blockSize } = await ousToken();
  logStep({ op: 'asset.begin', file: name, bytes: bytes.length, md5, note: '逐文件入库开始' });
  let payload;
  if (bytes.length <= Math.max(blockSize - 256 * 1024, 1024)) {
    const form = new FormData();
    form.append('md5', md5);
    form.append('file', new Blob([bytes]), name);
    payload = await postOus('asset.single', `${domain}/ous/api/v2/single/upload`, token, form);
  } else {
    const blocks = Math.ceil(bytes.length / blockSize);
    await postOus('asset.block.init', `${domain}/ous/api/v2/block/upload/init?md5=${md5}&blocks=${blocks}&size=${bytes.length}&name=${encodeURIComponent(name)}`, token, new FormData());
    for (let index = 1; index <= blocks; index++) {
      const form = new FormData();
      form.append('block', String(index));
      form.append('file', new Blob([bytes.subarray((index - 1) * blockSize, index * blockSize)]), name);
      payload = await postOus('asset.block.part', `${domain}/ous/api/v2/block/upload/part`, token, form);
    }
  }
  // 上传接口只回 obsTaskId；公网地址要用同一个 token 轮询状态换出来。
  let asset = payload;
  for (let attempt = 0; attempt < 40; attempt++) {
    const res = await fetch(`${domain}/ous/api/v2/upload/status?md5=${md5}`, { headers: { 'ous-token-v2': token }, signal: AbortSignal.timeout(30000) });
    const text = await res.text();
    let body; try { body = JSON.parse(text); } catch { body = text; }
    await record('asset.status', res, body, { file: name, attempt });
    const d = unwrap(body);
    if (d?.url) { asset = d; break; }
    await sleep(2000);
  }
  const url = pickUrl(asset);
  if (!url) throw new Error(`${name} 入库后 40 次轮询仍未拿到地址`);
  const assetId = asset?.obsTaskId ?? asset?.assetId ?? asset?.taskId ?? null;
  logStep({ op: 'asset.ready', file: name, assetId, url, note: '入库完成（obsTaskId 即资产 ID）' });
  return { file: name, bytes: bytes.length, md5, assetId, url };
}

async function createTask(resources, name, quality, scene = 'space') {
  const payload = { name, resources, scene, taskQuality: quality };
  const { body } = await call('recon.create', `${BASE}/world/v1/reconstructions`, {
    method: 'POST',
    headers: { Authorization: KEY, 'Content-Type': 'application/json', 'x-source': 'openapi' },
    body: JSON.stringify(payload),
  });
  const taskId = body?.worldId ?? unwrap(body)?.worldId;
  if (!taskId) throw new Error('recon.create 响应缺少 worldId');
  logStep({ op: 'recon.task', taskId, name, note: '建任务成功' });
  return taskId;
}

async function pollTask(taskId, maxMinutes = 45) {
  const deadline = Date.now() + maxMinutes * 60_000;
  let detail;
  while (Date.now() < deadline) {
    await sleep(10_000);
    const { body } = await call('recon.status', `${BASE}/world/v1/${encodeURIComponent(taskId)}`, {
      headers: { Authorization: KEY, 'x-source': 'openapi' },
    });
    detail = unwrap(body);
    const status = String(detail?.status ?? '');
    logStep({ op: 'recon.poll', taskId, status, progress: detail?.progress, note: '' });
    if (['SUCCEEDED', 'SUCCESS', 'COMPLETED', 'FAILED', 'FAILURE', 'ERROR', 'CANCELLED', 'CANCELED'].includes(status)) break;
  }
  if (!detail) throw new Error('轮询超时且没有拿到详情');
  return detail;
}

async function downloadSpz(detail, taskId) {
  const urls = detail?.assets?.splats?.urls ?? {};
  const spz = urls.spzPath;
  if (!spz) return { spzPath: null, local: null, bytes: 0, magicOk: false, note: '详情中没有 spzPath' };
  const res = await fetch(spz, { signal: AbortSignal.timeout(600000) });
  const buf = Buffer.from(await res.arrayBuffer());
  const file = join(OUT, `${taskId}.spz`);
  await writeFile(file, buf);
  const magicOk = buf[0] === 0x1f && buf[1] === 0x8b && buf[2] === 0x08;
  logStep({ op: 'artifact.download', http: res.status, taskId, bytes: buf.length, magicOk, local: file });
  return { spzPath: spz, plyPath: urls.plyPath ?? null, lodMetaPath: urls.lodMetaPath ?? null, local: file, bytes: buf.length, magicOk };
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const report = { startedAt: new Date().toISOString(), base: BASE, mode: null, taskId: null, finalStatus: null, uploads: [], artifacts: {}, steps };
  const video = getArg('--video', null);
  const framesDir = getArg('--frames', null);
  const query = getArg('--query', null);
  const name = getArg('--name', `scendance-${stamp}`);
  const quality = getArg('--quality', 'normal');
  const scene = getArg('--scene', 'space');

  if (query) {
    report.mode = 'query';
    report.taskId = query;
    const detail = await pollTask(query, 1);
    report.finalStatus = detail.status;
    report.finalDetail = detail;
    report.artifacts = await downloadSpz(detail, query);
  } else if (getArg('--url', null)) {
    // 已入库资产直建任务：同 md5 文件平台侧去重会让新上传会话秒被终结
    // （「上传任务已经结束」），此时复用上一次入库返回的 URL 即可，不再重传。
    report.mode = 'url';
    const url = getArg('--url');
    report.uploads.push({ file: '(already-ingested)', url });
    report.taskId = await createTask([{ url, type: getArg('--asset-type', 'video') }], name, quality);
    const detail = await pollTask(report.taskId);
    report.finalStatus = detail.status;
    report.finalDetail = detail;
    report.artifacts = await downloadSpz(detail, report.taskId);
  } else if (video) {
    report.mode = 'video';
    const asset = await uploadOne(resolve(video));
    report.uploads.push(asset);
    report.taskId = await createTask([{ url: asset.url, type: 'video' }], name, quality);
    const detail = await pollTask(report.taskId);
    report.finalStatus = detail.status;
    report.finalDetail = detail;
    report.artifacts = await downloadSpz(detail, report.taskId);
  } else if (framesDir) {
    report.mode = 'frames';
    const limit = Number(getArg('--limit', '0'));
    const files = (await readdir(framesDir)).filter(f => /\.(jpg|jpeg|png|webp)$/i.test(f)).sort().slice(0, limit || undefined);
    if (!files.length) throw new Error('frames 目录没有图片');
    for (const f of files) report.uploads.push(await uploadOne(join(framesDir, f)));
    if (has('--upload-only')) {
      logStep({ op: 'frames.ingest', uploaded: report.uploads.length, note: '只入库不建任务' });
    } else {
      report.taskId = await createTask(report.uploads.map(a => ({ url: a.url, type: 'image' })), name, quality, scene);
      const detail = await pollTask(report.taskId);
      report.finalStatus = detail.status;
      report.finalDetail = detail;
      report.artifacts = await downloadSpz(detail, report.taskId);
    }
  } else {
    throw new Error('用法: --video <文件> | --frames <目录> | --query <worldId>');
  }

  report.elapsedMs = Date.now() - START;
  await writeFile(join(OUT, 'chain-report.json'), JSON.stringify(report, null, 2));
  await writeFile(join(OUT, 'chain.jsonl'), logs.join('\n') + '\n');
  console.log('\n===== CHAIN REPORT =====');
  console.log(JSON.stringify({
    mode: report.mode, taskId: report.taskId, finalStatus: report.finalStatus,
    uploads: report.uploads.map(u => ({ file: u.file, bytes: u.bytes, assetId: u.assetId, url: u.url })),
    artifacts: report.artifacts, report: join(OUT, 'chain-report.json'),
  }, null, 2));
  if (report.finalStatus && report.finalStatus !== 'SUCCEEDED') process.exitCode = 1;
}

main().catch(async error => {
  console.error('[chain] 失败:', error.message);
  await mkdir(OUT, { recursive: true }).catch(() => {});
  await writeFile(join(OUT, 'chain-failed.json'), JSON.stringify({ error: redact(error.message), steps, at: new Date().toISOString() }, null, 2)).catch(() => {});
  process.exitCode = 1;
});
