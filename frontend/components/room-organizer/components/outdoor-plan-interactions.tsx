'use client';

/**
 * 户外 2D 规划交互层 UI：渐进引导气泡。
 *
 * - 纯展示组件，状态逻辑全在 site-plan-guide 纯函数层（可测）。
 * - 引导气泡按每步的 anchor 指向对应区域（canvas=画布中上、left=左缘箭头指向
 *   左栏「添加物件/已放置物件」），箭头用旋转方块拼出，不遮目标。
 * - 视觉消费 outdoor-plan-tokens（幕景绿/间距/圆角）。
 * - 选中态对比度：引导的强调色统一品牌绿 + 白字（AA 级），
 *   悬停加深不透明度，主按钮 autoFocus（键盘可达）。
 */

import { useEffect, useState } from 'react';
import {
  GUIDE_STEP_CONTENT,
  completeGuideStep,
  currentGuideStep,
  dismissGuide,
  parseGuideState,
  type GuideState,
  type GuideStep,
} from '../lib/site-plan-guide';
import { PLANNING_SPACING, PLANNING_TYPOGRAPHY } from '@/lib/outdoor-plan-tokens';

/* ---------------- 渐进引导气泡 ---------------- */

export interface GuideBubbleProps {
  step: GuideStep;
  stepIndex: number;
  totalSteps: number;
  onComplete: () => void;
  onDismiss: () => void;
}

export function GuideBubble({ step, stepIndex, totalSteps, onComplete, onDismiss }: GuideBubbleProps) {
  const content = GUIDE_STEP_CONTENT[step];
  // 2026-11-12 重新做引导：每步带指向锚点——welcome/edit 指画布（箭头朝下），
  // layers 指左栏页签（箭头朝左）。独立工作台的浮窗也在画布左侧，同款指向成立。
  const anchoredLeft = content.anchor === 'left';
  return (
    <div
      role="dialog"
      aria-label={`新手引导 ${stepIndex + 1}/${totalSteps}：${content.title}`}
      data-testid="guide-bubble"
      data-guide-anchor={content.anchor}
      style={{
        position: 'absolute',
        ...(anchoredLeft ? { left: 12, top: 24 } : { left: '50%', top: 24, transform: 'translateX(-50%)' }),
        /* 2026-11-15：导引气泡在 .sc-canvas-stage 里（container-type:size → 栈上下文），
           自身的 z-index 永远压不过 769–1080 档的左栏卡（实测 z 提到 99 仍输），
           所以避让改在 CSS 里做平移，这里保持原值。 */
        zIndex: 30,
        width: 340,
        maxWidth: 'calc(100% - 32px)',
        padding: PLANNING_SPACING.lg,
        borderRadius: 14,
        background: '#ffffff',
        border: '1px solid #e4e4e7',
        boxShadow: '0 6px 18px rgba(20, 20, 22, 0.10)',
        color: '#141416',
        fontFamily: 'inherit',
      }}
    >
      {/* 指向箭头：旋转方块探出气泡边缘，露出两面描边拼成尖端。 */}
      {anchoredLeft ? (
        <span
          aria-hidden
          style={{
            position: 'absolute',
            left: -6,
            top: 36,
            width: 12,
            height: 12,
            transform: 'rotate(45deg)',
            background: '#ffffff',
            borderLeft: '1px solid #e4e4e7',
            borderBottom: '1px solid #e4e4e7',
          }}
        />
      ) : (
        <span
          aria-hidden
          style={{
            position: 'absolute',
            bottom: -6,
            left: '50%',
            width: 12,
            height: 12,
            transform: 'translateX(-50%) rotate(45deg)',
            background: '#ffffff',
            borderRight: '1px solid #e4e4e7',
            borderBottom: '1px solid #e4e4e7',
          }}
        />
      )}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: PLANNING_SPACING.sm }}>
        <strong style={{ fontSize: 14 }}>{content.title}</strong>
        <span style={{ fontSize: PLANNING_TYPOGRAPHY.row, color: '#71767e' }}>{stepIndex + 1}/{totalSteps}</span>
      </div>
      <p style={{ margin: `0 0 ${PLANNING_SPACING.md}px`, fontSize: PLANNING_TYPOGRAPHY.panel, lineHeight: '20px', color: '#55585f' }}>{content.body}</p>
      <div style={{ display: 'flex', gap: PLANNING_SPACING.sm, justifyContent: 'flex-end' }}>
        <button type="button" onClick={onDismiss} style={secondaryButtonStyle}>跳过引导</button>
        <button type="button" onClick={onComplete} autoFocus style={primaryButtonStyle}>{content.cta}</button>
      </div>
    </div>
  );
}

/* ---------------- 引导编排 hook（持久化注入，逻辑在纯函数层） ---------------- */

export function useGuide(storageKey: string) {
  const [state, setState] = useState<GuideState | null>(null);

  useEffect(() => {
    let next: GuideState;
    try {
      const raw = window.localStorage.getItem(storageKey);
      next = raw ? parseGuideState(JSON.parse(raw)) : { done: [], dismissed: false };
    } catch {
      next = { done: [], dismissed: false };
    }
    setState(next);
  }, [storageKey]);

  const persist = (next: GuideState) => {
    setState(next);
    try { window.localStorage.setItem(storageKey, JSON.stringify(next)); } catch { /* 私密模式等：静默 */ }
  };

  return {
    state,
    /** 当前未完成的引导步骤（全部完成/已跳过为 null）。 */
    activeStep: state ? currentGuideStep(state) : null,
    complete: (step: GuideStep) => { if (state) persist(completeGuideStep(state, step)); },
    dismiss: () => { if (state) persist(dismissGuide(state)); },
    restart: () => persist({ done: [], dismissed: false }),
  };
}

/* ---------------- 共享样式（品牌绿强调，白字 AA 对比度） ---------------- */

const primaryButtonStyle: React.CSSProperties = {
  // 冷石规范：主按钮 = 墨底白字（--primary ink），绿不占主钮位。
  padding: `${PLANNING_SPACING.sm}px ${PLANNING_SPACING.md}px`,
  borderRadius: 10,
  border: '1px solid #141416',
  background: '#141416',
  color: '#ffffff',
  fontWeight: 600,
  fontSize: PLANNING_TYPOGRAPHY.panel,
  lineHeight: '20px',
  cursor: 'pointer',
  font: 'inherit',
};

const secondaryButtonStyle: React.CSSProperties = {
  // ghost 次钮：透明底 + 发丝线 + 墨字。
  padding: `${PLANNING_SPACING.sm}px ${PLANNING_SPACING.md}px`,
  borderRadius: 10,
  border: '1px solid #e4e4e7',
  background: 'transparent',
  color: '#141416',
  fontSize: PLANNING_TYPOGRAPHY.panel,
  lineHeight: '20px',
  cursor: 'pointer',
  font: 'inherit',
};










