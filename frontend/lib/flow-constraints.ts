/**
 * 第 12 批「能摆 → 会摆」动线约束纯函数层。
 *
 * 设计红线（见 scoring-flow-spec.md §flow-constraints）：
 * - 纯函数、不可变，不接 React、不读 layoutStore；
 * - 坐标与 ZoneFurniturePlacement 一致（米制、房间中心为原点；x 向右、z 向下）；
 * - 只约束「入口 → 签到区」这一条主通道：宾客从 z 负方向走来，
 *   签到区 z0 边（z 较小那侧）是入口基准；
 * - 没有签到区时不约束（aisleWidthM=Infinity、violations=[]）。
 */

import type { PlanAnnotation } from './plan-annotation';
import type { ZoneFurniturePlacement } from './plan-approve';

/** 主通道最低净宽（米）：普通通过。 */
export const AISLE_MIN_NORMAL = 1.2;
/** 主通道最低净宽（米）：轮椅友好。 */
export const AISLE_MIN_WHEELCHAIR = 1.5;

/** 净空小于此值视为「贴脸堵」（米）。 */
const BLOCKED_EPSILON = 0.5;
/** 横向条带在签到区 x0 / x1 外的扩展余量（米）。 */
const AISLE_X_MARGIN = 0.3;
/** 浮点比较容差（米）。 */
const EPS = 1e-6;
/**
 * 无签到区时的默认宽敞通道（米）。
 * 当既无签到区也无 placements 时，主通道不被任何家具约束，给一个保守的宽敞估值，
 * 让 UI 不再显示 Infinity；这个数字不会触发任何 violation。
 */
const DEFAULT_AISLE_WHEN_EMPTY = 3.0;

export interface FlowEvaluation {
  /** 签到区入口侧（z0 边外）到最近家具/zone 家具投影的净空，米；没有签到区时返回 Infinity。 */
  aisleWidthM: number;
  /** aisleWidthM >= AISLE_MIN_WHEELCHAIR。 */
  wheelChairPassable: boolean;
  /** aisleWidthM >= AISLE_MIN_NORMAL。 */
  normalPassable: boolean;
  /** 签到区入口侧是否被任何家具（zone 内或 zone 外）堵上：从 z0 边往 z 负方向扫，遇到第一件家具即算堵。 */
  checkinBlocked: boolean;
  /** 全部人话违规原因（用于打分扣分项 + UI 回执），空数组表示通过。 */
  violations: string[];
}

/**
 * 评估一批 placements 相对 zone 标注的动线合规度。
 *
 * 算法：
 * 1. 从 zones 里挑出 kind==='zone' && zoneType==='checkin' && geometry.kind==='rect' 的签到区；
 *    没有 → 不约束（返回 Infinity / 全过）。
 * 2. 对每个签到区 z0 边：横向条带 = [x0-0.3, x0+w+0.3]；
 *    筛 placements 中「x 中心落在条带内 且 z 中心 < z0」的家具。
 * 3. 每件候选的「后缘 z」= z + depth/2；净空 = z0 - 后缘；
 *    取所有签到区、所有候选里最小的净空作为整体 aisleWidthM（找不到 = Infinity）。
 * 4. checkinBlocked = aisleWidthM < 0.5（贴脸）。
 * 5. violations：
 *    - 净空 < 1.2m → `签到台前通道只剩 X.Xm，轮椅过不去`（normal 不过）
 *    - 1.2m ≤ 净空 < 1.5m → `签到台前通道 X.Xm，轮椅过不去，但行人能过`
 *    - checkinBlocked → `签到区入口被家具贴脸堵住`
 */
export function evaluateFlow(
  placements: readonly ZoneFurniturePlacement[],
  zones: readonly PlanAnnotation[],
): FlowEvaluation {
  const checkinZones = zones.filter(
    (a) => a.kind === 'zone' && a.zoneType === 'checkin' && a.geometry.kind === 'rect',
  );

  if (checkinZones.length === 0) {
    // 无签到区：不写硬约束，但返回有限的「主通道估算余量」让 UI 能显示一个数字。
    // - 无 placements → 默认宽敞 3.0m；
    // - 有 placements → 扫所有家具两两之间的最大正向间隙（轴对齐矩形表面距离），
    //   作为最可能走人那条通道的宽度估算；所有 pair 都贴住时回落到 0.5m。
    const estimated = estimateMainAisleFromPlacements(placements);
    return {
      aisleWidthM: estimated,
      wheelChairPassable: estimated >= AISLE_MIN_WHEELCHAIR - EPS,
      normalPassable: estimated >= AISLE_MIN_NORMAL - EPS,
      checkinBlocked: false,
      violations: [],
    };
  }

  // 对每个签到区扫一遍候选家具，取最小净空（最堵的那条）。
  let minClearance = Infinity;

  for (const zone of checkinZones) {
    const g = zone.geometry;
    if (g.kind !== 'rect') continue;
    const bandL = g.x - AISLE_X_MARGIN;
    const bandR = g.x + g.width + AISLE_X_MARGIN;
    const z0 = g.z;

    for (const p of placements) {
      // 横向条带：x 中心落在哪
      if (p.x < bandL - EPS || p.x > bandR + EPS) continue;
      // 只看入口侧（z 中心 < z0）
      if (p.z >= z0 - EPS) continue;
      const zRear = p.z + p.spec.depth / 2;
      const clearance = z0 - zRear;
      if (clearance < minClearance - EPS) {
        minClearance = clearance;
      }
    }
  }

  const aisleWidthM = minClearance;
  const wheelChairPassable = aisleWidthM >= AISLE_MIN_WHEELCHAIR - EPS;
  const normalPassable = aisleWidthM >= AISLE_MIN_NORMAL - EPS;
  const checkinBlocked = aisleWidthM < BLOCKED_EPSILON - EPS;

  const violations: string[] = [];
  if (aisleWidthM < AISLE_MIN_NORMAL - EPS) {
    violations.push(`签到台前通道只剩 ${aisleWidthM.toFixed(1)}m，轮椅过不去`);
  } else if (aisleWidthM < AISLE_MIN_WHEELCHAIR - EPS) {
    violations.push(`签到台前通道 ${aisleWidthM.toFixed(1)}m，轮椅过不去，但行人能过`);
  }
  if (checkinBlocked) {
    violations.push('签到区入口被家具贴脸堵住');
  }

  return {
    aisleWidthM,
    wheelChairPassable,
    normalPassable,
    checkinBlocked,
    violations,
  };
}

/**
 * 无签到区时的主通道估算余量：扫所有家具两两之间的最大正间隙（轴对齐矩形表面距离）。
 * 这只是一个粗估，不参与硬约束，violations 始终为空。
 * - placements 不足 2 件 → 默认宽敞 3.0m；
 * - 所有 pair 都贴住/重叠 → 回落到 0.5m（贴脸档）；
 * - 否则返回最宽的那条可走人间隙。
 */
function estimateMainAisleFromPlacements(
  placements: readonly ZoneFurniturePlacement[],
): number {
  if (placements.length < 2) return DEFAULT_AISLE_WHEN_EMPTY;
  let maxGap = 0;
  for (let i = 0; i < placements.length; i++) {
    for (let j = i + 1; j < placements.length; j++) {
      const a = placements[i]!;
      const b = placements[j]!;
      const gap = rectSurfaceGap(a, b);
      if (gap > maxGap) maxGap = gap;
    }
  }
  if (maxGap <= EPS) return BLOCKED_EPSILON;
  return maxGap;
}

/** 两件轴对齐矩形家具之间的表面距离（米）；相交或接触返回 0。 */
function rectSurfaceGap(
  a: ZoneFurniturePlacement,
  b: ZoneFurniturePlacement,
): number {
  const ax1 = a.x - a.spec.width / 2;
  const ax2 = a.x + a.spec.width / 2;
  const az1 = a.z - a.spec.depth / 2;
  const az2 = a.z + a.spec.depth / 2;
  const bx1 = b.x - b.spec.width / 2;
  const bx2 = b.x + b.spec.width / 2;
  const bz1 = b.z - b.spec.depth / 2;
  const bz2 = b.z + b.spec.depth / 2;

  const xOverlap = Math.min(ax2, bx2) - Math.max(ax1, bx1);
  const zOverlap = Math.min(az2, bz2) - Math.max(az1, bz1);

  if (xOverlap > EPS && zOverlap > EPS) return 0; // 相交
  if (xOverlap > EPS) return Math.max(0, Math.max(az1, bz1) - Math.min(az2, bz2));
  if (zOverlap > EPS) return Math.max(0, Math.max(ax1, bx1) - Math.min(ax2, bx2));
  // 对角：用欧氏距离近似（保守）
  const dx = Math.max(0, Math.max(ax1, bx1) - Math.min(ax2, bx2));
  const dz = Math.max(0, Math.max(az1, bz1) - Math.min(az2, bz2));
  return Math.hypot(dx, dz);
}
