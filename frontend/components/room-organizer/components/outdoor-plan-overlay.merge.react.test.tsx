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
import type { OutdoorAgentBridge } from "../lib/outdoor-agent-contract";
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
  outdoorWorkflow: { proposal: null, state: { confirmedBoundary: null } },
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
it("主线缺省高德与已有图源偏好保留，同时单位导出和Agent受控2D/3D接线共存", () => {
  expect(readPlanGroundSource()).toBe("amap-streets");
  writePlanGroundSource("amap-satellite");
  const plan = createStarterOutdoorPlan(),
    before = JSON.stringify(plan),
    onView = vi.fn();
  const props = {
    projectId: "merge-regression",
    seedPlan: plan,
    lengthUnit: "ft" as const,
    onViewChange: onView,
  };
  const view = render(<Overlay {...props} view="2d" />);
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
  view.rerender(<Overlay {...props} view="3d" />);
  expect(state.three?.source).toBe("amap-satellite");
  expect(JSON.stringify(state.three?.plan)).toBe(before);
});
it("切换图源不改规划，且共享给同plan的3D视角与原子Agent桥", () => {
  writePlanGroundSource("amap-streets");
  const plan = createStarterOutdoorPlan(),
    before = JSON.stringify(plan);
  const view = render(
    <Overlay
      projectId="merge-source"
      seedPlan={plan}
      view="2d"
      lengthUnit="m"
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: /^底图：/ }));
  fireEvent.click(screen.getByText("Carto 深色"));
  expect(state.canvas?.source).toBe("carto-dark");
  expect(readPlanGroundSource()).toBe("carto-dark");
  expect(JSON.stringify(state.bridge!.getPlan())).toBe(before);
  view.rerender(
    <Overlay
      projectId="merge-source"
      seedPlan={plan}
      view="3d"
      lengthUnit="m"
    />,
  );
  expect(state.three?.source).toBe("carto-dark");
  expect(JSON.stringify(state.three?.plan)).toBe(before);
  expect(state.bridge?.applyPlan).toBeTypeOf("function");
});
