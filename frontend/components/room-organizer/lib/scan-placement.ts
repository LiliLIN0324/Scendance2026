import { anchorGeoToWorld, sceneAnchorOf } from './scene-anchor';
import { lngLatToEnu } from './outdoor-plan-canvas';
import { researchGeoToWorld } from '../three/research-basemap';
import type { PlanAnchor, PlanPoint } from '../../../../supabase/functions/_shared/site-plan';
import { legacyGroundOf } from './legacy-ground';
import type { RoomLayout } from './types';
import type { ScannedVenue } from './venue-scans';

/**
 * 实景扫描落位（2026-11-19 用户：「实景扫描就是点击，然后放在特定的场地位置而已」）。
 *
 * 一张扫描卡点下去要回答两件事，本文件只做这两件纯计算：
 * 1. 这套点云该落在场地的哪儿 —— 世界坐标（米，x 东 / z 南，原点=场地锚点）；
 * 2. 2D 地图上那枚落位钉画在哪 —— plan ENU（米，x 东 / y 北，原点=plan.anchor）。
 *
 * 口径（先真后兜，不编坐标）：
 * - 带遥测经纬度（geo.source === 'telemetry'）→ 按锚点投影，就是拍下来的那一点；
 * - 没有 geo → 调研底图中心（researchArea.center）→ 圈场地块（mapGroundPolygon）中心；
 * - 两者都没有 → 世界原点（场地锚点本身），**不再退回室内并排槽位**。
 */

export type ScanPlacementSource = 'telemetry' | 'research-area' | 'polygon' | 'origin';

export type ScanPlacement = {
  /** 世界坐标（米）；3D 点云与 2D 落位都从这里出发。 */
  world: { x: number; z: number };
  /** 2D 地图落位钉（plan ENU）；没有 plan 锚点时给 null，不硬画。 */
  pin: PlanPoint | null;
  /** 这次用的是哪条依据，用来写提示，别把估算说成实测。 */
  source: ScanPlacementSource;
};

/** 经纬度 → plan ENU（与画布 `lngLatToEnu` 同源，保证钉子落在同一个像素上）。 */
export function planPointFromGeo(anchor: PlanAnchor, lng: number, lat: number): PlanPoint {
  return lngLatToEnu(lng, lat, anchor.lng, anchor.lat);
}

/** 环的几何中心：顶点平均值（小场地几十米量级，和面积形心的差别远小于落位误差）。 */
function polygonGeoCenter(polygon: readonly { lng: number; lat: number }[] | undefined): { lng: number; lat: number } | null {
  if (!polygon || polygon.length < 3) return null;
  const lng = polygon.reduce((sum, point) => sum + point.lng, 0) / polygon.length;
  const lat = polygon.reduce((sum, point) => sum + point.lat, 0) / polygon.length;
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  return { lng, lat };
}

/** 地理点 → 世界坐标（米）。有锚点走锚点投影（含朝向/缩放），否则退回调研底图中心口径。 */
export function planWorldPosition(layout: RoomLayout, lng: number, lat: number): { x: number; z: number } | null {
  const anchor = sceneAnchorOf(layout);
  if (anchor) return anchorGeoToWorld(anchor, lng, lat);
  return researchGeoToWorld(layout, lng, lat);
}

/**
 * plan ENU → 世界坐标（米）。2D 地图上点一下的落点走这条路。
 *
 * 不做「ENU → 经纬度 → 再投影」的往返：画布的 ENU 按 111_132.92 m/° 折纬度，
 * 锚点投影按 110_574 m/°，往返一次白丢 0.5%（100 m 上差半米）。这里只把
 * 「plan 原点的世界位置」（plan.anchor 与场地锚点不同心时才有偏移）当平移，
 * 再把 ENU 向量按场地朝向旋转、按 metersPerUnit 缩放——与画布上点的那一格逐米对得上。
 * 既没锚点也没调研范围时按「x 东 / z 南」原样搬，不凭空编一个位置。
 */
export function worldFromPlanPoint(
  layout: RoomLayout,
  planAnchor: PlanAnchor,
  point: PlanPoint,
): { x: number; z: number } {
  const anchor = sceneAnchorOf(layout);
  const origin = planWorldPosition(layout, planAnchor.lng, planAnchor.lat);
  const east = point.x;
  const south = -point.y;
  if (!anchor) {
    return origin ? { x: origin.x + east, z: origin.z + south } : { x: east, z: south };
  }
  const unit = Number.isFinite(anchor.metersPerUnit) && anchor.metersPerUnit > 0 ? anchor.metersPerUnit : 1;
  const theta = (anchor.orientationDeg * Math.PI) / 180;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  return {
    x: (origin?.x ?? 0) + (east * cos + south * sin) / unit,
    z: (origin?.z ?? 0) + (-east * sin + south * cos) / unit,
  };
}

/**
 * 世界坐标 → plan ENU，`worldFromPlanPoint` 的逆。
 * 存档里的场地位置是世界系（场地锚点），而户外 3D 场景建在 plan ENU 上——
 * 两个锚点不同心时差一个平移（实测 3.5 km），不逆变换就会把重建甩到场外。
 */
export function planPointFromWorld(
  layout: RoomLayout,
  planAnchor: PlanAnchor,
  world: { x: number; z: number },
): PlanPoint {
  const anchor = sceneAnchorOf(layout);
  const origin = planWorldPosition(layout, planAnchor.lng, planAnchor.lat);
  const dx = world.x - (origin?.x ?? 0);
  const dz = world.z - (origin?.z ?? 0);
  if (!anchor) return { x: dx, y: -dz };
  const unit = Number.isFinite(anchor.metersPerUnit) && anchor.metersPerUnit > 0 ? anchor.metersPerUnit : 1;
  const theta = (anchor.orientationDeg * Math.PI) / 180;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  const east = (dx * cos - dz * sin) * unit;
  const south = (dx * sin + dz * cos) * unit;
  return { x: east, y: -south };
}

/**
 * 没点地图时的默认落点：有 geo 用 geo，其次调研底图中心，再次圈场地块中心，最后原点。
 * 返回的 `pin` 供 2D 地图画那枚落位钉；没有 plan 锚点时不画。
 */
export function defaultScanPlacement(input: {
  layout: RoomLayout;
  venue: ScannedVenue;
  planAnchor: PlanAnchor | null;
  /** 正源 `plan.ground`（B4）。没给时只借盘上老字段兜底，迁完擦掉后自然失效。 */
  ground?: { polygon?: readonly { lng: number; lat: number }[] | undefined } | null;
}): ScanPlacement {
  const { layout, venue, planAnchor, ground } = input;
  const pinOf = (lng: number, lat: number): PlanPoint | null => (planAnchor ? planPointFromGeo(planAnchor, lng, lat) : null);

  const telemetry = venue.geo;
  if (telemetry) {
    const world = planWorldPosition(layout, telemetry.lng, telemetry.lat) ?? { x: 0, z: 0 };
    return { world, pin: pinOf(telemetry.lng, telemetry.lat), source: 'telemetry' };
  }

  const area = layout.researchArea;
  if (area) {
    const world = planWorldPosition(layout, area.center.lng, area.center.lat) ?? { x: 0, z: 0 };
    return { world, pin: pinOf(area.center.lng, area.center.lat), source: 'research-area' };
  }

  const center = polygonGeoCenter(ground?.polygon ?? legacyGroundOf(layout).mapGroundPolygon);
  if (center) {
    const world = planWorldPosition(layout, center.lng, center.lat) ?? { x: 0, z: 0 };
    return { world, pin: pinOf(center.lng, center.lat), source: 'polygon' };
  }

  // 什么地理依据都没有：落在锚点本身（世界原点），比室内并排槽位诚实。
  return { world: { x: 0, z: 0 }, pin: planAnchor ? { x: 0, y: 0 } : null, source: 'origin' };
}

/** 落位后的提示语：只说依据（实测还是估算），操作提示由调用处接在后面。 */
export function scanPlacementNote(placement: ScanPlacement, name: string): string {
  switch (placement.source) {
    case 'telemetry':
      return `已把「${name}」放回拍摄点（遥测经纬度）。`;
    case 'research-area':
      return `已把「${name}」放在调研范围中心（估算，不是实测）。`;
    case 'polygon':
      return `已把「${name}」放在场地中心（估算，不是实测）。`;
    default:
      return `已把「${name}」落在场地原点（估算，不是实测）。`;
  }
}
