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
 * - 默认占地见 `libraryFootprint`：按类型给可信尺度（轿车约 4.5×1.8、座椅约 0.5×0.6），
 *   比例尺线稿再按 viewBox 长宽比落地；用户后续仍可改尺寸。已摆上图的物件保持原 size。
 * - `templateId` 带 `oneplan:` 前缀，便于与 8 个内置模板区分；3D 侧按种类映射低模。
 */

import type { PlanPropKind } from './plan-footprint-geometry';
import { planPropKind } from './plan-footprint-geometry';
import type { OneplanStickerDescriptor } from './oneplan-stickers';
import type { PlanFacilityTemplate } from './site-plan-facilities';
import { libraryFootprint } from './oneplan-library-size';

export { libraryFootprint } from './oneplan-library-size';

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
  viewBox?: string;
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
  /** 2026-11-12 活动包物件：所属包 id（packs.json），非包条目缺省。 */
  packId?: string;
  /** 包内物件 id（`pack:` 模板 id 的第三段）。 */
  packItemId?: string;
  /** 物件主题色（OnePlan 默认色；放置时落到 facility.color / 动线区色 / 人员点色）。 */
  color?: string;
  /**
   * 包物件的放置语义：facility=占地/点位设施、route=动线预设、area=分区预设、
   * worker=纯色圆点位（走布人员）。非包条目缺省 = facility。
   */
  placeKind?: 'facility' | 'route' | 'area' | 'worker';
}

/* ------------------------------------------------------------------ */
/* 2026-11-12 活动包（packs.json，物件级）：与 manifest（资产级）互补     */
/* ------------------------------------------------------------------ */

/** packs.json 里一件物件（生成脚本 .temp/build-packs.mjs）。 */
export interface OneplanPackItem {
  id: string;
  /** 前景资产 slug（manifest/磁盘文件名）；generic 纯色圆点位与 route/area 预设复用共用文件。 */
  asset_slug: string;
  name_en: string;
  name_zh: string;
  kind: 'icon' | 'route' | 'area' | 'scale';
  color: string;
  generic?: boolean;
  fg_color?: string;
}

export interface OneplanPackDef {
  id: string;
  /** OnePlan 侧的包 uuid（溯源用；original 包没有）。 */
  oneplan_id?: string;
  name_en: string;
  name_zh: string;
  source: 'oneplan' | 'original';
  order: number;
  items: OneplanPackItem[];
}

export interface OneplanPacksFile {
  generated_at: string;
  source: string;
  note: string;
  packs: OneplanPackDef[];
}

/** 包物件的放置语义（generic 纯色圆点位走布人员，OnePlan 同为点位物件）。 */
function packPlaceKind(item: OneplanPackItem): 'facility' | 'route' | 'area' | 'worker' {
  if (item.generic) return 'worker';
  if (item.kind === 'route') return 'route';
  if (item.kind === 'area') return 'area';
  return 'facility';
}

/** 包物件的贴纸：icon 白字形 / scale 成对 / area 用 solid-fg 轮廓做 chip / route 用线型字形。 */
function packStickerOf(item: OneplanPackItem): OneplanStickerDescriptor {
  if (item.kind === 'scale') return { kind: 'scale', slug: item.asset_slug, icon: 'shapes' };
  if (item.kind === 'area') return { kind: 'area', slug: 'solid-fg', icon: 'shapes' };
  return { kind: 'icon', slug: item.asset_slug, icon: 'shapes' };
}

/** 包物件 → 物件库条目（catalogLabelOf 靠 categoryZh 的「物件库扩展包 /」前缀识别）。 */
export function packEntryFromItem(pack: OneplanPackDef, item: OneplanPackItem): LibraryEntry {
  const placeKind = packPlaceKind(item);
  const sticker = packStickerOf(item);
  const size = placeKind === 'facility'
    ? libraryFootprint({
      slug: sticker.slug,
      kind: sticker.kind === 'scale' ? 'scale-fg' : 'icon',
      categoryZh: `物件库扩展包 / ${pack.name_zh}`,
    })
    : { width: 1.2, depth: 1.2 };
  const propKind = placeKind === 'facility' ? planPropKind(sticker.slug) : 'misc';
  return {
    id: `${pack.id}/${item.id}`,
    slug: sticker.slug,
    kind: sticker.kind,
    sticker,
    nameZh: item.name_zh,
    nameEn: item.name_en,
    categoryZh: `物件库扩展包 / ${pack.name_zh}`,
    width: size.width,
    depth: size.depth,
    propKind,
    packId: pack.id,
    packItemId: item.id,
    color: item.color,
    placeKind,
  };
}

/** 整份 packs.json → 包物件条目（包序 = order，包内序 = 文件序）。 */
export function packsToEntries(file: Pick<OneplanPacksFile, 'packs'>): LibraryEntry[] {
  const out: LibraryEntry[] = [];
  for (const pack of [...file.packs].sort((a, b) => a.order - b.order)) {
    for (const item of pack.items) out.push(packEntryFromItem(pack, item));
  }
  return out;
}

/* 2026-11-12 物件主题色：manifest 条目没有 color 字段（0/549），库里全黑不好看——
   用确定性调色板（slug 哈希）给每件物件一个稳定的主题色：同一物件永远同色、
   库里整体彩色不单调；packs.json 自带色优先（entry.color 已落）。 */
const ENTRY_PALETTE: readonly string[] = [
  '#C96F2E', // 活力橙
  '#3F8F5F', // 市集绿
  '#3D74C4', // 湖蓝
  '#7C5CBF', // 舞台紫
  '#B85C79', // 玫红
  '#2E8FA3', // 青
  '#96651F', // 琥珀
  '#5B6570', // 石板灰蓝
  '#4A7C59', // 品牌绿
  '#8A6BB8', // 苇紫
];

function entryColorHash(slug: string): number {
  let hash = 0;
  for (let index = 0; index < slug.length; index += 1) {
    hash = (hash * 31 + slug.charCodeAt(index)) >>> 0;
  }
  return hash;
}

/** 物件主题色：自带色优先，缺省走调色板（同 slug 永远同色）。 */
export function libraryEntryColor(entry: Pick<LibraryEntry, 'slug' | 'color'>): string {
  return entry.color ?? ENTRY_PALETTE[entryColorHash(entry.slug) % ENTRY_PALETTE.length]!;
}

/** `pack:` 前缀的 templateId 判定（画布与 3D 用它区分 `oneplan:` 库条目与内置模板）。 */
export const PACK_TEMPLATE_PREFIX = 'pack:';

export function isPackTemplateId(templateId: string): boolean {
  return templateId.startsWith(PACK_TEMPLATE_PREFIX);
}

/** `pack:<packId>:<itemId>` —— 同名物件在不同包里是两件独立物件。 */
export function packTemplateId(packId: string, itemId: string): string {
  return `${PACK_TEMPLATE_PREFIX}${packId}:${itemId}`;
}

export function parsePackTemplateId(templateId: string): { packId: string; itemId: string } | null {
  if (!isPackTemplateId(templateId)) return null;
  const rest = templateId.slice(PACK_TEMPLATE_PREFIX.length);
  const sep = rest.indexOf(':');
  if (sep <= 0) return null;
  const packId = rest.slice(0, sep);
  const itemId = rest.slice(sep + 1);
  if (!packId || !itemId) return null;
  return { packId, itemId };
}

/** 画布加载 packs.json 后登记包条目（3D 贴纸占位反查用；Node/测试环境不登记也不炸）。 */
const packEntryIndex = new Map<string, LibraryEntry>();

export function registerPackEntries(entries: readonly LibraryEntry[]): void {
  packEntryIndex.clear();
  for (const entry of entries) {
    if (!entry.packId || !entry.packItemId) continue;
    packEntryIndex.set(packTemplateId(entry.packId, entry.packItemId), entry);
  }
}

/** `pack:` 模板 id → 贴纸（未登记/未知 id 返回 null，调用方回落）。 */
export function packStickerForTemplateId(templateId: string): OneplanStickerDescriptor | null {
  if (!isPackTemplateId(templateId)) return null;
  return packEntryIndex.get(templateId)?.sticker ?? null;
}

/** `pack:` 模板 id → 包物件条目（3D 素材绑定按 entry.slug 查映射；未登记/未知 id 返回 null）。 */
export function packEntryByTemplateId(templateId: string): LibraryEntry | null {
  if (!isPackTemplateId(templateId)) return null;
  return packEntryIndex.get(templateId) ?? null;
}

/** `oneplan:` 前缀的 templateId 判定（画布与 3D 用它区分内置模板）。 */
export const LIBRARY_TEMPLATE_PREFIX = 'oneplan:';

export function isLibraryTemplateId(templateId: string): boolean {
  return templateId.startsWith(LIBRARY_TEMPLATE_PREFIX);
}

export function libraryTemplateId(entry: Pick<LibraryEntry, 'kind' | 'slug'>): string {
  return `${LIBRARY_TEMPLATE_PREFIX}${entry.kind}:${entry.slug}`;
}

/**
 * 3D 低模种类对应的默认占地（米）：没有尺寸元数据的物件也要有可信尺度。
 * 2026-11-11 目录合并后这张表在 `plan-footprint-geometry.ts`（`PLAN_PROP_SIZE`），内置模板与物件库共用。
 */

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
  const size = libraryFootprint({
    slug,
    kind: asset.kind,
    ...(asset.category_zh ? { categoryZh: asset.category_zh } : {}),
    ...(asset.viewBox ? { viewBox: asset.viewBox } : {}),
  });
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
    // 2026-11-12 主题色随模板落到 facility.color（自带色优先，缺省调色板；画布贴纸跟色消费）。
    color: libraryEntryColor(entry),
  };
}

/** 包物件 → 设施模板：templateId 用 `pack:` 前缀，主题色随模板落到 facility.color。 */
export function packFacilityTemplate(entry: LibraryEntry): PlanFacilityTemplate {
  return {
    templateId: packTemplateId(entry.packId ?? '', entry.packItemId ?? ''),
    name: entry.nameZh,
    width: entry.width,
    depth: entry.depth,
    note: entry.nameEn,
    color: libraryEntryColor(entry),
  };
}

/**
 * 从 `oneplan:kind:slug` 反推物件库条目（画布绘制与 3D 低模只需要 kind/slug/名称）。
 * 名称与尺寸在反推时不可用，调用方应优先用放置时写进 facility 的 name / size。
 */
export function parseLibraryTemplateId(
  templateId: string,
): { kind: OneplanStickerDescriptor['kind']; slug: string } | null {
  // 2026-11-14 兼容存量：Agent 物件排布曾写入 `library:` 前缀（规范是 `oneplan:`），
  // 已摆上图的物件不重摆也能出贴纸/取色。
  const prefix = templateId.startsWith(LIBRARY_TEMPLATE_PREFIX)
    ? LIBRARY_TEMPLATE_PREFIX
    : templateId.startsWith('library:')
      ? 'library:'
      : null;
  if (!prefix) return null;
  const rest = templateId.slice(prefix.length);
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