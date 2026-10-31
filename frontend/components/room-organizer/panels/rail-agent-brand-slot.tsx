'use client';

import type { RefObject } from 'react';
import { QingguangRailButton } from './qingguang-rail-button';
import { WorkbenchBrandToggle } from './workbench-brand-toggle';

/**
 * 左窄轨顶格：收起只露晴光头像；展开后同一格交叉淡入为幕景锁标（头像飞到对话头）。
 */
export function RailAgentBrandSlot({
  showBrand,
  showQingguang,
  navExpanded,
  qingguangPanelOpen,
  onToggleNav,
  onOpenQingguang,
  qingguangRailRef,
}: {
  showBrand: boolean;
  showQingguang: boolean;
  navExpanded: boolean;
  qingguangPanelOpen: boolean;
  onToggleNav(): void;
  onOpenQingguang(): void;
  qingguangRailRef: RefObject<HTMLButtonElement>;
}): JSX.Element {
  return (
    <div className="sc-rail-agent-brand-slot" data-rail-slot={showBrand ? 'brand' : 'qingguang'}>
      <div className={`sc-rail-slot-layer is-brand${showBrand ? ' is-on' : ''}`} aria-hidden={!showBrand}>
        <WorkbenchBrandToggle expanded={navExpanded} onToggle={onToggleNav} />
      </div>
      <div className={`sc-rail-slot-layer is-qingguang${showQingguang ? ' is-on' : ''}`} aria-hidden={!showQingguang}>
        <nav className="sc-mode-rail-top" aria-label="晴光">
          <QingguangRailButton
            buttonRef={qingguangRailRef}
            open={qingguangPanelOpen}
            onOpen={onOpenQingguang}
          />
        </nav>
      </div>
    </div>
  );
}
