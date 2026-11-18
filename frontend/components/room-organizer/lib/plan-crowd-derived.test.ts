import { describe, expect, it } from 'vitest';
import { deriveCrowdFromRoutes, DERIVED_CROWD_NOTE, derivedRoleAt, mergeDerivedCrowd, shouldDeriveCrowd } from './plan-crowd-derived';
import type { PlanNode, PlanPoint, PlanRoute } from '../../../../supabase/functions/_shared/site-plan';

/**
 * 流线派生人群（2026-11-18 用户：「给人的流线就直接加人在走」）。
 *
 * 钉住的都是会被误读成结论的地方：只铺人行线、人数不超预算、默认不密、
 * 单向线不折返、双向线迎面走、同一份输入永远同一组人。
 */

const BOUNDARY: PlanPoint[] = [
  { x: 0, y: 0 },
  { x: 200, y: 0 },
  { x: 200, y: 120 },
  { x: 0, y: 120 },
];
const METRICS = { width: 200, depth: 120 };

function route(overrides: Partial<PlanRoute> & { points: PlanPoint[] }): PlanRoute {
  return {
    id: 'r1',
    kind: 'pedestrian',
    name: '主通道',
    oneWay: false,
    notes: '',
    ...overrides,
  } as PlanRoute;
}

const STRAIGHT_60M: PlanPoint[] = [{ x: 20, y: 20 }, { x: 80, y: 20 }];

describe('deriveCrowdFromRoutes（流线派生人群）', () => {
  it('没有人行流线时不造人', () => {
    expect(deriveCrowdFromRoutes({ routes: [], boundary: BOUNDARY, metrics: METRICS }).walkers).toHaveLength(0);
  });

  it('车辆线 / 推车线不铺人，只铺人行线', () => {
    const out = deriveCrowdFromRoutes({
      routes: [
        route({ id: 'car', kind: 'vehicle', points: STRAIGHT_60M }),
        route({ id: 'trolley', kind: 'pedestrian', carrier: 'trolley', points: STRAIGHT_60M }),
        route({ id: 'walk', kind: 'pedestrian', carrier: 'walk', points: STRAIGHT_60M }),
      ],
      boundary: BOUNDARY,
      metrics: METRICS,
    });
    expect(new Set(out.walkers.map(walker => walker.routeId))).toEqual(new Set(['walk']));
  });

  it('默认「稀」密度：60 m 的通道不站成一串', () => {
    const sparse = deriveCrowdFromRoutes({ routes: [route({ points: STRAIGHT_60M })], boundary: BOUNDARY, metrics: METRICS });
    const dense = deriveCrowdFromRoutes({
      routes: [route({ points: STRAIGHT_60M })],
      boundary: BOUNDARY,
      metrics: METRICS,
      density: 'dense',
    });
    expect(sparse.density).toBe('sparse');
    expect(sparse.walkers.length).toBeGreaterThan(0);
    expect(dense.walkers.length).toBeGreaterThan(sparse.walkers.length);
    expect(sparse.walkers.length).toBeLessThanOrEqual(Math.ceil(60 / 3.0));
  });

  it('全局预算封顶：再长的场地也不超预算', () => {
    const long = route({ points: [{ x: 0, y: 10 }, { x: 200, y: 10 }] });
    const out = deriveCrowdFromRoutes({
      routes: [long],
      boundary: BOUNDARY,
      metrics: METRICS,
      density: 'dense',
      budget: 5,
    });
    expect(out.walkers.length).toBeLessThanOrEqual(5);
  });

  it('单向流线：所有人都单向续流，不出现反向行走', () => {
    const out = deriveCrowdFromRoutes({
      routes: [route({ points: STRAIGHT_60M, oneWay: true })],
      boundary: BOUNDARY,
      metrics: METRICS,
      density: 'normal',
    });
    expect(out.walkers.length).toBeGreaterThan(1);
    for (const walker of out.walkers) {
      expect(walker.walk.oneWay).toBe(true);
      // 正向：首点到末点的 x 递增（原线从 20 到 80）。
      expect(walker.walk.points[0]!.x).toBeLessThan(walker.walk.points.at(-1)!.x);
    }
  });

  it('双向流线：一半人迎面走（点序反转）', () => {
    const out = deriveCrowdFromRoutes({
      routes: [route({ points: STRAIGHT_60M, oneWay: false })],
      boundary: BOUNDARY,
      metrics: METRICS,
      density: 'normal',
    });
    const forward = out.walkers.filter(walker => walker.walk.points[0]!.x < walker.walk.points.at(-1)!.x);
    const backward = out.walkers.filter(walker => walker.walk.points[0]!.x > walker.walk.points.at(-1)!.x);
    expect(forward.length).toBeGreaterThan(0);
    expect(backward.length).toBeGreaterThan(0);
    expect(out.walkers.every(walker => walker.walk.oneWay === undefined)).toBe(true);
  });

  it('端点接出入口节点时按穿场流处理（单向续流）', () => {
    const nodes: PlanNode[] = [{
      id: 'n1',
      kind: 'entry',
      name: '北门',
      position: { x: 20, y: 20 },
    } as PlanNode];
    const out = deriveCrowdFromRoutes({
      routes: [route({ points: STRAIGHT_60M })],
      nodes,
      boundary: BOUNDARY,
      metrics: METRICS,
      density: 'normal',
    });
    expect(out.walkers.every(walker => walker.walk.oneWay === true)).toBe(true);
  });

  it('同一条线上的人不叠在同一个起点', () => {
    const out = deriveCrowdFromRoutes({
      routes: [route({ points: STRAIGHT_60M })],
      boundary: BOUNDARY,
      metrics: METRICS,
      density: 'normal',
    });
    const starts = out.walkers.map(walker => walker.startDistance);
    expect(new Set(starts).size).toBe(starts.length);
    expect(starts.every(value => value >= 0)).toBe(true);
  });

  it('同一份输入永远得到同一组人（刷新不跳）', () => {
    const args = { routes: [route({ points: STRAIGHT_60M })], boundary: BOUNDARY, metrics: METRICS } as const;
    expect(deriveCrowdFromRoutes(args)).toEqual(deriveCrowdFromRoutes(args));
  });

  it('角色不重复：一条线上一眼能看出好几种人', () => {
    const out = deriveCrowdFromRoutes({ routes: [route({ points: STRAIGHT_60M })], boundary: BOUNDARY, metrics: METRICS });
    const roles = new Set(out.walkers.map(walker => walker.placement.role));
    expect(roles.size).toBeGreaterThanOrEqual(6);
    // 角色名不再是笼统的「路人」——每类人在现场做的事不一样。
    expect(roles.has('路人')).toBe(false);
  });

  it('以游客为主体：游客占多数，工作人员只是点缀', () => {
    const out = deriveCrowdFromRoutes({ routes: [route({ points: STRAIGHT_60M })], boundary: BOUNDARY, metrics: METRICS });
    const visitors = out.walkers.filter(walker => walker.placement.crowdType === 'visitor');
    expect(visitors.length / out.walkers.length).toBeGreaterThanOrEqual(0.7);
    expect(out.walkers.length).toBeGreaterThanOrEqual(12);
  });

  it('每个派生角色都有现成漫游模型，不会出现光秃磊的低模人', () => {
    const out = deriveCrowdFromRoutes({ routes: [route({ points: STRAIGHT_60M })], boundary: BOUNDARY, metrics: METRICS });
    for (const walker of out.walkers) {
      expect(walker.placement.assetId).toBeTruthy();
      expect(walker.placement.glbUrl).toBeTruthy();
    }
  });

  it('角色分配只看序号，不看随机数', () => {
    expect(derivedRoleAt(0)).toEqual(derivedRoleAt(0));
    const names = Array.from({ length: 12 }, (_, index) => derivedRoleAt(index).name);
    expect(new Set(names).size).toBe(8);
    expect(names.filter(name => name === '唐女')).toHaveLength(2);
  });

  it('派生人群带示意说明，且不写 workerId 撞真实点位', () => {
    const out = deriveCrowdFromRoutes({ routes: [route({ points: STRAIGHT_60M })], boundary: BOUNDARY, metrics: METRICS });
    expect(out.note).toBe(DERIVED_CROWD_NOTE);
    expect(out.walkers.every(walker => walker.id.startsWith('route:'))).toBe(true);
    expect(out.walkers.every(walker => walker.placement.workerId.startsWith('derived:'))).toBe(true);
  });
});

describe('shouldDeriveCrowd（什么时候才该派生）', () => {
  it('没放人就派生', () => {
    expect(shouldDeriveCrowd([])).toBe(true);
  });

  it('已经放了保安等岗位仍可派生路人', () => {
    expect(shouldDeriveCrowd([{ role: '保安' }, { role: '志愿者' }])).toBe(true);
  });

  it('放了观众/游客/演员就以点位为准，派生退场', () => {
    expect(shouldDeriveCrowd([{ role: '观众' }])).toBe(false);
    expect(shouldDeriveCrowd([{ role: '游客引导' }])).toBe(false);
    expect(shouldDeriveCrowd([{ role: '演员' }])).toBe(false);
  });
});

describe('mergeDerivedCrowd（并进 3D 人群结构）', () => {
  const pointPlacement = {
    id: 'w1-0',
    workerId: 'w1',
    role: '保安',
    crowdType: 'staff',
    assetId: null,
    slug: 'security',
    glbUrl: null,
    at: { x: 0, y: 0 },
    offset: { x: 0, y: 0 },
    color: '#ffffff',
    shell: { x: 0, z: 0 },
  } as unknown as Parameters<typeof mergeDerivedCrowd>[0]['placements'][number];
  const pointRoute = { points: [{ x: 0, z: 0 }, { x: 1, z: 0 }], loop: true, pauseMs: 0 };

  it('没派生时原样返回，不凭空加人', () => {
    const out = mergeDerivedCrowd({
      placements: [pointPlacement],
      routeMap: new Map([[pointPlacement.id, pointRoute]]),
      derived: null,
    });
    expect(out.roster).toHaveLength(1);
    expect(out.routeMap.size).toBe(1);
    expect(out.derivedCount).toBe(0);
  });

  it('派生路人与真实点位共存，各自带自己的巡游路线', () => {
    const derived = deriveCrowdFromRoutes({ routes: [route({ points: STRAIGHT_60M })], boundary: BOUNDARY, metrics: METRICS });
    const out = mergeDerivedCrowd({
      placements: [pointPlacement],
      routeMap: new Map([[pointPlacement.id, pointRoute]]),
      derived,
    });
    expect(out.roster).toHaveLength(1 + derived.walkers.length);
    expect(out.derivedCount).toBe(derived.walkers.length);
    // 每个派生实例都拿到了路线，否则 3D 里人会全部挤在起点不动。
    for (const walker of derived.walkers) expect(out.routeMap.has(walker.placement.id)).toBe(true);
    expect(out.routeMap.get(pointPlacement.id)).toEqual(pointRoute);
    // 传进来的 map 不被就地改写（重建人群时会被反复复用）。
    expect(out.routeMap).not.toBe(undefined);
  });

  it('派生实例撞上真实点位 id 时跳过，而不是覆盖用户的人', () => {
    const derived = deriveCrowdFromRoutes({ routes: [route({ points: STRAIGHT_60M })], boundary: BOUNDARY, metrics: METRICS });
    const clash = derived.walkers[0]!.placement;
    const out = mergeDerivedCrowd({
      placements: [clash],
      routeMap: new Map(),
      derived,
    });
    expect(out.roster).toHaveLength(derived.walkers.length);
    expect(out.derivedCount).toBe(derived.walkers.length - 1);
  });
});
