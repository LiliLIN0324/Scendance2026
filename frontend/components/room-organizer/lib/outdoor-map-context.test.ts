import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { createOutdoorMapContext } from "./outdoor-map-context";
import { createStarterOutdoorPlan } from "./outdoor-project-store";
import { understandOutdoorTurn } from "./outdoor-agent-understanding";
import { emptyOutdoorFlow, type OutdoorTurn } from "./outdoor-agent-contract";
import { validateModelReferences } from "@/lib/site-intelligence";
import { assistantChatRequestSchema } from "../../../../supabase/functions/_shared/assistant-chat-contract";
import { siteWgsCenter } from "../../../../functions/api/site-context";
import { enuToLngLat } from "./outdoor-plan-canvas";
import type { SitePlanData } from "../../../../supabase/functions/_shared/site-plan";
let plan: SitePlanData;
function wgs(x: number, y: number) {
  const p = enuToLngLat(x, y, plan.anchor!.lng, plan.anchor!.lat);
  return siteWgsCenter(p.lng, p.lat);
}
beforeEach(() => {
  plan = {
    ...createStarterOutdoorPlan(),
    boundary: [
      { x: -40, y: -35 },
      { x: 40, y: -35 },
      { x: 40, y: 35 },
      { x: -40, y: 35 },
    ],
    zones: [
      {
        id: crypto.randomUUID(),
        name: "草坪表演区",
        semantic: "stage",
        environment: "outdoor",
        purpose: "performance",
        geometrySource: "user-confirmed",
        polygon: [
          { x: -30, y: -25 },
          { x: 30, y: -25 },
          { x: 30, y: 25 },
          { x: -30, y: 25 },
        ],
        notes: "",
      },
    ],
    facilities: [],
  };
  plan.facilities = [
    {
      id: crypto.randomUUID(),
      name: "舞台",
      templateId: "stage",
      zoneId: plan.zones[0]!.id,
      position: { x: 8, y: 0 },
      rotationDeg: 0,
      size: { width: 2, depth: 2 },
      notes: "",
    },
  ];
  const door = wgs(8, 0),
    a = wgs(-40, -28),
    b = wgs(40, -28);
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
            elements: [
              {
                type: "node",
                id: 11,
                lon: door.lng,
                lat: door.lat,
                tags: { entrance: "yes", name: "建筑东入口" },
              },
              {
                type: "way",
                id: 22,
                geometry: [
                  { lon: a.lng, lat: a.lat },
                  { lon: b.lng, lat: b.lat },
                ],
                tags: { highway: "footway", name: "已映射人行路" },
              },
            ],
          }),
        ),
    ),
  );
});
afterEach(() => vi.unstubAllGlobals());
it("发给同一模型的真正issued上下文同时含地图和用户对象，保留ID与revision，符合现有后端限制", async () => {
  const adapter = createOutdoorMapContext();
  const map = await adapter.load(
    "project-a",
    plan,
    [plan.facilities[0]!.id],
    true,
    new AbortController().signal,
  );
  expect(map.issued).toBeDefined();
  expect(
    map.issued!.objects.some((o) => o.reference.id.startsWith("osm:")),
  ).toBe(true);
  expect(
    map.issued!.objects.some((o) => o.reference.id.startsWith("plan:")),
  ).toBe(true);
  const refs = map.issued!.objects.slice(0, 2).map((o) => ({
    layer: o.reference.id.startsWith("plan:")
      ? ("plan" as const)
      : ("map" as const),
    ...o.reference,
  }));
  const controller = {
    assistantChat: vi.fn(async (message, history) => {
      assistantChatRequestSchema.parse({ message, history });
      return {
        status: "ok" as const,
        answer: JSON.stringify({
          action: "ask",
          reply: "先核对这两个对象",
          references: refs,
          facts: {},
        }),
      };
    }),
  };
  const turn = await understandOutdoorTurn({
    message: "舞台不要挡建筑入口",
    state: emptyOutdoorFlow("project-a"),
    plan,
    selected: [plan.facilities[0]!.id],
    map,
    controller,
    signal: new AbortController().signal,
  });
  expect(turn.references).toEqual(refs);
  expect(adapter.highlights(turn.references)).toHaveLength(2);
  expect(adapter.roads().roads[0]!.id).toBe("osm:way/22");
});
it("原始模型过期revision与未发出的对象拒绝，不改成当前版本洗白", async () => {
  const adapter = createOutdoorMapContext(),
    map = await adapter.load(
      "project-a",
      plan,
      [],
      true,
      new AbortController().signal,
    );
  const id = map.issued!.objects[0]!.reference.id;
  const controller = {
    assistantChat: vi.fn(async () => ({
      status: "ok" as const,
      answer: JSON.stringify({
        action: "ask",
        reply: "",
        references: [{ layer: "map", id, revision: "old-revision" }],
        facts: {},
      }),
    })),
  };
  await expect(
    understandOutdoorTurn({
      message: "这个入口",
      state: emptyOutdoorFlow("project-a"),
      plan,
      selected: [],
      map,
      controller,
      signal: new AbortController().signal,
    }),
  ).rejects.toThrow("引用无效");
  expect(
    adapter.highlights([{ layer: "map", id, revision: "old-revision" }]),
  ).toEqual([]);
  expect(
    validateModelReferences(
      { references: [{ id: "osm:node/not-issued", revision: map.version }] },
      map.issued!,
    ).ok,
  ).toBe(false);
});
it("引用地图上的真实门会驱动设施避让提案；不把高亮当理解完成", async () => {
  const adapter = createOutdoorMapContext(),
    map = await adapter.load(
      "project-a",
      plan,
      [plan.facilities[0]!.id],
      true,
      new AbortController().signal,
    );
  const target = map.issued!.objects.find((o) => o.kind === "facility")!,
    door = map.issued!.objects.find((o) => o.kind === "entrance")!;
  const turn: OutdoorTurn = {
    action: "adjust",
    reply: "",
    references: [
      { layer: "plan", ...target.reference },
      { layer: "map", ...door.reference },
    ],
    facts: {},
    operation: {
      targetId: target.reference.id,
      referenceId: door.reference.id,
      relation: "clear",
      evidence: "不要挡建筑入口",
    },
  };
  const next = adapter.spatial(turn, plan);
  expect(next.facilities[0]!.id).toBe(plan.facilities[0]!.id);
  expect(next.facilities[0]!.position).not.toEqual(
    plan.facilities[0]!.position,
  );
  expect(() => adapter.validate(plan, next)).not.toThrow();
  expect(plan.facilities[0]!.position).toEqual({ x: 8, y: 0 });
});
