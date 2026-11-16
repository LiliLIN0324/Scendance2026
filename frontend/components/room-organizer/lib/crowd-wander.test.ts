import { describe, expect, it } from 'vitest';
import {
  createWanderAgent,
  stepWanderAgent,
  type WanderBounds,
} from './crowd-wander';
import { boxCollider } from './walk-collision';

const OPEN_BOUNDS: WanderBounds = { minX: -10, maxX: 10, minZ: -10, maxZ: 10 };
const HOME = { x: 2, z: 3 };

describe('createWanderAgent', () => {
  it('starts idle at the home point with no target and a bounded idle timer', () => {
    const agent = createWanderAgent(42, HOME, { idleMs: [1000, 3000] });
    expect(agent.mode).toBe('idle');
    expect(agent.position).toEqual(HOME);
    expect(agent.target).toBeNull();
    expect(agent.blockedAttempts).toBe(0);
    expect(agent.timerMs).toBeGreaterThanOrEqual(1000);
    expect(agent.timerMs).toBeLessThanOrEqual(3000);
  });

  it('is reproducible: the same seed produces the same stream', () => {
    const a = createWanderAgent(7, HOME);
    const b = createWanderAgent(7, HOME);
    expect(b.rngState).toBe(a.rngState);
    expect(b.timerMs).toBe(a.timerMs);
  });
});

describe('stepWanderAgent', () => {
  it('transitions idle → walk once the idle timer elapses and a free target exists', () => {
    const agent = createWanderAgent(1, HOME, { idleMs: [0, 0] });
    stepWanderAgent(agent, 16, [], OPEN_BOUNDS);
    expect(agent.mode).toBe('walk');
    expect(agent.target).not.toBeNull();
  });

  it('keeps the chosen target inside the activity bounds', () => {
    const agent = createWanderAgent(11, { x: 0, z: 0 }, { idleMs: [0, 0] });
    stepWanderAgent(agent, 16, [], OPEN_BOUNDS);
    const target = agent.target!;
    expect(target.x).toBeGreaterThanOrEqual(OPEN_BOUNDS.minX);
    expect(target.x).toBeLessThanOrEqual(OPEN_BOUNDS.maxX);
    expect(target.z).toBeGreaterThanOrEqual(OPEN_BOUNDS.minZ);
    expect(target.z).toBeLessThanOrEqual(OPEN_BOUNDS.maxZ);
  });

  it('transitions walk → idle on arrival and resets the blocked counter', () => {
    const agent = createWanderAgent(3, HOME, { idleMs: [500, 500] });
    const destination = { x: HOME.x + 0.2, z: HOME.z };
    agent.mode = 'walk';
    agent.target = destination;
    agent.timerMs = 200;
    // 大步长预算覆盖 0.2 m，直接到达。
    stepWanderAgent(agent, 10_000, [], OPEN_BOUNDS);
    expect(agent.mode).toBe('idle');
    expect(agent.target).toBeNull();
    expect(agent.blockedAttempts).toBe(0);
    expect(agent.position).toEqual(destination);
  });

  it('keeps two same-seed agents in lockstep across steps', () => {
    const a = createWanderAgent(9, HOME);
    const b = createWanderAgent(9, HOME);
    for (let i = 0; i < 30; i += 1) {
      stepWanderAgent(a, 200, [], OPEN_BOUNDS);
      stepWanderAgent(b, 200, [], OPEN_BOUNDS);
    }
    expect(b.rngState).toBe(a.rngState);
    expect(b.mode).toBe(a.mode);
    expect(b.position).toEqual(a.position);
    expect(b.target).toEqual(a.target);
  });

  it('stays idle and records a blocked attempt when no free target exists', () => {
    // 一个覆盖整片活动区的实心盒：任何步点都压在盒上，余量不达标。
    const wall = [boxCollider(0, 0, 40, 40, 0, true)];
    const agent = createWanderAgent(5, HOME, { idleMs: [0, 0], maxAttempts: 4 });
    stepWanderAgent(agent, 16, wall, OPEN_BOUNDS);
    expect(agent.mode).toBe('idle');
    expect(agent.target).toBeNull();
    expect(agent.blockedAttempts).toBeGreaterThanOrEqual(1);
  });

  it('accepts a null bounds and an empty collider list without throwing', () => {
    const agent = createWanderAgent(2, HOME, { idleMs: [0, 0] });
    expect(() => stepWanderAgent(agent, 16, [], null)).not.toThrow();
    expect(agent.mode).toBe('walk');
  });
});
