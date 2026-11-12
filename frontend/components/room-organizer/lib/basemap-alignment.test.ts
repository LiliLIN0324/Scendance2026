import { describe, expect, it } from 'vitest';
import { alignedTileBounds, alignedTileCenter, needsWgs84Alignment } from './basemap-alignment';
import { gcj02ToWgs84, wgs84ToGcj02 } from './geo-coords';

const HANGZHOU = { lng: 120.141306, lat: 30.2545 };

describe('basemap-alignment', () => {
  it('高德三档是 GCJ-02，不换算；其余公开源要换算到 WGS-84', () => {
    expect(needsWgs84Alignment('amap-satellite')).toBe(false);
    expect(needsWgs84Alignment('amap-streets')).toBe(false);
    expect(needsWgs84Alignment('amap-streets-labels')).toBe(false);
    expect(needsWgs84Alignment('osm')).toBe(true);
    expect(needsWgs84Alignment('carto-light')).toBe(true);
    expect(needsWgs84Alignment('vec')).toBe(true);
    expect(needsWgs84Alignment('img')).toBe(true);
  });

  it('高德源视点原样返回', () => {
    expect(alignedTileCenter(HANGZHOU.lng, HANGZHOU.lat, 'amap-satellite')).toEqual(HANGZHOU);
  });

  it('OSM 视点换算成 WGS-84：杭州一带约 500 m 量级，且能反推回原值', () => {
    const shifted = alignedTileCenter(HANGZHOU.lng, HANGZHOU.lat, 'osm');
    const back = wgs84ToGcj02(shifted.lng, shifted.lat);
    expect(Math.abs(back.lng - HANGZHOU.lng)).toBeLessThan(1e-6);
    expect(Math.abs(back.lat - HANGZHOU.lat)).toBeLessThan(1e-6);
    const dLng = Math.abs(shifted.lng - HANGZHOU.lng);
    const dLat = Math.abs(shifted.lat - HANGZHOU.lat);
    expect(dLng).toBeGreaterThan(0.003);
    expect(dLat).toBeGreaterThan(0.001);
  });

  it('范围整体平移：四角偏移一致、宽高不变', () => {
    const bounds = { west: HANGZHOU.lng - 0.001, south: HANGZHOU.lat - 0.0006, east: HANGZHOU.lng + 0.001, north: HANGZHOU.lat + 0.0006 };
    const shifted = alignedTileBounds(bounds, 'carto-light');
    const center = gcj02ToWgs84(HANGZHOU.lng, HANGZHOU.lat);
    const dLng = center.lng - HANGZHOU.lng;
    const dLat = center.lat - HANGZHOU.lat;
    expect(shifted.west).toBeCloseTo(bounds.west + dLng, 12);
    expect(shifted.east).toBeCloseTo(bounds.east + dLng, 12);
    expect(shifted.south).toBeCloseTo(bounds.south + dLat, 12);
    expect(shifted.north).toBeCloseTo(bounds.north + dLat, 12);
    expect(alignedTileBounds(bounds, 'amap-streets')).toEqual(bounds);
  });
});