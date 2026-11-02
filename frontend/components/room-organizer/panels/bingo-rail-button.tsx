'use client';

import type { RefObject } from 'react';
import { bingoHeaderStatus, useAgent } from './agent-panel';
import { BingoGlyph } from './rail-glyphs';

/** 对话顶栏与画布浮标共用的 Bingo 切图；左轨只放形体，不再放头像。 */
export const BINGO_MASCOT = '/assets/assistant/qingguang-3d-40.png';

/**
 * 左轨第二格：圆环形体，打开旁边的 Bingo 对话，不切换模式。
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
      <BingoGlyph />
      <span className={`sc-rail-bingo-dot is-${status.tone}`} aria-hidden="true" />
    </button>
  );
}
