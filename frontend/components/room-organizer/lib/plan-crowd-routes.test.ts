import { describe, expect, it } from 'vitest';
import { assignCrowdWalkRoutes, walkablePedestrianRoutes } from './plan-crowd-routes';
import type { CrowdShellPlacement } from './plan-scene-placement';
import type { PlanPoint, PlanRoute } from '../../../../supabase/functions/_shared/site-plan';

const METRICS = { width: 100, depth: 80 };

/** 场地边界：西南角 (0,0)，东北角 (100,80)。 */
const BOUNDARY: PlanPoint[] = [
  { x: 0, y: 0 },
  { x: 100, y: 0 },
  { x: 100, y: 80 },
  { x: 0, y: 80 },
];

function route(kind: PlanRoute['kind'], points: PlanPoint[], id = `r-${kind}`): PlanRoute {
  return {
    id,
    kind,
    name: kind,
    points,
    oneWay: false,
    notes: '',
  };
}

function placement(overrides: Partial<CrowdShellPlacement> & { id: string }): CrowdShellPlacement {
  return {
    workerId: 'w1',
    role: '保安',
    crowdType: 'security',
    assetId: 'a007',
    slug: null,
    glbUrl: '/people/a007.glb',
    at: { x: 0, y: 0 },
    offset: { x: 0, y: 0 },
    color: '#5e7fa6',
    shell: { x: 0, z: 0 },
    ...overrides,
  };
}

const LINE_A: PlanPoint[] = [
  { x: 25, y: 60 },
  { x: 75, y: 60 },
];
const LINE_B: PlanPoint[] = [
  { x: 25, y: 20 },
  { x: 75, y: 20 },
];

describe('walkablePedestrianRoutes', () => {
  it('只保留人行动线，排除车流 / 后勤流与退化线', () => {
    const routes = [
      route('pedestrian', LINE_A, 'p1'),
      route('vehicle', LINE_A, 'v1'),
      route('service', LINE_A, 's1'),
      route('pedestrian', [{ x: 0, y: 0 }], 'p-degenerate'),
    ];
    expect(walkablePedestrianRoutes(routes).map((r) => r.id)).toEqual(['p1']);
  });
});

describe('assignCrowdWalkRoutes', () => {
  it('无可走人流时返回空映射，实例保持静态', () => {
    const placements = [placement({ id: 'p#0' })];
    const map = assignCrowdWalkRoutes(placements, [route('vehicle', LINE_A)], BOUNDARY, METRICS);
    expect(map.size).toBe(0);
  });

  it('可走实例按序号循环挂到各条人行动线；非可走实例不挂', () => {
    const placements = [
      placement({ id: 'p#0', assetId: 'a007' }),
      placement({ id: 'p#1', assetId: 'a008' }),
      placement({ id: 'p#2', assetId: 'a009' }),
      placement({ id: 'p#3', assetId: null, slug: 'lowpoly' }),
    ];
    const map = assignCrowdWalkRoutes(
      placements,
      [route('pedestrian', LINE_A, 'pa'), route('pedestrian', LINE_B, 'pb')],
      BOUNDARY,
      METRICS,
    );
    expect([...map.keys()]).toEqual(['p#0', 'p#1', 'p#2']);
    // 循环分配：第 0/2 条落 pa，第 1 条落 pb
    expect(map.get('p#0')!.points[0]).toEqual(map.get('p#2')!.points[0]);
    expect(map.get('p#1')!.points[0]).not.toEqual(map.get('p#0')!.points[0]);
    expect(map.has('p#3')).toBe(false);
  });

  it('路线点折成 crowdLayer 局部坐标（框归中、y 北翻成 z 南）', () => {
    const placements = [placement({ id: 'p#0' })];
    const map = assignCrowdWalkRoutes(placements, [route('pedestrian', LINE_A)], BOUNDARY, METRICS);
    const walk = map.get('p#0')!;
    // (25,60) → shell(25,20) → 局部 (25−50, 20−40) = (−25,−20)
    expect(walk.points[0]).toEqual({ x: -25, z: -20 });
    // (75,60) → shell(75,20) → 局部 (25,−20)
    expect(walk.points[1]).toEqual({ x: 25, z: -20 });
  });

  it('折返巡游、不逗留，路线点数量与输入一致', () => {
    const placements = [placement({ id: 'p#0' })];
    const map = assignCrowdWalkRoutes(placements, [route('pedestrian', LINE_A)], BOUNDARY, METRICS);
    const walk = map.get('p#0')!;
    expect(walk.loop).toBe(false);
    expect(walk.pauseMs).toBe(0);
    expect(walk.points).toHaveLength(2);
  });
});
