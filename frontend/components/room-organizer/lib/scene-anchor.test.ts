import { describe, expect, it } from 'vitest';
import { anchorFromMapFrame, frameFromAnchor, METERS_PER_DEGREE_LAT, metersPerDegreeLng } from './amap-venue';
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

  it('frame 只是锚点的视图：往返一圈误差 < 1 cm', () => {
    const frame = { lng0: 120.13, lat0: 30.215, latMid: 30.21, scale: 0.8, latSign: -1 as const };
    const anchor = anchorFromMapFrame(frame, 11.7, 3.7);
    const back = frameFromAnchor(anchor, 11.7, 3.7);
    expect(Math.abs(back.lng0 - frame.lng0) * metersPerDegreeLng(anchor.lat)).toBeLessThan(0.01);
    expect(Math.abs(back.lat0 - frame.lat0) * METERS_PER_DEGREE_LAT).toBeLessThan(0.01);
    expect(back.scale).toBeCloseTo(frame.scale, 10);
    // 旧场地的圈画点只有纬度向符号不同：latSign=+1 时 z 向北，往返仍成立。
    const northward = frameFromAnchor(anchorFromMapFrame({ ...frame, latSign: 1 }, 11.7, 3.7), 11.7, 3.7, 1);
    expect(Math.abs(northward.lat0 - frame.lat0) * METERS_PER_DEGREE_LAT).toBeLessThan(0.01);
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
    style: 6 as const,
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
      // 宽度按「锚点纬度」换算：世界坐标是锚点定的，底图宽度必须和它同一把尺子。
      const mLngAtAnchor = metersPerDegreeLng(anchorFromMapFrame(frame, 11.7, 3.7).lat);
      expect(placement.widthM).toBeCloseTo((area.bounds.east - area.bounds.west) * mLngAtAnchor * frame.scale, 4);
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

describe('底图与场景地面的重合误差（验收：≤ 1 个瓦片像素）', () => {
  // 代理按墨卡托烘焙整片底图（tools/aholo/lux3d-dev-proxy.mjs fetchAmapBounds），
  // 铺进 3D 时按经纬度线性拉伸到真实米数——两条链路的差就是重合误差。
  // 这里把两条链路都算出来，用米数断言；z15 瓦片在本纬度 4.13 m/px。
  const TILE_M = 4.13;
  const mercatorPixel = (lng: number, lat: number, zoom: number) => {
    const span = 2 ** zoom * 256;
    const latRad = (lat * Math.PI) / 180;
    return {
      x: ((lng + 180) / 360) * span,
      y: ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * span,
    };
  };
  // 底图中心在「西湖风景名胜区」POI，比茶亭偏北约 1.9 km——真实摆放条件下的偏差。
  const center = { lng: 120.128, lat: 30.238 };
  const half = 0.06;
  const bounds = { west: center.lng - half, east: center.lng + half, south: center.lat - half, north: center.lat + half };
  const scened = layoutWith({
    sceneAnchor: { ...XIHU, orientationDeg: 0, metersPerUnit: 1 },
    researchArea: {
      name: '西湖', address: '', center, bounds, radiusM: 6000,
      widthM: (bounds.east - bounds.west) * 96_000, depthM: (bounds.north - bounds.south) * METERS_PER_DEGREE_LAT,
      imageUrl: 'x', style: 6 as const,
    },
  });
  const placement = researchBasemapPlacement(scened)!;
  const zoom = 15;
  const nw = mercatorPixel(bounds.west, bounds.north, zoom);
  const se = mercatorPixel(bounds.east, bounds.south, zoom);
  // 底图像素 → 世界坐标（平面线性铺法）；地理坐标 → 世界坐标（锚点唯一变换）。
  const byPlane = (lng: number, lat: number) => {
    const p = mercatorPixel(lng, lat, zoom);
    const u = (p.x - nw.x) / (se.x - nw.x);
    const v = (p.y - nw.y) / (se.y - nw.y);
    return { x: placement.centerX + (u - 0.5) * placement.widthM, z: placement.centerZ + (v - 0.5) * placement.depthM };
  };
  const byAnchor = (lng: number, lat: number) => anchorGeoToWorld(scened.sceneAnchor!, lng, lat);
  const offsetM = (lng: number, lat: number) => {
    const a = byAnchor(lng, lat);
    const b = byPlane(lng, lat);
    return Math.hypot(a.x - b.x, a.z - b.z);
  };

  it('场地本体（茶亭）偏差远小于 1 个瓦片像素', () => {
    expect(offsetM(XIHU.lng, XIHU.lat)).toBeLessThan(TILE_M);
    expect(offsetM(XIHU.lng, XIHU.lat)).toBeLessThan(3);
  });

  it('12 km 底图的四角与场地中心都在 1 个瓦片像素内', () => {
    const corners = [[bounds.west, bounds.north], [bounds.east, bounds.north], [bounds.west, bounds.south], [bounds.east, bounds.south]];
    for (const [lng, lat] of corners) expect(offsetM(lng!, lat!)).toBeLessThan(TILE_M);
    expect(offsetM(center.lng, center.lat)).toBeLessThan(TILE_M);
  });
});
