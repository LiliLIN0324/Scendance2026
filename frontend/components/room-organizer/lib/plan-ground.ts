import type { PlanGround } from '../../../../supabase/functions/_shared/site-plan';
import { isPlanGroundImage } from './amap-venue';
import { LEGACY_GROUND_KEYS, legacyGroundOf, type LegacyLayoutGround } from './legacy-ground';

/**
 * 贴地底图的「正源 ↔ 旧字段」换算（B4，2026-11-25）。
 *
 * 正源：`plan.ground`（随 plan 落库、跨设备一致）。
 * 旧字段：layout 上那六个键——已从 `RoomLayout` 类型删除，只在盘上的老方案里存在，
 * 由 `lib/legacy-ground.ts` 这一个口读出来、迁进正源，随后整键擦掉。
 *
 * 只做纯换算，不读写存储。
 */

/** 贴地底图默认不透明度：与旧 `applyLayout` 写入值保持一致。 */
export const PLAN_GROUND_OPACITY = 0.94;

/**
 * 这张图能被当成贴地底图吗？
 *
 * 判定不用只看内存登记表（`isPlanGroundImage` 依赖本次会话的拼图登记，刷新后为空）：
 * 旧项目重开时图还在、登记没了，只看登记表会把存量当成「没有底图」而丢掉。
 * 因此「data:image + 有贴地框/经纬多边形」也算；用户自己上传的户型图没有这两个字段，不会被误认。
 */
function isGroundImage(legacy: LegacyLayoutGround): boolean {
  const url = legacy.floorPlanImage;
  if (!url) return false;
  if (legacy.satelliteGroundRef === false) return false;
  if (isPlanGroundImage(url)) return true;
  return url.startsWith('data:image/') && (!!legacy.mapGroundFrame || (legacy.mapGroundPolygon?.length ?? 0) >= 3);
}

/** 旧项目（只有 layout 那六个键）读成 plan.ground；一份定位都没有就返回 null，不虚构。 */
export function planGroundFromLayout(layout: object | null | undefined): PlanGround | null {
  const legacy = legacyGroundOf(layout);
  const image = isGroundImage(legacy) ? legacy.floorPlanImage : undefined;
  const polygon = legacy.mapGroundPolygon && legacy.mapGroundPolygon.length >= 3 ? legacy.mapGroundPolygon : undefined;
  const center = legacy.mapLngLat;
  const frame = legacy.mapGroundFrame;
  if (!image && !polygon && !center && !frame) return null;
  return {
    ...(image ? { image } : {}),
    ...(legacy.floorPlanOpacity === undefined ? {} : { opacity: legacy.floorPlanOpacity }),
    ...(legacy.satelliteGroundRef === undefined ? {} : { satelliteRef: legacy.satelliteGroundRef }),
    ...(polygon ? { polygon } : {}),
    ...(center ? { center } : {}),
    ...(frame ? { frame } : {}),
  };
}

/**
 * 迁移落地后把 layout 上的**旧字段**整键擦掉（S3，2026-11-25）。
 *
 * 贴地底图的图、透明度、开关、定位（多边形/中心/框）只准活在 `plan.ground`；
 * 老方案迁完当刻就把这六个键从 layout 删掉，盘上不再留第二份。
 *
 * 例外：用户自己上传的参考图纸（data:image 但没有贴地框/多边形）是另一项能力，
 * 只擦定位与开关，图与透明度保留（`floorPlanImage` 在类型里也留着这一义）。
 *
 * 返回的新对象用 delete 构造，避免 exactOptionalPropertyTypes 下写 undefined。
 */
export function stripLayoutGroundBytes<T extends object>(layout: T): { layout: T; stripped: boolean } {
  const legacy = legacyGroundOf(layout);
  if (!Object.keys(legacy).length) return { layout, stripped: false };
  const next = { ...layout } as T & Record<string, unknown>;
  const referenceOnly = !!legacy.floorPlanImage && !isGroundImage(legacy);
  let changed = false;
  for (const key of LEGACY_GROUND_KEYS) {
    if (referenceOnly && (key === 'floorPlanImage' || key === 'floorPlanOpacity')) continue;
    if (!(key in next)) continue;
    delete next[key];
    changed = true;
  }
  return changed ? { layout: next as T, stripped: true } : { layout, stripped: false };
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
 * 底图读源：`plan.ground` 优先，盘上老字段只作兜底（B4 读侧单源化，2026-11-25）。
 * 老字段走 `legacyGroundOf` 这一个口；迁移擦掉之后兜底自然失效，读方只剩正源。
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
  layout: object,
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
  const legacy = legacyGroundOf(layout);
  if (!isGroundImage(legacy)) return null;
  return {
    image: legacy.floorPlanImage!,
    opacity: legacy.floorPlanOpacity ?? PLAN_GROUND_OPACITY,
    satelliteRef: legacy.satelliteGroundRef ?? true,
    polygon: legacy.mapGroundPolygon,
    center: legacy.mapLngLat,
    frame: legacy.mapGroundFrame,
    source: 'layout',
  };
}

/**
 * 打开一份方案时该怎么补底图正源：
 * - `to-plan`：旧项目只有 layout 老字段 → 迁进正源（随后调用方把老字段整键擦掉）；
 * - `none`：不用动。
 *
 * 正源已经是唯一事实，没有反向投影。
 */
export type PlanGroundSync =
  | { direction: 'to-plan'; ground: PlanGround }
  | { direction: 'none'; reason: 'no-plan' | 'no-ground-anywhere' | 'already-current' };

export function planGroundSync(
  plan: { ground?: PlanGround | undefined } | null | undefined,
  layout: object,
): PlanGroundSync {
  if (!plan) return { direction: 'none', reason: 'no-plan' };
  if (!plan.ground) {
    const legacy = planGroundFromLayout(layout);
    return legacy ? { direction: 'to-plan', ground: legacy } : { direction: 'none', reason: 'no-ground-anywhere' };
  }
  return { direction: 'none', reason: 'already-current' };
}
