#!/usr/bin/env node
/**
 * 把 extract-aoi 产出的 jsonl 批量写入 public.place_shapes。
 *
 * 与手写单条用的 upsert-place-shape.mjs 分工不同：
 *   那个是「一个人画完一条边界，写一条」，走 on_conflict=name_norm。
 *   这个是「几万到几十万条存量」，分批 POST，不依赖 name_norm 唯一索引——
 *   库里的同名多行（in77 ×7、跨城同名的人民公园）本身就允许共存，
 *   走 upsert 反而会把它们互相覆盖。
 *
 * 默认只预演，不写库。真正写入要 --apply，并且需要 SUPABASE_URL +
 * SUPABASE_SERVICE_ROLE_KEY（环境变量或根 .env.local）。
 *
 * 列只发库里确实有的：id / name / name_norm / kind / polygon / bounds /
 * center_lng / center_lat / pts。包里的这些字段与线上表一致。
 *
 * 用法：
 *   node tools/place-shapes/import-place-shapes.mjs .temp/aoi-china-260210.place_shapes.jsonl
 *   node tools/place-shapes/import-place-shapes.mjs <file> --smoke 200        # 先试 200 条，通过就自动续写剩余
 *   node tools/place-shapes/import-place-shapes.mjs <file> --apply --batch 500
 *
 * --smoke 是一步式：试写 N 条 → 回读核对 → 自动写完剩下的。中途断了会记断点，
 * 重跑同一条命令就从断点接力，不会把已写过的再写一遍。
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '../..');
const TABLE_COLUMNS = ['id', 'name', 'name_norm', 'kind', 'polygon', 'bounds', 'center_lng', 'center_lat', 'pts'];

function parseArgs(argv) {
  const out = {
    file: null, apply: false, batch: 400, limit: 0, offset: 0, filter: null,
    smoke: 0, resume: false, fresh: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--apply') out.apply = true;
    else if (arg === '--dry-run') out.apply = false;
    else if (arg === '--batch') out.batch = Math.max(1, Number(argv[++i]));
    else if (arg === '--limit') out.limit = Math.max(0, Number(argv[++i]));
    else if (arg === '--offset') out.offset = Math.max(0, Number(argv[++i]));
    else if (arg === '--filter') out.filter = new RegExp(argv[++i]);
    else if (arg === '--smoke') {
      // --smoke 可以只写一次（默认 200 条），也可以 --smoke 50
      const next = Number(argv[i + 1]);
      if (Number.isFinite(next) && next > 0) { out.smoke = next; i++; } else out.smoke = 200;
      out.apply = true; // --smoke 就是写库模式，不用再加 --apply
    } else if (arg === '--resume') out.resume = true;
    else if (arg === '--fresh') out.fresh = true;
    else if (!arg.startsWith('--')) out.file = arg;
  }
  return out;
}

function readEnvLocal() {
  const env = {};
  for (const name of ['.env.local', '.env']) {
    try {
      for (const line of readFileSync(resolve(ROOT, name), 'utf8').split(/\r?\n/)) {
        const hit = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$/);
        if (!hit) continue;
        env[hit[1]] ??= hit[2].trim().replace(/^["']|["']$/g, '');
      }
    } catch { /* 没有就继续用真实环境变量 */ }
  }
  return env;
}

function credentials() {
  const file = readEnvLocal();
  const pick = (key) => process.env[key] || file[key] || '';
  const url = pick('SUPABASE_URL') || pick('NEXT_PUBLIC_SUPABASE_URL');
  const key = pick('SUPABASE_SERVICE_ROLE_KEY');
  return { url: url ? url.replace(/\/$/, '') : '', key };
}

function project(row) {
  const out = {};
  for (const column of TABLE_COLUMNS) out[column] = row[column];
  return out;
}

async function rest(url, key, path, init = {}) {
  const response = await fetch(`${url}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
  return response;
}

async function countRows(url, key) {
  const response = await rest(url, key, 'place_shapes?select=id', {
    method: 'HEAD',
    headers: { Prefer: 'count=exact', Range: '0-0' },
  });
  const range = response.headers.get('content-range');
  const total = Number(String(range ?? '').split('/')[1]);
  return Number.isFinite(total) ? total : null;
}

const args = parseArgs(process.argv.slice(2));
if (!args.file) {
  console.error('用法：node tools/place-shapes/import-place-shapes.mjs <package.place_shapes.jsonl> [--apply] [--batch 400] [--limit N]');
  process.exit(2);
}

const lines = readFileSync(args.file, 'utf8').split('\n').filter(Boolean);
let rows = lines.map((line) => JSON.parse(line));
if (args.filter) rows = rows.filter((row) => args.filter.test(row.name));
rows = rows.slice(args.offset, args.limit > 0 ? args.offset + args.limit : undefined);

console.log(`包 ${args.file}`);
console.log(`行 ${rows.length}${args.filter ? `（已按 ${args.filter} 过滤）` : ''}｜列 ${TABLE_COLUMNS.join(',')}｜批 ${args.batch}`);
const batches = Math.ceil(rows.length / args.batch);
console.log(`将发 ${batches} 个请求`);

if (!args.apply) {
  const sample = project(rows[0]);
  console.log('\n预演，不写库。第一条：');
  console.log(JSON.stringify({ ...sample, polygon: `${sample.polygon.length} 点`, bounds: sample.bounds }));
  console.log('\n确认后加 --smoke 200 先试写 200 条并自动续写，或 --apply 整包写入（需要 SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY）。');
  process.exit(0);
}

const { url, key } = credentials();
if (!url || !key) {
  console.log('\n缺少凭据：设置 SUPABASE_URL 与 SUPABASE_SERVICE_ROLE_KEY（环境变量或根 .env.local）后重试。');
  process.exit(1);
}

const before = await countRows(url, key);
console.log(`\n写入前 place_shapes 行数：${before ?? '未知'}`);

/* ---------------- 断点与 --smoke ---------------- */
const PROGRESS_DIR = resolve(ROOT, '.temp');
const PROGRESS_FILE = resolve(PROGRESS_DIR, 'place-shapes-import.progress.json');
const progressKey = `${args.file}|${args.offset}|${rows.length}|${args.filter ?? ''}`;

function readProgress() {
  try { return JSON.parse(readFileSync(PROGRESS_FILE, 'utf8')); } catch { return null; }
}
function saveProgress(done) {
  try {
    mkdirSync(PROGRESS_DIR, { recursive: true });
    writeFileSync(PROGRESS_FILE, JSON.stringify({ key: progressKey, done, total: rows.length, updatedAt: new Date().toISOString() }, null, 2));
  } catch { /* 断点文件写不了不影响主流程 */ }
}
function clearProgress() {
  try { rmSync(PROGRESS_FILE); } catch { /* 没写过就算了 */ }
}

let start = 0;
const saved = readProgress();
if (!args.fresh && saved && saved.key === progressKey && Number(saved.done) > 0 && Number(saved.done) <= rows.length) {
  start = Number(saved.done);
  console.log(`接力上次断点：前 ${start} 条已写过，从第 ${start + 1} 条继续（--fresh 可从头写）`);
}

let written = 0;
let failed = 0;
let aborted = false;

async function writeRange(from, to) {
  for (let cursor = from; cursor < to && !aborted; cursor += args.batch) {
    const end = Math.min(cursor + args.batch, to);
    const slice = rows.slice(cursor, end).map(project);
    let attempt = 0;
    for (;;) {
      attempt++;
      const response = await rest(url, key, 'place_shapes', {
        method: 'POST',
        // 不合并：库里的同名多行本来就要各存一份。
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify(slice),
      });
      if (response.ok) {
        written += slice.length;
        start = end;
        saveProgress(start);
        break;
      }
      const text = (await response.text()).slice(0, 2000);
      const retryable = response.status === 429 || response.status >= 500;
      if (retryable && attempt < 4) {
        await new Promise((r) => setTimeout(r, 500 * attempt));
        continue;
      }
      failed += slice.length;
      aborted = true;
      console.error(`\n停在第 ${cursor + 1}–${end} 条：${response.status} ${text}`);
      if (/column .* does not exist|Could not find the .* column/i.test(text)) {
        console.error('列不匹配：线上 place_shapes 的实际列与本脚本的 TABLE_COLUMNS 不一致，先核对再继续。');
      }
      break;
    }
    if (!aborted && (to - from <= args.batch * 4 || (cursor - from) % (args.batch * 20) === 0)) {
      console.log(`进度 ${start}/${rows.length}｜本次成功 ${written}｜失败 ${failed}`);
    }
  }
  return !aborted;
}

if (args.smoke > 0) {
  const smokeEnd = Math.min(rows.length, start + args.smoke);
  console.log(`\n第一步：试写 ${smokeEnd - start} 条（--smoke ${args.smoke}）`);
  if (!(await writeRange(start, smokeEnd))) {
    console.error(`\n试写失败，已停。本次成功 ${written}，断点记在 ${start}/${rows.length}，修好后重跑原命令即可接力。`);
    process.exitCode = 1;
  } else {
    const mid = await countRows(url, key);
    const landed = before != null && mid != null ? mid - before : null;
    if (landed != null && landed !== written) {
      aborted = true;
      console.error(`\n试写回读对不上：实际新增 ${landed} 条，请求成功 ${written} 条。已停，先人工确认再继续。`);
      process.exitCode = 1;
    } else {
      console.log(`试写通过${landed != null ? `（回读新增 ${landed} 条）` : '（回读计数不可用，跳过核对）'}，继续写剩余 ${rows.length - smokeEnd} 条`);
      if (!(await writeRange(smokeEnd, rows.length))) {
        console.error(`\n中途失败，已停。本次成功 ${written}，断点记在 ${start}/${rows.length}。`);
        process.exitCode = 1;
      }
    }
  }
} else if (!(await writeRange(start, rows.length))) {
  console.error(`\n失败已停。本次成功 ${written}，断点记在 ${start}/${rows.length}。`);
  process.exitCode = 1;
}

const after = await countRows(url, key);
console.log(`\n写入后行数：${after ?? '未知'}${before != null && after != null ? `（+${after - before}）` : ''}`);
console.log(`本次成功 ${written}｜失败 ${failed}｜包内共 ${rows.length} 行`);
if (!aborted && start >= rows.length) {
  clearProgress();
  console.log('这个包已写完，断点文件已清除。');
} else {
  console.log(`未写完：断点在 ${start}/${rows.length}，保存于 ${PROGRESS_FILE}`);
  process.exitCode = 1;
}