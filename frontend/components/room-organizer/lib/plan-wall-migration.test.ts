import { describe, expect, it } from 'vitest';
import type { PlanPoint } from '../../../../supabase/functions/_shared/site-plan';
import { makeFloor, makeLayout } from './__testfixtures__/fixtures';
import { migrateWalls } from './plan-wall-migration';
import type { InteriorWall } from './types';

const BOUNDARY: PlanPoint[] = [
  { x: 0, y: 0 }, { x: 8, y: 0 }, { x: 8, y: 8 }, { x: 0, y: 8 },
];

/** 确定性 id：wall-1、wall-2…（与迁移器契约一致）。 */
function sequentialIds(): () => string {
  let n = 0;
  return () => `wall-${(n += 1)}`;
}

function makeWall(overrides: Partial<InteriorWall> & Pick<InteriorWall, 'id' | 'x1' | 'z1' | 'x2' | 'z2'>): InteriorWall {
  return overrides;
}

function layoutWith(walls: InteriorWall[]) {
  return makeLayout({ width: 8, height: 8, floors: [makeFloor({ interiorWalls: walls })] });
}

describe('plan-wall-migration（室内墙体 → plan walls）', () => {
  it('按迁移帧翻轴并透传厚度/高度/类型/状态/颜色', () => {
    const layout = layoutWith([
      makeWall({ id: 'w1', x1: 0, z1: 0, x2: 4, z2: 0, thickness: 0.2, height: 3, kind: 'interior', status: 'confirmed', color: '#ff0000' }),
    ]);

    const result = migrateWalls(layout, BOUNDARY, sequentialIds());

    expect(result.skipped).toEqual([]);
    expect(result.walls).toHaveLength(1);
    expect(result.walls[0]).toMatchObject({
      id: 'wall-1',
      points: [{ x: 0, y: 8 }, { x: 4, y: 8 }],
      thicknessM: 0.2,
      heightM: 3,
      kind: 'interior',
      status: 'confirmed',
      color: '#ff0000',
    });
  });

  it('两端重合的退化段进 skipped，不落库', () => {
    const layout = layoutWith([
      makeWall({ id: 'w1', x1: 2, z1: 2, x2: 2, z2: 2 }),
      makeWall({ id: 'w2', x1: 0, z1: 0, x2: 4, z2: 0 }),
    ]);

    const result = migrateWalls(layout, BOUNDARY, sequentialIds());

    expect(result.walls).toHaveLength(1);
    expect(result.skipped).toEqual([{ sourceId: 'w1', reason: '墙体长度退化' }]);
  });

  it('端点非有限数进 skipped', () => {
    const layout = layoutWith([makeWall({ id: 'w1', x1: Number.NaN, z1: 0, x2: 4, z2: 0 })]);

    const result = migrateWalls(layout, BOUNDARY, sequentialIds());

    expect(result.walls).toEqual([]);
    expect(result.skipped[0]?.sourceId).toBe('w1');
  });

  it('厚度/高度超界按未量处理：丢字段但保留墙段', () => {
    const layout = layoutWith([
      makeWall({ id: 'w1', x1: 0, z1: 0, x2: 4, z2: 0, thickness: 9, height: 0.2 }),
    ]);

    const result = migrateWalls(layout, BOUNDARY, sequentialIds());

    expect(result.walls).toHaveLength(1);
    expect(result.walls[0]).not.toHaveProperty('thicknessM');
    expect(result.walls[0]).not.toHaveProperty('heightM');
  });

  it('归属分区按线段中点命中，都不含则留空', () => {
    const zones = [{ id: 'zone-1', polygon: BOUNDARY }];
    const layout = layoutWith([makeWall({ id: 'w1', x1: 0, z1: 0, x2: 4, z2: 0 })]);

    const inside = migrateWalls(layout, BOUNDARY, sequentialIds(), zones);
    expect(inside.walls[0]?.zoneId).toBe('zone-1');

    const outside = migrateWalls(layout, BOUNDARY, sequentialIds(), []);
    expect(outside.walls[0]).not.toHaveProperty('zoneId');
  });

  it('超过 500 段的墙进 skipped，保留前 500 段', () => {
    const walls = Array.from({ length: 501 }, (_, i) => makeWall({
      id: `w${i}`,
      x1: 0, z1: i / 100, x2: 4, z2: i / 100,
    }));
    const result = migrateWalls(layoutWith(walls), BOUNDARY, sequentialIds());

    expect(result.walls).toHaveLength(500);
    expect(result.skipped).toEqual([{ sourceId: 'w500', reason: '墙体超过 500 段上限' }]);
  });

  it('无墙体时返回空结果，不抛错', () => {
    const result = migrateWalls(makeLayout({ width: 8, height: 8 }), BOUNDARY, sequentialIds());
    expect(result).toEqual({ walls: [], skipped: [] });
  });
});
