'use client';

import { useRef, type RefObject } from 'react';
import { RailHall } from '@/components/solid-icons';
import { navToggleLabel } from '../lib/nav-chrome';
import { useEyeFollow } from './rail-avatar';
import { RailLaneDot } from './rail-lane-dot';

/**
 * 工作台左轨顶格。点击仍走调用方传入的 onToggle。
 * 图形是始终实心的门厅脸：圆角方块、两只不对称眼镂空、底部门洞。
 * 眼洞跟着指针微移，整张脸轻微侧倾；洞是纸色空隙，不画瞳孔。
 * 选中只靠左缘绿条，不把门洞闭上，也不把脸改成线框。
 * 活动那格常驻：状态点一直亮着（在线），出错才爆红。
 */
export function WorkbenchBrandToggle({ expanded, active = false, onToggle, buttonRef }: {
  expanded: boolean;
  active?: boolean;
  onToggle(): void;
  buttonRef?: RefObject<HTMLButtonElement>;
}): JSX.Element {
  const faceRef = useRef<HTMLSpanElement>(null);
  useEyeFollow(faceRef);
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
      <span className="sc-brand-mark"><RailHall size={28} ref={faceRef} /><RailLaneDot lane="door"/></span>
      <span className="sc-rail-label" aria-hidden="true">总控</span>
    </button>
  );
}
