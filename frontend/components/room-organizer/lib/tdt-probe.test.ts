import { describe, expect, it } from 'vitest';
import {
  PUBLIC_SOURCE_SPECS,
  TDT_PROBE_ATTRIBUTION,
  TDT_PROBE_DEFAULT,
  TDT_PROBE_MAX_ZOOM,
  TDT_PROBE_MIN_ZOOM,
  TDT_PROBE_TILE,
  lngLatToTileXY,
  metersPerPixel,
  basemapSourceAttribution,
  probeSourceAttribution,
  publicSourceTileUrl,
  tdtProbeTileUrl,
  visibleTileGrid,
} from './tdt-probe';

describe('tdt probe helpers (H0-b)', () => {
  it('converts lng/lat to web-mercator tile x/y', () => {
    // 赤道 / 本初子午线在 z1 上是瓦片 (1, 1)。
    expect(lngLatToTileXY(0, 0, 1)).toEqual({ x: 1, y: 1 });
    // 平湖秋月（z15）应落在杭州附近的合法瓦片内。
    const p = lngLatToTileXY(TDT_PROBE_DEFAULT.lng, TDT_PROBE_DEFAULT.lat, 15);
    expect(p.x).toBeGreaterThan(0);
    expect(p.y).toBeGreaterThan(0);
    expect(p.x).toBeLessThan(2 ** 15);
    expect(p.y).toBeLessThan(2 ** 15);
  });

  it('reports a finite, positive meters-per-pixel and shrinks as zoom increases', () => {
    const z14 = metersPerPixel(TDT_PROBE_DEFAULT.lat, 14);
    const z15 = metersPerPixel(TDT_PROBE_DEFAULT.lat, 15);
    expect(Number.isFinite(z14)).toBe(true);
    expect(z14).toBeGreaterThan(0);
    expect(z15).toBeLessThan(z14); // 更高缩放，每像素代表更少米。
  });

  it('builds base + annotation tile pairs for both layers', () => {
    const vec = tdtProbeTileUrl('vec', 12, 3372, 1690);
    expect(vec.base).toContain('layer=vec_w');
    expect(vec.annotation).toContain('layer=cva_w');
    expect(vec.base).not.toContain('tk=');

    const img = tdtProbeTileUrl('img', 12, 3372, 1690);
    expect(img.base).toContain('layer=img_w');
    expect(img.annotation).toContain('layer=cia_w');
  });

  it('builds a tile grid that covers the viewport', () => {
    const grid = visibleTileGrid(TDT_PROBE_DEFAULT.lng, TDT_PROBE_DEFAULT.lat, 15, 1200, 800);
    expect(grid.tiles.length).toBeGreaterThan(0);
    expect(grid.tiles.every(t => t.x >= 0 && t.y >= 0)).toBe(true);
  });

  it('clamps grid tiles to the valid world range', () => {
    // 极点附近视图不应产生越界瓦片。
    const grid = visibleTileGrid(0, 89.9, 12, 800, 600);
    expect(grid.tiles.every(t => t.x >= 0 && t.y >= 0)).toBe(true);
  });

  it('exposes an attribution and sane zoom bounds', () => {
    expect(TDT_PROBE_ATTRIBUTION).toContain('天地图');
    expect(TDT_PROBE_MIN_ZOOM).toBeLessThan(TDT_PROBE_MAX_ZOOM);
    expect(TDT_PROBE_TILE).toBe(256);
  });

  it('builds public-source tile urls with required attributions', () => {
    expect(publicSourceTileUrl('osm', 15, 27315, 13489)).toBe('https://tile.openstreetmap.org/15/27315/13489.png');
    expect(publicSourceTileUrl('carto-light', 15, 27315, 13489)).toContain('basemaps.cartocdn.com/light_all/15/27315/13489.png');
    expect(publicSourceTileUrl('carto-dark', 15, 27315, 13489)).toContain('dark_all/15/27315/13489.png');
    // OSM 政策要求署名必显。
    expect(PUBLIC_SOURCE_SPECS.osm.attribution).toContain('OpenStreetMap contributors');
    expect(PUBLIC_SOURCE_SPECS['carto-light'].attribution).toContain('CARTO');
  });

  it('switches attribution per probe source', () => {
    expect(probeSourceAttribution('osm')).toContain('OpenStreetMap');
    expect(probeSourceAttribution('carto-dark')).toContain('CARTO');
    expect(probeSourceAttribution('vec')).toContain('天地图');
    expect(probeSourceAttribution('img')).toContain('天地图');
  });

  it('署名逐档对得上真实数据源（高德三档不挂天地图的名）', () => {
    expect(basemapSourceAttribution('osm')).toContain('OpenStreetMap');
    expect(basemapSourceAttribution('carto-light')).toContain('CARTO');
    expect(basemapSourceAttribution('amap-satellite')).toContain('高德');
    expect(basemapSourceAttribution('amap-satellite')).toContain('卫星');
    expect(basemapSourceAttribution('amap-streets')).toContain('高德');
    expect(basemapSourceAttribution('amap-streets-labels')).toContain('高德');
    for (const amap of ['amap-satellite', 'amap-streets', 'amap-streets-labels'] as const) {
      expect(basemapSourceAttribution(amap)).not.toContain('天地图');
    }
    expect(basemapSourceAttribution('vec')).toContain('天地图');
    expect(basemapSourceAttribution('img')).toContain('天地图');
  });
});