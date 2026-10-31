// @vitest-environment jsdom
import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeLayout } from '../lib/__testfixtures__/fixtures';
import { SATELLITE_GROUND_LABEL, createVenueFromPick, parseSatelliteImageBounds, satelliteProxyUrl, shellMetersToSatelliteUv } from '../lib/amap-venue';
import { INITIAL_LAYOUT } from '../lib/initial-layout';
import { buildStructureShell } from './structure-builder';
import type { RoomLayout } from '../lib/types';

afterEach(() => { vi.unstubAllGlobals(); });

describe('satellite floor texture', () => {
  it('sticks a decoded satellite image on the floor instead of painting olive', async () => {
    vi.stubGlobal('Image', class {
      onload: null | (() => void) = null;
      onerror: null | (() => void) = null;
      width = 256;
      height = 256;
      set src(_value: string) { queueMicrotask(() => this.onload?.()); }
    });
    const scene = new THREE.Scene();
    const layout = makeLayout({
      satelliteGroundRef: true,
      floorPlanImage: '/api/amap-static?location=120.54,30.40&zoom=18&size=768*768&scale=2&x-ref=satellite-ground-ref',
    });
    buildStructureShell(THREE, scene, layout);
    await new Promise(resolve => setTimeout(resolve, 0));
    const floor = scene.children.find(child => child.userData.satelliteGroundRef && !child.userData.satelliteSurroundFade) as THREE.Mesh | undefined;
    const material = floor?.material as THREE.MeshBasicMaterial | undefined;
    expect(material?.map).toBeTruthy();
    expect(material?.color.getHex()).toBe(0xffffff);
    const surround = scene.children.find(child => child.userData.satelliteSurroundFade) as THREE.Mesh | undefined;
    const surroundMaterial = surround?.material as THREE.MeshBasicMaterial | undefined;
    expect(surroundMaterial?.color.getHex()).toBe(0xffffff);
    expect(surroundMaterial?.opacity).toBeLessThan(material?.opacity ?? 1);
    expect(surroundMaterial?.map).toBe(material?.map);
    const uv = surround?.geometry.getAttribute('uv');
    expect(uv && Array.from({ length: uv.count }, (_, index) => uv.getX(index)).some(value => value < 0 || value > 1)).toBe(true);
  });

  it('draws the ban label when the satellite url cannot be decoded', async () => {
    vi.stubGlobal('Image', class {
      onload: null | (() => void) = null;
      onerror: null | (() => void) = null;
      set src(_value: string) { queueMicrotask(() => this.onerror?.()); }
    });
    HTMLCanvasElement.prototype.getContext = (() => ({
      fillStyle: '',
      font: '',
      fillRect() {},
      fillText() {},
    })) as unknown as HTMLCanvasElement['getContext'];
    const scene = new THREE.Scene();
    buildStructureShell(THREE, scene, makeLayout({
      satelliteGroundRef: true,
      floorPlanImage: 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" data-kind="satellite-ground-ref"/>`),
    }));
    await new Promise(resolve => setTimeout(resolve, 0));
    const floor = scene.children.find(child => child.userData.satelliteGroundRef && !child.userData.satelliteSurroundFade) as THREE.Mesh | undefined;
    const material = floor?.material as THREE.MeshBasicMaterial | undefined;
    expect(material?.map).toBeTruthy();
    expect(material?.color.getHex()).toBe(0xffffff);
    expect(SATELLITE_GROUND_LABEL).toContain('不可作重建素材');
  });

  it('puts the drawn L on the same lng/lat rectangle as the satellite image', () => {
    vi.stubGlobal('Image', class {
      onload: null | (() => void) = null;
      onerror: null | (() => void) = null;
      set src(_value: string) { queueMicrotask(() => this.onload?.()); }
    });
    const lat = 30.4049;
    const lng = 120.5394;
    const dLng = 12 / (111_320 * Math.cos((lat * Math.PI) / 180));
    const dLat = 8 / 110_574;
    const polygon = [
      { lng, lat },
      { lng: lng + dLng, lat },
      { lng: lng + dLng, lat: lat + dLat * 0.45 },
      { lng: lng + dLng * 0.45, lat: lat + dLat * 0.45 },
      { lng: lng + dLng * 0.45, lat: lat + dLat },
      { lng, lat: lat + dLat },
    ];
    const image = satelliteProxyUrl(polygon, 'secret-key')!;
    const { layout } = createVenueFromPick(INITIAL_LAYOUT as RoomLayout, {
      name: '盐官古城', location: '潮乐之城', polygon, satelliteGround: true, satelliteGroundImage: image,
    });
    const scene = new THREE.Scene();
    buildStructureShell(THREE, scene, layout);
    const floor = scene.children.find(child => child.userData.satelliteGroundRef && !child.userData.satelliteSurroundFade) as THREE.Mesh;
    const surround = scene.children.find(child => child.userData.satelliteSurroundFade) as THREE.Mesh;
    const frame = layout.mapGroundFrame!;
    const bounds = parseSatelliteImageBounds(layout.floorPlanImage!)!;
    const shell = layout.backendVenue?.polygon ?? [];
    const pos = floor.geometry.getAttribute('position');
    const uv = floor.geometry.getAttribute('uv');
    let northV = -Infinity;
    let southV = Infinity;
    for (const point of shell) {
      const shapeX = point.x - layout.width / 2;
      const shapeY = -(point.z - layout.height / 2);
      let best = 0;
      let bestD = Infinity;
      for (let i = 0; i < pos.count; i++) {
        const distance = (pos.getX(i) - shapeX) ** 2 + (pos.getY(i) - shapeY) ** 2;
        if (distance < bestD) { bestD = distance; best = i; }
      }
      expect(bestD).toBeLessThan(1e-8);
      const expected = shellMetersToSatelliteUv(point.x, point.z, frame, bounds);
      expect(uv.getX(best)).toBeCloseTo(expected.u, 4);
      expect(uv.getY(best)).toBeCloseTo(expected.v, 4);
      expect(expected.u).toBeGreaterThan(0.05);
      expect(expected.u).toBeLessThan(0.95);
      expect(expected.v).toBeGreaterThan(0.05);
      expect(expected.v).toBeLessThan(0.95);
      northV = Math.max(northV, expected.v);
      southV = Math.min(southV, expected.v);
    }
    expect(northV).toBeGreaterThan(southV);
    const surroundUv = surround.geometry.getAttribute('uv');
    const surroundPos = surround.geometry.getAttribute('position');
    const xs = Array.from({ length: surroundUv.count }, (_, index) => surroundUv.getX(index));
    const ys = Array.from({ length: surroundUv.count }, (_, index) => surroundUv.getY(index));
    expect(Math.min(...xs)).toBeGreaterThan(-0.02);
    expect(Math.max(...xs)).toBeLessThan(1.02);
    expect(Math.min(...ys)).toBeGreaterThan(-0.02);
    expect(Math.max(...ys)).toBeLessThan(1.02);
    const corner = shell[0]!;
    const cornerX = corner.x - layout.width / 2;
    const cornerY = -(corner.z - layout.height / 2);
    let surroundIndex = 0;
    let surroundDistance = Infinity;
    for (let i = 0; i < surroundPos.count; i++) {
      const distance = (surroundPos.getX(i) - cornerX) ** 2 + (surroundPos.getY(i) - cornerY) ** 2;
      if (distance < surroundDistance) { surroundDistance = distance; surroundIndex = i; }
    }
    expect(surroundDistance).toBeLessThan(1e-8);
    const shared = shellMetersToSatelliteUv(corner.x, corner.z, frame, bounds);
    expect(surroundUv.getX(surroundIndex)).toBeCloseTo(shared.u, 4);
    expect(surroundUv.getY(surroundIndex)).toBeCloseTo(shared.v, 4);
  });
});
