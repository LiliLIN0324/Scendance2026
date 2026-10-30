import { describe, it, expect } from 'vitest';
import { polygonBboxMeters, createVenueFromPick } from './amap-venue';
import { INITIAL_LAYOUT } from './initial-layout';
import type { RoomLayout } from './types';

describe('amap venue pick', () => {
  it('converts a polygon bbox to meters at Haining latitude', () => {
    // 盐官观潮胜地公园一带：约 0.009° 纬度 × 0.018° 经度（~1km × 1.7km）
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
  });
  it('builds an outdoor shell named after the place, clamping oversized sites into a planning zone', () => {
    const before = INITIAL_LAYOUT as RoomLayout;
    const layout = createVenueFromPick(before, { name: '盐官潮乐之城', location: '海宁盐官', polygon: [
      { lng: 120.53, lat: 30.40 }, { lng: 120.548, lat: 30.40 }, { lng: 120.548, lat: 30.409 }, { lng: 120.53, lat: 30.409 },
    ] });
    expect(layout.name).toContain('盐官潮乐之城');
    expect(layout.width).toBeLessThanOrEqual(100);
    expect(layout.height).toBeLessThanOrEqual(100);
    // 大场地：真实范围进名称，不丢地理实据
    expect(layout.name).toMatch(/真实范围 \d+×\d+m/);
  });
});
