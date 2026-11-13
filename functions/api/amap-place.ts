import { amapKeyFromEnv, parseLocation, type AmapServerEnv } from './amap-env';

type Context = { request: Request; env: AmapServerEnv };

export interface AmapPlace {
  id: string;
  name: string;
  address: string;
  lng: number;
  lat: number;
}

/** 单次 8s 超时遇上游挂起就会整段 502；改为短超时多试，总预算仍约 8s。 */
const ATTEMPTS = 3;
const ATTEMPT_TIMEOUT_MS = 2500;
const RETRY_GAP_MS = 200;
const RETRYABLE_INFOCODES = new Set(['10002', '10004', '10016', '10019', '10020', '10029', '10044']);

const wait = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

const shouldRetryHttp = (status: number): boolean => status === 429 || status >= 500;

/**
 * 生产同源地点检索：GET /api/amap-place?keywords=西湖&limit=5
 * 只回地点名、地址与经纬度，Key 不进响应。
 *
 * 与 /api/amap-geocode 的分工：geocode 只回一个中心点（补旧场地的卫星图用），
 * place 还要名字和地址——总控 chat 的调研底图卡片要给人看地名，不能只给坐标。
 */
export async function handleAmapPlace(request: Request, env: AmapServerEnv, fetchImpl: typeof fetch = fetch): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const keywords = params.get('keywords')?.trim() ?? '';
  if (keywords.length < 2 || keywords.length > 80) return new Response('keywords invalid', { status: 400 });
  const key = amapKeyFromEnv(env);
  if (!key) return new Response('amap key missing', { status: 503 });
  const limitRaw = Number(params.get('limit') ?? 5);
  const limit = Number.isInteger(limitRaw) ? Math.min(10, Math.max(1, limitRaw)) : 5;
  const upstream = new URL('https://restapi.amap.com/v3/place/text');
  upstream.searchParams.set('keywords', keywords);
  upstream.searchParams.set('offset', String(limit));
  upstream.searchParams.set('page', '1');
  upstream.searchParams.set('extensions', 'all');
  upstream.searchParams.set('key', key);
  let lastFailure = new Response('place failed', { status: 502 });
  for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
    if (attempt > 0) await wait(RETRY_GAP_MS);
    try {
      const response = await fetchImpl(upstream, { signal: AbortSignal.timeout(ATTEMPT_TIMEOUT_MS) });
      if (!response.ok) {
        lastFailure = new Response('place HTTP ' + response.status, { status: 502 });
        if (shouldRetryHttp(response.status)) continue;
        return lastFailure;
      }
      const body = await response.json() as {
        status?: string;
        infocode?: string;
        pois?: { id?: string; name?: string; address?: string[] | string; location?: string }[];
      };
      if (body.status && body.status !== '1' && body.infocode && RETRYABLE_INFOCODES.has(body.infocode)) {
        lastFailure = new Response('place failed', { status: 502 });
        continue;
      }
      const places = (body.pois ?? []).flatMap(poi => {
        const point = parseLocation(typeof poi.location === 'string' ? poi.location : null);
        if (!point) return [];
        const { lng, lat } = point;
        const address = Array.isArray(poi.address) ? poi.address.join('') : poi.address ?? '';
        return [{
          id: poi.id ?? `${lng},${lat}`,
          name: poi.name?.trim() || keywords,
          address,
          lng,
          lat,
        } satisfies AmapPlace];
      });
      if (!places.length) return new Response('no place', { status: 404 });
      return new Response(JSON.stringify({ places }), {
        status: 200,
        headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'private, max-age=600' },
      });
    } catch {
      lastFailure = new Response('place failed', { status: 502 });
    }
  }
  return lastFailure;
}

export const onRequestGet = (context: Context): Promise<Response> => handleAmapPlace(context.request, context.env);
