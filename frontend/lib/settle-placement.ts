/**
 * settle-placement.ts —— 合法布置图判据 + 最小平移收敛器。
 *
 * 纯函数模块：输入一份 RoomLayout，输出收敛后的新 layout、每一遍的轨迹、
 * 仍存在的违规清单、是否在遍数上界内收敛。原 layout 不被修改。
 *
 * 设计底稿：docs/research/generation/petitmaker-construction-logic-2026-11-01.md 卡 04。
 * 与 placement-rules.ts 并列、不互相调用，保持本模块独立可测。
 *
 * 关键常量（与研究底稿咬合，勿单独改动）：
 *  - EXPAND_M=0.15   家具 AABB 外扩 0.15m 作为 BFS 障碍物占位。
 *  - BFS_STEP=0.2    导航网格步长（米）。
 *  - SEED_OFFSET=0.3  座椅件 BFS 起点距自身 AABB 外沿 0.3m。
 *  - SHIFT=0.3       收敛器试探步长。
 *  - SHIFT_TRIES=3   单方向上探 3 步（±0.3/±0.6/±0.9）。
 *  - AISLE_HALF=0.6  主通道带半宽（|x|≤0.6，纵向贯穿全高）。
 *  - OPEN_HALF=0.5   场地南北边（z=±H/2）中点 1m 宽视为开口。
 */

import type { FurnitureItem, InteriorWall, RoomLayout } from '../components/room-organizer/lib/types';

const EPS = 1e-6;
const EXPAND_M = 0.15;
const BFS_STEP = 0.2;
const SEED_OFFSET = 0.3;
const SHIFT = 0.3;
const SHIFT_TRIES = 3;
const AISLE_HALF = 0.6;
const OPEN_HALF = 0.5;

/** settle 自有违规码，与 placement-rules 的 ViolationCode 并行不混用。 */
export interface SettleViolation {
  kind: 'ISLAND' | 'AISLE_TOUCH' | 'OUT_OF_BOUNDS' | 'WALL' | 'OVERLAP';
  itemId: string;
  message: string;
}

export interface SettleStep {
  moved: Array<{ itemId: string; from: { x: number; z: number }; to: { x: number; z: number } }>;
  violations: SettleViolation[];
}

export interface SettleReport {
  /** 最终 layout（收敛后的新不可变布局）。 */
  layout: RoomLayout;
  /** 每一遍的轨迹（最后一遍 moved 应为空）。 */
  steps: SettleStep[];
  /** 收敛后仍存在的违规。 */
  remainingViolations: SettleViolation[];
  /** 是否在遍数上界内收敛。 */
  converged: boolean;
  /** 实际遍数。 */
  iterations: number;
}

interface Pt {
  x: number;
  z: number;
}

interface AABB {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/** 旋转后的 4 个世界角点（与 placement-rules.itemCorners 同算法，本模块独立实现）。 */
function itemCorners(item: FurnitureItem): Pt[] {
  const cx = item.position?.x ?? 0;
  const cz = item.position?.z ?? 0;
  const hw = item.width / 2;
  const hd = item.depth / 2;
  const theta = item.rotation ?? 0;
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  const locals: Pt[] = [
    { x: -hw, z: -hd },
    { x: hw, z: -hd },
    { x: hw, z: hd },
    { x: -hw, z: hd },
  ];
  return locals.map((p) => ({
    x: cx + p.x * c - p.z * s,
    z: cz + p.x * s + p.z * c,
  }));
}

function aabbOf(poly: Pt[]): AABB {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const p of poly) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.z < minZ) minZ = p.z;
    if (p.z > maxZ) maxZ = p.z;
  }
  return { minX, maxX, minZ, maxZ };
}

/** 计算家具旋转后的 AABB（不膨胀）。 */
function itemAABB(item: FurnitureItem): AABB {
  return aabbOf(itemCorners(item));
}

function expand(a: AABB, m: number): AABB {
  return { minX: a.minX - m, maxX: a.maxX + m, minZ: a.minZ - m, maxZ: a.maxZ + m };
}

function aabbIntersect(a: AABB, b: AABB): boolean {
  return a.minX < b.maxX - EPS && a.maxX > b.minX + EPS && a.minZ < b.maxZ - EPS && a.maxZ > b.minZ + EPS;
}

/** 座椅/桌沿类：人必须能走到身边使用的件，参与 ISLAND 可达性判定。 */
function isSeatingLike(item: FurnitureItem): boolean {
  const t = item.type ?? '';
  return (
    t.includes('chair') ||
    t.includes('seat') ||
    t === 'bench' ||
    t === 'sofa' ||
    t === 'dining-table' ||
    t === 'dining-chair'
  );
}

/** 低矮件（地毯）不进 BFS 障碍物占位，避免把地面装饰当成墙。 */
function isLowProfile(item: FurnitureItem): boolean {
  return item.height <= 0.05 || item.type === 'rug';
}

/** 计算某一层所有家具的（膨胀后）障碍物 AABB 列表。 */
function buildObstacles(items: FurnitureItem[]): AABB[] {
  const out: AABB[] = [];
  for (const it of items) {
    if (isLowProfile(it)) continue;
    out.push(expand(itemAABB(it), EXPAND_M));
  }
  return out;
}

/** 网格点是否被障碍物占住 / 越出场地。 */
function isBlocked(p: Pt, obstacles: AABB[], w: number, h: number): boolean {
  if (p.x < -w / 2 + EPS || p.x > w / 2 - EPS || p.z < -h / 2 + EPS || p.z > h / 2 - EPS) return true;
  for (const o of obstacles) {
    if (p.x >= o.minX - EPS && p.x <= o.maxX + EPS && p.z >= o.minZ - EPS && p.z <= o.maxZ + EPS) return true;
  }
  return false;
}

/** 是否落在主通道带（|x|≤0.6 且在场地内）。 */
function hitsAisle(p: Pt): boolean {
  return p.x >= -AISLE_HALF - EPS && p.x <= AISLE_HALF + EPS;
}

/** 是否落在南北边开口（z=±H/2 附近、|x|≤0.5）。 */
function hitsOpening(p: Pt, h: number): boolean {
  const north = Math.abs(p.z - h / 2) <= BFS_STEP / 2 + EPS;
  const south = Math.abs(p.z + h / 2) <= BFS_STEP / 2 + EPS;
  const alongMiddle = Math.abs(p.x) <= OPEN_HALF + EPS;
  return (north || south) && alongMiddle;
}

/** 把 (x,z) 吸附到最近的 BFS 网格坐标。 */
function snapToGrid(v: number): number {
  return Math.round(v / BFS_STEP) * BFS_STEP;
}

/**
 * 从 seed 集合出发做 BFS，返回是否能到达主通道带或南北开口。
 * obstacles 已包含全部家具膨胀框（不含自身，调用方负责把自身从障碍物中去掉）。
 */
function bfsReachTarget(seeds: Pt[], obstacles: AABB[], w: number, h: number): boolean {
  const visited = new Set<string>();
  const queue: Pt[] = [];
  for (const s of seeds) {
    if (isBlocked(s, obstacles, w, h)) continue;
    const gx = snapToGrid(s.x);
    const gz = snapToGrid(s.z);
    const key = `${gx.toFixed(3)},${gz.toFixed(3)}`;
    if (visited.has(key)) continue;
    visited.add(key);
    queue.push({ x: gx, z: gz });
  }
  if (queue.length === 0) return false;

  while (queue.length > 0) {
    const cur = queue.shift()!;
    if (hitsAisle(cur) || hitsOpening(cur, h)) return true;
    const neighbors: Pt[] = [
      { x: cur.x + BFS_STEP, z: cur.z },
      { x: cur.x - BFS_STEP, z: cur.z },
      { x: cur.x, z: cur.z + BFS_STEP },
      { x: cur.x, z: cur.z - BFS_STEP },
    ];
    for (const n of neighbors) {
      if (isBlocked(n, obstacles, w, h)) continue;
      const key = `${snapToGrid(n.x).toFixed(3)},${snapToGrid(n.z).toFixed(3)}`;
      if (visited.has(key)) continue;
      visited.add(key);
      queue.push({ x: snapToGrid(n.x), z: snapToGrid(n.z) });
    }
  }
  return false;
}

/** 座椅件的 BFS 种子集合：AABB 外沿 0.3m 环路上 8 个方向点（吸附到网格）。 */
function seatingSeeds(item: FurnitureItem): Pt[] {
  const a = itemAABB(item);
  const ox = SEED_OFFSET;
  const seeds: Pt[] = [
    { x: (a.minX + a.maxX) / 2, z: a.minZ - ox },
    { x: (a.minX + a.maxX) / 2, z: a.maxZ + ox },
    { x: a.minX - ox, z: (a.minZ + a.maxZ) / 2 },
    { x: a.maxX + ox, z: (a.minZ + a.maxZ) / 2 },
    { x: a.minX - ox, z: a.minZ - ox },
    { x: a.maxX + ox, z: a.minZ - ox },
    { x: a.minX - ox, z: a.maxZ + ox },
    { x: a.maxX + ox, z: a.maxZ + ox },
  ];
  return seeds;
}

/**
 * 对一层 items 跑全部 settle 判据，返回违规清单。
 * 不修改 items。
 */
function evaluateFloor(
  items: FurnitureItem[],
  w: number,
  h: number,
  interiorWalls: InteriorWall[] | undefined,
): SettleViolation[] {
  const violations: SettleViolation[] = [];

  // 障碍物（用于 BFS）。每件家具的膨胀框都占，但 BFS 判 ISLAND 时会把当前座椅件自身去掉。
  const obstaclesAll = buildObstacles(items);

  for (const it of items) {
    const a = itemAABB(it);

    // OUT_OF_BOUNDS
    if (a.minX < -w / 2 - EPS || a.maxX > w / 2 + EPS || a.minZ < -h / 2 - EPS || a.maxZ > h / 2 + EPS) {
      violations.push({
        kind: 'OUT_OF_BOUNDS',
        itemId: it.id,
        message: `「${it.name}」越出场地边界（场地 ${w}m × ${h}m）`,
      });
    }

    // AISLE_TOUCH：AABB 与主通道带 |x|≤0.6 有交集（settle 自己复算，不分座椅豁免）
    if (a.minX < AISLE_HALF - EPS && a.maxX > -AISLE_HALF + EPS) {
      violations.push({
        kind: 'AISLE_TOUCH',
        itemId: it.id,
        message: `「${it.name}」压住主通道带（|x|≤0.6）`,
      });
    }

    // WALL：与内墙线段相交（用线段 AABB 粗判）
    if (interiorWalls && interiorWalls.length > 0) {
      for (const wall of interiorWalls) {
        const wAABB: AABB = {
          minX: Math.min(wall.x1, wall.x2),
          maxX: Math.max(wall.x1, wall.x2),
          minZ: Math.min(wall.z1, wall.z2),
          maxZ: Math.max(wall.z1, wall.z2),
        };
        if (aabbIntersect(a, wAABB)) {
          violations.push({
            kind: 'WALL',
            itemId: it.id,
            message: `「${it.name}」与内墙「${wall.id}」相交`,
          });
        }
      }
    }

    // OVERLAP：与其他家具 AABB 重叠（低矮件豁免）
    if (!isLowProfile(it)) {
      for (const other of items) {
        if (other.id === it.id) continue;
        if (isLowProfile(other)) continue;
        const oa = itemAABB(other);
        if (aabbIntersect(a, oa)) {
          // 同一对只报一次：字典序小的一方挂记录
          if (it.id < other.id) {
            violations.push({
              kind: 'OVERLAP',
              itemId: it.id,
              message: `「${it.name}」与「${other.name}」重叠`,
            });
          }
        }
      }
    }
  }

  // ISLAND：对每个座椅类件做 BFS（自身膨胀框从障碍物中剔除）
  for (const it of items) {
    if (!isSeatingLike(it)) continue;
    const selfExpanded = expand(itemAABB(it), EXPAND_M);
    const obstacles = obstaclesAll.filter((o) => {
      // 剔除自身膨胀框（AABB 等价判断）
      return !(Math.abs(o.minX - selfExpanded.minX) < EPS && Math.abs(o.maxX - selfExpanded.maxX) < EPS);
    });
    const seeds = seatingSeeds(it);
    if (!bfsReachTarget(seeds, obstacles, w, h)) {
      violations.push({
        kind: 'ISLAND',
        itemId: it.id,
        message: `「${it.name}」被家具围死，无法走到主通道或场地开口`,
      });
    }
  }

  return violations;
}

/** 生成一份新 layout，把指定 floor 的 items 整体替换为新数组（深拷贝非 position 字段，保证不可变）。 */
function replaceFloorItems(layout: RoomLayout, floorIndex: number, newItems: FurnitureItem[]): RoomLayout {
  const floors = layout.floors.map((f, i) => {
    if (i !== floorIndex) return f;
    return { ...f, items: newItems };
  });
  return { ...layout, floors };
}

/** 把某件家具的 position 改成新坐标，返回新家具对象（不 mutate 原对象）。 */
function moveItem(item: FurnitureItem, x: number, z: number): FurnitureItem {
  return { ...item, position: { x, z } };
}

/**
 * 对候选落点（试把 itemId 的件移到 (nx,nz)）做合法性检查：
 * 该件本身 OUT_OF_BOUNDS / WALL / AISLE_TOUCH / OVERLAP 都不能新增。
 * 返回 true 表示落点合法。
 */
function candidateLegal(
  items: FurnitureItem[],
  itemId: string,
  nx: number,
  nz: number,
  w: number,
  h: number,
  interiorWalls: InteriorWall[] | undefined,
): boolean {
  const idx = items.findIndex((i) => i.id === itemId);
  if (idx < 0) return false;
  const moved = moveItem(items[idx], nx, nz);
  const others = items.filter((i) => i.id !== itemId);

  // 用单判据快速短路
  const a = itemAABB(moved);
  if (a.minX < -w / 2 + EPS || a.maxX > w / 2 - EPS || a.minZ < -h / 2 + EPS || a.maxZ > h / 2 - EPS) {
    return false;
  }
  if (a.minX < AISLE_HALF - EPS && a.maxX > -AISLE_HALF + EPS) {
    return false;
  }
  if (interiorWalls && interiorWalls.length > 0) {
    for (const wall of interiorWalls) {
      const wAABB: AABB = {
        minX: Math.min(wall.x1, wall.x2),
        maxX: Math.max(wall.x1, wall.x2),
        minZ: Math.min(wall.z1, wall.z2),
        maxZ: Math.max(wall.z1, wall.z2),
      };
      if (aabbIntersect(a, wAABB)) return false;
    }
  }
  if (!isLowProfile(moved)) {
    for (const other of others) {
      if (isLowProfile(other)) continue;
      if (aabbIntersect(a, itemAABB(other))) return false;
    }
  }
  return true;
}

/**
 * 检查把 itemId 移到 (nx,nz) 后，该件是否仍 ISLAND。
 * 在临时 items 数组上跑 evaluateFloor，只看该件的 ISLAND 违规。
 */
function candidateStillIsland(
  items: FurnitureItem[],
  itemId: string,
  nx: number,
  nz: number,
  w: number,
  h: number,
): boolean {
  const idx = items.findIndex((i) => i.id === itemId);
  if (idx < 0) return true;
  const moved = moveItem(items[idx], nx, nz);
  const tmpItems = items.map((it, i) => (i === idx ? moved : it));
  const vs = evaluateFloor(tmpItems, w, h, undefined);
  return vs.some((v) => v.kind === 'ISLAND' && v.itemId === itemId);
}

/**
 * 收敛器主入口。
 * @param layout 原始布局（不被修改）。
 * @param floorIndex 要收敛的层（默认 0）。
 */
export function settlePlacement(layout: RoomLayout, floorIndex = 0): SettleReport {
  const floor = layout.floors[floorIndex];
  if (!floor) {
    return {
      layout,
      steps: [],
      remainingViolations: [],
      converged: true,
      iterations: 0,
    };
  }

  const w = layout.width;
  const h = layout.height;
  const interiorWalls = floor.interiorWalls;

  // 座椅类件数 N：遍数上界 2N+4
  const seatingCount = floor.items.filter(isSeatingLike).length;
  const maxIterations = 2 * seatingCount + 4;

  let currentItems = floor.items;
  let currentLayout = layout;
  const steps: SettleStep[] = [];

  // 空场地 / 初始就无违规：直接 0 遍返回（不可变）。
  const initialViolations = evaluateFloor(currentItems, w, h, interiorWalls);
  if (initialViolations.length === 0) {
    return {
      layout,
      steps: [],
      remainingViolations: [],
      converged: true,
      iterations: 0,
    };
  }

  // 振荡防护：上一遍 from→to 的 Set（key = `${itemId}:${fromX},${fromZ}->${toX},${toZ}`）
  let lastMovedSet = new Set<string>();

  for (let iter = 0; iter < maxIterations; iter++) {
    const violations = evaluateFloor(currentItems, w, h, interiorWalls);
    const moved: SettleStep['moved'] = [];
    const nextMovedSet = new Set<string>();

    // 本遍要处理的目标件：ISLAND / AISLE_TOUCH / OUT_OF_BOUNDS
    // （OOB 件虽不在 spec 字面"ISLAND/AISLE_TOUCH"清单，但收敛器必须能把越界件内移，
    // 否则测试 4/18 的"越界件被内移"期望无法满足。落点合法性仍按 candidateLegal 把关。）
    const targetIds = Array.from(
      new Set(
        violations
          .filter((v) => v.kind === 'ISLAND' || v.kind === 'AISLE_TOUCH' || v.kind === 'OUT_OF_BOUNDS')
          .map((v) => v.itemId),
      ),
    );

    for (const itemId of targetIds) {
      const item = currentItems.find((i) => i.id === itemId);
      if (!item) continue;
      const fromX = item.position?.x ?? 0;
      const fromZ = item.position?.z ?? 0;

      // 候选落点：先 z 方向 ±0.3/±0.6/±0.9，再 x 方向
      const candidates: Array<{ dx: number; dz: number }> = [];
      for (let s = 1; s <= SHIFT_TRIES; s++) {
        candidates.push({ dx: 0, dz: -s * SHIFT });
        candidates.push({ dx: 0, dz: s * SHIFT });
      }
      for (let s = 1; s <= SHIFT_TRIES; s++) {
        candidates.push({ dx: -s * SHIFT, dz: 0 });
        candidates.push({ dx: s * SHIFT, dz: 0 });
      }

      let applied: { dx: number; dz: number } | null = null;
      for (const c of candidates) {
        const nx = fromX + c.dx;
        const nz = fromZ + c.dz;

        // 振荡防护：本遍 (from→to) 不能是上一遍 (to→from) 的反向
        const backKey = `${itemId}:${nx.toFixed(3)},${nz.toFixed(3)}->${fromX.toFixed(3)},${fromZ.toFixed(3)}`;
        if (lastMovedSet.has(backKey)) continue;

        if (!candidateLegal(currentItems, itemId, nx, nz, w, h, interiorWalls)) continue;

        // 对 ISLAND 件还要求新位置不再 ISLAND
        const isIsland = violations.some((v) => v.kind === 'ISLAND' && v.itemId === itemId);
        if (isIsland && candidateStillIsland(currentItems, itemId, nx, nz, w, h)) continue;

        applied = c;
        break;
      }

      if (applied) {
        const nx = fromX + applied.dx;
        const nz = fromZ + applied.dz;
        moved.push({ itemId, from: { x: fromX, z: fromZ }, to: { x: nx, z: nz } });
        nextMovedSet.add(`${itemId}:${fromX.toFixed(3)},${fromZ.toFixed(3)}->${nx.toFixed(3)},${nz.toFixed(3)}`);
        // 应用到 currentItems，供后续 target 在同一遍内基于最新位置试
        currentItems = currentItems.map((it) => (it.id === itemId ? moveItem(it, nx, nz) : it));
      }
    }

    steps.push({ moved: [...moved], violations: [...violations] });
    lastMovedSet = nextMovedSet;

    // 终止条件：本遍 moved 为空 且 当前 ISLAND 数 = 0
    const afterViolations = evaluateFloor(currentItems, w, h, interiorWalls);
    const islandCount = afterViolations.filter((v) => v.kind === 'ISLAND').length;
    if (moved.length === 0 && islandCount === 0) {
      currentLayout = replaceFloorItems(layout, floorIndex, currentItems);
      return {
        layout: currentLayout,
        steps,
        remainingViolations: afterViolations,
        converged: true,
        iterations: iter + 1,
      };
    }
  }

  // 达到上界：返回当前状态
  currentLayout = replaceFloorItems(layout, floorIndex, currentItems);
  const finalViolations = evaluateFloor(currentItems, w, h, interiorWalls);
  return {
    layout: currentLayout,
    steps,
    remainingViolations: finalViolations,
    converged: false,
    iterations: maxIterations,
  };
}
