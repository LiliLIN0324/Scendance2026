import type { RefObject } from 'react';
import { navToggleLabel } from '../lib/nav-chrome';
import { RailAvatar } from './rail-avatar';
import { RailLaneDot } from './rail-lane-dot';

/**
 * 工作台 logo。点一下收起或展开左侧导航。
 * 左轨四形与 Bingo / 空间 / 物料同一套手绘形体，门厅画成带拱形开口的门洞。
 * 活动那格常驻：状态点一直亮着（在线），出错才爆红。
 */
export function WorkbenchBrandToggle({ expanded, active = false, onToggle, buttonRef }: {
  expanded: boolean;
  active?: boolean;
  onToggle(): void;
  buttonRef?: RefObject<HTMLButtonElement>;
}): JSX.Element {
  const label = navToggleLabel(expanded);
  return (
    <button
      ref={buttonRef}
      type="button"
      className={`sc-nav-brand is-mark${active ? ' is-active' : ''}`}
      aria-expanded={expanded}
      aria-controls="workbench-nav-column"
      aria-label={label}
      data-tip={label}
      onClick={onToggle}
    >
      <span className="sc-brand-mark"><RailAvatar form="door" size={28} /><RailLaneDot lane="door"/></span>
      <span className="sc-rail-label" aria-hidden="true">总控</span>
    </button>
  );
}
