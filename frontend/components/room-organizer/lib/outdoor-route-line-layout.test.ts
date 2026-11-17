import { describe, expect, it } from "vitest";
import type { PlanPoint } from "../../../../supabase/functions/_shared/site-plan";
import {
  isRouteLineEvent,
  parseRouteLineDemand,
  proposeRouteLineLayout,
  referenceKindFor,
  routeLineIntent,
  type RouteLine,
} from "./outdoor-route-line-layout";
import { facilityFootprintRing } from "./site-plan-facilities";
import { planPointInRing } from "./site-plan-editing";

const boundary: PlanPoint[] = [
  { x: 0, y: 0 },
  { x: 200, y: 0 },
  { x: 200, y: 120 },
  { x: 0, y: 120 },
];

/** 一条横穿场地的地图道路：x 10→190，y=30，长 180 m。 */
const road: RouteLine = {
  id: "ofm:road/1",
  name: "滨河路",
  points: [
    { x: 10, y: 30 },
    { x: 190, y: 30 },
  ],
};

const counter = () => {
  let n = 0;
  return () => `00000000-0000-4000-9000-${String(++n).padStart(12, "0")}`;
};

describe("沿线排布（巡游/马拉松参照）", () => {
  it("认出沿线意图与赛事活动词，且不与岸线混淆；赛事词优先指线路", () => {
    expect(routeLineIntent("沿线摆补给站")).toBe(true);
    expect(routeLineIntent("沿着这条公路摆服务点")).toBe(true);
    expect(routeLineIntent("就沿着水岸线")).toBe(false);
    expect(isRouteLineEvent("马拉松")).toBe(true);
    expect(isRouteLineEvent("城市巡游")).toBe(true);
    expect(isRouteLineEvent("钓鱼比赛")).toBe(false);
    // 事件词优先：「沿着河边的路跑马拉松」是路跑，不是垂钓。
    expect(referenceKindFor("沿着河边的路跑马拉松")).toBe("route-line");
    expect(referenceKindFor("就沿着水岸线")).toBe("shoreline");
    expect(referenceKindFor("巡游沿线摆补给站")).toBe("route-line");
    expect(referenceKindFor("先排 30 个摊位")).toBeNull();
  });

  it("从一句话里读出补给站数量与间距", () => {
    expect(parseRouteLineDemand("6 个补给站，间隔 10 米")).toEqual({ stations: 6, spacingM: 10 });
    expect(parseRouteLineDemand("补给站12个")).toEqual({ stations: 12 });
    expect(parseRouteLineDemand("每 25 米一个水站")).toEqual({ spacingM: 25 });
    expect(parseRouteLineDemand("就沿着这条路线")).toEqual({});
  });

  it("沿线路落位：补给站贴线一侧、全部在边界内、起终点区与拱门齐备", () => {
    const result = proposeRouteLineLayout({ lines: [road], boundary }, counter());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const stations = result.layout.facilities.filter(f => f.name.startsWith("补给站"));
    expect(stations.length).toBeGreaterThanOrEqual(6);
    expect(result.layout.summary.stations).toBe(stations.length);
    expect(result.layout.summary.runLengthM).toBeCloseTo(180, 0);
    for (const station of stations) {
      const ring = facilityFootprintRing(station);
      expect(ring.every(p => planPointInRing(p, boundary))).toBe(true);
      // 路线在 y=30，站位（含后勤帐篷足迹）必须整体在线路一侧，不压赛道。
      expect(ring.every(p => p.y > 30.5)).toBe(true);
    }
    // 相邻补给站按缺省 20 m 间距排开。
    const xs = stations.map(s => s.position.x).sort((a, b) => a - b);
    for (let i = 1; i < xs.length; i++) expect(xs[i]! - xs[i - 1]!).toBeCloseTo(20, 1);
    // 地图参照：补一条赛事中心线（示意），起终点区与拱门节点齐备。
    expect(result.layout.routes).toHaveLength(1);
    expect(result.layout.routes[0]!.name).toContain("赛事线");
    expect(result.layout.routes[0]!.widthM).toBe(1);
    expect(result.layout.zones.some(z => z.semantic === "loading")).toBe(true);
    expect(result.layout.zones.some(z => z.semantic === "stage" && z.name.includes("起点"))).toBe(true);
    expect(result.layout.nodes.some(n => n.kind === "entry" && n.name.includes("起点"))).toBe(true);
    expect(result.layout.nodes.some(n => n.kind === "exit")).toBe(true);
    expect(result.layout.summary.warnings.join()).toContain("核对");
  });

  it("数量与间距按输入执行；放不下时如实给上限", () => {
    const five = proposeRouteLineLayout(
      { lines: [road], boundary, demand: { stations: 5, spacingM: 20 } },
      counter(),
    );
    expect(five.ok).toBe(true);
    if (five.ok) expect(five.layout.facilities.filter(f => f.name.startsWith("补给站"))).toHaveLength(5);

    const tooMany = proposeRouteLineLayout(
      { lines: [road], boundary, demand: { stations: 40, spacingM: 10 } },
      counter(),
    );
    expect(tooMany.ok).toBe(false);
    if (!tooMany.ok) {
      expect(tooMany.reason).toBe("too-short");
      // 起点区占 12 m，可用 168 m，按 10 m 间距最多 17 个。
      expect(tooMany.message).toContain("17");
    }
  });

  it("没有线路、或线路全在界外时，给可执行的下一步而不是空等", () => {
    const none = proposeRouteLineLayout({ lines: [], boundary }, counter());
    expect(none.ok).toBe(false);
    if (!none.ok) {
      expect(none.reason).toBe("no-line");
      expect(none.message).toContain("标注");
    }

    const outside: RouteLine = {
      id: "ofm:road/2",
      name: "界外公路",
      points: [
        { x: -60, y: -40 },
        { x: 260, y: -40 },
      ],
    };
    const off = proposeRouteLineLayout({ lines: [outside], boundary }, counter());
    expect(off.ok).toBe(false);
    if (!off.ok) expect(off.reason).toBe("outside-scope");
  });

  it("画布上已有的巡游线可直接作参照，不重复加赛道线，站位避开线路廊道", () => {
    const canvasLine: RouteLine = {
      id: "plan:route-1",
      name: "巡游线",
      points: [
        { x: 10, y: 30 },
        { x: 190, y: 30 },
      ],
      widthM: 3,
    };
    const result = proposeRouteLineLayout({ lines: [canvasLine], boundary }, counter());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // 画布线路自身就是赛道，不再重复补赛事中心线。
    expect(result.layout.routes).toHaveLength(0);
    // 站位避开线路廊道（widthM 3 → 廊道边缘 31.5 m，足迹内缘 32.5 m）。
    for (const station of result.layout.facilities.filter(f => f.name.startsWith("补给站"))) {
      const ring = facilityFootprintRing(station);
      expect(ring.every(p => p.y > 31.6)).toBe(true);
    }
  });
});
