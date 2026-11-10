import { describe, expect, it } from 'vitest';
import { buildPlanLegend, polylineHalfLengthPoint } from './site-plan-legend';
import { PLANNING_LAYER_COLORS, PLANNING_ROUTE_KIND_COLORS, PLANNING_ZONE_COLORS } from '@/lib/outdoor-plan-tokens';
import type { SitePlanData } from '../../../../supabase/functions/_shared/site-plan';

/** 复用演示页「平湖秋月市集」同构的迷你样例（3 分区 / 2 摊位 + 1 帐篷 / 3 动线 / 2 节点 / 2 人员 / 2 测量）。 */
function samplePlan(): SitePlanData {
  return {
    schemaVersion: 1,
    anchor: { lng: 120.1460368, lat: 30.2521924, crs: 'gcj-02', source: 'picker' },
    boundary: [
      { x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 120 }, { x: 0, y: 120 },
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
        id: 'a1000000-0000-4000-8000-000000000002',
        semantic: 'audience',
        name: '观众区 B',
        polygon: [{ x: 100, y: 10 }, { x: 150, y: 10 }, { x: 150, y: 40 }, { x: 100, y: 40 }],
        color: '#7fb69a',
        notes: '',
      },
      {
        id: 'a1000000-0000-4000-8000-000000000003',
        semantic: 'stage',
        name: '舞台区',
        polygon: [{ x: 110, y: 60 }, { x: 150, y: 60 }, { x: 150, y: 90 }, { x: 110, y: 90 }],
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
        notes: '',
      },
      {
        id: 'b2000000-0000-4000-8000-000000000002',
        templateId: 'booth-2x2',
        name: '市集摊位 B',
        position: { x: 68, y: 80 },
        rotationDeg: 0,
        size: { width: 2, depth: 2 },
        notes: '',
      },
      {
        id: 'b2000000-0000-4000-8000-000000000003',
        templateId: 'tent-3x3',
        name: '后勤帐篷',
        position: { x: 180, y: 100 },
        rotationDeg: 15,
        size: { width: 3, depth: 3 },
        notes: '',
      },
      {
        id: 'b2000000-0000-4000-8000-000000000004',
        templateId: 'custom-gate-4x1',
        name: '临时闸机',
        position: { x: 0, y: 60 },
        rotationDeg: 0,
        size: { width: 4, depth: 1 },
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
        notes: '',
      },
      {
        id: 'c3000000-0000-4000-8000-000000000002',
        kind: 'vehicle',
        name: '装卸动线',
        points: [{ x: 200, y: 60 }, { x: 160, y: 60 }, { x: 160, y: 95 }],
        oneWay: false,
        widthM: 4,
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
        kind: 'exit',
        name: '东出口',
        position: { x: 200, y: 60 },
        notes: '',
      },
    ],
    workers: [
      {
        id: 'e5000000-0000-4000-8000-000000000001',
        role: '安保',
        count: 2,
        position: { x: 3, y: 57 },
        notes: '',
      },
      {
        id: 'e5000000-0000-4000-8000-000000000002',
        role: '安保',
        count: 1,
        position: { x: 195, y: 97 },
        notes: '',
      },
      {
        id: 'e5000000-0000-4000-8000-000000000003',
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

describe('buildPlanLegend (H3-c 图例生成器)', () => {
  it('emits the stable group order: 边界 → 分区 → 设施 → 动线 → 出入口 → 人员 → 测量', () => {
    const groups = buildPlanLegend(samplePlan());
    expect(groups.map(g => g.title)).toEqual(['场地边界', '功能分区', '设施', '动线', '出入口', '人员', '测量']);
  });

  it('aggregates zones by semantic with default semantic colors and area totals', () => {
    const zones = buildPlanLegend(samplePlan()).find(g => g.title === '功能分区')!;
    // 契约语义枚举序 stage 在前。
    expect(zones.entries.map(e => e.label)).toEqual(['舞台区', '观众区']);
    expect(zones.entries[1]!.count).toBe(2);
    // 舞台区一块 40×30 = 1200 m²；观众区两块 80×45 + 50×30 = 3600 + 1500 = 5100 m²。
    expect(zones.entries[0]!.detail).toBe('共 1200 m²');
    expect(zones.entries[1]!.detail).toBe('共 5100 m²');
    // 无显式色的观众区用语义默认色。
    expect(zones.entries[1]!.swatch).toBe(PLANNING_ZONE_COLORS.audience);
    // 舞台区用语义默认色（样例未给色）。
    expect(zones.entries[0]!.swatch).toBe(PLANNING_ZONE_COLORS.stage);
  });

  it('aggregates facilities by template with catalog names and a custom-id fallback', () => {
    const facilities = buildPlanLegend(samplePlan()).find(g => g.title === '设施')!;
    expect(facilities.entries.map(e => e.label)).toEqual(['市集摊位', '后勤帐篷', 'custom-gate-4x1']);
    expect(facilities.entries.map(e => e.count)).toEqual([2, 1, 1]);
    expect(facilities.entries[0]!.swatch).toBe(PLANNING_LAYER_COLORS.facility);
    expect(facilities.entries[0]!.detail).toBe('2×2 m');
  });

  it('aggregates routes by kind with dedicated kind colors and length totals', () => {
    const routes = buildPlanLegend(samplePlan()).find(g => g.title === '动线')!;
    expect(routes.entries.map(e => e.label)).toEqual(['人行动线', '车辆动线']);
    expect(routes.entries[0]!.swatch).toBe(PLANNING_ROUTE_KIND_COLORS.pedestrian);
    expect(routes.entries[1]!.swatch).toBe(PLANNING_ROUTE_KIND_COLORS.vehicle);
    // 入场 55+30=85 m；装卸 40+35=75 m。
    expect(routes.entries[0]!.detail).toBe('共 85 m');
    expect(routes.entries[1]!.detail).toBe('共 75 m');
  });

  it('aggregates workers by role with people totals and post counts', () => {
    const workers = buildPlanLegend(samplePlan()).find(g => g.title === '人员')!;
    expect(workers.entries.map(e => e.label)).toEqual(['安保', '引导员']);
    expect(workers.entries[0]!.count).toBe(3);
    expect(workers.entries[0]!.detail).toBe('2 个点位');
    expect(workers.entries[1]!.count).toBe(3);
    expect(workers.entries[1]!.swatch).toBe(PLANNING_LAYER_COLORS.worker);
  });

  it('aggregates measurements by kind with formatted totals', () => {
    const measurements = buildPlanLegend(samplePlan()).find(g => g.title === '测量')!;
    expect(measurements.entries.map(e => e.label)).toEqual(['距离', '面积']);
    expect(measurements.entries[0]!.detail).toBe('共 10 m');
    expect(measurements.entries[1]!.detail).toBe('共 100 m²');
    expect(measurements.entries[0]!.swatch).toBe(PLANNING_LAYER_COLORS.measure);
  });

  it('omits empty groups and keeps the boundary group for a boundary-only plan', () => {
    const boundaryOnly: SitePlanData = {
      schemaVersion: 1,
      boundary: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }],
      zones: [],
      facilities: [],
      routes: [],
      nodes: [],
      workers: [],
    };
    const groups = buildPlanLegend(boundaryOnly);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.title).toBe('场地边界');
    expect(groups[0]!.entries[0]!.detail).toBe('共 10000 m²');
    expect(groups[0]!.entries[0]!.swatch).toBe(PLANNING_LAYER_COLORS.boundary);
  });

  it('keeps zone explicit color as swatch when provided', () => {
    const plan = samplePlan();
    plan.zones[0]!.color = '#3d8fa8';
    const zones = buildPlanLegend(plan).find(g => g.title === '功能分区')!;
    // 观众区组在契约枚举序下是第 2 条。
    expect(zones.entries[1]!.swatch).toBe('#3d8fa8');
  });
});

describe('polylineHalfLengthPoint (H3-c 清单定位锚点)', () => {
  it('finds the half-length point on a two-segment polyline', () => {
    // 10 + 10 = 20 m，半长 10 m 落在第二段起点。
    expect(polylineHalfLengthPoint([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }])).toEqual({ x: 10, y: 0 });
  });

  it('interpolates inside a segment when the half length falls mid-segment', () => {
    // 20 m 单段，半长 10 m → 中点。
    expect(polylineHalfLengthPoint([{ x: 0, y: 0 }, { x: 20, y: 0 }])).toEqual({ x: 10, y: 0 });
  });

  it('falls back to the first point for degenerate input', () => {
    expect(polylineHalfLengthPoint([{ x: 5, y: 6 }])).toEqual({ x: 5, y: 6 });
    expect(polylineHalfLengthPoint([])).toEqual({ x: 0, y: 0 });
  });
});
