import { removeAndDispose } from './builder-utils';
import type { Vec2 } from '../lib/types';
import type * as ThreeNS from 'three';

type ThreeModule = typeof import('three');

const MEASUREMENT_TAG = 'measurement';
const DIMENSION_TAG = 'room-dimension';
// 与 2D canvas 的 PLAN_SELECT (#2f7a4f) / PLAN_LABEL_INK (#333) 同色。
const PLAN_SELECT = 0x2f7a4f;

export function clearMeasurement(scene: ThreeNS.Scene): void {
  scene.children
    .filter((obj) => obj.userData.type === MEASUREMENT_TAG)
    .forEach((obj) => removeAndDispose(scene, obj));
}

export function clearRoomDimensions(scene: ThreeNS.Scene): void {
  scene.children
    .filter((obj) => obj.userData.type === DIMENSION_TAG)
    .forEach((obj) => removeAndDispose(scene, obj));
}

/**
 * 3D 房间尺寸标注：与 2D 的 drawRoomDimensions 对齐——粗体、墨色 #333、白描边光晕，
 * 长边标在北侧、短边标在西侧，外移量取 2D 的「10px」语义。
 */
export function renderRoomDimensions(
  THREE: ThreeModule,
  scene: ThreeNS.Scene,
  width: number,
  depth: number,
  yOffset = 0
): void {
  clearRoomDimensions(scene);
  const gap = 0.35;
  addDimensionSprite(THREE, scene, `${Number(width.toFixed(2))}m`, 0, yOffset + 0.4, -depth / 2 - gap);
  addDimensionSprite(THREE, scene, `${Number(depth.toFixed(2))}m`, -width / 2 - gap, yOffset + 0.4, 0);
}

function addDimensionSprite(
  THREE: ThreeModule,
  scene: ThreeNS.Scene,
  text: string,
  x: number,
  y: number,
  z: number
): void {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.font = 'bold 28px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.lineWidth = 6;
    ctx.strokeText(text, canvas.width / 2, canvas.height / 2);
    ctx.fillStyle = '#333';
    ctx.fillText(text, canvas.width / 2, canvas.height / 2);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false, depthTest: false });
  const sprite = new THREE.Sprite(material);
  sprite.position.set(x, y, z);
  sprite.scale.set(2.4, 0.6, 1);
  sprite.renderOrder = 9;
  sprite.userData.type = DIMENSION_TAG;
  sprite.raycast = () => {};
  scene.add(sprite);
}

/**
 * Render measurement markers — small green spheres at each point and, when
 * two points exist, a line connecting them. The numeric label is rendered
 * in HTML by the orchestrator; keeping it out of the scene avoids having
 * to load a font + Text geometry.
 */
export function renderMeasurement(
  THREE: ThreeModule,
  scene: ThreeNS.Scene,
  points: readonly Vec2[],
  yOffset = 0
): void {
  clearMeasurement(scene);
  if (points.length === 0) return;

  const sphereGeo = new THREE.SphereGeometry(0.08, 16, 12);
  const sphereMat = new THREE.MeshStandardMaterial({
    color: PLAN_SELECT,
    emissive: PLAN_SELECT,
    emissiveIntensity: 0.4,
    toneMapped: false,
  });
  for (const point of points) {
    const sphere = new THREE.Mesh(sphereGeo, sphereMat);
    sphere.position.set(point.x, yOffset + 0.05, point.z);
    sphere.userData.type = MEASUREMENT_TAG;
    scene.add(sphere);
  }

  if (points.length >= 2) {
    const lineMat = new THREE.LineBasicMaterial({ color: PLAN_SELECT, linewidth: 2, toneMapped: false });
    const lineGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(points[0]!.x, yOffset + 0.05, points[0]!.z),
      new THREE.Vector3(points[1]!.x, yOffset + 0.05, points[1]!.z),
    ]);
    const line = new THREE.Line(lineGeo, lineMat);
    line.userData.type = MEASUREMENT_TAG;
    scene.add(line);
  }
}

export function measurementDistance(points: readonly Vec2[]): number | null {
  if (points.length < 2) return null;
  const [a, b] = points;
  if (!a || !b) return null;
  return Math.hypot(a.x - b.x, a.z - b.z);
}
