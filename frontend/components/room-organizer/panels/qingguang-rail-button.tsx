'use client';

import type { RefObject } from 'react';
import { qingguangHeaderStatus, useAgent } from './agent-panel';

/**
 * 原「布置」图标那一格。只放晴光头像，打开旁边的对话面板，不切换模式。
 * 右下状态点与 Agent 面板头图同一套 tone，避免白点错位感。
 */
export const QINGGUANG_RAIL_MASCOT = '/assets/assistant/qingguang-3d-40.png';

export function QingguangRailButton({ open, onOpen, buttonRef }: {
  open: boolean;
  onOpen(): void;
  buttonRef?: RefObject<HTMLButtonElement>;
}): JSX.Element {
  const agent = useAgent();
  const mode = agent.callbacks.workbenchMode;
  const status = qingguangHeaderStatus(agent, mode);
  return (
    <button
      ref={buttonRef}
      type="button"
      className={`sc-rail-qingguang sc-rail-disc${open ? ' is-panel-open' : ''}`}
      aria-expanded={open}
      aria-label="晴光"
      data-tip="晴光"
      onClick={onOpen}
    >
      <img src={QINGGUANG_RAIL_MASCOT} alt="" width={28} height={28} draggable={false} />
      <span className={`sc-rail-qingguang-dot is-${status.tone}`} aria-hidden="true" />
    </button>
  );
}
