import { describe, expect, it } from "vitest";
import { createStarterOutdoorPlan } from "./outdoor-project-store";
import {
  OUTDOOR_DRAFT_MAX_ITEMS,
  OUTDOOR_DRAFT_MAX_LINE,
  draftDemand,
  ringAreaM2,
} from "./outdoor-draft-design";
import type { PlanZone, SitePlanData } from "../../../../supabase/functions/_shared/site-plan";

const rect = (w: number, d: number) => [
  { x: 0, y: 0 },
  { x: w, y: 0 },
  { x: w, y: d },
  { x: 0, y: d },
];
const zone = (
  name: string,
  purpose: PlanZone["purpose"],
  w: number,
  d: number,
): PlanZone => ({
  id: crypto.randomUUID(),
  name,
  notes: "",
  semantic: "reserved",
  purpose,
  environment: "outdoor",
  polygon: rect(w, d),
});
const planWith = (...zones: PlanZone[]): SitePlanData => ({
  ...createStarterOutdoorPlan(),
  boundary: rect(100, 100),
  zones,
});

describe("ringAreaM2 —— 分区面积就是几何面积，不靠猜", () => {
  it("矩形面积按 ENU 米算", () => {
    expect(ringAreaM2(rect(10, 4))).toBe(40);
  });
  it("退化轮廓记 0，不当成有面积", () => {
    expect(ringAreaM2([{ x: 0, y: 0 }, { x: 10, y: 0 }])).toBe(0);
  });
});

describe("draftDemand —— 用户说「随便」时的默认方案", () => {
  it("市集摊位按面积反算：40㎡ → 5 摊（每摊含通道 8㎡）", () => {
    const draft = draftDemand(planWith(zone("摆摊区", "market", 10, 4)), {});
    expect(draft.items).toHaveLength(1);
    expect(draft.items[0]).toMatchObject({ zone: "摆摊区", query: "市集摊位", count: 5 });
    expect(draft.items[0]!.evidence).toContain("默认方案");
    expect(draft.items[0]!.evidence).toContain("未使用你给的数量");
  });

  it("超过协议单行上限就截断，并如实说明能放多少", () => {
    const draft = draftDemand(planWith(zone("大集市", "market", 60, 30)), {});
    // 1800㎡ / 8㎡ = 225，单行上限 200。
    expect(draft.items[0]!.count).toBe(OUTDOOR_DRAFT_MAX_LINE);
    expect(draft.zones[0]).toMatchObject({ capacity: 225, drawn: 200 });
    expect(draft.notes.join()).toContain("最多可放约 225 件");
    expect(draft.notes.join()).toContain("单次清单上限 200 件");
  });

  it("演出区给舞台 + 座席，座位不足同时人数时如实说差额", () => {
    const draft = draftDemand(planWith(zone("演出区", "performance", 20, 20)), { guests: 3000 });
    const stage = draft.items.find((i) => i.query === "舞台");
    const seats = draft.items.find((i) => i.query === "椅子");
    expect(stage?.count).toBe(1);
    // (400-48)*0.6/0.8 = 264，截到单行上限 200。
    expect(seats?.count).toBe(OUTDOOR_DRAFT_MAX_LINE);
    expect(draft.notes.join()).toContain("按面积可排约 264 座");
    expect(draft.notes.join()).toContain("低于同时 3000 人");
  });

  it("分区太小放不下舞台：不硬塞，也不假装排过", () => {
    const draft = draftDemand(planWith(zone("小舞台", "performance", 6, 6)), {});
    expect(draft.items).toHaveLength(0);
    expect(draft.notes.join()).toContain("放不下 8×6m 舞台");
  });

  it("观众区按 0.7 可排面积、0.8㎡/座，且不超过同时人数", () => {
    const draft = draftDemand(planWith(zone("观众区", "audience", 20, 10)), { guests: 100 });
    expect(draft.items[0]).toMatchObject({ query: "椅子", count: 100 });
  });

  it("服务区给最小可用套件，不按面积堆数量", () => {
    const draft = draftDemand(planWith(zone("服务区", "service", 5, 5)), {});
    expect(draft.items.map((i) => [i.query, i.count])).toEqual([
      ["桌子", 1],
      ["垃圾桶", 2],
      ["指示牌", 2],
    ]);
  });

  it("分区没有用途就不猜它放什么，明确说缺什么", () => {
    const draft = draftDemand(planWith(zone("空地", undefined, 10, 10)), {});
    expect(draft.items).toHaveLength(0);
    expect(draft.notes.join()).toContain("还没有用途");
  });

  it("没有分区时不产出清单，并指向先分区", () => {
    const draft = draftDemand(planWith(), {});
    expect(draft.items).toHaveLength(0);
    expect(draft.notes.join()).toContain("画布上还没有分区");
  });

  it("人数没定也能出方案：只按面积排，不做容量粗筛", () => {
    const draft = draftDemand(planWith(zone("摆摊区", "market", 10, 4)), {});
    expect(draft.items).toHaveLength(1);
    expect(draft.notes.join()).toContain("人数还没定");
  });

  it("同一输入永远同一输出（可单测、可复现）", () => {
    const plan = planWith(
      zone("摆摊区", "market", 10, 4),
      zone("服务区", "service", 5, 5),
      zone("演出区", "performance", 20, 20),
    );
    expect(draftDemand(plan, { guests: 800 })).toEqual(draftDemand(plan, { guests: 800 }));
  });

  it("产出满足协议约束：数量 1–200、evidence 非空且 ≤200 字、条目 ≤20", () => {
    const draft = draftDemand(
      planWith(
        zone("大集市", "market", 60, 30),
        zone("展览区", "exhibition", 30, 30),
        zone("演出区", "performance", 20, 20),
        zone("观众区", "audience", 20, 10),
        zone("服务区", "service", 5, 5),
      ),
      { guests: 3000 },
    );
    expect(draft.items.length).toBeGreaterThan(0);
    expect(draft.items.length).toBeLessThanOrEqual(OUTDOOR_DRAFT_MAX_ITEMS);
    for (const item of draft.items) {
      expect(Number.isInteger(item.count)).toBe(true);
      expect(item.count).toBeGreaterThanOrEqual(1);
      expect(item.count).toBeLessThanOrEqual(OUTDOOR_DRAFT_MAX_LINE);
      expect(item.evidence.length).toBeGreaterThan(0);
      expect(item.evidence.length).toBeLessThanOrEqual(200);
      expect(item.zone.length).toBeGreaterThan(0);
      expect(item.query.length).toBeGreaterThan(0);
    }
  });
});
