'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { BingoPhase } from '../lib/bingo-status';

/**
 * Bingo D4（2026-11-18 锁定的状态圈）。
 * 墨色细线，东北开口。环身不涂雪绿、赭石或红。
 * 角度：0° 在东，顺时针；315° 即东北。
 * 送出中只是瞬时转动，不是新的存储状态。
 */
export const BINGO_D4 = {
  stroke: 1.65,
  cx: 12,
  cy: 12,
  r: 9.05,
  gapCenterDeg: 315,
  gapDeg: 58,
  beadR: 2.55,
} as const;

export const BINGO_SPIN_PERIOD_MS = 1200;
export const BINGO_RECEIPT_PAUSE_MS = 200;
export const BINGO_RECEIPT_CLOSE_MS = 200;
/** 满环之后再出勾，中间留一拍，避免勾和缺口叠在同一帧。 */
export const BINGO_RECEIPT_SEAL_MS = 80;

export const BINGO_SENDING_EVENT = 'scendance:bingo-sending';

const RING = 'var(--ink-soft, #55585F)';
const BEAD = 'var(--warn, #96651F)';
const INK = 'var(--ink, #141416)';
const CHECK_D = 'M9.2 12.35 11.25 14.5 15.05 9.9';

export type BingoVisual = 'to-send' | 'sending' | 'awaiting' | 'returned';
export type BingoPoseStep = 'hold' | 'spin' | 'decel' | 'pause' | 'closing' | 'closed' | 'check';

export interface BingoPose {
  angle: number;
  gap: number;
  beadOpacity: number;
  check: boolean;
  step: BingoPoseStep;
}

export interface BingoReceiptPose {
  gap: number;
  beadOpacity: number;
  check: boolean;
  step: 'pause' | 'closing' | 'closed' | 'check';
}

function ringPoint(deg: number): { x: number; y: number } {
  const rad = (deg * Math.PI) / 180;
  return {
    x: BINGO_D4.cx + BINGO_D4.r * Math.cos(rad),
    y: BINGO_D4.cy + BINGO_D4.r * Math.sin(rad),
  };
}

/** 从缺口顺时针终点画到缺口起点，绕开东北那一截。gapDeg 用来收口。 */
export function bingoArcPath(gapDeg: number = BINGO_D4.gapDeg): string {
  const gap = Math.min(359.2, Math.max(0, gapDeg));
  const start = ringPoint(BINGO_D4.gapCenterDeg + gap / 2);
  const end = ringPoint(BINGO_D4.gapCenterDeg - gap / 2);
  const fmt = (n: number) => n.toFixed(2);
  return `M ${fmt(start.x)} ${fmt(start.y)} A ${BINGO_D4.r} ${BINGO_D4.r} 0 1 1 ${fmt(end.x)} ${fmt(end.y)}`;
}

export function bingoRingPath(): string {
  return bingoArcPath(BINGO_D4.gapDeg);
}

export function bingoBeadCenter(): { cx: number; cy: number } {
  const at = ringPoint(BINGO_D4.gapCenterDeg);
  return { cx: Number(at.x.toFixed(2)), cy: Number(at.y.toFixed(2)) };
}

/** 圆内计数：0 不画；超过 9 收束为 9+。 */
export function bingoBadgeCount(count: number): string {
  if (count <= 0) return '';
  return count > 9 ? '9+' : String(count);
}

/** 已回执压过转动。转动压过待发和待评。 */
export function bingoVisual(phase: BingoPhase, sending: boolean): BingoVisual {
  if (phase === 'returned') return 'returned';
  if (sending) return 'sending';
  if (phase === 'awaiting') return 'awaiting';
  return 'to-send';
}

export function bingoVisualLabel(visual: BingoVisual): string {
  if (visual === 'returned') return '已回执';
  if (visual === 'sending') return '送出中';
  if (visual === 'awaiting') return '待评';
  return '待发';
}

/** 匀速，一秒多一圈。同一时间间隔转过的角度相同。 */
export function bingoSpinAngle(elapsedMs: number, originDeg = 0): number {
  const turns = elapsedMs / BINGO_SPIN_PERIOD_MS;
  const raw = originDeg + turns * 360;
  return ((raw % 360) + 360) % 360;
}

function easeOutCubic(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return 1 - (1 - x) ** 3;
}

/** 顺着当前转向，转到下一个东北开口。不倒转。 */
export function bingoForwardDelta(fromDeg: number): number {
  const from = ((fromDeg % 360) + 360) % 360;
  return from === 0 ? 0 : 360 - from;
}

export function bingoDecelDuration(deltaDeg: number): number {
  if (deltaDeg <= 0) return 0;
  return Math.min(700, Math.max(240, (deltaDeg / 300) * 1000));
}

export function bingoDecel(fromDeg: number, elapsedMs: number): { angle: number; done: boolean } {
  const from = ((fromDeg % 360) + 360) % 360;
  const delta = bingoForwardDelta(from);
  if (delta === 0) return { angle: 0, done: true };
  const ms = bingoDecelDuration(delta);
  if (elapsedMs >= ms) return { angle: 0, done: true };
  const angle = from + delta * easeOutCubic(elapsedMs / ms);
  return { angle: ((angle % 360) + 360) % 360, done: false };
}

/**
 * 已回执：停在当前角度。数字由调用方先拿掉。
 * 暂停（开口环 + 珠）→ 约 0.2 秒收口、珠淡出 → 满环无珠 → 墨色勾。
 */
export function bingoReceiptPose(elapsedMs: number): BingoReceiptPose {
  const t = Math.max(0, elapsedMs);
  if (t < BINGO_RECEIPT_PAUSE_MS) {
    return { gap: BINGO_D4.gapDeg, beadOpacity: 1, check: false, step: 'pause' };
  }
  const closeT = t - BINGO_RECEIPT_PAUSE_MS;
  if (closeT < BINGO_RECEIPT_CLOSE_MS) {
    const eased = 1 - (1 - closeT / BINGO_RECEIPT_CLOSE_MS) ** 2;
    return {
      gap: BINGO_D4.gapDeg * (1 - eased),
      beadOpacity: 1 - eased,
      check: false,
      step: 'closing',
    };
  }
  const sealed = closeT - BINGO_RECEIPT_CLOSE_MS;
  if (sealed < BINGO_RECEIPT_SEAL_MS) {
    return { gap: 0, beadOpacity: 0, check: false, step: 'closed' };
  }
  return { gap: 0, beadOpacity: 0, check: true, step: 'check' };
}

export function settledBingoPose(visual: BingoVisual, reduced: boolean): BingoPose {
  if (visual === 'returned' && reduced) {
    return { angle: 0, gap: BINGO_D4.gapDeg, beadOpacity: 0, check: false, step: 'hold' };
  }
  if (visual === 'returned') {
    return { angle: 0, gap: 0, beadOpacity: 0, check: true, step: 'check' };
  }
  if (visual === 'awaiting') {
    return { angle: 0, gap: BINGO_D4.gapDeg, beadOpacity: 1, check: false, step: 'hold' };
  }
  return { angle: 0, gap: BINGO_D4.gapDeg, beadOpacity: 0, check: false, step: visual === 'sending' && !reduced ? 'spin' : 'hold' };
}

/** 同页通知。不写 localStorage。 */
export function setBingoSending(active: boolean): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(BINGO_SENDING_EVENT, { detail: active }));
}

export function useBingoSending(): boolean {
  const [active, setActive] = useState(false);
  useEffect(() => {
    const onSending = (event: Event) => {
      setActive((event as CustomEvent<boolean>).detail === true);
    };
    window.addEventListener(BINGO_SENDING_EVENT, onSending);
    return () => window.removeEventListener(BINGO_SENDING_EVENT, onSending);
  }, []);
  return active;
}

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const media = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!media) return undefined;
    const sync = () => setReduced(media.matches);
    sync();
    media.addEventListener?.('change', sync);
    return () => media.removeEventListener?.('change', sync);
  }, []);
  return reduced;
}

function useBingoPose(visual: BingoVisual, reduced: boolean, armed: boolean): BingoPose {
  const [pose, setPose] = useState<BingoPose>(() => settledBingoPose(visual, false));
  const angleRef = useRef(0);
  const visualRef = useRef(visual);
  const mounted = useRef(false);
  const armedRef = useRef(false);

  useLayoutEffect(() => {
    const previous = visualRef.current;
    visualRef.current = visual;
    const first = !mounted.current;
    const wasArmed = armedRef.current;
    mounted.current = true;
    if (armed) armedRef.current = true;

    let raf = 0;
    let stop = false;
    const apply = (next: BingoPose) => {
      if (stop) return;
      angleRef.current = next.angle;
      setPose(next);
    };

    if (visual === 'sending' && !reduced) {
      const origin = angleRef.current;
      const started = performance.now();
      const frame = () => {
        if (stop) return;
        const angle = bingoSpinAngle(performance.now() - started, origin);
        apply({ angle, gap: BINGO_D4.gapDeg, beadOpacity: 0, check: false, step: 'spin' });
        raf = requestAnimationFrame(frame);
      };
      apply({ angle: origin, gap: BINGO_D4.gapDeg, beadOpacity: 0, check: false, step: 'spin' });
      raf = requestAnimationFrame(frame);
      return () => {
        stop = true;
        cancelAnimationFrame(raf);
      };
    }

    const playReceipt = wasArmed && visual === 'returned' && !reduced && !first && previous !== 'returned';
    if (playReceipt) {
      const frozen = angleRef.current;
      const started = performance.now();
      const frame = () => {
        if (stop) return;
        const receipt = bingoReceiptPose(performance.now() - started);
        apply({ angle: frozen, gap: receipt.gap, beadOpacity: receipt.beadOpacity, check: receipt.check, step: receipt.step });
        if (receipt.step !== 'check') raf = requestAnimationFrame(frame);
      };
      const opening = bingoReceiptPose(0);
      apply({ angle: frozen, gap: opening.gap, beadOpacity: opening.beadOpacity, check: false, step: 'pause' });
      raf = requestAnimationFrame(frame);
      return () => {
        stop = true;
        cancelAnimationFrame(raf);
      };
    }

    if (visual === 'returned') {
      const next = settledBingoPose('returned', reduced);
      apply(next);
      return () => { stop = true; };
    }

    const glide = wasArmed && !reduced && !first && previous === 'sending' && visual !== 'sending';
    if (glide) {
      const from = angleRef.current;
      const started = performance.now();
      if (bingoDecel(from, 0).done) {
        apply(settledBingoPose(visual, false));
        return () => { stop = true; };
      }
      const frame = () => {
        if (stop) return;
        const step = bingoDecel(from, performance.now() - started);
        if (step.done) {
          apply(settledBingoPose(visual, false));
          return;
        }
        apply({ angle: step.angle, gap: BINGO_D4.gapDeg, beadOpacity: 0, check: false, step: 'decel' });
        raf = requestAnimationFrame(frame);
      };
      raf = requestAnimationFrame(frame);
      return () => {
        stop = true;
        cancelAnimationFrame(raf);
      };
    }

    apply(settledBingoPose(visual, reduced));
    return () => { stop = true; };
  }, [visual, reduced, armed]);

  return pose;
}

/**
 * 左轨和分享行共用这一枚。
 * 只转动环（和收口时还在缺口里的珠）。数字、对勾、旁边的「Bingo」不进这个旋转组。
 */
export function BingoStatusMark({
  phase,
  sending = false,
  count = '',
  size = 28,
  armed = true,
}: {
  phase: BingoPhase;
  sending?: boolean;
  count?: string;
  size?: number;
  /** 读完本机记录之后才为真。读入已有回执时不重放收口。 */
  armed?: boolean;
}): JSX.Element {
  const reduced = useReducedMotion();
  const visual = bingoVisual(phase, sending);
  const pose = useBingoPose(visual, reduced, armed);
  const showCount = visual === 'awaiting' && pose.step === 'hold' && count !== '';
  const bead = bingoBeadCenter();
  const open = pose.gap >= 0.35;
  const showBead = pose.beadOpacity > 0.02;

  return (
    <span
      className="sc-bingo-badge"
      data-status={phase}
      data-visual={visual}
      data-step={pose.step}
      data-reduced={reduced ? 'true' : 'false'}
      data-angle={pose.angle.toFixed(1)}
      {...(visual === 'sending' && !reduced ? { 'data-spin-ms': String(BINGO_SPIN_PERIOD_MS) } : {})}
      {...(showBead ? { 'data-bead': 'warn' } : {})}
      {...(showCount ? { 'data-count': count } : {})}
      style={{ width: size, height: size, display: 'grid', placeItems: 'center', flex: 'none' }}
      aria-hidden="true"
    >
      <svg className="sc-bingo-mark" viewBox="0 0 24 24" width={size} height={size} fill="none" aria-hidden="true" focusable="false" style={{ textRendering: 'geometricPrecision' }}>
        <g data-ring="" transform={`rotate(${pose.angle.toFixed(2)} ${BINGO_D4.cx} ${BINGO_D4.cy})`}>
          {open ? (
            <path
              data-part="ring"
              d={bingoArcPath(pose.gap)}
              stroke={RING}
              strokeWidth={BINGO_D4.stroke}
              strokeLinecap="round"
              fill="none"
            />
          ) : (
            <circle
              data-part="ring"
              cx={BINGO_D4.cx}
              cy={BINGO_D4.cy}
              r={BINGO_D4.r}
              stroke={RING}
              strokeWidth={BINGO_D4.stroke}
              fill="none"
            />
          )}
          {showBead && (
            <circle
              data-part="bead"
              cx={bead.cx}
              cy={bead.cy}
              r={BINGO_D4.beadR}
              fill={BEAD}
              opacity={pose.beadOpacity}
            />
          )}
        </g>
        {pose.check && (
          <path
            data-mark="check"
            d={CHECK_D}
            stroke={INK}
            strokeWidth={BINGO_D4.stroke}
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
        )}
        {showCount && (
          <text
            x="12"
            y="12"
            textAnchor="middle"
            dominantBaseline="central"
            fill={INK}
            fontSize="8"
            fontWeight="600"
            fontFamily="inherit"
          >
            {count}
          </text>
        )}
      </svg>
    </span>
  );
}
