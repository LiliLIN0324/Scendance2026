'use client';

import { useRef, type RefObject } from 'react';
import { RailHall } from '@/components/solid-icons';
import { useEyeFollow } from './rail-avatar';

/**
 * 工作台左轨顶格，对应四条车道里的「活动」（内部 id 沿用 door）。
 * 图形是始终实心的门厅脸：圆角方块、两只不对称眼镂空、底部门洞。
 * 眼洞跟着指针微移，整张脸轻微侧倾；洞是纸色空隙，不画瞳孔。
 * 选中只靠图标自己：门厅不反黑，也不在脸的右下角加句点。
 *
 * 三态：open=车道卡占栏；retained=车道卡被创作/消息/私信等占栏盖住，底层仍保留，
 * 点按是切回该车道；空态=从没打开。retained 用描边环和空钮区分，避免看不出点下去是开还是关。
 */
export function WorkbenchBrandToggle({ open = false, retained = false, onToggle, buttonRef }: {
  open?: boolean;
  retained?: boolean;
  onToggle(): void;
  buttonRef?: RefObject<HTMLButtonElement>;
}): JSX.Element {
  const faceRef = useRef<HTMLSpanElement>(null);
  useEyeFollow(faceRef);
  const label = open ? '收起 活动' : retained ? '活动：切回当前对话' : '打开 活动';
  return (
    <button
      ref={buttonRef}
      type="button"
      className={`sc-nav-brand is-mark${open ? ' is-active' : retained ? ' is-retained' : ''}`}
      aria-pressed={open || retained}
      aria-expanded={open}
      aria-controls="agent-panel"
      aria-label={label}
      data-tip={label}
      onClick={onToggle}
    >
      <span className="sc-brand-mark"><RailHall size={28} ref={faceRef} /></span>
      <span className="sc-rail-label" aria-hidden="true">总控</span>
    </button>
  );
}
