// R2 上传（S3 兼容 API，零依赖，SigV4 手写签名）。
//
// 为什么不用网页控制台：浏览器自动化没有文件选择能力，且控制台账号未开通 R2；
// S3 API 是唯一可脚本化、可复核的通道。
//
// 凭据只从环境变量或 --env-file 读取，**任何输出都不含密钥**：
//   R2_ACCOUNT_ID        账号 ID（控制台右侧「Copy account ID」）
//   R2_ACCESS_KEY_ID     R2 API Token 的 Access Key ID
//   R2_SECRET_ACCESS_KEY 对应 Secret
//   R2_BUCKET            默认 scendance-assets
//
// 用法：
//   node tools/aholo/r2-upload.mjs --hero .cache/aholo/hero --far .cache/aholo/far --dry-run
//   node tools/aholo/r2-upload.mjs --hero .cache/aholo/hero --far .cache/aholo/far            # 自动读仓库根 .r2.env
//   node tools/aholo/r2-upload.mjs --hero DIR --id <assetId> --verify-only    # 只回读校验已上传对象
//
// 路径约定与 people-manifest.mjs 一致：
//   hero → people/<assetId>.glb        覆盖现有 URL（老客户端也能拿到高清压缩版）
//   far  → people/lod1/<assetId>.glb   新路径
import { createHash, createHmac } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const has = name => args.includes(`--${name}`);
const heroDir = option('hero', '.cache/aholo/hero');
const farDir = option('far', '.cache/aholo/far');
const onlyId = option('id', '');
const dryRun = has('dry-run');
const verifyOnly = has('verify-only');
// 没显式传 --env-file 时自动找仓库根的 .r2.env，免得命令行里出现凭据文件路径。
const envFile = option('env-file', '') || (existsSync('.r2.env') ? '.r2.env' : '');
const PUBLIC_BASE = option('public-base', 'https://pub-048147e4c4ad482d95df092dc8098e1d.r2.dev');

/** 读 .env 风格的 KEY=VALUE；不覆盖已存在的真实环境变量。 */
function loadEnvFile(path) {
  if (!path) return {};
  if (!existsSync(path)) {
    console.error(`找不到 env 文件：${path}`);
    process.exit(2);
  }
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

const sha256Hex = data => createHash('sha256').update(data).digest('hex');
const hmac = (key, data) => createHmac('sha256', key).update(data).digest();

/** SigV4（region=auto, service=s3）。URI 按 S3 规范编码：路径分隔符保留，其余 encodeURIComponent。 */
function signPut({ key, body, contentType }) {
  const url = new URL(`${endpoint}/${bucket}/${key}`);
  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, ''); // YYYYMMDDTHHMMSSZ
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
      'authorization': `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    },
  };
}

function collect(dir) {
  const map = new Map();
  if (!dir || !existsSync(dir)) return map;
  for (const name of readdirSync(dir)) {
    if (!name.toLowerCase().endsWith('.glb')) continue;
    map.set(name.slice(0, -4), join(dir, name));
  }
  return map;
}

async function headPublic(key) {
  try {
    const response = await fetch(`${PUBLIC_BASE}/${key}`, { method: 'HEAD' });
    return { ok: response.ok, status: response.status, bytes: Number(response.headers.get('content-length')) };
  } catch (error) {
    // 回读失败不能当成“大 0 字节”，更不能打断整批。
    return { ok: false, status: 0, bytes: -1, error: error?.cause?.code ?? error?.message ?? 'unknown' };
  }
}

/** 网络抖动（ECONNRESET / fetch failed）与 5xx 重试；403/404 这类确定性错误直接返回。 */
async function putWithRetry(signed, body, attempts = 4) {
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(signed.url, { method: 'PUT', headers: signed.headers, body });
      if (response.status < 500) return response;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    if (attempt < attempts) {
      const wait = 800 * 2 ** (attempt - 1);
      console.warn(`WARN PUT ${signed.url.split('/').slice(-1)[0]} 第 ${attempt} 次失败（${lastError?.cause?.code ?? lastError?.message ?? lastError}），${wait} ms 后重试`);
      await new Promise(resolve => setTimeout(resolve, wait));
    }
  }
  throw lastError ?? new Error('上传失败');
}

const plan = [];
const hero = collect(heroDir);
const far = collect(farDir);
for (const [assetId, path] of hero) {
  if (onlyId && assetId !== onlyId) continue;
  plan.push({ assetId, kind: 'hero', key: `people/${assetId}.glb`, path, bytes: statSync(path).size });
}
for (const [assetId, path] of far) {
  if (onlyId && assetId !== onlyId) continue;
  plan.push({ assetId, kind: 'far', key: `people/lod1/${assetId}.glb`, path, bytes: statSync(path).size });
}

if (!plan.length) {
  console.error(`没有待上传文件（hero=${resolve(heroDir)}，far=${resolve(farDir)}${onlyId ? `，id=${onlyId}` : ''}）。`);
  process.exit(1);
}

// 注意：这里全程用 `process.exitCode` 而不是 `process.exit()`——Node 26 上强制退出会与
// undici 的 keep-alive 句柄竞争，抛 `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)`。
if (verifyOnly) {
  let failed = 0;
  for (const item of plan) {
    const head = await headPublic(item.key);
    const match = head.ok && head.bytes === item.bytes;
    if (!match) failed += 1;
    console.log(`${match ? 'OK  ' : 'FAIL'} ${item.key}  本地 ${item.bytes} B / 线上 ${head.ok ? `${head.bytes} B` : `HTTP ${head.status}`}`);
  }
  process.exitCode = failed ? 1 : 0;
} else if (dryRun) {
  for (const item of plan) console.log(`DRY  PUT ${item.key}  ${(item.bytes / 1048576).toFixed(2)} MB  ← ${item.path}`);
  console.log(`\n共 ${plan.length} 个对象，${(plan.reduce((sum, item) => sum + item.bytes, 0) / 1048576).toFixed(2)} MB。`);
  if (!accountId) console.log('提示：未提供 R2_ACCOUNT_ID，真实上传会直接失败（dry-run 不校验凭据）。');
} else if (!accountId || !accessKeyId || !secretAccessKey) {
  console.error('缺少凭据：需要 R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY（环境变量或 --env-file）。');
  process.exitCode = 2;
} else {
  let failed = 0;
  for (const item of plan) {
    const body = readFileSync(item.path);
    const signed = signPut({ key: item.key, body, contentType: 'model/gltf-binary' });
    let response;
    try {
      response = await putWithRetry(signed, body);
    } catch (error) {
      failed += 1;
      console.error(`FAIL PUT ${item.key}  网络错误 ${error?.cause?.code ?? error?.message ?? error}`);
      continue;
    }
    if (!response.ok) {
      failed += 1;
      const detail = (await response.text()).slice(0, 300);
      console.error(`FAIL PUT ${item.key}  HTTP ${response.status}  ${detail}`);
      continue;
    }
    // 回读校验：公网 URL 的 Content-Length 必须与本地字节数一致，否则就是传了半个文件。
    const head = await headPublic(item.key);
    const match = head.ok && head.bytes === item.bytes;
    if (!match) failed += 1;
    console.log(`${match ? 'OK  ' : 'WARN'} PUT ${item.key}  ${(item.bytes / 1048576).toFixed(2)} MB  回读 ${head.ok ? `${head.bytes} B` : `HTTP ${head.status}`}`);
  }
  if (failed) {
    console.error(`\n${failed}/${plan.length} 个对象未通过，请勿下调前端阈值。`);
    process.exitCode = 1;
  } else {
    console.log(`\n${plan.length} 个对象全部上传并回读一致。`);
  }
}

