import { describe, expect, it } from "vitest";
import { affectedRanges, describePlanChange, diffPlanObjects, otherEntitiesChanged } from "./outdoor-plan-change";
import type { SitePlanData } from "../../../../supabase/functions/_shared/site-plan";

const facility = (id: string, x: number, y: number, zoneId = "z1") => ({
  id,
  templateId: "oneplan:chair",
  name: `椅 ${id}`,
  zoneId,
  position: { x, y },
  rotationDeg: 0,
  size: { width: 0.5, depth: 0.55 },
  notes: "",
});

const base = (): SitePlanData => ({
  schemaVersion: 1,
  boundary: [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 20 }, { x: 0, y: 20 }],
  zones: [{
    id: "z1", name: "宴席区",
    semantic: "audience" as const,
    notes: "",
    polygon: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }],
  }],
  facilities: [facility("a", 1, 1), facility("b", 2, 2), facility("c", 3, 3)],
  routes: [],
  nodes: [],
  workers: [],
});

describe("本次变化摘要", () => {
  it("分清新增、移动、删除，并按分区说明范围", () => {
    const before = base();
    const after: SitePlanData = {
      ...before,
      facilities: [
        { ...before.facilities[0]!, position: { x: 1, y: 3 } },
        before.facilities[1]!,
        facility("d", 5, 5),
      ],
    };
    const change = diffPlanObjects(before, after);
    expect(change.moved).toEqual(["a"]);
    expect(change.added).toEqual(["d"]);
    expect(change.removed).toEqual(["c"]);

    const summary = describePlanChange(change, after);
    expect(summary.headline).toBe("新增 1 · 移动 1 · 删除 1");
    expect(summary.ranges).toEqual(["宴席区"]);
    expect(summary.details).toContain("删除 1 件，可在撤销后核对原位置");
    expect(summary.empty).toBe(false);
  });

  it("尺寸变化不冒充位移", () => {
    const before = base();
    const after: SitePlanData = {
      ...before,
      facilities: before.facilities.map((item) =>
        item.id === "a" ? { ...item, size: { width: 0.8, depth: 0.55 } } : item,
      ),
    };
    const change = diffPlanObjects(before, after);
    expect(change.moved).toEqual([]);
    expect(change.resized).toEqual(["a"]);
  });

  it("没有改动时说没有改动，不编一条变化", () => {
    const before = base();
    expect(describePlanChange(diffPlanObjects(before, structuredClone(before)), before)).toMatchObject({
      headline: "这次没有改动画布",
      empty: true,
      details: [],
    });
  });

  it("分区被改名/改形状算其它实体变化，另起一行提示", () => {
    const before = base();
    const after: SitePlanData = { ...before, zones: before.zones.map((zone) => ({ ...zone, name: "主宴席区" })) };
    expect(otherEntitiesChanged(before, after)).toEqual(["分区"]);
    expect(affectedRanges(before, ["a"])).toEqual(["宴席区"]);
  });
});
