// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
import type { BackendSession } from "@/lib/backend-session";
import { assistantChatRequestSchema } from "../../../../supabase/functions/_shared/assistant-chat-contract";
import { createStarterOutdoorPlan } from "../lib/outdoor-project-store";
import { useOutdoorAgentWorkflow } from "./use-outdoor-agent-workflow";
import { OutdoorWorkflowCard } from "../components/outdoor-workflow-card";
import type {
  OutdoorMapContext,
  OutdoorAgentBridge,
  OutdoorTurn,
} from "../lib/outdoor-agent-contract";
import type { SitePlanData } from "../../../../supabase/functions/_shared/site-plan";
vi.mock("../lib/road-network", () => ({
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
  status: "ok",
  answer: JSON.stringify({
    action,
    reply: "",
    references: [],
    facts,
    ...extra,
  }),
});
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
        ) => {
          assistantChatRequestSchema.parse({ message, history });
          return understand(message, history, signal);
        },
      }) as unknown as BackendSession,
    begin: () => ++epoch,
    current: (e) => e === epoch,
    status: vi.fn(),
    say: vi.fn(),
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
  understand = vi.fn<(...args: unknown[]) => Promise<unknown>>();
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
it("地点轮廓仅候选，具体活动范围需真实卡片确认才写入", async () => {
  const anchor = { ...plan.anchor!, lng: 120.1 };
  act(() => flow.offerBoundary(anchor, ring, "IN77"));
  expect(apply).not.toHaveBeenCalled();
  expect(host.textContent).toContain("部分使用请重画");
  const confirm = [...host.querySelectorAll("button")].find(
    (b) => b.textContent === "确认并应用这一版",
  )!;
  await act(async () => {
    confirm.click();
  });
  expect(apply).toHaveBeenCalledTimes(1);
  expect(plan.anchor?.lng).toBe(120.1);
  expect(flow.state.stage).toBe("zones");
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
it("未确认活动边界不能跳过到库布置，保留本句自然补充", async () => {
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
  expect(flow.notice).toContain("先核对");
  expect(plan.facilities).toHaveLength(0);
  expect(flow.state.brief.guests).toBe(45);
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
  await turn(
    "这个安排没问题，就按它落下去吧",
    response("confirm", {}, { confirmationEvidence: "就按它落下去吧" }),
  );
  expect(plan.zones).toHaveLength(1);
  expect(flow.state.stage).toBe("main-routes");
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
        position: { x: 5, y: 35 },
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
it("模型不可用/格式错误明确阻断，不用关键词假装理解或落固定模板", async () => {
  understand.mockResolvedValueOnce({ status: "disabled" });
  await act(async () => {
    await flow.handle("这个区放展位");
  });
  expect(flow.notice).toContain("disabled");
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
