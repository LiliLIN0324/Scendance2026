import { INFRA_CATEGORY_ORDER, type InfraCategory } from './oneplan-catalog';

/**
 * 物料库的分类口径（用户 m02542 / m02574 / m02594）：
 *
 * 「物料」和「2D 规划里的基础设施」是同一批东西，只是两个视图。以前物料库按活动
 * 场景分组（舞台 / 签到 / 展位 / 座席 …），户外规划却按基础设施 17 类分组，同一个
 * 帐篷在两边被归到不同类目，用户没法把 2D 的规划对上 3D 的落点。
 *
 * 现在只剩一套：基础设施 17 类 + 「不同人群」（原来叫劳动力 / 漫游角色）。
 * 素材库的原始家族（`bucket`，来自 assets/library/merged.json）在这张表里折进
 * 基础设施分类；折叠只影响展示与筛选，落盘数据里的 `bucket` 保持原样。
 */
export const CROWD_GROUP_LABEL = '不同人群';

/** 物料库的类目，顺序即筛选项顺序：基础设施 17 类 → 不同人群。 */
export const MATERIAL_GROUP_LABELS: readonly (InfraCategory | typeof CROWD_GROUP_LABEL)[] = [
  ...INFRA_CATEGORY_ORDER,
  CROWD_GROUP_LABEL,
];

export type MaterialGroupLabel = (typeof MATERIAL_GROUP_LABELS)[number];

/**
 * 素材家族 → 基础设施分类。
 *
 * 只做映射、不改数据：`stage` 的模型仍以 `stage` 落库，展示时归到「景点」。
 * 表里没有的家族原样显示（新素材接进来不会凭空消失）。
 */
export const MATERIAL_GROUP_BY_BUCKET: Readonly<Record<string, MaterialGroupLabel>> = {
  // 视听设备：音响乐器 / 灯光照明 / 数码设备
  audio: '视听设备',
  lighting: '视听设备',
  digital: '视听设备',
  // 品牌标识：标识导视
  signage: '品牌标识',
  // 食品饮料：餐饮用品
  food: '食品饮料',
  // 家具：座椅沙发 / 桌台柜台
  seating: '家具',
  tables: '家具',
  // 景点：舞台设施 / 运动器材 / 装饰陈设 / 绿植景观 / 完整场景 / 游乐设施
  stage: '景点',
  sports: '景点',
  decor: '景点',
  plants: '景点',
  scenes: '景点',
  rides: '景点',
  // 建筑物：建筑结构 / 摊位展陈
  structure: '建筑物',
  exhibition: '建筑物',
  // 运输：后勤设施 / 收纳容器 / 工具设备
  logistics: '运输',
  storage: '运输',
  tools: '运输',
  // 车辆：交通载具
  vehicles: '车辆',
  // 不同人群：人物角色
  people: CROWD_GROUP_LABEL,
};

/** 空分类的提示：素材还没接进来，但类目先占位，别让人以为丢了。 */
export const MATERIAL_GROUP_EMPTY_HINT = '这一类还没有模型，后续生成或找公开模型补上。';

export function isMaterialGroupLabel(value: string): value is MaterialGroupLabel {
  return (MATERIAL_GROUP_LABELS as readonly string[]).includes(value);
}

/** 素材家族对应的基础设施分类；未知家族原样返回（不是空串，避免并进「全部」）。 */
export function materialGroupLabel(bucket: string): string {
  if (!bucket) return '其他';
  return MATERIAL_GROUP_BY_BUCKET[bucket] ?? bucket;
}

/** 类目筛选：既认分类标签，也认原始家族名，老的链接/收藏筛选不会失效。 */
export function matchesMaterialGroup(bucket: string, filter: string): boolean {
  if (!filter) return true;
  if (bucket === filter) return true;
  return materialGroupLabel(bucket) === filter;
}