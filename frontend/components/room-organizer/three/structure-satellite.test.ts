// @vitest-environment jsdom
import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeLayout } from '../lib/__testfixtures__/fixtures';
import { SATELLITE_GROUND_LABEL } from '../lib/amap-venue';
import { buildStructureShell } from './structure-builder';

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
});
