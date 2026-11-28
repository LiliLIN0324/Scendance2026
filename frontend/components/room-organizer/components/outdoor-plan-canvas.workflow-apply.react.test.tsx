// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import Canvas, { type OutdoorPlanCanvasHandle } from './outdoor-plan-canvas';
import { createStarterOutdoorPlan } from '../lib/outdoor-project-store';

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

/**
 * 2026-11-28 用户实机：第二轮确认活动范围（画布已有红线）时，任务卡反复报
 * 「画布当前不可写或保存身份变化，未应用；原规划保留。」——重试永远同样失败。
 * 根因：applyWorkflowPlan 自己那道 refusePlanWrite(next, true) 会越过红线默认锁，
 * 但随后 commitPlan 内部的 refusePlanWrite(next) 不带这个豁免，默认锁把写入拦下。
 */
it('agent 确认卡应用范围：画布已有红线且用户没亲手碰过锁时，默认锁不阻断应用', () => {
  const plan = {
    ...createStarterOutdoorPlan(),
    boundary: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 80 }, { x: 0, y: 80 }],
  };
  const ref = createRef<OutdoorPlanCanvasHandle>();
  const commit = vi.fn();
  render(<Canvas ref={ref} plan={plan} onPlanChange={commit} />);
  const next = {
    ...plan,
    boundary: [{ x: 5, y: 5 }, { x: 150, y: 5 }, { x: 150, y: 120 }, { x: 5, y: 120 }],
  };
  let ok = false;
  act(() => { ok = ref.current!.applyWorkflowPlan(next, JSON.stringify(plan)); });
  expect(ok).toBe(true);
  expect(commit).toHaveBeenCalledOnce();
  expect(commit.mock.calls[0]![0]!.boundary).toHaveLength(4);
});
