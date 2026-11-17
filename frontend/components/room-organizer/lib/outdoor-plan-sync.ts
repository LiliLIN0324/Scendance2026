/**
 * 户外活动本体入库（2026-11-17「换设备继续编辑整个活动」+ 版本保护）。
 *
 * 口径：
 *  - **本机仍先落盘**（`saveOutdoorProjectRecord`），后端是副本；推送失败不影响编辑；
 *  - 第一次推送时后端发号 `activityId`，本机记住它，之后都按「本机 id + 版本号」推；
 *  - 每次推送带 `baseRevision`：跟服务器一致才写入并 +1；不一致返回 **conflict**，
 *    本次**不落库、不覆盖**——由用户决定以哪一版为准；
 *  - 一切异常都收敛成 `skipped`，不往上抛，不阻断画布。
 */

import type { BackendSession } from "@/lib/backend-session";
import type { SitePlanData } from "../../../../supabase/functions/_shared/site-plan";
import type { OutdoorProjectRecord } from "./outdoor-project-store";

export type PlanSyncOutcome =
  | { status: "saved"; remoteActivityId: string; remoteRevision: number }
  | { status: "conflict"; remoteRevision: number; remoteName: string }
  | { status: "skipped"; reason: "no-session" | "no-plan" | "failed" };

type PlanSyncSession = Pick<BackendSession, "saveOutdoorPlan"> &
  Partial<Pick<BackendSession, "listOutdoorPlans" | "getOutdoorPlan">>;

/** 把当前规划推成后端副本；冲突时**不改**本机记录，交由上层提示。 */
export async function pushOutdoorPlan(
  session: PlanSyncSession | null | undefined,
  record: OutdoorProjectRecord,
  plan: SitePlanData | null,
): Promise<PlanSyncOutcome> {
  if (!session?.saveOutdoorPlan) return { status: "skipped", reason: "no-session" };
  if (!plan) return { status: "skipped", reason: "no-plan" };
  try {
    const result = await session.saveOutdoorPlan({
      ...(record.remoteActivityId ? { activityId: record.remoteActivityId } : {}),
      localActivityId: record.projectId,
      ...(typeof record.remoteRevision === "number" ? { baseRevision: record.remoteRevision } : {}),
      name: record.name,
      plan,
    });
    if (result.conflict) {
      return {
        status: "conflict",
        remoteRevision: result.revision,
        remoteName: result.name,
      };
    }
    return {
      status: "saved",
      remoteActivityId: result.activityId,
      remoteRevision: result.revision,
    };
  } catch {
    return { status: "skipped", reason: "failed" };
  }
}

/**
 * 用户在冲突提示里选了「用我这版」：带 `force` 越过版本比对覆盖服务器。
 * 仍然会 +1 版本，避免第三台设备又拿旧 baseRevision 乱写。
 */
export async function forcePushOutdoorPlan(
  session: Pick<BackendSession, "saveOutdoorPlan"> | null | undefined,
  record: OutdoorProjectRecord,
  plan: SitePlanData | null,
): Promise<PlanSyncOutcome> {
  if (!session?.saveOutdoorPlan) return { status: "skipped", reason: "no-session" };
  if (!plan) return { status: "skipped", reason: "no-plan" };
  try {
    const result = await session.saveOutdoorPlan({
      ...(record.remoteActivityId ? { activityId: record.remoteActivityId } : {}),
      localActivityId: record.projectId,
      name: record.name,
      plan,
      force: true,
    });
    if (result.conflict) {
      return { status: "conflict", remoteRevision: result.revision, remoteName: result.name };
    }
    return { status: "saved", remoteActivityId: result.activityId, remoteRevision: result.revision };
  } catch {
    return { status: "skipped", reason: "failed" };
  }
}

/** 冲突/首次接入时，把「以服务器为准」的那一版读回来；读不到返回 null。 */
export async function pullOutdoorPlan(
  session: Pick<BackendSession, "getOutdoorPlan"> | null | undefined,
  activityId: string | undefined,
): Promise<{ name: string; revision: number; plan: SitePlanData } | null> {
  if (!session?.getOutdoorPlan || !activityId) return null;
  try {
    const snapshot = await session.getOutdoorPlan(activityId);
    if (!snapshot.found || !snapshot.plan) return null;
    return {
      name: snapshot.name ?? "",
      revision: snapshot.revision ?? 0,
      plan: snapshot.plan as SitePlanData,
    };
  } catch {
    return null;
  }
}
