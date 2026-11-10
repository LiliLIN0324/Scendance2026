import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { buildPlanFootprint } from './plan-footprint-builder';
import { ROOM_OBJECT_TAGS } from './room-builder';
import type { SitePlanData } from '../../../../supabase/functions/_shared/site-plan';

/**
 * 3D 地面图层的构建冒烟测试：不渲染、不看图，只确认「该有的都有、位置在场地框里、
 * 标记挂对」——重建靠 removeTagged 清这一层，标记漏了就会在场景里越堆越多。
 */

const metrics = { width: 20, depth: 10 };

function makePlan(): SitePlanData {
  return {
    schemaVersion: 1,
    boundary: [
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      { x: 20, y: 10 },
      { x: 0, y: 10 },
    ],
    zones: [{ id: 'z1', semantic: 'audience', name: '观众区', polygon: [
      { x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 },
    ], notes: '' }],
    facilities: [{ id: 'f1', templateId: 'tent', name: '帐篷', position: { x: 15, y: 5 }, rotationDeg: 0, size: { width: 4, depth: 4 }, notes: '' }],
    routes: [{ id: 'r1', kind: 'pedestrian', name: '人行', points: [{ x: 1, y: 1 }, { x: 19, y: 9 }], oneWay: false, notes: '' }],
    nodes: [{ id: 'n1', kind: 'entry', name: '入口', position: { x: 0, y: 5 }, notes: '' }],
    workers: [{ id: 'w1', role: '引导', count: 4, position: { x: 10, y: 5 }, notes: '' }],
  } as unknown as SitePlanData;
}

function findLayer(scene: THREE.Scene): THREE.Object3D | undefined {
  return scene.children.find(child => child.userData.type === ROOM_OBJECT_TAGS.PlanFootprint);
}

describe('buildPlanFootprint', () => {
  it('把规划挂成带了标记的单一图层，重建时可以整层摘掉', () => {
    const scene = new THREE.Scene();
    expect(buildPlanFootprint(THREE, scene, makePlan(), metrics)).toBe(true);
    const layer = findLayer(scene);
    expect(layer).toBeDefined();
    expect(layer!.children.length).toBeGreaterThanOrEqual(7); // 分区色块+描边、设施色块+描边、动线、点位×2、场地轮廓
  });

  it('所有几何都落在场地框内（x ±width/2、z ±depth/2），不会飘到壳体外', () => {
    const scene = new THREE.Scene();
    buildPlanFootprint(THREE, scene, makePlan(), metrics);
    const layer = findLayer(scene)!;
    layer.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(layer);
    // 出入口/人员点位以自身中心落在边界上，圆环半径 0.9 m 会跨过边界线，所以留 1 m 容差。
    const markerSlack = 1.0;
    expect(box.min.x).toBeGreaterThanOrEqual(-metrics.width / 2 - markerSlack);
    expect(box.max.x).toBeLessThanOrEqual(metrics.width / 2 + markerSlack);
    expect(box.min.z).toBeGreaterThanOrEqual(-metrics.depth / 2 - markerSlack);
    expect(box.max.z).toBeLessThanOrEqual(metrics.depth / 2 + markerSlack);
    // 贴地：整层高度在一个很小的抬升范围内，不是立起来的墙。
    expect(box.max.y - box.min.y).toBeLessThan(0.2);
  });

  it('平面为空/边界退化时返回 false 且不挂空图层', () => {
    const scene = new THREE.Scene();
    expect(buildPlanFootprint(THREE, scene, null, metrics)).toBe(false);
    const degenerate = { ...makePlan(), boundary: [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }] } as SitePlanData;
    expect(buildPlanFootprint(THREE, scene, degenerate, metrics)).toBe(false);
    expect(findLayer(scene)).toBeUndefined();
  });
});