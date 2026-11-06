#!/usr/bin/env node
// 作业客户端：建 job → 只按 status/stage 轮询 → 成功列产物，失败原样抛 error。
// 用法：
//   node tools/aholo/job-scan.mjs --pid <reconstructionId> --out docs/evidence/aholo/scan-tearoom-130 \
//     [--quality fast|high] [--mode scene] [--steps 30000] [--timeout-min 90]
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createClient, scanKey } from './lib/web-scan.mjs';

const args = process.argv.slice(2);
const arg = (name, fallback) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] ? args[i + 1] : fallback; };

const KEY = scanKey();
const OUT = resolve(arg('--out', 'docs/evidence/aholo/scan-job'));
const QUALITY = arg('--quality', '');
const MODE = arg('--mode', 'scene');
const STEPS = Number(arg('--steps', '0')) || 0;
const MAX_GAUSSIANS = Number(arg('--max-gaussians', '0')) || 0;
const TIMEOUT_MIN = Number(arg('--timeout-min', '90'));
const POLL_MS = Number(arg('--poll-ms', '10000'));

async function readJson(path) { try { return JSON.parse(await readFile(path, 'utf8')); } catch { return null; } }

async function main() {
  await mkdir(OUT, { recursive: true });
  const upload = await readJson(join(OUT, 'upload-report.json')) ?? await readJson(join(OUT, 'upload-state.json'));
  const pid = arg('--pid', upload?.reconstructionId);
  if (!pid) throw new Error('缺少 --pid，也找不到 upload-report.json / upload-state.json');

  const client = createClient({ key: KEY });
  console.log(`reconstruction=${pid} out=${OUT} mode=${MODE} quality=${QUALITY || '默认'} steps=${STEPS || '默认'}`);

  let job = await readJson(join(OUT, 'job.json'));
  const reusable = job?.status === 'succeeded' && job?.id;
  if (!reusable) {
    const created = await client.createJob(pid, {
      mode: MODE,
      quality: QUALITY || undefined,
      outputFormats: ['ply', 'spz'],
      axes: 'opencv',
      steps: STEPS || undefined,
      maxGaussians: MAX_GAUSSIANS || undefined,
    });
    job = created;
    await writeFile(join(OUT, 'job.json'), JSON.stringify(job, null, 2));
    console.log(`job=${job.id} status=${job.status} stage=${job.stage}`);
  } else {
    console.log(`复用已成功的 job=${job.id}`);
  }

  let lastStage = job.stage;
  try {
    job = await client.waitJob(pid, job.id, {
      timeoutMinutes: TIMEOUT_MIN,
      intervalMs: POLL_MS,
      onTick: next => {
        if (next.stage !== lastStage || next.status !== 'running') {
          console.log(`[${client.elapsedSeconds().toFixed(0)}s] status=${next.status} stage=${next.stage} registered=${next.registered_image_count ?? '-'}/${next.input_image_count ?? '-'}`);
          lastStage = next.stage;
        }
      },
    });
  } catch (error) {
    const fail = {
      at: new Date().toISOString(),
      reconstructionId: pid,
      jobId: job?.id,
      status: error.job?.status ?? 'unknown',
      stage: error.stage ?? error.job?.stage ?? null,
      error: error.job?.error ?? error.message,
      job: error.job ?? null,
      steps: client.steps,
    };
    await writeFile(join(OUT, 'job-fail.json'), JSON.stringify(fail, null, 2));
    console.error('\n===== JOB FAILED =====');
    console.error(`status=${fail.status} stage=${fail.stage}`);
    console.error(`error=${fail.error}`);
    process.exit(1);
  }

  const artifacts = [];
  for (const artifact of job.artifacts ?? []) {
    artifacts.push({ ...artifact, ...(await client.headArtifact(artifact)) });
  }
  const report = {
    finishedAt: new Date().toISOString(),
    elapsedSeconds: client.elapsedSeconds(),
    reconstructionId: pid,
    jobId: job.id,
    status: job.status,
    stage: job.stage,
    mode: job.mode,
    quality: job.quality,
    steps: job.steps,
    axes: job.axes,
    inputImages: job.input_image_count,
    registeredImages: job.registered_image_count,
    artifacts,
    stepsLog: client.steps,
  };
  await writeFile(join(OUT, 'job.json'), JSON.stringify({ ...job, artifacts }, null, 2));
  await writeFile(join(OUT, 'job-report.json'), JSON.stringify(report, null, 2));

  console.log('\n===== JOB REPORT =====');
  console.log(JSON.stringify({
    jobId: job.id,
    status: job.status,
    stage: job.stage,
    axes: job.axes,
    quality: job.quality,
    steps: job.steps,
    inputImages: job.input_image_count,
    registeredImages: job.registered_image_count,
    artifacts: artifacts.map(a => ({ name: a.name, format: a.format, bytes: a.bytes })),
    elapsedSeconds: client.elapsedSeconds(),
  }, null, 2));
}

main().catch(async error => {
  console.error('[job][FAIL]', error.message);
  try {
    await mkdir(OUT, { recursive: true });
    await writeFile(join(OUT, 'job-fail.json'), JSON.stringify({ at: new Date().toISOString(), error: error.message, http: error.http ?? null, body: error.body ?? null }, null, 2));
  } catch { /* 忽略 */ }
  process.exit(1);
});
