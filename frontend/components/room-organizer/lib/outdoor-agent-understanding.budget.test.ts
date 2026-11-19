import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createOutdoorMapContext } from "./outdoor-map-context";
import { createStarterOutdoorPlan } from "./outdoor-project-store";
import { understandOutdoorTurn } from "./outdoor-agent-understanding";
import { emptyOutdoorFlow } from "./outdoor-agent-contract";
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
    facilities: [
      {
        id: crypto.randomUUID(),
        name: "舞台",
        templateId: "stage",
        zoneId: "",
        position: { x: 8, y: 0 },
        rotationDeg: 0,
        size: { width: 2, depth: 2 },
        notes: "",
      },
    ],
  };
  plan.facilities[0]!.zoneId = plan.zones[0]!.id;
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

const askTurn = () => ({
  status: "ok" as const,
  answer: JSON.stringify({
    action: "ask",
    reply: "已理解本轮需求。",
    references: [],
    facts: {},
  }),
});

describe("E1 上下文预算分级降级（docs/47）", () => {
  it("大 brief 不再掷出超限：降级声明进 reply，约束字段全部保留", async () => {
    const adapter = createOutdoorMapContext();
    const map = await adapter.load(
      "project-a",
      plan,
      [],
      true,
      new AbortController().signal,
    );
    const state = emptyOutdoorFlow("project-a");
    state.stage = "objects";
    state.brief = {
      event: "两天两夜的滨江综合市集与音乐会联场活动",
      guests: 320,
      zones: Array.from({ length: 6 }, (_, i) => ({
        name: `多功能综合服务区${i + 1}`,
        purpose: "service" as const,
        environment: "outdoor" as const,
        evidence: `用户明确要求第${i + 1}个区域用于综合服务，包含签到咨询物资中转与志愿者休整，位置靠近主入口内侧并避开车行通道，此约束不可省略——${"夜间需要保留照明与安保巡视通道，不得被展位挤占".repeat(10)}`,
      })),
      items: [
        {
          zone: "多功能综合服务区1",
          query: "展板",
          count: 6,
          evidence: "综合服务区放6个展板用于活动导览",
        },
        {
          zone: "多功能综合服务区2",
          query: "折叠桌",
          count: 8,
          evidence: "第二服务区放8张折叠桌用于物资发放",
        },
        {
          zone: "多功能综合服务区3",
          query: "遮阳棚",
          count: 4,
          evidence: "第三服务区放4顶遮阳棚用于志愿者休整",
        },
      ],
      people: [
        {
          role: "安保",
          zone: "多功能综合服务区1",
          count: 6,
          audience: "security" as const,
          evidence: "每个综合服务区至少两名安保",
        },
        {
          role: "引导员",
          zone: "多功能综合服务区2",
          count: 4,
          audience: "staff" as const,
          evidence: "入口内侧需要引导员",
        },
      ],
    };
    const candidates = Array.from({ length: 8 }, (_, i) => ({
      id: `real-personal-asset-${i}-stable-id`,
      name: `真实展板候选${i + 1}：${"铝合金双面立式宣传展示展架室外活动专用防风配重底座需核对固定与承重".repeat(10)}`,
      width: 1.2,
      depth: 0.5,
      height: 2,
    }));
    let history: Array<{ text: string }> = [];
    const controller = {
      assistantChat: vi.fn(async (message, hist) => {
        history = hist;
        assistantChatRequestSchema.parse({ message, history: hist });
        return askTurn();
      }),
    };
    const turn = await understandOutdoorTurn({
      message: "把六个展板摆进多功能综合服务区1，别省略任何分区约束",
      state,
      plan,
      selected: [],
      map,
      libraryChoices: candidates,
      controller,
      signal: new AbortController().signal,
    });
    expect(controller.assistantChat).toHaveBeenCalledOnce();
    expect(turn.reply).toContain("本场内容较多");
    expect(turn.reply).toContain("你的需求与约束全部保留");
    const serialized = history.map((h) => h.text).join("");
    expect(serialized).toContain("两天两夜的滨江综合市集与音乐会联场活动");
    expect(serialized).toContain("320");
    expect(serialized).toContain("多功能综合服务区3");
    expect(serialized).toContain("用户明确要求第3个区域");
    expect(serialized).toContain("入口内侧需要引导员");
  });

  it("降级为地图证据摘要后，已发出对象的引用仍可校验通过（issued 不被改写）", async () => {
    const adapter = createOutdoorMapContext();
    const map = await adapter.load(
      "project-a",
      plan,
      [],
      true,
      new AbortController().signal,
    );
    const entrance = map.issued!.objects.find(
      (o) => o.kind === "entrance" && !o.reference.id.startsWith("plan:"),
    );
    expect(entrance).toBeDefined();
    const state = emptyOutdoorFlow("project-a");
    state.stage = "zones";
    state.brief = {
      event: "周末两天市集活动",
      guests: 180,
      zones: Array.from({ length: 6 }, (_, i) => ({
        name: `沿河活动分区${i + 1}`,
        purpose: "market" as const,
        environment: "outdoor" as const,
        evidence: `用户要求第${i + 1}分区沿河布置并保留亲水步道通行，${"摊位不得遮挡河岸栏杆与救生器材，夜间照明走预埋电缆不走临时拉线".repeat(20)}`,
      })),
      items: [
        {
          zone: "沿河活动分区1",
          query: "摊位桌",
          count: 10,
          evidence: "第一分区放10张摊位桌",
        },
      ],
      people: [
        {
          role: "安保",
          zone: "沿河活动分区1",
          count: 4,
          audience: "security" as const,
          evidence: "沿河分区需要专职安保",
        },
      ],
    };
    const controller = {
      assistantChat: vi.fn(async () => ({
        status: "ok" as const,
        answer: JSON.stringify({
          action: "ask",
          reply: "先核对这个入口。",
          references: [
            {
              layer: "map",
              id: entrance!.reference.id,
              revision: entrance!.reference.revision,
            },
          ],
          facts: {},
        }),
      })),
    };
    // 候选清单把 fixedContext 抬进「整份证据装不下」的窗口（预算远低于 issue 下限
    // 1200，fresh issue 必不走，降级必然发生——不依赖地图证据自身的体积）。
    const libraryChoices = Array.from({ length: 8 }, (_, i) => ({
      id: `real-personal-asset-${i}-stable-id`,
      name: `真实摊位桌候选${i + 1}：${"折叠式铝合金桁架桌室外市集专用防风加固需核对承重".repeat(2)}`,
      width: 1.2,
      depth: 0.6,
      height: 0.75,
    }));
    const turn = await understandOutdoorTurn({
      message: "沿河的摊位怎么避免挡住建筑入口",
      state,
      plan,
      selected: [],
      map,
      libraryChoices,
      controller,
      signal: new AbortController().signal,
    });
    // 摘要视图装得下→「已压缩为摘要」；连摘要都装不下→「未随本轮携带，仅保留覆盖声明」。
    // 两种都是合法降级，且引用都仍对整份 issued 校验（本断言的真正靶子）。
    expect(turn.reply).toMatch(/地图证据已压缩为摘要|地图证据未随本轮携带/);
    expect(turn.references).toEqual([
      { layer: "map", id: entrance!.reference.id, revision: entrance!.reference.revision },
    ]);
  });

  it("连最小可行上下文都装不下的超大 brief 仍明确拒绝，不静默丢约束", async () => {
    const adapter = createOutdoorMapContext();
    const map = await adapter.load(
      "project-a",
      plan,
      [],
      true,
      new AbortController().signal,
    );
    const state = emptyOutdoorFlow("project-a");
    state.stage = "zones";
    state.brief = {
      event: "超大联场活动",
      guests: 900,
      zones: Array.from({ length: 40 }, (_, i) => ({
        name: `超细分区分区${i + 1}`,
        purpose: "service" as const,
        environment: "outdoor" as const,
        evidence: `第${i + 1}分区要求：${"位置靠近东门内侧避开消防通道与变电围栏，摊位间距不小于三米并保留双向推车通道，夜间照明与安保巡视要求单列成册不得省略".repeat(2)}`,
      })),
      items: [],
      people: [],
    };
    const controller = {
      assistantChat: vi.fn(async () => askTurn()),
    };
    await expect(
      understandOutdoorTurn({
        message: "四十个分区一起排",
        state,
        plan,
        selected: [],
        map,
        controller,
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow(/超出单轮上下文上限/);
    expect(controller.assistantChat).not.toHaveBeenCalled();
  });
});
