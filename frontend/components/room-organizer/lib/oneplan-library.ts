/**
 * OnePlan 物件库（549 件贴纸）→ 可放置物件的桥。
 *
 * 背景：`frontend/public/oneplan-icons/manifest.json` 是抓取产出的权威清单（549 条），
 * 每条带 kind / slug / 中英名 / 分类。画布上「放设施」原本只认 8 个写死模板
 * （见 `site-plan-facilities.ts` 的 `PLAN_FACILITY_TEMPLATES`），所以物件库里挑一件
 * 必须能变成合法的 `PlanFacility`：这里负责把清单条目折算成
 * 「贴纸描述 + 默认占地 + 3D 低模种类 + 设施模板」，画布只消费结果。
 *
 * 设计口径（对齐 OnePlan 的 Add Objects 面板）：
 * - 清单里的 `scale-bg` 只是占地底形，不能单独作为物件；`categories` 是分类图标，
 *   同理跳过。真正可选的是 `icon`（符号）、`scale-fg`（真实尺度线稿）、`area`（面域）。
 * - 默认占地按 3D 低模种类给（帐篷 3×3、舞台 8×6、餐车 6×2.5…），用户后续可改尺寸；
 *   这样「点一件物件 → 地图上落一个真实尺度的东西」不会出现 0 尺寸。
 * - `templateId` 带 `oneplan:` 前缀，便于与 8 个内置模板区分；3D 侧按种类映射低模。
 */

import type { PlanPropKind } from './plan-footprint-geometry';
import { planPropKind } from './plan-footprint-geometry';
import type { OneplanStickerDescriptor } from './oneplan-stickers';
import type { PlanFacilityTemplate } from './site-plan-facilities';

/** manifest.json 里我们关心的字段子集（多出来的字段原样忽略）。 */
export interface OneplanManifestAsset {
  path: string;
  kind: string;
  slug: string;
  name_zh?: string;
  name_en?: string;
  category_zh?: string;
  category_en?: string;
  pack?: string | null;
}

export interface OneplanManifest {
  assets: readonly OneplanManifestAsset[];
  counts?: Record<string, number>;
}

/** 物件库里一件可选物件。 */
export interface LibraryEntry {
  /** 稳定 id：`kind:slug`（同一 slug 在 icon / scale-fg 下是两件不同的物件）。 */
  id: string;
  slug: string;
  kind: OneplanStickerDescriptor['kind'];
  sticker: OneplanStickerDescriptor;
  /** 中文名（缺失回落到英文名，再回落 slug）。 */
  nameZh: string;
  nameEn: string;
  categoryZh: string;
  /** 默认占地（米）。 */
  width: number;
  depth: number;
  /** 3D 低模种类：帐篷 / 舞台 / 摊位 / 餐车 / 厕所 / 岗亭 / 垃圾桶 / 杂项。 */
  propKind: PlanPropKind;
}

/** `oneplan:` 前缀的 templateId 判定（画布与 3D 用它区分内置模板）。 */
export const LIBRARY_TEMPLATE_PREFIX = 'oneplan:';

export function isLibraryTemplateId(templateId: string): boolean {
  return templateId.startsWith(LIBRARY_TEMPLATE_PREFIX);
}

export function libraryTemplateId(entry: Pick<LibraryEntry, 'kind' | 'slug'>): string {
  return `${LIBRARY_TEMPLATE_PREFIX}${entry.kind}:${entry.slug}`;
}

/** 3D 低模种类对应的默认占地（米）：没有尺寸元数据的物件也要有可信尺度。 */
const PROP_SIZE: Record<PlanPropKind, { width: number; depth: number }> = {
  tent: { width: 3, depth: 3 },
  stage: { width: 8, depth: 6 },
  kiosk: { width: 2, depth: 2 },
  foodTruck: { width: 6, depth: 2.5 },
  toilet: { width: 2.4, depth: 1.2 },
  post: { width: 1.5, depth: 1.5 },
  bin: { width: 1.2, depth: 1.2 },
  misc: { width: 2, depth: 2 },
};

/** 该 slug 是否可放进物件库（`scale-bg`/`categories` 只是底形与分类图标）。 */
function libraryKind(kind: string): OneplanStickerDescriptor['kind'] | null {
  if (kind === 'icon') return 'icon';
  if (kind === 'scale-fg') return 'scale';
  if (kind === 'area') return 'area';
  return null;
}

/** 清单条目 → 物件库条目；不可选的返回 null。 */
export function libraryEntryFromAsset(asset: OneplanManifestAsset): LibraryEntry | null {
  const kind = libraryKind(asset.kind);
  if (!kind) return null;
  const slug = asset.slug.trim();
  if (!slug) return null;
  const propKind = planPropKind(slug);
  const size = PROP_SIZE[propKind];
  const nameEn = (asset.name_en ?? '').trim();
  const nameZh = (asset.name_zh ?? '').trim() || nameEn || slug;
  return {
    id: `${kind}:${slug}`,
    slug,
    kind,
    // icon 字段只用作「文件加载失败」时的 Lucide 回落，这里给中性图形。
    sticker: { kind, slug, icon: 'shapes' },
    nameZh,
    nameEn: nameEn || nameZh,
    categoryZh: (asset.category_zh ?? '').trim() || '未分类',
    width: size.width,
    depth: size.depth,
    propKind,
  };
}

/** 整份清单 → 物件库（顺序与清单一致，便于稳定渲染）。 */
export function libraryEntries(assets: readonly OneplanManifestAsset[]): LibraryEntry[] {
  const out: LibraryEntry[] = [];
  for (const asset of assets) {
    const entry = libraryEntryFromAsset(asset);
    if (entry) out.push(entry);
  }
  return out;
}

export interface LibraryGroup {
  category: string;
  items: LibraryEntry[];
}

/**
 * 按中文分类分组：面域类排最前（OnePlan 的 Areas 根），其余按件数降序。
 * 组内按中文名排序，保证面板每次渲染顺序稳定。
 */
export function groupLibraryEntries(entries: readonly LibraryEntry[]): LibraryGroup[] {
  const map = new Map<string, LibraryEntry[]>();
  for (const entry of entries) {
    const bucket = map.get(entry.categoryZh);
    if (bucket) bucket.push(entry);
    else map.set(entry.categoryZh, [entry]);
  }
  const groups: LibraryGroup[] = [];
  for (const [category, items] of map) {
    items.sort((a, b) => a.nameZh.localeCompare(b.nameZh, 'zh-Hans-CN'));
    groups.push({ category, items });
  }
  groups.sort((a, b) => {
    const aArea = a.items.some(item => item.kind === 'area') ? 0 : 1;
    const bArea = b.items.some(item => item.kind === 'area') ? 0 : 1;
    if (aArea !== bArea) return aArea - bArea;
    if (a.items.length !== b.items.length) return b.items.length - a.items.length;
    return a.category.localeCompare(b.category, 'zh-Hans-CN');
  });
  return groups;
}

/** 搜索：中文名 / 英文名 / slug 任一包含即可（大小写不敏感，去首尾空格）。 */
export function searchLibraryEntries(
  entries: readonly LibraryEntry[],
  query: string,
): LibraryEntry[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...entries];
  return entries.filter(entry =>
    entry.nameZh.toLowerCase().includes(q)
    || entry.nameEn.toLowerCase().includes(q)
    || entry.slug.toLowerCase().includes(q));
}

/** 物件库条目 → 设施模板（画布 `pickFacilityTemplate` / `buildFacility` 直接消费）。 */
export function libraryFacilityTemplate(entry: LibraryEntry): PlanFacilityTemplate {
  return {
    templateId: libraryTemplateId(entry),
    name: entry.nameZh,
    width: entry.width,
    depth: entry.depth,
    note: entry.nameEn,
  };
}

/**
 * 从 `oneplan:kind:slug` 反推物件库条目（画布绘制与 3D 低模只需要 kind/slug/名称）。
 * 名称与尺寸在反推时不可用，调用方应优先用放置时写进 facility 的 name / size。
 */
export function parseLibraryTemplateId(
  templateId: string,
): { kind: OneplanStickerDescriptor['kind']; slug: string } | null {
  if (!isLibraryTemplateId(templateId)) return null;
  const rest = templateId.slice(LIBRARY_TEMPLATE_PREFIX.length);
  const sep = rest.indexOf(':');
  if (sep <= 0) return null;
  const kind = rest.slice(0, sep);
  const slug = rest.slice(sep + 1);
  if (!slug) return null;
  if (kind !== 'icon' && kind !== 'scale' && kind !== 'area') return null;
  return { kind, slug };
}

/** 物件库设施在 2D 画布上用的贴纸描述；内置模板返回 null。 */
export function libraryStickerFor(templateId: string): OneplanStickerDescriptor | null {
  const parsed = parseLibraryTemplateId(templateId);
  if (!parsed) return null;
  return { kind: parsed.kind, slug: parsed.slug, icon: 'shapes' };
}