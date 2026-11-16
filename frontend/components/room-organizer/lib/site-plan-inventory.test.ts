import { describe, expect, it } from 'vitest';
import {
  buildPlanInventory,
  filterPlanInventory,
  planInventoryKindLabel,
  type PlanInventoryRow,
} from './site-plan-inventory';
import type { SitePlanData } from '../../../../supabase/functions/_shared/site-plan';

const ZONE_A = 'a1000000-0000-4000-8000-000000000001';
const ZONE_B = 'a1000000-0000-4000-8000-000000000002';

/** 迷你样例：2 分区 + 带归属/未归属设施 + 动线（缺宽 + 越界驱动问题）+ 节点 + 人员 + 测量。 */
function samplePlan(): SitePlanData {
  return {
    schemaVersion: 1,
    boundary: [{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 120 }, { x: 0, y: 120 }],
    zones: [
      {
        id: ZONE_A,
        semantic: 'audience',
        name: '观众区',
        polygon: [{ x: 10, y: 10 }, { x: 90, y: 10 }, { x: 90, y: 55 }, { x: 10, y: 55 }],
        notes: '',
      },
      {
        id: ZONE_B,
        semantic: 'stage',
        name: '舞台区',
        polygon: [{ x: 110, y: 12 }, { x: 150, y: 12 }, { x: 150, y: 42 }, { x: 110, y: 42 }],
        notes: '',
      },
    ],
    facilities: [
      {
        id: 'b2000000-0000-4000-8000-000000000001',
        templateId: 'booth-2x2',
        name: '市集摊位 A',
        position: { x: 60, y: 80 },
        rotationDeg: 0,
        size: { width: 2, depth: 2 },
        zoneId: ZONE_A,
        notes: '',
      },
      {
        id: 'b2000000-0000-4000-8000-000000000002',
        templateId: 'tent-3x3',
        name: '后勤帐篷',
        position: { x: 180, y: 100 },
        rotationDeg: 15,
        size: { width: 3, depth: 3 },
        notes: '',
      },
      {
        id: 'b2000000-0000-4000-8000-000000000003',
        templateId: 'unknown-thing',
        name: '临时闸机',
        // 2026-11-16：人车交叉只在设施占地上才报，所以把闸机放在两线交点 (55,52) 上，
        // 让“设施上交叉”这条规则继续有夹具覆盖（人行 x=55 段 × 后勤斜线 y=10+1.2(x-20)）。
        position: { x: 55, y: 52 },
        rotationDeg: 0,
        size: { width: 4, depth: 2 },
        notes: '',
      },
    ],
    routes: [
      {
        id: 'c3000000-0000-4000-8000-000000000001',
        kind: 'pedestrian',
        name: '入场动线',
        points: [{ x: 0, y: 60 }, { x: 55, y: 60 }, { x: 55, y: 30 }],
        oneWay: true,
        startNodeId: 'd4000000-0000-4000-8000-000000000001',
        notes: '',
      },
      {
        id: 'c3000000-0000-4000-8000-000000000002',
        kind: 'service',
        // 后勤电瓶车：2026-11-16 起载体缺省为步行，这条要显式标成机动车才保持「车行」语义。
        carrier: 'vehicle',
        name: '后勤电瓶车动线',
        points: [{ x: 20, y: 10 }, { x: 70, y: 70 }],
        oneWay: false,
        notes: '',
      },
      {
        id: 'c3000000-0000-4000-8000-000000000003',
        kind: 'vehicle',
        name: '越界动线',
        points: [{ x: 190, y: 60 }, { x: 210, y: 60 }],
        oneWay: false,
        notes: '',
      },
    ],
    nodes: [
      {
        id: 'd4000000-0000-4000-8000-000000000001',
        kind: 'entry',
        name: '西门',
        position: { x: 0, y: 60 },
        notes: '',
      },
      {
        id: 'd4000000-0000-4000-8000-000000000002',
        kind: 'both',
        name: '北门（未连接）',
        position: { x: 100, y: 120 },
        notes: '',
      },
    ],
    workers: [
      {
        id: 'e5000000-0000-4000-8000-000000000001',
        role: '安保',
        count: 2,
        position: { x: 3, y: 57 },
        zoneId: ZONE_B,
        notes: '',
      },
      {
        id: 'e5000000-0000-4000-8000-000000000002',
        role: '引导员',
        count: 3,
        position: { x: 55, y: 45 },
        notes: '',
      },
    ],
    measurements: [
      {
        id: 'f6000000-0000-4000-8000-000000000001',
        kind: 'distance',
        name: '距离 1',
        points: [{ x: 0, y: 0 }, { x: 10, y: 0 }],
        notes: '',
      },
    ],
  };
}

function rowOf(rows: readonly PlanInventoryRow[], id: string): PlanInventoryRow {
  const row = rows.find(r => r.id === id);
  expect(row).toBeDefined();
  return row!;
}

describe('buildPlanInventory (H3-c 清单构建)', () => {
  it('lists all six kinds in stable order with correct type labels and metrics', () => {
    const rows = buildPlanInventory(samplePlan());
    expect(rows.map(r => r.kind)).toEqual([
      'zone', 'zone', 'facility', 'facility', 'facility',
      'route', 'route', 'route', 'node', 'node', 'worker', 'worker', 'measurement',
    ]);
    expect(rowOf(rows, ZONE_A).typeLabel).toBe('观众区');
    expect(rowOf(rows, ZONE_A).metric).toBe('3600 m²');
    expect(rowOf(rows, 'b2000000-0000-4000-8000-000000000001').typeLabel).toBe('市集摊位');
    expect(rowOf(rows, 'b2000000-0000-4000-8000-000000000001').metric).toBe('2×2 m');
    expect(rowOf(rows, 'c3000000-0000-4000-8000-000000000001').typeLabel).toBe('人行动线');
    expect(rowOf(rows, 'c3000000-0000-4000-8000-000000000001').metric).toBe('85 m');
    expect(rowOf(rows, 'd4000000-0000-4000-8000-000000000001').typeLabel).toBe('入口');
    expect(rowOf(rows, 'd4000000-0000-4000-8000-000000000001').metric).toBe('1 条动线引用');
    expect(rowOf(rows, 'e5000000-0000-4000-8000-000000000001').metric).toBe('2 人');
    expect(rowOf(rows, 'f6000000-0000-4000-8000-000000000001').typeLabel).toBe('距离');
    expect(rowOf(rows, 'f6000000-0000-4000-8000-000000000001').metric).toBe('10 m');
  });

  it('resolves zone names and unknown template fallback', () => {
    const rows = buildPlanInventory(samplePlan());
    expect(rowOf(rows, 'b2000000-0000-4000-8000-000000000001').zoneName).toBe('观众区');
    expect(rowOf(rows, 'b2000000-0000-4000-8000-000000000001').zoneId).toBe(ZONE_A);
    expect(rowOf(rows, 'b2000000-0000-4000-8000-000000000002').zoneName).toBeNull();
    expect(rowOf(rows, 'b2000000-0000-4000-8000-000000000003').typeLabel).toBe('unknown-thing');
    expect(rowOf(rows, 'e5000000-0000-4000-8000-000000000001').zoneName).toBe('舞台区');
  });

  it('adds width to route metric when widthM is known', () => {
    const plan = samplePlan();
    plan.routes[0]!.widthM = 4;
    const rows = buildPlanInventory(plan);
    expect(rowOf(rows, 'c3000000-0000-4000-8000-000000000001').metric).toBe('85 m · 宽 4 m');
  });

  it('flags rows that hit any issue list or conflict rule', () => {
    const rows = buildPlanInventory(samplePlan());
    // 后勤电瓶车动线缺宽度（missing）+ 人行动线与后勤在闸机上交叉（conflict）。
    expect(rowOf(rows, 'c3000000-0000-4000-8000-000000000002').hasIssue).toBe(true);
    expect(rowOf(rows, 'c3000000-0000-4000-8000-000000000001').hasIssue).toBe(true);
    // 越界动线在真实规则里不再报越界，但它没设宽度 → 缺宽度（missing）。
    expect(rowOf(rows, 'c3000000-0000-4000-8000-000000000003').hasIssue).toBe(true);
    // 未连接的北门（node issue）。
    expect(rowOf(rows, 'd4000000-0000-4000-8000-000000000002').hasIssue).toBe(true);
    // 正常实体与测量不带问题。
    expect(rowOf(rows, ZONE_A).hasIssue).toBe(false);
    expect(rowOf(rows, 'f6000000-0000-4000-8000-000000000001').hasIssue).toBe(false);
  });

  it('anchors zones at vertex centroid and routes at the half-length point', () => {
    const rows = buildPlanInventory(samplePlan());
    expect(rowOf(rows, ZONE_A).anchor).toEqual({ x: 50, y: 32.5 });
    // 85 m 折线半长 42.5 m 落在第一段（0,60）→（55,60）内。
    expect(rowOf(rows, 'c3000000-0000-4000-8000-000000000001').anchor).toEqual({ x: 42.5, y: 60 });
    expect(rowOf(rows, 'b2000000-0000-4000-8000-000000000001').anchor).toEqual({ x: 60, y: 80 });
    expect(rowOf(rows, 'f6000000-0000-4000-8000-000000000001').anchor).toEqual({ x: 0, y: 0 });
  });
});

/** 车辆夹具（2026-11-16 #122）：一台待补模型的大巴 + 一台有模型的货车。 */
function planWithVehicles(): SitePlanData {
  const plan = samplePlan();
  plan.vehicles = [
    { id: 'aa000000-0000-4000-8000-000000000001', type: 'coach', count: 3, position: { x: 20, y: 100 }, notes: '司机待命' },
    { id: 'aa000000-0000-4000-8000-000000000002', type: 'truck', count: 1, position: { x: 180, y: 20 }, modelSlug: 'car-park-and-road-vehicle-fleet-box-truck-4574c765', zoneId: ZONE_A, notes: '' },
  ];
  return plan;
}

describe('buildPlanInventory 车辆行（#122）', () => {
  it('lists vehicles with a 台数 metric after 人员 and before 测量', () => {
    const rows = buildPlanInventory(planWithVehicles());
    expect(rows.map(r => r.kind)).toEqual([
      'zone', 'zone', 'facility', 'facility', 'facility',
      'route', 'route', 'route', 'node', 'node', 'worker', 'worker',
      'vehicle', 'vehicle', 'measurement',
    ]);
    const coach = rowOf(rows, 'aa000000-0000-4000-8000-000000000001');
    expect(coach.kind).toBe('vehicle');
    expect(coach.typeLabel).toBe('车辆');
    expect(coach.name).toBe('服务大巴车（待补模型）');
    expect(coach.metric).toBe('3 台');
    expect(coach.anchor).toEqual({ x: 20, y: 100 });
    expect(coach.zoneName).toBeNull();
    const truck = rowOf(rows, 'aa000000-0000-4000-8000-000000000002');
    expect(truck.name).toBe('货车');
    expect(truck.metric).toBe('1 台');
    expect(truck.zoneName).toBe('观众区');
  });

  it('never blends 台数 into people rows and never writes 人 into vehicle rows', () => {
    const rows = buildPlanInventory(planWithVehicles());
    const workerRows = rows.filter(r => r.kind === 'worker');
    expect(workerRows.map(r => r.metric)).toEqual(['2 人', '3 人']);
    expect(rows.filter(r => r.kind === 'vehicle').every(r => r.metric.endsWith(' 台'))).toBe(true);
    expect(rows.filter(r => r.kind === 'vehicle').every(r => !r.metric.includes('人'))).toBe(true);
  });

  it('leaves legacy plans without vehicles byte-identical', () => {
    const legacy = buildPlanInventory(samplePlan());
    expect(legacy.map(r => r.kind)).toEqual([
      'zone', 'zone', 'facility', 'facility', 'facility',
      'route', 'route', 'route', 'node', 'node', 'worker', 'worker', 'measurement',
    ]);
    expect(legacy.some(r => r.kind === 'vehicle')).toBe(false);
    // 旧快照（无 vehicles 字段）与显式空数组两份输出逐字段相同。
    expect(buildPlanInventory({ ...samplePlan(), vehicles: [] })).toEqual(legacy);
  });
});

describe('filterPlanInventory (H3-c 清单筛选)', () => {
  const rows = buildPlanInventory(samplePlan());

  it('filters by kind', () => {
    const facilities = filterPlanInventory(rows, { kind: 'facility' });
    expect(facilities).toHaveLength(3);
    expect(facilities.every(r => r.kind === 'facility')).toBe(true);
    expect(filterPlanInventory(rows, { kind: 'measurement' })).toHaveLength(1);
    expect(filterPlanInventory(rows, {})).toHaveLength(rows.length);
  });

  it('filters by zone for assignable entities only', () => {
    const inZoneA = filterPlanInventory(rows, { zone: ZONE_A });
    expect(inZoneA.map(r => r.id)).toEqual(['b2000000-0000-4000-8000-000000000001']);
    const unassigned = filterPlanInventory(rows, { zone: 'unassigned' });
    expect(unassigned.map(r => r.id).sort()).toEqual([
      'b2000000-0000-4000-8000-000000000002',
      'b2000000-0000-4000-8000-000000000003',
      'e5000000-0000-4000-8000-000000000002',
    ]);
  });

  it('filters issues-only rows', () => {
    const issues = filterPlanInventory(rows, { issuesOnly: true });
    expect(issues.map(r => r.id).sort()).toEqual([
      'c3000000-0000-4000-8000-000000000001',
      'c3000000-0000-4000-8000-000000000002',
      'c3000000-0000-4000-8000-000000000003',
      'd4000000-0000-4000-8000-000000000002',
    ]);
  });

  it('combines kind × zone × issues filters', () => {
    const combined = filterPlanInventory(rows, { kind: 'facility', zone: 'unassigned', issuesOnly: true });
    expect(combined).toHaveLength(0);
    const routeIssues = filterPlanInventory(rows, { kind: 'route', issuesOnly: true });
    expect(routeIssues).toHaveLength(3);
  });
});

describe('planInventoryKindLabel', () => {
  it('exposes stable Chinese labels for the filter dropdown', () => {
    expect(planInventoryKindLabel('zone')).toBe('分区');
    expect(planInventoryKindLabel('facility')).toBe('设施');
    expect(planInventoryKindLabel('route')).toBe('动线');
    expect(planInventoryKindLabel('node')).toBe('出入口');
    expect(planInventoryKindLabel('worker')).toBe('人员');
    // 2026-11-16 #122：车辆是独立类型行。
    expect(planInventoryKindLabel('vehicle')).toBe('车辆');
    expect(planInventoryKindLabel('measurement')).toBe('测量');
  });
});
