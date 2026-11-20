// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import Canvas, { type OutdoorPlanCanvasHandle } from './outdoor-plan-canvas';
import { createStarterOutdoorPlan } from '../lib/outdoor-project-store';

/**
 * 2026-11-20 审计 K5/K11：落位前的朝向与取消要有可点的入口（原来只有 R / Esc），
 * 且 3D 右键要回到 2D 同一份菜单逻辑（取消放置 / 撤草稿上一点 / 设施菜单）。
 */
const ARM = { slug: 'tent', name: '帐篷', width: 3, depth: 3, templateId: 'oneplan:scale:tent' };

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function mount() {
  const ref = createRef<OutdoorPlanCanvasHandle>();
  const commit = vi.fn();
  render(<Canvas ref={ref} plan={createStarterOutdoorPlan()} onPlanChange={commit} />);
  act(() => { expect(ref.current!.armCatalogFacility(ARM)).toBe(true); });
  return { ref, commit };
}

it('放置浮条上的 ±15° 按钮改的就是落位角度', () => {
  mount();
  const bar = screen.getByTestId('plan-placement-bar');
  expect(bar.textContent).toContain('当前 0°');
  fireEvent.click(screen.getByTestId('plan-placement-rotate-right'));
  expect(screen.getByTestId('plan-placement-bar').textContent).toContain('当前 15°');
  fireEvent.click(screen.getByTestId('plan-placement-rotate-right'));
  expect(screen.getByTestId('plan-placement-bar').textContent).toContain('当前 30°');
  fireEvent.click(screen.getByTestId('plan-placement-rotate-left'));
  expect(screen.getByTestId('plan-placement-bar').textContent).toContain('当前 15°');
});

it('放置浮条的取消钮回到浏览态，不写方案', () => {
  const { ref, commit } = mount();
  fireEvent.click(screen.getByTestId('plan-placement-cancel'));
  expect(ref.current!.getMode()).toBe('view');
  expect(screen.queryByTestId('plan-placement-bar')).toBeNull();
  expect(commit).not.toHaveBeenCalled();
});

it('3D 右键桥能取消放置（与 Esc / 浮条同一下场）', () => {
  const { ref, commit } = mount();
  act(() => {
    ref.current!.pointerFromPlan('contextmenu', { px: { x: 120, y: 120 }, pt: { x: 4, y: 4 } }, { button: 2 });
  });
  expect(ref.current!.getMode()).toBe('view');
  expect(commit).not.toHaveBeenCalled();
});

it('3D 右键桥在浏览态把设施菜单打开到命中的物件上', () => {
  const { ref } = mount();
  act(() => {
    ref.current!.pointerFromPlan('contextmenu', { px: { x: 120, y: 120 }, pt: { x: 4, y: 4 } }, { button: 2 });
  });
  // 放置态已被取消；再放一件真设施，右键应能选中并弹菜单（菜单本体挂在 React 树里）。
  act(() => {
    ref.current!.addFacility({
      id: '22222222-2222-4222-8222-222222222222',
      templateId: 'oneplan:scale:tent',
      name: '帐篷 1',
      position: { x: 4, y: 4 },
      rotationDeg: 0,
      size: { width: 3, depth: 3 },
      notes: '',
    });
  });
  act(() => {
    ref.current!.pointerFromPlan('contextmenu', { px: { x: 120, y: 120 }, pt: { x: 4, y: 4 } }, { button: 2 });
  });
  expect(ref.current!.getSelectedIds()).toContain('22222222-2222-4222-8222-222222222222');
});
