import { describe, expect, it } from 'vitest';
import { anchorFromMapFrame, METERS_PER_DEGREE_LAT, metersPerDegreeLng } from './amap-venue';
import { anchorBasemapYawRad, anchorGeoToWorld, sceneAnchorOf } from './scene-anchor';
import { researchBasemapPlacement, researchGeoToWorld } from '../three/research-basemap';
import type { RoomLayout, SceneAnchor } from './types';

const XIHU = { lng: 120.121358, lat: 30.222692 };

function layoutWith(patch: Partial<RoomLayout>): RoomLayout {
  return { name: '测试', width: 11.7, height: 3.7, floors: [], ...patch } as unknown as RoomLayout;
}

describe('sceneAnchorOf', () => {
  it('显式 sceneAnchor 优先，旧字段不参与', () => {
    const anchor: SceneAnchor = { ...XIHU, orientationDeg: 0, metersPerUnit: 1 };
    const layout = layoutWith({
      sceneAnchor: anchor,
      // 残留一套北京旧框架也不该影响：锚点在场时它就是唯一变换。
      mapGroundFrame: { lng0: 116.46, lat0: 39.96, latMid: 39.96, scale: 1 },
      mapLngLat: { lng: 116.46, lat: 39.96 },
    });
    expect(sceneAnchorOf(layout)).toEqual(anchor);
  });

  it('旧存档只有 mapGroundFrame 时反推出同一个锚点（兼容路径）', () => {
    const frame = { lng0: 120.11, lat0: 30.23, latMid: 30.2227, scale: 1, latSign: -1 as const };
    const anchor = sceneAnchorOf(layoutWith({ mapGroundFrame: frame }))!;
    const scale = frame.scale;
    expect(anchor.lng).toBeCloseTo(frame.lng0 + 11.7 / (2 * scale * metersPerDegreeLng(frame.latMid)), 10);
    expect(anchor.lat).toBeCloseTo(frame.lat0 - 3.7 / (2 * scale * METERS_PER_DEGREE_LAT), 10);
    expect(anchor.orientationDeg).toBe(0);
    expect(anchor.metersPerUnit).toBe(1);
  });

  it('壳体缩小时 metersPerUnit = 1/scale', () => {
    const frame = { lng0: 120.11, lat0: 30.23, latMid: 30.22, scale: 0.5, latSign: -1 as const };
    expect(anchorFromMapFrame(frame, 60, 40).metersPerUnit).toBe(2);
  });

  it('没有任何地理信息时返回 null', () => {
    expect(sceneAnchorOf(layoutWith({}))).toBeNull();
  });
});

describe('anchorGeoToWorld', () => {
  const anchor: SceneAnchor = { ...XIHU, orientationDeg: 0, metersPerUnit: 1 };

  it('原点在 (0,0)；东 +x、南 +z，米制是真实投影常数', () => {
    expect(anchorGeoToWorld(anchor, anchor.lng, anchor.lat)).toEqual({ x: 0, z: 0 });
    const east = anchorGeoToWorld(anchor, anchor.lng + 0.001, anchor.lat);
    // 经度向 0.001° ≈ 96.19m（110574·cos(30.22°)·0.001）——瓦片 z15 约 4.9m/px，换算必须远小于它。
    expect(east.x).toBeCloseTo(metersPerDegreeLng(anchor.lat) * 0.001, 6);
    expect(east.z).toBeCloseTo(0, 6);
    const south = anchorGeoToWorld(anchor, anchor.lng, anchor.lat - 0.001);
    expect(south.z).toBeCloseTo(METERS_PER_DEGREE_LAT * 0.001, 6);
    expect(south.x).toBeCloseTo(0, 6);
  });

  it('orientationDeg=90 时地理正东落在世界 -Z（平面图上沿）', () => {
    const turned: SceneAnchor = { ...anchor, orientationDeg: 90 };
    const east = anchorGeoToWorld(turned, anchor.lng + 0.001, anchor.lat);
    expect(east.x).toBeCloseTo(0, 4);
    expect(east.z).toBeCloseTo(-metersPerDegreeLng(anchor.lat) * 0.001, 4);
    expect(anchorBasemapYawRad(turned)).toBeCloseTo(-Math.PI / 2, 6);
  });

  it('metersPerUnit=2（壳体缩小一半）时世界坐标同步缩一半', () => {
    const shrunk: SceneAnchor = { ...anchor, metersPerUnit: 2 };
    const full = anchorGeoToWorld(anchor, anchor.lng + 0.001, anchor.lat);
    const half = anchorGeoToWorld(shrunk, anchor.lng + 0.001, anchor.lat);
    expect(half.x).toBeCloseTo(full.x / 2, 6);
  });
});

describe('researchBasemapPlacement（锚点驱动）', () => {
  const area = {
    name: '西湖', address: '', center: XIHU,
    bounds: { west: XIHU.lng - 0.06, south: XIHU.lat - 0.06, east: XIHU.lng + 0.06, north: XIHU.lat + 0.06 },
    radiusM: 6000, widthM: 11500, depthM: 13300, imageUrl: 'x',
    detailBounds: { west: XIHU.lng - 0.002, south: XIHU.lat - 0.002, east: XIHU.lng + 0.002, north: XIHU.lat + 0.002 },
    detailImageUrl: 'y', style: 6 as const,
  };

  it('锚点与底图同中心：底图正好铺在世界原点脚下，尺寸是真实米', () => {
    const layout = layoutWith({ sceneAnchor: { ...XIHU, orientationDeg: 0, metersPerUnit: 1 }, researchArea: area });
    const placement = researchBasemapPlacement(layout)!;
    expect(placement.centerX).toBeCloseTo(0, 6);
    expect(placement.centerZ).toBeCloseTo(0, 6);
    expect(placement.widthM).toBeCloseTo((area.bounds.east - area.bounds.west) * metersPerDegreeLng(XIHU.lat), 6);
    expect(placement.depthM).toBeCloseTo((area.bounds.north - area.bounds.south) * METERS_PER_DEGREE_LAT, 6);
    expect(placement.yawRad).toBe(0);
  });

  it('旧存档只有框架时，新铺图数学与旧框架数学等价（回归证明，厘米级）', () => {
    // 壳体中心在 (120.14, 30.21)，底图中心在西湖 —— 偏移几十公里也能正确换算。
    const frame = { lng0: 120.13, lat0: 30.215, latMid: 30.21, scale: 0.8, latSign: -1 as const };
    const legacyLayout = layoutWith({ mapGroundFrame: frame, researchArea: area });
    const anchoredLayout = layoutWith({ sceneAnchor: anchorFromMapFrame(frame, 11.7, 3.7), researchArea: area });

    const mLng = metersPerDegreeLng(frame.latMid);
    const venueLng = frame.lng0 + 11.7 / (2 * frame.scale * mLng);
    const venueLat = frame.lat0 - 3.7 / (2 * frame.scale * METERS_PER_DEGREE_LAT);
    const boundsLng = (area.bounds.west + area.bounds.east) / 2;
    const boundsLat = (area.bounds.south + area.bounds.north) / 2;
    // 旧数学（research-basemap 改造前的公式）。新实现 mLng 取锚点纬度、旧代码取 latMid，
    // 两者在公里级偏移上差几厘米——容差 0.1m，远小于瓦片精度（z15 约 4.9m/px）。
    const legacyX = (boundsLng - venueLng) * mLng * frame.scale;
    const legacyZ = (venueLat - boundsLat) * METERS_PER_DEGREE_LAT * frame.scale;

    for (const layout of [legacyLayout, anchoredLayout]) {
      const placement = researchBasemapPlacement(layout)!;
      expect(Math.abs(placement.centerX - legacyX)).toBeLessThan(0.1);
      expect(Math.abs(placement.centerZ - legacyZ)).toBeLessThan(0.1);
      expect(placement.widthM).toBeCloseTo((area.bounds.east - area.bounds.west) * metersPerDegreeLng(area.center.lat) * frame.scale, 4);
      expect(placement.depthM).toBeCloseTo((area.bounds.north - area.bounds.south) * METERS_PER_DEGREE_LAT * frame.scale, 4);
    }
  });

  it('残留异地框架（北京）+ 西湖锚点：底图落在锚点脚下，不被拽走（旧 bug 的定性修复）', () => {
    const layout = layoutWith({
      sceneAnchor: { ...XIHU, orientationDeg: 0, metersPerUnit: 1 },
      mapGroundFrame: { lng0: 116.46, lat0: 39.96, latMid: 39.96, scale: 1 },
      mapLngLat: { lng: 116.46, lat: 39.96 },
      researchArea: area,
    });
    const placement = researchBasemapPlacement(layout)!;
    expect(Math.hypot(placement.centerX, placement.centerZ)).toBeLessThan(1);
    const cross = researchGeoToWorld(layout, XIHU.lng, XIHU.lat)!;
    expect(Math.hypot(cross.x, cross.z)).toBeLessThan(0.001);
  });
});
