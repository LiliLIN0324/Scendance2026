import { describe, expect, it } from 'vitest';
import { sitePlanDataSchema } from '../../../../supabase/functions/_shared/site-plan';

const ZONE_ID = 'a1000000-0000-4000-8000-000000000001';
const WALL_ID = 'b2000000-0000-4000-8000-000000000001';
const LEVEL_ID = 'c3000000-0000-4000-8000-000000000001';

const RING = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];

/** 满足 required 集合的最小 plan；单项测试再覆盖 walls 相关字段。 */
function basePlan(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1 as const,
    boundary: RING,
    zones: [{ id: ZONE_ID, semantic: 'audience' as const, name: '观众区', polygon: RING, notes: '' }],
    facilities: [],
    routes: [],
    nodes: [],
    workers: [],
    walls: [{ id: WALL_ID, points: [{ x: 0, y: 0 }, { x: 5, y: 0 }] }],
    ...overrides,
  };
}

function messages(input: unknown): string[] {
  const parsed = sitePlanDataSchema.safeParse(input);
  return parsed.success ? [] : parsed.error.issues.map(issue => issue.message);
}

describe('sitePlanDataSchema walls（M2 契约校验）', () => {
  it('最小墙体（无 zoneId / levelId）可通过', () => {
    expect(messages(basePlan())).toEqual([]);
  });

  it('墙体 id 与分区 id 重复会被拒', () => {
    const walls = [{ id: ZONE_ID, points: [{ x: 0, y: 0 }, { x: 5, y: 0 }] }];
    expect(messages(basePlan({ walls }))).toContain('墙体实体 ID 与其他实体重复');
  });

  it('墙体 zoneId 悬空会被拒', () => {
    const walls = [{ id: WALL_ID, points: [{ x: 0, y: 0 }, { x: 5, y: 0 }], zoneId: LEVEL_ID }];
    expect(messages(basePlan({ walls })).some(message => message.includes('归属分区不存在'))).toBe(true);
  });

  it('墙体 levelId 悬空会被拒（levels 缺省时不得携带）', () => {
    const walls = [{ id: WALL_ID, points: [{ x: 0, y: 0 }, { x: 5, y: 0 }], levelId: LEVEL_ID }];
    expect(messages(basePlan({ walls }))).toContain(`墙体 ${WALL_ID.slice(0, 8)} 引用的图层不存在`);
  });

  it('墙体带合法 zoneId / levelId 与完整属性可通过', () => {
    const plan = basePlan({
      levels: [{ id: LEVEL_ID, name: '首层' }],
      walls: [{
        id: WALL_ID,
        points: [{ x: 0, y: 0 }, { x: 5, y: 0 }],
        thicknessM: 0.2,
        heightM: 3,
        kind: 'interior',
        status: 'confirmed',
        color: '#FF0000',
        zoneId: ZONE_ID,
        levelId: LEVEL_ID,
      }],
    });
    const parsed = sitePlanDataSchema.safeParse(plan);
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.walls?.[0]?.color).toBe('#ff0000');
  });

  it('厚度/高度超界会被拒，不静默截断', () => {
    const thin = [{ id: WALL_ID, points: [{ x: 0, y: 0 }, { x: 5, y: 0 }], thicknessM: 0.01 }];
    expect(messages(basePlan({ walls: thin })).length).toBeGreaterThan(0);
    const tall = [{ id: WALL_ID, points: [{ x: 0, y: 0 }, { x: 5, y: 0 }], heightM: 30 }];
    expect(messages(basePlan({ walls: tall })).length).toBeGreaterThan(0);
  });
});
