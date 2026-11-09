import { RESEARCH_BASEMAP_TAG, RESEARCH_BASEMAP_Y, researchBasemapMesh, researchBasemapPlacement, researchGeoToWorld } from './research-basemap';
import { wgs84ToGcj02 } from '../lib/geo-coords';
import type { RoomLayout } from '../lib/types';
import type * as ThreeNS from 'three';

/**
 * 整景区矢量叠加层（范围线 + 西湖水面）。
 *
 * 只用 `researchGeoToWorld` 这一套 geo→world 变换（sceneAnchor / 底图中心回退），
 * 不另起坐标路径；y 压在底图之上、场景地板之下，并挂 `RESEARCH_BASEMAP_TAG`
 * ——渲染时随底图一起挪进点云背景栈，保证「底图 < 矢量 < 3D」的先后。
 */

export const RESEARCH_OVERLAY_Y = RESEARCH_BASEMAP_Y + 0.012;

export const SCENIC_LINE_COLOR = 0xf59e0b;
export const WATER_LINE_COLOR = 0x38bdf8;
export const WATER_FILL_COLOR = 0x1e6fd9;
export const WATER_FILL_OPACITY = 0.14;

/** 线在世界里按 6 m 宽计，再换成屏幕像素；远近自适应但不写死像素。 */
export const OVERLAY_LINE_WIDTH_M = 6;
const LINE_MIN_PX = 1;
const LINE_MAX_PX = 8;

const SCENIC_URL = '/basemap/xihu-scenic-area.geojson';
const WATER_URL = '/basemap/xihu-water.geojson';

/**
 * 线宽（像素）：`pxPerMeter = (h/2) / (d · tan(fov/2))`，
 * `widthPx = clamp(1, 8, 6 m · pxPerMeter)`。d 取相机到叠加层中心的三维距离
 * ——俯视时相机在正上方，水平距离会误判成「贴近」，把线撑到最粗。
 */
export function researchOverlayLineWidthPx(distanceM: number, viewportHeightPx: number, fovRad: number): number {
  const d = Math.max(1, distanceM);
  const pxPerMeter = (viewportHeightPx / 2) / (d * Math.tan(fovRad / 2));
  return Math.min(LINE_MAX_PX, Math.max(LINE_MIN_PX, OVERLAY_LINE_WIDTH_M * pxPerMeter));
}

type Ring = number[][];
type PolygonRings = Ring[];
type GeoJson = {
  features: Array<{
    geometry:
      | { type: 'Polygon'; coordinates: PolygonRings }
      | { type: 'MultiPolygon'; coordinates: PolygonRings[] };
  }>;
};

function polygonsOf(geo: GeoJson): PolygonRings[] {
  return geo.features.flatMap(feature =>
    feature.geometry.type === 'MultiPolygon'
      ? feature.geometry.coordinates
      : [feature.geometry.coordinates],
  );
}

/** 环 → 世界点（x 向东、z 向南），y 统一压到叠加层高度。 */
function ringToWorld(layout: RoomLayout, ring: Ring, THREE: typeof import('three')): ThreeNS.Vector3[] {
  const points: ThreeNS.Vector3[] = [];
  for (const [lng, lat] of ring) {
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
    // OSM GeoJSON uses WGS84; the AMap image bounds and scene anchor use GCJ-02.
    const mapPoint = wgs84ToGcj02(lng, lat);
    const world = researchGeoToWorld(layout, mapPoint.lng, mapPoint.lat);
    if (!world) continue;
    points.push(new THREE.Vector3(world.x, RESEARCH_OVERLAY_Y, world.z));
  }
  return points;
}

type LineCtor = typeof import('three/addons/lines/Line2.js').Line2;
type LineGeometryCtor = typeof import('three/addons/lines/LineGeometry.js').LineGeometry;
type LineMaterialCtor = typeof import('three/addons/lines/LineMaterial.js').LineMaterial;

function makeLineMaterial(LineMaterial: LineMaterialCtor, color: number): InstanceType<LineMaterialCtor> {
  return new LineMaterial({
    color,
    linewidth: 2,
    worldUnits: false,
    transparent: true,
    opacity: 0.95,
    depthTest: true,
    depthWrite: false,
  });
}

function makeAdaptiveLine(
  THREE: typeof import('three'),
  Line2: LineCtor,
  LineGeometry: LineGeometryCtor,
  material: InstanceType<LineMaterialCtor>,
  points: ThreeNS.Vector3[],
  center: ThreeNS.Vector3,
  renderOrder: number,
): InstanceType<LineCtor> | null {
  if (points.length < 2) return null;
  const geometry = new LineGeometry();
  const flat: number[] = [];
  for (const p of points) flat.push(p.x, p.y, p.z);
  geometry.setPositions(flat);
  const line = new Line2(geometry, material);
  line.computeLineDistances();
  line.renderOrder = renderOrder;
  line.frustumCulled = false;
  const size = new THREE.Vector2();
  line.onBeforeRender = (
    renderer?: ThreeNS.WebGLRenderer,
    _scene?: ThreeNS.Scene,
    camera?: ThreeNS.Camera,
  ) => {
    if (!renderer || !camera) return;
    renderer.getDrawingBufferSize(size);
    const distance = Math.hypot(camera.position.x - center.x,
      camera.position.y - center.y - (line.parent?.position.y ?? 0), camera.position.z - center.z);
    const fovRad = 'fov' in camera ? (camera as ThreeNS.PerspectiveCamera).fov * Math.PI / 180 : Math.PI / 3;
    material.resolution.copy(size);
    material.linewidth = researchOverlayLineWidthPx(distance, size.y, fovRad);
  };
  return line;
}

export interface ResearchOverlayOptions {
  /** 图加载完成后重绘一帧。 */
  onLoaded?: () => void;
}

/** 拆掉旧的矢量层（连同几何体/材质）。 */
export function clearResearchOverlays(scene: ThreeNS.Scene): void {
  for (const child of [...scene.children]) {
    if (child.userData?.researchOverlay !== true) continue;
    scene.remove(child);
    child.traverse(object => {
      const mesh = object as ThreeNS.Mesh;
      mesh.geometry?.dispose?.();
      const material = mesh.material as ThreeNS.Material | ThreeNS.Material[] | undefined;
      if (Array.isArray(material)) material.forEach(item => item.dispose());
      else material?.dispose?.();
    });
  }
}

/**
 * 铺范围线与水面。异步拉两份 GeoJSON；失败就少一层，不挡底图。
 * 只有整景区静态预设才画——这两份数据是西湖专属的。
 */
export function buildResearchOverlays(
  THREE: typeof import('three'),
  scene: ThreeNS.Scene,
  layout: RoomLayout,
  options: ResearchOverlayOptions = {},
): () => void {
  clearResearchOverlays(scene);
  if (!layout.researchArea?.presetId) return () => {};
  if (!researchGeoToWorld(layout, layout.researchArea.center.lng, layout.researchArea.center.lat)) return () => {};
  const placement = researchBasemapPlacement(layout);
  if (!placement) return () => {};
  const center = new THREE.Vector3(placement.centerX, RESEARCH_OVERLAY_Y, placement.centerZ);

  const group = new THREE.Group();
  group.userData.type = RESEARCH_BASEMAP_TAG;
  group.userData.researchOverlay = true;
  group.position.y = (researchBasemapMesh(scene)?.position.y ?? RESEARCH_BASEMAP_Y) - RESEARCH_BASEMAP_Y;
  group.renderOrder = -9;
  scene.add(group);

  let disposed = false;
  void (async () => {
    const [{ Line2 }, { LineGeometry }, { LineMaterial }] = await Promise.all([
      import('three/addons/lines/Line2.js'),
      import('three/addons/lines/LineGeometry.js'),
      import('three/addons/lines/LineMaterial.js'),
    ]);
    if (disposed) return;
    const scenicMaterial = makeLineMaterial(LineMaterial, SCENIC_LINE_COLOR);
    const waterLineMaterial = makeLineMaterial(LineMaterial, WATER_LINE_COLOR);
    const waterFillMaterial = new THREE.MeshBasicMaterial({
      color: WATER_FILL_COLOR,
      transparent: true,
      opacity: WATER_FILL_OPACITY,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    const [scenic, water] = await Promise.all([
      fetch(SCENIC_URL).then(res => res.ok ? res.json() as Promise<GeoJson> : null).catch(() => null),
      fetch(WATER_URL).then(res => res.ok ? res.json() as Promise<GeoJson> : null).catch(() => null),
    ]);
    if (disposed) return;

    if (scenic) {
      for (const polygon of polygonsOf(scenic)) {
        for (const ring of polygon) {
          const line = makeAdaptiveLine(THREE, Line2, LineGeometry, scenicMaterial, ringToWorld(layout, ring, THREE), center, -9);
          if (line) group.add(line);
        }
      }
    }

    if (water) {
      for (const polygon of polygonsOf(water)) {
        const outer = polygon[0] ?? [];
        const worldOuter = ringToWorld(layout, outer, THREE);
        if (worldOuter.length >= 3) {
          // Shape 在 XY 平面：x 用世界 x，y 用 -world z；绕 X 转 -90° 后落到 XZ。
          const shape = new THREE.Shape(worldOuter.map(p => new THREE.Vector2(p.x, -p.z)));
          for (const holeRing of polygon.slice(1)) {
            const holePoints = ringToWorld(layout, holeRing, THREE);
            if (holePoints.length >= 3) shape.holes.push(new THREE.Path(holePoints.map(p => new THREE.Vector2(p.x, -p.z))));
          }
          const geometry = new THREE.ShapeGeometry(shape);
          const fill = new THREE.Mesh(geometry, waterFillMaterial);
          fill.rotation.x = -Math.PI / 2;
          fill.position.y = RESEARCH_OVERLAY_Y + 0.002;
          fill.renderOrder = -9;
          group.add(fill);
        }
        for (const ring of polygon) {
          const line = makeAdaptiveLine(THREE, Line2, LineGeometry, waterLineMaterial, ringToWorld(layout, ring, THREE), center, -9);
          if (line) group.add(line);
        }
      }
    }

    options.onLoaded?.();
  })().catch(() => {});

  return () => {
    disposed = true;
    clearResearchOverlays(scene);
  };
}
