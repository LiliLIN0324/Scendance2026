/**
 * 2026-11-17 海外底图修复的判定单。
 *
 * 背景：用户报「海外的地图没有卫星图，看海外案例就看不到底图」。实测高德卫星在
 * 巴黎/伦敦/洛杉矶/Victoria 一律回同一张 4235 B「此区域无卫星图」灰图（四处 MD5 相同），
 * 高德街道是 124 B 空白瓦片。修复 = 境外场地把中国专属源按类别换成全球源
 * （卫星类→Esri 全球卫星、街道/矢量类→OSM，见 `sourceForLocation`；一刀切会让
 * 六个地图类型格子全是同一张影像，用户报过「地图怎么全改了」），
 * 并拒绝把境外高德灰图当「已拉到的真图」。
 */
import { describe, expect, it } from 'vitest';

import {
  GLOBAL_SATELLITE_SOURCE,
  GLOBAL_STREET_SOURCE,
  isChinaOnlySource,
  isOverseasLocation,
  needsWgs84Alignment,
  sourceForLocation,
} from './basemap-alignment';
import { basemapNativeMaxZoom, BASEMAP_NATIVE_MAX_ZOOM } from './basemap-zoom-caps';
import { planGroundMaxZoom } from './plan-ground-capture';
import {
  basemapSourceAttribution,
  probeSourceAttribution,
  publicSourceTileUrl,
} from './tdt-probe';
import { hasFetchedSatellite, isOverseasAmapStaticUrl } from './amap-venue';
import { PLAN_GROUND_SOURCES } from './plan-basemap-source';

/** 杭州西湖一带（境内，GCJ 偏移适用区）。 */
const HANGZHOU = { lng: 120.147, lat: 30.245 };
/** Victoria BC 内港 Ship Point（复刻案例真实锚点，境外）。 */
const VICTORIA = { lng: -123.3716, lat: 48.4235 };

function amapStaticUrl(center: { lng: number; lat: number }): string {
  const d = 0.001;
  return `/api/amap-static?west=${center.lng - d}&south=${center.lat - d}&east=${center.lng + d}&north=${center.lat + d}&x-ref=satellite-ground-ref`;
}

describe('境外场地换源（sourceForLocation）', () => {
  it('境内一律原样返回，高德三档/天地图/公开源都不动', () => {
    for (const source of ['amap-streets', 'amap-satellite', 'amap-streets-labels', 'vec', 'img', 'osm', 'carto-dark', 'esri-satellite'] as const) {
      expect(sourceForLocation(source, HANGZHOU.lng, HANGZHOU.lat)).toBe(source);
    }
  });

  it('境外卫星类（高德卫星/天地图影像）换成全球卫星源', () => {
    for (const source of ['amap-satellite', 'img'] as const) {
      expect(sourceForLocation(source, VICTORIA.lng, VICTORIA.lat)).toBe(GLOBAL_SATELLITE_SOURCE);
    }
  });

  it('境外街道/矢量类（高德街道/注记/天地图矢量）换成 OSM，保住「地图类型」的语义', () => {
    for (const source of ['amap-streets', 'amap-streets-labels', 'vec'] as const) {
      expect(sourceForLocation(source, VICTORIA.lng, VICTORIA.lat)).toBe(GLOBAL_STREET_SOURCE);
    }
  });

  it('isOverseasLocation：GCJ 矩形之外才算境外，无效坐标不算', () => {
    expect(isOverseasLocation(VICTORIA.lng, VICTORIA.lat)).toBe(true);
    expect(isOverseasLocation(HANGZHOU.lng, HANGZHOU.lat)).toBe(false);
    expect(isOverseasLocation(undefined, undefined)).toBe(false);
  });

  it('境外本来就有全球覆盖的源原样保留', () => {
    for (const source of ['osm', 'carto-light', 'carto-dark', 'esri-satellite'] as const) {
      expect(sourceForLocation(source, VICTORIA.lng, VICTORIA.lat)).toBe(source);
    }
  });

  it('坐标无效时不换源（缺锚点的旧场地保持原行为）', () => {
    expect(sourceForLocation('amap-streets', undefined, undefined)).toBe('amap-streets');
    expect(sourceForLocation('amap-streets', Number.NaN, 48)).toBe('amap-streets');
  });

  it('中国专属源清单：高德三档 + 天地图两档，不含公开全球源', () => {
    expect(isChinaOnlySource('amap-satellite')).toBe(true);
    expect(isChinaOnlySource('vec')).toBe(true);
    expect(isChinaOnlySource('img')).toBe(true);
    expect(isChinaOnlySource('osm')).toBe(false);
    expect(isChinaOnlySource('carto-dark')).toBe(false);
    expect(isChinaOnlySource('esri-satellite')).toBe(false);
  });
});

describe('全球卫星源（Esri World Imagery）', () => {
  it('瓦片地址是 /{z}/{y}/{x}——行在前、列在后，与常见模板相反', () => {
    // Victoria z18 的真实瓦片（2026-11-17 实测 6946 B 真航拍）。
    expect(publicSourceTileUrl('esri-satellite', 18, 41235, 90662))
      .toBe('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/18/90662/41235');
  });

  it('署名必须挂 Esri，不能挂高德/天地图的名', () => {
    expect(basemapSourceAttribution('esri-satellite')).toContain('Esri');
    expect(probeSourceAttribution('esri-satellite')).toContain('Esri');
    expect(basemapSourceAttribution('esri-satellite')).not.toContain('高德');
    expect(basemapSourceAttribution('esri-satellite')).not.toContain('天地图');
  });

  it('上限表登记到 19，三处封装读同一张表', () => {
    expect(BASEMAP_NATIVE_MAX_ZOOM['esri-satellite']).toBe(19);
    expect(basemapNativeMaxZoom('esri-satellite')).toBe(19);
    expect(planGroundMaxZoom('esri-satellite')).toBe(19);
  });

  it('Esri 是 WGS-84 网格：取瓦片前要走对齐（境外平移量为 0，境内换算）', () => {
    expect(needsWgs84Alignment('esri-satellite')).toBe(true);
  });

  it('Esri 仍是境外卫星的铺图源，不是记下来的第二种卫星选择', () => {
    expect(PLAN_GROUND_SOURCES).toContain('esri-satellite');
    expect(sourceForLocation('amap-satellite', VICTORIA.lng, VICTORIA.lat)).toBe('esri-satellite');
    expect(sourceForLocation('amap-satellite', HANGZHOU.lng, HANGZHOU.lat)).toBe('amap-satellite');
  });
});

describe('境外高德灰图不再算「已拉到的真图」', () => {
  it('境外范围的 /api/amap-static 地址被识别为境外高德图', () => {
    expect(isOverseasAmapStaticUrl(amapStaticUrl(VICTORIA))).toBe(true);
  });

  it('境内范围的高德静态图不算境外', () => {
    expect(isOverseasAmapStaticUrl(amapStaticUrl(HANGZHOU))).toBe(false);
  });

  it('非高德静态代理的地址不参与这个判定', () => {
    expect(isOverseasAmapStaticUrl('data:image/svg+xml;charset=utf-8,%3Csvg%3E')).toBe(false);
    expect(isOverseasAmapStaticUrl(null)).toBe(false);
  });

  it('hasFetchedSatellite 对境外高德灰图返回 false，补图链路才会重拉全球源', () => {
    expect(hasFetchedSatellite(amapStaticUrl(VICTORIA))).toBe(false);
    expect(hasFetchedSatellite(amapStaticUrl(HANGZHOU))).toBe(true);
  });
});
