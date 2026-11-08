import { describe, expect, it } from 'vitest';
import { gcj02ToWgs84, isInGcjOffsetRegion, wgs84ToGcj02 } from './geo-coords';

/** 度 → 米（杭州纬度 30° 附近的近似换算）。 */
function meters(dLng: number, dLat: number): { lngM: number; latM: number } {
  return { lngM: dLng * 111320 * Math.cos((30 / 180) * Math.PI), latM: dLat * 110950 };
}

describe('geo-coords（GCJ-02 ↔ WGS-84，MAP-04 坐标边界）', () => {
  it('杭州点位：正向偏移量在 100–800 m 内（国内典型火星偏移量级）', () => {
    const gcj = wgs84ToGcj02(120.15, 30.25);
    const { lngM, latM } = meters(gcj.lng - 120.15, gcj.lat - 30.25);
    expect(Math.hypot(lngM, latM)).toBeGreaterThan(100);
    expect(Math.hypot(lngM, latM)).toBeLessThan(800);
    // 杭州（120.15, 30.25）实测偏移方向：经度向东、纬度向南，符号钉死防算法回归
    expect(lngM).toBeGreaterThan(0);
    expect(latM).toBeLessThan(0);
  });

  it('gcj02ToWgs84 与 wgs84ToGcj02 互逆：往返 < 1e-6 度（≈0.1 m）', () => {
    const wgs = { lng: 120.14432, lat: 30.25271 };
    const gcj = wgs84ToGcj02(wgs.lng, wgs.lat);
    const back = gcj02ToWgs84(gcj.lng, gcj.lat);
    expect(Math.abs(back.lng - wgs.lng)).toBeLessThan(1e-6);
    expect(Math.abs(back.lat - wgs.lat)).toBeLessThan(1e-6);
  });

  it('迭代反推收敛：gcj02ToWgs84 输出再正向变换应回到输入', () => {
    const gcj = { lng: 120.15524, lat: 30.25641 };
    const wgs = gcj02ToWgs84(gcj.lng, gcj.lat);
    const again = wgs84ToGcj02(wgs.lng, wgs.lat);
    expect(Math.abs(again.lng - gcj.lng)).toBeLessThan(1e-9);
    expect(Math.abs(again.lat - gcj.lat)).toBeLessThan(1e-9);
  });

  it('境外坐标原样返回（伦敦）', () => {
    expect(isInGcjOffsetRegion(-0.1276, 51.5072)).toBe(false);
    expect(wgs84ToGcj02(-0.1276, 51.5072)).toEqual({ lng: -0.1276, lat: 51.5072 });
    expect(gcj02ToWgs84(-0.1276, 51.5072)).toEqual({ lng: -0.1276, lat: 51.5072 });
  });

  it('偏移随位置平滑变化（同一条线上相邻点不跳变）', () => {
    const a = wgs84ToGcj02(120.0, 30.0);
    const b = wgs84ToGcj02(120.01, 30.01);
    // 间隔 0.01° 的两点，输出间隔应仍 ≈0.01°（偏移场连续，局部不突变）
    expect(Math.abs(b.lng - a.lng - 0.01)).toBeLessThan(0.005);
    expect(Math.abs(b.lat - a.lat - 0.01)).toBeLessThan(0.005);
  });
});
