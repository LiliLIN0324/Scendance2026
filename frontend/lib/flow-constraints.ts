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
    return {
      aisleWidthM: Infinity,
      wheelChairPassable: true,
      normalPassable: true,
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
