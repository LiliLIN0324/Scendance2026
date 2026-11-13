import { isPersistablePlaceShape, normalizeShapeName } from './place-shape';

export interface PlaceStockEnv {
  SUPABASE_URL?: string;
  NEXT_PUBLIC_SUPABASE_URL?: string;
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?: string;
  NEXT_PUBLIC_SUPABASE_ANON_KEY?: string;
}

/** 只读轮廓库存提示。公开 key 即可，无 service_role；没有配置就返回空 hints。 */
export async function handlePlaceShapeHints(request: Request, env: PlaceStockEnv, fetchImpl: typeof fetch = fetch): Promise<Response> {
  const params = new URL(request.url).searchParams;
  // PostgREST 的 or 过滤器是原始语法；只允许名字字符，不让标点注入过滤表达式。
  const tokens = [params.get('q') ?? '', ...(params.get('names') ?? '').split(',')]
    .map(value => normalizeShapeName(value.split('|')[0] ?? '').replace(/[^\p{L}\p{N}]/gu, '').slice(0, 60))
    .filter(value => value.length >= 2)
    .filter((value, index, all) => all.indexOf(value) === index).slice(0, 12);
  const key = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const db = (env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL || 'https://wkhfvnzgopjdzxlmycks.supabase.co').replace(/\/$/, '');
  const reply = (hints: unknown[]) => new Response(JSON.stringify({ hints }), {
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
  if (!key || !tokens.length) return reply([]);
  try {
    const query = new URLSearchParams({
      or: `(${tokens.map(value => `name_norm.ilike.*${value}*`).join(',')})`,
      select: 'name,name_norm,kind,polygon', limit: '12',
    });
    const res = await fetchImpl(`${db}/rest/v1/place_shapes?${query}`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return reply([]);
    const rows = await res.json() as unknown;
    const hints = (Array.isArray(rows) ? rows : []).filter(isPersistablePlaceShape).map(row => ({
      name: String(row.name ?? ''), nameNorm: String(row.name_norm ?? normalizeShapeName(row.name ?? '')),
      kind: 'area', pts: row.polygon.length,
    }));
    return reply(hints);
  } catch { return reply([]); }
}

export const onRequestGet = (context: { request: Request; env: PlaceStockEnv }): Promise<Response> => handlePlaceShapeHints(context.request, context.env);
