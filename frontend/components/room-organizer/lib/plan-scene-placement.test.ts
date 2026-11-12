import { describe, expect, it } from 'vitest';

import {
  planCrowdShellPlacements,
  planPointToShell,
  planSceneObjectPlacements,
} from './plan-scene-placement';
import type { PlanSceneObject } from './plan-item-bridge';
import type { PlanPoint } from '../../../../supabase/functions/_shared/site-plan';

const METRICS = { width: 100, depth: 80 };

/** 场地边界：西南角 (0,0)，东北角 (100,80)。 */
const BOUNDARY: PlanPoint[] = [
  { x: 0, y: 0 },
  { x: 100, y: 0 },
  { x: 100, y: 80 },
  { x: 0, y: 80 },
];

function item(overrides: Partial<PlanSceneObject> = {}): PlanSceneObject {
  return {
    id: 'item:chair',
    kind: 'item',
    name: '椅子',
    center: { x: 50, y: 40 },
    width: 1,
    depth: 1,
    height: 1,
    rotationDeg: 0,
    color: '#ff0000',
    ...overrides,
  };
}

describe('planPointToShell', () => {
  it('把平面 ENU 换算成场地壳体坐标（北沿 z=0、东沿 x=0）', () => {
    expect(planPointToShell({ x: 0, y: 80 }, BOUNDARY, METRICS)).toEqual({ x: 0, z: 0 });
    expect(planPointToShell({ x: 100, y: 0 }, BOUNDARY, METRICS)).toEqual({ x: 100, z: 80 });
    expect(planPointToShell({ x: 25, y: 60 }, BOUNDARY, METRICS)).toEqual({ x: 25, z: 20 });
  });

  it('没有有效边界时退回原值（z = -y）', () => {
    expect(planPointToShell({ x: 3, y: 7 }, [], METRICS)).toEqual({ x: 3, z: -7 });
  });
});

describe('planSceneObjectPlacements', () => {
  it('保留物料的尺寸、朝向与模型地址，并换算落点', () => {
    const [placement] = planSceneObjectPlacements(
      [item({ width: 2, depth: 3, height: 1.2, rotationDeg: 90, modelUrl: '/m.glb' })],
      BOUNDARY,
      METRICS,
    );
    expect(placement).toMatchObject({
      id: 'item:chair',
      kind: 'item',
      name: '椅子',
      width: 2,
      depth: 3,
      height: 1.2,
      rotationDeg: 90,
      color: '#ff0000',
      modelUrl: '/m.glb',
    });
    expect(placement.shell).toEqual({ x: 50, z: 40 });
  });

  it('尺寸不足时兜底到 0.2 米，避免 3D 里出现零体积', () => {
    const [placement] = planSceneObjectPlacements([item({ width: 0, depth: 0, height: 0 })], BOUNDARY, METRICS);
    expect(placement.width).toBe(0.2);
    expect(placement.depth).toBe(0.2);
    expect(placement.height).toBe(0.2);
  });

  it('实景扫描场景也走同一套落点换算', () => {
    const [placement] = planSceneObjectPlacements(
      [
        item({
          id: 'scene:venue-scan',
          kind: 'scene',
          name: '实景扫描',
          width: 100,
          depth: 80,
          height: 0,
          color: '#6ea8ff',
        }),
      ],
      BOUNDARY,
      METRICS,
    );
    expect(placement.kind).toBe('scene');
    expect(placement.shell).toEqual({ x: 50, z: 40 });
  });
});

describe('planCrowdShellPlacements', () => {
  it('按 count 展开成 N 个人并换算落点', () => {
    const placements = planCrowdShellPlacements(
      [{ id: 'w1', role: '保安', count: 3, position: { x: 20, y: 20 } }],
      BOUNDARY,
      METRICS,
    );
    expect(placements).toHaveLength(3);
    expect(placements.map((p) => p.crowdType)).toEqual(['security', 'security', 'security']);
    // 展开点在岗位周围散开，但仍在场地壳体内。
    placements.forEach((p) => {
      expect(p.shell.x).toBeGreaterThan(15);
      expect(p.shell.x).toBeLessThan(25);
      expect(p.shell.z).toBeGreaterThan(55);
      expect(p.shell.z).toBeLessThan(65);
    });
  });

  it('没有模型的岗位照样产实例（3D 先画人位柱）', () => {
    const placements = planCrowdShellPlacements(
      [{ id: 'w1', role: '保安', count: 1, position: { x: 10, y: 10 } }],
      BOUNDARY,
      METRICS,
    );
    expect(placements).toHaveLength(1);
    expect(placements[0].glbUrl).toBeNull();
  });

  it('有模型的岗位给出可加载的模型地址', () => {
    const placements = planCrowdShellPlacements(
      [{ id: 'w1', role: '观众', count: 1, position: { x: 10, y: 10 } }],
      BOUNDARY,
      METRICS,
    );
    expect(placements[0].glbUrl).toMatch(/^\/showcase\/assets\/library\/model\/.+\.glb$/);
  });
});
