'use client';

import { BookOpen, Check, Crown, FolderOpen, HelpCircle, Home, Images, Info, MessageSquare, Palette, Settings, UserRound, UsersRound } from '@/components/solid-icons';
import { useEffect, useId, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { APPEARANCE_LABELS, APPEARANCE_MODE_ORDER, type AppearanceMode } from '../lib/appearance';
import { AboutDialog } from './about-dialog';
import { FeedbackDialog, type FeedbackPlanContext } from './feedback-dialog';
import { openUpgradeModal, UpgradeModalMount } from '@/components/pay/upgrade-modal';

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

/**
 * 「支持」行与子列表之间有 6px 视觉间隙。鼠标横移穿过间隙时既不在行内、也不在面板内，
 * hover 被打断，面板当场卸载——表现就是「来不及移过去就消失」。
 * 这里补一块透明热区跨过间隙：横向只盖住间隙（两侧各多搭 `bite` 像素，避免亚像素裂缝），
 * 纵向取行与面板的并集，于是从行到面板的路径始终落在同一个 hover 子树里。
 */
export function gapBridge(anchor: FlyoutBox, flyout: FlyoutBox, bite = 1): FlyoutBox | null {
  const opensRight = flyout.left >= anchor.right;
  const opensLeft = flyout.right <= anchor.left;
  if (!opensRight && !opensLeft) return null;
  const left = opensRight ? anchor.right - bite : flyout.right;
  const right = opensRight ? flyout.left + bite : anchor.left + bite;
  if (right <= left) return null;
  return {
    left,
    right,
    top: Math.min(anchor.top, flyout.top),
    bottom: Math.max(anchor.bottom, flyout.bottom),
  };
}

/** 悬停移出后留一点时间给指针穿缝；零点几秒内重新进入即取消关闭。 */
const HOVER_CLOSE_DELAY = 160;

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
  onOpenTeam,
  onOpenSettings,
  onSignOut,
  appearanceMode,
  onAppearanceModeChange,
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
  onOpenTeam: () => void;
  onOpenSettings: () => void;
  onSignOut: () => void;
  appearanceMode?: AppearanceMode;
  onAppearanceModeChange?: (mode: AppearanceMode) => void;
  plan?: FeedbackPlanContext;
  onCapturePlan?: () => Promise<string | null> | string | null;
}): JSX.Element | null {
  const menuRef = useRef<HTMLDivElement>(null);
  const supportRowRef = useRef<HTMLDivElement>(null);
  const supportFlyoutRef = useRef<HTMLDivElement>(null);
  const supportBridgeRef = useRef<HTMLDivElement>(null);
  const supportButtonRef = useRef<HTMLButtonElement>(null);
  const appearanceRowRef = useRef<HTMLDivElement>(null);
  const appearanceFlyoutRef = useRef<HTMLDivElement>(null);
  const appearanceBridgeRef = useRef<HTMLDivElement>(null);
  const appearanceButtonRef = useRef<HTMLButtonElement>(null);
  const closeTimerRef = useRef<number | null>(null);
  const supportId = useId();
  const appearanceId = useId();
  const [openMenu, setOpenMenu] = useState<null | 'support' | 'appearance'>(null);
  const supportOpen = openMenu === 'support';
  const appearanceOpen = openMenu === 'appearance';
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [box, setBox] = useState<{ left: number; bottom: number } | null>(null);

  function cancelClose(): void {
    if (closeTimerRef.current === null) return;
    window.clearTimeout(closeTimerRef.current);
    closeTimerRef.current = null;
  }

  function scheduleClose(): void {
    cancelClose();
    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = null;
      setOpenMenu(null);
    }, HOVER_CLOSE_DELAY);
  }

  useEffect(() => () => {
    if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current);
  }, []);

  useEffect(() => {
    if (!open) {
      cancelClose();
      setOpenMenu(null);
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
      if (openMenu) {
        event.preventDefault();
        event.stopPropagation();
        setOpenMenu(null);
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
  }, [open, onClose, anchorRef, openMenu]);

  useLayoutEffect(() => {
    if (!open || !openMenu) return undefined;
    const row = openMenu === 'support' ? supportRowRef.current : appearanceRowRef.current;
    const flyout = openMenu === 'support' ? supportFlyoutRef.current : appearanceFlyoutRef.current;
    const bridge = openMenu === 'support' ? supportBridgeRef.current : appearanceBridgeRef.current;
    if (!flyout || !row) return undefined;
    const place = () => {
      const size = { width: flyout.offsetWidth, height: flyout.scrollHeight };
      const anchor = row.getBoundingClientRect();
      const next = placeSupportFlyout(
        anchor,
        size,
        { width: window.innerWidth, height: window.innerHeight },
      );
      flyout.style.position = 'fixed';
      flyout.style.top = `${next.top}px`;
      flyout.style.left = `${next.left}px`;
      flyout.style.right = 'auto';
      flyout.style.bottom = 'auto';
      flyout.style.maxHeight = `${next.maxHeight}px`;
      if (!bridge) return;
      const patch = gapBridge(anchor, {
        top: next.top,
        bottom: next.top + Math.min(size.height, next.maxHeight),
        left: next.left,
        right: next.left + size.width,
      });
      if (!patch) {
        bridge.style.display = 'none';
        return;
      }
      bridge.style.display = 'block';
      bridge.style.top = `${patch.top}px`;
      bridge.style.left = `${patch.left}px`;
      bridge.style.width = `${patch.right - patch.left}px`;
      bridge.style.height = `${patch.bottom - patch.top}px`;
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [open, openMenu]);

  function openSupportItem(action: () => void): void {
    setOpenMenu(null);
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
      <button type="button" role="menuitem" onClick={() => { onClose(); onOpenTeam(); }}><UsersRound size={15} aria-hidden="true"/>团队</button>
      <button type="button" role="menuitem" onClick={() => openSupportItem(openUpgradeModal)}><Crown size={15} aria-hidden="true"/>会员与升级</button>
      <button type="button" role="menuitem" onClick={() => { onClose(); onOpenSettings(); }}><Settings size={15} aria-hidden="true"/>设置</button>
      {onAppearanceModeChange ? (
        <div
          className="sc-account-menu-appearance"
          ref={appearanceRowRef}
          onMouseEnter={() => { if (!hoverFine()) return; cancelClose(); setOpenMenu('appearance'); }}
          onMouseLeave={() => { if (hoverFine()) scheduleClose(); }}
        >
          <button
            ref={appearanceButtonRef}
            type="button"
            role="menuitem"
            aria-haspopup="menu"
            aria-expanded={appearanceOpen}
            aria-controls={appearanceId}
            onClick={() => setOpenMenu(openMenu === 'appearance' ? null : 'appearance')}
            onKeyDown={event => {
              if (event.key !== 'ArrowRight') return;
              event.preventDefault();
              setOpenMenu('appearance');
              window.setTimeout(() => {
                appearanceRowRef.current?.querySelector<HTMLElement>('.sc-account-menu-flyout [role="menuitem"]')?.focus();
              }, 0);
            }}
          >
            <Palette size={15} aria-hidden="true"/>外观
            <span className="sc-account-menu-caret" aria-hidden="true">›</span>
          </button>
          {appearanceOpen && <div ref={appearanceBridgeRef} className="sc-account-menu-bridge" aria-hidden="true" />}
          {appearanceOpen && (
            <div
              id={appearanceId}
              ref={appearanceFlyoutRef}
              className="sc-account-menu-flyout"
              role="menu"
              aria-label="外观模式"
              onMouseEnter={cancelClose}
              onKeyDown={event => {
                const items = Array.from(appearanceFlyoutRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
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
                  setOpenMenu(null);
                  appearanceButtonRef.current?.focus();
                }
              }}
            >
              {APPEARANCE_MODE_ORDER.map(mode => (
                <button
                  key={mode}
                  type="button"
                  role="menuitemradio"
                  aria-checked={appearanceMode === mode}
                  className={appearanceMode === mode ? 'is-active' : ''}
                  onClick={() => onAppearanceModeChange(mode)}
                >
                  <span>{APPEARANCE_LABELS[mode]}</span>
                  {appearanceMode === mode ? <Check size={16} aria-hidden="true"/> : null}
                </button>
              ))}
            </div>
          )}
        </div>
      ) : null}
      <div
        className="sc-account-menu-support"
        ref={supportRowRef}
        onMouseEnter={() => { if (!hoverFine()) return; cancelClose(); setOpenMenu('support'); }}
        onMouseLeave={() => { if (hoverFine()) scheduleClose(); }}
      >
        <button
          ref={supportButtonRef}
          type="button"
          role="menuitem"
          aria-haspopup="menu"
          aria-expanded={supportOpen}
          aria-controls={supportId}
          onClick={() => setOpenMenu(openMenu === 'support' ? null : 'support')}
          onKeyDown={event => {
            if (event.key !== 'ArrowRight') return;
            event.preventDefault();
            setOpenMenu('support');
            window.setTimeout(() => {
              supportRowRef.current?.querySelector<HTMLElement>('.sc-account-menu-flyout [role="menuitem"]')?.focus();
            }, 0);
          }}
        >
          <HelpCircle size={15} aria-hidden="true"/>支持
          <span className="sc-account-menu-caret" aria-hidden="true">›</span>
        </button>
        {supportOpen && <div ref={supportBridgeRef} className="sc-account-menu-bridge" aria-hidden="true" />}
        {supportOpen && (
          <div
            id={supportId}
            ref={supportFlyoutRef}
            className="sc-account-menu-flyout"
            role="menu"
            aria-label="支持"
            onMouseEnter={cancelClose}
            onKeyDown={event => {
              const items = Array.from(supportFlyoutRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
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
                setOpenMenu(null);
                supportButtonRef.current?.focus();
              }
            }}
          >
            <a role="menuitem" href={GUIDE_URL} target="_blank" rel="noopener noreferrer" onClick={() => { setOpenMenu(null); onClose(); }}>
              <BookOpen size={15} aria-hidden="true"/>新手指引
            </a>
            <a role="menuitem" href={HOME_URL} onClick={() => { setOpenMenu(null); onClose(); }}>
              <Home size={15} aria-hidden="true"/>产品官网
            </a>
            <a role="menuitem" href={GITHUB_URL} target="_blank" rel="noopener noreferrer" onClick={() => { setOpenMenu(null); onClose(); }}>
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
    <UpgradeModalMount />
  </>;
}
