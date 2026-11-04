import { describe, expect, it } from 'vitest';
import { NEAR_ANCHOR_DISTANCE, suggestDropPoint, type DropAnchor } from './drop-zone';

const anchor: DropAnchor = { id: 'a1', name: '主桌', x: 0, z: 0, width: 4, depth: 1 };

describe('suggestDropPoint', () => {
  it('落点离锚点远时按原落点放，无锚点返回', () => {
    const out = suggestDropPoint({ x: 30, z: 30 }, [anchor], { width: 1, depth: 1 });
    expect(out.point).toEqual({ x: 30, z: 30 });
    expect(out.anchor).toBeNull();
  });

  it('落点在阈值内时推到锚点旁并返回锚点', () => {
    const out = suggestDropPoint({ x: 0.6, z: 0 }, [anchor], { width: 1, depth: 1 });
    expect(out.anchor?.name).toBe('主桌');
    // 锚深一半 0.5 + 新物深一半 0.5 + 间隙 0.45 = 1.45
    expect(out.point.x).toBeCloseTo(1.45, 2);
    expect(out.point.z).toBeCloseTo(0, 2);
  });

  it('阈值边界外不吸附', () => {
    const far = NEAR_ANCHOR_DISTANCE + 0.01;
    const out = suggestDropPoint({ x: far, z: 0 }, [anchor], { width: 1, depth: 1 });
    expect(out.anchor).toBeNull();
  });

  it('多个锚点时取最近的一个', () => {
    const other: DropAnchor = { id: 'a2', name: '吧台', x: 5, z: 0, width: 2, depth: 1 };
    const out = suggestDropPoint({ x: 0.8, z: 0 }, [other, anchor], { width: 1, depth: 1 });
    expect(out.anchor?.id).toBe('a1');
  });

  it('空锚点列表按原落点', () => {
    expect(suggestDropPoint({ x: 2, z: 2 }, [], { width: 1, depth: 1 }).anchor).toBeNull();
  });
});
