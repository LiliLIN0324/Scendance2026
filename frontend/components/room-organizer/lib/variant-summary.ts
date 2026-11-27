import type { SitePlanData } from '../../../../supabase/functions/_shared/site-plan';
import type { RoomLayout, VariantSaveMeta, VariantSummary } from './types';

/**
 * 椅/桌分类口径与 `scene-layers.ts` 的 `materialLayers` 保持同一组正则，
 * 避免两处分类漂移；结构件（出入口/开洞/柱）不进椅/桌分组，计入其余物料。
 */
const CHAIR_RE = /chair|seat|sofa|椅|座|沙发/i;
const TABLE_RE = /table|desk|桌/i;

function isStructural(item: { venueEntranceId?: string; structuralOpeningId?: string; structuralColumnId?: string }): boolean {
  return Boolean(item.venueEntranceId || item.structuralOpeningId || item.structuralColumnId);
}

/**
 * 从一份保存时刻的布局摘出不可变摘要兜底。纯函数：不修改入参，不碰存储。
 * 活动/计划/扫描缺省或未知时计数归零、人数省略，不用当前值顶替。
 */
export function summarizeVariant(layout: RoomLayout): VariantSummary {
  let itemCount = 0;
  let chairCount = 0;
  let tableCount = 0;
  let zoneCount = 0;

  for (const floor of layout.floors ?? []) {
    for (const item of floor.items ?? []) {
      itemCount += 1;
      if (isStructural(item)) continue;
      const type = `${item.materialId ?? ''} ${item.type} ${item.name}`;
      if (CHAIR_RE.test(type)) chairCount += 1;
      else if (TABLE_RE.test(type)) tableCount += 1;
    }
    zoneCount += (floor.zones ?? []).length;
  }

  const otherItemCount = Math.max(0, itemCount - chairCount - tableCount);
  const headcountRaw = layout.eventProfile?.expectedAttendance?.value;
  const headcount = typeof headcountRaw === 'number' && Number.isFinite(headcountRaw) ? headcountRaw : undefined;

  const summary: VariantSummary = {
    taskCount: layout.eventOperations?.tasks?.length ?? 0,
    acquisitionCount: layout.productionPlan?.acquisitions?.length ?? 0,
    staffingCount: layout.productionPlan?.staffing?.length ?? 0,
    estimateCount: layout.productionPlan?.estimates?.length ?? 0,
    itemCount,
    chairCount,
    tableCount,
    otherItemCount,
    zoneCount,
  };
  if (headcount !== undefined) summary.headcount = headcount;
  return summary;
}

/**
 * 组装保存变体时挂接的元数据（refs + 扫描身份 + 冻结摘要）。
 * `plan` 为空（legacy 草稿无绑定 plan 记录）时返回 `undefined`：调用方不传 meta，
 * 沿用旧整包内嵌副本兼容，不挂悬空 ref，也不另造变体专属侧车桶。
 */
export function buildVariantSaveMeta(
  layout: RoomLayout,
  plan: SitePlanData | null | undefined,
): VariantSaveMeta | undefined {
  if (!plan) return undefined;
  const meta: VariantSaveMeta = { summary: summarizeVariant(layout) };
  if (plan.operationsRef) meta.operationsRef = plan.operationsRef;
  if (plan.planRef) meta.planRef = plan.planRef;
  if (plan.scan) meta.scan = plan.scan;
  return meta;
}
