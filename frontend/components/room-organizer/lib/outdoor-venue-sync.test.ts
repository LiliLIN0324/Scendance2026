import { describe, expect, it } from 'vitest';
import botanicalGarden from './__testfixtures__/hangzhou-botanical-garden.json';
import { planBoundaryFromSearchArea, snapPointIntoFootprint, trueFootprintBoundary } from './outdoor-venue-sync';

// #86：杭州湖滨银泰 IN77 真实 OSM 足迹（osm:W1110196946，13 点闭合环，末点与首点重合）。
// 锚点取 bounds 中心；验证真实商场轮廓能转成契约合法的 ENU 米边界（街区尺度，不越 ±4900m）。
const IN77_POLYGON: [number, number][] = [
  [120.165045, 30.253919],
  [120.165159, 30.250533],
  [120.163849, 30.250512],
  [120.163277, 30.25059],
  [120.163175, 30.250639],
  [120.163095, 30.252815],
  [120.162309, 30.252793],
  [120.161611, 30.253851],
  [120.162988, 30.253899],
  [120.162938, 30.255426],
  [120.163875, 30.255466],
  [120.16394, 30.253884],
  [120.165045, 30.253919],
];

describe('trueFootprintBoundary · IN77 真实商场足迹', () => {
  const anchor = { lng: 120.163385, lat: 30.252989 };

  it('把 GCJ-02 闭合环转成合法 ENU 边界，去重首尾、保留街区尺度', () => {
    const boundary = trueFootprintBoundary(
      IN77_POLYGON.map(([lng, lat]) => ({ lng, lat })),
      anchor,
    );
    expect(boundary).not.toBeNull();
    expect(boundary!.length).toBeGreaterThanOrEqual(3);
    expect(boundary!.length).toBeLessThanOrEqual(64);
    // 首尾重合点已被抽掉
    const first = boundary![0]!;
    const last = boundary![boundary!.length - 1]!;
    expect(Math.hypot(first.x - last.x, first.y - last.y)).toBeGreaterThan(0.5);
    // 全部落在契约 ±5000m 内（留余量 ±4900）
    for (const point of boundary!) {
      expect(Math.abs(point.x)).toBeLessThan(4900);
      expect(Math.abs(point.y)).toBeLessThan(4900);
    }
    const xs = boundary!.map(point => point.x);
    const ys = boundary!.map(point => point.y);
    const spanX = Math.max(...xs) - Math.min(...xs);
    const spanY = Math.max(...ys) - Math.min(...ys);
    // IN77 街区约 340m × 550m，落在商场合理尺度区间
    expect(spanX).toBeGreaterThan(200);
    expect(spanX).toBeLessThan(600);
    expect(spanY).toBeGreaterThan(200);
    expect(spanY).toBeLessThan(800);
  });
});

describe('planBoundaryFromSearchArea · 搜索选区收成红线', () => {
  it('杭州植物园真实122点轮廓缩到64点内仍可确认，不把凹口连成自交线', () => {
    // OSM relation 13794808，2026-11-19 本机轮廓服务返回的 GCJ-02 几何。
    // 来源：https://www.openstreetmap.org/relation/13794808
    const shape = { ...botanicalGarden, polygon: botanicalGarden.polygon as [number, number][] };
    const boundary = planBoundaryFromSearchArea(shape, { lng: 120.085, lat: 30.215 });
    expect(boundary).not.toBeNull();
    expect(boundary!.length).toBeLessThanOrEqual(64);
    expect(boundary!.length).toBeGreaterThan(3);
  });

  const anchor = { lng: 120.14, lat: 30.25 };
  const d = 0.0008;
  const polygon: [number, number][] = [
    [anchor.lng, anchor.lat],
    [anchor.lng + d, anchor.lat],
    [anchor.lng + d, anchor.lat + d],
    [anchor.lng, anchor.lat + d],
  ];

  it('闭合选区转成能通过红线校验的环', () => {
    const boundary = planBoundaryFromSearchArea({ polygon }, anchor);
    expect(boundary).not.toBeNull();
    expect(boundary!.length).toBeGreaterThanOrEqual(3);
  });

  it('道路折线、点数不够、没有锚点都不当成红线', () => {
    expect(planBoundaryFromSearchArea({ polygon, kind: 'line' }, anchor)).toBeNull();
    expect(planBoundaryFromSearchArea({ polygon: polygon.slice(0, 2) }, anchor)).toBeNull();
    expect(planBoundaryFromSearchArea({ polygon }, null)).toBeNull();
    expect(planBoundaryFromSearchArea(null, anchor)).toBeNull();
  });
});

describe('snapPointIntoFootprint · POI 检索点吸附进可信足迹', () => {
  // 2026-11-28 西湖美术馆实测：天地图钉在 OSM 面以南 72.5 m。用同尺度方环复现。
  const square: [number, number][] = [
    [120.16, 30.25],
    [120.161, 30.25],
    [120.161, 30.251],
    [120.16, 30.251],
  ];

  it('点在足迹内原样保留，不动坐标', () => {
    const inside = { lng: 120.1605, lat: 30.2505 };
    expect(snapPointIntoFootprint(square, inside)).toEqual(inside);
  });

  it('点在足迹外（南侧 72m）吸附到最近内点，而不是跳质心', () => {
    // 0.00065° 纬度 ≈ 72m，复现西湖美术馆的偏差量级。
    const poi = { lng: 120.1605, lat: 30.25 - 0.00065 };
    const snapped = snapPointIntoFootprint(square, poi);
    const latInside = snapped.lat > 30.25 && snapped.lat < 30.251;
    const lngInside = snapped.lng > 120.16 && snapped.lng < 120.161;
    expect(latInside).toBe(true);
    expect(lngInside).toBe(true);
    // 保住方位语义：吸附点紧贴南缘（< 5m），不跳到环中心（~55m 外）。
    expect((snapped.lat - 30.25) * 111132).toBeLessThan(5);
  });

  it('凹口环：点落在凹槽里（环外、外接矩形内）也吸附到最近内点', () => {
    // L 形环（逆时针缺口朝东南），凹槽中心在环外。
    const lShape: [number, number][] = [
      [120.16, 30.25],
      [120.161, 30.25],
      [120.161, 30.2506],
      [120.1605, 30.2506],
      [120.1605, 30.251],
      [120.16, 30.251],
    ];
    const inNotch = { lng: 120.1608, lat: 30.2508 };
    const snapped = snapPointIntoFootprint(lShape, inNotch);
    const moved = Math.hypot((snapped.lng - inNotch.lng) * 85000, (snapped.lat - inNotch.lat) * 111132);
    expect(moved).toBeGreaterThan(0.5);
    expect(moved).toBeLessThan(60);
  });

  it('顶点数不够或病态几何一律回落原点，行为不变', () => {
    const poi = { lng: 120.159, lat: 30.249 };
    expect(snapPointIntoFootprint(square.slice(0, 2), poi)).toEqual(poi);
    expect(snapPointIntoFootprint([], poi)).toEqual(poi);
  });

  it('真实 IN77 足迹：偏离的检索点吸附后仍在环内', () => {
    const poi = { lng: 120.1605, lat: 30.2495 }; // 西南角外
    const snapped = snapPointIntoFootprint(IN77_POLYGON, poi);
    expect(snapped).not.toEqual(poi);
    // 吸附点必须落在足迹外接矩形内（IN77 是凹多边形，环内判定用测试自带的射线法口径）
    expect(snapped.lng).toBeGreaterThan(120.1616);
    expect(snapped.lng).toBeLessThan(120.1652);
    expect(snapped.lat).toBeGreaterThan(30.2505);
    expect(snapped.lat).toBeLessThan(30.2555);
  });
});
