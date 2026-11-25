import { describe, expect, it } from 'vitest';
import type { RoomLayout } from './types';
import {
  applySatelliteGroundPatch,
  groundFromSatellitePatch,
  makeSatelliteGroundPlaceholder,
  type SatelliteGroundPatch,
} from './amap-venue';

const POLYGON = [
  { lng: 121.473542418, lat: 31.2303096 },
  { lng: 121.473857582, lat: 31.2303096 },
  { lng: 121.473857582, lat: 31.2304904 },
  { lng: 121.473542418, lat: 31.2304904 },
];

const FRAME = { lng0: 121.473542418, lat0: 31.230490437, latMid: 31.2304, scale: 1, latSign: -1 as const };

function fullPatch(): SatelliteGroundPatch {
  return {
    floorPlanImage: 'data:image/png;base64,AAA',
    floorPlanOpacity: 0.78,
    satelliteGroundRef: true,
    mapGroundPolygon: POLYGON,
    mapLngLat: { lng: 121.4737, lat: 31.2304 },
    mapGroundFrame: FRAME,
    sceneAnchor: { lng: 121.4708, lat: 31.2304, orientationDeg: 0, metersPerUnit: 1, source: 'picker' },
  };
}

function bareLayout(): RoomLayout {
  return { id: 't', name: '测试场地', width: 30, height: 20 } as RoomLayout;
}

describe('groundFromSatellitePatch（写侧唯一出口）', () => {
  it('定位成功的 patch 逐项搬进 ground，与旧 applySatelliteGroundPatch 等价', () => {
    const patch = fullPatch();
    const ground = groundFromSatellitePatch(patch);
    const legacy = applySatelliteGroundPatch(bareLayout(), patch);

    expect(ground.image).toBe(patch.floorPlanImage);
    expect(ground.opacity).toBe(patch.floorPlanOpacity);
    expect(ground.satelliteRef).toBe(true);
    expect(ground.polygon).toEqual(POLYGON);
    expect(ground.center).toEqual(patch.mapLngLat);
    expect(ground.frame).toEqual(FRAME);

    // 旧路径写进 layout 的每个值，都能在 ground 里找到同一份，不多不少。
    expect(ground.image).toBe(legacy.floorPlanImage);
    expect(ground.opacity).toBe(legacy.floorPlanOpacity);
    expect(ground.satelliteRef).toBe(legacy.satelliteGroundRef);
    expect(ground.polygon).toEqual(legacy.mapGroundPolygon);
    expect(ground.center).toEqual(legacy.mapLngLat);
    expect(ground.frame).toEqual(legacy.mapGroundFrame);
  });

  it('图源随 patch 走：缺省落回 amap-satellite，自绘拼图按实际来源记', () => {
    expect(groundFromSatellitePatch(fullPatch()).source).toBe('amap-satellite');
    expect(groundFromSatellitePatch({ ...fullPatch(), source: 'carto-light' }).source).toBe('carto-light');
    expect(groundFromSatellitePatch({ ...fullPatch(), source: 'esri-satellite' }).source).toBe('esri-satellite');
  });

  it('没定位就不编定位：缺 polygon/center/frame 的占位 patch 只留图与开关', () => {
    const placeholder = {
      floorPlanImage: makeSatelliteGroundPlaceholder(30, 20),
      floorPlanOpacity: 0.78,
      satelliteGroundRef: true as const,
    };
    const ground = groundFromSatellitePatch(placeholder);

    expect(Object.keys(ground).sort()).toEqual(['image', 'opacity', 'satelliteRef', 'source']);
    expect(ground.polygon).toBeUndefined();
    expect(ground.center).toBeUndefined();
    expect(ground.frame).toBeUndefined();
    // capturedAt 不由纯函数现造，留给调用方。
    expect(ground.capturedAt).toBeUndefined();
  });

  it('只吃 patch，不碰 layout：出口类型里没有任何 layout 字段', () => {
    const ground = groundFromSatellitePatch(fullPatch());
    for (const key of ['id', 'name', 'width', 'height', 'floorPlanImage', 'floorPlanOpacity', 'mapGroundPolygon', 'mapLngLat', 'mapGroundFrame', 'sceneAnchor']) {
      expect(ground).not.toHaveProperty(key);
    }
  });
});
