import { RailHall } from '@/components/solid-icons';
import { navToggleLabel } from '../lib/nav-chrome';
import { RailLaneDot } from './rail-lane-dot';
import type { RefObject } from 'react';

/**
 * 工作台左轨顶格。点击仍走调用方传入的 onToggle。
 * 图形是始终实心的门厅脸：圆角方块、两只不对称眼镂空、底部门洞。
 * 选中只靠左缘绿条，不把门洞闭上，也不把脸改成线框。
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
      <span className="sc-brand-mark"><RailHall size={28} /><RailLaneDot lane="door"/></span>
      <span className="sc-rail-label" aria-hidden="true">总控</span>
    </button>
  );
}
