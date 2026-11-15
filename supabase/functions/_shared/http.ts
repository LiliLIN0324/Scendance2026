import { ApiError } from './domain.ts';

export type Fetcher = typeof fetch;
export type Env = (key: string) => string | undefined;

/**
 * Categorical upstream quota/balance signals. Only explicit balance/quota phrases
 * match; transient 4xx/5xx, rate limits and vague wording stay generic so a
 * momentary failure is never mislabeled as the account being out of quota.
 * The upstream body is matched server-side only and is never returned to the client.
 */
const QUOTA_PATTERNS=[
  'insufficient_quota','insufficient_credits','insufficient credits','insufficient balance','balance insufficient',
  'out of credit','out of credits','quota exceeded','quota exhausted','no credits',
  '余额不足','余额已耗尽','账户余额不足','欠费','额度不足',
];
export function isUpstreamQuotaExhausted(status:number, bodyText:string):boolean {
  if(status===402)return true;
  const text=bodyText.toLowerCase();
  return QUOTA_PATTERNS.some(pattern=>text.includes(pattern));
}
export function required(env: Env, key: string) {
  const value = env(key);
  if (!value) throw new ApiError('SERVICE_NOT_CONFIGURED', 503, { setting: key });
  return value;
}
export function reserveCost(env: Env, key: string) {
  const value = Number(env(key));
  if (!Number.isSafeInteger(value) || value <= 0) throw new ApiError('BILLING_NOT_CONFIGURED', 503, { setting: key });
  return value;
}
export async function readBounded(response: Response | Request, max: number): Promise<Uint8Array> {
  if (Number(response.headers.get('content-length')) > max) throw new ApiError('FILE_TOO_LARGE', 413);
  const reader = response.body?.getReader();
  if (!reader) throw new ApiError('EMPTY_BODY', 400);
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > max) throw new ApiError('FILE_TOO_LARGE', 413);
      chunks.push(value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}
export async function fetchJson(url: string, init: RequestInit, fetcher: Fetcher = fetch, max = 2_000_000, timeoutMs=25_000): Promise<unknown> {
  const timeout=AbortSignal.timeout(timeoutMs);
  const response = await fetcher(url, { ...init, signal: init.signal ? AbortSignal.any([init.signal,timeout]) : timeout, redirect: 'error' });
  if (!response.ok) {
    let upstream = '';
    try { upstream = new TextDecoder().decode(await readBounded(response, 2_048)); } catch { /* body optional */ }
    // Quota/balance exhaustion is a distinct category from a transient HTTP blip.
    // Pass only the bounded status; the upstream body is not forwarded to the client.
    if (isUpstreamQuotaExhausted(response.status, upstream)) throw new ApiError('PROVIDER_QUOTA_EXHAUSTED', 402, { status: response.status });
    throw new ApiError('PROVIDER_HTTP_ERROR', 502, { status: response.status, upstream: upstream.slice(0, 600) });
  }
  try { return JSON.parse(new TextDecoder().decode(await readBounded(response, max))); }
  catch (e) { if (e instanceof ApiError || (e instanceof Error && ['AbortError','TimeoutError'].includes(e.name))) throw e; throw new ApiError('PROVIDER_INVALID_JSON', 502); }
}
export function allowedDownload(url: string, hosts: string[]) {
  let parsed: URL;
  try { parsed = new URL(url); } catch { throw new ApiError('UNTRUSTED_ASSET_URL', 502); }
  if (parsed.protocol !== 'https:' || parsed.port || parsed.username || parsed.password || !hosts.some(host => host.startsWith('.') ? parsed.hostname.endsWith(host) : parsed.hostname === host)) throw new ApiError('UNTRUSTED_ASSET_URL', 502);
  return parsed.toString();
}
export async function download(url: string, hosts: string[], max: number, fetcher: Fetcher = fetch) {
  const response = await fetcher(allowedDownload(url, hosts), { signal: AbortSignal.timeout(25_000), redirect: 'error' });
  if (!response.ok) { await response.body?.cancel(); throw new ApiError('ASSET_DOWNLOAD_FAILED', 502); }
  return readBounded(response, max);
}
