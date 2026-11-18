import { expect, it } from 'vitest';
import {
  appendRingDraftVertex,
  isRingCloseHit,
  RING_CLOSE_HIT_PX,
} from './outdoor-draft-ring';
import { PLAN_RING_MAX_VERTICES } from './site-plan-editing';

it('点击落在首顶点闭合热区内才判闭合；超出热区不算', () => {
  const first = { x: 100, y: 100 };
  expect(isRingCloseHit({ x: 100, y: 100 }, first)).toBe(true);
  expect(isRingCloseHit({ x: 100 + RING_CLOSE_HIT_PX, y: 100 }, first)).toBe(true);
  expect(isRingCloseHit({ x: 100 + RING_CLOSE_HIT_PX + 1, y: 100 }, first)).toBe(false);
  expect(isRingCloseHit({ x: 320, y: 210 }, first)).toBe(false);
});

it('普通草稿逐个追加顶点，不替换已有草稿', () => {
  const draft: { x: number; y: number }[] = [{ x: 0, y: 0 }, { x: 10, y: 0 }];
  const result = appendRingDraftVertex(draft, { x: 10, y: 10 });
  expect(result.status).toBe('added');
  expect(result.replacedSeed).toBe(false);
  expect(result.points).toEqual([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }]);
  // 原草稿不被原地改写。
  expect(draft).toHaveLength(2);
});

it('搜索选区种子草稿在第一个手工顶点处被替换，不与大框顶点混排', () => {
  const seeded = [{ x: -500, y: -500 }, { x: 500, y: -500 }, { x: 500, y: 500 }, { x: -500, y: 500 }];
  const result = appendRingDraftVertex(seeded, { x: 20, y: 30 }, { seeded: true });
  expect(result.status).toBe('seed-replaced');
  expect(result.replacedSeed).toBe(true);
  expect(result.points).toEqual([{ x: 20, y: 30 }]);
});

it('离已有顶点小于 0.5 m 的重复点击被忽略', () => {
  const draft = [{ x: 0, y: 0 }, { x: 10, y: 0 }];
  const result = appendRingDraftVertex(draft, { x: 0.2, y: 0.1 });
  expect(result.status).toBe('too-close');
  expect(result.points).toHaveLength(2);
});

it('达到顶点上限后不再收点', () => {
  const full = Array.from({ length: PLAN_RING_MAX_VERTICES }, (_, i) => ({ x: i * 2, y: 0 }));
  const result = appendRingDraftVertex(full, { x: 999, y: 999 });
  expect(result.status).toBe('too-many');
  expect(result.points).toHaveLength(PLAN_RING_MAX_VERTICES);
});
