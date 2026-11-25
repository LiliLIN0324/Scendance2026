import { describe, expect, it } from 'vitest';
import botanicalGarden from './__testfixtures__/hangzhou-botanical-garden.json';
import { planBoundaryFromSearchArea, trueFootprintBoundary } from './outdoor-venue-sync';

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
