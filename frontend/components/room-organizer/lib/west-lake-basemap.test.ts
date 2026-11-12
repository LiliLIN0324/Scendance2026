import { describe, expect, it } from 'vitest';
import { isWestLakeBasemapLayout, purgeWestLakeBasemap, urlPointsIntoWestLake, withinWestLake } from './west-lake-basemap';
import type { RoomLayout } from './types';

function layoutWith(overrides: Partial<RoomLayout>): RoomLayout {
  return {
    name: '草稿',
    width: 10,
    height: 8,
    floors: [],
    ...overrides,
  } as RoomLayout;
}

describe('withinWestLake', () => {
  it('recognises 平湖秋月 and rejects elsewhere', () => {
    expect(withinWestLake(120.1460368, 30.2521924)).toBe(true);
    expect(withinWestLake(120.3, 30.25)).toBe(false);
    expect(withinWestLake(undefined, undefined)).toBe(false);
  });
});

describe('urlPointsIntoWestLake', () => {
  it('reads the amap static map location parameter', () => {
    expect(urlPointsIntoWestLake('https://restapi.amap.com/v3/staticmap?location=120.1460368,30.2521924&maptype=satellite')).toBe(true);
    expect(urlPointsIntoWestLake('https://restapi.amap.com/v3/staticmap?location=121.4737,31.2304&maptype=satellite')).toBe(false);
  });

  it('reads the research basemap bounds parameters', () => {
    expect(urlPointsIntoWestLake('http://127.0.0.1:3199/amap-static?west=120.09&south=30.20&east=120.20&north=30.30&style=6&x-ref=map-basemap')).toBe(true);
    expect(urlPointsIntoWestLake('http://127.0.0.1:3199/amap-static?west=121.40&south=31.20&east=121.50&north=31.30&style=6&x-ref=map-basemap')).toBe(false);
  });

  it('knows the old preset image', () => {
    expect(urlPointsIntoWestLake('/basemap/xihu-scenic-z15.jpg')).toBe(true);
  });
});

describe('purgeWestLakeBasemap', () => {
  it('leaves a layout without any West Lake basemap alone', () => {
    const layout = layoutWith({ floorPlanImage: 'data:image/png;base64,AAAA' });
    expect(isWestLakeBasemapLayout(layout)).toBe(false);
    const result = purgeWestLakeBasemap(layout);
    expect(result.changed).toBe(false);
    expect(result.layout).toBe(layout);
  });

  it('drops the research basemap and the cropped satellite ground of a West Lake draft', () => {
    const layout = layoutWith({
      researchArea: {
        name: '西湖 · 平湖秋月',
        address: '浙江省杭州市西湖区孤山路',
        center: { lng: 120.1460368, lat: 30.2521924 },
        radiusM: 1600,
        bounds: { west: 120.12, south: 30.23, east: 120.17, north: 30.27 },
        widthM: 3200,
        depthM: 3200,
        imageUrl: 'http://127.0.0.1:3199/amap-static?west=120.12&south=30.23&east=120.17&north=30.27&style=6&x-ref=map-basemap',
        style: 6,
      },
      floorPlanImage: 'https://restapi.amap.com/v3/staticmap?location=120.1460368,30.2521924&maptype=satellite',
      floorPlanOpacity: 0.85,
      satelliteGroundRef: true,
      mapLngLat: { lng: 120.1460368, lat: 30.2521924 },
      mapGroundPolygon: [{ lng: 120.146, lat: 30.252 }],
    });
    expect(isWestLakeBasemapLayout(layout)).toBe(true);
    const result = purgeWestLakeBasemap(layout);
    expect(result.changed).toBe(true);
    expect(result.layout.researchArea).toBeUndefined();
    expect(result.layout.floorPlanImage).toBeUndefined();
    expect(result.layout.floorPlanOpacity).toBeUndefined();
    expect(result.layout.mapLngLat).toBeUndefined();
    expect(result.layout.mapGroundPolygon).toBeUndefined();
    expect(result.layout.satelliteGroundRef).toBe(false);
    // The house itself stays.
    expect(result.layout.name).toBe('草稿');
  });

  it('drops a canvas-cropped map ground (data URL) located by its ground metadata', () => {
    const layout = layoutWith({
      floorPlanImage: 'data:image/jpeg;base64,/9j/4AAQSkZJRg==',
      floorPlanOpacity: 0.78,
      satelliteGroundRef: true,
      mapLngLat: { lng: 120.1460368, lat: 30.2521924 },
      mapGroundPolygon: [{ lng: 120.146, lat: 30.252 }],
      mapGroundFrame: { lng0: 120.14, lat0: 30.25, latMid: 30.252, scale: 0.5 },
    });
    const result = purgeWestLakeBasemap(layout);
    expect(result.changed).toBe(true);
    expect(result.layout.floorPlanImage).toBeUndefined();
    expect(result.layout.floorPlanOpacity).toBeUndefined();
    expect(result.layout.mapLngLat).toBeUndefined();
    expect(result.layout.mapGroundPolygon).toBeUndefined();
    expect(result.layout.mapGroundFrame).toBeUndefined();
    expect(result.layout.satelliteGroundRef).toBe(false);
  });

  it('keeps a plan image the user uploaded themselves', () => {
    const layout = layoutWith({
      floorPlanImage: 'data:image/png;base64,AAAA',
      researchArea: {
        name: '西湖 · 平湖秋月',
        address: '浙江省杭州市西湖区孤山路',
        center: { lng: 120.1460368, lat: 30.2521924 },
        radiusM: 1600,
        bounds: { west: 120.12, south: 30.23, east: 120.17, north: 30.27 },
        widthM: 3200,
        depthM: 3200,
        imageUrl: '/basemap/xihu-scenic-z15.jpg',
        style: 6,
      },
    });
    const result = purgeWestLakeBasemap(layout);
    expect(result.changed).toBe(true);
    expect(result.layout.researchArea).toBeUndefined();
    expect(result.layout.floorPlanImage).toBe('data:image/png;base64,AAAA');
  });

  it('keeps a satellite ground outside the West Lake', () => {
    const layout = layoutWith({
      floorPlanImage: 'https://restapi.amap.com/v3/staticmap?location=121.4737,31.2304&maptype=satellite',
      satelliteGroundRef: true,
    });
    const result = purgeWestLakeBasemap(layout);
    expect(result.changed).toBe(false);
    expect(result.layout.floorPlanImage).toBe(layout.floorPlanImage);
  });
});
