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
import type { ComponentProps } from "react";
import type { OutdoorAgentBridge, OutdoorMapEditHighlight } from "../lib/outdoor-agent-contract";
import type { SitePlanData } from "../../../../supabase/functions/_shared/site-plan";
import type { BackendSession } from "@/lib/backend-session";
import Overlay from "./outdoor-plan-overlay";
import { createStarterOutdoorPlan, readOutdoorProjectRecord, saveOutdoorProjectRecord } from "../lib/outdoor-project-store";
import {
  readPlanGroundSource,
  writePlanGroundSource,
} from "../lib/plan-basemap-source";
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
vi.mock("./plan-place-search", () => ({ default: () => null }));
vi.mock("./outdoor-delivery-panel", () => ({
  OutdoorDeliveryPanel: (props: { handlers: { onExportCsv: () => void } }) => (
    <button onClick={props.handlers.onExportCsv}>merge csv</button>
  ),
}));
vi.mock("../lib/site-plan-csv", () => ({ downloadPlanCsv: state.csv }));
beforeEach(() => {
  localStorage.clear();
  // 模块级图源缓存不随 localStorage 清，复位回缺省街道，避免上一条用例写入跨用例残留。
  writePlanGroundSource("amap-streets");
  agent.outdoorWorkflow.proposal = null;
  agent.outdoorWorkflow.appliedHighlight = null;
  state.bridge = null;
  state.canvas = null;
  state.three = null;
  state.csv.mockClear();
  state.apply.mockClear();
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) =>
    window.setTimeout(() => cb(0), 0),
  );
  vi.stubGlobal("cancelAnimationFrame", (id: number) =>
    window.clearTimeout(id),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it("keeps outside guide actions working and exposes a clean map details panel", () => {
  render(<Overlay projectId="guide-outside-action" seedPlan={createStarterOutdoorPlan()} />);
  const begin = screen.getByRole("button", { name: "开始浏览" });
  fireEvent.pointerDown(begin);
  fireEvent.click(begin);
  expect(screen.getByRole("dialog", { name: /这边是物件库/ })).toBeTruthy();

  const outsideTool = document.createElement("button");
  document.body.append(outsideTool);
  const useTool = vi.fn();
  outsideTool.addEventListener("click", useTool);
  try {
    fireEvent.pointerDown(outsideTool);
    fireEvent.click(outsideTool);
    expect(useTool).toHaveBeenCalledOnce();
    expect(screen.queryByTestId("guide-bubble")).toBeNull();
    expect(JSON.parse(localStorage.getItem("outdoor-plan-guide-v1")!)).toEqual({ done: ["welcome"], dismissed: false });
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
  expect(screen.getByRole("dialog", { name: "地图详情" })).toBeTruthy();
  expect(screen.queryByTestId("map-picker-restart-guide")).toBeNull();
  fireEvent.click(screen.getByTestId("map-picker-close"));
  expect(screen.queryByRole("dialog", { name: "地图详情" })).toBeNull();
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
  render(<Overlay {...props} />);
  expect(state.canvas?.source).toBe("amap-satellite");
  expect(readPlanGroundSource()).toBe("amap-satellite");
  act(() => state.bridge!.setView!("3d"));
  expect(onView).toHaveBeenCalledWith("3d");
  fireEvent.click(screen.getByText("merge csv"));
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
  // 点地图空白处不关；用户明确要求只走面板上的 X。
  fireEvent.click(screen.getByTestId("merge-canvas"));
  expect(screen.getByRole("dialog", { name: "地图详情" })).toBeTruthy();
  fireEvent.click(screen.getByTestId("map-picker-close"));
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
