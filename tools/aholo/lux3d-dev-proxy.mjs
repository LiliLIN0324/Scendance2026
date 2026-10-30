#!/usr/bin/env node
// Aholo 本机直连代理：密钥仅留在后端，无依赖，仅供 dev 联调。
// GET /health；POST /text-to-3d、/image-to-3d、/world；GET /task、/world；
// POST /asset 把会过期的签名产物落到本机，GET /asset/<id>.<ext> 稳定回源。
// 直接运行才读取环境变量 / 仓库根 .env.local，并监听 127.0.0.1:3199。
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer as createHttpServer } from 'node:http';
import { isIP } from 'node:net';
import { createHash, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const LUX_BASE = 'https://api.aholo.ai/global';
const WORLD_BASE = 'https://api.aholo3d.cn';
const MAX_BODY_BYTES = 7 * 1024 * 1024;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
// 物件 GLB 保持 10 MiB；3DGS 场景（SPZ/PLY）本来就是几十 MB 级，按整包上限收，落盘后才分类型复核。
const MAX_GLB_BYTES = 10 * 1024 * 1024;
const MAX_SPLAT_BYTES = 150 * 1024 * 1024;
// 场景包走公网 COS 可能几十 MB，60 秒会把还在下载的任务掐断。
const ASSET_TIMEOUT_MS = 300_000;
// 落盘只收加载器真正认得的三种：GLB 给物件、SPZ/PLY 给 3DGS 预览。类型按魔数判，不信 URL 后缀。
const ASSET_KINDS = {
  glb: { contentType: 'model/gltf-binary', matches: b => b.length > 8 && b.subarray(0, 4).toString('latin1') === 'glTF' && b.readUInt32LE(4) === 2 },
  spz: { contentType: 'application/octet-stream', matches: b => b[0] === 0x1f && b[1] === 0x8b && b[2] === 0x08 },
  ply: { contentType: 'application/octet-stream', matches: b => b.subarray(0, 3).toString('latin1') === 'ply' },
};
const ASSET_ID_PATH = /^\/asset\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.(glb|spz|ply)$/;
const STATUS = { 0: '排队中', 1: '运行中', 3: '成功', 4: '失败', 6: '已取消' };
const WORLD_STATUS = new Map([
  ['QUEUED', 0], ['PENDING', 0], ['INITIALIZING', 0],
  ['RUNNING', 1], ['PROCESSING', 1], ['IN_PROGRESS', 1],
  ['SUCCEEDED', 3], ['SUCCESS', 3], ['COMPLETED', 3],
  ['FAILED', 4], ['FAILURE', 4], ['ERROR', 4],
  ['CANCELLED', 6], ['CANCELED', 6],
]);

class HttpError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function localAuthority(value) {
  if (typeof value !== 'string') return false;
  const match = /^(?:localhost|127\.0\.0\.1)(?::([0-9]{1,5}))?$/i.exec(value);
  return Boolean(match && (!match[1] || (Number(match[1]) > 0 && Number(match[1]) <= 65535)));
}

function trustedOrigin(value) {
  if (typeof value !== 'string') return false;
  const match = /^https?:\/\/([^/]+)$/i.exec(value);
  return Boolean(match && localAuthority(match[1]));
}

function normalizeBase(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new Error('Aholo 网关必须是无凭据、查询参数和片段的 HTTPS URL');
  }
  return url.href.replace(/\/+$/, '');
}

function send(res, code, body, origin, key) {
  // 不透传上游错误；同时防止上游把密钥放进状态标签等成功字段。
  const json = JSON.stringify(body, (_name, value) => {
    if (!key || typeof value !== 'string') return value;
    return value.replaceAll(key, '[REDACTED]').replaceAll(encodeURIComponent(key), '[REDACTED]');
  });
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    Vary: 'Origin',
    ...(origin ? { 'Access-Control-Allow-Origin': origin } : {}),
    ...(code >= 400 ? { Connection: 'close' } : {}),
  });
  res.end(json);
}

function assetHeaders(ext, length, origin) {
  return {
    'Content-Type': ASSET_KINDS[ext].contentType,
    'Content-Length': String(length),
    'Cache-Control': 'public, max-age=31536000, immutable',
    'X-Content-Type-Options': 'nosniff',
    Vary: 'Origin',
    ...(origin ? { 'Access-Control-Allow-Origin': origin } : {}),
  };
}

function sendAsset(res, ext, bytes, origin) {
  res.writeHead(200, assetHeaders(ext, bytes.length, origin));
  res.end(bytes);
}

async function readJson(req) {
  if (!/^application\/json(?:\s*;\s*charset\s*=\s*(?:utf-8|"utf-8"))?\s*$/i.test(req.headers['content-type'] ?? '') ||
      (req.headers['content-encoding'] && req.headers['content-encoding'] !== 'identity')) {
    throw new HttpError(415, 'POST 仅支持 UTF-8 application/json，不支持压缩请求体');
  }
  if (Number(req.headers['content-length']) > MAX_BODY_BYTES) {
    throw new HttpError(413, '请求体不能超过 7 MiB');
  }
  const chunks = [];
  let size = 0;
  // 超限退出时保留 socket，以便先发送 413，再关闭连接。
  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new HttpError(413, '请求体不能超过 7 MiB');
    chunks.push(chunk);
  }
  let body;
  try {
    body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, size)));
  } catch {
    throw new HttpError(400, '请求体必须是合法 JSON 对象');
  }
  if (!isRecord(body)) throw new HttpError(400, '请求体必须是合法 JSON 对象');
  return body;
}

/** 二进制请求体（场地重建素材上传），超限即断。 */
async function readRaw(req, max) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req.iterator({ destroyOnReturn: false })) {
    size += chunk.length;
    if (size > max) throw new HttpError(413, `素材超过 ${Math.round(max / 1024 / 1024)} MiB，未上传`);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, size);
}

function text(value, field, maxLength) {
  if (typeof value !== 'string' || value.length > maxLength || !value.trim() ||
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) {
    throw new HttpError(400, `${field} 必须是 1..${maxLength} 字符的非空文本`);
  }
  return value.trim();
}

function validId(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
}

function queryId(url, field) {
  const values = url.searchParams.getAll(field);
  if (values.length !== 1 || !validId(values[0])) throw new HttpError(400, `${field} 无效`);
  return values[0];
}

function image(value) {
  if (typeof value !== 'string' || !value.startsWith('data:')) {
    throw new HttpError(400, 'img 必须是 PNG/JPEG base64 dataURL，不能是远程 URL');
  }
  const header = /^data:([^;,]+);base64,/i.exec(value);
  if (!header) throw new HttpError(400, 'img dataURL 格式无效');
  const mime = header[1].toLowerCase();
  if (mime !== 'image/png' && mime !== 'image/jpeg') throw new HttpError(415, 'img 仅支持 PNG/JPEG');
  const encoded = value.slice(header[0].length);
  if (encoded.length > 4 * Math.ceil(MAX_IMAGE_BYTES / 3)) throw new HttpError(413, '图片不能超过 5 MiB');
  if (!encoded || encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
    throw new HttpError(400, 'img base64 无效');
  }
  const bytes = Buffer.from(encoded, 'base64');
  if (bytes.length > MAX_IMAGE_BYTES) throw new HttpError(413, '图片不能超过 5 MiB');
  if (bytes.toString('base64') !== encoded) throw new HttpError(400, 'img base64 无效');
  const signature = mime === 'image/png' ? '89504e470d0a1a0a' : 'ffd8ff';
  if (bytes.subarray(0, signature.length / 2).toString('hex') !== signature) {
    throw new HttpError(415, 'img 文件特征与 PNG/JPEG MIME 不匹配');
  }
  return value;
}

function normalizeStatus(value, world = false) {
  const numeric = typeof value === 'number' || typeof value === 'string' ? String(value) : '';
  const status = Object.hasOwn(STATUS, numeric) ? Number(numeric) :
    (world && typeof value === 'string' ? WORLD_STATUS.get(value.toUpperCase()) ?? -1 : -1);
  return { status, statusLabel: STATUS[status] ?? (numeric || '未知') };
}

function safeHttps(value) {
  if (typeof value !== 'string' || !value.startsWith('https://') || /[\s\\]/.test(value)) return false;
  try {
    const url = new URL(value);
    // 产物应为公共 CDN 域名，不向浏览器返回凭据 URL、本机域名或 IP 字面量。
    return url.protocol === 'https:' && !url.username && !url.password &&
      !isIP(url.hostname) && !url.hostname.includes(':') &&
      url.hostname.includes('.') && !url.hostname.endsWith('.') &&
      !/(?:^|\.)(?:localhost|local|internal)$/.test(url.hostname);
  } catch {
    return false;
  }
}

// 落盘目录只按 UUID 拼路径，ID 已先过 ASSET_ID_PATH 的正则，不存在目录穿越。
function fileAssetStore(dir) {
  return {
    async save(id, ext, bytes) {
      await mkdir(dir, { recursive: true });
      await writeFile(`${dir}/${id}.${ext}`, bytes);
    },
    async read(id, ext) {
      try {
        return await readFile(`${dir}/${id}.${ext}`);
      } catch {
        return null;
      }
    },
  };
}

// 注入 key / fetch 供测试使用；导入本模块不读取环境、不读 .env、不创建监听。
export function createServer({
  key = '', base = LUX_BASE, worldBase = WORLD_BASE, fetchImpl = globalThis.fetch,
  assets = fileAssetStore(fileURLToPath(new URL('../../.cache/aholo/', import.meta.url))),
} = {}) {
  base = normalizeBase(base);
  worldBase = normalizeBase(worldBase);

  async function aholo(url, { world = false, ...init } = {}) {
    if (!key) throw new HttpError(500, '本机缺少 LUX3D_API_KEY（环境变量或仓库根 .env.local）');
    try {
      const response = await fetchImpl(url, {
        ...init,
        method: init.method ?? 'GET',
        headers: { Authorization: key, 'Content-Type': 'application/json' },
        redirect: 'error',
        signal: AbortSignal.timeout(30000),
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error('upstream HTTP error');
      }
      const body = await response.json();
      if (!isRecord(body)) throw new Error('invalid upstream body');
      if (!world) {
        if (body.c !== '0') throw new Error('Lux rejected request');
        return body.d;
      }
      if (Object.hasOwn(body, 'c') && body.c !== '0' && body.c !== 0) throw new Error('World rejected request');
      return body.d ?? body.data ?? body;
    } catch (failure) {
      const timeout = failure?.name === 'TimeoutError' || failure?.name === 'AbortError';
      throw new HttpError(timeout ? 504 : 502, timeout ? 'Aholo 上游请求超时' : 'Aholo 上游请求失败');
    }
  }

  // 签名产物只有约两小时有效期，取回字节按魔数定类型落盘，之后只走本机地址。
  async function stashAsset(remoteUrl) {
    if (!safeHttps(remoteUrl)) throw new HttpError(400, 'url 必须是公网 HTTPS 产物链接');
    let response;
    try {
      response = await fetchImpl(remoteUrl, { method: 'GET', redirect: 'error', signal: AbortSignal.timeout(ASSET_TIMEOUT_MS) });
    } catch (failure) {
      const timeout = failure?.name === 'TimeoutError' || failure?.name === 'AbortError';
      throw new HttpError(timeout ? 504 : 502, timeout ? '产物下载超时' : '产物下载失败');
    }
    if (!response.ok) {
      await response.body?.cancel?.();
      throw new HttpError(502, `产物下载失败：上游 HTTP ${response.status}`);
    }
    const declared = Number(response.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > MAX_SPLAT_BYTES) {
      await response.body?.cancel?.();
      throw new HttpError(413, `产物超过 ${Math.round(MAX_SPLAT_BYTES / 1024 / 1024)} MiB，未落盘`);
    }
    const chunks = [];
    let size = 0;
    if (response.body) {
      const reader = response.body.getReader();
      for (;;) {
        const next = await reader.read();
        if (next.done) break;
        size += next.value.byteLength;
        // 声明与实际不符时按实际断开，不让上游把本机内存撑爆。
        if (size > MAX_SPLAT_BYTES) {
          await reader.cancel();
          throw new HttpError(413, `产物超过 ${Math.round(MAX_SPLAT_BYTES / 1024 / 1024)} MiB，未落盘`);
        }
        chunks.push(Buffer.from(next.value));
      }
    }
    const bytes = Buffer.concat(chunks, size);
    const kind = Object.keys(ASSET_KINDS).find(name => ASSET_KINDS[name].matches(bytes));
    if (!kind) throw new HttpError(415, '产物不是 GLB / SPZ / PLY，未落盘');
    // 物件模型仍守着原来的 10 MiB 门槛：客户端加载器按它设计，场景包才允许更大。
    if (kind === 'glb' && bytes.length > MAX_GLB_BYTES) throw new HttpError(413, 'GLB 超过 10 MiB，未落盘');
    const assetId = randomUUID();
    await assets.save(assetId, kind, bytes);
    return { assetId, kind, bytes: bytes.length, url: `/asset/${assetId}.${kind}` };
  }

  // lod-meta 是 World 产物里唯一带真实尺度（米制 forwardBox）的文件；只放行 Aholo 自家域名，浏览器侧 CORS 过不来。
  async function fetchMeta(remoteUrl) {
    let parsed = null;
    try { parsed = new URL(remoteUrl ?? ''); } catch { parsed = null; }
    const hostOk = Boolean(parsed) && (/(?:^|\.)aholo3d\.cn$/.test(parsed.hostname) || /(?:^|\.)aholo\.ai$/.test(parsed.hostname));
    if (!parsed || !safeHttps(remoteUrl) || !hostOk) throw new HttpError(400, 'meta 只接受 Aholo 域名的 lod-meta 链接');
    let response;
    try {
      response = await fetchImpl(parsed.href, { method: 'GET', redirect: 'error', signal: AbortSignal.timeout(30000) });
    } catch (failure) {
      const timeout = failure?.name === 'TimeoutError' || failure?.name === 'AbortError';
      throw new HttpError(timeout ? 504 : 502, timeout ? 'lod-meta 拉取超时' : 'lod-meta 拉取失败');
    }
    if (!response.ok) {
      await response.body?.cancel?.();
      throw new HttpError(502, `lod-meta 拉取失败：上游 HTTP ${response.status}`);
    }
    const text = await response.text();
    if (text.length > 2 * 1024 * 1024) throw new HttpError(413, 'lod-meta 超过 2 MiB');
    try { return JSON.parse(text); } catch { throw new HttpError(502, 'lod-meta 不是合法 JSON'); }
  }

  // —— World 重建：素材先经 OUS 上传成公网 URL，再创建重建任务（docs/AHOLO-INTEGRATION-PLAN.md 二梯队）——
  let ousCredentials;
  async function ous() {
    if (ousCredentials) return ousCredentials;
    // token 接口返回裸 JSON（无 c/d 壳），不走 aholo() 包装器。
    const tokenResponse = await fetchImpl(`${base}/asset/v1/token`, { headers: { Authorization: key }, signal: AbortSignal.timeout(30000) });
    if (!tokenResponse.ok) { await tokenResponse.body?.cancel?.(); throw new HttpError(502, `OUS 凭证获取失败：上游 HTTP ${tokenResponse.status}`); }
    const d = await tokenResponse.json();
    if (!isRecord(d) || typeof d.ousToken !== 'string' || typeof d.globalDomain !== 'string') throw new HttpError(502, 'OUS 凭证无效');
    ousCredentials = { token: d.ousToken, domain: d.globalDomain.replace(/\/+$/, ''), blockSize: Number(d.blockSize) || 5 * 1024 * 1024 };
    return ousCredentials;
  }
  function pickUrl(value) {
    if (typeof value === 'string') return value.startsWith('https://') ? value : undefined;
    if (Array.isArray(value)) { for (const item of value) { const found = pickUrl(item); if (found) return found; } return undefined; }
    if (isRecord(value)) { for (const item of Object.values(value)) { const found = pickUrl(item); if (found) return found; } }
    return undefined;
  }
  async function postOus(url, token, form) {
    try {
      const response = await fetchImpl(url, {
        method: 'POST', headers: { 'ous-token-v2': token }, body: form,
        signal: AbortSignal.timeout(600000),
      });
      if (!response.ok) { await response.body?.cancel?.(); throw new HttpError(502, `OUS 上传失败：上游 HTTP ${response.status}`); }
      const body = await response.json();
      if (!isRecord(body)) throw new HttpError(502, 'OUS 响应无效');
      if (Object.hasOwn(body, 'c') && body.c !== '0' && body.c !== 0) throw new HttpError(502, `OUS 拒绝：${body.m ?? body.c}`);
      return body.d ?? body.data ?? body;
    } catch (failure) {
      if (failure instanceof HttpError) throw failure;
      throw new HttpError(502, 'OUS 上传请求失败');
    }
  }
  async function ousUpload(bytes, name) {
    const { token, domain, blockSize } = await ous();
    const md5 = createHash('md5').update(bytes).digest('hex');
    let payload;
    if (bytes.length <= Math.max(blockSize - 256 * 1024, 1024)) {
      const form = new FormData();
      form.append('md5', md5);
      form.append('file', new Blob([bytes]), name);
      payload = await postOus(`${domain}/ous/api/v2/single/upload`, token, form);
    } else {
      const blocks = Math.ceil(bytes.length / blockSize);
      await postOus(`${domain}/ous/api/v2/block/upload/init?md5=${md5}&blocks=${blocks}&size=${bytes.length}&name=${encodeURIComponent(name)}`, token);
      for (let index = 1; index <= blocks; index++) {
        const form = new FormData();
        form.append('block', String(index));
        form.append('file', new Blob([bytes.subarray((index - 1) * blockSize, index * blockSize)]), name);
        payload = await postOus(`${domain}/ous/api/v2/block/upload/part`, token, form);
      }
      const status = await fetchImpl(`${domain}/ous/api/v2/upload/status?md5=${md5}`, { headers: { 'ous-token-v2': token }, signal: AbortSignal.timeout(30000) });
      if (!status.ok) { await status.body?.cancel?.(); throw new HttpError(502, `OUS 状态查询失败：上游 HTTP ${status.status}`); }
      payload = await status.json();
    }
    // 上传只回 obsTaskId；公网地址要拿【同一个】ousToken 轮询状态接口换出来（换 token 会报 Token未绑定任务）。
    for (let attempt = 0; attempt < 30; attempt++) {
      const statusResponse = await fetchImpl(`${domain}/ous/api/v2/upload/status?md5=${md5}`, { headers: { 'ous-token-v2': token }, signal: AbortSignal.timeout(30000) });
      if (statusResponse.ok) {
        const statusBody = await statusResponse.json();
        const url = pickUrl(statusBody);
        if (url) return url;
      }
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    throw new HttpError(502, 'OUS 上传后未在时限内拿到文件地址');
  }

  return createHttpServer({ requestTimeout: 360000, headersTimeout: 10000 }, async (req, res) => {
    let origin = '';
    try {
      const headerNames = req.rawHeaders.filter((_value, index) => index % 2 === 0).map(name => name.toLowerCase());
      if (!localAuthority(req.headers.host) || headerNames.filter(name => name === 'host').length !== 1 ||
          headerNames.filter(name => name === 'origin').length > 1 ||
          (req.headers.origin !== undefined && !trustedOrigin(req.headers.origin))) {
        throw new HttpError(403, '仅允许 localhost / 127.0.0.1 本机来源与 Host');
      }
      origin = req.headers.origin ?? '';
      if (req.method === 'OPTIONS') {
        res.writeHead(204, {
          ...(origin ? { 'Access-Control-Allow-Origin': origin } : {}),
          Vary: 'Origin',
          'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
        });
        res.end();
        return;
      }
      if (!req.url?.startsWith('/') || req.url.startsWith('//')) throw new HttpError(400, '请求路径无效');
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname.startsWith('/asset/')) {
        if (req.method !== 'GET') throw new HttpError(405, '资产只支持 GET');
        const asset = ASSET_ID_PATH.exec(url.pathname);
        if (!asset) throw new HttpError(400, '资产地址无效');
        const bytes = await assets.read(asset[1], asset[2]);
        if (!bytes) throw new HttpError(404, '本机没有该资产，需重新落盘');
        sendAsset(res, asset[2], bytes, origin);
        return;
      }
      let result;
      if (req.method === 'GET' && url.pathname === '/health') {
        result = { ok: true, keyConfigured: Boolean(key), base, worldBase };
      } else if (req.method === 'GET' && url.pathname === '/meta') {
        result = await fetchMeta(url.searchParams.get('url'));
      } else if (req.method === 'POST' && url.pathname === '/asset') {
        result = await stashAsset((await readJson(req)).url);
      } else if (req.method === 'POST' && url.pathname === '/recon-upload') {
        const name = text(url.searchParams.get('name') ?? '', 'name', 200);
        const ext = name.slice(name.lastIndexOf('.')).toLowerCase();
        if (!['.mp4', '.mov', '.insv', '.jpg', '.jpeg', '.png', '.webp'].includes(ext)) throw new HttpError(400, '仅支持 mp4/mov/insv/jpg/jpeg/png/webp 素材');
        const bytes = await readRaw(req, 512 * 1024 * 1024);
        if (!bytes.length) throw new HttpError(400, '空文件');
        result = { url: await ousUpload(bytes, name) };
      } else if (req.method === 'POST' && url.pathname === '/world-recon') {
        const body = await readJson(req);
        const resources = Array.isArray(body.resources)
          ? body.resources.map(item => ({ url: safeHttps(text(item?.url ?? '', 'url', 600)), ...(typeof item?.type === 'string' && ['image', 'video', 'insv'].includes(item.type) ? { type: item.type } : {}) }))
          : [];
        if (!resources.length || resources.some(item => !item.url)) throw new HttpError(400, 'resources 需为至少一条带公网 HTTPS 地址的资源');
        const payload = {
          name: text(body.name, 'name', 128),
          resources,
          scene: body.scene === 'model' ? 'model' : 'space',
          taskQuality: ['low', 'normal', 'high'].includes(body.taskQuality) ? body.taskQuality : 'normal',
        };
        const created = await aholo(`${worldBase}/world/v1/reconstructions`, { world: true, method: 'POST', body: JSON.stringify(payload) });
        const taskid = created?.worldId;
        if (!validId(taskid)) throw new HttpError(502, 'Aholo 返回的任务号无效');
        result = { taskid };
      } else if (req.method === 'POST' && ['/text-to-3d', '/image-to-3d', '/world'].includes(url.pathname)) {
        const body = await readJson(req);
        let taskid;
        if (url.pathname === '/world') {
          const payload = { name: text(body.name, 'name', 128), prompt: text(body.prompt, 'prompt', 4000) };
          const created = await aholo(`${worldBase}/world/v1/generations`, { world: true, method: 'POST', body: JSON.stringify(payload) });
          taskid = created?.worldId;
        } else {
          const isImage = url.pathname === '/image-to-3d';
          const payload = isImage ? { img: image(body.img) } :
            { prompt: text(body.prompt, 'prompt', 4000), style: 'photorealistic' };
          Object.assign(payload, { faceCount: 30000, outputFormat: ['zip', 'glb'], version: 'G1' });
          const created = await aholo(`${base}/lux3d/v1/generate/${isImage ? 'img' : 'text'}-to-3d/task/create`, {
            method: 'POST', body: JSON.stringify(payload),
          });
          // Lux3D 创建任务返回的是数字号，转成字符串后才能一路查询回原任务。
          taskid = Number.isSafeInteger(created) && created > 0 ? String(created) : created;
        }
        if (!validId(taskid)) throw new HttpError(502, 'Aholo 返回的任务号无效');
        result = { taskid };
      } else if (req.method === 'GET' && (url.pathname === '/task' || url.pathname === '/world')) {
        const world = url.pathname === '/world';
        const id = queryId(url, world ? 'worldId' : 'taskid');
        const detail = await aholo(world ? `${worldBase}/world/v1/${encodeURIComponent(id)}` :
          `${base}/lux3d/v1/generate/task/get?taskid=${encodeURIComponent(id)}`, { world });
        if (!isRecord(detail) || !Object.hasOwn(detail, 'status')) throw new HttpError(502, 'Aholo 返回的任务详情无效');
        result = { ...normalizeStatus(detail.status, world), outputs: [] };
        if (world) {
          const urls = detail.assets?.splats?.urls;
          result.outputs = [urls?.plyPath, urls?.spzPath, urls?.lodMetaPath].filter(safeHttps);
          // 3DGS 的竖直轴决定预览要不要把点云立起来；上游不给就交给前端按 Z-up 处理。
          const upAxis = detail.semanticsMetadata?.upAxis;
          if (upAxis === 'X' || upAxis === 'Y' || upAxis === 'Z') result.upAxis = upAxis;
          if (typeof detail.progress === 'number' && Number.isFinite(detail.progress) && detail.progress >= 0 && detail.progress <= 1) {
            result.progress = detail.progress;
          }
          const pano = detail.assets?.imagery?.panoUrl;
          if (safeHttps(pano)) result.panoUrl = pano;
        } else {
          result.outputs = (Array.isArray(detail.outputs) ? detail.outputs : []).map(output => output?.content).filter(safeHttps);
        }
      } else {
        throw new HttpError(404, '未知接口');
      }
      send(res, 200, result, origin, key);
    } catch (failure) {
      req.resume();
      if (!res.destroyed && !res.headersSent) {
        send(res, failure instanceof HttpError ? failure.statusCode : 500,
          { error: failure instanceof HttpError ? failure.message : '代理请求失败' }, origin, key);
      }
    }
  });
}

async function readKey() {
  if (process.env.LUX3D_API_KEY !== undefined) return process.env.LUX3D_API_KEY.trim();
  try {
    const source = await readFile(new URL('../../.env.local', import.meta.url), 'utf8');
    const value = source.split(/\r?\n/).find(line => /^\s*LUX3D_API_KEY\s*=/.test(line))?.split('=').slice(1).join('=').trim() ?? '';
    return value.replace(/^(['"])(.*)\1$/, '$2');
  } catch {
    return '';
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const key = await readKey();
  const base = process.env.LUX3D_BASE_URL ?? LUX_BASE;
  const worldBase = process.env.AHOLO_WORLD_BASE_URL ?? WORLD_BASE;
  const port = Number(process.env.LUX3D_PROXY_PORT ?? 3199);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('LUX3D_PROXY_PORT 必须是 1..65535');
  createServer({ key, base, worldBase }).listen(port, '127.0.0.1', () => {
    console.log(`[Aholo dev-proxy] http://127.0.0.1:${port} · 密钥${key ? '已读到' : '缺失'}`);
  });
}
