// @vitest-environment jsdom
import { describe, expect, it, beforeEach } from 'vitest';
import {
  boundsSpanMeters,
  latToTileY,
  lngToTileX,
  planGroundTiles,
  tileNorthLat,
  zoomForGroundSpan,
  PLAN_GROUND_BACKDROP,
} from './plan-ground-capture';
import { isPlanGroundSource, readPlanGroundSource, writePlanGroundSource } from './plan-basemap-source';

// 杭州平湖秋月一带：约 100 m × 80 m 的场地。
const BOUNDS = { west: 120.1472, south: 30.2455, east: 120.14825, north: 30.24622 };

describe('plan-ground-capture 投影', () => {
  it('墨卡托瓦片边界：zoom 0 的北缘是 ±85.05°，y=1 处回到赤道', () => {
    expect(tileNorthLat(0, 0)).toBeCloseTo(85.0511, 3);
    expect(tileNorthLat(1, 1)).toBeCloseTo(0, 6);
    expect(latToTileY(0, 1)).toBeCloseTo(1, 6);
    expect(lngToTileX(-180, 0)).toBeCloseTo(0, 6);
    expect(lngToTileX(180, 1)).toBeCloseTo(2, 6);
  });

  it('经纬范围换算米数：0.001° 经度在 30° 纬度约 96 m，0.001° 纬度约 110 m', () => {
    const span = boundsSpanMeters({ west: 120.1, south: 30.2, east: 120.101, north: 30.201 });
    expect(span.width).toBeGreaterThan(94);
    expect(span.width).toBeLessThan(99);
    expect(span.depth).toBeGreaterThan(109);
    expect(span.depth).toBeLessThan(112);
  });

  it('拼图级别随场地变小而变高，且限在 13..19', () => {
    const big = zoomForGroundSpan(2000, 1500, 768);
    const small = zoomForGroundSpan(30, 20, 768);
    expect(small).toBeGreaterThan(big);
    expect(big).toBeGreaterThanOrEqual(13);
    expect(small).toBeLessThanOrEqual(19);
    expect(zoomForGroundSpan(1, 1, 768)).toBeLessThanOrEqual(19);
  });
});

describe('planGroundTiles', () => {
  const urlFor = (z: number, x: number, y: number) => `tile/${z}/${x}/${y}.png`;

  it('每块瓦片都带 URL，落点连续覆盖整张画布', () => {
    const plan = planGroundTiles(BOUNDS, 768, 17, urlFor);
    expect(plan.placements.length).toBeGreaterThan(0);
    expect(plan.zoom).toBe(17);
    for (const tile of plan.placements) {
      expect(tile.url).toMatch(/^tile\/17\/\d+\/\d+\.png$/);
      expect(tile.w).toBeGreaterThan(0);
      expect(tile.h).toBeGreaterThan(0);
    }
    // 横向落点从 0 附近开始、到 768 附近结束（可略超出画布）。
    const left = Math.min(...plan.placements.map(t => t.x));
    const right = Math.max(...plan.placements.map(t => t.x + t.w));
    expect(left).toBeLessThanOrEqual(0.5);
    expect(right).toBeGreaterThanOrEqual(767.5);
    // 行列范围与落点一致：块数不超过范围格数。
    const cols = plan.range.maxX - plan.range.minX + 1;
    const rows = plan.range.maxY - plan.range.minY + 1;
    expect(plan.placements.length).toBeLessThanOrEqual(cols * rows);
  });

  it('场地越小需要的瓦片越少（同一像素尺寸下）', () => {
    const wide = planGroundTiles({ west: 120.1, south: 30.2, east: 120.12, north: 30.22 }, 768, 16, urlFor);
    const tiny = planGroundTiles({ west: 120.1, south: 30.2, east: 120.1005, north: 30.2005 }, 768, 16, urlFor);
    expect(tiny.placements.length).toBeLessThanOrEqual(wide.placements.length);
  });

  it('每张底图都有兜底底色', () => {
    for (const color of Object.values(PLAN_GROUND_BACKDROP)) expect(color).toMatch(/^#[0-9a-f]{6}$/i);
  });
});

describe('plan-basemap-source', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('缺省是 osm，写进去能读回来', () => {
    expect(readPlanGroundSource()).toBe('osm');
    writePlanGroundSource('carto-dark');
    expect(readPlanGroundSource()).toBe('carto-dark');
    expect(window.localStorage.getItem('scendance-plan-basemap-source-v1')).toBe('carto-dark');
  });

  it('只认 OSM / Carto 三档，天地图与脏值忽略', () => {
    expect(isPlanGroundSource('vec')).toBe(false);
    expect(isPlanGroundSource('img')).toBe(false);
    expect(isPlanGroundSource('carto-light')).toBe(true);
    window.localStorage.setItem('scendance-plan-basemap-source-v1', 'carto-light');
    writePlanGroundSource('vec');
    writePlanGroundSource('img');
    expect(window.localStorage.getItem('scendance-plan-basemap-source-v1')).toBe('carto-light');
  });
});