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
    // 地面图形本身是贴地抬升，不是立起来的墙。不含 planPropId（帐篷等低模/贴纸占位）。
    // 2026-11-12「物体没放在平面上」：分层压到瓦片金字塔顶（0.048）之上——
    // 边界 0.05 / 分区 0.062 / 设施 0.074 / 动线 0.086，最高点位圆环 0.134。
    const flat = layer.children.filter(child => !child.userData.planPropId);
    const flatBox = new THREE.Box3();
    for (const child of flat) flatBox.expandByObject(child);
    expect(flatBox.min.y).toBeGreaterThanOrEqual(-0.01);
    expect(flatBox.max.y).toBeLessThan(0.2);
  });

  it('每个设施在 3D 里立起对应物件，且高度是「能认出来」的尺度而不是地贴', () => {
    const scene = new THREE.Scene();
    buildPlanFootprint(THREE, scene, makePlan(), metrics);
    const layer = findLayer(scene)!;
    layer.updateMatrixWorld(true);
    const props = layer.children.filter(child => child.userData.planPropId);
    expect(props).toHaveLength(1); // 只有一个设施
    const prop = props[0]!;
    expect(prop.name).toBe('plan-prop-tent');
    // planPropId 记的是 2D 设施 id，两个视图靠它对齐同一件物料。
    expect(prop.userData.planPropId).toBe('f1');
    const box = new THREE.Box3().setFromObject(prop);
    expect(box.min.y).toBeGreaterThanOrEqual(-0.01);
    expect(box.max.y).toBeGreaterThan(2); // 帐篷是有高度的实体
    expect(box.max.y).toBeLessThan(6);
    // 占地不超出 2D 给的 4×4（含少量出檐）。
    expect(box.max.x - box.min.x).toBeLessThan(4.6);
    expect(box.max.z - box.min.z).toBeLessThan(4.6);
  });

  it('没有贴纸的未知模板不再立灰块，只保留地面占地', () => {
    const scene = new THREE.Scene();
    const plan = makePlan();
    (plan as unknown as { facilities: unknown[] }).facilities = [
      { id: 'f9', templateId: 'mystery-box', name: '神秘物件', position: { x: 5, y: 5 }, rotationDeg: 30, size: { width: 2, depth: 1.4 }, notes: '' },
    ];
    expect(buildPlanFootprint(THREE, scene, plan, metrics)).toBe(true);
    const layer = findLayer(scene)!;
    const prop = layer.children.find(child => child.userData.planPropId === 'f9');
    expect(prop).toBeUndefined();
    // 地面设施色块还在，只是不再竖一块 1.1 m 的灰盒。
    expect(layer.children.length).toBeGreaterThan(0);
    const tallBox = new THREE.Box3();
    layer.traverse((child) => {
      const mesh = child as THREE.Mesh;
      if (mesh.geometry instanceof THREE.BoxGeometry) tallBox.expandByObject(mesh);
    });
    if (tallBox.isEmpty()) return;
    expect(tallBox.max.y).toBeLessThan(0.8);
  });

  it('没有 3D 模型的库物件在场地上铺原来的 2D 贴纸，不再立低模方块', () => {
    const scene = new THREE.Scene();
    const plan = makePlan();
    (plan as unknown as { facilities: unknown[] }).facilities = [
      { id: 'f10', templateId: 'oneplan:icon:first-aid-point', name: '急救点', position: { x: 5, y: 5 }, rotationDeg: 0, size: { width: 2, depth: 2 }, notes: '' },
      { id: 'f11', templateId: 'oneplan:scale:car', name: '轿车', position: { x: 12, y: 5 }, rotationDeg: 45, size: { width: 4.5, depth: 2.1 }, notes: '' },
    ];
    expect(buildPlanFootprint(THREE, scene, plan, metrics)).toBe(true);
    const layer = findLayer(scene)!;
    const icon = layer.children.find(child => child.userData.planPropId === 'f10');
    const scale = layer.children.find(child => child.userData.planPropId === 'f11');
    expect(icon).toBeDefined();
    expect(scale).toBeDefined();
    expect(icon!.name).toBe('plan-prop-misc');
    expect(scale!.name).toBe('plan-prop-misc');
    const hasBox = (object: THREE.Object3D): boolean => {
      let found = false;
      object.traverse((child) => {
        if ((child as THREE.Mesh).geometry instanceof THREE.BoxGeometry) found = true;
      });
      return found;
    };
    expect(hasBox(icon!)).toBe(false);
    expect(hasBox(scale!)).toBe(false);
    layer.updateMatrixWorld(true);
    const iconBox = new THREE.Box3().setFromObject(icon!);
    const scaleBox = new THREE.Box3().setFromObject(scale!);
    // 2026-11-12「物体没放在平面上」：贴纸层压到瓦片顶之上贴地带（0.08），不再悬空 0.42。
    expect(iconBox.max.y).toBeLessThan(0.2);
    expect(scaleBox.max.y).toBeLessThan(0.2);
    expect(iconBox.max.y).toBeGreaterThan(0.05);
    // 比例尺贴纸按占地铺满（轿车约 4.5×2.1）。
    expect(scaleBox.max.x - scaleBox.min.x).toBeGreaterThan(2);
    expect(scaleBox.max.z - scaleBox.min.z).toBeGreaterThan(1);
  });

  it('平面为空/边界退化时返回 false 且不挂空图层', () => {
    const scene = new THREE.Scene();
    expect(buildPlanFootprint(THREE, scene, null, metrics)).toBe(false);
    const degenerate = { ...makePlan(), boundary: [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }] } as SitePlanData;
    expect(buildPlanFootprint(THREE, scene, degenerate, metrics)).toBe(false);
    expect(findLayer(scene)).toBeUndefined();
  });
});