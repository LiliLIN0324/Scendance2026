/**
 * 通行体检（纯函数，零 three 依赖）。
 *
 * 漫游能让人"自己走一遍"，但走一遍只能发现"我撞到了这一顶帐篷"。主办方真正要的是
 * 一张结论：哪里根本走不到、哪条流线被压住、哪条通道窄到推车过不去。这里把
 * `planPlayerColliders` 已经算好的世界系盒子栅格化，做一次四邻域洪水填充，输出：
 *
 * 1. 可达面积与占比；
 * 2. 走不到的设施（中心点落在障碍里或与入口不连通）；
 * 3. 被压住的流线（沿流线采样，第一个走不过去的点 + 挡路的设施名）；
 * 4. 窄通道（流线上最窄处的通过宽度，按"到最近障碍的距离 × 2"估）。
 *
 * 三条口径与玩家实际行走保持一致，避免"体检说能走、真走撞上"：
 * - 障碍按玩家半径 0.28 m 外扩（`PERSON_WALK_RADIUS_M`）；
 * - 座位/过小件不挡（沿用 `planPlayerColliders` 的排除规则，不另写一套）；
 * - 红线外的格子直接算障碍（`pointInBoundaryRing` 与漫游同一份钳制）。
 *
 * 已知边界：只做水平 2D，不看高度（帐篷和舞台一律当实心）；网格 0.25 m 是
 * "人能不能过"的精度，不是厘米级量距。
 */
import { pointInBoundaryRing, worldToEnu } from './outdoor-walk-boundary';
import { planPlayerColliders, planPlayerSiteCenter, type PlanWorldPoint } from './plan-player-colliders';
import { planRouteFrame } from './plan-walk-context';
import { sightlineHit } from './walk-sightline';
import type { WalkCollider } from './walk-collision';
import type { PlanFacility, PlanPoint } from '../../../../supabase/functions/_shared/site-plan';
import type { PlanSiteMetrics } from './plan-scene-placement';

/** 体检网格边长（米）。0.25 m 够判"人能不能过"，再细只是算得慢。 */
export const AUDIT_CELL_M = 0.25;
/** 与 `use-outdoor-walk` / 人群一致的行人半径（米）。 */
export const AUDIT_WALK_RADIUS_M = 0.28;
/** 窄于这个宽度的通道按"推车/并排走不过"提示（米）。 */
export const NARROW_PASSAGE_M = 0.9;
/** 流线采样步长（米）。 */
const ROUTE_SAMPLE_M = 0.3;

export interface WalkAuditRoute {
  points: readonly PlanPoint[];
  kind?: string;
  name?: string;
}

export interface WalkAuditOptions {
  facilities: readonly PlanFacility[];
  boundary: readonly PlanPoint[];
  metrics: PlanSiteMetrics;
  routes?: readonly WalkAuditRoute[];
  /** 体检起点（世界系）；缺省取场地中心。 */
  start?: PlanWorldPoint;
  walkRadius?: number;
  cellSizeM?: number;
  /** 场地中心（世界系）；缺省按 boundary 现算，与场景层保持同源。 */
  center?: PlanWorldPoint;
}

export interface WalkAuditFacilityIssue {
  id: string;
  name: string;
  /** `inside`：中心就压在障碍里；`isolated`：中心空旷但与入口不连通。 */
  reason: 'inside' | 'isolated';
}

export interface WalkAuditRouteIssue {
  index: number;
  kind: string | null;
  name: string | null;
  /** 从流线起点算起，第一个走不过去的位置（米）。 */
  distanceAlongM: number;
  /** 挡在这个位置上的设施名。 */
  blockers: string[];
}

export interface WalkAuditNarrowSpot {
  routeIndex: number;
  distanceAlongM: number;
  /** 估出来的通过宽度（米）＝到最近障碍距离 × 2。 */
  widthM: number;
}

export interface WalkAuditSightline {
  /** 看的对象（面积最大的设施，当作主舞台 / 主篷房）。 */
  target: string;
  blocked: boolean;
  distanceM: number | null;
  ratio: number;
}

export interface WalkAuditReport {
  cellSizeM: number;
  walkRadiusM: number;
  /** 红线内的可走面积（m²，网格近似）。 */
  areaM2: number;
  /** 从起点真能走到的面积（m²）。 */
  reachableAreaM2: number;
  reachableRatio: number;
  facilityCount: number;
  unreachableFacilities: WalkAuditFacilityIssue[];
  blockedRoutes: WalkAuditRouteIssue[];
  narrowSpots: WalkAuditNarrowSpot[];
  /** 流线上最窄的通过宽度（米）；没有流线时为 null。 */
  narrowestRouteWidthM: number | null;
  /** 给 HUD 用的一句话结论。 */
  headline: string;
  /** 从起点看最大设施的视线（自动选一个目标，不代替人工判断）。 */
  sightline: WalkAuditSightline | null;
}

interface Grid {
  cols: number;
  rows: number;
  cell: number;
  minX: number;
  minZ: number;
  /** 1 = 障碍 / 红线外。 */
  blocked: Uint8Array;
  /** 1 = 只有设施占的格（不含红线外），窄通道只按这个算。 */
  obstacle: Uint8Array;
  reachable: Uint8Array;
  /** 到最近障碍的格数（0 = 自身是障碍）。 */
  clearance: Float32Array;
}

function colliderBlocks(collider: WalkCollider, x: number, z: number, pad: number): boolean {
  const dx = x - collider.cx;
  const dz = z - collider.cz;
  const lx = dx * collider.ax + dz * collider.az;
  const lz = dx * collider.bx + dz * collider.bz;
  return Math.abs(lx) <= collider.hw + pad && Math.abs(lz) <= collider.hd + pad;
}

/** 外接框 → 网格尺寸；留一格余量，保证红线边缘也有格子。 */
function buildGrid(boundary: readonly PlanPoint[], cell: number): Grid {
  let minX = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;
  for (const point of boundary) {
    if (!Number.isFinite(point?.x) || !Number.isFinite(point?.y)) continue;
    const world = { x: point.x, z: -point.y };
    minX = Math.min(minX, world.x);
    maxX = Math.max(maxX, world.x);
    minZ = Math.min(minZ, world.z);
    maxZ = Math.max(maxZ, world.z);
  }
  if (!Number.isFinite(minX) || minX === Infinity) {
    minX = -1; maxX = 1; minZ = -1; maxZ = 1;
  }
  const pad = cell * 2;
  const originX = minX - pad;
  const originZ = minZ - pad;
  const cols = Math.max(1, Math.ceil((maxX - minX + pad * 2) / cell));
  const rows = Math.max(1, Math.ceil((maxZ - minZ + pad * 2) / cell));
  return {
    cols,
    rows,
    cell,
    minX: originX,
    minZ: originZ,
    blocked: new Uint8Array(cols * rows),
    obstacle: new Uint8Array(cols * rows),
    reachable: new Uint8Array(cols * rows),
    clearance: new Float32Array(cols * rows),
  };
}

function cellCenter(grid: Grid, index: number): { x: number; z: number } {
  const col = index % grid.cols;
  const row = Math.floor(index / grid.cols);
  return {
    x: grid.minX + (col + 0.5) * grid.cell,
    z: grid.minZ + (row + 0.5) * grid.cell,
  };
}

function cellIndexAt(grid: Grid, x: number, z: number): number | null {
  const col = Math.floor((x - grid.minX) / grid.cell);
  const row = Math.floor((z - grid.minZ) / grid.cell);
  if (col < 0 || row < 0 || col >= grid.cols || row >= grid.rows) return null;
  return row * grid.cols + col;
}

/** 洪水填充：返回起点格；起点本身是障碍时找最近的空格。 */
function floodFill(grid: Grid, start: number | null): number | null {
  if (start === null) return null;
  let seed = start;
  if (grid.blocked[seed]) {
    seed = nearestFree(grid, start);
    if (seed < 0) return null;
  }
  const queue = new Int32Array(grid.cols * grid.rows);
  let head = 0;
  let tail = 0;
  queue[tail++] = seed;
  grid.reachable[seed] = 1;
  while (head < tail) {
    const current = queue[head++]!;
    const col = current % grid.cols;
    const row = Math.floor(current / grid.cols);
    if (col > 0) tail = pushFree(grid, current - 1, queue, tail);
    if (col + 1 < grid.cols) tail = pushFree(grid, current + 1, queue, tail);
    if (row > 0) tail = pushFree(grid, current - grid.cols, queue, tail);
    if (row + 1 < grid.rows) tail = pushFree(grid, current + grid.cols, queue, tail);
  }
  return seed;
}

function pushFree(grid: Grid, index: number, queue: Int32Array, tail: number): number {
  if (grid.blocked[index] || grid.reachable[index]) return tail;
  grid.reachable[index] = 1;
  queue[tail] = index;
  return tail + 1;
}

/** 起点被占时，螺旋找最近的空格（最多 8 格 ≈ 2 m）。 */
function nearestFree(grid: Grid, start: number): number {
  const col0 = start % grid.cols;
  const row0 = Math.floor(start / grid.cols);
  for (let ring = 1; ring <= 8; ring++) {
    for (let dr = -ring; dr <= ring; dr++) {
      for (let dc = -ring; dc <= ring; dc++) {
        if (Math.abs(dr) !== ring && Math.abs(dc) !== ring) continue;
        const col = col0 + dc;
        const row = row0 + dr;
        if (col < 0 || row < 0 || col >= grid.cols || row >= grid.rows) continue;
        const index = row * grid.cols + col;
        if (!grid.blocked[index]) return index;
      }
    }
  }
  return -1;
}

/** 多源 BFS：每个格子到最近设施障碍的格数，用来估"这里能过多宽"。
 *  只从设施格出发：流线贴着红线走时，场外不该被当成"窄通道"。 */
function computeClearance(grid: Grid): void {
  const total = grid.cols * grid.rows;
  const queue = new Int32Array(total);
  let head = 0;
  let tail = 0;
  for (let i = 0; i < total; i++) {
    if (grid.obstacle[i]) {
      grid.clearance[i] = 0;
      queue[tail++] = i;
    } else {
      grid.clearance[i] = Number.POSITIVE_INFINITY;
    }
  }
  while (head < tail) {
    const current = queue[head++]!;
    const col = current % grid.cols;
    const row = Math.floor(current / grid.cols);
    const next = grid.clearance[current]! + 1;
    const visit = (index: number) => {
      if (grid.clearance[index]! > next) {
        grid.clearance[index] = next;
        queue[tail++] = index;
      }
    };
    if (col > 0) visit(current - 1);
    if (col + 1 < grid.cols) visit(current + 1);
    if (row > 0) visit(current - grid.cols);
    if (row + 1 < grid.rows) visit(current + grid.cols);
  }
}

/**
 * 设施能不能走到：看它四周一圈有没有可站的地方。
 *
 * 不能直接看设施中心——中心永远落在它自己的占地盒里，会被误判成“压在障碍中”。
 * 沿外接半径外 0.35 m 采 12 个点：有一个可达就算能走到；有点空旷但都不可达算
 * `isolated`（被墙隔开）；一圈全是障碍算 `inside`；全在红线外则跳过。
 */
function facilityReach(
  grid: Grid,
  center: PlanWorldPoint,
  radiusM: number,
  seed: number | null
): 'reachable' | 'isolated' | 'inside' | 'outside' {
  let sawFree = false;
  let sawInsideSite = false;
  for (let i = 0; i < 12; i++) {
    const angle = (i / 12) * Math.PI * 2;
    const x = center.x + Math.cos(angle) * radiusM;
    const z = center.z + Math.sin(angle) * radiusM;
    const index = cellIndexAt(grid, x, z);
    if (index === null) continue;
    sawInsideSite = true;
    if (grid.blocked[index]) continue;
    sawFree = true;
    if (seed !== null && grid.reachable[index]) return 'reachable';
  }
  if (!sawInsideSite) return 'outside';
  if (!sawFree) return 'inside';
  return 'isolated';
}

/** 世界系折线 → 沿线每 0.3 m 的采样（含首尾）。 */
function samplePolyline(points: readonly PlanWorldPoint[]): Array<{ x: number; z: number; along: number }> {
  const samples: Array<{ x: number; z: number; along: number }> = [];
  if (points.length === 0) return samples;
  let along = 0;
  samples.push({ ...points[0]!, along: 0 });
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const length = Math.hypot(b.x - a.x, b.z - a.z);
    const steps = Math.max(1, Math.ceil(length / ROUTE_SAMPLE_M));
    for (let k = 1; k <= steps; k++) {
      const t = k / steps;
      samples.push({
        x: a.x + (b.x - a.x) * t,
        z: a.z + (b.z - a.z) * t,
        along: along + length * t,
      });
    }
    along += length;
  }
  return samples;
}

/**
 * 跑一次通行体检。
 *
 * 复杂度：格子数 × (设施数 + 1)。60 个设施、60×40 m 场地约 4 万格，
 * 单次在毫秒级，适合放在 plan 变化时算一次（不要在 RAF 里调）。
 */
export function auditWalkability(options: WalkAuditOptions): WalkAuditReport {
  const {
    facilities,
    boundary,
    metrics,
    routes = [],
    walkRadius = AUDIT_WALK_RADIUS_M,
    cellSizeM = AUDIT_CELL_M,
  } = options;
  const center = options.center ?? planPlayerSiteCenter(boundary);
  const colliders = planPlayerColliders(facilities, boundary, metrics, center);
  const { toLocal } = planRouteFrame(boundary, metrics);
  const toWorld = (point: PlanPoint): PlanWorldPoint => {
    const local = toLocal(point);
    return { x: local.x + center.x, z: local.z + center.z };
  };

  // 设施名 ↔ 碰撞盒：盒子不带 id，按中心点回查，供"挡路的是谁"用。
  const colliderOwners: Array<string | null> = colliders.map((collider) => {
    for (const facility of facilities) {
      if (!facility?.position) continue;
      const world = toWorld(facility.position);
      if (Math.hypot(world.x - collider.cx, world.z - collider.cz) < 0.02) {
        return facility.name || facility.templateId || facility.id;
      }
    }
    return null;
  });

  const grid = buildGrid(boundary, cellSizeM);
  const total = grid.cols * grid.rows;
  for (let i = 0; i < total; i++) {
    const { x, z } = cellCenter(grid, i);
    if (!pointInBoundaryRing(worldToEnu(x, z), boundary)) {
      grid.blocked[i] = 1;
      continue;
    }
    for (const collider of colliders) {
      if (colliderBlocks(collider, x, z, walkRadius)) {
        grid.blocked[i] = 1;
        grid.obstacle[i] = 1;
        break;
      }
    }
  }

  const start = options.start ?? center;
  const seed = floodFill(grid, cellIndexAt(grid, start.x, start.z));
  computeClearance(grid);

  let areaCells = 0;
  let reachableCells = 0;
  for (let i = 0; i < total; i++) {
    if (!grid.blocked[i]) areaCells++;
    if (grid.reachable[i]) reachableCells++;
  }
  const areaM2 = areaCells * cellSizeM * cellSizeM;
  const reachableAreaM2 = reachableCells * cellSizeM * cellSizeM;

  const unreachableFacilities: WalkAuditFacilityIssue[] = [];
  for (const facility of facilities) {
    if (!facility?.position) continue;
    const world = toWorld(facility.position);
    const halfW = Math.max(0.3, (facility.size?.width ?? 0) / 2);
    const halfD = Math.max(0.3, (facility.size?.depth ?? 0) / 2);
    const status = facilityReach(grid, world, Math.max(halfW, halfD) + 0.35, seed);
    if (status === 'isolated' || status === 'inside') {
      unreachableFacilities.push({
        id: facility.id,
        name: facility.name || facility.templateId || facility.id,
        reason: status,
      });
    }
  }

  const blockedRoutes: WalkAuditRouteIssue[] = [];
  const narrowSpots: WalkAuditNarrowSpot[] = [];
  for (let routeIndex = 0; routeIndex < routes.length; routeIndex++) {
    const route = routes[routeIndex]!;
    const world = route.points.map(toWorld);
    const samples = samplePolyline(world);
    let firstBlocked: { along: number; blockers: string[] } | null = null;
    for (const sample of samples) {
      const index = cellIndexAt(grid, sample.x, sample.z);
      const blocked = index === null || grid.blocked[index] === 1 || (seed !== null && grid.reachable[index] === 0);
      if (blocked) {
        if (!firstBlocked) {
          const blockers: string[] = [];
          for (let c = 0; c < colliders.length; c++) {
            if (colliderBlocks(colliders[c]!, sample.x, sample.z, walkRadius)) {
              const owner = colliderOwners[c];
              if (owner && !blockers.includes(owner)) blockers.push(owner);
            }
          }
          firstBlocked = { along: sample.along, blockers };
        }
        continue;
      }
      const widthM = grid.clearance[index!]! * cellSizeM * 2;
      if (widthM < NARROW_PASSAGE_M) {
        narrowSpots.push({ routeIndex, distanceAlongM: Math.round(sample.along * 10) / 10, widthM: Math.round(widthM * 100) / 100 });
      }
    }
    if (firstBlocked) {
      blockedRoutes.push({
        index: routeIndex,
        kind: route.kind ?? null,
        name: route.name ?? null,
        distanceAlongM: Math.round(firstBlocked.along * 10) / 10,
        blockers: firstBlocked.blockers,
      });
    }
  }

  const narrowestRouteWidthM = narrowSpots.length === 0
    ? null
    : Math.min(...narrowSpots.map((spot) => spot.widthM));

  // 视线：从起点看“面积最大的一件设施”（通常就是主舞台 / 主篷房）。
  // 只做平面遮挡，结论按“可能遮挡”读，不当作精确视线分析。
  let sightline: WalkAuditSightline | null = null;
  const target = facilities
    .filter((facility) => facility?.position)
    .map((facility) => ({
      facility,
      area: (facility.size?.width ?? 0) * (facility.size?.depth ?? 0),
      world: toWorld(facility.position),
    }))
    .sort((a, b) => b.area - a.area)[0];
  if (target) {
    const targetIndex = colliders.findIndex(
      (collider) => Math.hypot(collider.cx - target.world.x, collider.cz - target.world.z) < 0.02
    );
    const others = targetIndex >= 0 ? colliders.filter((_, index) => index !== targetIndex) : colliders;
    const hit = sightlineHit(others, start, target.world, 0.1);
    sightline = {
      target: target.facility.name || target.facility.templateId || target.facility.id,
      blocked: hit.blocked,
      distanceM: hit.blocked ? Math.round(hit.distanceM * 10) / 10 : null,
      ratio: hit.blocked ? Math.round(hit.ratio * 100) / 100 : 0,
    };
  }

  const report: WalkAuditReport = {
    cellSizeM,
    walkRadiusM: walkRadius,
    areaM2: Math.round(areaM2 * 10) / 10,
    reachableAreaM2: Math.round(reachableAreaM2 * 10) / 10,
    reachableRatio: areaM2 > 0 ? Math.round((reachableAreaM2 / areaM2) * 1000) / 1000 : 0,
    facilityCount: facilities.length,
    unreachableFacilities,
    blockedRoutes,
    narrowSpots: narrowSpots.slice(0, 20),
    narrowestRouteWidthM,
    sightline,
    headline: '',
  };
  report.headline = describeWalkAudit(report);
  return report;
}

/** HUD / 面板用的一句话结论。 */
export function describeWalkAudit(report: WalkAuditReport): string {
  const parts: string[] = [`可达 ${Math.round(report.reachableRatio * 100)}%`];
  if (report.unreachableFacilities.length > 0) parts.push(`${report.unreachableFacilities.length} 件设施走不到`);
  if (report.blockedRoutes.length > 0) parts.push(`${report.blockedRoutes.length} 条流线被挡`);
  if (report.narrowestRouteWidthM !== null) parts.push(`最窄 ${report.narrowestRouteWidthM.toFixed(2)} m`);
  if (report.sightline?.blocked) parts.push(`看「${report.sightline.target}」被挡`);
  if (report.blockedRoutes.length === 0 && report.unreachableFacilities.length === 0) parts.push('通行正常');
  return parts.join(' · ');
}
