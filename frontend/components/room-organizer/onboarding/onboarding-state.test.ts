import { describe, expect, it } from 'vitest';
import {
  ONBOARDING_STORAGE_KEY,
  ONBOARDING_TOUR_IDS,
  ONBOARDING_VERSION,
  currentTourStep,
  initialOnboardingState,
  markStepSeen,
  muteTour,
  parseOnboardingState,
  progressOf,
  readOnboardingState,
  restartTour,
  shouldAutoStart,
  stepVisible,
  tourSummary,
  writeOnboardingState,
  type OnboardingSignals,
  type OnboardingState,
  type TourId,
} from './onboarding-state';

/** 三步航线：中间一步要看现场信号（有物件才讲）。 */
const STEPS = [
  { id: 'site', title: '认场地', body: '底图是真地图', target: null },
  { id: 'placed', title: '清单', body: '放下的东西都在清单里', target: null, showWhen: { key: 'hasItems' as const, equals: true } },
  { id: 'publish', title: '发布', body: '发布只读链接', target: null },
];

const SIGNALS_WITH_ITEMS: OnboardingSignals = { hasBoundary: true, hasItems: true };
const EMPTY_SIGNALS: OnboardingSignals = { hasBoundary: false, hasItems: false };

/** 注入用的假 localStorage：状态层不碰 DOM，读写全靠调用方喂进来。 */
function fakeStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key: string): string | null => map.get(key) ?? null,
    setItem: (key: string, value: string): void => { map.set(key, value); },
    raw: (): string | null => map.get(ONBOARDING_STORAGE_KEY) ?? null,
  };
}

function seen(state: OnboardingState, tour: TourId, ...stepIds: string[]): OnboardingState {
  return stepIds.reduce((next, id) => markStepSeen(next, tour, id), state);
}

describe('onboarding state (2026-11-20 全局引导)', () => {
  it('starts clean: nothing seen, nothing muted, every tour auto-startable', () => {
    const state = initialOnboardingState();
    expect(state.version).toBe(ONBOARDING_VERSION);
    expect(state.tours).toEqual({});
    expect(state.firstSeenAt).toBeNull();
    expect(progressOf(state, 'first-run')).toEqual({ done: [], muted: false });
    expect(currentTourStep(state, 'first-run', STEPS)).toBe('site');
    for (const id of ONBOARDING_TOUR_IDS) expect(shouldAutoStart(state, id)).toBe(true);
  });

  it('remembers the first landing time when the caller supplies one', () => {
    expect(initialOnboardingState(1_700_000_000_000).firstSeenAt).toBe(1_700_000_000_000);
  });

  it('splits 「跳过这一步」 from 「以后不再提示」: seen advances, mute does not', () => {
    const afterSkip = markStepSeen(initialOnboardingState(), 'first-run', 'site');
    expect(currentTourStep(afterSkip, 'first-run', STEPS, EMPTY_SIGNALS)).toBe('publish');
    expect(progressOf(afterSkip, 'first-run').muted).toBe(false);

    const afterMute = muteTour(initialOnboardingState(), 'first-run');
    expect(progressOf(afterMute, 'first-run')).toEqual({ done: [], muted: true });
    // 静音只是不再自动开始；手动从帮助中心走时，进度照样能读出来。
    expect(currentTourStep(afterMute, 'first-run', STEPS, EMPTY_SIGNALS)).toBe('site');
  });

  it('mute keeps the steps already seen, so 重看 is the only thing that erases progress', () => {
    const state = muteTour(seen(initialOnboardingState(), 'first-run', 'site'), 'first-run');
    expect(progressOf(state, 'first-run')).toEqual({ done: ['site'], muted: true });
    expect(restartTour(state, 'first-run').tours['first-run']).toEqual({ done: [], muted: false });
  });

  it('auto-starts only a tour nobody has touched yet', () => {
    const oneStep = seen(initialOnboardingState(), 'first-run', 'site');
    // 看过一步 = 暂停：下次进工作台不硬弹，去帮助中心接着走。
    expect(shouldAutoStart(oneStep, 'first-run')).toBe(false);
    // 一条线的静音不影响另一条线。
    expect(shouldAutoStart(muteTour(oneStep, 'delivery'), 'canvas-basics')).toBe(true);
  });

  it('marks seen idempotently and keeps step order as written', () => {
    const state = initialOnboardingState();
    const once = markStepSeen(state, 'first-run', 'site');
    expect(markStepSeen(once, 'first-run', 'site')).toBe(once);
    expect(seen(state, 'first-run', 'publish', 'site').tours['first-run']?.done).toEqual(['publish', 'site']);
    // 指针一步只动那一条线，别的航线不受牵连。
    expect(progressOf(seen(state, 'first-run', 'site'), 'delivery')).toEqual({ done: [], muted: false });
  });

  it('hides signal-gated steps instead of letting the tour hang', () => {
    expect(stepVisible(STEPS[1], EMPTY_SIGNALS)).toBe(false);
    expect(stepVisible(STEPS[1], SIGNALS_WITH_ITEMS)).toBe(true);
    expect(stepVisible(STEPS[0], EMPTY_SIGNALS)).toBe(true);

    // 物件还没放过：「清单」这一步直接跳过，走到「发布」；两步走完才算这条线到底。
    expect(currentTourStep(seen(initialOnboardingState(), 'first-run', 'site'), 'first-run', STEPS, EMPTY_SIGNALS)).toBe('publish');
    expect(currentTourStep(seen(initialOnboardingState(), 'first-run', 'site', 'publish'), 'first-run', STEPS, EMPTY_SIGNALS)).toBeNull();
    // 同一个断点状态在有物件的现场仍然成立（隐藏步不会挡路）。
    expect(currentTourStep(seen(initialOnboardingState(), 'first-run', 'site'), 'first-run', STEPS, SIGNALS_WITH_ITEMS)).toBe('placed');
    expect(tourSummary(initialOnboardingState(), 'first-run', STEPS, EMPTY_SIGNALS)).toEqual({ done: 0, total: 2 });
    expect(tourSummary(initialOnboardingState(), 'first-run', STEPS, SIGNALS_WITH_ITEMS)).toEqual({ done: 0, total: 3 });
    expect(tourSummary(seen(initialOnboardingState(), 'first-run', 'site'), 'first-run', STEPS, SIGNALS_WITH_ITEMS)).toEqual({ done: 1, total: 3 });
  });

  it('tolerates garbage in the store — onboarding must never block the workbench', () => {
    expect(parseOnboardingState(null)).toEqual(initialOnboardingState());
    expect(parseOnboardingState('nope')).toEqual(initialOnboardingState());
    expect(parseOnboardingState(42)).toEqual(initialOnboardingState());
    expect(parseOnboardingState({})).toEqual(initialOnboardingState());
    // 版本不符 = 不认识，直接回初始态（不做静默改写）。
    expect(parseOnboardingState({ version: 2, tours: { 'first-run': { done: ['site'], muted: true } } })).toEqual(initialOnboardingState());
    const loose = parseOnboardingState({
      version: ONBOARDING_VERSION,
      firstSeenAt: '昨天',
      tours: {
        'first-run': { done: 'site', muted: 'yes' },
        'topic-undo': { done: ['undo', 7, null, 'again'], muted: true },
        '不存在的线': { done: ['x'] },
      },
    });
    expect(loose.firstSeenAt).toBeNull();
    expect(loose.tours['first-run']).toEqual({ done: [], muted: false });
    expect(loose.tours['topic-undo']).toEqual({ done: ['undo', 'again'], muted: true });
    expect(Object.keys(loose.tours)).toEqual(['first-run', 'topic-undo']);
  });

  it('round-trips through storage and falls back when the store is unusable', () => {
    const storage = fakeStorage();
    expect(readOnboardingState(storage)).toEqual(initialOnboardingState());

    const state = muteTour(seen(initialOnboardingState(), 'first-run', 'site', 'publish'), 'delivery');
    writeOnboardingState(storage, { ...state, firstSeenAt: 1_700_000_000_000 });
    expect(JSON.parse(storage.raw()!).version).toBe(ONBOARDING_VERSION);
    expect(readOnboardingState(storage)).toEqual({ ...state, firstSeenAt: 1_700_000_000_000 });

    // 坏 JSON / 读不到 / 私密模式写不进：都不许抛，回落一份新引导。
    expect(readOnboardingState(fakeStorage({ [ONBOARDING_STORAGE_KEY]: '{oops' }))).toEqual(initialOnboardingState());
    expect(readOnboardingState(null)).toEqual(initialOnboardingState());
    expect(writeOnboardingState(null, state)).toBeUndefined();
    const broken = { setItem: (): string => { throw new Error('QuotaExceeded'); } };
    expect(() => writeOnboardingState(broken, state)).not.toThrow();
  });

  it('keeps the documented tour ids and the scripts in lockstep', () => {
    // 状态层认这些 id；tour-steps 少了任何一条，宿主取脚本时会直接抛。
    expect(ONBOARDING_TOUR_IDS).toContain('first-run');
    expect(new Set(ONBOARDING_TOUR_IDS).size).toBe(ONBOARDING_TOUR_IDS.length);
  });
});
