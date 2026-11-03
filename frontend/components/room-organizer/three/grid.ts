import { GRID_SIZE_METERS } from '../lib/constants';

type ThreeModule = typeof import('three');

/**
 * 2D 平面图同款 0.5 m 网格：透明贴图平面。
 * 与 2D 共用同一套语义：`#ddd` 发丝线、单元对齐世界原点（不是贴图边缘），
 * 只铺在房间范围内；用贴图而不是 GridHelper，线宽在透视下随 mipmap 自然衰减。
 */
export function buildGridPlane(
  THREE: ThreeModule,
  width: number,
  depth: number
): import('three').Mesh<import('three').PlaneGeometry, import('three').MeshBasicMaterial> {
  // 约 96 px/m，边长截到 512–2048，避免小房间糊成一片、大房间吃显存。
  const longSide = Math.min(2048, Math.max(512, Math.round(Math.max(width, depth) * 96)));
  const pxW = Math.max(1, Math.round(longSide * width / Math.max(width, depth)));
  const pxH = Math.max(1, Math.round(longSide * depth / Math.max(width, depth)));
  const canvas = document.createElement('canvas');
  canvas.width = pxW;
  canvas.height = pxH;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.strokeStyle = '#ddd';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let k = Math.ceil(-width / 2 / GRID_SIZE_METERS); k * GRID_SIZE_METERS <= width / 2; k += 1) {
      const p = Math.round((k * GRID_SIZE_METERS + width / 2) / width * pxW) + 0.5;
      ctx.moveTo(p, 0);
      ctx.lineTo(p, pxH);
    }
    for (let k = Math.ceil(-depth / 2 / GRID_SIZE_METERS); k * GRID_SIZE_METERS <= depth / 2; k += 1) {
      const p = Math.round((k * GRID_SIZE_METERS + depth / 2) / depth * pxH) + 0.5;
      ctx.moveTo(0, p);
      ctx.lineTo(pxW, p);
    }
    ctx.stroke();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.anisotropy = 8;
  const geometry = new THREE.PlaneGeometry(width, depth);
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
    toneMapped: false,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.renderOrder = 2;
  mesh.raycast = () => {};
  return mesh;
}
