import { describe, expect, it } from 'vitest';
import { defaultScanPlacement, planPointFromGeo, planPointFromWorld, scanPlacementNote, worldFromPlanPoint } from './scan-placement';
import { METERS_PER_DEGREE_LAT, metersPerDegreeLng } from './amap-venue';
import type { PlanAnchor } from '../../../../supabase/functions/_shared/site-plan';
import type { RoomLayout, SceneAnchor } from './types';

/**
 * 2026-11-19 用户：「为什么点了还是没有落在场地上？」
 * 这条链路的判据只有两条：没 geo 时默认落在调研范围 / 地块的中心，
 * 以及地图上点的那一格要能换算回同一个世界落点。
 */

const XIHU = { lng: 120.121358, lat: 30.222692 };
const anchor: SceneAnchor = { ...XIHU, orientationDeg: 0, metersPerUnit: 1 };
const planAnchor: PlanAnchor = { ...XIHU, crs: 'gcj-02', source: 'preset' };

function layoutWith(patch: Partial<RoomLayout>): RoomLayout {
  return { name: '测试场地', width: 60, height: 40, floors: [], ...patch } as unknown as RoomLayout;
}

const area = {
  name: '西湖', address: '', center: XIHU,
  bounds: { west: XIHU.lng - 0.0004, south: XIHU.lat - 0.0003, east: XIHU.lng + 0.0004, north: XIHU.lat + 0.0003 },
  radiusM: 60, widthM: 76, depthM: 66, imageUrl: 'x', style: 6 as const,
};

const venue = (patch: Partial<{ geo: { lng: number; lat: number; source: 'telemetry' } }> = {}) => ({
  assetId: '00000000-0000-4000-8000-000000000001',
  name: '实景扫描 11/08',
  ...patch,
});

describe('defaultScanPlacement', () => {
  it('没有 geo 时落在调研范围中心，不再退回室内并排槽位', () => {
    const layout = layoutWith({ sceneAnchor: anchor, researchArea: area });
    const placement = defaultScanPlacement({ layout, venue: venue(), planAnchor });
    expect(placement.source).toBe('research-area');
    expect(placement.world.x).toBeCloseTo(0, 6);
    expect(placement.world.z).toBeCloseTo(0, 6);
    // 2D 落位钉与中心同一格
    expect(placement.pin?.x).toBeCloseTo(0, 6);
    expect(placement.pin?.y).toBeCloseTo(0, 6);
  });

  it('没有调研范围时落在圈场地块的中心（顶点平均）', () => {
    const ring = [
      { lng: XIHU.lng, lat: XIHU.lat },
      { lng: XIHU.lng + 0.0004, lat: XIHU.lat },
      { lng: XIHU.lng + 0.0004, lat: XIHU.lat - 0.0004 },
      { lng: XIHU.lng, lat: XIHU.lat - 0.0004 },
    ];
    const layout = layoutWith({ sceneAnchor: anchor, mapGroundPolygon: ring });
    const placement = defaultScanPlacement({ layout, venue: venue(), planAnchor });
    expect(placement.source).toBe('polygon');
    // 环心在东 0.0002° / 南 0.0002°（世界坐标按锚点投影的纬度尺子）
    expect(placement.world.x).toBeCloseTo(0.0002 * metersPerDegreeLng(XIHU.lat), 4);
    expect(placement.world.z).toBeCloseTo(0.0002 * METERS_PER_DEGREE_LAT, 4);
  });

  it('有遥测拍摄点时以拍摄点为准，调研范围不参与', () => {
    const layout = layoutWith({ sceneAnchor: anchor, researchArea: area });
    const shot = { lng: XIHU.lng + 0.0002, lat: XIHU.lat, source: 'telemetry' as const };
    const placement = defaultScanPlacement({ layout, venue: venue({ geo: shot }), planAnchor });
    expect(placement.source).toBe('telemetry');
    expect(placement.world.x).toBeCloseTo(0.0002 * metersPerDegreeLng(XIHU.lat), 4);
    expect(placement.world.z).toBeCloseTo(0, 4);
  });

  it('什么地理依据都没有时落在原点（锚点本身），不编造中心', () => {
    const layout = layoutWith({ sceneAnchor: anchor });
    const placement = defaultScanPlacement({ layout, venue: venue(), planAnchor });
    expect(placement.source).toBe('origin');
    expect(placement.world).toEqual({ x: 0, z: 0 });
    // 没有 plan 锚点就不画钉（不硬猜像素）
    expect(defaultScanPlacement({ layout, venue: venue(), planAnchor: null }).pin).toBeNull();
  });

  it('提示语区分实测拍摄点与估算中心', () => {
    const layout = layoutWith({ sceneAnchor: anchor, researchArea: area });
    expect(scanPlacementNote(defaultScanPlacement({ layout, venue: venue({ geo: { ...XIHU, source: 'telemetry' } }), planAnchor }), 'A'))
      .toContain('拍摄点');
    expect(scanPlacementNote(defaultScanPlacement({ layout, venue: venue(), planAnchor }), 'A'))
      .toContain('调研范围中心');
  });
});

describe('worldFromPlanPoint / planPointFromGeo', () => {
  it('地图上点哪里就落在哪里：ENU 东 12 m、南 5 m → 世界 (12, 5)', () => {
    const layout = layoutWith({ sceneAnchor: anchor, researchArea: area });
    const world = worldFromPlanPoint(layout, planAnchor, { x: 12, y: -5 });
    expect(world.x).toBeCloseTo(12, 4);
    expect(world.z).toBeCloseTo(5, 4);
  });

  it('锚点旋转 90° 时落点跟着转，不再按经纬度硬算', () => {
    const turned: SceneAnchor = { ...anchor, orientationDeg: 90 };
    const layout = layoutWith({ sceneAnchor: turned, researchArea: area });
    const world = worldFromPlanPoint(layout, planAnchor, { x: 10, y: 0 });
    expect(world.x).toBeCloseTo(0, 4);
    expect(world.z).toBeCloseTo(-10, 4);
  });

  it('默认中心的落位钉换算回同一个世界点（钉与点云同源）', () => {
    const layout = layoutWith({ sceneAnchor: anchor, researchArea: area });
    const placement = defaultScanPlacement({ layout, venue: venue(), planAnchor });
    const back = worldFromPlanPoint(layout, planAnchor, placement.pin!);
    expect(back.x).toBeCloseTo(placement.world.x, 4);
    expect(back.z).toBeCloseTo(placement.world.z, 4);
    expect(planPointFromGeo(planAnchor, XIHU.lng, XIHU.lat)).toEqual({ x: 0, y: 0 });
  });
});

describe('planPointFromWorld（户外 3D 用 plan ENU，存档用世界系）', () => {
  const point = { x: 128.5, y: -64.25 };

  it('同锚点时来回换算回到同一格', () => {
    const layout = layoutWith({ sceneAnchor: anchor, researchArea: area });
    const world = worldFromPlanPoint(layout, planAnchor, point);
    const back = planPointFromWorld(layout, planAnchor, world);
    expect(back.x).toBeCloseTo(point.x, 6);
    expect(back.y).toBeCloseTo(point.y, 6);
  });

  it('锚点不同心 + 旋转 + 缩放时仍然可逆（本项目实测差 3.5 km）', () => {
    const turned: SceneAnchor = { ...anchor, orientationDeg: 37, metersPerUnit: 2 };
    const layout = layoutWith({ sceneAnchor: turned, researchArea: area });
    const farAnchor: PlanAnchor = { lng: 120.085, lat: 30.215, crs: 'gcj-02', source: 'preset' };
    const world = worldFromPlanPoint(layout, farAnchor, point);
    // 两个锚点不同心：世界落点离原点数公里，不是「点哪落哪」的错觉
    expect(Math.hypot(world.x, world.z)).toBeGreaterThan(1000);
    const back = planPointFromWorld(layout, farAnchor, world);
    expect(back.x).toBeCloseTo(point.x, 6);
    expect(back.y).toBeCloseTo(point.y, 6);
  });

  it('没有场地锚点时只平移调研中心，不旋转不缩放', () => {
    const layout = layoutWith({ researchArea: area });
    const world = worldFromPlanPoint(layout, planAnchor, point);
    expect(world).toEqual({ x: point.x, z: -point.y });
    expect(planPointFromWorld(layout, planAnchor, world)).toEqual(point);
  });

  it('什么锚点都没有时按 x 东 / z 南原样搬', () => {
    const layout = layoutWith({});
    const world = worldFromPlanPoint(layout, planAnchor, point);
    expect(world).toEqual({ x: point.x, z: -point.y });
    expect(planPointFromWorld(layout, planAnchor, world)).toEqual(point);
  });
});
