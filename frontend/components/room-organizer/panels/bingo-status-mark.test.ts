import { describe, expect, it } from 'vitest';
import {
  BINGO_D4,
  BINGO_RECEIPT_CLOSE_MS,
  BINGO_RECEIPT_PAUSE_MS,
  BINGO_RECEIPT_SEAL_MS,
  BINGO_SPIN_PERIOD_MS,
  bingoDecel,
  bingoForwardDelta,
  bingoReceiptPose,
  bingoRingPath,
  bingoSpinAngle,
  bingoVisual,
  settledBingoPose,
} from './bingo-status-mark';

describe('Bingo 状态圈运动', () => {
  it('送出中匀速转，相同间隔转过相同角度，不倒转', () => {
    expect(bingoSpinAngle(0)).toBe(0);
    expect(bingoSpinAngle(BINGO_SPIN_PERIOD_MS / 2)).toBeCloseTo(180);
    expect(bingoSpinAngle(BINGO_SPIN_PERIOD_MS)).toBeCloseTo(0);
    const early = bingoSpinAngle(300) - bingoSpinAngle(0);
    const later = bingoSpinAngle(900) - bingoSpinAngle(600);
    expect(early).toBeCloseTo(later);
    expect(bingoSpinAngle(80)).toBeGreaterThan(bingoSpinAngle(40));
    const wrapped = bingoSpinAngle(100, 350);
    expect(wrapped).toBeGreaterThan(0);
    expect(wrapped).toBeLessThan(30);
  });

  it('进入待评时顺着当前转向减速，停在东北开口，不往回甩', () => {
    expect(bingoForwardDelta(0)).toBe(0);
    expect(bingoForwardDelta(20)).toBeCloseTo(340);
    expect(bingoDecel(0, 0)).toEqual({ angle: 0, done: true });
    const from = 300;
    const samples = [0, 40, 120].map(ms => bingoDecel(from, ms).angle);
    expect(samples[0]).toBeCloseTo(300);
    expect(samples[1]).toBeGreaterThan(samples[0] ?? 0);
    expect(samples[2]).toBeGreaterThan(samples[1] ?? 0);
    expect(bingoDecel(from, 5_000)).toEqual({ angle: 0, done: true });
    const near = bingoDecel(350, 0).angle;
    expect(near).toBeCloseTo(350);
    expect(bingoDecel(350, 20).angle).toBeGreaterThan(350);
  });

  it('已回执按暂停、收口、合上、对勾，收口约 0.2 秒，合上后没有珠', () => {
    const pause = bingoReceiptPose(0);
    expect(pause).toMatchObject({ gap: BINGO_D4.gapDeg, beadOpacity: 1, check: false, step: 'pause' });
    expect(bingoReceiptPose(BINGO_RECEIPT_PAUSE_MS - 1).step).toBe('pause');

    const opening = bingoReceiptPose(BINGO_RECEIPT_PAUSE_MS);
    expect(opening.step).toBe('closing');
    expect(opening.check).toBe(false);
    const mid = bingoReceiptPose(BINGO_RECEIPT_PAUSE_MS + BINGO_RECEIPT_CLOSE_MS / 2);
    expect(mid.step).toBe('closing');
    expect(mid.gap).toBeLessThan(BINGO_D4.gapDeg);
    expect(mid.gap).toBeGreaterThan(0);
    expect(mid.beadOpacity).toBeLessThan(1);
    expect(mid.beadOpacity).toBeGreaterThan(0);
    expect(mid.check).toBe(false);

    const sealed = bingoReceiptPose(BINGO_RECEIPT_PAUSE_MS + BINGO_RECEIPT_CLOSE_MS);
    expect(sealed).toMatchObject({ gap: 0, beadOpacity: 0, check: false, step: 'closed' });
    const done = bingoReceiptPose(BINGO_RECEIPT_PAUSE_MS + BINGO_RECEIPT_CLOSE_MS + BINGO_RECEIPT_SEAL_MS);
    expect(done).toMatchObject({ gap: 0, beadOpacity: 0, check: true, step: 'check' });
  });

  it('减少动态时停在开口环上，已回执不出勾', () => {
    expect(settledBingoPose('sending', true)).toMatchObject({ angle: 0, gap: BINGO_D4.gapDeg, check: false, step: 'hold' });
    expect(settledBingoPose('returned', true)).toMatchObject({ gap: BINGO_D4.gapDeg, beadOpacity: 0, check: false, step: 'hold' });
    expect(settledBingoPose('returned', false).check).toBe(true);
    expect(settledBingoPose('returned', false).gap).toBe(0);
  });

  it('转动不是存储状态，已回执压过送出中', () => {
    expect(bingoVisual('to-send', false)).toBe('to-send');
    expect(bingoVisual('to-send', true)).toBe('sending');
    expect(bingoVisual('awaiting', true)).toBe('sending');
    expect(bingoVisual('returned', true)).toBe('returned');
    expect(bingoRingPath()).toContain('A 9.05 9.05');
  });
});
