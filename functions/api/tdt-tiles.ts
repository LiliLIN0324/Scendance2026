import { isTdtTileLayer, parseTileCoord, tdtKeyFromEnv, tdtTileUrl, type TdtServerEnv } from './tdt-env';

type Context = { request: Request; env: TdtServerEnv };

/** 上游拉不到瓦片时给一块灰底占位，画布仍有网格可看、不闪断。 */
const PLACEHOLDER_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#EEF1F4"/></svg>';

/**
 * 天地图瓦片代理：GET /api/tdt-tiles?layer=vec_w&z=12&x=3372&y=1690
 * - 图层白名单 vec_w / cva_w / img_w / cia_w（同后缀配对，w=EPSG:3857）。
 * - key 只留在 Pages 环境变量；上游 URL 不出服务端，响应里也没有 tk。
 * - 每瓦片两台主机各试一次（8s 超时），仍失败回占位 SVG（X-Tdt-Fallback 头可判）。
 */
export async function handleTdtTiles(request: Request, env: TdtServerEnv, fetchImpl: typeof fetch = fetch): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const layer = params.get('layer');
  if (!isTdtTileLayer(layer)) return new Response('layer invalid', { status: 400 });
  const coord = parseTileCoord(params.get('z'), params.get('x'), params.get('y'));
  if (!coord) return new Response('coords invalid', { status: 400 });
  const key = tdtKeyFromEnv(env);
  if (!key) return new Response('TDT_KEY missing', { status: 503 });
  for (let attempt = 0; attempt < 2; attempt++) {
    const host = (coord.x + coord.y + attempt) % 8;
    try {
      const upstream = await fetchImpl(tdtTileUrl(layer, coord.z, coord.x, coord.y, key, host), {
        signal: AbortSignal.timeout(8000),
        headers: { 'User-Agent': 'ScendancePages/2.2.0' },
      });
      if (!upstream.ok) continue;
      const bytes = await upstream.arrayBuffer();
      if (bytes.byteLength < 100) continue;
      const type = upstream.headers.get('content-type') ?? '';
      const contentType = type.toLowerCase().startsWith('image/') ? type.split(';')[0] || 'image/png' : 'image/png';
      return new Response(bytes, {
        status: 200,
        headers: {
          'Content-Type': contentType,
          'Cache-Control': 'public, max-age=86400',
          'X-Content-Type-Options': 'nosniff',
        },
      });
    } catch {
      // 超时/网络错：换一台主机再试一次。
    }
  }
  return placeholderResponse();
}

function placeholderResponse(): Response {
  return new Response(PLACEHOLDER_SVG, {
    status: 200,
    headers: {
      'Content-Type': 'image/svg+xml',
      'Cache-Control': 'no-store',
      'X-Tdt-Fallback': 'placeholder',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

export const onRequestGet = (context: Context): Promise<Response> => handleTdtTiles(context.request, context.env);
