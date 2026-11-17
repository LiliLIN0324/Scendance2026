/**
 * 换设备「找回活动列表」（2026-11-17，用户：最后一件）。
 *
 * 口径：
 *  - 只读后端清单，**不写任何东西**；列表里每条是后端发号的 `activityId`；
 *  - 「打开」时才拉回整份 plan 并落本机记录（本机仍先落盘，后端只是副本）；
 *  - 任何失败都收敛成空列表/`null`，界面安静退回本机草稿——不弹错。
 */

import type { BackendSession, OutdoorPlanSnapshot, OutdoorPlanSummary } from "@/lib/backend-session";
import type { SitePlanData } from "../../../../supabase/functions/_shared/site-plan";
import { readOutdoorProjectRecord, saveOutdoorProjectRecord, type OutdoorProjectRecord } from "./outdoor-project-store";

/** 列表里能直接给人看的一条。 */
export interface AdoptableActivity {
  activityId: string;
  name: string;
  revision: number;
  updatedAt: string;
  /** 后端记下的本机活动 id（同一活动在别的设备上的名字），没有就按 activityId 生成。 */
  localActivityId: string;
}

/**
 * 落到本机时用哪个 projectId：
 *  - 后端记过 `localActivityId` 就沿用（同一活动在两台设备上 id 一致，历史也跟着走）；
 *  - 没有就用 `cloud-<前 8 位>`，稳定、可读、不会撞。
 */
export function localIdForActivity(input: { activityId: string; localActivityId?: string | null }): string {
  const local = input.localActivityId?.trim();
  if (local) return local;
  return `cloud-${input.activityId.slice(0, 8)}`;
}

/** 后端摘要 → 界面用的条目（时间按新到旧排）。 */
export function describeActivities(summaries: readonly OutdoorPlanSummary[]): AdoptableActivity[] {
  return summaries
    .filter(summary => summary && typeof summary.activityId === "string" && summary.activityId.length > 0)
    .map(summary => ({
      activityId: summary.activityId,
      name: summary.name?.trim() || "未命名活动",
      revision: Number.isFinite(summary.revision) ? summary.revision : 0,
      updatedAt: summary.updatedAt ?? "",
      localActivityId: localIdForActivity(summary),
    }))
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));
}

/** 列后端活动；未登录/失败/空都返回 `[]`（界面据此安静退回）。 */
export async function listAdoptableActivities(
  session: Pick<BackendSession, "listOutdoorPlans"> | null | undefined,
): Promise<AdoptableActivity[]> {
  if (!session?.listOutdoorPlans) return [];
  try {
    const summaries = await session.listOutdoorPlans();
    return describeActivities(Array.isArray(summaries) ? summaries : []);
  } catch {
    return [];
  }
}

/** 拉回一份活动并落本机记录；读不到/写不进都返回 null。 */
export async function adoptOutdoorActivity(
  session: Pick<BackendSession, "getOutdoorPlan"> | null | undefined,
  activity: Pick<AdoptableActivity, "activityId" | "localActivityId" | "name" | "revision">,
): Promise<{ projectId: string; record: OutdoorProjectRecord } | null> {
  if (!session?.getOutdoorPlan) return null;
  let snapshot: OutdoorPlanSnapshot;
  try {
    snapshot = await session.getOutdoorPlan(activity.activityId);
  } catch {
    return null;
  }
  if (!snapshot?.found || !snapshot.plan) return null;
  const projectId = localIdForActivity(activity);
  const existing = readOutdoorProjectRecord(projectId);
  const record: OutdoorProjectRecord = {
    v: 1,
    projectId,
    name: snapshot.name?.trim() || activity.name || "户外规划",
    createdAt: existing?.createdAt ?? new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    plan: snapshot.plan as SitePlanData,
    remoteActivityId: activity.activityId,
    remoteRevision: snapshot.revision ?? activity.revision,
  };
  try {
    // 远端 plan 过 schema 才落盘；不合法就当作没这份，别把画布弄坏。
    saveOutdoorProjectRecord(record);
  } catch {
    return null;
  }
  return { projectId, record };
}
