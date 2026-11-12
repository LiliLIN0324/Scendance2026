import type { PlanPoint } from '../../../../supabase/functions/_shared/site-plan';
import type { FurnitureItem, RoomLayout } from './types';

/**
 * 室内布置世界 → 户外 2D 规划坐标系（ENU 米制）的纯桥接层。
 *
 * 两个世界：
 * - 壳体世界（shell / three）：`x` 东、`z` 南，尺寸单位是米；
 * - 平面世界（plan / ENU）：`x` 东、`y` 北，尺寸单位是米。
 *
 * 平面 ↔ 壳体的映射由 `plan-footprint-geometry.planShellFrame` 定义（边界外接框
 * 铺满场地框，两轴各自缩放）。本模块只做它的**逆变换**，把室内的物料位置和
 * 场地实景扫描（venueScan）换算成平面上的落地坐标，供 2D 规划画布直接摆位。
 *
 * 无 React、无 DOM、无 three —— 只做纯函数计算。
 */

/** 平面里的可落地实体类型：物料（item）或场地实景扫描（scene）。 */
export type PlanSceneObjectKind = 'item' | 'scene';

export interface PlanSceneObject {
  /** 稳定 id：`item:<furnitureId>` / `scene:venue-scan`。 */
  id: string;
  kind: PlanSceneObjectKind;
  name: string;
  /** 落地中心（平面 ENU 米：x 东、y 北）。 */
  center: { x: number; y: number };
  /** 占地尺寸（米）：x 向东为宽、y 向北为深。 */
  width: number;
  depth: number;
  /** 高度（米）。 */
  height: number;
  /** 朝向（度，逆时针为正，0 表示长边沿东）。 */
  rotationDeg: number;
  /** 十六进制颜色，如 `#8899aa`。 */
  color: string;
  /** 有真实模型时的 glb 链接。 */
  modelUrl?: string;
  /** 云端资产 id（有才带）。 */
  assetId?: string;
}

/** 本模块关心的布局字段（与 `RoomLayout` 结构兼容）。 */
export type PlanBridgeLayout = Pick<RoomLayout, 'width' | 'height' | 'venueScan'>;

/** 物料颜色兜底（不写死成某个分类色，避免在 2D 里冒充语义色）。 */
const FALLBACK_ITEM_COLOR = '#9aa7b5';
/** 实景扫描（venueScan）落地框的固定色。 */
const SCENE_COLOR = '#6ea8ff';
/** 场景名兜底。 */
const FALLBACK_SCENE_NAME = '实景扫描';

const EPS = 0.001;
const HEX_COLOR = /^#[0-9a-fA-F]{3,8}$/;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** 抹掉 -0：负零会污染下游的 `toBe(0)` / 序列化比较。 */
function zeroSafe(value: number): number {
  return value === 0 ? 0 : value;
}

/**
 * 壳体 / three 坐标（x 东、z 南）→ 平面坐标（x 东、y 北）。
 *
 * 只是 z 轴翻向：北为正的平面世界里，南为正的壳体 z 取反。
 */
export function planPointOfScene(x: number, z: number): { x: number; y: number } {
  return { x: zeroSafe(x), y: zeroSafe(-z) };
}

/**
 * 平面边界的外接框。边界退化（点数不足 / 面积为零）返回 null：
 * 宁可不换算，也不要按一个假的框把实体摊在错的位置。
 */
export function planBoundaryBounds(
  boundary: readonly PlanPoint[],
): { minX: number; minY: number; maxX: number; maxY: number; width: number; height: number } | null {
  if (!Array.isArray(boundary) || boundary.length < 3) return null;
  const xs = boundary.map(point => point.x);
  const ys = boundary.map(point => point.y);
  if (!xs.every(value => Number.isFinite(value)) || !ys.every(value => Number.isFinite(value))) return null;
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const width = maxX - minX;
  const height = maxY - minY;
  if (width < EPS || height < EPS) return null;
  return { minX, minY, maxX, maxY, width, height };
}

/**
 * 壳体 → 平面（`planShellFrame` 的逆变换）。
 *
 * `toShell` 是 `x = (plan.x - minX) * scaleX`、`z = (maxY - plan.y) * scaleZ`，
 * 逆过来就是 `plan.x = minX + shellX / scaleX`、`plan.y = maxY - shellZ / scaleZ`，
 * 结果夹回边界外接框（与 `toShell` 的夹取行为对称）。
 */
function shellToPlan(
  bounds: { minX: number; minY: number; maxX: number; maxY: number },
  scaleX: number,
  scaleZ: number,
  shellX: number,
  shellZ: number,
): { x: number; y: number } {
  const x = clamp(bounds.minX + shellX / scaleX, bounds.minX, bounds.maxX);
  const y = clamp(bounds.maxY - shellZ / scaleZ, bounds.minY, bounds.maxY);
  return { x, y };
}

/**
 * 物料列表 → 平面上的落地位。
 *
 * 只有带 `position` 的物料有落地意义，其余跳过。
 * 边界不可用（退化 / 场地尺寸非法）时退化成「壳体坐标直接翻向」的近似落位，
 * 保证调用方永远拿得到一个可用的坐标，而不是 null。
 */
export function planItemFootprints(
  items: readonly FurnitureItem[],
  opts: { boundary: readonly PlanPoint[]; width: number; depth: number },
): PlanSceneObject[] {
  const bounds = planBoundaryBounds(opts.boundary);
  const shellWidth = opts.width;
  const shellDepth = opts.depth;
  const usable =
    bounds !== null &&
    Number.isFinite(shellWidth) &&
    Number.isFinite(shellDepth) &&
    shellWidth >= 1 &&
    shellDepth >= 1;
  const scaleX = usable ? shellWidth / bounds.width : 1;
  const scaleZ = usable ? shellDepth / bounds.height : 1;

  const result: PlanSceneObject[] = [];
  for (const item of items) {
    const position = item.position;
    if (!position) continue;
    const center = usable
      ? shellToPlan(bounds, scaleX, scaleZ, position.x, position.z)
      : planPointOfScene(position.x, position.z);
    const object: PlanSceneObject = {
      id: `item:${item.id}`,
      kind: 'item',
      name: item.name,
      center,
      width: item.width > 0 ? item.width : 1,
      depth: item.depth > 0 ? item.depth : 1,
      height: item.height > 0 ? item.height : 0.5,
      rotationDeg: zeroSafe(-(item.rotation ?? 0) * 180 / Math.PI),
      color: HEX_COLOR.test(item.color ?? '') ? item.color : FALLBACK_ITEM_COLOR,
    };
    if (item.glbUrl) object.modelUrl = item.glbUrl;
    if (item.assetId) object.assetId = item.assetId;
    result.push(object);
  }
  return result;
}

/**
 * 场地实景扫描（venueScan）→ 平面上的落地框。
 *
 * 实景扫描覆盖整个场地，所以它的落地框就是边界外接框（平面米）；没有扫描时返回 null。
 */
export function planSceneFootprint(opts: {
  layout: PlanBridgeLayout;
  boundary: readonly PlanPoint[];
}): PlanSceneObject | null {
  const venueScan = opts.layout.venueScan;
  if (!venueScan) return null;

  const bounds = planBoundaryBounds(opts.boundary);
  const center = bounds
    ? { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 }
    : { x: 0, y: 0 };
  const width = bounds ? bounds.width : opts.layout.width;
  const depth = bounds ? bounds.height : opts.layout.height;

  const object: PlanSceneObject = {
    id: 'scene:venue-scan',
    kind: 'scene',
    name: venueScan.name || FALLBACK_SCENE_NAME,
    center,
    width,
    depth,
    height: 0,
    rotationDeg: 0,
    color: SCENE_COLOR,
  };
  if (venueScan.assetId) object.assetId = venueScan.assetId;
  return object;
}

/**
 * 一次拿到全部可落地实体：实景扫描在前（它是底），物料在后（压在底上）。
 */
export function planSceneObjects(opts: {
  items: readonly FurnitureItem[];
  layout: PlanBridgeLayout;
  boundary: readonly PlanPoint[];
}): PlanSceneObject[] {
  const scene = planSceneFootprint({ layout: opts.layout, boundary: opts.boundary });
  const items = planItemFootprints(opts.items, {
    boundary: opts.boundary,
    width: opts.layout.width,
    depth: opts.layout.height,
  });
  return scene ? [scene, ...items] : items;
}
