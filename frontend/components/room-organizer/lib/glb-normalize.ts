import * as THREE from 'three';

/**
 * Blender / Lux3D 产物进编辑器前的唯一一道尺度归一化。
 *
 * glTF 规范本来就是 Y-up、米制，Blender 官方导出器也会把 Z-up 转成 Y-up；
 * 但「直接导出的 .glb」、手工导出的厘米单位、或从别的 DCC 转来的文件仍会带病进来。
 * 这里把规则写死，避免在编辑器里散着 scale/rotation 补丁：
 *
 * - 单位：最长边 ≥ 20 视为厘米建模，统一乘 0.01；否则按米。
 * - 轴向：只有 z 比 x、y 都大 25% 才当 Z-up（说明它是竖着的物件），绕 X 转 -90°；
 *   矮宽物件（桌、床、地毯）从包围盒分不出 Z-up，宁可不动，避免误转。
 * - 基准点：用 Box3（遍历 matrixWorld，不是单个 geometry.boundingBox）算出包围盒，
 *   把「底面中心」移到原点：x/z 居中、y 贴地。
 * - 合理尺寸：归一化后最长边必须落在 0.005–50 m；超出就报错，不猜。
 */

/** 最长边 ≥ 20 m 视为厘米建模：椅子 100 而不是 1.0。 */
export const GLB_CENTIMETER_THRESHOLD = 20;
/** 1 cm → 0.01 m。 */
export const GLB_CENTIMETER_SCALE = 0.01;
/** 归一化后最长边上限（与编辑器 MAX_ITEM_DIMENSION 一致）。 */
export const GLB_MAX_METERS = 50;
/** 归一化后最长边下限：小于 5 mm 的物件在场地里没有意义。 */
export const GLB_MIN_METERS = 0.005;
/** z 必须比 x、y 至少大 25% 才当 Z-up。 */
export const GLB_Z_UP_RATIO = 1.25;

export type GlbUnit = 'm' | 'cm';
export type GlbUpAxis = 'y' | 'z';
export type GlbDimensions = { width: number; depth: number; height: number };
export type GlbVector = { x: number; y: number; z: number };
export type GlbBounds = { min: GlbVector; max: GlbVector };

export interface GlbNormalizationPlan {
  unit: GlbUnit;
  unitScale: number;
  upAxis: GlbUpAxis;
  /** 绕 X 轴旋转的弧度；Y-up 为 0，Z-up 为 -π/2。 */
  rotateX: number;
  /** 把底面中心挪到原点所需的位移（按归一化后的轴计算）。 */
  pivot: GlbVector;
  /** 原始包围盒尺寸（归一化前，glTF 轴序）。 */
  sourceSize: GlbDimensions;
  /** 归一化后的宽深高（米）。 */
  size: GlbDimensions;
}

export interface GlbNormalizeOptions {
  /** 已知轴向时传进来，覆盖包围盒猜测。 */
  upAxis?: GlbUpAxis;
  /** 已知单位时传进来，覆盖最长边猜测。 */
  unit?: GlbUnit;
  /** 朝前轴修正：模型建成朝 -Z 时传 π；默认 0（朝 +Z）。 */
  yaw?: number;
}

function sizeOf(bounds: GlbBounds): GlbDimensions {
  return {
    width: bounds.max.x - bounds.min.x,
    depth: bounds.max.z - bounds.min.z,
    height: bounds.max.y - bounds.min.y,
  };
}

function validBox(bounds: GlbBounds): boolean {
  return [bounds.min.x, bounds.min.y, bounds.min.z, bounds.max.x, bounds.max.y, bounds.max.z]
    .every(n => Number.isFinite(n)) &&
    bounds.max.x > bounds.min.x && bounds.max.y > bounds.min.y && bounds.max.z > bounds.min.z;
}

/** 从世界坐标包围盒换算出场景里可摆放的宽深高（glTF 轴序，未归一化）。 */
export function glbDimensionsOf(bounds: GlbBounds): GlbDimensions {
  if (!validBox(bounds)) throw new Error('模型包围盒无效，无法设定尺寸。');
  return sizeOf(bounds);
}

/** 最长边 ≥ 20 m 按厘米；其余按米。阈值写死，不做“猜得更聪明”的启发式。 */
export function detectGlbUnit(size: GlbDimensions): { unit: GlbUnit; unitScale: number } {
  const longest = Math.max(size.width, size.depth, size.height);
  return longest >= GLB_CENTIMETER_THRESHOLD
    ? { unit: 'cm', unitScale: GLB_CENTIMETER_SCALE }
    : { unit: 'm', unitScale: 1 };
}

/** 只有 z 明显是“最长且竖着”的轴时才当 Z-up，矮宽物件一律按 Y-up。 */
export function detectGlbUpAxis(rawSize: GlbDimensions): GlbUpAxis {
  return rawSize.depth >= Math.max(rawSize.width, rawSize.height) * GLB_Z_UP_RATIO ? 'z' : 'y';
}

export function planGlbNormalization(bounds: GlbBounds, options: GlbNormalizeOptions = {}): GlbNormalizationPlan {
  const sourceSize = glbDimensionsOf(bounds);
  const unit = options.unit
    ? { unit: options.unit, unitScale: options.unit === 'cm' ? GLB_CENTIMETER_SCALE : 1 }
    : detectGlbUnit(sourceSize);
  const upAxis = options.upAxis ?? detectGlbUpAxis(sourceSize);
  const rotateX = upAxis === 'z' ? -Math.PI / 2 : 0;
  const centerX = (bounds.min.x + bounds.max.x) / 2;
  const centerY = (bounds.min.y + bounds.max.y) / 2;
  const centerZ = (bounds.min.z + bounds.max.z) / 2;
  // 旋转 -90° 后：x' = x、y' = z、z' = -y。
  const pivot: GlbVector = upAxis === 'z'
    ? { x: -centerX, y: -bounds.min.z, z: centerY }
    : { x: -centerX, y: -bounds.min.y, z: -centerZ };
  const size: GlbDimensions = (upAxis === 'z'
    ? { width: sourceSize.width, depth: sourceSize.height, height: sourceSize.depth }
    : sourceSize);
  const normalized: GlbDimensions = {
    width: size.width * unit.unitScale,
    depth: size.depth * unit.unitScale,
    height: size.height * unit.unitScale,
  };
  return {
    unit: unit.unit,
    unitScale: unit.unitScale,
    upAxis,
    rotateX,
    pivot: {
      x: pivot.x * unit.unitScale,
      y: pivot.y * unit.unitScale,
      z: pivot.z * unit.unitScale,
    },
    sourceSize,
    size: normalized,
  };
}

function assertNormalizedSize(size: THREE.Vector3): void {
  const longest = Math.max(size.x, size.y, size.z);
  const shortest = Math.min(size.x, size.y, size.z);
  if (!Number.isFinite(longest) || !Number.isFinite(shortest) || shortest <= 0) {
    throw new Error('模型包围盒无效，无法设定尺寸。');
  }
  if (longest > GLB_MAX_METERS) throw new Error(`模型尺寸异常（最长边 ${longest.toFixed(1)} 米），未载入。`);
  if (longest < GLB_MIN_METERS) throw new Error(`模型尺寸异常（最长边 ${(longest * 1000).toFixed(1)} 毫米），未载入。`);
}

/**
 * 把任意 GLB 场景包成「米制、Y-up、底面中心在原点」的模板。
 * 返回的 group 就是缓存里长期持有的那一份；调用方只克隆它，不再二次改 transform。
 */
export function normalizeGlbRoot(source: THREE.Object3D, options: GlbNormalizeOptions = {}): {
  root: THREE.Group;
  plan: GlbNormalizationPlan;
  size: GlbDimensions;
} {
  source.updateMatrixWorld(true);
  const rawBox = new THREE.Box3().setFromObject(source);
  if (!validBox({ min: rawBox.min, max: rawBox.max })) throw new Error('模型包围盒无效，无法设定尺寸。');
  const plan = planGlbNormalization({ min: rawBox.min, max: rawBox.max }, options);

  const axis = new THREE.Group();
  axis.name = 'glb-axis';
  axis.rotation.x = plan.rotateX;
  axis.add(source);

  const scaled = new THREE.Group();
  scaled.name = 'glb-unit';
  scaled.scale.setScalar(plan.unitScale);
  scaled.add(axis);

  const outer = options.yaw
    ? (() => { const group = new THREE.Group(); group.name = 'glb-yaw'; group.rotation.y = options.yaw!; group.add(scaled); return group; })()
    : scaled;

  outer.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(outer);
  const size = box.getSize(new THREE.Vector3());
  assertNormalizedSize(size);
  const center = box.getCenter(new THREE.Vector3());

  const root = new THREE.Group();
  root.name = 'glb-normalized';
  root.position.set(-center.x, -box.min.y, -center.z);
  root.add(outer);
  root.updateMatrixWorld(true);

  return {
    root,
    plan: { ...plan, pivot: { x: -center.x, y: -box.min.y, z: -center.z } },
    size: { width: size.x, depth: size.z, height: size.y },
  };
}
