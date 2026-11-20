import { afterEach, expect, it, vi } from 'vitest';
import { createPlanPreviewRefresh } from './plan-preview-refresh';

afterEach(() => vi.useRealTimers());

it('60 个连续预览采样合并重建，最终松手立即显示提交版本且旧预览不会覆盖它', () => {
  vi.useFakeTimers();
  const render = vi.fn();
  const refresh = createPlanPreviewRefresh(render);
  for (let frame = 0; frame < 60; frame++) {
    refresh.request(frame, true);
    vi.advanceTimersByTime(16);
  }
  expect(render.mock.calls.length).toBeLessThanOrEqual(16);
  refresh.request('committed', false);
  expect(render).toHaveBeenLastCalledWith('committed');
  const count = render.mock.calls.length;
  vi.runAllTimers();
  expect(render).toHaveBeenCalledTimes(count);
});

it('鼠标停止移动后仍刷新最后一个预览；卸载后没有尾帧重建', () => {
  vi.useFakeTimers();
  const render = vi.fn();
  const refresh = createPlanPreviewRefresh(render);
  refresh.request(1, true);
  refresh.request(2, true);
  refresh.request(3, true);
  vi.advanceTimersByTime(64);
  expect(render.mock.calls.map(call => call[0])).toEqual([1, 3]);
  refresh.request(4, true);
  refresh.dispose();
  vi.runAllTimers();
  refresh.request(5, false);
  expect(render).toHaveBeenCalledTimes(2);
});
