'use client';

/**
 * 户外 2D 规划交互层 UI（H4-b）：渐进引导气泡、导出菜单、毛玻璃分享弹窗。
 *
 * - 纯展示组件，状态逻辑全在 site-plan-guide 纯函数层（可测）。
 * - 视觉消费 outdoor-plan-tokens（幕景绿/间距/圆角），毛玻璃用 backdrop-filter。
 * - 选中态对比度：引导/菜单/弹窗的强调色统一品牌绿 + 白字（AA 级），
 *   悬停加深不透明度，主按钮 autoFocus（键盘可达）。
 */

import { useEffect, useRef, useState } from 'react';
import {
  EXPORT_MENU_ITEMS,
  GUIDE_STEP_CONTENT,
  completeGuideStep,
  currentGuideStep,
  dismissGuide,
  parseGuideState,
  type ExportItemId,
  type GuideState,
  type GuideStep,
} from '../lib/site-plan-guide';
import { PLANNING_SPACING } from '@/lib/outdoor-plan-tokens';

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
  return (
    <div
      role="dialog"
      aria-label={`新手引导 ${stepIndex + 1}/${totalSteps}：${content.title}`}
      style={{
        position: 'absolute',
        left: '50%',
        top: 24,
        transform: 'translateX(-50%)',
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
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: PLANNING_SPACING.sm }}>
        <strong style={{ fontSize: 14 }}>{content.title}</strong>
        <span style={{ fontSize: 11, color: '#71767e' }}>{stepIndex + 1}/{totalSteps}</span>
      </div>
      <p style={{ margin: `0 0 ${PLANNING_SPACING.md}px`, fontSize: 12, lineHeight: '20px', color: '#55585f' }}>{content.body}</p>
      <div style={{ display: 'flex', gap: PLANNING_SPACING.sm, justifyContent: 'flex-end' }}>
        <button type="button" onClick={onDismiss} style={secondaryButtonStyle}>跳过引导</button>
        <button type="button" onClick={onComplete} autoFocus style={primaryButtonStyle}>{content.cta}</button>
      </div>
    </div>
  );
}

/* ---------------- 导出菜单 ---------------- */

export interface ExportMenuProps {
  onPick?: (id: ExportItemId) => void;
  /** H5-a：PNG/CSV 已可导出。为 true 时对应菜单项可点（否则仍是「即将上线」禁用）。 */
  enableExports?: boolean;
}

export function ExportMenu({ onPick, enableExports = false, variant = 'default' }: ExportMenuProps & { variant?: 'default' | 'toolbar' }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [open]);

  return (
    <div ref={rootRef} style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => setOpen(value => !value)}
        {...(variant === 'toolbar'
          ? { 'aria-label': '导出/分享', 'data-tip': '导出 / 分享' }
          : { style: secondaryButtonStyle })}
        aria-expanded={open}
        aria-haspopup="menu"
      >
        {variant === 'toolbar'
          ? <span aria-hidden style={{ fontSize: 14, lineHeight: 1 }}>⤓</span>
          : '导出/分享'}
      </button>
      {open && (
        <div role="menu" aria-label="导出菜单" style={{
          position: 'absolute',
          right: 0,
          top: 'calc(100% + 6px)',
          zIndex: 40,
          minWidth: 220,
          borderRadius: 14,
          background: '#ffffff',
          border: '1px solid #e4e4e7',
          boxShadow: '0 6px 18px rgba(20, 20, 22, 0.10)',
          padding: PLANNING_SPACING.xs,
          fontFamily: 'inherit',
        }}>
          {EXPORT_MENU_ITEMS.map(item => {
            // 只读分享在 H4-b 即可预览毛玻璃弹窗形态；其余三项实现归 H5，如实标「即将上线」。
            // H5-c：四项全部真导出（PNG/CSV/GeoJSON/分享）。
            const enabled = enableExports ? true : item.id === 'share';
            return (
              <button
                key={item.id}
                type="button"
                role="menuitem"
                disabled={!enabled}
                title={enabled ? '预览分享弹窗' : `${item.label}（H5 上线）`}
                onClick={() => onPick?.(item.id)}
                style={enabled ? menuItemEnabledStyle : menuItemStyle}
              >
                <span style={{ display: 'block', fontWeight: 600, fontSize: 13 }}>{item.label}</span>
                <span style={{ display: 'block', fontSize: 11, color: '#71767e', marginTop: 2 }}>{item.hint}{enabled ? '' : ' · 即将上线'}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ---------------- 毛玻璃分享弹窗 ---------------- */

export interface ShareDialogProps {
  open: boolean;
  onClose: () => void;
  content: { title: string; lines: string[] };
  /** H5-b：本地分享链接（可复制）；生产换 token。 */
  shareLink?: string;
  /** H5-b：PDF 演示稿打印入口。 */
  onPrintDeck?: () => void;
}

export function ShareDialog({ open, onClose, content, shareLink, onPrintDeck }: ShareDialogProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const [copied, setCopied] = useState(false);
  if (!open) return null;
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={content.title}
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 60,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(20, 20, 22, 0.32)',
        fontFamily: 'inherit',
      }}
    >
      <div
        onClick={event => event.stopPropagation()}
        style={{
          width: 'min(560px, calc(100vw - 32px))',
          padding: 24,
          borderRadius: 18,
          background: '#ffffff',
          border: '1px solid #e4e4e7',
          boxShadow: '0 16px 48px rgba(20, 20, 22, 0.18)',
          color: '#141416',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: PLANNING_SPACING.md }}>
          <strong style={{ fontSize: 20, lineHeight: '28px', fontWeight: 600 }}>{content.title}</strong>
          <button type="button" onClick={onClose} aria-label="关闭" style={iconButtonStyle}>×</button>
        </div>
        {content.lines.map((line, index) => (
          <p key={index} style={{ margin: `0 0 ${PLANNING_SPACING.sm}px`, fontSize: 12, lineHeight: '20px', color: index === 0 ? '#141416' : '#55585f' }}>
            {line}
          </p>
        ))}
        {shareLink && (
          <div style={{ display: 'flex', alignItems: 'center', gap: PLANNING_SPACING.sm, margin: `${PLANNING_SPACING.md}px 0 0`, padding: `${PLANNING_SPACING.sm}px ${PLANNING_SPACING.md}px`, background: '#f4f5f7', border: '1px solid #e4e4e7', borderRadius: 10 }}>
            <input
              readOnly
              value={shareLink.length > 72 ? shareLink.slice(0, 48) + '…' + shareLink.slice(-12) : shareLink}
              aria-label="分享链接"
              style={{ flex: 1, background: 'transparent', border: 'none', color: '#141416', fontSize: 11, fontFamily: 'ui-monospace, monospace', outline: 'none', minWidth: 0 }}
              onFocus={event => event.currentTarget.select()}
            />
            <button type="button" onClick={() => { void navigator.clipboard?.writeText(shareLink); setCopied(true); }} style={primaryButtonStyle}>
              {copied ? '已复制' : '复制链接'}
            </button>
          </div>
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: PLANNING_SPACING.sm, marginTop: PLANNING_SPACING.lg }}>
          {onPrintDeck && (
            <button type="button" onClick={onPrintDeck} style={secondaryButtonStyle}>打印 PDF 演示稿</button>
          )}
          <button type="button" onClick={onClose} style={secondaryButtonStyle}>知道了</button>
        </div>
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
  fontSize: 12,
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
  fontSize: 12,
  lineHeight: '20px',
  cursor: 'pointer',
  font: 'inherit',
};

const menuItemEnabledStyle: React.CSSProperties = {
  // 绿仅点睛：可导出项 = 绿淡底 + 绿描边 + 墨字（激活语义）。
  display: 'block',
  width: '100%',
  textAlign: 'left',
  padding: `${PLANNING_SPACING.sm}px ${PLANNING_SPACING.md}px`,
  borderRadius: 10,
  border: '1px solid #4a7c59',
  background: 'rgba(74, 124, 89, 0.12)',
  color: '#141416',
  cursor: 'pointer',
  font: 'inherit',
  marginBottom: PLANNING_SPACING.xs,
};

const menuItemStyle: React.CSSProperties = {
  display: 'block',
  width: '100%',
  textAlign: 'left',
  padding: `${PLANNING_SPACING.sm}px ${PLANNING_SPACING.md}px`,
  borderRadius: 10,
  border: 'none',
  background: 'transparent',
  color: '#71767e',
  cursor: 'not-allowed',
  opacity: 0.75,
  font: 'inherit',
};

const iconButtonStyle: React.CSSProperties = {
  // ghost 关闭钮：透明底 + 发丝线 + 墨字（模态规范）。
  width: 28,
  height: 28,
  borderRadius: 10,
  border: '1px solid #e4e4e7',
  background: 'transparent',
  color: '#141416',
  fontSize: 16,
  lineHeight: 1,
  cursor: 'pointer',
};










