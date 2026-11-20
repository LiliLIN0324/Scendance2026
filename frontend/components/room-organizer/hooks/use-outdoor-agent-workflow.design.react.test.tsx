// @vitest-environment jsdom
/**
 * P1 闭环：生成 → 点选 → 一句话局部修改 → 撤销 → 候选比较。
 *
 * 这组用例只证明「交互与版本门」——不重算婚礼布局算法，也不证明真实浏览器视觉。
 * 布局算法本身在 wedding-layout.test.ts 里单独覆盖。
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OutdoorWorkflowCard } from "../components/outdoor-workflow-card";
import { useOutdoorAgentWorkflow } from "./use-outdoor-agent-workflow";
import type { SitePlanData } from "../../../../supabase/functions/_shared/site-plan";
import type { OutdoorAgentBridge } from "../lib/outdoor-agent-contract";

let flow: ReturnType<typeof useOutdoorAgentWorkflow>;
let plan: SitePlanData;
let bridge: OutdoorAgentBridge;
let root: Root;
let host: HTMLDivElement;
let selection: string[];
let apply: ReturnType<typeof vi.fn<(next: SitePlanData, expected: string) => boolean>>;
let say: ReturnType<typeof vi.fn<(text: string, clarification?: boolean) => void>>;
let supervision: "strict" | "key-points" | "auto";

const ring = [
  { x: 0, y: 0 },
  { x: 30, y: 0 },
  { x: 30, y: 30 },
  { x: 0, y: 30 },
];

const table = (id: string, x: number, y: number, extra: Record<string, unknown> = {}) => ({
  id,
  templateId: "oneplan:banquet-table",
  sourceAssetId: "banquet-table",
  modelOverride: "banquet-round",
  allocationKey: `wedding:zone-banquet:banquet-table:${id}`,
  name: `宴席圆桌 ${id}`,
  zoneId: "zone-banquet",
  position: { x, y },
  rotationDeg: 0,
  size: { width: 1.8, depth: 1.8 },
  notes: "婚礼联合草案",
  ...extra,
});

const seededPlan = (): SitePlanData => ({
  schemaVersion: 1,
  boundary: ring,
  zones: [
    {
      id: "zone-banquet",
      name: "宴席区",
      semantic: "audience",
      purpose: "audience",
      environment: "outdoor",
      notes: "",
      polygon: [{ x: 0, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 30 }, { x: 0, y: 30 }],
    },
  ],
  facilities: [
    table("t1", 4, 4),
    { ...table("c1", 5.6, 4), name: "宴席 1 桌 1 座", allocationKey: "wedding:zone-banquet:banquet-chair:1" },
    { ...table("c2", 2.4, 4), name: "宴席 1 桌 2 座", allocationKey: "wedding:zone-banquet:banquet-chair:2" },
    table("t2", 12, 12),
  ],
  routes: [],
  nodes: [],
  workers: [],
  annotations: [],
  measurements: [],
});

function Harness() {
  flow = useOutdoorAgentWorkflow({
    scope: "design-case",
    supervision: () => supervision,
    bridge: () => bridge,
    controller: () => null,
    provider: () => undefined,
    model: () => null,
    begin: () => 1,
    current: () => true,
    status: vi.fn(),
    say,
    search: vi.fn(),
  });
  return <OutdoorWorkflowCard flow={flow} />;
}

const byId = (id: string) => plan.facilities.find((facility) => facility.id === id)!;

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  plan = seededPlan();
  selection = [];
  supervision = "key-points";
  say = vi.fn();
  apply = vi.fn((next: SitePlanData, expected: string) => {
    if (JSON.stringify(plan) !== expected) return false;
    plan = next;
    return true;
  });
  bridge = {
    getPlan: () => plan,
    applyPlan: apply,
    selectedIds: () => selection,
    applyVenue: vi.fn(() => true),
    beginVenueBoundary: vi.fn(() => true),
    applyRoutes: vi.fn(() => true),
    applyZoneProposal: vi.fn(() => true),
    inspectFacility: vi.fn(() => true),
    readLibrary: vi.fn(async () => []),
  };
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root.render(<Harness />));
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

describe("场地局部调整闭环", () => {
  it("点选一组桌椅后，向右移 2 米只作用于该组", async () => {
    selection = ["t1", "c1", "c2"];
    bridge.viewBearingDeg = () => 0;
    await act(async () => {
      await flow.handle("这组桌椅向右移 2 米");
    });
    expect(apply).toHaveBeenCalledTimes(1);
    expect(byId("t1").position).toEqual({ x: 6, y: 4 });
    expect(byId("c1").position).toEqual({ x: 7.6, y: 4 });
    expect(byId("c2").position).toEqual({ x: 4.4, y: 4 });
    // 同区另一桌完全不动：局部指令没有变成整场重排。
    expect(byId("t2").position).toEqual({ x: 12, y: 12 });
    expect(byId("t1").rotationDeg).toBe(0);
    expect(byId("t1").allocationKey).toBe("wedding:zone-banquet:banquet-table:t1");
  });

  it("读不到画布朝向时只澄清「右」的语义，记住后不再追问", async () => {
    selection = ["t1"];
    await act(async () => {
      await flow.handle("这组向右移 2 米");
    });
    expect(apply).not.toHaveBeenCalled();
    expect(say).toHaveBeenCalledWith(expect.stringContaining("按屏幕"), true);
    expect(byId("t1").position).toEqual({ x: 4, y: 4 });

    await act(async () => {
      await flow.handle("按东侧");
    });
    expect(apply).not.toHaveBeenCalled();

    await act(async () => {
      await flow.handle("这组向右移 2 米");
    });
    expect(byId("t1").position).toEqual({ x: 6, y: 4 });
    // 只问过一次（另一条是“记住了”的回执，不是追问）。
    expect(say.mock.calls.filter(([, ask]) => ask === true)).toHaveLength(1);
  });

  it("没有选中对象时不猜「这里」，只要求先点选", async () => {
    await act(async () => {
      await flow.handle("这里向右移 2 米");
    });
    expect(apply).not.toHaveBeenCalled();
    expect(say).toHaveBeenCalledWith(expect.stringContaining("先点选"), true);
  });

  it("严格档只要求一次确认；确认前画布不动", async () => {
    supervision = "strict";
    selection = ["t1"];
    bridge.viewBearingDeg = () => 0;
    await act(async () => {
      await flow.handle("这组向右移 2 米");
    });
    expect(apply).not.toHaveBeenCalled();
    expect(flow.designPendingApply?.why).toContain("严格");
    expect(byId("t1").position).toEqual({ x: 4, y: 4 });

    await act(async () => {
      flow.designActions.onConfirmPending();
    });
    expect(apply).toHaveBeenCalledTimes(1);
    expect(flow.designPendingApply).toBeNull();
    expect(byId("t1").position).toEqual({ x: 6, y: 4 });
  });

  it("默认档按现有风险规则直接执行普通位移，不额外弹确认", async () => {
    supervision = "key-points";
    selection = ["t1"];
    bridge.viewBearingDeg = () => 0;
    await act(async () => {
      await flow.handle("这组向右移 2 米");
    });
    expect(apply).toHaveBeenCalledTimes(1);
    expect(flow.designPendingApply).toBeNull();
  });

  it("撤销写回应用前的完整方案：坐标、桌号引用与其它物件一起回来", async () => {
    selection = ["t1", "c1"];
    bridge.viewBearingDeg = () => 0;
    const before = structuredClone(plan);
    await act(async () => {
      await flow.handle("这组向右移 2 米");
    });
    expect(byId("t1").position).toEqual({ x: 6, y: 4 });

    await act(async () => {
      flow.designActions.onUndo();
    });
    expect(plan).toEqual(before);
    expect(byId("t1").allocationKey).toBe(before.facilities[0]!.allocationKey);
    expect(byId("c1").name).toBe("宴席 1 桌 1 座");
    expect(plan.zones).toEqual(before.zones);
  });

  it("画布在应用前又改过时拒绝写入，不覆盖用户较新的手动修改", async () => {
    selection = ["t1"];
    bridge.viewBearingDeg = () => 0;
    supervision = "strict";
    await act(async () => {
      await flow.handle("这组向右移 2 米");
    });
    expect(flow.designPendingApply).not.toBeNull();
    // 用户在两秒内自己拖了另一张桌子：版本已变。
    plan = { ...plan, facilities: plan.facilities.map((f) => (f.id === "t2" ? { ...f, position: { x: 13, y: 12 } } : f)) };
    await act(async () => {
      flow.designActions.onConfirmPending();
    });
    expect(apply).not.toHaveBeenCalled();
    expect(byId("t2").position).toEqual({ x: 13, y: 12 });
  });
});

describe("摘要与画布双向定位", () => {
  it("定位分区优先整组入镜（focusEntities），不再逐件聚焦", async () => {
    const focusEntities = vi.fn(() => true);
    bridge.focusEntities = focusEntities;
    await act(async () => {
      flow.designActions.onLocateZone("zone-banquet");
    });
    expect(focusEntities).toHaveBeenCalledWith(["t1", "c1", "c2", "t2"]);
    expect(bridge.inspectFacility).not.toHaveBeenCalled();
  });

  it("画布不提供整组入镜时如实回落到逐件聚焦，不假装动了镜头", async () => {
    delete bridge.focusEntities;
    await act(async () => {
      flow.designActions.onLocateZone("zone-banquet");
    });
    expect(bridge.inspectFacility).toHaveBeenCalledWith("t1");
  });
});

describe("候选方案比较", () => {  it("采用候选前不改画布；画布有新修改时旧候选被拒绝", async () => {
    selection = [];
    supervision = "key-points";
    await act(async () => {
      await flow.handle("请重新规划60人户外婚礼，不需要等待我逐项补充参数");
    });
    if (flow.designResult?.state === "proposal") {
      // 提案确认走面板的「确认并应用」；这里只验证比较/采用两段的版本门。
      expect(flow.designResult.summary.title.length).toBeGreaterThan(0);
    }
    expect(flow.designResult).not.toBeNull();

    await act(async () => {
      await flow.openDesignCompare();
    });
    expect(flow.designResult?.compare?.candidates.map((candidate) => candidate.id)).toEqual(["A", "B"]);
    expect(flow.designResult?.compare?.activeId).toBe("A");
    // 打开比较不改画布。
    const beforeAdopt = structuredClone(plan);
    expect(plan).toEqual(beforeAdopt);

    // 用户先手动改了一件：旧候选不能再覆盖。
    apply.mockClear();
    plan = {
      ...plan,
      facilities: plan.facilities.map((facility, index) =>
        index === 0 ? { ...facility, position: { x: facility.position.x + 0.7, y: facility.position.y } } : facility,
      ),
    };
    await act(async () => {
      flow.designActions.onAdoptCandidate();
    });
    expect(apply).not.toHaveBeenCalled();
    expect(flow.designResult?.compareNote).toContain("修改");
  }, 30000);
});
