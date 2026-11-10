import { describe, expect, it } from 'vitest';
import { buildPlanGeoJson, buildPlanGeoJsonText } from './site-plan-geojson';
import type { SitePlanData } from '../../../../supabase/functions/_shared/site-plan';

function samplePlan(): SitePlanData {
  return {
    schemaVersion: 1,
    anchor: { lng: 120.1443, lat: 30.2459, crs: 'gcj-02', source: 'picker' },
    boundary: [
      { x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 120 }, { x: 0, y: 120 },
    ],
    zones: [
      {
        id: 'a1000000-0000-4000-8000-000000000001', semantic: 'audience', name: '观众区',
        polygon: [{ x: 10, y: 10 }, { x: 90, y: 10 }, { x: 90, y: 55 }, { x: 10, y: 55 }],
        notes: '',
      },
    ],
    facilities: [
      { id: 'b2000000-0000-4000-8000-000000000001', templateId: 'booth-2x2', name: '摊位', position: { x: 60, y: 80 }, rotationDeg: 0, size: { width: 2, depth: 2 }, zoneId: 'a1000000-0000-4000-8000-000000000001', notes: '' },
    ],
    routes: [
      { id: 'c3000000-0000-4000-8000-000000000001', kind: 'pedestrian', name: '入场动线', points: [{ x: 0, y: 60 }, { x: 55, y: 60 }], oneWay: true, widthM: 3, notes: '' },
    ],
    nodes: [
      { id: 'd4000000-0000-4000-8000-000000000001', kind: 'entry', name: '西门', position: { x: 0, y: 60 }, notes: '' },
    ],
    workers: [
      { id: 'e5000000-0000-4000-8000-000000000001', role: '安保', count: 2, position: { x: 3, y: 57 }, zoneId: 'a1000000-0000-4000-8000-000000000001', notes: '' },
    ],
    measurements: [],
  } as unknown as SitePlanData;
}

describe('geojson export (H5-c)', () => {
  it('exports a FeatureCollection with every entity kind', () => {
    const geo = buildPlanGeoJson(samplePlan());
    expect(geo.type).toBe('FeatureCollection');
    const kinds = geo.features.map(f => f.properties.kind);
    expect(kinds).toContain('boundary');
    expect(kinds).toContain('zone');
    expect(kinds).toContain('facility');
    expect(kinds).toContain('route');
    expect(kinds).toContain('node');
    expect(kinds).toContain('worker');
    expect(geo.features).toHaveLength(6);
  });

  it('closes polygon rings per RFC 7946', () => {
    const geo = buildPlanGeoJson(samplePlan());
    const boundary = geo.features.find(f => f.properties.kind === 'boundary')!;
    // Polygon coordinates = [外环]，外环 = 4 顶点 + 闭合点。
    const ring = (boundary.geometry.coordinates as [number, number][][])[0];
    expect(ring).toHaveLength(5);
    expect(ring[0]).toEqual(ring[ring.length - 1]);
    const zone = geo.features.find(f => f.properties.kind === 'zone')!;
    const zoneRing = (zone.geometry.coordinates as [number, number][][])[0];
    expect(zoneRing.at(-1)).toEqual(zoneRing[0]);
  });

  it('maps ENU meters to [lng, lat] around the anchor', () => {
    const geo = buildPlanGeoJson(samplePlan());
    const node = geo.features.find(f => f.properties.kind === 'node')!;
    // 西门在 ENU 原点 (0,60)：纬度 = 30.2459 + 60/111132.92 ≈ 30.24644。
    const [lng, lat] = node.geometry.coordinates as [number, number];
    expect(lng).toBeCloseTo(120.1443, 5);
    expect(lat).toBeCloseTo(30.24644, 4);
  });

  it('carries rich properties for GIS filtering', () => {
    const geo = buildPlanGeoJson(samplePlan());
    const route = geo.features.find(f => f.properties.kind === 'route')!;
    expect(route.properties.width_m).toBe(3);
    expect(route.properties.one_way).toBe(true);
    expect(route.properties.length_m).toBeCloseTo(55, 1);
    const facility = geo.features.find(f => f.properties.kind === 'facility')!;
    expect(facility.properties.zone).toBe('观众区');
    expect(facility.properties.width_m).toBe(2);
  });

  it('outputs empty collection (no fabricated coords) when the plan has no anchor', () => {
    const plan = samplePlan();
    delete (plan as { anchor?: unknown }).anchor;
    const geo = buildPlanGeoJson(plan);
    expect(geo.features).toHaveLength(0);
  });

  it('is byte-stable for the same plan', () => {
    expect(buildPlanGeoJsonText(samplePlan())).toBe(buildPlanGeoJsonText(samplePlan()));
  });
});
