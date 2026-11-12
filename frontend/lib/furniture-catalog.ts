/**
 * 第 4.1 批「家具库 catalog」数据层。
 *
 * 设计红线：
 * - 纯数据、不接 React、不读 layoutStore；
 * - 把原 plan-approve.ts 里硬编码的 SPEC 表抽成独立命名 catalog，便于未来加家具 / 加 zone；
 * - 颜色沿用既有色板（#A0522D / #5D4037 / #4A7C59 / #8D6E63），不引新色；
 * - plan-approve.ts 仍按 zone 配方从本 catalog 取条目，保持 SPEC.roundtable.table 访问形态向后兼容；
 * - 本层不新增 UI 表，只是数据层可扩展。
 */

import type { ZoneSemanticType } from './plan-annotation';

/** 家具类别（用于 catalog 分组；不与 3D 房间那套 category 互通）。 */
export type FurnitureCategory =
  | 'table'
  | 'chair'
  | 'desk'
  | 'bench'
  | 'backdrop'
  | 'decor';

/** catalog 里的一条家具条目。 */
export interface CatalogFurniture {
  /** 类型 key（与 FurnitureItem.type / placement.spec.type 对齐）。 */
  type: string;
  /** 中文名（UI 显示、扣分 message 里用人话）。 */
  name: string;
  category: FurnitureCategory;
  /** 宽（米）。 */
  width: number;
  /** 深（米）。 */
  depth: number;
  /** 高（米）。 */
  height: number;
  /** 色板十六进制，沿用既有色板。 */
  color: string;
  /** emoji 或 icon key。 */
  icon: string;
  /** 哪些 zone 类型可用（配方层用它决定落到哪类区）。 */
  zoneTypes: readonly ZoneSemanticType[];
  /**
   * 若本条是「主家具（桌子）」，每件主家具默认配多少把 secondary 椅子。
   * 仅圆桌配方读取；椅子条目本身不需要此字段。
   */
  chairsPerTable?: number;
  /** 圆台面。缺省是矩形板。碰撞仍用 width×depth 的轴对齐盒。 */
  tableShape?: 'round';
}

/**
 * 全量家具 catalog（按现有 zone 配方展开）。
 * 同名 type（如 dining-chair）因用途不同（餐椅 vs 工作椅）拆成两条，
 * 靠 zoneTypes 区分，避免「工作椅被当成餐椅环在圆桌边」的混淆。
 */
export const FURNITURE_CATALOG: readonly CatalogFurniture[] = [
  {
    type: 'dining-table',
    name: '圆桌',
    category: 'table',
    // 官方宴会圆桌 Ø1.8m（东京国际论坛 Hall D5）。1.8×1.8 是圆台面的碰撞方框，
    // 画布 mesh / 顶视按这个直径画圆柱，不再用方盒冒充。
    width: 1.8,
    depth: 1.8,
    tableShape: 'round',
    height: 0.7,
    color: '#A0522D',
    icon: '🟫',
    zoneTypes: ['roundtable'],
    chairsPerTable: 8,
  },
  {
    // 课桌式（教室式）讲座用 1.8×0.6m 长条桌，与东京国际论坛 Hall D5 官方图一致。
    type: 'desk-table',
    name: '课桌',
    category: 'table',
    width: 1.8,
    depth: 0.6,
    height: 0.75,
    color: '#A0522D',
    icon: '📚',
    zoneTypes: ['desk'],
    // 每桌 3 人（官方课桌图：1.8m 长桌沿长边坐 3 人）。
    chairsPerTable: 3,
  },
  {
    // 讲座椅 0.49×0.57m，与官方图一致；与餐椅（0.45×0.45）是不同道具。
    type: 'desk-chair',
    name: '讲座椅',
    category: 'chair',
    width: 0.49,
    depth: 0.57,
    height: 0.9,
    color: '#5D4037',
    icon: '🪑',
    zoneTypes: ['desk'],
  },
  {
    type: 'dining-chair',
    name: '餐椅',
    category: 'chair',
    width: 0.45,
    depth: 0.45,
    height: 0.9,
    color: '#5D4037',
    icon: '🪑',
    zoneTypes: ['roundtable'],
  },
  {
    type: 'table',
    name: '签到台',
    category: 'desk',
    width: 1.4,
    depth: 0.6,
    height: 0.75,
    color: '#4A7C59',
    icon: '🖊️',
    zoneTypes: ['checkin'],
  },
  {
    type: 'dining-chair',
    name: '工作椅',
    category: 'chair',
    width: 0.45,
    depth: 0.45,
    height: 0.9,
    color: '#5D4037',
    icon: '🪑',
    zoneTypes: ['checkin'],
  },
  {
    type: 'backdrop',
    name: '打卡背景墙',
    category: 'backdrop',
    width: 2.4,
    depth: 0.15,
    height: 2.0,
    color: '#4A7C59',
    icon: '🖼️',
    zoneTypes: ['photo'],
  },
  {
    type: 'plant',
    name: '绿植',
    category: 'decor',
    width: 0.6,
    depth: 0.6,
    height: 1.2,
    color: '#4A7C59',
    icon: '🌿',
    zoneTypes: ['photo'],
  },
  {
    type: 'bench',
    name: '长椅',
    category: 'bench',
    width: 1.8,
    depth: 0.45,
    height: 0.45,
    color: '#8D6E63',
    icon: '🪑',
    zoneTypes: ['rest'],
  },
];

/** 按 type 取第一条匹配（同名多条时按 catalog 顺序）。查不到返回 undefined。 */
export function getCatalogByType(type: string): CatalogFurniture | undefined {
  return FURNITURE_CATALOG.find((entry) => entry.type === type);
}

/** 按 type + 适用 zone 取条目（同 type 多条时，用 zoneTypes 二选一）。 */
export function getCatalogForZone(
  type: string,
  zoneType: ZoneSemanticType,
): CatalogFurniture | undefined {
  return FURNITURE_CATALOG.find(
    (entry) => entry.type === type && entry.zoneTypes.includes(zoneType),
  );
}
