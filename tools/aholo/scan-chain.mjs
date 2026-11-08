#!/usr/bin/env node
// Aholo web-scan（Reality 2.0）重建链路：建 reconstruction → 逐张 PUT 图片（带 sequence）→ 等预处理 → 建 job → 轮询 → 记录产物。
// 用法：
//   set AHOLO_SCAN_KEY=xxx   （Bearer key，只从环境变量读）
//   node tools/aholo/scan-chain.mjs --probe
//   node tools/aholo/scan-chain.mjs --dir <图片目录> [--limit 20] [--name xxx] [--mode scene] [--out <目录>] [--download spz]
// 与 tools/aholo/recon-chain.mjs（world/v1 那套）互不影响，不改动它。
import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const BASE = (process.env.AHOLO_SCAN_BASE_URL ?? 'https://studio.aholo3d.cn/api/web-scan/v1').replace(/\/+$/, '');
const KEY = process.env.AHOLO_SCAN_KEY;
if (!KEY) {
  console.error('[scan] 缺少 AHOLO_SCAN_KEY 环境变量');
  process.exit(2);
}
const args = process.argv.slice(2);
const getArg = (n, d) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const has = n => args.includes(n);
const START = Date.now();
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const OUT = resolve(getArg('--out', `docs/evidence/aholo/scan-${stamp}`));
const steps = [];
const redact = s => String(s).replaceAll(KEY, '[REDACTED]');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const t = () => ((Date.now() - START) / 1000).toFixed(1);

function logStep(o) {
  steps.push(o);
  console.log(`[${t()}s] ${o.op} http=${o.http ?? '-'} ${o.note ?? ''}`.trim());
}

async function call(op, url, init = {}) {
  const res = await fetch(url, { ...init, headers: { Authorization: `Bearer ${KEY}`, ...(init.headers || {}) }, signal: AbortSignal.timeout(init.timeoutMs ?? 600000) });
  const text = await res.text();
  let body; try { body = JSON.parse(text); } catch { body = text; }
  logStep({ op, http: res.status, retryAfter: res.headers.get('retry-after'), note: op, response: redact(typeof body === 'string' ? body : JSON.stringify(body)).slice(0, 4000) });
  if (!res.ok) {
    const err = new Error(`${op} HTTP ${res.status}: ${redact(text).slice(0, 800)}`);
    err.http = res.status; err.body = body;
    throw err;
  }
  return { body, status: res.status, headers: res.headers };
}

function fid() { return randomBytes(16).toString('hex'); }

async function probe() {
  const { body, status } = await call('scan.probe', `${BASE}/reconstructions?limit=1`, {});
  console.log(`[scan] probe ok http=${status} items=${body?.items?.length ?? 0}`);
  return body;
}

async function createReconstruction(name) {
  const { body } = await call('scan.create', `${BASE}/reconstructions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, pose_units: 'metres', remove_people: true }),
  });
  if (!body?.id) throw new Error('create 响应缺少 id');
  return body.id;
}

async function uploadImage(pid, file, sequence) {
  const bytes = await readFile(file);
  const id = fid();
  const md5 = createHash('md5').update(bytes).digest('hex');
  const name = file.split(/[\\/]/).pop();
  const { body } = await call('scan.image', `${BASE}/reconstructions/${pid}/images/${id}?sequence=${sequence}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'image/jpeg' },
    body: bytes,
  });
  logStep({ op: 'scan.image.ok', http: 201, note: `${name} seq=${sequence} bytes=${bytes.length} md5=${md5} status=${body?.status}` });
  return { file: name, id, sequence, bytes: bytes.length, md5, status: body?.status };
}

async function waitImages(pid, expect, maxMinutes = 15) {
  const deadline = Date.now() + maxMinutes * 60_000;
  let items = [];
  while (Date.now() < deadline) {
    const { body } = await call('scan.images', `${BASE}/reconstructions/${pid}/images?limit=200`);
    items = body?.items ?? [];
    const ready = items.filter(i => i.status === 'ready').length;
    const failed = items.filter(i => i.status === 'failed').length;
    logStep({ op: 'scan.images.poll', note: `total=${items.length} ready=${ready} failed=${failed}` });
    if (items.length >= expect && ready + failed === items.length) break;
    await sleep(5000);
  }
  return items;
}

async function createJob(pid, mode, quality) {
  const body = { output_formats: ['ply', 'spz'], mode, remove_people: true, axes: 'opencv' };
  if (quality) body.quality = quality;
  const r = await call('scan.job', `${BASE}/reconstructions/${pid}/jobs`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  if (!r.body?.id) throw new Error('job 响应缺少 id');
  return r.body;
}

async function pollJob(pid, rid, maxMinutes = 40) {
  const deadline = Date.now() + maxMinutes * 60_000;
  let job;
  while (Date.now() < deadline) {
    await sleep(10000);
    const { body, headers } = await call('scan.job.poll', `${BASE}/reconstructions/${pid}/jobs/${rid}`);
    job = body;
    logStep({ op: 'scan.job.poll', note: `status=${body?.status} stage=${body?.stage} registered=${body?.registered_image_count}/${body?.input_image_count}` });
    if (['succeeded', 'failed'].includes(body?.status)) break;
    const ra = Number(headers.get('retry-after'));
    if (ra > 0) await sleep(Math.min(ra * 1000, 30000));
  }
  return job;
}

async function headArtifacts(job) {
  const out = [];
  for (const a of job?.artifacts ?? []) {
    try {
      const res = await fetch(a.href, { method: 'HEAD', headers: { Authorization: `Bearer ${KEY}` }, signal: AbortSignal.timeout(60000) });
      out.push({ name: a.name, format: a.format, bytes: Number(res.headers.get('content-length')) || null, http: res.status });
    } catch (e) { out.push({ name: a.name, format: a.format, error: String(e) }); }
  }
  return out;
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const report = { startedAt: new Date().toISOString(), base: BASE, mode: null, reconstructionId: null, jobId: null, finalStatus: null, uploads: [], job: null, artifacts: [], steps };

  if (has('--probe')) { report.mode = 'probe'; await probe(); await writeFile(join(OUT, 'probe.json'), JSON.stringify(report, null, 2)); return; }

  const dir = getArg('--dir', null);
  if (!dir) throw new Error('缺少 --dir（图片目录）');
  const limit = Number(getArg('--limit', '0'));
  const name = getArg('--name', `scendance-scan-${stamp}`);
  const mode = getArg('--mode', 'scene');
  const quality = getArg('--quality', null);

  const files = (await readdir(dir)).filter(f => /\.(jpg|jpeg|png|webp)$/i.test(f)).sort().slice(0, limit || undefined);
  if (!files.length) throw new Error('目录没有图片');
  const totalBytes = (await Promise.all(files.map(async f => (await stat(join(dir, f))).size))).reduce((a, b) => a + b, 0);
  logStep({ op: 'scan.plan', note: `files=${files.length} totalBytes=${totalBytes} name=${name} mode=${mode}` });

  report.mode = 'frames';
  report.reconstructionId = await createReconstruction(name);
  for (const [i, f] of files.entries()) report.uploads.push(await uploadImage(report.reconstructionId, join(dir, f), i));
  const images = await waitImages(report.reconstructionId, files.length);
  report.imageStates = { total: images.length, ready: images.filter(i => i.status === 'ready').length, failed: images.filter(i => i.status === 'failed').length };

  const job = await createJob(report.reconstructionId, mode, quality);
  report.jobId = job.id;
  const done = await pollJob(report.reconstructionId, job.id);
  report.finalStatus = done?.status;
  report.job = done;
  report.artifacts = await headArtifacts(done);

  if (has('--download')) {
    const want = getArg('--download', 'spz');
    for (const a of done?.artifacts ?? []) {
      if (!want.split(',').includes(a.format) && !want.split(',').includes(a.name)) continue;
      const res = await fetch(a.href, { headers: { Authorization: `Bearer ${KEY}` }, signal: AbortSignal.timeout(600000) });
      const buf = Buffer.from(await res.arrayBuffer());
      await writeFile(join(OUT, a.name), buf);
      logStep({ op: 'scan.download', http: res.status, note: `${a.name} ${buf.length} bytes` });
    }
  }

  report.elapsedSeconds = (Date.now() - START) / 1000;
  await writeFile(join(OUT, 'scan-report.json'), JSON.stringify(report, null, 2));
  console.log('\n===== SCAN REPORT =====');
  console.log(JSON.stringify({ reconstructionId: report.reconstructionId, jobId: report.jobId, finalStatus: report.finalStatus, imageStates: report.imageStates, registered: done?.registered_image_count, input: done?.input_image_count, error: done?.error, artifacts: report.artifacts, elapsedSeconds: report.elapsedSeconds }, null, 2));
}

main().catch(async e => {
  console.error('[scan][FAIL]', e.message);
  try {
    await mkdir(OUT, { recursive: true });
    await writeFile(join(OUT, 'scan-fail.json'), JSON.stringify({ at: new Date().toISOString(), http: e.http ?? null, error: e.message, body: e.body ?? null, steps }, null, 2));
  } catch { /* 落盘失败不影响退出码 */ }
  process.exit(1);
});
