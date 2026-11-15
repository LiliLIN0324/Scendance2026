/**
 * OnePlan 式物件库目录（左栏「区域、路线及交通 / 基础设施 / 工作人员」三段）。
 *
 * 用户口径（m05190 原文）：一点进户外规划就是三行带按钮——
 * 1. 区域、路线及交通 → 区域 / 入口和通道图标 / 路线
 * 2. 基础设施 → 视听设备、屏障、品牌标识、广播、电气设备、食品饮料、家具、地面及轨道、
 *    景点、安全保障、建筑物、卫生间、交通管理、运输、车辆、废物处理、供水和卫生设施
 * 3. 劳动力 → 自定义点、消防、经理、医务人员、警察、保安、管理员、主管、志愿者
 *
 * 素材侧的原始分类是抓取产出的「设施物料 / 交通管理」这类中文路径，与本目录不是一一对应，
 * 所以这里做一张显式映射表：先按原始分类落桶，再用 slug 关键字把「屏障 / 运输」这类
 * 混在大类里的条目挑出来。抓取包里多出来的活动包（圣诞/集市/路跑…）归到「活动包与图元」，
 * 不塞进上面 17 类，免得「基础设施」里冒出一堆节日装饰。
 */

import type { LibraryEntry, OneplanPackDef } from './oneplan-library';
import { PLANNING_ROUTE_KIND_COLORS } from '@/lib/outdoor-plan-tokens';

export interface LibraryCategoryBucket {
  label: string;
  items: LibraryEntry[];
}

/** 第一段：区域、路线及交通（按钮不是物件，按工具/图标两组处理）。 */
export const AREA_ROW_LABEL = '区域、路线及交通';

/** 第三段：工作人员角色（点击后进入「布人员」模式，岗位名就是按钮名）。 */
export const LABOR_ROW_LABEL = '工作人员';
export const LABOR_ROLES = [
  '自定义点',
  '消防',
  '经理',
  '医务人员',
  '警察',
  '保安',
  '管理员',
  '主管',
  '志愿者',
] as const;

/** 第二段：基础设施 17 类，顺序按用户给的原文。 */
export const INFRA_ROW_LABEL = '基础设施';
export const INFRA_CATEGORY_ORDER = [
  '视听设备',
  '屏障',
  '品牌标识',
  '广播',
  '电气设备',
  '食品饮料',
  '家具',
  '地面及轨道',
  '景点',
  '安全保障',
  '建筑物',
  '卫生间',
  '交通管理',
  '运输',
  '车辆',
  '废物处理',
  '供水和卫生设施',
] as const;

export type InfraCategory = (typeof INFRA_CATEGORY_ORDER)[number];

/** 「活动包与图元」段里除去活动包后剩下的图元/未映射条目（树里的二级子组）。 */
export const EXTRA_ROW_LABEL = '图元与其它';

/** 包物件 categoryZh 的前缀（packEntryFromItem 写入，这里据此识别归组）。 */
const PACK_CATEGORY_PREFIX = '物件库扩展包 / ';

/** 包物件在目录/搜索里显示的包名（categoryZh 第二段）。 */
export function packLabelOf(entry: LibraryEntry): string | null {
  if (!entry.packId) return null;
  return entry.categoryZh.startsWith(PACK_CATEGORY_PREFIX)
    ? entry.categoryZh.slice(PACK_CATEGORY_PREFIX.length)
    : entry.categoryZh;
}

const BARRIER_SLUG = /barrier|fence|jersey|hoarding|bollard|stanchion|crowd-control/;
const TRANSPORT_SLUG = /trailer|truck|lorry|bus|shuttle|van|transport|forklift/;

/** 原始分类 → 用户目录里的一类（没有映射的走 EXTRA 段）。 */
function infraCategoryOf(entry: LibraryEntry): InfraCategory | typeof EXTRA_ROW_LABEL | null {
  const category = entry.categoryZh;
  const path = category.replace(/\s+/g, '');
  const slug = entry.slug.toLowerCase();

  // 先按 slug 挑「屏障 / 运输」：这两类在抓取包里混在交通管理、车辆、构筑物里。
  if (BARRIER_SLUG.test(slug)) return '屏障';
  if (TRANSPORT_SLUG.test(slug)) return '运输';

  if (path.includes('视听设备')) return '视听设备';
  if (path.includes('转播摄像')) return '广播';
  if (path.includes('品牌与导视')) return '品牌标识';
  if (path.includes('电力与弱电')) return '电气设备';
  if (path.includes('餐饮')) return '食品饮料';
  if (path.includes('家具')) return '家具';
  if (path.includes('地面与铺道板')) return '地面及轨道';
  if (path.includes('兴趣点') || path.includes('功能点')) return '景点';
  if (path.includes('安全与安防')) return '安全保障';
  if (path.includes('构筑物')) return '建筑物';
  if (path.includes('卫生间')) return '卫生间';
  if (path.includes('交通管理') || path.includes('交通接驳')) return '交通管理';
  if (path.includes('车辆与拖车') || path.includes('物料/车辆')) return '车辆';
  if (path.includes('垃圾与回收')) return '废物处理';
  if (path.includes('供水与卫生')) return '供水和卫生设施';
  return null;
}

/** 基础设施 17 类分桶（顺序固定、空桶不出现）。 */
export function infraBuckets(entries: readonly LibraryEntry[]): LibraryCategoryBucket[] {
  const map = new Map<string, LibraryEntry[]>();
  for (const entry of entries) {
    // 车归「车」组，别在基础设施里再来一份（2026-11-16）。
    //   只剔已经在车组里露面的（同 slug 的拷贝），只有 icon 版的车仍留在原分类。
    if (isPlanVehicleEntry(entry)) continue;
    const label = infraCategoryOf(entry);
    if (!label || label === EXTRA_ROW_LABEL) continue;
    const bucket = map.get(label);
    if (bucket) bucket.push(entry);
    else map.set(label, [entry]);
  }
  return INFRA_CATEGORY_ORDER
    .map(label => ({ label, items: (map.get(label) ?? []).slice().sort(byNameZh) }))
    .filter(bucket => bucket.items.length > 0);
}

/** 活动包与图元（扩展包 / 图元底衬 / 未映射分类）。 */
export function extraBucket(entries: readonly LibraryEntry[]): LibraryCategoryBucket[] {
  const out: LibraryEntry[] = [];
  for (const entry of entries) {
    if (isPlanVehicleEntry(entry)) continue;
    const label = infraCategoryOf(entry);
    if (label === null || label === EXTRA_ROW_LABEL) out.push(entry);
  }
  out.sort(byNameZh);
  return out.length > 0 ? [{ label: EXTRA_ROW_LABEL, items: out }] : [];
}

/**
 * 区域段里的「入口和通道图标」：抓取包里 `活动区域·流线与通行 / 出入口与通行图标`。
 * 这些是符号贴纸，落在地图上当地标用（不是分区、也不是动线）。
 */
export function entranceIconItems(entries: readonly LibraryEntry[]): LibraryEntry[] {
  return entries
    .filter(entry => entry.categoryZh.includes('出入口与通行图标'))
    .slice()
    .sort(byNameZh);
}

/**
 * 「车」组（2026-11-16 用户三次收敛后的口径）。
 *
 * 1. 只留说得出是车的几种，斜置版（`-rotated`）不要；
 * 2. 分成「服务类（现场后勤）」和「服务以外（载客）」两段；
 * 3. 车从「基础设施」里摘出来（见 `isPlanVehicleEntry`）——同一台车不在两边各出一份；
 *    剩下的（公交站、自行车架、停车场关闭、飞机、艇、剪叉升降车…）**留在原来的分类里**，不删不改。
 *
 * 为什么不用关键词 / 类目兜底：拿真清单（oneplan-icons/manifest.json，549 条）跑过——
 * `categoryZh.includes('车辆')` 会把飞机、战机、直升机、橡皮艇、摩托艇、伸缩臂叉装车、
 * 拖拉机全拖进「车」；关键词又会把公交站、自行车停车、自行车架、停车场关闭当成车。
 */
export type PlanVehicleGroup = 'service' | 'passenger';

/**
 * 服务类 / 服务以外不再各占一个子标签（2026-11-16 用户：就用图标配色区分）。
 * 色跟动线同一套：后勤金、车行紫——图例里看到什么色，库里就是什么车。
 */
export const planVehicleGroupColors: Record<PlanVehicleGroup, string> = {
  service: PLANNING_ROUTE_KIND_COLORS.service,
  passenger: PLANNING_ROUTE_KIND_COLORS.vehicle,
};

/** 库内 slug → 车组段位。库里没有的（清扫车 / 面包车 / 自行车）留在待补文案里。 */
export const PLAN_VEHICLE_SLUGS: ReadonlyArray<{ slug: string; group: PlanVehicleGroup }> = [
  // 服务类：现场后勤 + 应急保障
  { slug: 'hgv', group: 'service' },
  { slug: 'van', group: 'service' },
  { slug: 'pickup-truck', group: 'service' },
  { slug: 'forklift', group: 'service' },
  { slug: 'sweeper', group: 'service' },
  { slug: 'food-trailer', group: 'service' },
  { slug: 'enclosed-trailer', group: 'service' },
  { slug: 'toilet-trailer', group: 'service' },
  { slug: 'ambulance', group: 'service' },
  { slug: 'fire-engine', group: 'service' },
  { slug: 'police-car', group: 'service' },
  // 服务以外：载客 / 对外接送
  { slug: 'bus', group: 'passenger' },
  { slug: 'coach', group: 'passenger' },
  { slug: 'taxi', group: 'passenger' },
  { slug: 'car', group: 'passenger' },
  { slug: 'caravan', group: 'passenger' },
  { slug: 'golf-cart', group: 'passenger' },
  { slug: 'motorcycle', group: 'passenger' },
  { slug: 'bicycle', group: 'passenger' },
];

const PLAN_VEHICLE_GROUP_BY_SLUG = new Map(PLAN_VEHICLE_SLUGS.map(v => [v.slug, v.group]));

/** 库里没有比例图的车，行里显示的文案。 */
export const VEHICLE_ICON_PENDING_LABEL = '库内无平面比例图：先用内置图标占位，能直接画这类车的流线';

/** 这台 slug 归「车」组吗（内部用；不分 icon / scale 拷贝）。 */
function isPlanVehicleSlug(entry: LibraryEntry): boolean {
  return PLAN_VEHICLE_GROUP_BY_SLUG.has(entry.slug) && !entry.slug.endsWith('-rotated');
}

/**
 * 这台车能进「车」组吗。
 *
 * 2026-11-16：先只收平面图（`scale`），结果出租车（库里只有 `icon` 款）直接没了；
 * 用户拍板「这几个重要的车得补上，图标随便找」——所以两种 kind 都收，
 * 同 slug 有平面图时优先平面图（配巧克力风格），没有就用库里现成的 icon 小图标。
 */
export function isPlanVehicleEntry(entry: LibraryEntry): boolean {
  return isPlanVehicleSlug(entry);
}

/** 库内叫法和日常叫法对不上时改个名（同一台车只占一行）。 */
const PLAN_VEHICLE_NAME_OVERRIDES: Record<string, string> = {
  van: '面包车 / 厢式货车',
};

/** 同 slug 在库里有多份（icon 小图标 / scale 平面图）：留平面图那份。 */
const VEHICLE_KIND_RANK: Record<string, number> = { scale: 0, icon: 1 };

const kindRank = (entry: LibraryEntry) => VEHICLE_KIND_RANK[entry.kind] ?? 9;

/**
 * 「车」组的条目（一段平铺，不分小标题，2026-11-16）。
 * 同一台车只出一行（同名多份合并），不提供平面图的车不入组。
 * 配色按段位写进 `entry.color`：后勤金 / 车行紫。
 */
export function vehicleIconItems(entries: readonly LibraryEntry[]): LibraryEntry[] {
  const bySlug = new Map<string, LibraryEntry>();
  for (const entry of entries) {
    if (!isPlanVehicleEntry(entry)) continue;
    const prev = bySlug.get(entry.slug);
    if (!prev || kindRank(entry) < kindRank(prev)) bySlug.set(entry.slug, entry);
  }
  const named = new Map<string, LibraryEntry>();
  for (const entry of bySlug.values()) {
    const prev = named.get(entry.nameZh);
    if (!prev || kindRank(entry) < kindRank(prev)) named.set(entry.nameZh, entry);
  }
  // 服务类一簇在上、服务以外一簇在下（2026-11-16 用户：紫的和橙的上下放），簇内按中文名。
  const groupOrder = (entry: LibraryEntry) => (PLAN_VEHICLE_GROUP_BY_SLUG.get(entry.slug) === 'service' ? 0 : 1);
  return [...named.values()]
    .map(entry => ({
      ...entry,
      nameZh: PLAN_VEHICLE_NAME_OVERRIDES[entry.slug] ?? entry.nameZh,
      color: planVehicleGroupColors[PLAN_VEHICLE_GROUP_BY_SLUG.get(entry.slug)!],
      // 视觉统一：出租车是 icon 白字形、其余是 scale 线稿，全部按「彩底 + 白字形」渲染，
      // 否则一边圆底一边浅底，看着像两个类目的东西。
      chipStyle: 'icon' as const,
    }))
    .sort((a, b) => groupOrder(a) - groupOrder(b) || byNameZh(a, b));
}

/** 某件物件在用户目录里属于哪一段/哪一类（搜索结果分组用）。 */
export function catalogLabelOf(entry: LibraryEntry): string {
  // 2026-11-12 活动包物件按包名归组（OnePlan marketplace 口径），不落图元桶。
  const packLabel = packLabelOf(entry);
  if (packLabel) return packLabel;
  // 车单独一段（与左侧「车」组同一口径），搜索里也归到「车」。
  if (isPlanVehicleEntry(entry)) return '车';
  const label = infraCategoryOf(entry);
  if (label) return label;
  if (entry.categoryZh.includes('出入口与通行图标')) return '入口和通道图标';
  if (entry.categoryZh.includes('活动区域')) return '区域';
  return EXTRA_ROW_LABEL;
}

/** 按用户目录分组搜索结果（顺序：区域段 → 基础设施 17 类 → 活动包 → 图元）。 */
export function groupCatalogResults(entries: readonly LibraryEntry[]): LibraryCategoryBucket[] {
  const map = new Map<string, LibraryEntry[]>();
  const packOrder: string[] = [];
  for (const entry of entries) {
    const label = catalogLabelOf(entry);
    if (entry.packId && !packOrder.includes(label)) packOrder.push(label);
    const bucket = map.get(label);
    if (bucket) bucket.push(entry);
    else map.set(label, [entry]);
  }
  const order = ['区域', '入口和通道图标', ...INFRA_CATEGORY_ORDER, ...packOrder, EXTRA_ROW_LABEL];
  return order
    .filter(label => map.has(label))
    .map(label => ({ label, items: (map.get(label) ?? []).slice().sort(byNameZh) }));
}

/* ------------------------------------------------------------------ */
/* 2026-11-12 活动包分桶（树内「活动包与图元」段 + 底部包浏览共用）        */
/* ------------------------------------------------------------------ */

/** 一个活动包在树里的呈现：包行（2×2 预览 + 件数 + 包名）+ 包内物件行。 */
export interface PackBucket {
  id: string;
  nameZh: string;
  nameEn: string;
  source: 'oneplan' | 'original';
  items: LibraryEntry[];
  /** 包行预览 chip：前 3 件（OnePlan 预览格是 2×2 的前 3 格 + 「+N」计数格）。 */
  previews: LibraryEntry[];
}

/** packs.json + 包物件条目 → 按包分桶（包序 = order；包内保持条目序）。 */
export function packBuckets(
  packs: readonly OneplanPackDef[],
  entries: readonly LibraryEntry[],
): PackBucket[] {
  const byPack = new Map<string, LibraryEntry[]>();
  for (const entry of entries) {
    if (!entry.packId) continue;
    const bucket = byPack.get(entry.packId);
    if (bucket) bucket.push(entry);
    else byPack.set(entry.packId, [entry]);
  }
  return [...packs]
    .sort((a, b) => a.order - b.order)
    .map(pack => {
      const items = byPack.get(pack.id) ?? [];
      return {
        id: pack.id,
        nameZh: pack.name_zh,
        nameEn: pack.name_en,
        source: pack.source,
        items,
        previews: items.slice(0, 3),
      };
    })
    .filter(bucket => bucket.items.length > 0);
}

function byNameZh(a: LibraryEntry, b: LibraryEntry): number {
  return a.nameZh.localeCompare(b.nameZh, 'zh-Hans-CN');
}