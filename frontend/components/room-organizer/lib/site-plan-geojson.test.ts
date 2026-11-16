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

/** 车辆夹具（2026-11-16 #122）：一台待补模型的大巴 + 一台有模型的商务车。 */
function planWithVehicles(): SitePlanData {
  const plan = samplePlan();
  plan.vehicles = [
    { id: 'aa000000-0000-4000-8000-000000000001', type: 'coach', count: 3, position: { x: 20, y: 100 }, notes: '大巴停车位' },
    { id: 'aa000000-0000-4000-8000-000000000002', type: 'business', count: 2, position: { x: 120, y: 100 }, modelSlug: 'car-park-and-road-vehicle-fleet-saloon-ad831b1f', notes: '' },
  ];
  return plan;
}

describe('geojson export 车辆 Point（#122）', () => {
  it('emits one Point per vehicle entity with type/label/count/model_slug', () => {
    const features = buildPlanGeoJson(planWithVehicles()).features.filter(f => f.properties.kind === 'vehicle');
    expect(features).toHaveLength(2);
    expect(features[0]!.geometry.type).toBe('Point');
    expect(features[0]!.properties.type).toBe('车辆');
    expect(features[0]!.properties.label).toBe('服务大巴车（待补模型）');
    expect(features[0]!.properties.vehicle_type).toBe('coach');
    expect(features[0]!.properties.count).toBe(3);
    expect(features[0]!.properties.model_slug).toBeNull();
    expect(features[0]!.properties.model_pending).toBe(true);
    expect(features[0]!.properties.notes).toBe('大巴停车位');
    expect(features[1]!.properties.label).toBe('商务车');
    expect(features[1]!.properties.count).toBe(2);
    expect(features[1]!.properties.model_slug).toBe('car-park-and-road-vehicle-fleet-saloon-ad831b1f');
    expect(features[1]!.properties.model_pending).toBe(false);
    // ENU (20,100) → 锚点东侧 20 m、北侧 100 m。
    const [lng, lat] = features[0]!.geometry.coordinates as [number, number];
    expect(lng).toBeGreaterThan(120.1443);
    expect(lat).toBeCloseTo(30.2459 + 100 / 111132.92, 5);
  });

  it('leaves legacy plans without vehicles byte-identical', () => {
    const geo = buildPlanGeoJson(samplePlan());
    expect(geo.features.map(f => f.properties.kind)).toEqual(['boundary', 'zone', 'facility', 'route', 'node', 'worker']);
    expect(buildPlanGeoJsonText({ ...samplePlan(), vehicles: [] })).toBe(buildPlanGeoJsonText(samplePlan()));
  });
});

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
