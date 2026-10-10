import libraryAssetIds from '../../../../assets/library/asset-ids.json';
import { isGlbUrl } from './glb-url';

/** Unified, lazily loaded catalogue: Chinese labels with original names for search. */

/** Item dimensions are clamped to the envelope the workspace's own numeric inputs accept. */
const MIN_DIMENSION = 0.02;
const MAX_DIMENSION = 50;

export interface OnlineModel {
  slug: string;
  assetId?: string;
  name: string;
  originalName?: string;
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
  seating: '座椅沙发', tables: '桌台柜台', exhibition: '摊位展陈', stage: '舞台设施',
  audio: '音响乐器', lighting: '灯光照明', signage: '标识导视', people: '人物角色',
  storage: '收纳容器', logistics: '后勤设施', tools: '工具设备', sports: '运动器材',
  plants: '绿植景观', structure: '建筑结构', digital: '数码设备', decor: '装饰陈设',
  food: '餐饮用品', vehicles: '交通载具', scenes: '完整场景',
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
    if (!slug || !name || seen.has(slug) || !isGlbUrl(glb) || toText(record.blockedReason)) continue;
    const width = toDimension(record.width);
    const depth = toDimension(record.depth);
    const height = toDimension(record.height);
    if (width === null || depth === null || height === null) continue;
    seen.add(slug);
    models.push({
      slug,
      ...((libraryAssetIds as Record<string,string>)[glb] ? { assetId: (libraryAssetIds as Record<string,string>)[glb] } : {}),
      name,
      ...(toText(record.originalName) ? { originalName: toText(record.originalName) } : {}),
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
    const text = [model.name, model.originalName, model.subcategory, onlineBucketLabel(model.bucket), model.slug].join(' ').toLowerCase();
    return needle.split(/\s+/).every(word => text.includes(word));
  });
}

/** `1.2 MB` / `72 KB`; the catalogue only quotes real byte counts, never a placeholder. */
export function formatModelBytes(bytes: number): string {
  if (bytes <= 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * The catalogue serves a thumbnail beside every GLB (`…/v1/thumb.webp` next to
 * `…/v1/model.glb`), so a placed item can show its real picture without carrying an
 * extra field the save schema would have to whitelist. Anything that is not a catalogue
 * `model.glb` returns an empty string, and the caller falls back to the vector glyph.
 */
export function onlineModelThumb(glbUrl: string | undefined, assetId?: string): string {
  if (assetId) {
    const entries = Object.entries(libraryAssetIds).filter(([,id]) => id === assetId);
    glbUrl = entries.find(([url]) => url.startsWith('/showcase/'))?.[0] ?? entries[0]?.[0] ?? glbUrl;
  }
  if (glbUrl?.startsWith('/showcase/assets/library/model/') && glbUrl.endsWith('.glb')) {
    return glbUrl.replace('/model/', '/thumb/').replace(/\.glb$/, '.webp');
  }
  if (!glbUrl || !/\/model\.glb$/.test(glbUrl)) return '';
  return glbUrl.replace(/\/model\.glb$/, '/thumb.webp');
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
  pending ??= import('../../../../assets/library/merged.json')
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
