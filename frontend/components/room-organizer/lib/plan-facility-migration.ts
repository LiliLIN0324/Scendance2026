/**
 * M2 facility 执行器纯函数：消费 `plan-facility-mapping` 的四档落点，把室内物件迁成 `PlanFacility`。
 *
 * 口径：
 * - 不接壳体调用、不拆旧链、不加载 manifest；`oneplan` 条目纯函数层拿不到库条目尺寸，
 *   先用 misc 兜底 2×2，templateId 保留 slug 供渲染层反查贴纸，落位后由 libraryEntry 校准；
 * - `builtin` 直连内置模板目录；`misc` 用动态兜底模板；`skip`（墙体/人员）进 skipped；
 * - 实体一律经 `buildFacility` 工厂构建，失败进 skipped 不留半成品；
 * - 室内 item 无显式 zoneId，归属留空，下一轮按落点命中口径补；特化字段（WiFi/CCTV/锥角/glb 等）
 *   本轮不落 notes，归属终稿定后再接。
 */

import type { PlanFacility, PlanPoint } from '../../../../supabase/functions/_shared/site-plan';
import type { FurnitureItem, RoomLayout } from './types';
import { resolveFacilityTarget } from './plan-facility-mapping';
import { buildFacility, type PlanFacilityTemplate } from './site-plan-facilities';
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

export interface FacilityMigrationSkip {
  sourceId: string;
  reason: string;
}

export interface FacilityMigrationResult {
  facilities: PlanFacility[];
  skipped: FacilityMigrationSkip[];
}

/** 弧度 → 平面角度：参照 `floor-reading.ts:166` 既有口径取反，钳制由工厂完成。 */
function rotationDeg(item: FurnitureItem): number {
  const rad = item.rotation ?? 0;
  return Number.isFinite(rad) ? -(rad * 180) / Math.PI : 0;
}

/** 动态兜底模板：oneplan 条目与 misc 占位共用，尺寸待接线校准。 */
function fallbackTemplate(templateId: string, name: string): PlanFacilityTemplate {
  return {
    templateId,
    name,
    width: FALLBACK_WIDTH,
    depth: FALLBACK_DEPTH,
    note: '旧室内物件占位（尺寸待接线校准）',
  };
}

export function migrateFacilities(
  layout: Pick<RoomLayout, 'width' | 'height' | 'floors'>,
  boundary: readonly PlanPoint[],
  gen: MigrationUuidGen = () => crypto.randomUUID(),
): FacilityMigrationResult {
  const frame = makeFrame(boundary, layout.width, layout.height);
  const facilities: PlanFacility[] = [];
  const skipped: FacilityMigrationSkip[] = [];

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
    const color = hexOrUndefined(item.color);
    const name = (item.name ?? '').trim().slice(0, 60) || FALLBACK_NAME;
    const rotationDegValue = rotationDeg(item);
    const templateId = target.kind === 'builtin'
      ? target.templateId
      : target.kind === 'oneplan'
        ? target.templateId
        : 'misc';
    const template = target.kind === 'builtin'
      ? undefined
      : fallbackTemplate(templateId, name);

    const built = buildFacility({
      id: gen(),
      templateId,
      ...(template ? { template } : {}),
      position,
      rotationDeg: rotationDegValue,
      name,
      ...(color ? { color } : {}),
      notes: '',
    }, boundary, facilities);

    if (built.ok) {
      facilities.push(built.value);
    } else {
      skipped.push({ sourceId: item.id, reason: built.issue.message });
    }
  }

  return { facilities, skipped };
}
