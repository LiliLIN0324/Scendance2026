'use client';

import { useRef, type RefObject } from 'react';
import { RailHall } from '@/components/solid-icons';
import { navToggleLabel } from '../lib/nav-chrome';
import { useEyeFollow } from './rail-avatar';

/**
 * 工作台左轨顶格。点击仍走调用方传入的 onToggle。
 * 图形是始终实心的门厅脸：圆角方块、两只不对称眼镂空、底部门洞。
 * 眼洞跟着指针微移，整张脸轻微侧倾；洞是纸色空隙，不画瞳孔。
 * 选中只靠图标自己：门厅不反黑，也不在脸的右下角加句点。
 * 眼洞跟着指针微移，整张脸轻微侧倾；洞是纸色空隙，不画瞳孔。
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
      <span className="sc-brand-mark"><RailHall size={28} ref={faceRef} /></span>
      <span className="sc-rail-label" aria-hidden="true">总控</span>
    </button>
  );
}
