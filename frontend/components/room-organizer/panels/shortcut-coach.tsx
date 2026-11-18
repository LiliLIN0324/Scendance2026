'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useDialogFocus } from '../hooks/use-dialog-focus';
import { ShortcutReference, type ShortcutReferenceMode } from './shortcut-reference';

export type ShortcutCoachMode = 'build' | 'outdoor' | 'annotate' | 'walk' | 'review' | 'delivery';

interface ModeMeta {
  label: string;
  hint: string;
  initialMode: ShortcutReferenceMode;
}

const MODE_META: Record<ShortcutCoachMode, ModeMeta> = {
  build: {
    label: '布置',
    hint: '编辑、变换与视图；按 ? 看全部',
    initialMode: 'all',
  },
  outdoor: {
    label: '户外',
    hint: 'H 抓手 · S 选择；标注键先给工具',
    initialMode: 'outdoor',
  },
  annotate: {
    label: '标注',
    hint: 'T / R / O / Y / L 切工具；Esc 退出',
    initialMode: 'annotate',
  },
  walk: {
    label: '漫游',
    hint: 'WASD 归相机；Esc 退出',
    initialMode: 'limits',
  },
  review: {
    label: '评审',
    hint: '只看不改；视图键仍可用',
    initialMode: 'limits',
  },
  delivery: {
    label: '执行',
    hint: '只看不改；交付检查优先',
    initialMode: 'limits',
  },
};

export interface ShortcutCoachProps {
  mode: ShortcutCoachMode;
  enabled?: boolean;
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.tagName === 'SELECT' ||
    target.isContentEditable
  );
}

/**
 * 画布里的快捷键学习入口：左下角一枚“当前模式 + ?”胶囊，按 ? 打开只读速查。
 * 不写存储、不改键位；Esc / 点击遮罩关闭，焦点交给 useDialogFocus。
 */
export function ShortcutCoach({ mode, enabled = true }: ShortcutCoachProps): JSX.Element {
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const meta = MODE_META[mode];

  const close = useCallback(() => setOpen(false), []);
  useDialogFocus(open, panelRef, { initialFocusRef: closeRef, onEscape: close, trap: true });

  useEffect(() => {
    if (!enabled || open) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.repeat) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const questionMark = event.key === '?' || (event.key === '/' && event.shiftKey);
      if (!questionMark || isTypingTarget(event.target)) return;
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      event.preventDefault();
      setOpen(true);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [enabled, open]);

  return (
    <>
      <button
        type="button"
        className="sc-shortcut-coach-trigger"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`快捷键速查（当前：${meta.label}）`}
        title="快捷键速查 (?)"
        onClick={() => setOpen(true)}
      >
        <kbd aria-hidden="true">?</kbd>
        <span className="sc-shortcut-coach-mode">{meta.label}</span>
        <span className="sc-shortcut-coach-hint">速查</span>
      </button>
      {open && createPortal(
        <div
          className="sc-shortcut-coach-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) close();
          }}
        >
          <div
            className="sc-shortcut-coach"
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="sc-shortcut-coach-title"
            tabIndex={-1}
          >
            <div className="sc-shortcut-coach-head">
              <div>
                <p className="sc-shortcut-coach-kicker">键盘速查 · 只读</p>
                <h2 id="sc-shortcut-coach-title">快捷键</h2>
                <p className="sc-shortcut-coach-current">
                  <span>{meta.label}</span>
                  {meta.hint}
                </p>
              </div>
              <button
                ref={closeRef}
                type="button"
                className="sc-shortcut-coach-close"
                aria-label="关闭快捷键速查"
                onClick={close}
              >
                ×
              </button>
            </div>
            <ShortcutReference initialMode={meta.initialMode} />
            <p className="sc-shortcut-coach-foot">按 ? 打开 · Esc 关闭 · 这里只读，不会改动你的键位</p>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
