import { describe, expect, it } from 'vitest';
import {
  PINGHU_WGS84,
  gcjWgs84RoundTrip,
  metersPerDegreeLng,
  ringAreaM2,
  ringPerimeterM,
  scaleConsistency,
  squareSampleBoundary,
  wgs84ToEnu,
} from './tdt-probe-scale';

describe('tdt probe scale fixture (H0-c)', () => {
  it('reports a 500×500 m square: area 250000 m², diagonal ≈ 707.1 m, perimeter 2000 m', () => {
    const boundary = squareSampleBoundary(500);
    expect(boundary).toHaveLength(4);
    expect(ringAreaM2(boundary)).toBeCloseTo(250000, 4);
    expect(ringPerimeterM(boundary)).toBeCloseTo(2000, 4);
    expect(scaleConsistency(500).diagonalM).toBeCloseTo(707.10678, 3);
  });

  it('guarantees the two-basemap ≤1cm consistency invariant (same geometry, no drift)', () => {
    const result = scaleConsistency(500);
    // 同一几何：矢量/影像切换不产生几何漂移，绝对误差 = 0 ≤ 0.01 m。
    expect(result.maxAbsErrorM).toBeLessThanOrEqual(0.01);
    // 交叉验证：两条对角线总长 = 2 × 单对角线。
    expect(result.crossDiagonalsM).toBeCloseTo(result.diagonalM * 2, 6);
  });

  it('maps WGS84 → local ENU with correct east/north magnitudes', () => {
    const eastPoint = { lng: PINGHU_WGS84.lng + 0.001, lat: PINGHU_WGS84.lat };
    const northPoint = { lng: PINGHU_WGS84.lng, lat: PINGHU_WGS84.lat + 0.001 };
    const east = wgs84ToEnu(eastPoint.lng, eastPoint.lat, PINGHU_WGS84);
    const north = wgs84ToEnu(northPoint.lng, northPoint.lat, PINGHU_WGS84);
    expect(east.x).toBeCloseTo(metersPerDegreeLng(PINGHU_WGS84.lat) * 0.001, 2);
    expect(east.y).toBeCloseTo(0, 2);
    // 纬度 1 度 ≈ 111132.92 m；0.001 度 ≈ 111.13 m。
    expect(north.y).toBeCloseTo(111.13292, 2);
    expect(north.x).toBeCloseTo(0, 2);
  });

  it('round-trips GCJ-02 ↔ WGS-84 within sub-meter error', () => {
    const gcj = { lng: 120.1460368, lat: 30.2521924 }; // 平湖秋月 GCJ-02
    const result = gcjWgs84RoundTrip(gcj);
    expect(result.roundTripM).toBeLessThan(1); // 往返误差 < 1 m，转换可用
    expect(result.wgs.lng).not.toEqual(gcj.lng); // 国内确实有偏移
  });
});