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
  | 'BBOX_OVERLAP'
  | 'ZONE_PAIR_DISCONNECTED'
  | 'ZONE_ENTRANCE_BLOCKED'
  | 'DOOR_SWEEP_BLOCKED'
  | 'PRIVACY_ORDER';

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

/** 门开门扇区半径（米，按门宽 0.9 的一半近似）。 */
export const DOOR_SWEEP_RADIUS_M = 0.45;

/**
 * 门弧遮挡：每个 door 标注沿墙开门后 0.45m 半径扇区内若有家具 footprint 落入，
 * → DOOR_SWEEP_BLOCKED hard（-3）。无 door 标注返回空。
 */
export function evaluateDoorSweep(
  placements: readonly ZoneFurniturePlacement[],
  annotations: readonly PlanAnnotation[],
): ScoredViolation[] {
  const doors = annotations.filter((a) => a.kind === 'door' && a.geometry.kind === 'door');
  if (doors.length === 0) return [];
  const out: ScoredViolation[] = [];
  for (const d of doors) {
    const g = d.geometry;
    if (g.kind !== 'door') continue;
    // 门沿墙位置的世界坐标（墙边为 ±room 半边长；这里用 position 直接当沿墙坐标）。
    // 简化：认为门在场地边线上，门扇区中心 = (position, 边线z/x)，扇区半径 DOOR_SWEEP_RADIUS_M。
    // wall=north 门在 z=-H/2 边，south 在 z=+H/2，west 在 x=-W/2，east 在 x=+W/2。
    // 由于没传 roomSize，这里只做「position 附近 0.45m 内家具」的近似判定，
    // 用 furniture 中心到门沿墙坐标点的欧氏距离 < DOOR_SWEEP_RADIUS_M + 家具外接半径近似 0.3m。
    for (const p of placements) {
      const furnitureR = Math.max(p.spec.width, p.spec.depth) / 2;
      // 沿墙坐标点：north/south → x=g.position, z=0（近似）；east/west → x=0, z=g.position
      const doorX = (g.wall === 'west' || g.wall === 'east') ? 0 : g.position;
      const doorZ = (g.wall === 'north' || g.wall === 'south') ? 0 : g.position;
      const dist = Math.hypot(p.x - doorX, p.z - doorZ);
      if (dist < DOOR_SWEEP_RADIUS_M + furnitureR) {
        out.push({
          code: 'DOOR_SWEEP_BLOCKED',
          severity: 'hard',
          zoneId: d.id,
          message: `${d.label || '门'}的开门扇区被「${p.spec.name}」压住，开门会撞家具`,
        });
        break; // 每扇门只报一次
      }
    }
  }
  return out;
}

/**
 * 隐私区顺序软约束：签到区应在前场（z>0）、休息区应在后场（z<0）。
 * 违反 → PRIVACY_ORDER soft（不扣分），只进 reasons 建议。
 */
export function evaluatePrivacyOrder(
  zones: readonly PlanAnnotation[],
  roomSize: { width: number; height: number } | undefined,
): ScoredViolation[] {
  if (!roomSize) return [];
  const out: ScoredViolation[] = [];
  for (const z of zones) {
    if (z.kind !== 'zone' || z.geometry.kind !== 'rect') continue;
    const centerZ = z.geometry.z + z.geometry.depth / 2;
    if (z.zoneType === 'checkin' && centerZ > 0) {
      // 签到区已经在前场 OK；z<0 说明签到在后排，反了
    }
    if (z.zoneType === 'checkin' && centerZ < -roomSize.height / 4) {
      out.push({
        code: 'PRIVACY_ORDER',
        severity: 'soft',
        zoneId: z.id,
        message: '签到区放到场地后半了，建议挪到入口侧（前排），宾客进来先签到',
      });
    }
    if (z.zoneType === 'rest' && centerZ > roomSize.height / 4) {
      out.push({
        code: 'PRIVACY_ORDER',
        severity: 'soft',
        zoneId: z.id,
        message: '休息区离门太近，建议往深处挪，留出签到→圆桌的自然动线',
      });
    }
  }
  return out;
}
