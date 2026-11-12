/**
 * 演示回放（tour-reel）纯状态机：与 React 壳分离，可独立测试。
 * 对标 PetitMaker 的「真实操作回放 + 倒计时接管 + 动手试试」：每步驱动真实控件，
 * 倒计时只是兜底，用户随时可以抢先或跳过；回放产生的操作与真实操作同源。
 */

export type TourAction = 'click' | 'fill' | 'highlight';

export interface TourStep {
  /** 对应 [data-tour="…"] 的目标控件标记。 */
  target: string;
  caption: string;
  action: TourAction;
  /** fill 的文本。 */
  payload?: string;
  /** 倒计时自动执行；省缺 8000。highlight 步给足阅读时间。 */
  autoPressMs?: number;
}

export type TourPhase = 'countdown' | 'waiting-target' | 'executing' | 'hands-on' | 'done';

export interface TourState {
  index: number;
  phase: TourPhase;
  /** 倒计时剩余。 */
  remainingMs: number;
  /** 目标未出现时的已等待时长。 */
  waitedMs: number;
}

/** 目标迟迟不出现就跳过这步，不让演示卡死。 */
export const TOUR_WAIT_TARGET_MS = 15_000;
export const TOUR_DEFAULT_AUTO_PRESS_MS = 8_000;

export function tourStepOf(state: TourState, steps: readonly TourStep[]): TourStep | null {
  return steps[state.index] ?? null;
}

export function startTour(steps: readonly TourStep[]): TourState {
  return { index: 0, phase: 'countdown', remainingMs: steps[0]?.autoPressMs ?? TOUR_DEFAULT_AUTO_PRESS_MS, waitedMs: 0 };
}

function beginStep(state: TourState, steps: readonly TourStep[], index: number): TourState {
  if (index >= steps.length) return { ...state, index: Math.max(0, steps.length - 1), phase: 'done' };
  return { index, phase: 'countdown', remainingMs: steps[index]?.autoPressMs ?? TOUR_DEFAULT_AUTO_PRESS_MS, waitedMs: 0 };
}

export function skipStep(state: TourState, steps: readonly TourStep[]): TourState {
  return beginStep(state, steps, state.index + 1);
}

export function tourBack(state: TourState, steps: readonly TourStep[]): TourState {
  return beginStep(state, steps, Math.max(0, state.index - 1));
}

/** 「下一步」= 立即执行当前步（不等倒计时）。 */
export function tourNext(state: TourState): TourState {
  return state.phase === 'done' ? state : { ...state, phase: 'executing' };
}

/** 「动手试试」暂停倒计时；「继续」恢复并重置一个完整倒计时。 */
export function tourHandsOn(state: TourState, steps: readonly TourStep[]): TourState {
  if (state.phase === 'done') return state;
  if (state.phase === 'hands-on') {
    return { ...state, phase: 'countdown', remainingMs: Math.max(state.remainingMs, steps[state.index]?.autoPressMs ?? TOUR_DEFAULT_AUTO_PRESS_MS) };
  }
  return { ...state, phase: 'hands-on' };
}

/**
 * 每帧推进。targetPresent 由壳查询 DOM（[data-tour=当前步] 是否存在）。
 * 目标未出现 → waiting-target 等待，超过 TOUR_WAIT_TARGET_MS 跳过该步。
 */
export function tourTick(state: TourState, steps: readonly TourStep[], dtMs: number, targetPresent: boolean): TourState {
  const step = tourStepOf(state, steps);
  if (!step || state.phase === 'done' || state.phase === 'executing' || state.phase === 'hands-on') return state;
  if (state.phase === 'waiting-target') {
    if (targetPresent) return { ...state, phase: 'countdown', remainingMs: step.autoPressMs ?? TOUR_DEFAULT_AUTO_PRESS_MS, waitedMs: 0 };
    const waited = state.waitedMs + dtMs;
    if (waited > TOUR_WAIT_TARGET_MS) return skipStep(state, steps);
    return { ...state, waitedMs: waited };
  }
  if (!targetPresent) return { ...state, phase: 'waiting-target', waitedMs: 0 };
  const remaining = state.remainingMs - dtMs;
  if (remaining <= 0) return { ...state, phase: 'executing' };
  return { ...state, remainingMs: remaining };
}
