import { anchorFromMapFrame, METERS_PER_DEGREE_LAT, metersPerDegreeLng } from './amap-venue';
import type { PlanGround } from '../../../../supabase/functions/_shared/site-plan';
import type { RoomLayout, SceneAnchor } from './types';

/** 正源里与定位有关的两段（写成可选形态，`plan.ground` 与 `ResolvedGround` 都能直接传）。 */
type GroundAnchor = Pick<PlanGround, 'frame' | 'center'>;
type GroundRing = Pick<PlanGround, 'frame' | 'center' | 'polygon'>;

/**
 * 场景锚点换算（docs/19 架构定案）。
 * 地图不是独立模块，是 3D 场景里的一个渲染层：场景坐标 ↔ 地理坐标只有这一套变换。
 * - 世界 +x 向东、+z 向南（orientationDeg = 0 时）；
 * - orientationDeg 是世界 -Z（平面图「上」）相对正北的顺时针偏航角；
 * - 世界单位 = 地理米 / metersPerUnit（壳体被等比缩小时 metersPerUnit = 1/scale）。
 */

export { anchorFromMapFrame };

/** 读取布局的场景锚点：优先用显式 sceneAnchor；旧存档没有就从 mapGroundFrame 反推（同一套数学的逆）。 */
export function sceneAnchorOf(
  layout: Pick<RoomLayout, 'sceneAnchor' | 'mapGroundFrame' | 'mapLngLat' | 'width' | 'height'>,
  // S2（2026-11-25）：调用方能给 `resolveGround(layout, plan)` 的结果时，定位字段以正源为准；
  // 不给才读 layout 上的旧缓存字段（`scan-placement` 这条几何基线仍走单参形态，行为不变）。
  ground?: GroundAnchor | null,
): SceneAnchor | null {
  const anchor = layout.sceneAnchor;
  if (
    anchor
    && Number.isFinite(anchor.lng) && Number.isFinite(anchor.lat)
    && Number.isFinite(anchor.orientationDeg)
    && Number.isFinite(anchor.metersPerUnit) && anchor.metersPerUnit > 0
  ) {
    return anchor;
  }
  const rawFrame = ground ? ground.frame : layout.mapGroundFrame;
  if (rawFrame && Number.isFinite(rawFrame.lng0) && Number.isFinite(rawFrame.lat0)) {
    // plan.ground.frame 的 latSign 在契约里可选（`1 | -1 | undefined`），壳体侧的 MapGroundFrame 是 `latSign?`——
    // 在这里补成 layout 口径，免得 exactOptionalPropertyTypes 一路穿透到 anchorFromMapFrame。
    const frame: NonNullable<RoomLayout['mapGroundFrame']> = {
      lng0: rawFrame.lng0,
      lat0: rawFrame.lat0,
      latMid: rawFrame.latMid,
      scale: rawFrame.scale,
      ...(rawFrame.latSign === undefined ? {} : { latSign: rawFrame.latSign }),
    };
    return anchorFromMapFrame(frame, layout.width, layout.height);
  }
  const center = ground ? ground.center : layout.mapLngLat;
  if (center && Number.isFinite(center.lng) && Number.isFinite(center.lat)) {
    return { lng: center.lng, lat: center.lat, orientationDeg: 0, metersPerUnit: 1 };
  }
  return null;
}

/** 地理坐标 → 世界坐标（米制、含朝向旋转）。 */
export function anchorGeoToWorld(anchor: SceneAnchor, lng: number, lat: number): { x: number; z: number } {
  const mLng = metersPerDegreeLng(anchor.lat);
  const eastM = (lng - anchor.lng) * mLng;
  const southM = (anchor.lat - lat) * METERS_PER_DEGREE_LAT;
  const theta = (anchor.orientationDeg * Math.PI) / 180;
  const x = eastM * Math.cos(theta) + southM * Math.sin(theta);
  const z = -eastM * Math.sin(theta) + southM * Math.cos(theta);
  return { x: x / anchor.metersPerUnit, z: z / anchor.metersPerUnit };
}

/** The saved geographic ring in the same world coordinates as the basemap. */
export function mapVenueFootprint(
  layout: RoomLayout,
  ground?: GroundRing | null,
): { x: number; z: number }[] {
  const polygon = ground ? ground.polygon : layout.mapGroundPolygon;
  if (!polygon || polygon.length < 3) return [];
  const anchor = sceneAnchorOf(layout, ground);
  return anchor ? [...polygon].map(point => anchorGeoToWorld(anchor, point.lng, point.lat)) : [];
}

/** 底图网格绕世界 Y 轴的偏航（弧度）：纹理正北要指向 orientationDeg 方位，与 anchorGeoToWorld 的旋转互逆。 */
export function anchorBasemapYawRad(anchor: SceneAnchor): number {
  if (anchor.orientationDeg === 0) return 0;
  return (-anchor.orientationDeg * Math.PI) / 180;
}
