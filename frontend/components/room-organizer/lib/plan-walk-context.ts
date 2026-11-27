/**
 * 户外 3D 人群的行走上下文：把规划层（ENU，x 东 / y 北）换算成人群行走用的
 * 「路线局部」坐标（场地中心为原点，x 东 / z 南），并给出三样东西：
 *
 * 1. `planFacilityColliders()` — 设施占地碰撞盒，供 `resolveWalkerStep` 推挤；
 * 2. `planWalkBounds()` — 场地内缩后的可走矩形，供 follower 夹取；
 * 3. `planSeatAnchors()` — 可坐设施的坐姿锚点与接近点，供自主落座。
 *
 * 为什么单独一层：`components/outdoor-plan-3d.tsx` 已经够长，而这套换算
 * 需要单测（坐标错半个场地是肉眼很难发现的 bug）。本模块零 three 依赖。
 *
 * 三条排除规则（都是「宁可少挡，不要把人卡死」）：
 * - 座位自身不进碰撞盒：人要走到座位后方坐下，椅子当障碍会永远到不了；
 * - 太小的件（< 0.3 m 边或 < 0.25 m²）不挡：牌子、花箱、小推车会把人挡在流线上；
 * - 已经压在流线上的设施不挡：流线是用户/Agent 画的既定通路，新加的碰撞盒
 *   不该让现有人群掉头（受阻 1.2 s 会反走，表现是原地来回）。
 */
import { ROUTE_BOUNDARY_MARGIN_M } from './person-route';
import { planShellFrame } from './plan-footprint-geometry';
import { seatFacilityTargets, type SeatFacilityInput } from './seat-placement';
import { boxCollider, type WalkCollider } from './walk-collision';
import type { SeatAnchor } from './person-behavior';
import type { PlanSiteMetrics } from './plan-scene-placement';
import type { ZoneRing } from './zone-walk';
import type { PlanFacility, PlanPoint, PlanZone } from '../../../../supabase/functions/_shared/site-plan';

export interface LocalPoint {
  x: number;
  z: number;
}

/** ENU → 路线局部。与 `lib/plan-crowd-routes.ts` 的 `toLocal` 同一套换算。 */
export function planRouteFrame(boundary: readonly PlanPoint[], metrics: PlanSiteMetrics) {
  const frame = planShellFrame(boundary, metrics, { clampPoints: false });
  return {
    toLocal(point: PlanPoint): LocalPoint {
      const shell = frame?.toShell(point);
      return shell
        ? { x: shell.x - metrics.width / 2, z: shell.z - metrics.depth / 2 }
        : { x: point.x, z: -point.y };
    },
  };
}

/** 可走矩形：场地外接矩形内缩一个路点余量（与路线布点同一口径）。 */
export function planWalkBounds(metrics: PlanSiteMetrics): {
  minX: number; minZ: number; maxX: number; maxZ: number;
} {
  const m = ROUTE_BOUNDARY_MARGIN_M;
  return {
    minX: -(metrics.width / 2 - m),
    minZ: -(metrics.depth / 2 - m),
    maxX: metrics.width / 2 - m,
    maxZ: metrics.depth / 2 - m,
  };
}

const MIN_SOLID_SIDE_M = 0.3;
const MIN_SOLID_AREA_M2 = 0.25;
/** 流线采样步长（判「设施是否压在流线上」）。 */
const ROUTE_SAMPLE_STEP_M = 0.3;

/**
 * PlanFacility → 座高判定输入：`ref` 取 override slug / 模板 id 供可坐关键词命中；
 * `height` 接标称高度 `heightM`，缺省不传，坐面高度由座高层按椅 / 沙发默认值兜底。
 */
function toSeatInput(f: PlanFacility): SeatFacilityInput {
  const input: SeatFacilityInput = {
    id: f.id,
    name: f.name,
    position: f.position,
    rotationDeg: f.rotationDeg,
  };
  const ref = f.modelOverride ?? f.templateId;
  if (ref) input.ref = ref;
  if (f.heightM !== undefined) input.height = f.heightM;
  return input;
}

/**
 * 设施 → 碰撞盒。
 *
 * @param routes 参与行走的流线（路线局部坐标）。落在这些线段上的设施会被排除，
 *   避免新加的碰撞盒把既有人流挡停。
 */
export function planFacilityColliders(
  facilities: readonly PlanFacility[],
  boundary: readonly PlanPoint[],
  metrics: PlanSiteMetrics,
  routes: readonly (readonly LocalPoint[])[] = []
): WalkCollider[] {
  const { toLocal } = planRouteFrame(boundary, metrics);
  const seatIds = new Set(seatFacilityTargets(facilities.map(toSeatInput)).map((seat) => seat.id));
  const colliders: WalkCollider[] = [];
  for (const facility of facilities) {
    if (!facility?.position) continue;
    if (seatIds.has(facility.id)) continue;
    const width = facility.size?.width ?? 0;
    const depth = facility.size?.depth ?? 0;
    if (width < MIN_SOLID_SIDE_M || depth < MIN_SOLID_SIDE_M) continue;
    if (width * depth < MIN_SOLID_AREA_M2) continue;
    const center = toLocal(facility.position);
    const rotation = ((facility.rotationDeg ?? 0) * Math.PI) / 180;
    const collider = boxCollider(center.x, center.z, width, depth, rotation, false);
    if (routes.some((points) => routeTouchesBox(points, collider))) continue;
    colliders.push(collider);
  }
  return colliders;
}

/** 坐姿锚点与接近点：坐姿锚点再往回让一段，起身后不站在椅子里。 */
export function planSeatAnchors(
  facilities: readonly PlanFacility[],
  boundary: readonly PlanPoint[],
  metrics: PlanSiteMetrics,
  options: { hipBackM?: number; standoffM?: number } = {}
): SeatAnchor[] {
  const { toLocal } = planRouteFrame(boundary, metrics);
  const hipBack = options.hipBackM ?? 0.12;
  const standoff = options.standoffM ?? 0.45;
  return seatFacilityTargets(facilities.map(toSeatInput)).map((seat) => {
    const center = toLocal(seat);
    // 与 `outdoor-plan-3d.tsx` 的 toggleSeatEntry 同一朝向口径：设施模型 rotation.y = -deg，
    // 人物正面 +Z，故人转 π - deg 才与座面同向、背靠椅背。
    const facing = Math.PI - (seat.rotationDeg * Math.PI) / 180;
    return {
      id: seat.id,
      x: center.x - Math.sin(facing) * hipBack,
      z: center.z - Math.cos(facing) * hipBack,
      approach: {
        x: center.x - Math.sin(facing) * (hipBack + standoff),
        z: center.z - Math.cos(facing) * (hipBack + standoff),
      },
      facing,
      seatHeight: seat.seatHeight,
    };
  });
}

/** 分区可漫游面积下限（m²）：再小进去也只能原地转身。 */
const MIN_ZONE_AREA_M2 = 4;

/**
 * 分区 → 漫游环（路线局部坐标，B2）。只收 3 点以上、面积够大的分区；
 * 旧数据里「0 点 = 不设范围」的空环直接跳过。
 */
export function planZoneRings(
  zones: readonly PlanZone[],
  boundary: readonly PlanPoint[],
  metrics: PlanSiteMetrics
): ZoneRing[] {
  const { toLocal } = planRouteFrame(boundary, metrics);
  const rings: ZoneRing[] = [];
  for (const zone of zones) {
    const polygon = (zone.polygon ?? []).map(toLocal);
    if (polygon.length < 3) continue;
    if (Math.abs(ringArea(polygon)) < MIN_ZONE_AREA_M2) continue;
    rings.push({ id: zone.id, polygon });
  }
  return rings;
}

/** 鞋带公式面积（绝对值，不关心绕向）。 */
function ringArea(points: readonly LocalPoint[]): number {
  let sum = 0;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[j]!;
    const b = points[i]!;
    sum += a.x * b.z - b.x * a.z;
  }
  return sum / 2;
}

/** 折线是否穿过碰撞盒（按步长采样；B1 不需要精确相交，够用来排除即可）。 */function routeTouchesBox(points: readonly LocalPoint[], box: WalkCollider): boolean {
  if (points.length === 0) return false;
  if (points.length === 1) return pointInBox(points[0]!, box);
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const length = Math.hypot(b.x - a.x, b.z - a.z);
    const steps = Math.max(1, Math.ceil(length / ROUTE_SAMPLE_STEP_M));
    for (let k = 0; k <= steps; k++) {
      const t = k / steps;
      if (pointInBox({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t }, box)) return true;
    }
  }
  return false;
}

function pointInBox(point: LocalPoint, box: WalkCollider): boolean {
  const dx = point.x - box.cx;
  const dz = point.z - box.cz;
  const lx = dx * box.ax + dz * box.az;
  const lz = dx * box.bx + dz * box.bz;
  return Math.abs(lx) <= box.hw && Math.abs(lz) <= box.hd;
}
