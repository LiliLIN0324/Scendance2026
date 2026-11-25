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
 *
 * S1（2026-11-25）：**不再投影 `floorPlanImage` / `floorPlanOpacity`**。
 * 字节只活在正源 `plan.ground`，layout 只剩定位形状（多边形/中心/框/开关）当视图缓存；
 * 3D 地面与 2D 画布都改从 `resolveGround(layout, plan)` 取图，删这两个字段时不会断成图。
 * 旧项目盘上已有的镜像仍然可读（`resolveGround` 的 layout 兜底），不做数据迁移。
 */
export function layoutGroundPatch(ground: PlanGround | undefined | null): Partial<RoomLayout> | null {
  if (!ground) return null;
  if (!ground.image && !ground.polygon && !ground.center && !ground.frame) return null;
  const patch: Partial<RoomLayout> = {};
  if (ground.satelliteRef !== undefined) patch.satelliteGroundRef = ground.satelliteRef;
  if (ground.polygon) patch.mapGroundPolygon = ground.polygon;
  if (ground.center) patch.mapLngLat = ground.center;
  // layout 的 mapGroundFrame 要求 latSign 必填（壳体卫星 UV 靠它定朝向）；
  // plan.ground 里缺 latSign 的旧数据先不投影——宁可退回无框，也不要按错误朝向贴图。
  if (ground.frame && ground.frame.latSign !== undefined) {
    patch.mapGroundFrame = { ...ground.frame, latSign: ground.frame.latSign };
  }
  return Object.keys(patch).length ? patch : null;
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

/**
 * 底图读源：`plan.ground` 优先，layout 那份只作兜底（B4 读侧单源化，2026-11-25）。
 *
 * 这是「删 layout 那 6 个字段」的前置：读方先统一从这里取，等全部接上之后，
 * 删字段就是纯删除，不会出现「删了不知道哪里断成图」。
 * `source` 只为排查用：`plan` = 读的正源，`layout` = 旧项目还没迁进 plan。
 */
export interface ResolvedGround {
  image: string;
  opacity: number;
  satelliteRef: boolean;
  polygon: PlanGround['polygon'];
  center: PlanGround['center'];
  frame: PlanGround['frame'];
  source: 'plan' | 'layout';
}

export function resolveGround(
  layout: LayoutGroundSource,
  plan: { ground?: PlanGround | undefined } | null | undefined,
): ResolvedGround | null {
  const source = plan?.ground;
  if (source?.image) {
    return {
      image: source.image,
      opacity: source.opacity ?? PLAN_GROUND_OPACITY,
      satelliteRef: source.satelliteRef ?? true,
      polygon: source.polygon,
      center: source.center,
      frame: source.frame,
      source: 'plan',
    };
  }
  if (!isGroundImage(layout)) return null;
  return {
    image: layout.floorPlanImage!,
    opacity: layout.floorPlanOpacity ?? PLAN_GROUND_OPACITY,
    satelliteRef: layout.satelliteGroundRef ?? true,
    polygon: layout.mapGroundPolygon,
    center: layout.mapLngLat,
    frame: layout.mapGroundFrame,
    source: 'layout',
  };
}

/**
 * 打开一份方案时该往哪个方向同步底图（两个方向都只补缺，不覆盖更新的一侧）：
 * - `to-plan`：旧项目只有 layout 缓存 → 迁进正源；
 * - `to-layout`：正源有图而视图缓存没有（或还是旧图）→ 用正源补齐 3D 读的缓存；
 * - `none`：不用动。
 * 放在这里而不是散在壳体 effect 里，是因为「谁覆盖谁」必须只有一个答案，且要能单测。
 */
export type PlanGroundSync =
  | { direction: 'to-plan'; ground: PlanGround }
  | { direction: 'to-layout'; patch: Partial<RoomLayout> }
  | { direction: 'none'; reason: 'no-plan' | 'no-ground-anywhere' | 'already-current' };

export function planGroundSync(
  plan: { ground?: PlanGround | undefined } | null | undefined,
  layout: LayoutGroundSource,
): PlanGroundSync {
  if (!plan) return { direction: 'none', reason: 'no-plan' };
  if (!plan.ground) {
    const legacy = planGroundFromLayout(layout);
    return legacy ? { direction: 'to-plan', ground: legacy } : { direction: 'none', reason: 'no-ground-anywhere' };
  }
  const ground = plan.ground;
  if (!ground.image) return { direction: 'none', reason: 'already-current' };
  // S1（2026-11-25）：缓存里不再有字节，比较基准换成「定位形状」——
  // 多边形、框、开关三项都齐了就算已同步；否则补一次（补的补丁里也没有字节）。
  const cacheMissingShape = !samePolygon(ground.polygon, layout.mapGroundPolygon)
    || (!!ground.frame && !layout.mapGroundFrame)
    || (ground.satelliteRef !== undefined && layout.satelliteGroundRef !== ground.satelliteRef);
  if (!cacheMissingShape) return { direction: 'none', reason: 'already-current' };
  const patch = layoutGroundPatch(ground);
  return patch ? { direction: 'to-layout', patch } : { direction: 'none', reason: 'already-current' };
}

function samePolygon(
  source: PlanGround['polygon'],
  cache: { lng: number; lat: number }[] | undefined,
): boolean {
  if (!source) return true; // 正源只有图、没有多边形：没有可比的形状。
  if (!cache || cache.length !== source.length) return false;
  return source.every((point, index) =>
    Math.abs(point.lng - cache[index]!.lng) < 1e-9 && Math.abs(point.lat - cache[index]!.lat) < 1e-9,
  );
}
