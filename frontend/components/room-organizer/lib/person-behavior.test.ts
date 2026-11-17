import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SEAT_BEHAVIOR,
  createSeatBehavior,
  createSeatRegistry,
  nearestSeat,
  seatDwellSeconds,
  stepSeatBehavior,
  type SeatAnchor,
  type SeatBehaviorContext,
} from './person-behavior';

const seat = (id: string, x: number, z: number): SeatAnchor => ({
  id,
  x,
  z,
  approach: { x, z },
  facing: Math.PI,
  seatHeight: 0.45,
});

function ctx(overrides: Partial<SeatBehaviorContext> = {}): SeatBehaviorContext {
  return {
    position: { x: 0, z: 0 },
    seats: [seat('chair-a', 2, 0)],
    isTaken: () => false,
    canReach: () => true,
    dwellSeconds: 30,
    secondsPerTick: 1,
    ...overrides,
  };
}

describe('nearestSeat', () => {
  it('takes the closest seat within the detour budget', () => {
    const seats = [seat('far', 6, 0), seat('near', 2, 0)];
    expect(nearestSeat({ x: 0, z: 0 }, seats, () => false, () => true, [], 8)?.id).toBe('near');
  });

  it('returns null for taken, used, unreachable or too-far seats', () => {
    const seats = [seat('chair-a', 2, 0)];
    expect(nearestSeat({ x: 0, z: 0 }, seats, () => true, () => true, [], 8)).toBeNull();
    expect(nearestSeat({ x: 0, z: 0 }, seats, () => false, () => true, ['chair-a'], 8)).toBeNull();
    expect(nearestSeat({ x: 0, z: 0 }, seats, () => false, () => false, [], 8)).toBeNull();
    expect(nearestSeat({ x: 0, z: 0 }, seats, () => false, () => true, [], 1)).toBeNull();
  });

  it('breaks distance ties by id so two frames never swap seats', () => {
    const seats = [seat('chair-b', 2, 0), seat('chair-a', 0, 2)];
    expect(nearestSeat({ x: 0, z: 0 }, seats, () => false, () => true, [], 8)?.id).toBe('chair-a');
    const reversed = [...seats].reverse();
    expect(nearestSeat({ x: 0, z: 0 }, reversed, () => false, () => true, [], 8)?.id).toBe('chair-a');
  });
});

describe('stepSeatBehavior', () => {
  it('goes roaming → approaching → seated → roaming, and never re-sits the same chair', () => {
    const state = createSeatBehavior();
    const context = ctx();

    // 第一帧：看到椅子，给出 approach。
    const [approach] = stepSeatBehavior(state, context, false);
    expect(approach).toMatchObject({ type: 'approach', seat: { id: 'chair-a' } });
    expect(state.phase).toBe('approaching');

    // 还没走到：不重复发事件。
    expect(stepSeatBehavior(state, context, false)).toEqual([]);

    // 走到了：坐下，停留时长取调用方给的秒数。
    const [sit] = stepSeatBehavior(state, context, true);
    expect(sit).toEqual({ type: 'sit', seat: expect.objectContaining({ id: 'chair-a' }) });
    expect(state.phase).toBe('seated');
    expect(state.dwell).toBe(30);

    // 坐着时按帧长递减，不到点不起身。
    expect(stepSeatBehavior(state, { ...context, secondsPerTick: 10 }, false)).toEqual([]);
    expect(state.dwell).toBe(20);

    const [stand] = stepSeatBehavior(state, { ...context, secondsPerTick: 25 }, false);
    expect(stand).toEqual({ type: 'stand' });
    expect(state.phase).toBe('roaming');
    expect(state.used).toEqual(['chair-a']);

    // 同一把椅子不再坐第二次。
    expect(stepSeatBehavior(state, context, false)).toEqual([]);
  });

  it('falls back to roaming when the chosen seat disappears while walking to it', () => {
    const state = createSeatBehavior();
    stepSeatBehavior(state, ctx(), false);
    expect(state.phase).toBe('approaching');
    expect(stepSeatBehavior(state, ctx({ seats: [] }), true)).toEqual([]);
    expect(state.phase).toBe('roaming');
    expect(state.seatId).toBeNull();
  });

  it('does not walk to a seat when the frame budget is zero', () => {
    const state = createSeatBehavior();
    const events = stepSeatBehavior(state, ctx({ dwellSeconds: 0 }), false);
    expect(events).toHaveLength(1);
    expect(state.dwell).toBe(0);
  });
});

describe('createSeatRegistry', () => {
  it('keeps one person per seat and releases by person, not by seat', () => {
    const registry = createSeatRegistry();
    expect(registry.claim('chair-a', 'p1')).toBe(true);
    expect(registry.claim('chair-a', 'p2')).toBe(false);
    expect(registry.isTaken('chair-a')).toBe(true);
    expect(registry.holderOf('chair-a')).toBe('p1');

    // 本人重复认领是幂等的（重建/重复帧不会把座判成别人的）。
    expect(registry.claim('chair-a', 'p1')).toBe(true);

    registry.release('p2');
    expect(registry.isTaken('chair-a')).toBe(true);

    registry.release('p1');
    expect(registry.isTaken('chair-a')).toBe(false);
    expect(registry.size()).toBe(0);
  });

  it('clears every claim', () => {
    const registry = createSeatRegistry();
    registry.claim('chair-a', 'p1');
    registry.claim('chair-b', 'p2');
    expect(registry.size()).toBe(2);
    registry.clear();
    expect(registry.isTaken('chair-a')).toBe(false);
    expect(registry.isTaken('chair-b')).toBe(false);
  });
});

describe('seatDwellSeconds', () => {
  it('is deterministic per person and seat, and inside the range', () => {
    const a = seatDwellSeconds('p1', 'chair-a');
    expect(seatDwellSeconds('p1', 'chair-a')).toBe(a);
    expect(a).toBeGreaterThanOrEqual(25);
    expect(a).toBeLessThanOrEqual(70);
    expect(seatDwellSeconds('p1', 'chair-b')).not.toBe(a);
    expect(seatDwellSeconds('p2', 'chair-a', [5, 6])).toBeGreaterThanOrEqual(5);
  });
});

describe('DEFAULT_SEAT_BEHAVIOR', () => {
  it('keeps the B1 budget: 8 m detour, 0.35 m arrival', () => {
    expect(DEFAULT_SEAT_BEHAVIOR.maxDetourM).toBe(8);
    expect(DEFAULT_SEAT_BEHAVIOR.arriveM).toBeCloseTo(0.35, 5);
  });
});
