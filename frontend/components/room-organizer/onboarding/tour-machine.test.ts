import { describe, expect, it } from 'vitest';
import {
  startTour, tourBack, tourHandsOn, tourNext, tourTick, skipStep,
  type TourStep,
} from './tour-machine';

const steps: readonly TourStep[] = [
  { target: 'a', caption: '第一步', action: 'fill', payload: '需求', autoPressMs: 1000 },
  { target: 'b', caption: '第二步', action: 'click', autoPressMs: 1000 },
  { target: 'c', caption: '第三步', action: 'highlight', autoPressMs: 1000 },
];

describe('tour-machine — 演示回放状态机', () => {
  it('倒计时归零进入 executing，推进到下一步', () => {
    let state = startTour(steps);
    state = tourTick(state, steps, 600, true);
    expect(state.phase).toBe('countdown');
    state = tourTick(state, steps, 600, true);
    expect(state.phase).toBe('executing');
  });

  it('目标未出现转等待，出现后回倒计时，超 15 秒跳过该步', () => {
    let state = startTour(steps);
    state = tourTick(state, steps, 250, false);
    expect(state.phase).toBe('waiting-target');
    state = tourTick(state, steps, 250, true);
    expect(state.phase).toBe('countdown');
    // 回到 waiting 并耗尽等待预算（目标一直缺席，只在第 0 步内耗尽）
    state = tourTick(state, steps, 250, false);
    for (let i = 0; i < 70 && state.index === 0; i++) state = tourTick(state, steps, 250, false);
    expect(state.index).toBe(1);
    expect(state.phase).toBe('countdown');
  });

  it('下一步立即执行；上一步回退并重置倒计时', () => {
    let state = startTour(steps);
    state = tourNext(state);
    expect(state.phase).toBe('executing');
    state = { ...state, index: 1, phase: 'countdown', remainingMs: 500, waitedMs: 0 };
    state = tourBack(state, steps);
    expect(state.index).toBe(0);
    expect(state.remainingMs).toBe(1000);
  });

  it('动手试试暂停倒计时，继续恢复完整时长', () => {
    let state = startTour(steps);
    state = tourHandsOn(state, steps);
    expect(state.phase).toBe('hands-on');
    const held = tourTick(state, steps, 60_000, true);
    expect(held.phase).toBe('hands-on');
    state = tourHandsOn(state, steps);
    expect(state.phase).toBe('countdown');
    expect(state.remainingMs).toBe(1000);
  });

  it('skipStep 越过末尾即完成', () => {
    let state = startTour(steps);
    state = { ...state, index: 2, phase: 'countdown', remainingMs: 0, waitedMs: 0 };
    state = skipStep(state, steps);
    expect(state.phase).toBe('done');
  });

  it('跳过的步骤超时后落到下一步的倒计时', () => {
    let state = startTour(steps);
    state = tourTick(state, steps, 250, false);
    for (let i = 0; i < 80; i++) state = tourTick(state, steps, 250, false);
    expect(state.index).toBe(1);
    const advanced = tourNext(state);
    expect(advanced.phase).toBe('executing');
  });
});
