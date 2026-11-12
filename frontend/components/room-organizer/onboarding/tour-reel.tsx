'use client';

/**
 * 演示回放壳：把 onboarding 步进脚本回放在真实工作台上。
 * - 首访自动开始（localStorage 标记只跑一次）；右下角浮钮随时重看。
 * - 每步：目标控件高亮 + 底部旁白卡 + 倒计时自动执行；「动手试试」暂停倒计时让用户亲手来。
 * - 执行走真实 DOM 事件（click / React 受控输入的原生 setter），与真实用户同一入口，撤销栈可退。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Play, RotateCcw, X } from 'lucide-react';
import {
  startTour, tourBack, tourHandsOn, tourNext, tourTick, tourStepOf,
  type TourState, type TourStep,
} from './tour-machine';

const ACTIVE_ATTR = 'data-tour-active';

function findTarget(step: TourStep | null): HTMLElement | null {
  if (!step) return null;
  return document.querySelector<HTMLElement>(`[data-tour="${step.target}"]`);
}

function setHighlight(el: HTMLElement | null): void {
  document.querySelectorAll(`[${ACTIVE_ATTR}]`).forEach(node => node.removeAttribute(ACTIVE_ATTR));
  if (el) el.setAttribute(ACTIVE_ATTR, '');
}

/** React 受控输入：原生 setter + input 事件，走真实 onChange。 */
function fillReactValue(el: HTMLTextAreaElement | HTMLInputElement, value: string): void {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  setter?.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

export function TourReel({ steps, storageKey }: { steps: readonly TourStep[]; storageKey: string }): JSX.Element {
  const [state, setState] = useState<TourState | null>(null);
  const [doneAck, setDoneAck] = useState(false);
  const stateRef = useRef<TourState | null>(null);
  stateRef.current = state;
  const executingRef = useRef(false);

  const finish = useCallback(() => {
    try { localStorage.setItem(storageKey, 'done'); } catch { /* 隐私模式等：仅影响不再自动播放 */ }
  }, [storageKey]);

  // 首访自动开始（只跑一次）。
  useEffect(() => {
    let started = false;
    try { started = localStorage.getItem(storageKey) === 'done'; } catch { started = false; }
    if (!started) setState(startTour(steps));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const step = useMemo(() => tourStepOf(state ?? { index: 0, phase: 'done', remainingMs: 0, waitedMs: 0 }, steps), [state, steps]);

  // 心跳：倒计时 / 等目标。
  useEffect(() => {
    if (!state || state.phase === 'done' || state.phase === 'executing' || state.phase === 'hands-on') return;
    const timer = window.setInterval(() => {
      const current = stateRef.current;
      if (!current || current.phase === 'done' || current.phase === 'executing' || current.phase === 'hands-on') return;
      const currentStep = tourStepOf(current, steps);
      const present = !!findTarget(currentStep);
      setState(tourTick(current, steps, 250, present));
    }, 250);
    return () => window.clearInterval(timer);
  }, [state?.phase, steps, state]);

  // 高亮跟随当前步。
  useEffect(() => {
    if (!state || state.phase === 'done') { setHighlight(null); return; }
    setHighlight(findTarget(step));
    return () => setHighlight(null);
  }, [state?.index, state?.phase, step, state]);

  // 执行当前步（真实事件），然后进入下一步或完成。
  useEffect(() => {
    if (!state || state.phase !== 'executing' || executingRef.current) return;
    executingRef.current = true;
    const run = async (): Promise<void> => {
      const currentStep = tourStepOf(state, steps);
      const el = findTarget(currentStep);
      if (el && currentStep) {
        if (currentStep.action === 'fill') fillReactValue(el as HTMLTextAreaElement, currentStep.payload ?? '');
        else if (currentStep.action === 'click') (el as HTMLButtonElement).click();
        // highlight：只停留，不加操作。
      }
      await new Promise(resolve => window.setTimeout(resolve, currentStep?.action === 'highlight' ? 400 : 250));
      setState(current => {
        if (!current) return current;
        const next = current.index + 1;
        if (next >= steps.length) {
          finish();
          return { ...current, phase: 'done' };
        }
        return { index: next, phase: 'countdown', remainingMs: steps[next]?.autoPressMs ?? 8000, waitedMs: 0 };
      });
    };
    void run().finally(() => { executingRef.current = false; });
  }, [state, steps, finish]);

  const replay = useCallback(() => {
    try { localStorage.removeItem(storageKey); } catch { /* 忽略 */ }
    setDoneAck(false);
    setState(startTour(steps));
  }, [steps, storageKey]);

  const stop = useCallback(() => {
    finish();
    setDoneAck(false);
    setState(null);
  }, [finish]);

  // 完成卡（可重看可关）。
  if (state?.phase === 'done' && !doneAck) {
    return <div className="tour-card" role="dialog" aria-label="新手演示完成">
      <p className="tour-caption">演示完成 🎉 布置的完整闭环就是这条线。右下角随时可以重看。</p>
      <div className="tour-actions">
        <button type="button" className="btn" onClick={replay}><RotateCcw size={14} aria-hidden="true"/>重看</button>
        <button type="button" className="btn btn-primary" onClick={() => setDoneAck(true)}>开始用</button>
      </div>
    </div>;
  }

  // 待机：右下角浮钮。
  if (!state || state.phase === 'done') {
    return <button type="button" className="tour-fab" onClick={() => { setDoneAck(false); setState(startTour(steps)); }} aria-label="重看新手演示">
      <Play size={14} aria-hidden="true"/>新手演示
    </button>;
  }

  const remainingSeconds = Math.max(0, Math.ceil(state.remainingMs / 1000));
  const isHandsOn = state.phase === 'hands-on';
  return <div className="tour-card" role="dialog" aria-label="新手演示">
    <div className="tour-head">
      <span className="tour-dots" aria-hidden="true">{steps.map(entry => <i key={entry.target} data-on={steps.indexOf(entry) <= state.index ? 'true' : 'false'}/>)}</span>
      <span className="tour-step-label">{state.index + 1}/{steps.length}</span>
      <button type="button" className="tour-x" aria-label="跳过演示" onClick={stop}><X size={14} aria-hidden="true"/></button>
    </div>
    <p className="tour-caption">{step?.caption}</p>
    <div className="tour-actions">
      <button type="button" className="btn" onClick={() => setState(tourBack(state, steps))} disabled={state.index === 0}>上一步</button>
      <button type="button" className="btn" onClick={() => setState(tourHandsOn(state, steps))}>{isHandsOn ? '继续演示' : '动手试试'}</button>
      <button type="button" className="btn btn-primary" onClick={() => setState(tourNext(state))}>
        {isHandsOn ? '继续' : state.phase === 'waiting-target' ? '等它出现…' : `下一步（${remainingSeconds}s）`}
      </button>
    </div>
  </div>;
}
