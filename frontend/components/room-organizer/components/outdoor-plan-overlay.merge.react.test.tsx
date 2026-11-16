// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";
import type { OutdoorAgentBridge, OutdoorMapEditHighlight } from "../lib/outdoor-agent-contract";
import type { SitePlanData } from "../../../../supabase/functions/_shared/site-plan";
import Overlay from "./outdoor-plan-overlay";
import { createStarterOutdoorPlan } from "../lib/outdoor-project-store";
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

  // 悬停图层先出竖排快捷列表；点末尾「展开」才进完整「地图详情」。
  const layerBtn = screen.getByTestId("outdoor-source-cycle");
  fireEvent.mouseEnter(layerBtn.parentElement!);
  expect(screen.getByTestId("outdoor-layer-strip")).toBeTruthy();
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
