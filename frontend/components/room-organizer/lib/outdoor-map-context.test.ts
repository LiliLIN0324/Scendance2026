import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { createOutdoorMapContext } from "./outdoor-map-context";
import { createStarterOutdoorPlan } from "./outdoor-project-store";
import { validateWorkflowPlan } from "./outdoor-agent-planning";
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
  // 2026-11-14 用户拍板「引用无效要有追问」：不再 reject 死路——返回 action=ask 追问，
  // 且坏引用被剥掉（不洗白成当前版本，不下发高亮，不执行）。
  const turn = await understandOutdoorTurn({
    message: "这个入口",
    state: emptyOutdoorFlow("project-a"),
    plan,
    selected: [],
    map,
    controller,
    signal: new AbortController().signal,
  });
  expect(turn.action).toBe("ask");
  expect(turn.references.some(ref => ref.revision === "old-revision")).toBe(false);
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

it("正常两区100人6展板和5个真实候选必须在整份请求预算内，保持候选ID顺序", async () => {
  plan.zones.push({
    ...plan.zones[0]!,
    id: crypto.randomUUID(),
    name: "室外展览区",
    purpose: "exhibition",
    polygon: [
      { x: -30, y: -25 },
      { x: -2, y: -25 },
      { x: -2, y: 25 },
      { x: -30, y: 25 },
    ],
  });
  const adapter = createOutdoorMapContext(),
    map = await adapter.load(
      "project-a",
      plan,
      [plan.zones[1]!.id],
      true,
      new AbortController().signal,
    );
  const state = emptyOutdoorFlow("project-a");
  state.stage = "objects";
  state.brief = {
    event: "户外市集与草坪演出",
    guests: 100,
    zones: plan.zones.map((z) => ({
      name: z.name,
      purpose: z.purpose!,
      environment: "outdoor",
      evidence: z.name,
    })),
    items: [
      {
        zone: "室外展览区",
        query: "展板",
        count: 6,
        evidence: "展览区放6个展板",
      },
    ],
    people: [],
  };
  const candidates = Array.from({ length: 5 }, (_, i) => ({
    id: `real-personal-asset-${i}-stable-id`,
    name: `真实展板候选${i + 1}：铝合金双面立式宣传展示展架室外活动专用，需核对固定及防风`,
    width: 1.2,
    depth: 0.5,
    height: 2,
  }));
  const controller = {
    assistantChat: vi.fn(async (message, history) => {
      assistantChatRequestSchema.parse({ message, history });
      const serialized = history.map((h: { text: string }) => h.text).join("");
      for (const c of candidates) expect(serialized).toContain(c.id);
      expect(serialized.indexOf(candidates[1]!.id)).toBeGreaterThan(
        serialized.indexOf(candidates[0]!.id),
      );
      expect(serialized).toContain("户外市集与草坪演出");
      expect(serialized).toContain("100");
      return {
        status: "ok" as const,
        answer: JSON.stringify({
          action: "ask",
          reply: "核对第二个",
          references: [],
          facts: {},
        }),
      };
    }),
  };
  await understandOutdoorTurn({
    message: "就选第二个展板，放6个",
    state,
    plan,
    selected: [plan.zones[1]!.id],
    map,
    libraryChoices: candidates,
    controller,
    signal: new AbortController().signal,
  });
  expect(controller.assistantChat).toHaveBeenCalledOnce();
});
it("237个无关旧设施不能挤掉已知地图门并让新舞台穿门", async () => {
  const stage = plan.facilities[0]!;
  plan.facilities = Array.from({ length: 237 }, (_, i) => ({
    ...stage,
    id: crypto.randomUUID(),
    name: `旧物${i}`,
    position: { x: 100 + i * 3, y: 100 },
    size: { width: 0.2, depth: 0.2 },
  }));
  const adapter = createOutdoorMapContext();
  await adapter.load("project-a", plan, [], true, new AbortController().signal);
  const next = { ...plan, facilities: [...plan.facilities, stage] };
  expect(() => validateWorkflowPlan(plan, next)).not.toThrow();
  expect(() => adapter.validate(plan, next)).toThrow(/门前净空|证据.*截断/);
});

it("地图必要几何截断不能只警告后放行新设施", async () => {
  const original = fetch;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (...args: Parameters<typeof fetch>) => {
      const res = await original(...args);
      const body = await res.json();
      return new Response(
        JSON.stringify({
          ...body,
          complete: false,
          warnings: ["element_limit_reached"],
        }),
      );
    }),
  );
  const adapter = createOutdoorMapContext();
  await adapter.load("project-a", plan, [], true, new AbortController().signal);
  const next = {
    ...plan,
    facilities: plan.facilities.map((f) => ({
      ...f,
      position: { x: 20, y: 0 },
    })),
  };
  expect(() => adapter.validate(plan, next)).toThrow("证据被截断");
});

it("访客身份不调用模型，必须正常账户登录而非匿名续跑", async () => {
  const controller = {
    getSnapshot: () => ({ user: { id: "guest-user", is_anonymous: true } }),
    assistantChat: vi.fn(async () => ({ status: "ok" as const, answer: "{}" })),
  };
  const adapter = createOutdoorMapContext(),
    map = await adapter.load(
      "project-a",
      plan,
      [],
      true,
      new AbortController().signal,
    );
  await expect(
    understandOutdoorTurn({
      message: "找IN77",
      state: emptyOutdoorFlow("project-a"),
      plan,
      selected: [],
      map,
      controller,
      signal: new AbortController().signal,
    }),
  ).rejects.toThrow("UNAUTHENTICATED");
  expect(controller.assistantChat).not.toHaveBeenCalled();
});
