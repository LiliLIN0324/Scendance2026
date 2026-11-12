'use client';

import { useRoomEditor } from '../contexts';
import { buildHeadingBadges, type HeadingBadgeTone } from '../lib/canvas-heading-badges';
import { getBriefHeadcount } from './brief-headcount-store';

const TONE_CLASS: Record<HeadingBadgeTone, string> = {
  ok: 'is-ok',
  warn: 'is-warn',
  pending: '',
};

function badgeClass(tone: HeadingBadgeTone): string {
  const modifier = TONE_CLASS[tone];
  return modifier ? `sc-canvas-heading-badge ${modifier}` : 'sc-canvas-heading-badge';
}

/**
 * 画布顶左浮标：只在 2D 平面时提示视图，并附容量 / 座位的软提示徽标；3D 维持原 null 行为。
 * 徽标仅作估算提示，不做硬闸门（不禁用按钮、不阻断导出 / 应用）。
 */
export function CanvasHeading({ view2D }: { view2D: boolean }) {
  const editor = useRoomEditor();

  if (!view2D) return null;

  const badges = buildHeadingBadges({
    layout: editor.layout,
    activeFloorIndex: editor.activeFloorIndex,
    headcount: getBriefHeadcount(),
  });

  return (
    <div className="sc-canvas-heading is-badge-stack">
      <span className="sc-canvas-kind">2D 平面</span>
      <span className="sc-canvas-heading-badges">
        <span className={badgeClass(badges.capacity.tone)}>{badges.capacity.text}</span>
        <span className={badgeClass(badges.seating.tone)}>{badges.seating.text}</span>
      </span>
    </div>
  );
}
