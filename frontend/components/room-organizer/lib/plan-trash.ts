/**
 * 设施软删除（2026-11-17）：删除先入回收站，导出/统计/3D 自然不再包含。
 *
 * 纯函数，零 React / 零 three；调用方只负责 commitPlan（可撤销）与刷新面板。
 */

import type { PlanFacility, SitePlanData } from '../../../../supabase/functions/_shared/site-plan';

export interface PlanTrashEntry {
  id: string;
  deletedAt: string;
  facility: PlanFacility;
}

const MAX_TRASH = 200;

/** 删除设施 → 移入回收站；设施不存在返回 null（调用方据此提示，不静默吞掉）。 */
export function moveFacilityToTrash(
  plan: SitePlanData,
  facilityId: string,
  now: string = new Date().toISOString(),
): SitePlanData | null {
  const facility = plan.facilities.find(item => item.id === facilityId);
  if (!facility) return null;
  const entry: PlanTrashEntry = { id: facility.id, deletedAt: now, facility };
  return {
    ...plan,
    facilities: plan.facilities.filter(item => item.id !== facilityId),
    trash: [entry, ...(plan.trash ?? [])].slice(0, MAX_TRASH),
  };
}

/** 从回收站恢复；条目不存在返回 null。已存在同 id 时只清回收站，不重复插入。 */
export function restoreFacilityFromTrash(plan: SitePlanData, entryId: string): SitePlanData | null {
  const entry = plan.trash?.find(item => item.id === entryId);
  if (!entry) return null;
  const trash = (plan.trash ?? []).filter(item => item.id !== entryId);
  if (plan.facilities.some(item => item.id === entry.facility.id)) {
    return { ...plan, trash };
  }
  return { ...plan, facilities: [...plan.facilities, entry.facility], trash };
}
