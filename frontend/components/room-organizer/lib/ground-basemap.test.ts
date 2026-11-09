import { describe, expect, it } from 'vitest';
import {
  activeGroundBasemap,
  groundBasemapOpacity,
  groundBasemapStyleOf,
} from './ground-basemap';

describe('ground basemap styles', () => {
  it('reads 高德 street and satellite styles from the proxy url', () => {
    expect(groundBasemapStyleOf(undefined)).toBe(6);
    expect(groundBasemapStyleOf('/api/amap-static?west=120.1&south=30.1&east=120.2&north=30.2&x-ref=satellite-ground-ref')).toBe(6);
    expect(groundBasemapStyleOf('http://127.0.0.1:3199/amap-static?west=120.1&south=30.1&east=120.2&north=30.2&style=7&x-ref=satellite-ground-ref')).toBe(7);
    expect(groundBasemapStyleOf('/api/amap-static?style=8&x-ref=map-basemap')).toBe(8);
    expect(groundBasemapStyleOf('/api/amap-static?style=9&x-ref=satellite-ground-ref')).toBe(6);
  });

  it('keeps satellite fade and makes street layers clearer inside the fence', () => {
    expect(groundBasemapOpacity(6, 0.78)).toEqual({ inside: 0.78, outside: 0.55 });
    expect(groundBasemapOpacity(6)).toEqual({ inside: 0.78, outside: 0.55 });
    const street = groundBasemapOpacity(7, 0.78);
    expect(street.inside).toBeGreaterThan(street.outside);
    expect(street.inside).toBeGreaterThan(0.85);
    expect(street.outside).toBeLessThan(0.5);
    expect(groundBasemapOpacity(8, 0.78).outside).toBe(street.outside);
  });

  it('treats a closed ground as having no active layer', () => {
    expect(activeGroundBasemap({ satelliteGroundRef: false, floorPlanImage: '/api/amap-static?style=7&x-ref=satellite-ground-ref' })).toBeNull();
    expect(activeGroundBasemap({
      satelliteGroundRef: true,
      floorPlanImage: '/api/amap-static?style=7&x-ref=satellite-ground-ref',
    })?.id).toBe('amap-streets');
    expect(activeGroundBasemap({ satelliteGroundRef: true })?.id).toBe('amap-satellite');
  });
});
