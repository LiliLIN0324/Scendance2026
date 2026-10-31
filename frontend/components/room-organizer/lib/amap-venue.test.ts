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
  fetchSatelliteGroundDataUrl,
  satelliteMissReason,
  groundRegistration,
  shellMetersToSatelliteUv,
  parseSatelliteImageBounds,
  satelliteImageAligned,
  metersPerDegreeLng,
  METERS_PER_DEGREE_LAT,
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

  it('shows satellite for a planning-zone name or an outdoor brief even when the shell is not a polygon', () => {
    const named = { ...(INITIAL_LAYOUT as RoomLayout), name: '盐官潮乐之城 · 规划区 84.6×100m（真实范围 846×1000m）' };
    delete named.mapGroundPolygon;
    delete named.satelliteGroundRef;
    delete named.floorPlanImage;
    expect(named.backendVenue?.shape).not.toBe('polygon');
    expect(isMapOutdoorLayout(named)).toBe(true);
    expect(satelliteGroundWanted(named)).toBe(true);
    expect(satelliteGroundWanted({ ...named, satelliteGroundRef: false })).toBe(false);

    const outdoor = {
      ...(INITIAL_LAYOUT as RoomLayout),
      name: '海边舞台',
      backendVenue: { shape: 'rectangle' as const, width: 40, depth: 20, height: 4, entrances: [], site: { indoorOutdoor: 'outdoor' as const } },
    };
    expect(isMapOutdoorLayout(outdoor)).toBe(true);
    expect(satelliteGroundWanted(outdoor)).toBe(true);
    expect(isMapOutdoorLayout({ ...(INITIAL_LAYOUT as RoomLayout), name: '盐官潮乐之城', mapLngLat: { lng: 120.54, lat: 30.4 } })).toBe(true);
    expect(isMapOutdoorLayout({ ...(INITIAL_LAYOUT as RoomLayout), name: '室内宴会厅' })).toBe(false);
  });

  it('builds a localhost proxy url without the key', () => {
    const url = satelliteProxyUrl(lShapePolygon(), 'secret-key');
    expect(url).toContain('http://127.0.0.1:3199/amap-static?');
    expect(url).toContain(`x-ref=${SATELLITE_GROUND_MARK}`);
    expect(url).not.toContain('secret-key');
  });

  it('uses a same-origin satellite url on the production host', () => {
    vi.stubGlobal('window', { location: { hostname: 'scendance.lilicoding.space' } });
    const url = satelliteProxyUrl(lShapePolygon(), 'secret-key');
    expect(url?.startsWith('/api/amap-static?')).toBe(true);
    expect(url).toContain(`x-ref=${SATELLITE_GROUND_MARK}`);
    expect(url).not.toContain('127.0.0.1');
    expect(url).not.toContain('secret-key');
  });

  it('fills a stored polygon from the proxy when the key is set', async () => {
    vi.stubEnv('NEXT_PUBLIC_AMAP_STATIC_KEY', 'test-static');
    vi.stubGlobal('window', {});
    const bytes = new Uint8Array(120);
    bytes[0] = 0xff;
    bytes[1] = 0xd8;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      headers: { get: () => 'image/jpeg' },
      arrayBuffer: async () => bytes.buffer,
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
    const bytes = new Uint8Array(120);
    bytes[0] = 0xff;
    bytes[1] = 0xd8;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      headers: { get: () => 'image/jpeg' },
      arrayBuffer: async () => bytes.buffer,
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
    delete legacy.mapLngLat;
    delete legacy.satelliteGroundRef;
    delete legacy.floorPlanImage;
    const patch = await ensureSatelliteGround(legacy);
    expect(mapVenuePlaceQuery(legacy.name)).toContain('盐官潮乐之城');
    expect(patch?.mapGroundPolygon).toHaveLength(4);
    const center = patch!.mapGroundPolygon!.reduce((sum, point) => ({ lng: sum.lng + point.lng, lat: sum.lat + point.lat }), { lng: 0, lat: 0 });
    expect(center.lng / 4).toBeCloseTo(120.54, 4);
    expect(center.lat / 4).toBeCloseTo(30.405, 4);
    expect(rectangleAroundMeters({ lng: 120.54, lat: 30.405 }, legacy.width, legacy.height)).toHaveLength(4);
  });

  it('aligns the shell with the satellite image: center stays centered and north stays up', () => {
    const polygon = lShapePolygon();
    const registration = groundRegistration(polygon);
    expect(registration).not.toBeNull();
    const local = polygonToLocalMeters(polygon);
    const scale = registration!.frame.scale;
    const center = shellMetersToSatelliteUv(local.width / 2 * scale, local.depth / 2 * scale, registration!.frame, registration!.bounds);
    expect(center.u).toBeCloseTo(0.5, 4);
    expect(center.v).toBeCloseTo(0.5, 4);
    const south = shellMetersToSatelliteUv(local.width / 2 * scale, 0, registration!.frame, registration!.bounds);
    const north = shellMetersToSatelliteUv(local.width / 2 * scale, local.depth * scale, registration!.frame, registration!.bounds);
    expect(north.v).toBeGreaterThan(south.v);
    const west = shellMetersToSatelliteUv(0, local.depth / 2 * scale, registration!.frame, registration!.bounds);
    const east = shellMetersToSatelliteUv(local.width * scale, local.depth / 2 * scale, registration!.frame, registration!.bounds);
    expect(east.u).toBeGreaterThan(west.u);
    const url = satelliteProxyUrl(polygon, 'secret-key');
    expect(url).toContain('west=');
    expect(url).toContain('north=');
    expect(url).not.toContain('zoom=');
    const parsed = parseSatelliteImageBounds(url!);
    expect(parsed?.west).toBeCloseTo(registration!.bounds.west, 6);
    expect(parsed?.north).toBeCloseTo(registration!.bounds.north, 6);
    const { layout } = createVenueFromPick(INITIAL_LAYOUT as RoomLayout, {
      name: '盐官古城', location: '潮乐之城', polygon, satelliteGround: false,
    });
    expect(layout.mapGroundFrame?.lng0).toBeCloseTo(registration!.frame.lng0, 6);
    expect(layout.mapGroundFrame?.scale).toBe(registration!.frame.scale);
    expect(satelliteImageAligned(url)).toBe(true);
    expect(satelliteImageAligned(url!.replace(/west=[^&]+&south=[^&]+&east=[^&]+&north=[^&]+/, 'location=120.54,30.40&zoom=18'))).toBe(false);
    const shell = layout.backendVenue?.polygon ?? [];
    expect(shell.length).toBeGreaterThanOrEqual(3);
    for (const point of shell) {
      const lng = registration!.frame.lng0 + (point.x / registration!.frame.scale) / metersPerDegreeLng(registration!.frame.latMid);
      const lat = registration!.frame.lat0 + (point.z / registration!.frame.scale) / METERS_PER_DEGREE_LAT;
      const nearest = polygon.reduce((best, candidate) => {
        const east = (candidate.lng - lng) * metersPerDegreeLng(registration!.frame.latMid);
        const north = (candidate.lat - lat) * METERS_PER_DEGREE_LAT;
        return Math.min(best, Math.hypot(east, north));
      }, Infinity);
      expect(nearest).toBeLessThan(0.2);
    }
    const drawn = satelliteProxyUrl(polygon, 'secret-key');
    expect(drawn).toBe(url);
  });

  it('keeps an oversized site on the same origin after the shell is scaled under 100m', () => {
    const lat = 30.4;
    const lng = 120.53;
    const dLng = 200 / metersPerDegreeLng(lat);
    const dLat = 80 / METERS_PER_DEGREE_LAT;
    const polygon = [
      { lng, lat },
      { lng: lng + dLng, lat },
      { lng: lng + dLng, lat: lat + dLat },
      { lng, lat: lat + dLat },
    ];
    const registration = groundRegistration(polygon);
    expect(registration!.frame.scale).toBeLessThan(1);
    expect(registration!.shellWidth).toBeLessThanOrEqual(100);
    const east = shellMetersToSatelliteUv(registration!.shellWidth, registration!.shellDepth / 2, registration!.frame, registration!.bounds);
    const west = shellMetersToSatelliteUv(0, registration!.shellDepth / 2, registration!.frame, registration!.bounds);
    expect(east.u).toBeGreaterThan(west.u);
    expect(east.u).toBeLessThan(0.95);
    expect(west.u).toBeGreaterThan(0.05);
    const { layout } = createVenueFromPick(INITIAL_LAYOUT as RoomLayout, {
      name: '盐官潮乐之城', location: '海宁盐官', polygon, satelliteGround: false,
    });
    expect(layout.mapGroundFrame?.scale).toBeCloseTo(registration!.frame.scale, 6);
    expect(layout.width).toBe(registration!.shellWidth);
    expect(layout.height).toBe(registration!.shellDepth);
  });

  it('does not report 未定位 when the drawn polygon is already known', () => {
    expect(satelliteMissReason(
      { mapGroundPolygon: lShapePolygon(), mapLngLat: { lng: 120.54, lat: 30.4 } },
      null,
      { key: 'js-key', staticKey: 'static-key' },
    )).toBeNull();
    expect(satelliteMissReason({}, null, { key: '', staticKey: '' })).toBe('key');
    expect(satelliteMissReason({}, null, { key: 'js-key', staticKey: 'static-key' })).toBe('place');
  });

  it('keeps a same-origin satellite url when the jpeg header is oddly cased', async () => {
    vi.stubGlobal('window', { location: { hostname: 'scendance.lilicoding.space' } });
    const bytes = new Uint8Array(120);
    bytes[0] = 0xff;
    bytes[1] = 0xd8;
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      headers: { get: () => 'Image/JPEG' },
      arrayBuffer: async () => bytes.buffer,
    }));
    const url = await fetchSatelliteGroundDataUrl(lShapePolygon());
    expect(url?.startsWith('/api/amap-static?')).toBe(true);
    expect(url).toContain('x-ref=satellite-ground-ref');
  });

  it('uses a placeholder when the key is missing so the ground is not left plain', async () => {
    vi.stubEnv('NEXT_PUBLIC_AMAP_KEY', '');
    vi.stubEnv('NEXT_PUBLIC_AMAP_STATIC_KEY', '');
    const named = { ...(INITIAL_LAYOUT as RoomLayout), name: '盐官潮乐之城 · 规划区 84.6×100m' };
    const patch = await ensureSatelliteGround(named);
    expect(patch?.satelliteGroundRef).toBe(true);
    expect(patch?.floorPlanImage).toContain(SATELLITE_GROUND_MARK);
    expect(patch?.floorPlanImage?.startsWith('data:image/svg')).toBe(true);
    expect(patch?.mapGroundPolygon).toBeUndefined();
    expect(await ensureSatelliteGround({ ...named, floorPlanImage: patch!.floorPlanImage, satelliteGroundRef: true })).toBeNull();
  });
});
