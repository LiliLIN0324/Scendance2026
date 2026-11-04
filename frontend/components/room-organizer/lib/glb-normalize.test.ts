import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  GLB_CENTIMETER_THRESHOLD,
  GLB_MAX_METERS,
  GLB_MIN_METERS,
  GLB_Z_UP_RATIO,
  normalizeGlbRoot,
  planGlbNormalization,
} from './glb-normalize';

function box(width: number, height: number, depth: number): THREE.Mesh {
  return new THREE.Mesh(new THREE.BoxGeometry(width, height, depth));
}

function actual(object: THREE.Object3D) {
  object.updateMatrixWorld(true);
  const box3 = new THREE.Box3().setFromObject(object);
  const size = box3.getSize(new THREE.Vector3());
  const center = box3.getCenter(new THREE.Vector3());
  return {
    width: size.x, depth: size.z, height: size.y,
    minY: box3.min.y, centerX: center.x, centerZ: center.z,
  };
}

describe('GLB 尺度归一化', () => {
  it('米制 Y-up 物件：只把底面中心挪到原点，尺寸不变', () => {
    const source = box(2, 1, 0.5);
    source.position.set(5, 3, -7);
    const { root, plan } = normalizeGlbRoot(source);
    expect(plan).toMatchObject({ unit: 'm', unitScale: 1, upAxis: 'y', rotateX: 0 });
    expect(plan.size).toEqual({ width: 2, depth: 0.5, height: 1 });
    const size = actual(root);
    expect(size.width).toBeCloseTo(2, 5);
    expect(size.depth).toBeCloseTo(0.5, 5);
    expect(size.height).toBeCloseTo(1, 5);
    expect(size.minY).toBeCloseTo(0, 5);
    expect(size.centerX).toBeCloseTo(0, 5);
    expect(size.centerZ).toBeCloseTo(0, 5);
  });

  it('厘米单位：最长边 ≥ 20 一律乘 0.01，宽深高按米换算', () => {
    const { root, plan } = normalizeGlbRoot(box(100, 80, 60));
    expect(plan).toMatchObject({ unit: 'cm', unitScale: 0.01, upAxis: 'y' });
    expect(plan.size).toEqual({ width: 1, depth: 0.6, height: 0.8 });
    const size = actual(root);
    expect(size.width).toBeCloseTo(1, 5);
    expect(size.depth).toBeCloseTo(0.6, 5);
    expect(size.height).toBeCloseTo(0.8, 5);
    expect(size.minY).toBeCloseTo(0, 5);
  });

  it('Z-up：z 明显是最长轴时绕 X 转 -90°，原 z 变成高度', () => {
    const { root, plan } = normalizeGlbRoot(box(0.6, 0.6, 1.8));
    expect(plan).toMatchObject({ upAxis: 'z', rotateX: -Math.PI / 2 });
    expect(plan.size.width).toBeCloseTo(0.6, 5);
    expect(plan.size.depth).toBeCloseTo(0.6, 5);
    expect(plan.size.height).toBeCloseTo(1.8, 5);
    const size = actual(root);
    expect(size.width).toBeCloseTo(0.6, 5);
    expect(size.depth).toBeCloseTo(0.6, 5);
    expect(size.height).toBeCloseTo(1.8, 5);
    expect(size.minY).toBeCloseTo(0, 5);
  });

  it('矮宽物件不误判 Z-up：床/沙发这种 z 长但 x 更长的按 Y-up 保留', () => {
    const { plan } = normalizeGlbRoot(box(2.2, 0.5, 2.0));
    expect(plan).toMatchObject({ unit: 'm', upAxis: 'y', rotateX: 0 });
    expect(plan.size.width).toBeCloseTo(2.2, 5);
    expect(plan.size.depth).toBeCloseTo(2.0, 5);
    expect(plan.size.height).toBeCloseTo(0.5, 5);
  });

  it('显式 upAxis / unit 覆盖包围盒猜测', () => {
    const plan = planGlbNormalization(
      { min: { x: 0, y: 0, z: 0 }, max: { x: 100, y: 60, z: 80 } },
      { unit: 'm', upAxis: 'z' },
    );
    expect(plan).toMatchObject({ unit: 'm', unitScale: 1, upAxis: 'z' });
    expect(plan.size).toEqual({ width: 100, depth: 60, height: 80 });
  });

  it('超大包围盒在厘米换算后仍超限就报错，不缩成错误尺寸', () => {
    expect(() => normalizeGlbRoot(box(100_000, 1_000, 1_000))).toThrow(/模型尺寸异常（最长边 1000\.0 米）/);
    expect(GLB_MAX_METERS).toBe(50);
  });

  it('过小包围盒直接拒绝', () => {
    expect(() => normalizeGlbRoot(box(0.001, 0.001, 0.001))).toThrow('模型尺寸异常');
  });

  it('无网格的空节点没有包围盒，也会被拒绝', () => {
    expect(() => normalizeGlbRoot(new THREE.Group())).toThrow('模型包围盒无效');
  });
});

describe('归一化参数边界', () => {
  const bounds = (width: number, height: number, depth: number) => ({
    min: { x: 0, y: 0, z: 0 },
    max: { x: width, y: height, z: depth },
  });

  it('厘米阈值 20 是闭边界：19.999 仍按米，20 起按厘米', () => {
    expect(GLB_CENTIMETER_THRESHOLD).toBe(20);
    expect(planGlbNormalization(bounds(19.999, 1, 1)).unit).toBe('m');
    expect(planGlbNormalization(bounds(20, 1, 1)).unit).toBe('cm');
    expect(planGlbNormalization(bounds(20, 1, 1)).unitScale).toBe(0.01);
  });

  it('Z-up 判定只在 z 达到 x/y 最长值的 1.25 倍时成立', () => {
    expect(GLB_Z_UP_RATIO).toBe(1.25);
    expect(planGlbNormalization(bounds(1, 1, 1.25)).upAxis).toBe('z');
    expect(planGlbNormalization(bounds(1, 1, 1.24)).upAxis).toBe('y');
    // x 比 z 长时也按 Y-up，不会被 z 轴误转。
    expect(planGlbNormalization(bounds(1.3, 1, 1.25)).upAxis).toBe('y');
  });

  it('尺寸上限 50 m 是闭边界，超一点就报错', () => {
    expect(GLB_MAX_METERS).toBe(50);
    expect(() => normalizeGlbRoot(box(50, 1, 1), { unit: 'm' })).not.toThrow();
    expect(() => normalizeGlbRoot(box(50.001, 1, 1), { unit: 'm' })).toThrow(/模型尺寸异常（最长边 50\.0 米）/);
  });

  it('尺寸下限 0.005 m：5.1 mm 可导入，4 mm 拒绝', () => {
    expect(GLB_MIN_METERS).toBe(0.005);
    expect(() => normalizeGlbRoot(box(0.0051, 0.0051, 0.0051))).not.toThrow();
    expect(() => normalizeGlbRoot(box(0.004, 0.004, 0.004))).toThrow('模型尺寸异常');
  });
});
