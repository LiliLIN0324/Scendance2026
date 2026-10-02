import { isGlbUrl } from './glb-url';

/**
 * The online model library (#online-models): the curated catalogue that also backs
 * `assets/library/online.json`, browsable from the workspace's 物料库 panel.
 *
 * The index ships inside the repository instead of being fetched, because browsing
 * must not depend on a live endpoint. Only the thumbnails and GLB files come from the
 * CDN. The JSON is ~110 KB, so it is imported lazily — sessions that never open the
 * source switch never pay for it.
 */

/** Item dimensions are clamped to the envelope the workspace's own numeric inputs accept. */
const MIN_DIMENSION = 0.02;
const MAX_DIMENSION = 50;

export interface OnlineModel {
  slug: string;
  name: string;
  /** Coarse family from the catalogue (`structure`, `seating`, …); drives the rail. */
  bucket: string;
  subcategory: string;
  width: number;
  depth: number;
  height: number;
  bytes: number;
  triangles: number;
  downloads: number;
  /** Empty when the catalogue row's thumbnail is missing or not a usable URL. */
  thumb: string;
  glb: string;
  page: string;
}

/**
 * Bucket labels are a lookup rather than a closed union: a new family in the catalogue
 * should appear in the rail on its own, falling back to its raw key.
 */
export const ONLINE_BUCKET_LABELS: Readonly<Record<string, string>> = {
  structure: '结构',
  stage: '舞台',
  lighting: '灯光',
  seating: '座椅',
  tables: '桌台',
  decor: '装饰',
  plants: '绿植',
  exhibition: '展陈',
  logistics: '后勤',
  digital: '数码',
  food: '餐饮',
  sports: '运动',
  vehicles: '车辆',
};

export function onlineBucketLabel(bucket: string): string {
  return ONLINE_BUCKET_LABELS[bucket] ?? (bucket || '其他');
}

export interface OnlineBucket {
  key: string;
  label: string;
  count: number;
}

export interface OnlineModelIndex {
  models: readonly OnlineModel[];
  buckets: readonly OnlineBucket[];
}

function toText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function toDimension(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
  return Math.min(MAX_DIMENSION, Math.max(MIN_DIMENSION, Math.round(value * 1000) / 1000));
}

function toCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
}

/** Thumbnails are CDN absolute or repository-relative; anything else is dropped. */
function toImageUrl(value: unknown): string {
  const text = toText(value);
  if (!text) return '';
  if (text.startsWith('https://') || text.startsWith('/')) return text;
  return '';
}

/**
 * The catalogue ships as a `{ modelCount, models }` wrapper, but a bare array is just as
 * valid an import result. Accepting both keeps the loader from silently yielding nothing.
 */
function catalogueRows(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === 'object') {
    const models = (raw as { models?: unknown }).models;
    if (Array.isArray(models)) return models;
  }
  return [];
}

/**
 * Narrows the raw catalogue to models the workspace can actually place. A malformed
 * row costs one tile rather than breaking the panel, and duplicates are dropped so a
 * repeated slug cannot both appear in the grid and collide on the scene's asset key.
 */
export function normalizeOnlineModels(raw: unknown): OnlineModel[] {
  const rows = catalogueRows(raw);
  const seen = new Set<string>();
  const models: OnlineModel[] = [];
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const record = row as Record<string, unknown>;
    const slug = toText(record.slug);
    const name = toText(record.name);
    const glb = toText(record.glb);
    if (!slug || !name || seen.has(slug) || !isGlbUrl(glb)) continue;
    const width = toDimension(record.width);
    const depth = toDimension(record.depth);
    const height = toDimension(record.height);
    if (width === null || depth === null || height === null) continue;
    seen.add(slug);
    models.push({
      slug,
      name,
      glb,
      bucket: toText(record.bucket),
      subcategory: toText(record.subcategory),
      width,
      depth,
      height,
      bytes: toCount(record.bytes),
      triangles: toCount(record.triangles),
      downloads: toCount(record.downloads),
      thumb: toImageUrl(record.thumb),
      page: toText(record.page),
    });
  }
  return models;
}

/** Buckets, busiest first, so the most useful families sit closest to 全部. */
export function buildOnlineModelIndex(models: readonly OnlineModel[]): OnlineModelIndex {
  const counts = new Map<string, number>();
  for (const model of models) {
    if (!model.bucket) continue;
    counts.set(model.bucket, (counts.get(model.bucket) ?? 0) + 1);
  }
  return {
    models,
    buckets: [...counts]
      .map(([key, count]) => ({ key, label: onlineBucketLabel(key), count }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'zh-Hans-CN')),
  };
}

/**
 * Free-text and bucket filter, kept out of the component so the panel stays markup-only.
 * Matching the subcategory and slug as well as the name makes Chinese subcategory words
 * and pasted CDN slugs both searchable.
 */
export function filterOnlineModels(
  models: readonly OnlineModel[],
  query: string,
  bucket: string
): OnlineModel[] {
  const needle = query.trim().toLowerCase();
  return models.filter(model => {
    if (bucket && model.bucket !== bucket) return false;
    if (!needle) return true;
    return model.name.toLowerCase().includes(needle)
      || model.subcategory.toLowerCase().includes(needle)
      || model.slug.includes(needle);
  });
}

/** `1.2 MB` / `72 KB`; the catalogue only quotes real byte counts, never a placeholder. */
export function formatModelBytes(bytes: number): string {
  if (bytes <= 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

let pending: Promise<OnlineModelIndex> | null = null;

/** Test seam: mirrors `clearGlbAssetCache` so a spec can exercise a fresh load. */
export function clearOnlineModelCache(): void {
  pending = null;
}

/**
 * Loads and indexes the shipped catalogue once per session. A failed import clears the
 * cache so the panel's retry button performs a real retry rather than replaying the
 * same rejection.
 */
export function loadOnlineModels(): Promise<OnlineModelIndex> {
  pending ??= import('../../../../assets/library/online.json')
    .then(module => {
      const namespace = module as { default?: unknown };
      return buildOnlineModelIndex(normalizeOnlineModels(namespace.default ?? namespace));
    })
    .catch((error: unknown) => {
      pending = null;
      throw error;
    });
  return pending;
}
