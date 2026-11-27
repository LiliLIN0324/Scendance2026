// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { planPointToPixel } from '../lib/outdoor-plan-canvas';
import { createStarterOutdoorPlan } from '../lib/outdoor-project-store';
import Canvas, { type OutdoorPlanCanvasHandle } from './outdoor-plan-canvas';
import type { PlanPoint } from '../../../../supabase/functions/_shared/site-plan';

/**
 * 2026-11-23 边界顶点 DOM 透明热区手柄层：
 *  - 可编辑态按顶点渲染带 `data-vertex-index` 的透明钮，中心与 canvas 投影逐点一致；
 *  - 锁定 / 隐藏层不渲染可点手柄；
 *  - 点手柄冒泡进既有拖拽链路：合法落点提交、设计范围随动；非法落点拒绝、原环保留。
 * 命中/拖拽/提交全部复用既有 `nearestBoundaryVertexIndex → moveRingVertex → checkBoundaryRing`，
 * DOM 层只作自动化/测试可按引用命中的锚点，不另起链路。
 */

/** jsdom 没有 PointerEvent：补一个最小可用实现（鼠标事件 + 指针号）。 */
if (typeof window !== 'undefined' && !('PointerEvent' in window)) {
  class PointerEventPolyfill extends MouseEvent {
    pointerId: number;
    pointerType: string;
    isPrimary: boolean;
    constructor(type: string, params: any = {}) {
      super(type, params);
      this.pointerId = params.pointerId ?? 0;
      this.pointerType = params.pointerType ?? 'mouse';
      this.isPrimary = params.isPrimary ?? true;
    }
  }
  (window as any).PointerEvent = PointerEventPolyfill;
  (globalThis as any).PointerEvent = PointerEventPolyfill;
}

const ANCHOR = { lng: 120, lat: 30, crs: 'gcj-02' as const, source: 'manual' as const };

/** 40×30 m 矩形边界。 */
const QUAD: PlanPoint[] = [
  { x: -20, y: -15 },
  { x: 20, y: -15 },
  { x: 20, y: 15 },
  { x: -20, y: 15 },
];

/** 瘦高三角：把顶点 0 压回底边即退化（面积跌破下限 / 三点共线）。 */
const TRIANGLE: PlanPoint[] = [
  { x: 0, y: 5 },
  { x: 40, y: 0 },
  { x: -40, y: 0 },
];

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  (Element.prototype as any).setPointerCapture = vi.fn();
  (Element.prototype as any).releasePointerCapture = vi.fn();
  (Element.prototype as any).hasPointerCapture = vi.fn(() => true);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function mount() {
  const ref = createRef<OutdoorPlanCanvasHandle>();
  const commit = vi.fn();
  const plan = createStarterOutdoorPlan();
  const { container } = render(<Canvas ref={ref} plan={plan} onPlanChange={commit} />);
  const canvas = container.querySelector('canvas[aria-label="底图瓦片层"]') as HTMLCanvasElement;
  return { ref, commit, container, canvas };
}

/** 落场地边界；初始 boundary 层默认锁定，点锁钮解锁后手柄才出现。 */
function applyEditableVenue(ref: React.RefObject<OutdoorPlanCanvasHandle>, boundary: PlanPoint[], commit?: ReturnType<typeof vi.fn>) {
  act(() => {
    expect(ref.current!.applyVenue(ANCHOR, boundary)).toBe(true);
  });
  act(() => {
    fireEvent.click(screen.getByTestId('layer-lock-boundary'));
  });
  // 清掉落场地本身那次提交，后续断言只看拖拽链路是否写入。
  commit?.mockClear();
}

/** 场地坐标 → 指针坐标（jsdom 里舞台矩形是 0,0，像素即 clientX/Y）。 */
function pxOf(ref: React.RefObject<OutdoorPlanCanvasHandle>, point: PlanPoint) {
  return planPointToPixel(point, ref.current!.getView());
}

function handleEls(container: HTMLElement) {
  return Array.from(container.querySelectorAll('[data-vertex-index]')) as HTMLElement[];
}

it('可编辑态：每顶点一枚透明热区，中心与投影逐点一致，层空白不拦事件', () => {
  const { ref, commit, container } = mount();
  applyEditableVenue(ref, QUAD, commit);

  const handles = handleEls(container);
  expect(handles).toHaveLength(QUAD.length);

  const vp = ref.current!.getView();
  handles.forEach((el, i) => {
    const expected = planPointToPixel(QUAD[i]!, vp);
    const left = parseFloat(el.style.left);
    const top = parseFloat(el.style.top);
    // 20×20 热区居中对齐顶点像素（容差 1px）。
    expect(Math.abs(left + 10 - expected.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(top + 10 - expected.y)).toBeLessThanOrEqual(1);
    expect(el.getAttribute('data-vertex-index')).toBe(String(i));
    expect(el.style.pointerEvents).toBe('auto');
    expect(el.style.background).toBe('transparent');
  });

  const layer = container.querySelector('[data-vertex-handle-layer]') as HTMLElement;
  expect(layer.style.pointerEvents).toBe('none');
});

it('锁定态不渲染手柄；隐藏红线图层后手柄收起', () => {
  const { ref, container } = mount();
  act(() => {
    expect(ref.current!.applyVenue(ANCHOR, QUAD)).toBe(true);
  });
  // 初始 boundary 层锁定：没有可点手柄。
  expect(handleEls(container)).toHaveLength(0);

  // 解锁后出现。
  act(() => {
    fireEvent.click(screen.getByTestId('layer-lock-boundary'));
  });
  expect(handleEls(container)).toHaveLength(QUAD.length);

  // 隐藏红线图层：手柄同步收起，不保留可点锚点。
  act(() => {
    fireEvent.click(screen.getByRole('checkbox', { name: '显示用地红线图层' }));
  });
  expect(handleEls(container)).toHaveLength(0);
});

it('点手柄进入既有拖拽链路：合法落点提交，设计范围随动', () => {
  const { ref, commit, container, canvas } = mount();
  applyEditableVenue(ref, QUAD, commit);
  act(() => { ref.current!.focusLngLat(ANCHOR.lng, ANCHOR.lat, 19); });

  const from = pxOf(ref, QUAD[0]!);
  const to = pxOf(ref, { x: -16, y: -12 });
  const handle = container.querySelector('[data-vertex-index="0"]') as HTMLElement;

  fireEvent.pointerDown(handle, { clientX: from.x, clientY: from.y, pointerId: 7, button: 0, buttons: 1 });
  fireEvent.pointerMove(canvas, { clientX: to.x, clientY: to.y, pointerId: 7, buttons: 1 });
  fireEvent.pointerUp(canvas, { clientX: to.x, clientY: to.y, pointerId: 7, button: 0 });

  expect(commit).toHaveBeenCalled();
  const last = commit.mock.calls.at(-1)![0];
  expect(last.boundary).toHaveLength(QUAD.length);
  expect(last.designScope && last.designScope.length).toBeGreaterThanOrEqual(3);
  // 顶点 0 已离开原位，且其余顶点未被拖动。
  expect(last.boundary[0]).not.toEqual(QUAD[0]);
  expect(last.boundary[1]).toEqual(QUAD[1]);
});

it('拖到非法位置松手：拒绝提交、原环保留；move 阶段复验给出回执', () => {
  const { ref, commit, container, canvas } = mount();
  applyEditableVenue(ref, TRIANGLE, commit);
  act(() => { ref.current!.focusLngLat(ANCHOR.lng, ANCHOR.lat, 19); });

  const from = pxOf(ref, TRIANGLE[0]!);
  const to = pxOf(ref, { x: 0, y: 0 });
  const handle = container.querySelector('[data-vertex-index="0"]') as HTMLElement;

  fireEvent.pointerDown(handle, { clientX: from.x, clientY: from.y, pointerId: 8, button: 0, buttons: 1 });
  fireEvent.pointerMove(canvas, { clientX: to.x, clientY: to.y, pointerId: 8, buttons: 1 });

  // 非法落点在 move 阶段即被 moveRingVertex / checkBoundaryRing 拦下：预览不更新，给复验原因。
  expect(ref.current!.getEditVisuals().plan.boundary).toEqual(TRIANGLE);
  const movingStatus = screen.getAllByRole('status').map(node => node.textContent ?? '').join(' | ');
  expect(movingStatus).toMatch(/自相交|面积太小|重合顶点/);

  fireEvent.pointerUp(canvas, { clientX: to.x, clientY: to.y, pointerId: 8, button: 0 });

  // 松手仍不写方案，原环保留。
  expect(commit).not.toHaveBeenCalled();
  expect(ref.current!.getEditVisuals().plan.boundary).toEqual(TRIANGLE);
});

/** 凸矩形基准（40×30 m，合法）。 */
const BASE: PlanPoint[] = [
  { x: -20, y: -15 },
  { x: 20, y: -15 },
  { x: 20, y: 15 },
  { x: -20, y: 15 },
];

// A1（面积 <4㎡）、A6（删到 2 点）的拒绝码由纯函数层 site-plan-editing.test.ts 钉住；
// 组件层此处只覆盖「经 DOM 手柄拖拽进入既有链路 → 拒绝、原环保留、不提交」这一条行为。

it('A2 拖到相邻顶点：重合顶点被拒，原环保留，松手不提交', () => {
  const { ref, commit, container, canvas } = mount();
  applyEditableVenue(ref, BASE, commit);
  act(() => { ref.current!.focusLngLat(ANCHOR.lng, ANCHOR.lat, 19); });

  const from = pxOf(ref, BASE[0]!);
  // 顶点 0 拖到顶点 1 位置：相邻顶点重合。
  const to = pxOf(ref, BASE[1]!);
  const handle = container.querySelector('[data-vertex-index="0"]') as HTMLElement;

  fireEvent.pointerDown(handle, { clientX: from.x, clientY: from.y, pointerId: 11, button: 0, buttons: 1 });
  fireEvent.pointerMove(canvas, { clientX: to.x, clientY: to.y, pointerId: 11, buttons: 1 });

  // move 阶段即被复验拦下：预览不更新、给重合回执。
  expect(ref.current!.getEditVisuals().plan.boundary).toEqual(BASE);
  expect(screen.getAllByRole('status').map(node => node.textContent ?? '').join(' | ')).toMatch(/重合顶点/);

  fireEvent.pointerUp(canvas, { clientX: to.x, clientY: to.y, pointerId: 11, button: 0 });
  expect(commit).not.toHaveBeenCalled();
  expect(ref.current!.getEditVisuals().plan.boundary).toEqual(BASE);
});

it('A3 拖出穿边：自相交被拒，原环保留，松手不提交', () => {
  const { ref, commit, container, canvas } = mount();
  applyEditableVenue(ref, BASE, commit);
  act(() => { ref.current!.focusLngLat(ANCHOR.lng, ANCHOR.lat, 19); });

  const from = pxOf(ref, BASE[0]!);
  // 顶点 0 越过右边落到外侧：边 3→0 穿边 1→2，形成自交。
  const to = pxOf(ref, { x: 30, y: -20 });
  const handle = container.querySelector('[data-vertex-index="0"]') as HTMLElement;

  fireEvent.pointerDown(handle, { clientX: from.x, clientY: from.y, pointerId: 12, button: 0, buttons: 1 });
  fireEvent.pointerMove(canvas, { clientX: to.x, clientY: to.y, pointerId: 12, buttons: 1 });

  expect(ref.current!.getEditVisuals().plan.boundary).toEqual(BASE);
  expect(screen.getAllByRole('status').map(node => node.textContent ?? '').join(' | ')).toMatch(/自相交/);

  fireEvent.pointerUp(canvas, { clientX: to.x, clientY: to.y, pointerId: 12, button: 0 });
  expect(commit).not.toHaveBeenCalled();
  expect(ref.current!.getEditVisuals().plan.boundary).toEqual(BASE);
});

/** 6 m² 小矩形：先合法落地，再把一个角压进 4 m² 下限。 */
const SMALL: PlanPoint[] = [
  { x: -1.5, y: -1 },
  { x: 1.5, y: -1 },
  { x: 1.5, y: 1 },
  { x: -1.5, y: 1 },
];

it('A1 拖顶点把面积压到 4㎡ 以下：拒绝「面积太小」，原环保留，松手不提交', () => {
  const { ref, commit, container, canvas } = mount();
  applyEditableVenue(ref, SMALL, commit);
  act(() => { ref.current!.focusLngLat(ANCHOR.lng, ANCHOR.lat, 19); });

  const from = pxOf(ref, SMALL[0]!);
  // 1.75 × 2 = 3.5 m²，低于用地红线 4 m² 下限；相邻顶点间距仍大于 0.5 m。
  const to = pxOf(ref, { x: -0.25, y: -1 });
  const handle = container.querySelector('[data-vertex-index="0"]') as HTMLElement;

  fireEvent.pointerDown(handle, { clientX: from.x, clientY: from.y, pointerId: 13, button: 0, buttons: 1 });
  fireEvent.pointerMove(canvas, { clientX: to.x, clientY: to.y, pointerId: 13, buttons: 1 });

  expect(ref.current!.getEditVisuals().plan.boundary).toEqual(SMALL);
  expect(screen.getAllByRole('status').map(node => node.textContent ?? '').join(' | ')).toMatch(/面积太小/);

  fireEvent.pointerUp(canvas, { clientX: to.x, clientY: to.y, pointerId: 13, button: 0 });
  expect(commit).not.toHaveBeenCalled();
  expect(ref.current!.getEditVisuals().plan.boundary).toEqual(SMALL);
});

it('A4 顶点顶出白框：不拒几何，设计范围按新红线外扩 20m 重置', () => {
  const { ref, commit, container, canvas } = mount();
  applyEditableVenue(ref, BASE, commit);
  act(() => { ref.current!.focusLngLat(ANCHOR.lng, ANCHOR.lat, 19); });
  const oldScope = ref.current!.getEditVisuals().plan.designScope!;

  const from = pxOf(ref, BASE[0]!);
  const to = pxOf(ref, { x: -50, y: -30 });
  const handle = container.querySelector('[data-vertex-index="0"]') as HTMLElement;

  fireEvent.pointerDown(handle, { clientX: from.x, clientY: from.y, pointerId: 14, button: 0, buttons: 1 });
  fireEvent.pointerMove(canvas, { clientX: to.x, clientY: to.y, pointerId: 14, buttons: 1 });
  fireEvent.pointerUp(canvas, { clientX: to.x, clientY: to.y, pointerId: 14, button: 0 });

  expect(commit).toHaveBeenCalled();
  const last = commit.mock.calls.at(-1)![0];
  expect(last.boundary[0]).not.toEqual(BASE[0]);
  expect(last.designScope).not.toEqual(oldScope);
  // 新红线外接矩形四边各外扩 20 m。
  expect(Math.min(...last.designScope.map((p: PlanPoint) => p.x))).toBeCloseTo(-70, 6);
  expect(Math.min(...last.designScope.map((p: PlanPoint) => p.y))).toBeCloseTo(-50, 6);
});

it('A5 已有内容时换锚点：公共写句柄拒绝，原方案与锚点不动', () => {
  const { ref, commit } = mount();
  applyEditableVenue(ref, BASE, commit);
  act(() => {
    expect(ref.current!.addFacility({
      id: '77777777-7777-4777-8777-777777777777',
      templateId: 'oneplan:scale:tent',
      name: '帐篷',
      position: { x: 4, y: 4 },
      rotationDeg: 0,
      size: { width: 3, depth: 3 },
      notes: '',
    })).toBe(true);
  });
  commit.mockClear();
  const current = ref.current!.getEditVisuals().plan;
  const next = { ...current, anchor: { ...current.anchor!, lng: current.anchor!.lng + 0.1 } };

  act(() => {
    expect(ref.current!.applyWorkflowPlan(next, JSON.stringify(current))).toBe(false);
  });
  expect(commit).not.toHaveBeenCalled();
  expect(ref.current!.getEditVisuals().plan.anchor).toEqual(current.anchor);
  expect(ref.current!.getEditVisuals().plan.boundary).toEqual(BASE);
});

it('A6 双击顶点删到剩 2 点：拒绝「至少 3 个顶点」，原环保留', () => {
  const { ref, commit, container } = mount();
  applyEditableVenue(ref, TRIANGLE, commit);
  act(() => { ref.current!.focusLngLat(ANCHOR.lng, ANCHOR.lat, 19); });

  const at = pxOf(ref, TRIANGLE[1]!);
  const handle = container.querySelector('[data-vertex-index="1"]') as HTMLElement;
  fireEvent.doubleClick(handle, { clientX: at.x, clientY: at.y });

  expect(ref.current!.getEditVisuals().plan.boundary).toEqual(TRIANGLE);
  expect(screen.getAllByRole('status').map(node => node.textContent ?? '').join(' | ')).toMatch(/至少.*3/);
  expect(commit).not.toHaveBeenCalled();
});

it('A7 锁定态拖顶点：图层锁拦截，提示先解锁，不提交', () => {
  const { ref, commit, canvas } = mount();
  act(() => {
    expect(ref.current!.applyVenue(ANCHOR, BASE)).toBe(true);
  });
  act(() => { ref.current!.focusLngLat(ANCHOR.lng, ANCHOR.lat, 19); });
  commit.mockClear();

  const from = pxOf(ref, BASE[0]!);
  const to = pxOf(ref, { x: -16, y: -12 });
  fireEvent.pointerDown(canvas, { clientX: from.x, clientY: from.y, pointerId: 15, button: 0, buttons: 1 });
  fireEvent.pointerMove(canvas, { clientX: to.x, clientY: to.y, pointerId: 15, buttons: 1 });
  fireEvent.pointerUp(canvas, { clientX: to.x, clientY: to.y, pointerId: 15, button: 0 });

  expect(commit).not.toHaveBeenCalled();
  expect(ref.current!.getEditVisuals().plan.boundary).toEqual(BASE);
  expect(screen.getAllByRole('status').map(node => node.textContent ?? '').join(' | ')).toMatch(/已锁定.*解锁/);
});

/** B4（2026-11-25）：贴地底图正源写 plan.ground，不进撤销栈。 */
const GROUND = {
  image: 'data:image/jpeg;base64,AAAA',
  opacity: 0.94,
  satelliteRef: true,
  polygon: [
    { lng: 120.1413, lat: 30.2489 }, { lng: 120.1433, lat: 30.2489 },
    { lng: 120.1433, lat: 30.2469 }, { lng: 120.1413, lat: 30.2469 },
  ],
  center: { lng: 120.1423, lat: 30.2479 },
  frame: { lng0: 120.1413, lat0: 30.2489, latMid: 30.2479, scale: 1, latSign: -1 as const },
  source: 'amap-satellite' as const,
};

it('B4 applyGround：写进 plan.ground 并通知父级，撤销栈不变', () => {
  const { ref, commit } = mount();
  const undoBefore = ref.current!.canUndo();
  act(() => {
    expect(ref.current!.applyGround(GROUND)).toBe(true);
  });
  expect(ref.current!.getEditVisuals().plan.ground).toEqual(GROUND);
  expect(commit).toHaveBeenCalledTimes(1);
  expect(ref.current!.canUndo()).toBe(undoBefore);
});

it('B4 applyGround：同样的 ground 再来一次返回 false，不重复提交', () => {
  const { ref, commit } = mount();
  act(() => { expect(ref.current!.applyGround(GROUND)).toBe(true); });
  act(() => { expect(ref.current!.applyGround({ ...GROUND })).toBe(false); });
  expect(commit).toHaveBeenCalledTimes(1);
  expect(ref.current!.getEditVisuals().plan.ground).toEqual(GROUND);
});
