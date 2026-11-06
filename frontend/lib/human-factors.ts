/**
 * 第 12 批 P0-1 人体工学硬阈值（对齐 RoomCraft）。
 *
 * 设计红线：
 * - 纯函数、不可变，不接 React、不读 layoutStore；
 * - 只输出带 code 的 violations，扣分层由 plan-scoring.ts 按 severity/code 算；
 * - 阈值：餐椅间距 < 0.9m（每对 -1）、对坐家具中心距 < 1.65m（每对 -2）、
 *   签到台前缓冲 < 1.5m（soft，不扣分只进 reasons）；
 * - 中文简体，禁「高斯/WorldGen」。
 */

import type { PlanAnnotation } from './plan-annotation';
import type { ZoneFurniturePlacement } from './plan-approve';

/** violation 枚举码（与 research 文档 §3.3 对齐）。 */
export type ViolationCode =
  | 'CHAIR_GAP'
  | 'AISLE_CLEARANCE'
  | 'CHECKIN_QUEUE'
  | 'ZONE_UNREACHABLE'
  | 'BBOX_OVERLAP';

export interface ScoredViolation {
  code: ViolationCode;
  /** hard 进扣分；soft 只进 reasons，不扣 score。 */
  severity: 'hard' | 'soft';
  message: string;
  /** 可选：归因的 zoneId。 */
  zoneId?: string;
}

/** 餐椅中心距小于此值视为过挤（米）。 */
export const CHAIR_GAP_THRESHOLD_M = 0.9;
/** 对坐家具（长椅 vs 长椅 / 桌 vs 桌）中心距小于此值视为通行余量不足（米）。 */
export const AISLE_CLEARANCE_THRESHOLD_M = 1.65;
/** 签到台前排队缓冲小于此值进 soft violation（米）。 */
export const CHECKIN_QUEUE_THRESHOLD_M = 1.5;

const EPS = 1e-6;

/**
 * 扫 placements，返回人体工学 violations（不扣分，扣分层由 plan-scoring 算）。
 *
 * - CHAIR_GAP：两把 dining-chair 中心距 < 0.9m → 每对一条 hard violation。
 * - AISLE_CLEARANCE：两条对坐长椅（bench vs bench）中心距 < 1.65m → 每对一条 hard violation。
 * - CHECKIN_QUEUE：有签到区时，签到台（type=table/name=签到台）前沿到 zone z0 边距离 < 1.5m
 *   → 一条 soft violation（不扣分）。无签到区或无签到台 placement 时不产生。
 */
export function evaluateHumanFactors(
  placements: readonly ZoneFurniturePlacement[],
  zones: readonly PlanAnnotation[],
): ScoredViolation[] {
  const violations: ScoredViolation[] = [];

  // 1. CHAIR_GAP：餐椅两两中心距。
  const chairs = placements.filter((p) => p.spec.type === 'dining-chair');
  for (let i = 0; i < chairs.length; i++) {
    for (let j = i + 1; j < chairs.length; j++) {
      const a = chairs[i]!;
      const b = chairs[j]!;
      const d = Math.hypot(a.x - b.x, a.z - b.z);
      if (d < CHAIR_GAP_THRESHOLD_M - EPS) {
        violations.push({
          code: 'CHAIR_GAP',
          severity: 'hard',
          message: `餐椅间距仅 ${d.toFixed(2)}m，小于 ${CHAIR_GAP_THRESHOLD_M.toFixed(2)}m 过挤`,
        });
      }
    }
  }

  // 2. AISLE_CLEARANCE：长椅两两中心距（对坐长椅是最常见场景）。
  const benches = placements.filter((p) => p.spec.type === 'bench');
  for (let i = 0; i < benches.length; i++) {
    for (let j = i + 1; j < benches.length; j++) {
      const a = benches[i]!;
      const b = benches[j]!;
      const d = Math.hypot(a.x - b.x, a.z - b.z);
      if (d < AISLE_CLEARANCE_THRESHOLD_M - EPS) {
        violations.push({
          code: 'AISLE_CLEARANCE',
          severity: 'hard',
          message: `对坐家具通行余量仅 ${d.toFixed(2)}m，小于 ${AISLE_CLEARANCE_THRESHOLD_M.toFixed(2)}m`,
        });
      }
    }
  }

  // 3. CHECKIN_QUEUE：签到台前沿到签到区 z0 边的距离。
  const checkinZones = zones.filter(
    (a) =>
      a.kind === 'zone' && a.zoneType === 'checkin' && a.geometry.kind === 'rect',
  );
  if (checkinZones.length > 0) {
    const desks = placements.filter(
      (p) => p.spec.type === 'table' && p.zoneType === 'checkin',
    );
    for (const desk of desks) {
      const zone = checkinZones.find((z) => z.id === desk.zoneId);
      if (!zone || zone.geometry.kind !== 'rect') continue;
      const z0 = zone.geometry.z;
      // 桌前沿（宾客侧，z 负方向）= desk.z - depth/2；缓冲 = 前沿到 z0 的距离。
      const frontEdgeZ = desk.z - desk.spec.depth / 2;
      const buffer = frontEdgeZ - z0;
      if (buffer < CHECKIN_QUEUE_THRESHOLD_M - EPS) {
        violations.push({
          code: 'CHECKIN_QUEUE',
          severity: 'soft',
          zoneId: zone.id,
          message: `签到台前排队缓冲仅 ${buffer.toFixed(2)}m，建议留 ≥ ${CHECKIN_QUEUE_THRESHOLD_M.toFixed(2)}m`,
        });
      }
    }
  }

  return violations;
}
