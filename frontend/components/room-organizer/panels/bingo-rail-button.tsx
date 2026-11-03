'use client';

import type { RefObject } from 'react';
import { bingoHeaderStatus, useAgent } from './agent-panel';
import { RailAvatar } from './rail-avatar';
import { RailLaneDot } from './rail-lane-dot';

/**
 * 左轨第二格：球的形体，打开旁边的 Bingo 对话，不切换模式。
 * 右下状态点与对话头同一套 tone：没事干是休眠（灰），面板开着就是醒着。
 */
export function BingoRailButton({ open, onOpen, buttonRef }: {
  open: boolean;
  onOpen(): void;
  buttonRef?: RefObject<HTMLButtonElement>;
}): JSX.Element {
  const agent = useAgent();
  const mode = agent.callbacks.workbenchMode;
  const status = bingoHeaderStatus(agent, mode);
  const tone = status.tone === 'idle' ? (open ? 'ok' : 'idle') : status.tone;
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
      <RailLaneDot lane="bingo" open={open} tone={tone}/>
    </button>
  );
}
