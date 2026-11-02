'use client';

import type { RefObject } from 'react';
import { bingoHeaderStatus, useAgent } from './agent-panel';
import { RailAvatar } from './rail-avatar';

/**
 * 左轨第二格：球的形体，打开旁边的 Bingo 对话，不切换模式。
 * 右下状态点与对话头同一套 tone。
 */
export function BingoRailButton({ open, onOpen, buttonRef }: {
  open: boolean;
  onOpen(): void;
  buttonRef?: RefObject<HTMLButtonElement>;
}): JSX.Element {
  const agent = useAgent();
  const mode = agent.callbacks.workbenchMode;
  const status = bingoHeaderStatus(agent, mode);
  return (
    <button
      ref={buttonRef}
      type="button"
      className={`sc-rail-bingo sc-rail-disc${open ? ' is-active' : ''}`}
      aria-expanded={open}
      aria-label="Bingo"
      data-tip="Bingo"
      onClick={onOpen}
    >
      <RailAvatar form="ball" size={28} />
      <span className={`sc-rail-bingo-dot is-${status.tone}`} aria-hidden="true" />
    </button>
  );
}
