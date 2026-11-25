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
 * 由 plan.ground 投影出 layout 的**地理定位缓存**（只剩形状三类）。
 *
 * S3（2026-11-25）：连 `satelliteGroundRef` 也不再投影——贴地开关的正源是
 * `plan.ground.satelliteRef`，读方一律 `resolveGround` 后取，不再往 layout 写。
 * 这三项定位缓存仍留着，是因为 `three/scan-placement.ts`（禁改基线）与
 * `isMapOutdoorLayout` 还在读 layout 的定位字段；等基线解禁后再整簇删。
 */
export function layoutGroundPatch(ground: PlanGround | undefined | null): Partial<RoomLayout> | null {
  if (!ground) return null;
  if (!ground.image && !ground.polygon && !ground.center && !ground.frame) return null;
  const patch: Partial<RoomLayout> = {};
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
 * 迁移落地后把 layout 上的**底图字节镜像**擦掉（S3，2026-11-25）：
 * 图、透明度、贴地开关三样只准活在 `plan.ground`。
 *
 * 只擦「像贴地底图」的那张图（`isGroundImage`）；用户自己上传的参考图纸
 * （data:image 但没有贴地框/多边形）原样保留——那是另一项能力，不是镜像。
 * 定位三类（多边形/中心/框）暂时留给基线文件读，等基线解禁再一起删。
 *
 * 返回的新对象用 delete 构造，避免 exactOptionalPropertyTypes 下写 undefined。
 */
export function stripLayoutGroundBytes(layout: RoomLayout): { layout: RoomLayout; stripped: boolean } {
  if (!layout.floorPlanImage && layout.satelliteGroundRef === undefined) return { layout, stripped: false };
  if (layout.floorPlanImage && !isGroundImage(layout)) {
    // 参考图纸：只擦贴地开关，不动图与透明度。
    if (layout.satelliteGroundRef === undefined) return { layout, stripped: false };
    const next = { ...layout };
    delete next.satelliteGroundRef;
    return { layout: next, stripped: true };
  }
  const next = { ...layout };
  delete next.floorPlanImage;
  delete next.floorPlanOpacity;
  delete next.satelliteGroundRef;
  return { layout: next, stripped: true };
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
 * 打开一份方案时该怎么补底图正源：
 * - `to-plan`：旧项目只有 layout 缓存 → 迁进正源（随后由调用方擦掉 layout 字节镜像）；
 * - `none`：不用动。
 *
 * S3（2026-11-25）：删掉了 `to-layout` 方向。正源已经是唯一事实，没有理由再把
 * plan.ground 反向投影回 layout；layout 侧的定位缓存只由取图当下的捕获路径更新。
 */
export type PlanGroundSync =
  | { direction: 'to-plan'; ground: PlanGround }
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
  return { direction: 'none', reason: 'already-current' };
}
