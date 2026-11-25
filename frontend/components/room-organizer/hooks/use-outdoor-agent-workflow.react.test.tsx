// @vitest-environment jsdom
import { act } from "react";
import { waitFor } from '@testing-library/react';
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, it, expect, vi, type Mock } from "vitest";
import { MemoryStorage } from "@/lib/test-support-memory-storage";
import type { BackendSession } from "@/lib/backend-session";
import { assistantChatRequestSchema } from "../../../../supabase/functions/_shared/assistant-chat-contract";
import type { ChatProviderId } from "../../../../supabase/functions/_shared/chat-provider";
import { createStarterOutdoorPlan, saveOutdoorProjectRecord } from "../lib/outdoor-project-store";
import { FIXED_DATA_CASES } from "../lib/outdoor-release-status-card";
import { OUTDOOR_STAGE_LABELS, useOutdoorAgentWorkflow } from "./use-outdoor-agent-workflow";
import { OutdoorWorkflowCard } from "../components/outdoor-workflow-card";
import { getGenerationSheetState, resetGenerationSheetForTests } from "../lib/generation-sheet";
import { getAgentSupervision, setAgentSupervision } from '../lib/agent-supervision-store';
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
vi.mock(import('../lib/openfreemap-buildings'), async importOriginal => ({
  ...await importOriginal(),
  fetchOpenFreeMapBuildings: vi.fn(async () => []),
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
let supervision: "strict" | "key-points" | "auto" | undefined;
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
    supervision: () => supervision,
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
/** 以已落盘的流程状态重挂载（模拟刷新后回到「核对具体活动范围」）。 */
function mountAtFlowState(patch: Record<string, unknown>) {
  act(() => root.unmount());
  localStorage.setItem(
    `scendance:outdoor-flow:${scope}`,
    JSON.stringify({
      scope,
      stage: "place",
      brief: { zones: [], items: [], people: [] },
      confirmedBoundary: null,
      completed: [],
      ...patch,
    }),
  );
  root = createRoot(host);
  mount();
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
let mem: MemoryStorage;
beforeEach(() => {
  mem = new MemoryStorage();
  vi.stubGlobal('Storage', MemoryStorage);
  vi.stubGlobal('localStorage', mem);
  window.localStorage = mem;
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  resetGenerationSheetForTests();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  plan = { ...createStarterOutdoorPlan(), boundary: ring };
  epoch = 0;
  scope = "project-a";
  chatMeta = { provider: undefined, model: null };
  sessionUser = undefined;
  supervision = "strict";
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
  mem?.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
it("户外问答跟随面板所选 provider 与 model 透传到对话请求", async () => {
  providerOverride = () => "tokendance";
  modelOverride = () => "tk-another";
  await turn("布置一个户外市集", response("ask", {}));
  expect(chatMeta.provider).toBe("tokendance");
  expect(chatMeta.model).toBe("tk-another");
});

it('婚礼自主重排不因缺参数请求云端追问，生成地图候选并在应用前保存完整恢复版本',async()=>{
  plan.zones=[{id:crypto.randomUUID(),name:'仪式区',purpose:'audience',semantic:'audience',environment:'outdoor',polygon:[{x:1,y:1},{x:3,y:1},{x:3,y:3},{x:1,y:3}],notes:''}];
  bridge.readLibrary=vi.fn(async()=>[]);
  await confirmScope();
  const original=structuredClone(plan);
  apply.mockClear();
  await act(async()=>{await flow.handle('请重新规划60人户外婚礼，不需要等待我逐项补充参数');});
  if(flow.pendingPlan){const pending=flow.pendingPlan;await act(async()=>{await flow.approvePlan(pending);});}
  expect(understand).not.toHaveBeenCalled();
  expect(flow.proposal?.next.facilities.filter(f=>f.name.startsWith('观礼椅'))).toHaveLength(60);
  expect(flow.proposal?.next.facilities.filter(f=>f.name.startsWith('宴席圆桌'))).toHaveLength(6);
  expect(plan).toEqual(original);
  expect(apply).not.toHaveBeenCalled();
  await action('confirm');
  expect(apply).toHaveBeenCalledOnce();
  const backupKey=Object.keys(localStorage).find(key=>key.startsWith('scendance-outdoor-plan-v1:agent-before-'));
  expect(backupKey).toBeTruthy();
  expect(JSON.parse(localStorage.getItem(backupKey!)!).plan).toEqual(original);
  expect(saySpy.mock.calls.some(([text])=>text.includes('打开原方案'))).toBe(true);
});

it('婚礼自主规划的复杂要求保留模型事实，缺少桌位参数的追问自动转成设计候选',async()=>{
  await confirmScope();
  bridge.readLibrary=vi.fn(async()=>[]);
  await turn('请继续执行60人户外婚礼规划，入口尚未核对，不需要等待我逐项补充参数',response('ask',{
    event:{value:'户外婚礼',evidence:'户外婚礼'},guests:{value:60,evidence:'60人'},
  },{reply:'每桌几人？'}));
  expect(understand).toHaveBeenCalledOnce();
  expect(flow.proposal?.next.facilities.filter(f=>f.name.startsWith('宴席圆桌'))).toHaveLength(6);
  expect(flow.proposal?.warnings.join(' ')).toContain('入口');
  expect(saySpy.mock.calls.some(([text])=>text==='每桌几人？')).toBe(false);
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
  await act(async () => { await flow.handle("先给计划，安排室外展览区"); });
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
  // 2026-11-18 用户实测：没给分区用途时不挂「生成分区预览」空头按钮（点了只会撞红卡反问），
  // 改为如实引导；给过用途后按钮才出现。
  expect(buttons.some(button => button.textContent?.trim() === "生成分区预览")).toBe(false);
  expect(host.textContent).toContain("说一句用途和室内外");
  const draw = buttons.find(button => button.textContent?.trim() === "在地图上手画分区");
  await act(async () => { draw!.click(); });
  expect(beginDrawing).toHaveBeenCalledWith("zone");
  expect(flow.notice).toContain("请在地图上画出分区轮廓并闭合");
  // 2026-11-18 用户实测：进手画模式后卡上不再留自相矛盾的旧引导——引导语与手画按钮都收掉，
  // 通知条是唯一指令，避免「收起」和内容脱节的观感。
  expect(host.textContent).not.toContain("说一句用途和室内外");
  expect([...host.querySelectorAll("button")].some(button => button.textContent?.trim() === "在地图上手画分区")).toBe(false);
});
it("分区预览带水体核对：压水指名分区与红线，缺水体数据标待核（P0-A 2026-11-25）", async () => {
  await confirmScope();
  apply.mockClear();
  // 掩膜盖住整块场地：红线与每个预览分区都压水 → 设计过程与预览卡都点名。
  bridge.mapContext = vi.fn(async (): Promise<OutdoorMapContext> => ({
    version: "map:ready",
    status: "ready",
    text: "已取到结构化地图依据",
    featureIds: [],
    unknowns: [],
    water: () => [{ id: "ofm:water/lake", name: "湖面", points: [{ x: -200, y: -200 }, { x: 300, y: -200 }, { x: 300, y: 200 }, { x: -200, y: 200 }], closed: true }],
  }));
  await turn("办一场市集，全部室外", response("zones", {}));
  expect(flow.proposal?.kind, flow.notice).toBe("zones");
  expect(flow.proposal?.warnings.join("\n")).toContain("活动红线压到水面。");
  expect(flow.proposal?.warnings.join("\n")).toContain("压到水面的分区：");
  expect(host.textContent).toContain("活动红线压到水面。");
  expect(apply).not.toHaveBeenCalled();
  // 确认仍照常走：核对回执不拦流程，只补事实。
  await action("confirm");
  expect(plan.zones.length).toBeGreaterThan(0);
});

it("没有水体数据时分区分区预览标一句待核，不静默当无事（P0-A 2026-11-25）", async () => {
  await confirmScope();
  apply.mockClear();
  // 不挂 mapContext：mapRef 停在 unknownMap，water() 缺失 → 掩膜为空。
  await turn("办一场市集，全部室外", response("zones", {}));
  expect(flow.proposal?.kind, flow.notice).toBe("zones");
  expect(flow.proposal?.warnings.join("\n")).toContain("水体数据未取得");
  expect(flow.proposal?.warnings.join("\n")).toContain("待核");
  expect(apply).not.toHaveBeenCalled();
  await action("confirm");
  expect(plan.zones.length).toBeGreaterThan(0);
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
  act(() => flow.offerBoundary(anchor, ring, "IN77", undefined, undefined, false, ["候选范围压到水面。"]));
  expect(host.textContent).toContain("候选范围压到水面。");
  expect(apply).not.toHaveBeenCalled();
  expect(flow.appliedHighlight).toBeNull();
  expect(host.textContent).toContain("确认“IN77”的活动范围");
  // 2026-11-20 用户拍板：卡上不再写「地点轮廓只是候选」这类交代。
  expect(host.textContent).not.toContain("地点轮廓只是候选");
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
  expect(host.textContent).toContain("不贴合就拖顶点调整，改完重新核对");
});
it("自动档下画布已有同一条红线时「确认活动范围」一次落地，不再弹第二张确认卡", async () => {
  // 2026-11-21 用户实测：核对阶段对有效红线原样重发提案，两击确认的是同一份数据。
  // 提案与画布完全一致且监督档不另要求复核时，点一下就直接应用并推进到分区。
  supervision = "auto";
  await action("scope");
  expect(apply).toHaveBeenCalledTimes(1);
  expect(plan.boundary).toEqual(ring);
  expect(flow.proposal).toBeNull();
  expect(flow.state.confirmedBoundary).not.toBeNull();
  expect(flow.state.stage).toBe("zones");
  expect(flow.notice).toContain("已应用");
});
it("严格档下同一条红线仍停在核对卡，一次一确认不变", async () => {
  await action("scope");
  expect(flow.proposal?.kind).toBe("scope");
  expect(apply).not.toHaveBeenCalled();
  await action("confirm");
  expect(apply).toHaveBeenCalledTimes(1);
  expect(flow.state.stage).toBe("zones");
});
it("自动档下搜索候选点选直接落地：不再弹范围核对卡", async () => {
  // 2026-11-21 用户拍板「候选点选直接落地」：候选是用户刚亲手选的，锚定写入不再立核对卡。
  supervision = "auto";
  plan = { ...plan, boundary: [] };
  await act(async () => {
    await flow.offerBoundary({ ...plan.anchor!, lng: 120.1 }, ring, "IN77", undefined, undefined, true);
  });
  expect(apply).toHaveBeenCalledTimes(1);
  expect(plan.boundary).toEqual(ring);
  expect(flow.proposal).toBeNull();
  expect(flow.state.stage).toBe("zones");
});
it("严格档下候选点选仍停在核对卡", async () => {
  plan = { ...plan, boundary: [] };
  await act(async () => {
    await flow.offerBoundary({ ...plan.anchor!, lng: 120.2 }, ring, "IN77", undefined, undefined, true);
  });
  expect(apply).not.toHaveBeenCalled();
  expect(flow.proposal?.kind).toBe("scope");
  await action("confirm");
  expect(apply).toHaveBeenCalledTimes(1);
  expect(flow.state.stage).toBe("zones");
});
it("自动档下范围确认后重画红线：新范围直接生效，流程继续不卡死", async () => {
  // 2026-11-21 用户实测：范围确认后想重画场地，画布轮询只在 place/scope 活着，
  // 重画的边界没人收——任务卡停在「分区用途」，画布上只剩孤零零的新红线，流程卡死。
  // 自动档：重画的红线是用户亲手画的，走「候选点选直接落地」同款口径直接生效；
  // 严格档仍停在核对卡（见「当前规划改变后重画红线」那条）。
  supervision = "auto";
  await action("scope");
  expect(flow.state.stage).toBe("zones");
  // 画布上出现重画的新红线（键与已确认键不一致）
  const ring2 = [
    { x: 10, y: 5 },
    { x: 90, y: 5 },
    { x: 90, y: 75 },
    { x: 10, y: 75 },
  ];
  plan = { ...plan, boundary: ring2 };
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 900));
  });
  expect(flow.proposal).toBeNull();
  expect(flow.state.confirmedBoundary).not.toBeNull();
  expect(plan.boundary).toEqual(ring2);
  expect(flow.state.stage).toBe("zones");
});
it("判据13·状态机不变量：确认链上 stage 单调前进、completed 只增、happy path 无 blocked", async () => {
  // docs/63 判据 #13：这条不变量曾在 950c6dd8 被打破（nextStage 原地不动，用户循环确认同一范围）。
  // 走一遍完整 happy path，在每个检查点核对四条不变量；编排抽离前后各跑一遍当行为等价裁判。
  const stages = ["place", "scope", "zones", "main-routes", "objects", "sub-routes", "people", "refine-3d"];
  let prevIdx = -1;
  let prevCompleted = 0;
  const checkpoint = (label: string, mustAdvance = false) => {
    const idx = stages.indexOf(flow.state.stage);
    const completed = flow.state.completed.length;
    expect(idx, `${label} · stage 不得回退（停在 ${flow.state.stage}）`).toBeGreaterThanOrEqual(prevIdx);
    if (mustAdvance) expect(idx, `${label} · 确认后必须前进（停在 ${flow.state.stage}）`).toBeGreaterThan(prevIdx);
    expect(completed, `${label} · completed 只增`).toBeGreaterThanOrEqual(prevCompleted);
    expect(flow.noticeKind, `${label} · happy path 不得出现 blocked`).not.toBe("blocked");
    expect(flow.noticeKind, `${label} · happy path 不得出现 error`).not.toBe("error");
    prevIdx = idx;
    prevCompleted = completed;
  };
  // scope：画布已有红线，严格档两步确认
  await action("scope");
  checkpoint("范围核对卡就绪");
  await action("confirm");
  checkpoint("范围确认后", true);
  // zones：登记需求 → 给用途 → 预览 → 确认（链上直接接物件预览）
  bridge.readLibrary = vi.fn(async () => [
    { id: "my-stall", name: "市集摊位", source: "personal" as const, width: 3, depth: 3, height: 2.5, modelSlug: "generated:library-my-stall", available: true },
  ]);
  await turn("做户外市集60人", response("ask", { event: { value: "户外市集", evidence: "户外市集" }, guests: { value: 60, evidence: "60人" } }));
  checkpoint("需求登记");
  await turn("展览区在室外", response("zones", { zones: [{ name: "展览区", purpose: "exhibition", environment: "outdoor", evidence: "展览区在室外" }] }));
  checkpoint("分区预览就绪");
  await action("confirm");
  checkpoint("分区确认后（链上到物件）", true);
  // 链上的物件预览（严格档停卡）→ 确认 → 直达岗位阶段
  await action("confirm");
  checkpoint("物件确认后（直达 people）", true);
  expect(flow.state.stage).toBe("people");
});
it("范围依据不再贴到画布：提案不生成说明注记，旧注记随手清掉", () => {
  const anchor = { ...plan.anchor!, lng: 120.44 };
  plan = {
    ...plan,
    annotations: [{ id: crypto.randomUUID(), kind: "note" as const, name: "Agent 场地范围依据", points: [{ ...ring[0] }], text: "仅取得地点整体轮廓", notes: "place-outline" }],
  };
  act(() =>
    flow.offerBoundary(anchor, ring, "IN77", {
      kind: "place-outline",
      location: "mapped",
      scale: "mapped",
      detail: "仅取得地点整体轮廓，尚未识别具体可用草坪。",
    }),
  );
  const names = (flow.proposal?.next.annotations ?? []).map(note => note.name);
  expect(names).not.toContain("Agent 场地范围依据");
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
it("卡确认后写进本机 cards 槽，刷新重挂从本机槽读回", async () => {
  const anchor = { ...plan.anchor!, lng: 120.25 };
  act(() => flow.offerBoundary(anchor, ring, "IN77"));
  const confirm = [...host.querySelectorAll("button")].find(
    (b) => b.textContent?.includes("确认并应用这一版"),
  )!;
  await act(async () => {
    confirm.click();
  });
  expect(flow.cardRecords).toHaveLength(1);
  const cardKey = `scendance:outdoor-cards:${scope}`;
  const stored = JSON.parse(localStorage.getItem(cardKey) ?? "[]") as Array<{ decision: string }>;
  expect(Array.isArray(stored)).toBe(true);
  expect(stored).toHaveLength(1);
  expect(stored[0].decision).toBe("confirmed");
  // 刷新 = 卸载后同一本机存储重挂；历史卡片应从本机槽接回，不落回空态。
  act(() => root.unmount());
  root = createRoot(host);
  mount();
  expect(flow.cardRecords).toHaveLength(1);
  expect(flow.cardRecords.at(-1)!.title).toContain("活动范围");
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
it("旧记录没有候选和边界时留在核对阶段并提示手画，不退回搜索", async () => {
  plan = { ...plan, boundary: [] };
  mountAtFlowState({ stage: "scope", completed: ["place"] });
  await action("scope");
  expect(flow.state.stage).toBe("scope");
  expect(host.textContent).toContain("在地图上手画活动范围");
  expect(flow.notice).toContain("重新搜索地点");
  expect(flow.busy).toBe(false);
  expect(apply).not.toHaveBeenCalled();
});
it("候选边界遇到画布基座变化仍恢复核对，不把任务打回搜索", async () => {
  plan = { ...plan, boundary: [] };
  const anchor = { ...plan.anchor!, lng: 120.1 };
  act(() => flow.offerBoundary(anchor, ring, "IN77"));
  // 画布随后自动补了设计范围（非实体字段），候选签发时的 base 已不一致。
  plan = { ...plan, designScope: ring.map(point => ({ ...point })) };
  await action("scope");
  expect(flow.state.stage).toBe("scope");
  expect(flow.state.pendingBoundary?.boundary).toEqual(ring);
  expect(flow.proposal?.next.boundary).toEqual(ring);
  expect(flow.notice).not.toContain("没有可核对");
  expect(flow.busy).toBe(false);
  expect(apply).not.toHaveBeenCalled();
});
it.each(["place", "scope"])("%s 阶段搜索轮廓到达后自动出现确认按钮，确认前不写入，撤回不反复弹出", async stage => {
  vi.useFakeTimers();
  try {
    plan = { ...plan, boundary: [] };
    let visible: ReturnType<NonNullable<OutdoorAgentBridge["visibleActivityRange"]>> = null;
    bridge.visibleActivityRange = () => visible;
    mountAtFlowState({ stage, completed: stage === "scope" ? ["place"] : [] });
    expect(flow.proposal).toBeNull();
    visible = { anchor: plan.anchor!, boundary: ring, name: "杭州植物园" };
    await act(async () => { await vi.advanceTimersByTimeAsync(800); });
    expect(flow.proposal?.label).toContain("杭州植物园");
    expect(host.textContent).toContain("确认并应用这一版");
    expect(host.textContent).not.toContain("先在图上圈出这次活动用的地");
    expect(plan.boundary).toEqual([]);expect(apply).not.toHaveBeenCalled();
    act(() => flow.cancel());
    await act(async () => { await vi.advanceTimersByTimeAsync(1600); });
    expect(flow.proposal).toBeNull();
    visible = { ...visible, boundary: ring.map(p => ({ x: p.x * 2, y: p.y * 2 })) };
    await act(async () => { await vi.advanceTimersByTimeAsync(800); });
    expect(flow.proposal?.kind).toBe("scope");
    await action("confirm");
    expect(plan.boundary).toEqual(visible.boundary);expect(flow.state.stage).toBe("zones");
  } finally { vi.useRealTimers(); }
});
it("没有红线时核对把地图上的可见范围送进确认卡，确认后写入且不退回搜索", async () => {
  plan = { ...plan, boundary: [] };
  bridge.visibleActivityRange = () => ({
    anchor: plan.anchor!,
    boundary: ring,
    name: "玉泉",
  });
  mountAtFlowState({ stage: "scope", completed: ["place"] });
  await action("scope");
  expect(flow.state.stage).toBe("scope");
  expect(flow.proposal?.kind).toBe("scope");
  expect(flow.proposal?.label).toContain("玉泉");
  expect(flow.proposal?.next.boundary).toEqual(ring);
  expect(host.textContent).not.toContain("搜索目标地点");
  expect(apply).not.toHaveBeenCalled();
  await action("confirm");
  expect(plan.boundary).toEqual(ring);
  expect(flow.state.stage).toBe("zones");
  expect(host.textContent).not.toContain("搜索目标地点");
});
it("只有搜索选区时继续设计会先核对这块可见范围，不退回搜索", async () => {
  plan = { ...plan, boundary: [] };
  bridge.visibleActivityRange = () => ({
    anchor: plan.anchor!,
    boundary: ring,
    name: "玉泉",
  });
  mountAtFlowState({ stage: "zones", completed: ["place"] });
  await turn(
    "室外展览区",
    response("zones", {
      zones: [{
        name: "展览区",
        purpose: "exhibition",
        environment: "outdoor",
        evidence: "室外展览区",
      }],
    }),
  );
  expect(flow.proposal?.kind).toBe("scope");
  expect(flow.proposal?.next.boundary).toEqual(ring);
  expect(flow.state.stage).not.toBe("place");
  expect(host.textContent).not.toContain("搜索目标地点");
  expect(plan.boundary).toEqual([]);
});
it("只有默认西湖锚点、没有任何场地内容时，不把锚点当场地重置任务", async () => {
  plan = { ...plan, boundary: [] };
  mountAtFlowState({ stage: "place" });
  act(() => flow.reconcileCanvasStage());
  expect(flow.state.stage).toBe("place");
  expect(host.textContent).toContain("搜索目标地点");
  expect(plan.anchor?.source).toBe("preset");
  expect(plan.boundary).toEqual([]);
});
it("重开已有分区的命名方案：任务接回分区核对，不退回搜索目标地点", async () => {
  plan = {
    ...plan,
    boundary: [],
    zones: [{
      id: "zone-existing",
      name: "展览区",
      purpose: "audience",
      semantic: "audience",
      environment: "outdoor",
      polygon: [{ x: 1, y: 1 }, { x: 9, y: 1 }, { x: 9, y: 9 }, { x: 1, y: 9 }],
      notes: "",
    }],
  };
  const before = structuredClone(plan);
  mountAtFlowState({ stage: "place" });
  act(() => flow.reconcileCanvasStage());
  expect(flow.state.stage).toBe("zones");
  expect(host.textContent).not.toContain("搜索目标地点");
  // 只对账阶段：不自动确认、不改写边界与锚点。
  expect(plan).toEqual(before);
  expect(flow.state.confirmedBoundary).toBeNull();
});
it("已有可见范围时 search 不把任务卡打回搜索目标地点；没有任何范围时仍回去", async () => {
  plan = { ...plan, boundary: [] };
  bridge.visibleActivityRange = () => ({
    anchor: plan.anchor!,
    boundary: ring,
    name: "玉泉",
  });
  mountAtFlowState({ stage: "scope", completed: ["place"] });
  await turn("再搜一个地点", response("search", {}, { query: "玉泉" }));
  expect(flow.state.stage).toBe("scope");
  expect(host.textContent).not.toContain("搜索目标地点");
  // 搜索轮廓现在会自动成为待确认候选；清除地点时一并撤回这份候选。
  act(() => flow.cancel());
  bridge.visibleActivityRange = () => null;
  plan = { ...plan, boundary: [] };
  await turn("换个地方", response("search", {}, { query: "西湖" }));
  expect(flow.state.stage).toBe("place");
  expect(host.textContent).toContain("搜索目标地点");
});
it("地图已有有效边界时核对重新预览并在确认后写入，边界不被清掉", async () => {
  plan = { ...plan, boundary: ring };
  mountAtFlowState({ stage: "scope", completed: ["place"] });
  apply.mockClear();
  await action("scope");
  expect(flow.state.stage).toBe("scope");
  expect(flow.proposal?.next.boundary).toEqual(ring);
  expect(apply).not.toHaveBeenCalled();
  expect(plan.boundary).toEqual(ring);
  expect(flow.busy).toBe(false);
  await action("confirm");
  expect(apply).toHaveBeenCalledTimes(1);
  expect(plan.boundary).toEqual(ring);
  expect(flow.state.stage).toBe("zones");
  expect(flow.state.pendingBoundary).toBeUndefined();
  expect(flow.state.confirmedBoundary).not.toBeNull();
});
it("Esc 取消手画后撤掉未确认候选，不在核对阶段留待写入状态", async () => {
  plan = { ...plan, boundary: [] };
  mountAtFlowState({
    stage: "scope",
    completed: ["place"],
    pendingBoundary: { anchor: plan.anchor!, boundary: ring, name: "IN77", base: JSON.stringify(plan) },
  });
  expect(flow.state.stage).toBe("scope");
  act(() => flow.manualCanceled());
  expect(flow.state.stage).toBe("place");
  expect(flow.state.pendingBoundary).toBeUndefined();
  expect(flow.notice).toContain("已取消");
  expect(host.textContent).not.toContain("确认活动范围");
});
it("取消重画时已确认的边界和核对阶段保留", async () => {
  plan = { ...plan, boundary: ring };
  mountAtFlowState({ stage: "scope", completed: ["place", "scope"], confirmedBoundary: "existing-boundary" });
  act(() => flow.manualCanceled());
  expect(flow.state.stage).toBe("scope");
  expect(flow.state.confirmedBoundary).toBe("existing-boundary");
  expect(plan.boundary).toEqual(ring);
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
  // 2026-11-18 用户口径「先设计」：分区确认后直接接物件预览，测试给一份真实库反应。
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
    {
      id: "my-stall",
      name: "市集摊位",
      source: "personal" as const,
      width: 3,
      depth: 3,
      height: 2.5,
      modelSlug: "generated:library-my-stall",
      available: true,
    },
  ]);
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
  // 确认分区后不再停在「主通道」，直接给一版按分区排的物件预览。
  expect(flow.state.stage).toBe("objects");
  expect(flow.proposal?.kind, flow.notice).toBe("objects");
  // 分区已应用；随后接的物件版是未确认的预览，画布高亮让给新一版。
  expect(flow.appliedHighlight).toBeNull();
  expect(host.textContent).toContain("这版是默认方案");

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
  expect(host.textContent).toContain("路线和候选入口可拖动微调");
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
it("当前规划改变后重画红线：旧提案被新范围核对卡替换，画布不被覆盖", async () => {
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
  // 2026-11-21：重画红线不再等用户点旧提案的确认才报「失效」——看护 800ms 内把任务卡
  // 轮回「核对活动范围」并签发新确认卡，画布原样保留等用户确认新范围。
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 900));
  });
  expect(JSON.stringify(plan)).toBe(snapshot);
  expect(flow.proposal?.kind).toBe("scope");
  expect(flow.notice).toContain("确认重画的活动范围");
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
it("已确认场地后一次 search 不再静默丢场地，任务卡也不退回搜索", async () => {
  await confirmScope();
  const before = JSON.stringify(plan);
  await turn("看看别的地点", response("search", {}, { query: "别的地点" }));
  expect(flow.state.stage).toBe("zones");
  expect(flow.state.confirmedBoundary).not.toBeNull();
  expect(host.textContent).not.toContain("搜索目标地点");
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
it.skip("真实个人库复用→子线岗位→同plan3D替换/上传/生成表单，不启动收费请求", async () => {
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
}, 20000);
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
// 2026-11-17 闭环验收：物品摆放不是一次性动作——确认后还要能反复改口，每一轮都是
// 「预览 → 确认」，画布与需求始终一致，不重复铺。
it("摆好之后能连续两轮改口：每轮都出预览、确认后画布与需求一致", async () => {
  await confirmScope();
  seedMarketPlan();
  stubLibraryByQuery();
  await turn(
    "摆摊区放20个摊位",
    response("objects", { items: [{ zone: "摆摊区", query: "市集摊位", count: 20, evidence: "20个摊位" }] }),
  );
  expect(flow.proposal?.kind, flow.notice).toBe("objects");
  await action("confirm");
  expect(plan.facilities).toHaveLength(20);
  await turn(
    "改成22个",
    response("objects", { items: [{ zone: "摆摊区", query: "市集摊位", count: 22, evidence: "22个" }] }),
  );
  expect(flow.proposal?.kind, flow.notice).toBe("objects");
  await action("confirm");
  expect(plan.facilities).toHaveLength(22);
  await turn(
    "改成25个",
    response("objects", { items: [{ zone: "摆摊区", query: "市集摊位", count: 25, evidence: "25个" }] }),
  );
  await action("confirm");
  expect(plan.facilities).toHaveLength(25);
  // 需求始终跟着用户最后一句话走，没有被偷偷改成缩过的数。
  expect(flow.state.brief.items).toEqual([
    { zone: "摆摊区", query: "市集摊位", count: 25, evidence: "25个" },
  ]);
}, 20000);
// 2026-11-17 用户拍板「就硬挤在一起，甲方就会明白放不下了」：要的数量放不下时不缩数量、不红卡，
// 切「硬挤」重排塞到物理极限——预览自己说明放不下，卡上只报差额与极限。
it("要的数量放不下：按「硬挤」出预览塞到物理极限，需求原文不动", async () => {
  await confirmScope();
  seedMarketPlan();
  stubLibraryByQuery();
  await turn(
    "摆摊区放120个摊位",
    response("objects", { items: [{ zone: "摆摊区", query: "市集摊位", count: 120, evidence: "120个摊位" }] }),
  );
  expect(flow.noticeKind, flow.notice).not.toBe("error");
  expect(flow.proposal?.kind, flow.notice).toBe("objects");
  // 卡上说的是「硬挤的物理极限」，不是替用户缩过的数。
  expect(flow.proposal?.warnings.join()).toContain("硬挤");
  expect(flow.proposal?.warnings.join()).toContain("120");
  // 预览里塞进去的比正常间距（25）多得多，但远到不了 120——这就是可视化的「放不下」。
  const placed = flow.proposal?.next.facilities.filter((f) => f.name.startsWith("市集摊位")) ?? [];
  expect(placed.length).toBeGreaterThan(25);
  expect(placed.length).toBeLessThan(120);
  // 用户记下的需求保持原话；画布仍然只在确认后才写。
  expect(flow.state.brief.items).toEqual([
    { zone: "摆摊区", query: "市集摊位", count: 120, evidence: "120个摊位" },
  ]);
  expect(plan.facilities).toHaveLength(0);
  await action("confirm");
  expect(plan.facilities.length).toBe(placed.length);
  // 确认后的回话说清「需求没变、画布已到物理上限」。
  expect(flow.notice).toContain("硬挤");
}, 20000);
// 2026-11-17 断点修复完成：用户 review 批准共享契约 items count min(1)→min(0)，
// 「摊位都撤了」count=0 清空全链打通（schema→合并→落位回收→预览→确认）。
it("「摊位都撤了」：整区清空出预览，确认后画布同步清空", async () => {
  await confirmScope();
  seedMarketPlan();
  stubLibraryByQuery();
  await turn(
    "摆摊区放8个摊位",
    response("objects", { items: [{ zone: "摆摊区", query: "市集摊位", count: 8, evidence: "8个摊位" }] }),
  );
  await action("confirm");
  expect(plan.facilities).toHaveLength(8);
  await turn(
    "摊位都撤了",
    response("objects", { items: [{ zone: "摆摊区", query: "市集摊位", count: 0, evidence: "都撤了" }] }),
  );
  expect(flow.noticeKind, flow.notice).not.toBe("error");
  // 中间校验：合并层必须已经把需求改成 count=0，否则问题在合并层而非落位层。
  expect(flow.state.brief.items[0]?.count, flow.notice).toBe(0);
  expect(flow.proposal?.kind, flow.notice).toBe("objects");
  expect(flow.proposal?.next.facilities).toHaveLength(0);
  await action("confirm");
  expect(plan.facilities).toHaveLength(0);
  expect(flow.state.brief.items[0]).toMatchObject({ query: "市集摊位", count: 0 });
}, 30000);
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
  expect(flow.proposal?.warnings.join()).not.toContain("人数还没定");
  expect(flow.proposal?.warnings.join()).not.toContain("仅按2㎡/人");
  expect(plan.facilities).toHaveLength(0);
  await action("confirm");
  expect(plan.facilities).toHaveLength(1);
});
it("没核实入口也先出设计：分区确认后直接给物件预览，缺口写在卡上", async () => {
  await confirmScope();
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
  // 2026-11-18 用户口径「先设计，用户会告诉你他的想法」：不再先拦到主通道阶段，
  // 确认分区就直接排一版预览；入口没用核实的只写在卡上，不挡人。
  expect(flow.state.stage).toBe("objects");
  expect(flow.proposal?.kind, flow.notice).toBe("objects");
  expect(flow.noticeKind).not.toBe("error");
  expect(flow.proposal?.warnings.join()).not.toContain("入口还没核对");
  expect([...host.querySelectorAll("button")].map(button => button.textContent?.trim()))
    .not.toContain("去核对主要入口与通道");
});
// 2026-11-17 用户拍「都做」之一：红卡上的「重试」= 原样重放当前阶段动作，缺前置条件时点了还是同一句话。
// 这类拦阻改成给一个真能改变状态的动作。
it("缺分区时红卡给的是能推进的动作，不是把同一动作再放一遍", async () => {
  await confirmScope();
  await action("sub-routes");
  expect(flow.notice).toContain("需要知道要连接的区域");
  expect(flow.noticeFix).toEqual({ action: "zones", label: "先生成分区预览" });
  const labels = [...host.querySelectorAll("button")].map(button => button.textContent?.trim());
  expect(labels).toContain("先生成分区预览");
  // 不再同时给一个只会重放 objects 的「重试」。
  expect(labels).not.toContain("重试");
  const fix = [...host.querySelectorAll("button")].find(button => button.textContent?.trim() === "先生成分区预览");
  await act(async () => { (fix as HTMLButtonElement).click(); });
  // 真的去跑了分区：不会停在同一句重复提示上。
  expect(flow.notice).not.toContain("先明确并确认区域用途和边界");
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
  // 2026-11-17：三颗按钮原来都叫「我已核对…预览标记」，只有后半句不同，用户分不清点哪个；
  // 后两颗还默认把门当出口，等于替用户做了判断。现在必须是三个互斥的方向选择。
  const cardButtons = Array.from(host.querySelectorAll("button")).map((b) => b.textContent ?? "");
  expect(cardButtons.some((t) => t.includes("只能进"))).toBe(true);
  expect(cardButtons.some((t) => t.includes("只能出"))).toBe(true);
  expect(cardButtons.some((t) => t.includes("双向"))).toBe(true);
  expect(cardButtons.some((t) => t.includes("我已核对"))).toBe(false);
  // 三个选项是一个成组的选择（有 role=group），不是三行普通文字。
  expect(host.querySelector('[role="group"]')).not.toBeNull();
  // 提示条不再 8 秒自己消失（那条提示就是这一步的状态）。
  expect(host.textContent).not.toContain("后收起");
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
  // 失败时标题直说「这一步没做成」，不再顶着一个阶段名冒充正常任务卡。
  await act(async () => {
    await flow.action("verify-access");
  });
  expect(flow.noticeKind).toBe("error");
  expect(host.textContent).toContain("这一步没做成");
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
// 2026-11-17 用户拍板「用户是讲不清楚需要什么的，AI 就是设计师，先出一版他看看」：
// 没有物料清单时不再追问「各区需要哪些物件、各多少」，而是按分区用途 + 真实面积出一版默认方案。
function seedMarketPlan(): void {
  // 画布上已经有一块摆摊区（20×10m = 200㎡）和一扇已核实的入口 + 一条人行主线。
  plan = {
    ...plan,
    zones: [
      {
        id: crypto.randomUUID(),
        name: "摆摊区",
        notes: "",
        semantic: "reserved",
        purpose: "market",
        environment: "outdoor",
        polygon: [
          { x: 20, y: 20 },
          { x: 40, y: 20 },
          { x: 40, y: 30 },
          { x: 20, y: 30 },
        ],
      },
    ],
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
}
function stubLibraryByQuery(): void {
  bridge.readLibrary = vi.fn(async (queries: string[]) =>
    queries.map((query) => ({
      id: `lib-${query}`,
      name: query,
      source: "built-in" as const,
      width: 2,
      depth: 2,
      height: 2.5,
      modelSlug: `model-${query}`,
      available: true,
    })),
  );
}
it("没有物料清单也出方案：按分区用途与面积走默认设计，不再追问各区需要哪些物件", async () => {
  await confirmScope();
  seedMarketPlan();
  stubLibraryByQuery();
  // 用户从头到尾没给过清单。
  expect(flow.state.brief.items).toHaveLength(0);
  await action("objects");
  expect(flow.notice).not.toContain("各区需要哪些物件");
  expect(flow.noticeKind, flow.notice).not.toBe("error");
  expect(flow.proposal?.kind, flow.notice).toBe("objects");
  expect(flow.proposal?.label).toBe("物料布置");
  expect(flow.proposal?.warnings.join()).toContain("默认方案");
  // 预览阶段不写画布。
  expect(plan.facilities).toHaveLength(0);
  await action("confirm");
  // 200㎡ / 8㎡（含通道）= 25 摊。
  expect(plan.facilities).toHaveLength(25);
  // 默认值是草案，不写回用户需求：用户下一句亲口说的数量仍然优先。
  expect(flow.state.brief.items).toHaveLength(0);
  // 阶段名也不能再说「按用途复用我的物料」——用户根本没给清单，用的不是他的库。
  expect(OUTDOOR_STAGE_LABELS.objects).toBe("摆放物料");
});
// 2026-11-17 正式站截图原句：追问「各分区各放什么物件」→ 用户「随便放」→ 模型编了一份清单，
// 校验按「本句无依据」整轮抛错 → 红卡「模型提取缺少本句原文依据」+ 重试（重试还是同一堵墙）。
// 用户没给清单时，任何清单都是模型编的：丢掉它，按分区用途与面积出默认方案。
it("「随便放」时模型编的清单不拦成红卡：丢弃后按两个分区出默认方案", async () => {
  await confirmScope();
  seedMarketPlan();
  plan = {
    ...plan,
    zones: [
      ...plan.zones,
      {
        id: crypto.randomUUID(),
        name: "演出区",
        notes: "",
        semantic: "reserved",
        purpose: "performance",
        environment: "outdoor",
        polygon: [
          { x: 45, y: 20 },
          { x: 65, y: 20 },
          { x: 65, y: 40 },
          { x: 45, y: 40 },
        ],
      },
    ],
  };
  stubLibraryByQuery();
  await turn(
    "随便放",
    response("objects", {
      items: [{ zone: "摆摊区", query: "市集摊位", count: 12, evidence: "摊位若干" }],
    }),
  );
  // 不进红卡，也不把编的 12 写进需求。
  expect(flow.noticeKind, flow.notice).not.toBe("error");
  expect(flow.state.brief.items).toHaveLength(0);
  expect(flow.proposal?.kind, flow.notice).toBe("objects");
  expect(flow.proposal?.warnings.join()).toContain("默认方案");
  // 演出区按面积算出的座位排不下，就只缩那一个区，并在卡上写明缩到了多少。
  expect(flow.proposal?.warnings.join()).toContain("排不下");
  // 预览阶段不写画布；确认后是两个分区都有东西，且按面积算（摆摊区 25 摊）而不是编的 12。
  expect(plan.facilities).toHaveLength(0);
  await action("confirm");
  expect(plan.facilities.length).toBeGreaterThan(25);
  expect(plan.facilities.filter((f) => f.name.includes("市集摊位"))).toHaveLength(25);
  expect(plan.facilities.some((f) => f.name.includes("舞台"))).toBe(true);
}, 20000);
// 第一句就把设计交回来（只有「随便放」、模型还回了 ask）也不该再追问一遍清单。
it("第一句「随便放」就不再追问清单，直接出默认方案", async () => {
  await confirmScope();
  seedMarketPlan();
  stubLibraryByQuery();
  await turn(
    "随便放",
    response("ask", {}, { reply: "请告诉我每个分区各要放什么物件。" }),
  );
  expect(flow.proposal?.kind, flow.notice).toBe("objects");
  const said = saySpy.mock.calls.map((call) => String(call[0] ?? "")).join("\n");
  expect(said).not.toContain("各要放什么物件");
}, 20000);
it("连续两次追问都没有推进时，直接出默认方案而不是问第三句", async () => {
  await confirmScope();
  seedMarketPlan();
  stubLibraryByQuery();
  // 第一次追问：照旧问，但开始记账（这两句都不是「随便/看着办」，不确定是授权我直接做）。
  await turn("嗯", response("ask", {}, { reply: "请告诉我各区要放什么物料、各多少。" }));
  expect(flow.proposal).toBeNull();
  expect(saySpy).toHaveBeenCalled();
  // 2026-11-17 断点修复：反问时标题不再是「当前任务 · 主通道」——说的和卡上写的是一回事。
  expect(host.textContent).toContain("等你补充");
  // 第二次还是追问、画布毫无改动 → 不再问，直接出一版默认方案（仍然只预览）。
  await turn("然后呢", response("ask", {}, { reply: "请告诉我各区要放什么物料、各多少。" }));
  expect(flow.proposal?.kind, flow.notice).toBe("objects");
  expect(flow.proposal?.warnings.join()).toContain("默认方案");
  expect(plan.facilities).toHaveLength(0);
});


it("走查记录本：标一条才算看过，非法编号这一标不生效", () => {
  // 开场没有任何证据：11 条全算没看。
  expect(flow.walkthroughLine()).toContain("已看 0/11");
  act(() => {
    flow.recordWalkthrough(3, "pass");
  });
  expect(flow.walkthroughLine()).toContain("已看 1/11");
  expect(flow.walkthroughLine()).toContain("通过 1");
  // 已落盘：刷新后能读回来（键里确实有 #3）。
  const stored = window.localStorage.getItem("scendance.outdoor.walkthrough.v1");
  expect(stored).toBeTruthy();
  expect(JSON.parse(stored!).seen["3"]).toBe("pass");
  // 编号不在 1..11：返回 null，且记录本不变。
  expect(flow.recordWalkthrough(99, "pass")).toBeNull();
  expect(flow.walkthroughLine()).toContain("已看 1/11");
  // 记录本永远不下结论。
  expect(flow.walkthroughLine()).not.toContain("可发布（");
});

it("云端声明：只能显式给号，编号不合法这一标不生效", () => {
  // 没声明就是“云端一条都没验”，不从浏览器结果推。
  expect(flow.cloudPass()).toEqual([]);
  act(() => {
    flow.declareCloud(2, true);
  });
  expect(flow.cloudPass()).toEqual([2]);
  // 编号不在 1..11：返回 null，声明不变。
  expect(flow.declareCloud(99, true)).toBeNull();
  expect(flow.cloudPass()).toEqual([2]);
  // 撤回声明。
  act(() => {
    flow.declareCloud(2, false);
  });
  expect(flow.cloudPass()).toEqual([]);
});

it("云端声明落盘：标完刷新也能读回来，撤掉同步写出", () => {
  expect(flow.cloudPass()).toEqual([]);
  act(() => {
    flow.declareCloud(4, true);
  });
  const stored = window.localStorage.getItem("scendance.outdoor.walkthrough.cloud.v1");
  expect(stored).toBeTruthy();
  expect(JSON.parse(stored!).pass).toEqual([4]);
  act(() => {
    flow.declareCloud(4, false);
  });
  expect(JSON.parse(window.localStorage.getItem("scendance.outdoor.walkthrough.cloud.v1")!).pass).toEqual([]);
});

it("发布状态一次算齐：卡片与快照同源，标一条云端+浏览器才涨到 1", () => {
  const before = flow.logReleaseStatus();
  expect(before.allGreen).toBe(0);
  expect(before.snapshot.allGreen).toBe(before.allGreen);
  act(() => {
    flow.recordWalkthrough(2, "pass");
    flow.declareCloud(2, true);
  });
  const after = flow.logReleaseStatus();
  expect(after.allGreen).toBe(1);
  expect(after.snapshot.allGreen).toBe(1);
  // 卡片文本与 bundle.card 必须逐字一致（同一份台账）。
  expect(after.card).toBe(after.card.trim());
  expect(after.card).toContain("不可发布（三类全绿 1 条）");
  expect(after.card).toContain("云端证据：1 条通过");
});

it("会话报告带上发布快照：两轮导出能按行 diff", () => {
  act(() => {
    flow.recordWalkthrough(2, "pass");
    flow.declareCloud(2, true);
  });
  const report = flow.sessionReport();
  expect(report.release).toBeDefined();
  expect(report.release?.snapshot).toMatchObject({ allGreen: 1 });
  expect(report.text).toContain("[发布状态快照]");
  expect(report.text).toContain("不可发布（三类全绿 1 条）");
});

it("待补清单：标一条并声明云端后，清单就少一条，末行只报待补", () => {
  const before = flow.releaseGaps();
  expect(before).toContain("共 11 条待补");
  act(() => {
    flow.recordWalkthrough(2, "pass");
    flow.declareCloud(2, true);
  });
  const after = flow.releaseGaps();
  expect(after).not.toContain("#2 ");
  expect(after).toContain("共 10 条待补");
  expect(after).toContain("三类全绿 1 条");
  expect(after).not.toContain("可发布（");
});

it("台账 CSV：表头五列 + 11 行，标了浏览器与云端就分别落列", () => {
  const before = flow.releaseCsv().split("\n");
  expect(before).toHaveLength(12);
  expect(before[0]).toBe("编号,用例,固定数据,浏览器,云端");
  act(() => {
    flow.recordWalkthrough(2, "pass");
    flow.declareCloud(2, true);
  });
  const after = flow.releaseCsv().split("\n");
  const case2 = after.find((line: string) => line.startsWith("2,")) as string;
  expect(case2.endsWith(",有,pass,pass")).toBe(true);
  expect(after.join("\n")).not.toContain("可发布");
});

it("台账 CSV 落盘：jsdom 里导不出也只回报原因，不抛", () => {
  const result = flow.downloadLedgerCsv();
  expect(result.filename).toMatch(/^outdoor-acceptance-ledger-.*\.csv$/);
  // jsdom 没有 URL.createObjectURL：这里只验“如实回报失败”，不假装成功。
  if (!("createObjectURL" in URL)) {
    expect(result).toMatchObject({ ok: false, reason: "no-url-api" });
  }
});

it("会话报告带上走查原件与云端声明，人可对着报告复核卡片", () => {
  act(() => {
    flow.setWalkthroughAsOf("2026-11-19 第三轮");
    flow.recordWalkthrough(2, "pass");
    flow.declareCloud(2, true);
  });
  const report = flow.sessionReport();
  expect(report.release?.walkthrough?.asOf).toBe("2026-11-19 第三轮");
  expect(report.text).toContain("[走查标记]");
  expect(report.text).toContain("#2 pass");
  expect(report.text).toContain("#2");
  expect(report.text).toContain("[云端声明]");
});

it("报告逐条判断只认台账：只声明云端仍不是全绿", () => {
  act(() => {
    flow.declareCloud(2, true);
  });
  const onlyCloud = flow.sessionReport();
  expect(onlyCloud.text).toContain("#2 未全绿");

  act(() => {
    flow.recordWalkthrough(2, "pass");
  });
  const both = flow.sessionReport();
  expect(both.text).toContain("#2 全绿");
  expect(both.text).toContain("#5 未全绿");
});


it("报告里的待补清单与面板同源：标一条并声明后少一条", () => {
  // 只看待补那一段：#2 会同时出现在「逐条判断」里，全文搜索会误判。
  const gapBlock = (text: string) => (text.split("[待补清单]")[1] ?? "").split("\n\n")[0] ?? "";
  const before = gapBlock(flow.sessionReport().text);
  expect(before).toContain("#2 ");
  expect(before).toContain("#5 ");
  act(() => {
    flow.recordWalkthrough(2, "pass");
    flow.declareCloud(2, true);
  });
  const after = gapBlock(flow.sessionReport().text);
  expect(after).not.toContain("#2 ");
  expect(after).toContain("#5 ");
});

it("报告来源跟着走查日期走，空日期写未填", () => {
  const empty = flow.sessionReport().text;
  // 从常量推期望串，不手抄编号（口径改了才不用再改测试）。
  expect(empty).toContain(
    `[报告来源] 固定数据用例：${FIXED_DATA_CASES.map((id) => `#${id}`).join(" ")}`,
  );
  expect(empty).toContain("走查日期：未填");
  act(() => {
    flow.setWalkthroughAsOf("2026-11-19 第四轮");
  });
  expect(flow.sessionReport().text).toContain("走查日期：2026-11-19 第四轮");
});

it("报告段落自检：六段全在也只说“齐”，不说合格", () => {
  const line = flow.reportSections();
  expect(line).toContain("6/6 段齐");
  expect(line).not.toContain("可发布");
  expect(line).not.toContain("合格");
});

it("下一步提示与待补清单同源，且不含发布结论", () => {
  const line = flow.nextGap();
  expect(line.startsWith("下一步：#")).toBe(true);
  expect(line).toContain("先");
  expect(line).not.toContain("可发布");
});

it("定地点拦阻时，把上一句里的后置活说出来（不再等于没说）", async () => {
  await turn("先摆摊位，最后再调通道", response("search", {}, {}));
  expect(flow.notice).toContain("想在哪个地点做");
  expect(flow.notice).toContain("后面还有：最后再调通道");
});

it("无边界时只改人数不触发范围红卡，简报记下人数", async () => {
  plan = { ...plan, boundary: [] };
  mountAtFlowState({ stage: "scope", completed: ["place"] });
  await turn(
    "人数改为 150 人，保持现有分区。",
    response("revise", { guests: { value: 150, evidence: "人数改为 150 人" } }, { reply: "已记下人数改为 150 人。" }),
  );
  expect(flow.state.brief.guests).toBe(150);
  expect(flow.notice).not.toContain("地图上还没有可核对的活动边界");
  expect(flow.noticeKind, flow.notice).not.toBe("error");
  expect(plan.boundary).toEqual([]);
});

it("入围未确认时，也把上一句里的后置活说出来", async () => {
  plan = { ...plan, boundary: [] };
  mountAtFlowState({ stage: "scope", completed: ["place"] });
  await turn("先划展览区和表演区，最后再调通道", response("zones", {}));
  expect(flow.notice).toContain("地图上还没有可核对的活动边界");
  expect(flow.notice).toContain("后面还有：最后再调通道");
});

it("反问时也把上一句里的后置活说出来", async () => {
  await confirmScope();
  await turn("先摆摊位，最后再调通道", response("ask", {}, { reply: "分区想怎么分？" }));
  expect(flow.notice).toContain("补充对话里的信息后可以继续");
  expect(flow.notice).toContain("后面还有：最后再调通道");
  expect(flow.notice).toContain("现在不用决定");
});

it.skip("缺分区要追问时，提示条里也带上后置活", async () => {
  await confirmScope();
  await turn("先划展览区和表演区，最后再调通道", response("zones", {}));
  expect(flow.notice).toContain("要分哪些用途");
  expect(flow.notice).toContain("后面还有：最后再调通道");
});

// 2026-11-18：对话主路径接上 Aholo Lux3D——说「生成一件道具」就打开现成生成面板，
// 不再先回一句「请到侧栏点设施」；也不把「摆一批折叠椅」静默改成收费生成。
it("对话里点名 Lux3D 生成道具，直接打开现成生成面板且不调模型理解", async () => {
  mountAtFlowState({ stage: "objects", completed: ["place", "scope", "zones"] });
  await act(async () => {
    await flow.handle("用 Lux3D 生成一个木质花箱摆到展览区");
  });
  expect(understand).not.toHaveBeenCalled();
  expect(getGenerationSheetState()).toMatchObject({
    open: true,
    task: "model",
    scope: "material",
    prompt: "木质花箱",
  });
  const said = saySpy.mock.calls.map((call) => String(call[0] ?? "")).join("\n");
  expect(said).toContain("Aholo Lux3D");
  expect(flow.notice).toContain("没有提交");
});

it("画布选中设施时，生成的模型回填那件设施", async () => {
  const fixture = {
    id: "f-lux",
    name: "签到台",
    position: { x: 10, y: 10 },
    rotationDeg: 0,
    size: { width: 1, depth: 1 },
    notes: "",
    templateId: "checkin",
  } as unknown as SitePlanData["facilities"][number];
  plan = { ...plan, facilities: [fixture] };
  bridge.selectedIds = () => ["f-lux"];
  mountAtFlowState({ stage: "objects", completed: ["place", "scope", "zones"] });
  await act(async () => {
    await flow.handle("生成一个木纹签到台");
  });
  expect(getGenerationSheetState()).toMatchObject({
    open: true,
    task: "model",
    scope: "facility",
    facility: { id: "f-lux", name: "签到台" },
  });
});

it("没有合法红线时不打开面板，如实说先圈活动范围", async () => {
  plan = { ...plan, boundary: [] };
  await act(async () => {
    await flow.handle("生成一个签到台");
  });
  expect(getGenerationSheetState().open).toBe(false);
  expect(understand).not.toHaveBeenCalled();
  expect(host.textContent).toContain("还没有可用的活动红线");
});

it.skip("物件阶段的卡片给 Aholo Lux3D 入口，点和「落位预览」分开", async () => {
  mountAtFlowState({ stage: "objects", completed: ["place", "scope", "zones"] });
  const entry = host.querySelector('[data-testid="outdoor-lux3d-entry"]');
  // 两条路都是一颗同高的次级按钮：导入 GLB（本机免费）／生成新道具（要勾额度）。
  expect(entry?.textContent).toContain("用 Aholo Lux3D 生成道具");
  expect(entry?.textContent).toContain("导入 GLB");
  // 收费路径的提醒必须在卡上，不能被删成一颗裸入口。
  expect(host.textContent).toContain("勾选额度");
  const button = host.querySelector('[data-testid="outdoor-lux3d-generate"]');
  expect(button).not.toBeNull();
  await act(async () => {
    (button as HTMLButtonElement).click();
  });
  expect(getGenerationSheetState()).toMatchObject({ open: true, task: "model" });
});


it("默认直接执行：无分区、无入口、未重复确认范围也能加物件并增量追加", async () => {
  supervision = undefined;
  sessionUser = { id: "designer" };
  bridge.readLibrary = vi.fn(async () => [{ id: "chair", name: "椅子", source: "built-in" as const, modelSlug: "oneplan:chair", available: true, width: 1, depth: 1, height: 1 }]);
  await turn("放2把椅子", response("objects", { items: [{ zone: "", query: "椅子", count: 2, evidence: "放2把椅子" }] }));
  expect(understand).toHaveBeenCalledTimes(1);
  expect(flow.pendingPlan).toBeNull();
  expect(flow.proposal).toBeNull();
  expect(plan.zones).toHaveLength(0);
  expect(plan.facilities).toHaveLength(2);
  expect(plan.facilities.every(item => !item.zoneId)).toBe(true);
  expect(apply).toHaveBeenCalledTimes(1);
  const originalIds = plan.facilities.map(item => item.id);
  await turn("再加2把椅子", response("objects", { items: [{ zone: "", query: "椅子", count: 2, evidence: "再加2把椅子" }] }));
  expect(plan.facilities).toHaveLength(4);
  expect(plan.facilities.map(item => item.id)).toEqual(expect.arrayContaining(originalIds));
  expect(apply).toHaveBeenCalledTimes(2);
  expect(flow.proposal).toBeNull();
});

it("默认直接执行仍对删除保留一次结果确认，不先批准计划", async () => {
  supervision = undefined;
  bridge.readLibrary = vi.fn(async () => [{ id: "chair", name: "椅子", source: "built-in" as const, modelSlug: "oneplan:chair", available: true, width: 1, depth: 1, height: 1 }]);
  await turn("放2把椅子", response("objects", { items: [{ zone: "", query: "椅子", count: 2, evidence: "放2把椅子" }] }));
  await turn("椅子改成1把", response("objects", { items: [{ zone: "", query: "椅子", count: 1, evidence: "椅子改成1把" }] }));
  expect(flow.pendingPlan).toBeNull();
  expect(flow.proposal?.kind).toBe("objects");
  expect(plan.facilities).toHaveLength(2);
  expect(apply).toHaveBeenCalledTimes(1);
  await action("confirm");
  expect(plan.facilities).toHaveLength(1);
});

it("默认直接执行：没有报数量的单件添加不会反问", async () => {
  supervision = undefined;
  bridge.readLibrary = vi.fn(async () => [{ id: "chair", name: "椅子", source: "built-in" as const, modelSlug: "oneplan:chair", available: true, width: 1, depth: 1, height: 1 }]);
  await turn("放把椅子", response("objects", { items: [{ zone: "", query: "椅子", count: 1, evidence: "放把椅子" }] }));
  expect(plan.facilities).toHaveLength(1);
  expect(flow.proposal).toBeNull();
});

it("默认直接执行：超过100件时只展示结果预览", async () => {
  supervision = undefined;
  bridge.readLibrary = vi.fn(async () => [{ id: "chair", name: "椅子", source: "built-in" as const, modelSlug: "oneplan:chair", available: true, width: 1, depth: 1, height: 1 }]);
  await turn("放101把椅子", response("objects", { items: [{ zone: "", query: "椅子", count: 101, evidence: "放101把椅子" }] }));
  expect(flow.pendingPlan).toBeNull();
  expect(flow.proposal?.next.facilities).toHaveLength(101);
  expect(plan.facilities).toHaveLength(0);
  expect(apply).not.toHaveBeenCalled();
});


it("默认直接执行：无分区时「你看着办」直接出一版小型布置", async () => {
  supervision = undefined;
  bridge.readLibrary = vi.fn(async () => ["桌子", "垃圾桶", "指示牌"].map(name => ({ id: name, name, modelSlug: "oneplan:fixture", source: "built-in" as const, available: true, width: 1, depth: 1, height: 1 })));
  await turn("你看着办", response("ask", {}, { reply: "需要先分区吗？" }));
  expect(plan.zones).toHaveLength(0);
  expect(plan.facilities).toHaveLength(5);
  expect(apply).toHaveBeenCalledTimes(1);
  expect(saySpy.mock.calls.map(call => call[0]).join()).not.toContain("需要先分区吗");
});

const autonomousChairLibrary = async () => [{id:'chair',name:'椅子',source:'built-in' as const,modelSlug:'oneplan:chair',available:true,width:1,depth:1,height:1}];
const addTwoChairs = () => response('objects',{items:[{zone:'',query:'椅子',count:2,evidence:'放2把椅子'}]});

it('自主权限：严格档直接计算预览，只在写入前确认一次',async()=>{
  await confirmScope();apply.mockClear();bridge.readLibrary=vi.fn(autonomousChairLibrary);
  await turn('放2把椅子',addTwoChairs());
  expect(flow.pendingPlan).toBeNull();expect(flow.proposal?.next.facilities).toHaveLength(2);
  expect(flow.proposal?.approvalReason).toContain('严格');expect(apply).not.toHaveBeenCalled();
  await action('confirm');expect(apply).toHaveBeenCalledOnce();
});

it('自主权限：真实设置切换立即作用到默认执行器，删除只确认一次',async()=>{
  supervision=undefined;bridge.readLibrary=vi.fn(autonomousChairLibrary);
  await act(async()=>setAgentSupervision('key-points'));
  expect(getAgentSupervision()).toBe('key-points');
  await turn('放2把椅子',addTwoChairs());expect(apply).toHaveBeenCalledOnce();
  await act(async()=>setAgentSupervision('strict'));
  await turn('再加2把椅子',response('objects',{items:[{zone:'',query:'椅子',count:2,evidence:'再加2把椅子'}]}));
  expect(apply).toHaveBeenCalledOnce();expect(flow.proposal).not.toBeNull();
  await action('confirm');expect(apply).toHaveBeenCalledTimes(2);
});

it('自主权限：自动档覆盖前保存完整恢复副本，不能仅依赖本次撤销栈',async()=>{
  supervision=undefined;bridge.readLibrary=vi.fn(autonomousChairLibrary);
  await act(async()=>setAgentSupervision('auto'));
  await turn('放2把椅子',addTwoChairs());const original=structuredClone(plan);
  await turn('椅子改成1把',response('objects',{items:[{zone:'',query:'椅子',count:1,evidence:'椅子改成1把'}]}));
  expect(flow.proposal).toBeNull();expect(plan.facilities).toHaveLength(1);
  const key=Object.keys(localStorage).find(key=>key.startsWith('scendance-outdoor-plan-v1:agent-before-'));
  expect(key).toBeTruthy();expect(JSON.parse(localStorage.getItem(key!)!).plan.facilities).toEqual(original.facilities);
});

it('自主权限：地图最后核对期间切成严格档，不自动写入旧授权的候选',async()=>{
  supervision=undefined;bridge.readLibrary=vi.fn(autonomousChairLibrary);
  let reads=0;
  bridge.mapContext=vi.fn(async()=>{
    reads++;if(reads===3)setAgentSupervision('strict');
    return{version:'map:ready',status:'ready' as const,text:'已有范围',featureIds:[],unknowns:[]};
  });
  await turn('放2把椅子',addTwoChairs());
  expect(reads).toBe(3);expect(apply).not.toHaveBeenCalled();
  expect(flow.proposal?.approvalReason).toContain('严格');
});

it('自主权限：模型处理期间换账号，旧账号结果不能写入当前活动',async()=>{
  supervision=undefined;sessionUser={id:'designer-a'};bridge.readLibrary=vi.fn(autonomousChairLibrary);
  let complete!:(value:ReturnType<typeof response>)=>void;
  understand.mockImplementationOnce(()=>new Promise(resolve=>{complete=resolve;}));
  let pending!:Promise<boolean>;await act(async()=>{pending=flow.handle('放2把椅子');});
  await act(async()=>{sessionUser={id:'designer-b'};complete(addTwoChairs());await pending;});
  expect(apply).not.toHaveBeenCalled();expect(plan.facilities).toHaveLength(0);
});

it('自主权限：失败重试携带原始需求，不能按更早的子入口阶段重放',async()=>{
  supervision=undefined;bridge.readLibrary=vi.fn(autonomousChairLibrary);
  mountAtFlowState({stage:'sub-routes',confirmedBoundary:JSON.stringify({anchor:plan.anchor,boundary:plan.boundary})});
  understand.mockRejectedValueOnce(new Error('temporary model failure'));
  await act(async()=>{await flow.handle('放2把椅子');});
  understand.mockResolvedValueOnce(addTwoChairs());
  await act(async()=>{await flow.retryLastRequest();});
  expect(understand.mock.calls[1][0]).toBe('放2把椅子');
  expect(plan.facilities).toHaveLength(2);expect(plan.nodes).toHaveLength(0);
});

it('自主权限：非婚礼同样采用布局假设，不把缺少人数当作停止理由',async()=>{
  supervision=undefined;
  bridge.readLibrary=vi.fn(async()=>['桌子','垃圾桶','指示牌'].map(name=>({id:name,name,modelSlug:'oneplan:fixture',source:'built-in' as const,available:true,width:1,depth:1,height:1})));
  await turn('请自主规划，继续执行，缺参数采用默认值',response('ask',{}, {reply:'先提供人数？'}));
  expect(plan.facilities.length).toBeGreaterThan(0);expect(flow.state.brief.guests).toBeUndefined();
  expect(saySpy.mock.calls.some(([text])=>text==='先提供人数？')).toBe(false);
});

it('自主权限：卡片动作失败后只重试该动作，不重复更早已经完成的物件请求',async()=>{
  supervision=undefined;bridge.readLibrary=vi.fn(autonomousChairLibrary);
  await turn('放2把椅子',addTwoChairs());
  expect(plan.facilities).toHaveLength(2);expect(understand).toHaveBeenCalledOnce();
  await action('sub-routes');
  expect(flow.notice).toBeTruthy();
  await act(async()=>{expect(await flow.retryLastRequest()).toBe(true);});
  expect(understand).toHaveBeenCalledOnce();expect(plan.facilities).toHaveLength(2);
});

it('自主权限：首次明确布置请求就先起稿，不要求用户再次说自主或补齐人数',async()=>{
  supervision=undefined;
  bridge.readLibrary=vi.fn(async()=>['桌子','垃圾桶','指示牌'].map(name=>({id:name,name,modelSlug:'oneplan:fixture',source:'built-in' as const,available:true,width:1,depth:1,height:1})));
  await turn('帮我布置一个讲座活动',response('ask',{}, {reply:'请提供人数和物件清单'}));
  expect(plan.facilities.length).toBeGreaterThan(0);expect(flow.state.brief.guests).toBeUndefined();
  expect(saySpy.mock.calls.some(([text])=>text==='请提供人数和物件清单')).toBe(false);
});

it('自主权限：原方案副本保存失败时，自动档也不能删除已有物件',async()=>{
  supervision=undefined;bridge.readLibrary=vi.fn(autonomousChairLibrary);
  await act(async()=>setAgentSupervision('auto'));
  await turn('放2把椅子',addTwoChairs());const original=structuredClone(plan);
  const write=Storage.prototype.setItem;
  vi.spyOn(Storage.prototype,'setItem').mockImplementation(function(this:Storage,key,value){
    if(key.startsWith('scendance-outdoor-plan-v1:agent-before-'))throw new Error('quota');
    write.call(this,key,value);
  });
  await turn('椅子改成1把',response('objects',{items:[{zone:'',query:'椅子',count:1,evidence:'椅子改成1把'}]}));
  expect(plan).toEqual(original);expect(apply).toHaveBeenCalledOnce();expect(flow.notice).toContain('恢复副本未能保存');
});

it('自主权限：真实登录订阅保留原请求并自动续接，不把登录当成跨账号结果应用',async()=>{
  supervision=undefined;sessionUser=null;bridge.readLibrary=vi.fn(autonomousChairLibrary);
  bridge.mapContext=vi.fn(async()=>({version:'map:ready',status:'ready' as const,text:'测试范围',featureIds:[],unknowns:[]}));
  const listeners=new Set<()=>void>();
  cardHistorySession={subscribe:(listener:()=>void)=>{listeners.add(listener);return()=>{listeners.delete(listener);};}};
  mount();
  await act(async()=>{await flow.handle('放2把椅子');});
  expect(flow.state.pendingLogin?.message).toBe('放2把椅子');expect(understand).not.toHaveBeenCalled();
  understand.mockResolvedValueOnce(addTwoChairs());
  await act(async()=>{sessionUser={id:'signed-in-designer'};[...listeners].forEach(listener=>listener());});
  await waitFor(()=>expect(apply).toHaveBeenCalledOnce());
  expect(plan.facilities).toHaveLength(2);expect(flow.state.pendingLogin).toBeUndefined();
});
