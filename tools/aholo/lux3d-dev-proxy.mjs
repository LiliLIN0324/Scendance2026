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
import { createRequire } from 'node:module';

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
  key = '', base = LUX_BASE, worldBase = WORLD_BASE, fetchImpl = globalThis.fetch, amapSecurity = '',
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
        headers: { Authorization: key, 'Content-Type': 'application/json', ...(world ? { 'x-source': 'openapi' } : {}) },
        redirect: 'error',
        signal: AbortSignal.timeout(30000),
      });
      if (!response.ok) {
        // 失败要带真实上游状态与报文，不能只给一句「上游请求失败」。
        const errText = await response.text().catch(() => '');
        throw new Error(`upstream HTTP ${response.status}: ${errText.slice(0, 300)}`);
      }
      const body = await response.json();
      if (!isRecord(body)) throw new Error('invalid upstream body');
      if (!world) {
        if (body.c !== '0') throw new Error(`Lux rejected request: ${JSON.stringify(body).slice(0, 300)}`);
        return body.d;
      }
      if (Object.hasOwn(body, 'c') && body.c !== '0' && body.c !== 0) throw new Error(`World rejected request: ${JSON.stringify(body).slice(0, 300)}`);
      return body.d ?? body.data ?? body;
    } catch (failure) {
      const timeout = failure?.name === 'TimeoutError' || failure?.name === 'AbortError';
      const reason = failure instanceof HttpError ? failure.message : failure?.message ?? 'unknown';
      throw new HttpError(timeout ? 504 : 502, timeout ? 'Aholo 上游请求超时' : `Aholo 上游请求失败：${reason}`);
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

  // —— World 重建：素材先经 OUS 上传成公网 URL，再创建重建任务（docs/15-Aholo集成规划.md 二梯队）——
  let ousCredentials;
  async function ous(fresh = false) {
    // ousToken 是一次性上传会话凭证：一次上传（含其状态轮询）内必须同 token，跨文件复用会报「Token已被使用」。
    if (!fresh && ousCredentials) return ousCredentials;
    // 重建素材的 token 必须与 World 服务同区（国内网关）：国际网关签发的 token 上传的文件，
    // 国内重建端点查不到归属，会报「文件链接不对，请使用 资产 模块相关接口上传文件」（SDK 也是 region:'cn'）。
    // token 接口返回裸 JSON（无 c/d 壳），不走 aholo() 包装器。
    const tokenResponse = await fetchImpl(`${worldBase}/asset/v1/token`, { headers: { Authorization: key }, signal: AbortSignal.timeout(30000) });
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
    const { token, domain, blockSize } = await ous(true);
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

  
  function mercatorPixel(lng, lat, zoom) {
    const span = (2 ** zoom) * 256;
    const latRad = lat * Math.PI / 180;
    return {
      x: (lng + 180) / 360 * span,
      y: (1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * span,
    };
  }

  // 高德瓦片样式：6 卫星、7 路网、8 路网加注记。调研底图走 7 路网，读路更清楚。
  function resolveAmapTileStyle(searchParams) {
    const raw = Number(searchParams.get('style'));
    if (Number.isInteger(raw) && raw >= 6 && raw <= 8) return raw;
    return searchParams.get('x-ref') === 'map-basemap' ? 7 : 6;
  }

  // 高分辨率底图会拆成上百块瓦片；同时打太多高德会被限流，这里限并发。
  async function mapWithLimit(items, limit, worker) {
    const results = new Array(items.length);
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const index = next++;
        results[index] = await worker(items[index]);
      }
    }));
    return results;
  }

  async function fetchAmapBounds(sharp, west, south, east, north, style = 6) {
    let zoom = 18;
    while (zoom > 3) {
      const nw = mercatorPixel(west, north, zoom);
      const se = mercatorPixel(east, south, zoom);
      if (Math.max(se.x - nw.x, se.y - nw.y) <= 4096) break;
      zoom -= 1;
    }
    const nw = mercatorPixel(west, north, zoom);
    const se = mercatorPixel(east, south, zoom);
    const srcW = se.x - nw.x;
    const srcH = se.y - nw.y;
    if (srcW < 1 || srcH < 1) throw new HttpError(400, 'bounds invalid');
    const longEdge = Math.max(srcW, srcH);
    const fit = longEdge > 2048 ? 2048 / longEdge : (longEdge < 256 ? 256 / longEdge : 1);
    const outW = Math.max(2, Math.round(srcW * fit));
    const outH = Math.max(2, Math.round(srcH * fit));
    const tile = 256;
    const x0 = Math.floor(nw.x / tile);
    const x1 = Math.floor((se.x - 1e-6) / tile);
    const y0 = Math.floor(nw.y / tile);
    const y1 = Math.floor((se.y - 1e-6) / tile);
    const limit = 2 ** zoom;
    const coords = [];
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        if (tx < 0 || ty < 0 || tx >= limit || ty >= limit) continue;
        coords.push({ tx, ty });
      }
    }
    async function grabTile(styleId, tx, ty, optional) {
      let lastError = null;
      // 整片地面要几十块瓦片。单块偶发超时就重试，并换一台主机，避免整张图失败。
      // 预算：单块 2 次 × 8s；客户端 25s 就会放弃留旧图，瓦片预算不能远超它。
      for (let attempt = 0; attempt < 2; attempt++) {
        const host = 1 + ((tx + ty + attempt) % 4);
        try {
          const res = await fetch(`https://webst0${host}.is.autonavi.com/appmaptile?style=${styleId}&x=${tx}&y=${ty}&z=${zoom}`, { signal: AbortSignal.timeout(8000), headers: { 'User-Agent': 'ScendanceLocalProxy/1.0' } });
          if (!res.ok) throw new HttpError(502, 'tile HTTP ' + res.status);
          const buf = Buffer.from(await res.arrayBuffer());
          if (buf.length < 100) throw new HttpError(502, 'empty tile');
          return { input: buf, left: (tx - x0) * tile, top: (ty - y0) * tile };
        } catch (failure) {
          lastError = failure;
        }
      }
      // 路网注记层缺一块只少一块路，不让整张底图失败；卫星层是本体，缺了就报错。
      if (optional) return null;
      throw lastError;
    }
    // 「街道 2」(8) 单独拉只会得到深底注记：同样按 7 打底、8 叠注记，地址里仍标 style=8。
    const baseStyle = style === 8 ? 7 : style;
    const satelliteTiles = (await mapWithLimit(coords, 8, ({ tx, ty }) => grabTile(baseStyle, tx, ty, false))).filter(Boolean);
    // 底图带道路信息（用户拍板）：卫星(6)之上叠路网注记(8)透明 PNG；矢量路网(7)本身带路，不叠。
    const roadTiles = style === 6 || style === 8
      ? (await mapWithLimit(coords, 8, ({ tx, ty }) => grabTile(8, tx, ty, true))).filter(Boolean)
      : [];
    const loaded = [...satelliteTiles, ...roadTiles];
    if (!satelliteTiles.length) throw new HttpError(502, 'no satellite tiles');
    const mosaicW = (x1 - x0 + 1) * tile;
    const mosaicH = (y1 - y0 + 1) * tile;
    const cropLeft = Math.max(0, Math.min(mosaicW - 1, Math.round(nw.x - x0 * tile)));
    const cropTop = Math.max(0, Math.min(mosaicH - 1, Math.round(nw.y - y0 * tile)));
    const cropW = Math.max(1, Math.min(mosaicW - cropLeft, Math.round(srcW)));
    const cropH = Math.max(1, Math.min(mosaicH - cropTop, Math.round(srcH)));
    // 先拼图再另起一次 sharp 做 extract：同一管线里 extract 会再次走 composite，
    // 单瓦片时触发 “Image to composite must have same dimensions or smaller”。
    const mosaic = await sharp({
      create: { width: mosaicW, height: mosaicH, channels: 3, background: { r: 20, g: 30, b: 20 } },
    }).composite(loaded).png().toBuffer();
    const bytes = await sharp(mosaic).extract({ left: cropLeft, top: cropTop, width: cropW, height: cropH }).resize(outW, outH).jpeg({ quality: 86 }).toBuffer();
    return { bytes, type: 'image/jpeg' };
  }

  async function fetchAmapStatic(searchParams) {
    const west = Number(searchParams.get('west'));
    const south = Number(searchParams.get('south'));
    const east = Number(searchParams.get('east'));
    const north = Number(searchParams.get('north'));
    const style = resolveAmapTileStyle(searchParams);
    if ([searchParams.get('west'), searchParams.get('south'), searchParams.get('east'), searchParams.get('north')].some(value => value != null)) {
      if (![west, south, east, north].every(Number.isFinite) || !(east > west) || !(north > south)) throw new HttpError(400, 'bounds invalid');
      const require = createRequire(import.meta.url);
      let sharp;
      try { sharp = require('../../frontend/node_modules/sharp'); }
      catch { throw new HttpError(500, 'sharp unavailable for satellite stitch'); }
      return fetchAmapBounds(sharp, west, south, east, north, style);
    }
    const location = searchParams.get('location') ?? '';
    if (!/^\d{1,3}(?:\.\d+)?,\d{1,3}(?:\.\d+)?$/.test(location)) throw new HttpError(400, 'location invalid');
    const [lngRaw, latRaw] = location.split(',');
    const lng = Number(lngRaw);
    const lat = Number(latRaw);
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) throw new HttpError(400, 'location invalid');
    let zoom = Number(searchParams.get('zoom') ?? '18');
    // z19 对本 Key/区域常回「此区域无卫星图」；硬顶 18。
    if (!Number.isInteger(zoom) || zoom < 3 || zoom > 18) zoom = Math.min(18, Math.max(3, Number.isFinite(zoom) ? Math.round(zoom) : 18));
    if (zoom > 18) zoom = 18;
    // 静态 maptype=satellite 对本 Key 常回矢量图；改拼高德卫星瓦片 style=6。
    const require = createRequire(import.meta.url);
    let sharp;
    try {
      sharp = require('../../frontend/node_modules/sharp');
    } catch {
      throw new HttpError(500, 'sharp unavailable for satellite stitch');
    }
    const n = Math.pow(2, zoom);
    const x = Math.floor(((lng + 180) / 360) * n);
    const latRad = (lat * Math.PI) / 180;
    const y = Math.floor((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * n);
    // 3x3 tiles around center → ~768px
    const tiles = [];
    const span = 1;
    for (let dy = -span; dy <= span; dy++) {
      for (let dx = -span; dx <= span; dx++) {
        const tx = x + dx;
        const ty = y + dy;
        if (tx < 0 || ty < 0 || tx >= n || ty >= n) continue;
        const host = 1 + ((tx + ty) % 4);
        const url = `https://webst0${host}.is.autonavi.com/appmaptile?style=6&x=${tx}&y=${ty}&z=${zoom}`;
        tiles.push({ dx, dy, url, tx, ty });
      }
    }
    if (!tiles.length) throw new HttpError(502, 'no satellite tiles');
    const loaded = await Promise.all(tiles.map(async tile => {
      const res = await fetch(tile.url, { signal: AbortSignal.timeout(10000), headers: { 'User-Agent': 'ScendanceLocalProxy/1.0' } });
      if (!res.ok) throw new HttpError(502, 'tile HTTP ' + res.status);
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 100) throw new HttpError(502, 'empty tile');
      return { ...tile, buf };
    }));
    const size = 256;
    const grid = span * 2 + 1;
    const composites = loaded.map(tile => ({
      input: tile.buf,
      left: (tile.dx + span) * size,
      top: (tile.dy + span) * size,
    }));
    const bytes = await sharp({
      create: { width: grid * size, height: grid * size, channels: 3, background: { r: 20, g: 30, b: 20 } },
    }).composite(composites).jpeg({ quality: 86 }).toBuffer();
    return { bytes, type: 'image/jpeg' };
  }

  // 高德 JS Key 的域名白名单通常只放行线上域名，localhost 会回 10006（INVALID_USER_DOMAIN）并用 JSON 顶掉脚本。
  // dev 代理带线上 Referer 回源，本机才能完整跑地图选址；只在本机监听，线上不经过这里。
  const AMAP_REFERER = process.env.AMAP_REFERER || 'https://scendance.lilicoding.space/';

  async function fetchAmapScript(searchParams) {
    const target = new URL('https://webapi.amap.com/maps');
    for (const name of ['v', 'key', 'plugin']) {
      const value = searchParams.get(name);
      if (value) target.searchParams.set(name, value);
    }
    if (!target.searchParams.get('key')) throw new HttpError(400, '缺 key');
    const res = await fetch(target, {
      headers: { Referer: AMAP_REFERER, 'User-Agent': 'Mozilla/5.0 ScendanceLocalProxy', Accept: '*/*' },
      signal: AbortSignal.timeout(30000),
    });
    const type = (res.headers.get('content-type') ?? '').toLowerCase();
    if (!res.ok || !type.includes('javascript')) {
      const detail = (await res.text().catch(() => '')).slice(0, 200);
      throw new HttpError(502, `高德脚本被拒（${res.status}）：${detail || '非 JS 响应'}`);
    }
    return new Uint8Array(await res.arrayBuffer());
  }

  // 安全密钥只在真正有地图服务请求时才读，避免启动阶段多碰一个 env 文件。
  let amapSecurityCode = amapSecurity;
  async function resolveAmapSecurity() {
    if (!amapSecurityCode) {
      amapSecurityCode = await readEnvFile('NEXT_PUBLIC_AMAP_SECURITY_CODE', new URL('../../frontend/.env.local', import.meta.url));
    }
    return amapSecurityCode;
  }

  // 地点检索要 Web 服务 Key；它只留在本机代理里，浏览器拿不到明文。
  let amapPlaceKey = '';
  async function resolveAmapPlaceKey() {
    if (!amapPlaceKey) {
      // REST place/text 需要 Web 服务 key：优先 root .env.local 的 AMAP_STATIC_KEY
      // （与线上 Pages Function 同名同值）；frontend 的 NEXT_PUBLIC_AMAP_STATIC_KEY 是
      // 带数字签名的 JS key，直接打 REST 会 10007 INVALID_USER_SIGNATURE（2026-11-13 实测）。
      amapPlaceKey = await readEnvFile('AMAP_STATIC_KEY', new URL('../../.env.local', import.meta.url));
      if (!amapPlaceKey) {
        amapPlaceKey = await readEnvFile('NEXT_PUBLIC_AMAP_STATIC_KEY', new URL('../../frontend/.env.local', import.meta.url));
      }
    }
    return amapPlaceKey;
  }

  /** 本机地点检索：回地点名、地址与经纬度，Key 不进响应。
   * 本机 REST key 缺失/无效（NEXT_PUBLIC_AMAP_STATIC_KEY 是带签名的 JS key，REST 打
   * place/text 回 10007）时回退到线上 Pages Function（同契约同源数据），本机不用 key 也能出候选。 */
  async function fetchAmapPlace(searchParams) {
    const keywords = (searchParams.get('keywords') ?? '').trim();
    if (keywords.length < 2 || keywords.length > 80) throw new HttpError(400, 'keywords invalid');
    const limitRaw = Number(searchParams.get('limit') ?? 5);
    const limit = Number.isInteger(limitRaw) ? Math.min(10, Math.max(1, limitRaw)) : 5;
    const key = await resolveAmapPlaceKey();
    if (key) {
      try {
        const places = await amapPlaceViaRest(key, keywords, limit);
        if (places.length) return { places };
      } catch { /* REST 不可用就走线上回退 */ }
    }
    const prod = await fetchProdAmapPlace(keywords, limit);
    if (prod.length) return { places: prod };
    throw new HttpError(404, 'no place');
  }

  async function amapPlaceViaRest(key, keywords, limit) {
    const target = new URL('https://restapi.amap.com/v3/place/text');
    target.searchParams.set('keywords', keywords);
    target.searchParams.set('offset', String(limit));
    target.searchParams.set('page', '1');
    target.searchParams.set('extensions', 'all');
    target.searchParams.set('key', key);
    const res = await fetch(target, {
      headers: { Referer: AMAP_REFERER, 'User-Agent': 'Mozilla/5.0 ScendanceLocalProxy' },
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) throw new HttpError(502, 'place HTTP ' + res.status);
    const body = await res.json();
    return amapPoisToPlaces(body, keywords);
  }

  async function fetchProdAmapPlace(keywords, limit) {
    try {
      const params = new URLSearchParams({ keywords, limit: String(limit) });
      const res = await fetch(`https://scendance-scene-planner-ewz.pages.dev/api/amap-place?${params}`, {
        signal: AbortSignal.timeout(20000),
        headers: { 'User-Agent': 'ScdanceDevProxy/2.2.0' },
      });
      if (!res.ok) return [];
      const body = await res.json();
      return Array.isArray(body?.places) ? body.places : [];
    } catch {
      return [];
    }
  }

  function amapPoisToPlaces(body, keywords) {
    const pois = Array.isArray(body?.pois) ? body.pois : [];
    return pois.flatMap(poi => {
      const [lngRaw, latRaw] = String(poi?.location ?? '').split(',');
      const lng = Number(lngRaw);
      const lat = Number(latRaw);
      if (!Number.isFinite(lng) || !Number.isFinite(lat)) return [];
      const address = Array.isArray(poi.address) ? poi.address.join('') : (poi.address ?? '');
      return [{ id: String(poi.id ?? `${lng},${lat}`), name: String(poi.name ?? '').trim() || keywords, address: String(address), lng, lat }];
    });
  }

  async function fetchAmapService(pathname, searchParams) {
    const target = new URL(`https://restapi.amap.com${pathname.replace(/^\/_AMapService/, '')}`);
    target.search = searchParams.toString();
    // 本机不把安全密钥交给页面，由代理回源时补上，等价于线上页面的安全模式。
    const security = await resolveAmapSecurity();
    if (security && !target.searchParams.has('jscode')) target.searchParams.set('jscode', security);
    const res = await fetch(target, {
      headers: { Referer: AMAP_REFERER, 'User-Agent': 'Mozilla/5.0 ScendanceLocalProxy' },
      signal: AbortSignal.timeout(30000),
    });
    return { status: res.status, type: res.headers.get('content-type') ?? 'application/json', body: await res.text() };
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
      if (req.method === 'GET' && url.pathname === '/amap-js') {
        const bytes = await fetchAmapScript(url.searchParams);
        res.writeHead(200, {
          'Content-Type': 'application/javascript; charset=utf-8',
          'Content-Length': String(bytes.length),
          'Cache-Control': 'no-store',
          Vary: 'Origin',
          'Access-Control-Allow-Origin': origin || '*',
        });
        res.end(Buffer.from(bytes));
        return;
      } else if (req.method === 'GET' && url.pathname.startsWith('/_AMapService/')) {
        const { status, type, body } = await fetchAmapService(url.pathname, url.searchParams);
        res.writeHead(status, {
          'Content-Type': type,
          'Content-Length': String(Buffer.byteLength(body)),
          Vary: 'Origin',
          'Access-Control-Allow-Origin': origin || '*',
        });
        res.end(body);
        return;
      } else if (req.method === 'GET' && url.pathname === '/amap-place') {
        result = await fetchAmapPlace(url.searchParams);
      } else if (req.method === 'GET' && url.pathname === '/amap-static') {
        const { bytes, type } = await fetchAmapStatic(url.searchParams);
        res.writeHead(200, {
          'Content-Type': type,
          'Content-Length': String(bytes.length),
          'Cache-Control': 'private, max-age=600',
          'X-Content-Type-Options': 'nosniff',
          Vary: 'Origin',
          'Access-Control-Allow-Origin': origin || '*',
        });
        res.end(bytes);
        return;
      } else if (req.method === 'GET' && url.pathname === '/api/tdt-tiles') {
        // 天地图瓦片代理（dev-only）：本地 next dev 没有 Pages Functions，这里补一条同源可用的口子。
        // key 只从本机 .env.local 读，上游 URL 不出服务端，响应里不带 tk。
        const tile = await fetchTdtTile(url.searchParams);
        res.writeHead(200, {
          'Content-Type': tile.type,
          'Content-Length': String(tile.bytes.length),
          'Cache-Control': tile.fallback ? 'no-store' : 'public, max-age=86400',
          ...(tile.fallback ? { 'X-Tdt-Fallback': 'placeholder' } : {}),
          Vary: 'Origin',
          ...(origin ? { 'Access-Control-Allow-Origin': origin } : {}),
        });
        res.end(tile.bytes);
        return;
      } else if (req.method === 'GET' && url.pathname === '/api/tdt-search') {
        // 天地图地名搜索（dev-only，对齐 functions/api/tdt-search.ts）。
        // 本机 next dev 没有 Pages Functions，创建活动时的「活动地点」检索走这条口子。
        result = await fetchTdtSearch(url.searchParams);
      } else if (req.method === 'GET' && url.pathname === '/api/tdt-area') {
        // 天地图行政区选区（dev-only，对齐 functions/api/tdt-area.ts）：
        // 用户输入地名时给「这块地的边界」，而不是只有中心点。
        result = await fetchTdtArea(url.searchParams);
      } else if (req.method === 'GET' && url.pathname === '/api/place-shape') {
        // POI 真实轮廓（dev-only，对齐 functions/api/place-shape.ts）：
        // 点地名后从 OSM 挖这个地点的实际占地（商场/公园/景区等面要素），
        // 高德那种「商圈虚线框」的公开数据等价物。Overpass 不稳（忙时排队），
        // 失败一律回空 shape，调用方降级保留定位钉，绝不报错打断。
        result = await fetchPlaceShape(url.searchParams);
      } else if (req.method === 'GET' && url.pathname === '/api/road-network') {
        // 路网矢量（V-2a，dev-only，对齐 functions/api/road-network.ts）：
        // 流线自动生成的道路几何来源——Overpass way["highway"] 按 bbox，
        // GCJ-02 折线 + highway 等级；失败回空 roads，调用方回「路网暂时拿不到」。
        result = await fetchRoadNetwork(url.searchParams);
      } else if (req.method === 'GET' && url.pathname === '/health') {
        result = { ok: true, keyConfigured: Boolean(key), base, worldBase };
      } else if (req.method === 'GET' && url.pathname === '/meta') {
        result = await fetchMeta(url.searchParams.get('url'));
      } else if (req.method === 'GET' && url.pathname === '/debug-stock') {
        // 库存诊断（dev-only）：进程内钥匙实况 + 对 Supabase 的真实查询结果
        const key = await placeStockKey();
        const probeName = url.searchParams.get('name') ?? '杭州湖滨银泰in77';
        const nameNorm = normalizeShapeName(probeName);
        const url2 = `${PLACE_STOCK_DB}/rest/v1/place_shapes?name_norm=eq.${encodeURIComponent(nameNorm)}&select=id,name,pts`;
        let fetchInfo = 'skipped';
        try {
          const res = await fetch(url2, { headers: { apikey: key, Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(8000) });
          fetchInfo = `http=${res.status} body=${(await res.text()).slice(0, 160)}`;
        } catch (e) { fetchInfo = 'THROW ' + e.message; }
        result = {
          envKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ? 'env-set:' + process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY.length : 'env-missing',
          fileKeyLen: key.length,
          fileKeyPrefix: key.slice(0, 12),
          nameNorm,
          fetchInfo,
        };
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
          { error: failure instanceof HttpError ? failure.message : ('代理请求失败: ' + (failure && failure.message ? failure.message : String(failure))) }, origin, key);
      }
    }
  });
}

/* ---------------- 天地图瓦片代理（dev-only，对齐 functions/api/tdt-tiles.ts） ---------------- */
const TDT_TILE_LAYERS = ['vec_w', 'cva_w', 'img_w', 'cia_w'];
const TDT_PLACEHOLDER_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#EEF1F4"/></svg>';

/** 本机 key：优先仓库根 .env.local 的 TDT_KEY，其次前端 .env.local 的两个名字。 */
async function resolveTdtKey() {
  const candidates = [
    ['TDT_KEY', new URL('../../.env.local', import.meta.url)],
    ['NEXT_PUBLIC_TDT_KEY', new URL('../../.env.local', import.meta.url)],
    ['TDT_KEY', new URL('../../frontend/.env.local', import.meta.url)],
    ['NEXT_PUBLIC_TDT_KEY', new URL('../../frontend/.env.local', import.meta.url)],
  ];
  for (const [name, fileUrl] of candidates) {
    const value = await readEnvFile(name, fileUrl);
    if (value) return value;
  }
  return '';
}

async function fetchTdtTile(searchParams) {
  const layer = searchParams.get('layer') ?? '';
  if (!TDT_TILE_LAYERS.includes(layer)) throw new HttpError(400, 'layer invalid');
  const z = Number(searchParams.get('z'));
  const x = Number(searchParams.get('x'));
  const y = Number(searchParams.get('y'));
  if (!Number.isInteger(z) || !Number.isInteger(x) || !Number.isInteger(y)) throw new HttpError(400, 'coords invalid');
  if (z < 3 || z > 18) throw new HttpError(400, 'coords invalid');
  const span = 2 ** z;
  if (x < 0 || y < 0 || x >= span || y >= span) throw new HttpError(400, 'coords invalid');
  const key = await resolveTdtKey();
  if (!key) throw new HttpError(503, '本机缺少 TDT_KEY（仓库根 .env.local 或前端 .env.local）');
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const tileHost = (x + y + attempt) % 8;
    const upstream = new URL(`https://t${tileHost}.tianditu.gov.cn/${layer}/wmts`);
    upstream.searchParams.set('SERVICE', 'WMTS');
    upstream.searchParams.set('REQUEST', 'GetTile');
    upstream.searchParams.set('VERSION', '1.0.0');
    upstream.searchParams.set('LAYER', layer.slice(0, -2));
    upstream.searchParams.set('STYLE', 'default');
    upstream.searchParams.set('TILEMATRIXSET', 'w');
    upstream.searchParams.set('FORMAT', 'tiles');
    upstream.searchParams.set('TILECOL', String(x));
    upstream.searchParams.set('TILEROW', String(y));
    upstream.searchParams.set('TILEMATRIX', String(z));
    upstream.searchParams.set('tk', key);
    try {
      const response = await fetch(upstream, { signal: AbortSignal.timeout(8000), headers: { 'User-Agent': 'ScendanceDevProxy/2.2.0' } });
      if (!response.ok) continue;
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length < 100) continue;
      const raw = response.headers.get('content-type') ?? '';
      const type = raw.toLowerCase().startsWith('image/') ? (raw.split(';')[0] || 'image/png') : 'image/png';
      return { bytes, type, fallback: false };
    } catch {
      // 超时/网络错：换一台主机再试一次。
    }
  }
  return { bytes: Buffer.from(TDT_PLACEHOLDER_SVG), type: 'image/svg+xml', fallback: true };
}

/* 天地图地名搜索（dev-only，对齐 functions/api/tdt-search.ts） */
const TDT_KEYWORD_MIN = 2;
const TDT_KEYWORD_MAX = 80;
/** 天地图 v2 搜索只在小范围 mapBound 内出结果：窄 → 中 → 宽 三档试探，第一档有结果就回。 */
const TDT_BOUND_STEPS = [
  [0.16, 0.12],
  [0.35, 0.26],
  [0.7, 0.5],
];
/**
 * geocoder 的可信分。实测（2026-11-12）：「in77」「asdfgh」回 score 0 并被塞到大同（113.29,40.07），
 * 「查无此地xyz」回 score 42 却指向上海，「平湖秋月」score 0 指向嘉兴；而真地名是
 * 城市/区县 100、兴趣点 99（「湖滨银泰in77」只有 50，所以兴趣点类可以宽松些）。
 * 低于这些分的点既不当搜索中心，也不回成建议。
 */
const TDT_TRUST_SCORE_MIN = 40;
const TDT_ADMIN_TRUST_SCORE_MIN = 80;

function tdtGeocodeTrusted(center) {
  if (!center) return false;
  if (/兴趣点|门牌/.test(center.level)) return center.score >= TDT_TRUST_SCORE_MIN;
  return center.score >= TDT_ADMIN_TRUST_SCORE_MIN;
}
/** 一次请求最多打几次上游搜索：多个中心 × 三档会吃满 8s 超时，这里封顶。 */
const TDT_MAX_UPSTREAM_SEARCHES = 6;

function tdtGcjOffsetRegion(lng, lat) {
  return lng >= 72.004 && lng <= 137.8347 && lat >= 0.8293 && lat <= 55.8271;
}

function tdtTransformLat(x, y) {
  let ret = -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
  ret += (20.0 * Math.sin(6.0 * x * Math.PI) + 20.0 * Math.sin(2.0 * x * Math.PI)) * 2.0 / 3.0;
  ret += (20.0 * Math.sin(y * Math.PI) + 40.0 * Math.sin(y / 3.0 * Math.PI)) * 2.0 / 3.0;
  ret += (160.0 * Math.sin(y / 12.0 * Math.PI) + 320 * Math.sin(y * Math.PI / 30.0)) * 2.0 / 3.0;
  return ret;
}

function tdtTransformLng(x, y) {
  let ret = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
  ret += (20.0 * Math.sin(6.0 * x * Math.PI) + 20.0 * Math.sin(2.0 * x * Math.PI)) * 2.0 / 3.0;
  ret += (20.0 * Math.sin(x * Math.PI) + 40.0 * Math.sin(x / 3.0 * Math.PI)) * 2.0 / 3.0;
  ret += (150.0 * Math.sin(x / 12.0 * Math.PI) + 300.0 * Math.sin(x / 30.0 * Math.PI)) * 2.0 / 3.0;
  return ret;
}

/** CGCS2000/天地图 → GCJ-02（写进 SitePlanData.anchor 前必须转）。 */
function tdtWgs84ToGcj02(lng, lat) {
  if (!tdtGcjOffsetRegion(lng, lat)) return { lng, lat };
  const ee = 0.00669342162296594323;
  const major = 6378245.0;
  let dLat = tdtTransformLat(lng - 105.0, lat - 35.0);
  let dLng = tdtTransformLng(lng - 105.0, lat - 35.0);
  const radLat = (lat / 180.0) * Math.PI;
  let magic = Math.sin(radLat);
  magic = 1 - ee * magic * magic;
  const sqrtMagic = Math.sqrt(magic);
  dLat = (dLat * 180.0) / (((major * (1 - ee)) / (magic * sqrtMagic)) * Math.PI);
  dLng = (dLng * 180.0) / ((major / sqrtMagic) * Math.cos(radLat) * Math.PI);
  return { lng: lng + dLng, lat: lat + dLat };
}

function parseTdtLonLat(raw) {
  if (typeof raw !== 'string') return null;
  const [lngRaw, latRaw] = raw.split(',');
  const lng = Number(lngRaw);
  const lat = Number(latRaw);
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  if (Math.abs(lng) > 180 || Math.abs(lat) > 90) return null;
  return { lng, lat };
}

/** `center=120.16,30.25` → `{lng, lat}`；格式不对就当没给。 */
function parseTdtCenter(raw) {
  if (typeof raw !== 'string' || !raw.includes(',')) return null;
  const [lngRaw, latRaw] = raw.split(',');
  const lng = Number(lngRaw);
  const lat = Number(latRaw);
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  if (Math.abs(lng) > 180 || Math.abs(lat) > 90) return null;
  return { lng, lat };
}

function tdtBoundString(lng, lat, spanLng, spanLat) {
  return `${(lng - spanLng).toFixed(6)},${(lat - spanLat).toFixed(6)},${(lng + spanLng).toFixed(6)},${(lat + spanLat).toFixed(6)}`;
}

/** 名字比较用：忽略大小写、空格与括号标点（「in77」≈「IN77」）。 */
function normalizeTdtName(value) {
  return String(value).toLowerCase().replace(/[\s\u3000·・()（）\-—_/]+/g, '');
}

/** geocoder 单点：回 `{lng, lat, score, level, keyWord}`，取不到回 null。 */
async function tdtGeocodeCenter(keywords, key) {
  try {
    const geocoder = new URL('https://api.tianditu.gov.cn/geocoder');
    geocoder.searchParams.set('ds', JSON.stringify({ keyWord: keywords }));
    geocoder.searchParams.set('tk', key);
    const res = await fetch(geocoder, { signal: AbortSignal.timeout(8000), headers: { 'User-Agent': 'ScendanceDevProxy/2.2.0' } });
    if (!res.ok) return null;
    const body = await res.json();
    const lng = Number(body?.location?.lon);
    const lat = Number(body?.location?.lat);
    if (!Number.isFinite(lng) || !Number.isFinite(lat) || Math.abs(lng) > 180 || Math.abs(lat) > 90) return null;
    return {
      lng,
      lat,
      score: Number.isFinite(Number(body?.location?.score)) ? Number(body.location.score) : 0,
      level: typeof body?.location?.level === 'string' ? body.location.level : '',
      keyWord: typeof body?.location?.keyWord === 'string' && body.location.keyWord.trim() ? body.location.keyWord.trim() : keywords,
    };
  } catch {
    return null;
  }
}

async function fetchTdtSearch(searchParams) {
  const keywords = (searchParams.get('keywords') ?? searchParams.get('keyword') ?? '').trim();
  if (keywords.length < TDT_KEYWORD_MIN || keywords.length > TDT_KEYWORD_MAX) throw new HttpError(400, 'keywords invalid');
  const rawLimit = Number(searchParams.get('limit'));
  const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(10, Math.max(1, Math.round(rawLimit))) : 6;
  const key = await resolveTdtKey();
  if (!key) throw new HttpError(503, '本机缺少 TDT_KEY（仓库根 .env.local 或前端 .env.local）');
  // 用户当前看的地方（画布锚点）：天地图只能在小范围里搜，有它就先用它当中心。
  const hint = parseTdtCenter(searchParams.get('center'));

  let searched = 0;
  const cache = new Map();
  const runSearch = async bound => {
    if (cache.has(bound)) return cache.get(bound);
    searched += 1;
    const places = await searchTdtPlaces(keywords, key, bound, limit);
    cache.set(bound, places);
    return places;
  };
  const target = normalizeTdtName(keywords);

  // 0) 有锚点就先打最窄一档（约 50–150ms）：命中同名 POI 直接回，
  //    省掉 geocoder 那一趟——它遇到「in77」这种查不到的词要 ~2s 才吐答案。
  if (hint) {
    const quick = await runSearch(tdtBoundString(hint.lng, hint.lat, TDT_BOUND_STEPS[0][0], TDT_BOUND_STEPS[0][1]));
    if (quick.some(place => normalizeTdtName(place.name) === target)) return { places: quick };
  }

  // 1) geocoder 拿一个中心点，顺带判断可信度（低分的点当中心会把搜索带到别的城市）。
  const center = await tdtGeocodeCenter(keywords, key);
  const trusted = tdtGeocodeTrusted(center);
  const adminIntent = trusted && /行政区划|行政区/.test(center.level);

  // 2) 中心优先级：
  //    搜的是行政区（「杭州」「西湖区」）→ geocoder 先，用户要的是那块地，不是名字带「杭州」的店；
  //    其它（「in77」「平湖秋月」这种本地专名）→ 先围画布搜，再退到 geocoder 中心。
  const centers = [];
  const pushCenter = point => {
    if (!point) return;
    if (centers.some(item => Math.abs(item.lng - point.lng) < 0.05 && Math.abs(item.lat - point.lat) < 0.05)) return;
    centers.push({ lng: point.lng, lat: point.lat });
  };
  if (adminIntent) pushCenter(center);
  pushCenter(hint);
  if (trusted) pushCenter(center);

  for (const point of centers) {
    for (const [spanLng, spanLat] of TDT_BOUND_STEPS) {
      if (searched >= TDT_MAX_UPSTREAM_SEARCHES) break;
      const places = await runSearch(tdtBoundString(point.lng, point.lat, spanLng, spanLat));
      if (places.length > 0) return { places };
    }
    if (searched >= TDT_MAX_UPSTREAM_SEARCHES) break;
  }

  // 3) 都没搜到：只有可信的 geocoder 点才当「至少能落钉」的兜底，不可信的（大同那种）算没找到。
  if (!trusted) throw new HttpError(404, 'no place');
  const gcj = tdtWgs84ToGcj02(center.lng, center.lat);
  return {
    places: [
      {
        id: `${gcj.lng.toFixed(6)},${gcj.lat.toFixed(6)}`,
        name: center.keyWord,
        address: center.level ? `天地图定位：${center.level}` : '',
        lng: Number(gcj.lng.toFixed(6)),
        lat: Number(gcj.lat.toFixed(6)),
      },
    ],
  };
}

/** 单档天地图 v2 地名搜索：超时/网络错重试一次，空结果回 []。 */
async function searchTdtPlaces(keywords, key, bound, limit) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const upstream = new URL('https://api.tianditu.gov.cn/v2/search');
    upstream.searchParams.set('postStr', JSON.stringify({ keyWord: keywords, level: 12, mapBound: bound, queryType: 1, start: 0, count: limit }));
    upstream.searchParams.set('type', 'query');
    upstream.searchParams.set('tk', key);
    try {
      const response = await fetch(upstream, { signal: AbortSignal.timeout(8000), headers: { 'User-Agent': 'ScendanceDevProxy/2.2.0' } });
      if (!response.ok) continue;
      const body = await response.json();
      const pois = Array.isArray(body?.pois) ? body.pois : [];
      const places = [];
      for (const poi of pois) {
        const name = typeof poi?.name === 'string' ? poi.name.trim() : '';
        const point = parseTdtLonLat(poi?.lonlat);
        if (!name || !point) continue;
        const gcj = tdtWgs84ToGcj02(point.lng, point.lat);
        places.push({
          id: typeof poi?.hotPointID === 'string' && poi.hotPointID ? poi.hotPointID : `${gcj.lng},${gcj.lat}`,
          name,
          address: typeof poi?.address === 'string' ? poi.address.trim() : '',
          lng: Number(gcj.lng.toFixed(6)),
          lat: Number(gcj.lat.toFixed(6)),
        });
        if (places.length >= limit) break;
      }
      if (places.length > 0) return places;
      return [];
    } catch {
      // 超时/网络错：重试一次。
    }
  }
  return [];
}

/* 天地图行政区选区（dev-only，对齐 functions/api/tdt-area.ts） */
const TDT_AREA_MAX_POINTS = 240;
const TDT_AREA_LEVELS = { 1: '省', 2: '区县', 3: '市', 4: '街道' };

/** WKT（POLYGON / MULTIPOLYGON）→ 环数组：只取最内层坐标串，外层括号不带信息。 */
function tdtRingsFromWkt(wkt) {
  const rings = [];
  if (typeof wkt !== 'string' || !wkt.includes('(')) return rings;
  const pattern = /\(([^()]+)\)/g;
  let match;
  while ((match = pattern.exec(wkt)) !== null) {
    const points = [];
    for (const pair of match[1].split(',')) {
      const [lngRaw, latRaw] = pair.trim().split(/\s+/);
      const lng = Number(lngRaw);
      const lat = Number(latRaw);
      if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
      if (Math.abs(lng) > 180 || Math.abs(lat) > 90) continue;
      points.push([lng, lat]);
    }
    if (points.length >= 3) rings.push(points);
  }
  return rings;
}

function tdtRingArea(ring) {
  let sum = 0;
  for (let i = 0; i < ring.length; i += 1) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    sum += a[0] * b[1] - b[0] * a[1];
  }
  return Math.abs(sum) / 2;
}

async function fetchTdtArea(searchParams) {
  const keywords = (searchParams.get('keywords') ?? searchParams.get('keyword') ?? '').trim();
  if (keywords.length < 2 || keywords.length > 40) throw new HttpError(400, 'keywords invalid');
  const rawLimit = Number(searchParams.get('limit'));
  const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(5, Math.max(1, Math.round(rawLimit))) : 3;
  const near = parseTdtLonLat(searchParams.get('near') ?? '');
  const key = await resolveTdtKey();
  if (!key) throw new HttpError(503, '本机缺少 TDT_KEY（仓库根 .env.local 或前端 .env.local）');

  const upstream = new URL('https://api.tianditu.gov.cn/v2/administrative');
  upstream.searchParams.set('keyword', keywords);
  upstream.searchParams.set('childLevel', '0');
  upstream.searchParams.set('extensions', 'true');
  upstream.searchParams.set('tk', key);
  let body = null;
  try {
    const response = await fetch(upstream, { signal: AbortSignal.timeout(8000), headers: { 'User-Agent': 'ScendanceDevProxy/2.2.0' } });
    if (!response.ok) return { areas: [] };
    body = await response.json();
  } catch {
    return { areas: [] };
  }

  const districts = Array.isArray(body?.data?.district) ? body.data.district : [];
  const areas = [];
  const seen = new Set();
  for (const item of districts) {
    const name = typeof item?.name === 'string' ? item.name.trim() : '';
    const wkt = typeof item?.boundary === 'string' ? item.boundary : '';
    if (!name || !wkt) continue;
    const id = typeof item?.gb === 'string' && item.gb ? item.gb : `${name}:${wkt.length}`;
    if (seen.has(id)) continue;
    const rings = tdtRingsFromWkt(wkt);
    if (rings.length === 0) continue;
    let biggest = rings[0];
    for (const ring of rings) if (tdtRingArea(ring) > tdtRingArea(biggest)) biggest = ring;
    const stride = Math.max(1, Math.ceil(biggest.length / TDT_AREA_MAX_POINTS));
    const polygon = [];
    for (let i = 0; i < biggest.length; i += stride) {
      const gcj = tdtWgs84ToGcj02(biggest[i][0], biggest[i][1]);
      polygon.push([Number(gcj.lng.toFixed(6)), Number(gcj.lat.toFixed(6))]);
    }
    if (polygon.length < 3) continue;
    let west = Infinity; let south = Infinity; let east = -Infinity; let north = -Infinity;
    for (const [lng, lat] of polygon) {
      west = Math.min(west, lng); east = Math.max(east, lng);
      south = Math.min(south, lat); north = Math.max(north, lat);
    }
    const cnLng = Number(item?.center?.lng);
    const cnLat = Number(item?.center?.lat);
    const center = Number.isFinite(cnLng) && Number.isFinite(cnLat)
      ? tdtWgs84ToGcj02(cnLng, cnLat)
      : { lng: (west + east) / 2, lat: (south + north) / 2 };
    seen.add(id);
    areas.push({
      id,
      name,
      level: TDT_AREA_LEVELS[Number(item?.level)] ?? '行政区',
      lng: Number(center.lng.toFixed(6)),
      lat: Number(center.lat.toFixed(6)),
      bounds: [Number(west.toFixed(6)), Number(south.toFixed(6)), Number(east.toFixed(6)), Number(north.toFixed(6))],
      polygon,
    });
  }
  const ranked = near
    ? areas
      .map(area => ({ area, d: (area.lng - near.lng) ** 2 + (area.lat - near.lat) ** 2 }))
      .sort((a, b) => a.d - b.d)
      .map(entry => entry.area)
    : areas;
  return { areas: ranked.slice(0, limit) };
}

/* POI 真实轮廓（OSM，dev-only，对齐 functions/api/place-shape.ts）
 * 流程：photon（OSM 地理编码）按「名称+中心点」拿 osm_type/osm_id →
 * Overpass 按 id 取几何（way 或 relation）→ 拼/抽成单环 → WGS84→GCJ-02。
 * photon 不可达时的兜底：Overpass 直接按名搜面要素（先 way 快查、再 relation 慢查），
 * 用 near 收敛范围防全城正则扫；命中结果进程内缓存，镜像抖动时重复查询秒回。
 * 上游忙时一次要排队数十秒，超时预算给足但失败只回 null。 */
const PHOTON_TIMEOUT_MS = 6000;
// 2026-11-13 用户反馈「圈范围太久」→ ①单台预算 45s→25s（QL timeout 同步 40→20），
// ②镜像熔断：刚失败的台 60s 内跳过（坏窗口里不再挨台等死，秒降级），
// ③三路并发抢答（photon/way/rel 同时开跑，见 fetchPlaceShape）。
const OVERPASS_TIMEOUT_MS = 25000;
const OVERPASS_COOLDOWN_MS = 60000;
const SHAPE_MAX_POINTS = 320;
const OVERPASS_ENDPOINTS = [
  // mail.ru 镜像国内最稳（2026-11-12 实测：overpass-api.de 整段 502、photon/Nominatim 全不可达时它 15s 出结果）
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass-api.de/api/interpreter',
  'https://lz4.overpass-api.de/api/interpreter',
];

function normalizeShapeName(value) {
  return String(value ?? '').toLowerCase().replace(/[\s\u3000·．.,，()（）\-—_/]+/g, '');
}

function photonUrl(name, near) {
  const u = new URL('https://photon.komoot.io/api/');
  u.searchParams.set('q', name);
  if (near) {
    u.searchParams.set('lat', String(near.lat));
    u.searchParams.set('lon', String(near.lng));
  }
  u.searchParams.set('limit', '3');
  u.searchParams.set('lang', 'default');
  return u;
}

async function photonLookup(name, near) {
  try {
    const res = await fetch(photonUrl(name, near), {
      signal: AbortSignal.timeout(PHOTON_TIMEOUT_MS),
      headers: { 'User-Agent': 'ScdanceDevProxy/2.2.0' },
    });
    if (!res.ok) return null;
    const body = await res.json();
    const features = Array.isArray(body?.features) ? body.features : [];
    const target = normalizeShapeName(name);
    for (const f of features) {
      const p = f?.properties ?? {};
      if (p.osm_type === 'N') continue; // 节点没有面几何
      const candidate = normalizeShapeName(p.name);
      if (!candidate || !target) continue;
      if (candidate.includes(target) || target.includes(candidate)) return { osmType: p.osm_type, osmId: p.osm_id, label: p.name };
    }
    return null;
  } catch {
    return null;
  }
}

/** 镜像熔断表：endpoint → 熔断到期时间戳。刚失败的台先跳过，坏窗口秒降级不挨台等死。 */
const endpointCooldown = new Map();

async function overpass(query) {
  const body = 'data=' + encodeURIComponent(query);
  const now = Date.now();
  const live = OVERPASS_ENDPOINTS.filter(ep => (endpointCooldown.get(ep) ?? 0) <= now);
  if (live.length === 0) return null; // 全部熔断中：直接放弃，别把超时预算烧完
  for (const endpoint of live) {
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'User-Agent': 'ScdanceDevProxy/2.2.0', 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
        signal: AbortSignal.timeout(OVERPASS_TIMEOUT_MS),
      });
      if (!res.ok) { endpointCooldown.set(endpoint, Date.now() + OVERPASS_COOLDOWN_MS); continue; } // 失败（含 403/451/520 系）熔断后换下一台
      const payload = await res.json();
      endpointCooldown.delete(endpoint);
      return payload;
    } catch {
      endpointCooldown.set(endpoint, Date.now() + OVERPASS_COOLDOWN_MS); // 超时/网络失败也熔断
    }
  }
  return null;
}

/** relation 成员 way 拼成单环：按 way 首尾节点 id 接龙；拼不拢回 null（多部件园区就放弃）。 */
function stitchRelationRings(elements) {
  const nodes = new Map();
  for (const el of elements) {
    if (el?.type !== 'way' || !Array.isArray(el.nodes) || !Array.isArray(el.geometry)) continue;
    const pts = el.geometry.filter(g => Number.isFinite(g?.lon) && Number.isFinite(g?.lat));
    if (pts.length < 2) continue;
    nodes.set(el.id, { pts, head: el.nodes[0], tail: el.nodes[el.nodes.length - 1] });
  }
  if (nodes.size === 0) return null;
  const firstId = nodes.keys().next().value;
  const ring = [];
  let cursor = nodes.get(firstId);
  nodes.delete(firstId);
  ring.push(...cursor.pts);
  let guard = 0;
  while (nodes.size > 0 && guard < 500) {
    guard += 1;
    let found = null;
    for (const [id, way] of nodes) {
      if (way.head === cursor.tail) { found = { id, way, reverse: false }; break; }
      if (way.tail === cursor.tail) { found = { id, way, reverse: true }; break; }
    }
    if (!found) return null;
    const pts = found.reverse ? [...found.way.pts].reverse() : found.way.pts;
    ring.push(...pts.slice(1));
    cursor = found.way;
    nodes.delete(found.id);
  }
  return ring.length >= 3 ? ring : null;
}

/** 命中过的 shape 进程内缓存：公共镜像抖动大，重复查询秒回、也省上游配额。 */
const shapeCache = new Map();
const SHAPE_CACHE_MAX = 64;

function cacheShape(key, shape) {
  if (shapeCache.size >= SHAPE_CACHE_MAX) shapeCache.delete(shapeCache.keys().next().value);
  shapeCache.set(key, shape);
  return shape;
}

function escapeOverpassRegex(value) {
  return value.replace(/[\\^$.*+?()[\]{}|"]/g, ch => '\\' + ch);
}

/** GCJ-02 射线法：near 落在多边形内才认为「用户点的是这块地」。 */
function pointInGcjPolygon(point, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i];
    const [xj, yj] = polygon[j];
    const crosses = (yi > point.lat) !== (yj > point.lat)
      && point.lng < ((xj - xi) * (point.lat - yi)) / (yj - yi) + xi;
    if (crosses) inside = !inside;
  }
  return inside;
}

function gcjBBoxArea(polygon) {
  let west = Infinity; let south = Infinity; let east = -Infinity; let north = -Infinity;
  for (const [lng, lat] of polygon) {
    west = Math.min(west, lng); east = Math.max(east, lng);
    south = Math.min(south, lat); north = Math.max(north, lat);
  }
  return (east - west) * (north - south);
}

/** bbox 平方米（等距圆柱近似）——空间命中候选的绝对尺寸门槛用。 */
function gcjBBoxAreaM2(polygon) {
  let west = Infinity; let south = Infinity; let east = -Infinity; let north = -Infinity;
  for (const [lng, lat] of polygon) {
    west = Math.min(west, lng); east = Math.max(east, lng);
    south = Math.min(south, lat); north = Math.max(north, lat);
  }
  const latMid = (north + south) / 2;
  return ((east - west) * 111320 * Math.cos((latMid * Math.PI) / 180)) * ((north - south) * 110540);
}

/** 折线（道路）→ GCJ 线型选区：不闭合、不填充，前端画粗线。 */
function lineToGcjShape(pts, id, label) {
  if (!pts || pts.length < 2) return null;
  const simplified = simplifyRingMeters(pts, 4);
  const stride = Math.max(1, Math.ceil(simplified.length / SHAPE_MAX_POINTS));
  const polygon = [];
  for (let i = 0; i < simplified.length; i += stride) {
    const gcj = tdtWgs84ToGcj02(simplified[i].lon, simplified[i].lat);
    polygon.push([Number(gcj.lng.toFixed(6)), Number(gcj.lat.toFixed(6))]);
  }
  if (polygon.length < 2) return null;
  let west = Infinity; let south = Infinity; let east = -Infinity; let north = -Infinity;
  for (const [lng, lat] of polygon) {
    west = Math.min(west, lng); east = Math.max(east, lng);
    south = Math.min(south, lat); north = Math.max(north, lat);
  }
  return {
    id,
    name: label,
    kind: 'line',
    polygon,
    bounds: [Number(west.toFixed(6)), Number(south.toFixed(6)), Number(east.toFixed(6)), Number(north.toFixed(6))],
  };
}

/** 米制近似坐标（等距圆柱，x=lon·cos(lat0)·111320 / y=lat·110540）。 */
function ringToMeters(ring) {
  const lat0 = ring[0].lat;
  const kx = Math.cos((lat0 * Math.PI) / 180) * 111320;
  return ring.map(p => ({ x: p.lon * kx, y: p.lat * 110540 }));
}

/** 轻量 Douglas-Peucker 抽稀（米制）：压掉楼宇尺度的微抖动，轮廓像高德一样干净。 */
function simplifyRingMeters(ring, toleranceM) {
  if (ring.length < 5) return ring;
  const pts = ringToMeters(ring);
  const keep = new Array(ring.length).fill(false);
  keep[0] = true;
  keep[ring.length - 1] = true;
  const stack = [[0, ring.length - 1]];
  while (stack.length > 0) {
    const [a, b] = stack.pop();
    if (b <= a + 1) continue;
    const ax = pts[a].x; const ay = pts[a].y;
    const dx = pts[b].x - ax; const dy = pts[b].y - ay;
    const len2 = dx * dx + dy * dy || 1e-9;
    let maxD = -1; let maxI = -1;
    for (let i = a + 1; i < b; i++) {
      const t = Math.max(0, Math.min(1, ((pts[i].x - ax) * dx + (pts[i].y - ay) * dy) / len2));
      const ex = ax + dx * t - pts[i].x;
      const ey = ay + dy * t - pts[i].y;
      const d = Math.sqrt(ex * ex + ey * ey);
      if (d > maxD) { maxD = d; maxI = i; }
    }
    if (maxD > toleranceM) { keep[maxI] = true; stack.push([a, maxI], [maxI, b]); }
  }
  const out = [];
  for (let i = 0; i < ring.length; i++) if (keep[i]) out.push(ring[i]);
  return out;
}

function ringToGcjShape(ring, id, label) {
  if (!ring || ring.length < 3) return null;
  const simplified = simplifyRingMeters(ring, 4);
  const stride = Math.max(1, Math.ceil(simplified.length / SHAPE_MAX_POINTS));
  const polygon = [];
  for (let i = 0; i < simplified.length; i += stride) {
    const gcj = tdtWgs84ToGcj02(simplified[i].lon, simplified[i].lat);
    polygon.push([Number(gcj.lng.toFixed(6)), Number(gcj.lat.toFixed(6))]);
  }
  if (polygon.length < 3) return null;
  let west = Infinity; let south = Infinity; let east = -Infinity; let north = -Infinity;
  for (const [lng, lat] of polygon) {
    west = Math.min(west, lng); east = Math.max(east, lng);
    south = Math.min(south, lat); north = Math.max(north, lat);
  }
  return {
    id,
    name: label,
    polygon,
    bounds: [Number(west.toFixed(6)), Number(south.toFixed(6)), Number(east.toFixed(6)), Number(north.toFixed(6))],
  };
}

/** relation 成员直接按坐标接龙成单环（`out geom` 的成员带 geometry；首尾点相同即相接，不依赖节点 id）。 */
function stitchMemberGeometry(members) {
  const key = p => `${p.lon.toFixed(7)},${p.lat.toFixed(7)}`;
  const pieces = [];
  for (const m of members ?? []) {
    if (m?.role === 'inner' || !Array.isArray(m.geometry)) continue;
    const pts = m.geometry.filter(g => Number.isFinite(g?.lon) && Number.isFinite(g?.lat));
    if (pts.length < 2) continue;
    pieces.push({ pts, head: key(pts[0]), tail: key(pts[pts.length - 1]) });
  }
  if (pieces.length === 0) return null;
  const ring = [...pieces[0].pts];
  let tail = pieces[0].tail;
  const rest = pieces.slice(1);
  let guard = 0;
  while (rest.length > 0 && guard < 500) {
    guard += 1;
    const idx = rest.findIndex(p => p.head === tail || p.tail === tail);
    if (idx < 0) return null;
    const piece = rest.splice(idx, 1)[0];
    const reverse = piece.tail === tail;
    const pts = reverse ? [...piece.pts].reverse() : piece.pts;
    ring.push(...pts.slice(1));
    tail = reverse ? piece.head : piece.tail;
  }
  return rest.length === 0 && ring.length >= 3 ? ring : null;
}

/** photon 命中路径：按 osm id 取几何；relation 先试整包元素接龙，失败再从成员 geometry 拼环。 */
async function shapeFromOsmId(osmType, osmId, label) {
  const kind = osmType === 'R' ? 'rel' : 'way';
  const query = `[out:json][timeout:20];${kind}(${osmId});out geom;`;
  const payload = await overpass(query);
  const elements = payload?.elements;
  if (!Array.isArray(elements) || elements.length === 0) return null;
  const primary = elements.find(el => el?.type === kind && el?.id === osmId);
  if (!primary) return null;
  let ring = null;
  if (kind === 'way') {
    const pts = (primary.geometry ?? []).filter(g => Number.isFinite(g?.lon) && Number.isFinite(g?.lat));
    ring = pts.length >= 3 ? pts : null;
  } else {
    ring = stitchRelationRings(elements) ?? stitchMemberGeometry(primary.members);
  }
  return ringToGcjShape(ring, `osm:${osmType}${osmId}`, label);
}

/** 候选排序：同名 > 包含定位点 > 其余；同级名字短的优先（整场地 > 区块），面积大的优先。 */
function pickNameCandidate(candidates, name, near) {
  const target = normalizeShapeName(name);
  if (!target) return null;
  const scored = [];
  for (const c of candidates) {
    if (!c.ring || c.ring.length < 3) continue;
    const candidate = normalizeShapeName(c.label);
    if (!candidate || !(candidate.includes(target) || target.includes(candidate))) continue;
    const gcj = c.ring.map(p => { const g = tdtWgs84ToGcj02(p.lon, p.lat); return [g.lng, g.lat]; });
    const rank = candidate === target ? 0 : (near && pointInGcjPolygon(near, gcj) ? 1 : 2);
    scored.push({ ...c, rank, nameLen: candidate.length, area: gcjBBoxArea(gcj) });
  }
  scored.sort((a, b) => a.rank - b.rank || a.nameLen - b.nameLen || b.area - a.area);
  return scored[0] ?? null;
}

/** Overpass 按名搜单类要素（kind='way'|'relation'）：geometry 随结果返回，无需二次请求。 */
async function nameSearchStage(name, near, kind) {
  if (!near) return null; // 无定位点没法收敛范围，不冒险全城正则扫
  const safe = escapeOverpassRegex(name);
  const query = `[out:json][timeout:20];${kind}["name"~"${safe}",i](around:1500,${near.lat},${near.lng});out geom;`;
  const payload = await overpass(query);
  const elements = Array.isArray(payload?.elements) ? payload.elements : [];
  if (kind === 'way') {
    const pick = pickNameCandidate(
      elements
        .filter(el => el?.type === 'way' && Array.isArray(el.geometry))
        .map(el => ({ el, label: el.tags?.name ?? '', ring: el.geometry.filter(g => Number.isFinite(g?.lon) && Number.isFinite(g?.lat)) })),
      name, near,
    );
    return pick ? ringToGcjShape(pick.ring, `osm:W${pick.el.id}`, pick.label || name) : null;
  }
  const pick = pickNameCandidate(
    elements
      .filter(el => el?.type === 'relation')
      .map(el => ({ el, label: el.tags?.name ?? '', ring: stitchMemberGeometry(el.members) })),
    name, near,
  );
  return pick ? ringToGcjShape(pick.ring, `osm:R${pick.el.id}`, pick.label || name) : null;
}

/** photon 精确链：osm_id 定位 → 按 id 取几何。 */
async function photonPath(name, near) {
  const hit = await photonLookup(name, near);
  return hit ? shapeFromOsmId(hit.osmType, hit.osmId, hit.label || name) : null;
}

/** 三路并发抢答：谁先挖到用谁的，全空才 null——串行排队是「圈范围太久」的主因。 */
function firstNonNull(tasks) {
  return new Promise(resolve => {
    let pending = tasks.length;
    for (const task of tasks) {
      Promise.resolve().then(task).then(value => {
        if (value) resolve(value);
        else if (--pending === 0) resolve(null);
      }).catch(() => {
        if (--pending === 0) resolve(null);
      });
    }
  });
}

/** 空间命中：点在哪个面里就框哪个面——不看名字，是「点建筑出建筑选区」的主路径。 */
async function spatialAreaStage(name, near) {
  if (!near) return null;
  const at = `${near.lat},${near.lng}`;
  // around:400 不是 100：大场地（度假村/园区 1km+）的 near 点常在地块内部，离最近
  // 边界顶点轻松超过 100m，100 半径会整块漏掉；真正的「点的是不是它」由
  // pointInGcjPolygon 判定，这里只是召回网，放宽无害。
  const query = `[out:json][timeout:20];(way["building"](around:400,${at});way["landuse"](around:400,${at});way["leisure"](around:400,${at});way["amenity"](around:400,${at});way["shop"](around:400,${at});way["tourism"](around:400,${at});way["man_made"](around:400,${at});way["natural"](around:400,${at}););out geom;`;
  const payload = await overpass(query);
  const elements = Array.isArray(payload?.elements) ? payload.elements : [];
  const target = normalizeShapeName(name);
  const candidates = [];
  for (const el of elements) {
    if (el?.type !== 'way' || !Array.isArray(el.geometry)) continue;
    const pts = el.geometry.filter(g => Number.isFinite(g?.lon) && Number.isFinite(g?.lat));
    if (pts.length < 4) continue;
    // 面要素要闭合（首尾同点）；开放折线（道路）不在此列，走 highway 线型兜底
    if (Math.abs(pts[0].lat - pts[pts.length - 1].lat) > 1e-6 || Math.abs(pts[0].lon - pts[pts.length - 1].lon) > 1e-6) continue;
    const gcj = pts.map(p => { const g = tdtWgs84ToGcj02(p.lon, p.lat); return [g.lng, g.lat]; });
    if (!pointInGcjPolygon(near, gcj)) continue;
    const areaM2 = gcjBBoxAreaM2(gcj);
    if (areaM2 > 9e6) continue; // 3km×3km 门槛：更大的多是区域级地块，不算「点中的建筑」
    const label = el.tags?.name ?? '';
    const candidate = normalizeShapeName(label);
    candidates.push({
      el,
      label,
      ring: pts,
      area: areaM2,
      nameMatch: !!(target && candidate && (candidate.includes(target) || target.includes(candidate))),
    });
  }
  if (candidates.length === 0) return null;
  // 有同名候选优先（点的名字就是它）；否则取「包含点击点的最小的面」=点中的那个建筑
  const named = candidates.filter(c => c.nameMatch);
  const pool = named.length > 0 ? named : candidates;
  pool.sort((a, b) => a.area - b.area);
  const pick = pool[0];
  return ringToGcjShape(pick.ring, `osm:W${pick.el.id}`, pick.label || name);
}

/** 道路线型兜底：面要素都不命中时，框住点击点最近的道路段（前端画粗线高亮）。 */
async function highwayLineStage(name, near) {
  if (!near) return null;
  const at = `${near.lat},${near.lng}`;
  const query = `[out:json][timeout:20];way["highway"](around:60,${at});out geom;`;
  const payload = await overpass(query);
  const elements = Array.isArray(payload?.elements) ? payload.elements : [];
  // 名字门槛（2026-11-13 用户「点 in77 给了开元路」）：路名必须与查询名互相包含，
  // 无名/不同名的路一律不要——道路兜底只为「点道路」服务，绝不替 POI 编一个路选区。
  const target = normalizeShapeName(name);
  let best = null; let bestD = Infinity;
  for (const el of elements) {
    if (el?.type !== 'way' || !Array.isArray(el.geometry)) continue;
    const pts = el.geometry.filter(g => Number.isFinite(g?.lon) && Number.isFinite(g?.lat));
    if (pts.length < 2) continue;
    const label = el.tags?.name ?? '';
    const candidate = normalizeShapeName(label);
    if (!target || !candidate || !(candidate.includes(target) || target.includes(candidate))) continue;
    let d = Infinity;
    for (const p of pts) {
      const dd = Math.hypot((p.lon - near.lng) * 85000, (p.lat - near.lat) * 111000);
      if (dd < d) d = dd;
    }
    if (d < bestD) { bestD = d; best = { el, pts, label }; }
  }
  if (!best || bestD > 120) return null; // 120m 内没有同名道路段就放弃（宁降级只落钉，不出错路）
  return lineToGcjShape(best.pts, `osm:W${best.el.id}`, best.label || name);
}

/* ---------------- 选区库存（2026-11-13 用户拍板「先存杭州」）----------------
 * 挖到过的轮廓存 Supabase place_shapes 表（全用户共享、永久秒出）。
 * 写入仅收杭州范围；表未建/无密钥/网络失败一律静默跳过——库存是锦上添花，
 * 绝不阻塞主链路。密钥读 .env.local 的 SUPABASE_SERVICE_ROLE_KEY。 */
const PLACE_STOCK_DB = 'https://wkhfvnzgopjdzxlmycks.supabase.co';
const PLACE_STOCK_HZ = [119.9, 29.9, 120.9, 30.6]; // 杭州市域粗框

async function placeStockKey() {
  // anon 级钥匙即可（表 RLS 策略放行 anon 读写）。
  // 故意绕过 process.env：npm --env-file 父子链路对 GBK 文件解析会把值截短
  // （实测 46→37 位，Supabase 401 拒收）——直接 latin1 读文件拿完整钥匙。
  try {
    const rootLine = (await readFile(new URL('../../.env.local', import.meta.url), 'latin1'))
      .split(/\r?\n/)
      .find(line => /^NEXT_PUBLIC_SUPABASE_ANON_KEY=/.test(line));
    if (rootLine) {
      const value = rootLine.split('=').slice(1).join('=').trim();
      if (value) return value;
    }
  } catch {
    // 根 .env.local 读不到就试 frontend 的
  }
  try {
    const feLine = (await readFile(new URL('../../frontend/.env.local', import.meta.url), 'latin1'))
      .split(/\r?\n/)
      .find(line => /^NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=/.test(line));
    if (feLine) return feLine.split('=').slice(1).join('=').trim();
  } catch {
    // 兜底也失败就走 readEnvFile
  }
  return readEnvFile('NEXT_PUBLIC_SUPABASE_ANON_KEY', new URL('../../.env.local', import.meta.url)) || '';
}

function shapeInHangzhou(shape) {
  const [w, s, e, n] = shape.bounds;
  return w >= PLACE_STOCK_HZ[0] && s >= PLACE_STOCK_HZ[1] && e <= PLACE_STOCK_HZ[2] && n <= PLACE_STOCK_HZ[3];
}

async function lookupPlaceStock(nameNorm) {
  const key = await placeStockKey();
  if (!key) return null;
  try {
    const res = await fetch(`${PLACE_STOCK_DB}/rest/v1/place_shapes?name_norm=eq.${encodeURIComponent(nameNorm)}&select=id,name,kind,polygon,bounds`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return null;
    const rows = await res.json();
    const row = rows?.[0];
    if (!row || !Array.isArray(row.polygon) || row.polygon.length < 3) return null;
    return { id: row.id, name: row.name, kind: row.kind === 'line' ? 'line' : 'area', polygon: row.polygon, bounds: row.bounds };
  } catch {
    return null;
  }
}

async function writePlaceStock(shape, nameNorm) {
  if (!shapeInHangzhou(shape)) return; // 先只囤杭州
  const key = await placeStockKey();
  if (!key) return;
  try {
    await fetch(`${PLACE_STOCK_DB}/rest/v1/place_shapes`, {
      method: 'POST',
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates' },
      body: JSON.stringify({
        id: shape.id,
        name_norm: nameNorm,
        name: shape.name,
        kind: shape.kind || 'area',
        center_lng: (shape.bounds[0] + shape.bounds[2]) / 2,
        center_lat: (shape.bounds[1] + shape.bounds[3]) / 2,
        bounds: shape.bounds,
        polygon: shape.polygon,
        pts: shape.polygon.length,
      }),
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    // 库存写入失败不影响本次出框
  }
}

async function fetchPlaceShape(searchParams) {
  const name = (searchParams.get('name') ?? '').trim();
  if (!name || name.length < 2 || name.length > 60) throw new HttpError(400, 'name invalid');
  const near = parseTdtLonLat(searchParams.get('near') ?? '');
  // 检索名只取「名称 | 地址」的名称段：地址尾巴会污染 photon 匹配与 Overpass 按名正则，
  // 是「只有 in77 出框、大部分地点不出框」的主因之一（2026-11-13 用户要求大部分搜索带框）。
  const queryName = name.split('|')[0].trim() || name;
  const cacheKey = `${normalizeShapeName(queryName)}|${near ? `${near.lng.toFixed(2)},${near.lat.toFixed(2)}` : ''}`;
  const cached = shapeCache.get(cacheKey);
  if (cached) return { shape: cached };
  // 库存查询（2026-11-13 用户拍板「先存杭州」）：挖到过的轮廓存 Supabase 共享表，
  // 命中即秒回；表未建/无密钥时静默跳过，绝不阻塞主链路。
  const nameNorm = normalizeShapeName(queryName);
  const stockHit = await lookupPlaceStock(nameNorm);
  if (stockHit) return { shape: cacheShape(cacheKey, stockHit) };
  // 名字分段重试：高德名「盐官古城-潮乐之城」与 OSM 名「盐官潮乐之城国际旅游度假区」
  // 对不上时，按 -·/空格 拆段逐段试（整名优先，段长的优先）。空间命中本不看名字，
  // 这里是名字链路的兜底；线上回退只跟第一轮（整名）一起跑，段轮不再惊动 CF。
  const segmentCandidates = [
    queryName,
    ...queryName.split(/[-·\s]+/).map(s => s.trim()).filter(s => s.length >= 2),
  ].filter((value, index, all) => all.indexOf(value) === index)
    .sort((a, b) => b.length - a.length);
  let shape = null;
  for (let i = 0; i < segmentCandidates.length && !shape; i += 1) {
    const candidate = segmentCandidates[i];
    shape = await firstNonNull([
      () => photonPath(candidate, near),
      () => nameSearchStage(candidate, near, 'way'),
      () => nameSearchStage(candidate, near, 'rel'),
      () => (near ? spatialAreaStage(queryName, near) : Promise.resolve(null)),
      // 线上函数同链路并发抢答：本机到 OSM 可能整段不可达（晚间坏窗口），CF 出口网络独立
      // ——五路谁先出结果用谁，60s 上限恒在预算内；服务端对服务端直调无跨域问题。
      // （线上旧部署的 highway 兜底还没有名字门槛——重部署前本机补一道，免得替 POI 编路选区）
      ...(i === 0 ? [() => fetchProdPlaceShape(name, near).then(s => {
        if (s?.kind === 'line') {
          const target = normalizeShapeName(queryName);
          const candidate = normalizeShapeName(s.name ?? '');
          if (!target || !candidate || !(candidate.includes(target) || target.includes(candidate))) return null;
        }
        return s;
      })] : []),
    ]);
  }
  if (!shape && near) shape = await highwayLineStage(queryName, near);
  if (shape) {
    cacheShape(cacheKey, shape);
    void writePlaceStock(shape, nameNorm); // 入库存（杭州范围），失败静默——出框不等它
    return { shape };
  }
  return { shape: null };
}

const PROD_PLACE_SHAPE_URL = 'https://scendance-scene-planner-ewz.pages.dev/api/place-shape';

/** 线上回退：调生产 place-shape（带完整同名链路），60s 预算。 */
async function fetchProdPlaceShape(name, near) {
  try {
    const params = new URLSearchParams({ name });
    if (near) params.set('near', `${near.lng.toFixed(6)},${near.lat.toFixed(6)}`);
    const res = await fetch(`${PROD_PLACE_SHAPE_URL}?${params}`, {
      signal: AbortSignal.timeout(60000),
      headers: { 'User-Agent': 'ScdanceDevProxy/2.2.0' },
    });
    if (!res.ok) return null;
    const body = await res.json();
    return body?.shape ?? null;
  } catch {
    return null;
  }
}

/* 路网矢量（V-2a，dev-only，对齐 functions/api/road-network.ts）：way["highway"] bbox → GCJ 折线 + 等级。 */
const ROAD_MAX_POINTS = 160;

function roadDecimate(points) {
  if (points.length <= ROAD_MAX_POINTS) return points;
  const stride = Math.ceil(points.length / ROAD_MAX_POINTS);
  const out = [];
  for (let i = 0; i < points.length; i += stride) out.push(points[i]);
  return out;
}

function parseRoadWires(payload) {
  const elements = Array.isArray(payload?.elements) ? payload.elements : [];
  const roads = [];
  for (const el of elements) {
    if (el?.type !== 'way' || !Array.isArray(el.geometry) || !el.tags?.highway) continue;
    const points = [];
    for (const node of el.geometry) {
      if (!Number.isFinite(node?.lon) || !Number.isFinite(node?.lat)) continue;
      const gcj = tdtWgs84ToGcj02(node.lon, node.lat);
      points.push([Number(gcj.lng.toFixed(6)), Number(gcj.lat.toFixed(6))]);
    }
    if (points.length < 2) continue;
    roads.push({
      id: `osm:W${el.id ?? roads.length}`,
      highway: String(el.tags.highway),
      name: String(el.tags.name ?? ''),
      points: roadDecimate(points),
    });
  }
  return roads;
}

async function fetchRoadNetwork(searchParams) {
  const lat = Number(searchParams.get('lat'));
  const lng = Number(searchParams.get('lng'));
  const spanRaw = Number(searchParams.get('span') ?? 1200);
  const span = Number.isFinite(spanRaw) ? Math.min(5000, Math.max(200, spanRaw)) : 1200;
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return { roads: [] };
  const halfDegLat = span / 111132.92;
  const halfDegLng = span / (Math.cos(lat * Math.PI / 180) * 111319.49);
  const query = `[out:json][timeout:20];way["highway"](${(lat - halfDegLat).toFixed(6)},${(lng - halfDegLng).toFixed(6)},${(lat + halfDegLat).toFixed(6)},${(lng + halfDegLng).toFixed(6)});out geom;`;
  const payload = await overpass(query);
  return { roads: payload ? parseRoadWires(payload) : [] };
}

async function readEnvFile(name, fileUrl) {
  if (process.env[name] !== undefined) return process.env[name].trim();
  try {
    // latin1 读：.env.local 是 GBK 编码（中文注释），utf8 解码时 GBK 序列会吞掉
    // 相邻 ASCII 密钥行（NEXT_PUBLIC_SUPABASE_ANON_KEY 就这样丢过）；密钥值全 ASCII，latin1 安全。
    const source = await readFile(fileUrl, 'latin1');
    const value = source.split(/\r?\n/).find(line => new RegExp(`^\\s*${name}\\s*=`).test(line))?.split('=').slice(1).join('=').trim() ?? '';
    return value.replace(/^(['"])(.*)\1$/, '$2');
  } catch {
    return '';
  }
}

const readKey = () => readEnvFile('LUX3D_API_KEY', new URL('../../.env.local', import.meta.url));

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
