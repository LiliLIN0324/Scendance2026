import { SATELLITE_GROUND_LABEL, frameForExistingShell, parseSatelliteImageBounds, satellitePadMeters, satellitePhotoShapeRect, shellMetersToSatelliteUv } from '../lib/amap-venue';
import { layoutGeometryScene } from '../lib/structural-layout';
import { buildFloorMaterial } from './floor-patterns';
import { buildExtrudedWallGeometry } from './interior-walls';
import { buildWallMaterial } from './wall-patterns';
import type { RoomLayout } from '../lib/types';
import type * as ThreeNS from 'three';

export interface StructureShellOptions {
  /** 卫星参考底图贴上后触发重绘（与 buildRoom.onTextureLoaded 同角色）。 */
  onTextureLoaded?: () => void;
}

/**
 * 旧图没有经纬度范围时，整张照片铺在「壳体 + 圈外留白」上，而不是只铺圈内。
 * 留白若仍用圈内包围盒当 0..1，顶点会跑到贴图外，ClampToEdge 把边缘像素拉成横竖线带。
 */
function writeNormalizedUv(
  THREE: typeof import('three'),
  geometry: import('three').BufferGeometry,
  minX: number,
  maxX: number,
  minY: number,
  maxY: number,
): void {
  const pos = geometry.getAttribute('position');
  const spanX = Math.max(1e-6, maxX - minX);
  const spanY = Math.max(1e-6, maxY - minY);
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    uv[i * 2] = (pos.getX(i) - minX) / spanX;
    uv[i * 2 + 1] = 1 - (pos.getY(i) - minY) / spanY;
  }
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}

function writeGeographicUv(
  THREE: typeof import('three'),
  geometry: import('three').BufferGeometry,
  width: number,
  depth: number,
  frame: NonNullable<RoomLayout['mapGroundFrame']>,
  bounds: { west: number; south: number; east: number; north: number },
): void {
  const pos = geometry.getAttribute('position');
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    // Shape 里 y = -(z - depth/2)，转回壳体 z。新圈画 z=0 是北；旧帧用 latSign 区分。
    const localX = pos.getX(i) + width / 2;
    const localZ = depth / 2 - pos.getY(i);
    const { u, v } = shellMetersToSatelliteUv(localX, localZ, frame, bounds);
    uv[i * 2] = u;
    uv[i * 2 + 1] = v;
  }
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}
function loadSatelliteTexture(THREE: typeof import('three'), url: string): Promise<import('three').Texture> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const texture = new THREE.Texture(image);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.wrapS = THREE.ClampToEdgeWrapping;
      texture.wrapT = THREE.ClampToEdgeWrapping;
      texture.anisotropy = 16;
      texture.flipY = true;
      texture.needsUpdate = true;
      resolve(texture);
    };
    image.onerror = () => reject(new Error('sat decode'));
    image.src = url;
  });
}

/** 解码失败时仍把禁令文案画到地面上，避免只剩一块纯色。 */
function paintSatelliteLabel(THREE: typeof import('three'), label: string): import('three').Texture | null {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = 640;
  canvas.height = 360;
  const context = canvas.getContext('2d');
  if (!context) return null;
  context.fillStyle = '#2f4a38';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = 'rgba(0,0,0,0.55)';
  context.fillRect(16, 16, canvas.width - 32, 84);
  context.fillStyle = '#f0e6c8';
  context.font = '28px sans-serif';
  context.fillText(label, 32, 70);
  const texture = new THREE.Texture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.flipY = true;
  texture.needsUpdate = true;
  return texture;
}

/** Measured v2 shell: floor polygon and each wall's own thickness, height and holes. */
export function buildStructureShell(
  THREE: typeof import('three'),
  scene: ThreeNS.Scene,
  layout: RoomLayout,
  options: StructureShellOptions = {},
): void {
  const canonical = layoutGeometryScene(layout);
  const floor = layout.floors[0];
  const points = canonical.venue.polygon ?? [{ x: 0, z: 0 }, { x: layout.width, z: 0 },
    { x: layout.width, z: layout.height }, { x: 0, z: layout.height }];
  const shape = new THREE.Shape();
  points.forEach((p, i) => {
    const x = p.x - layout.width / 2, y = -(p.z - layout.height / 2);
    if (!i) shape.moveTo(x, y); else shape.lineTo(x, y);
  });
  shape.closePath();
  const useSat = !!(layout.satelliteGroundRef && layout.floorPlanImage);
  const floorMat = buildFloorMaterial(THREE, {
    pattern: floor.floorPattern ?? 'solid', color: floor.floorColor, roomWidth: layout.width, roomDepth: layout.height });
  const floorMesh = new THREE.Mesh<ThreeNS.ShapeGeometry, ThreeNS.Material>(new THREE.ShapeGeometry(shape), floorMat);
  floorMesh.rotation.x = -Math.PI / 2;
  floorMesh.receiveShadow = true;
  floorMesh.userData.type = 'floor';
  if (useSat) {
    // 贴地参考：半透明叠在壳体地面；文案标记保证不可当重建素材。
    // ShapeGeometry 默认 UV=米制坐标，须归一化到照片矩形，否则 Clamp 只采到边角并拉成线带。
    // 用 MeshBasicMaterial（同 room-builder）：不受光照/金属度影响，卫星色可见。
    const imageBounds = parseSatelliteImageBounds(layout.floorPlanImage ?? '');
    const shellPolygon = layout.backendVenue?.polygon ?? layout.backendSceneV2?.venue.polygon;
    const frame = imageBounds
      ? layout.mapGroundFrame ?? (layout.mapGroundPolygon ? frameForExistingShell(layout.mapGroundPolygon, shellPolygon) : null)
      : null;
    // 有经纬度就让网格外沿等于照片范围。没有时，照片覆盖壳体加同一圈留白，圈外采到的是照片外圈像素，不是被 Clamp 拉长的一条边。
    const pad = satellitePadMeters(layout.width, layout.height);
    const photoRect = imageBounds && frame
      ? satellitePhotoShapeRect(layout.width, layout.height, frame, imageBounds)
      : {
          minX: -layout.width / 2 - pad,
          maxX: layout.width / 2 + pad,
          minY: -layout.height / 2 - pad,
          maxY: layout.height / 2 + pad,
        };
    if (imageBounds && frame) writeGeographicUv(THREE, floorMesh.geometry, layout.width, layout.height, frame, imageBounds);
    else writeNormalizedUv(THREE, floorMesh.geometry, photoRect.minX, photoRect.maxX, photoRect.minY, photoRect.maxY);
    floorMat.dispose();
    const satMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: Math.max(0.65, layout.floorPlanOpacity ?? 0.78),
      side: THREE.DoubleSide,
      depthWrite: true,
    });
    floorMesh.material = satMat;
    floorMesh.userData.satelliteGroundRef = true;
    floorMesh.userData.satelliteGroundLabel = SATELLITE_GROUND_LABEL;

    // 圈外仍是同一张卫星，只是更淡。外沿停在照片矩形上，UV 落在 0..1 里，才能看见周边地貌而不是边缘拉丝。
    const surroundShape = new THREE.Shape();
    surroundShape.moveTo(photoRect.minX, photoRect.minY);
    surroundShape.lineTo(photoRect.maxX, photoRect.minY);
    surroundShape.lineTo(photoRect.maxX, photoRect.maxY);
    surroundShape.lineTo(photoRect.minX, photoRect.maxY);
    surroundShape.closePath();
    const venueHole = new THREE.Path();
    // hole 绕序与外轮廓相反，避免 ShapeGeometry 挖洞失败
    for (let i = points.length - 1; i >= 0; i--) {
      const p = points[i];
      const x = p.x - layout.width / 2;
      const y = -(p.z - layout.height / 2);
      if (i === points.length - 1) venueHole.moveTo(x, y);
      else venueHole.lineTo(x, y);
    }
    venueHole.closePath();
    surroundShape.holes.push(venueHole);
    const surroundGeometry = new THREE.ShapeGeometry(surroundShape);
    if (imageBounds && frame) writeGeographicUv(THREE, surroundGeometry, layout.width, layout.height, frame, imageBounds);
    else writeNormalizedUv(THREE, surroundGeometry, photoRect.minX, photoRect.maxX, photoRect.minY, photoRect.maxY);
    const surroundMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.55,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const surroundMesh = new THREE.Mesh(surroundGeometry, surroundMat);
    surroundMesh.rotation.x = -Math.PI / 2;
    surroundMesh.position.y = -0.01;
    surroundMesh.receiveShadow = false;
    surroundMesh.userData.type = 'floor';
    surroundMesh.userData.satelliteSurroundFade = true;
    surroundMesh.userData.satelliteGroundRef = true;
    surroundMesh.userData.satelliteGroundLabel = SATELLITE_GROUND_LABEL;
    scene.add(surroundMesh);
    // HTMLImageElement 能解开 jpeg 瓦片和 SVG 占位。createImageBitmap 解不开 SVG，
    // 失败时曾经把地面涂成 0x445544（纯橄榄绿），网络里却是 200 的图。
    const url = layout.floorPlanImage!;
    const applyMap = (texture: ThreeNS.Texture) => {
      texture.wrapS = THREE.ClampToEdgeWrapping;
      texture.wrapT = THREE.ClampToEdgeWrapping;
      texture.anisotropy = 16;
      satMat.map = texture;
      surroundMat.map = texture;
      satMat.color = new THREE.Color(0xffffff);
      satMat.needsUpdate = true;
      surroundMat.needsUpdate = true;
      options.onTextureLoaded?.();
    };
    void loadSatelliteTexture(THREE, url).then(texture => {
      if (floorMesh.material !== satMat) { texture.dispose(); return; }
      applyMap(texture);
    }).catch(() => {
      if (floorMesh.material !== satMat) return;
      const fallback = paintSatelliteLabel(THREE, SATELLITE_GROUND_LABEL);
      if (fallback && floorMesh.material === satMat) applyMap(fallback);
    });
  }
  scene.add(floorMesh);
  const signedArea = points.reduce((total, p, i) => {
    const q = points[(i + 1) % points.length]; return total + p.x * q.z - q.x * p.z;
  }, 0);
  for (const wall of canonical.structure.walls) {
    const dx = wall.end.x - wall.start.x, dz = wall.end.z - wall.start.z;
    const length = Math.hypot(dx, dz);
    if (length < 0.01) continue;
    const openings = canonical.structure.openings.filter(o => o.wallId === wall.id).map(o => ({
      centerAlongWall: o.offset + o.width / 2 - length / 2,
      bottomFromFloor: o.sillHeight, width: o.width, height: o.height,
    }));
    const geometry = openings.length
      ? buildExtrudedWallGeometry(THREE, length, wall.height, wall.thickness, openings)
      : new THREE.BoxGeometry(length, wall.height, wall.thickness).translate(0, wall.height / 2, 0);
    const source = floor.interiorWalls?.find(w => w.id === wall.id);
    // Keep the existing editor's exterior/interior finishes. Recognition status
    // belongs in the review UI, not in the physical wall's material color.
    const material = wall.kind === 'exterior'
      ? buildWallMaterial(THREE, { pattern: 'solid', color: source?.color ?? '#e8dcc4', width: length, height: wall.height })
      : new THREE.MeshStandardMaterial({ color: source?.color ?? '#e0e0e0', roughness: 0.85 });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set((wall.start.x + wall.end.x) / 2 - layout.width / 2, 0,
      (wall.start.z + wall.end.z) / 2 - layout.height / 2);
    mesh.rotation.y = -Math.atan2(dz, dx);
    mesh.castShadow = true; mesh.receiveShadow = true;
    // Shell owns all v2 walls so one rebuild and one disposal cover them.
    mesh.userData.type = 'wall'; mesh.userData.wallId = wall.id;
    mesh.userData.structureKind = wall.kind;
    mesh.userData.normal = { x: (signedArea >= 0 ? dz : -dz) / length, z: (signedArea >= 0 ? -dx : dx) / length };
    scene.add(mesh);
  }
}
