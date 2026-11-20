// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import Canvas, { type OutdoorPlanCanvasHandle } from './outdoor-plan-canvas';
import { createStarterOutdoorPlan } from '../lib/outdoor-project-store';
import { planPointToPixel } from '../lib/outdoor-plan-canvas';

/**
 * 2026-11-20 审计 K6：2D 舞台改 Pointer Events + setPointerCapture。
 *
 * 这一组用例盯的是「拖出画布 / 掠过右侧属性卡就不再取消拖拽」：
 *  - 按下即捕获指针（捕获成功才谈得上继续跟手）；
 *  - 捕获生效时，指针移出画布（React 的 onPointerLeave）不再丢弃拖拽会话，松手照常落位；
 *  - 没有指针捕获能力时（老浏览器 / 合成事件）仍按旧口径取消，不留半截会话。
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

const TENT = {
  id: '44444444-4444-4444-8444-444444444444',
  templateId: 'oneplan:scale:tent',
  name: '帐篷 1',
  position: { x: 4, y: 4 },
  rotationDeg: 0,
  size: { width: 3, depth: 3 },
  notes: '',
};

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  // jsdom 也没有指针捕获：补上，行为对齐浏览器（捕获成功 = 指针移出画布仍跟手）。
  (Element.prototype as any).setPointerCapture = vi.fn();
  (Element.prototype as any).releasePointerCapture = vi.fn();
  (Element.prototype as any).hasPointerCapture = vi.fn(() => true);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function mount() {
  const ref = createRef<OutdoorPlanCanvasHandle>();
  const commit = vi.fn();
  // 设施要一开始就带上：组件内部按 plan prop 命中，父级不回灌就命中不到。
  const plan = { ...createStarterOutdoorPlan(), facilities: [TENT] };
  const { container } = render(<Canvas ref={ref} plan={plan} onPlanChange={commit} />);
  const canvas = container.querySelector('canvas[aria-label="底图瓦片层"]') as HTMLCanvasElement;
  return { ref, commit, canvas };
}

/** 场地坐标 → 指针坐标（jsdom 里舞台矩形是 0,0，像素即 clientX/Y）。 */
function pxOf(ref: React.RefObject<OutdoorPlanCanvasHandle>, point: { x: number; y: number }) {
  return planPointToPixel(point, ref.current!.getView());
}

/** 拖一段：按下 → 移动 → 指针移出画布 → 松手。 */
function dragOutOfCanvas(ref: React.RefObject<OutdoorPlanCanvasHandle>, canvas: HTMLCanvasElement) {
  // 浏览模式只选中；要拖动得进「选择」模式（单件拖动/整组移动都在这条链路上）。
  act(() => { ref.current!.setMode('select'); });
  const from = pxOf(ref, { x: 4, y: 4 });
  const to = { x: from.x + 40, y: from.y };
  fireEvent.pointerDown(canvas, { clientX: from.x, clientY: from.y, pointerId: 7, button: 0, buttons: 1 });
  fireEvent.pointerMove(canvas, { clientX: to.x, clientY: to.y, pointerId: 7, buttons: 1 });
  // React 的 onPointerLeave 由 pointerout + relatedTarget 合成（不是 pointerleave 本体）。
  fireEvent.pointerOut(canvas, { clientX: to.x, clientY: to.y, pointerId: 7, relatedTarget: document.body });
  fireEvent.pointerUp(canvas, { clientX: to.x, clientY: to.y, pointerId: 7, button: 0 });
}

it('按下即捕获指针：这根指针之后移出画布也还归舞台管', () => {
  const { ref, canvas } = mount();
  const px = pxOf(ref, { x: 4, y: 4 });
  fireEvent.pointerDown(canvas, { clientX: px.x, clientY: px.y, pointerId: 7, button: 0, buttons: 1 });
  expect((Element.prototype as any).setPointerCapture).toHaveBeenCalledWith(7);
});

it('捕获生效时：指针移出画布不取消拖拽，松手照常落位', () => {
  const { ref, commit, canvas } = mount();
  commit.mockClear();
  dragOutOfCanvas(ref, canvas);
  expect(commit).toHaveBeenCalledTimes(1);
  const position = commit.mock.calls.at(-1)![0].facilities[0].position;
  expect(Math.abs(position.x - TENT.position.x)).toBeGreaterThan(1);
});

it('没有指针捕获能力时：仍按旧口径取消这次拖拽（不留半截会话）', () => {
  delete (Element.prototype as any).setPointerCapture;
  const { ref, commit, canvas } = mount();
  commit.mockClear();
  dragOutOfCanvas(ref, canvas);
  expect(commit).not.toHaveBeenCalled();
  expect(statusText()).toContain('这次拖动已取消（指针离开了画布）');
});

/** 画布自己的状态行（role=status）；只读文字，不依赖具体布局。 */
function statusText(): string {
  return screen.getAllByRole('status').map(node => node.textContent ?? '').join(' | ');
}

it('浏览器收走指针（pointercancel）：丢弃拖拽、方案不改动，并明说是系统取消', () => {
  const { ref, commit, canvas } = mount();
  commit.mockClear();
  act(() => { ref.current!.setMode('select'); });
  const from = pxOf(ref, { x: 4, y: 4 });
  fireEvent.pointerDown(canvas, { clientX: from.x, clientY: from.y, pointerId: 9, button: 0, buttons: 1 });
  fireEvent.pointerMove(canvas, { clientX: from.x + 40, clientY: from.y, pointerId: 9, buttons: 1 });
  fireEvent.pointerCancel(canvas, { pointerId: 9 });
  // 预览不提交：物件回弹原位，方案一字未改。
  expect(commit).not.toHaveBeenCalled();
  expect(statusText()).toContain('这次拖动被系统取消了，方案没有改动。');
  // 会话已丢弃：紧接着松手不该再落位一次（也不该补一句「离开画布」）。
  fireEvent.pointerUp(canvas, { clientX: from.x + 40, clientY: from.y, pointerId: 9, button: 0 });
  expect(commit).not.toHaveBeenCalled();
  expect(statusText()).not.toContain('指针离开了画布');
});
