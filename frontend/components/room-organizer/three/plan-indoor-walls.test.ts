import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { buildPlanFootprint } from './plan-footprint-builder';
import { addIndoorWalls } from './plan-indoor-walls';
import type { SitePlanData } from '../../../../supabase/functions/_shared/site-plan';
import type { IndoorWallDoor, IndoorWallZone } from '../lib/plan-indoor-walls';

/**
 * 2026-11-18 用户口径的 3D 验收：
 * 室内分区边线立 3.5 m 墙；吸附在边上的门真的在墙上挖出 2 m 高的洞。
 *
 * 洞用射线验，不看顶点数：y = 1 m 的水平射线能穿过去 = 真的开洞；
 * y = 2.5 m 打得到墙 = 洞口上方还有过梁。这是用户唯一能一眼验的那两条。
 */

const ZONE: IndoorWallZone = {
  id: 'zone-indoor',
  environment: 'indoor',
  points: [
    { x: 0, z: 0 },
    { x: 10, z: 0 },
    { x: 10, z: 8 },
    { x: 0, z: 8 },
  ],
};

const THREE_MODULE = THREE as unknown as typeof import('three');

function build(doors: readonly IndoorWallDoor[]) {
  const root = new THREE.Group();
  const result = addIndoorWalls(THREE_MODULE, root, [ZONE], doors);
  root.updateMatrixWorld(true);
  const group = root.children.find(child => child.name === 'plan-indoor-walls') as THREE.Group | undefined;
  const walls = (group?.children ?? []) as THREE.Mesh[];
  return { root, group, walls, result };
}

/** 从墙外侧沿 +z 打一条水平射线。 */
function shoot(mesh: THREE.Mesh, { x, y, from = -2, to = 2 }: { x: number; y: number; from?: number; to?: number }) {
  const raycaster = new THREE.Raycaster(
    new THREE.Vector3(x, y, from),
    new THREE.Vector3(0, 0, Math.sign(to - from)),
  );
  return raycaster.intersectObject(mesh, false).length;
}

describe('addIndoorWalls（3D 室内分区立墙）', () => {
  it('室内分区四条边各立一段 3.5 m 高的实心墙', () => {
    const { walls, result } = build([]);
    expect(result).toEqual({ walls: 4, openings: 0, refusals: 0 });
    expect(walls).toHaveLength(4);
    for (const wall of walls) {
      const box = new THREE.Box3().setFromObject(wall);
      expect(box.min.y).toBeCloseTo(0, 5);
      expect(box.max.y).toBeCloseTo(3.5, 5);
    }
  });

  it('没有室内分区时不挂空层（室外分区照旧只有地面色块）', () => {
    const root = new THREE.Group();
    const result = addIndoorWalls(THREE_MODULE, root, [{ ...ZONE, environment: 'outdoor' }], []);
    expect(result.walls).toBe(0);
    expect(root.children).toHaveLength(0);
  });

  it('吸在边线中点的门：y=1 m 穿得过去，y=2.5 m 打过梁', () => {
    const { walls, group } = build([{ id: 'door-1', center: { x: 5, z: 0 }, widthM: 1.2 }]);
    const holed = walls.filter(wall => wall.userData.planIndoorWallOpenings === 1);
    expect(holed).toHaveLength(1);
    expect(group!.userData.planIndoorWallOpenings).toBe(1);

    const wall = holed[0]!;
    // 洞口正中（x = 5）在 2 m 以下没有面；1.2 m 宽的门，x = 4.5 / 5.5 也都在洞内。
    for (const x of [4.5, 5, 5.5]) expect(shoot(wall, { x, y: 1 })).toBe(0);
    // 洞口上方是过梁：2.5 m 一定打得到。
    expect(shoot(wall, { x: 5, y: 2.5 })).toBeGreaterThan(0);
    // 门旁边仍是实墙。
    expect(shoot(wall, { x: 2, y: 1 })).toBeGreaterThan(0);
  });

  it('2 m 是硬边界：1.9 m 穿得过，2.1 m 打得到', () => {
    const { walls } = build([{ id: 'door-1', center: { x: 5, z: 0 }, widthM: 1.2 }]);
    const wall = walls.find(item => item.userData.planIndoorWallOpenings === 1)!;
    expect(shoot(wall, { x: 5, y: 1.9 })).toBe(0);
    expect(shoot(wall, { x: 5, y: 2.1 })).toBeGreaterThan(0);
  });

  it('门比边线还宽：拒绝开洞，墙完整（用户口径）', () => {
    const { walls, result } = build([{ id: 'door-wide', center: { x: 5, z: 0 }, widthM: 12 }]);
    expect(result).toEqual({ walls: 4, openings: 0, refusals: 1 });
    const wall = walls.find(item => Math.abs(item.position.x - 5) < 1e-6 && Math.abs(item.position.z) < 1e-6)!;
    expect(shoot(wall, { x: 5, y: 1 })).toBeGreaterThan(0);
  });

  it('没吸到边上的门不开洞：不传门就没有洞（自由摆放的「莫名其妙的门」）', () => {
    const { walls, result } = build([]);
    expect(result.openings).toBe(0);
    expect(walls.every(wall => wall.userData.planIndoorWallOpenings === 0)).toBe(true);
  });
});

describe('buildPlanFootprint 接入（plan 坐标 → 墙体）', () => {
  const BOUNDARY = [
    { x: -10, y: -7 },
    { x: 10, y: -7 },
    { x: 10, y: 7 },
    { x: -10, y: 7 },
  ];

  /** 10 × 6 m 室内分区（南边在 y = −3）+ 一扇吸在南边中点的门。 */
  function makePlan(door: boolean): SitePlanData {
    return {
      schemaVersion: 1,
      anchor: { lng: 120.15, lat: 30.28 },
      boundary: BOUNDARY,
      zones: [
        {
          id: 'zone-indoor',
          semantic: 'reserved',
          name: '室内区',
          environment: 'indoor',
          polygon: [
            { x: -5, y: -3 },
            { x: 5, y: -3 },
            { x: 5, y: 3 },
            { x: -5, y: 3 },
          ],
          notes: '',
        },
      ],
      facilities: door
        ? [
            {
              id: 'door-1',
              templateId: 'icon:door',
              name: '门',
              position: { x: 0, y: -3 },
              rotationDeg: 0,
              size: { width: 1.2, depth: 0.1 },
              notes: '',
            },
          ]
        : [],
      routes: [],
      nodes: [],
      workers: [],
      measurements: [],
      annotations: [],
    } as unknown as SitePlanData;
  }

  function footprint(plan: SitePlanData): THREE.Group {
    const scene = new THREE.Scene();
    expect(
      buildPlanFootprint(
        THREE_MODULE,
        scene as unknown as import('three').Scene,
        plan,
        { width: 20, depth: 14 },
        { clampPoints: false },
      ),
    ).toBe(true);
    const group = scene.getObjectByName('plan-footprint') as THREE.Group;
    group.updateMatrixWorld(true);
    return group;
  }

  it('分区边线在 3D 里立起 3.5 m 墙，并在吸附门处开洞', () => {
    const group = footprint(makePlan(true));
    const walls = group.getObjectByName('plan-indoor-walls') as THREE.Group;
    expect(walls).toBeTruthy();
    expect(walls.userData.planIndoorWalls).toBe(4);
    expect(walls.userData.planIndoorWallOpenings).toBe(1);

    const holed = walls.children.find(
      (mesh): mesh is THREE.Mesh => mesh instanceof THREE.Mesh && mesh.userData.planIndoorWallOpenings === 1,
    )!;
    expect(holed).toBeTruthy();
    const raycaster = new THREE.Raycaster(new THREE.Vector3(0, 1, 5), new THREE.Vector3(0, 0, -1));
    // 门在 plan (0, −3)：壳体里世界 z = 3；y = 1 穿得过去，y = 2.5 打过梁。
    expect(raycaster.intersectObject(holed, false)).toHaveLength(0);
    raycaster.ray.origin.set(0, 2.5, 5);
    expect(raycaster.intersectObject(holed, false).length).toBeGreaterThan(0);
  });

  it('同一份分区没有门时墙是整片实心', () => {
    const group = footprint(makePlan(false));
    const walls = group.getObjectByName('plan-indoor-walls') as THREE.Group;
    expect(walls.userData.planIndoorWallOpenings).toBe(0);
    const raycaster = new THREE.Raycaster(new THREE.Vector3(0, 1, 5), new THREE.Vector3(0, 0, -1));
    const anyWall = walls.children.find(mesh => mesh instanceof THREE.Mesh) as THREE.Mesh;
    expect(raycaster.intersectObject(anyWall, false).length >= 0).toBe(true);
    // 南墙（z = 3）仍旧实心：整层墙都打得到。
    const hits = walls.children
      .filter((mesh): mesh is THREE.Mesh => mesh instanceof THREE.Mesh)
      .flatMap(mesh => raycaster.intersectObject(mesh, false));
    expect(hits.length).toBeGreaterThan(0);
  });
});
