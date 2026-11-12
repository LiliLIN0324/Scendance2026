// @vitest-environment jsdom
import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BasemapTileCache } from '../lib/plan-tile-cache';
import { RESEARCH_BASEMAP_TAG } from './research-basemap';
import { paintTiledGround, paintTilePyramid, type TilePaintCache } from './plan-basemap-tiles';

/** 微任务直接就绪的假图：只当「图片已能解码」用，不碰网络。 */
class FakeImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  crossOrigin: string | null = null;
  set src(_value: string) {
    queueMicrotask(() => this.onload?.());
  }
}

const ANCHOR = { lng: 120.15, lat: 30.25 };
const BOUNDS = { west: 120.148, south: 30.248, east: 120.152, north: 30.252 };

function makeCache(): TilePaintCache {
  return {
    imageCache: new BasemapTileCache({ createImage: () => new FakeImage() as unknown as HTMLImageElement }),
    textures: new Map<string, THREE.Texture>(),
    fallbackMeshes: new Map<string, THREE.Mesh>(),
    readyKeys: new Set<string>(),
  };
}

interface PaintOptions {
  readonly source?: 'osm';
  readonly preferredZoom?: number;
  readonly maxTiles?: number;
  readonly height?: number;
  readonly tag?: string | undefined;
  readonly isDisposed?: () => boolean;
}

function paintOnce(parent: THREE.Object3D, cache: TilePaintCache, options: PaintOptions = {}): Promise<number> {
  return paintTiledGround({
    scene: new THREE.Scene(),
    disposables: [],
    bounds: BOUNDS,
    anchor: ANCHOR,
    source: options.source ?? 'osm',
    preferredZoom: options.preferredZoom ?? 14,
    maxTiles: options.maxTiles ?? 6,
    height: options.height ?? 0.001,
    isDisposed: options.isDisposed ?? (() => false),
    cache,
    parent,
    ...(options.tag === undefined ? {} : { tag: options.tag }),
  });
}

describe('plan basemap tiles (shared tile-ground pipeline)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('paints tile quads flat at the requested height, tagged research-basemap by default', async () => {
    const parent = new THREE.Group();
    const cache = makeCache();
    const loaded = await paintOnce(parent, cache);
    expect(loaded).toBeGreaterThan(0);
    expect(parent.children).toHaveLength(loaded);
    for (const child of parent.children) {
      const mesh = child as THREE.Mesh;
      expect(mesh.userData.type).toBe(RESEARCH_BASEMAP_TAG);
      const position = mesh.geometry.getAttribute('position');
      // 四角都是 (enu.x, height, -enu.y)：高度贴 request 的值，y 分量不参与。
      for (let corner = 0; corner < position.count; corner += 1) {
        expect(position.getY(corner)).toBeCloseTo(0.001, 9);
      }
      const uv = mesh.geometry.getAttribute('uv');
      expect(uv).toBeDefined();
    }
    expect(cache.readyKeys.size).toBe(loaded);
  });

  it('does not reload tiles already marked ready (dedup by cache key)', async () => {
    const parent = new THREE.Group();
    const cache = makeCache();
    const loaded: Set<string> = new Set();
    const first = await paintTiledGround({
      scene: new THREE.Scene(), disposables: [], bounds: BOUNDS, anchor: ANCHOR,
      source: 'osm', preferredZoom: 14, maxTiles: 6, height: 0.001,
      isDisposed: () => false, loaded, cache, parent,
    });
    expect(first).toBeGreaterThan(0);
    const second = await paintTiledGround({
      scene: new THREE.Scene(), disposables: [], bounds: BOUNDS, anchor: ANCHOR,
      source: 'osm', preferredZoom: 14, maxTiles: 6, height: 0.001,
      isDisposed: () => false, loaded, cache, parent,
    });
    expect(second).toBe(0);
    expect(parent.children).toHaveLength(first);
  });

  it('honours the tag override so the main stage can use its own geo-ground tag', async () => {
    const parent = new THREE.Group();
    const cache = makeCache();
    const loaded = await paintOnce(parent, cache, { tag: 'geo-ground' });
    expect(loaded).toBeGreaterThan(0);
    for (const child of parent.children) {
      expect(child.userData.type).toBe('geo-ground');
    }
  });

  it('paints the pyramid levels close-to-far and reports the total count', async () => {
    const parent = new THREE.Group();
    const cache = makeCache();
    const loaded = await paintTilePyramid({
      scene: new THREE.Scene(),
      disposables: [],
      closeBounds: BOUNDS,
      midBounds: BOUNDS,
      farBounds: BOUNDS,
      anchor: ANCHOR,
      source: 'osm',
      topZoom: 15,
      isDisposed: () => false,
      loaded: new Set<string>(),
      cache,
      focus: { x: 0, y: 0 },
      closeMaxTiles: 8,
      parent,
      tag: 'geo-ground',
    });
    expect(loaded).toBeGreaterThan(0);
    expect(parent.children.length).toBe(loaded);
    const zoomHeights = new Set(parent.children.map((child) => (child as THREE.Mesh).geometry.getAttribute('position').getY(0)));
    // 金字塔每级贴自己的高度（tileHeight 单调），至少两级在场上。
    expect(zoomHeights.size).toBeGreaterThan(1);
  });

  it('stops painting once disposed', async () => {
    const parent = new THREE.Group();
    const cache = makeCache();
    const loaded = await paintOnce(parent, cache, { isDisposed: () => true });
    expect(loaded).toBe(0);
    expect(parent.children).toHaveLength(0);
  });
});
