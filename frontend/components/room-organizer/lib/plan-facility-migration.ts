/**
 * M2 facility 执行器纯函数：消费 `plan-facility-mapping` 的四档落点，把室内物件迁成 `PlanFacility`。
 *
 * 口径：
 * - 不接壳体调用、不拆旧链、不加载 manifest；`oneplan` 条目纯函数层拿不到库条目尺寸，
 *   先用 misc 兜底 2×2，templateId 保留 slug 供渲染层反查贴纸，落位后由 libraryEntry 校准；
 * - `builtin` 直连内置模板目录；`misc` 用动态兜底模板；`skip`（墙体/人员）进 skipped；
 * - `glb-asset` 回落 misc；`assetId` 直通契约 `sourceAssetId`，物料库 slug 经注入 resolver 挂 `modelOverride`；
 * - 纯函数层不加载 manifest：oneplan/misc 尺寸由调用方经 `libraryEntry` 注入，缺省回落 2×2；
 * - 实体一律经 `buildFacility` 工厂构建，失败进 skipped 不留半成品；
 * - 室内 item 无显式 zoneId，归属留空，下一轮按落点命中口径补；特化字段（WiFi/CCTV/锥角/glb 等）
 *   本轮不落 notes、不迁 plan，按条目在 `result.lossy` 如实标记。
 */

import type { PlanFacility, PlanPoint } from '../../../../supabase/functions/_shared/site-plan';
import type { FurnitureItem, RoomLayout } from './types';
import { resolveFacilityTarget } from './plan-facility-mapping';
import { firstModelSlug } from './asset-namespace';
import { buildFacility, type PlanFacilityTemplate } from './site-plan-facilities';
import { inferWorkerZoneId } from './site-plan-routes';
import {
  framePoint,
  hexOrUndefined,
  makeFrame,
  type MigrationUuidGen,
} from './plan-migration-frame';

/** 纯函数层兜底占地（米）；与 `PLAN_PROP_SIZE.misc` 同值。 */
const FALLBACK_WIDTH = 2;
const FALLBACK_DEPTH = 2;
const FALLBACK_NAME = '通用物件';

/** 契约上限（`site-plan` 的 `planFacilitySchema`）。 */
const MAX_SIZE_M = 100;
const MAX_SOURCE_ASSET_ID = 160;

/** 物料库条目在纯函数层只需尺寸；图标由渲染层按 templateId 反查，不进 plan 契约。 */
export interface FacilityLibraryEntry {
  width: number;
  depth: number;
}

export interface FacilityMigrationOptions {
  /**
   * oneplan / misc 条目的尺寸校准注入点。
   * 纯函数层读不到 manifest，调用方接 `oneplan-library` 条目后传入；返回 undefined 或非法尺寸时保持 2×2 兜底。
   */
  libraryEntry?: (templateId: string) => FacilityLibraryEntry | undefined;
  /**
   * glb 物件的物料库 slug（契约 `modelOverride`，1–160）。
   * `assetId ↔ slug` 对应关系未拍板，故不在迁移器内硬猜：只在物件带 assetId / glbUrl 时询问调用方。
   */
  modelSlug?: (item: FurnitureItem) => string | undefined;
}

export interface FacilityMigrationSkip {
  sourceId: string;
  reason: string;
}

/** C3：室内特化字段不迁 plan，按条目如实标记损失项。 */
export interface FacilityMigrationLossy {
  sourceId: string;
  fields: readonly string[];
}

export interface FacilityMigrationResult {
  facilities: PlanFacility[];
  skipped: FacilityMigrationSkip[];
  lossy: FacilityMigrationLossy[];
}

/** 只迁二维占地与通用属性；下面这些是室内 3D 语义，plan 无对应字段（C3 拍板 A）。 */
const INDOOR_ONLY_FIELDS = [
  'handoff',
  'structuralOpeningId',
  'structuralColumnId',
  'wallId',
  'venueEntranceId',
  'elevation',
  'price',
  'isWiFiAccessPoint',
  'isCCTV',
  'signalRange',
  'hasVisionCone',
  'visionRange',
  'visionFov',
  'cctvModelId',
  'cameraBracket',
  'wallRotation',
] as const satisfies readonly (keyof FurnitureItem)[];

/** false 不算损失；0 算（价格 0 / 标高 0 也是显式数据）。 */
function indoorOnlyFields(item: FurnitureItem): string[] {
  return INDOOR_ONLY_FIELDS.filter((field) => {
    const value = item[field];
    return value !== undefined && value !== false;
  });
}

/** 弧度 → 平面角度：参照 `floor-reading.ts:166` 既有口径取反，钳制由工厂完成。 */
function rotationDeg(item: FurnitureItem): number {
  const rad = item.rotation ?? 0;
  return Number.isFinite(rad) ? -(rad * 180) / Math.PI : 0;
}

/** 动态兜底模板：oneplan 条目与 misc 占位共用；尺寸由注入的 libraryEntry 校准，缺省 2×2。 */
function fallbackTemplate(
  templateId: string,
  name: string,
  size?: FacilityLibraryEntry,
): PlanFacilityTemplate {
  return {
    templateId,
    name,
    width: size?.width ?? FALLBACK_WIDTH,
    depth: size?.depth ?? FALLBACK_DEPTH,
    note: '旧室内物件占位（尺寸待接线校准）',
  };
}

/** 库条目尺寸必须落在契约正数上限内，否则不采信（不把 0 / NaN / 超 100 m 带进 plan）。 */
function validLibrarySize(size: FacilityLibraryEntry | undefined): FacilityLibraryEntry | undefined {
  if (!size) return undefined;
  const { width, depth } = size;
  if (!Number.isFinite(width) || !Number.isFinite(depth)) return undefined;
  if (width <= 0 || depth <= 0 || width > MAX_SIZE_M || depth > MAX_SIZE_M) return undefined;
  return { width, depth };
}

/** 契约字符串区间（trim 后 1–max）；不合法返回 undefined，不虚构字段。 */
function boundedId(value: string | undefined, max: number): string | undefined {
  const trimmed = (value ?? '').trim();
  return trimmed.length >= 1 && trimmed.length <= max ? trimmed : undefined;
}

/** glb 引用：assetId 直通 `sourceAssetId`；有模型引用时才经 resolver 取物料库 slug。 */
function withModelReference(
  facility: PlanFacility,
  item: FurnitureItem,
  options: FacilityMigrationOptions,
): PlanFacility {
  const next: PlanFacility = { ...facility };
  // C1：sourceAssetId 只从 item.assetId 直通，绝不从 resolver 的 slug 反推。
  const sourceAssetId = boundedId(item.assetId, MAX_SOURCE_ASSET_ID);
  if (sourceAssetId) next.sourceAssetId = sourceAssetId;
  const hasModelRef = Boolean(item.assetId || item.glbUrl);
  // C1：modelOverride 只收物料库 slug；resolver 误返回 UUID 时丢弃，不硬写。
  const slug = hasModelRef ? firstModelSlug(options.modelSlug?.(item)) : undefined;
  if (slug) next.modelOverride = slug;
  return next;
}

/** 竖向高度落契约：0 与非有限 / 超 20 m 不落键（纯平面件由读取层按 0 兜底）。 */
function boundedHeightM(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isFinite(value) || value <= 0 || value > 20) return undefined;
  return value;
}

/**
 * 档2 摆放写侧五字段（heightM / locked / groupId / shape / finish）：
 * 缺省由读取层兜底，不合法不落键、不虚构；`elevationM` 不补（户外贴地）。
 */
function withSpecFields(facility: PlanFacility, item: FurnitureItem): PlanFacility {
  const next: PlanFacility = { ...facility };
  const heightM = boundedHeightM(item.height);
  if (heightM !== undefined) next.heightM = heightM;
  if (item.locked === true) next.locked = true;
  const groupId = boundedId(item.groupId, 60);
  if (groupId) next.groupId = groupId;
  if (item.tableShape === 'round' || item.tableShape === 'rect') next.shape = item.tableShape;
  if (item.tableFinish === 'linen' || item.tableFinish === 'bare') next.finish = item.tableFinish;
  return next;
}

export function migrateFacilities(
  layout: Pick<RoomLayout, 'width' | 'height' | 'floors'>,
  boundary: readonly PlanPoint[],
  gen: MigrationUuidGen = () => crypto.randomUUID(),
  zones: readonly { id: string; polygon: readonly PlanPoint[] }[] = [],
  options: FacilityMigrationOptions = {},
): FacilityMigrationResult {
  const frame = makeFrame(boundary, layout.width, layout.height);
  const facilities: PlanFacility[] = [];
  const skipped: FacilityMigrationSkip[] = [];
  const lossy: FacilityMigrationLossy[] = [];

  const allItems = layout.floors.flatMap(floor => floor.items ?? []);

  for (const item of allItems) {
    const target = resolveFacilityTarget(item.type);
    if (target.kind === 'skip') {
      skipped.push({ sourceId: item.id, reason: target.reason });
      continue;
    }
    if (!item.position) {
      skipped.push({ sourceId: item.id, reason: '物料缺少落点' });
      continue;
    }

    const position = framePoint(frame, item.position.x, item.position.z);
    // 归属分区：中心点落点命中，口径与 worker/node 一致；都不含则留空。
    const zoneId = inferWorkerZoneId(position, zones);
    const color = hexOrUndefined(item.color);
    const name = (item.name ?? '').trim().slice(0, 60) || FALLBACK_NAME;
    const notes = (item.notes ?? '').trim().slice(0, 500);
    const rotationDegValue = rotationDeg(item);
    const templateId = target.kind === 'builtin'
      ? target.templateId
      : target.kind === 'oneplan'
        ? target.templateId
        : 'misc';
    const template = target.kind === 'builtin'
      ? undefined
      : fallbackTemplate(templateId, name, validLibrarySize(options.libraryEntry?.(templateId)));

    const built = buildFacility({
      id: gen(),
      templateId,
      ...(template ? { template } : {}),
      position,
      rotationDeg: rotationDegValue,
      name,
      ...(zoneId ? { zoneId } : {}),
      ...(color ? { color } : {}),
      notes,
    }, boundary, facilities);

    if (built.ok) {
      facilities.push(withSpecFields(withModelReference(built.value, item, options), item));
      const fields = indoorOnlyFields(item);
      if (fields.length > 0) lossy.push({ sourceId: item.id, fields });
    } else {
      skipped.push({ sourceId: item.id, reason: built.issue.message });
    }
  }

  return { facilities, skipped, lossy };
}
