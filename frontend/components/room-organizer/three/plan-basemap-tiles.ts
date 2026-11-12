/**
 * 户外地理瓦片铺地管线（从 `components/outdoor-plan-3d.tsx` 原样抽出，2026-11-11）。
 *
 * 原本整套管线（paintTiledGround / paintTilePyramid + frame 族 + 瓦片数学）锁在
 * outdoor-plan-3d 组件文件里，主舞台（use-scene-effects）拿不到——退出户外后 3D
 * 只剩纸面平面。这里把它搬成共享模块：依赖全是叶子（lib/outdoor-plan-canvas、
 * plan-ground-capture、tdt-probe、basemap-alignment、plan-tile-cache、geo-coords、
 * three/research-basemap 的 tag），无循环依赖。
 *
 * 坐标口径不变：调用方给 `anchor`（GCJ-02）与 `bounds`（同锚点的经纬框），瓦片四角
 * 经 `lngLatToEnu(corner, anchor)` 落成 ENU 米制点，`addTileQuad` 放到 (enu.x, height, -enu.y)。
 * 主舞台复用时用「父组仿射」把 ENU 变换到壳体世界系（见 use-scene-effects 的 GeoGround effect），
 * 管线本身零改动。
 *
 * 本模块相对原文件的唯一行为差异：`addTileQuad` / `paintTiledGround` / `paintTilePyramid`
 * 增加可选 `tag` 参数（默认仍 `RESEARCH_BASEMAP_TAG`，outdoor-plan-3d 行为不变）；
 * 主舞台传自己的 tag，避免与 `clearResearchBasemap` 的清理语义互相误删。
 */

import * as THREE from 'three';
import { enuToLngLat, lngLatToEnu, planMetersPerPixel, type PlanViewport } from '@/components/room-organizer/lib/outdoor-plan-canvas';
import {
  latToTileY,
  lngToTileX,
  tileNorthLat,
  type PlanGroundBounds,
} from '@/components/room-organizer/lib/plan-ground-capture';
import { publicSourceTileUrl } from '@/components/room-organizer/lib/tdt-probe';
import { alignedTileBounds, needsWgs84Alignment } from '@/components/room-organizer/lib/basemap-alignment';
import { ancestorTileCrop, BasemapTileCache } from '@/components/room-organizer/lib/plan-tile-cache';
import { wgs84ToGcj02 } from '@/components/room-organizer/lib/geo-coords';
import { RESEARCH_BASEMAP_TAG } from '@/components/room-organizer/three/research-basemap';
import type { CanvasBasemapSource } from '@/components/room-organizer/components/outdoor-plan-canvas';
import type { PlanPoint, PlanRing } from '../../../../supabase/functions/_shared/site-plan';

export interface SiteFrame {
  /** 边界在 ENU 里的包围盒中心（米）。 */
  cx: number;
  cy: number;
  width: number;
  depth: number;
  span: number;
}

export function ringFrame(ring: PlanRing): SiteFrame {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  ring.forEach((p: PlanPoint) => {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  });
  if (!Number.isFinite(minX)) {
    return { cx: 0, cy: 0, width: 60, depth: 40, span: 60 };
  }
  const width = Math.max(4, maxX - minX);
  const depth = Math.max(4, maxY - minY);
  return { cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, width, depth, span: Math.max(width, depth) };
}

export function frameToBounds(frame: SiteFrame, anchor: { lng: number; lat: number }): PlanGroundBounds {
  const sw = enuToLngLat(frame.cx - frame.width / 2, frame.cy - frame.depth / 2, anchor.lng, anchor.lat);
  const ne = enuToLngLat(frame.cx + frame.width / 2, frame.cy + frame.depth / 2, anchor.lng, anchor.lat);
  return { west: sw.lng, south: sw.lat, east: ne.lng, north: ne.lat };
}

/**
 * 把指定姿态的透视镜头与地面（y=0）求交，得到要铺满整个画面所需的 ENU 范围。
 * 某条边几乎水平、打不到地面时，就在那个方向放到 maxRange，避免再留下一条空白带。
 */
export function coverFrameFromFrustum(
  target: THREE.Vector3,
  eye: THREE.Vector3,
  fovDeg: number,
  aspect: number,
  maxRange = 80000,
  pad = 1.35,
): SiteFrame {
  const probe = new THREE.PerspectiveCamera(fovDeg, Math.max(aspect, 0.2), 0.1, Math.max(maxRange * 2, 1));
  probe.position.copy(eye);
  probe.lookAt(target);
  probe.updateMatrixWorld();
  probe.updateProjectionMatrix();
  const hits: Array<{ x: number; z: number }> = [];
  const corners: Array<[number, number]> = [
    [-1, -1], [1, -1], [-1, 1], [1, 1],
    [-1, 0], [1, 0], [0, -1], [0, 1],
  ];
  for (const [nx, ny] of corners) {
    const near = new THREE.Vector3(nx, ny, -1).unproject(probe);
    const far = new THREE.Vector3(nx, ny, 1).unproject(probe);
    const dir = far.clone().sub(near);
    if (Math.abs(dir.y) < 1e-9) {
      const horiz = new THREE.Vector3(dir.x, 0, dir.z);
      if (horiz.lengthSq() < 1e-12) continue;
      horiz.setLength(maxRange);
      hits.push({ x: probe.position.x + horiz.x, z: probe.position.z + horiz.z });
      continue;
    }
    const t = -near.y / dir.y;
    if (t <= 0) {
      const horiz = new THREE.Vector3(dir.x, 0, dir.z);
      if (horiz.lengthSq() < 1e-12) continue;
      horiz.setLength(maxRange);
      hits.push({ x: probe.position.x + horiz.x, z: probe.position.z + horiz.z });
      continue;
    }
    const hit = near.clone().add(dir.multiplyScalar(t));
    const dx = hit.x - target.x;
    const dz = hit.z - target.z;
    const dist = Math.hypot(dx, dz);
    if (dist > maxRange && dist > 0) {
      hits.push({ x: target.x + (dx * maxRange) / dist, z: target.z + (dz * maxRange) / dist });
    } else {
      hits.push({ x: hit.x, z: hit.z });
    }
  }
  if (hits.length < 2) {
    return { cx: target.x, cy: -target.z, width: maxRange, depth: maxRange, span: maxRange };
  }
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  hits.forEach((hit) => {
    minX = Math.min(minX, hit.x);
    maxX = Math.max(maxX, hit.x);
    minZ = Math.min(minZ, hit.z);
    maxZ = Math.max(maxZ, hit.z);
  });
  const width = Math.max(4, (maxX - minX) * pad);
  const depth = Math.max(4, (maxZ - minZ) * pad);
  return {
    cx: (minX + maxX) / 2,
    cy: -((minZ + maxZ) / 2),
    width,
    depth,
    span: Math.max(width, depth),
  };
}

export function unionFrames(frames: readonly SiteFrame[]): SiteFrame {
  return frames.reduce((acc, frame) => unionFrame(acc, frame));
}

export function zoomFromSpan(spanM: number): number {
  const metersPerPixel = Math.max(spanM, 8) / 512;
  const target = Math.log2((156543.03392 * Math.cos((30 * Math.PI) / 180)) / metersPerPixel);
  return Math.max(13, Math.min(19, Math.round(target)));
}

export function maxZoomForSource(source: CanvasBasemapSource): number {
  // 3D 默认用图源真正有高清瓦片的最高级；高德最近一档发虚，退一档。
  if (source === 'amap-satellite') return 18;
  if (source === 'amap-streets' || source === 'amap-streets-labels') return 17;
  if (source === 'vec' || source === 'img') return 18;
  return 19;
}

export function tileUrlFor(source: CanvasBasemapSource, z: number, x: number, y: number): string {
  if (source === 'vec') return `/api/tdt-tiles?layer=vec_w&z=${z}&x=${x}&y=${y}`;
  if (source === 'img') return `/api/tdt-tiles?layer=img_w&z=${z}&x=${x}&y=${y}`;
  return publicSourceTileUrl(source, z, x, y);
}

export function chooseTileZoom(bounds: PlanGroundBounds, preferred: number, maxZoom: number, maxTiles: number): number {
  let zoom = Math.max(4, Math.min(maxZoom, Math.round(preferred)));
  while (zoom > 4) {
    const minX = Math.floor(lngToTileX(bounds.west, zoom));
    const maxX = Math.floor(lngToTileX(bounds.east, zoom));
    const minY = Math.floor(latToTileY(bounds.north, zoom));
    const maxY = Math.floor(latToTileY(bounds.south, zoom));
    const count = (maxX - minX + 1) * (maxY - minY + 1);
    if (count <= maxTiles) return zoom;
    zoom -= 1;
  }
  return zoom;
}

export function tileCornerLngLat(lng: number, lat: number, source: CanvasBasemapSource): { lng: number; lat: number } {
  if (!needsWgs84Alignment(source)) return { lng, lat };
  return wgs84ToGcj02(lng, lat);
}

export const TILE_PYRAMID_DEPTH = 4;
export const TILE_PIXELS = 256;

export function ancestorUv(sx: number, sy: number, size: number, tileSize: number): { u0: number; v0: number; u1: number; v1: number } {
  const u0 = sx / tileSize;
  const u1 = (sx + size) / tileSize;
  // Texture.flipY 默认 true：v=0 是图片底边（南缘），裁剪坐标原点在左上。
  const v1 = 1 - sy / tileSize;
  const v0 = 1 - (sy + size) / tileSize;
  return { u0, v0, u1, v1 };
}

export function getSharedTexture(
  imageCache: BasemapTileCache,
  textures: Map<string, THREE.Texture>,
  url: string,
  mipmaps: boolean,
): THREE.Texture | null {
  const existing = textures.get(url);
  if (existing) return existing;
  const img = imageCache.get(url);
  if (!img) return null;
  const texture = new THREE.Texture(img);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  texture.generateMipmaps = mipmaps;
  texture.minFilter = mipmaps ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.anisotropy = mipmaps ? 16 : 1;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  textures.set(url, texture);
  return texture;
}

export function addTileQuad(
  parent: THREE.Object3D,
  disposables: { dispose: () => void }[],
  sw: { x: number; y: number },
  se: { x: number; y: number },
  ne: { x: number; y: number },
  nw: { x: number; y: number },
  texture: THREE.Texture,
  height: number,
  uv?: { u0: number; v0: number; u1: number; v1: number },
  tag: string = RESEARCH_BASEMAP_TAG,
): THREE.Mesh {
  const u0 = uv?.u0 ?? 0;
  const v0 = uv?.v0 ?? 0;
  const u1 = uv?.u1 ?? 1;
  const v1 = uv?.v1 ?? 1;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array([
    sw.x, height, -sw.y,
    se.x, height, -se.y,
    ne.x, height, -ne.y,
    nw.x, height, -nw.y,
  ]), 3));
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([u0, v0, u1, v0, u1, v1, u0, v1]), 2));
  const material = new THREE.MeshBasicMaterial({ map: texture, depthWrite: false });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.userData.type = tag;
  parent.add(mesh);
  // 2026-11-12 用户「缩放时两个尺度的栅格闪来闪去」：整座瓦片金字塔是若干张几乎共面的
  // 大面片（相邻级只差 0.12 mm），彼此 z-fighting → 每一帧谁在前面会被抖动决定，
  // 表现就是在两个清晰度之间闪。改成：不写深度 + 按高度定 renderOrder，
  // 高级别永远后画、盖住低级别；和场景其它物体仍用正常深度测试。
  mesh.renderOrder = Math.round(height * 2000);
  // 纹理来自共享缓存，不能随单块网格一起 dispose。
  disposables.push(geometry, material);
  return mesh;
}

export function tileHeight(zoom: number): number {
  // 整座瓦片金字塔贴在地平面附近，必须低于规划层（分区约 0.28 m 起）。
  // 每级抬 4 mm：早先只差 0.12 mm，5 层摞在一起在 z-buffer 里分不开（见 addTileQuad）。
  return 0.004 + Math.max(0, zoom - 8) * 0.004;
}

/** 按镜头到目标的距离估算需要的地图级别；略提前加一级，避免放大后先露出糊图。 */
export function neededMapZoom(camera: THREE.PerspectiveCamera, target: THREE.Vector3, canvasH: number, lat: number): number {
  const dist = Math.max(camera.position.distanceTo(target) * 0.7, 4);
  const metersPerPixel = (2 * dist * Math.tan((camera.fov * Math.PI) / 360)) / Math.max(canvasH, 1);
  const zoom = Math.log2((156543.03392 * Math.cos((lat * Math.PI) / 180)) / Math.max(metersPerPixel, 0.05));
  return Math.max(4, Math.min(19, zoom + 0.6));
}

export function squareFrame(cx: number, cy: number, size: number): SiteFrame {
  const span = Math.max(size, 8);
  return { cx, cy, width: span, depth: span, span };
}

export interface TilePaintCache {
  imageCache: BasemapTileCache;
  textures: Map<string, THREE.Texture>;
  fallbackMeshes: Map<string, THREE.Mesh>;
  readyKeys: Set<string>;
}

/** 按墨卡托瓦片一块一块铺到 ENU 地面。fixedZoom 时宁可不铺远处，也不把级别降下去，避免缩放时精度跳档。 */
export async function paintTiledGround(options: {
  scene: THREE.Scene;
  disposables: { dispose: () => void }[];
  bounds: PlanGroundBounds;
  anchor: { lng: number; lat: number };
  source: CanvasBasemapSource;
  preferredZoom: number;
  maxTiles: number;
  height: number;
  isDisposed: () => boolean;
  loaded?: Set<string>;
  fixedZoom?: boolean;
  focus?: { x: number; y: number };
  mipmaps?: boolean;
  cache: TilePaintCache;
  fallbackDepth?: number;
  parent: THREE.Object3D;
  /** 瓦片 quad 的 userData.type 标记（默认 RESEARCH_BASEMAP_TAG，与 outdoor-plan-3d 原行为一致）。 */
  tag?: string | undefined;
}): Promise<number> {
  if (typeof document === 'undefined') return 0;
  const tileBounds = alignedTileBounds(options.bounds, options.source);
  const maxZoom = maxZoomForSource(options.source);
  const zoom = options.fixedZoom
    ? Math.max(4, Math.min(maxZoom, Math.round(options.preferredZoom)))
    : chooseTileZoom(tileBounds, options.preferredZoom, maxZoom, options.maxTiles);
  const minX = Math.floor(lngToTileX(tileBounds.west, zoom));
  const maxX = Math.floor(lngToTileX(tileBounds.east, zoom));
  const minY = Math.floor(latToTileY(tileBounds.north, zoom));
  const maxY = Math.floor(latToTileY(tileBounds.south, zoom));
  const world = 2 ** zoom;
  type TileJob = { tx: number; ty: number; wrappedX: number; cx: number; cy: number };
  const tiles: TileJob[] = [];
  for (let ty = minY; ty <= maxY; ty += 1) {
    for (let tx = minX; tx <= maxX; tx += 1) {
      const wrappedX = ((tx % world) + world) % world;
      const west = (tx / world) * 360 - 180;
      const east = ((tx + 1) / world) * 360 - 180;
      const north = tileNorthLat(ty, zoom);
      const south = tileNorthLat(ty + 1, zoom);
      const mid = tileCornerLngLat((west + east) / 2, (north + south) / 2, options.source);
      const enu = lngLatToEnu(mid.lng, mid.lat, options.anchor.lng, options.anchor.lat);
      tiles.push({ tx, ty, wrappedX, cx: enu.x, cy: enu.y });
    }
  }
  const chosen = (() => {
    const focus = options.focus;
    const ordered = focus
      ? tiles.slice().sort((a, b) => {
          const da = (a.cx - focus.x) ** 2 + (a.cy - focus.y) ** 2;
          const db = (b.cx - focus.x) ** 2 + (b.cy - focus.y) ** 2;
          return da - db;
        })
      : tiles;
    if (ordered.length <= options.maxTiles) return ordered;
    return ordered.slice(0, options.maxTiles);
  })();
  const useMipmaps = options.mipmaps ?? zoom >= 15;
  const depth = options.fallbackDepth ?? TILE_PYRAMID_DEPTH;
  const pending: TileJob[] = [];
  chosen.forEach((tile) => {
    const key = `${zoom}:${tile.wrappedX}:${tile.ty}`;
    if (options.cache.readyKeys.has(key) || options.loaded?.has(key)) return;
    options.loaded?.add(key);
    pending.push(tile);
  });
  const loadOne = (tile: TileJob): Promise<number> => new Promise((resolve) => {
    const key = `${zoom}:${tile.wrappedX}:${tile.ty}`;
    // 2026-11-12：任何一张瓦片悬住（既没 onload 也没 onerror）都会让 Promise.all 永远
    // 不结算，上层 `lodBusy` 卡死 → 之后不再补高清瓦片（3D 地面一直糊）。加超时兜底。
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const done = (value: number): void => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve(value);
    };
    timer = setTimeout(() => {
      options.loaded?.delete(key);
      done(0);
    }, 8000);
    const west = (tile.tx / world) * 360 - 180;
    const east = ((tile.tx + 1) / world) * 360 - 180;
    const north = tileNorthLat(tile.ty, zoom);
    const south = tileNorthLat(tile.ty + 1, zoom);
    const swLL = tileCornerLngLat(west, south, options.source);
    const seLL = tileCornerLngLat(east, south, options.source);
    const neLL = tileCornerLngLat(east, north, options.source);
    const nwLL = tileCornerLngLat(west, north, options.source);
    const sw = lngLatToEnu(swLL.lng, swLL.lat, options.anchor.lng, options.anchor.lat);
    const se = lngLatToEnu(seLL.lng, seLL.lat, options.anchor.lng, options.anchor.lat);
    const ne = lngLatToEnu(neLL.lng, neLL.lat, options.anchor.lng, options.anchor.lat);
    const nw = lngLatToEnu(nwLL.lng, nwLL.lat, options.anchor.lng, options.anchor.lat);
    const url = tileUrlFor(options.source, zoom, tile.wrappedX, tile.ty);
    const { imageCache, textures, fallbackMeshes, readyKeys } = options.cache;
    const dropFallback = (): void => {
      const fb = fallbackMeshes.get(key);
      if (!fb) return;
      fb.parent?.remove(fb);
      fb.geometry.dispose();
      (fb.material as THREE.Material).dispose();
      fallbackMeshes.delete(key);
    };
    const placeReal = (): void => {
      if (options.isDisposed() || readyKeys.has(key)) {
        done(readyKeys.has(key) ? 1 : 0);
        return;
      }
      const texture = getSharedTexture(imageCache, textures, url, useMipmaps);
      if (!texture) {
        options.loaded?.delete(key);
        done(0);
        return;
      }
      addTileQuad(options.parent, options.disposables, sw, se, ne, nw, texture, options.height, undefined, options.tag);
      readyKeys.add(key);
      dropFallback();
      done(1);
    };
    const tryFallback = (): void => {
      if (options.isDisposed() || readyKeys.has(key) || fallbackMeshes.has(key)) return;
      for (let d = 1; d <= depth; d += 1) {
        const crop = ancestorTileCrop(zoom, tile.wrappedX, tile.ty, d, TILE_PIXELS);
        const ancestorUrl = tileUrlFor(options.source, crop.zoom, crop.x, crop.y);
        const tex = getSharedTexture(imageCache, textures, ancestorUrl, false);
        if (!tex) continue;
        const uv = ancestorUv(crop.sx, crop.sy, crop.size, TILE_PIXELS);
        const mesh = addTileQuad(options.parent, options.disposables, sw, se, ne, nw, tex, Math.max(0, options.height - 0.0008), uv, options.tag);
        fallbackMeshes.set(key, mesh);
        return;
      }
    };
    for (let d = 1; d <= depth; d += 1) {
      const crop = ancestorTileCrop(zoom, tile.wrappedX, tile.ty, d, TILE_PIXELS);
      const ancestorUrl = tileUrlFor(options.source, crop.zoom, crop.x, crop.y);
      imageCache.load(ancestorUrl, tryFallback);
    }
    tryFallback();
    imageCache.load(url, placeReal);
    if (imageCache.status(url) === 'error') {
      options.loaded?.delete(key);
      done(0);
    }
  });
  let loaded = 0;
  const batchSize = 40;
  for (let i = 0; i < pending.length; i += batchSize) {
    if (options.isDisposed()) break;
    const chunk = pending.slice(i, i + batchSize);
    const results = await Promise.all(chunk.map(loadOne));
    loaded += results.reduce((sum, n) => sum + n, 0);
  }
  return loaded;
}

/** 当前级 + 往上 4 级一起铺，和 2D fallbackDepth 对齐。高清仍优先铺在近处。 */
export async function paintTilePyramid(options: {
  scene: THREE.Scene;
  disposables: { dispose: () => void }[];
  closeBounds: PlanGroundBounds;
  midBounds: PlanGroundBounds;
  farBounds?: PlanGroundBounds;
  anchor: { lng: number; lat: number };
  source: CanvasBasemapSource;
  topZoom: number;
  isDisposed: () => boolean;
  loaded: Set<string>;
  cache: TilePaintCache;
  focus: { x: number; y: number };
  closeMaxTiles?: number;
  parent: THREE.Object3D;
  tag?: string | undefined;
}): Promise<number> {
  const cap = maxZoomForSource(options.source);
  const top = Math.max(4, Math.min(cap, Math.round(options.topZoom)));
  const jobs: Promise<number>[] = [];
  for (let d = 0; d <= TILE_PYRAMID_DEPTH; d += 1) {
    const z = top - d;
    if (z < 4) break;
    const bounds = d === 0
      ? options.closeBounds
      : d <= 2
        ? options.midBounds
        : (options.farBounds ?? options.midBounds);
    const maxTiles = d === 0 ? (options.closeMaxTiles ?? 200) : d <= 2 ? 120 : 80;
    jobs.push(paintTiledGround({
      scene: options.scene,
      disposables: options.disposables,
      bounds,
      anchor: options.anchor,
      source: options.source,
      preferredZoom: z,
      maxTiles,
      height: tileHeight(z),
      isDisposed: options.isDisposed,
      loaded: options.loaded,
      fixedZoom: true,
      focus: options.focus,
      mipmaps: z >= 15,
      cache: options.cache,
      parent: options.parent,
      tag: options.tag,
    }));
  }
  const counts = await Promise.all(jobs);
  return counts.reduce((sum, n) => sum + n, 0);
}

/** 把 2D 画布当前视口换成 ENU 框，3D 镜头对着同一块地图斜起来。 */
export function frameFromMapView(view: PlanViewport, anchor: { lng: number; lat: number }): SiteFrame {
  const mpp = planMetersPerPixel(view);
  const width = Math.max(8, (view.canvasW || 800) * mpp);
  const depth = Math.max(8, (view.canvasH || 600) * mpp);
  const origin = lngLatToEnu(view.lng, view.lat, anchor.lng, anchor.lat);
  return { cx: origin.x, cy: origin.y, width, depth, span: Math.max(width, depth) };
}

export function unionFrame(a: SiteFrame, b: SiteFrame): SiteFrame {
  const minX = Math.min(a.cx - a.width / 2, b.cx - b.width / 2);
  const maxX = Math.max(a.cx + a.width / 2, b.cx + b.width / 2);
  const minY = Math.min(a.cy - a.depth / 2, b.cy - b.depth / 2);
  const maxY = Math.max(a.cy + a.depth / 2, b.cy + b.depth / 2);
  const width = Math.max(4, maxX - minX);
  const depth = Math.max(4, maxY - minY);
  return { cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, width, depth, span: Math.max(width, depth) };
}
