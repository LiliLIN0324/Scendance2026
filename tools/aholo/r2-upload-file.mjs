// R2 单文件上传（S3 兼容 API，零依赖，SigV4 手写签名）——r2-upload.mjs 的通用版。
//
// 为什么单独一个文件：r2-upload.mjs 只认 people/*.glb 的两条固定路径，
// 报告书（HTML/PDF）这种一次性静态件复用它的签名逻辑更省事，也不必动已验收的脚本。
//
// 凭据只从环境变量或 --env-file 读取，**任何输出都不含密钥**：
//   R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY / R2_BUCKET(默认 scendance-assets)
//
// 用法：
//   node tools/aholo/r2-upload-file.mjs --file a.html --key reports/x/index.html --type "text/html; charset=utf-8" --dry-run
//   node tools/aholo/r2-upload-file.mjs --file a.html --key reports/x/index.html --type "text/html; charset=utf-8"
//   可重复传 --file/--key/--type 三件套，按顺序配对。
import { createHash, createHmac } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';

const args = process.argv.slice(2);
const all = name => args.reduce((acc, value, index) => (value === `--${name}` && args[index + 1] ? [...acc, args[index + 1]] : acc), []);
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const has = name => args.includes(`--${name}`);

const files = all('file');
const keys = all('key');
const types = all('type');
const dryRun = has('dry-run');
const envFile = option('env-file', '') || (existsSync('.r2.env') ? '.r2.env' : '');
const PUBLIC_BASE = option('public-base', 'https://pub-048147e4c4ad482d95df092dc8098e1d.r2.dev');

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
      'authorization': `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
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

if (!files.length) {
  console.error('用法：--file <本地路径> --key <远端 key> [--type <mime>] [--dry-run]');
  process.exit(2);
}

const plan = files.map((file, index) => {
  if (!existsSync(file)) {
    console.error(`找不到文件：${file}`);
    process.exit(2);
  }
  return {
    path: file,
    key: keys[index] ?? file.replace(/\\/g, '/'),
    type: types[index] ?? 'application/octet-stream',
    bytes: statSync(file).size,
    publicUrl: `${PUBLIC_BASE}/${keys[index] ?? file}`,
  };
});

if (dryRun) {
  for (const item of plan) console.log(`DRY  PUT ${item.key}  ${(item.bytes / 1048576).toFixed(2)} MB  ${item.type}\n      → ${item.publicUrl}`);
  if (!accountId) console.log('提示：未提供 R2_ACCOUNT_ID，真实上传会直接失败（dry-run 不校验凭据）。');
  process.exitCode = 0;
} else if (!accountId || !accessKeyId || !secretAccessKey) {
  console.error('缺少凭据：需要 R2_ACCOUNT_ID / R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY（环境变量或 --env-file）。');
  process.exitCode = 2;
} else {
  let failed = 0;
  for (const item of plan) {
    const body = readFileSync(item.path);
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
      const detail = (await response.text()).slice(0, 300);
      console.error(`FAIL PUT ${item.key}  HTTP ${response.status}  ${detail}`);
      continue;
    }
    // 回读校验：公网 URL 的 Content-Length 必须与本地字节数一致，否则就是传了半个文件。
    const head = await headPublic(item.key);
    const match = head.ok && head.bytes === item.bytes;
    if (!match) failed += 1;
    console.log(`${match ? 'OK  ' : 'WARN'} PUT ${item.key}  ${(item.bytes / 1048576).toFixed(2)} MB  回读 ${head.ok ? `${head.bytes} B` : `HTTP ${head.status}`}`);
    if (match) console.log(`      ${item.publicUrl}`);
  }
  if (failed) {
    console.error(`\n${failed}/${plan.length} 个对象未通过。`);
    process.exitCode = 1;
  } else {
    console.log(`\n${plan.length} 个对象全部上传并回读一致。`);
  }
}
