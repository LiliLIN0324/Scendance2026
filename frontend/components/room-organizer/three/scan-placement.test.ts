// @vitest-environment node
/**
 * 真实空间实测：把 A4（210×297 mm）当作标定物放进扫描坐标，
 * 读它在世界里的毫米尺寸、底面离基准面多少、朝向偏了几度。
 * 「改前」= 旧公式（只把包围盒底面压到 y = ground.y，不看基准面倾斜）；
 * 「改后」= computeScanFit（贴到基准面法线）。
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { groundFromThreePoints, groundHeightAt } from '../lib/site-capture';
import { measureCalibrationPlate, type ResolvedScanCalibration } from './scan-placement';
import { upAxisQuaternion, rotatedBox } from './splat-preview';

/** 一块 6 m × 5 m、高 3.2 m 的 Z-up 扫描。 */
const SCAN_BOX = new THREE.Box3(new THREE.Vector3(0, 0, 0), new THREE.Vector3(6, 5, 3.2));
const A4 = { width: 0.210, depth: 0.297 } as const;
const PLATE = { x: 5.2, y: 1.5 } as const;

function flatCalibration(): ResolvedScanCalibration {
  return {
    scale: 1,
    yawDeg: 0,
    origin: { x: 0, z: 0 },
    ground: { y: 0, normal: { x: 0, y: 1, z: 0 }, definedBy: 'height' },
  };
}

/** 改前的算法：完全不看基准面倾斜，只平移到 ground.y。 */
function legacyPlateMeasure(calibration: ResolvedScanCalibration) {
  const quaternion = new THREE.Quaternion()
    .setFromAxisAngle(new THREE.Vector3(0, 1, 0), THREE.MathUtils.degToRad(calibration.yawDeg))
    .multiply(upAxisQuaternion('Z'));
  const rotated = rotatedBox(SCAN_BOX, quaternion);
  const center = rotated.getCenter(new THREE.Vector3());
  const position = new THREE.Vector3(
    -center.x * calibration.scale + calibration.origin.x,
    -rotated.min.y * calibration.scale + calibration.ground.y,
    -center.z * calibration.scale + calibration.origin.z
  );
  const halfW = A4.width / 2;
  const halfD = A4.depth / 2;
  const corners = [
    [PLATE.x - halfW, PLATE.y - halfD, 0],
    [PLATE.x + halfW, PLATE.y - halfD, 0],
    [PLATE.x - halfW, PLATE.y + halfD, 0],
    [PLATE.x + halfW, PLATE.y + halfD, 0],
    [PLATE.x - halfW, PLATE.y - halfD, 0.001],
    [PLATE.x + halfW, PLATE.y - halfD, 0.001],
    [PLATE.x - halfW, PLATE.y + halfD, 0.001],
    [PLATE.x + halfW, PLATE.y + halfD, 0.001],
  ].map(([x, y, z]) => new THREE.Vector3(x, y, z).applyQuaternion(quaternion).multiplyScalar(calibration.scale).add(position));
  const box = new THREE.Box3().setFromPoints(corners);
  const size = box.getSize(new THREE.Vector3());
  const centerWorld = box.getCenter(new THREE.Vector3());
  return {
    width: size.x,
    depth: size.z,
    groundError: Math.abs(box.min.y - groundHeightAt(calibration.ground, centerWorld.x, centerWorld.z)),
  };
}

describe('真实空间实测（A4 标定物）', () => {
  it('平整场地：1 m 就是 1 m，贴地、朝向都对', () => {
    const calibration = flatCalibration();
    const hit = measureCalibrationPlate(A4, SCAN_BOX, upAxisQuaternion('Z'), calibration, PLATE);
    console.log(
      `[空间] 平场 A4：${(hit.width * 1000).toFixed(1)}×${(hit.depth * 1000).toFixed(1)} mm，` +
      `底面 ${(hit.bottomY * 1000).toFixed(1)} mm，贴地误差 ${(hit.groundError * 1000).toFixed(1)} mm，朝向误差 ${hit.headingDeg.toFixed(2)}°`
    );
    expect(Math.abs(hit.width - A4.width) / A4.width).toBeLessThan(0.01);
    expect(Math.abs(hit.depth - A4.depth) / A4.depth).toBeLessThan(0.01);
    expect(hit.groundError).toBeLessThan(0.02);
    expect(hit.headingDeg).toBeLessThan(2);
  });

  it('倾斜基准面（三点定面 3°）：场地边缘改前贴地 11 cm，改后 0', () => {
    // 3° 倾斜：正常 (sin3°, cos3°, 0)，x 越大地面越低。
    const ground = groundFromThreePoints(
      { x: 0, y: 0, z: 0 },
      { x: 10, y: -10 * Math.tan((3 * Math.PI) / 180), z: 0 },
      { x: 0, y: 0, z: 6 }
    );
    expect(ground).not.toBeNull();
    const calibration: ResolvedScanCalibration = { scale: 1, yawDeg: 0, origin: { x: 0, z: 0 }, ground: { ...ground!, normal: ground!.normal } };
    const before = legacyPlateMeasure(calibration);
    const after = measureCalibrationPlate(A4, SCAN_BOX, upAxisQuaternion('Z'), calibration, PLATE);
    console.log(
      `[空间] 斜场 A4：改前贴地 ${(before.groundError * 1000).toFixed(1)} mm，` +
      `改后贴地 ${(after.groundError * 1000).toFixed(1)} mm；尺寸 ${(after.width * 1000).toFixed(1)}×${(after.depth * 1000).toFixed(1)} mm，朝向 ${after.headingDeg.toFixed(2)}°`
    );
    expect(before.groundError).toBeGreaterThan(0.02);
    expect(after.groundError).toBeLessThan(0.02);
    expect(Math.abs(after.width - A4.width) / A4.width).toBeLessThan(0.01);
    expect(after.headingDeg).toBeLessThan(2);
  });

  it('带比例 / 朝向 / 原点 / 地面高度时，三条不变量仍然成立', () => {
    const calibration: ResolvedScanCalibration = {
      scale: 1.25,
      yawDeg: 47,
      origin: { x: 2.4, z: -1.2 },
      ground: { y: 0.12, normal: { x: 0, y: 1, z: 0 }, definedBy: 'height' },
    };
    const hit = measureCalibrationPlate(A4, SCAN_BOX, upAxisQuaternion('Z'), calibration, PLATE);
    // 比例 1.25 时，A4 会渲染成 1.25 倍；这就是「扫描米 × 比例 = 真实米」。
    expect(Math.abs(hit.width - A4.width * 1.25) / (A4.width * 1.25)).toBeLessThan(0.01);
    expect(hit.groundError).toBeLessThan(0.02);
    expect(hit.headingDeg).toBeLessThan(2);
  });
});
