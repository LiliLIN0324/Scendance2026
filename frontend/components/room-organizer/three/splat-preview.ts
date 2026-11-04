import * as THREE from 'three';
import { ROOM_OBJECT_TAGS } from './room-builder';
import { sampleSplatColors, rememberSceneSample } from './scene-lighting';
import { DEFAULT_GROUND_PLANE, groundFromHeight, groundHeightAt, type GroundAnchor, type GroundPlane } from '../lib/site-capture';
import { computeScanFit, rotatedBox } from './scan-placement';
import type { SplatMesh, SparkRenderer } from '@sparkjsdev/spark';

/** Aholo World 的 3DGS 竖直轴；上游不给时按它给的 Z-up 立起来。 */
export type SplatUpAxis = 'X' | 'Y' | 'Z';
/** 本机稳定地址（`/asset/<uuid>.spz`）：Spark 按后缀认格式，所以不用再传类型。 */
export type SplatMeters = Readonly<{ width: number; depth: number; height: number }>;
/**
 * 落地后的真实米制水平边界：第一人称漫游用它代替场地 footprint 围栏，
 * 让人在点云里走扫描出来的实际空间，而不是布置区那 12×9 米。
 */
export type SplatWalkBounds = Readonly<{ minX: number; maxX: number; minZ: number; maxZ: number; minY: number }>;
export type SplatSource = Readonly<{ assetId: string; url: string; name: string; meters?: SplatMeters }>;
export type SplatPosition = Readonly<{ x: number; y: number; z: number }>;
export type SplatDisplayMode = 'gaussian' | 'footprint';
/** Whole-scene move: gizmo shows XYZ axes; numeric keeps the panel only. */
export type SplatTransformMode = 'off' | 'gizmo' | 'numeric';
/**
 * 手动标定结果：扫描米 → 真实米的倍数、绕世界 Y 的朝向，以及物件落地用的基准面与锚点。
 * 默认比例 1、朝向 0，表示沿用上游的真实米制。
 */
export type SplatCalibration = Readonly<{
  scale?: number;
  yawDeg?: number;
  /** 扫描原点相对场地原点的水平平移，米。 */
  origin?: { x: number; z: number };
  ground?: GroundPlane;
  anchors?: readonly GroundAnchor[];
}>;
export type SplatLoadOptions = Readonly<{
  /** 场地最长水平边（米）：无真实尺度时的兜底——点云按它等比缩放。 */
  sizeMeters: number;
  upAxis?: SplatUpAxis;
  /** Hide scanned splats above the active storey's ceiling (world metres). */
  roofCutoffY?: number;
  position?: SplatPosition;
  /** 手动标定：尺度 / 朝向 / 基准面 / 锚点；随场景持久化，重开直接复原。 */
  calibration?: SplatCalibration;
  onProgress?(ratio: number | undefined): void;
}>;
export type SplatFit = Readonly<{ scale: number; position: THREE.Vector3 }>;
export type SplatPaint = (renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) => void;


const EPSILON = 0.000001;

/** 离群 / 超大 splat 会把包围盒撑到几公里外：只按两端分位数取「实际内容」的范围。 */
export function percentile(values: readonly number[], ratio: number): number | undefined {
  if (!values.length) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(ratio * (sorted.length - 1))))];
}

/** 从采样的 splat 中心点算稳健包围盒；centers 必须是原始（未旋转）坐标。 */
export function robustBox(centers: readonly THREE.Vector3[], ratio = 0.01): THREE.Box3 | null {
  if (!centers.length) return null;
  const axis = (pick: (vector: THREE.Vector3) => number) => centers.map(pick);
  const at = (pick: (vector: THREE.Vector3) => number, quantile: number) => percentile(axis(pick), quantile) ?? 0;
  const min = new THREE.Vector3(at(v => v.x, ratio), at(v => v.y, ratio), at(v => v.z, ratio));
  const max = new THREE.Vector3(at(v => v.x, 1 - ratio), at(v => v.y, 1 - ratio), at(v => v.z, 1 - ratio));
  // 贴地的一片点云在某个轴上本来就是零厚度，那不算「没有盒子」；缩放那一步才真的用得上。
  return [min, max].every(point => Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.z)) &&
    max.x >= min.x && max.y >= min.y && max.z >= min.z ? new THREE.Box3(min, max) : null;
}

/** 绕竖直轴归正：Z-up 的扫描绕 X 转 -90° 才和布置图一样是 Y 朝上。 */
export function upAxisQuaternion(upAxis: SplatUpAxis): THREE.Quaternion {
  const euler = upAxis === 'Z' ? new THREE.Euler(-Math.PI / 2, 0, 0) :
    upAxis === 'X' ? new THREE.Euler(0, 0, Math.PI / 2) : new THREE.Euler(0, 0, 0);
  return new THREE.Quaternion().setFromEuler(euler);
}

export { rotatedBox } from './scan-placement';

/** 把旋转后的点云按场地最长水平边等比缩放，底面贴到 y=0、水平中心对到原点。 */
export function fitSplatBox(box: THREE.Box3, sizeMeters: number): SplatFit {
  const size = box.getSize(new THREE.Vector3());
  const horizontal = Math.max(size.x, size.z);
  const scale = sizeMeters > 0 && horizontal > EPSILON ? sizeMeters / horizontal : 1;
  const center = box.getCenter(new THREE.Vector3());
  return { scale, position: new THREE.Vector3(-center.x * scale, -box.min.y * scale, -center.z * scale) };
}

/** 把落地后的包围盒折成漫游边界；退化盒（薄片 / 空点云）退回 null，让调用方保留旧围栏。 */
export function walkBoundsOf(box: THREE.Box3): SplatWalkBounds | null {
  const size = box.getSize(new THREE.Vector3());
  if (!(size.x > EPSILON) || !(size.z > EPSILON)) return null;
  return Object.freeze({ minX: box.min.x, maxX: box.max.x, minZ: box.min.z, maxZ: box.max.z, minY: box.min.y });
}

export type SplatOrbit = { target: THREE.Vector3; enabled: boolean; update(): void };

/**
 * 预览机位：站在场景里、离地 1.6 m 看过去，而不是从场外看一块悬空的地板。
 * 落点被夹在点云内部，避免一进来就穿到墙外。
 */
export function frameSplatView(bounds: THREE.Box3, eyeHeight = 1.6, azimuthDeg = 126):
  Readonly<{ position: THREE.Vector3; target: THREE.Vector3 }> {
  const size = bounds.getSize(new THREE.Vector3());
  const center = bounds.getCenter(new THREE.Vector3());
  const target = new THREE.Vector3(center.x, bounds.min.y + Math.min(1.3, size.y * 0.4), center.z);
  const distance = Math.max(size.x, size.z) * 0.5;
  const azimuth = THREE.MathUtils.degToRad(azimuthDeg);
  const desired = new THREE.Vector3(
    target.x + Math.sin(azimuth) * distance, bounds.min.y + eyeHeight, target.z + Math.cos(azimuth) * distance
  );
  const inset = new THREE.Vector3(size.x, size.y, size.z).multiplyScalar(0.06);
  const floorPad = Math.max(inset.y, size.y * 0.15);
  return {
    target,
    position: new THREE.Vector3(
      THREE.MathUtils.clamp(desired.x, bounds.min.x + inset.x, bounds.max.x - inset.x),
      THREE.MathUtils.clamp(desired.y, bounds.min.y + floorPad, bounds.max.y - Math.max(inset.y, size.y * 0.06)),
      THREE.MathUtils.clamp(desired.z, bounds.min.z + inset.z, bounds.max.z - inset.z)
    ),
  };
}

function sampleCenters(splat: SplatMesh, maxSamples = 20000): THREE.Vector3[] {
  const step = Math.max(1, Math.floor((splat.numSplats ?? 0) / maxSamples));
  const centers: THREE.Vector3[] = [];
  splat.forEachSplat((index, center) => {
    if (index % step === 0) centers.push(center.clone());
  });
  return centers;
}

type FootprintLoop = Array<{ x: number; z: number }>;

function footprintContains(outline: readonly { x: number; z: number }[], x: number, z: number): boolean {
  let inside = false;
  for (let index = 0, previous = outline.length - 1; index < outline.length; previous = index++) {
    const a = outline[index]!, b = outline[previous]!;
    if ((a.z > z) !== (b.z > z) && x < (b.x - a.x) * (z - a.z) / (b.z - a.z) + a.x) inside = !inside;
  }
  return inside;
}

/**
 * Infer the footprint by projecting the complete scanned volume vertically
 * onto the floor plane. Using the whole volume keeps a missing floor patch
 * from carving a false notch into the venue outline; raster closing bridges
 * splat gaps while tracing still preserves diagonal and concave boundaries.
 */
function inferFloorOutline(box: THREE.Box3, projectedPoints: readonly THREE.Vector3[], cellSize = 0.25): FootprintLoop | null {
  const size = box.getSize(new THREE.Vector3());
  const columns = Math.ceil(size.x / cellSize);
  const rows = Math.ceil(size.z / cellSize);
  if (columns < 3 || rows < 3 || columns * rows > 200_000 || projectedPoints.length < 80) return null;
  const indexOf = (x: number, z: number) => z * columns + x;
  const mask = new Uint8Array(columns * rows);
  for (const point of projectedPoints) {
    const x = Math.floor((point.x - box.min.x) / cellSize);
    const z = Math.floor((point.z - box.min.z) / cellSize);
    if (x >= 0 && z >= 0 && x < columns && z < rows) mask[indexOf(x, z)] = 1;
  }

  // Dilate then erode with the same disk: bridge small scan gaps without
  // systematically growing the whole footprint outward.
  const expanded = new Uint8Array(mask.length);
  for (let z = 0; z < rows; z++) for (let x = 0; x < columns; x++) {
    if (!mask[indexOf(x, z)]) continue;
    for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) {
      if (dx * dx + dz * dz > 5) continue;
      const nx = x + dx, nz = z + dz;
      if (nx >= 0 && nz >= 0 && nx < columns && nz < rows) expanded[indexOf(nx, nz)] = 1;
    }
  }
  const closed = new Uint8Array(mask.length);
  for (let z = 0; z < rows; z++) for (let x = 0; x < columns; x++) {
    let all = true;
    for (let dz = -2; dz <= 2 && all; dz++) for (let dx = -2; dx <= 2; dx++) {
      if (dx * dx + dz * dz > 5) continue;
      const nx = x + dx, nz = z + dz;
      if (nx >= 0 && nz >= 0 && nx < columns && nz < rows && !expanded[indexOf(nx, nz)]) { all = false; break; }
    }
    if (all) closed[indexOf(x, z)] = 1;
  }

  // Discard isolated furniture footprints; keep the dominant connected floor region.
  const seen = new Uint8Array(closed.length);
  let largest: number[] = [];
  for (let start = 0; start < closed.length; start++) {
    if (!closed[start] || seen[start]) continue;
    const component: number[] = [];
    const queue = [start]; seen[start] = 1;
    for (let cursor = 0; cursor < queue.length; cursor++) {
      const current = queue[cursor]!; component.push(current);
      const x = current % columns, z = Math.floor(current / columns);
      for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, nz = z + dz;
        if (nx < 0 || nz < 0 || nx >= columns || nz >= rows) continue;
        const next = indexOf(nx, nz);
        if (closed[next] && !seen[next]) { seen[next] = 1; queue.push(next); }
      }
    }
    if (component.length > largest.length) largest = component;
  }
  if (largest.length < columns * rows * 0.03) return null;
  const floorMask = new Uint8Array(closed.length);
  for (const cell of largest) floorMask[cell] = 1;

  // Fill enclosed holes so furniture-free floor areas remain walkable.
  const outside = new Uint8Array(floorMask.length);
  const queue: number[] = [];
  const addOutside = (x: number, z: number) => {
    const id = indexOf(x, z);
    if (!floorMask[id] && !outside[id]) { outside[id] = 1; queue.push(id); }
  };
  for (let x = 0; x < columns; x++) { addOutside(x, 0); addOutside(x, rows - 1); }
  for (let z = 0; z < rows; z++) { addOutside(0, z); addOutside(columns - 1, z); }
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const current = queue[cursor]!;
    const x = current % columns, z = Math.floor(current / columns);
    if (x > 0) addOutside(x - 1, z);
    if (x + 1 < columns) addOutside(x + 1, z);
    if (z > 0) addOutside(x, z - 1);
    if (z + 1 < rows) addOutside(x, z + 1);
  }
  for (let id = 0; id < floorMask.length; id++) if (!outside[id]) floorMask[id] = 1;

  // Trace the dominant component's exposed cell edges into one closed loop.
  const edges: Array<{ a: number; b: number }> = [];
  const vertexId = (x: number, z: number) => z * (columns + 1) + x;
  for (let z = 0; z < rows; z++) for (let x = 0; x < columns; x++) {
    if (!floorMask[indexOf(x, z)]) continue;
    if (z === 0 || !floorMask[indexOf(x, z - 1)]) edges.push({ a: vertexId(x, z), b: vertexId(x + 1, z) });
    if (x === columns - 1 || !floorMask[indexOf(x + 1, z)]) edges.push({ a: vertexId(x + 1, z), b: vertexId(x + 1, z + 1) });
    if (z === rows - 1 || !floorMask[indexOf(x, z + 1)]) edges.push({ a: vertexId(x + 1, z + 1), b: vertexId(x, z + 1) });
    if (x === 0 || !floorMask[indexOf(x - 1, z)]) edges.push({ a: vertexId(x, z + 1), b: vertexId(x, z) });
  }
  const outgoing = new Map<number, number[]>();
  for (const edge of edges) outgoing.set(edge.a, [...(outgoing.get(edge.a) ?? []), edge.b]);
  if (!edges.length) return null;
  const first = edges[0]!.a;
  const loop = [first];
  let current = first;
  for (let guard = 0; guard <= edges.length; guard++) {
    const next = outgoing.get(current)?.pop();
    if (next === undefined) return null;
    if (next === first) break;
    loop.push(next); current = next;
  }
  if (loop.length < 3 || current === first) return null;
  // Remove collinear grid steps, then simplify the raster stair-steps into straight diagonal walls.
  const corners = loop.filter((id, index) => {
    const before = loop[(index + loop.length - 1) % loop.length]!;
    const after = loop[(index + 1) % loop.length]!;
    const ax = before % (columns + 1), az = Math.floor(before / (columns + 1));
    const bx = id % (columns + 1), bz = Math.floor(id / (columns + 1));
    const cx = after % (columns + 1), cz = Math.floor(after / (columns + 1));
    return (bx - ax) * (cz - bz) !== (bz - az) * (cx - bx);
  });
  const points = corners.map(id => ({ x: (id % (columns + 1)) * cellSize, z: Math.floor(id / (columns + 1)) * cellSize }));
  const pointToSegment = (point: { x: number; z: number }, a: { x: number; z: number }, b: { x: number; z: number }) => {
    const dx = b.x - a.x, dz = b.z - a.z;
    const lengthSquared = dx * dx + dz * dz;
    if (lengthSquared < EPSILON) return Math.hypot(point.x - a.x, point.z - a.z);
    const t = THREE.MathUtils.clamp(((point.x - a.x) * dx + (point.z - a.z) * dz) / lengthSquared, 0, 1);
    return Math.hypot(point.x - (a.x + t * dx), point.z - (a.z + t * dz));
  };
  // Remove scan-noise dents while retaining features larger than the local
  // smoothing scale (about 0.4–0.8 m depending on venue size).
  const smoothingTolerance = Math.min(0.8, Math.max(0.4, Math.max(size.x, size.z) * 0.018));
  let changed = true;
  while (changed && points.length > 4) {
    changed = false;
    for (let index = 0; index < points.length; index++) {
      const previous = points[(index + points.length - 1) % points.length]!;
      const current = points[index]!;
      const next = points[(index + 1) % points.length]!;
      if (pointToSegment(current, previous, next) <= smoothingTolerance) {
        points.splice(index, 1);
        changed = true;
        break;
      }
    }
  }
  return points;
}

/** Sparse scans can defeat the raster contour; fall back to the projected cloud's convex silhouette, never an AABB. */
function projectedVolumeHull(box: THREE.Box3, projectedPoints: readonly THREE.Vector3[]): FootprintLoop | null {
  if (projectedPoints.length < 3) return null;
  const sortedX = projectedPoints.map(point => point.x - box.min.x).sort((a, b) => a - b);
  const sortedZ = projectedPoints.map(point => point.z - box.min.z).sort((a, b) => a - b);
  const low = Math.floor((projectedPoints.length - 1) * 0.002);
  const high = Math.ceil((projectedPoints.length - 1) * 0.998);
  const minX = sortedX[low]!, maxX = sortedX[high]!;
  const minZ = sortedZ[low]!, maxZ = sortedZ[high]!;
  const points = projectedPoints
    .map(point => ({ x: point.x - box.min.x, z: point.z - box.min.z }))
    .filter(point => point.x >= minX && point.x <= maxX && point.z >= minZ && point.z <= maxZ)
    .sort((a, b) => a.x - b.x || a.z - b.z);
  const cross = (origin: { x: number; z: number }, a: { x: number; z: number }, b: { x: number; z: number }) =>
    (a.x - origin.x) * (b.z - origin.z) - (a.z - origin.z) * (b.x - origin.x);
  const lower: Array<{ x: number; z: number }> = [];
  for (const point of points) {
    while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, point) <= 0) lower.pop();
    lower.push(point);
  }
  const upper: Array<{ x: number; z: number }> = [];
  for (let index = points.length - 1; index >= 0; index--) {
    const point = points[index]!;
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, point) <= 0) upper.pop();
    upper.push(point);
  }
  lower.pop(); upper.pop();
  const hull = [...lower, ...upper];
  return hull.length >= 3 ? hull : null;
}

/**
 * 先画背景那条渲染栈，再把布置场景叠在同一次画布上：点云从此只是环境，不参与拾取，
 * 也不会被墙体剖切那种「每帧改 visible」的逻辑波及。场地壳体只在这两趟之间按原值藏起，
 * 画完逐条还原，所以退出预览时墙面切法还是用户自己定的那一套。
 */
export function paintAsBackLayer(deps: {
  renderer: THREE.WebGLRenderer;
  back: THREE.Scene;
  scene: THREE.Scene;
  camera: THREE.Camera;
}): void {
  paintSplatLayers({ ...deps, backs: [deps.back] });
}

/** Draw each Gaussian back layer, then the shared editable layout once. */
export function paintSplatLayers(deps: {
  renderer: THREE.WebGLRenderer;
  backs: readonly THREE.Scene[];
  scene: THREE.Scene;
  camera: THREE.Camera;
}): void {
  const { renderer, backs, scene, camera } = deps;
  if (!backs.length) { renderer.render(scene, camera); return; }
  const hidden: Array<[THREE.Object3D, boolean]> = [];
  for (const child of scene.children) {
    if (child.userData.type !== ROOM_OBJECT_TAGS.Floor && child.userData.type !== ROOM_OBJECT_TAGS.Wall) continue;
    hidden.push([child, child.visible]);
    child.visible = false;
  }
  // 天空属于背景那一层：临时挪到点云场景，免得点云没盖到的地方露出纯黑。
  const sky = scene.background;
  scene.background = null;
  for (let index = 0; index < backs.length; index++) {
    const back = backs[index]!;
    back.background = index === 0 ? sky : null;
    renderer.autoClear = index === 0;
    renderer.render(back, camera);
    back.background = null;
  }
  renderer.autoClear = false;
  renderer.render(scene, camera);
  renderer.autoClear = true;
  scene.background = sky;
  for (const [child, visible] of hidden) child.visible = visible;
}
/**
 * 3DGS 环境预览：点云待在自己的一条渲染栈里（自己的 Scene + 自己的 SparkRenderer），
 * 每帧用 paintAsBackLayer 把它铺在布置场景底下。相机、轨道控制器与拾取全部沿用现有的那套，
 * 所以转视角时点云和物料始终对得上，而点云本身一件都点不着。
 */
export function createSplatPreview(deps: {
  renderer: THREE.WebGLRenderer;
  camera: THREE.PerspectiveCamera;
  orbitControls: SplatOrbit;
  invalidate(): void;
  onPositionChange?(position: SplatPosition): void;
}) {
  const sparkPromise = import('@sparkjsdev/spark');
  const splatScene = new THREE.Scene();
  let spark: SparkRenderer | null = null;
  let holder: THREE.Group | null = null;
  let mesh: SplatMesh | null = null;
  let roofCutoff: { value: number; uniform: { value: number } } | null = null;
  let basePosition = new THREE.Vector3();
  const currentOffset = new THREE.Vector3();
  let transformControls: import('three/addons/controls/TransformControls.js').TransformControls | null = null;
  let transformHelper: THREE.Object3D | null = null;
  let transformMode: SplatTransformMode = 'off';
  let displayMode: SplatDisplayMode = 'gaussian';
  let sceneVisible = true;
  // 高斯场地自己的地面（按点云实测 footprint，而不是矢量壳那 12×9 米）。
  let ground: THREE.Group | null = null;
  let groundOutline: FootprintLoop | null = null;
  // 标定产生的极淡基准面 / 锚点 / 地面遮挡代理：与 footprint 一起随场景平移。
  let referencePlane: THREE.Group | null = null;
  let anchorMarkers: THREE.Group | null = null;
  let occlusionProxy: THREE.Group | null = null;
  // 点云摆好之后在世界里的占位，用来把相机框进场景内。
  let bounds: THREE.Box3 | null = null;
  // 原始局部盒 / 采样点 / 竖直轴修正：标定改比例或朝向时，就地重算，不重新解码点云。
  let localBox: THREE.Box3 | null = null;
  let localCenters: THREE.Vector3[] = [];
  let upQuaternion = new THREE.Quaternion();
  // 当前生效的标定：默认 1:1 米制、水平基准面、无锚点。
  let calibration: Required<SplatCalibration> = {
    scale: 1,
    yawDeg: 0,
    origin: { x: 0, z: 0 },
    ground: { ...DEFAULT_GROUND_PLANE },
    anchors: [],
  };
  let savedView: Readonly<{ position: THREE.Vector3; target: THREE.Vector3 }> | null = null;
  // 正在显示的场景号：空字符串就是预览关闭，渲染循环每帧只认这一个判据。
  let shownId = '';
  // 一次只认最后一次请求：还在下载时又点了别的场景，先完成的那条要自己丢掉。
  let generation = 0;
  let disposed = false;

  function releaseTransformControls() {
    if (!transformControls) return;
    deps.orbitControls.enabled = true;
    transformControls.detach();
    transformControls.dispose();
    transformHelper?.removeFromParent();
    transformControls = null;
    transformHelper = null;
  }

  function releaseMesh() {
    holder?.removeFromParent();
    mesh?.dispose();
    holder = null;
    mesh = null;
    roofCutoff = null;
    localBox = null;
    localCenters = [];
    transformControls?.detach();
    releaseGround();
    releaseOverlays();
  }

  function releaseGround() {
    if (!ground) return;
    ground.removeFromParent();
    ground.traverse(object => {
      const line = object as THREE.LineSegments;
      line.geometry?.dispose?.();
      const material = line.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(material)) material.forEach(entry => entry.dispose());
      else material?.dispose?.();
    });
    ground = null;
    groundOutline = null;
  }

  function disposeGroup(group: THREE.Group | null): null {
    if (!group) return null;
    group.removeFromParent();
    group.traverse(object => {
      const meshLike = object as THREE.Mesh;
      meshLike.geometry?.dispose?.();
      const material = meshLike.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(material)) material.forEach(entry => entry.dispose());
      else material?.dispose?.();
    });
    return null;
  }

  function releaseOverlays() {
    referencePlane = disposeGroup(referencePlane);
    anchorMarkers = disposeGroup(anchorMarkers);
    occlusionProxy = disposeGroup(occlusionProxy);
  }

  /** 标定输入只接受有限值，越界就退回默认，别让脏数据把场景撑飞。 */
  function sanitizeCalibration(input: SplatCalibration | undefined): Required<SplatCalibration> {
    const rawScale = input?.scale;
    const scale = typeof rawScale === 'number' && Number.isFinite(rawScale) && rawScale >= 0.2 && rawScale <= 20
      ? rawScale
      : 1;
    const rawYaw = input?.yawDeg;
    const yawDeg = typeof rawYaw === 'number' && Number.isFinite(rawYaw) ? ((rawYaw % 360) + 360) % 360 : 0;
    const origin = {
      x: typeof input?.origin?.x === 'number' && Number.isFinite(input.origin.x) ? input.origin.x : 0,
      z: typeof input?.origin?.z === 'number' && Number.isFinite(input.origin.z) ? input.origin.z : 0,
    };
    const rawGround = input?.ground;
    const ground: GroundPlane = rawGround && Number.isFinite(rawGround.y)
      ? groundFromHeight(rawGround.y, rawGround.normal ?? DEFAULT_GROUND_PLANE.normal)
      : { y: DEFAULT_GROUND_PLANE.y, normal: { ...DEFAULT_GROUND_PLANE.normal }, definedBy: 'height' };
    const anchors = (input?.anchors ?? [])
      .filter(anchor => Number.isFinite(anchor.x) && Number.isFinite(anchor.z))
      .slice(0, 24)
      .map(anchor => ({ ...anchor }));
    return { scale, yawDeg, origin, ground, anchors };
  }

  /** 高斯场景自带的地面：按整个扫描体积的俯视投影裁切，保留斜边与凹口。 */
  function buildGround(box: THREE.Box3, projectedPoints: readonly THREE.Vector3[]) {
    releaseGround();
    const size = box.getSize(new THREE.Vector3());
    if (!(size.x > EPSILON) || !(size.z > EPSILON)) return;
    const outline = inferFloorOutline(box, projectedPoints) ?? projectedVolumeHull(box, projectedPoints);
    // No rectangular bounds fallback: an unknown footprint must stay unknown
    // instead of drawing a misleading box around the venue.
    if (!outline) return;
    const group = new THREE.Group();
    group.userData.type = 'splat-ground';
    const contains = (x: number, z: number) => footprintContains(outline, x, z);
    const plane = new THREE.Mesh(
      new THREE.ShapeGeometry((() => {
        const shape = new THREE.Shape();
        shape.moveTo(outline[0]!.x, -outline[0]!.z);
        for (const point of outline.slice(1)) shape.lineTo(point.x, -point.z);
        shape.closePath();
        return shape;
      })()),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.05, depthWrite: false, side: THREE.DoubleSide })
    );
    plane.rotation.x = -Math.PI / 2;
    plane.position.set(0, 0.002, 0);
    plane.renderOrder = -1;
    group.add(plane);
    const points: number[] = [];
    const gridStep = 1;
    const sampleStep = 0.12;
    for (let x = 0; x <= size.x + EPSILON; x += gridStep) {
      for (let z = 0; z < size.z; z += sampleStep) if (contains(x, z) && contains(x, Math.min(size.z, z + sampleStep))) {
        points.push(x, 0.004, z, x, 0.004, Math.min(size.z, z + sampleStep));
      }
    }
    for (let z = 0; z <= size.z + EPSILON; z += gridStep) {
      for (let x = 0; x < size.x; x += sampleStep) if (contains(x, z) && contains(Math.min(size.x, x + sampleStep), z)) {
        points.push(x, 0.004, z, Math.min(size.x, x + sampleStep), 0.004, z);
      }
    }
    const gridGeometry = new THREE.BufferGeometry();
    gridGeometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
    const grid = new THREE.LineSegments(
      gridGeometry,
      new THREE.LineBasicMaterial({ color: 0x9aa0aa, transparent: true, opacity: 0.26, depthWrite: false })
    );
    grid.renderOrder = -1;
    group.add(grid);
    const edgePoints: number[] = [];
    for (let index = 0; index < outline.length; index++) {
      const point = outline[index]!, next = outline[(index + 1) % outline.length]!;
      edgePoints.push(point.x, 0.006, point.z, next.x, 0.006, next.z);
    }
    const edgeGeometry = new THREE.BufferGeometry();
    edgeGeometry.setAttribute('position', new THREE.Float32BufferAttribute(edgePoints, 3));
    group.add(new THREE.LineSegments(edgeGeometry, new THREE.LineBasicMaterial({ color: 0x665343, transparent: true, opacity: 0.88 })));
    group.position.set(box.min.x, box.min.y, box.min.z);
    ground = group;
    groundOutline = outline;
    splatScene.add(group);
  }

  /** 基准面形状：有实测 footprint 就跟着它走，没有才退回包围盒矩形。 */
  function groundShapeGeometry(box: THREE.Box3): THREE.BufferGeometry {
    const size = box.getSize(new THREE.Vector3());
    if (groundOutline) {
      const shape = new THREE.Shape();
      shape.moveTo(groundOutline[0]!.x, -groundOutline[0]!.z);
      for (const point of groundOutline.slice(1)) shape.lineTo(point.x, -point.z);
      shape.closePath();
      return new THREE.ShapeGeometry(shape);
    }
    const shape = new THREE.Shape();
    shape.moveTo(0, 0);
    shape.lineTo(size.x, 0);
    shape.lineTo(size.x, -size.z);
    shape.lineTo(0, -size.z);
    shape.closePath();
    return new THREE.ShapeGeometry(shape);
  }

  /**
   * 把一张 XZ 平面挂到基准面上：外壳负责位置与倾斜，内层负责把几何从 XY 转到 XZ。
   * 水平面时外壳就是 y = 基准面高度；三点定面时外壳法线跟着走。
   */
  function groundPlaneGroup(box: THREE.Box3, lift: number): THREE.Group {
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const outer = new THREE.Group();
    outer.position.set(center.x, groundHeightAt(calibration.ground, center.x, center.z), center.z);
    outer.quaternion.setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(calibration.ground.normal.x, calibration.ground.normal.y, calibration.ground.normal.z).normalize(),
    );
    const inner = new THREE.Group();
    inner.rotation.x = -Math.PI / 2;
    inner.position.set(-size.x / 2, lift, -size.z / 2);
    outer.add(inner);
    return outer;
  }

  /**
   * 极淡的基准面参考：只给“地在哪里”一个视觉锚，强度刻意低于 2D 网格，
   * 不与点云里真实的桌面、舞台抢注意力。
   */
  function buildReference(box: THREE.Box3) {
    referencePlane = disposeGroup(referencePlane);
    const size = box.getSize(new THREE.Vector3());
    if (!(size.x > EPSILON) || !(size.z > EPSILON)) return;
    const group = groundPlaneGroup(box, 0.006);
    group.userData.type = 'splat-reference-plane';
    const inner = group.children[0] as THREE.Group;
    const plane = new THREE.Mesh(
      groundShapeGeometry(box),
      new THREE.MeshBasicMaterial({ color: 0x7d8f7a, transparent: true, opacity: 0.035, depthWrite: false, side: THREE.DoubleSide }),
    );
    plane.renderOrder = -3;
    inner.add(plane);
    const points: number[] = [];
    const step = 2;
    const sample = 0.2;
    const contains = (x: number, z: number) => !groundOutline || footprintContains(groundOutline, x, z);
    for (let x = 0; x <= size.x + EPSILON; x += step) {
      for (let z = 0; z < size.z; z += sample) if (contains(x, z) && contains(x, Math.min(size.z, z + sample))) {
        points.push(x, -z, 0.008, x, -Math.min(size.z, z + sample), 0.008);
      }
    }
    for (let z = 0; z <= size.z + EPSILON; z += step) {
      for (let x = 0; x < size.x; x += sample) if (contains(x, z) && contains(Math.min(size.x, x + sample), z)) {
        points.push(x, -z, 0.008, Math.min(size.x, x + sample), -z, 0.008);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
    const grid = new THREE.LineSegments(
      geometry,
      new THREE.LineBasicMaterial({ color: 0x8a9c86, transparent: true, opacity: 0.1, depthWrite: false }),
    );
    grid.renderOrder = -3;
    inner.add(grid);
    referencePlane = group;
    splatScene.add(group);
  }

  /** 锚点：贴基准面的小圆环 + 一根短竖杆，给“舞台位 / 入口”一个可被看见的落点。 */
  function buildAnchors(box: THREE.Box3) {
    anchorMarkers = disposeGroup(anchorMarkers);
    if (!calibration.anchors.length) return;
    const group = new THREE.Group();
    group.userData.type = 'splat-anchors';
    group.position.set(box.min.x, box.min.y, box.min.z);
    const ringMaterial = new THREE.MeshBasicMaterial({
      color: 0x4f7a5c, transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide,
    });
    const mastMaterial = new THREE.LineBasicMaterial({ color: 0x4f7a5c, transparent: true, opacity: 0.28, depthWrite: false });
    for (const anchor of calibration.anchors) {
      const y = groundHeightAt(calibration.ground, anchor.x, anchor.z) - box.min.y + 0.015;
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.28, 0.36, 24), ringMaterial.clone());
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(anchor.x - box.min.x, y, anchor.z - box.min.z);
      ring.renderOrder = -2;
      ring.userData.type = 'splat-anchor';
      ring.userData.anchorId = anchor.id;
      group.add(ring);
      const mast = new THREE.LineSegments(
        new THREE.BufferGeometry().setFromPoints([
          new THREE.Vector3(anchor.x - box.min.x, y, anchor.z - box.min.z),
          new THREE.Vector3(anchor.x - box.min.x, y + 1.1, anchor.z - box.min.z),
        ]),
        mastMaterial.clone(),
      );
      mast.renderOrder = -2;
      group.add(mast);
    }
    anchorMarkers = group;
    splatScene.add(group);
  }

  /**
   * 地面遮挡代理：3DGS 不写深度，物料一旦掉到地面以下就会“穿”进点云地板里。
   * 用一张只写深度、不写颜色的水平面兜住：点云照常画（先画），
   * 之后画的布置物件只要在面下方就会被深度测试挡掉。
   */
  function buildOcclusionProxy(box: THREE.Box3) {
    occlusionProxy = disposeGroup(occlusionProxy);
    const size = box.getSize(new THREE.Vector3());
    if (!(size.x > EPSILON) || !(size.z > EPSILON)) return;
    const group = groundPlaneGroup(box, 0);
    group.userData.type = 'splat-occlusion-proxy';
    const inner = group.children[0] as THREE.Group;
    const proxy = new THREE.Mesh(groundShapeGeometry(box), new THREE.MeshBasicMaterial({
      colorWrite: false,
      depthWrite: true,
      depthTest: true,
      transparent: false,
      side: THREE.DoubleSide,
    }));
    proxy.renderOrder = 1000;
    inner.add(proxy);
    occlusionProxy = group;
    splatScene.add(group);
  }

  /** 按当前标定重新落位点云，并重建地面 / 基准面 / 锚点 / 遮挡代理；不重新解码。 */
  function placeSplat(): THREE.Box3 | null {
    if (!holder || !mesh || !localBox) return null;
    // 竖直轴校正 → 朝向 → 基准面倾斜；旋转作用在点云本身。
    const fit = computeScanFit(localBox, upQuaternion, calibration);
    const { quaternion, scale } = fit;
    const fitPosition = fit.position;
    const rotated = rotatedBox(localBox, quaternion);
    mesh.quaternion.copy(quaternion);
    basePosition.copy(fitPosition);
    holder.scale.setScalar(scale);
    holder.position.copy(fitPosition).add(currentOffset);
    bounds = new THREE.Box3(
      rotated.min.clone().multiplyScalar(scale).add(fitPosition).add(currentOffset),
      rotated.max.clone().multiplyScalar(scale).add(fitPosition).add(currentOffset),
    );
    const projectedPoints = localCenters.map(point =>
      point.clone().applyQuaternion(quaternion).multiplyScalar(scale).add(fitPosition).add(currentOffset)
    );
    buildGround(bounds, projectedPoints);
    buildReference(bounds);
    buildAnchors(bounds);
    buildOcclusionProxy(bounds);
    return bounds;
  }

  function translateOverlays(delta: THREE.Vector3) {
    ground?.position.add(delta);
    referencePlane?.position.add(delta);
    anchorMarkers?.position.add(delta);
    occlusionProxy?.position.add(delta);
  }

  async function load(source: SplatSource, options: SplatLoadOptions): Promise<Readonly<{ splats: number; meters: SplatMeters; walkBounds: SplatWalkBounds | null }>> {
    if (disposed) throw new Error('环境预览已关闭。');
    const sparkModule = await sparkPromise;
    if (disposed) throw new Error('环境预览已关闭。');
    const pending = ++generation;
    releaseMesh();
    if (!spark) {
      spark = new sparkModule.SparkRenderer({ renderer: deps.renderer });
      // 排序在工作线程里完成后才生效，render-on-demand 的循环得被它唤醒一次。
      spark.onDirty = () => deps.invalidate();
      splatScene.add(spark);
    }
    const next = new sparkModule.SplatMesh({
      url: source.url,
      onProgress: event => {
        if (generation !== pending) return;
        const ratio = event.total > 0 ? event.loaded / event.total : Number.NaN;
        options.onProgress?.(Number.isFinite(ratio) ? Math.min(1, Math.max(0, ratio)) : undefined);
      },
    });
    try {
      await next.initialized;
    } catch {
      next.dispose();
      throw new Error('无法解码这个 3DGS 场景，可能文件已损坏或不是场景产物。');
    }
    if (disposed || generation !== pending) {
      next.dispose();
      throw new Error('环境预览请求已过期，请重试。');
    }
    // 3DGS scans include their real ceiling/roof. A Spark world modifier
    // discards centers above the selected storey's ceiling in the GPU path.
    // Keep the cutoff uniform live so changing floors never decodes the scan again.
    const dyno = sparkModule.dyno;
    const cutoffUniform = new dyno.DynoFloat({ key: 'storeyRoofCutoffY', value: options.roofCutoffY ?? 3 });
    const cutModifier = dyno.dynoBlock(
      { gsplat: dyno.Gsplat }, { gsplat: dyno.Gsplat },
      inputs => {
        const parts = new dyno.SplitGsplat({ gsplat: inputs.gsplat! }).outputs;
        const opacity = dyno.select(
          dyno.greaterThan(parts.y, cutoffUniform),
          dyno.dynoConst('float', 0),
          parts.opacity,
        );
        return { gsplat: dyno.combineGsplat({ gsplat: inputs.gsplat!, ...parts, opacity }) };
      },
    );
    next.worldModifier = cutModifier;
    roofCutoff = cutoffUniform;
    const centers = sampleCenters(next);
    // 点云颜色就是实拍光照本身：载入时顺手取样一次，供场景光照匹配复用。
    if (source.assetId) rememberSceneSample(source.assetId, sampleSplatColors(next));
    const local = robustBox(centers);
    if (!local) {
      next.dispose();
      throw new Error('场景点云没有有效的包围盒，无法摆放。');
    }
    next.quaternion.copy(upAxisQuaternion(options.upAxis ?? 'Z'));
    // 缩放和落位挂在包装层上，点云本身只管朝向，换场地不必重算旋转。
    // 默认 1:1 米制；只有存在手动标定时才乘 sceneScale（扫描米 → 真实米）。
    calibration = sanitizeCalibration(options.calibration);
    localBox = local;
    localCenters = centers;
    upQuaternion = next.quaternion.clone();
    currentOffset.set(options.position?.x ?? 0, options.position?.y ?? 0, options.position?.z ?? 0);
    const group = new THREE.Group();
    group.add(next);
    splatScene.add(group);
    mesh = next;
    holder = group;
    placeSplat();
    if (transformMode === 'gizmo' && transformControls) transformControls.attach(group);
    if (!bounds) throw new Error('场景点云没有有效的包围盒，无法摆放。');
    // 标定后 bounds 仍是真实米制（比例已经乘进落位）：实测宽深高直接带回去。
    const placed = bounds.getSize(new THREE.Vector3());
    return Object.freeze({
      splats: next.numSplats ?? 0,
      meters: {
        width: Math.round(placed.x * 10) / 10,
        depth: Math.round(placed.z * 10) / 10,
        height: Math.round(placed.y * 10) / 10,
      },
      // 第一人称 1:1 漫游的围栏：同一条落位盒，不重算。
      walkBounds: walkBoundsOf(bounds),
    });
  }

  const renderFrame: SplatPaint = (renderer, scene, camera) => {
    if (!holder || !shownId) { renderer.render(scene, camera); return; }
    if (mesh) mesh.visible = displayMode === 'gaussian';
    paintAsBackLayer({ renderer, back: splatScene, scene, camera });
  };

  return {
    get shownId(): string { return shownId; },
    get renderScene(): THREE.Scene | null { return holder && shownId && sceneVisible ? splatScene : null; },
    get worldBounds(): THREE.Box3 | null { return bounds?.clone() ?? null; },
    pickFootprint(ray: THREE.Ray): number | null {
      if (!ground || !groundOutline || !sceneVisible) return null;
      const planeY = ground.position.y + 0.002;
      const hit = ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -planeY), new THREE.Vector3());
      if (!hit || !footprintContains(groundOutline, hit.x - ground.position.x, hit.z - ground.position.z)) return null;
      return hit.distanceTo(ray.origin);
    },
    async start(source: SplatSource, options: SplatLoadOptions) {
      sceneVisible = true;
      const result = await load(source, options);
      shownId = source.assetId;
      deps.invalidate();
      return result;
    },
    async setTransformMode(mode: SplatTransformMode) {
      transformMode = mode;
      const wantGizmo = mode === 'gizmo';
      if (wantGizmo && !transformControls) {
        const { TransformControls } = await import('three/addons/controls/TransformControls.js');
        // The mode may have been switched off while the control module loaded.
        if (transformMode !== 'gizmo' || disposed) return;
        transformControls = new TransformControls(deps.camera, deps.renderer.domElement);
        transformControls.setMode('translate');
        transformControls.setSpace('world');
        transformControls.setTranslationSnap(0.1);
        transformHelper = transformControls.getHelper();
        transformHelper.userData.type = 'splat-transform-gizmo';
        splatScene.add(transformHelper);
        transformControls.addEventListener('dragging-changed', event => {
          deps.orbitControls.enabled = !event.value;
        });
        transformControls.addEventListener('mouseUp', () => {
          if (!holder) return;
          const offset = holder.position.clone().sub(basePosition);
          const delta = offset.clone().sub(currentOffset);
          bounds?.translate(delta);
          translateOverlays(delta);
          currentOffset.copy(offset);
          deps.onPositionChange?.({ x: Number(offset.x.toFixed(3)), y: Number(offset.y.toFixed(3)), z: Number(offset.z.toFixed(3)) });
        });
      }
      if (transformControls) {
        // Dynamic import can finish after the user has already switched away
        // from the gizmo. Re-read the current mode instead of the stale
        // argument so a late setup cannot re-enable the scene axes.
        if (transformMode === 'gizmo' && holder) transformControls.attach(holder);
        else transformControls.detach();
      }
      if (transformHelper) transformHelper.visible = transformMode === 'gizmo' && !!holder;
      if (!wantGizmo) releaseTransformControls();
      deps.invalidate();
    },
    setPosition(position: SplatPosition) {
      if (!holder) return;
      const nextOffset = new THREE.Vector3(position.x, position.y, position.z);
      const delta = nextOffset.clone().sub(currentOffset);
      bounds?.translate(delta);
      translateOverlays(delta);
      currentOffset.copy(nextOffset);
      holder.position.set(basePosition.x + position.x, basePosition.y + position.y, basePosition.z + position.z);
      deps.invalidate();
    },
    /** 手动标定：就地重算落位、基准面、锚点与遮挡代理，不重新解码点云。 */
    applyCalibration(next: SplatCalibration): Readonly<{ meters: SplatMeters; walkBounds: SplatWalkBounds | null }> | null {
      calibration = sanitizeCalibration({ ...calibration, ...next });
      const placedBounds = placeSplat() ?? bounds;
      if (transformMode === 'gizmo' && holder && transformControls) transformControls.attach(holder);
      deps.invalidate();
      if (!placedBounds) return null;
      const size = placedBounds.getSize(new THREE.Vector3());
      return Object.freeze({
        meters: {
          width: Math.round(size.x * 10) / 10,
          depth: Math.round(size.z * 10) / 10,
          height: Math.round(size.y * 10) / 10,
        },
        walkBounds: walkBoundsOf(placedBounds),
      });
    },
    get calibration(): Required<SplatCalibration> {
      return {
        scale: calibration.scale,
        yawDeg: calibration.yawDeg,
        origin: { ...calibration.origin },
        ground: { y: calibration.ground.y, normal: { ...calibration.ground.normal }, definedBy: calibration.ground.definedBy },
        anchors: calibration.anchors.map(anchor => ({ ...anchor })),
      };
    },
    setDisplayMode(mode: SplatDisplayMode) {
      displayMode = mode;
      if (mesh) mesh.visible = mode === 'gaussian';
      deps.invalidate();
    },
    setVisible(visible: boolean) {
      sceneVisible = visible;
      deps.invalidate();
    },
    /** 站进场景里看；第一次进预览时把原来的机位记下来，退出原样还回去。 */
    frame(camera: THREE.PerspectiveCamera, controls: SplatOrbit) {
      if (!bounds) return false;
      return this.frameBounds(bounds, camera, controls);
    },
    frameBounds(frameBounds: THREE.Box3, camera: THREE.PerspectiveCamera, controls: SplatOrbit) {
      savedView ??= { position: camera.position.clone(), target: controls.target.clone() };
      const view = frameSplatView(frameBounds);
      camera.position.copy(view.position);
      controls.target.copy(view.target);
      controls.update();
      deps.invalidate();
      return true;
    },
    restoreView(camera: THREE.PerspectiveCamera, controls: SplatOrbit) {
      if (!savedView) return false;
      camera.position.copy(savedView.position);
      controls.target.copy(savedView.target);
      savedView = null;
      controls.update();
      deps.invalidate();
      return true;
    },
    /** Drop the borrowed orbit pose without moving the camera (walk owns it). */
    discardSavedView() {
      savedView = null;
    },
    /** 只停显示，点云还留在显存里：同一场景再点开不用重新解码。 */
    stop() {
      shownId = '';
      displayMode = 'gaussian';
      deps.invalidate();
    },
    setRoofCutoff(y: number) {
      if (!roofCutoff || !mesh || !Number.isFinite(y)) return;
      roofCutoff.value = y;
      roofCutoff.uniform.value = y;
      mesh.updateGenerator();
      deps.invalidate();
    },
    renderFrame,
    dispose() {
      disposed = true;
      generation += 1;
      shownId = '';
      bounds = null;
      savedView = null;
      releaseMesh();
      releaseTransformControls();
      spark?.dispose();
      spark = null;
    },
  };
}

export type SplatPreview = ReturnType<typeof createSplatPreview>;
