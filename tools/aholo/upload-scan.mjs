#!/usr/bin/env node
// 扫描照片上传器：按 sequence 顺序逐张 PUT，带重试、断点续传、并发上限与进度。
// 用法：
//   set AHOLO_SCAN_KEY=xxx
//   node tools/aholo/upload-scan.mjs --dir scene-3d --out docs/evidence/aholo/scan-tearoom-130
//   node tools/aholo/upload-scan.mjs --dir scene-3d --out <同目录>            # 自动续传
//   node tools/aholo/upload-scan.mjs --dir scene-3d --out <同目录> --fresh    # 新开重建
import { mkdir, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createClient, fid, keyPrefix, md5, scanKey, sleep } from './lib/web-scan.mjs';

const args = process.argv.slice(2);
const arg = (name, fallback) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] ? args[i + 1] : fallback; };
const has = name => args.includes(name);

const KEY = scanKey();
const DIR = resolve(arg('--dir', 'scene-3d'));
const OUT = resolve(arg('--out', 'docs/evidence/aholo/scan-upload'));
const LIMIT = Number(arg('--limit', '0')) || Infinity;
const CONCURRENCY = Math.max(1, Math.min(8, Number(arg('--concurrency', '4'))));
const NAME = arg('--name', `scendance-scan-${new Date().toISOString().replace(/[:.]/g, '-')}`);
const STATE_PATH = join(OUT, 'upload-state.json');
const REPORT_PATH = join(OUT, 'upload-report.json');
const IMAGE_RE = /\.(jpg|jpeg|png|webp)$/i;

const client = createClient({ key: KEY });
const started = Date.now();
const t = () => ((Date.now() - started) / 1000).toFixed(1);

function log(message) { console.log(`[${t()}s] ${message}`); }

async function saveState(state) {
  const tmp = `${STATE_PATH}.tmp`;
  await writeFile(tmp, JSON.stringify(state, null, 2));
  await rename(tmp, STATE_PATH);
}

async function loadState() {
  try { return JSON.parse(await readFile(STATE_PATH, 'utf8')); } catch { return null; }
}

async function listFiles() {
  const names = (await readdir(DIR)).filter(name => IMAGE_RE.test(name) && !name.startsWith('.')).sort();
  const picked = names.slice(0, Number.isFinite(LIMIT) ? LIMIT : names.length);
  const files = [];
  for (const name of picked) {
    const info = await stat(join(DIR, name));
    files.push({ name, path: join(DIR, name), bytes: info.size });
  }
  return files;
}

/** 并发池：固定 worker 数从同一个游标取任务，保证 sequence 与文件顺序一致。 */
async function runPool(tasks, worker) {
  let cursor = 0;
  const results = [];
  const runners = new Array(Math.min(CONCURRENCY, tasks.length)).fill(0).map(async () => {
    while (true) {
      const index = cursor++;
      if (index >= tasks.length) return;
      results[index] = await worker(tasks[index], index);
    }
  });
  await Promise.all(runners);
  return results;
}

async function uploadOne(task, attempt = 1) {
  const bytes = await readFile(task.path);
  const digest = md5(bytes);
  if (digest !== task.md5) {
    task.md5 = digest;
    task.status = 'pending';
  }
  try {
    await client.uploadImage(task.pid, task.fid, bytes, task.sequence, 'image/jpeg');
    task.status = 'uploaded';
    task.uploadedAt = new Date().toISOString();
    task.attempts = attempt;
    task.uploadedBytes = bytes.length;
    return { ok: true };
  } catch (error) {
    task.attempts = attempt;
    // 4xx（除 408/429）不重试：key 无权或参数错，重试只会放大问题。
    const retryable = !error.http || error.http === 408 || error.http === 429 || error.http >= 500;
    if (!retryable || attempt >= 5) {
      task.status = 'failed';
      task.error = error.message.slice(0, 400);
      return { ok: false, error };
    }
    const delay = 1000 * 2 ** (attempt - 1);
    log(`重试 ${task.name} seq=${task.sequence} 第 ${attempt}/4 次失败，${delay}ms 后再来: ${error.message.slice(0, 160)}`);
    await sleep(delay);
    return uploadOne(task, attempt + 1);
  }
}

async function main() {
  await mkdir(OUT, { recursive: true });
  log(`key=${keyPrefix(KEY)} dir=${DIR} out=${OUT} concurrency=${CONCURRENCY}`);
  const files = await listFiles();
  if (!files.length) throw new Error('目录没有可用图片');
  const totalBytes = files.reduce((sum, file) => sum + file.bytes, 0);

  let state = has('--fresh') ? null : await loadState();
  if (!state?.reconstructionId) {
    log(`新建 reconstruction：${NAME}`);
    state = { name: NAME, createdAt: new Date().toISOString(), reconstructionId: await client.createReconstruction(NAME), items: [] };
    await saveState(state);
  } else {
    log(`续传 reconstruction=${state.reconstructionId}（已有 ${state.items?.length ?? 0} 条记录）`);
  }
  const pid = state.reconstructionId;

  // 以服务端已存在图片为准对齐：状态文件丢了也能续传，sequence 不重复。
  const existing = await client.listImages(pid, { limit: 200 });
  const bySequence = new Map((existing.items ?? []).map(item => [item.sequence, item]));
  log(`服务端已有 ${existing.items?.length ?? 0} 张，计划上传 ${files.length} 张，共 ${(totalBytes / 1048576).toFixed(1)} MB`);

  const tasks = files.map((file, index) => ({
    ...file,
    pid,
    sequence: index,
    fid: state.items?.[index]?.fid ?? fid(),
    md5: state.items?.[index]?.md5 ?? '',
    status: 'pending',
  }));
  for (const task of tasks) {
    const remote = bySequence.get(task.sequence);
    if (remote?.status === 'ready' || remote?.status === 'processing') task.status = 'uploaded';
    else if (remote?.status === 'failed') task.status = 'pending';
  }
  state.items = tasks.map(({ fid: fileId, name, sequence, md5: digest, status, error }) => ({ fid: fileId, name, sequence, md5: digest, status, error }));
  await saveState(state);

  const pending = tasks.filter(task => task.status !== 'uploaded');
  log(`需要上传 ${pending.length} 张（跳过 ${tasks.length - pending.length} 张已存在）`);

  let uploaded = 0;
  let uploadedBytes = 0;
  let failed = 0;
  const pendingBytes = pending.reduce((sum, task) => sum + task.bytes, 0);
  let lastReport = 0;

  await runPool(pending, async task => {
    const result = await uploadOne(task);
    // 每张单独落盘，进程被杀也能续。
    const record = state.items[task.sequence];
    record.status = task.status;
    record.error = task.error;
    record.md5 = task.md5;
    record.attempts = task.attempts;
    await saveState(state);
    if (result.ok) {
      uploaded += 1;
      uploadedBytes += task.bytes;
      const done = uploaded + failed;
      if (Date.now() - lastReport > 3000 || done === pending.length) {
        lastReport = Date.now();
        const rate = uploadedBytes / 1048576 / Math.max(0.001, (Date.now() - started) / 1000);
        log(`进度 ${done}/${pending.length} 张，${(uploadedBytes / 1048576).toFixed(1)}/${(pendingBytes / 1048576).toFixed(1)} MB，${rate.toFixed(1)} MB/s`);
      }
    } else {
      failed += 1;
      log(`失败 ${task.name} seq=${task.sequence}: ${task.error}`);
    }
  });

  // 上传完再等服务端预处理，把 ready/failed 的真实数字带回来。
  log('等待服务端预处理（status 而非 progress）…');
  const items = await client.waitImages(pid, tasks.length, {
    maxMinutes: 20,
    onTick: tick => log(`预处理 total=${tick.total} ready=${tick.ready} failed=${tick.failed} processing=${tick.processing}`),
  });
  const states = { total: items.length, ready: items.filter(i => i.status === 'ready').length, failed: items.filter(i => i.status === 'failed').length };

  const report = {
    startedAt: state.createdAt,
    finishedAt: new Date().toISOString(),
    elapsedSeconds: client.elapsedSeconds(),
    reconstructionId: pid,
    requested: tasks.length,
    uploaded,
    skipped: tasks.length - pending.length,
    failed,
    uploadedBytes,
    totalBytes,
    throughputMBps: uploadedBytes / 1048576 / Math.max(0.001, client.elapsedSeconds()),
    serverImages: states,
    keyPrefix: keyPrefix(KEY),
    steps: client.steps,
  };
  await writeFile(REPORT_PATH, JSON.stringify(report, null, 2));
  console.log('\n===== UPLOAD REPORT =====');
  console.log(JSON.stringify({ reconstructionId: pid, requested: tasks.length, uploaded, skipped: report.skipped, failed, uploadedBytes, totalBytes, throughputMBps: report.throughputMBps.toFixed(2), serverImages: states }, null, 2));
}

main().catch(async error => {
  console.error('[upload][FAIL]', error.message);
  try {
    await mkdir(OUT, { recursive: true });
    await writeFile(join(OUT, 'upload-fail.json'), JSON.stringify({ at: new Date().toISOString(), error: error.message, http: error.http ?? null, body: error.body ?? null, steps: client.steps }, null, 2));
  } catch { /* 落盘失败不影响退出码 */ }
  process.exit(1);
});
