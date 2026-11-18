/**
 * 室内分区的墙（2026-11-18 用户口径）：
 * 「室内分区边缘向上挤出 3.5m 的墙，画了门就在对应位置开 2m 的门。」
 *
 * 几何不另写一套：直接复用 `three/interior-walls.ts` 的
 * `buildExtrudedWallGeometry`（挤出 + earcut 挖矩形洞 + 重叠洞先合并），
 * 那边是 2.6 m 隔墙的门窗，这边是 3.5 m 分区墙的门洞，同一段代码换数字。
 *
 * 什么地方开洞、什么时候拒绝开洞由 `lib/plan-indoor-walls.ts` 决定，
 * 这里只负责把墙段摆到 world 里：几何沿 +X 展开、厚度在 ±Z，
 * 再把 +X 转到 a→b 的方向。
 */
import {
  INDOOR_WALL_HEIGHT_M,
  INDOOR_WALL_THICKNESS_M,
  planIndoorWalls,
  type ExtraIndoorWall,
  type IndoorWallDoor,
  type IndoorWallWindow,
  type IndoorWallZone,
} from '../lib/plan-indoor-walls';
import { buildExtrudedWallGeometry } from './interior-walls';
import type * as ThreeNS from 'three';

const WALL_COLOR = 0xd9d5ca;

export interface AddedIndoorWalls {
  walls: number;
  openings: number;
  refusals: number;
}

/**
 * 往 parent（规划地面 group）里挂一层室内墙体。返回挂了几段墙，0 表示没有室内分区。
 * 墙与地面 group 同生共死：group 重建时按 `ROOM_OBJECT_TAGS.PlanFootprint` 整层清掉。
 */
export function addIndoorWalls(
  THREE: typeof import('three'),
  parent: ThreeNS.Object3D,
  zones: readonly IndoorWallZone[],
  doors: readonly IndoorWallDoor[],
  /** 窗：同一套贴墙/开洞，洞口不落地（窗台高来自 opening.bottomFromFloor）。 */
  windows: readonly IndoorWallWindow[] = [],
  /** 手画的墙（`plan.walls`）：已经换成壳体系，和分区边线一起立墙、开洞。 */
  extraWalls: readonly ExtraIndoorWall[] = [],
): AddedIndoorWalls {
  const plan = planIndoorWalls(zones, doors, {
    ...(windows.length ? { windows } : {}),
    ...(extraWalls.length ? { extraWalls } : {}),
  });
  if (!plan.walls.length) return { walls: 0, openings: 0, refusals: plan.refusals.length };

  // 一层墙共用一个材质：段数不多但材质对象没必要一人一份。
  const material = new THREE.MeshStandardMaterial({
    color: WALL_COLOR,
    roughness: 0.92,
    metalness: 0,
    side: THREE.DoubleSide,
  });
  const group = new THREE.Group();
  group.name = 'plan-indoor-walls';
  group.userData.planIndoorWalls = plan.walls.length;

  let openings = 0;
  for (const wall of plan.walls) {
    // 两端各多出半个墙厚，转角处两段墙正好补成一块，不留竖缝。
    const length = wall.length + INDOOR_WALL_THICKNESS_M;
    const geometry = buildExtrudedWallGeometry(
      THREE,
      length,
      INDOOR_WALL_HEIGHT_M,
      INDOOR_WALL_THICKNESS_M,
      // 门洞一律落地：`bottomFromFloor = 0`，高度取 2 m（洞口上方的过梁由墙高 3.5 m 给）。
      // 窗洞用窗台高（2026-11-18），不再一律 0。
      wall.openings.map(opening => ({
        centerAlongWall: opening.centerAlongWall,
        bottomFromFloor: opening.bottomFromFloor,
        width: opening.width,
        height: opening.height,
      })),
    );
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set((wall.a.x + wall.b.x) / 2, 0, (wall.a.z + wall.b.z) / 2);
    // 几何的 +X 转到 a→b：R_y(φ) 把 +X 送到 (cos φ, 0, −sin φ)。
    mesh.rotation.y = Math.atan2(-(wall.b.z - wall.a.z), wall.b.x - wall.a.x);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.planIndoorWall = true;
    // owner 可能是分区，也可能是墙自己（手画墙），所以不叫 planZoneId、也不编造。
    if (wall.ownerId) mesh.userData.planOwnerId = wall.ownerId;
    mesh.userData.planIndoorWallOpenings = wall.openings.length;
    group.add(mesh);
    openings += wall.openings.length;
  }

  group.userData.planIndoorWallOpenings = openings;
  group.userData.planIndoorWallRefusals = plan.refusals.length;
  parent.add(group);
  return { walls: plan.walls.length, openings, refusals: plan.refusals.length };
}
