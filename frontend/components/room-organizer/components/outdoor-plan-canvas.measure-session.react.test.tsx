// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import Canvas, { type OutdoorPlanCanvasHandle } from './outdoor-plan-canvas';
import { createStarterOutdoorPlan } from '../lib/outdoor-project-store';

/**
 * 2026-11-20 审计 B4 / F8：测量是一次性标尺，退出就清；它不能从撤销栈里「复活」成正式测量，
 * 右键也要在测量/画墙这些模式里起作用（原来只有 Esc）。
 */
beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function mount() {
  const ref = createRef<OutdoorPlanCanvasHandle>();
  const commit = vi.fn();
  render(<Canvas ref={ref} plan={createStarterOutdoorPlan()} onPlanChange={commit} />);
  return { ref, commit };
}

const lastPlan = (commit: ReturnType<typeof vi.fn>) => commit.mock.calls.at(-1)![0];

const click = (ref: React.RefObject<OutdoorPlanCanvasHandle>, x: number, y: number) => act(() => {
  const hit = { px: { x, y }, pt: { x, y } };
  ref.current!.pointerFromPlan('down', hit, { button: 0 });
  ref.current!.pointerFromPlan('up', hit, { button: 0 });
});

it('退出测量后按 Ctrl+Z 不会把临时线恢复成正式测量（并仍能撤回上一次实际编辑）', () => {
  const { ref, commit } = mount();
  act(() => {
    ref.current!.addFacility({
      id: '44444444-4444-4444-8444-444444444444',
      templateId: 'oneplan:scale:tent',
      name: '帐篷 3',
      position: { x: 6, y: 6 },
      rotationDeg: 0,
      size: { width: 3, depth: 3 },
      notes: '',
    });
  });
  act(() => { ref.current!.setMode('measure'); });
  click(ref, 120, 120);
  click(ref, 240, 240);
  // 距离测量不再收满两点自动提交：右键结段（同时验证 F8）
  act(() => { ref.current!.pointerFromPlan('contextmenu', { px: { x: 240, y: 240 }, pt: { x: 240, y: 240 } }, { button: 2 }); });
  expect(lastPlan(commit).measurements ?? []).toHaveLength(1);

  act(() => { ref.current!.setMode('view'); });
  expect(lastPlan(commit).measurements ?? []).toHaveLength(0);

  act(() => { ref.current!.undo(); });
  // 撤销回到「加设施之前」：既没有临时线被复活，也不是一次空撤销。
  expect(lastPlan(commit).measurements ?? []).toHaveLength(0);
  expect(lastPlan(commit).facilities).toHaveLength(0);
});

it('测量态右键：只有一个起点时撤点，不写方案', () => {
  const { ref, commit } = mount();
  act(() => { ref.current!.setMode('measure'); });
  click(ref, 120, 120);
  act(() => { ref.current!.pointerFromPlan('contextmenu', { px: { x: 120, y: 120 }, pt: { x: 120, y: 120 } }, { button: 2 }); });
  expect(commit).not.toHaveBeenCalled();
  expect(screen.getByTestId('measure-finish')).toBeTruthy();
});

it('画墙态右键丢弃这一段的草稿，模式不退出', () => {
  const { ref } = mount();
  act(() => { ref.current!.setMode('wall'); });
  act(() => {
    ref.current!.pointerFromPlan('down', { px: { x: 100, y: 100 }, pt: { x: 2, y: 2 } }, { button: 0 });
    ref.current!.pointerFromPlan('move', { px: { x: 200, y: 100 }, pt: { x: 8, y: 2 } }, { button: 0 });
  });
  act(() => { ref.current!.pointerFromPlan('contextmenu', { px: { x: 200, y: 100 }, pt: { x: 8, y: 2 } }, { button: 2 }); });
  expect(ref.current!.getMode()).toBe('wall');
});

it('测量会话中多次 Agent 编辑：退出只剥离临时线，逐次撤销仍保留每次设施编辑', () => {
  const { ref } = mount();
  act(() => { ref.current!.setMode('measure'); });
  click(ref, 120, 120);
  click(ref, 240, 240);
  act(() => { ref.current!.pointerFromPlan('contextmenu', null, { button: 2 }); });
  expect(ref.current!.getEditVisuals().plan.measurements).toHaveLength(1);
  for (const name of ['A', 'B', 'C']) {
    act(() => {
      ref.current!.addFacility({
        id: crypto.randomUUID(), templateId: 'oneplan:scale:tent', name,
        position: { x: 6, y: 6 }, rotationDeg: 0, size: { width: 3, depth: 3 }, notes: '',
      });
    });
  }
  act(() => { ref.current!.setMode('view'); });
  for (const names of [['A', 'B'], ['A'], []]) {
    act(() => { ref.current!.undo(); });
    const plan = ref.current!.getEditVisuals().plan;
    expect(plan.facilities.map(f => f.name)).toEqual(names);
    expect(plan.measurements ?? []).toHaveLength(0);
  }
  act(() => { ref.current!.redo(); });
  expect(ref.current!.getEditVisuals().plan.facilities.map(f => f.name)).toEqual(['A']);
  expect(ref.current!.getEditVisuals().plan.measurements ?? []).toHaveLength(0);
});

it('无地面命中的右键也能退出放置，且不会误用 2D 像素定位菜单', () => {
  const { ref, commit } = mount();
  act(() => { ref.current!.armCatalogFacility({ slug: 'tent', name: '帐篷', width: 3, depth: 3, templateId: 'oneplan:scale:tent' }); });
  act(() => { ref.current!.pointerFromPlan('contextmenu', null, { button: 2, clientX: 200, clientY: 200 }); });
  expect(ref.current!.getMode()).toBe('view');
  expect(commit).not.toHaveBeenCalled();
  expect(screen.queryByTestId('plan-context-menu')).toBeNull();
});

it('会话内已撤掉临时线时退出，重做也只恢复实际编辑', () => {
  const { ref } = mount();
  act(() => { ref.current!.setMode('measure'); });
  click(ref, 120, 120);
  click(ref, 240, 240);
  act(() => { ref.current!.pointerFromPlan('contextmenu', null, { button: 2 }); });
  act(() => { ref.current!.addFacility({
    id: crypto.randomUUID(), templateId: 'oneplan:scale:tent', name: 'A',
    position: { x: 6, y: 6 }, rotationDeg: 0, size: { width: 3, depth: 3 }, notes: '',
  }); });
  act(() => { ref.current!.undo(); ref.current!.undo(); });
  act(() => { ref.current!.setMode('view'); ref.current!.redo(); });
  const plan = ref.current!.getEditVisuals().plan;
  expect(plan.facilities.map(f => f.name)).toEqual(['A']);
  expect(plan.measurements ?? []).toHaveLength(0);
});
