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
  | 'PRIVACY_ORDER'
  /** 缺房间尺寸：墙退距/可达性无法核验，不算 pass。 */
  | 'ROOM_SIZE_UNKNOWN'
  /** 缺门数据：门弧/动线可信度未知（推测门由 assurance 单独标记）。 */
  | 'DOOR_UNKNOWN';

/** 检查结果四值：pass 不必生成 violation；violated 进 violations；unknown 软提示；not_applicable 省略。 */
export type CheckStatus = 'pass' | 'violated' | 'unknown' | 'not_applicable';

export interface ScoredViolation {
  code: ViolationCode;
  /** hard 进扣分；soft 只进 reasons，不扣 score。 */
  severity: 'hard' | 'soft';
  message: string;
  /** 可选：归因的 zoneId。 */
  zoneId?: string;
  /** 四值状态；缺省视为 violated（向后兼容）。 */
  status?: CheckStatus;
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
 * 门弧遮挡：每个 door 标注按真实墙位置算扇区中心，沿墙法线向室内展开 widthM/2 半径。
 * 家具 footprint 落入扇区 → DOOR_SWEEP_BLOCKED hard（-3）。
 *
 * 门宽已知但开启方向（swing）未知 → 结论为「近似，门扇未核验」，
 * 另产一条 soft unknown violation（DOOR_SWEEP_UNVERIFIED），不声称通过。
 * roomSize 缺失时退化为旧近似并标 INSUFFICIENT_INPUT。
 */
export function evaluateDoorSweep(
  placements: readonly ZoneFurniturePlacement[],
  annotations: readonly PlanAnnotation[],
  roomSize?: { width: number; height: number },
): ScoredViolation[] {
  const doors = annotations.filter((a) => a.kind === 'door' && a.geometry.kind === 'door');
  if (doors.length === 0) return [];
  const out: ScoredViolation[] = [];

  // 缺 roomSize：几何不真实，统一标 unknown，不算通过。
  if (!roomSize || !Number.isFinite(roomSize.width) || !Number.isFinite(roomSize.height)) {
    for (const d of doors) {
      out.push({
        code: 'DOOR_SWEEP_BLOCKED',
        severity: 'soft',
        status: 'unknown',
        zoneId: d.id,
        message: `「${d.label || '门'}」缺房间尺寸，门弧几何未核验（近似，门扇未核验）`,
      });
    }
    return out;
  }

  const halfW = roomSize.width / 2;
  const halfH = roomSize.height / 2;

  for (const d of doors) {
    const g = d.geometry;
    if (g.kind !== 'door') continue;
    // 真实门中心按墙位置算；扇区半径 = 门宽的一半。
    const sweepR = g.widthM / 2;
    let doorX: number;
    let doorZ: number;
    // 向室内展开的法线方向（用于判定家具在门内侧而非墙外）。
    let inwardX: number;
    let inwardZ: number;
    switch (g.wall) {
      case 'south':
        doorX = g.position; doorZ = halfH; inwardX = 0; inwardZ = -1; break;
      case 'north':
        doorX = g.position; doorZ = -halfH; inwardX = 0; inwardZ = 1; break;
      case 'east':
        doorX = halfW; doorZ = g.position; inwardX = -1; inwardZ = 0; break;
      case 'west':
        doorX = -halfW; doorZ = g.position; inwardX = 1; inwardZ = 0; break;
    }

    // 推测门（inferred:true，含 withDefaultDoor 合成门和 fixture 按图推断的门）：
    // 门宽/位置/开启方向都未核验，不做 hard blocked 判定，统一走 soft unknown，
    // 避免用「猜的门」硬否决一个可行方案。
    if (g.inferred) {
      out.push({
        code: 'DOOR_SWEEP_BLOCKED',
        severity: 'soft',
        status: 'unknown',
        zoneId: d.id,
        message: `「${d.label || '门'}」为推测门（门宽/位置/开启方向未核验），门弧几何不做硬判定`,
      });
      continue;
    }

    let blocked = false;
    for (const p of placements) {
      const furnitureR = Math.max(p.spec.width, p.spec.depth) / 2;
      const dx = p.x - doorX;
      const dz = p.z - doorZ;
      const dist = Math.hypot(dx, dz);
      // 家具在扇区半径内，且位于门内侧（向内法线方向投影 ≥ -0.1m 容差）。
      const inwardProj = dx * inwardX + dz * inwardZ;
      if (dist < sweepR + furnitureR && inwardProj >= -0.1) {
        out.push({
          code: 'DOOR_SWEEP_BLOCKED',
          severity: 'hard',
          status: 'violated',
          zoneId: d.id,
          message: `${d.label || '门'}的开门扇区被「${p.spec.name}」压住，开门会撞家具（近似，门扇未核验）`,
        });
        blocked = true;
        break;
      }
    }
    // 无论是否 blocked，开启方向未知 → 软 unknown 提示。
    out.push({
      code: 'DOOR_SWEEP_BLOCKED',
      severity: 'soft',
      status: 'unknown',
      zoneId: d.id,
      message: `「${d.label || '门'}」门扇开启方向未核验，结论为近似${blocked ? '，且已检出遮挡' : ''}`,
    });
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
