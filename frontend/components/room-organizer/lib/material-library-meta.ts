/**
 * 物料卡上的收藏和自建标签。分类（舞台、空间…）仍来自目录；
 * 这里只记用户后来加上的，存在本机，之后可以换成账户里的物料字段。
 */

export interface MaterialLibraryMeta {
  favorites: string[];
  customTags: string[];
  /** 物料 slug 或资产号 → 挂上的自建标签。 */
  assignments: Record<string, string[]>;
}

export const MATERIAL_LIBRARY_META_KEY = 'scendance:material-library-meta';

const TAG_MAX = 16;
const TAG_LIMIT = 24;

export function emptyMaterialLibraryMeta(): MaterialLibraryMeta {
  return { favorites: [], customTags: [], assignments: {} };
}

function cleanTag(value: string): string {
  return value.trim().replace(/\s+/g, ' ').slice(0, TAG_MAX);
}

function stringList(value: unknown, limit: number): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const next: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const text = cleanTag(item);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    next.push(text);
    if (next.length >= limit) break;
  }
  return next;
}

export function parseMaterialLibraryMeta(raw: string | null): MaterialLibraryMeta {
  if (!raw) return emptyMaterialLibraryMeta();
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return emptyMaterialLibraryMeta();
    const row = parsed as { favorites?: unknown; customTags?: unknown; assignments?: unknown };
    const customTags = stringList(row.customTags, TAG_LIMIT);
    const allowed = new Set(customTags);
    const assignments: Record<string, string[]> = {};
    if (row.assignments && typeof row.assignments === 'object') {
      for (const [id, tags] of Object.entries(row.assignments as Record<string, unknown>)) {
        if (!id || id.length > 160) continue;
        const kept = stringList(tags, 8).filter(tag => allowed.has(tag));
        if (kept.length) assignments[id] = kept;
      }
    }
    return { favorites: stringList(row.favorites, 400), customTags, assignments };
  } catch {
    return emptyMaterialLibraryMeta();
  }
}

export function loadMaterialLibraryMeta(storage: Pick<Storage, 'getItem'> | null): MaterialLibraryMeta {
  if (!storage) return emptyMaterialLibraryMeta();
  try {
    return parseMaterialLibraryMeta(storage.getItem(MATERIAL_LIBRARY_META_KEY));
  } catch {
    return emptyMaterialLibraryMeta();
  }
}

export function saveMaterialLibraryMeta(storage: Pick<Storage, 'setItem'> | null, meta: MaterialLibraryMeta): void {
  if (!storage) return;
  try {
    storage.setItem(MATERIAL_LIBRARY_META_KEY, JSON.stringify(meta));
  } catch {
    /* 隐私模式写不进就只留在这一页。 */
  }
}

export function toggleFavorite(meta: MaterialLibraryMeta, id: string): MaterialLibraryMeta {
  if (!id) return meta;
  const favorites = meta.favorites.includes(id)
    ? meta.favorites.filter(item => item !== id)
    : [...meta.favorites, id].slice(-400);
  return { ...meta, favorites };
}

/** 目录里已有的分类名不能再当成一条新标签。 */
export function addCustomTag(meta: MaterialLibraryMeta, name: string, reserved: readonly string[] = []): { meta: MaterialLibraryMeta; tag: string | null; error: string } {
  const tag = cleanTag(name);
  if (!tag) return { meta, tag: null, error: '标签不能是空的。' };
  if (reserved.includes(tag) || meta.customTags.includes(tag) || tag === '全部' || tag === '收藏' || tag === '生成') {
    return { meta, tag: null, error: '这个标签已经有了。' };
  }
  if (meta.customTags.length >= TAG_LIMIT) return { meta, tag: null, error: '自建标签已满。' };
  return { meta: { ...meta, customTags: [...meta.customTags, tag] }, tag, error: '' };
}

export function toggleAssignment(meta: MaterialLibraryMeta, id: string, tag: string): MaterialLibraryMeta {
  if (!id || !meta.customTags.includes(tag)) return meta;
  const current = meta.assignments[id] ?? [];
  const next = current.includes(tag) ? current.filter(item => item !== tag) : [...current, tag];
  const assignments = { ...meta.assignments };
  if (next.length) assignments[id] = next;
  else delete assignments[id];
  return { ...meta, assignments };
}
