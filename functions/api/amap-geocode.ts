import { amapKeyFromEnv, type AmapServerEnv } from './amap-env';

type Context = { request: Request; env: AmapServerEnv };

/**
 * 生产同源地点搜索：GET /api/amap-geocode?keywords=
 * 只回中心经纬度，Key 不进响应。旧地图场地没有圈画点列时，用场地名补卫星图。
 */
export async function handleAmapGeocode(request: Request, env: AmapServerEnv, fetchImpl: typeof fetch = fetch): Promise<Response> {
  const keywords = new URL(request.url).searchParams.get('keywords')?.trim() ?? '';
  if (keywords.length < 2 || keywords.length > 80) return new Response('keywords invalid', { status: 400 });
  const key = amapKeyFromEnv(env);
  if (!key) return new Response('amap key missing', { status: 503 });
  const upstream = new URL('https://restapi.amap.com/v3/place/text');
  upstream.searchParams.set('keywords', keywords);
  upstream.searchParams.set('offset', '1');
  upstream.searchParams.set('page', '1');
  upstream.searchParams.set('key', key);
  try {
    const response = await fetchImpl(upstream, { signal: AbortSignal.timeout(8000) });
    if (!response.ok) return new Response('geocode HTTP ' + response.status, { status: 502 });
    const body = await response.json() as { pois?: { location?: string }[] };
    const location = body.pois?.[0]?.location ?? '';
    const [lngRaw, latRaw] = location.split(',');
    const lng = Number(lngRaw);
    const lat = Number(latRaw);
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) return new Response('no place', { status: 404 });
    return new Response(JSON.stringify({ lng, lat }), {
      status: 200,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'private, max-age=600' },
    });
  } catch {
    return new Response('geocode failed', { status: 502 });
  }
}

export const onRequestGet = (context: Context): Promise<Response> => handleAmapGeocode(context.request, context.env);
