import { describe, expect, it } from 'vitest';
import {
  planRouteKindLabels,
  planZoneSemanticLabels,
  planRouteLengthM,
  planRingAreaM2,
  sitePlanDataSchema,
  sitePlanHash,
  sitePlanSnapshotSchema,
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
});
