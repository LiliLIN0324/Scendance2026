import { anchorFromMapFrame, METERS_PER_DEGREE_LAT, metersPerDegreeLng } from './amap-venue';
import type { RoomLayout, SceneAnchor } from './types';

/**
 * 场景锚点换算（docs/49 架构定案）。
 * 地图不是独立模块，是 3D 场景里的一个渲染层：场景坐标 ↔ 地理坐标只有这一套变换。
 * - 世界 +x 向东、+z 向南（orientationDeg = 0 时）；
 * - orientationDeg 是世界 -Z（平面图「上」）相对正北的顺时针偏航角；
 * - 世界单位 = 地理米 / metersPerUnit（壳体被等比缩小时 metersPerUnit = 1/scale）。
 */

export { anchorFromMapFrame };

/** 读取布局的场景锚点：优先用显式 sceneAnchor；旧存档没有就从 mapGroundFrame 反推（同一套数学的逆）。 */
export function sceneAnchorOf(
  layout: Pick<RoomLayout, 'sceneAnchor' | 'mapGroundFrame' | 'mapLngLat' | 'width' | 'height'>,
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
  const frame = layout.mapGroundFrame;
  if (frame && Number.isFinite(frame.lng0) && Number.isFinite(frame.lat0)) {
    return anchorFromMapFrame(frame, layout.width, layout.height);
  }
  const center = layout.mapLngLat;
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

/** 底图网格绕世界 Y 轴的偏航（弧度）：纹理正北要指向 orientationDeg 方位，与 anchorGeoToWorld 的旋转互逆。 */
export function anchorBasemapYawRad(anchor: SceneAnchor): number {
  if (anchor.orientationDeg === 0) return 0;
  return (-anchor.orientationDeg * Math.PI) / 180;
}
