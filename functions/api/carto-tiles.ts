import {
  CARTO_WATERMARK_SHA256,
  cartoKeyFromEnv,
  cartoTileUrl,
  isCartoTileStyle,
  isCartoWatermark,
  parseCartoTileCoord,
} from './carto-env.ts';
import type { CartoServerEnv, CartoWatermarkHashes } from './carto-env.ts';

type Context = { request: Request; env: CartoServerEnv };

/** 上游拉不到真瓦片时给一块灰底占位：画布仍有网格可看，也不会把 Carto 水印图当成底图。 */
const PLACEHOLDER_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" fill="#EEF1F4"/></svg>';

/**
 * Carto 瓦片代理：GET /api/carto-tiles?style=light&z=15&x=27315&y=13489
 * - style 白名单 light / dark；z 0–21，x/y 按 2^z 校验。
 * - key 从 Pages 运行时环境变量 CARTO_KEY 读（兼容旧名 NEXT_PUBLIC_CARTO_KEY），
 *   上游 URL 不出服务端，响应里没有 key。
 * - 上游失败 / 空瓦片 / 水印图（key 失效）一律回 200 占位 SVG + `X-Carto-Fallback`：
 *   画布不闪断，但绝不把「API KEY REQUIRED」水印当成地图。缺 key 时明确 503。
 */
export async function handleCartoTiles(
  request: Request,
  env: CartoServerEnv,
  fetchImpl: typeof fetch = fetch,
  watermarkHashes: CartoWatermarkHashes = CARTO_WATERMARK_SHA256,
): Promise<Response> {
  const params = new URL(request.url).searchParams;
  const style = params.get('style');
  if (!isCartoTileStyle(style)) return new Response('style invalid', { status: 400 });
  const coord = parseCartoTileCoord(params.get('z'), params.get('x'), params.get('y'));
  if (!coord) return new Response('coords invalid', { status: 400 });

  const key = cartoKeyFromEnv(env);
  if (!key) {
    return new Response('CARTO_KEY missing', {
      status: 503,
      headers: { 'X-Carto-Fallback': 'nokey', 'Cache-Control': 'no-store' },
    });
  }

  let upstream: Response;
  try {
    upstream = await fetchImpl(cartoTileUrl(style, coord.z, coord.x, coord.y, key), {
      signal: AbortSignal.timeout(8000),
      headers: { 'User-Agent': 'ScendancePages/4.14.0' },
    });
  } catch {
    return placeholder('upstream-error');
  }
  if (!upstream.ok) return placeholder(`upstream-${upstream.status}`);

  const bytes = await upstream.arrayBuffer();
  if (bytes.byteLength < 100) return placeholder('upstream-empty');
  if (await isCartoWatermark(bytes, style, watermarkHashes)) return placeholder('invalid-key');

  const type = (upstream.headers.get('content-type') ?? '').toLowerCase();
  const contentType = type.startsWith('image/') ? type.split(';')[0] || 'image/png' : 'image/png';
  return new Response(bytes, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=86400',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

function placeholder(reason: string): Response {
  return new Response(PLACEHOLDER_SVG, {
    status: 200,
    headers: {
      'Content-Type': 'image/svg+xml',
      'Cache-Control': 'no-store',
      'X-Carto-Fallback': reason,
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

export const onRequestGet = (context: Context): Promise<Response> => handleCartoTiles(context.request, context.env);
