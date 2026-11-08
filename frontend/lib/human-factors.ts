/**
 * 基于中心距的粗略提示；不作为人体工学或规范通过结论。
 *
 * 设计红线：
 * - 纯函数、不可变，不接 React、不读 layoutStore；
 * - 只输出带 code 的 violations，扣分层由 plan-scoring.ts 按 severity/code 算；
 * - 餐椅、长椅中心距和签到区边缘间距仅用于提示，实际通行空间仍需核对；
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
  | 'DOOR_UNKNOWN'
  | 'FLOW_ANALYSIS_LIMIT';

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
 * - CHAIR_GAP：两把 dining-chair 中心距 < 0.9m → 每对一条待核验提示。
 * - AISLE_CLEARANCE：两条长椅中心距 < 1.65m → 每对一条待核验提示。
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
          severity: 'soft',
          status: 'unknown',
          message: `两把餐椅中心距约 ${d.toFixed(2)}m，请核对椅背空间和实际使用方式。`,
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
          severity: 'soft',
          status: 'unknown',
          message: `两条长椅中心距约 ${d.toFixed(2)}m；朝向与实际通行空间仍需核对。`,
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
          status: 'unknown',
          zoneId: zone.id,
          message: `签到台与区域一侧距离约 ${buffer.toFixed(2)}m；实际排队方向和空间仍需核对。`,
        });
      }
    }
  }

  return violations;
}

/**
 * 门附近的粗略检查：当前缺少铰链和开启方向，不能据此判定实际门扇遮挡。
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
  if (!roomSize || !Number.isFinite(roomSize.width) || !Number.isFinite(roomSize.height) || roomSize.width <= 0 || roomSize.height <= 0) {
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
    const hasWidth = typeof g.widthM === 'number' && Number.isFinite(g.widthM) && g.widthM > 0;
    if (!hasWidth) {
      out.push({
        code: 'DOOR_SWEEP_BLOCKED', severity: 'soft', status: 'unknown', zoneId: d.id,
        message: `「${d.label || '门'}」门宽未知，位置及开启方向仍需核验。`,
      });
      continue;
    }
    // 已录入的宽度只用于粗略提示，不代表现场尺寸或开门方向已确认。
    const sweepR = g.widthM! / 2;
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
        message: g.source === 'scene'
          ? `「${d.label || '门'}」来自场景记录；现场位置、净宽和开启方向仍需核验。`
          : `「${d.label || '门'}」为推测门（门宽/位置/开启方向未核验），门弧几何不做硬判定`,
      });
      continue;
    }

    let nearbyName: string | null = null;
    for (const p of placements) {
      const furnitureR = Math.max(p.spec.width, p.spec.depth) / 2;
      const dx = p.x - doorX;
      const dz = p.z - doorZ;
      const dist = Math.hypot(dx, dz);
      // 家具在扇区半径内，且位于门内侧（向内法线方向投影 ≥ -0.1m 容差）。
      const inwardProj = dx * inwardX + dz * inwardZ;
      if (dist < sweepR + furnitureR && inwardProj >= -0.1) {
        nearbyName = p.spec.name;
        break;
      }
    }
    // 当前模型没有铰链和开启方向；无论附近是否有物件，门扇都未核验。
    out.push({
      code: 'DOOR_SWEEP_BLOCKED',
      severity: 'soft',
      status: 'unknown',
      zoneId: d.id,
      message: nearbyName
        ? `「${d.label || '门'}」附近有「${nearbyName}」；门位置、宽度及开启方向未核验，请现场确认是否遮挡。`
        : `「${d.label || '门'}」门位置、宽度及开启方向未核验，请现场确认是否遮挡。`,
    });
  }
  return out;
}

/** 没有经过核验的入口与路径距离，不按坐标推断区域和入口的远近。 */
export function evaluatePrivacyOrder(
  zones: readonly PlanAnnotation[],
  _roomSize: { width: number; height: number } | undefined,
): ScoredViolation[] {
  const out: ScoredViolation[] = [];
  for (const z of zones) {
    if (z.kind !== 'zone' || z.geometry.kind !== 'rect') continue;
    if (z.zoneType === 'checkin' || z.zoneType === 'rest') {
      out.push({
        code: 'PRIVACY_ORDER',
        severity: 'soft',
        status: 'unknown',
        zoneId: z.id,
        message: `${z.zoneType === 'checkin' ? '签到区' : '休息区'}与入口的距离及实际路线尚未核验，请结合现场入口确认。`,
      });
    }
  }
  return out;
}
