import type { PlanGround } from '../../../../supabase/functions/_shared/site-plan';
import { isPlanGroundImage } from './amap-venue';
import type { RoomLayout } from './types';

/**
 * 贴地底图的「正源 ↔ 视图缓存」换算（B4，2026-11-25）。
 *
 * 正源：`plan.ground`（随 plan 落库、跨设备一致）。
 * 视图缓存：`layout.floorPlanImage / floorPlanOpacity / satelliteGroundRef /
 * mapGroundPolygon / mapLngLat / mapGroundFrame`（3D 卫星 UV 与进场补图仍读它，
 * 随 #38 壳体退役一起消失）。
 *
 * 只做纯换算，不读写存储；旧项目只有 layout 那一份时，`planGroundFromLayout`
 * 负责把存量读成正源，调用方再落 plan。
 */

/** 贴地底图默认不透明度：与旧 `applyLayout` 写入值保持一致。 */
export const PLAN_GROUND_OPACITY = 0.94;

type LayoutGroundSource = Pick<
  RoomLayout,
  'floorPlanImage' | 'floorPlanOpacity' | 'satelliteGroundRef' | 'mapGroundPolygon' | 'mapLngLat' | 'mapGroundFrame'
>;

/**
 * 这张图能被当成贴地底图吗？
 *
 * 判定不用只看内存登记表（`isPlanGroundImage` 依赖本次会话的拼图登记，刷新后为空）：
 * 旧项目重开时图还在、登记没了，只看登记表会把存量当成「没有底图」而丢掉。
 * 因此「data:image + 有贴地框/经纬多边形」也算；用户自己上传的户型图没有这两个字段，不会被误认。
 */
function isGroundImage(layout: LayoutGroundSource): boolean {
  const url = layout.floorPlanImage;
  if (!url) return false;
  if (layout.satelliteGroundRef === false) return false;
  if (isPlanGroundImage(url)) return true;
  return url.startsWith('data:image/') && (!!layout.mapGroundFrame || (layout.mapGroundPolygon?.length ?? 0) >= 3);
}

/** 旧项目（只有 layout 镜像）读成 plan.ground；一份定位都没有就返回 null，不虚构。 */
export function planGroundFromLayout(layout: LayoutGroundSource): PlanGround | null {
  const image = isGroundImage(layout) ? layout.floorPlanImage : undefined;
  const polygon = layout.mapGroundPolygon && layout.mapGroundPolygon.length >= 3 ? layout.mapGroundPolygon : undefined;
  const center = layout.mapLngLat;
  const frame = layout.mapGroundFrame;
  if (!image && !polygon && !center && !frame) return null;
  return {
    ...(image ? { image } : {}),
    ...(layout.floorPlanOpacity === undefined ? {} : { opacity: layout.floorPlanOpacity }),
    ...(layout.satelliteGroundRef === undefined ? {} : { satelliteRef: layout.satelliteGroundRef }),
    ...(polygon ? { polygon } : {}),
    ...(center ? { center } : {}),
    ...(frame ? { frame } : {}),
  };
}

/**
 * 由 plan.ground 投影出 layout 视图缓存补丁。
 * 没有可用的定位或图时返回 null；调用方不要把 null 当成「清空底图」。
 */
export function layoutGroundPatch(ground: PlanGround | undefined | null): Partial<RoomLayout> | null {
  if (!ground) return null;
  if (!ground.image && !ground.polygon && !ground.center && !ground.frame) return null;
  const patch: Partial<RoomLayout> = {
    ...(ground.image ? { floorPlanImage: ground.image } : {}),
    floorPlanOpacity: ground.opacity ?? PLAN_GROUND_OPACITY,
  };
  if (ground.satelliteRef !== undefined) patch.satelliteGroundRef = ground.satelliteRef;
  if (ground.polygon) patch.mapGroundPolygon = ground.polygon;
  if (ground.center) patch.mapLngLat = ground.center;
  // layout 的 mapGroundFrame 要求 latSign 必填（壳体卫星 UV 靠它定朝向）；
  // plan.ground 里缺 latSign 的旧数据先不投影——宁可退回无框，也不要按错误朝向贴图。
  if (ground.frame && ground.frame.latSign !== undefined) {
    patch.mapGroundFrame = { ...ground.frame, latSign: ground.frame.latSign };
  }
  return patch;
}

/**
 * 分享/评审前剥掉底图字节，只留地理定位：
 * data URL 动辄几百 KB，塞进分享链接会把 URL 撑爆；定位信息仍保留，接收方可用自己的底图源重拼。
 */
export function stripPlanGroundImage<T extends { ground?: PlanGround | undefined }>(plan: T): T {
  const ground = plan.ground;
  if (!ground?.image) return plan;
  const { image: _image, ...rest } = ground;
  if (!Object.keys(rest).length) {
    const { ground: _ground, ...withoutGround } = plan;
    return withoutGround as T;
  }
  return { ...plan, ground: rest };
}
