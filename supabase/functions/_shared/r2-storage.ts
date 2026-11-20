/**
 * R2（S3 兼容）存储驱动：公开读 + 不可猜路径。
 *
 * 为什么要有它：Supabase Storage 的私有桶每次会话都重新签 300s 的地址，token 一变
 * 浏览器和 CDN 都当新资源，同一个模型被反复下载；13 个 MAU 就把 5GB 出网用到 3.74GB。
 * R2 桶公开读、地址不含 token，配合对象侧 immutable 缓存，重复打开不再出网。
 *
 * 切换方式：Edge 环境变量 SCENE_STORAGE_DRIVER=r2。不设或设成 supabase 时走原实现，
 * 一行变量即可回滚，不需要改任何调用点。
 *
 * 安全边界：公开读意味着拿到地址的人都能看，靠的是路径不可枚举（UUID / 内容哈希），
 * 不是权限。这是 2026-11-20 与产品方确认后的取舍。
 */
import { ApiError } from './domain.ts';
import { required, type Env } from './http.ts';

/** 驱动名；未知值直接报错，避免拼错变量名后静默留在 Supabase 上继续出网。 */
export function storageDriver(env: Env): 'supabase' | 'r2' {
  const raw = (env('SCENE_STORAGE_DRIVER') ?? 'supabase').trim().toLowerCase();
  if (raw !== 'supabase' && raw !== 'r2') throw new ApiError('STORAGE_DRIVER_INVALID', 500);
  return raw;
}

const encoder = new TextEncoder();
const UNRESERVED = /[A-Za-z0-9\-._~]/;

/** S3 规范的 URI 编码：除保留字符外全部百分号编码，斜杠保留为路径分隔。 */
function encodePath(key: string): string {
  return key
    .split('/')
    .map(segment => [...encoder.encode(segment)]
      .map(byte => {
        const char = String.fromCharCode(byte);
        return UNRESERVED.test(char) ? char : `%${byte.toString(16).toUpperCase().padStart(2, '0')}`;
      })
      .join(''))
    .join('/');
}

function hex(bytes: Uint8Array): string {
  return [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

async function sha256Hex(value: string): Promise<string> {
  return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value))));
}

async function hmac(key: Uint8Array | string, value: string): Promise<Uint8Array> {
  const material = typeof key === 'string' ? encoder.encode(key) : key;
  // 复制到普通 ArrayBuffer 后备，避免 Uint8Array<ArrayBufferLike> 与 BufferSource 的型变冲突。
  const imported = await crypto.subtle.importKey('raw', new Uint8Array(material), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', imported, encoder.encode(value)));
}

export interface StorageDriver {
  upload(path: string, bytes: Uint8Array, mime: string): Promise<void>;
  readSourceBytes(path: string): Promise<Uint8Array>;
  sign(path: string, expiresIn?: number): Promise<string>;
  stat(path: string): Promise<{ size: number }>;
  createUploadUrl(path: string): Promise<{ url: string; token: string }>;
}

/**
 * 只在 SCENE_STORAGE_DRIVER=r2 时构造；否则返回 null，由 backend.ts 沿用 Supabase 实现。
 * 这里不做任何 Supabase 回落：凭据或桶配错必须显形，不能悄悄继续走旧路。
 */
export function createR2Storage(env: Env): StorageDriver | null {
  if (storageDriver(env) !== 'r2') return null;
  const accountId = required(env, 'R2_ACCOUNT_ID');
  const accessKeyId = required(env, 'R2_ACCESS_KEY_ID');
  const secretAccessKey = required(env, 'R2_SECRET_ACCESS_KEY');
  const bucket = (env('R2_BUCKET') ?? 'scendance-assets').trim();
  const publicBase = (env('R2_PUBLIC_BASE') ?? '').trim().replace(/\/+$/, '');
  if (!publicBase) throw new ApiError('R2_PUBLIC_BASE_MISSING', 500);

  const host = `${accountId}.r2.cloudflarestorage.com`;
  /** 公开对象一年强缓存：路径不可变（UUID / 内容哈希），换内容必然换路径。 */
  const CACHE_CONTROL = 'public, max-age=31536000, immutable';

  async function presign(method: 'PUT' | 'GET' | 'HEAD', path: string, expiresIn: number): Promise<string> {
    const key = `${bucket}/${path.replace(/^\/+/, '')}`;
    const canonicalUri = `/${key.split('/').map(encodePath).join('/')}`;
    const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
    const dateStamp = amzDate.slice(0, 8);
    const scope = `${dateStamp}/auto/s3/aws4_request`;
    const query = new URLSearchParams({
      'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
      'X-Amz-Credential': `${accessKeyId}/${scope}`,
      'X-Amz-Date': amzDate,
      'X-Amz-Expires': String(expiresIn),
      'X-Amz-SignedHeaders': 'host',
      // R2 不接受流式分块签名，预签名一律走 UNSIGNED-PAYLOAD。
      'X-Amz-Content-Sha256': 'UNSIGNED-PAYLOAD',
    });
    const canonicalQuery = [...query.entries()]
      .sort(([left], [right]) => (left < right ? -1 : 1))
      .map(([name, value]) => `${encodeURIComponent(name)}=${encodeURIComponent(value)}`)
      .join('&');
    const canonicalRequest = [
      method,
      canonicalUri,
      canonicalQuery,
      `host:${host}\n`,
      'host',
      'UNSIGNED-PAYLOAD',
    ].join('\n');
    const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, await sha256Hex(canonicalRequest)].join('\n');
    const signingKey = await hmac(
      await hmac(await hmac(await hmac(`AWS4${secretAccessKey}`, dateStamp), 'auto'), 's3'),
      'aws4_request',
    );
    const signature = hex(await hmac(signingKey, stringToSign));
    return `https://${host}${canonicalUri}?${canonicalQuery}&X-Amz-Signature=${signature}`;
  }

  function publicUrl(path: string): string {
    return `${publicBase}/${encodePath(path.replace(/^\/+/, ''))}`;
  }

  return {
    async upload(path, bytes, mime) {
      const response = await fetch(await presign('PUT', path, 900), {
        method: 'PUT',
        headers: { 'Content-Type': mime, 'Cache-Control': CACHE_CONTROL },
        body: new Uint8Array(bytes),
      });
      // 409/412：内容寻址路径已存在，等价于成功（与 Supabase 驱动的既有语义一致）。
      if (!response.ok && response.status !== 409 && response.status !== 412) {
        // 只记状态与 R2 的 XML 错误体（不含凭据），否则签名问题在生产里无法定位。
        const detail = (await response.text().catch(() => '')).slice(0, 300);
        console.error(JSON.stringify({ event: 'r2_upload_failed', status: response.status, detail }));
        throw new ApiError('STORAGE_UPLOAD_FAILED', 502);
      }
    },
    async readSourceBytes(path) {
      // 刚写完的新对象 public 侧可能还没生效，短暂重试三次再判失败。
      const url = publicUrl(path);
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const response = await fetch(url);
        if (response.ok) return new Uint8Array(await response.arrayBuffer());
        if (response.status !== 404) break;
        await new Promise(resolve => setTimeout(resolve, 200 * (attempt + 1)));
      }
      throw new ApiError('STORAGE_DOWNLOAD_FAILED', 502);
    },
    async sign(path) {
      // 公开读下没有可签的东西：返回稳定地址本身就是「永不过期」。
      // 调用方传进来的 expiresIn 只影响它自己的刷新节奏，不改变对象权限。
      return publicUrl(path);
    },
    async stat(path) {
      const response = await fetch(publicUrl(path), { method: 'HEAD' });
      if (!response.ok) throw new ApiError('OBJECT_NOT_FOUND', 404);
      const size = Number(response.headers.get('content-length') ?? '');
      if (!Number.isFinite(size)) throw new ApiError('STORAGE_STAT_FAILED', 502);
      return { size };
    },
    async createUploadUrl(path) {
      const url = await presign('PUT', path, 900);
      // token 只是 Supabase 的直传约定；R2 不需要，保留字段避免改调用方契约。
      return { url, token: '' };
    },
  };
}
