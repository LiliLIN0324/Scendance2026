import { describe, expect, it } from 'vitest';
import {
  PLAN_AUDIENCE_AREA_PER_PERSON_M2,
  PLAN_COLLINEAR_MIN_LENGTH_M,
  PLAN_CONFLICT_CATEGORY_LABELS,
  PLAN_CONFLICT_DEFAULT_STATUSES,
  groupConflictIssues,
  planConflictCount,
  planConflictIssues,
  type PlanConflictIssue,
} from './site-plan-conflicts';
import { planOverviewStats } from './site-plan-measure';
import type { PlanFacility, PlanNode, PlanPoint, PlanRoute, PlanZone, SitePlanData } from '../../../../supabase/functions/_shared/site-plan';

/* ---------------- 夹具 ---------------- */

const BOUNDARY = [
  { x: 0, y: 0 },
  { x: 200, y: 0 },
  { x: 200, y: 120 },
  { x: 0, y: 120 },
];

/** 非凸 L 形边界：下带全宽 + 左上立柱，右上门洞（x>100 且 y>60）在界外。 */
const L_BOUNDARY = [
  { x: 0, y: 0 },
  { x: 200, y: 0 },
  { x: 200, y: 60 },
  { x: 100, y: 60 },
  { x: 100, y: 120 },
  { x: 0, y: 120 },
];

const NO_NODES: PlanNode[] = [];
const NO_ZONES: PlanZone[] = [];

function route(partial: Partial<PlanRoute> & { id: string; kind: PlanRoute['kind']; points: PlanPoint[] }): PlanRoute {
  return { name: partial.name ?? partial.id, oneWay: false, notes: '', ...partial } as PlanRoute;
}

function issuesFor(
  routes: PlanRoute[],
  opts: { boundary?: PlanPoint[]; zones?: PlanZone[]; nodes?: PlanNode[]; facilities?: PlanFacility[] } = {},
): PlanConflictIssue[] {
  return planConflictIssues({
    boundary: opts.boundary ?? BOUNDARY,
    zones: opts.zones ?? NO_ZONES,
    facilities: opts.facilities ?? [],
    routes,
    nodes: opts.nodes ?? NO_NODES,
  });
}

function byCategory(issues: PlanConflictIssue[], category: PlanConflictIssue['category']): PlanConflictIssue[] {
  return issues.filter(i => i.category === category);
}

/* ---------------- 1) 人车交叉（仅设施占地上才报） ---------------- */

/** 占地 6×6 的设施（默认盖住两线交叉点 55,20）。 */
function hallAt(position: PlanPoint) {
  return {
    id: 'f-hall',
    templateId: 'hall-6x6',
    name: '候场棚',
    position,
    rotationDeg: 0,
    size: { width: 6, depth: 6 },
    notes: '',
  } as unknown as PlanFacility;
}

describe('pedestrian-vehicle centerline crossing (H3-b)', () => {
  it('stays quiet on a plain crossing, and only flags it when it lands on a facility footprint', () => {
    // 2026-11-16 用户：「人车交叉没问题。除非是踩在设施上了」。
    const plain = issuesFor([
      route({ id: 'r-ped', kind: 'pedestrian', points: [{ x: 10, y: 20 }, { x: 100, y: 20 }] }),
      route({ id: 'r-veh', kind: 'vehicle', points: [{ x: 55, y: 0 }, { x: 55, y: 80 }] }),
    ]);
    expect(byCategory(plain, 'route-crossing')).toHaveLength(0);

    const onFacility = issuesFor(
      [
        route({ id: 'r-ped', kind: 'pedestrian', points: [{ x: 10, y: 20 }, { x: 100, y: 20 }] }),
        route({ id: 'r-veh', kind: 'vehicle', points: [{ x: 55, y: 0 }, { x: 55, y: 80 }] }),
      ],
      { facilities: [hallAt({ x: 55, y: 20 })] },
    );
    const crossings = byCategory(onFacility, 'route-crossing');
    expect(crossings).toHaveLength(1);
    expect(crossings[0]!.status).toBe('conflict');
    expect(crossings[0]!.at).toEqual({ x: 55, y: 20 });
    expect(crossings[0]!.routeIds).toEqual(['r-ped', 'r-veh']);
    expect(crossings[0]!.facilityId).toBe('f-hall');
    expect(crossings[0]!.message).toContain('候场棚');

    // 设施离交叉点较远 → 不报。
    const farFacility = issuesFor(
      [
        route({ id: 'r-ped', kind: 'pedestrian', points: [{ x: 10, y: 20 }, { x: 100, y: 20 }] }),
        route({ id: 'r-veh', kind: 'vehicle', points: [{ x: 55, y: 0 }, { x: 55, y: 80 }] }),
      ],
      { facilities: [hallAt({ x: 55, y: 45 })] },
    );
    expect(byCategory(farFacility, 'route-crossing')).toHaveLength(0);
  });

  it('does not flag endpoint touches or same-kind crossings (strict crossing only)', () => {
    // 共享端点触碰：人行动线终点 = 车辆动线终点（不严格穿越）。
    const touch = issuesFor([
      route({ id: 'r-ped', kind: 'pedestrian', points: [{ x: 10, y: 20 }, { x: 55, y: 20 }] }),
      route({ id: 'r-veh', kind: 'vehicle', points: [{ x: 55, y: 0 }, { x: 55, y: 80 }] }),
    ]);
    expect(byCategory(touch, 'route-crossing')).toHaveLength(0);
    // 同类交叉：人行 × 人行几何上相交，但不是「人车交叉」。
    const pedPed = issuesFor([
      route({ id: 'r-p1', kind: 'pedestrian', points: [{ x: 10, y: 20 }, { x: 100, y: 20 }] }),
      route({ id: 'r-p2', kind: 'pedestrian', points: [{ x: 55, y: 0 }, { x: 55, y: 80 }] }),
    ]);
    expect(byCategory(pedPed, 'route-crossing')).toHaveLength(0);
    // 车辆 × 后勤同类交叉同样不报（两条都标了 vehicle，同载体）。
    const vehSvc = issuesFor([
      route({ id: 'r-v1', kind: 'vehicle', points: [{ x: 10, y: 40 }, { x: 100, y: 40 }] }),
      route({ id: 'r-s1', kind: 'service', carrier: 'vehicle', points: [{ x: 55, y: 10 }, { x: 55, y: 90 }] }),
    ]);
    expect(byCategory(vehSvc, 'route-crossing')).toHaveLength(0);
  });

  it('judges service routes by carrier：缺省人车一起，标 walk 才算纯人行（2026-11-16）', () => {
    const crossing = (carrier?: 'walk' | 'trolley' | 'vehicle' | 'mixed') => issuesFor(
      [
        route({ id: 'r-ped', kind: 'pedestrian', points: [{ x: 10, y: 20 }, { x: 100, y: 20 }] }),
        route({ id: 'r-svc', kind: 'service', ...(carrier ? { carrier } : {}), points: [{ x: 55, y: 0 }, { x: 55, y: 80 }] }),
      ],
      { facilities: [hallAt({ x: 55, y: 20 })] },
    );
    // 缺省：后勤当「人车一起」，与人行不同载体，要报。
    expect(byCategory(crossing(), 'route-crossing')).toHaveLength(1);
    // 显式标成纯人行：与人行同载体，不报。
    expect(byCategory(crossing('walk'), 'route-crossing')).toHaveLength(0);
    // 标成机动车或推车：不同载体，同样要报。
    expect(byCategory(crossing('vehicle'), 'route-crossing')).toHaveLength(1);
    expect(byCategory(crossing('trolley'), 'route-crossing')).toHaveLength(1);
  });

  it('exempts crossings at a node declared by both routes (声明允许的共享节点)', () => {
    const sharedNode: PlanNode = {
      id: 'n-shared',
      kind: 'both',
      name: '共用门',
      position: { x: 55, y: 20 },
      notes: '',
    };
    const bothDeclared = issuesFor(
      [
        route({ id: 'r-ped', kind: 'pedestrian', points: [{ x: 10, y: 20 }, { x: 100, y: 20 }], startNodeId: 'n-shared' }),
        route({ id: 'r-veh', kind: 'vehicle', points: [{ x: 55, y: 0 }, { x: 55, y: 80 }], startNodeId: 'n-shared' }),
      ],
      { nodes: [sharedNode], facilities: [hallAt({ x: 55, y: 20 })] },
    );
    expect(byCategory(bothDeclared, 'route-crossing')).toHaveLength(0);
    // 只有一条声明 → 不豁免（共用入口必须双方声明）。
    const oneDeclared = issuesFor(
      [
        route({ id: 'r-ped', kind: 'pedestrian', points: [{ x: 10, y: 20 }, { x: 100, y: 20 }], startNodeId: 'n-shared' }),
        route({ id: 'r-veh', kind: 'vehicle', points: [{ x: 55, y: 0 }, { x: 55, y: 80 }] }),
      ],
      { nodes: [sharedNode], facilities: [hallAt({ x: 55, y: 20 })] },
    );
    expect(byCategory(oneDeclared, 'route-crossing')).toHaveLength(1);
  });
});

/* ---------------- 2) 共线重叠（单独分类） ---------------- */

describe('collinear overlap (H3-b)', () => {
  it('flags collinear overlap with the overlap midpoint, separate from crossing', () => {
    const issues = issuesFor([
      route({ id: 'r-ped', kind: 'pedestrian', points: [{ x: 10, y: 20 }, { x: 110, y: 20 }] }),
      route({ id: 'r-veh', kind: 'vehicle', points: [{ x: 30, y: 20 }, { x: 90, y: 20 }] }),
    ]);
    expect(byCategory(issues, 'route-crossing')).toHaveLength(0);
    const collinear = byCategory(issues, 'route-collinear');
    expect(collinear).toHaveLength(1);
    expect(collinear[0]!.at).toEqual({ x: 60, y: 20 });
    expect(collinear[0]!.status).toBe('conflict');
  });

  it('ignores short parallel touches below the minimum overlap length', () => {
    const issues = issuesFor([
      route({ id: 'r-ped', kind: 'pedestrian', points: [{ x: 10, y: 20 }, { x: 110, y: 20 }] }),
      route({ id: 'r-veh', kind: 'vehicle', points: [{ x: 30, y: 20 }, { x: 30 + PLAN_COLLINEAR_MIN_LENGTH_M - 0.1, y: 20 }] }),
    ]);
    expect(byCategory(issues, 'route-collinear')).toHaveLength(0);
    expect(byCategory(issues, 'route-crossing')).toHaveLength(0);
  });
});

/* ---------------- 3) 通行带与设施占地相交（宽度已知） ---------------- */

describe('known-width corridor vs facility footprint (H3-b)', () => {
  const booth = {
    id: 'f-booth',
    templateId: 'booth-2x2',
    name: '市集摊位',
    position: { x: 60, y: 21 },
    rotationDeg: 0,
    size: { width: 2, depth: 2 },
    notes: '',
  };

  function withFacility(routes: PlanRoute[], facilities: typeof booth[]) {
    return planConflictIssues({ boundary: BOUNDARY, zones: NO_ZONES, facilities, routes, nodes: NO_NODES });
  }

  it('flags a facility whose footprint reaches into a known-width corridor', () => {
    const issues = withFacility(
      [route({ id: 'r-veh', kind: 'vehicle', points: [{ x: 10, y: 20 }, { x: 110, y: 20 }], widthM: 4 })],
      [booth],
    );
    const hits = byCategory(issues, 'route-facility-collision');
    expect(hits).toHaveLength(1);
    expect(hits[0]!.facilityId).toBe('f-booth');
    expect(hits[0]!.routeIds).toEqual(['r-veh']);
    // 标记定位在通行带上距设施最近的点：设施中心 (60,21) → 通行带 (60,20)。
    expect(hits[0]!.at.x).toBeCloseTo(60, 6);
    expect(hits[0]!.at.y).toBeCloseTo(20, 6);
    expect(hits[0]!.message).toContain('4 m');
  });

  it('does not flag facilities clear of the corridor, nor routes without width', () => {
    const clear = withFacility(
      [route({ id: 'r-veh', kind: 'vehicle', points: [{ x: 10, y: 20 }, { x: 110, y: 20 }], widthM: 4 })],
      [{ ...booth, position: { x: 60, y: 30 } }],
    );
    expect(byCategory(clear, 'route-facility-collision')).toHaveLength(0);
    // 缺宽度的动线不参与走廊判定（通行带未评估）。
    const noWidth = withFacility(
      [route({ id: 'r-veh', kind: 'vehicle', points: [{ x: 10, y: 20 }, { x: 110, y: 20 }] })],
      [booth],
    );
    expect(byCategory(noWidth, 'route-facility-collision')).toHaveLength(0);
  });
});

/* ---------------- 4) 动线越界：不再报（2026-11-15 用户拍掉） ---------------- */

describe('route out-of-boundary is not a conflict any more (2026-11-15)', () => {
  it('keeps a route that starts outside the boundary quiet（场外走进来是常态）', () => {
    // 从界外 10 m 处走到界内：原来会报「有顶点落在场地边界之外」，现在不该再出现。
    const issues = issuesFor([
      route({ id: 'r-veh', kind: 'vehicle', points: [{ x: 10, y: 20 }, { x: 210, y: 20 }] }),
    ]);
    expect(issues.some(issue => issue.category === 'route-out-of-boundary' as never)).toBe(false);
    // 也不该以其它的名义重复报一遍越界。
    expect(issues.some(issue => issue.message.includes('边界之外'))).toBe(false);
  });

  it('keeps a route that cuts across a concave boundary quiet', () => {
    const issues = issuesFor(
      [route({ id: 'r-ped', kind: 'pedestrian', points: [{ x: 80, y: 90 }, { x: 190, y: 30 }] })],
      { boundary: L_BOUNDARY },
    );
    expect(issues.some(issue => issue.message.includes('穿出'))).toBe(false);
  });

  it('still flags the real problems on such a route（缺宽度照旧）', () => {
    const issues = issuesFor([
      route({ id: 'r-veh', kind: 'vehicle', points: [{ x: -40, y: 20 }, { x: 110, y: 20 }] }),
    ]);
    expect(byCategory(issues, 'route-missing-width')).toHaveLength(1);
    expect(issues.every(issue => issue.status !== 'conflict')).toBe(true);
  });
});

/* ---------------- 5) 缺宽度（缺失项） ---------------- */

describe('missing width (H3-b)', () => {
  it('只对非步行载体报缺宽度（vehicle / trolley / 缺省后勤），纯步行不报', () => {
    const issues = issuesFor([
      route({ id: 'r-veh', kind: 'vehicle', points: [{ x: 10, y: 20 }, { x: 110, y: 20 }, { x: 110, y: 80 }] }),
      route({ id: 'r-svc', kind: 'service', carrier: 'vehicle', points: [{ x: 20, y: 10 }, { x: 70, y: 70 }] }),
    ]);
    const missing = byCategory(issues, 'route-missing-width');
    expect(missing).toHaveLength(2);
    expect(missing.every(i => i.status === 'missing')).toBe(true);
    expect(missing.map(i => i.at)).toEqual([
      { x: 110, y: 20 }, // 3 点折线的中点顶点。
      { x: 70, y: 70 }, // 2 点折线取 floor(2/2)=1 号顶点。
    ]);
    expect(missing[0]!.message).toContain('未评估');
  });

  it('does not require width for pedestrian routes, and skips routes with width', () => {
    const issues = issuesFor([
      route({ id: 'r-ped', kind: 'pedestrian', points: [{ x: 10, y: 20 }, { x: 110, y: 20 }] }),
      route({ id: 'r-veh', kind: 'vehicle', points: [{ x: 10, y: 20 }, { x: 110, y: 20 }], widthM: 6 }),
    ]);
    expect(byCategory(issues, 'route-missing-width')).toHaveLength(0);
  });
});

/* ---------------- 6) 容量待核实 ---------------- */

describe('audience capacity estimate (H3-b)', () => {
  const audienceZone: PlanZone = {
    id: 'z-aud',
    semantic: 'audience',
    name: '观众区',
    polygon: [{ x: 10, y: 10 }, { x: 90, y: 10 }, { x: 90, y: 55 }, { x: 10, y: 55 }],
    notes: '',
  };

  it('emits an unverified capacity estimate per audience zone (规划假设口径)', () => {
    const issues = issuesFor([], { zones: [audienceZone] });
    const caps = byCategory(issues, 'capacity-unverified');
    expect(caps).toHaveLength(1);
    expect(caps[0]!.status).toBe('unverified');
    expect(caps[0]!.zoneId).toBe('z-aud');
    expect(caps[0]!.at).toEqual({ x: 50, y: 10 }); // 首两顶点中点（分区标注同口径）。
    expect(caps[0]!.message).toContain('3600 人'); // 80×45 = 3600 m² ÷ 1 m²/人。
    expect(caps[0]!.message).toContain('待核实');
  });

  it('only estimates audience zones (其他语义不产容量项)', () => {
    const stageZone: PlanZone = { ...audienceZone, id: 'z-stage', semantic: 'stage', name: '舞台区' };
    expect(byCategory(issuesFor([], { zones: [stageZone] }), 'capacity-unverified')).toHaveLength(0);
  });

  it('documents the planning-assumption density constant (非法规口径)', () => {
    expect(PLAN_AUDIENCE_AREA_PER_PERSON_M2).toBeGreaterThan(0);
    expect(PLAN_CONFLICT_CATEGORY_LABELS['capacity-unverified']).toBe('容量待核实');
  });
});

/* ---------------- 稳定性与统计接线 ---------------- */

describe('conflict issue stability & stats wiring (H3-b)', () => {
  const audienceZone: PlanZone = {
    id: 'z-aud',
    semantic: 'audience',
    name: '观众区',
    polygon: [{ x: 10, y: 10 }, { x: 90, y: 10 }, { x: 90, y: 55 }, { x: 10, y: 55 }],
    notes: '',
  };
  const mixedPlan = (): SitePlanData => ({
    schemaVersion: 1,
    boundary: BOUNDARY,
    zones: [audienceZone],
    // 人车交叉只在设施占地上才报，所以给交叉点 (55,20) 放一个棚。
    facilities: [hallAt({ x: 55, y: 20 })],
    routes: [
      route({ id: 'r-ped', kind: 'pedestrian', points: [{ x: 10, y: 20 }, { x: 100, y: 20 }] }),
      route({ id: 'r-veh', kind: 'vehicle', points: [{ x: 55, y: 0 }, { x: 55, y: 80 }] }),
    ],
    nodes: NO_NODES,
    workers: [],
  });

  it('returns a deterministic, key-unique list in rule order', () => {
    const first = planConflictIssues(mixedPlan());
    const second = planConflictIssues(mixedPlan());
    expect(first).toEqual(second);
    const keys = first.map(i => i.key);
    expect(new Set(keys).size).toBe(keys.length);
    // 规则顺序：交叉 → 缺宽度 → 容量（夹具无共线/走廊/越界；人行不查宽度）。
    expect(first.map(i => i.category)).toEqual(['route-crossing', 'route-missing-width', 'capacity-unverified']);
  });

  it('counts conflicts for the overview stats without touching entity issueCount', () => {
    const stats = planOverviewStats(mixedPlan());
    expect(stats.conflictCount).toBe(planConflictIssues(mixedPlan()).length);
    expect(stats.conflictCount).toBeGreaterThan(0);
  });

  it('planConflictCount matches the issue list length', () => {
    expect(planConflictCount(mixedPlan())).toBe(planConflictIssues(mixedPlan()).length);
  });
});

describe('groupConflictIssues（同一条线的问题合并成一枚徽章）', () => {
  it('一条动线上的多条问题合成一组：枚数、最严重状态与徽章落点取最严重那条', () => {
    const issues = planConflictIssues({
      boundary: BOUNDARY,
      zones: NO_ZONES,
      // 后勤线缺宽度（missing）× 与人在设施上交叉（conflict）。
      // 交叉问题按 routeIds[0] 归属（交叉只挂前一条线，不在两条上各报一次），
      // 所以把后勤线放在前面，才能让它同时拿到「交叉 + 缺宽度」两条。
      // （原先还有「越界」凑第三条，2026-11-15 这条规则已按用户意见移除；
      //   2026-11-16 也收窄了交叉——只有踩在设施占地上才算冲突。）
      facilities: [hallAt({ x: 60, y: 60 })],
      routes: [
        route({ id: 'r-svc', kind: 'service', carrier: 'vehicle', points: [{ x: 60, y: 10 }, { x: 60, y: 130 }] }),
        route({ id: 'r-ped', kind: 'pedestrian', points: [{ x: 10, y: 60 }, { x: 190, y: 60 }] }),
      ],
      nodes: NO_NODES,
    });
    const clusters = groupConflictIssues(issues);
    const svc = clusters.find(cluster => cluster.key === 'route:r-svc')!;
    expect(svc.count).toBe(svc.issues.length);
    expect(svc.count).toBeGreaterThan(1);
    // 组内按严重度降序：冲突在前，缺宽度在后。
    expect(svc.issues[0]!.status).toBe('conflict');
    expect(svc.status).toBe('conflict');
    expect(svc.at).toEqual(svc.issues[0]!.at);
    expect(svc.issues.at(-1)!.status).toBe('missing');
  });

  it('不同对象各占一枚，量数等于关联对象数而不是问题条数', () => {
    const issues = planConflictIssues({
      boundary: BOUNDARY,
      zones: [{
        id: 'z-aud',
        semantic: 'audience',
        name: '观众区',
        polygon: [{ x: 10, y: 10 }, { x: 90, y: 10 }, { x: 90, y: 55 }, { x: 10, y: 55 }],
        notes: '',
      }],
      facilities: [hallAt({ x: 55, y: 20 })],
      routes: [
        route({ id: 'r-ped', kind: 'pedestrian', points: [{ x: 10, y: 20 }, { x: 100, y: 20 }] }),
        route({ id: 'r-veh', kind: 'vehicle', points: [{ x: 55, y: 0 }, { x: 55, y: 80 }] }),
      ],
      nodes: NO_NODES,
    });
    const clusters = groupConflictIssues(issues);
    // 交叉挂在人行线上、缺宽度挂在车行线上、容量挂在分区上：三枚。
    expect(clusters).toHaveLength(3);
    expect(clusters.map(cluster => cluster.key)).toEqual(['route:r-ped', 'route:r-veh', 'zone:z-aud']);
    // 默认上图只算真冲突：缺宽度（橙）和容量待核实（灰）都是提示，默认不上图但不影响总数。
    expect(clusters.filter(cluster => !PLAN_CONFLICT_DEFAULT_STATUSES.includes(cluster.status)).map(cluster => cluster.key)).toEqual(['route:r-veh', 'zone:z-aud']);
    expect(clusters.reduce((sum, cluster) => sum + cluster.count, 0)).toBe(issues.length);
  });

  it('空的输入得到空的分组（不造占位徽章）', () => {
    expect(groupConflictIssues([])).toEqual([]);
  });
});
