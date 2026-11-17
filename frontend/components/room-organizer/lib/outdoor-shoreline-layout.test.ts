import { describe, expect, it } from "vitest";
import type { PlanPoint } from "../../../../supabase/functions/_shared/site-plan";
import {
  parseShorelineDemand,
  proposeShorelineLayout,
  shorelineIntent,
  type Shoreline,
} from "./outdoor-shoreline-layout";
import { facilityFootprintRing } from "./site-plan-facilities";
import { planPointInRing } from "./site-plan-editing";

const boundary: PlanPoint[] = [
  { x: 0, y: 0 },
  { x: 200, y: 0 },
  { x: 200, y: 120 },
  { x: 0, y: 120 },
];

/** 南侧湖面：环顶边 y=6 落在边界内，是真正可用的那段岸线。 */
const lake: Shoreline = {
  id: "ofm:water/0",
  name: "西湖",
  closed: true,
  points: [
    { x: 10, y: -20 },
    { x: 190, y: -20 },
    { x: 190, y: 6 },
    { x: 10, y: 6 },
  ],
};

const counter = () => {
  let n = 0;
  return () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
};

describe("沿岸排布（2026-11-17「就沿着水岸线」）", () => {
  it("认出沿岸意图，不把普通需求误判成沿岸", () => {
    expect(shorelineIntent("就沿着水岸线")).toBe(true);
    expect(shorelineIntent("钓位沿着岸边排")).toBe(true);
    expect(shorelineIntent("观众区靠着湖边")).toBe(true);
    expect(shorelineIntent("这里要办一个钓鱼比赛")).toBe(false);
    expect(shorelineIntent("先排 30 个摊位")).toBe(false);
  });

  it("从一句话里读出钓位数量、间距与观众区纵深", () => {
    expect(parseShorelineDemand("30 个钓位，间隔 8 米")).toEqual({ stations: 30, spacingM: 8 });
    expect(parseShorelineDemand("钓位 12 个，观众区退 3 米")).toEqual({ stations: 12, audienceDepthM: 3 });
    expect(parseShorelineDemand("就沿着水岸线")).toEqual({});
  });

  it("沿真实岸线落位：钓位贴岸、全部在边界内、不压水", () => {
    const result = proposeShorelineLayout({ shorelines: [lake], boundary }, counter());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const stations = result.layout.facilities.filter(f => f.name.startsWith("钓位"));
    expect(stations.length).toBeGreaterThan(10);
    expect(result.layout.summary.stations).toBe(stations.length);
    expect(result.layout.summary.runLengthM).toBeCloseTo(180, 0);
    for (const station of stations) {
      const ring = facilityFootprintRing(station);
      expect(ring.every(p => planPointInRing(p, boundary))).toBe(true);
      // 湖面在 y<6，钓位必须整块在岸上。
      expect(ring.every(p => p.y > 6)).toBe(true);
      expect(ring.some(p => planPointInRing(p, lake.points))).toBe(false);
    }
    // 相邻钓位按 8 m 间距排开（沿 x 轴）。
    const xs = stations.map(s => s.position.x).sort((a, b) => a - b);
    for (let i = 1; i < xs.length; i++) expect(xs[i]! - xs[i - 1]!).toBeCloseTo(8, 1);
    expect(result.layout.zones.some(z => z.semantic === "audience")).toBe(true);
    expect(result.layout.routes[0]?.widthM).toBe(3);
    expect(result.layout.summary.warnings.join()).toContain("现场核对");
  });

  it("说了几个就排几个；放不下时如实拒绝并给出上限", () => {
    const five = proposeShorelineLayout(
      { shorelines: [lake], boundary, demand: { stations: 5, spacingM: 10 } },
      counter(),
    );
    expect(five.ok).toBe(true);
    if (five.ok) expect(five.layout.facilities.filter(f => f.name.startsWith("钓位"))).toHaveLength(5);

    const tooMany = proposeShorelineLayout(
      { shorelines: [lake], boundary, demand: { stations: 40, spacingM: 8 } },
      counter(),
    );
    expect(tooMany.ok).toBe(false);
    if (!tooMany.ok) {
      expect(tooMany.reason).toBe("too-short");
      expect(tooMany.message).toContain("23");
    }
  });

  it("没有水系、或水岸全在界外时，给出可执行的下一步而不是空等", () => {
    const none = proposeShorelineLayout({ shorelines: [], boundary }, counter());
    expect(none.ok).toBe(false);
    if (!none.ok) {
      expect(none.reason).toBe("no-water");
      expect(none.message).toContain("标注");
    }

    const outside: Shoreline = {
      id: "ofm:river/1",
      name: "界外河道",
      closed: false,
      points: [
        { x: -40, y: -40 },
        { x: 240, y: -40 },
      ],
    };
    const off = proposeShorelineLayout({ shorelines: [outside], boundary }, counter());
    expect(off.ok).toBe(false);
    if (!off.ok) expect(off.reason).toBe("outside-scope");
  });
});
