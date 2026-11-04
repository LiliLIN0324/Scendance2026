import { METERS_PER_DEGREE_LAT, metersPerDegreeLng } from '../lib/amap-venue';
import { boundsSizeMeters } from '../lib/research-area';
import { anchorBasemapYawRad, anchorGeoToWorld, sceneAnchorOf } from '../lib/scene-anchor';
import type { RoomLayout } from '../lib/types';
import type * as ThreeNS from 'three';

/**
 * 调研底图：这一片区域的路网，铺在 3D 地面上。
 *
 * 架构定案（docs/49）：地图不是独立模块，是 3D 场景里的一个渲染层。
 * 场景坐标 ↔ 地理坐标只有场景锚点（lib/scene-anchor.ts）这一套变换，
 * 底图的中心、尺寸、正北朝向全部由锚点推出，不再自己持有定位。
 *
 * 尺度：真实米制。壳体被等比缩小过（锚点 metersPerUnit > 1）时，底图一起缩小。
 */

export const RESEARCH_BASEMAP_TAG = 'research-basemap';
/** 底图压在场地下方一点点，不和壳体地面抢同一层深度。 */
export const RESEARCH_BASEMAP_Y = -0.02;

export interface ResearchBasemapPlacement {
  /** 底图覆盖的世界米（x 向东，z 向南；已随锚点 metersPerUnit 缩放）。 */
  widthM: number;
  depthM: number;
  /** 底图中心在 3D 世界里的位置（相对世界原点）。 */
  centerX: number;
  centerZ: number;
  /** 底图绕世界 Y 轴的偏航（弧度）：锚点正北朝向的反向旋转，0 表示正北朝上。 */
  yawRad: number;
}

/**
 * 经纬度 → 3D 世界坐标（x 向东、z 向南，y=0）。
 * 唯一变换是场景锚点；还没有锚点（项目刚开始就先调研）时以底图中心为原点，
 * 空地也要能铺图、能定点。
 */
export function researchGeoToWorld(layout: RoomLayout, lng: number, lat: number): { x: number; z: number } | null {
  const area = layout.researchArea;
  if (!area) return null;
  const anchor = sceneAnchorOf(layout);
  if (anchor) return anchorGeoToWorld(anchor, lng, lat);
  const mLng = metersPerDegreeLng(area.center.lat);
  return { x: (lng - area.center.lng) * mLng, z: (area.center.lat - lat) * METERS_PER_DEGREE_LAT };
}

/**
 * 底图该摆在哪、多大、朝哪。
 *
 * 底图范围的地理中心经锚点投影得到世界偏移；尺寸是范围的真实米数除以
 * 锚点 metersPerUnit（壳体缩小时底图同步缩）；朝向随锚点正北偏航。
 * 没有锚点时底图中心就是世界原点。
 */
export function researchBasemapPlacement(layout: RoomLayout): ResearchBasemapPlacement | null {
  const area = layout.researchArea;
  if (!area) return null;
  const widthM = (area.bounds.east - area.bounds.west) * metersPerDegreeLng(area.center.lat);
  const depthM = (area.bounds.north - area.bounds.south) * METERS_PER_DEGREE_LAT;
  const anchor = sceneAnchorOf(layout);
  if (!anchor) return { widthM, depthM, centerX: 0, centerZ: 0, yawRad: 0 };
  const boundsLng = (area.bounds.west + area.bounds.east) / 2;
  const boundsLat = (area.bounds.south + area.bounds.north) / 2;
  const center = anchorGeoToWorld(anchor, boundsLng, boundsLat);
  const mpu = anchor.metersPerUnit;
  return { widthM: widthM / mpu, depthM: depthM / mpu, centerX: center.x, centerZ: center.z, yawRad: anchorBasemapYawRad(anchor) };
}

/**
 * 底图观感（docs/49 需求B）：去饱和 + 提亮 + 压对比，让底图退到后面、场景跳出来。
 * 只作用在底图贴图像素上，不碰场景里任何别的东西。
 */
export const BASEMAP_TONE_FILTER = 'saturate(0.55) brightness(1.12) contrast(0.9)';

/** 按 BASEMAP_TONE_FILTER 过一遍画布；画布不可用（测试环境）时原样返回。 */
function toneDownBasemapImage(image: HTMLImageElement): HTMLImageElement | HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx || canvas.width === 0 || canvas.height === 0) return image;
  ctx.filter = BASEMAP_TONE_FILTER;
  ctx.drawImage(image, 0, 0);
  return canvas;
}

/** 底图贴图。代理地址跨源，必须带 anonymous 解码，否则 WebGL 会报 SecurityError。 */
function loadBasemapTexture(THREE: typeof import('three'), url: string): Promise<import('three').Texture> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => {
      const texture = new THREE.Texture(toneDownBasemapImage(image));
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.wrapS = THREE.ClampToEdgeWrapping;
      texture.wrapT = THREE.ClampToEdgeWrapping;
      texture.anisotropy = 16;
      texture.needsUpdate = true;
      resolve(texture);
    };
    image.onerror = () => reject(new Error('basemap decode'));
    image.src = url;
  });
}

export interface ResearchBasemapOptions {
  /** 贴图加载完成时回调一次（用来重绘一帧）。 */
  onTextureLoaded?: () => void;
}

/**
 * 铺一张调研底图。已经有底图就先拆掉旧的，免得换范围后两层叠在一起。
 * 没有 researchArea 或定位不了就不铺——空地比错位的图诚实。
 */
export function buildResearchBasemap(
  THREE: typeof import('three'),
  scene: ThreeNS.Scene,
  layout: RoomLayout,
  options: ResearchBasemapOptions = {},
): ThreeNS.Mesh | null {
  clearResearchBasemap(scene);
  const area = layout.researchArea;
  const placement = researchBasemapPlacement(layout);
  if (!area || !placement) return null;
  if (![placement.widthM, placement.depthM].every(value => Number.isFinite(value) && value > 0)) return null;

  const geometry = new THREE.PlaneGeometry(placement.widthM, placement.depthM, 1, 1);
  const material = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(geometry, material);
  // PlaneGeometry 的 UV：u 沿 +x（东），v 沿 +y。绕 X 转 -90° 后 +y 指向 -z（北），
  // 贴图 flipY 默认把图片首行放到 v=1（北），所以这张平面天然正北朝上。
  mesh.rotation.x = -Math.PI / 2;
  // 锚点带朝向时，把纹理正北偏到锚点给出的方位（绕世界 Y，与投影旋转互逆）。
  if (placement.yawRad !== 0) mesh.rotateOnWorldAxis(new THREE.Vector3(0, 1, 0), placement.yawRad);
  mesh.position.set(placement.centerX, RESEARCH_BASEMAP_Y, placement.centerZ);
  mesh.receiveShadow = false;
  mesh.castShadow = false;
  mesh.userData.type = RESEARCH_BASEMAP_TAG;
  mesh.userData.mapReference = true;
  mesh.userData.mapReferenceLabel = '参考底图·不可作重建素材';
  scene.add(mesh);

  void loadBasemapTexture(THREE, area.imageUrl).then(texture => {
    if (mesh.material !== material) { texture.dispose(); return; }
    material.map = texture;
    material.needsUpdate = true;
    options.onTextureLoaded?.();
  }).catch(() => {
    // 图没拉下来时留一张素底，别让地面变成一块说不清的颜色。
    if (mesh.material === material) material.color.setHex(0xe8e4da);
  });

  // 场地脚下那块 z18 级高清贴片：同锚点、略高于全景底图，走近时地面是真实的树/路/岸线。
  // 真实比例不变——尺寸就是 detailBounds 换算出来的真实米数，不缩放。
  const detailSize = area.detailBounds ? boundsSizeMeters(area.detailBounds) : null;
  if (area.detailImageUrl && detailSize && [detailSize.widthM, detailSize.depthM].every(value => Number.isFinite(value) && value > 0)) {
    const detailGeometry = new THREE.PlaneGeometry(detailSize.widthM, detailSize.depthM, 1, 1);
    const detailMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff, side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
    });
    const detailMesh = new THREE.Mesh(detailGeometry, detailMaterial);
    detailMesh.rotation.x = -Math.PI / 2;
    if (placement.yawRad !== 0) detailMesh.rotateOnWorldAxis(new THREE.Vector3(0, 1, 0), placement.yawRad);
    detailMesh.position.set(placement.centerX, RESEARCH_BASEMAP_Y + 0.01, placement.centerZ);
    detailMesh.renderOrder = 1;
    detailMesh.receiveShadow = false;
    detailMesh.castShadow = false;
    detailMesh.userData.type = RESEARCH_BASEMAP_TAG;
    detailMesh.userData.mapReference = true;
    detailMesh.userData.mapReferenceLabel = '参考底图·不可作重建素材';
    scene.add(detailMesh);
    void loadBasemapTexture(THREE, area.detailImageUrl).then(texture => {
      if (detailMesh.material !== detailMaterial) { texture.dispose(); return; }
      detailMaterial.map = texture;
      detailMaterial.needsUpdate = true;
      options.onTextureLoaded?.();
    }).catch(() => {
      // 贴片没拉下来就整层隐掉，让全景底图露出来，不留一块白板。
      if (detailMesh.material === detailMaterial) detailMaterial.visible = false;
    });
  }
  return mesh;
}

/** 拆掉旧底图，连同贴图一起释放。 */
export function clearResearchBasemap(scene: ThreeNS.Scene): void {
  for (const child of [...scene.children]) {
    if (child.userData?.type !== RESEARCH_BASEMAP_TAG) continue;
    scene.remove(child);
    const mesh = child as ThreeNS.Mesh;
    mesh.geometry?.dispose();
    const material = mesh.material as ThreeNS.Material | undefined;
    const map = (material as unknown as { map?: import('three').Texture } | undefined)?.map;
    if (map && (map as { isTexture?: boolean }).isTexture) map.dispose();
    material?.dispose();
  }
}

/* ---------------- 候选坐标十字核对（?geocross=lng,lat,名字;…） ---------------- */

export const GEO_CROSS_TAG = 'geo-cross';

export interface GeoCrossPoint {
  lng: number;
  lat: number;
  label?: string;
}

/** 解析 URL 参数：?geocross=120.1393,30.2461,断桥;120.1489,30.2311,雷峰塔。名字可省。 */
export function parseGeoCrossParam(search: string): GeoCrossPoint[] {
  const raw = new URLSearchParams(search).get('geocross');
  if (!raw) return [];
  return raw.split(';').flatMap(chunk => {
    const parts = chunk.split(',');
    const lng = Number(parts[0]);
    const lat = Number(parts[1]);
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) return [];
    return [{ lng, lat, ...(parts[2] ? { label: parts[2] } : {}) }];
  });
}

function makeCrossLabel(THREE: typeof import('three'), text: string, size: number): import('three').Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.font = 'bold 40px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 8;
    ctx.strokeText(text, 256, 64);
    ctx.fillStyle = '#c0392b';
    ctx.fillText(text, 256, 64);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false, depthWrite: false });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(size, size / 4, 1);
  sprite.renderOrder = 11;
  return sprite;
}

/**
 * 在候选经纬度上打红十字 + 名字标签。肉眼读图不可靠，核对底图对齐时用它：
 * 十字压在地名/路上说明投影对得上，偏了就是换算错了。不参与选中与射线。
 */
export function buildGeoCrosses(
  THREE: typeof import('three'),
  scene: ThreeNS.Scene,
  layout: RoomLayout,
  points: readonly GeoCrossPoint[],
): void {
  clearGeoCrosses(scene);
  const placement = researchBasemapPlacement(layout);
  if (!placement) return;
  const crossSize = Math.max(placement.widthM, placement.depthM) * 0.02;
  const labelSize = Math.max(placement.widthM, placement.depthM) * 0.1;
  for (const point of points) {
    const world = researchGeoToWorld(layout, point.lng, point.lat);
    if (!world) continue;
    const group = new THREE.Group();
    const material = new THREE.LineBasicMaterial({ color: 0xc0392b, depthTest: false, transparent: true });
    const geometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-crossSize, 0, 0), new THREE.Vector3(crossSize, 0, 0),
      new THREE.Vector3(0, 0, -crossSize), new THREE.Vector3(0, 0, crossSize),
    ]);
    const lines = new THREE.LineSegments(geometry, material);
    lines.position.set(world.x, 0.05, world.z);
    lines.renderOrder = 11;
    lines.raycast = () => {};
    group.add(lines);
    const text = point.label ?? `${point.lng.toFixed(5)},${point.lat.toFixed(5)}`;
    const label = makeCrossLabel(THREE, text, labelSize);
    label.position.set(world.x, 0.05 + labelSize * 0.6, world.z);
    label.raycast = () => {};
    group.add(label);
    group.userData.type = GEO_CROSS_TAG;
    scene.add(group);
  }
}

export function clearGeoCrosses(scene: ThreeNS.Scene): void {
  for (const child of [...scene.children]) {
    if (child.userData?.type !== GEO_CROSS_TAG) continue;
    scene.remove(child);
    child.traverse(node => {
      const mesh = node as ThreeNS.Mesh;
      const isSprite = (node as ThreeNS.Sprite).isSprite === true;
      // Sprite 的几何体是 three 全局共享的，不能 dispose；只清贴图与材质。
      if (!isSprite) mesh.geometry?.dispose();
      const material = mesh.material as ThreeNS.Material | undefined;
      const map = (material as unknown as { map?: import('three').Texture } | undefined)?.map;
      if (map && (map as { isTexture?: boolean }).isTexture) map.dispose();
      material?.dispose();
    });
  }
}
