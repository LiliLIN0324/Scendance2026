/**
 * 全局新手引导状态（2026-11-20）——纯函数层。
 *
 * 为什么另起一份：旧的首访气泡把「跳过这一步」和「以后别再烦我」写成同一个
 * `dismissed`，点一次跳过就再也回不来（`restartGuide` 写了却没人调用）；吸附/拖动
 * 教练又自带第二个键 `scendance.f3-coach-seen`，两边互不知情。这里按「航线（tour）」记账，
 * 把两件事分开：
 * - 跳过这一步 = 只把这一步记为已看，下次打开从断点继续；
 * - 以后不再提示 = muted，自动开始不再触发，帮助中心仍可手动重看。
 *
 * 旧键（`outdoor-plan-guide-v1` / `scendance.f3-coach-seen`）不迁移也不留后路：
 * 两者的渲染组件（旧三步气泡、拖动教练气泡）已一并退役，迁过来只会把新用户的引导
 * 直接标成「已看」，等于没引导。
 *
 * 纯函数不碰 DOM / localStorage，读写由调用方注入，便于测试。
 */

export const ONBOARDING_STORAGE_KEY = 'scendance.onboarding.v1';
export const ONBOARDING_VERSION = 1;

/** 航线 id。前四条是上手航线，`topic-` 开头的是帮助中心里的单点提示。 */
export const ONBOARDING_TOUR_IDS = [
  'first-run',
  'canvas-basics',
  'material-shelf',
  'delivery',
  'topic-say',
  'topic-scope',
  'topic-undo',
  'topic-place',
  'topic-3d',
  'topic-share',
  'topic-drag',
] as const;

export type TourId = (typeof ONBOARDING_TOUR_IDS)[number];

/** 单条航线的进度。 */
export interface TourProgress {
  /** 已完成（含「跳过这一步」）的步骤 id。 */
  done: string[];
  /** 用户点过「以后不再提示」。 */
  muted: boolean;
}

export interface OnboardingState {
  version: number;
  tours: Partial<Record<TourId, TourProgress>>;
  /** 第一次落盘的时间；只做展示与排查，不参与任何判断。 */
  firstSeenAt: number | null;
}

/** 引导要看的现场信号：已经会的事不再教。 */
export interface OnboardingSignals {
  hasBoundary: boolean;
  hasItems: boolean;
  /** 已经有具名方案（打开的是既有活动，而不是空白起步草稿）：不再自动盖首访引导。 */
  hasNamedPlan?: boolean;
}

export const NO_SIGNALS: OnboardingSignals = { hasBoundary: false, hasItems: false };

export function initialOnboardingState(now: number | null = null): OnboardingState {
  return { version: ONBOARDING_VERSION, tours: {}, firstSeenAt: now };
}

export function progressOf(state: OnboardingState, tour: TourId): TourProgress {
  return state.tours[tour] ?? { done: [], muted: false };
}

/** 当前应展示的步骤：第一个既没完成、也没被现场状态跳过的步骤。 */
export function currentTourStep(
  state: OnboardingState,
  tour: TourId,
  steps: readonly { id: string; showWhen?: { key: keyof OnboardingSignals; equals: boolean } }[],
  signals: OnboardingSignals = NO_SIGNALS,
): string | null {
  const { done } = progressOf(state, tour);
  return steps.find(step => !done.includes(step.id) && stepVisible(step, signals))?.id ?? null;
}

/** 步骤在当前现场是否该出现（例如「已放置清单」只在真有物件时讲）。 */
export function stepVisible(
  step: { showWhen?: { key: keyof OnboardingSignals; equals: boolean } },
  signals: OnboardingSignals,
): boolean {
  if (!step.showWhen) return true;
  return signals[step.showWhen.key] === step.showWhen.equals;
}

/** 标记一步已看（完成或跳过这一步，同一语义）。幂等。 */
export function markStepSeen(state: OnboardingState, tour: TourId, stepId: string): OnboardingState {
  const progress = progressOf(state, tour);
  if (progress.done.includes(stepId)) return state;
  return {
    ...state,
    tours: { ...state.tours, [tour]: { ...progress, done: [...progress.done, stepId] } },
  };
}

/** 「以后不再提示」：整条航线停止自动开始。 */
export function muteTour(state: OnboardingState, tour: TourId): OnboardingState {
  const progress = progressOf(state, tour);
  if (progress.muted) return state;
  return { ...state, tours: { ...state.tours, [tour]: { ...progress, muted: true } } };
}

/** 重看：清空进度与静音（帮助中心里的显式意愿）。 */
export function restartTour(state: OnboardingState, tour: TourId): OnboardingState {
  return { ...state, tours: { ...state.tours, [tour]: { done: [], muted: false } } };
}

/** 进度摘要：「已学会 2/5」。被现场跳过的步骤不计入分母，避免永远学不完。 */
export function tourSummary(
  state: OnboardingState,
  tour: TourId,
  steps: readonly { id: string; showWhen?: { key: keyof OnboardingSignals; equals: boolean } }[],
  signals: OnboardingSignals = NO_SIGNALS,
): { done: number; total: number } {
  const visible = steps.filter(step => stepVisible(step, signals));
  const { done } = progressOf(state, tour);
  return { done: visible.filter(step => done.includes(step.id)).length, total: visible.length };
}

/** 是否该在进工作台时自动开始：只有一步都没看过、也没点过「不再提示」的航线。 */
export function shouldAutoStart(state: OnboardingState, tour: TourId): boolean {
  const progress = progressOf(state, tour);
  return !progress.muted && progress.done.length === 0;
}

/**
 * 进入工作台时是否自动开首访引导。
 * 已经打开一份具名方案时不再盖一层「1/5」：那是回访，不是第一次上手；
 * 帮助中心里仍可手动开始。空白起步草稿不受影响。
 */
export function shouldAutoStartOnArrival(
  state: OnboardingState,
  tour: TourId,
  signals: OnboardingSignals = NO_SIGNALS,
): boolean {
  if (signals.hasNamedPlan) return false;
  return shouldAutoStart(state, tour);
}

/** 宽容解析：结构不符一律回落初始态，引导不能挡住工作台。 */
export function parseOnboardingState(raw: unknown): OnboardingState {
  if (typeof raw !== 'object' || raw === null) return initialOnboardingState();
  const obj = raw as { version?: unknown; tours?: unknown; firstSeenAt?: unknown };
  if (obj.version !== ONBOARDING_VERSION) return initialOnboardingState();
  const tours: Partial<Record<TourId, TourProgress>> = {};
  if (typeof obj.tours === 'object' && obj.tours !== null) {
    for (const id of ONBOARDING_TOUR_IDS) {
      const entry = (obj.tours as Record<string, unknown>)[id];
      if (typeof entry !== 'object' || entry === null) continue;
      const { done, muted } = entry as { done?: unknown; muted?: unknown };
      tours[id] = {
        done: Array.isArray(done) ? done.filter((step): step is string => typeof step === 'string') : [],
        muted: muted === true,
      };
    }
  }
  const firstSeenAt = typeof obj.firstSeenAt === 'number' && Number.isFinite(obj.firstSeenAt)
    ? obj.firstSeenAt
    : null;
  return { version: ONBOARDING_VERSION, tours, firstSeenAt };
}

/** 读取本地存档（浏览器 / 测试共用）：读不到或私密模式禁用时回落初始态。 */
export function readOnboardingState(storage: Pick<Storage, 'getItem'> | null): OnboardingState {
  if (!storage) return initialOnboardingState();
  try {
    const raw = storage.getItem(ONBOARDING_STORAGE_KEY);
    if (!raw) return initialOnboardingState();
    return parseOnboardingState(JSON.parse(raw));
  } catch {
    return initialOnboardingState();
  }
}

/** 写回本地存档；写不进（私密模式 / 配额满）时安静放弃，不阻塞交互。 */
export function writeOnboardingState(storage: Pick<Storage, 'setItem'> | null, state: OnboardingState): void {
  if (!storage) return;
  try {
    storage.setItem(ONBOARDING_STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* 写不进就算了：下次还是一份新引导，总比弹错误好 */
  }
}
