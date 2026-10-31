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
  const stitched = await stitchSatelliteTiles(point.lng, point.lat, zoom, fetchImpl);
  if (stitched) return imageResponse(stitched.bytes, stitched.type);
  const key = amapKeyFromEnv(env);
  if (key) {
    const requested = url.searchParams.get('size') ?? '';
    const size = /^\d{2,4}\*\d{2,4}$/.test(requested) ? requested : '768*768';
    const official = new URL('https://restapi.amap.com/v3/staticmap');
    official.searchParams.set('location', `${point.lng},${point.lat}`);
    official.searchParams.set('zoom', String(zoom));
    official.searchParams.set('size', size);
    official.searchParams.set('scale', '2');
    official.searchParams.set('maptype', 'satellite');
    official.searchParams.set('key', key);
    try {
      const response = await fetchImpl(official, { signal: AbortSignal.timeout(10000) });
      const type = response.headers.get('content-type') ?? '';
      if (response.ok && type.toLowerCase().startsWith('image/')) {
        const bytes = await response.arrayBuffer();
        // 官方图经常只有一张小矢量；太小就改用瓦片，避免把「无卫星图」占位当底图。
        if (bytes.byteLength > 20000) return imageResponse(bytes, type.split(';')[0] || 'image/jpeg');
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

/** 3×3 瓦片 = 768px。没有 OffscreenCanvas 的运行时返回 null，调用方再退回单张 256 瓦片。 */
export async function stitchSatelliteTiles(
  lng: number,
  lat: number,
  zoom: number,
  fetchImpl: typeof fetch,
): Promise<{ bytes: ArrayBuffer; type: string } | null> {
  try {
  if (typeof OffscreenCanvas === 'undefined' || typeof createImageBitmap === 'undefined') return null;
  const n = 2 ** zoom;
  const x = Math.floor(((lng + 180) / 360) * n);
  const latRad = (lat * Math.PI) / 180;
  const y = Math.floor((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * n);
  const span = 1;
  const tileSize = 256;
  const canvas = new OffscreenCanvas((span * 2 + 1) * tileSize, (span * 2 + 1) * tileSize);
  const context = canvas.getContext('2d');
  if (!context) return null;
  const jobs: { dx: number; dy: number; tileUrl: string }[] = [];
  for (let dy = -span; dy <= span; dy++) {
    for (let dx = -span; dx <= span; dx++) {
      const tx = x + dx;
      const ty = y + dy;
      if (tx < 0 || ty < 0 || tx >= n || ty >= n) continue;
      const host = 1 + ((tx + ty) % 4);
      jobs.push({ dx, dy, tileUrl: `https://webst0${host}.is.autonavi.com/appmaptile?style=6&x=${tx}&y=${ty}&z=${zoom}` });
    }
  }
  if (jobs.length < 9) return null;
  const bitmaps = await Promise.all(jobs.map(async job => {
    const response = await fetchImpl(job.tileUrl, { signal: AbortSignal.timeout(10000) });
    if (!response.ok) return null;
    const bitmap = await createImageBitmap(await response.blob());
    return { ...job, bitmap };
  }));
  if (bitmaps.some(tile => !tile)) return null;
  for (const tile of bitmaps) {
    if (!tile) continue;
    context.drawImage(tile.bitmap, (tile.dx + span) * tileSize, (tile.dy + span) * tileSize);
    tile.bitmap.close();
  }
  const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.86 });
  return { bytes: await blob.arrayBuffer(), type: 'image/jpeg' };
  } catch {
    return null;
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
