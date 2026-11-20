// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import Canvas, { type OutdoorPlanCanvasHandle } from './outdoor-plan-canvas';
import { createStarterOutdoorPlan } from '../lib/outdoor-project-store';
import type { SitePlanData } from '../../../../supabase/functions/_shared/site-plan';

/**
 * 2026-11-20 审计 K9：单件属性卡缺删除/复制，只有多选卡有——只用属性卡的用户找不到删除，
 * 选中两件时又突然冒出按钮。这里锁的是「单件卡的两个钮真的落到同一个 commit」。
 */
const FACILITY_ID = '11111111-1111-4111-8111-111111111111';

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function planWithOneFacility(): SitePlanData {
  const plan = createStarterOutdoorPlan();
  return {
    ...plan,
    facilities: [{
      id: FACILITY_ID,
      templateId: 'oneplan:scale:tent',
      name: '桁架 1',
      position: { x: 2, y: 2 },
      rotationDeg: 0,
      size: { width: 3, depth: 3 },
      notes: '',
    }],
  };
}

function mount() {
  const ref = createRef<OutdoorPlanCanvasHandle>();
  const commit = vi.fn();
  render(<Canvas ref={ref} plan={planWithOneFacility()} onPlanChange={commit} />);
  act(() => {
    ref.current!.setInspector(true);
    expect(ref.current!.inspectFacility(FACILITY_ID)).toBe(true);
  });
  return { ref, commit };
}

it('单件卡删除按钮删掉当前设施（同一条 commit）', () => {
  const { commit } = mount();
  fireEvent.click(screen.getByTestId('facility-card-delete'));
  expect(commit).toHaveBeenCalledTimes(1);
  expect(commit.mock.calls[0]![0].facilities).toHaveLength(0);
});

it('单件卡复制按钮复制出一件副本并偏移落位', () => {
  const { commit } = mount();
  fireEvent.click(screen.getByTestId('facility-card-copy'));
  expect(commit).toHaveBeenCalledTimes(1);
  const facilities = commit.mock.calls[0]![0].facilities;
  expect(facilities).toHaveLength(2);
  expect(facilities[1].name).toBe('桁架 1 副本');
  expect(facilities[1].id).not.toBe(FACILITY_ID);
  expect(facilities[1].position).not.toEqual(facilities[0].position);
});
