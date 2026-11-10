import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { applyLayoutCommand, applyLayoutCommandWithRefusals, completeLayoutError } from '../../../lib/build-command';
import { collectViolations } from '../../../lib/placement-rules';
import { createFurnitureModel } from '../three/furniture-builders';
import { makeFloor, makeLayout } from './__testfixtures__/fixtures';
import { FURNITURE_CATALOG } from './constants';
import { itemsOverlap } from './geometry';
import { buildFurnitureSet } from './furniture-sets';
import { localPlan } from './local-plan';
import { RING_SEATS, RING_TABLE_SIDE_M, ringCenters, ringDiningSet } from './ring-seating';
import type { FurnitureItem } from './types';
import { parseSafeDirectionalMove } from './workbench-agent';

function roundTopOf(item: FurnitureItem): THREE.Mesh {
  const model = createFurnitureModel(THREE, item, false);
  model.updateMatrixWorld(true);
  let top: THREE.Mesh | undefined;
  model.traverse(node => {
    const mesh = node as THREE.Mesh;
    if (mesh.isMesh && mesh.userData.part === 'round-top') top = mesh;
  });
  expect(top, item.name).toBeDefined();
  const size = new THREE.Box3().setFromObject(top!).getSize(new THREE.Vector3());
  expect(size.x).toBeCloseTo(item.width, 2);
  expect(size.z).toBeCloseTo(item.depth, 2);
  const geometry = top!.geometry as THREE.CylinderGeometry;
  expect(geometry.type).toBe('CylinderGeometry');
  expect(geometry.parameters.radiusTop).toBeCloseTo(item.width / 2, 3);
  expect(geometry.parameters.radiusBottom).toBeCloseTo(geometry.parameters.radiusTop, 5);
  // The square corner of the collision box sits outside the disc.
  expect(geometry.parameters.radiusTop * Math.SQRT2).toBeGreaterThan(item.width / 2 + 0.05);
  model.traverse(node => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh || mesh.geometry.type !== 'BoxGeometry') return;
    const box = mesh.geometry as THREE.BoxGeometry;
    expect(box.parameters.width).toBeLessThan(item.width * 0.5);
    expect(box.parameters.depth).toBeLessThan(item.depth * 0.5);
  });
  return top!;
}

describe('round-table ring', () => {
  it('puts chairs on one circle facing the table, clear of the table box', () => {
    const items = buildFurnitureSet(ringDiningSet(), { idPrefix: 'ring', roomWidth: 20, roomDepth: 16 });
    const table = items.find(item => item.type === 'dining-table');
    const chairs = items.filter(item => item.type === 'dining-chair');
    expect(table?.name).toBe('圆桌');
    expect(table?.tableShape).toBe('round');
    expect(table?.width).toBe(RING_TABLE_SIDE_M);
    expect(table?.depth).toBe(table?.width);
    expect(FURNITURE_CATALOG.find(entry => entry.name === '圆桌')?.tableShape).toBe('round');
    roundTopOf(table!);
    expect(chairs.length).toBe(RING_SEATS);
    const radii = chairs.map(item => Math.hypot(item.position?.x ?? 0, item.position?.z ?? 0));
    expect(Math.max(...radii) - Math.min(...radii)).toBeLessThan(0.05);
    for (const chair of chairs) {
      const x = chair.position?.x ?? 0;
      const z = chair.position?.z ?? 0;
      const length = Math.hypot(x, z);
      const theta = chair.rotation ?? 0;
      const facing = Math.sin(theta) * (-x / length) + Math.cos(theta) * (-z / length);
      expect(facing).toBeGreaterThan(0.9);
      expect(itemsOverlap(table!, chair)).toBe(false);
    }
    const layout = makeLayout({
      width: 20,
      height: 16,
      floors: [makeFloor({ items })],
    });
    const overlaps = collectViolations(layout).filter(violation => violation.code === 'BBOX_OVERLAP');
    expect(overlaps).toEqual([]);
  });

  it('fills the floor with round tables instead of one loop of ten', () => {
    const sample = buildFurnitureSet(ringDiningSet(), { idPrefix: 'm', roomWidth: 30, roomDepth: 24 });
    const half = sample.reduce((max, item) => Math.max(max, Math.hypot(item.position?.x ?? 0, item.position?.z ?? 0) + Math.max(item.width, item.depth) / 2), 0);
    const centers = ringCenters({ x: -10, z: -7, w: 20, d: 14 }, { halfX: half, halfZ: half }, 0.4, 1.2);
    expect(centers.length).toBeGreaterThan(10);
    const xs = new Set(centers.map(point => point.x.toFixed(2)));
    const zs = new Set(centers.map(point => point.z.toFixed(2)));
    expect(xs.size).toBeGreaterThan(1);
    expect(zs.size).toBeGreaterThan(1);
  });

  it('seats an 80-person 20×15 brief close to the headcount and confirms without table-chair overlap', () => {
    const base = makeLayout({ width: 20, height: 15, floors: [makeFloor()] });
    const plan = localPlan({
      base,
      floorIndex: 0,
      widthM: 20,
      depthM: 15,
      variant: 0,
      guests: 80,
      layoutMode: 'dining',
      seatingShape: 'ring',
      stage: false,
      checkin: false,
    });
    const layout = plan.layouts.at(-1)!;
    const chairs = layout.floors[0]!.items.filter(item => item.name === '餐椅');
    const tables = layout.floors[0]!.items.filter(item => item.name === '圆桌');
    expect(tables.length).toBeGreaterThanOrEqual(10);
    expect(tables.every(item => item.name === '圆桌' && item.tableShape === 'round' && item.width === item.depth)).toBe(true);
    expect(chairs.length).toBe(tables.length * RING_SEATS);
    roundTopOf(tables[0]!);
    expect(plan.seats).toBe(80);
    const overlaps = collectViolations(layout).filter(violation => violation.code === 'BBOX_OVERLAP');
    expect(overlaps.filter(violation => /圆桌|餐椅/.test(violation.detail))).toEqual([]);
    const applied = applyLayoutCommandWithRefusals(applyLayoutCommand({ layout }), { layout: base });
    expect(completeLayoutError(applied)).toBeNull();
  });
});

describe('vague nudge', () => {
  it('reads 把椅子往左挪一点 as a short revise, not a missing distance', () => {
    expect(parseSafeDirectionalMove('把椅子往左挪一点')).toMatchObject({
      kind: 'move',
      role: '椅子',
      delta: { x: -0.3, z: 0 },
    });
    expect(parseSafeDirectionalMove('把椅子往左挪')).toBeNull();
  });
});
