/**
 * 地点搜索下拉的合成与排序。
 *
 * 用户要求「优先是有轮廓的」：已有可信占地轮廓的 POI（库存 / 本地缓存）排在最前，
 * 其次是天地图行政区选区（本身带边界），最后才是仅有定位钉的 POI。
 * 3 点 kind:line 等垃圾几何不算「有轮廓」。
 */
import { mergePlaceSuggestions, usesLocalPlaceProxy, type PlaceSuggestion } from './place-search';
import type { PlaceArea } from './place-area';
import { isOutlineHint, namesReferToSamePlace, normalizeOutlineName } from './place-shape-quality';

export type PlaceSearchOption =
  | { kind: 'area'; area: PlaceArea }
  /**
   * `fromHistory`：这条来自「最近选过」而不是本次检索（2026-11-28 用户指令）。
   * 历史条目不占编号、不铺编号钉——编号只属于本次检索的候选，
   * 否则「第 1 条」到底是历史还是结果，会和地图上的 1/2/3 钉对不上。
   */
  | { kind: 'place'; place: PlaceSuggestion; hasOutline?: boolean; fromHistory?: boolean };

export interface PlaceShapeHint {
  name: string;
  nameNorm?: string | undefined;
  kind?: 'area' | 'line' | string;
  pts?: number | undefined;
}

/** 从库存 hint 抽出已规范化的「有轮廓」名字集合。 */
export function hintedOutlineNames(hints: readonly PlaceShapeHint[]): Set<string> {
  const out = new Set<string>();
  for (const hint of hints) {
    if (!isOutlineHint(hint)) continue;
    const fromName = normalizeOutlineName(hint.name ?? '');
    const fromNorm = normalizeOutlineName(hint.nameNorm ?? '');
    if (fromName) out.add(fromName);
    if (fromNorm && namesReferToSamePlace(fromName, fromNorm)) out.add(fromNorm);
  }
  return out;
}

export function placeHasOutline(placeName: string, outlinedNames: ReadonlySet<string>): boolean {
  const name = normalizeOutlineName(placeName.split('|')[0] ?? '');
  if (!name) return false;
  if (outlinedNames.has(name)) return true;
  for (const hint of outlinedNames) {
    if (namesReferToSamePlace(name, hint)) return true;
  }
  return false;
}

/**
 * 合成建议列表：有轮廓的 POI → 行政区选区 → 其余 POI。
 * 组内保持 mergePlaceSuggestions / 服务端原序。
 */
export function buildPlaceSearchOptions(input: {
  query: string;
  areas: readonly PlaceArea[];
  places: readonly PlaceSuggestion[];
  recent: readonly PlaceSuggestion[];
  outlinedNames: ReadonlySet<string>;
}): PlaceSearchOption[] {
  const query = input.query.trim();
  const merged = mergePlaceSuggestions(query, input.recent, input.places);
  // 历史行判定：在「最近」里、且不是本次检索回来的结果。同一个地点两边都有时算结果（带号）。
  const recentIds = new Set(input.recent.map(place => place.id));
  const hitIds = new Set(input.places.map(place => place.id));
  const outlinedPlaces: PlaceSearchOption[] = [];
  const otherPlaces: PlaceSearchOption[] = [];
  for (const place of merged) {
    const hasOutline = placeHasOutline(place.name, input.outlinedNames);
    const fromHistory = recentIds.has(place.id) && !hitIds.has(place.id);
    const option: PlaceSearchOption = { kind: 'place', place, hasOutline, fromHistory };
    if (hasOutline) outlinedPlaces.push(option);
    else otherPlaces.push(option);
  }
  const areas: PlaceSearchOption[] = input.areas.map(area => ({ kind: 'area', area }));
  return [...outlinedPlaces, ...areas, ...otherPlaces];
}

export function parseShapeHints(body: unknown): PlaceShapeHint[] {
  const raw = (body as { hints?: unknown } | null)?.hints;
  if (!Array.isArray(raw)) return [];
  const hints: PlaceShapeHint[] = [];
  for (const entry of raw) {
    const item = entry as Partial<PlaceShapeHint> | null;
    const name = String(item?.name ?? '').trim();
    if (!name) continue;
    const pts = item?.pts == null ? undefined : Number(item.pts);
    hints.push({
      name,
      nameNorm: String(item?.nameNorm ?? '').trim() || undefined,
      kind: item?.kind === 'line' ? 'line' : 'area',
      pts: pts != null && Number.isFinite(pts) ? pts : undefined,
    });
  }
  return hints;
}

export function placeShapeHintsUrl(
  query: string,
  names: readonly string[] = [],
  local = usesLocalPlaceProxy(),
): string {
  const params = new URLSearchParams();
  const q = query.trim();
  if (q) params.set('q', q);
  const list = names.map(name => name.trim()).filter(name => name.length >= 2).slice(0, 12);
  if (list.length) params.set('names', list.join(','));
  const qs = params.toString();
  return local ? `http://127.0.0.1:3199/api/place-shape-hints?${qs}` : `/api/place-shape-hints?${qs}`;
}

/** 库存提示检索；失败一律空数组（排序退回缓存 / 原序，不弹错）。 */
export async function fetchPlaceShapeHints(
  query: string,
  options: { names?: readonly string[]; local?: boolean; signal?: AbortSignal; fetchImpl?: typeof fetch } = {},
): Promise<PlaceShapeHint[]> {
  const q = query.trim();
  const names = options.names ?? [];
  if (q.length < 2 && names.length === 0) return [];
  const doFetch = options.fetchImpl ?? fetch;
  try {
    const response = await doFetch(placeShapeHintsUrl(q, names, options.local ?? usesLocalPlaceProxy()), {
      signal: options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(4000)]) : AbortSignal.timeout(4000),
    });
    if (!response.ok) return [];
    return parseShapeHints(await response.json());
  } catch {
    return [];
  }
}
