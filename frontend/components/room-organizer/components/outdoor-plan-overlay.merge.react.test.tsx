// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MemoryStorage } from "@/lib/test-support-memory-storage";
import { createRef, type ComponentProps } from "react";
import type { OutdoorAgentBridge, OutdoorMapEditHighlight } from "../lib/outdoor-agent-contract";
import type { SitePlanData } from "../../../../supabase/functions/_shared/site-plan";
import type { BackendSession } from "@/lib/backend-session";
import Overlay, { type OutdoorPlanOverlayHandle } from "./outdoor-plan-overlay";
import { createStarterOutdoorPlan, readOutdoorProjectRecord, saveOutdoorProjectRecord } from "../lib/outdoor-project-store";
import {
  readPlanGroundSource,
  writePlanGroundSource,
} from "../lib/plan-basemap-source";
import { readMapSlots, resetMapSlotsCacheForTest } from "../lib/map-source-slots";
import { buildScotiabankReplicaPlan } from "../lib/replica-cases";
type CanvasProps = ComponentProps<
  typeof import("./outdoor-plan-canvas").default
>;
const state = vi.hoisted(() => ({
  bridge: null as OutdoorAgentBridge | null,
  canvas: null as CanvasProps | null,
  csv: vi.fn(),
  apply: vi.fn(() => true),
  three: null as { plan: SitePlanData; source: string } | null,
}));
const placeSearch = vi.hoisted(() => ({
  props: null as null | {
    testIdPrefix?: string;
    onPick?: (place: { name: string; lng: number; lat: number }) => void;
    onPickArea?: (area: {
      id: string;
      name: string;
      level: string;
      lng: number;
      lat: number;
      bounds: [number, number, number, number];
      polygon: [number, number][];
      kind?: "area" | "line";
    }) => void;
  },
}));
const agent = vi.hoisted(() => ({
  registerRouteBridge: vi.fn((bridge: OutdoorAgentBridge | null) => {
    state.bridge = bridge;
  }),
  outdoorWorkflow: {
    proposal: null as { kind: "scope"; next: SitePlanData } | null,
    appliedHighlight: null as OutdoorMapEditHighlight | null,
    state: { confirmedBoundary: null },
  },
}));
vi.mock("../panels/agent-panel", () => ({ useAgentOptional: () => agent }));
vi.mock("./outdoor-plan-canvas", async () => {
  const React = await import("react");
  return {
    default: React.forwardRef(function MergeCanvas(props: CanvasProps, ref) {
      state.canvas = props;
      React.useImperativeHandle(ref, () => ({
        getEditVisuals: () => ({ plan: props.plan }),
        getSelectedIds: () => [],
        applyWorkflowPlan: state.apply,
        getView: () => null,
        focusBounds: () => {},
        focusLngLat: () => {},
      }));
      return <div data-testid="merge-canvas" />;
    }),
  };
});
vi.mock("./outdoor-plan-3d", () => ({
  default: (props: { plan: SitePlanData; source: string }) => {
    state.three = props;
    return <div data-testid="merge-3d" />;
  },
}));
vi.mock("./plan-place-search", () => ({
  default: (props: NonNullable<typeof placeSearch.props>) => {
    placeSearch.props = props;
    // 渲染出与真组件同名的输入框：真组件的 testid 由 testIdPrefix 派生，
    // 这里让测试能直接验证 focusPlaceSearch 选中的那个 id 确实在 DOM 里。
    return (
      <input
        data-testid={`${props.testIdPrefix ?? "plan-place-search"}-input`}
        aria-label="搜地点"
        readOnly
      />
    );
  },
}));
vi.mock("../lib/site-plan-csv", () => ({ downloadPlanCsv: state.csv }));
let mem: MemoryStorage;
beforeEach(() => {
  mem = new MemoryStorage();
  vi.stubGlobal("Storage", MemoryStorage);
  vi.stubGlobal("localStorage", mem);
  window.localStorage = mem;
  localStorage.clear();
  // 槽位 store 同样有模块级缓存（面板用 useSyncExternalStore 消费），用例间手动复位。
  resetMapSlotsCacheForTest();
  // 模块级图源缓存不随 localStorage 清，复位回缺省街道，避免上一条用例写入跨用例残留。
  writePlanGroundSource("amap-streets");
  agent.outdoorWorkflow.proposal = null;
  agent.outdoorWorkflow.appliedHighlight = null;
  state.bridge = null;
  state.canvas = null;
  state.three = null;
  state.csv.mockClear();
  state.apply.mockClear();
  placeSearch.props = null;
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) =>
    window.setTimeout(() => cb(0), 0),
  );
  vi.stubGlobal("cancelAnimationFrame", (id: number) =>
    window.clearTimeout(id),
  );
});
afterEach(() => {
  cleanup();
  mem?.clear();
  vi.unstubAllGlobals();
});
it("空白项目默认以西湖区全域概览起步，用户选址仍保留自己的位置", () => {
  const view = render(<Overlay projectId="district-overview" seedPlan={createStarterOutdoorPlan()} />);
  expect(state.canvas?.initialView).toEqual({ lng: 120.085, lat: 30.215, zoom: 11 });
  expect(state.canvas?.plan.boundary).toEqual([]);
  view.unmount();
  const anchor = { lng: 121.48, lat: 31.23, crs: "gcj-02" as const, source: "preset" as const };
  render(<Overlay projectId="chosen-venue" seedPlan={createStarterOutdoorPlan(anchor)} anchor={anchor} />);
  expect(state.canvas?.initialView).toEqual({ lng: anchor.lng, lat: anchor.lat });
});
it("经典案例载入、显示与本机保存保持核验过的设施占地", async () => {
  const projectId = "replica-scotiabank-hockey-day-canada";
  const plan = buildScotiabankReplicaPlan();
  saveOutdoorProjectRecord({ v: 1, projectId, name: "经典案例 · Scotiabank", createdAt: "2026-11-18T00:00:00.000Z", updatedAt: "2026-11-18T00:00:00.000Z", plan });
  const saveState = vi.fn();
  render(<Overlay projectId={projectId} onSaveStateChange={saveState} />);
  expect(state.canvas?.plan).toEqual(plan);
  expect(state.canvas?.initialView).toEqual({ lng: -123.370099, lat: 48.423153, zoom: 18, bearing: -285 * Math.PI / 180 });
  expect(state.canvas?.plan.facilities.find(f => f.name === "40×50 公共帐篷")?.size).toEqual({ width: 12.192, depth: 15.24 });
  await waitFor(() => expect(saveState).toHaveBeenCalledWith(expect.objectContaining({ state: "saved" })), { timeout: 2000 });
  expect(readOutdoorProjectRecord(projectId)?.plan).toEqual(plan);
});
it("keeps outside clicks through and exposes a clean map details panel", () => {
  render(<Overlay projectId="guide-outside-action" seedPlan={createStarterOutdoorPlan()} />);
  // 2026-11-20：三步气泡退役后，覆盖层不再挂 window 捕获监听；这里钉住「别把引导做成拦截器」。
  expect(screen.queryByTestId("guide-bubble")).toBeNull();
  expect(localStorage.getItem("outdoor-plan-guide-v1")).toBeNull();

  const outsideTool = document.createElement("button");
  document.body.append(outsideTool);
  const useTool = vi.fn();
  outsideTool.addEventListener("click", useTool);
  try {
    fireEvent.pointerDown(outsideTool);
    fireEvent.click(outsideTool);
    expect(useTool).toHaveBeenCalledOnce();
  } finally {
    outsideTool.remove();
  }

  // 点图层钮弹出紧凑快捷卡（高德范式）；点末尾「展开」才进完整「地图详情」，弹层随之收起。
  const layerBtn = screen.getByTestId("outdoor-source-cycle");
  fireEvent.click(layerBtn);
  expect(screen.getByTestId("outdoor-layer-strip")).toBeTruthy();
  // 再点一次图层钮收起（点按开合）。
  fireEvent.click(layerBtn);
  expect(screen.queryByTestId("outdoor-layer-strip")).toBeNull();
  fireEvent.click(layerBtn);
  fireEvent.click(screen.getByTestId("map-strip-expand"));
  expect(screen.queryByTestId("outdoor-layer-strip")).toBeNull();
  const details = screen.getByRole("dialog", { name: "地图详情" });
  expect(screen.queryByTestId("map-picker-restart-guide")).toBeNull();
  // 标题与 X 在固定头里，滚动只发生在 body，不会把关闭按钮滚走。
  const close = screen.getByTestId("map-picker-close");
  expect(details.querySelector(".oc-map-details__head")?.contains(close)).toBe(true);
  expect(details.querySelector(".oc-map-details__body .oc-map-details__section")).toBeTruthy();
  fireEvent.click(close);
  expect(screen.queryByRole("dialog", { name: "地图详情" })).toBeNull();
  // 关闭不只靠 X：Esc 和点画布也要能关。重新查询图层钮——面板开着时它不在 DOM 里。
  const openDetails = () => {
    fireEvent.click(screen.getByTestId("outdoor-source-cycle"));
    fireEvent.click(screen.getByTestId("map-strip-expand"));
  };
  openDetails();
  fireEvent.keyDown(document, { key: "Escape" });
  expect(screen.queryByRole("dialog", { name: "地图详情" })).toBeNull();
  openDetails();
  fireEvent.pointerDown(screen.getByTestId("merge-canvas"));
  expect(screen.queryByRole("dialog", { name: "地图详情" })).toBeNull();
});
it("地图左上挂回搜索浮条：组件已挂载，focusPlaceSearch 找得到输入框", () => {
  render(<Overlay projectId="floating-search" seedPlan={createStarterOutdoorPlan()} />);
  expect(placeSearch.props).not.toBeNull();
  // 前缀必须是 outdoor-place-search——focusPlaceSearch 查的就是 outdoor-place-search-input。
  expect(placeSearch.props?.testIdPrefix).toBe("outdoor-place-search");
  expect(typeof placeSearch.props?.onPick).toBe("function");
  expect(screen.getByTestId("outdoor-place-search-input")).toBeTruthy();
  // 不再需要独立 portal 槽：搜索条直接画在覆盖层里，槽位不存在也不影响挂载。
  expect(document.getElementById("outdoor-place-search-slot")).toBeNull();
});
it("routes the active scope preview and applied highlights to the canvas, and clears them on withdrawal", () => {
  const plan = createStarterOutdoorPlan();
  const candidate = { ...plan, boundary: [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 0, y: 20 }] };
  agent.outdoorWorkflow.proposal = { kind: "scope", next: candidate };
  const props = { projectId: "review-highlights", seedPlan: plan };
  const { rerender } = render(<Overlay {...props} />);
  expect(state.canvas?.workflowScopePreview).toBe(true);
  expect(state.canvas?.workflowPreview).toEqual(candidate);
  expect(state.canvas?.mapEditHighlight).toBeNull();

  agent.outdoorWorkflow.proposal = null;
  rerender(<Overlay {...props} />);
  expect(state.canvas?.workflowScopePreview).toBe(false);
  expect(state.canvas?.workflowPreview).toBeNull();

  const highlight = { kind: "main-routes", routeIds: ["route-id"], nodeIds: ["entrance-id"] } as const;
  agent.outdoorWorkflow.appliedHighlight = highlight;
  rerender(<Overlay {...props} />);
  expect(state.canvas?.mapEditHighlight).toEqual(highlight);
});
it("当前视角如实报给对话层：3D 时不默认成 2d", () => {
  const plan = createStarterOutdoorPlan();
  const { rerender } = render(<Overlay projectId="view-mode" seedPlan={plan} view="3d" />);
  expect(state.bridge!.currentView?.()).toBe("3d");
  // bridge 只注册一次，换视角靠 ref 跟上，不需要重新注册。
  rerender(<Overlay projectId="view-mode" seedPlan={plan} view="2d" />);
  expect(state.bridge!.currentView?.()).toBe("2d");
  // 只读分享页不传：那里只有平面图，如实报 2d。
  rerender(<Overlay projectId="view-mode" seedPlan={plan} />);
  expect(state.bridge!.currentView?.()).toBe("2d");
});

it("主线缺省高德与已有图源偏好保留，同时单位导出和Agent受控2D/3D接线共存", () => {
  expect(readPlanGroundSource()).toBe("amap-streets");
  writePlanGroundSource("amap-satellite");
  const plan = createStarterOutdoorPlan(),
    before = JSON.stringify(plan),
    onView = vi.fn(),
    onPlan = vi.fn();
  const props = {
    projectId: "merge-regression",
    seedPlan: plan,
    lengthUnit: "ft" as const,
    onViewChange: onView,
    onPlanChange: onPlan,
  };
  const ref = createRef<OutdoorPlanOverlayHandle>();
  render(<Overlay {...props} ref={ref} />);
  expect(state.canvas?.source).toBe("amap-satellite");
  expect(readPlanGroundSource()).toBe("amap-satellite");
  act(() => state.bridge!.setView!("3d"));
  expect(onView).toHaveBeenCalledWith("3d");
  act(() => ref.current?.exportCsv());
  expect(state.csv.mock.calls[0]?.[2]).toBe("ft");
  expect(JSON.stringify(state.bridge!.getPlan())).toBe(before);
  act(() => {
    expect(state.bridge!.applyPlan!(plan, before)).toBe(true);
  });
  expect(state.apply).toHaveBeenCalledWith(plan, before);
  // 3D 由壳层接管，覆盖层不再自挂实例；计划与图源偏好仍上报给那一份 3D。
  expect(state.three).toBeNull();
  expect(screen.queryByTestId("merge-3d")).toBeNull();
  expect(JSON.stringify(onPlan.mock.calls.at(-1)?.[0])).toBe(before);
});
it("切换图源不改规划，且把同一份计划和图源偏好交给壳层3D与原子Agent桥", () => {
  writePlanGroundSource("amap-streets");
  const plan = createStarterOutdoorPlan(),
    before = JSON.stringify(plan),
    onPlan = vi.fn();
  render(
    <Overlay
      projectId="merge-source"
      seedPlan={plan}
      lengthUnit="m"
      onPlanChange={onPlan}
    />,
  );
  // 手机点图层入口也能展开快捷条；选图源只换底图，面板保持到用户点 X。
  fireEvent.click(screen.getByTestId("outdoor-source-cycle"));
  fireEvent.click(screen.getByTestId("map-strip-expand"));
  fireEvent.click(screen.getByTestId("map-source-carto-dark"));
  expect(state.canvas?.source).toBe("carto-dark");
  expect(readPlanGroundSource()).toBe("carto-dark");
  expect(screen.getByRole("dialog", { name: "地图详情" })).toBeTruthy();
  // 点地图空白处也能关，不再只能找面板上的 X。
  fireEvent.pointerDown(screen.getByTestId("merge-canvas"));
  expect(screen.queryByTestId("outdoor-map-picker-panel")).toBeNull();
  expect(screen.getByTestId("outdoor-source-cycle")).toBeTruthy();
  expect(JSON.stringify(state.bridge!.getPlan())).toBe(before);
  expect(state.three).toBeNull();
  expect(JSON.stringify(onPlan.mock.calls.at(-1)?.[0])).toBe(before);
  expect(state.bridge?.applyPlan).toBeTypeOf("function");
  expect(state.bridge?.applyWorkers).toBeTypeOf("function");
  expect(state.bridge?.getLevels).toBeTypeOf("function");
});

it("版本冲突给二选一：点「用我这版」才 force 覆盖，点「用服务器那版」才换成本机", async () => {
  const projectId = "sync-conflict";
  const localPlan = createStarterOutdoorPlan();
  saveOutdoorProjectRecord({
    v: 1,
    projectId,
    name: "湖滨夜集",
    createdAt: "2026-11-17T00:00:00.000Z",
    updatedAt: "2026-11-17T00:00:00.000Z",
    plan: localPlan,
    remoteActivityId: "a-1",
    remoteRevision: 2,
  });
  const remotePlan = { ...createStarterOutdoorPlan(), anchor: { lng: 120.99, lat: 30.99 } };
  const saveOutdoorPlan = vi.fn().mockResolvedValue({
    conflict: true,
    activityId: "a-1",
    revision: 3,
    updatedAt: "2026-11-17T01:00:00.000Z",
    name: "另一台设备的版本",
  });
  const getOutdoorPlan = vi.fn().mockResolvedValue({
    found: true,
    activityId: "a-1",
    name: "服务器那版",
    revision: 3,
    plan: remotePlan,
  });
  const controller = { saveOutdoorPlan, getOutdoorPlan } as unknown as BackendSession;

  render(<Overlay projectId={projectId} controller={controller} />);

  // 2026-11-20（F9）：打开时内容与盘上一致就不再写盘/推云端——这里模拟一次真实编辑再等自动保存。
  act(() => { state.canvas!.onPlanChange!({ ...localPlan, anchor: { lng: 120.21, lat: 30.31, crs: "gcj-02", source: "picker" } }); });

  // 自动保存落地后撞上服务器更新版本：不覆盖，先问用户。
  await waitFor(() => expect(screen.getByTestId("outdoor-sync-banner")).toBeTruthy(), { timeout: 3000 });
  expect(screen.getByTestId("outdoor-sync-banner").textContent).toContain("版本 3");
  expect(saveOutdoorPlan.mock.calls.at(-1)?.[0]).toMatchObject({ baseRevision: 2, activityId: "a-1" });

  // 选「用我这版」：带 force 覆盖，写回新版本号。
  fireEvent.click(screen.getByTestId("outdoor-sync-use-mine"));
  await waitFor(() =>
    expect(saveOutdoorPlan.mock.calls.at(-1)?.[0]).toMatchObject({ force: true, activityId: "a-1" }),
  );
});

it("冲突时选「用服务器那版」：本机换成服务器版本并记住它", async () => {  const projectId = "sync-server";
  saveOutdoorProjectRecord({
    v: 1,
    projectId,
    name: "本机版本",
    createdAt: "2026-11-17T00:00:00.000Z",
    updatedAt: "2026-11-17T00:00:00.000Z",
    plan: createStarterOutdoorPlan(),
    remoteActivityId: "a-2",
    remoteRevision: 2,
  });
  const basePlan = createStarterOutdoorPlan();
  const remotePlan = { ...basePlan, anchor: { ...(basePlan.anchor ?? { lng: 0, lat: 0 }), lng: 120.99 } };
  const saveOutdoorPlan = vi.fn().mockResolvedValue({
    conflict: true,
    activityId: "a-2",
    revision: 5,
    updatedAt: "2026-11-17T03:00:00.000Z",
    name: "服务器那版",
  });
  const getOutdoorPlan = vi.fn().mockResolvedValue({
    found: true,
    activityId: "a-2",
    name: "服务器那版",
    revision: 5,
    plan: remotePlan,
  });

  render(<Overlay projectId={projectId} controller={{ saveOutdoorPlan, getOutdoorPlan } as unknown as BackendSession} />);
  // 2026-11-20（F9）：干净打开不再推云端；先做一次真实编辑，冲突才会真的发生。
  act(() => { state.canvas!.onPlanChange!({ ...basePlan, anchor: { lng: 120.18, lat: 30.28, crs: "gcj-02", source: "picker" } }); });
  await waitFor(() => expect(screen.getByTestId("outdoor-sync-banner")).toBeTruthy(), { timeout: 3000 });

  fireEvent.click(screen.getByTestId("outdoor-sync-use-remote"));
  await waitFor(() => expect(getOutdoorPlan).toHaveBeenCalledWith("a-2"));
  await waitFor(() => {
    const stored = readOutdoorProjectRecord(projectId);
    expect(stored?.remoteRevision).toBe(5);
    expect(stored?.plan?.anchor?.lng).toBeCloseTo(120.99);
  });
  expect(saveOutdoorPlan.mock.calls.every((call) => call[0].force !== true)).toBe(true);
});

it("地图详情是「上排四格 + 下方分组清单」：下方图源能置顶进同类槽位", () => {
  render(<Overlay projectId="map-slots" seedPlan={createStarterOutdoorPlan()} />);
  fireEvent.click(screen.getByTestId("outdoor-source-cycle"));
  fireEvent.click(screen.getByTestId("map-strip-expand"));

  // 上排四格：卫星 / 街道 / 单色 / 无，缺省按用户点名的顺序填好。
  expect(screen.getByTestId("map-slot-satellite").textContent).toContain("高德卫星");
  expect(screen.getByTestId("map-slot-streets").textContent).toContain("高德街道");
  expect(screen.getByTestId("map-slot-tone").textContent).toContain("Carto 浅色");
  expect(screen.getByTestId("map-picker-toggle-geo").textContent).toContain("无");

  // 下排按类型分组，三组都在。
  expect(screen.getByRole("radiogroup", { name: "街道类" })).toBeTruthy();
  expect(screen.getByRole("radiogroup", { name: "卫星类" })).toBeTruthy();
  expect(screen.getByRole("radiogroup", { name: "视觉类" })).toBeTruthy();

  // 置顶 Carto 深色 → 单色格换成它；当前底图不变（置顶只改上面那格）。
  const before = state.canvas?.source;
  fireEvent.click(screen.getByTestId("map-pin-carto-dark"));
  expect(readMapSlots().tone).toBe("carto-dark");
  expect(screen.getByTestId("map-slot-tone").textContent).toContain("Carto 深色");
  expect((screen.getByTestId("map-pin-carto-dark") as HTMLButtonElement).disabled).toBe(true);
  expect(state.canvas?.source).toBe(before);

  // 点格子才真正换底图，并同步给三维地面。
  fireEvent.click(screen.getByTestId("map-slot-tone"));
  expect(state.canvas?.source).toBe("carto-dark");
  expect(readPlanGroundSource()).toBe("carto-dark");
});

it("云端副本传不上去时不出任何提示（本机照常保存）", async () => {
  const projectId = "sync-silent";
  const saveOutdoorPlan = vi.fn().mockRejectedValue(new Error("offline"));
  render(
    <Overlay
      projectId={projectId}
      controller={{ saveOutdoorPlan } as unknown as BackendSession}
      seedPlan={createStarterOutdoorPlan()}
    />,
  );

  await waitFor(() => expect(saveOutdoorPlan).toHaveBeenCalled(), { timeout: 3000 });
  // 本机记录照写（不因云端失败而丢）
  await waitFor(() => expect(readOutdoorProjectRecord(projectId)?.plan).toBeTruthy());
  // 但屏幕上不该出现任何「云端副本…」提示
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 250));
  });
  expect(screen.queryByTestId("outdoor-sync-banner")).toBeNull();
  expect(document.body.textContent).not.toContain("云端副本");
});
