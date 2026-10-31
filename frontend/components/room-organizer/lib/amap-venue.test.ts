import { afterEach, describe, it, expect, vi } from 'vitest';
import {
  polygonBboxMeters,
  polygonToLocalMeters,
  fitPolygonToShellLimit,
  createVenueFromPick,
  makeSatelliteGroundPlaceholder,
  isSatelliteGroundImage,
  SATELLITE_GROUND_LABEL,
  SATELLITE_GROUND_MARK,
  mapVenuePlaceQuery,
  satelliteGroundWanted,
  isMapOutdoorLayout,
  satelliteProxyUrl,
  ensureSatelliteGround,
  rectangleAroundMeters,
} from './amap-venue';
import { INITIAL_LAYOUT } from './initial-layout';
import type { RoomLayout } from './types';

/** L 形：外接约 12×8 m，非轴对齐矩形。 */
function lShapePolygon(): { lng: number; lat: number }[] {
  const lat = 30.4049;
  const lng = 120.5394;
  const dLng = 12 / (111_320 * Math.cos((lat * Math.PI) / 180));
  const dLat = 8 / 110_574;
  return [
    { lng, lat },
    { lng: lng + dLng, lat },
    { lng: lng + dLng, lat: lat + dLat * 0.45 },
    { lng: lng + dLng * 0.45, lat: lat + dLat * 0.45 },
    { lng: lng + dLng * 0.45, lat: lat + dLat },
    { lng, lat: lat + dLat },
  ];
}

describe('amap venue pick', () => {
  it('converts a polygon bbox to meters at Haining latitude', () => {
    const polygon = [
      { lng: 120.53, lat: 30.40 },
      { lng: 120.548, lat: 30.40 },
      { lng: 120.548, lat: 30.409 },
      { lng: 120.53, lat: 30.409 },
    ];
    const { width, depth } = polygonBboxMeters(polygon);
    expect(width).toBeGreaterThan(1500);
    expect(width).toBeLessThan(1900);
    expect(depth).toBeGreaterThan(950);
    expect(depth).toBeLessThan(1050);
  });

  it('rejects a degenerate polygon', () => {
    expect(polygonBboxMeters([{ lng: 120.5, lat: 30.4 }])).toEqual({ width: 0, depth: 0 });
    expect(polygonToLocalMeters([{ lng: 120.5, lat: 30.4 }]).points).toEqual([]);
  });

  it('keeps true L-contour local meters instead of only the bbox rectangle corners', () => {
    const local = polygonToLocalMeters(lShapePolygon());
    expect(local.points.length).toBe(6);
    expect(local.width).toBeGreaterThan(11);
    expect(local.width).toBeLessThan(13);
    expect(local.depth).toBeGreaterThan(7);
    expect(local.depth).toBeLessThan(9);
    // 非四角矩形：应有凹点（不是 bbox 四个角）
    const xs = new Set(local.points.map(p => p.x));
    const zs = new Set(local.points.map(p => p.z));
    expect(xs.size).toBeGreaterThan(2);
    expect(zs.size).toBeGreaterThan(2);
  });

  it('scales an oversized contour into the 100 m shell without squashing to a rectangle', () => {
    const huge = [
      { lng: 120.53, lat: 30.40 },
      { lng: 120.548, lat: 30.40 },
      { lng: 120.548, lat: 30.409 },
      { lng: 120.539, lat: 30.409 },
      { lng: 120.539, lat: 30.4045 },
      { lng: 120.53, lat: 30.4045 },
    ];
    const local = polygonToLocalMeters(huge);
    const fitted = fitPolygonToShellLimit(local);
    expect(fitted.oversized).toBe(true);
    expect(fitted.width).toBeLessThanOrEqual(100);
    expect(fitted.depth).toBeLessThanOrEqual(100);
    expect(fitted.points.length).toBeGreaterThanOrEqual(3);
    expect(fitted.points.length).toBe(local.points.length);
  });

  it('builds an outdoor polygon shell named after the place, clamping oversized sites into a planning zone', () => {
    const before = INITIAL_LAYOUT as RoomLayout;
    const { layout, cleared } = createVenueFromPick(before, { name: '盐官潮乐之城', location: '海宁盐官', polygon: [
      { lng: 120.53, lat: 30.40 }, { lng: 120.548, lat: 30.40 }, { lng: 120.548, lat: 30.409 }, { lng: 120.53, lat: 30.409 },
    ] });
    expect(layout.name).toContain('盐官潮乐之城');
    expect(layout.floors[0]!.items.length).toBe(before.floors[0]!.items.length);
    expect(cleared).toBe(0);
    expect(layout.width).toBeLessThanOrEqual(100);
    expect(layout.height).toBeLessThanOrEqual(100);
    expect(layout.name).toMatch(/真实范围 \d+×\d+m/);
    expect(layout.backendSceneV2?.venue.shape).toBe('polygon');
    expect(layout.backendSceneV2?.venue.polygon?.length).toBeGreaterThanOrEqual(3);
    expect(layout.satelliteGroundRef).toBeUndefined();
    expect(layout.floorPlanImage).toBeUndefined();
    expect(layout.mapGroundPolygon).toHaveLength(4);
  });

  it('raises an L-contour shell that is visibly not an axis-aligned rectangle', () => {
    const before = INITIAL_LAYOUT as RoomLayout;
    const { layout } = createVenueFromPick(before, {
      name: '盐官潮乐之城', location: '海宁盐官', polygon: lShapePolygon(),
    });
    const poly = layout.backendSceneV2?.venue.polygon;
    expect(layout.backendSceneV2?.venue.shape).toBe('polygon');
    expect(poly?.length).toBe(6);
    const onBBoxCorner = poly!.filter(p =>
      (p.x === 0 || Math.abs(p.x - layout.width) < 0.15) &&
      (p.z === 0 || Math.abs(p.z - layout.height) < 0.15)
    );
    expect(onBBoxCorner.length).toBeLessThan(poly!.length);
  });

  it('optionally attaches a satellite ground reference that is never recon material', () => {
    const before = INITIAL_LAYOUT as RoomLayout;
    const { layout } = createVenueFromPick(before, {
      name: '盐官潮乐之城', location: '海宁盐官', polygon: lShapePolygon(), satelliteGround: true,
    });
    expect(layout.satelliteGroundRef).toBe(true);
    expect(isSatelliteGroundImage(layout.floorPlanImage)).toBe(true);
    expect(layout.floorPlanImage).toContain(SATELLITE_GROUND_MARK);
    expect(decodeURIComponent(layout.floorPlanImage!)).toContain(SATELLITE_GROUND_LABEL);
    // 占位图带禁令语义；上传链路只收用户选的现场文件，不读 floorPlanImage
    expect(makeSatelliteGroundPlaceholder(12, 8)).toContain(SATELLITE_GROUND_MARK);
  });

  it('accepts a fetched satellite data URL as ground reference', () => {
    const before = INITIAL_LAYOUT as RoomLayout;
    const image = 'http://127.0.0.1:3199/amap-static?location=120.5,30.4&zoom=19&size=512*512&scale=2&x-ref=satellite-ground-ref';
    const { layout } = createVenueFromPick(before, {
      name: '�ιٳ���֮��', location: '�����ι�', polygon: lShapePolygon(),
      satelliteGround: true, satelliteGroundImage: image,
    });
    expect(layout.satelliteGroundRef).toBe(true);
    expect(layout.floorPlanImage).toBe(image);
    expect(isSatelliteGroundImage(layout.floorPlanImage)).toBe(true);
    expect(layout.floorPlanOpacity).toBeGreaterThan(0.5);
  });

  it('clears satellite ground when regenerating with the switch off', () => {
    const before = INITIAL_LAYOUT as RoomLayout;
    const { layout: on } = createVenueFromPick(before, {
      name: '�ι�', location: '����', polygon: lShapePolygon(), satelliteGround: true,
    });
    const { layout: off } = createVenueFromPick(on, {
      name: '�ι�', location: '����', polygon: lShapePolygon(), satelliteGround: false,
    });
    expect(off.satelliteGroundRef).toBe(false);
    expect(off.floorPlanImage).toBeUndefined();
    expect(off.mapGroundPolygon?.length).toBeGreaterThanOrEqual(3);
  });
});

describe('satellite ground backfill', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('reads the place name out of a planning-zone title', () => {
    expect(mapVenuePlaceQuery('盐官潮乐之城 · 规划区 84.6×100m（真实范围 846×1000m）')).toBe('盐官潮乐之城');
    expect(mapVenuePlaceQuery('盐官潮乐之城 · 海宁盐官 · 规划区 12×8m')).toBe('盐官潮乐之城 海宁盐官');
  });

  it('defaults satellite on for a map shell and keeps an explicit off', () => {
    const { layout } = createVenueFromPick(INITIAL_LAYOUT as RoomLayout, {
      name: '盐官潮乐之城', location: '海宁盐官', polygon: lShapePolygon(),
    });
    expect(isMapOutdoorLayout(layout)).toBe(true);
    expect(satelliteGroundWanted(layout)).toBe(true);
    expect(satelliteGroundWanted({ ...layout, satelliteGroundRef: false })).toBe(false);
    expect(satelliteGroundWanted({ ...layout, satelliteGroundRef: true })).toBe(true);
  });

  it('builds a localhost proxy url without the key', () => {
    const url = satelliteProxyUrl(lShapePolygon(), 'secret-key');
    expect(url).toContain('http://127.0.0.1:3199/amap-static?');
    expect(url).toContain(`x-ref=${SATELLITE_GROUND_MARK}`);
    expect(url).not.toContain('secret-key');
  });

  it('fills a stored polygon from the proxy when the key is set', async () => {
    vi.stubEnv('NEXT_PUBLIC_AMAP_STATIC_KEY', 'test-static');
    vi.stubGlobal('window', {});
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      headers: { get: () => 'image/jpeg' },
      body: { cancel: vi.fn() },
    }));
    const { layout } = createVenueFromPick(INITIAL_LAYOUT as RoomLayout, {
      name: '盐官潮乐之城', location: '海宁盐官', polygon: lShapePolygon(), satelliteGround: false,
    });
    const patch = await ensureSatelliteGround(layout);
    expect(patch?.satelliteGroundRef).toBe(true);
    expect(patch?.floorPlanImage).toContain('127.0.0.1:3199/amap-static');
    expect(isSatelliteGroundImage(patch?.floorPlanImage)).toBe(true);
    expect(patch?.floorPlanImage).not.toContain('test-static');
  });

  it('geocodes a legacy map shell that never stored a polygon', async () => {
    vi.stubEnv('NEXT_PUBLIC_AMAP_KEY', 'js-key');
    vi.stubEnv('NEXT_PUBLIC_AMAP_STATIC_KEY', 'test-static');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      headers: { get: () => 'image/jpeg' },
      body: { cancel: vi.fn() },
    }));
    vi.stubGlobal('window', {
      AMap: {
        PlaceSearch: class {
          search(_query: string, cb: (status: string, result: unknown) => void) {
            cb('complete', { poiList: { pois: [{ location: { lng: 120.54, lat: 30.405 } }] } });
          }
        },
      },
    });
    const { layout } = createVenueFromPick(INITIAL_LAYOUT as RoomLayout, {
      name: '盐官潮乐之城', location: '', polygon: lShapePolygon(),
    });
    const legacy = { ...layout };
    delete legacy.mapGroundPolygon;
    delete legacy.satelliteGroundRef;
    delete legacy.floorPlanImage;
    const patch = await ensureSatelliteGround(legacy);
    expect(mapVenuePlaceQuery(legacy.name)).toContain('盐官潮乐之城');
    expect(patch?.mapGroundPolygon).toHaveLength(4);
    const center = patch!.mapGroundPolygon.reduce((sum, point) => ({ lng: sum.lng + point.lng, lat: sum.lat + point.lat }), { lng: 0, lat: 0 });
    expect(center.lng / 4).toBeCloseTo(120.54, 4);
    expect(center.lat / 4).toBeCloseTo(30.405, 4);
    expect(rectangleAroundMeters({ lng: 120.54, lat: 30.405 }, legacy.width, legacy.height)).toHaveLength(4);
  });

  it('does not invent a ground image when no key is available', async () => {
    vi.stubEnv('NEXT_PUBLIC_AMAP_KEY', '');
    vi.stubEnv('NEXT_PUBLIC_AMAP_STATIC_KEY', '');
    const { layout } = createVenueFromPick(INITIAL_LAYOUT as RoomLayout, {
      name: '盐官潮乐之城', location: '海宁盐官', polygon: lShapePolygon(), satelliteGround: false,
    });
    expect(await ensureSatelliteGround(layout)).toBeNull();
  });
});
