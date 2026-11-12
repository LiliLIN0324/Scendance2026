import { describe, expect, it } from 'vitest';
import type { PlanPoint } from '../../../../supabase/functions/_shared/site-plan';
import { planShellFrame } from './plan-footprint-geometry';
import {
  planBoundaryBounds,
  planItemFootprints,
  planPointOfScene,
  planSceneFootprint,
  planSceneObjects,
} from './plan-item-bridge';
import type { FurnitureItem } from './types';

/** 一个 10×8 m 的平面边界（x 东、y 北）。 */
const BOUNDARY: PlanPoint[] = [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
  { x: 10, y: 8 },
  { x: 0, y: 8 },
];

/** 场地壳体尺寸（米）。 */
const SHELL = { width: 20, depth: 16 };

function makeItem(overrides: Partial<FurnitureItem> & { id: string }): FurnitureItem {
  return {
    type: 'table',
    name: '圆桌',
    width: 1.2,
    depth: 1.2,
    height: 0.75,
    color: '#8899aa',
    icon: 'table',
    ...overrides,
  } as FurnitureItem;
}

describe('plan-item-bridge（室内世界 → 户外 2D 平面坐标）', () => {
  it('planPointOfScene 把壳体 z（南为正）翻成平面 y（北为正）', () => {
    expect(planPointOfScene(3, 5)).toEqual({ x: 3, y: -5 });
    expect(planPointOfScene(0, 0)).toEqual({ x: 0, y: 0 });
  });

  it('planBoundaryBounds 给出外接框，退化输入返回 null', () => {
    expect(planBoundaryBounds(BOUNDARY)).toMatchObject({
      minX: 0,
      minY: 0,
      maxX: 10,
      maxY: 8,
      width: 10,
      height: 8,
    });
    // 点数不足
    expect(planBoundaryBounds([{ x: 0, y: 0 }, { x: 1, y: 1 }])).toBeNull();
    // 面积为零（一条线）
    expect(
      planBoundaryBounds([
        { x: 0, y: 0 },
        { x: 5, y: 0 },
        { x: 10, y: 0 },
      ]),
    ).toBeNull();
  });

  it('物料中心是 toShell 的逆变换（往返一致）', () => {
    const frame = planShellFrame(BOUNDARY, SHELL);
    expect(frame).not.toBeNull();
    const planPoint: PlanPoint = { x: 4, y: 3 };
    const shell = frame!.toShell(planPoint);

    const objects = planItemFootprints(
      [makeItem({ id: 'sofa-1', position: { x: shell.x, z: shell.z } })],
      { boundary: BOUNDARY, ...SHELL },
    );

    expect(objects).toHaveLength(1);
    const object = objects[0]!;
    expect(object.id).toBe('item:sofa-1');
    expect(object.kind).toBe('item');
    expect(object.center.x).toBeCloseTo(planPoint.x, 6);
    expect(object.center.y).toBeCloseTo(planPoint.y, 6);
    // 往返：落回壳体应得到原值
    const back = frame!.toShell(object.center);
    expect(back.x).toBeCloseTo(shell.x, 6);
    expect(back.z).toBeCloseTo(shell.z, 6);
  });

  it('没有 position 的物料被跳过', () => {
    const objects = planItemFootprints(
      [makeItem({ id: 'no-pos' }), makeItem({ id: 'with-pos', position: { x: 1, z: 2 } })],
      { boundary: BOUNDARY, ...SHELL },
    );
    expect(objects.map(object => object.id)).toEqual(['item:with-pos']);
  });

  it('边界退化时退回「壳体坐标直接翻向」的近似落位', () => {
    const objects = planItemFootprints(
      [makeItem({ id: 'a', position: { x: 2, z: 3 } })],
      { boundary: [{ x: 0, y: 0 }], ...SHELL },
    );
    expect(objects[0]!.center).toEqual({ x: 2, y: -3 });
  });

  it('rotationDeg 取反（壳体弧度 → 平面度，逆时针为正）', () => {
    const objects = planItemFootprints(
      [makeItem({ id: 'r', position: { x: 1, z: 1 }, rotation: Math.PI / 2 })],
      { boundary: BOUNDARY, ...SHELL },
    );
    expect(objects[0]!.rotationDeg).toBeCloseTo(-90, 6);

    const noRotation = planItemFootprints(
      [makeItem({ id: 'r0', position: { x: 1, z: 1 } })],
      { boundary: BOUNDARY, ...SHELL },
    );
    expect(noRotation[0]!.rotationDeg).toBe(0);
  });

  it('尺寸与高度有下限，颜色只接受十六进制', () => {
    const objects = planItemFootprints(
      [
        makeItem({
          id: 'zero',
          position: { x: 1, z: 1 },
          width: 0,
          depth: -2,
          height: 0,
          color: 'not-a-color',
        }),
      ],
      { boundary: BOUNDARY, ...SHELL },
    );
    expect(objects[0]).toMatchObject({ width: 1, depth: 1, height: 0.5, color: '#9aa7b5' });

    const withHex = planItemFootprints(
      [makeItem({ id: 'hex', position: { x: 1, z: 1 }, color: '#8899aa' })],
      { boundary: BOUNDARY, ...SHELL },
    );
    expect(withHex[0]!.color).toBe('#8899aa');
  });

  it('modelUrl / assetId 只在有值时出现', () => {
    const objects = planItemFootprints(
      [
        makeItem({ id: 'plain', position: { x: 1, z: 1 } }),
        makeItem({
          id: 'rich',
          position: { x: 1, z: 1 },
          glbUrl: 'https://example.com/a.glb',
          assetId: 'asset-1',
        }),
      ],
      { boundary: BOUNDARY, ...SHELL },
    );
    expect(objects[0]!.modelUrl).toBeUndefined();
    expect(objects[0]!.assetId).toBeUndefined();
    expect(objects[1]!.modelUrl).toBe('https://example.com/a.glb');
    expect(objects[1]!.assetId).toBe('asset-1');
  });

  it('没有 venueScan 时没有场景落地框', () => {
    expect(planSceneFootprint({ layout: { width: 20, height: 16 }, boundary: BOUNDARY })).toBeNull();
  });

  it('有 venueScan 时场景框覆盖整个边界', () => {
    const scene = planSceneFootprint({
      layout: { width: 20, height: 16, venueScan: { assetId: 'scan-1', name: '西湖现场扫描' } },
      boundary: BOUNDARY,
    });
    expect(scene).not.toBeNull();
    expect(scene).toMatchObject({
      id: 'scene:venue-scan',
      kind: 'scene',
      name: '西湖现场扫描',
      assetId: 'scan-1',
      width: 10,
      depth: 8,
      height: 0,
      rotationDeg: 0,
      color: '#6ea8ff',
    });
    expect(scene!.center.x).toBeCloseTo(5, 6);
    expect(scene!.center.y).toBeCloseTo(4, 6);
    expect(scene!.modelUrl).toBeUndefined();
  });

  it('planSceneObjects 里场景排在物料之前', () => {
    const objects = planSceneObjects({
      items: [makeItem({ id: 'chair-1', position: { x: 1, z: 1 } })],
      layout: { width: 20, height: 16, venueScan: { assetId: 'scan-1', name: '扫描' } },
      boundary: BOUNDARY,
    });
    expect(objects.map(object => object.id)).toEqual(['scene:venue-scan', 'item:chair-1']);
    expect(objects.map(object => object.kind)).toEqual(['scene', 'item']);

    const withoutScene = planSceneObjects({
      items: [makeItem({ id: 'chair-1', position: { x: 1, z: 1 } })],
      layout: { width: 20, height: 16 },
      boundary: BOUNDARY,
    });
    expect(withoutScene.map(object => object.id)).toEqual(['item:chair-1']);
  });
});
