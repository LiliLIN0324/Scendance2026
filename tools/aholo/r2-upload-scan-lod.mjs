#!/usr/bin/env node
// 把派生好的本地 LOD 目录发到 R2，并给云端单独写一份「L0 指回云端 .spz」的 lod-meta。
//
// 为什么需要这一步
//   1. frontend/public/scans/ 被 .gitignore:25 整目录忽略——派生好的 LOD 只在开发机上，
//      构建站/部署站看不到，`/scans/<dir>/lod-meta.json` 在线上是 404。
//   2. 本地 lod-meta 的 files[0] 指向 http://127.0.0.1:3199/asset/<id>.spz（本机代理），
//      远端机器取不到；R2 的公网域名又只放行本站来源，开发机反过来直连也有 CORS 风险。
//      所以「本地那份不动、云端那份单独生成」——两边各自指向自己够得到的地址。
//
// 云端布局（与 cloud-assets.ts 的 cloudScanLodUrl / cloudScanUrl 严格对齐）：
//   scans/<assetId>/lod-meta.json      files[0] = <public-base>/scans/<assetId>.spz
//   scans/<assetId>/lod-1.spz
//   scans/<assetId>/lod-2.spz
//
// 用法：
//   node tools/aholo/r2-upload-scan-lod.mjs --dry-run      # 只列计划，不联网不改文件
//   node tools/aholo/r2-upload-scan-lod.mjs                # 自动读仓库根 .r2.env
//   node tools/aholo/r2-upload-scan-lod.mjs --verify-only  # 只回读线上字节数
//
// 凭据只从环境变量或 --env-file 读取，任何输出都不含密钥：
//   R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_BUCKET(默认 scendance-assets)
import { createHash, createHmac } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const has = name => args.includes(`--${name}`);

const scansDir = resolve(option('scans-dir', 'frontend/public/scans'));
const stagingDir = resolve(option('staging', '.cache/r2-lod'));
const dryRun = has('dry-run');
const verifyOnly = has('verify-only');
const envFile = option('env-file', '') || (existsSync('.r2.env') ? '.r2.env' : '');
const PUBLIC_BASE = option('public-base', 'https://pub-048147e4c4ad482d95df092dc8098e1d.r2.dev').replace(/\/+$/, '');

const uuidPattern = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/** 读 .env 风格的 KEY=VALUE；不覆盖已存在的真实环境变量。 */
function loadEnvFile(path) {
  if (!path || !existsSync(path)) return {};
  const out = {};
  for (const rawLine of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim().replace(/^export\s+/, '');
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

const fileEnv = loadEnvFile(envFile);
const env = key => process.env[key] ?? fileEnv[key] ?? '';
const accountId = env('R2_ACCOUNT_ID');
const accessKeyId = env('R2_ACCESS_KEY_ID');
const secretAccessKey = env('R2_SECRET_ACCESS_KEY');
const bucket = env('R2_BUCKET') || 'scendance-assets';
const endpoint = env('R2_ENDPOINT') || (accountId ? `https://${accountId}.r2.cloudflarestorage.com` : '');

/** 第 0 档反查资产号：代理绝对地址或裸文件名都认（与 scripts/build-local-scan-index.mjs 同口径）。 */
function assetIdFromSource(source) {
  const name = String(source ?? '').trim();
  const byPath = /\/asset\/([0-9a-f-]{36})\.(spz|ply)$/i.exec(name);
  if (byPath) return { assetId: byPath[1], ext: byPath[2].toLowerCase() };
  const bare = /^([0-9a-f-]{36})\.(spz|ply)$/i.exec(name);
  return bare ? { assetId: bare[1], ext: bare[2].toLowerCase() } : null;
}

/** 扫一遍本地 LOD 目录，产出「云端 meta」与待传对象清单。 */
function buildPlan() {
  if (!existsSync(scansDir)) throw new Error(`找不到扫描目录：${scansDir}`);
  const items = [];
  const skipped = [];
  /** 一个资产号只能有一套云端 LOD：重复的（尤其是夹具目录）会互相覆盖，先到先得。 */
  const claimed = new Set();
  for (const name of readdirSync(scansDir)) {
    const dir = join(scansDir, name);
    if (!statSync(dir).isDirectory()) continue;
    // 测试夹具目录（tearoom-lod-test 这类）不传：它可能拿着别的场切出来的件与假包围盒。
    if (/test/i.test(name)) {
      skipped.push(`${name}（测试夹具目录）`);
      continue;
    }
    const metaPath = join(dir, 'lod-meta.json');
    if (!existsSync(metaPath)) continue;
    let meta;
    try {
      meta = JSON.parse(readFileSync(metaPath, 'utf8'));
    } catch {
      skipped.push(`${name}（meta 不是合法 JSON）`);
      continue;
    }
    if (!Array.isArray(meta.files) || meta.files.length < 2) {
      skipped.push(`${name}（不足 2 档）`);
      continue;
    }
    const resolved = assetIdFromSource(meta.files[0]);
    if (!resolved) {
      skipped.push(`${name}（files[0] 里没有资产号）`);
      continue;
    }
    const { assetId, ext } = resolved;
    if (claimed.has(assetId)) {
      skipped.push(`${name}（与已排入的目录同资产 ${assetId}，不重复传）`);
      continue;
    }
    claimed.add(assetId);
    // 云端那份：第 0 档指回同桶的 scans/<assetId>.<ext>，其余仍按 meta 所在目录的相对名。
    const cloudMeta = {
      ...meta,
      source: `${assetId}.${ext}`,
      files: [`${PUBLIC_BASE}/scans/${assetId}.${ext}`, ...meta.files.slice(1)],
      localLodDir: undefined,
    };
    delete cloudMeta.localLodDir;
    const stagedMeta = join(stagingDir, assetId, 'lod-meta.json');
    // 云端 meta 先写进暂存目录：没凭据也能用 cat 核对「线上那份到底长什么样」。
    mkdirSync(join(stagingDir, assetId), { recursive: true });
    writeFileSync(stagedMeta, `${JSON.stringify(cloudMeta, null, 2)}\n`);
    items.push({
      key: `scans/${assetId}/lod-meta.json`,
      path: stagedMeta,
      bytes: Buffer.byteLength(JSON.stringify(cloudMeta, null, 2)) + 1,
      content: `${JSON.stringify(cloudMeta, null, 2)}\n`,
      type: 'application/json; charset=utf-8',
      label: `${name} → ${assetId} · meta`,
    });
    for (const file of meta.files.slice(1)) {
      const local = join(dir, String(file));
      if (!existsSync(local)) {
        skipped.push(`${name}（缺 ${file}）`);
        continue;
      }
      items.push({
        key: `scans/${assetId}/${file}`,
        path: local,
        bytes: statSync(local).size,
        type: 'application/octet-stream',
        label: `${name} → ${assetId} · ${file}`,
      });
    }
  }
  return { items, skipped };
}

const sha256Hex = data => createHash('sha256').update(data).digest('hex');
const hmac = (key, data) => createHmac('sha256', key).update(data).digest();

/** SigV4（region=auto, service=s3），与 tools/aholo/r2-upload.mjs 同一套口径。 */
function signPut({ key, body, contentType }) {
  const url = new URL(`${endpoint}/${bucket}/${key}`);
  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256Hex(body);
  const canonicalUri = url.pathname.split('/').map(segment => encodeURIComponent(decodeURIComponent(segment))).join('/');
  const canonicalHeaders = `content-type:${contentType}\nhost:${url.host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
  const signedHeaders = 'content-type;host;x-amz-content-sha256;x-amz-date';
  const canonicalRequest = ['PUT', canonicalUri, '', canonicalHeaders, signedHeaders, payloadHash].join('\n');
  const scope = `${dateStamp}/auto/s3/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256Hex(canonicalRequest)].join('\n');
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${secretAccessKey}`, dateStamp), 'auto'), 's3'), 'aws4_request');
  const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex');
  return {
    url: url.toString(),
    headers: {
      'content-type': contentType,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': amzDate,
      authorization: `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    },
  };
}

async function headPublic(key) {
  try {
    const response = await fetch(`${PUBLIC_BASE}/${key}`, { method: 'HEAD' });
    return { ok: response.ok, status: response.status, bytes: Number(response.headers.get('content-length')) };
  } catch (error) {
    return { ok: false, status: 0, bytes: -1, error: error?.cause?.code ?? error?.message ?? 'unknown' };
  }
}

const { items, skipped } = buildPlan();
if (skipped.length) for (const note of skipped) console.warn(`SKIP ${note}`);
if (!items.length) {
  console.error(`没有可上传的 LOD（${scansDir}）。先跑 tools/aholo/make-lod.mjs 派生。`);
  process.exit(1);
}
const totalMb = (items.reduce((sum, item) => sum + item.bytes, 0) / 1048576).toFixed(2);

if (verifyOnly) {
  let failed = 0;
  for (const item of items) {
    const head = await headPublic(item.key);
    const match = head.ok && head.bytes === item.bytes;
    if (!match) failed += 1;
    console.log(`${match ? 'OK  ' : 'FAIL'} ${item.key}  本地 ${item.bytes} B / 线上 ${head.ok ? `${head.bytes} B` : `HTTP ${head.status}`}`);
  }
  process.exitCode = failed ? 1 : 0;
} else if (dryRun) {
  for (const item of items) console.log(`DRY  PUT ${item.key}  ${(item.bytes / 1048576).toFixed(2)} MB  ← ${item.path}`);
  console.log(`\n共 ${items.length} 个对象，${totalMb} MB。`);
  if (!accountId || !accessKeyId || !secretAccessKey) {
    console.log('提示：未提供 R2 凭据，真实上传会直接失败（dry-run 不校验凭据）。');
  }
} else if (!accountId || !accessKeyId || !secretAccessKey) {
  console.error('缺少凭据：需要 R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY（环境变量或 --env-file .r2.env）。');
  console.error('拿到后：node tools/aholo/r2-upload-scan-lod.mjs --dry-run  再  node tools/aholo/r2-upload-scan-lod.mjs');
  process.exitCode = 2;
} else {
  let failed = 0;
  for (const item of items) {
    const body = item.content ? Buffer.from(item.content, 'utf8') : readFileSync(item.path);
    const signed = signPut({ key: item.key, body, contentType: item.type });
    let response;
    try {
      response = await fetch(signed.url, { method: 'PUT', headers: signed.headers, body });
    } catch (error) {
      failed += 1;
      console.error(`FAIL PUT ${item.key}  网络错误 ${error?.cause?.code ?? error?.message ?? error}`);
      continue;
    }
    if (!response.ok) {
      failed += 1;
      console.error(`FAIL PUT ${item.key}  HTTP ${response.status}  ${(await response.text()).slice(0, 200)}`);
      continue;
    }
    const head = await headPublic(item.key);
    const match = head.ok && head.bytes === body.length;
    if (!match) failed += 1;
    console.log(`${match ? 'OK  ' : 'WARN'} PUT ${item.key}  ${(body.length / 1048576).toFixed(2)} MB  回读 ${head.ok ? `${head.bytes} B` : `HTTP ${head.status}`}`);
  }
  if (failed) {
    console.error(`\n${failed}/${items.length} 个对象未通过；先别把云端登记指过来。`);
    process.exitCode = 1;
  } else {
    console.log(`\n${items.length} 个对象全部上传并回读一致（${totalMb} MB）。`);
  }
}
