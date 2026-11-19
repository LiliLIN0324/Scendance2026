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

it("2026-11-17 生产实测：综合体是整块建筑多边形时，场地本体不阻断排布；范围外的建筑仍然阻断", async () => {
  // 建筑要素必须是闭合环（证据适配器只收闭合多边形）。
  const ring = (pts: [number, number][]) =>
    [...pts, pts[0]!].map(([x, y]) => {
      const p = wgs(x, y);
      return { lon: p.lng, lat: p.lat };
    });
  const loadWith = async (elements: unknown[]) => {
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
    const adapter = createOutdoorMapContext();
    await adapter.load("project-a", plan, [], true, new AbortController().signal);
    return adapter;
  };
  const route = (points: { x: number; y: number }[], name: string) => ({
    ...plan,
    routes: [
      {
        id: crypto.randomUUID(),
        kind: "pedestrian" as const,
        name,
        points,
        oneWay: false,
        widthM: 3,
        notes: "",
      },
    ],
  });

  // ① 场地本体：OSM 把整个综合体画成一整块包住活动范围的建筑多边形（顶点都在范围外）。
  const venueBuilding = await loadWith([
    {
      type: "way",
      id: 99,
      geometry: ring([
        [-45, -40],
        [45, -40],
        [45, 40],
        [-45, 40],
      ]),
      tags: { building: "yes" },
    },
  ]);
  const notes = venueBuilding.validate(
    plan,
    route(
      [
        { x: -20, y: 0 },
        { x: 20, y: 0 },
      ],
      "人行流线（湖滨路）",
    ),
  );
  expect(notes.join(" ")).toContain("未计入障碍");

  // ② 综合体内部的子环（步行街/裙房）：顶点落在已确认范围内，同样是场地本体。
  const innerRing = await loadWith([
    {
      type: "way",
      id: 97,
      geometry: ring([
        [-30, -30],
        [-20, -30],
        [-20, 30],
        [-30, 30],
      ]),
      tags: { building: "yes" },
    },
  ]);
  expect(() =>
    innerRing.validate(
      plan,
      route(
        [
          { x: -25, y: 0 },
          { x: 20, y: 0 },
        ],
        "人行流线（湖滨路）",
      ),
    ),
  ).not.toThrow();

  // ③ 活动范围之外的建筑不再一票否决整轮（2026-11-17 生产实测改判据）：
  //    路网草案与建筑足迹同出 OSM、互相打架是常态，整轮否掉会让主链永远排不出流线，
  //    而用户连提案都看不到、无从在画布上改。改为如实写出位置与长度，让用户去核对。
  const outside = await loadWith([
    {
      type: "way",
      id: 98,
      geometry: ring([
        [50, -10],
        [70, -10],
        [70, 10],
        [50, 10],
      ]),
      tags: { building: "yes" },
    },
  ]);
  const outsideNotes = outside.validate(
    plan,
    route(
      [
        { x: 40, y: 0 },
        { x: 60, y: 0 },
      ],
      "越界流线",
    ),
  );
  expect(outsideNotes.join(" ")).toContain("未命名建筑足迹");
  expect(outsideNotes.join(" ")).toMatch(/活动范围.+侧约.+m/);
  // 物件（用户摆的）放进同一栋楼仍然硬拦：那才是真占位，不能跟着放宽。
  expect(() =>
    outside.validate(plan, {
      ...plan,
      facilities: [
        { ...plan.facilities[0]!, position: { x: 55, y: 0 } },
      ],
    }),
  ).toThrow(/建筑\/障碍/);
});

/**
 * 2026-11-17 生产实测（杭州湖滨路）：OSM 道路中心线与 OSM 建筑轮廓互相打架时，
 * 不能拿「离墙多近」当冲突判据，也不能整轮否掉主链。
 */
it("2026-11-17 生产实测：路线从建筑足迹里穿过 → 不再整轮否掉，但写清穿楼长度与位置", async () => {
  const ring = (pts: [number, number][]) =>
    [...pts, pts[0]!].map(([x, y]) => {
      const p = wgs(x, y);
      return { lon: p.lng, lat: p.lat };
    });
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
                type: "way",
                id: 98,
                geometry: ring([
                  [50, -10],
                  [70, -10],
                  [70, 10],
                  [50, 10],
                ]),
                tags: { building: "yes" },
              },
            ],
          }),
        ),
    ),
  );
  const adapter = createOutdoorMapContext();
  await adapter.load("project-a", plan, [], true, new AbortController().signal);
  const notes = adapter.validate(plan, {
    ...plan,
    routes: [
      {
        id: crypto.randomUUID(),
        kind: "pedestrian" as const,
        name: "人行流线（湖滨路）",
        points: [
          { x: 40, y: 0 },
          { x: 60, y: 0 },
        ],
        oneWay: false,
        widthM: 3,
        notes: "",
      },
    ],
  });
  const text = notes.join(" ");
  expect(text).toContain("未命名建筑足迹");
  expect(text).toMatch(/约\d+m/);
  expect(text).toContain("活动范围");
  expect(text).toContain("未自动判定为可通行");
});

it("2026-11-17 生产实测：贴着建筑外墙走的路线不算穿楼（OSM 共享墙角顶点不是占用）", async () => {
  const ring = (pts: [number, number][]) =>
    [...pts, pts[0]!].map(([x, y]) => {
      const p = wgs(x, y);
      return { lon: p.lng, lat: p.lat };
    });
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
                type: "way",
                id: 97,
                geometry: ring([
                  [50, -10],
                  [70, -10],
                  [70, 10],
                  [50, 10],
                ]),
                tags: { building: "yes" },
              },
            ],
          }),
        ),
    ),
  );
  const adapter = createOutdoorMapContext();
  await adapter.load("project-a", plan, [], true, new AbortController().signal);
  // 中心线在墙外 0.4m、宽 1m：旧判据（离墙 ≤ 半宽）会否掉整轮；贴墙不是穿楼。
  const notes = adapter.validate(plan, {
    ...plan,
    routes: [
      {
        id: crypto.randomUUID(),
        kind: "pedestrian" as const,
        name: "贴墙流线",
        points: [
          { x: 40, y: -10.4 },
          { x: 70, y: -10.4 },
        ],
        oneWay: false,
        widthM: 1,
        notes: "",
      },
    ],
  });
  expect(notes.join(" ")).not.toContain("未命名建筑足迹");
});

/**
 * docs/47 A2 轮注的结构性发现（A3 修复）：`water()`/`roadLines()` 挂在外层 adapter 对象上，
 * 而 hook 经 `bridge.mapContext`→`load()` 拿到的是内层 issued 对象——生产路径
 * `mapRef.current.water?.()` 恒为 undefined，沿岸/沿线预览永远拿空数组。
 * react harness 用带 water 的对象冒充所以没拦住；本测走真实 load 管线拦这个洞。
 */
it("docs/47 A3：load 返回的内层上下文自带 water/roadLines（hook 生产路径经它取岸线/沿线）", async () => {
  const ring = (pts: [number, number][]) =>
    [...pts, pts[0]!].map(([x, y]) => {
      const p = wgs(x, y);
      return { lon: p.lng, lat: p.lat };
    });
  // 道路两端点在本用例内现算（beforeEach 里的 a/b 不可引用，引用即运行时断链）。
  const roadA = wgs(-40, -28);
  const roadB = wgs(40, -28);
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
                type: "way",
                id: 31,
                geometry: ring([
                  [-30, 5],
                  [-5, 5],
                  [-5, 25],
                  [-30, 25],
                ]),
                tags: { natural: "water", name: "西湖" },
              },
              {
                type: "way",
                id: 32,
                geometry: [
                  { lon: roadA.lng, lat: roadA.lat },
                  { lon: roadB.lng, lat: roadB.lat },
                ],
                tags: { highway: "footway", name: "沿湖人行路" },
              },
            ],
          }),
        ),
    ),
  );
  const adapter = createOutdoorMapContext();
  // load 的返回值就是 hook 里 mapRef.current 持有的对象——只对它断言，不走外层冒充。
  const map = await adapter.load(
    "project-a",
    plan,
    [],
    true,
    new AbortController().signal,
  );
  const water = map.water?.() ?? [];
  const lines = map.roadLines?.() ?? [];
  expect(water).toHaveLength(1);
  expect(water[0]!.name).toBe("西湖");
  expect(water[0]!.closed).toBe(true);
  expect(water[0]!.points.length).toBeGreaterThanOrEqual(4);
  expect(lines).toHaveLength(1);
  expect(lines[0]!.name).toBe("沿湖人行路");
  // 外层旧 API 仍在，不得破坏。
  expect(adapter.water!()).toHaveLength(1);
  expect(adapter.roadLines!()).toHaveLength(1);
  // A3 消费点：内层 layoutEvidence 分档里这片水域在 hard 档。
  const evidence = map.layoutEvidence?.();
  expect(evidence?.hard.some((f) => f.name === "西湖")).toBe(true);
});

it("docs/47 B1：load 返回的内层上下文自带 placeableDomain（水域 hard 块与道路走廊从可用面积里扣掉）", async () => {
  const ring = (pts: [number, number][]) =>
    [...pts, pts[0]!].map(([x, y]) => {
      const p = wgs(x, y);
      return { lon: p.lng, lat: p.lat };
    });
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
                type: "way",
                id: 31,
                // 西湖占场地东南角 40×30 的一块（[0,40]×[-35,-5]）。
                geometry: ring([
                  [0, -35],
                  [40, -35],
                  [40, -5],
                  [0, -5],
                ]),
                tags: { natural: "water", name: "西湖" },
              },
              {
                type: "way",
                id: 32,
                geometry: [
                  { lon: wgs(-40, 20).lng, lat: wgs(-40, 20).lat },
                  { lon: wgs(40, 20).lng, lat: wgs(40, 20).lat },
                ],
                tags: { highway: "footway", name: "沿湖人行路" },
              },
            ],
          }),
        ),
    ),
  );
  const adapter = createOutdoorMapContext();
  const map = await adapter.load(
    "project-a",
    plan,
    [],
    true,
    new AbortController().signal,
  );
  const domain = map.placeableDomain?.();
  expect(domain).toBeDefined();
  // 场地 80×70=5600；扣水域 40×30=1200、扣 3m 走廊 80×3=240（走廊在 y=20，与水域不相交）。
  expect(domain!.areaM2).toBeGreaterThan(0);
  const expected = 5600 - 1200 - 240;
  expect(Math.abs(domain!.areaM2 - expected) / expected).toBeLessThan(0.05);
  expect(domain!.boundaryAreaM2).toBeGreaterThan(domain!.areaM2);
  expect(domain!.rects.length).toBeGreaterThan(0);
  expect(domain!.maxRect).not.toBeNull();
});

it("docs/47 B1：走廊与水域重叠时按并集扣，不重复扣同一块地", async () => {
  const ring = (pts: [number, number][]) =>
    [...pts, pts[0]!].map(([x, y]) => {
      const p = wgs(x, y);
      return { lon: p.lng, lat: p.lat };
    });
  const roadA = wgs(-40, -20);
  const roadB = wgs(40, -20);
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
                type: "way",
                id: 31,
                geometry: ring([
                  [0, -35],
                  [40, -35],
                  [40, -5],
                  [0, -5],
                ]),
                tags: { natural: "water", name: "西湖" },
              },
              {
                type: "way",
                id: 32,
                geometry: [
                  { lon: roadA.lng, lat: roadA.lat },
                  { lon: roadB.lng, lat: roadB.lat },
                ],
                tags: { highway: "footway", name: "穿湖人行路" },
              },
            ],
          }),
        ),
    ),
  );
  const adapter = createOutdoorMapContext();
  const map = await adapter.load(
    "project-a",
    plan,
    [],
    true,
    new AbortController().signal,
  );
  const domain = map.placeableDomain?.();
  // 水域 1200；走廊与水域重叠段不再扣，只有水域以西 x∈[-40,0] 的 3m 条带 120 是新增禁区。
  const expected = 5600 - 1200 - 120;
  expect(Math.abs(domain!.areaM2 - expected) / expected).toBeLessThan(0.05);
});
