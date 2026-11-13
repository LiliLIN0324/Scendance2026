import type { PlanPoint, SitePlanData } from '../../../../supabase/functions/_shared/site-plan';
import type { RoomLayout } from './types';
import { metersPerDegreeLng } from './tdt-probe-scale';

/**
 * 户外 2D 规划 ↔ 3D 场地壳体联动（P2-g 数据打通）。
 *
 * 坐标口径（两套都是米制，只差一次「西北角对齐 + 翻轴」）：
 * - SitePlan 边界：局部 ENU，x 东、y 北，相对 `plan.anchor`，可到 ±5 km；
 * - 壳体顶点：`0..width × 0..depth` 的矩形内，x 东、z 向南（北在 2D 平面的上沿）。
 *
 * 所以 2D 边界可以直接投影成 3D 壳体多边形，壳体也能投回 2D 边界——同一个地点、
 * 同一个形状，不需要重新圈地（`createVenueFromPick` 会清物料，这里绝不走它）。
 *
 * 契约约束（`supabase/functions/_shared/domain.ts` 的 venueSchema）：多边形 3–32 点、
 * 顶点必须落在 `[0,width]×[0,depth]`、不能自相交。尺寸上限取 `MAX_ROOM_DIMENSION`（100 m，
 * 见 `lib/constants.ts`）：3D 编辑器在 `applyLayout → normaliseLayout` 里把 width/height 裁到
 * 100，如果这里按 venueSchema 的 200 m 算，polygon 顶点就会跑到裁过的壳体外。本模块返回的
 * 结果一律先按这套约束规整过。
 */

/** 壳体尺寸上限：与 3D 编辑器的 `MAX_ROOM_DIMENSION` 一致（米）。 */
export const SHELL_SIZE_LIMIT_M = 100;
/** 多边形顶点数上限：venueSchema 的 polygon 上界。 */
export const SHELL_RING_LIMIT = 32;
/** 判「同一个形状」的容差（米）：编辑精度 0.3 m，避免每帧抖动都写回 3D。 */
export const RING_EQUAL_EPS_M = 0.5;

export interface ShellVenue {
  width: number;
  depth: number;
  polygon: { x: number; z: number }[];
  /** 规整时按多少比例缩过（1 = 原尺寸）。 */
  scale: number;
  /** 顶点被删减过（>32 点）。 */
  simplified: boolean;
}

const round1 = (value: number): number => Math.round(value * 10) / 10;

/** 环面积（shoelace，绝对值）：用来判断退化多边形。 */
function ringArea(ring: readonly { x: number; z: number }[]): number {
  let area = 0;
  for (let i = 0; i < ring.length; i += 1) {
    const a = ring[i]!;
    const b = ring[(i + 1) % ring.length]!;
    area += a.x * b.z - b.x * a.z;
  }
  return Math.abs(area) / 2;
}

/**
 * 顶点数超限时按「最小三角形」逐个削点——保持外形、不重采样，和 OnePlan 缩点同思路。
 */
function simplifyRing<T extends { x: number; z: number }>(ring: T[], limit = SHELL_RING_LIMIT): T[] {
  if (ring.length <= limit) return ring;
  const points = ring.map(point => ({ ...point }));
  while (points.length > limit) {
    let worstIndex = 0;
    let worstArea = Number.POSITIVE_INFINITY;
    for (let i = 0; i < points.length; i += 1) {
      const prev = points[(i - 1 + points.length) % points.length]!;
      const next = points[(i + 1) % points.length]!;
      const area = Math.abs((points[i]!.x - prev.x) * (next.z - prev.z) - (next.x - prev.x) * (points[i]!.z - prev.z)) / 2;
      if (area < worstArea) {
        worstArea = area;
        worstIndex = i;
      }
    }
    points.splice(worstIndex, 1);
  }
  return points as T[];
}

/** 去掉相邻重合点（venueSchema 要求顶点互不相同）。 */
function dedupeRing<T extends { x: number; z: number }>(ring: T[], eps = 0.05): T[] {
  const out: T[] = [];
  for (const point of ring) {
    const last = out[out.length - 1];
    if (last && Math.hypot(last.x - point.x, last.z - point.z) <= eps) continue;
    out.push(point);
  }
  while (out.length > 1) {
    const first = out[0]!;
    const last = out[out.length - 1]!;
    if (Math.hypot(last.x - first.x, last.z - first.z) > eps) break;
    out.pop();
  }
  return out;
}

/**
 * 2D 边界（ENU 米，可负）→ 壳体多边形（0..width × 0..depth，z 向南）。
 * 退化（顶点不足、面积过小、缩到壳体内仍挤成一条线）返回 null。
 */
export function planBoundaryToShellVenue(boundary: readonly PlanPoint[]): ShellVenue | null {
  if (boundary.length < 3) return null;
  const xs = boundary.map(point => point.x);
  const ys = boundary.map(point => point.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const rawWidth = maxX - minX;
  const rawDepth = maxY - minY;
  if (!Number.isFinite(rawWidth) || !Number.isFinite(rawDepth) || rawWidth < 0.5 || rawDepth < 0.5) return null;
  const scale = Math.min(1, SHELL_SIZE_LIMIT_M / rawWidth, SHELL_SIZE_LIMIT_M / rawDepth);
  const width = Math.max(2, round1(rawWidth * scale));
  const depth = Math.max(2, round1(rawDepth * scale));
  // y 北向 → z 南向：北沿对齐 z=0，与壳体「北在平面图上沿」一致。
  const projected = boundary.map(point => ({
    x: Math.min(width, Math.max(0, round1((point.x - minX) * scale))),
    z: Math.min(depth, Math.max(0, round1((maxY - point.y) * scale))),
  }));
  const deduped = dedupeRing(projected);
  if (deduped.length < 3) return null;
  const simplified = deduped.length > SHELL_RING_LIMIT;
  const polygon = simplifyRing(deduped);
  if (polygon.length < 3 || ringArea(polygon) < 0.5) return null;
  return { width, depth, polygon, scale, simplified };
}

/**
 * 壳体多边形 → 2D 边界（逆变换）：zh 坐标换回 ENU，西北角落到原点。
 * 用于「3D 已经圈好场地，2D 平面照它起稿」，以及校验往返一致。
 */
export function shellVenueToPlanBoundary(venue: { width: number; depth: number; polygon?: readonly { x: number; z: number }[] | null | undefined }): PlanPoint[] {
  const ring = venue.polygon && venue.polygon.length >= 3
    ? venue.polygon
    : [{ x: 0, z: 0 }, { x: venue.width, z: 0 }, { x: venue.width, z: venue.depth }, { x: 0, z: venue.depth }];
  return ring.map(point => ({ x: round1(point.x), y: round1(venue.depth - point.z) }));
}

/** 两个环是否同形（顶点集合逐点比对；起点不同先按最近点轮转对齐）。 */
export function samePlanRing(a: readonly PlanPoint[], b: readonly PlanPoint[], eps = RING_EQUAL_EPS_M): boolean {
  if (a.length !== b.length) return false;
  if (a.length === 0) return true;
  const near = (p: PlanPoint, q: PlanPoint): boolean => Math.hypot(p.x - q.x, p.y - q.y) <= eps;
  // 找出 b 中与 a[0] 对齐的起点，再比一整圈（含反向，编辑可能改绕向）。
  for (const reverse of [false, true]) {
    const ring = reverse ? [...b].reverse() : b;
    for (let offset = 0; offset < ring.length; offset += 1) {
      if (!near(a[0]!, ring[offset]!)) continue;
      let matched = true;
      for (let i = 0; i < a.length; i += 1) {
        if (!near(a[i]!, ring[(offset + i) % ring.length]!)) { matched = false; break; }
      }
      if (matched) return true;
    }
  }
  return false;
}

export interface ShellVenuePatch {
  width: number;
  height: number;
  backendVenue: NonNullable<RoomLayout['backendVenue']>;
  /** 场地被整体缩过（>200 m），调用方可以据此提示。 */
  scaled: boolean;
  simplified: boolean;
}

/**
 * 把 2D 边界落成 3D 壳体的 layout 补丁：写 `backendVenue.polygon` + `width/height` 即可，
 * `layoutGeometryScene` 会把它变成地面与外墙（地图圈地管线只吃这两个字段）。
 *
 * 已有出入口（entrances）只保留仍落在新边界上的——venueSchema 要求出入口必须在边界上，
 * 场地形状变了还留着旧门口会让整份场景校验失败。
 */
export function shellVenuePatchFromPlanBoundary(
  layout: Pick<RoomLayout, 'backendVenue'>,
  boundary: readonly PlanPoint[],
): ShellVenuePatch | null {
  const venue = planBoundaryToShellVenue(boundary);
  if (!venue) return null;
  const storeyHeight = layout.backendVenue?.height;
  const height = Number.isFinite(storeyHeight) && (storeyHeight ?? 0) > 0 ? storeyHeight! : 3;
  const onRing = (point: { x: number; z: number }, eps = 0.35): boolean => {
    const ring = venue.polygon;
    for (let i = 0; i < ring.length; i += 1) {
      const a = ring[i]!;
      const b = ring[(i + 1) % ring.length]!;
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const length = Math.hypot(dx, dz);
      if (length < 1e-6) continue;
      const t = ((point.x - a.x) * dx + (point.z - a.z) * dz) / (length * length);
      if (t < -0.001 || t > 1.001) continue;
      const px = a.x + t * dx;
      const pz = a.z + t * dz;
      if (Math.hypot(point.x - px, point.z - pz) <= eps) return true;
    }
    return false;
  };
  const entrances = (layout.backendVenue?.entrances ?? [])
    .filter(entrance => entrance.position.x >= 0 && entrance.position.x <= venue.width
      && entrance.position.z >= 0 && entrance.position.z <= venue.depth && onRing(entrance.position))
    .slice(0, 12);
  return {
    width: venue.width,
    height: venue.depth,
    backendVenue: {
      shape: 'polygon',
      width: venue.width,
      depth: venue.depth,
      height,
      polygon: venue.polygon,
      entrances,
    },
    scaled: venue.scale < 1,
    simplified: venue.simplified,
  };
}

/**
 * 覆盖层的计划变了要不要写回 3D：只有边界真的变了才写。
 * 初次载入（没有基线）只记基线——草稿起步矩形不能覆盖用户在 3D 里圈好的场地。
 */
export interface OutdoorBoundarySyncState {
  baseline: PlanPoint[] | null;
}

export function nextOutdoorBoundarySync(
  state: OutdoorBoundarySyncState,
  plan: Pick<SitePlanData, 'boundary'>,
): { state: OutdoorBoundarySyncState; apply: boolean } {
  const boundary = plan.boundary;
  if (!state.baseline) return { state: { baseline: boundary }, apply: false };
  if (samePlanRing(state.baseline, boundary)) return { state, apply: false };
  return { state: { baseline: boundary }, apply: true };
}

/**
 * 反向播种：3D 已经圈好场地（`layout.backendVenue`）时，2D 平面照它起稿。
 *
 * 只给「还没有户外草稿」的新平面用：边界直接取壳体轮廓，锚点取场景锚点，
 * 这样两个视图一打开就是同一块场地、同一个地点，而不是各画各的。
 * 已有草稿宁可按草稿走——用户在意的是自己画过的东西，不是壳体的当前形状。
 */
export function seededPlanFromVenue(
  venue: { width: number; depth: number; shape?: string | undefined; polygon?: readonly { x: number; z: number }[] | null | undefined } | null | undefined,
  anchor: { lng: number; lat: number } | null | undefined,
): SitePlanData | null {
  if (!venue || !Number.isFinite(venue.width) || !Number.isFinite(venue.depth)) return null;
  if (venue.width < 2 || venue.depth < 2) return null;
  const boundary = shellVenueToPlanBoundary(venue);
  if (boundary.length < 3) return null;
  const plan: SitePlanData = {
    schemaVersion: 1,
    boundary,
    zones: [],
    facilities: [],
    routes: [],
    nodes: [],
    workers: [],
  };
  if (anchor && Number.isFinite(anchor.lng) && Number.isFinite(anchor.lat)) {
    plan.anchor = { lng: anchor.lng, lat: anchor.lat, crs: 'gcj-02', source: 'asset-geo' };
  }
  return plan;
}

/**
 * 反向播种的 layout 入口：直接用 3D 场景的权威尺寸（`layout.width/height`）当壳体，
 * `backendVenue.polygon` 只在「顶点确实落在壳体内」时采信——模板场景压根没有
 * `backendVenue`，只有宽高；老数据也可能带着和宽高不同尺度的多边形。
 *
 * V-1c（2026-11-13）：有真实 GCJ 足迹（chat 场地确认/地图圈画写入 `mapGroundPolygon`）
 * 且有锚点时，2D 边界用**真实米数**（相对锚点的 ENU），壳体交给 planBoundaryToShellVenue
 * 等比缩——「选区=真轮廓」，不再是缩到 100m 的壳体影子。足迹超 ±5000m 契约（城市级）
 * 或缺锚点则退回壳体轮廓（老路径不变）。
 */
export function seededPlanFromLayout(layout: {
  width: number;
  height: number;
  backendVenue?: { shape?: string | undefined; polygon?: readonly { x: number; z: number }[] | null | undefined } | null | undefined;
  sceneAnchor?: { lng: number; lat: number } | null | undefined;
  mapLngLat?: { lng: number; lat: number } | null | undefined;
  mapGroundPolygon?: readonly { lng: number; lat: number }[] | null | undefined;
}): SitePlanData | null {
  const width = layout.width;
  const depth = layout.height;
  if (!Number.isFinite(width) || !Number.isFinite(depth) || width < 2 || depth < 2) return null;
  const anchor = layout.sceneAnchor ?? layout.mapLngLat ?? null;
  const footprint = layout.mapGroundPolygon;
  if (anchor && Number.isFinite(anchor.lng) && Number.isFinite(anchor.lat)
    && Array.isArray(footprint) && footprint.length >= 3) {
    const boundary = trueFootprintBoundary(footprint, anchor);
    if (boundary) {
      const plan: SitePlanData = {
        schemaVersion: 1,
        boundary,
        zones: [],
        facilities: [],
        routes: [],
        nodes: [],
        workers: [],
      };
      plan.anchor = { lng: anchor.lng, lat: anchor.lat, crs: 'gcj-02', source: 'lookup' };
      return plan;
    }
  }
  const polygon = layout.backendVenue?.polygon;
  const polygonFits = Array.isArray(polygon) && polygon.length >= 3
    && polygon.every(point => Number.isFinite(point.x) && Number.isFinite(point.z)
      && point.x >= -0.01 && point.x <= width + 0.01 && point.z >= -0.01 && point.z <= depth + 0.01);
  const venue = polygonFits
    ? { width, depth, polygon }
    : { width, depth };
  return seededPlanFromVenue(venue, layout.sceneAnchor ?? layout.mapLngLat ?? null);
}

/**
 * V-1c：真实 GCJ 足迹 → ENU 米边界（相对锚点），顶点抽稀到 64（契约上界）。
 * 抽稀用等步长——place-shape 已经做过 Douglas-Peucker，这里只做降采样。
 * 任何顶点跑出 ±4900m（±5000 契约留余量）就整体不采信，调用方退回壳体轮廓。
 */
export function trueFootprintBoundary(
  polygon: readonly { lng: number; lat: number }[],
  anchor: { lng: number; lat: number },
  maxPoints = 64,
): PlanPoint[] | null {
  if (polygon.length < 3) return null;
  const kx = metersPerDegreeLng(anchor.lat);
  const points: PlanPoint[] = [];
  for (const { lng, lat } of polygon) {
    const x = (lng - anchor.lng) * kx;
    const y = (lat - anchor.lat) * 111132.92;
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    if (Math.abs(x) > 4900 || Math.abs(y) > 4900) return null;
    const point = { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 };
    const prior = points[points.length - 1];
    if (!prior || Math.hypot(point.x - prior.x, point.y - prior.y) >= 0.5) points.push(point);
  }
  if (points.length > 1 && Math.hypot(points[0]!.x - points[points.length - 1]!.x, points[0]!.y - points[points.length - 1]!.y) < 0.5) points.pop();
  if (points.length < 3) return null;
  const stride = Math.max(1, Math.ceil(points.length / maxPoints));
  if (stride === 1) return points;
  const out: PlanPoint[] = [];
  for (let i = 0; i < points.length; i += stride) out.push(points[i]!);
  return out.length >= 3 ? out : null;
}
/** 户外规划锚点/真实边界 → 旧场景镜像的西北角原点；不改变 SitePlan 正源。 */
export function sceneAnchorFromOutdoorPlan(plan: Pick<SitePlanData, 'anchor' | 'boundary'>): RoomLayout['sceneAnchor'] | null {
  if (!plan.anchor || plan.boundary.length < 3) return null;
  const shell = planBoundaryToShellVenue(plan.boundary);
  if (!shell) return null;
  const west = Math.min(...plan.boundary.map(point => point.x));
  const north = Math.max(...plan.boundary.map(point => point.y));
  return {
    lng: plan.anchor.lng + west / metersPerDegreeLng(plan.anchor.lat),
    lat: plan.anchor.lat + north / 111132.92,
    orientationDeg: 0,
    metersPerUnit: 1 / shell.scale,
    source: plan.anchor.source,
  };
}

/** Only geometry belongs to RoomLayout; scaled/simplified are diagnostics, not persisted fields.
 * Spreading the whole patch makes strict save readback fail after schema normalization. */
export function applyOutdoorShellVenuePatch(layout: RoomLayout, patch: ShellVenuePatch): RoomLayout {
  return { ...layout, width: patch.width, height: patch.height, backendVenue: patch.backendVenue };
}
