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
    const xs = uv ? Array.from({ length: uv.count }, (_, index) => uv.getX(index)) : [];
    const ys = uv ? Array.from({ length: uv.count }, (_, index) => uv.getY(index)) : [];
    // 圈外必须采到照片里的像素。落到 0..1 之外时 ClampToEdge 会把边缘纹素拉成线带。
    expect(xs.length).toBeGreaterThan(0);
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(-1e-4);
    expect(Math.max(...xs)).toBeLessThanOrEqual(1 + 1e-4);
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(-1e-4);
    expect(Math.max(...ys)).toBeLessThanOrEqual(1 + 1e-4);
    expect(Math.min(...xs)).toBeLessThan(0.02);
    expect(Math.max(...xs)).toBeGreaterThan(0.98);
    const floorUv = floor?.geometry.getAttribute('uv');
    const floorXs = floorUv ? Array.from({ length: floorUv.count }, (_, index) => floorUv.getX(index)) : [];
    expect(Math.min(...floorXs)).toBeGreaterThan(0.05);
    expect(Math.max(...floorXs)).toBeLessThan(0.95);
    // 圈外三角从照片外沿（0/1）连到圈边。中间这段是照片外圈的真实像素，不是同一个边缘纹素。
    expect(xs.some(value => value > 0.05 && value < 0.95)).toBe(true);
    expect(Math.min(...xs.filter(value => value > 0.02))).toBeCloseTo(Math.min(...floorXs), 2);
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
    expect(Math.min(...xs)).toBeLessThan(0.05);
    expect(Math.max(...xs)).toBeGreaterThan(0.95);
    expect(Math.min(...ys)).toBeLessThan(0.05);
    expect(Math.max(...ys)).toBeGreaterThan(0.95);
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

  it('shows geographic north above south in the top-down camera, with the surround on the same photo', () => {
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 500);
    camera.position.set(0, 80, 0.001);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();
    const depth = 60;
    const project = (z: number) => new THREE.Vector3(0, 0, z - depth / 2).project(camera);
    expect(project(0).y).toBeGreaterThan(project(depth).y);
    vi.stubGlobal('Image', class {
      onload: null | (() => void) = null;
      onerror: null | (() => void) = null;
      set src(_value: string) { queueMicrotask(() => this.onload?.()); }
    });
    const lat = 30.45;
    const lng = 120.55;
    const east = (meters: number) => lng + meters / (111_320 * Math.cos((lat * Math.PI) / 180));
    const north = (meters: number) => lat + meters / 110_574;
    const polygon = [
      { lng, lat: north(80) },
      { lng: east(40), lat: north(80) },
      { lng: east(40), lat: north(30) },
      { lng: east(120), lat: north(30) },
      { lng: east(120), lat },
      { lng, lat },
    ];
    const image = satelliteProxyUrl(polygon, 'secret-key')!;
    const { layout } = createVenueFromPick(INITIAL_LAYOUT as RoomLayout, {
      name: '盐官', location: '手画', polygon, satelliteGround: true, satelliteGroundImage: image,
    });
    const scene = new THREE.Scene();
    buildStructureShell(THREE, scene, layout);
    const surround = scene.children.find(child => child.userData.satelliteSurroundFade) as THREE.Mesh;
    const uv = surround.geometry.getAttribute('uv');
    const xs = Array.from({ length: uv.count }, (_, index) => uv.getX(index));
    const ys = Array.from({ length: uv.count }, (_, index) => uv.getY(index));
    expect(Math.min(...xs)).toBeGreaterThan(-0.02);
    expect(Math.max(...xs)).toBeLessThan(1.02);
    expect(Math.min(...ys)).toBeGreaterThan(-0.02);
    expect(Math.max(...ys)).toBeLessThan(1.02);
    const material = surround.material as THREE.MeshBasicMaterial;
    expect(material.color.getHex()).toBe(0xffffff);
    expect(material.opacity).toBeLessThan(0.7);
  });

  it('keeps the surround on the photo when the saved frame is missing', () => {
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
      name: '盐官潮乐之城', location: '海宁盐官', polygon, satelliteGround: true, satelliteGroundImage: image,
    });
    const framed = layout.mapGroundFrame!;
    const dropped = { ...layout };
    delete dropped.mapGroundFrame;
    const scene = new THREE.Scene();
    buildStructureShell(THREE, scene, dropped);
    const surround = scene.children.find(child => child.userData.satelliteSurroundFade) as THREE.Mesh;
    const floor = scene.children.find(child => child.userData.satelliteGroundRef && !child.userData.satelliteSurroundFade) as THREE.Mesh;
    const bounds = parseSatelliteImageBounds(layout.floorPlanImage!)!;
    const shell = layout.backendVenue?.polygon ?? [];
    const pos = floor.geometry.getAttribute('position');
    const uv = floor.geometry.getAttribute('uv');
    const corner = shell[0]!;
    const shapeX = corner.x - layout.width / 2;
    const shapeY = -(corner.z - layout.height / 2);
    let index = 0;
    let best = Infinity;
    for (let i = 0; i < pos.count; i++) {
      const distance = (pos.getX(i) - shapeX) ** 2 + (pos.getY(i) - shapeY) ** 2;
      if (distance < best) { best = distance; index = i; }
    }
    const expected = shellMetersToSatelliteUv(corner.x, corner.z, framed, bounds);
    expect(uv.getX(index)).toBeCloseTo(expected.u, 4);
    expect(uv.getY(index)).toBeCloseTo(expected.v, 4);
    const surroundUv = surround.geometry.getAttribute('uv');
    const xs = Array.from({ length: surroundUv.count }, (_, i) => surroundUv.getX(i));
    const ys = Array.from({ length: surroundUv.count }, (_, i) => surroundUv.getY(i));
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(-1e-3);
    expect(Math.max(...xs)).toBeLessThanOrEqual(1 + 1e-3);
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(-1e-3);
    expect(Math.max(...ys)).toBeLessThanOrEqual(1 + 1e-3);
    expect(Math.min(...xs)).toBeLessThan(0.05);
    expect(Math.max(...xs)).toBeGreaterThan(0.95);
  });

  it('leaves a plain floor when satellite ground is off', () => {
    const scene = new THREE.Scene();
    buildStructureShell(THREE, scene, makeLayout({
      satelliteGroundRef: false,
      floorPlanImage: '/api/amap-static?west=120.53&south=30.40&east=120.54&north=30.41&x-ref=satellite-ground-ref',
    }));
    expect(scene.children.some(child => child.userData.satelliteSurroundFade)).toBe(false);
    expect(scene.children.some(child => child.userData.satelliteGroundRef)).toBe(false);
  });
});
