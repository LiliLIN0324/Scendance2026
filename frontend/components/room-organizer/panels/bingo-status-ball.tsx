'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import {
  bingoBallLabel,
  bingoPhaseLabel,
  clearBingoReceipt,
  emptyBingoSnapshot,
  formatBingoTime,
  readBingoSnapshot,
  type BingoSnapshot,
} from '../lib/bingo-status';

/**
 * 左轨脚下的评审状态球。
 *
 * 轨顶和画布上的晴光仍是对话入口。这颗球只表示评审收藏：
 * 待发、待评审、已回执（红环）。点开是一张简卡，不是另一个 Agent。
 */
export function BingoStatusBall() {
  const cardId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const ballRef = useRef<HTMLButtonElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [snapshot, setSnapshot] = useState<BingoSnapshot>(emptyBingoSnapshot);
  const [ready, setReady] = useState(false);

  const sync = useCallback(() => {
    setSnapshot(readBingoSnapshot(window.localStorage));
    setReady(true);
  }, []);

  useEffect(() => {
    sync();
    const onStore = () => sync();
    window.addEventListener('storage', onStore);
    window.addEventListener('focus', onStore);
    document.addEventListener('visibilitychange', onStore);
    return () => {
      window.removeEventListener('storage', onStore);
      window.removeEventListener('focus', onStore);
      document.removeEventListener('visibilitychange', onStore);
    };
  }, [sync]);

  const close = useCallback(() => {
    setOpen(false);
    ballRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    cardRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    const onPointer = (event: PointerEvent) => {
      const root = rootRef.current;
      if (!root || !(event.target instanceof Node) || root.contains(event.target)) return;
      setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
    };
  }, [open, close]);

  const onClear = () => {
    clearBingoReceipt(window.localStorage);
    sync();
  };

  const phase = ready ? snapshot.phase : 'pending';
  const label = ready ? bingoBallLabel(snapshot) : '评审收藏';
  const phaseLabel = bingoPhaseLabel(ready ? snapshot.phase : 'to-send');
  const count = ready && snapshot.phase === 'awaiting' ? String(snapshot.plans.length) : '';

  return (
    <div ref={rootRef} className="sc-bingo" data-bingo={phase}>
      <button
        ref={ballRef}
        type="button"
        className={`sc-bingo-ball${phase === 'returned' ? ' is-returned' : ''}`}
        data-status={phase}
        {...(count ? { 'data-count': count } : {})}
        aria-label={label}
        aria-expanded={open}
        aria-controls={cardId}
        aria-haspopup="dialog"
        title={ready ? `评审收藏 · ${phaseLabel}` : '评审收藏'}
        onClick={() => setOpen(value => !value)}
      />
      {open && (
        <div
          ref={cardRef}
          id={cardId}
          className="sc-bingo-card"
          role="dialog"
          aria-label="评审收藏"
          tabIndex={-1}
        >
          <div className="sc-bingo-card-head">
            <strong>评审收藏</strong>
            <span className={`sc-bingo-phase is-${snapshot.phase}`}>{phaseLabel}</span>
            <button type="button" className="sc-bingo-collapse" onClick={close}>收起</button>
          </div>
          {snapshot.receipt && (
            <p className="sc-bingo-receipt">
              已回执 · {formatBingoTime(snapshot.receipt.at) || snapshot.receipt.at}
              <span>{snapshot.receipt.planKey}</span>
            </p>
          )}
          {snapshot.plans.length > 0 ? (
            <ul className="sc-bingo-plans">
              {snapshot.plans.map((plan, index) => (
                <li key={`${plan.shareId}-${index}`}>
                  <div className="sc-bingo-plan-copy">
                    <strong>{plan.title}</strong>
                    <span>{plan.returned ? '已回执' : '待评审'}</span>
                  </div>
                  <a href={plan.href}>打开评审页</a>
                </li>
              ))}
            </ul>
          ) : (
            <p className="sc-bingo-empty">
              {snapshot.receipt
                ? '评审已经写回这台浏览器。清掉回执后，球回到待发。'
                : '还没有待评审的方案。从分享发出评审链接后，会收在这颗球里。'}
            </p>
          )}
          {(snapshot.plans.length === 0 || snapshot.receipt) && (
            <div className="sc-bingo-actions">
              {snapshot.plans.length === 0 && (
                <a href={snapshot.receipt?.href ?? '/review/'}>打开评审页</a>
              )}
              {snapshot.receipt && (
                <button type="button" className="sc-bingo-clear" onClick={onClear}>清回执</button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
