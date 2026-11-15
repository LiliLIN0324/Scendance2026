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
it("keeps the guide buttons usable and hides the guide when the user works outside it", () => {
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

  fireEvent.click(screen.getByRole("button", { name: /^底图：/ }));
  fireEvent.click(screen.getByRole("button", { name: "重看首次开图引导" }));
  expect(screen.getByRole("dialog", { name: /这是你的场地画布/ })).toBeTruthy();
  fireEvent.wheel(screen.getByTestId("merge-canvas"));
  expect(screen.queryByTestId("guide-bubble")).toBeNull();
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
  fireEvent.click(screen.getByRole("button", { name: /^底图：/ }));
  fireEvent.click(screen.getByText("Carto 深色"));
  expect(state.canvas?.source).toBe("carto-dark");
  expect(readPlanGroundSource()).toBe("carto-dark");
  expect(JSON.stringify(state.bridge!.getPlan())).toBe(before);
  expect(state.three).toBeNull();
  expect(JSON.stringify(onPlan.mock.calls.at(-1)?.[0])).toBe(before);
  expect(state.bridge?.applyPlan).toBeTypeOf("function");
  expect(state.bridge?.applyWorkers).toBeTypeOf("function");
  expect(state.bridge?.getLevels).toBeTypeOf("function");
});
