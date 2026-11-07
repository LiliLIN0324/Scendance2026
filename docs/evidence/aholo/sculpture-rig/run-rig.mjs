#!/usr/bin/env node
// 实跑：把本地 MODEL.glb 入库 → 提交 Lux3D 数字人自动绑骨 → 轮询到终态 → 下载产物。
// 只跑这一尊雕塑。凭据从仓库 .env.local 的 LUX3D_API_KEY 读取，不落盘、不打印。
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const BASE = (process.env.LUX3D_BASE_URL ?? 'https://api.aholo3d.cn').replace(/\/+$/, '');
const OUT = process.env.LUX3D_OUT ?? 'docs/evidence/aholo/sculpture-rig';
const GLB_CANDIDATES = process.env.LUX3D_GLB ? [process.env.LUX3D_GLB] : [
  'docs/evidence/aholo/sculpture-img2-3d/MODEL.glb',
  'docs/evidence/aholo/sculpture-img2-3d/4676340-unpacked/MODEL.glb',
];

function loadKey() {
  if (process.env.LUX3D_API_KEY) return process.env.LUX3D_API_KEY;
  try {
    const text = readFileSyncText('.env.local');
    const line = text.split(/\r?\n/).find(l => l.trim().startsWith('LUX3D_API_KEY='));
    return line ? line.split('=').slice(1).join('=').trim() : '';
  } catch { return ''; }
}
function readFileSyncText(p) { return readFileSync(p, 'utf8'); }
import { readFileSync } from 'node:fs';

const KEY = loadKey();
if (!KEY) { console.error('缺少 LUX3D_API_KEY'); process.exit(2); }
const redact = s => String(s).replaceAll(KEY, '[REDACTED]');

const log = [];
const t0 = Date.now();
const stamp = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`;
function note(op, data) {
  const entry = { at: stamp(), iso: new Date().toISOString(), op, ...data };
  log.push(entry);
  console.log(`[${entry.at}] ${op} ${JSON.stringify(data).slice(0, 900)}`);
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

function unwrap(body) { return body?.d ?? body?.data ?? body; }

async function uploadGlb(file) {
  const bytes = await readFile(file);
  const name = path.basename(file);
  const md5 = createHash('md5').update(bytes).digest('hex');
  note('local.file', { file, bytes: bytes.length, md5 });

  const t = Date.now();
  const res = await fetch(`${BASE}/asset/v1/token`, { headers: { Authorization: KEY }, signal: AbortSignal.timeout(30000) });
  const text = await res.text();
  let body; try { body = JSON.parse(text); } catch { body = text; }
  note('asset.token', { http: res.status, response: redact(JSON.stringify(body)).slice(0, 800) });
  if (!res.ok) throw new Error(`asset token HTTP ${res.status}`);
  const d = unwrap(body);
  if (!d?.ousToken || !d?.globalDomain) throw new Error('asset token 响应缺少 ousToken/globalDomain');
  const token = d.ousToken;
  const domain = String(d.globalDomain).replace(/\/+$/, '');
  const blockSize = Number(d.blockSize) || 5 * 1024 * 1024;

  const form = new FormData();
  form.append('md5', md5);
  form.append('file', new Blob([bytes]), name);
  const upRes = await fetch(`${domain}/ous/api/v2/single/upload`, {
    method: 'POST', headers: { 'ous-token-v2': token }, body: form, signal: AbortSignal.timeout(600000),
  });
  const upText = await upRes.text();
  let upBody; try { upBody = JSON.parse(upText); } catch { upBody = upText; }
  note('asset.single', { http: upRes.status, response: redact(upText).slice(0, 800) });
  if (!upRes.ok) throw new Error(`single upload HTTP ${upRes.status}`);

  let asset = unwrap(upBody);
  for (let attempt = 1; attempt <= 40; attempt++) {
    const stRes = await fetch(`${domain}/ous/api/v2/upload/status?md5=${md5}`, { headers: { 'ous-token-v2': token }, signal: AbortSignal.timeout(30000) });
    const stText = await stRes.text();
    let stBody; try { stBody = JSON.parse(stText); } catch { stBody = stText; }
    const dd = unwrap(stBody);
    if (dd?.url) {
      asset = dd;
      note('asset.status', { attempt, http: stRes.status, url: dd.url, assetId: dd.obsTaskId ?? null });
      break;
    }
    note('asset.status', { attempt, http: stRes.status, pending: true });
    await sleep(2000);
  }
  const url = asset?.url ?? null;
  if (!url) throw new Error('入库后 40 次轮询仍未拿到地址');
  return { file: name, bytes: bytes.length, md5, url, assetId: asset?.obsTaskId ?? null, uploadMs: Date.now() - t };
}

async function createRig(modelUrl) {
  const t = Date.now();
  const res = await fetch(`${BASE}/lux3d/v1/animations/rig/task/create`, {
    method: 'POST',
    headers: { Authorization: KEY, 'Content-Type': 'application/json', 'x-source': 'openapi' },
    body: JSON.stringify({ modelUrl }),
    signal: AbortSignal.timeout(120000),
  });
  const text = await res.text();
  let body; try { body = JSON.parse(text); } catch { body = text; }
  note('rig.create', { http: res.status, response: redact(text).slice(0, 2000), ms: Date.now() - t });
  if (!res.ok) throw new Error(`rig create HTTP ${res.status}: ${redact(text).slice(0, 500)}`);
  const taskId = unwrap(body);
  if (typeof taskId !== 'number' && typeof taskId !== 'string') throw new Error(`rig create 未返回 taskId: ${redact(text).slice(0, 500)}`);
  return { taskId, httpStatus: res.status, raw: body };
}

const TERMINAL = new Set([3, 4, 6]);
const STATUS_LABEL = { 0: '初始化', 1: '运行中', 3: '成功', 4: '失败', 6: '已取消' };

async function poll(taskId, maxMinutes = 30) {
  const deadline = Date.now() + maxMinutes * 60000;
  let polls = 0;
  let detail = null;
  while (Date.now() < deadline) {
    polls += 1;
    const res = await fetch(`${BASE}/lux3d/v1/generate/task/get?taskid=${taskId}`, {
      headers: { Authorization: KEY, 'x-source': 'openapi' }, signal: AbortSignal.timeout(30000),
    });
    const text = await res.text();
    let body; try { body = JSON.parse(text); } catch { body = text; }
    detail = unwrap(body);
    const status = Number(detail?.status);
    note('rig.poll', {
      polls, http: res.status, status, label: STATUS_LABEL[status] ?? '未知',
      progress: detail?.progress ?? null,
      outputs: Array.isArray(detail?.outputs) ? detail.outputs.map(o => (typeof o.content === 'string' ? o.content.slice(0, 200) : o.content)) : undefined,
    });
    if (TERMINAL.has(status)) return { detail, polls, elapsedMs: Date.now() - tCreate };
    await sleep(5000);
  }
  throw new Error(`超过 ${maxMinutes} 分钟未到终态`);
}

let tCreate = Date.now();

const summary = {
  startedAt: new Date().toISOString(),
  base: BASE,
  endpoint: `${BASE}/lux3d/v1/animations/rig/task/create`,
  request: null, upload: null, taskId: null, createResponse: null,
  polls: 0, finalStatus: null, finalStatusLabel: null, finalDetail: null,
  credits: '接口不返回', artifact: null, error: null,
};

let glbPath = null;
for (const c of GLB_CANDIDATES) if (existsSync(c)) { glbPath = c; break; }
if (!glbPath) { console.error('找不到 MODEL.glb，候选：', GLB_CANDIDATES); process.exit(3); }

try {
  await mkdir(OUT, { recursive: true });
  const up = await uploadGlb(glbPath);
  summary.upload = up;
  summary.request = { modelUrl: up.url };
  tCreate = Date.now();
  const created = await createRig(up.url);
  summary.taskId = created.taskId;
  summary.createResponse = created.raw;
  const { detail, polls } = await poll(created.taskId);
  summary.polls = polls;
  summary.finalStatus = Number(detail?.status);
  summary.finalStatusLabel = STATUS_LABEL[summary.finalStatus] ?? '未知';
  summary.finalDetail = detail;

  const outputs = Array.isArray(detail?.outputs) ? detail.outputs : [];
  const content = outputs.map(o => o?.content).filter(Boolean);
  const first = content[0];
  if (summary.finalStatus === 3 && typeof first === 'string' && first.startsWith('http')) {
    const res = await fetch(first, { signal: AbortSignal.timeout(600000) });
    const buf = Buffer.from(await res.arrayBuffer());
    const file = path.join(OUT, `rigged-${created.taskId}.glb`);
    await writeFile(file, buf);
    summary.artifact = { url: first, local: file, bytes: buf.length, http: res.status };
    note('artifact.download', summary.artifact);
  } else if (summary.finalStatus === 4) {
    summary.error = typeof first === 'string' ? first : JSON.stringify(content);
  }
} catch (e) {
  summary.error = redact(e.message);
  console.error('[FAIL]', redact(e.message));
}

summary.elapsedMs = Date.now() - t0;
summary.elapsedSeconds = Math.round(summary.elapsedMs / 1000);
await mkdir(OUT, { recursive: true });
await writeFile(path.join(OUT, 'rig-report.json'), JSON.stringify(summary, null, 2));
await writeFile(path.join(OUT, 'rig-run.jsonl'), log.map(l => JSON.stringify(l)).join('\n') + '\n');
console.log('\n===== RIG REPORT =====');
console.log(JSON.stringify({
  taskId: summary.taskId, finalStatus: summary.finalStatus, label: summary.finalStatusLabel,
  polls: summary.polls, elapsedSeconds: summary.elapsedSeconds, artifact: summary.artifact, error: summary.error,
}, null, 2));
process.exitCode = summary.finalStatus === 3 ? 0 : 1;
