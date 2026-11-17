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
import { resolvePersonAction } from '../lib/person-action-state';

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
  /** 坐姿循环（PEOPLE-06 起人物资产带 Sit_Idle_Loop）；旧资产缺省。 */
  sit?: ThreeNS.AnimationClip | null;
  /** 挥手（2026-11-17）：crowd 无现成片段，由 `person-clip-retarget` 程序化生成。 */
  wave?: ThreeNS.AnimationClip | null;
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
  manualMoving: boolean | null;
  /** 落座态：坐在座位上时播坐姿循环，起身清除。 */
  seated: boolean;
  /** 落座椅面高度（米）与把这个模型摆上去所需的抬升；每个模型量一次。 */
  seatHeight: number | null;
  sitLift: number | null;
  /** 站立时的原始 y，起身还原。 */
  baseY: number;
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

/**
 * 坐姿摆位：读出当前坐姿下髋关节相对 group 的高度，把人抬到椅面上。
 * 只靠「坐姿眼高」对齐会让屁股浮在椅面上；这里直接用椅面高度反算。
 */
function alignSeatedGroup(entry: PersonAnimEntry): void {
  if (entry.seatHeight === null) return;
  // 闸一：等坐姿真正生效再量。落座头几帧还在从站立交叉淡入，那时髋关节是站立高度，
  // 拿它反算会算出负抬升，人直接陷入地面。
  if (entry.currentAction !== 'sit') return;
  const action = entry.playingAction;
  if (!action || action.getEffectiveWeight() < 0.9 || action.time < 0.15) return;
  entry.group.updateMatrixWorld(true);
  if (entry.sitLift === null) {
    let hips: ThreeNS.Object3D | null = null;
    entry.group.traverse((node: ThreeNS.Object3D) => {
      if (!hips && /hips/i.test(node.name)) hips = node;
    });
    if (!hips) return;
    const hipsWorldY = (hips as ThreeNS.Object3D).matrixWorld.elements[13] ?? 0;
    const groupWorldY = entry.group.matrixWorld.elements[13] ?? 0;
    const hipsRelY = hipsWorldY - groupWorldY;
    // 闸二：坐姿髋高应明显低于站立（站姿约 0.9 m），量出来不像坐着就不采用。
    if (!(hipsRelY > -1.2 && hipsRelY < 0.45)) return;
    entry.sitLift = entry.seatHeight - hipsRelY;
  }
  entry.group.position.y = entry.baseY + entry.sitLift;
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
  // 缺片段的动作回退 idle；idle 也缺则保持当前姿态，不播空动作。
  const resolved = resolvePersonAction(action, entry.clips);
  if (!resolved) return;
  const clip = (entry.clips as unknown as Record<string, ThreeNS.AnimationClip | null | undefined>)[resolved] ?? null;
  if (!clip) return;
  const next = entry.mixer.clipAction(clip);
  if (entry.playingAction === next) return;
  if (entry.playingAction) entry.playingAction.fadeOut(fadeSeconds);
  next.reset().fadeIn(fadeSeconds).play();
  if (resolved === 'walk') {
    // 步幅同步：路线步速相对自然步速（1.05 m/s ≈ Walk_Loop timeScale 1）。
    const speed = entry.route ? clampWalkTimeScale(routeSpeedOf(entry.route)) : 1;
    next.timeScale = speed;
  }
  entry.playingAction = next;
  entry.currentAction = resolved;
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
    manualMoving: existing?.group === group ? existing.manualMoving : null,
    seated: existing?.group === group ? existing.seated : false,
    seatHeight: existing?.group === group ? existing.seatHeight : null,
    sitLift: existing?.group === group ? existing.sitLift : null,
    baseY: existing?.group === group ? existing.baseY : group.position.y,
  };
  entries.set(spec.id, entry);
  if (entry.follower && entry.manualMoving === null) {
    // 重建出来的新 group 停在锚点/原点：注册时立刻落到行进位姿，暂停中也不瞬移。
    group.position.x = entry.follower.x;
    group.position.z = entry.follower.z;
    group.rotation.y = entry.follower.facing;
  }
  if (entry.mixer) {
    playClip(entry, entry.manualMoving === true ? 'walk' : entry.follower || entry.manualMoving === false ? 'idle' : spec.action, 0);
    entry.mixer.update(stanceSeed(spec.id));
  } else if (entry.rig) {
    poseWalk(entry.rig, 0, 0);
  }
}

/** 暂停这个实例的巡游，复用它的站立和走路动画；释放后续走原路线。 */
export function takePersonControl(id: string, group: ThreeNS.Group) {
  const entry = entries.get(id);
  if (!entry || entry.group !== group || !group.parent || entry.manualMoving !== null) return null;
  const position = group.position.clone();
  const rotation = group.rotation.y;
  entry.manualMoving = false;
  const current = () => {
    const live = entries.get(id);
    return live?.group === group && live.manualMoving !== null ? live : null;
  };
  return {
    setMoving(moving: boolean) {
      const live = current();
      if (live) live.manualMoving = moving;
    },
    /** 落座 / 起身：坐姿循环与站立待机互换，并按椅面高度把人物摆正。 */
    setSeated(seated: boolean, seatHeight?: number) {
      const live = current();
      if (!live) return;
      live.seated = seated;
      if (typeof seatHeight === 'number') live.seatHeight = seatHeight;
      if (!seated) {
        live.sitLift = null;
        live.group.position.y = live.baseY;
      }
    },
    release() {
      const live = current();
      if (!live) return;
      live.manualMoving = null;
      live.seated = false;
      live.seatHeight = null;
      live.sitLift = null;
      live.group.position.y = live.baseY;
      group.position.copy(position);
      group.rotation.y = rotation;
      group.visible = true;
      if (!live.follower) playClip(live, live.action);
    },
  };
}

/** 测试用：当前注册表里的实例 id。 */
export function personAnimIds(): string[] {
  return [...entries.keys()];
}

/** 单个实例的动作状态快照（交互层据此判断是否落座 / 能否播该动作）。 */
export interface PersonActionState {
  id: string;
  /** 外部请求的动作（未被路线覆盖前的目标态）。 */
  requested: PersonAction;
  /** 实际正在播放的动作（缺 clip 已回退）。 */
  current: PersonAction;
  /** 是否已处于坐姿。 */
  sitting: boolean;
  /** 各循环态是否带有可播片段。 */
  hasClips: Record<'idle' | 'talk' | 'walk' | 'sit' | 'wave', boolean>;
}

/**
 * 外部（交互层）请求切换静态人物动作。挂了路线 follower 的实例仍由路线每帧
 * 驱动 walk/idle，不在这里硬切；坐姿只给到静止岗位人物。
 */
export function setPersonAction(id: string, action: PersonAction): void {
  const entry = entries.get(id);
  if (!entry) return;
  entry.action = action;
  if (!entry.follower) playClip(entry, action);
}

/** 读一个在册实例的动作状态；不在册返回 null。 */
export function personActionState(id: string): PersonActionState | null {
  const entry = entries.get(id);
  if (!entry) return null;
  return {
    id,
    requested: entry.action,
    current: entry.currentAction,
    sitting: entry.currentAction === 'sit',
    hasClips: {
      idle: Boolean(entry.clips.idle),
      talk: Boolean(entry.clips.talk),
      walk: Boolean(entry.clips.walk),
      sit: Boolean(entry.clips.sit),
      wave: Boolean(entry.clips.wave),
    },
  };
}

/** 全部在册实例的动作状态（走查/诊断用）。 */
export function personActionStates(): PersonActionState[] {
  const out: PersonActionState[] = [];
  for (const id of entries.keys()) {
    const state = personActionState(id);
    if (state) out.push(state);
  }
  return out;
}

/**
 * 对道具附近最近的一个静止 NPC 请求动作。只认已挂场景、无路线 follower、
 * 未被接管的实例；没有候选返回 null。交互层用它把桌/舞台映射到人物动作。
 */
export function setNearestPersonAction(
  position: { x: number; z: number },
  action: PersonAction,
  radius = 2.2,
): string | null {
  let bestId: string | null = null;
  let bestDistance = radius;
  for (const [id, entry] of entries) {
    if (!entry.group.parent || entry.follower || entry.manualMoving !== null || entry.paused) continue;
    entry.group.updateWorldMatrix(true, false);
    const e = entry.group.matrixWorld.elements;
    const distance = Math.hypot(e[12]! - position.x, e[14]! - position.z);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestId = id;
    }
  }
  if (bestId) setPersonAction(bestId, action);
  return bestId;
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
  (window as unknown as { __personActionStates?: typeof personActionStates }).__personActionStates =
    personActionStates;
  // 走查用：把动作打到最近一个静止 NPC（仅 dev；生产不暴露）。
  (window as unknown as { __setPersonAction?: typeof setNearestPersonAction }).__setPersonAction =
    setNearestPersonAction;
}

/**
 * 推进所有人物实例（路线行走 + mixer）。返回活跃实例数；0 表示这一帧可以早退。
 * 脱离场景的旧实例顺手摘除——disposeObject 只清 GPU 资源，不管这张表。
 */
export function advancePeopleAnimations(deltaSeconds: number, scene?: ThreeNS.Scene): number {
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
    if (scene) {
      let owner: ThreeNS.Object3D | null = entry.group.parent;
      while (owner && owner !== scene) owner = owner.parent;
      if (!owner) continue;
    }
    active += 1;
    if (entry.manualMoving !== null) {
      playClip(entry, entry.seated && entry.clips.sit ? 'sit' : entry.manualMoving ? 'walk' : 'idle');
      if (entry.rig) {
        if (!entry.seated && entry.manualMoving) entry.phase += deltaSeconds * 5.5;
        poseWalk(entry.rig, entry.phase, !entry.seated && entry.manualMoving ? 1 : 0);
      }
      if (entry.mixer) entry.mixer.update(deltaSeconds);
      if (entry.seated) alignSeatedGroup(entry);
      continue;
    }
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
