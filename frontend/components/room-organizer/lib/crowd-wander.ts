/**
 * 户外人群松散闲逛状态机（#103，纯函数层，零 three 依赖）。
 *
 * 口径：
 * - 只服务「无固定人流动线」的 wander 类角色；定点值守的 guard 类不走这里（见
 *   `lib/crowd-behavior.ts`）。人流动线 follower（#102）优先级高于本状态机。
 * - `idle ↔ walk` 两段循环：停留一段随机时长后，在锚点周围一个漫游半径内挑一个
 *   边界内、离碰撞体有足够余量的步点；走到步点后回 idle。选不到合法点就继续留守，
 *   不计失败、不硬闯障碍物。
 * - 随机数走 mulberry32，状态随 agent 持久化，同一 seed + 同一路径可完整重放，便于单测复现。
 * - 坐标与人群落点同属 crowdLayer 组内局部坐标（x 东、z 南），由场景层把结果写进组位置。
 */
import { walkerClearanceAt } from './walk-collision';
import type { WalkCollider, WalkerPosition } from './walk-collision';

/** 闲逛行为模式：idle 留守锚点，walk 朝步点短程漫步。 */
export type WanderMode = 'idle' | 'walk';

export interface WanderPoint {
  x: number;
  z: number;
}

/** 矩形活动边界（由 #104 从场地 frame 内缩生成），组内局部坐标。 */
export interface WanderBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/** 一个闲逛个体的可持久化状态；场景层每帧把它读回 three 摆位。 */
export interface WanderAgent {
  /** mulberry32 内部状态，随步进演进，保证可重放。 */
  rngState: number;
  mode: WanderMode;
  /** 岗位锚点：闲逛步点围绕它分布，不离开岗位太远。 */
  home: WanderPoint;
  position: WanderPoint;
  /** walk 模式下的目标步点；idle 时为 null。 */
  target: WanderPoint | null;
  /** 当前模式剩余毫秒：idle 为停留倒计时，walk 为到达预估倒计时。 */
  timerMs: number;
  /** 连续挑不到合法步点的次数；回到步点清零，全部用于受阻兜底判断。 */
  blockedAttempts: number;
}

export interface WanderOptions {
  /** 漫步速度（米/秒）。缺省 1.1。 */
  speedMs?: number;
  /** idle 停留区间 [下限, 上限]（毫秒）。缺省 [2500, 7000]。 */
  idleMs?: readonly [number, number];
  /** 单次漫步半径上限（米）。缺省 1.6。 */
  roamRadius?: number;
  /** 人物占位半径（米）。缺省 0.3。 */
  radius?: number;
  /** 步点离碰撞体的最小余量（米）。缺省 0.35。 */
  minClearance?: number;
  /** 单次选点尝试次数，超限判定本轮受阻。缺省 12。 */
  maxAttempts?: number;
}

const DEFAULTS = {
  speedMs: 1.1,
  idleMinMs: 2500,
  idleMaxMs: 7000,
  roamRadius: 1.6,
  radius: 0.3,
  minClearance: 0.35,
  maxAttempts: 12,
} as const;

/** mulberry32 步进：返回下一个 [0,1) 随机数与演进后的状态。 */
function nextRandom(state: number): [number, number] {
  let t = (state + 0x6d2b79f5) | 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return [value, t];
}

function inBounds(point: Readonly<WanderPoint>, bounds: WanderBounds | null): boolean {
  if (!bounds) return true;
  return (
    point.x >= bounds.minX &&
    point.x <= bounds.maxX &&
    point.z >= bounds.minZ &&
    point.z <= bounds.maxZ
  );
}

function clearanceEnough(
  point: Readonly<WalkerPosition>,
  colliders: readonly WalkCollider[],
  radius: number,
  minClearance: number,
): boolean {
  if (colliders.length === 0) return true;
  // 户外无室内/室外之分：所有碰撞体都参与余量判定。
  return walkerClearanceAt(colliders, point, {}) >= radius + minClearance;
}

/**
 * 创建一个闲逛个体：从 idle 开始，停留第一段随机时长。
 * `seed` 取岗位 id 哈希或序号，保证同类个体互不相同、又可重放。
 */
export function createWanderAgent(
  seed: number,
  home: Readonly<WanderPoint>,
  options: WanderOptions = {},
): WanderAgent {
  const idle: readonly [number, number] = options.idleMs ?? [DEFAULTS.idleMinMs, DEFAULTS.idleMaxMs];
  const state = seed | 0;
  const [first, nextState] = nextRandom(state);
  const timerMs = idle[0] + first * (idle[1] - idle[0]);
  return {
    rngState: nextState,
    mode: 'idle',
    home: { x: home.x, z: home.z },
    position: { x: home.x, z: home.z },
    target: null,
    timerMs,
    blockedAttempts: 0,
  };
}

/** 在锚点周围挑一个边界内、避障达标的随机步点；挑不到返回 null（受阻兜底）。 */
function pickTarget(
  agent: WanderAgent,
  colliders: readonly WalkCollider[],
  bounds: WanderBounds | null,
  options: WanderOptions,
): WanderPoint | null {
  const roamRadius = options.roamRadius ?? DEFAULTS.roamRadius;
  const radius = options.radius ?? DEFAULTS.radius;
  const minClearance = options.minClearance ?? DEFAULTS.minClearance;
  const maxAttempts = options.maxAttempts ?? DEFAULTS.maxAttempts;

  let state = agent.rngState;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const [ang, s1] = nextRandom(state);
    const [dist, s2] = nextRandom(s1);
    state = s2;
    const angle = ang * Math.PI * 2;
    const radiusAt = Math.sqrt(dist) * roamRadius;
    const candidate: WanderPoint = {
      x: agent.home.x + Math.cos(angle) * radiusAt,
      z: agent.home.z + Math.sin(angle) * radiusAt,
    };
    if (!inBounds(candidate, bounds)) continue;
    if (!clearanceEnough(candidate, colliders, radius, minClearance)) continue;
    agent.rngState = state;
    return candidate;
  }
  // 本轮选点耗尽：回退保留状态，下一段 idle 再试。
  agent.rngState = state;
  return null;
}

/**
 * 推进一个闲逛个体一个时间片（纯函数：就地更新 `agent`，并原样返回）。
 *
 * - idle 倒计时结束 → 选步点；成功转 walk，受阻则延长留守、`blockedAttempts` 累加。
 * - walk 按速度朝 target 移动；到达后回 idle，重设随机停留，受阻计数清零。
 * - `dtMs` 为帧间隔毫秒；colliders/bounds 缺省表示无碰撞、无边界约束。
 */
export function stepWanderAgent(
  agent: WanderAgent,
  dtMs: number,
  colliders: readonly WalkCollider[] = [],
  bounds: WanderBounds | null = null,
  options: WanderOptions = {},
): WanderAgent {
  if (!(dtMs > 0)) return agent;
  const speed = options.speedMs ?? DEFAULTS.speedMs;
  const idle: readonly [number, number] = options.idleMs ?? [DEFAULTS.idleMinMs, DEFAULTS.idleMaxMs];

  if (agent.mode === 'idle') {
    agent.timerMs -= dtMs;
    if (agent.timerMs > 0) return agent;

    const target = pickTarget(agent, colliders, bounds, options);
    if (!target) {
      // 受阻：留在锚点附近，下一段稍短的停留后重试，避免每帧空转选点。
      agent.blockedAttempts += 1;
      agent.timerMs = Math.min(idle[1], Math.max(idle[0], idle[1] / 2));
      return agent;
    }
    agent.target = target;
    agent.mode = 'walk';
    agent.blockedAttempts = 0;
    const distance = Math.hypot(target.x - agent.position.x, target.z - agent.position.z);
    agent.timerMs = (distance / speed) * 1000;
    return agent;
  }

  // walk：按本帧预算朝 target 逼近，到达即回 idle。
  const target = agent.target!;
  const dx = target.x - agent.position.x;
  const dz = target.z - agent.position.z;
  const distance = Math.hypot(dx, dz);
  const stepDistance = (speed * dtMs) / 1000;
  if (distance <= Math.max(stepDistance, 1e-3)) {
    agent.position.x = target.x;
    agent.position.z = target.z;
    agent.target = null;
    agent.mode = 'idle';
    agent.blockedAttempts = 0;
    const [roll, nextState] = nextRandom(agent.rngState);
    agent.rngState = nextState;
    agent.timerMs = idle[0] + roll * (idle[1] - idle[0]);
    return agent;
  }

  const ratio = stepDistance / distance;
  agent.position.x += dx * ratio;
  agent.position.z += dz * ratio;
  agent.timerMs -= dtMs;
  return agent;
}
