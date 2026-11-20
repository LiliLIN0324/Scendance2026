'use client';

/**
 * 帮助中心（2026-11-20）。
 *
 * 这是引导的「入口」而不是又一个弹窗：以前引导关掉就没有第二次，静态教程藏在
 * 账号菜单 → 支持里，还停在室内四格口径。现在左轨常驻一颗「?」，打开能看到
 * 每条航线走到第几步、单点问题的短提示，以及既有的快捷键表与静态教程入口。
 *
 * 只读状态 + 触发开始，不在这里改方案，也不替用户点确认/发布。
 */

import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  tourSummary,
  type OnboardingSignals,
  type OnboardingState,
  type TourId,
} from './onboarding-state';
import { TOUR_SCRIPTS } from './tour-steps';
import './onboarding.css';

export interface HelpCenterProps {
  open: boolean;
  state: OnboardingState;
  signals: OnboardingSignals;
  onClose(): void;
  onStart(id: TourId): void;
  onShortcuts(): void;
}

const MAIN_TOURS = TOUR_SCRIPTS.filter(script => !script.id.startsWith('topic-'));
const TOPIC_TOURS = TOUR_SCRIPTS.filter(script => script.id.startsWith('topic-'));

export function HelpCenter({ open, state, signals, onClose, onStart, onShortcuts }: HelpCenterProps): JSX.Element | null {
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    panelRef.current?.focus();
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [open, onClose]);

  if (!open || typeof document === 'undefined') return null;

  return createPortal(
    <div className="sc-help-backdrop" onPointerDown={event => { if (event.target === event.currentTarget) onClose(); }}>
      <div
        ref={panelRef}
        className="sc-help-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sc-help-title"
        tabIndex={-1}
        data-testid="help-center"
      >
        <header className="sc-help-head">
          <strong id="sc-help-title">帮助与上手</strong>
          <button type="button" className="sc-help-close" aria-label="关闭帮助" onClick={onClose}>×</button>
        </header>

        <div className="sc-help-body">
          <section className="sc-help-section" aria-labelledby="sc-help-tours">
            <h3 id="sc-help-tours">上手航线</h3>
            <div className="sc-help-rows">
              {MAIN_TOURS.map(script => {
                const summary = tourSummary(state, script.id, script.steps, signals);
                const finished = summary.total > 0 && summary.done >= summary.total;
                const label = finished ? '重看' : summary.done > 0 ? '继续' : '开始';
                return (
                  <div className="sc-help-row" key={script.id}>
                    <div className="sc-help-text">
                      <strong>{script.title}</strong>
                      <p>{script.note}</p>
                    </div>
                    <span className="sc-help-progress" aria-label={`已学会 ${summary.done}/${summary.total} 步`}>
                      {summary.done}/{summary.total}
                    </span>
                    <button
                      type="button"
                      className={`sc-help-go${finished ? ' is-secondary' : ''}`}
                      data-tour-start={script.id}
                      onClick={() => onStart(script.id)}
                    >
                      {label}
                    </button>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="sc-help-section" aria-labelledby="sc-help-topics">
            <h3 id="sc-help-topics">单点提示</h3>
            <div className="sc-help-topics">
              {TOPIC_TOURS.map(script => (
                <button
                  type="button"
                  key={script.id}
                  className="sc-help-topic"
                  title={script.note}
                  data-tour-start={script.id}
                  onClick={() => onStart(script.id)}
                >
                  {script.title}
                </button>
              ))}
            </div>
          </section>
        </div>

        <footer className="sc-help-foot">
          <button type="button" onClick={onShortcuts}>键盘快捷键</button>
          <a href="/guide" target="_blank" rel="noopener noreferrer">完整图文教程</a>
          <a href="/guide/capture" target="_blank" rel="noopener noreferrer">场地拍摄要求</a>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
