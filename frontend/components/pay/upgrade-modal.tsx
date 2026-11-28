'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { MembershipPlans } from './membership-plans';
import './upgrade-modal.css';

export const UPGRADE_MODAL_EVENT = 'scendance:open-upgrade-modal';

/** 任意位置一键拉起升级弹窗（与 openShortcutCoach 同一套全局事件约定）。 */
export function openUpgradeModal(): void {
  window.dispatchEvent(new Event(UPGRADE_MODAL_EVENT));
}

/**
 * OnePlan 式升级弹窗：编辑器内居中浮层，左定价右产品实景，不是全屏页。
 * 定价与结账直接内嵌 MembershipPlans（modal 变体），入口由各处 dispatch 事件拉起。
 */
export function UpgradeModalMount(): JSX.Element {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const onOpen = () => setOpen(true);
    window.addEventListener(UPGRADE_MODAL_EVENT, onOpen);
    return () => window.removeEventListener(UPGRADE_MODAL_EVENT, onOpen);
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      event.stopPropagation();
      setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  if (!mounted || !open) return <></>;

  return createPortal(
    <div className="upm-overlay" onClick={() => setOpen(false)}>
      <section
        className="upm"
        role="dialog"
        aria-modal="true"
        aria-label="升级幕景会员"
        onClick={event => event.stopPropagation()}
      >
        <button type="button" className="upm-close" aria-label="关闭" onClick={() => setOpen(false)}>
          ✕
        </button>
        <div className="upm-main">
          <header className="upm-head">
            <h2 className="upm-title">升级幕景会员</h2>
            <p className="upm-lead">订阅管持续做方案的能力；重建次数是算力，单独加购。</p>
          </header>
          <MembershipPlans variant="modal" />
        </div>
        <aside className="upm-aside" aria-hidden="true">
          <div className="upm-shot">
            <div className="upm-shot-bar"><i /><i /><i /></div>
            <svg viewBox="0 0 300 210" width="100%" height="200" role="presentation">
              <rect x="0" y="0" width="300" height="210" fill="#F4F5F7" />
              <path d="M14 16 H286 V194 H14 Z" fill="#FFFFFF" stroke="#E4E4E7" strokeWidth="1" />
              <rect x="30" y="34" width="70" height="56" fill="#EEF3EF" stroke="#35624A" strokeWidth="1.4" />
              <rect x="112" y="34" width="76" height="56" fill="#EEF3EF" stroke="#35624A" strokeWidth="1.4" />
              <rect x="200" y="34" width="70" height="56" fill="#ECEDEF" stroke="#A6AAB2" strokeWidth="1.4" />
              <rect x="30" y="106" width="240" height="52" fill="#FFFFFF" opacity="0.7" />
              <g fill="#141416">
                <circle cx="60" cy="132" r="7" /><circle cx="120" cy="132" r="7" />
                <circle cx="180" cy="132" r="7" /><circle cx="240" cy="132" r="7" />
              </g>
              <g stroke="#141416" strokeWidth="2.2" fill="none">
                <path d="M46 60 H130 V150 H250" />
              </g>
              <g fill="#141416">
                <path d="M252 150 l-8 -5 v10 z" />
              </g>
              <circle cx="150" cy="132" r="4" fill="#141416" />
              <g stroke="#A6AAB2" strokeWidth="1">
                <path d="M14 186 H74" /><path d="M14 182 v8" /><path d="M74 182 v8" />
              </g>
              <text x="80" y="190" fontSize="9" fill="#71767E" fontFamily="sans-serif">20 m</text>
              <g fill="#55585F" fontSize="9" fontFamily="sans-serif">
                <text x="46" y="60">舞台</text><text x="130" y="60">主舞台</text><text x="216" y="60">签到</text>
              </g>
            </svg>
            <p className="upm-shot-cap">导入平面图后，2D 里摆位、3D 里出图</p>
          </div>
        </aside>
      </section>
    </div>,
    document.body,
  );
}
