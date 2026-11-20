#!/usr/bin/env node
// Lux3D 批量文生 3D  runner（临期积分批量补库用，不进产品链路）。
//
// 流程：读 manifest → 并发创建 text-to-3d 任务 → 轮询终态 → 下载 GLB/ZIP → 写 state.json。
// 凭据只从仓库根 .env.local 的 LUX3D_API_KEY 读取，不落盘、不打印。产物落 .cache/aholo/batch-<date>/，
// 今晚不登记 catalogue；归一化（厘米转米、Z-up、面数/尺寸门禁）与入库放到后续人工验收环节。
//
// 用法（仓库根目录运行）：
//   node tools/aholo/lux3d-batch.mjs --dry-run
//   node tools/aholo/lux3d-batch.mjs --concurrency 3 --limit 20
//   node tools/aholo/lux3d-batch.mjs --only aholo-20261119-grand-opening-flower-basket
//   node tools/aholo/lux3d-batch.mjs --shard 1/3
//
// 退出码：0 全部成功或跳过；1 有失败（失败任务不扣分，可重跑续上）；2 配置/网络致命错误。
import { mkdir, readFile, writeFile, readdir, stat } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../');
const STATE_VERSION = 1;

// ---------- 参数 ----------
const argv = process.argv.slice(2);
const arg = (name, fallback = null) => {
  const at = argv.indexOf(name);
  return at >= 0 && argv[at + 1] && !argv[at + 1].startsWith('--') ? argv[at + 1] : fallback;
};
const flags = new Set(argv.filter(a => a.startsWith('--')).map(a => a.replace(/^--/, '')));
const manifestPath = path.resolve(ROOT, arg('--manifest', 'tools/aholo/batch-manifest.json'));
const outDir = path.resolve(ROOT, arg('--out', `.cache/aholo/batch-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}`));
const concurrency = Number(arg('--concurrency', '3'));
const limit = Number(arg('--limit', '0')) || Infinity;
const version = arg('--version', 'G1');
const faceCount = Number(arg('--face-count', '30000'));
const pollMs = Number(arg('--poll-ms', '5000'));
const maxMinutes = Number(arg('--max-minutes', '25'));
const onlySlug = arg('--only', null);
const dryRun = flags.has('dry-run');
const [shardIdx, shardTotal] = (arg('--shard', null) || '').split('/').map(Number);

// ---------- 凭据 ----------
function loadKey() {
  if (process.env.LUX3D_API_KEY) return process.env.LUX3D_API_KEY;
  try {
    const text = readFileSync(path.join(ROOT, '.env.local'), 'utf8');
    const line = text.split(/\r?\n/).find(l => l.trim().startsWith('LUX3D_API_KEY='));
    return line ? line.split('=').slice(1).join('=').trim() : '';
  } catch { return ''; }
}
const KEY = loadKey();
const BASE = (process.env.LUX3D_BASE_URL ?? 'https://api.aholo.cn').replace(/\/+$/, '');
if (!KEY && !dryRun) { console.error('[batch] 缺少 LUX3D_API_KEY（.env.local 或环境变量）'); process.exit(2); }
const redact = s => String(s ?? '').replaceAll(KEY, '[REDACTED]');

// ---------- 状态 ----------
const statePath = path.join(outDir, 'state.json');
let state = { version: STATE_VERSION, startedAt: new Date().toISOString(), base: BASE, entries: {} };
if (existsSync(statePath)) {
  try { state = JSON.parse(await readFile(statePath, 'utf8')); } catch { /* 损坏就重建 */ }
}
const saveState = async () => {
  state.updatedAt = new Date().toISOString();
  await writeFile(statePath, JSON.stringify(state, null, 2));
};

// ---------- HTTP ----------
async function api(method, urlPath, body, retriesOnLimit = 0) {
  const url = urlPath.startsWith('http') ? urlPath : `${BASE}${urlPath}`;
  const init = {
    method,
    headers: { Authorization: KEY, 'Content-Type': 'application/json', 'x-source': 'openapi' },
    signal: AbortSignal.timeout(120000),
  };
  if (body) init.body = JSON.stringify(body);
  let res;
  try {
    res = await fetch(url, init);
  } catch (e) {
    if (retriesOnLimit < 4) { await sleep(10_000 * (retriesOnLimit + 1)); return api(method, urlPath, body, retriesOnLimit + 1); }
    throw new Error(`网络错误: ${e.message}`);
  }
  const text = await res.text();
  let parsed; try { parsed = JSON.parse(text); } catch { parsed = text; }
  const code = parsed?.c;
  const msg = parsed?.m ?? parsed?.message ?? '';
  const isLimit = code === 'GENERATION_CONCURRENCY_LIMIT_EXCEEDED' || /concurrenc|rate limit|全局任务并发/i.test(String(msg));
  const isNoCredit = /insufficient credit|no credits|积分不足|11003/i.test(String(msg)) || parsed?.f?.details?.metaData?.bizCode === '11003';
  if (isNoCredit) throw new Error('INSUFFICIENT_CREDITS: 积分不足，停止提交');
  if (!res.ok || (code && code !== '0')) {
    const err = new Error(`HTTP ${res.status} c=${code ?? '-'} m=${redact(msg).slice(0, 300)}`);
    err.bizCode = code;
    err.limit = isLimit;
    throw err;
  }
  return parsed?.d ?? parsed?.data ?? parsed;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
const TERMINAL = new Set([3, 4, 6]);
const STATUS_LABEL = { 0: '初始化', 1: '运行中', 3: '成功', 4: '失败', 6: '已取消' };

function pickTaskId(d) { return d?.taskId ?? d?.taskid ?? (typeof d === 'number' ? d : null); }

async function createTask(entry) {
  const payload = {
    prompt: entry.prompt,
    style: entry.style ?? 'photorealistic',
    version,
    faceCount: entry.faceCount ?? faceCount,
    outputFormat: ['zip', 'glb'],
    aiPredictSize: true,
  };
  const d = await api('POST', '/lux3d/v1/generate/text-to-3d/task/create', payload);
  const taskId = pickTaskId(d);
  if (!taskId) throw new Error(`创建响应无 taskId: ${redact(JSON.stringify(d)).slice(0, 300)}`);
  return Number(taskId);
}

async function pollTask(taskId, slug) {
  const deadline = Date.now() + maxMinutes * 60_000;
  let polls = 0;
  while (Date.now() < deadline) {
    const d = await api('GET', `/lux3d/v1/generate/task/get?taskid=${taskId}`);
    const status = Number(d?.status);
    if (polls === 0 || TERMINAL.has(status) || polls % 6 === 0) {
      console.log(`[${slug}] status=${status}(${STATUS_LABEL[status] ?? '未知'}) polls=${polls}`);
    }
    if (TERMINAL.has(status)) return d;
    polls += 1;
    await sleep(pollMs);
  }
  throw new Error(`超过 ${maxMinutes} 分钟未到终态`);
}

function outputUrls(detail) {
  const urls = [];
  for (const o of Array.isArray(detail?.outputs) ? detail.outputs : []) {
    const raw = o?.content;
    if (typeof raw !== 'string' || !raw.trim()) continue;
    const t = raw.trim();
    if (t.startsWith('[')) {
      try { for (const x of JSON.parse(t)) if (typeof x === 'string' && /^https?:/.test(x)) urls.push(x); } catch { /* 单 URL */ }
      continue;
    }
    if (/^https?:/.test(t)) urls.push(t);
  }
  return urls;
}

async function download(entry, detail) {
  const dir = path.join(outDir, entry.slug);
  await mkdir(dir, { recursive: true });
  const urls = outputUrls(detail);
  const zipUrl = urls.find(u => /\.zip(\?|$)/i.test(u));
  const glbUrl = urls.find(u => /\.glb(\?|$)/i.test(u));
  const saved = { outputs: urls, glb: null, zip: null, bytes: 0 };

  if (zipUrl) {
    const zipPath = path.join(dir, 'result.zip');
    const buf = Buffer.from(await (await fetch(zipUrl, { signal: AbortSignal.timeout(600_000) })).arrayBuffer());
    await writeFile(zipPath, buf);
    saved.zip = path.relative(outDir, zipPath);
  }
  let glbPath = glbUrl ? path.join(dir, 'model.glb') : null;
  if (glbUrl) {
    const buf = Buffer.from(await (await fetch(glbUrl, { signal: AbortSignal.timeout(600_000) })).arrayBuffer());
    await writeFile(glbPath, buf);
    saved.bytes = buf.length;
  } else if (zipUrl) {
    // 从 ZIP 解包找 GLB
    const unpacked = path.join(dir, 'unpacked');
    execFileSync('powershell', ['-NoProfile', '-Command', `Expand-Archive -LiteralPath '${path.join(dir, 'result.zip')}' -DestinationPath '${unpacked}' -Force`]);
    const files = await walk(unpacked);
    const glb = files.find(f => /\.glb$/i.test(f));
    if (glb) {
      glbPath = path.join(dir, 'model.glb');
      execFileSync('powershell', ['-NoProfile', '-Command', `Copy-Item -LiteralPath '${glb}' -Destination '${glbPath}' -Force`]);
      const b = await stat(glbPath);
      saved.bytes = b.size;
    }
  }
  if (glbPath && existsSync(glbPath)) {
    // 魔数校验：不信后缀
    const fd = await readFile(glbPath, { flag: 'r' });
    const magic = fd.subarray(0, 4).toString('latin1');
    if (magic !== 'glTF') throw new Error('下载文件不是合法 GLB（魔数不符）');
    saved.glb = path.relative(outDir, glbPath);
  }
  return saved;
}

async function walk(dir) {
  const out = [];
  for (const name of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, name.name);
    if (name.isDirectory()) out.push(...await walk(p)); else out.push(p);
  }
  return out;
}

// ---------- 单条任务：提交阶段 + 轮询阶段 ----------
function record(entry) {
  const prev = state.entries[entry.slug] ?? {};
  const rec = {
    ...prev, slug: entry.slug, zh: entry.zh, bucket: entry.bucket, prompt: entry.prompt,
    experimental: Boolean(entry.experimental), taskId: prev.taskId ?? null,
    status: prev.status === 'succeeded' ? 'succeeded' : 'running',
    error: prev.status === 'succeeded' ? null : (prev.error ?? null),
    outputs: prev.outputs ?? [], glb: prev.glb ?? null, zip: prev.zip ?? null, bytes: prev.bytes ?? 0,
    updatedAt: new Date().toISOString(),
  };
  state.entries[entry.slug] = rec;
  return rec;
}

async function submitWithRetry(entry, rec) {
  // 账号生成并发额度约 5：并发满属于常态，持续等到空出槽位再提交，不在提交阶段判失败。
  const deadline = Date.now() + 20 * 60_000;
  let lastErr = null;
  while (Date.now() < deadline) {
    try {
      return await createTask(entry);
    } catch (e) {
      lastErr = e;
      if (!e.limit) throw e;
      console.log(`[${entry.slug}] 并发额度已满，20s 后重试`);
      await sleep(20_000);
    }
  }
  throw lastErr ?? new Error('等待并发槽位超时');
}

async function runEntry(entry) {
  const rec = record(entry);
  if (rec.status === 'succeeded' && rec.glb && existsSync(path.join(outDir, rec.glb))) {
    return { slug: entry.slug, skipped: true };
  }
  try {
    if (!rec.taskId) {
      rec.taskId = await submitWithRetry(entry, rec);
      console.log(`[${entry.slug}] taskId=${rec.taskId}`);
      await saveState();
    } else {
      console.log(`[${entry.slug}] 复用 taskId=${rec.taskId}`);
    }
    const detail = await pollTask(rec.taskId, entry.slug);
    const status = Number(detail?.status);
    if (status !== 3) throw new Error(`任务终态 ${STATUS_LABEL[status] ?? status}: ${redact(JSON.stringify(detail)).slice(0, 300)}`);
    const saved = await download(entry, detail);
    rec.outputs = saved.outputs; rec.glb = saved.glb; rec.zip = saved.zip; rec.bytes = saved.bytes;
    rec.status = 'succeeded'; rec.updatedAt = new Date().toISOString();
    await saveState();
    console.log(`[${entry.slug}] 成功 glb=${rec.glb} bytes=${rec.bytes}`);
    return { slug: entry.slug, ok: true, bytes: rec.bytes };
  } catch (e) {
    rec.status = 'failed'; rec.error = String(e.message ?? e).slice(0, 500);
    rec.updatedAt = new Date().toISOString();
    await saveState();
    console.error(`[${entry.slug}] 失败: ${rec.error}`);
    return { slug: entry.slug, ok: false, error: rec.error };
  }
}

async function pool(items, fn, label) {
  const results = [];
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) { const i = cursor++; results.push(await fn(items[i])); }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  console.log(`[batch] ${label}阶段完成 ${results.length} 条`);
  return results;
}

// ---------- 主流程 ----------
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
let entries = manifest.entries.slice();
if (onlySlug) entries = entries.filter(e => e.slug === onlySlug || e.slug.startsWith(onlySlug));
if (shardTotal > 0) entries = entries.filter((_, i) => (i % shardTotal) === shardIdx - 1);
entries = entries.slice(0, limit);

console.log(`[batch] 网关=${BASE} version=${version} faceCount=${faceCount} 并发=${concurrency} 条目=${entries.length}`);
const estCredits = entries.length * (manifest.creditPerTask ?? 20);
console.log(`[batch] 预估扣费 ${estCredits} credits（失败任务不扣分；以 task/list 净消耗为准）`);

if (dryRun) {
  for (const e of entries) console.log(`  - ${e.slug} [${e.bucket}] ${e.zh}${e.experimental ? ' (experimental)' : ''}\n      ${e.prompt}`);
  process.exit(0);
}

await mkdir(outDir, { recursive: true });
// 单池并发：每个 worker 走完「等槽位提交 → 轮询 → 下载」再拿下一条；
// 已成功的条目直接跳过，中断后重跑可按 state.json 续上。
const results = await pool(entries, runEntry, '生成');

const ok = results.filter(r => r.ok).length;
const skipped = results.filter(r => r.skipped).length;
const failed = results.filter(r => !r.ok && !r.skipped).length;
console.log(`\n[batch] 完成：成功 ${ok}，跳过 ${skipped}，失败 ${failed}，产物目录 ${outDir}`);
await saveState();
process.exit(failed > 0 ? 1 : 0);
