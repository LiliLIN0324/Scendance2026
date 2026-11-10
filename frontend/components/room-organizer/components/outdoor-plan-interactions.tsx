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
        borderRadius: 12,
        background: 'rgba(24, 34, 48, 0.88)',
        backdropFilter: 'blur(10px)',
        WebkitBackdropFilter: 'blur(10px)',
        border: '1px solid rgba(127, 182, 154, 0.35)',
        boxShadow: '0 12px 32px rgba(0,0,0,0.35)',
        color: '#e7edf5',
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: PLANNING_SPACING.sm }}>
        <strong style={{ fontSize: 14 }}>{content.title}</strong>
        <span style={{ fontSize: 11, color: '#93a4bc' }}>{stepIndex + 1}/{totalSteps}</span>
      </div>
      <p style={{ margin: `0 0 ${PLANNING_SPACING.md}px`, fontSize: 12.5, lineHeight: 1.6, color: '#cdd9ea' }}>{content.body}</p>
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

export function ExportMenu({ onPick, enableExports = false }: ExportMenuProps) {
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
      <button type="button" onClick={() => setOpen(value => !value)} style={primaryButtonStyle} aria-expanded={open} aria-haspopup="menu">
        导出/分享
      </button>
      {open && (
        <div role="menu" aria-label="导出菜单" style={{
          position: 'absolute',
          right: 0,
          top: 'calc(100% + 6px)',
          zIndex: 40,
          minWidth: 220,
          borderRadius: 10,
          background: 'rgba(24, 34, 48, 0.92)',
          backdropFilter: 'blur(12px)',
          WebkitBackdropFilter: 'blur(12px)',
          border: '1px solid rgba(127, 182, 154, 0.3)',
          boxShadow: '0 12px 32px rgba(0,0,0,0.4)',
          padding: PLANNING_SPACING.xs,
          fontFamily: 'system-ui, sans-serif',
        }}>
          {EXPORT_MENU_ITEMS.map(item => {
            // 只读分享在 H4-b 即可预览毛玻璃弹窗形态；其余三项实现归 H5，如实标「即将上线」。
            // H5-a：PNG/CSV 真导出 + 分享弹窗形态；GeoJSON 归 H5-c，如实标「即将上线」。
            const enabled = enableExports
              ? (item.id === 'png' || item.id === 'csv' || item.id === 'share')
              : item.id === 'share';
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
                <span style={{ display: 'block', fontSize: 11, color: '#93a4bc', marginTop: 2 }}>{item.hint}{enabled ? '' : ' · 即将上线'}</span>
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
        background: 'rgba(10, 15, 22, 0.45)',
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      <div
        onClick={event => event.stopPropagation()}
        style={{
          width: 360,
          maxWidth: 'calc(100vw - 48px)',
          padding: PLANNING_SPACING.xl,
          borderRadius: 14,
          background: 'rgba(28, 39, 54, 0.82)',
          backdropFilter: 'blur(16px)',
          WebkitBackdropFilter: 'blur(16px)',
          border: '1px solid rgba(127, 182, 154, 0.35)',
          boxShadow: '0 24px 64px rgba(0,0,0,0.5)',
          color: '#e7edf5',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: PLANNING_SPACING.md }}>
          <strong style={{ fontSize: 15 }}>{content.title}</strong>
          <button type="button" onClick={onClose} aria-label="关闭" style={iconButtonStyle}>×</button>
        </div>
        {content.lines.map((line, index) => (
          <p key={index} style={{ margin: `0 0 ${PLANNING_SPACING.sm}px`, fontSize: 12.5, lineHeight: 1.6, color: index === 0 ? '#e7edf5' : '#cdd9ea' }}>
            {line}
          </p>
        ))}
        {shareLink && (
          <div style={{ display: 'flex', alignItems: 'center', gap: PLANNING_SPACING.sm, margin: `${PLANNING_SPACING.md}px 0 0`, padding: `${PLANNING_SPACING.sm}px ${PLANNING_SPACING.md}px`, background: 'rgba(127, 182, 154, 0.08)', border: '1px solid rgba(127, 182, 154, 0.3)', borderRadius: 8 }}>
            <input
              readOnly
              value={shareLink.length > 72 ? shareLink.slice(0, 48) + '…' + shareLink.slice(-12) : shareLink}
              aria-label="分享链接"
              style={{ flex: 1, background: 'transparent', border: 'none', color: '#cdd9ea', fontSize: 11, fontFamily: 'ui-monospace, monospace', outline: 'none', minWidth: 0 }}
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
  padding: `${PLANNING_SPACING.sm}px ${PLANNING_SPACING.md}px`,
  borderRadius: 8,
  border: '1px solid #35624A',
  background: '#35624A',
  color: '#fff',
  fontWeight: 600,
  fontSize: 12.5,
  cursor: 'pointer',
  font: 'inherit',
};

const secondaryButtonStyle: React.CSSProperties = {
  padding: `${PLANNING_SPACING.sm}px ${PLANNING_SPACING.md}px`,
  borderRadius: 8,
  border: '1px solid #35485f',
  background: 'transparent',
  color: '#cdd9ea',
  fontSize: 12.5,
  cursor: 'pointer',
  font: 'inherit',
};

const menuItemEnabledStyle: React.CSSProperties = {
  display: 'block',
  width: '100%',
  textAlign: 'left',
  padding: `${PLANNING_SPACING.sm}px ${PLANNING_SPACING.md}px`,
  borderRadius: 8,
  border: '1px solid rgba(127, 182, 154, 0.45)',
  background: 'rgba(127, 182, 154, 0.12)',
  color: '#e7edf5',
  cursor: 'pointer',
  font: 'inherit',
  marginBottom: PLANNING_SPACING.xs,
};

const menuItemStyle: React.CSSProperties = {
  display: 'block',
  width: '100%',
  textAlign: 'left',
  padding: `${PLANNING_SPACING.sm}px ${PLANNING_SPACING.md}px`,
  borderRadius: 8,
  border: 'none',
  background: 'transparent',
  color: '#cdd9ea',
  cursor: 'not-allowed',
  opacity: 0.75,
  font: 'inherit',
};

const iconButtonStyle: React.CSSProperties = {
  width: 28,
  height: 28,
  borderRadius: 6,
  border: '1px solid #35485f',
  background: 'transparent',
  color: '#cdd9ea',
  fontSize: 16,
  lineHeight: 1,
  cursor: 'pointer',
};





