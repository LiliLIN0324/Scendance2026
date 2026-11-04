/**
 * 真实空间的落位数学：扫描点云局部坐标 → 场地世界坐标。
 *
 * 这一步决定「1 m 是不是 1 m、地面贴不贴、朝向对不对」。把它从渲染器里
 * 抽出来，是因为它必须能被单独量：给定已知尺寸的标定物（A4 = 210×297 mm），
 * 跑完之后它的世界尺寸、底面高度、朝向都应该有确定的数字。
 *
 * 落位顺序：上游竖直轴校正 → 绕竖直轴朝向 → 贴到基准面（含倾斜）→ 等比缩放
 * → 水平居中到场地原点、沿基准面法线把最低点压到地面上。
 */
import * as THREE from 'three';
import { groundHeightAt, type GroundPlane } from '../lib/site-capture';

const WORLD_UP = new THREE.Vector3(0, 1, 0);

/** 已解析的标定：比例必有、朝向必有、原点必有、基准面必有。 */
export interface ResolvedScanCalibration {
  scale: number;
  yawDeg: number;
  origin: { x: number; z: number };
  ground: GroundPlane;
}

export interface ScanFit {
  /** 作用在点云上的旋转：竖直轴校正 + 朝向 + 基准面倾斜。 */
  quaternion: THREE.Quaternion;
  scale: number;
  /** 点云原点在世界里的落点。 */
  position: THREE.Vector3;
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

/** 让世界「上」对到基准面法线的旋转；水平基准面时是单位四元数。 */
export function groundLevelQuaternion(ground: GroundPlane): THREE.Quaternion {
  const normal = new THREE.Vector3(ground.normal.x, ground.normal.y, ground.normal.z);
  if (!(normal.lengthSq() > 1e-12)) return new THREE.Quaternion();
  normal.normalize();
  if (normal.dot(WORLD_UP) > 0.999999) return new THREE.Quaternion();
  return new THREE.Quaternion().setFromUnitVectors(WORLD_UP, normal);
}

/** 朝向 + 贴面组合后的点云旋转。 */
export function scanQuaternion(
  upQuaternion: THREE.Quaternion,
  calibration: ResolvedScanCalibration
): THREE.Quaternion {
  const yaw = new THREE.Quaternion().setFromAxisAngle(WORLD_UP, THREE.MathUtils.degToRad(calibration.yawDeg));
  const level = groundLevelQuaternion(calibration.ground);
  return level.multiply(yaw).multiply(upQuaternion);
}

/** 给定原始包围盒，算出让它落进场地所需的旋转、比例与平移。 */
export function computeScanFit(
  localBox: THREE.Box3,
  upQuaternion: THREE.Quaternion,
  calibration: ResolvedScanCalibration
): ScanFit {
  const quaternion = scanQuaternion(upQuaternion, calibration);
  const rotated = rotatedBox(localBox, quaternion);
  const scale = calibration.scale;
  const center = rotated.getCenter(new THREE.Vector3());
  const position = new THREE.Vector3(
    -center.x * scale + calibration.origin.x,
    0,
    -center.z * scale + calibration.origin.z
  );
  // 基准面可能倾斜：沿法线把包围盒最低的角压到平面上，而不是一律压到 y = ground.y。
  const normal = new THREE.Vector3(
    calibration.ground.normal.x,
    calibration.ground.normal.y,
    calibration.ground.normal.z
  );
  if (!(normal.lengthSq() > 1e-12)) normal.copy(WORLD_UP);
  normal.normalize();
  const groundPoint = new THREE.Vector3(0, calibration.ground.y, 0);
  // 用原始盒子的角（转过之后）求最低点：旋转盒的 AABB 角会跑出去，量出来会偏高。
  let lowest = Infinity;
  const corner = new THREE.Vector3();
  for (const point of boxCorners(localBox)) {
    lowest = Math.min(lowest, normal.dot(corner.copy(point).applyQuaternion(quaternion)));
  }
  position.addScaledVector(normal, normal.dot(groundPoint) - (lowest * scale + normal.dot(position)));
  return { quaternion, scale, position };
}

/** 局部点 → 世界点，与渲染器完全同一套变换。 */
export function scanPointToWorld(
  point: THREE.Vector3,
  fit: Pick<ScanFit, 'quaternion' | 'scale' | 'position'>
): THREE.Vector3 {
  return point.clone().applyQuaternion(fit.quaternion).multiplyScalar(fit.scale).add(fit.position);
}

/**
 * 标定物实测：把一块已知尺寸的平板放进扫描坐标，落到世界里量它的尺寸与贴地。
 * 返回的尺寸是「渲染出来的米」，直接和真实尺寸比。
 */
export function measureCalibrationPlate(
  size: { width: number; depth: number },
  localBox: THREE.Box3,
  upQuaternion: THREE.Quaternion,
  calibration: ResolvedScanCalibration,
  plate: { x: number; y: number }
): Readonly<{
  width: number;
  depth: number;
  bottomY: number;
  groundHeight: number;
  groundError: number;
  headingDeg: number;
}> {
  const fit = computeScanFit(localBox, upQuaternion, calibration);
  const thickness = 0.001;
  const halfW = size.width / 2;
  const halfD = size.depth / 2;
  // 扫描是 Z-up：平板躺在 z = 0，X 是宽、Y 是深。
  const corners = [
    new THREE.Vector3(plate.x - halfW, plate.y - halfD, 0),
    new THREE.Vector3(plate.x + halfW, plate.y - halfD, 0),
    new THREE.Vector3(plate.x - halfW, plate.y + halfD, 0),
    new THREE.Vector3(plate.x + halfW, plate.y + halfD, 0),
    new THREE.Vector3(plate.x - halfW, plate.y - halfD, thickness),
    new THREE.Vector3(plate.x + halfW, plate.y - halfD, thickness),
    new THREE.Vector3(plate.x - halfW, plate.y + halfD, thickness),
    new THREE.Vector3(plate.x + halfW, plate.y + halfD, thickness),
  ].map(point => scanPointToWorld(point, fit));
  const box = new THREE.Box3().setFromPoints(corners);
  // 尺寸量相邻角之间的边，不量旋转后的 AABB（斜着放会把边撑大）。
  const [c00, c10, c01] = corners;
  const width = c10!.distanceTo(c00!);
  const depth = c01!.distanceTo(c00!);
  const center = box.getCenter(new THREE.Vector3());
  const groundHeight = groundHeightAt(calibration.ground, center.x, center.z);
  // 贴地：四个底角各自与所在位置的基准面比，取最大偏差。
  const groundError = Math.max(
    ...corners.slice(0, 4).map(point => Math.abs(point.y - groundHeightAt(calibration.ground, point.x, point.z)))
  );
  // 朝向：扫描 +Y（正前方）水平投影相对约定前向的夹角。
  // 约定：Z-up 扫描经竖直轴校正后，+Y 落到世界 -Z，和布置图的「北」一致。
  const forward = scanPointToWorld(new THREE.Vector3(plate.x, plate.y + 1, 0), fit)
    .sub(scanPointToWorld(new THREE.Vector3(plate.x, plate.y, 0), fit));
  forward.y = 0;
  const expected = new THREE.Vector3(0, 0, -1)
    .applyAxisAngle(WORLD_UP, THREE.MathUtils.degToRad(calibration.yawDeg));
  const headingDeg = THREE.MathUtils.radToDeg(forward.angleTo(expected));
  return {
    width,
    depth,
    bottomY: box.min.y,
    groundHeight,
    groundError,
    headingDeg: Math.min(headingDeg, Math.abs(360 - headingDeg)),
  };
}

function boxCorners(box: THREE.Box3): THREE.Vector3[] {
  const corners: THREE.Vector3[] = [];
  for (const x of [box.min.x, box.max.x]) {
    for (const y of [box.min.y, box.max.y]) {
      for (const z of [box.min.z, box.max.z]) corners.push(new THREE.Vector3(x, y, z));
    }
  }
  return corners;
}
