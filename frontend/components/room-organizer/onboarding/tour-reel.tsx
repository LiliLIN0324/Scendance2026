'use client';

/**
 * 引导浮层引擎（2026-11-20）。
 *
 * 对标 petitmaker / Figma 的做法改了一处：**不做全屏遮罩**，也不替用户点按。
 * 只做三件事——圈出真实控件、在旁边说一句人话、给下一步。遮罩会挡住工作台，
 * 自动点按会真的改方案（发送、确认、发布都是写操作），两者都不要。
 *
 * 控件按 CSS 选择器找（`data-tour` 或既有稳定 id），不记坐标：面板一收一开，
 * 坐标就是错的。找不到控件时退回居中卡片，绝不因为定位失败卡住引导。
 */

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import type { TourStep } from './tour-steps';
import './onboarding.css';

const CARD_WIDTH = 320;
const GAP = 14;
const MARGIN = 12;
/** 卡片高度只能估：真要精确就得先渲染再量，收益不值这个复杂度。 */
const CARD_ESTIMATE = 196;

interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}

function measureTarget(selector: string | null): Box | null {
  if (!selector || typeof document === 'undefined') return null;
  const element = document.querySelector<HTMLElement>(selector);
  if (!element) return null;
  const style = window.getComputedStyle(element);
  // 3D 接管时 2D 覆盖层还在 DOM 里但 visibility:hidden——那不是「能看到的控件」。
  if (style.visibility === 'hidden' || style.display === 'none') return null;
  const rect = element.getBoundingClientRect();
  if (rect.width < 24 || rect.height < 24) return null;
  return { top: rect.top, left: rect.left, width: rect.width, height: rect.height };
}

function cardPlacement(box: Box | null): { left: number; top: number; width: number } {
  const viewportWidth = typeof window === 'undefined' ? 1024 : window.innerWidth;
  const viewportHeight = typeof window === 'undefined' ? 768 : window.innerHeight;
  const width = Math.min(CARD_WIDTH, viewportWidth - MARGIN * 2);

  if (!box) {
    return {
      left: Math.round((viewportWidth - width) / 2),
      top: Math.max(MARGIN, Math.round((viewportHeight - CARD_ESTIMATE) / 2)),
      width,
    };
  }

  // 整块画布这种大目标：卡片浮在中上，圈仍然围着整块区域。
  if (box.width > viewportWidth * 0.6 || box.height > viewportHeight * 0.6) {
    return { left: Math.round((viewportWidth - width) / 2), top: 24, width };
  }

  // 先试右侧，再试上方，再试下方，都不行就贴着目标居中夹进视口。
  const right = box.left + box.width + GAP;
  if (right + width <= viewportWidth - MARGIN) {
    const top = Math.max(MARGIN, Math.min(box.top + box.height / 2 - CARD_ESTIMATE / 2, viewportHeight - CARD_ESTIMATE - MARGIN));
    return { left: Math.round(right), top: Math.round(top), width };
  }
  const above = box.top - GAP - CARD_ESTIMATE;
  if (above >= MARGIN) {
    const left = Math.max(MARGIN, Math.min(box.left + box.width / 2 - width / 2, viewportWidth - width - MARGIN));
    return { left: Math.round(left), top: Math.round(above), width };
  }
  const below = box.top + box.height + GAP;
  if (below + CARD_ESTIMATE <= viewportHeight - MARGIN) {
    const left = Math.max(MARGIN, Math.min(box.left + box.width / 2 - width / 2, viewportWidth - width - MARGIN));
    return { left: Math.round(left), top: Math.round(below), width };
  }
  return {
    left: Math.max(MARGIN, Math.min(box.left, viewportWidth - width - MARGIN)),
    top: MARGIN,
    width,
  };
}

export interface TourReelProps {
  steps: TourStep[];
  index: number;
  onNext(): void;
  onSkipStep(): void;
  onClose(): void;
  onMute(): void;
}

export function TourReel({ steps, index, onNext, onSkipStep, onClose, onMute }: TourReelProps): JSX.Element | null {
  const step = steps[index];
  const [mounted, setMounted] = useState(false);
  const [box, setBox] = useState<Box | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  // 目标可能比引导晚挂载（面板展开、卡片出提案），所以量不到就隔 200ms 再试，
  // 最多八次（约 1.6s）；之后按「没有控件」处理，卡片居中，不无限轮询。
  useEffect(() => {
    if (!mounted || !step) return undefined;
    let alive = true;
    let attempts = 0;
    let timer: number | undefined;

    const measure = () => {
      if (!alive) return;
      const next = measureTarget(step.target);
      setBox(current => {
        if (current === null && next === null) return current;
        if (current && next
          && current.top === next.top && current.left === next.left
          && current.width === next.width && current.height === next.height) return current;
        return next;
      });
      if (!next && step.target && attempts < 8) {
        attempts += 1;
        timer = window.setTimeout(measure, 200);
      }
    };

    measure();
    const onViewportChange = () => {
      if (!alive) return;
      setBox(measureTarget(step.target));
    };
    window.addEventListener('resize', onViewportChange);
    window.addEventListener('scroll', onViewportChange, true);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(onViewportChange);
    const element = step.target ? document.querySelector<HTMLElement>(step.target) : null;
    if (observer && element) observer.observe(element);

    return () => {
      alive = false;
      if (timer !== undefined) window.clearTimeout(timer);
      window.removeEventListener('resize', onViewportChange);
      window.removeEventListener('scroll', onViewportChange, true);
      observer?.disconnect();
    };
  }, [mounted, step]);

  useEffect(() => {
    if (!mounted) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      // Esc 只收起引导（暂停），不把进度标成已看：下次还能接着走。
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [mounted, onClose]);

  const placement = useMemo(() => cardPlacement(box), [box]);

  if (!mounted || !step) return null;

  const isLast = index === steps.length - 1;
  const ring = box
    ? {
        left: Math.round(box.left - 4),
        top: Math.round(box.top - 4),
        width: Math.round(box.width + 8),
        height: Math.round(box.height + 8),
      }
    : null;

  return createPortal(
    <div className="sc-tour-root">
      {ring && <div className="sc-tour-ring" data-testid="tour-ring" aria-hidden="true" style={ring} />}
      <div
        className="sc-tour-card"
        role="dialog"
        aria-modal="false"
        aria-labelledby="sc-tour-title"
        data-testid="tour-reel"
        data-tour-step={step.id}
        style={{ left: placement.left, top: placement.top, width: placement.width }}
      >
        <div className="sc-tour-head">
          <span className="sc-tour-count" aria-hidden="true">{index + 1}/{steps.length}</span>
          <strong id="sc-tour-title">{step.title}</strong>
          <button type="button" className="sc-tour-close" aria-label="关闭引导" onClick={onClose}>×</button>
        </div>
        <p className="sc-tour-body">{step.body}</p>
        <div className="sc-tour-actions">
          <button type="button" className="sc-tour-mute" onClick={onMute}>以后不再提示</button>
          <span className="sc-tour-spacer" />
          {steps.length > 1 && !isLast && (
            <button type="button" className="sc-tour-secondary" onClick={onSkipStep}>跳过这一步</button>
          )}
          {/* cta 只写最后一步的说法：同一步骤复用进别的航线时，中间那步还叫「下一步」。 */}
          <button type="button" className="sc-tour-primary" onClick={onNext}>
            {isLast ? (step.cta ?? '知道了') : '下一步'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
