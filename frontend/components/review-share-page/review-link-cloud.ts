/**
 * 评审短链：整份方案快照存 Supabase，URL 只留短码。
 *
 * 发出去的地址是 `/r/<code>`。微信等会剥掉 URL 哈希，所以不能只靠
 * `/review/#review=`。旧的哈希短链仍能打开。
 *
 * 读取对匿名开放；写入要求已登录（含匿名登录），避免公开表被任意灌数据。
 * 未登录、后端没接上或写入失败时，调用方必须说明原因，不能改发一条
 * `#layout=` 长链当作正常链接。
 */

import { getBackendConfig } from '@/lib/backend-session';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { isShareHash } from '../room-organizer/lib/share';

export const REVIEW_SHORT_PARAM = 'review';
export const REVIEW_SHORT_PATH = '/r/';
/** 旧哈希短链仍挂在评审页上。新链接不再用这个路径。 */
export const REVIEW_HASH_PAGE = '/review/';
export const REVIEW_CODE_PATTERN = /^[a-z0-9]{12,24}$/;
/** 与数据库 review_share_links.payload_size 的上限保持一致。 */
export const REVIEW_LINK_MAX_PAYLOAD_BYTES = 512_000;

export type ReviewLinkRecord = { longHash: string; payload: unknown };
export type ReviewLinkReadFailure = 'disabled' | 'network' | 'not-found' | 'bad-response';
export type ReviewLinkWriteFailure = 'disabled' | 'signed-out' | 'network' | 'rejected' | 'too-large';

export type ReviewLinkReadResult =
  | { ok: true; value: ReviewLinkRecord }
  | { ok: false; reason: ReviewLinkReadFailure };

export type ReviewLinkWriteResult =
  | { ok: true; code: string }
  | { ok: false; reason: ReviewLinkWriteFailure };

/** `/review/#review=<code>` → code。别的片段一律不认。 */
export function reviewCodeFromHash(hash: string): string | null {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  const index = raw.indexOf('=');
  if (index < 0 || raw.slice(0, index) !== REVIEW_SHORT_PARAM) return null;
  const code = raw.slice(index + 1);
  return REVIEW_CODE_PATTERN.test(code) ? code : null;
}

/** `/r/<code>` → code。尾斜杠可以，别的路径不认。 */
export function reviewCodeFromPath(pathname: string): string | null {
  const match = /^\/r\/([a-z0-9]{12,24})\/?$/.exec(pathname);
  const code = match?.[1] ?? '';
  return REVIEW_CODE_PATTERN.test(code) ? code : null;
}

export function reviewShortHref(origin: string, code: string): string | null {
  if (!REVIEW_CODE_PATTERN.test(code)) return null;
  try {
    const base = new URL(origin);
    return `${base.origin}${REVIEW_SHORT_PATH}${code}`;
  } catch {
    return null;
  }
}

/**
 * 创作者可以记下的客户链接。
 * `path` 是 `/r/<code>`，`hash` 是旧的 `/review/#review=`，`layout` 是仍可读的长链。
 */
export function reviewClientLinkKind(url: URL): 'path' | 'hash' | 'layout' | null {
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search) return null;
  if (reviewCodeFromPath(url.pathname)) return url.hash ? null : 'path';
  if (url.pathname !== '/review' && url.pathname !== '/review/') return null;
  if (reviewCodeFromHash(url.hash)) return 'hash';
  if (url.hash.startsWith('#layout=') && url.hash.length > '#layout='.length) return 'layout';
  return null;
}

/** 短码用 96 位随机十六进制：不可枚举，长度固定 24，落在数据库约束内。 */
export function newReviewCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function readReviewLink(code: string): Promise<ReviewLinkReadResult> {
  if (!REVIEW_CODE_PATTERN.test(code)) return { ok: false, reason: 'not-found' };
  const response = await callRpc('review_share_link_read', { p_code: code });
  if (!response.ok) {
    if (response.reason === 'rejected') return { ok: false, reason: 'not-found' };
    return { ok: false, reason: response.reason === 'disabled' ? 'disabled' : 'network' };
  }
  const value = response.value as { longHash?: unknown; payload?: unknown } | null;
  if (!value || typeof value.longHash !== 'string' || !isShareHash(value.longHash) || value.payload === undefined) {
    return { ok: false, reason: 'bad-response' };
  }
  return { ok: true, value: { longHash: value.longHash, payload: value.payload } };
}

export async function publishReviewLink(input: {
  longHash: string;
  payload: unknown;
  /** 发给客户时的权限。写进短链载荷，不改方案长哈希。 */
  reviewAccess?: unknown;
}): Promise<ReviewLinkWriteResult> {
  if (!isShareHash(input.longHash)) return { ok: false, reason: 'rejected' };
  const payload = input.reviewAccess && input.payload && typeof input.payload === 'object'
    ? { ...(input.payload as Record<string, unknown>), reviewAccess: input.reviewAccess }
    : input.payload;
  let bytes = 0;
  try {
    bytes = new TextEncoder().encode(JSON.stringify(payload)).byteLength;
  } catch {
    return { ok: false, reason: 'rejected' };
  }
  if (bytes > REVIEW_LINK_MAX_PAYLOAD_BYTES) return { ok: false, reason: 'too-large' };

  const config = getBackendConfig();
  if (!config.configured) return { ok: false, reason: 'disabled' };

  let token: string | undefined;
  try {
    const supabase = createSupabaseBrowserClient(config.url, config.anonKey);
    const { data, error } = await supabase.auth.getSession();
    if (error) return { ok: false, reason: 'signed-out' };
    token = data.session?.access_token;
  } catch {
    return { ok: false, reason: 'signed-out' };
  }
  if (!token) return { ok: false, reason: 'signed-out' };

  const code = newReviewCode();
  const response = await callRpc('review_share_link_create', {
    p_code: code,
    p_long_hash: input.longHash,
    p_payload: payload,
  }, token);
  if (!response.ok) return { ok: false, reason: response.reason };
  if (response.value !== code) return { ok: false, reason: 'rejected' };
  return { ok: true, code };
}

type RpcCallResult =
  | { ok: true; value: unknown }
  | { ok: false; reason: 'disabled' | 'network' | 'signed-out' | 'rejected' };

async function callRpc(name: string, body: Record<string, unknown>, token?: string): Promise<RpcCallResult> {
  const config = getBackendConfig();
  if (!config.configured) return { ok: false, reason: 'disabled' };
  // 短链写失败要尽快返回，调用方据此告诉创作者，而不是改发长链。
  const signal = typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
    ? AbortSignal.timeout(8000)
    : undefined;
  try {
    const response = await fetch(`${config.url}/rest/v1/rpc/${name}`, {
      method: 'POST',
      ...(signal ? { signal } : {}),
      headers: {
        apikey: config.anonKey,
        // 匿名读也要带 anon JWT；只给 apikey 时 PostgREST 会按未认证处理。
        Authorization: `Bearer ${token ?? config.anonKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) return { ok: false, reason: 'signed-out' };
      return { ok: false, reason: 'rejected' };
    }
    const text = await response.text();
    if (!text) return { ok: false, reason: 'rejected' };
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false, reason: 'network' };
  }
}
