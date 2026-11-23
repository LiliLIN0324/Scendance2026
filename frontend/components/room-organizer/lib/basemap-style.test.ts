// @vitest-environment jsdom
/**
 * 底图选择只有地图 / 卫星 / 浅色 / 纸面，每种选择在同一地点只解析出一个瓦片源。
 * 旧的全球卫星、天地图影像、Carto 深色不再作为记下来的第二种选择。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryStorage } from '@/lib/test-support-memory-storage';
import { alignedTileCenter } from './basemap-alignment';
import {
  canonicalPlanGroundSource,
  styleFromGround,
  styleFromProvider,
  tileSourceForBasemapStyle,
  WORKBENCH_BASEMAP_SOURCE,
  WORKBENCH_BASEMAP_STYLES,
} from './basemap-style';
import {
  readPlanGroundSource,
  readRecordedBasemapStyle,
  resetPlanBasemapSourceCacheForTest,
  writePlanGroundSource,
  writeRecordedBasemapStyle,
} from './plan-basemap-source';
import { publicSourceTileUrl } from './tdt-probe';

const HANGZHOU = { lng: 120.147, lat: 30.245 };
const VICTORIA = { lng: -123.3716, lat: 48.4235 };

let mem: MemoryStorage;
beforeEach(() => {
  mem = new MemoryStorage();
  vi.stubGlobal('Storage', MemoryStorage);
  vi.stubGlobal('localStorage', mem);
  window.localStorage = mem;
  localStorage.clear();
  resetPlanBasemapSourceCacheForTest();
});
afterEach(() => {
  mem?.clear();
  resetPlanBasemapSourceCacheForTest();
  vi.unstubAllGlobals();
});

function tileHosts(style: 'map' | 'satellite' | 'light', at: { lng: number; lat: number }): string[] {
  const source = tileSourceForBasemapStyle(style, at.lng, at.lat);
  expect(source).toBeTruthy();
  return [0, 1, 2].map(offset => {
    const url = publicSourceTileUrl(source!, 16, 26900 + offset, 13280);
    return url.startsWith('/') ? url.slice(0, url.indexOf('?')) : new URL(url).host;
  });
}

describe('一种底图选择只有一个瓦片源', () => {
  it('四档名字固定，纸面没有瓦片', () => {
    expect(WORKBENCH_BASEMAP_STYLES).toEqual(['map', 'satellite', 'light', 'paper']);
    expect(tileSourceForBasemapStyle('paper', HANGZHOU.lng, HANGZHOU.lat)).toBeNull();
  });

  it('境内卫星只铺高德卫星，不混 Esri 或天地图', () => {
    const hosts = tileHosts('satellite', HANGZHOU);
    expect(new Set(hosts).size).toBe(1);
    expect(hosts[0]).toContain('autonavi.com');
    const source = tileSourceForBasemapStyle('satellite', HANGZHOU.lng, HANGZHOU.lat);
    const url = publicSourceTileUrl(source!, 17, 1, 2);
    expect(url).toContain('style=6');
    expect(url).not.toContain('arcgisonline');
    expect(url).not.toContain('tianditu');
    expect(url).not.toContain('tdt-tiles');
  });

  it('境内地图与浅色各自只有一个源，浅色仍走 WGS 对齐', () => {
    expect(new Set(tileHosts('map', HANGZHOU)).size).toBe(1);
    expect(tileHosts('map', HANGZHOU)[0]).toContain('autonavi.com');
    expect(new Set(tileHosts('light', HANGZHOU)).size).toBe(1);
    expect(tileHosts('light', HANGZHOU)[0]).toBe('/api/carto-tiles');
    const satellite = tileSourceForBasemapStyle('satellite', HANGZHOU.lng, HANGZHOU.lat)!;
    const light = tileSourceForBasemapStyle('light', HANGZHOU.lng, HANGZHOU.lat)!;
    expect(alignedTileCenter(HANGZHOU.lng, HANGZHOU.lat, satellite)).toEqual(HANGZHOU);
    const shifted = alignedTileCenter(HANGZHOU.lng, HANGZHOU.lat, light);
    expect(shifted).not.toEqual(HANGZHOU);
  });

  it('境外卫星选择换成 Esri，且一整屏只有这一个源', () => {
    const hosts = tileHosts('satellite', VICTORIA);
    expect(hosts.every(host => host === 'server.arcgisonline.com')).toBe(true);
    expect(tileSourceForBasemapStyle('map', VICTORIA.lng, VICTORIA.lat)).toBe('osm');
    expect(tileSourceForBasemapStyle('light', VICTORIA.lng, VICTORIA.lat)).toBe('carto-light');
  });
});

describe('旧图源 id 收成同一种选择', () => {
  it('全球卫星、天地图影像、高德卫星都是卫星，深色并进浅色', () => {
    expect(styleFromProvider('esri-satellite')).toBe('satellite');
    expect(styleFromProvider('img')).toBe('satellite');
    expect(styleFromProvider('amap-satellite')).toBe('satellite');
    expect(styleFromProvider('carto-dark')).toBe('light');
    expect(styleFromProvider('carto-light')).toBe('light');
    expect(styleFromProvider('osm')).toBe('map');
    expect(styleFromProvider('vec')).toBe('map');
    expect(styleFromGround('paper', 'esri-satellite')).toBe('paper');
    expect(canonicalPlanGroundSource('esri-satellite')).toBe(WORKBENCH_BASEMAP_SOURCE.satellite);
    expect(canonicalPlanGroundSource('carto-dark')).toBe(WORKBENCH_BASEMAP_SOURCE.light);
  });

  it('偏好里残留的全球卫星读出来是卫星，并改写成高德卫星', () => {
    localStorage.setItem('scendance-plan-basemap-source-v1', 'esri-satellite');
    expect(readPlanGroundSource()).toBe('amap-satellite');
    expect(localStorage.getItem('scendance-plan-basemap-source-v1')).toBe('amap-satellite');
    expect(readRecordedBasemapStyle()).toBe('satellite');
    expect(tileSourceForBasemapStyle(readRecordedBasemapStyle(), HANGZHOU.lng, HANGZHOU.lat)).toBe('amap-satellite');
  });

  it('已经记下的选择盖过旧图源 id', () => {
    localStorage.setItem('scendance-basemap-style-v1', 'light');
    localStorage.setItem('scendance-plan-basemap-source-v1', 'esri-satellite');
    expect(readPlanGroundSource()).toBe('carto-light');
    expect(readRecordedBasemapStyle()).toBe('light');
  });

  it('写入全球卫星或深色时记成对应的唯一源', () => {
    writePlanGroundSource('esri-satellite');
    expect(readPlanGroundSource()).toBe('amap-satellite');
    expect(readRecordedBasemapStyle()).toBe('satellite');
    writePlanGroundSource('carto-dark');
    expect(readPlanGroundSource()).toBe('carto-light');
    expect(readRecordedBasemapStyle()).toBe('light');
    writeRecordedBasemapStyle('paper');
    expect(readRecordedBasemapStyle()).toBe('paper');
    writeRecordedBasemapStyle('map');
    expect(readRecordedBasemapStyle()).toBe('map');
    expect(readPlanGroundSource()).toBe('amap-streets');
  });
});
