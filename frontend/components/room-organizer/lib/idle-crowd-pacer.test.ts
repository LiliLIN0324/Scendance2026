import { describe, expect, it } from 'vitest';
import { createCrowdIdlePacer } from './idle-crowd-pacer';

describe('createCrowdIdlePacer', () => {
  it('holds the step until the cadence is reached, then hands out the real elapsed time', () => {
    const pacer = createCrowdIdlePacer(0.25);
    let taken: number | null = null;
    let frames = 0;
    while (taken === null && frames < 100) {
      pacer.tick(1 / 60);
      taken = pacer.take();
      frames += 1;
    }
    expect(frames).toBeGreaterThanOrEqual(15);
    // 交出去的就是真实经过的秒数，不是固定 0.25。
    expect(taken).toBeCloseTo(frames / 60, 2);
    // 取走后重新攒：下一次立刻取只会拿到 null。
    expect(pacer.take()).toBeNull();
  });

  it('advances at roughly the same wall-clock rate as the active loop', () => {
    const pacer = createCrowdIdlePacer(0.25);
    let advanced = 0;
    for (let i = 0; i < 120; i += 1) {
      pacer.tick(1 / 60);
      const step = pacer.take();
      if (step !== null) advanced += step;
    }
    // 2 s 内推进总量 ≈ 2 s：最多差一个未满的节拍（0.25 s），不是 1/6，也不是每帧 0.25。
    expect(advanced).toBeGreaterThan(2 - 0.25 - 1e-6);
    expect(advanced).toBeLessThan(2 + 1e-6);
  });

  it('caps a single catch-up step so nobody jumps through a wall', () => {
    const pacer = createCrowdIdlePacer(0.25, 0.5);
    pacer.tick(3);
    expect(pacer.take()).toBeCloseTo(0.5, 6);
  });

  it('drops the pending time when returning to the active state', () => {
    const pacer = createCrowdIdlePacer(0.25);
    for (let i = 0; i < 10; i += 1) pacer.tick(1 / 60);
    pacer.reset();
    expect(pacer.take()).toBeNull();
    pacer.tick(0.3);
    expect(pacer.take()).toBeCloseTo(0.3, 6);
  });

  it('ignores non-positive deltas instead of stalling', () => {
    const pacer = createCrowdIdlePacer(0.25);
    pacer.tick(0);
    pacer.tick(-1);
    expect(pacer.take()).toBeNull();
    pacer.tick(0.3);
    expect(pacer.take()).toBeCloseTo(0.3, 6);
  });
});
