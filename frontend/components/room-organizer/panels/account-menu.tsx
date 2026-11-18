'use client';

import { BookOpen, FolderOpen, HelpCircle, Home, Images, Info, MessageSquare, Settings, UserRound } from '@/components/solid-icons';
import { useEffect, useId, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { AboutDialog } from './about-dialog';
import { FeedbackDialog, type FeedbackPlanContext } from './feedback-dialog';

const GUIDE_URL = '/guide';
const HOME_URL = '/introduction';
const GITHUB_URL = 'https://github.com/LiliLIN0324/Scendance2026';

function GithubMark(): JSX.Element {
  return <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true" fill="currentColor"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>;
}

export function openShortcutCoach(): void {
  window.dispatchEvent(new Event('scendance:open-shortcut-coach'));
}

function hoverFine(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(hover: hover) and (pointer: fine)').matches;
}

export interface FlyoutBox {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

/** 支持子列表从锚点向上展开，并收进视口，避免贴着窗口底边被裁掉。 */
export function placeSupportFlyout(
  anchor: FlyoutBox,
  size: { width: number; height: number },
  viewport: { width: number; height: number },
  margin = 8,
  gap = 6,
): { top: number; left: number; maxHeight: number } {
  const maxHeight = Math.max(0, viewport.height - margin * 2);
  const height = Math.min(Math.max(size.height, 0), maxHeight);
  let top = anchor.bottom - height;
  const minTop = margin;
  const maxTop = Math.max(margin, viewport.height - margin - height);
  if (top < minTop) top = minTop;
  if (top > maxTop) top = maxTop;
  let left = anchor.right + gap;
  if (left + size.width > viewport.width - margin) left = anchor.left - gap - size.width;
  if (left < margin) left = margin;
  return { top, left, maxHeight };
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
  const flyoutRef = useRef<HTMLDivElement>(null);
  const supportButtonRef = useRef<HTMLButtonElement>(null);
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

  useLayoutEffect(() => {
    if (!open || !supportOpen) return undefined;
    const flyout = flyoutRef.current;
    const row = supportRef.current;
    if (!flyout || !row) return undefined;
    const place = () => {
      const next = placeSupportFlyout(
        row.getBoundingClientRect(),
        { width: flyout.offsetWidth, height: flyout.scrollHeight },
        { width: window.innerWidth, height: window.innerHeight },
      );
      flyout.style.position = 'fixed';
      flyout.style.top = `${next.top}px`;
      flyout.style.left = `${next.left}px`;
      flyout.style.right = 'auto';
      flyout.style.bottom = 'auto';
      flyout.style.maxHeight = `${next.maxHeight}px`;
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [open, supportOpen]);

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
          ref={supportButtonRef}
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
          <div
            id={supportId}
            ref={flyoutRef}
            className="sc-account-menu-flyout"
            role="menu"
            aria-label="支持"
            onKeyDown={event => {
              const items = Array.from(flyoutRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
              const index = items.indexOf(document.activeElement as HTMLElement);
              if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault();
                const delta = event.key === 'ArrowDown' ? 1 : -1;
                const next = items[index + delta];
                (next ?? items[index] ?? items[0])?.focus();
                return;
              }
              if (event.key === 'ArrowLeft') {
                event.preventDefault();
                setSupportOpen(false);
                supportButtonRef.current?.focus();
              }
            }}
          >
            <a role="menuitem" href={GUIDE_URL} target="_blank" rel="noopener noreferrer" onClick={() => { setSupportOpen(false); onClose(); }}>
              <BookOpen size={15} aria-hidden="true"/>新手指引
            </a>
            <a role="menuitem" href={HOME_URL} onClick={() => { setSupportOpen(false); onClose(); }}>
              <Home size={15} aria-hidden="true"/>产品官网
            </a>
            <a role="menuitem" href={GITHUB_URL} target="_blank" rel="noopener noreferrer" onClick={() => { setSupportOpen(false); onClose(); }}>
              <GithubMark/>GitHub 仓库
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
