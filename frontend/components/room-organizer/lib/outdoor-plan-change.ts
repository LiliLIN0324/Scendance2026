/**
 * 「这次改了什么」——把两版 plan 的差异折成用户能核对的范围描述。
 *
 * 2026-11-20 场地自主规划交互 P1：局部调整后要能说清新增 / 移动 / 删除分别多少、落在哪些分区。
 * 纯函数，不改 plan；真源仍是 `SitePlanData`，这里只读。
 *
 * 口径：
 * - 「移动」只认位置或朝向变化，尺寸变化单列，避免把换尺寸说成挪位置。
 * - 「删除」按 id 消失判定；ID 换新 = 新增 + 删除，不猜成同一件。
 * - 范围用分区名表达（没有分区名就写到米制坐标），不编造区域语义。
 */
import type { SitePlanData } from "../../../../supabase/functions/_shared/site-plan";

export interface PlanChange {
  added: string[];
  removed: string[];
  moved: string[];
  resized: string[];
  zonesAdded: string[];
  zonesRemoved: string[];
}

export interface PlanChangeSummary {
  headline: string;
  details: string[];
  addedCount: number;
  movedCount: number;
  removedCount: number;
  /** 受影响物件所在的分区名（去重，最多 4 个）。 */
  ranges: string[];
  /** 没有任何改动。 */
  empty: boolean;
}

const ID_KINDS = ["facilities", "zones", "routes", "nodes", "workers"] as const;

function byId<T extends { id: string }>(items: readonly T[] | undefined): Map<string, T> {
  return new Map((items ?? []).map((item) => [item.id, item]));
}

const samePosition = (a: { position?: { x: number; y: number } }, b: { position?: { x: number; y: number } }) =>
  Math.abs((a.position?.x ?? 0) - (b.position?.x ?? 0)) < 1e-6 &&
  Math.abs((a.position?.y ?? 0) - (b.position?.y ?? 0)) < 1e-6;

/** 只比较物件（设施）的位移/尺寸，加上分区增删——这正是局部调整会动到的东西。 */
export function diffPlanObjects(before: SitePlanData, after: SitePlanData): PlanChange {
  const beforeFacilities = byId(before.facilities);
  const afterFacilities = byId(after.facilities);
  const added: string[] = [];
  const removed: string[] = [];
  const moved: string[] = [];
  const resized: string[] = [];

  for (const [id, next] of afterFacilities) {
    const previous = beforeFacilities.get(id);
    if (!previous) {
      added.push(id);
      continue;
    }
    if (!samePosition(previous, next) || (previous.rotationDeg ?? 0) !== (next.rotationDeg ?? 0)) {
      moved.push(id);
    } else if (
      Math.abs(previous.size.width - next.size.width) > 1e-6 ||
      Math.abs(previous.size.depth - next.size.depth) > 1e-6
    ) {
      resized.push(id);
    }
  }
  for (const id of beforeFacilities.keys()) {
    if (!afterFacilities.has(id)) removed.push(id);
  }

  const zonesBefore = new Set((before.zones ?? []).map((zone) => zone.id));
  const zonesAfter = new Set((after.zones ?? []).map((zone) => zone.id));
  return {
    added,
    removed,
    moved,
    resized,
    zonesAdded: [...zonesAfter].filter((id) => !zonesBefore.has(id)),
    zonesRemoved: [...zonesBefore].filter((id) => !zonesAfter.has(id)),
  };
}

/** 除物件外的实体是否也被改动（用于「这次不只是挪东西」的如实提示）。 */
export function otherEntitiesChanged(before: SitePlanData, after: SitePlanData): string[] {
  const changed: string[] = [];
  const labels: Record<(typeof ID_KINDS)[number], string> = {
    facilities: "物件",
    zones: "分区",
    routes: "流线",
    nodes: "出入口",
    workers: "人员",
  };
  for (const kind of ID_KINDS) {
    if (kind === "facilities") continue;
    if (JSON.stringify(before[kind] ?? []) !== JSON.stringify(after[kind] ?? [])) {
      changed.push(labels[kind]);
    }
  }
  return changed;
}

/** 受影响物件落在哪些分区；找不到分区时用米制中心点，不编分区名。 */
export function affectedRanges(plan: SitePlanData, ids: readonly string[]): string[] {
  const zones = new Map(plan.zones.map((zone) => [zone.id, zone.name]));
  const names = new Set<string>();
  for (const id of ids) {
    const facility = plan.facilities.find((item) => item.id === id);
    if (!facility) continue;
    const zoneName = facility.zoneId ? zones.get(facility.zoneId) : undefined;
    names.add(zoneName ?? `(${facility.position.x.toFixed(1)}, ${facility.position.y.toFixed(1)}) m`);
  }
  return [...names].slice(0, 4);
}

export function describePlanChange(change: PlanChange, after: SitePlanData): PlanChangeSummary {
  const affectedIds = [...change.added, ...change.moved, ...change.resized];
  const ranges = affectedRanges(after, affectedIds);
  const addedCount = change.added.length;
  const movedCount = change.moved.length;
  const removedCount = change.removed.length;
  const resizedCount = change.resized.length;
  const zoneNote = [
    change.zonesAdded.length ? `新增 ${change.zonesAdded.length} 个分区` : "",
    change.zonesRemoved.length ? `删除 ${change.zonesRemoved.length} 个分区` : "",
  ].filter(Boolean);

  if (!addedCount && !movedCount && !removedCount && !resizedCount && !zoneNote.length) {
    return { headline: "这次没有改动画布", details: [], addedCount, movedCount, removedCount, ranges: [], empty: true };
  }

  const parts = [
    addedCount ? `新增 ${addedCount}` : "",
    movedCount ? `移动 ${movedCount}` : "",
    resizedCount ? `改尺寸 ${resizedCount}` : "",
    removedCount ? `删除 ${removedCount}` : "",
    ...zoneNote,
  ].filter(Boolean);
  const details = [
    addedCount ? `新增落在：${affectedRanges(after, change.added).join("、") || "未归属分区"}` : "",
    movedCount ? `移动范围：${affectedRanges(after, change.moved).join("、") || "未归属分区"}` : "",
    removedCount ? `删除 ${removedCount} 件，可在撤销后核对原位置` : "",
  ].filter(Boolean);

  return {
    headline: parts.join(" · "),
    details,
    addedCount,
    movedCount,
    removedCount,
    ranges,
    empty: false,
  };
}
