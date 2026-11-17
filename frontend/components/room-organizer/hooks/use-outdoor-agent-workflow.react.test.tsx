// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, it, expect, vi, type Mock } from "vitest";
import type { BackendSession } from "@/lib/backend-session";
import { assistantChatRequestSchema } from "../../../../supabase/functions/_shared/assistant-chat-contract";
import type { ChatProviderId } from "../../../../supabase/functions/_shared/chat-provider";
import { createStarterOutdoorPlan, saveOutdoorProjectRecord } from "../lib/outdoor-project-store";
import { useOutdoorAgentWorkflow } from "./use-outdoor-agent-workflow";
import { OutdoorWorkflowCard } from "../components/outdoor-workflow-card";
import type {
  OutdoorMapContext,
  OutdoorAgentBridge,
  OutdoorTurn,
} from "../lib/outdoor-agent-contract";
import type { SitePlanData } from "../../../../supabase/functions/_shared/site-plan";
vi.mock(import("../lib/road-network"), async (importOriginal) => ({
  ...(await importOriginal()),
  fetchRoadNetwork: vi.fn(async () => ({ roads: [] })),
}));
vi.mock("../three/glb-assets", () => ({
  ensureGlbAsset: vi.fn(),
  getGlbAssetState: vi.fn(),
  listImportedGlbAssets: () => [],
  importLocalGlb: vi.fn(async () => ({
    key: "local-glb:fixture",
    name: "我的展板",
    fileName: "我的展板.glb",
    width: 2,
    depth: 1,
    height: 2,
    unit: "m",
    upAxis: "y",
    importedAt: Date.now(),
  })),
}));
let root: Root,
  host: HTMLDivElement,
  flow: ReturnType<typeof useOutdoorAgentWorkflow>,
  plan: SitePlanData,
  epoch: number,
  scope: string;
let chatMeta: { provider: unknown; model: unknown };
// undefined = 会话不给 getSnapshot（旧用例口径）；null = 未登录；对象 = 已登录。
let sessionUser: { id: string; is_anonymous?: boolean } | null | undefined;
let providerOverride: (() => ChatProviderId | undefined) | undefined;
let modelOverride: (() => string | null) | undefined;
let streamUnderstand: BackendSession["assistantChatStream"] | undefined;
let understand: ReturnType<
    typeof vi.fn<(...args: unknown[]) => Promise<unknown>>
  >,
  apply: ReturnType<
    typeof vi.fn<(next: SitePlanData, expected: string) => boolean>
  >,
  bridge: OutdoorAgentBridge;
const ring = [
  { x: 0, y: 0 },
  { x: 80, y: 0 },
  { x: 80, y: 70 },
  { x: 0, y: 70 },
];
const response = (
  action: OutdoorTurn["action"],
  facts: OutdoorTurn["facts"] = {},
  extra: Partial<OutdoorTurn> = {},
) => ({
  status: "ok" as const,
  answer: JSON.stringify({
    action,
    reply: "",
    references: [],
    facts,
    ...extra,
  }),
});
let cardHistorySession: Record<string, unknown> = {};
let saySpy: Mock<(text: string, clarification?: boolean) => void>;
function Harness() {
  flow = useOutdoorAgentWorkflow({
    scope,
    bridge: () => bridge,
    controller: () =>
      ({
        assistantChat: (
          message: string,
          history: Array<{ role: "user" | "assistant"; text: string }>,
          signal: AbortSignal,
          _purpose: unknown,
          provider: unknown,
          model: unknown,
        ) => {
          chatMeta = { provider, model };
          assistantChatRequestSchema.parse({ message, history });
          return understand(message, history, signal);
        },
        ...(streamUnderstand ? { assistantChatStream: streamUnderstand } : {}),
        ...(sessionUser === undefined ? {} : { getSnapshot: () => ({ user: sessionUser }) }),
        ...cardHistorySession,
      }) as unknown as BackendSession,
    provider: () => providerOverride?.(),
    model: () => modelOverride?.() ?? null,
    begin: () => ++epoch,
    current: (e) => e === epoch,
    status: vi.fn(),
    say: saySpy,
    search: vi.fn(),
  });
  return (
    <OutdoorWorkflowCard
      flow={flow}
    />
  );
}
function mount() {
  act(() => root.render(<Harness />));
}
async function turn(text: string, reply: ReturnType<typeof response>) {
  understand.mockResolvedValueOnce(reply);
  await act(async () => {
    await flow.handle(text);
  });
  if (flow.pendingPlan) {
    const plan = flow.pendingPlan;
    await act(async () => { await flow.approvePlan(plan); });
  }
}
async function action(
  name: OutdoorTurn["action"],
  choice?: number,
  id?: string,
) {
  await act(async () => {
    await flow.action(name, choice, id);
  });
}
async function confirmScope() {
  await action("scope");
  expect(plan.boundary).toEqual(ring);
  await action("confirm");
}
beforeEach(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  plan = { ...createStarterOutdoorPlan(), boundary: ring };
  epoch = 0;
  scope = "project-a";
  chatMeta = { provider: undefined, model: null };
  sessionUser = undefined;
  cardHistorySession = {};
  providerOverride = undefined;
  modelOverride = undefined;
  streamUnderstand = undefined;
  understand = vi.fn<(...args: unknown[]) => Promise<unknown>>();
  saySpy = vi.fn();
  apply = vi.fn((next: SitePlanData, expected: string) => {
    if (JSON.stringify(plan) !== expected) return false;
    plan = next;
    return true;
  });
  bridge = {
    getPlan: () => plan,
    applyPlan: apply,
    applyVenue: vi.fn(() => true),
    beginVenueBoundary: vi.fn(() => true),
    applyRoutes: vi.fn(() => true),
    applyZoneProposal: vi.fn(() => true),
    inspectFacility: vi.fn(() => true),
    setView: vi.fn(),
    openGenerate: vi.fn(() => true),
    openUpload: vi.fn(() => true),
  };
  mount();
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});
it("户外问答跟随面板所选 provider 与 model 透传到对话请求", async () => {
  providerOverride = () => "tokendance";
  modelOverride = () => "tk-another";
  await turn("布置一个户外市集", response("ask", {}));
  expect(chatMeta.provider).toBe("tokendance");
  expect(chatMeta.model).toBe("tk-another");
});
it("「你在做」在地图和模型响应完成前显示实际工作步骤与模型片段", async () => {
  const thought = "我在核对当前活动的分区用途，并等待你补充要求。";
  let mapReady!: (value: OutdoorMapContext) => void;
  bridge.mapContext = vi.fn(() => new Promise<OutdoorMapContext>(resolve => { mapReady = resolve; }));
  let complete!: (value: ReturnType<typeof response>) => void;
  let streamThought!: (text: string) => void;
  streamUnderstand = vi.fn<BackendSession["assistantChatStream"]>((_message, _history, _signal, onDelta) => {
    streamThought = onDelta;
    return new Promise<ReturnType<typeof response>>(resolve => { complete = resolve; });
  });
  let pending!: Promise<boolean>;
  await act(async () => { pending = flow.handle("你在做"); });
  // 画布规模并进摘要，不再单独占一行步骤。
  expect(host.querySelector("details.ap-run-thoughts")?.textContent).toContain("已读画布");
  expect(streamUnderstand).not.toHaveBeenCalled();
  await act(async () => { mapReady({ version: "map:unavailable", status: "unavailable", text: "地图不可用", featureIds: [], unknowns: [] }); });
  // 「将本轮输入和场地资料交给模型判断」是恒真过程句，已从步骤里删除。
  expect(host.querySelector("details.ap-run-thoughts")?.textContent).not.toContain("交给模型判断");
  // 地图依据取不全属于真异常：这一轮自动展开。
  expect(host.querySelector("details.ap-run-thoughts")?.hasAttribute("open")).toBe(true);
  act(() => { streamThought("我在核对当前活动的分区用途，"); });
  expect(host.querySelector("details.ap-run-thoughts")?.textContent).toContain("我在核对当前活动的分区用途，");
  expect(host.querySelector("details.ap-run-thoughts")?.getAttribute("aria-busy")).toBe("true");
  act(() => { streamThought("并等待你补充要求。"); });
  expect(host.querySelector("details.ap-run-thoughts")?.textContent).toContain(thought);
  await act(async () => {
    complete(response("ask", {}, { reply: "我在核对分区用途。", thought }));
    await pending;
  });
  const record = host.querySelector("details.ap-run-thoughts");
  expect(streamUnderstand).toHaveBeenCalledOnce();
  expect(understand).not.toHaveBeenCalled();
  // 跑完之后是记录态：默认收起，用户想看再点开。
  expect(record?.hasAttribute("open")).toBe(false);
  expect(record?.textContent).toContain("思考记录 · 1 条");
  expect(record?.textContent).toContain(thought);
  expect(apply).not.toHaveBeenCalled();
  scope = "project-b";
  mount();
  expect(host.querySelector("details.ap-run-thoughts")).toBeNull();
});
it("地图依据取全、无异常时思考卡默认收起，画布规模只在摘要里出现", async () => {
  bridge.mapContext = vi.fn(async (): Promise<OutdoorMapContext> => ({
    version: "map:ready",
    status: "ready",
    text: "已取到结构化地图依据",
    featureIds: [],
    unknowns: [],
  }));
  let complete!: (value: ReturnType<typeof response>) => void;
  streamUnderstand = vi.fn<BackendSession["assistantChatStream"]>(() => new Promise<ReturnType<typeof response>>(resolve => { complete = resolve; }));
  let pending!: Promise<boolean>;
  await act(async () => { pending = flow.handle("整理一下分区"); });
  const record = host.querySelector("details.ap-run-thoughts");
  expect(record?.getAttribute("aria-busy")).toBe("true");
  expect(record?.hasAttribute("open")).toBe(false);
  expect(record?.textContent).toContain("已读画布");
  await act(async () => {
    complete(response("ask", {}));
    await pending;
  });
});
it("模型提出分区计划后，批准计划才生成预览，再确认才写入画布", async () => {
  await confirmScope();
  apply.mockClear();
  understand.mockResolvedValueOnce(response("zones", {
    zones: [{ name: "展览区", purpose: "exhibition", environment: "outdoor", evidence: "室外展览区" }],
  }));
  await act(async () => { await flow.handle("安排室外展览区"); });
  const planCard = host.querySelector('[aria-label="待批准计划"]');
  const thoughtCard = host.querySelector('[aria-label="思考卡片"]');
  expect(thoughtCard?.textContent).toContain("安排室外展览区");
  expect(thoughtCard?.nextElementSibling).toBe(planCard);
  expect(planCard?.textContent).toContain("按活动用途和室内外依据生成分区预览");
  expect(flow.proposal).toBeNull();
  expect(apply).not.toHaveBeenCalled();
  const approve = [...planCard!.querySelectorAll("button")].find(button => button.textContent === "批准并执行");
  await act(async () => { approve!.click(); });
  expect(flow.pendingPlan).toBeNull();
  expect(flow.proposal?.kind, flow.notice).toBe("zones");
  expect(apply).not.toHaveBeenCalled();
  await action("confirm");
  expect(plan.zones.map(zone => zone.name)).toEqual(["展览区"]);
});
it("在地图上手画分区按钮直接进入绘制模式", async () => {
  await confirmScope();
  const beginDrawing = vi.fn(() => true);
  bridge.beginDrawing = beginDrawing;
  const buttons = [...host.querySelectorAll("button")];
  expect(buttons.some(button => button.textContent?.trim() === "生成分区预览")).toBe(true);
  const draw = buttons.find(button => button.textContent?.trim() === "在地图上手画分区");
  await act(async () => { draw!.click(); });
  expect(beginDrawing).toHaveBeenCalledWith("zone");
  expect(flow.notice).toContain("请在地图上画出分区轮廓并闭合");
});
it.each([true, false])("缺分区时先预览分区，按确认结果处理后续主通道（确认=%s）", async (approved) => {
  await confirmScope();
  apply.mockClear();
  const { lng, lat } = plan.anchor!;
  const roads = vi.fn(() => ({
    roads: [{
      id: "walkway",
      name: "现场步道",
      highway: "footway" as const,
      points: [[lng + 0.0003, lat - 0.0002], [lng + 0.0003, lat + 0.0008]] as [number, number][],
    }],
  }));
  bridge.roadNetwork = roads;
  await turn("先划室外展览区和室外表演区，再设计主通道", response("main-routes", {
    zones: [
      { name: "展览区", purpose: "exhibition", environment: "outdoor", evidence: "室外展览区" },
      { name: "表演区", purpose: "performance", environment: "outdoor", evidence: "室外表演区" },
    ],
  }));
  expect(flow.proposal).toMatchObject({ kind: "zones", afterConfirm: "main-routes" });
  expect(host.textContent).toContain("先按已知用途划分区域");
  expect(host.textContent).toContain("确认分区并预览主通道");
  expect(plan.zones).toHaveLength(0);
  expect(roads).not.toHaveBeenCalled();
  expect(apply).not.toHaveBeenCalled();

  if (approved) {
    await action("confirm");
    expect(plan.zones.map(zone => zone.name)).toEqual(["展览区", "表演区"]);
    expect(roads).toHaveBeenCalledOnce();
    expect(flow.proposal?.kind, flow.notice).toBe("main-routes");
    expect(host.textContent).toContain("把真实道路与活动边界相交的位置作为入口候选");
    expect(apply).toHaveBeenCalledOnce();
    expect(plan.routes).toHaveLength(0);
    await action("confirm");
    expect(apply).toHaveBeenCalledTimes(2);
    expect(plan.routes.length).toBeGreaterThan(0);
  } else {
    const stale = flow.proposal!;
    act(() => flow.cancel());
    await act(async () => { await flow.confirmProposal(stale); });
    expect(roads).not.toHaveBeenCalled();
    expect(apply).not.toHaveBeenCalled();
  }
});
it("地点轮廓仅候选，具体活动范围需真实卡片确认才写入", async () => {
  const anchor = { ...plan.anchor!, lng: 120.1 };
  act(() => flow.offerBoundary(anchor, ring, "IN77"));
  expect(apply).not.toHaveBeenCalled();
  expect(flow.appliedHighlight).toBeNull();
  expect(host.textContent).toContain("商场轮廓只是候选");
  const confirm = [...host.querySelectorAll("button")].find(
    (b) => b.textContent?.includes("确认并应用这一版"),
  )!;
  await act(async () => {
    confirm.click();
  });
  expect(apply).toHaveBeenCalledTimes(1);
  expect(plan.anchor?.lng).toBe(120.1);
  expect(flow.state.stage).toBe("zones");
  expect(flow.appliedHighlight).toEqual({ kind: "scope" });
  expect(host.textContent).toContain("拖动顶点调整后，请重新核对活动范围");
});
it("卡确认/撤回后留在历史里，不随下一张卡消失", async () => {
  const anchor = { ...plan.anchor!, lng: 120.25 };
  const before = flow.cardRecords.length;
  act(() => flow.offerBoundary(anchor, ring, "IN77"));
  expect(flow.cardRecords).toHaveLength(before);
  const confirm = [...host.querySelectorAll("button")].find(
    (b) => b.textContent?.includes("确认并应用这一版"),
  )!;
  await act(async () => {
    confirm.click();
  });
  expect(flow.cardRecords).toHaveLength(before + 1);
  expect(flow.cardRecords.at(-1)).toMatchObject({ decision: "confirmed", kind: "scope" });
  expect(flow.cardRecords.at(-1)!.title).toContain("活动范围");
  const history = host.querySelector('[aria-label="已完成的引导"]');
  expect(history?.textContent).toContain("已确认");
  expect(history?.textContent).toContain("活动范围");
  // 点开历史行：能看到当时那张卡的说明与按钮（只作记录，不提供点击）
  const row = host.querySelector<HTMLButtonElement>(".ap-card-history-row")!;
  act(() => row.click());
  const detail = host.querySelector(".ap-card-history-detail");
  expect(detail?.textContent).toContain("商场轮廓只是候选");
  expect(detail?.textContent).toContain("确认并应用这一版");
  expect(detail?.textContent).toContain("在地图上重画实际活动范围");
  expect(detail?.textContent).toContain("撤回预览");
  // 撤回也留痕：下一张卡不再出现时，上一条记录还能看见
  act(() => flow.offerBoundary({ ...plan.anchor!, lng: 120.28 }, ring, "IN77"));
  act(() => flow.cancel());
  expect(flow.cardRecords).toHaveLength(before + 2);
  expect(flow.cardRecords.at(-1)?.decision).toBe("withdrawn");
  expect(host.textContent).toContain("已撤回");
});
it("卡的历史会推到后端副本，换设备首屏从后端接回", async () => {
  const save = vi.fn().mockResolvedValue([]);
  const load = vi.fn().mockResolvedValue([
    {
      at: 111,
      stage: "scope",
      kind: "scope",
      title: "另一台设备上的旧卡",
      decision: "confirmed",
      notes: [],
      actions: [],
    },
  ]);
  cardHistorySession = { getOutdoorCardHistory: load, saveOutdoorCardHistory: save };
  // 换设备 = 新挂载；同一 scope 不重挂的话 effect 不会重跑。
  act(() => root.unmount());
  root = createRoot(host);
  await act(async () => {
    mount();
    await Promise.resolve();
    await Promise.resolve();
  });
  // 新设备：本地为空时，首屏从后端接回旧记录
  expect(flow.cardRecords.some((record) => record.title === "另一台设备上的旧卡")).toBe(true);
  // 确认一张卡后：本机记一条，同时推一份后端副本
  act(() => flow.offerBoundary({ ...plan.anchor!, lng: 120.4 }, ring, "IN77"));
  const confirm = [...host.querySelectorAll("button")].find(
    (b) => b.textContent?.includes("确认并应用这一版"),
  )!;
  await act(async () => {
    confirm.click();
  });
  expect(save).toHaveBeenCalled();
  const [projectId, pushed] = save.mock.calls.at(-1)! as [string, Array<{ title: string }>];
  expect(projectId).toBe(scope);
  expect(pushed.some((record) => record.title.includes("活动范围"))).toBe(true);
});
it("拿到后端活动 id 后，历史改为按它存（换设备才读得到）", async () => {
  const save = vi.fn().mockResolvedValue([]);
  cardHistorySession = { saveOutdoorCardHistory: save };
  saveOutdoorProjectRecord({
    v: 1,
    projectId: scope,
    name: "湖滨夜集",
    createdAt: "2026-11-17T00:00:00.000Z",
    updatedAt: "2026-11-17T00:00:00.000Z",
    plan: null,
    remoteActivityId: "remote-9",
    remoteRevision: 2,
  });
  act(() => root.unmount());
  root = createRoot(host);
  act(() => mount());
  act(() => flow.offerBoundary({ ...plan.anchor!, lng: 120.7 }, ring, "IN77"));
  const confirm = [...host.querySelectorAll("button")].find(
    (b) => b.textContent?.includes("确认并应用这一版"),
  )!;
  await act(async () => {
    confirm.click();
  });
  expect(save.mock.calls.at(-1)?.[0]).toBe("remote-9");
});
it("可从候选范围直接重画地图边界，重画前不写入提案", () => {
  const anchor = { ...plan.anchor!, lng: 120.1 };
  act(() => flow.offerBoundary(anchor, ring, "IN77"));
  const redraw = [...host.querySelectorAll("button")].find(
    (button) => button.textContent?.includes("在地图上重画实际活动范围"),
  )!;
  act(() => redraw.click());
  expect(bridge.beginVenueBoundary).toHaveBeenCalledWith(anchor);
  expect(apply).not.toHaveBeenCalled();
  expect(flow.proposal).toBeNull();
  expect(host.textContent).toContain("圈出实际活动范围并闭合");
});
it("刷新后重新预览未确认候选，仍需显式确认才写入", async () => {
  plan = { ...plan, boundary: [] };
  const anchor = { ...plan.anchor!, lng: 120.1 };
  act(() => flow.offerBoundary(anchor, ring, "IN77"));
  act(() => root.unmount());
  root = createRoot(host);
  mount();
  expect(flow.proposal).toBeNull();
  await action("scope");
  expect(flow.proposal?.next.boundary).toEqual(ring);
  // 2026-11-17 「同一标准」：范围提案自己就带白框（外扩 20 m），预览与落地一致，
  // 不再靠画布那条事后兜底去补——兜底只留给旧提案。
  expect(flow.proposal?.next.designScope).toHaveLength(4);
  expect(Math.min(...flow.proposal!.next.designScope!.map(p => p.x)))
    .toBeCloseTo(Math.min(...ring.map(p => p.x)) - 20, 5);
  expect(apply).not.toHaveBeenCalled();
  await action("confirm");
  expect(plan.boundary).toEqual(ring);
  expect(flow.state.pendingBoundary).toBeUndefined();
});
it("旧记录没有候选和边界时回到场地搜索", async () => {
  plan = { ...plan, boundary: [] };
  await action("scope");
  expect(flow.state.stage).toBe("place");
  expect(host.textContent).toContain("重新搜索地点");
  expect(apply).not.toHaveBeenCalled();
});
it("未确认活动边界先出范围确认卡而不是死路，保留本句自然补充", async () => {
  await turn(
    "户外市集45人，展览区6个展板",
    response("objects", {
      event: { value: "户外市集", evidence: "户外市集" },
      guests: { value: 45, evidence: "45人" },
      items: [
        { zone: "展览区", query: "展板", count: 6, evidence: "展览区6个展板" },
      ],
    }),
  );
  // 2026-11-17：画布已有闭合边界时不再硬抛死路（原报错把用户引回重新搜索地点），
  // 直接给「确认当前活动范围」卡，一键回主流程；物件仍不落盘。
  expect(flow.proposal?.kind).toBe("scope");
  expect(flow.proposal?.label).toBe("确认当前活动范围");
  expect(plan.facilities).toHaveLength(0);
  expect(flow.state.brief.guests).toBe(45);
  // 一键确认后本句需求已记入记忆，继续走不丢人数。
  await action("confirm");
  expect(flow.state.brief.guests).toBe(45);
  expect(flow.proposal).toBeNull();
});
it("多轮事实延续、改口人数，分区预览及自然非暗号确认推进同规划", async () => {
  await confirmScope();
  await turn(
    "做户外市集60人",
    response("ask", {
      event: { value: "户外市集", evidence: "户外市集" },
      guests: { value: 60, evidence: "60人" },
    }),
  );
  await turn(
    "改45人，展览区在室外",
    response("zones", {
      guests: { value: 45, evidence: "45人" },
      zones: [
        {
          name: "展览区",
          purpose: "exhibition",
          environment: "outdoor",
          evidence: "展览区在室外",
        },
      ],
    }),
  );
  expect(plan.zones).toHaveLength(0);
  expect(flow.state.brief).toMatchObject({ event: "户外市集", guests: 45 });
  await act(async () => {
    await flow.handle("这个安排没问题，就按它落下去吧");
  });
  expect(plan.zones).toHaveLength(1);
  expect(flow.state.stage).toBe("main-routes");
  expect(flow.appliedHighlight).toEqual({ kind: "zones", zoneIds: [plan.zones[0]!.id] });
  expect(host.textContent).toContain("可以拖动分区，或拖动顶点调整轮廓");

  const editedZone = {
    ...plan.zones[0]!,
    polygon: plan.zones[0]!.polygon.map(({ x, y }) => ({ x: x + 1, y })),
  };
  plan = { ...plan, zones: [editedZone] };
  const { lng, lat } = plan.anchor!;
  bridge.roadNetwork = () => ({
    roads: [{
      id: "walkway",
      name: "现场步道",
      highway: "footway",
      points: [[lng + 0.0003, lat - 0.0002], [lng + 0.0003, lat + 0.0008]],
    }],
  });
  await turn("生成主通道", response("main-routes"));
  expect(flow.proposal?.next.zones, flow.notice).toEqual([editedZone]);
  expect(flow.appliedHighlight).toBeNull();
  expect(host.textContent).not.toContain("拖动路线转折点");
  await action("confirm");
  expect(plan.routes.length).toBeGreaterThan(0);
  expect(plan.zones).toEqual([editedZone]);
  expect(flow.appliedHighlight).toEqual({
    kind: "main-routes",
    routeIds: plan.routes.map(route => route.id),
    nodeIds: plan.nodes.map(node => node.id),
  });
  expect(host.textContent).toContain("拖动路线转折点绕开障碍");
  act(() => flow.cancel());
  expect(flow.appliedHighlight).toBeNull();
});
it("改口新任务后迟到旧模型结果不复活；取消与项目切换均隔离", async () => {
  await confirmScope();
  let resolve!: (value: ReturnType<typeof response>) => void;
  let oldSignal: AbortSignal | undefined;
  understand.mockImplementationOnce((_m, _h, signal) => {
    oldSignal = signal as AbortSignal | undefined;
    return new Promise((r) => {
      resolve = r;
    });
  });
  let pending!: Promise<boolean>;
  act(() => {
    pending = flow.handle("先布市集");
  });
  await act(async () => {
    await Promise.resolve();
  });
  await turn(
    "改成草坪表演",
    response("ask", { event: { value: "草坪表演", evidence: "草坪表演" } }),
  );
  expect(oldSignal?.aborted).toBe(true);
  await act(async () => {
    resolve(
      response("zones", {
        zones: [
          {
            name: "旧区",
            purpose: "market",
            environment: "outdoor",
            evidence: "先布市集",
          },
        ],
      }),
    );
    await pending;
  });
  expect(flow.state.brief.event).toBe("草坪表演");
  expect(flow.proposal).toBeNull();
  act(() => {
    flow.cancel();
  });
  scope = "project-b";
  mount();
  expect(flow.state.scope).toBe("project-b");
  expect(flow.state.brief.event).toBeUndefined();
  expect(plan.zones).toHaveLength(0);
});
it("当前规划改变后的确认拒绝旧提案，不覆盖手工草稿", async () => {
  await confirmScope();
  await turn(
    "室外展览区",
    response("zones", {
      zones: [
        {
          name: "展览区",
          purpose: "exhibition",
          environment: "outdoor",
          evidence: "室外展览区",
        },
      ],
    }),
  );
  plan = {
    ...plan,
    boundary: [...ring.slice(0, 2), { x: 70, y: 65 }, ring[3]!],
  };
  const snapshot = JSON.stringify(plan);
  await action("confirm");
  expect(JSON.stringify(plan)).toBe(snapshot);
  expect(flow.notice).toContain("失效");
});
it("提案后用户新加的实体不让提案失效，确认时并回且不丢用户内容", async () => {
  await confirmScope();
  await turn(
    "室外展览区",
    response("zones", {
      zones: [
        {
          name: "展览区",
          purpose: "exhibition",
          environment: "outdoor",
          evidence: "室外展览区",
        },
      ],
    }),
  );
  // 用户在预览之后自己加了点位（画布新增，基座没被删改）。
  plan = {
    ...plan,
    nodes: [
      ...plan.nodes,
      {
        id: crypto.randomUUID(),
        name: "我核对的分期入口",
        kind: "entry" as const,
        verification: "user-confirmed" as const,
        position: { x: 5, y: 35 },
        notes: "",
      },
    ],
  };
  await action("confirm");
  expect(flow.notice).not.toContain("失效");
  expect(apply).toHaveBeenCalled();
  expect(plan.zones.map((z) => z.name)).toContain("展览区");
  expect(plan.nodes.map((n) => n.name)).toContain("我核对的分期入口");
});
it("范围确认卡在预览期间被画布改动（如一键收进红线）不作废，确认按最新画布安置", async () => {
  // 2026-11-17 玉泉鱼跃实测：手画范围出确认卡后，用户点「一键收进红线」挪了实体，
  // 旧逻辑按实体快照整卡作废 → confirmedBoundary 永远写不进 → 下一句需求被打回死路。
  const nodeId = crypto.randomUUID();
  plan = {
    ...plan,
    nodes: [{
      id: nodeId,
      name: "签到入口",
      kind: "entry" as const,
      verification: "user-confirmed" as const,
      position: { x: 5, y: 35 },
      notes: "",
    }],
  };
  await action("scope");
  expect(flow.proposal?.kind).toBe("scope");
  // 预览期间用户挪动实体：边界、锚点都没变，只动了内容。
  plan = {
    ...plan,
    nodes: [{ ...plan.nodes[0]!, position: { x: 12, y: 35 } }],
  };
  await action("confirm");
  expect(flow.notice).not.toContain("失效");
  expect(apply).toHaveBeenCalled();
  expect(plan.nodes.map((n) => n.id)).toContain(nodeId);
  expect(flow.scopeConfirmed()).toBe(true);
});
it("已确认场地后一次 search 不再静默丢场地：继续说需求仍按已确认范围推进", async () => {
  await confirmScope();
  const before = JSON.stringify(plan);
  await turn("看看别的地点", response("search", {}, { query: "别的地点" }));
  expect(flow.state.stage).toBe("place");
  expect(JSON.stringify(plan)).toBe(before);
  await turn(
    "户外市集45人，展览区在室外",
    response("zones", {
      guests: { value: 45, evidence: "45人" },
      zones: [
        {
          name: "展览区",
          purpose: "exhibition",
          environment: "outdoor",
          evidence: "展览区在室外",
        },
      ],
    }),
  );
  // 旧代码这里 confirmedBoundary 已被清掉，需求被打回范围死路；新代码直接出分区预览。
  expect(flow.proposal?.kind).toBe("zones");
});
it("真实个人库复用→子线岗位→同plan3D替换/上传/生成表单，不启动收费请求", async () => {
  await confirmScope();
  await turn(
    "45人室外展览区，1个展板",
    response("zones", {
      guests: { value: 45, evidence: "45人" },
      zones: [
        {
          name: "展览区",
          purpose: "exhibition",
          environment: "outdoor",
          evidence: "室外展览区",
        },
      ],
      items: [{ zone: "展览区", query: "展板", count: 1, evidence: "1个展板" }],
    }),
  );
  await action("confirm");
  const zone = plan.zones[0]!;
  plan = {
    ...plan,
    nodes: [
      {
        id: crypto.randomUUID(),
        name: "已核对活动双向主出入口",
        kind: "both",
        verification: "user-confirmed",
        position: { x: 5, y: 5 },
        notes: "",
      },
    ],
    routes: [
      {
        id: crypto.randomUUID(),
        kind: "pedestrian",
        name: "已核对人行主线",
        points: [
          { x: 5, y: 5 },
          { x: 5, y: 65 },
        ],
        widthM: 3,
        oneWay: false,
        notes: "",
      },
    ],
  };
  bridge.readLibrary = vi.fn(async () => [
    {
      id: "my-display",
      name: "展板",
      source: "personal" as const,
      width: 2,
      depth: 1,
      height: 2,
      modelSlug: "generated:library-my-display",
      available: true,
    },
  ]);
  await action("objects");
  expect(flow.proposal, flow.notice).not.toBeNull();
  expect(bridge.readLibrary).toHaveBeenCalledWith(
    ["展板"],
    expect.any(AbortSignal),
  );
  expect(plan.facilities).toHaveLength(0);
  await action("confirm");
  expect(plan.facilities).toHaveLength(1);
  expect(plan.facilities[0]!.zoneId).toBe(zone.id);
  // Stage-specific branch uses actual confirmed gap/route geometry; unsupported geometry must stay a concrete blocker.
  await action("sub-routes");
  expect(flow.proposal, flow.notice).not.toBeNull();
  await action("confirm");
  expect(plan.facilities).toHaveLength(1);
  await turn(
    "展览区安排2名保安",
    response("people", {
      people: [
        {
          role: "保安",
          zone: "展览区",
          count: 2,
          audience: "security",
          evidence: "展览区安排2名保安",
        },
      ],
    }),
  );
  expect(flow.proposal).not.toBeNull();
  await action("confirm");
  expect(plan.workers[0]).toMatchObject({ count: 2, zoneId: zone.id });
  const facility = plan.facilities[0]!;
  bridge.selectedIds = () => [facility.id];
  bridge.models = vi.fn(async () => [
    {
      slug: "existing-glb",
      name: "现有展板模型",
      source: "我的库",
      width: 2,
      depth: 1,
      height: 2,
    },
  ]);
  await action("refine-3d");
  expect(bridge.setView).toHaveBeenCalledWith("3d");
  await action("models");
  expect(host.textContent).toContain("现有展板模型");
  await action("choose-model", 0, facility.id);
  expect(plan.facilities[0]!.modelOverride).toBe(
    "generated:library-my-display",
  );
  await action("confirm");
  expect(plan.facilities[0]!.modelOverride).toBe("existing-glb");
  await action("upload");
  expect(bridge.openUpload).toHaveBeenCalledWith(facility.id);
  await action("generate-image");
  expect(bridge.openGenerate).toHaveBeenCalledWith(facility.id, "image");
  await action("generate");
  expect(bridge.openGenerate).toHaveBeenCalledWith(facility.id, "text");
  expect(flow.notice).toContain("没有提交收费任务");
});
it("物料数量自然改口是原设施增减，不重复铺一版", async () => {
  await confirmScope();
  await turn(
    "45人，室外展览区放1个展板",
    response("zones", {
      guests: { value: 45, evidence: "45人" },
      zones: [
        {
          name: "展览区",
          purpose: "exhibition",
          environment: "outdoor",
          evidence: "室外展览区",
        },
      ],
      items: [{ zone: "展览区", query: "展板", count: 1, evidence: "1个展板" }],
    }),
  );
  await action("confirm");
  plan = {
    ...plan,
    nodes: [
      {
        id: crypto.randomUUID(),
        name: "已核对入口",
        kind: "entry",
        verification: "user-confirmed",
        position: { x: 5, y: 35 },
        notes: "",
      },
    ],
    routes: [
      {
        id: crypto.randomUUID(),
        kind: "pedestrian",
        name: "主线",
        points: [
          { x: 5, y: 5 },
          { x: 5, y: 65 },
        ],
        widthM: 3,
        oneWay: false,
        notes: "",
      },
    ],
  };
  bridge.readLibrary = vi.fn(async () => [
    {
      id: "my-display",
      name: "展板",
      source: "personal" as const,
      width: 2,
      depth: 1,
      height: 2,
      modelSlug: "generated:library-my-display",
      available: true,
    },
  ]);
  await action("objects");
  await action("confirm");
  const first = plan.facilities[0]!.id;
  await turn(
    "展览区改成2个展板",
    response("objects", {
      items: [{ zone: "展览区", query: "展板", count: 2, evidence: "2个展板" }],
    }),
  );
  await action("confirm");
  expect(plan.facilities).toHaveLength(2);
  expect(plan.facilities[0]!.id).toBe(first);
});
// 2026-11-17 正式站卡点：用户没说过人数（很常见——先布场、人数活动定了才知道），
// 点「预览按用途复用我的物料」拿到的是一张红卡「预计同时在场多少人？」+ 重试；
// 而重试只是原样重跑 objects，人数不变就永远撞同一堵墙，任务卡标题也被永久改成物件阶段。
// 规划层（validateWorkflowDemand）本来就允许没有人数，这个 throw 是唯一拦住的地方。
it("人数还没定也能排物料：不拦成红卡、阶段照样前进，并如实说明没做容量粗筛", async () => {
  await confirmScope();
  await turn(
    "室外市集，展览区1个展板",
    response("zones", {
      zones: [
        {
          name: "展览区",
          purpose: "exhibition",
          environment: "outdoor",
          evidence: "展览区",
        },
      ],
      items: [{ zone: "展览区", query: "展板", count: 1, evidence: "1个展板" }],
    }),
  );
  await action("confirm");
  plan = {
    ...plan,
    nodes: [
      {
        id: crypto.randomUUID(),
        name: "已核对活动双向主出入口",
        kind: "both",
        verification: "user-confirmed",
        position: { x: 5, y: 5 },
        notes: "",
      },
    ],
    routes: [
      {
        id: crypto.randomUUID(),
        kind: "pedestrian",
        name: "已核对人行主线",
        points: [
          { x: 5, y: 5 },
          { x: 5, y: 65 },
        ],
        widthM: 3,
        oneWay: false,
        notes: "",
      },
    ],
  };
  bridge.readLibrary = vi.fn(async () => [
    {
      id: "my-display",
      name: "展板",
      source: "personal" as const,
      width: 2,
      depth: 1,
      height: 2,
      modelSlug: "generated:library-my-display",
      available: true,
    },
  ]);
  // 全程没人说过人数：不编、也不拿物件数量去凑。
  expect(flow.state.brief.guests).toBeUndefined();
  await action("objects");
  expect(flow.notice).not.toContain("预计同时在场多少人");
  expect(flow.noticeKind).not.toBe("error");
  expect(flow.proposal?.kind, flow.notice).toBe("objects");
  expect(flow.proposal?.warnings.join()).toContain("人数还没定");
  expect(flow.proposal?.warnings.join()).not.toContain("仅按2㎡/人");
  expect(plan.facilities).toHaveLength(0);
  await action("confirm");
  expect(plan.facilities).toHaveLength(1);
});
it("缺主入口时失败不把任务卡改名成物件阶段", async () => {
  await confirmScope();
  await turn(
    "室外市集，展览区1个展板",
    response("zones", {
      zones: [
        {
          name: "展览区",
          purpose: "exhibition",
          environment: "outdoor",
          evidence: "展览区",
        },
      ],
      items: [{ zone: "展览区", query: "展板", count: 1, evidence: "1个展板" }],
    }),
  );
  await action("confirm");
  // 未核对主入口时，分区确认后下一站就是主通道阶段。
  expect(flow.state.stage).toBe("main-routes");
  await action("objects");
  expect(flow.notice).toContain("请先核对主入口和主要通道");
  // 阶段落盘挪到前置校验之后：失败一次不该把标题永久改成「按用途复用我的物料」。
  expect(flow.state.stage).toBe("main-routes");
});
// 2026-11-17 用户拍「都做」之一：红卡上的「重试」= 原样重放当前阶段动作，缺前置条件时点了还是同一句话。
// 这类拦阻改成给一个真能改变状态的动作。
it("缺前置条件时红卡给的是能推进的动作，不是把同一动作再放一遍", async () => {
  await confirmScope();
  await turn(
    "室外市集，展览区1个展板",
    response("zones", {
      zones: [
        { name: "展览区", purpose: "exhibition", environment: "outdoor", evidence: "展览区" },
      ],
      items: [{ zone: "展览区", query: "展板", count: 1, evidence: "1个展板" }],
    }),
  );
  await action("confirm");
  await action("objects");
  expect(flow.notice).toContain("请先核对主入口和主要通道");
  expect(flow.noticeFix).toEqual({ action: "main-routes", label: "去核对主要入口与通道" });
  const labels = [...host.querySelectorAll("button")].map(button => button.textContent?.trim());
  expect(labels).toContain("去核对主要入口与通道");
  // 不再同时给一个只会重放 objects 的「重试」。
  expect(labels).not.toContain("重试");
  const fix = [...host.querySelectorAll("button")].find(button => button.textContent?.trim() === "去核对主要入口与通道");
  await act(async () => { (fix as HTMLButtonElement).click(); });
  // 真的去跑了主通道：本机拉不到路网，会落到一个明确的下一步，而不是同一句重复提示。
  expect(flow.notice).not.toContain("请先核对主入口和主要通道");
  expect(flow.notice).toContain("未取得可核对路网");
});
// 2026-11-17 用户拍「都做」之二：答「第一个方案」后模型又把同一句追问端回来，
// 旧行为就是「我明明选了，却什么都没发生」。现在本地按原请求接着走。
const SCREENSHOT_QUESTION =
  "重新分区会覆盖现有 8 个户外分区，想先和你确认一下：你是想（1）保留全部功能但压缩成 3-4 个复合区，还是（2）完全按一套新分区清单来重排？如果是新清单，请把分区名、用途和环境（室内/室外）逐条列出；现有分区我会原样保留直到你确认。";
it("答「第一个方案」后模型再反问同一句，本地按原请求接着走，不再重复追问", async () => {
  await confirmScope();
  await turn(
    "室外市集，展览区1个展板",
    response("zones", {
      zones: [
        { name: "展览区", purpose: "exhibition", environment: "outdoor", evidence: "展览区" },
      ],
      items: [{ zone: "展览区", query: "展板", count: 1, evidence: "1个展板" }],
    }),
  );
  await action("confirm");
  // 模型对这一轮仍然只反问（就是截图那一屏的形态）。
  understand.mockResolvedValueOnce(response("ask", {}, { reply: SCREENSHOT_QUESTION }));
  await act(async () => {
    await flow.handle("第一个方案", {
      request: "我希望你把我的分区重新做一遍",
      question: SCREENSHOT_QUESTION,
    });
  });
  expect(flow.proposal?.kind, flow.notice).toBe("zones");
  expect(flow.state.stage).toBe("zones");
  // 卡上能看见这一版是按哪一项走的（提示条留给「预览已就绪」，这句进设计过程）。
  expect(flow.designSteps.join()).toContain("按你选的「保留全部功能但压缩成 3-4 个复合区」继续原请求");
  // 仍然是预览，没写画布。
  expect(plan.zones).toHaveLength(1);
});
it("选项里夹带别的要求时不本地强制推进，仍走追问", async () => {
  await confirmScope();
  understand.mockResolvedValueOnce(response("ask", {}, { reply: "你想怎么调整？" }));
  await act(async () => {
    await flow.handle("第一个方案，但保留舞台区", {
      request: "我希望你把我的分区重新做一遍",
      question: SCREENSHOT_QUESTION,
    });
  });
  expect(flow.proposal).toBeNull();
  expect(flow.notice).toContain("补充对话里的信息后可以继续");
});
it("模型不可用/格式错误明确阻断，不用关键词假装理解或落固定模板", async () => {
  understand.mockResolvedValueOnce({ status: "disabled" });
  await act(async () => {
    await flow.handle("这个区放展位");
  });
  // 用户可见文案是「当前环境未开启 Agent 理解模型…」；不再回显模型层的 status 原码。
  expect(flow.notice).toContain("未开启");
  expect(apply).not.toHaveBeenCalled();
  await turn("舞台不要挡入口", { status: "ok", answer: "我已完成！" });
  expect(flow.notice).toContain("没有返回");
  expect(plan.facilities).toHaveLength(0);
});
it("地图依据版本变化使当前提案失效，不能改写引用revision洗白", async () => {
  await confirmScope();
  let version = "map-one";
  bridge.mapContext = async () => ({
    version,
    status: "partial" as const,
    text: "known structured context",
    featureIds: [],
    unknowns: [],
  });
  await turn(
    "室外展览区",
    response("zones", {
      zones: [
        {
          name: "展览区",
          purpose: "exhibition",
          environment: "outdoor",
          evidence: "室外展览区",
        },
      ],
    }),
  );
  version = "map-two";
  await action("confirm");
  expect(plan.zones).toHaveLength(0);
  expect(flow.notice).toContain("地图或规划依据");
});

it("过期确认卡保留的真实handler不能确认后来的新方案", async () => {
  await confirmScope();
  await turn(
    "室外展览区",
    response("zones", {
      zones: [
        {
          name: "展览区",
          purpose: "exhibition",
          environment: "outdoor",
          evidence: "室外展览区",
        },
      ],
    }),
  );
  const previous = flow.proposal!,
    oldAction = flow.action;
  await turn(
    "改成室外市集区",
    response("zones", {
      zones: [
        {
          name: "市集区",
          purpose: "market",
          environment: "outdoor",
          evidence: "室外市集区",
        },
      ],
    }),
  );
  const latest = flow.proposal;
  await act(async () => {
    await flow.confirmProposal(previous);
    await oldAction("confirm");
  });
  expect(plan.zones).toHaveLength(0);
  expect(flow.proposal).toBe(latest);
});
it("45人原文不能被模型抽成80，原规划和数量均不被写错", async () => {
  await turn(
    "45人草坪演出",
    response("ask", { guests: { value: 80, evidence: "45人" } }),
  );
  expect(flow.state.brief.guests).toBeUndefined();
  expect(flow.notice).toContain("原文数量");
  expect(apply).not.toHaveBeenCalled();
});

it("真实库候选卡选择保留上下文；本机GLB测量后仍先说数量/预览，不擅自摆放", async () => {
  await confirmScope();
  await turn(
    "45人室外展览区",
    response("zones", {
      guests: { value: 45, evidence: "45人" },
      zones: [
        {
          name: "展览区",
          purpose: "exhibition",
          environment: "outdoor",
          evidence: "室外展览区",
        },
      ],
    }),
  );
  await action("confirm");
  bridge.readLibrary = vi.fn(async () => [
    {
      id: "real-board",
      name: "自有展板",
      source: "personal" as const,
      width: 2,
      depth: 1,
      height: 2,
      modelSlug: "generated:library-real-board",
      available: true,
    },
  ]);
  await turn(
    "先看看我的展板",
    response("library-search", {}, { query: "展板" }),
  );
  expect(host.textContent).toContain("自有展板");
  const choose = [...host.querySelectorAll("button")].find((b) =>
    b.textContent?.includes("自有展板"),
  )!;
  act(() => choose.click());
  expect(flow.selectedLibraryId).toBe("real-board");
  expect(plan.facilities).toHaveLength(0);
  await act(async () => {
    await flow.importLibraryGlb(new File(["fixture-only"], "我的展板.glb"));
  });
  expect(flow.libraryChoices[0]).toMatchObject({
    id: "local-glb:fixture",
    width: 2,
    depth: 1,
  });
  expect(flow.notice).toContain("尚未摆放");
  expect(flow.notice).toContain("本会话");
  expect(plan.facilities).toHaveLength(0);
});
it("图片生成只是同设施表单入口；候选第几个不能冒充物件数量", async () => {
  await turn(
    "选第二个",
    response("ask", {
      items: [{ zone: "展览区", query: "展板", count: 2, evidence: "第二个" }],
    }),
  );
  expect(flow.notice).toContain("数字依据");
  expect(apply).not.toHaveBeenCalled();
});

it.each([
  "先不要应用，我再想想",
  "如果人数没问题再应用",
  "确认之前不要应用",
  "可以吗？",
])("模型confirm不得把否定/条件/询问授为确认：%s", async (text) => {
  await action("scope");
  await turn(
    text,
    response(
      "confirm",
      {},
      { confirmationEvidence: text.includes("不要应用") ? "不要应用" : text },
    ),
  );
  expect(apply).not.toHaveBeenCalled();
  expect(flow.state.confirmedBoundary).toBeNull();
});
it.each(["取消", "切项目", "新任务"])(
  "确认等地图时%s，即便桥忽略abort且迟到同版本也不应用",
  async (mode) => {
    await confirmScope();
    bridge.mapContext = vi.fn(async () => ({
      version: "same-map",
      status: "partial" as const,
      text: "{}",
      unknowns: [],
      featureIds: [],
    }));
    await turn(
      "室外展览区",
      response("zones", {
        zones: [
          {
            name: "展览区",
            purpose: "exhibition",
            environment: "outdoor",
            evidence: "室外展览区",
          },
        ],
      }),
    );
    expect(flow.proposal).not.toBeNull();
    apply.mockClear();
    let resolve!: (value: OutdoorMapContext) => void;
    bridge.mapContext = vi.fn(
      () =>
        new Promise<OutdoorMapContext>((r) => {
          resolve = r;
        }),
    );
    let pending!: Promise<void>;
    act(() => {
      pending = flow.confirmProposal(flow.proposal!);
    });
    await act(async () => {
      await Promise.resolve();
    });
    if (mode === "取消") act(() => flow.cancel());
    else if (mode === "切项目") {
      scope = "project-b";
      mount();
    } else await action("scope");
    await act(async () => {
      resolve({
        version: "same-map",
        status: "partial" as const,
        text: "{}",
        unknowns: [],
        featureIds: [],
      });
      await pending;
    });
    expect(apply).not.toHaveBeenCalled();
    if (mode === "新任务") expect(flow.proposal?.kind).toBe("scope");
    else expect(flow.proposal).toBeNull();
    expect(plan.zones).toHaveLength(0);
  },
);

it("未登录错误保留原句和草稿，正规账户中心入口可操作，登录身份变化后显式恢复", async () => {
  understand.mockRejectedValueOnce(
    Object.assign(new Error("UNAUTHENTICATED"), { code: "UNAUTHENTICATED" }),
  );
  const before = JSON.stringify(plan);
  await act(async () => {
    await flow.handle("先找IN77，核对活动区域");
  });
  expect(flow.loginRequired).toBe(true);
  expect(flow.notice).toContain("登录后即可");
  expect(flow.state.pendingLogin?.message).toBe("先找IN77，核对活动区域");
  expect(JSON.stringify(plan)).toBe(before);
  const request = vi.fn();
  window.addEventListener("scendance:request-account-login", request);
  const open = [...host.querySelectorAll("button")].find(
    (b) => b.textContent === "前往登录",
  )!;
  act(() => open.click());
  expect(request).toHaveBeenCalledOnce();
  window.removeEventListener("scendance:request-account-login", request);
  act(() => flow.authChanged("signed-in-user"));
  expect(flow.state.pendingLogin?.message).toBe("先找IN77，核对活动区域");
  understand.mockResolvedValueOnce(response("ask"));
  await act(async () => {
    await flow.resumeAfterLogin();
  });
  expect(understand).toHaveBeenCalledTimes(2);
  expect(understand.mock.calls[1]![0]).toBe("先找IN77，核对活动区域");
  expect(flow.loginRequired).toBe(false);
  expect(apply).not.toHaveBeenCalled();
});
// 2026-11-16 用户指令：「已登录 · 可以继续」这张卡没保留必要——登录到位就自动接上。
it("登录一到位就自动接上待续需求，不再留一张「已登录 · 可以继续」等用户点", async () => {
  sessionUser = null;
  await act(async () => {
    await flow.handle("先找IN77，核对活动区域");
  });
  expect(flow.loginRequired).toBe(true);
  expect(flow.loginSatisfied).toBe(false);
  // 真没登录时仍然是登录卡，且文案不提「已登录」。
  expect(host.textContent).toContain("登录后继续这次选址");
  expect(host.textContent).not.toContain("已登录");
  // 账号恢复（真实登录）后重渲染：不需要再点「继续这次搜索」，需求自己接上。
  sessionUser = { id: "user-a", is_anonymous: false };
  understand.mockResolvedValueOnce(response("ask"));
  await act(async () => {
    mount();
    await Promise.resolve();
  });
  await act(async () => {
    await Promise.resolve();
  });
  expect(flow.loginRequired).toBe(false);
  expect(understand).toHaveBeenCalledTimes(1);
  expect(understand.mock.calls[0]![0]).toBe("先找IN77，核对活动区域");
  expect(host.textContent).not.toContain("已登录");
});
it("登录待恢复原句不跟到其他活动；取消后不能复活", async () => {
  understand.mockRejectedValueOnce(new Error("UNAUTHENTICATED"));
  await act(async () => {
    await flow.handle("找IN77");
  });
  expect(flow.loginRequired).toBe(true);
  scope = "project-b";
  mount();
  expect(flow.loginRequired).toBe(false);
  scope = "project-a";
  mount();
  expect(flow.loginRequired).toBe(true);
  act(() => flow.cancel());
  await act(async () => {
    await flow.resumeAfterLogin();
  });
  expect(understand).toHaveBeenCalledOnce();
});
it("入口核对不能推断出口；卡片显式核对双向出入口经预览再应用", async () => {
  await confirmScope();
  plan = {
    ...plan,
    zones: [
      {
        id: crypto.randomUUID(),
        name: "展览区",
        semantic: "reserved",
        polygon: ring,
        notes: "",
      },
    ],
    nodes: [
      {
        id: crypto.randomUUID(),
        name: "东口",
        kind: "entry",
        verification: "unverified",
        position: { x: 0, y: 35 },
        notes: "",
      },
    ],
  };
  await turn(
    "展览区安排2个保安",
    response("people", {
      people: [
        {
          role: "保安",
          zone: "展览区",
          count: 2,
          audience: "security",
          evidence: "2个保安",
        },
      ],
    }),
  );
  expect(flow.state.stage).toBe("people");
  await act(async () => {
    await flow.action(
      "verify-access",
      undefined,
      plan.nodes[0]!.id,
      undefined,
      "both",
    );
  });
  expect(plan.nodes[0]!.kind).toBe("entry");
  expect(flow.proposal, flow.notice).not.toBeNull();
  await action("confirm");
  expect(plan.nodes[0]!.kind).toBe("both");
  expect(plan.nodes[0]!.verification).toBe("user-confirmed");
  expect(flow.state.stage).toBe("people");
});

it.each(["没问题", "同意这版方案", "就按它落下去吧"])(
  "明确肯定仍绑定当前一版：%s",
  async (text) => {
    await action("scope");
    await act(async () => {
      await flow.handle(text);
    });
    expect(apply).toHaveBeenCalledOnce();
    expect(flow.state.stage).toBe("zones");
  },
);

it(
  "未登录时不再先抓十几秒地图上下文：立刻给登录卡，不调模型",
  async () => {
    sessionUser = null;
    const mapContext = vi.fn(async (): Promise<OutdoorMapContext> => {
      throw new Error("未登录不该去抓地图上下文");
    });
    Object.assign(bridge, { mapContext });
    const before = JSON.stringify(plan);
    await act(async () => {
      await flow.handle("你好");
    });
    expect(mapContext).not.toHaveBeenCalled();
    expect(understand).not.toHaveBeenCalled();
    expect(flow.loginRequired).toBe(true);
    expect(flow.notice).toContain("登录后即可");
    expect(flow.state.pendingLogin?.message).toBe("你好");
    // 草稿与规划一字未动。
    expect(JSON.stringify(plan)).toBe(before);
  },
);

it("已登录时照常走地图上下文与理解模型", async () => {
  sessionUser = { id: "user-a", is_anonymous: false };
  const mapContext = vi.fn(async (): Promise<OutdoorMapContext> => ({
    version: "map:unavailable",
    status: "unavailable",
    text: "不可用",
    featureIds: [],
    unknowns: [],
  }));
  Object.assign(bridge, { mapContext });
  await turn("帮我看看这个场地", response("ask"));
  expect(mapContext).toHaveBeenCalledOnce();
  expect(understand).toHaveBeenCalledOnce();
  expect(flow.loginRequired).toBe(false);
});

it("place 阶段卡上直接能点「在地图上手画活动范围」", async () => {
  expect(flow.state.stage).toBe("place");
  const button = [...host.querySelectorAll("button")].find(
    (item) => item.textContent?.includes("在地图上手画活动范围"),
  );
  expect(button).toBeTruthy();
  await act(async () => {
    button!.click();
  });
  expect(bridge.beginVenueBoundary).toHaveBeenCalledOnce();
  expect(flow.state.stage).toBe("scope");
});

it("要你动手的提示不倒计时自己消失", async () => {
  await turn("帮我看看这个场地", response("ask"));
  expect(flow.noticeSticky).toBe(true);
  // 卡上出现的是「补充对话里的信息后可以继续」，不应带倒计时收场。
  expect(host.textContent).toContain("补充对话里的信息后可以继续");
  expect(host.textContent).not.toContain("后收起");
});

it("地图依据没取全时，place 卡不再承诺自动框选", async () => {
  Object.assign(bridge, {
    mapContext: async (): Promise<OutdoorMapContext> => ({
      version: "map:failed",
      status: "unavailable",
      text: "底图服务 503不可用",
      featureIds: [],
      unknowns: ["建筑轮廓未知"],
    }),
  });
  await turn("就用杭州湖滨银泰in77", response("ask"));
  expect(flow.mapGap).toBe(true);
  act(() => flow.dismissNotice());
  expect(host.textContent).toContain("没有取到可核对的真实地图/轮廓");
  expect(host.textContent).toContain("在地图上手画活动范围");
  expect(host.textContent).not.toContain("自动为你框选项目区域");
});

// 2026-11-17 用户实测：说「就沿着水岸线」，智能体回「工作台里没有可识别的水岸线……请告诉我哪一侧」。
// 水岸进快照之后，这句必须变成沿岸预览，而不是又一个方位追问。
it("说「就沿着水岸线」时沿真实岸线出预览，不再反问北/东/南/西", async () => {
  await confirmScope();
  const shore = {
    id: "ofm:water/1",
    name: "南侧河",
    closed: false,
    points: [
      { x: 0, y: 30 },
      { x: 80, y: 30 },
    ],
  };
  Object.assign(bridge, {
    mapContext: async (): Promise<OutdoorMapContext> => ({
      version: "map:water",
      status: "partial",
      text: "{}",
      featureIds: [shore.id],
      unknowns: [],
      water: () => [shore],
    }),
  });
  understand.mockResolvedValueOnce(
    response("ask", {}, {
      reply:
        "我理解你想让比赛沿水岸线排布。但当前工作台里没有可识别的真实水岸线/水域对象。请先告诉我哪一侧。",
    }),
  );
  await act(async () => {
    await flow.handle("就沿着水岸线");
  });
  expect(flow.proposal?.label).toContain("沿岸排布");
  const stations = flow.proposal?.next.facilities.filter((f) => f.name.startsWith("钓位")) ?? [];
  expect(stations.length).toBeGreaterThan(5);
  expect(host.textContent).not.toContain("没有可识别的真实水岸线");
});

it("地图上没有水系时，沿岸请求给可执行下一步（画一条岸线），不说「请告诉我方位」", async () => {
  await confirmScope();
  Object.assign(bridge, {
    mapContext: async (): Promise<OutdoorMapContext> => ({
      version: "map:dry",
      status: "partial",
      text: "{}",
      featureIds: [],
      unknowns: [],
      water: () => [],
    }),
  });
  understand.mockResolvedValueOnce(
    response("ask", {}, { reply: "请告诉我水岸在哪一侧。" }),
  );
  await act(async () => {
    await flow.handle("就沿着水岸线");
  });
  expect(flow.proposal).toBeNull();
  const said = saySpy.mock.calls.map((call) => String(call[0] ?? "")).join("\n");
  expect(said).toContain("没有水系");
  expect(said).toContain("标注");
});

// 2026-11-17 用户拍板：沿岸活动不依赖模型回 ask——模型直接给设计动作时同样落沿岸排布。
it("模型不回 ask 也能沿岸：钓鱼比赛 + zones 动作直接出预览，不落「只支持讲座/市集」", async () => {
  await confirmScope();
  const shore = {
    id: "ofm:water/2",
    name: "南侧河",
    closed: false,
    points: [
      { x: 0, y: 30 },
      { x: 80, y: 30 },
    ],
  };
  Object.assign(bridge, {
    mapContext: async (): Promise<OutdoorMapContext> => ({
      version: "map:water2",
      status: "partial",
      text: "{}",
      featureIds: [shore.id],
      unknowns: [],
      water: () => [shore],
    }),
  });
  understand.mockResolvedValueOnce(response("zones"));
  await act(async () => {
    await flow.handle("这里要办一个钓鱼比赛，就沿着水岸线");
  });
  expect(flow.proposal?.label).toContain("沿岸排布");
  const stations = flow.proposal?.next.facilities.filter((f) => f.name.startsWith("钓位")) ?? [];
  expect(stations.length).toBeGreaterThan(5);
});

it("objects 动作同样沿岸，不被主入口核对拦住", async () => {
  await confirmScope();
  const shore = {
    id: "ofm:water/3",
    name: "湖岸",
    closed: false,
    points: [
      { x: 0, y: 40 },
      { x: 80, y: 40 },
    ],
  };
  Object.assign(bridge, {
    mapContext: async (): Promise<OutdoorMapContext> => ({
      version: "map:water3",
      status: "partial",
      text: "{}",
      featureIds: [shore.id],
      unknowns: [],
      water: () => [shore],
    }),
  });
  understand.mockResolvedValueOnce(response("objects"));
  await act(async () => {
    await flow.handle("这里要办一个钓鱼比赛");
  });
  expect(flow.proposal?.label).toContain("沿岸排布");
});

it("brief 记下钓鱼比赛后，后续一句 zones 也走沿岸", async () => {
  await confirmScope();
  const shore = {
    id: "ofm:water/4",
    name: "河岸",
    closed: false,
    points: [
      { x: 0, y: 30 },
      { x: 80, y: 30 },
    ],
  };
  Object.assign(bridge, {
    mapContext: async (): Promise<OutdoorMapContext> => ({
      version: "map:water4",
      status: "partial",
      text: "{}",
      featureIds: [shore.id],
      unknowns: [],
      water: () => [shore],
    }),
  });
  understand.mockResolvedValueOnce(
    response("ask", { event: { value: "钓鱼比赛", evidence: "这里要办一个钓鱼比赛" } }),
  );
  await act(async () => {
    await flow.handle("这里要办一个钓鱼比赛");
  });
  understand.mockResolvedValueOnce(response("zones"));
  await act(async () => {
    await flow.handle("先排吧");
  });
  expect(flow.proposal?.label).toContain("沿岸排布");
});

// 2026-11-17 用户拍板「沿线/巡游和沿岸一起进第一批」：巡游补给沿线排布，模型不回 ask 也能直达。
it("模型不回 ask 也能沿线：巡游补给 + zones 动作直接出沿线预览", async () => {
  await confirmScope();
  const road = {
    id: "ofm:road/9",
    name: "滨河路",
    points: [
      { x: 0, y: 30 },
      { x: 80, y: 30 },
    ],
  };
  Object.assign(bridge, {
    mapContext: async (): Promise<OutdoorMapContext> => ({
      version: "map:road",
      status: "partial",
      text: "{}",
      featureIds: [road.id],
      unknowns: [],
      roadLines: () => [road],
    }),
  });
  understand.mockResolvedValueOnce(response("zones"));
  await act(async () => {
    await flow.handle("这里要办一场巡游，沿线摆补给站");
  });
  expect(flow.proposal?.label).toContain("沿线排布");
  const stations = flow.proposal?.next.facilities.filter((f) => f.name.startsWith("补给站")) ?? [];
  expect(stations.length).toBeGreaterThanOrEqual(2);
  // 地图参照：补一条赛事中心线（示意）。
  expect(flow.proposal?.next.routes.some((r) => r.name.includes("赛事线"))).toBe(true);
});

it("画布上已有的巡游线可直接作沿线参照，不重复加赛道线", async () => {
  await confirmScope();
  plan = {
    ...plan,
    routes: [
      {
        id: "11111111-1111-4111-8111-000000000009",
        kind: "pedestrian",
        name: "巡游线",
        points: [
          { x: 10, y: 30 },
          { x: 90, y: 30 },
        ],
        widthM: 3,
        oneWay: false,
        notes: "",
      },
    ],
  };
  Object.assign(bridge, {
    mapContext: async (): Promise<OutdoorMapContext> => ({
      version: "map:dry2",
      status: "partial",
      text: "{}",
      featureIds: [],
      unknowns: [],
    }),
  });
  understand.mockResolvedValueOnce(response("objects"));
  await act(async () => {
    await flow.handle("这里要办一场巡游，沿线摆补给站");
  });
  expect(flow.proposal?.label).toContain("沿线排布·巡游线");
  // 画布线路自身就是赛道，不再重复补赛事中心线。
  expect(flow.proposal?.next.routes).toHaveLength(1);
  const stations = flow.proposal?.next.facilities.filter((f) => f.name.startsWith("补给站")) ?? [];
  expect(stations.length).toBeGreaterThanOrEqual(2);
});

it("走查记录本：标一条才算看过，非法编号这一标不生效", () => {
  // 开场没有任何证据：11 条全算没看。
  expect(flow.walkthroughLine()).toContain("已看 0/11");
  act(() => {
    flow.recordWalkthrough(3, "pass");
  });
  expect(flow.walkthroughLine()).toContain("已看 1/11");
  expect(flow.walkthroughLine()).toContain("通过 1");
  // 编号不在 1..11：返回 null，且记录本不变。
  expect(flow.recordWalkthrough(99, "pass")).toBeNull();
  expect(flow.walkthroughLine()).toContain("已看 1/11");
  // 记录本永远不下结论。
  expect(flow.walkthroughLine()).not.toContain("可发布（");
});
