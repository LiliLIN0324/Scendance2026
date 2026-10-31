'use client';

import { useRef } from 'react';
import { LEFT_CARD_WIDTH_MAX, LEFT_CARD_WIDTH_MIN, clampLeftCardWidth } from '../lib/left-card-width';

/** 左栏右缘一条细线。指针按在线上，不落到画布，所以不会把 3D 转起来。 */
export function LeftCardResizer({ width, onWidth, onDragging }: {
  width: number;
  onWidth(next: number): void;
  onDragging(active: boolean): void;
}): JSX.Element {
  const drag = useRef<{ pointerId: number; startX: number; startW: number } | null>(null);
  const end = (node: HTMLElement, pointerId: number) => {
    if (!drag.current) return;
    drag.current = null;
    onDragging(false);
    try { node.releasePointerCapture(pointerId); } catch { /* already released */ }
  };
  return <div
    role="separator"
    aria-orientation="vertical"
    aria-label="调整左栏宽度"
    aria-valuemin={LEFT_CARD_WIDTH_MIN}
    aria-valuemax={LEFT_CARD_WIDTH_MAX}
    aria-valuenow={width}
    tabIndex={0}
    className="sc-left-card-resizer"
    onPointerDown={event => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      event.currentTarget.setPointerCapture(event.pointerId);
      drag.current = { pointerId: event.pointerId, startX: event.clientX, startW: width };
      onDragging(true);
    }}
    onPointerMove={event => {
      const session = drag.current;
      if (!session || session.pointerId !== event.pointerId) return;
      event.preventDefault();
      onWidth(clampLeftCardWidth(session.startW + (event.clientX - session.startX)));
    }}
    onPointerUp={event => end(event.currentTarget, event.pointerId)}
    onPointerCancel={event => end(event.currentTarget, event.pointerId)}
    onKeyDown={event => {
      const step = event.shiftKey ? 24 : 8;
      if (event.key === 'ArrowRight') { event.preventDefault(); onWidth(clampLeftCardWidth(width + step)); }
      if (event.key === 'ArrowLeft') { event.preventDefault(); onWidth(clampLeftCardWidth(width - step)); }
    }}
  />;
}
