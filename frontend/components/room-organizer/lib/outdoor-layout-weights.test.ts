import { describe, expect, it, vi } from "vitest";
import {
  buildLayoutEvidence,
  layoutWeightForFeature,
} from "./outdoor-layout-weights";
import { createOutdoorMapContext } from "./outdoor-map-context";
import { createStarterOutdoorPlan } from "./outdoor-project-store";
import { understandOutdoorTurn } from "./outdoor-agent-understanding";
import { emptyOutdoorFlow } from "./outdoor-agent-contract";
import { buildSiteSnapshot, buildModelContext } from "@/lib/site-intelligence";
import type { MapFeature } from "@/lib/site-intelligence/types";
import { siteWgsCenter } from "../../../../functions/api/site-context";
import { enuToLngLat } from "./outdoor-plan-canvas";
import type { SitePlanData } from "../../../../supabase/functions/_shared/site-plan";

// 活动范围：80×70m 矩形，中心 (0,0)，西南角 (-40,-35)。
const BOUNDARY = [
  { x: -40, y: -35 },
  { x: 40, y: -35 },
  { x: 40, y: 35 },
  { x: -40, y: 35 },
];

function feature(
  id: number,
  kind: string,
  name: string,
  ring: Array<[number, number]>,
  tags: Record<string, string>,
  type: "polygon" | "line" = "polygon",
): MapFeature {
  return {
    id: `osm:way/${id}`,
    kind: kind as MapFeature["kind"],
    name,
    geometry: { type, points: ring.map(([x, y]) => ({ x, y })) },
    tags,
    evidence: {
      source: "osm",
      sourceId: `osm:way/${id}`,
      certainty: "mapped",
      note: "测试用地图要素",
    },
  };
}

function ring(
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
): Array<[number, number]> {
  return [
    [minX, minY],
    [maxX, minY],
    [maxX, maxY],
    [minX, maxY],
  ];
}

describe("docs/47 A2 证据分级（layoutWeight 三档）", () => {
  it("水域与围栏=hard-block（禁区）", () => {
    expect(layoutWeightForFeature({ kind: "water", tags: { natural: "water" } })).toEqual({
      weight: "hard-block",
      surface: "water",
    });
    expect(layoutWeightForFeature({ kind: "water", tags: { waterway: "riverbank" } })).toEqual({
      weight: "hard-block",
      surface: "water",
    });
    expect(layoutWeightForFeature({ kind: "barrier", tags: { barrier: "fence" } })).toEqual({
      weight: "hard-block",
      surface: "barrier",
    });
    expect(layoutWeightForFeature({ kind: "barrier", tags: { barrier: "wall" } })).toEqual({
      weight: "hard-block",
      surface: "barrier",
    });
  });

  it("绿地=soft-avoid（可摆但有代价）：leisure 与 landcover 两族标签都算", () => {
    for (const tags of [
      { leisure: "park" },
      { leisure: "garden" },
      // OpenFreeMap planet 层（A1 实测）：城市绿地多边形在 landcover 层。
      { landcover: "grass" },
      { landcover: "wood" },
      // 服务端 Overpass：landuse=grass。
      { landuse: "grass" },
    ]) {
      expect(layoutWeightForFeature({ kind: "open-space", tags })).toEqual({
        weight: "soft-avoid",
        surface: "green",
      });
    }
  });

  it("广场铺装=info（利好）：place=square / amenity=parking / 铺装开放空间", () => {
    expect(layoutWeightForFeature({ kind: "open-space", tags: { place: "square" } })).toEqual({
      weight: "info",
      surface: "paved",
    });
    expect(layoutWeightForFeature({ kind: "open-space", tags: { amenity: "parking" } })).toEqual({
      weight: "info",
      surface: "paved",
    });
    expect(layoutWeightForFeature({ kind: "open-space", tags: { highway: "pedestrian" } })).toEqual({
      weight: "info",
      surface: "paved",
    });
    expect(layoutWeightForFeature({ kind: "open-space", tags: {} })).toEqual({
      weight: "info",
      surface: "open",
    });
  });

  it("建筑/道路/入口/规划对象不进分级（建筑障碍走既有引擎路径）", () => {
    expect(layoutWeightForFeature({ kind: "building", tags: { building: "yes" } })).toBeNull();
    expect(layoutWeightForFeature({ kind: "road", tags: { highway: "primary" } })).toBeNull();
    expect(layoutWeightForFeature({ kind: "entrance", tags: { entrance: "yes" } })).toBeNull();
    expect(layoutWeightForFeature({ kind: "zone", tags: { semantic: "stage" } })).toBeNull();
    expect(layoutWeightForFeature({ kind: "facility", tags: {} })).toBeNull();
    expect(layoutWeightForFeature({ kind: "route", tags: {} })).toBeNull();
  });

  it("摘要是 fit-for-layout 一行式：分档方位+代价口径，方向按活动范围相对位置", () => {
    const features = [
      // 西南角外 20m 的湖
      feature(101, "water", "西湖", ring(-100, -80, -60, -35), { natural: "water" }),
      // 北侧 25m 的围栏
      feature(102, "barrier", "", ring(-30, 60, 30, 60), { barrier: "fence" }, "line"),
      // 场地内的中心花园
      feature(103, "open-space", "中心花园", ring(-20, -20, 20, 20), { leisure: "garden" }),
      // 东侧 10m 的公园
      feature(104, "open-space", "东园", ring(50, 0, 90, 30), { leisure: "park" }),
      // 东侧 5m 的停车场
      feature(105, "open-space", "P1", ring(45, -30, 70, -10), { amenity: "parking" }),
      // 西侧 5m 的广场
      feature(106, "open-space", "西广场", ring(-70, 10, -45, 30), { place: "square" }),
      // 500m 外的水塘：超出关联半径，不进分级
      feature(107, "water", "远处水塘", ring(600, 600, 640, 640), { natural: "water" }),
    ];
    const layout = buildLayoutEvidence(features, BOUNDARY);
    expect(layout.hard.map((f) => f.id)).toEqual([
      "osm:way/101",
      "osm:way/102",
    ]);
    expect(layout.soft.map((f) => f.id)).toEqual([
      "osm:way/103",
      "osm:way/104",
    ]);
    expect(layout.info.map((f) => f.id)).toEqual([
      "osm:way/105",
      "osm:way/106",
    ]);
    expect(layout.hard.every((f) => f.gapM <= 80)).toBe(true);
    expect(layout.hard.map((f) => f.gapM)).toEqual([...layout.hard.map((f) => f.gapM)].sort((a, b) => a - b));

    const summary = layout.summary;
    expect(summary.length).toBeLessThanOrEqual(8);
    const waterLine = summary.find((w) => w.includes("西湖"));
    expect(waterLine).toContain("西南");
    expect(waterLine).toContain("水域");
    expect(waterLine).toContain("列为禁区");
    const fenceLine = summary.find((w) => w.includes("围栏"));
    expect(fenceLine).toContain("北");
    expect(fenceLine).toContain("列为禁区");
    const gardenLine = summary.find((w) => w.includes("中心花园"));
    expect(gardenLine).toContain("场地内");
    expect(gardenLine).toContain("可摆但有代价");
    const eastParkLine = summary.find((w) => w.includes("东园"));
    expect(eastParkLine).toContain("东");
    expect(eastParkLine).toContain("可摆但有代价");
    const parkingLine = summary.find((w) => w.includes("P1"));
    expect(parkingLine).toContain("停车场");
    expect(parkingLine).toContain("利好");
    const squareLine = summary.find((w) => w.includes("西广场"));
    expect(squareLine).toContain("广场");
    expect(squareLine).toContain("利好");
    expect(summary.some((w) => w.includes("远处水塘"))).toBe(false);
  });

  it("同方位同类要素合并计数；无边界时以锚点为参照不拒绝分级", () => {
    const twoLakes = [
      feature(201, "water", "西湖", ring(-100, -80, -60, -35), { natural: "water" }),
      feature(202, "water", "内湖", ring(-150, -80, -110, -40), { natural: "water" }),
    ];
    const layout = buildLayoutEvidence(twoLakes, BOUNDARY);
    expect(layout.hard.length).toBe(2);
    const waterLine = layout.summary.find((w) => w.includes("西湖"));
    expect(waterLine).toContain("等2处");

    const noBoundary = buildLayoutEvidence(twoLakes, []);
    expect(noBoundary.hard.length).toBe(2);
    expect(noBoundary.summary.some((w) => w.includes("列为禁区"))).toBe(true);
  });
});

describe("docs/47 A2 摘要进模型上下文（生产路径）", () => {
  let plan: SitePlanData;
  function wgs(x: number, y: number) {
    const p = enuToLngLat(x, y, plan.anchor!.lng, plan.anchor!.lat);
    return siteWgsCenter(p.lng, p.lat);
  }
  /** 把 ENU 环转成 Overpass way 元素（闭合环首尾同点；Overpass 坐标是 {lon,lat}）。 */
  function wayElement(id: number, points: Array<{ x: number; y: number }>, tags: Record<string, string>, name = "") {
    const geometry = [...points, points[0]!].map((p) => {
      const ll = enuToLngLat(p.x, p.y, plan.anchor!.lng, plan.anchor!.lat);
      const w = siteWgsCenter(ll.lng, ll.lat);
      return { lon: w.lng, lat: w.lat };
    });
    return { type: "way", id, geometry, tags: name ? { ...tags, name } : tags };
  }

  it("修前红反例：带水域/绿地/铺装的场地，issued 上下文必须带「列为禁区」类摘要与分档明细", async () => {
    plan = {
      ...createStarterOutdoorPlan(),
      boundary: BOUNDARY,
      zones: [],
      facilities: [],
    };
    const closed = (pts: Array<[number, number]>) => pts.map(([x, y]) => ({ x, y }));
    const elements = [
      wayElement(101, closed(ring(-100, -80, -60, -35)), { natural: "water" }, "西湖"),
      {
        type: "way",
        id: 102,
        geometry: [wgs(-30, 60), wgs(30, 60)].map((w) => ({
          lon: w.lng,
          lat: w.lat,
        })),
        tags: { barrier: "fence" },
      },
      wayElement(103, closed(ring(-20, -20, 20, 20)), { leisure: "garden" }, "中心花园"),
      wayElement(104, closed(ring(50, 0, 90, 30)), { leisure: "park" }, "东园"),
      wayElement(105, closed(ring(45, -30, 70, -10)), { amenity: "parking" }, "P1"),
      wayElement(106, closed(ring(-70, 10, -45, 30)), { place: "square" }, "西广场"),
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              schemaVersion: 1,
              crs: "wgs84",
              complete: true,
              warnings: [],
              elements,
            }),
          ),
      ),
    );
    try {
      const adapter = createOutdoorMapContext();
      const map = await adapter.load(
        "project-a2",
        plan,
        [],
        true,
        new AbortController().signal,
      );
      // 摘要进 issued 模型上下文（buildModelContext 的 layoutEvidence 字段）。
      expect(map.issued).toBeDefined();
      const summary = map.issued!.layoutEvidence ?? [];
      expect(summary.length).toBeGreaterThan(0);
      const waterLine = summary.find((w) => w.includes("西湖"));
      expect(waterLine).toContain("西南");
      expect(waterLine).toContain("列为禁区");
      expect(summary.some((w) => w.includes("中心花园") && w.includes("可摆但有代价"))).toBe(true);
      expect(summary.some((w) => w.includes("P1") && w.includes("利好"))).toBe(true);
      // 明细进引擎：分档 accessor 供排布引擎（A3）消费。
      const detail = map.layoutEvidence?.();
      expect(detail).toBeDefined();
      expect(detail!.hard.length).toBe(2); // 西湖 + 围栏
      expect(detail!.hard.every((f) => f.weight === "hard-block")).toBe(true);
      expect(detail!.soft.length).toBe(2); // 中心花园 + 东园
      expect(detail!.info.length).toBe(2); // P1 + 西广场
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("降级为证据摘要视图后，layoutEvidence 一行式仍随本轮携带（不随对象明细一起被裁掉）", async () => {
    plan = {
      ...createStarterOutdoorPlan(),
      boundary: BOUNDARY,
      zones: [],
      facilities: [],
    };
    const mapFeatures: MapFeature[] = [
      feature(301, "water", "西湖", ring(-100, -80, -60, -35), { natural: "water" }),
      feature(302, "barrier", "", ring(-30, 60, 30, 60), { barrier: "fence" }, "line"),
      feature(303, "open-space", "中心花园", ring(-20, -20, 20, 20), { leisure: "garden" }),
    ];
    const snapshot = buildSiteSnapshot({
      projectId: "project-a2",
      geometryRevision: 1,
      plan,
      mapFeatures,
      mapScope: { anchor: { ...plan.anchor! }, radiusM: 300, crs: "gcj-02" },
    });
    const layout = buildLayoutEvidence(snapshot.features, plan.boundary);
    const issued = buildModelContext(snapshot, {
      maxObjects: 6,
      maxChars: 40000,
      layoutEvidence: layout.summary,
    });
    expect(issued.layoutEvidence).toEqual(layout.summary);

    const state = emptyOutdoorFlow("project-a2");
    state.stage = "zones";
    state.brief = {
      event: "湖滨音乐会",
      guests: 80,
      zones: [
        {
          name: "观众区",
          purpose: "audience" as const,
          environment: "outdoor" as const,
          evidence: "观众区在场地中央，避开西湖一侧",
        },
      ],
      items: [],
      people: [],
    };
    const controller = {
      assistantChat: vi.fn(async () => ({
        status: "ok" as const,
        answer: JSON.stringify({
          action: "ask",
          reply: "已理解本轮需求。",
          references: [],
          facts: {},
        }),
      })),
    };
    // 长句把固定上下文之外的消息预算压到「整份 issued 装不下、摘要视图装得下」的窗口：
    // 摘要视图裁掉的是对象明细，layoutEvidence 一行式必须保留。
    const message = `在西湖边办一场 80 人的音乐会，${"舞台不要进水，签到放在铺装面上，音响避开围栏".repeat(30)}`;
    const turn = await understandOutdoorTurn({
      message,
      state,
      plan,
      selected: [],
      map: {
        version: issued.revision,
        status: "ready",
        text: "",
        featureIds: issued.objects.map((o) => o.reference.id),
        unknowns: [],
        issued,
      },
      controller,
      signal: new AbortController().signal,
    });
    expect(controller.assistantChat).toHaveBeenCalledOnce();
    expect(turn.reply).toContain("地图证据已压缩为摘要");
    const [firstCall] = controller.assistantChat.mock.calls as unknown as Array<[unknown, { text: string }[]]>;
    const serialized = firstCall![1].map(h => h.text).join("");
    expect(serialized).toContain("列为禁区");
    expect(serialized).toContain("可摆但有代价");
  });
});
