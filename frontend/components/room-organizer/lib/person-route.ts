import type { Vec2, WalkRoute } from './types';
import { resolveWalkerStep, type WalkCollider } from './walk-collision';

/**
 * PEOPLE-04：人物沿米制路线行走。纯几何 + 时间推进，不碰 three——
 * three 侧（three/people-anim.ts）只负责把结果写进场景对象和切 clip。
 *
 * Walk_Loop 是原位 clip（root.position 全程 span=0，见 people-model.test 的
 * 判读），所以位移完全由本引擎给出，clip 只管步态，不存在双重位移。
 * 1.05 m/s ≈ 1.4 m 步幅周期 ÷ 1.333 s clip 周期，timeScale=1 即步幅同步。
 */
export const PERSON_WALK_SPEED_MPS = 1.05;
export const PERSON_PAUSE_MS = 900;
/** 与人群 NPC 同款半径（lib/crowd-route.ts CROWD_WALKER_RADIUS）。 */
export const PERSON_WALK_RADIUS = 0.28;
/** 每帧最大转向速率：90° 转向约 0.17 s 完成，急转不瞬移也不拖影。 */
const TURN_RATE_RAD_PER_S = 9;
/** 实际位移小于意图位移的这一比例时视为被挡住（站住等，不硬挤）。 */
const BLOCKED_FRACTION = 0.25;
/**
 * 连续被挡超过这个时长就沿路线掉头反走：路线贴着障碍画时，碰撞推挤会把人
 * 钉在障碍面上（每帧位移≈0），不折返就是永久死锁（E2E 实测踩到）。
 */
const BLOCKED_TURNAROUND_S = 1.2;
/** 相邻路点小于这个距离视为同一点（防手抖双击造出零长段）。 */
export const MIN_WAYPOINT_DISTANCE_M = 0.15;
/** 路线最多途经点：防御性上限，画布点多少都不至于撑爆存档。 */
export const MAX_WAYPOINTS = 32;
/** 路线点距场地边界的最小距离（人物半径 + 一点余量）。 */
export const ROUTE_BOUNDARY_MARGIN_M = 0.3;
/**
 * 途经点贴障提示阈值：距最近障碍不足此值时布点提示但不阻断（1.2s 受阻掉头
 * 仍兜底）。E2E 实踩 0.2m 间隙会被推挤钉死反走徘徊，0.5m ≈ 半径 + 一步余量。
 */
export const ROUTE_WAYPOINT_CLEARANCE_WARN_M = 0.5;

export interface RouteFollowerState {
  /** 当前位置（米，场景坐标）。从首个路点出发。 */
  x: number;
  z: number;
  /** 朝向（弧度），平滑转向。 */
  facing: number;
  /** 正在走向的路点下标。 */
  segment: number;
  /** 沿路点的行进方向：+1 顺行、-1 反行（闭环反走或折返）。 */
  dir: 1 | -1;
  /** 当前途经点剩余停留秒数。 */
  remainingPause: number;
  /** 里程表：实际位移累计（米）——「走过的距离与路线相符」的验收依据。 */
  travelled: number;
  /** 已跑过的整圈（闭环：抵达首点计一圈）或完成的折返（pingpong）次数。 */
  laps: number;
  /** 连续被挡的累计秒数；超过阈值就地掉头，路线永远不通也不僵住。 */
  blockedFor: number;
}

export interface RouteStepContext {
  /** 家具/隔墙的碰撞盒；省缺则不避障（仍会夹在边界内）。 */
  colliders?: readonly WalkCollider[];
  /** 可走范围的矩形边界（米）；省缺则不夹取。 */
  bounds?: { minX: number; minZ: number; maxX: number; maxZ: number };
}

export interface RouteStepResult {
  x: number;
  z: number;
  facing: number;
  /** 本帧真的在走（用于 walk/idle clip 切换）。 */
  moving: boolean;
  /** 被障碍挡住（站住等路通）——UI 可用它提示，但视觉上等同停留。 */
  blocked: boolean;
}

export function normalizeRouteSpeed(route: WalkRoute): number {
  return typeof route.speed === 'number' && isFinite(route.speed) && route.speed > 0.05
    ? Math.min(route.speed, 3)
    : PERSON_WALK_SPEED_MPS;
}

export function normalizeRoutePause(route: WalkRoute): number {
  return typeof route.pauseMs === 'number' && isFinite(route.pauseMs) && route.pauseMs >= 0
    ? route.pauseMs
    : PERSON_PAUSE_MS;
}

export function routeIsLoop(route: WalkRoute): boolean {
  return route.loop !== false;
}

/** 路线总长（闭环时含末点→首点的收尾段）。 */
export function routeLength(points: readonly Vec2[], loop: boolean): number {
  let total = 0;
  for (let i = 0; i < points.length - 1; i++) {
    total += Math.hypot(points[i + 1]!.x - points[i]!.x, points[i + 1]!.z - points[i]!.z);
  }
  if (loop && points.length > 2) {
    total += Math.hypot(points[0]!.x - points[points.length - 1]!.x, points[0]!.z - points[points.length - 1]!.z);
  }
  return total;
}

export function createRouteFollower(route: WalkRoute): RouteFollowerState {
  const first = route.points[0] ?? { x: 0, z: 0 };
  return {
    x: first.x,
    z: first.z,
    facing: 0,
    segment: Math.min(1, Math.max(0, route.points.length - 1)),
    dir: 1,
    remainingPause: 0,
    travelled: 0,
    laps: 0,
    blockedFor: 0,
  };
}

/** 路线内容是否真的变了（同一布局重建后决定要不要保留行走进度）。 */
export function routeSignature(route: WalkRoute | undefined): string | null {
  if (!route || route.points.length < 2) return null;
  return JSON.stringify([route.points, route.loop !== false]);
}

function advanceSegment(route: WalkRoute, state: RouteFollowerState): void {
  const n = route.points.length;
  if (routeIsLoop(route)) {
    // 闭环按当前方向环走；抵达首点（无论顺逆）计一圈。
    const arrived = state.segment;
    state.segment = (state.segment + state.dir + n) % n;
    if (arrived === 0) state.laps += 1;
    return;
  }
  // 折返：到头反向。折返点同样停留，来回各计一次 lap。
  const next = state.segment + state.dir;
  if (next >= n || next < 0) {
    state.dir = state.dir === 1 ? -1 : 1;
    state.laps += 1;
  }
  state.segment += state.dir;
}

/** 受阻掉头：目标换成身后的路点，沿原路反走（身后是刚走过来的自由空间）。 */
function reverseDirection(route: WalkRoute, state: RouteFollowerState): void {
  const n = route.points.length;
  const behind = state.segment - state.dir;
  state.dir = state.dir === 1 ? -1 : 1;
  if (routeIsLoop(route)) {
    state.segment = (behind + n) % n;
  } else {
    state.segment = Math.min(n - 1, Math.max(0, behind));
  }
  state.blockedFor = 0;
}

function shortestTurn(current: number, target: number): number {
  let delta = (target - current) % (Math.PI * 2);
  if (delta > Math.PI) delta -= Math.PI * 2;
  if (delta < -Math.PI) delta += Math.PI * 2;
  return delta;
}

function headingTo(from: RouteFollowerState, x: number, z: number): number {
  return Math.atan2(x - from.x, z - from.z);
}

const stepOut = { x: 0, z: 0 };

/**
 * 推进一帧。`delta` 上限由调用方夹（渲染循环已统一 0.1 s）。
 * 停留 / 被挡时不产生位移，返回 moving=false 供调用方切 idle clip。
 */
export function stepRouteFollower(
  state: RouteFollowerState,
  route: WalkRoute,
  deltaSeconds: number,
  ctx: RouteStepContext = {}
): RouteStepResult {
  const points = route.points;
  if (points.length < 2) {
    return { x: state.x, z: state.z, facing: state.facing, moving: false, blocked: false };
  }
  if (deltaSeconds <= 0) {
    return { x: state.x, z: state.z, facing: state.facing, moving: false, blocked: false };
  }

  if (state.remainingPause > 0) {
    state.remainingPause = Math.max(0, state.remainingPause - deltaSeconds);
    return { x: state.x, z: state.z, facing: state.facing, moving: false, blocked: false };
  }

  const target = points[state.segment] ?? points[points.length - 1]!;
  const speed = normalizeRouteSpeed(route);
  const intended = Math.min(speed * deltaSeconds, Math.hypot(target.x - state.x, target.z - state.z));
  const dirX = target.x - state.x;
  const dirZ = target.z - state.z;
  const distance = Math.hypot(dirX, dirZ);

  stepOut.x = state.x;
  stepOut.z = state.z;
  let x = state.x;
  let z = state.z;
  if (distance > 1e-6) {
    const scale = Math.min(1, intended / distance);
    x = state.x + dirX * scale;
    z = state.z + dirZ * scale;
    if (ctx.colliders && ctx.colliders.length > 0) {
      stepOut.x = x;
      stepOut.z = z;
      resolveWalkerStep(ctx.colliders, state, stepOut, PERSON_WALK_RADIUS, stepOut);
      x = stepOut.x;
      z = stepOut.z;
    }
    if (ctx.bounds) {
      const { minX, minZ, maxX, maxZ } = ctx.bounds;
      x = Math.min(maxX, Math.max(minX, x));
      z = Math.min(maxZ, Math.max(minZ, z));
    }
  }

  const actual = Math.hypot(x - state.x, z - state.z);
  const reached = distance <= 1e-6 || actual >= distance - 1e-4;
  const blocked = !reached && actual < intended * BLOCKED_FRACTION;
  state.travelled += actual;
  if (blocked) {
    state.blockedFor += deltaSeconds;
    // 被挡超过阈值就地掉头：目标换成身后的路点，下一帧沿原路反走。
    if (state.blockedFor >= BLOCKED_TURNAROUND_S) {
      reverseDirection(route, state);
      return { x: state.x, z: state.z, facing: state.facing, moving: false, blocked: true };
    }
  } else {
    state.blockedFor = 0;
  }

  if (reached && distance > 1e-6) {
    state.x = target.x;
    state.z = target.z;
    advanceSegment(route, state);
    const pause = normalizeRoutePause(route);
    if (pause > 0) state.remainingPause = pause / 1000;
  } else {
    state.x = x;
    state.z = z;
  }

  // 转向只朝移动方向平滑；被挡或停留时保持原朝向（站住不原地打转）。
  const moving = reached ? false : !blocked;
  if (moving) {
    const heading = headingTo(state, target.x, target.z);
    const turn = shortestTurn(state.facing, heading);
    const maxTurn = TURN_RATE_RAD_PER_S * deltaSeconds;
    state.facing += Math.abs(turn) <= maxTurn ? turn : Math.sign(turn) * maxTurn;
  }
  return { x: state.x, z: state.z, facing: state.facing, moving, blocked };
}

/** 画布布点时的合法性检查（矩形形式）：界内（四至直接给定——实景点云范围
 * 有落位偏移，不再以房间中心为原点）、与上一点不重叠。返回错误文案或 null。 */
export function routePointErrorInRect(
  points: readonly Vec2[],
  point: Vec2,
  rect: { minX: number; maxX: number; minZ: number; maxZ: number }
): string | null {
  if (points.length >= MAX_WAYPOINTS) return `路线最多 ${MAX_WAYPOINTS} 个途经点。`;
  const margin = ROUTE_BOUNDARY_MARGIN_M;
  if (point.x < rect.minX + margin || point.x > rect.maxX - margin ||
      point.z < rect.minZ + margin || point.z > rect.maxZ - margin) {
    return '路点要留在场地内（距边界至少 0.3 m）。';
  }
  const last = points[points.length - 1];
  if (last && Math.hypot(point.x - last.x, point.z - last.z) < MIN_WAYPOINT_DISTANCE_M) {
    return '新路点离上一个点太近了（至少 0.15 m）。';
  }
  return null;
}

/** 画布布点时的合法性检查：界内（房间中心为原点）、与上一点不重叠。返回错误文案或 null。 */
export function routePointError(
  points: readonly Vec2[],
  point: Vec2,
  bounds: { width: number; depth: number }
): string | null {
  return routePointErrorInRect(points, point, {
    minX: -bounds.width / 2,
    maxX: bounds.width / 2,
    minZ: -bounds.depth / 2,
    maxZ: bounds.depth / 2,
  });
}

/**
 * 巡游夹取框：真实景（点云就绪）用点云实测四至内缩边界余量——巡游人物与
 * 第一人称漫游共用同一条实景围栏，不再被布局名义矩形困住或放空；无实景或
 * 范围退化（任一边 ≤ 2×余量）时回退布局矩形。坐标同为场景系（房间中心原点）。
 */
export function personWalkBounds(
  splat: { minX: number; maxX: number; minZ: number; maxZ: number } | null | undefined,
  layout: { width: number; depth: number }
): { minX: number; minZ: number; maxX: number; maxZ: number } {
  const margin = ROUTE_BOUNDARY_MARGIN_M;
  if (splat && splat.maxX - splat.minX > margin * 2 && splat.maxZ - splat.minZ > margin * 2) {
    return {
      minX: splat.minX + margin,
      minZ: splat.minZ + margin,
      maxX: splat.maxX - margin,
      maxZ: splat.maxZ - margin,
    };
  }
  return {
    minX: -(layout.width / 2 - margin),
    minZ: -(layout.depth / 2 - margin),
    maxX: layout.width / 2 - margin,
    maxZ: layout.depth / 2 - margin,
  };
}
