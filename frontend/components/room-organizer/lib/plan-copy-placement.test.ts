import { describe, expect, it } from 'vitest';
import type { PlanPoint } from '../../../../supabase/functions/_shared/site-plan';
import { planCopyOffset, type PlanCopyShape } from './plan-copy-placement';

/**
 * 2026-11-20 审计 F2：复制不再只有「+2,+2」一个答案。
 * 这些用例锁的是「首选原偏移、脏了就找最近的空地、都脏也照复制但如实标记」。
 */
const square = (x: number, y: number, size = 2): PlanCopyShape => ({
  position: { x, y },
  rotationDeg: 0,
  size: { width: size, depth: size },
});

const rect = (west: number, south: number, east: number, north: number): PlanPoint[] => [
  { x: west, y: south },
  { x: east, y: south },
  { x: east, y: north },
  { x: west, y: north },
];

/** 40×40 的红线框：中间放东西都算界内。 */
const bigRing = rect(0, 0, 40, 40);

describe('plan-copy-placement · 复制落点', () => {
  it('空地保持原有 +2/+2，行为不变', () => {
    const result = planCopyOffset([square(10, 10)], [square(10, 10)], bigRing);
    expect(result).toEqual({ offset: { x: 2, y: 2 }, clear: true });
  });

  it('+2/+2 会压住邻居时换到最近的空地，且不与邻居相交', () => {
    const source = square(10, 10);
    const neighbour = square(12, 12); // 正好占住 +2/+2
    const result = planCopyOffset([source], [source, neighbour], bigRing);
    expect(result.clear).toBe(true);
    expect(result.offset).not.toEqual({ x: 2, y: 2 });
    // 正交优先：第一档应该落在 2 m 的上下左右之一。
    expect(Math.abs(result.offset.x) + Math.abs(result.offset.y)).toBe(2);
  });

  it('贴着红线时不会把副本复制到界外', () => {
    const ring = rect(0, 0, 12, 12);
    const source = square(10.5, 10.5); // 占地 9.5–11.5，+2 就出界了
    const result = planCopyOffset([source], [source], ring);
    expect(result.clear).toBe(true);
    const moved = { ...source, position: { x: source.position.x + result.offset.x, y: source.position.y + result.offset.y } };
    const corners: PlanPoint[] = [
      { x: moved.position.x - 1, y: moved.position.y - 1 },
      { x: moved.position.x + 1, y: moved.position.y - 1 },
      { x: moved.position.x + 1, y: moved.position.y + 1 },
      { x: moved.position.x - 1, y: moved.position.y + 1 },
    ];
    for (const corner of corners) {
      expect(corner.x).toBeGreaterThanOrEqual(0);
      expect(corner.x).toBeLessThanOrEqual(12);
      expect(corner.y).toBeGreaterThanOrEqual(0);
      expect(corner.y).toBeLessThanOrEqual(12);
    }
  });

  it('四周都被占满时仍按原偏移复制，但标记为不干净（交给问题清单）', () => {
    const source = square(10, 10);
    const blockers: PlanCopyShape[] = [];
    for (let dx = -8; dx <= 8; dx += 2) {
      for (let dy = -8; dy <= 8; dy += 2) {
        if (dx === 0 && dy === 0) continue;
        blockers.push(square(10 + dx, 10 + dy));
      }
    }
    const result = planCopyOffset([source], [source, ...blockers], bigRing, { rings: 2 });
    expect(result).toEqual({ offset: { x: 2, y: 2 }, clear: false });
  });

  it('整组复制时整组一起换位，且副本之间不互压', () => {
    const a = square(10, 10);
    const b = square(14, 10);
    const blocker = square(12, 12); // 挡住 a 的 +2/+2
    const result = planCopyOffset([a, b], [a, b, blocker], bigRing);
    expect(result.clear).toBe(true);
    expect(result.offset).not.toEqual({ x: 2, y: 2 });
  });

  it('没有红线（<3 点）时只按碰撞判断', () => {
    const source = square(10, 10);
    const result = planCopyOffset([source], [source], []);
    expect(result).toEqual({ offset: { x: 2, y: 2 }, clear: true });
  });
});
