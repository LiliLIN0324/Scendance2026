'use client';

/**
 * 2026-11-11 第二阶段：目录合并（设施模板 ↔ OnePlan 物件库）。
 *
 * 背景：画布「放设施」的可见目录早已换成 OnePlan 物件库（549 条贴纸，`oneplan:<kind>:<slug>`），
 * 但仓里还留着一套 8 条内置模板（`PLAN_FACILITY_TEMPLATES`），两套目录各有自己的名字/尺寸，
 * 导致同一个「帐篷」在 3D 物件类型、清单 typeLabel、图例里可能落到三个不同的名字。
 *
 * 这里把两套收成一套：
 * - 旧内置 templateId 仍可解析（历史数据不能坏），但它只是别名，指向同一个 `PlanPropKind`；
 * - `oneplan:` 模板按 slug 关键字落到同一个 `PlanPropKind` 与同一张 `PLAN_PROP_SIZE`；
 * - 清单 / 图例 / 3D 都走 `resolveFacilityTemplate` / `facilityTypeLabel`，不再直接漏出原始 id。
 *
 * 不改后端契约：`planFacilitySchema.templateId` 仍是自由字符串，旧值原样保留。
 */

import type { PlanPropKind } from './plan-footprint-geometry';
import { planPropKind } from './plan-footprint-geometry';
import { isLibraryTemplateId, parseLibraryTemplateId, libraryFootprint } from './oneplan-library';
import type { PlanFacilityTemplate } from './site-plan-facilities';
import { findFacilityTemplate } from './site-plan-facilities';

/** 3D 物件类型的中文名：清单/图例/属性面板都从这里取，避免三处各写一套。 */
export const FACILITY_KIND_LABELS: Record<PlanPropKind, string> = {
  tent: '帐篷',
  stage: '舞台',
  kiosk: '摊位',
  foodTruck: '餐车',
  toilet: '移动厕所',
  post: '岗亭',
  bin: '垃圾点',
  misc: '其他物件',
};

/**
 * 目录合并后的别名表：旧内置 templateId → 物件类型。
 * 与 `plan-footprint-geometry.ts` 的 `PROP_KIND_BY_TEMPLATE` 同源，这里只做只读再导出一份，
 * 让「目录合并」有一个可被人读到的入口（而不是散落在各处的 if）。
 */
export const LEGACY_FACILITY_TEMPLATE_KINDS: Readonly<Record<string, PlanPropKind>> = {
  'booth-2x2': 'kiosk',
  'tent-3x3': 'tent',
  'medical-tent-4x3': 'tent',
  'food-truck-6x2.5': 'foodTruck',
  'stage-platform-8x6': 'stage',
  'toilet-2.4x1.2': 'toilet',
  'security-post-1.5x1.5': 'post',
  'trash-point-1.2x1.2': 'bin',
};

/** 任意 templateId（内置别名 / `oneplan:` / 自定义）→ 3D 物件类型。 */
export function facilityKindOfTemplate(templateId: string): PlanPropKind {
  return LEGACY_FACILITY_TEMPLATE_KINDS[templateId] ?? planPropKind(templateId);
}

/**
 * 任意 templateId → 模板描述（名字 / 占地 / 备注）。
 *
 * 顺序：内置精确命中（历史数据保留原尺寸，如医疗帐篷 4×3）→ `oneplan:` 条目（按物件类型给默认占地）
 * → 其他未知 id 返回 null（调用方回落到原始 id 或 `facilityTypeLabel`）。
 */
export function resolveFacilityTemplate(templateId: string): PlanFacilityTemplate | null {
  const builtin = findFacilityTemplate(templateId);
  if (builtin) return builtin;
  if (!isLibraryTemplateId(templateId)) return null;
  const parsed = parseLibraryTemplateId(templateId);
  if (!parsed) return null;
  const kind = facilityKindOfTemplate(templateId);
  const size = libraryFootprint({ slug: parsed.slug, kind: parsed.kind });
  const label = FACILITY_KIND_LABELS[kind];
  return {
    templateId,
    name: label,
    width: size.width,
    depth: size.depth,
    note: `${parsed.kind}:${parsed.slug}`,
  };
}

/**
 * 人读类型名：清单 / 图例 / 属性面板共用。
 * - 内置与 `oneplan:` 都能解析出中文名；
 * - 未知自定义 id 原样返回，方便用户认出自己填的 templateId。
 */
export function facilityTypeLabel(templateId: string): string {
  return resolveFacilityTemplate(templateId)?.name ?? templateId;
}