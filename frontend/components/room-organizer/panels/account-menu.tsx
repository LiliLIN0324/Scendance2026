'use client';

import { BookOpen, FolderOpen, HelpCircle, Images, Info, MessageSquare, Settings, UserRound } from '@/components/solid-icons';
import { useEffect, useId, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { AboutDialog } from './about-dialog';
import { FeedbackDialog, type FeedbackPlanContext } from './feedback-dialog';

const GUIDE_URL = '/guide';

export function openShortcutCoach(): void {
  window.dispatchEvent(new Event('scendance:open-shortcut-coach'));
}

function hoverFine(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(hover: hover) and (pointer: fine)').matches;
}

export function AccountMenu({
  open,
  onClose,
  anchorRef,
  displayName,
  studioName,
  showSignOut,
  busy,
  notice,
  noticeError,
  onOpenProjects,
  onOpenAssets,
  onOpenSettings,
  onSignOut,
  plan,
  onCapturePlan,
}: {
  open: boolean;
  onClose: () => void;
  anchorRef: RefObject<HTMLButtonElement>;
  displayName: string;
  studioName: string;
  showSignOut: boolean;
  busy: boolean;
  notice?: string;
  noticeError?: boolean;
  onOpenProjects: () => void;
  onOpenAssets: () => void;
  onOpenSettings: () => void;
  onSignOut: () => void;
  plan?: FeedbackPlanContext;
  onCapturePlan?: () => Promise<string | null> | string | null;
}): JSX.Element | null {
  const menuRef = useRef<HTMLDivElement>(null);
  const supportRef = useRef<HTMLDivElement>(null);
  const supportId = useId();
  const [supportOpen, setSupportOpen] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [box, setBox] = useState<{ left: number; bottom: number } | null>(null);

  useEffect(() => {
    if (!open) {
      setSupportOpen(false);
      return undefined;
    }
    const anchor = anchorRef.current;
    if (anchor) {
      const rect = anchor.getBoundingClientRect();
      setBox({ left: rect.right + 8, bottom: Math.max(8, window.innerHeight - rect.bottom) });
    }
    const onPointer = (event: MouseEvent) => {
      const target = event.target as Node;
      if (anchorRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      onClose();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      if (supportOpen) {
        event.preventDefault();
        event.stopPropagation();
        setSupportOpen(false);
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, onClose, anchorRef, supportOpen]);

  function openSupportItem(action: () => void): void {
    setSupportOpen(false);
    onClose();
    action();
  }

  const menu = open && box && typeof document !== 'undefined' ? createPortal(
    <div
      ref={menuRef}
      className="sc-account-menu"
      role="menu"
      aria-label="账户菜单"
      style={{ left: box.left, bottom: box.bottom }}
    >
      <div className="sc-account-menu-id">
        <strong>{displayName}</strong>
        {studioName ? <span>{studioName}</span> : null}
      </div>
      <button type="button" role="menuitem" onClick={() => { onClose(); onOpenProjects(); }}><FolderOpen size={15} aria-hidden="true"/>所有方案</button>
      <button type="button" role="menuitem" onClick={() => { onClose(); onOpenAssets(); }}><Images size={15} aria-hidden="true"/>物料</button>
      <button type="button" role="menuitem" onClick={() => { onClose(); onOpenSettings(); }}><Settings size={15} aria-hidden="true"/>设置</button>
      <div
        className="sc-account-menu-support"
        ref={supportRef}
        onMouseEnter={() => { if (hoverFine()) setSupportOpen(true); }}
        onMouseLeave={() => { if (hoverFine()) setSupportOpen(false); }}
      >
        <button
          type="button"
          role="menuitem"
          aria-haspopup="menu"
          aria-expanded={supportOpen}
          aria-controls={supportId}
          onClick={() => setSupportOpen(value => !value)}
          onKeyDown={event => {
            if (event.key !== 'ArrowRight') return;
            event.preventDefault();
            setSupportOpen(true);
            window.setTimeout(() => {
              supportRef.current?.querySelector<HTMLElement>('.sc-account-menu-flyout [role="menuitem"]')?.focus();
            }, 0);
          }}
        >
          <HelpCircle size={15} aria-hidden="true"/>支持
          <span className="sc-account-menu-caret" aria-hidden="true">›</span>
        </button>
        {supportOpen && (
          <div id={supportId} className="sc-account-menu-flyout" role="menu" aria-label="支持">
            <a role="menuitem" href={GUIDE_URL} target="_blank" rel="noopener noreferrer" onClick={() => { setSupportOpen(false); onClose(); }}>
              <BookOpen size={15} aria-hidden="true"/>新手指引
            </a>
            <button type="button" role="menuitem" onClick={() => openSupportItem(openShortcutCoach)}>
              <span className="sc-account-menu-kbd" aria-hidden="true">?</span>键盘快捷键
            </button>
            <button type="button" role="menuitem" onClick={() => openSupportItem(() => setFeedbackOpen(true))}>
              <MessageSquare size={15} aria-hidden="true"/>发送反馈
            </button>
            <button type="button" role="menuitem" onClick={() => openSupportItem(() => setAboutOpen(true))}>
              <Info size={15} aria-hidden="true"/>关于
            </button>
          </div>
        )}
      </div>
      {showSignOut && (
        <button type="button" role="menuitem" className="sc-account-menu-signout" disabled={busy} onClick={onSignOut}>
          <UserRound size={15} aria-hidden="true"/>退出登录
        </button>
      )}
      {notice ? <p className={noticeError ? 'sc-account-error' : 'sc-account-footnote'} role={noticeError ? 'alert' : 'status'}>{notice}</p> : null}
    </div>,
    document.body,
  ) : null;

  return <>
    {menu}
    <FeedbackDialog open={feedbackOpen} onClose={() => setFeedbackOpen(false)} {...(plan ? { plan } : {})} {...(onCapturePlan ? { onCapturePlan } : {})} />
    <AboutDialog open={aboutOpen} onClose={() => setAboutOpen(false)} />
  </>;
}
