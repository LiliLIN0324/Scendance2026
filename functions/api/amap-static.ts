import { amapKeyFromEnv, clampZoom, parseLocation, satelliteTileUrl, type AmapServerEnv } from './amap-env';

type Context = { request: Request; env: AmapServerEnv };

/**
 * 生产同源卫星图：GET /api/amap-static?location=lng,lat&zoom=&x-ref=satellite-ground-ref
 * Key 只留在 Pages 环境变量。有 Key 时先试官方静态图，不行就回 style=6 卫星瓦片。
 * 本机开发不走这里，浏览器直接打 127.0.0.1:3199。
 */
export async function handleAmapStatic(request: Request, env: AmapServerEnv, fetchImpl: typeof fetch = fetch): Promise<Response> {
  const url = new URL(request.url);
  const point = parseLocation(url.searchParams.get('location'));
  if (!point) return new Response('location invalid', { status: 400 });
  if (url.searchParams.get('x-ref') !== 'satellite-ground-ref') return new Response('ref invalid', { status: 400 });
  const zoom = clampZoom(url.searchParams.get('zoom'));
  const key = amapKeyFromEnv(env);
  if (key) {
    const official = new URL('https://restapi.amap.com/v3/staticmap');
    official.searchParams.set('location', `${point.lng},${point.lat}`);
    official.searchParams.set('zoom', String(zoom));
    official.searchParams.set('size', '512*512');
    official.searchParams.set('scale', '2');
    official.searchParams.set('maptype', 'satellite');
    official.searchParams.set('key', key);
    try {
      const response = await fetchImpl(official, { signal: AbortSignal.timeout(10000) });
      const type = response.headers.get('content-type') ?? '';
      if (response.ok && type.startsWith('image/')) {
        const bytes = await response.arrayBuffer();
        if (bytes.byteLength > 8000) return imageResponse(bytes, type.split(';')[0] || 'image/jpeg');
      }
    } catch {
      // 官方静态图失败时改走瓦片，仍然给地面一张图。
    }
  }
  try {
    const tile = await fetchImpl(satelliteTileUrl(point.lng, point.lat, zoom), {
      signal: AbortSignal.timeout(10000),
      headers: { 'User-Agent': 'ScendancePages/2.2.0' },
    });
    if (!tile.ok) return new Response('tile HTTP ' + tile.status, { status: 502 });
    const bytes = await tile.arrayBuffer();
    if (bytes.byteLength < 100) return new Response('empty tile', { status: 502 });
    return imageResponse(bytes, 'image/jpeg');
  } catch {
    return new Response('tile failed', { status: 502 });
  }
}

function imageResponse(bytes: ArrayBuffer, type: string): Response {
  return new Response(bytes, {
    status: 200,
    headers: {
      'Content-Type': type,
      'Cache-Control': 'private, max-age=600',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

export const onRequestGet = (context: Context): Promise<Response> => handleAmapStatic(context.request, context.env);
