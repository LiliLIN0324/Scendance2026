'use client';

/**
 * 引导宿主（2026-11-20）：把状态、引擎、帮助中心接在一起。
 *
 * 挂在工作台里而不是每个面板里：引导要跨左轨、画布、对话、交付菜单找控件，
 * 挂在任一子面板里都会跟着那个面板一起卸载。
 *
 * 自动开始只有一条航线（首访五步），且只在「一步都没看过、也没点过不再提示」
 * 时触发；中途关掉算暂停，下次进帮助中心能接着走，不硬弹。
 */

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { HelpCenter } from './help-center';
import {
  markStepSeen,
  muteTour,
  NO_SIGNALS,
  ONBOARDING_STORAGE_KEY,
  readOnboardingState,
  restartTour,
  shouldAutoStart,
  stepVisible,
  writeOnboardingState,
  type OnboardingSignals,
  type OnboardingState,
  type TourId,
} from './onboarding-state';
import { TourReel } from './tour-reel';
import { tourScript, TOUR_SCRIPTS, type TourStep } from './tour-steps';
import './onboarding.css';

/* ---------------- 帮助中心开关：左轨那颗 ? 和宿主不在同一棵子树 ---------------- */

let helpOpen = false;
const helpListeners = new Set<() => void>();

function emitHelp(): void {
  for (const listener of helpListeners) listener();
}

export function openHelpCenter(): void {
  if (helpOpen) return;
  helpOpen = true;
  emitHelp();
}

export function closeHelpCenter(): void {
  if (!helpOpen) return;
  helpOpen = false;
  emitHelp();
}

/** 测试用：单例状态清干净，下一个用例从「关着」开始。 */
export function resetHelpCenterForTests(): void {
  helpOpen = false;
  emitHelp();
}

export function useHelpCenterOpen(): boolean {
  return useSyncExternalStore(
    listener => {
      helpListeners.add(listener);
      return () => { helpListeners.delete(listener); };
    },
    () => helpOpen,
    () => false,
  );
}

/* ---------------- 左轨入口 ---------------- */

export function HelpRailButton(): JSX.Element {
  const open = useHelpCenterOpen();
  return (
    <button
      type="button"
      className="sc-rail-tool sc-rail-help"
      aria-label="帮助与上手"
      aria-pressed={open}
      aria-expanded={open}
      data-tip="帮助与上手"
      data-tour="help"
      onClick={openHelpCenter}
    >
      <span aria-hidden="true">?</span>
    </button>
  );
}

/* ---------------- 宿主 ---------------- */

function firstVisibleIndex(steps: readonly TourStep[], signals: OnboardingSignals, done: readonly string[] = []): number {
  return steps.findIndex(step => !done.includes(step.id) && stepVisible(step, signals));
}

export interface OnboardingHostProps {
  signals?: OnboardingSignals;
}

export function OnboardingHost({ signals = NO_SIGNALS }: OnboardingHostProps): JSX.Element | null {
  const [state, setState] = useState<OnboardingState>(() => readOnboardingState(null));
  const [hydrated, setHydrated] = useState(false);
  const [active, setActive] = useState<{ id: TourId; index: number } | null>(null);
  const helpOpenNow = useHelpCenterOpen();
  const autoStarted = useRef(false);
  const stateRef = useRef(state);
  stateRef.current = state;
  const signalsRef = useRef(signals);
  signalsRef.current = signals;
  const activeRef = useRef(active);
  activeRef.current = active;

  // 水合后再读存档：SSR 阶段没有 localStorage，首帧必须与客户端一致。
  useEffect(() => {
    const storage = typeof window === 'undefined' ? null : window.localStorage;
    const stored = readOnboardingState(storage);
    setState({ ...stored, firstSeenAt: stored.firstSeenAt ?? Date.now() });
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated || typeof window === 'undefined') return;
    writeOnboardingState(window.localStorage, state);
  }, [state, hydrated]);

  // 首访自动开始。一次性 ref 挡住 StrictMode 的重复执行；依赖里不写 state，
  // 否则水合后第一次 setState 会把定时器清掉，再也不会重排。
  useEffect(() => {
    if (!hydrated || autoStarted.current) return undefined;
    autoStarted.current = true;
    // 单测里没人会点引导：自动弹窗只会给既有用例添乱，要测就显式 openHelpCenter。
    const isTest = typeof process !== 'undefined' && process.env.NODE_ENV === 'test';
    if (isTest) return undefined;
    const timer = window.setTimeout(() => {
      const script = TOUR_SCRIPTS.find(item => item.auto);
      if (!script || !shouldAutoStart(stateRef.current, script.id)) return;
      const index = firstVisibleIndex(script.steps, signalsRef.current);
      if (index >= 0) setActive({ id: script.id, index });
    }, 1200);
    return () => window.clearTimeout(timer);
  }, [hydrated]);

  const startTour = useCallback((id: TourId) => {
    const script = tourScript(id);
    const progress = stateRef.current.tours[id];
    const done = progress?.done ?? [];
    const index = firstVisibleIndex(script.steps, signalsRef.current, done);
    if (index >= 0) {
      closeHelpCenter();
      setActive({ id, index });
      return;
    }
    // 全走完了就是「重看」：清进度，从第一步重来。
    setState(current => restartTour(current, id));
    const replayIndex = firstVisibleIndex(script.steps, signalsRef.current);
    closeHelpCenter();
    if (replayIndex >= 0) setActive({ id, index: replayIndex });
  }, []);

  const advance = useCallback(() => {
    const current = activeRef.current;
    if (!current) return;
    const script = tourScript(current.id);
    const step = script.steps[current.index];
    if (!step) {
      setActive(null);
      return;
    }
    const done = [...(stateRef.current.tours[current.id]?.done ?? []), step.id];
    setState(latest => markStepSeen(latest, current.id, step.id));
    const next = script.steps.findIndex((candidate, position) =>
      position > current.index && !done.includes(candidate.id) && stepVisible(candidate, signalsRef.current));
    setActive(next >= 0 ? { id: current.id, index: next } : null);
  }, []);

  const pause = useCallback(() => setActive(null), []);

  const mute = useCallback(() => {
    const current = activeRef.current;
    if (current) setState(latest => muteTour(latest, current.id));
    setActive(null);
  }, []);

  const shortcuts = useCallback(() => {
    closeHelpCenter();
    if (typeof window !== 'undefined') window.dispatchEvent(new Event('scendance:open-shortcut-coach'));
  }, []);

  const script = active ? tourScript(active.id) : null;
  const safeIndex = script && active ? Math.min(active.index, Math.max(script.steps.length - 1, 0)) : 0;

  return (
    <>
      {script && active && (
        <TourReel
          key={`${active.id}-${safeIndex}`}
          steps={script.steps}
          index={safeIndex}
          onNext={advance}
          onSkipStep={advance}
          onClose={pause}
          onMute={mute}
        />
      )}
      <HelpCenter
        open={helpOpenNow}
        state={state}
        signals={signals}
        onClose={closeHelpCenter}
        onStart={startTour}
        onShortcuts={shortcuts}
      />
    </>
  );
}

export default OnboardingHost;

/** 存档键对外暴露一份，排查时不用去翻源码。 */
export { ONBOARDING_STORAGE_KEY };
