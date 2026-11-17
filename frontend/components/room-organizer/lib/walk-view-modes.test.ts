import { describe, expect, it } from 'vitest';
import {
  EDITOR_MAX_POLAR,
  VIEW_RIG_OFFSETS,
  WALK_AERIAL_CLEARANCE_M,
  WALK_VIEW_ORDER,
  aerialPolarLimit,
  nextWalkViewMode,
  rigOffsetForYaw,
  viewRigOffset,
} from './walk-view-modes';

describe('aerial polar limit', () => {
  it('keeps a close camera above the ground clearance', () => {
    const distance = 2;
    const phi = aerialPolarLimit(distance);
    expect(phi).toBeLessThan(EDITOR_MAX_POLAR);
    expect(distance * Math.cos(phi)).toBeGreaterThanOrEqual(WALK_AERIAL_CLEARANCE_M - 1e-6);
  });

  it('keeps the editor cap once the site is far enough', () => {
    expect(aerialPolarLimit(80)).toBeCloseTo(EDITOR_MAX_POLAR);
  });

  it('forces a near-overhead angle inside the clearance distance', () => {
    expect(aerialPolarLimit(1)).toBeCloseTo(0.05);
  });
});

describe('walk view mode cycle', () => {
  it('cycles through the order and wraps around', () => {
    expect(nextWalkViewMode('orbit')).toBe('first');
    expect(nextWalkViewMode('first')).toBe('third');
    expect(nextWalkViewMode('third')).toBe('shoulder');
    expect(nextWalkViewMode('shoulder')).toBe('orbit');
  });

  it('treats an unknown mode as starting from orbit', () => {
    expect(nextWalkViewMode('first' as never)).toBe('third');
  });
});

describe('view rig offsets', () => {
  it('keeps migrated third/shoulder constants', () => {
    expect(VIEW_RIG_OFFSETS.third).toEqual({ back: 4, right: 0.65, heightDelta: 0, thirdPerson: true });
    expect(VIEW_RIG_OFFSETS.shoulder).toEqual({ back: 1.5, right: 0.42, heightDelta: -0.18, thirdPerson: true });
    expect(VIEW_RIG_OFFSETS.first.thirdPerson).toBe(false);
    expect(VIEW_RIG_OFFSETS.orbit.thirdPerson).toBe(false);
  });

  it('marks orbit as the orbit-camera aerial mode and others as walk-rigged', () => {
    expect(VIEW_RIG_OFFSETS.orbit.orbitCamera).toBe(true);
    for (const mode of ['first', 'third', 'shoulder'] as const) {
      expect(VIEW_RIG_OFFSETS[mode].orbitCamera ?? false).toBe(false);
      expect(rigOffsetForYaw(mode, 0).orbitCamera).toBe(false);
    }
    expect(rigOffsetForYaw('orbit', 0).orbitCamera).toBe(true);
  });

  it('exposes the same offset via viewRigOffset', () => {
    expect(viewRigOffset('shoulder').back).toBe(1.5);
  });
});

describe('rigOffsetForYaw', () => {
  it('produces zero plane offset for first/orbit facing north', () => {
    for (const mode of ['orbit', 'first'] as const) {
      const out = rigOffsetForYaw(mode, 0);
      expect(out.x).toBeCloseTo(0);
      expect(out.z).toBeCloseTo(0);
      expect(out.heightDelta).toBeCloseTo(0);
    }
  });

  it('pulls third-person back south and to the right when facing north', () => {
    const out = rigOffsetForYaw('third', 0);
    expect(out.x).toBeCloseTo(0.65);
    expect(out.z).toBeCloseTo(-4);
    expect(out.thirdPerson).toBe(true);
  });

  it('applies shoulder height drop', () => {
    const out = rigOffsetForYaw('shoulder', 0);
    expect(out.heightDelta).toBeCloseTo(-0.18);
    expect(out.z).toBeCloseTo(-1.5);
  });

  it('rotates offset with yaw', () => {
    // 朝东（yaw = π/2）：后拉应朝西（-x），右偏朝南（-z）。
    const out = rigOffsetForYaw('third', Math.PI / 2);
    expect(out.x).toBeCloseTo(-4);
    expect(out.z).toBeCloseTo(-0.65);
  });

  it('lists the four distinct modes in order', () => {
    expect(WALK_VIEW_ORDER).toEqual(['orbit', 'first', 'third', 'shoulder']);
  });
});
