import { describe, expect, it } from 'vitest';
import { BASEMAP_NATIVE_MAX_ZOOM, basemapNativeMaxZoom } from './basemap-zoom-caps';
import { planGroundMaxZoom } from './plan-ground-capture';

describe('底图上限表', () => {
  it('Carto / 高德 / 天地图封顶 18，OSM 到 19', () => {
    expect(basemapNativeMaxZoom('carto-light')).toBe(18);
    expect(basemapNativeMaxZoom('carto-dark')).toBe(18);
    expect(basemapNativeMaxZoom('amap-satellite')).toBe(18);
    expect(basemapNativeMaxZoom('amap-streets')).toBe(18);
    expect(basemapNativeMaxZoom('amap-streets-labels')).toBe(18);
    expect(basemapNativeMaxZoom('vec')).toBe(18);
    expect(basemapNativeMaxZoom('img')).toBe(18);
    expect(basemapNativeMaxZoom('osm')).toBe(19);
  });

  it('2D / 3D 的封装函数只读这张表，口径不会分叉', () => {
    for (const source of ['osm', 'carto-light', 'carto-dark', 'amap-satellite', 'amap-streets', 'amap-streets-labels'] as const) {
      expect(planGroundMaxZoom(source)).toBe(BASEMAP_NATIVE_MAX_ZOOM[source]);
    }
  });
});
