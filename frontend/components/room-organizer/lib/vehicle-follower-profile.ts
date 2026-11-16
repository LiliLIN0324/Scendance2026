/**
 * 车辆 / 后勤 3D follower 的预览参数（2026-11-16，任务 #117）。
 *
 * 3D 侧目前只给行人挂了 follower，车与后勤还没有动态对象。真接线前先把「每档载体
 * 走多快、占多大、转多急」这类数值口径收敛到一处：本模块不碰 three、不读 plan、
 * 不写 schema，只按 `PlanRouteCarrier` 返回一份冻结的预览档，供后续 3D 每帧
 * 按弧长取切线、限速转向。
 *
 * 口径：
 * - 速度**只有一处来源**——`flow-sim.speedRangeForCarrier`（walk 1.0–1.3、trolley
 *   0.6–0.9、vehicle 3.0–5.0、mixed 步行档），本模块不复制数字；
 * - 车身尺寸、转向角速度是占位与避碰半径用的预览量，不是车型实测尺寸；
 * - 全部数值仅用于预览节奏，**不代表现场限速、通行能力或合规核算**。
 */

import type { PlanRouteCarrier } from '../../../../supabase/functions/_shared/site-plan';
import { speedRangeForCarrier } from './flow-sim';

export interface VehicleFollowerProfile {
  readonly carrier: PlanRouteCarrier;
  /** 预览速度区间 m/s；必须直接来自 flow-sim 的 speedRangeForCarrier，单一来源，不另立一份数字。 */
  readonly speedRange: readonly [number, number];
  /** 车身预览尺寸（米）：沿行进方向长、横向宽。仅用于占位与避碰半径，不是车型实测尺寸。 */
  readonly bodyLengthM: number;
  readonly bodyWidthM: number;
  /** 最大转向角速度 rad/s（预览用）。 */
  readonly turnRateRadPerSec: number;
  /** 一句话说明这档口径的使用边界（预览/不代表通行能力）。 */
  readonly note: string;
}

/** 车身占位与转向档（2026-11-16 用户口径）：预览量，不参与任何核算。 */
const BODY_PROFILE: Record<
  PlanRouteCarrier,
  { readonly lengthM: number; readonly widthM: number; readonly turnRateRadPerSec: number }
> = {
  /** 行人：0.5×0.5 占位，转向 3.0 rad/s（与现有行人 follower 同档手感）。 */
  walk: { lengthM: 0.5, widthM: 0.5, turnRateRadPerSec: 3.0 },
  /** 推车：1.2×0.7，转向 1.8 rad/s——比人长、比车慢，介于两者之间。 */
  trolley: { lengthM: 1.2, widthM: 0.7, turnRateRadPerSec: 1.8 },
  /** 车 / 后勤：4.8×1.9，转向 0.9 rad/s——按场地内低速接驳与货运的占位取。 */
  vehicle: { lengthM: 4.8, widthM: 1.9, turnRateRadPerSec: 0.9 },
  /**
   * 人车一起：速度按人、占位按车。
   * 理由：人在场的混流里，节奏由慢的一方决定（3–5 m/s 的车速放在人身边不成立），
   * 所以速度走 `speedRangeForCarrier('mixed')` 的步行档；但避碰与占位必须留够
   * 在场最大的车（4.8×1.9、转向 0.9），否则画出来的人贴着车头穿过去。
   */
  mixed: { lengthM: 4.8, widthM: 1.9, turnRateRadPerSec: 0.9 },
};

const NOTE: Record<PlanRouteCarrier, string> = {
  walk: '行人预览档：仅用于 3D 占位与转弯节奏，不代表现场限速、通行能力或合规核算。',
  trolley: '推车预览档：仅用于 3D 占位与转弯节奏，不代表现场限速、通行能力或合规核算。',
  vehicle: '车辆 / 后勤预览档：仅用于 3D 占位与转弯节奏，不代表现场限速、通行能力或合规核算。',
  mixed:
    '人车混流预览档：速度按人、占位按车，仅用于 3D 占位与转弯节奏，不代表现场限速、通行能力或合规核算。',
};

/** 四档 profile 按 carrier 缓存（同一 carrier 返回同一引用），避免每帧新建对象。 */
const PROFILE_CACHE = new Map<PlanRouteCarrier, VehicleFollowerProfile>();

/** 取某载体的 3D follower 预览档（冻结、按 carrier 缓存）。 */
export function vehicleFollowerProfileFor(carrier: PlanRouteCarrier): VehicleFollowerProfile {
  const cached = PROFILE_CACHE.get(carrier);
  if (cached) return cached;
  const body = BODY_PROFILE[carrier];
  const profile: VehicleFollowerProfile = Object.freeze({
    carrier,
    speedRange: speedRangeForCarrier(carrier),
    bodyLengthM: body.lengthM,
    bodyWidthM: body.widthM,
    turnRateRadPerSec: body.turnRateRadPerSec,
    note: NOTE[carrier],
  });
  PROFILE_CACHE.set(carrier, profile);
  return profile;
}

/**
 * 折线上弧长 dist 处的前进方位角（atan2(dy, dx)，平面坐标系）；越界夹紧、跳过零长段。
 * dist≤0 取首个非零长度段方向，dist≥总长取末个非零段；正好落在拐点时取后段。
 */
export function polylineTangentRad(
  points: readonly { x: number; y: number }[],
  dist: number,
): number {
  if (points.length < 2) return 0;

  const segments: { readonly dx: number; readonly dy: number; readonly len: number }[] = [];
  let total = 0;
  for (let i = 0; i < points.length - 1; i += 1) {
    const from = points[i]!;
    const to = points[i + 1]!;
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const len = Math.hypot(dx, dy);
    // 重复点 / 零长段 / 非有限坐标一律跳过，不制造方向。
    if (!Number.isFinite(len) || len <= 0) continue;
    segments.push({ dx, dy, len });
    total += len;
  }
  if (segments.length === 0) return 0;

  const clamped = Number.isNaN(dist) ? 0 : Math.min(Math.max(dist, 0), total);
  if (clamped >= total) {
    const last = segments[segments.length - 1]!;
    return Math.atan2(last.dy, last.dx);
  }

  let walked = 0;
  for (const segment of segments) {
    if (clamped < walked + segment.len) return Math.atan2(segment.dy, segment.dx);
    walked += segment.len;
  }
  const fallback = segments[segments.length - 1]!;
  return Math.atan2(fallback.dy, fallback.dx);
}

/** 角度归一化到 (-π, π]。 */
function normalizeAngleRad(rad: number): number {
  const wrapped = rad % (Math.PI * 2);
  if (wrapped <= -Math.PI) return wrapped + Math.PI * 2;
  if (wrapped > Math.PI) return wrapped - Math.PI * 2;
  return wrapped;
}

/** 从 current 朝 target 转，单步不超过 maxDelta；走最短弧，返回 (-π, π]。 */
export function turnTowardRad(current: number, target: number, maxDelta: number): number {
  if (!Number.isFinite(current) || !Number.isFinite(target)) return 0;
  const from = normalizeAngleRad(current);
  if (!Number.isFinite(maxDelta) || maxDelta <= 0) return from;

  const to = normalizeAngleRad(target);
  let delta = to - from;
  // 最短弧：把跨 ±π 的大圈折回小圈。
  if (delta > Math.PI) delta -= Math.PI * 2;
  else if (delta <= -Math.PI) delta += Math.PI * 2;

  const step = Math.max(-maxDelta, Math.min(maxDelta, delta));
  return normalizeAngleRad(from + step);
}

/** 预览速度：按 unit∈[0,1] 在 speedRange 内线性插值；unit 非有限则取下限。 */
export function vehiclePreviewSpeed(carrier: PlanRouteCarrier, unit: number): number {
  const [min, max] = speedRangeForCarrier(carrier);
  if (!Number.isFinite(unit)) return min;
  const t = Math.min(Math.max(unit, 0), 1);
  return min + (max - min) * t;
}
