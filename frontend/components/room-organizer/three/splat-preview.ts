import * as THREE from 'three';
import { ROOM_OBJECT_TAGS } from './room-builder';
import type { SplatMesh, SparkRenderer } from '@sparkjsdev/spark';

/** Aholo World 的 3DGS 竖直轴；上游不给时按它给的 Z-up 立起来。 */
export type SplatUpAxis = 'X' | 'Y' | 'Z';
/** 本机稳定地址（`/asset/<uuid>.spz`）：Spark 按后缀认格式，所以不用再传类型。 */
export type SplatMeters = Readonly<{ width: number; depth: number; height: number }>;
export type SplatSource = Readonly<{ assetId: string; url: string; name: string; meters?: SplatMeters }>;
export type SplatLoadOptions = Readonly<{
  /** 场地最长水平边（米）：无真实尺度时的兜底——点云按它等比缩放。 */
  sizeMeters: number;
  upAxis?: SplatUpAxis;
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

/** 旋转后的轴对齐盒：八个角各自转一遍再取并集。 */
export function rotatedBox(box: THREE.Box3, quaternion: THREE.Quaternion): THREE.Box3 {
  const result = new THREE.Box3();
  const point = new THREE.Vector3();
  for (const x of [box.min.x, box.max.x]) {
    for (const y of [box.min.y, box.max.y]) {
      for (const z of [box.min.z, box.max.z]) {
        result.expandByPoint(point.set(x, y, z).applyQuaternion(quaternion));
      }
    }
  }
  return result;
}

/** 把旋转后的点云按场地最长水平边等比缩放，底面贴到 y=0、水平中心对到原点。 */
export function fitSplatBox(box: THREE.Box3, sizeMeters: number): SplatFit {
  const size = box.getSize(new THREE.Vector3());
  const horizontal = Math.max(size.x, size.z);
  const scale = sizeMeters > 0 && horizontal > EPSILON ? sizeMeters / horizontal : 1;
  const center = box.getCenter(new THREE.Vector3());
  return { scale, position: new THREE.Vector3(-center.x * scale, -box.min.y * scale, -center.z * scale) };
}

export type SplatOrbit = { target: THREE.Vector3; update(): void };

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
  const { renderer, back, scene, camera } = deps;
  const hidden: Array<[THREE.Object3D, boolean]> = [];
  for (const child of scene.children) {
    if (child.userData.type !== ROOM_OBJECT_TAGS.Floor && child.userData.type !== ROOM_OBJECT_TAGS.Wall) continue;
    hidden.push([child, child.visible]);
    child.visible = false;
  }
  // 天空属于背景那一层：临时挪到点云场景，免得点云没盖到的地方露出纯黑。
  const sky = scene.background;
  scene.background = null;
  back.background = sky;
  renderer.autoClear = true;
  renderer.render(back, camera);
  renderer.autoClear = false;
  renderer.render(scene, camera);
  renderer.autoClear = true;
  back.background = null;
  scene.background = sky;
  for (const [child, visible] of hidden) child.visible = visible;
}
/**
 * 3DGS 环境预览：点云待在自己的一条渲染栈里（自己的 Scene + 自己的 SparkRenderer），
 * 每帧用 paintAsBackLayer 把它铺在布置场景底下。相机、轨道控制器与拾取全部沿用现有的那套，
 * 所以转视角时点云和物料始终对得上，而点云本身一件都点不着。
 */
export function createSplatPreview(deps: { renderer: THREE.WebGLRenderer; invalidate(): void }) {
  const sparkPromise = import('@sparkjsdev/spark');
  const splatScene = new THREE.Scene();
  let spark: SparkRenderer | null = null;
  let holder: THREE.Group | null = null;
  let mesh: SplatMesh | null = null;
  // 点云摆好之后在世界里的占位，用来把相机框进场景内。
  let bounds: THREE.Box3 | null = null;
  let savedView: Readonly<{ position: THREE.Vector3; target: THREE.Vector3 }> | null = null;
  // 正在显示的场景号：空字符串就是预览关闭，渲染循环每帧只认这一个判据。
  let shownId = '';
  // 一次只认最后一次请求：还在下载时又点了别的场景，先完成的那条要自己丢掉。
  let generation = 0;
  let disposed = false;

  function releaseMesh() {
    holder?.removeFromParent();
    mesh?.dispose();
    holder = null;
    mesh = null;
  }

  async function load(source: SplatSource, options: SplatLoadOptions): Promise<Readonly<{ splats: number; meters: SplatMeters }>> {
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
    const local = robustBox(sampleCenters(next));
    if (!local) {
      next.dispose();
      throw new Error('场景点云没有有效的包围盒，无法摆放。');
    }
    next.quaternion.copy(upAxisQuaternion(options.upAxis ?? 'Z'));
    // 缩放和落位挂在包装层上，点云本身只管朝向，换场地不必重算旋转。
    const rotated = rotatedBox(local, next.quaternion);
    // 米制假设：World 生成产物就是真实米制（forwardBox 只是局部子盒，tree 根盒 ~40×26m 对得上一座宴会厅），
    // 不做任何缩放：底面贴 y=0、水平中心对到场地中心，场地只是大厅里的一块布置区。
    // 点云里自带桌椅（真实米数），缩放反而会破坏与物料的比例。
    const center = rotated.getCenter(new THREE.Vector3());
    const fit = { scale: 1, position: new THREE.Vector3(-center.x, -rotated.min.y, -center.z) };
    const group = new THREE.Group();
    group.scale.setScalar(fit.scale);
    group.position.copy(fit.position);
    group.add(next);
    splatScene.add(group);
    // 落位后的占位 = 旋转盒缩放再平移；相机就照它站进场内。
    bounds = new THREE.Box3(
      rotated.min.clone().multiplyScalar(fit.scale).add(fit.position),
      rotated.max.clone().multiplyScalar(fit.scale).add(fit.position)
    );
    mesh = next;
    holder = group;
    // scale 1 下 bounds 就是真实米制：把实测宽深高带回去，场地校准与横幅都以它为准。
    const placed = bounds.getSize(new THREE.Vector3());
    return Object.freeze({
      splats: next.numSplats ?? 0,
      meters: {
        width: Math.round(placed.x * 10) / 10,
        depth: Math.round(placed.z * 10) / 10,
        height: Math.round(placed.y * 10) / 10,
      },
    });
  }

  const renderFrame: SplatPaint = (renderer, scene, camera) => {
    if (!holder || !shownId) { renderer.render(scene, camera); return; }
    paintAsBackLayer({ renderer, back: splatScene, scene, camera });
  };

  return {
    get shownId(): string { return shownId; },
    async start(source: SplatSource, options: SplatLoadOptions) {
      const result = await load(source, options);
      shownId = source.assetId;
      deps.invalidate();
      return result;
    },
    /** 站进场景里看；第一次进预览时把原来的机位记下来，退出原样还回去。 */
    frame(camera: THREE.PerspectiveCamera, controls: SplatOrbit) {
      if (!bounds) return false;
      savedView ??= { position: camera.position.clone(), target: controls.target.clone() };
      const view = frameSplatView(bounds);
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
      spark?.dispose();
      spark = null;
    },
  };
}

export type SplatPreview = ReturnType<typeof createSplatPreview>;
