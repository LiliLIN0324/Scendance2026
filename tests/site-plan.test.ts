import { describe, expect, it } from 'vitest';
import {
  planRouteKindLabels,
  planZoneSemanticLabels,
  planRouteLengthM,
  planRingAreaM2,
  sitePlanDataSchema,
  sitePlanHash,
  sitePlanSnapshotSchema,
  type PlanNode,
  type SitePlanSnapshot,
} from '../supabase/functions/_shared/site-plan.ts';

function samplePlan() {
  return {
    schemaVersion: 1 as const,
    anchor: { lng: 120.1443, lat: 30.2459, crs: 'gcj-02' as const, source: 'picker' as const },
    boundary: [
      { x: 0, y: 0 },
      { x: 200, y: 0 },
      { x: 200, y: 120 },
      { x: 0, y: 120 },
    ],
    zones: [
      {
        id: '11111111-1111-4111-8111-111111111111',
        semantic: 'audience' as const,
        name: '观众区',
        polygon: [
          { x: 10, y: 10 },
          { x: 90, y: 10 },
          { x: 90, y: 60 },
          { x: 10, y: 60 },
        ],
        color: '#aabbcc',
        notes: '',
      },
    ],
    facilities: [
      {
        id: '22222222-2222-4222-8222-222222222222',
        templateId: 'tent-3x3',
        name: '摊位 A',
        position: { x: 120, y: 20 },
        rotationDeg: 0,
        size: { width: 3, depth: 3 },
        zoneId: '11111111-1111-4111-8111-111111111111',
        notes: '',
      },
    ],
    routes: [
      {
        id: '33333333-3333-4333-8333-333333333333',
        kind: 'pedestrian' as const,
        name: '主入场动线',
        points: [
          { x: 0, y: 60 },
          { x: 60, y: 60 },
          { x: 60, y: 20 },
        ],
        oneWay: true,
        notes: '',
      },
    ],
    nodes: [
      {
        id: '44444444-4444-4444-8444-444444444444',
        kind: 'entry' as const,
        name: '东门',
        position: { x: 0, y: 60 },
        notes: '',
      },
    ],
    workers: [
      {
        id: '55555555-5555-4555-8555-555555555555',
        role: '安保',
        count: 2,
        position: { x: 2, y: 58 },
        zoneId: '11111111-1111-4111-8111-111111111111',
        notes: '',
      },
    ],
  };
}

function sampleSnapshot(data = samplePlan()): SitePlanSnapshot {
  return {
    planId: '99999999-9999-4999-8999-999999999999',
    projectId: '88888888-8888-4888-8888-888888888888',
    revision: 3,
    updatedAt: '2026-11-10T05:10:00.000Z',
    data,
  };
}

describe('site plan contract', () => {
  it('round-trips a full snapshot through JSON without losing data', () => {
    const snapshot = sampleSnapshot();
    const restored = sitePlanSnapshotSchema.parse(JSON.parse(JSON.stringify(snapshot)));
    expect(restored).toEqual(snapshot);
    expect(restored.data.zones[0].color).toBe('#aabbcc'); // 颜色统一小写
    expect(restored.data.routes[0].oneWay).toBe(true); // 默认值往返保留
    expect(restored.data.workers[0].notes).toBe('');
  });

  it('derives boundary area and route length from geometry', () => {
    const data = samplePlan();
    expect(planRingAreaM2(data.boundary)).toBeCloseTo(200 * 120, 9); // 24,000 m²
    expect(planRingAreaM2(data.zones[0].polygon)).toBeCloseTo(80 * 50, 9);
    expect(planRouteLengthM(data.routes[0].points)).toBeCloseTo(60 + 40, 9); // 60 m + 40 m
  });

  it('hashes the snapshot deterministically and distinguishes revisions', async () => {
    const a = await sitePlanHash(sampleSnapshot());
    const b = await sitePlanHash(sampleSnapshot());
    expect(a).toBe(b);
    expect(a).toHaveLength(64);
    const bumped = sampleSnapshot();
    bumped.revision = 4;
    expect(await sitePlanHash(bumped)).not.toBe(a);
    const moved = sampleSnapshot();
    moved.data.facilities[0].position = { x: 121, y: 20 };
    expect(await sitePlanHash(moved)).not.toBe(a);
  });

  it('rejects duplicate ids across entity collections', () => {
    const data = samplePlan();
    data.facilities.push({ ...data.facilities[0], id: data.zones[0].id });
    const result = sitePlanDataSchema.safeParse(data);
    expect(result.success).toBe(false);
  });

  it('rejects dangling zone references and degenerate geometry', () => {
    const dangling = samplePlan();
    dangling.workers[0].zoneId = '77777777-7777-4777-8777-777777777777';
    expect(sitePlanDataSchema.safeParse(dangling).success).toBe(false);

    const danglingNode = samplePlan();
    (danglingNode.nodes[0] as PlanNode).zoneId = '77777777-7777-4777-8777-777777777777';
    expect(sitePlanDataSchema.safeParse(danglingNode).success).toBe(false);

    const shortRoute = samplePlan();
    shortRoute.routes[0].points = [{ x: 0, y: 0 }];
    expect(sitePlanDataSchema.safeParse(shortRoute).success).toBe(false);

    const tinyBoundary = samplePlan();
    tinyBoundary.boundary = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
    ];
    expect(sitePlanDataSchema.safeParse(tinyBoundary).success).toBe(false);

    const repeatedPoint = samplePlan();
    repeatedPoint.routes[0].points = [
      { x: 0, y: 0 },
      { x: 0, y: 0 },
      { x: 5, y: 0 },
    ];
    expect(sitePlanDataSchema.safeParse(repeatedPoint).success).toBe(false);
  });

  it('rejects unknown semantics, kinds and anchor systems', () => {
    const badZone = samplePlan();
    (badZone.zones[0] as { semantic: string }).semantic = 'casino';
    expect(sitePlanDataSchema.safeParse(badZone).success).toBe(false);

    const badRoute = samplePlan();
    (badRoute.routes[0] as { kind: string }).kind = 'drone';
    expect(sitePlanDataSchema.safeParse(badRoute).success).toBe(false);

    const badAnchor = samplePlan();
    (badAnchor.anchor as { crs: string }).crs = 'wgs-84';
    expect(sitePlanDataSchema.safeParse(badAnchor).success).toBe(false);
  });

  it('accepts the preset anchor source (2026-11-11 默认锚点决策) and still rejects unknown sources', () => {
    const preset = samplePlan();
    (preset.anchor as { source: string }).source = 'preset';
    const parsed = sitePlanDataSchema.safeParse(preset);
    expect(parsed.success).toBe(true);

    const unknown = samplePlan();
    (unknown.anchor as { source: string }).source = 'guess';
    expect(sitePlanDataSchema.safeParse(unknown).success).toBe(false);
  });

  it('allows an empty boundary (2026-11-11 零边界起步：新草稿未画边界) and still rejects oversized rings', () => {
    const empty = samplePlan();
    (empty as { boundary: unknown }).boundary = [];
    const parsed = sitePlanDataSchema.safeParse(empty);
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.boundary).toHaveLength(0);

    const oversize = samplePlan();
    (oversize as { boundary: unknown }).boundary = Array.from({ length: 65 }, (_, i) => ({ x: i, y: 0 }));
    expect(sitePlanDataSchema.safeParse(oversize).success).toBe(false);
  });

  it('keeps label dictionaries aligned with the enums', () => {
    const data = samplePlan();
    expect(Object.keys(planZoneSemanticLabels)).toContain(data.zones[0].semantic);
    expect(Object.keys(planRouteKindLabels)).toContain(data.routes[0].kind);
    expect(planZoneSemanticLabels.reserved).toBe('预留区');
    expect(planRouteKindLabels.service).toBe('后勤');
  });

  it('keeps zone opacity optional and round-trips it when present (H2-b)', () => {
    // 旧数据不带 opacity：解析成功且不虚构字段。
    const legacy = sitePlanDataSchema.parse(samplePlan());
    expect(legacy.zones[0].opacity).toBeUndefined();

    // 带透明度：往返逐字段保留（与颜色同一口径）。
    const styled = samplePlan();
    (styled.zones[0] as { opacity?: number }).opacity = 0.35;
    const restored = sitePlanDataSchema.parse(JSON.parse(JSON.stringify(styled)));
    expect(restored.zones[0].opacity).toBe(0.35);
  });

  it('rejects zone opacity outside 0–1 (H2-b)', () => {
    const tooSolid = samplePlan();
    (tooSolid.zones[0] as { opacity?: number }).opacity = 1.5;
    expect(sitePlanDataSchema.safeParse(tooSolid).success).toBe(false);

    const negative = samplePlan();
    (negative.zones[0] as { opacity?: number }).opacity = -0.1;
    expect(sitePlanDataSchema.safeParse(negative).success).toBe(false);
  });

  it('keeps route node references optional and round-trips them when present (H2-d)', () => {
    // 旧数据不带端点引用：解析成功且不虚构字段（与 opacity 同口径）。
    const legacy = sitePlanDataSchema.parse(samplePlan());
    expect(legacy.routes[0].startNodeId).toBeUndefined();
    expect(legacy.routes[0].endNodeId).toBeUndefined();

    // 带端点引用且节点存在：往返逐字段保留。
    const linked = samplePlan();
    (linked.routes[0] as { startNodeId?: string }).startNodeId = '44444444-4444-4444-8444-444444444444';
    const restored = sitePlanDataSchema.parse(JSON.parse(JSON.stringify(linked)));
    expect(restored.routes[0].startNodeId).toBe('44444444-4444-4444-8444-444444444444');
    expect(restored.routes[0].endNodeId).toBeUndefined();
  });

  it('rejects route endpoint references to missing nodes (H2-d)', () => {
    const danglingStart = samplePlan();
    (danglingStart.routes[0] as { startNodeId?: string }).startNodeId = '66666666-6666-4666-8666-666666666666';
    expect(sitePlanDataSchema.safeParse(danglingStart).success).toBe(false);

    const danglingEnd = samplePlan();
    (danglingEnd.routes[0] as { endNodeId?: string }).endNodeId = '66666666-6666-4666-8666-666666666666';
    expect(sitePlanDataSchema.safeParse(danglingEnd).success).toBe(false);
  });

  it('keeps route color optional and round-trips it when present (2026-11-12 活动包赛道预设)', () => {
    // 旧数据不带 color：解析成功且不虚构字段（与 opacity / startNodeId 同口径）。
    const legacy = sitePlanDataSchema.parse(samplePlan());
    expect(legacy.routes[0].color).toBeUndefined();

    // 带主题色：小写化往返（与 zone/facility/worker 的 color 同口径）。
    const colored = samplePlan();
    (colored.routes[0] as { color?: string }).color = '#9E00FF';
    const restored = sitePlanDataSchema.parse(JSON.parse(JSON.stringify(colored)));
    expect(restored.routes[0].color).toBe('#9e00ff');

    // 非法色值照例拒绝。
    const badColor = samplePlan();
    (badColor.routes[0] as { color?: string }).color = 'purple';
    expect(sitePlanDataSchema.safeParse(badColor).success).toBe(false);
  });

  it('keeps measurements optional and round-trips them when present (H3-a)', () => {
    // 旧数据不带 measurements：解析成功且不虚构字段（与 opacity / startNodeId 同口径）。
    const legacy = sitePlanDataSchema.parse(samplePlan());
    expect(legacy.measurements).toBeUndefined();

    // 带固定测量：往返逐字段保留。
    const measured = samplePlan() as ReturnType<typeof samplePlan> & { measurements?: unknown };
    measured.measurements = [
      {
        id: '66666666-6666-4666-8666-666666666661',
        kind: 'distance',
        name: '距离 1',
        points: [{ x: 0, y: 0 }, { x: 3, y: 4 }],
        notes: '',
      },
      {
        id: '66666666-6666-4666-8666-666666666662',
        kind: 'area',
        name: '面积 1',
        points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }],
        notes: '',
      },
    ];
    const restored = sitePlanDataSchema.parse(JSON.parse(JSON.stringify(measured)));
    expect(restored.measurements).toHaveLength(2);
    expect(restored.measurements![0].points).toEqual([{ x: 0, y: 0 }, { x: 3, y: 4 }]);
    expect(restored.measurements![1].kind).toBe('area');
  });

  it('rejects malformed measurement geometry (H3-a)', () => {
    function withMeasurement(points: { x: number; y: number }[], kind: 'distance' | 'area' | 'path') {
      const data = samplePlan() as ReturnType<typeof samplePlan> & { measurements?: unknown };
      data.measurements = [{
        id: '66666666-6666-4666-8666-666666666663',
        kind,
        name: '测量 1',
        points,
        notes: '',
      }];
      return data;
    }

    // 距离口径是恰好 2 点。
    expect(sitePlanDataSchema.safeParse(withMeasurement([{ x: 0, y: 0 }], 'distance')).success).toBe(false);
    expect(sitePlanDataSchema.safeParse(withMeasurement(
      [{ x: 0, y: 0 }, { x: 3, y: 4 }, { x: 6, y: 8 }],
      'distance',
    )).success).toBe(false);

    // 面积口径是至少 3 点闭合环。
    expect(sitePlanDataSchema.safeParse(withMeasurement([{ x: 0, y: 0 }, { x: 10, y: 0 }], 'area')).success).toBe(false);

    // 相邻重复顶点拒绝（与动线/边界同口径）。
    expect(sitePlanDataSchema.safeParse(withMeasurement(
      [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 5, y: 0 }],
      'path',
    )).success).toBe(false);
  });
});
