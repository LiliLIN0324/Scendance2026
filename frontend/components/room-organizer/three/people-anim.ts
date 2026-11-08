import type * as ThreeNS from 'three';
import type { HumanFigureRig } from './builders/human-figure';
import { poseWalk } from './builders/human-figure';
import {
  PERSON_WALK_SPEED_MPS,
  type RouteFollowerState,
  type RouteStepContext,
  createRouteFollower,
  routeSignature,
  stepRouteFollower,
} from '../lib/person-route';
import type { PersonAction, WalkRoute } from '../lib/types';

/**
 * PEOPLE-01/04：摆置人物动画的常驻注册表。
 *
 * 家具层是「layout 一变就整层重建」的模型（use-scene-effects 的家具 effect），
 * 所以 mixer 不能只挂在重建出来的 group 上——那样随便改个名字动画就从头来，
 * 行走进度也会被打回路线起点。注册表按 item id 存续，重建时：
 *  - 同一 id 重注册 → 换绑新 group/mixer，行走进度（follower）按路线签名保留；
 *  - item 被删 → group 脱离场景，tick 顺手把表项摘掉并释放 mixer。
 *
 * 渲染循环每帧调 advancePeopleAnimations；返回活跃数 >0 时调用方置脏，
 * 否则编辑器空闲时照旧整帧早退（render-on-demand，见 use-three-scene tick）。
 */

export interface PersonClips {
  idle: ThreeNS.AnimationClip | null;
  talk: ThreeNS.AnimationClip | null;
  walk: ThreeNS.AnimationClip | null;
}

/** builders-people 每次重建人物时提交的快照。mixer 由本次新建。 */
export interface PersonAnimSpec {
  id: string;
  /** 绑骨路径的 mixer；程序化兜底时为 null。 */
  mixer: ThreeNS.AnimationMixer | null;
  /** 程序化兜底的人形关节（human-figure），绑骨时为 null。 */
  rig: HumanFigureRig | null;
  clips: PersonClips;
  /** 无路线时的默认动作；带路线时被路线驱动覆盖。 */
  action: PersonAction;
  paused: boolean;
  route: WalkRoute | null;
}

interface PersonAnimEntry extends PersonAnimSpec {
  group: ThreeNS.Group;
  routeSig: string | null;
  follower: RouteFollowerState | null;
  currentAction: PersonAction;
  playingAction: ThreeNS.AnimationAction | null;
  /** 程序化兜底的步态相位。 */
  phase: number;
}

const entries = new Map<string, PersonAnimEntry>();
let walkContext: RouteStepContext = {};
let shadowRefresher: (() => void) | null = null;

/** 家具层随 layout 变化重建碰撞上下文（见 use-scene-effects 的行走上下文 effect）。 */
export function setPersonWalkContext(ctx: RouteStepContext | null): void {
  walkContext = ctx ?? {};
}

/**
 * 行走中的人物是动态阴影投影体，静态阴影图必须跟着重算（与 use-npcs 同款
 * 约束）。由 use-scene-effects 注入 requestShadowUpdate；每帧只在真的有人
 * 在走时调用一次。
 */
export function setPeopleShadowRefresher(fn: (() => void) | null): void {
  shadowRefresher = fn;
}

/** 只有显式开了动画的人物才进注册表：有路线、改过默认动作或被暂停。普通静态人物保持原状。 */
export function personIsAnimated(route: WalkRoute | undefined, action: PersonAction | undefined, paused: boolean | undefined): boolean {
  if (route && route.points.length >= 2) return true;
  return action !== undefined && action !== 'idle' || paused === true;
}

/** 稳定的时间错峰种子：三个人站一排不做同一个动作相位。 */
function stanceSeed(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return 0.6 + (hash % 1000) / 1000 * 1.9;
}

function playClip(entry: PersonAnimEntry, action: PersonAction, fadeSeconds = 0.18): void {
  if (!entry.mixer) return;
  const clip = entry.clips[action];
  if (!clip) return;
  const next = entry.mixer.clipAction(clip);
  if (entry.playingAction === next) return;
  if (entry.playingAction) entry.playingAction.fadeOut(fadeSeconds);
  next.reset().fadeIn(fadeSeconds).play();
  if (action === 'walk') {
    // 步幅同步：路线步速相对自然步速（1.05 m/s ≈ Walk_Loop timeScale 1）。
    const speed = entry.route ? clampWalkTimeScale(routeSpeedOf(entry.route)) : 1;
    next.timeScale = speed;
  }
  entry.playingAction = next;
  entry.currentAction = action;
}

function routeSpeedOf(route: WalkRoute): number {
  return typeof route.speed === 'number' && isFinite(route.speed) && route.speed > 0.05
    ? Math.min(route.speed, 3)
    : PERSON_WALK_SPEED_MPS;
}

function clampWalkTimeScale(speed: number): number {
  return Math.min(2.5, Math.max(0.5, speed / PERSON_WALK_SPEED_MPS));
}

/**
 * 家具重建时重新登记一个人物实例。旧表项的 mixer 立即释放；路线几何没变时
 * 行走进度与步态相位原样保留，动画看起来就像没被打断。
 */
export function registerPersonAnim(group: ThreeNS.Group, spec: PersonAnimSpec): void {
  const existing = entries.get(spec.id);
  const sig = routeSignature(spec.route ?? undefined);
  const follower =
    existing && existing.follower && existing.routeSig !== null && existing.routeSig === sig
      ? existing.follower
      : spec.route
        ? createRouteFollower(spec.route)
        : null;
  if (existing?.mixer) {
    existing.mixer.stopAllAction();
    existing.mixer.uncacheRoot(existing.mixer.getRoot());
  }
  const entry: PersonAnimEntry = {
    ...spec,
    group,
    routeSig: sig,
    follower,
    currentAction: spec.action,
    playingAction: null,
    phase: existing?.phase ?? 0,
  };
  entries.set(spec.id, entry);
  if (entry.follower) {
    // 重建出来的新 group 停在锚点/原点：注册时立刻落到行进位姿，暂停中也不瞬移。
    group.position.x = entry.follower.x;
    group.position.z = entry.follower.z;
    group.rotation.y = entry.follower.facing;
  }
  if (entry.mixer) {
    playClip(entry, entry.follower ? 'idle' : spec.action, 0);
    entry.mixer.update(stanceSeed(spec.id));
  } else if (entry.rig) {
    poseWalk(entry.rig, 0, 0);
  }
}

/** 测试用：当前注册表里的实例 id。 */
export function personAnimIds(): string[] {
  return [...entries.keys()];
}

/** 测试/调试用：读一个实例的里程与圈数。 */
export function personOdometer(id: string): { travelled: number; laps: number } | null {
  const follower = entries.get(id)?.follower;
  return follower ? { travelled: follower.travelled, laps: follower.laps } : null;
}

/**
 * 近景跟拍用：读一个在册实例的实时行进位姿（脚底位置 + 朝向）。
 * 不在册或已脱离场景返回 null——跟拍镜头以此判定目标消失并自动退出。
 */
export function personFollowSample(id: string): { x: number; z: number; facing: number } | null {
  const entry = entries.get(id);
  if (!entry || !entry.group.parent) return null;
  return { x: entry.group.position.x, z: entry.group.position.z, facing: entry.group.rotation.y };
}

export interface PersonWalkProbe {
  id: string;
  x: number;
  z: number;
  facing: number;
  travelled: number;
  laps: number;
  moving: boolean;
  paused: boolean;
  /** 该模块实例被渲染循环调用的次数（诊断 tick 接线/双实例用）。 */
  advanceCalls: number;
  /** 路线步进分支被执行的次数（诊断 follower/route 挂接用）。 */
  stepCalls: number;
  /** 入口上挂的路线点数；-1 表示 route 为空。 */
  routePoints: number;
  /** 入口是否持有 follower。 */
  hasFollower: boolean;
  /** group 是否还挂在场景里。 */
  attached: boolean;
}

let advanceCalls = 0;
let stepCalls = 0;

/** 走查/E2E 探针：读全部在册实例的行进状态（生产 UI 不消费）。 */
export function personWalkStates(): PersonWalkProbe[] {
  const out: PersonWalkProbe[] = [];
  for (const [id, entry] of entries) {
    out.push({
      id,
      x: entry.group.position.x,
      z: entry.group.position.z,
      facing: entry.group.rotation.y,
      travelled: entry.follower?.travelled ?? 0,
      laps: entry.follower?.laps ?? 0,
      moving: !entry.paused && !!entry.follower && entry.currentAction === 'walk',
      paused: entry.paused,
      advanceCalls,
      stepCalls,
      routePoints: entry.route ? entry.route.points.length : -1,
      hasFollower: !!entry.follower,
      attached: !!entry.group.parent,
    });
  }
  return out;
}

// 浏览器走查探针（仅 dev 构建挂 window；生产构建不暴露任何全局）。
if (process.env.NODE_ENV !== 'production' && typeof window !== 'undefined') {
  (window as unknown as { __peopleWalkStates?: typeof personWalkStates }).__peopleWalkStates =
    personWalkStates;
}

/**
 * 推进所有人物实例（路线行走 + mixer）。返回活跃实例数；0 表示这一帧可以早退。
 * 脱离场景的旧实例顺手摘除——disposeObject 只清 GPU 资源，不管这张表。
 */
export function advancePeopleAnimations(deltaSeconds: number): number {
  advanceCalls += 1;
  if (entries.size === 0 || !(deltaSeconds > 0)) return 0;
  let active = 0;
  let anyMoving = false;
  for (const [id, entry] of entries) {
    if (!entry.group.parent) {
      if (entry.mixer) {
        entry.mixer.stopAllAction();
        entry.mixer.uncacheRoot(entry.mixer.getRoot());
      }
      entries.delete(id);
      continue;
    }
    active += 1;
    if (entry.paused) continue; // 暂停 = 全停：路线冻结在原地，mixer 停在当前帧。

    if (entry.follower && entry.route) {
      stepCalls += 1;
      const result = stepRouteFollower(entry.follower, entry.route, deltaSeconds, walkContext);
      entry.group.position.x = result.x;
      entry.group.position.z = result.z;
      entry.group.rotation.y = result.facing;
      const action: PersonAction = result.moving ? 'walk' : 'idle';
      if (action !== entry.currentAction) playClip(entry, action);
      if (entry.rig) {
        if (result.moving) entry.phase += deltaSeconds * routeSpeedOf(entry.route) * 3.2;
        poseWalk(entry.rig, entry.phase, result.moving ? 1 : 0);
      }
      if (result.moving) anyMoving = true;
    }
    if (entry.mixer) entry.mixer.update(deltaSeconds);
  }
  if (anyMoving) shadowRefresher?.();
  return active;
}
