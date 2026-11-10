import { describe, expect, it } from 'vitest';
import {
  PLAN_MEASURE_MAX_VERTICES,
  buildMeasurement,
  formatAreaM2,
  formatLengthM,
  measureDraftReadout,
  measureValue,
  planOverviewStats,
} from './site-plan-measure';
import { planFacilityIssues } from './site-plan-facilities';
import { planNodeIssues, planWorkerIssues } from './site-plan-routes';
import { planZoneIssues, type PlanEditIssue } from './site-plan-editing';
import { sitePlanDataSchema, type SitePlanData } from '../../../../supabase/functions/_shared/site-plan';

/* ---------------- 米制读数（评审稿验收锚：5 m / 100 m² / 20 m，缩放无关） ---------------- */

describe('metric measurement readouts (H3-a)', () => {
  it('measures the 3-4-5 triangle as exactly 5 m', () => {
    const result = buildMeasurement({
      kind: 'distance',
      name: '距离 1',
      points: [{ x: 0, y: 0 }, { x: 3, y: 4 }],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(measureValue(result.value)).toBeCloseTo(5, 9);
    expect(formatLengthM(measureValue(result.value))).toBe('5 m');
  });

  it('measures the 10×10 area as exactly 100 m²', () => {
    const result = buildMeasurement({
      kind: 'area',
      name: '面积 1',
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
        { x: 0, y: 10 },
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(measureValue(result.value)).toBeCloseTo(100, 9);
    expect(formatAreaM2(measureValue(result.value))).toBe('100 m²');
  });

  it('measures a two-segment 10 m path as exactly 20 m', () => {
    const result = buildMeasurement({
      kind: 'path',
      name: '路径 1',
      points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(measureValue(result.value)).toBeCloseTo(20, 9);
    expect(formatLengthM(measureValue(result.value))).toBe('20 m');
  });

  it('formats fractional readouts with at most one decimal', () => {
    expect(formatLengthM(4.25)).toBe('4.3 m');
    expect(formatLengthM(4.24)).toBe('4.2 m');
    expect(formatAreaM2(1234.56)).toBe('1234.6 m²');
    expect(formatLengthM(0)).toBe('0 m');
  });
});

/* ---------------- 固定测量提交校验 ---------------- */

describe('buildMeasurement validation (H3-a)', () => {
  function buildOrIssue(input: Parameters<typeof buildMeasurement>[0]): PlanEditIssue {
    const result = buildMeasurement(input);
    expect(result.ok).toBe(false);
    return (result as { ok: false; issue: PlanEditIssue }).issue;
  }

  it('rejects a distance measurement that is not exactly two points', () => {
    expect(buildOrIssue({ kind: 'distance', name: '距离 1', points: [{ x: 0, y: 0 }] }).code).toBe('too-few-vertices');
    expect(buildOrIssue({
      kind: 'distance',
      name: '距离 1',
      points: [{ x: 0, y: 0 }, { x: 3, y: 4 }, { x: 6, y: 8 }],
    }).code).toBe('too-many-vertices');
  });

  it('rejects an area measurement with fewer than 3 points or a self-intersecting outline', () => {
    expect(buildOrIssue({ kind: 'area', name: '面积 1', points: [{ x: 0, y: 0 }, { x: 10, y: 0 }] }).code).toBe('too-few-vertices');
    expect(buildOrIssue({
      kind: 'area',
      name: '面积 1',
      points: [{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 10, y: 0 }, { x: 0, y: 10 }],
    }).code).toBe('self-intersection');
  });

  it('rejects a path measurement with fewer than 2 points', () => {
    expect(buildOrIssue({ kind: 'path', name: '路径 1', points: [{ x: 0, y: 0 }] }).code).toBe('too-few-vertices');
  });

  it('rejects duplicate adjacent vertices and out-of-range points', () => {
    expect(buildOrIssue({
      kind: 'path',
      name: '路径 1',
      points: [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 5, y: 0 }],
    }).code).toBe('duplicate-vertex');
    expect(buildOrIssue({
      kind: 'path',
      name: '路径 1',
      points: [{ x: 0, y: 0 }, { x: 5001, y: 0 }],
    }).code).toBe('out-of-range');
  });

  it('caps measurement vertices at the contract limit', () => {
    expect(PLAN_MEASURE_MAX_VERTICES).toBe(64);
    const tooMany = Array.from({ length: 65 }, (_, i) => ({ x: i, y: (i % 2) as number }));
    const issue = buildOrIssue({ kind: 'path', name: '路径 1', points: tooMany });
    expect(issue.code).toBe('too-many-vertices');
  });
});

/* ---------------- 临时测量：草稿实时读数 ---------------- */

describe('measureDraftReadout (临时测量)', () => {
  it('shows the live segment length for a distance draft', () => {
    expect(measureDraftReadout('distance', [{ x: 0, y: 0 }], { x: 3, y: 4 })).toBe('5 m');
    expect(measureDraftReadout('distance', [{ x: 0, y: 0 }, { x: 3, y: 4 }])).toBe('5 m');
    expect(measureDraftReadout('distance', [])).toBeNull();
    expect(measureDraftReadout('distance', [], { x: 1, y: 1 })).toBeNull();
  });

  it('shows the accumulated length for a path draft', () => {
    expect(measureDraftReadout('path', [{ x: 0, y: 0 }, { x: 10, y: 0 }], { x: 10, y: 10 })).toBe('20 m');
    expect(measureDraftReadout('path', [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }])).toBe('20 m');
    expect(measureDraftReadout('path', [{ x: 0, y: 0 }])).toBeNull();
  });

  it('shows the closed preview area for an area draft', () => {
    expect(measureDraftReadout(
      'area',
      [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }],
      { x: 0, y: 10 },
    )).toBe('100 m²');
    expect(measureDraftReadout('area', [{ x: 0, y: 0 }, { x: 10, y: 0 }])).toBeNull();
    expect(measureDraftReadout('area', [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }])).toBe('50 m²');
  });
});

/* ---------------- 派生统计（全案顶层口径） ---------------- */

function statsPlan(): SitePlanData {
  return {
    schemaVersion: 1,
    boundary: [
      { x: 0, y: 0 },
      { x: 200, y: 0 },
      { x: 200, y: 120 },
      { x: 0, y: 120 },
    ],
    zones: [
      {
        id: 'a1000000-0000-4000-8000-000000000001',
        semantic: 'audience',
        name: '观众区',
        polygon: [{ x: 10, y: 10 }, { x: 90, y: 10 }, { x: 90, y: 55 }, { x: 10, y: 55 }],
        notes: '',
      },
      {
        // 越界分区：顶点在边界外 → 恰好 1 条分区问题。
        id: 'a1000000-0000-4000-8000-000000000002',
        semantic: 'parking',
        name: '越界停车区',
        polygon: [{ x: 190, y: 110 }, { x: 220, y: 110 }, { x: 220, y: 140 }, { x: 190, y: 140 }],
        notes: '',
      },
    ],
    facilities: [
      {
        id: 'b2000000-0000-4000-8000-000000000001',
        templateId: 'booth-2x2',
        name: '摊位 A',
        position: { x: 60, y: 80 },
        rotationDeg: 0,
        size: { width: 2, depth: 2 },
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
        kind: 'vehicle',
        name: '装卸动线',
        points: [{ x: 200, y: 60 }, { x: 160, y: 60 }, { x: 160, y: 95 }],
        oneWay: false,
        notes: '',
      },
      {
        id: 'c3000000-0000-4000-8000-000000000003',
        kind: 'service',
        name: '后勤动线',
        points: [{ x: 10, y: 110 }, { x: 30, y: 110 }],
        oneWay: false,
        notes: '',
      },
    ],
    nodes: [
      // 节点 1 被两条动线引用（起点）；节点 2 孤立 → 恰好 1 条节点问题。
      { id: 'd4000000-0000-4000-8000-000000000001', kind: 'entry', name: '西门', position: { x: 0, y: 60 }, notes: '' },
      { id: 'd4000000-0000-4000-8000-000000000002', kind: 'exit', name: '东出口', position: { x: 200, y: 60 }, notes: '' },
    ],
    workers: [
      { id: 'e5000000-0000-4000-8000-000000000001', role: '安保', count: 2, position: { x: 3, y: 57 }, notes: '' },
      { id: 'e5000000-0000-4000-8000-000000000002', role: '引导员', count: 1, position: { x: 195, y: 97 }, notes: '' },
    ],
    measurements: [
      {
        id: 'f6000000-0000-4000-8000-000000000001',
        kind: 'distance',
        name: '距离 1',
        points: [{ x: 0, y: 0 }, { x: 3, y: 4 }],
        notes: '',
      },
      {
        id: 'f6000000-0000-4000-8000-000000000002',
        kind: 'area',
        name: '面积 1',
        points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }],
        notes: '',
      },
    ],
  };
}

describe('planOverviewStats (派生统计)', () => {
  it('derives top-level counts and per-kind route lengths from the plan geometry', () => {
    const stats = planOverviewStats(statsPlan());
    expect(stats.boundaryAreaM2).toBeCloseTo(200 * 120, 9); // 24,000 m²
    expect(stats.zoneCount).toBe(2);
    expect(stats.facilityCount).toBe(1);
    expect(stats.routeCount).toBe(3);
    // 入场 55+30=85（人行）/ 装卸 40+35=75（车辆）/ 后勤 20。
    expect(stats.routeLengthMByKind.pedestrian).toBeCloseTo(85, 9);
    expect(stats.routeLengthMByKind.vehicle).toBeCloseTo(75, 9);
    expect(stats.routeLengthMByKind.service).toBeCloseTo(20, 9);
    expect(stats.routeLengthTotalM).toBeCloseTo(180, 9);
    expect(stats.nodeCount).toBe(2);
    expect(stats.workerPostCount).toBe(2);
    expect(stats.workerTotalCount).toBe(3);
    expect(stats.measurementCount).toBe(2);
    // 越界分区 1 条 + 孤立节点 1 条，其余实体均在界内 → 恰好 2 条待处理问题。
    expect(stats.issueCount).toBe(2);
    expect(planZoneIssues(statsPlan()).length).toBe(1);
    expect(planNodeIssues(statsPlan()).length).toBe(1);
    expect(planFacilityIssues(statsPlan()).length).toBe(0);
    expect(planWorkerIssues(statsPlan()).length).toBe(0);
  });

  it('ignores layer visibility by design — stats are computed from data only', () => {
    // 统计不接收可见性参数：同一份数据重复计算结果恒等（评审稿「隐藏图层不改变全案统计」）。
    const stats = planOverviewStats(statsPlan());
    expect(planOverviewStats(statsPlan())).toEqual(stats);
  });
});

/* ---------------- 契约往返（测量字段在 SitePlanData 内的兼容性） ---------------- */

describe('measurements inside the site plan contract (H3-a)', () => {
  it('round-trips fixed measurements through the contract schema', () => {
    const parsed = sitePlanDataSchema.parse(JSON.parse(JSON.stringify(statsPlan())));
    expect(parsed.measurements).toHaveLength(2);
    expect(parsed.measurements![0]).toMatchObject({ kind: 'distance', name: '距离 1' });
    expect(parsed.measurements![0].points).toEqual([{ x: 0, y: 0 }, { x: 3, y: 4 }]);
    expect(measureValue(parsed.measurements![1])).toBeCloseTo(100, 9);
  });
});
