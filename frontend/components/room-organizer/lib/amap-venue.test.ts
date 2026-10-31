import { describe, it, expect } from 'vitest';
import {
  polygonBboxMeters,
  polygonToLocalMeters,
  fitPolygonToShellLimit,
  createVenueFromPick,
  makeSatelliteGroundPlaceholder,
  isSatelliteGroundImage,
  SATELLITE_GROUND_LABEL,
  SATELLITE_GROUND_MARK,
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
    expect(off.satelliteGroundRef).toBeUndefined();
    expect(off.floorPlanImage).toBeUndefined();
  });
});
