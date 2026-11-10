import type * as ThreeNS from 'three';
import type { PlanPropShape, ShellPoint } from '../lib/plan-footprint-geometry';

/**
 * 2D 规划里的设施 → 3D 里立起来的物件（P2-g「2D 设施与 3D 物料对位」）。
 *
 * 和 `plan-footprint-builder` 的分工：那里画「地面上的图形」（分区/动线/占地），
 * 这里给每个设施立一个可辨认的低模物件——帐篷是帐篷、舞台有台面和桁架、餐车有
 * 车身和轮子。尺寸与朝向直接来自 2D 占地（已换算到壳体米），所以两个视图里是
 * 同一个东西，不是各画一套。
 *
 * 坐标：物件建在**世界轴**上（BoxGeometry 的 X 就是东西、Z 就是南北、Y 是高度），
 * 不参与 `ShapeGeometry` 那套绕 X 轴 -90° 的翻转；2D 画布的顺时针 `rotationDeg`
 * 对应 `rotation.y = -theta`（three 绕 Y 正向是逆时针）。
 */

const PALETTE = {
  fabric: '#f3f0e8',
  fabricShadow: '#d9d3c6',
  marquee: '#c98a2c',
  wood: '#96714d',
  metal: '#5a6169',
  dark: '#2b2f36',
  glass: '#9fc4d8',
  white: '#e9edf1',
  body: '#dfe3e8',
  accent: '#b3628c',
  bin: '#2f6b4f',
  binGray: '#8b9aa6',
} as const;

function standard(
  THREE: typeof import('three'),
  color: string,
  options: { roughness?: number; metalness?: number; opacity?: number; side?: number } = {},
): import('three').MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: new THREE.Color(color),
    roughness: options.roughness ?? 0.82,
    metalness: options.metalness ?? 0.04,
    transparent: options.opacity !== undefined && options.opacity < 1,
    opacity: options.opacity ?? 1,
    side: (options.side as import('three').Side | undefined) ?? THREE.FrontSide,
  });
}

interface PartOptions {
  position?: [number, number, number];
  rotationY?: number;
  shadow?: boolean;
}

function box(
  THREE: typeof import('three'),
  group: ThreeNS.Group,
  size: [number, number, number],
  material: import('three').Material,
  options: PartOptions = {},
): ThreeNS.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(size[0], size[1], size[2]), material);
  const [x, y, z] = options.position ?? [0, 0, 0];
  mesh.position.set(x, y, z);
  if (options.rotationY) mesh.rotation.y = options.rotationY;
  mesh.castShadow = options.shadow !== false;
  mesh.receiveShadow = true;
  group.add(mesh);
  return mesh;
}

function cylinder(
  THREE: typeof import('three'),
  group: ThreeNS.Group,
  radius: number,
  height: number,
  material: import('three').Material,
  options: PartOptions = {},
  segments = 16,
): ThreeNS.Mesh {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, height, segments), material);
  const [x, y, z] = options.position ?? [0, 0, 0];
  mesh.position.set(x, y, z);
  if (options.rotationY) mesh.rotation.y = options.rotationY;
  mesh.castShadow = options.shadow !== false;
  mesh.receiveShadow = true;
  group.add(mesh);
  return mesh;
}

/** 四坡顶（方形金字塔）：ConeGeometry 四段旋转 45°，再把底面拉到占地尺寸。 */
function pyramidRoof(
  THREE: typeof import('three'),
  group: ThreeNS.Group,
  width: number,
  depth: number,
  height: number,
  material: import('three').Material,
  baseY: number,
  overhang = 0.18,
): void {
  const w = width + overhang * 2;
  const d = depth + overhang * 2;
  const geometry = new THREE.ConeGeometry(1, 1, 4, 1, false);
  geometry.rotateY(Math.PI / 4);
  // 四段锥旋转 45° 后底面是轴对齐方形，半边长 0.7071。
  geometry.scale((w / 2) / 0.7071, height, (d / 2) / 0.7071);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.y = baseY + height / 2;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
}

/** 帐篷 / 医疗帐篷：四角立柱 + 顶棚 + 檐裙。 */
function buildTent(THREE: typeof import('three'), width: number, depth: number): ThreeNS.Group {
  const group = new THREE.Group();
  const postHeight = 2.15;
  const roofHeight = Math.min(1.5, Math.max(0.85, width * 0.24));
  const postMat = standard(THREE, PALETTE.metal, { roughness: 0.6, metalness: 0.5 });
  const fabricMat = standard(THREE, PALETTE.fabric, { roughness: 0.95, side: THREE.DoubleSide });
  const skirtMat = standard(THREE, PALETTE.fabricShadow, { roughness: 0.95, side: THREE.DoubleSide });

  const inset = 0.09;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const post = cylinder(THREE, group, 0.05, postHeight, postMat, {
        position: [sx * (width / 2 - inset), postHeight / 2, sz * (depth / 2 - inset)],
      });
      post.castShadow = true;
    }
  }
  // 檐裙：顶棚下沿一圈 0.32 m 的布边，远看就有「帐篷」的轮廓。
  box(THREE, group, [width, 0.32, depth], skirtMat, { position: [0, postHeight - 0.16, 0] });
  pyramidRoof(THREE, group, width, depth, roofHeight, fabricMat, postHeight);
  return group;
}

/** 舞台：台面 + 后场桁架 + 两只音箱 + 前缘灯带。 */
function buildStage(THREE: typeof import('three'), width: number, depth: number): ThreeNS.Group {
  const group = new THREE.Group();
  const deckHeight = 0.7;
  const deckMat = standard(THREE, PALETTE.dark, { roughness: 0.85 });
  const metalMat = standard(THREE, PALETTE.metal, { roughness: 0.45, metalness: 0.65 });
  const boxMat = standard(THREE, '#15181c', { roughness: 0.7 });
  const ledMat = standard(THREE, PALETTE.marquee, { roughness: 0.4, metalness: 0.2 });

  box(THREE, group, [width, deckHeight, depth], deckMat, { position: [0, deckHeight / 2, 0] });
  // 后场桁架（画布上方=北=−z，舞台背line 放在北侧）。
  const trussHeight = 4.1;
  const backZ = -depth / 2 + 0.25;
  for (const sx of [-1, 1]) {
    box(THREE, group, [0.14, trussHeight, 0.14], metalMat, {
      position: [sx * (width / 2 - 0.35), deckHeight + trussHeight / 2, backZ],
    });
  }
  box(THREE, group, [width - 0.3, 0.16, 0.16], metalMat, {
    position: [0, deckHeight + trussHeight, backZ],
  });
  // 挂灯：桁架下方三盏。
  for (const ratio of [-0.32, 0, 0.32]) {
    box(THREE, group, [0.26, 0.2, 0.26], boxMat, {
      position: [ratio * width, deckHeight + trussHeight - 0.3, backZ],
    });
  }
  // 音箱
  for (const sx of [-1, 1]) {
    box(THREE, group, [0.55, 0.95, 0.5], boxMat, {
      position: [sx * (width / 2 - 0.6), deckHeight + 0.48, backZ + 0.55],
    });
  }
  // 前缘灯带（贴近台面，不挡住占位感）
  box(THREE, group, [width * 0.92, 0.06, 0.08], ledMat, {
    position: [0, deckHeight + 0.03, depth / 2 - 0.06],
  });
  return group;
}

/** 市集摊位：柜台 + 四角立柱 + 平顶棚 + 背板招牌。 */
function buildKiosk(THREE: typeof import('three'), width: number, depth: number): ThreeNS.Group {
  const group = new THREE.Group();
  const counterMat = standard(THREE, PALETTE.wood, { roughness: 0.9 });
  const postMat = standard(THREE, PALETTE.metal, { roughness: 0.6, metalness: 0.5 });
  const canopyMat = standard(THREE, PALETTE.marquee, { roughness: 0.85, side: THREE.DoubleSide });
  const boardMat = standard(THREE, PALETTE.white, { roughness: 0.9 });
  const signMat = standard(THREE, PALETTE.accent, { roughness: 0.8 });

  box(THREE, group, [width * 0.94, 0.95, depth * 0.5], counterMat, {
    position: [0, 0.48, depth * 0.2],
  });
  const canopyY = 2.35;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      cylinder(THREE, group, 0.04, canopyY, postMat, {
        position: [sx * (width / 2 - 0.06), canopyY / 2, sz * (depth / 2 - 0.06)],
      });
    }
  }
  box(THREE, group, [width + 0.24, 0.08, depth + 0.24], canopyMat, { position: [0, canopyY, 0] });
  // 背板 + 招牌色条
  box(THREE, group, [width * 0.94, 0.62, 0.06], boardMat, {
    position: [0, 1.62, -depth / 2 + 0.12],
  });
  box(THREE, group, [width * 0.94, 0.12, 0.08], signMat, {
    position: [0, 1.96, -depth / 2 + 0.13],
  });
  return group;
}

/** 餐车：车身 + 驾驶室 + 四轮 + 售卖窗 + 遮阳篷。 */
function buildFoodTruck(THREE: typeof import('three'), width: number, depth: number): ThreeNS.Group {
  const group = new THREE.Group();
  const bodyMat = standard(THREE, PALETTE.body, { roughness: 0.55, metalness: 0.15 });
  const cabMat = standard(THREE, PALETTE.white, { roughness: 0.5, metalness: 0.2 });
  const glassMat = standard(THREE, PALETTE.glass, { roughness: 0.25, metalness: 0.1 });
  const tireMat = standard(THREE, '#23262b', { roughness: 0.95 });
  const awningMat = standard(THREE, PALETTE.accent, { roughness: 0.85, side: THREE.DoubleSide });

  const wheelR = 0.34;
  const bodyHeight = 2.25;
  const bodyLength = width * 0.78;
  const bodyX = width * 0.11;
  box(THREE, group, [bodyLength, bodyHeight, depth], bodyMat, {
    position: [bodyX, wheelR + bodyHeight / 2, 0],
  });
  box(THREE, group, [width * 0.22, 1.55, depth * 0.94], cabMat, {
    position: [-width / 2 + width * 0.11, wheelR + 0.78, 0],
  });
  // 挡风玻璃
  box(THREE, group, [0.06, 0.55, depth * 0.8], glassMat, {
    position: [-width / 2 + 0.04, wheelR + 1.25, 0],
  });
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const wheel = cylinder(THREE, group, wheelR, 0.22, tireMat, {
        position: [sx * width * 0.28, wheelR, sz * (depth / 2 - 0.06)],
        rotationY: Math.PI / 2,
      });
      wheel.rotation.z = Math.PI / 2;
    }
  }
  // 售卖窗 + 遮阳篷（行人一侧 = +z）
  box(THREE, group, [bodyLength * 0.62, 0.75, 0.05], glassMat, {
    position: [bodyX, wheelR + 1.6, depth / 2 + 0.02],
  });
  box(THREE, group, [bodyLength * 0.7, 0.06, 0.85], awningMat, {
    position: [bodyX, wheelR + 2.1, depth / 2 + 0.42],
  });
  return group;
}

/** 移动洗手间：厢体 + 顶板 + 门 + 通风口。 */
function buildToilet(THREE: typeof import('three'), width: number, depth: number): ThreeNS.Group {
  const group = new THREE.Group();
  const bodyMat = standard(THREE, PALETTE.body, { roughness: 0.7 });
  const doorMat = standard(THREE, '#7d8894', { roughness: 0.75 });
  const roofMat = standard(THREE, PALETTE.white, { roughness: 0.8 });

  const height = 2.25;
  box(THREE, group, [width * 0.94, height, depth * 0.94], bodyMat, { position: [0, height / 2, 0] });
  box(THREE, group, [width, 0.1, depth], roofMat, { position: [0, height + 0.05, 0] });
  box(THREE, group, [width * 0.55, height * 0.78, 0.05], doorMat, {
    position: [0, height * 0.42, depth * 0.47 + 0.03],
  });
  box(THREE, group, [0.16, 0.07, 0.05], standard(THREE, PALETTE.metal), {
    position: [width * 0.2, height * 0.5, depth * 0.47 + 0.06],
  });
  box(THREE, group, [0.28, 0.1, 0.05], standard(THREE, PALETTE.binGray), {
    position: [0, height - 0.18, depth * 0.47 + 0.05],
  });
  return group;
}

/** 安保岗亭：基座 + 亭身 + 出檐顶 + 玻璃窗带。 */
function buildPost(THREE: typeof import('three'), width: number, depth: number): ThreeNS.Group {
  const group = new THREE.Group();
  const baseMat = standard(THREE, PALETTE.dark, { roughness: 0.9 });
  const bodyMat = standard(THREE, '#3f6b8a', { roughness: 0.7 });
  const glassMat = standard(THREE, PALETTE.glass, { roughness: 0.25, metalness: 0.1 });
  const roofMat = standard(THREE, PALETTE.white, { roughness: 0.8 });

  box(THREE, group, [width, 0.22, depth], baseMat, { position: [0, 0.11, 0] });
  const height = 2.05;
  box(THREE, group, [width * 0.86, height, depth * 0.86], bodyMat, {
    position: [0, 0.22 + height / 2, 0],
  });
  box(THREE, group, [width * 0.74, 0.62, 0.04], glassMat, {
    position: [0, 0.22 + height * 0.66, depth * 0.43 + 0.02],
  });
  box(THREE, group, [width * 1.12, 0.12, depth * 1.12], roofMat, { position: [0, 0.22 + height + 0.06, 0] });
  return group;
}

/** 垃圾收集点：两只分类桶。 */
function buildBin(THREE: typeof import('three'), width: number, depth: number): ThreeNS.Group {
  const group = new THREE.Group();
  const radius = Math.max(0.16, Math.min(width, depth) * 0.26);
  const height = 1.0;
  const materials = [standard(THREE, PALETTE.bin, { roughness: 0.8 }), standard(THREE, PALETTE.binGray, { roughness: 0.8 })];
  materials.forEach((material, index) => {
    const offset = (index - 0.5) * radius * 2.4;
    cylinder(THREE, group, radius, height, material, {
      position: [Math.abs(offset) < 0.01 ? 0 : offset, height / 2, 0],
    });
    cylinder(THREE, group, radius * 1.06, 0.09, standard(THREE, PALETTE.dark), {
      position: [Math.abs(offset) < 0.01 ? 0 : offset, height + 0.05, 0],
    });
  });
  return group;
}

/** 兜底：一块可辨认的低块（未知模板也不至于什么都不立）。 */
function buildMisc(THREE: typeof import('three'), width: number, depth: number): ThreeNS.Group {
  const group = new THREE.Group();
  const material = standard(THREE, PALETTE.binGray, { roughness: 0.9 });
  box(THREE, group, [width * 0.9, 1.1, depth * 0.9], material, { position: [0, 0.55, 0] });
  return group;
}

/** 一个设施的 3D 物件（不含定位；调用方负责摆位与朝向）。 */
export function buildPlanPropObject(THREE: typeof import('three'), prop: PlanPropShape): ThreeNS.Group {
  const width = Math.max(0.6, prop.width);
  const depth = Math.max(0.6, prop.depth);
  switch (prop.kind) {
    case 'tent':
      return buildTent(THREE, width, depth);
    case 'stage':
      return buildStage(THREE, width, depth);
    case 'kiosk':
      return buildKiosk(THREE, width, depth);
    case 'foodTruck':
      return buildFoodTruck(THREE, width, depth);
    case 'toilet':
      return buildToilet(THREE, width, depth);
    case 'post':
      return buildPost(THREE, width, depth);
    case 'bin':
      return buildBin(THREE, width, depth);
    default:
      return buildMisc(THREE, width, depth);
  }
}

/** 地面文字标签：贴在场地上的「画在地面」文字，抬头方向=平面图上方=北。 */
export function buildGroundLabel(
  THREE: typeof import('three'),
  text: string,
  at: ShellPoint,
  metrics: { width: number; depth: number },
  options: { widthM: number; y: number; color?: string; bold?: boolean } = { widthM: 3, y: 0.06 },
): ThreeNS.Mesh | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const doc = typeof document === 'undefined' ? null : document;
  const canvas = doc?.createElement('canvas');
  if (!canvas) return null;
  const context = canvas.getContext('2d');
  if (!context) return null;
  const fontSize = 44;
  canvas.width = 512;
  canvas.height = 128;
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.font = `${options.bold ? '600' : '500'} ${fontSize}px "PingFang SC", "Microsoft YaHei", system-ui, sans-serif`;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillStyle = options.color ?? '#ffffff';
  // 深色描边让文字在浅色底图与饱和色块上都读得出来。
  context.lineWidth = 7;
  context.strokeStyle = 'rgba(12, 16, 22, 0.72)';
  context.strokeText(trimmed, canvas.width / 2, canvas.height / 2);
  context.fillText(trimmed, canvas.width / 2, canvas.height / 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  const heightM = options.widthM * (canvas.height / canvas.width);
  const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(options.widthM, heightM), material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(at.x - metrics.width / 2, options.y, at.z - metrics.depth / 2);
  mesh.renderOrder = 3;
  return mesh;
}