'use client';

import { useCallback, useEffect, useState, type RefObject } from 'react';
import { RAIL_PAPER, RAIL_SELECTED } from '@/components/solid-icons';
import { countOpenFeedbackPins, readBingoPlanFeedback } from '../lib/bingo-feedback';
import {
  bingoPhaseLabel,
  emptyBingoSnapshot,
  readBingoSnapshot,
  type BingoSnapshot,
} from '../lib/bingo-status';

/**
 * Bingo D4（2026-11-17 锁定，2026-11-18 选中改为反黑）。
 * 未选中：环与四枚工具标同一条墨线，1.65、圆端、`--ink-soft`。环在东北约 315° 开口，缺口约 58°。
 * 选中：整枚填成实心圆盘，中心留一枚纸色圆孔。不再靠左缘绿条。
 * 环身不改涂赭色或红色。语义色只做缺口里的一颗珠（未选中时珠坐在缺口里）。
 * 角度：0° 在东，顺时针；315° 即东北。
 */
export const BINGO_D4 = {
  stroke: 1.65,
  cx: 12,
  cy: 12,
  r: 9.05,
  gapCenterDeg: 315,
  gapDeg: 58,
  beadR: 2.55,
  /** 选中时圆盘中心的纸色孔。 */
  holeR: 3.6,
} as const;

function ringPoint(deg: number): { x: number; y: number } {
  const rad = (deg * Math.PI) / 180;
  return {
    x: BINGO_D4.cx + BINGO_D4.r * Math.cos(rad),
    y: BINGO_D4.cy + BINGO_D4.r * Math.sin(rad),
  };
}

/** 从缺口顺时针终点画到缺口起点，绕开东北那一截。 */
export function bingoRingPath(): string {
  const start = ringPoint(BINGO_D4.gapCenterDeg + BINGO_D4.gapDeg / 2);
  const end = ringPoint(BINGO_D4.gapCenterDeg - BINGO_D4.gapDeg / 2);
  const fmt = (n: number) => n.toFixed(2);
  return `M ${fmt(start.x)} ${fmt(start.y)} A ${BINGO_D4.r} ${BINGO_D4.r} 0 1 1 ${fmt(end.x)} ${fmt(end.y)}`;
}

export function bingoBeadCenter(): { cx: number; cy: number } {
  const at = ringPoint(BINGO_D4.gapCenterDeg);
  return { cx: Number(at.x.toFixed(2)), cy: Number(at.y.toFixed(2)) };
}

/** 圆内计数：0 不画；超过 9 收束为 9+。 */
function badgeCount(count: number): string {
  if (count <= 0) return '';
  return count > 9 ? '9+' : String(count);
}

/**
 * 左轨第二格：Bingo / 评审收藏。
 * 未选中是开口环。选中改成实心圆盘，中心留纸色孔，不再画左缘绿条。
 * 三态只改环内与珠：待发没有数字、勾、珠；待评环内写未回执链接数，一颗 warn 珠；
 * 已回执环内墨色勾，一颗 err 珠。不再用角标把计数说两遍。
 * 未读钉仍写进 aria-label / data-tip。圆体 28px。
 */
export function BingoRailButton({ open, onOpen, buttonRef }: {
  open: boolean;
  onOpen(): void;
  buttonRef?: RefObject<HTMLButtonElement>;
}): JSX.Element {
  const [snapshot, setSnapshot] = useState<BingoSnapshot>(emptyBingoSnapshot);

  const sync = useCallback(() => {
    setSnapshot(readBingoSnapshot(typeof window === 'undefined' ? null : window.localStorage));
  }, []);

  useEffect(() => {
    sync();
    window.addEventListener('storage', sync);
    window.addEventListener('focus', sync);
    document.addEventListener('visibilitychange', sync);
    return () => {
      window.removeEventListener('storage', sync);
      window.removeEventListener('focus', sync);
      document.removeEventListener('visibilitychange', sync);
    };
  }, [sync]);

  const storage = typeof window === 'undefined' ? null : window.localStorage;
  const plans = snapshot.plans;
  // L：尚未回执的评审链接份数；P：这些方案下未闭环画内钉总数。
  const linkCount = plans.filter(plan => !plan.returned).length;
  const pinCount = plans.reduce(
    (sum, plan) => sum + countOpenFeedbackPins(readBingoPlanFeedback(plan, storage)),
    0,
  );

  const phase = snapshot.phase;
  // 环内只留一个数：待评的未回执链接。未读钉不再画成第二枚角标。
  const shownCount = phase === 'awaiting' ? badgeCount(linkCount) : '';
  const bead = phase === 'awaiting' || phase === 'returned' ? bingoBeadCenter() : null;

  const labelParts = [bingoPhaseLabel(phase)];
  if (linkCount > 0) labelParts.push(`${linkCount} 份链接`);
  if (pinCount > 0) labelParts.push(`${pinCount} 条未读钉`);
  const label = `收反馈，${labelParts.join('，')}`;
  const tipParts = ['Bingo', bingoPhaseLabel(phase)];
  if (pinCount > 0) tipParts.push(`${pinCount} 条未读钉`);
  if (linkCount > 0) tipParts.push(`${linkCount} 份链接`);
  const tip = tipParts.join(' · ');

  return (
    <button
      ref={buttonRef}
      type="button"
      className={`sc-rail-bingo sc-rail-disc${open ? ' is-active' : ''}`}
      aria-pressed={open}
      aria-expanded={open}
      aria-label={label}
      data-tip={tip}
      onClick={onOpen}
    >
      <span
        className="sc-bingo-badge"
        data-status={phase}
        {...(bead ? { 'data-bead': phase === 'awaiting' ? 'warn' : 'err' } : {})}
        {...(shownCount ? { 'data-count': shownCount } : {})}
        aria-hidden="true"
      >
        <svg className="sc-bingo-mark" viewBox="0 0 24 24" width="28" height="28" fill="none" aria-hidden="true" focusable="false">
          {open ? (
            <>
              <circle cx={BINGO_D4.cx} cy={BINGO_D4.cy} r={BINGO_D4.r} fill={RAIL_SELECTED} />
              <circle data-mark="hole" cx={BINGO_D4.cx} cy={BINGO_D4.cy} r={BINGO_D4.holeR} fill={RAIL_PAPER} />
            </>
          ) : (
            <path
              d={bingoRingPath()}
              stroke="var(--ink-soft, #55585F)"
              strokeWidth={BINGO_D4.stroke}
              strokeLinecap="round"
            />
          )}
          {bead && (
            <circle
              cx={bead.cx}
              cy={bead.cy}
              r={BINGO_D4.beadR}
              fill={phase === 'awaiting' ? 'var(--warn, #96651F)' : 'var(--err, #B4443C)'}
            />
          )}
          {phase === 'returned' && (
            <path
              data-mark="check"
              d="M9.2 12.35 11.25 14.5 15.05 9.9"
              stroke="var(--ink, #141416)"
              strokeWidth={BINGO_D4.stroke}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}
          {shownCount && (
            <text
              x="12"
              y="12"
              textAnchor="middle"
              dominantBaseline="central"
              fill="var(--ink, #141416)"
              fontSize="8"
              fontWeight="600"
              fontFamily="inherit"
            >
              {shownCount}
            </text>
          )}
        </svg>
      </span>
      <span className="sc-rail-label" aria-hidden="true">Bingo</span>
    </button>
  );
}
