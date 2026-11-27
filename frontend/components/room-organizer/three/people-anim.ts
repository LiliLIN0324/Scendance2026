import {
  DEFAULT_SEAT_BEHAVIOR,
  createSeatBehavior,
  createSeatRegistry,
  seatDwellSeconds,
  stepSeatBehavior,
  type SeatAnchor,
  type SeatBehaviorState,
} from '../lib/person-behavior';
import {
  PERSON_WALK_RADIUS,
  PERSON_WALK_SPEED_MPS,
  type RouteFollowerState,
  type RouteStepContext,
  createRouteFollower,
  rebaseRouteFollower,
  routeSignature,
  stepRouteFollower,
} from '../lib/person-route';
import { resolveWalkerStep } from '../lib/walk-collision';
import {
  planZoneWalk,
  pointInPolygon,
  projectOnPolyline,
  shouldEnterZone,
  zoneCrossingsAlong,
  zoneDwellSeconds,
  zoneEntryPoint,
  type ZoneCrossing,
  type ZoneRing,
} from '../lib/zone-walk';
import { poseSit, poseWalk } from './builders/human-figure';
import type { HumanFigureRig } from './builders/human-figure';
import type { PersonAction, Vec2, WalkRoute } from '../lib/types';
import type * as ThreeNS from 'three';

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
 * 否则编辑器空闲时照旧整帧早退（render-on-demand，3D 壳体已退役为 use-dormant-three-shell）。
 */

export interface PersonClips {
  idle: ThreeNS.AnimationClip | null;
  talk: ThreeNS.AnimationClip | null;
  walk: ThreeNS.AnimationClip | null;
  /** 坐姿循环（PEOPLE-06 起人物资产带 Sit_Idle_Loop）；旧资产缺省。 */
  sit?: ThreeNS.AnimationClip | null;
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
  /**
   * 自主落座（B1）：基准流线之外的临时路线。有它时走它，没有就走 `route`。
   * 关键：不能让换线经过 `registerPersonAnim`——签名一变 follower 就被重置、
   * 人会瞬移回线头（见 docs/plans/2026-11-17-roam-behavior-layer.md §三）。
   */
  activeRoute: WalkRoute | null;
  activeFollower: RouteFollowerState | null;
  /** 落座/漫游相位：none 沿线、toZone 进区、zone 区内、going/seated/returning 落座、rejoin 回线。 */
  seatPhase: RoamPhase;
  seatTarget: SeatAnchor | null;
  /** 离开原路线时的落点：起身后走回这里，再交还给原路线。 */
  seatLeave: Vec2 | null;
  seatBehavior: SeatBehaviorState;
  /** 落座结束后回到哪个相位（none 沿基准线 / zone 区内）。 */
  resumePhase: 'none' | 'zone';
  /** B2 分区漫游：当前所在分区、区内停留预算、区内路线与回线点。 */
  zoneId: string | null;
  zoneDwell: number;
  zoneRoute: WalkRoute | null;
  zoneFollower: RouteFollowerState | null;
  /** 允许下一次进区的圈数（出区后 +1 圈）。 */
  zoneCooldownLaps: number;
  zoneEntry: Vec2 | null;
  rejoinPoint: Vec2 | null;
  rejoinAlong: number;
  /** 上一帧的漫游状态标记（相位 + 分区 + 坐姿），只在真变化时通知订阅方重绘 2D。 */
  roamTag: string;
}

const entries = new Map<string, PersonAnimEntry>();
/**
 * 行走上下文按归属分开：室内 `local`、户外 `outdoor`。
 * `advancePeopleAnimations(dt, scene, owner)` 推进时取自己那一套，
 * 两套 3D 同时挂载也不会互相串用碰撞盒与围栏。
 */
const walkContexts = new Map<string, RouteStepContext>();
/** 当前这一遍 `advancePeopleAnimations` 正在用的上下文（同步循环内有效，供座位/分区助手读取）。 */
let steppingContext: RouteStepContext = {};
let shadowRefresher: (() => void) | null = null;

/** 自主落座（B1）的座位上下文：与 `steppingContext` 同一坐标系（路线局部，场地中心为原点）。 */
let seatContext: { seats: readonly SeatAnchor[] } | null = null;
const seatRegistry = createSeatRegistry();
/** 走到离接近点这么近就算到了（米）；比 follower 的路点判定宽松一点，免得差一帧。 */
const SEAT_ARRIVE_M = 0.35;
/** 起身走到这里就算回到流线了（米）。 */
const SEAT_RETURN_M = 0.3;
/** B2：进区判定提前量（米）与到达半径（米）。 */
const ZONE_LOOKAHEAD_M = 2.5;
const ZONE_ARRIVE_M = 0.6;

/** 漫游相位。`seatPhase` 字段名沿用 B1，语义已扩到整段漫游。 */
type RoamPhase = 'none' | 'toZone' | 'zone' | 'going' | 'seated' | 'returning' | 'rejoin';

/** 分区上下文（B2）：与行走上下文同一坐标系。 */
let zoneContext: { zones: readonly ZoneRing[] } | null = null;
/** 每条基准流线的进区点缓存：不缓存的话每人每帧都要沿线采样。 */
let crossingCache = new WeakMap<WalkRoute, ZoneCrossing[]>();

/** 分区上下文。传 null 关掉进区行为——室内链路不注入，B1 行为保持不变。 */
export function setPersonZoneContext(ctx: { zones: readonly ZoneRing[] } | null): void {
  zoneContext = ctx && ctx.zones.length > 0 ? { zones: ctx.zones } : null;
  crossingCache = new WeakMap();
}

/**
 * 座位上下文。传 null 关掉自主落座——室内那条链路不注入，行为与现状逐字段一致。
 * 与 `setPersonWalkContext` 分开两个入口：没有可坐物件的场景不必凭空造一份空数组。
 */
export function setPersonSeatContext(ctx: { seats: readonly SeatAnchor[] } | null): void {
  seatContext = ctx && ctx.seats.length > 0 ? { seats: ctx.seats } : null;
  if (!seatContext) seatRegistry.clear();
}

/**
 * 家具层随 layout 变化重建碰撞上下文（见 use-scene-effects 的行走上下文 effect）。
 *
 * 2026-11-17：按 `owner` 分开存（室内默认 `local`、户外 `outdoor`）。推进时由
 * `advancePeopleAnimations(dt, scene, owner)` 取对应那套——不再「最后注入的赢」。
 * 没注入过的 owner 用空上下文（不避障、不夹围栏），不会借到别处的围栏。
 */
export function setPersonWalkContext(ctx: RouteStepContext | null, owner = 'local'): void {
  if (ctx) walkContexts.set(owner, ctx);
  else walkContexts.delete(owner);
}

/**
 * 行走中的人物是动态阴影投影体，静态阴影图必须跟着重算。由 use-scene-effects
 * 注入 requestShadowUpdate；每帧只在真的有人在走时调用一次。
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

/**
 * 程序化小人的坐姿对齐：没有 mixer、没有 `Sit_Idle_Loop`，靠 `poseSit` 摆关节，
 * 再按「髋关节相对 group 的高度」把整个人落到座面上。
 * 座面 0.45 m、髋高 0.9 m 时人下沉 0.45 m，屈膝后脚正好落回地面——这是几何恒等，
 * 不是调参：大腿放平、小腿竖直，髋到脚≈小腿长 0.435 m ≈ 座面高。
 */
function alignRigSeated(entry: PersonAnimEntry): void {
  if (!entry.rig || entry.seatHeight === null) return;
  poseSit(entry.rig);
  entry.group.updateMatrixWorld(true);
  const hipWorldY = entry.rig.leftHip.matrixWorld.elements[13] ?? 0;
  const groupWorldY = entry.group.matrixWorld.elements[13] ?? 0;
  const hipRel = hipWorldY - groupWorldY;
  // 闸：髋高超出一个人的量级说明父层缩放/单位对不上，宁可不抬也不要把人埋进地里。
  if (!(hipRel > 0.3 && hipRel < 2)) return;
  entry.sitLift = entry.seatHeight - hipRel;
  entry.group.position.y = entry.baseY + entry.sitLift;
}

/** 换「当前路线」。传 null 交还基准流线——基准 follower 一直冻在离开点上，不会瞬移。 */
function setActiveRoute(entry: PersonAnimEntry, points: readonly Vec2[] | null): void {
  if (!points || points.length < 2) {
    entry.activeRoute = null;
    entry.activeFollower = null;
    return;
  }
  const route: WalkRoute = { points: points.map((point) => ({ x: point.x, z: point.z })), loop: false, pauseMs: 0 };
  entry.activeRoute = route;
  entry.activeFollower = createRouteFollower(route);
}

/** 直线可达：B1 不做绕行寻路，推挤后偏离目标超过 0.4 m 就当走不过去。 */
function seatReachable(from: Vec2, to: Vec2): boolean {
  const colliders = steppingContext.colliders;
  if (!colliders || colliders.length === 0) return true;
  const out = { x: from.x, z: from.z };
  resolveWalkerStep(colliders, from, to, PERSON_WALK_RADIUS, out);
  return Math.hypot(out.x - to.x, out.z - to.z) < 0.4;
}

/**
 * B2：分区相位推进（进区 / 区内 / 出区回线）。落座仍由 `advanceSeat` 负责，
 * 两者靠 `seatPhase` 互拆：本函数把相位推成 toZone/zone/rejoin 时，落座那段直接跳过。
 */
function advanceZonePhase(entry: PersonAnimEntry, deltaSeconds: number): void {
  const x = entry.group.position.x;
  const z = entry.group.position.z;

  if (entry.seatPhase === 'toZone') {
    const target = entry.zoneEntry;
    if (!target || Math.hypot(x - target.x, z - target.z) > ZONE_ARRIVE_M) return;
    beginZoneWalk(entry, x, z);
    return;
  }

  if (entry.seatPhase === 'zone') {
    entry.zoneDwell = Math.max(0, entry.zoneDwell - deltaSeconds);
    if (entry.zoneDwell <= 0) beginRejoin(entry, x, z);
    return;
  }

  if (entry.seatPhase === 'rejoin') {
    const merge = entry.rejoinPoint;
    if (merge && Math.hypot(x - merge.x, z - merge.z) > ZONE_ARRIVE_M) return;
    finishRejoin(entry);
    return;
  }

  if (entry.seatPhase === 'none' && tryEnterZone(entry, x, z)) return;
}

/**
 * 进区判定：只看「前方 LOOKAHEAD 内、外→内」的穿越点，再加两道闸——
 * 出区后至少再走一圈才允许再进（`zoneCooldownLaps`），以及按人+圈数的确定性概率。
 */
function tryEnterZone(entry: PersonAnimEntry, x: number, z: number): boolean {
  if (!zoneContext || !entry.route) return false;
  const laps = entry.follower?.laps ?? 0;
  if (laps < entry.zoneCooldownLaps) return false;

  let crossings = crossingCache.get(entry.route);
  if (!crossings) {
    crossings = zoneCrossingsAlong(entry.route.points, zoneContext.zones);
    crossingCache.set(entry.route, crossings);
  }

  const forwardX = Math.sin(entry.group.rotation.y);
  const forwardZ = Math.cos(entry.group.rotation.y);
  let best: ZoneCrossing | null = null;
  let bestGap = ZONE_LOOKAHEAD_M;
  for (const crossing of crossings) {
    const dx = crossing.x - x;
    const dz = crossing.z - z;
    const gap = Math.hypot(dx, dz);
    if (gap > bestGap || gap < 0.2) continue;
    // 只认前方的口：背后已经走过的入口不算「正要进去」。
    if (dx * forwardX + dz * forwardZ < gap * 0.5) continue;
    best = crossing;
    bestGap = gap;
  }
  if (!best) return false;

  if (!shouldEnterZone(entry.id, laps)) return false;
  const crossing = best;
  const zone = zoneContext.zones.find((ring) => ring.id === crossing.zoneId);
  if (!zone) return false;
  const entryPoint = zoneEntryPoint(crossing, zone.polygon);
  if (!seatReachable({ x, z }, entryPoint)) return false;

  setActiveRoute(entry, [{ x, z }, entryPoint]);
  entry.seatPhase = 'toZone';
  entry.zoneId = zone.id;
  entry.zoneDwell = zoneDwellSeconds(entry.id, zone.id);
  entry.zoneEntry = entryPoint;
  return true;
}

/** 区内路线：从当前位置走格到远端再原路回来；格不够就回线。 */
function beginZoneWalk(entry: PersonAnimEntry, x: number, z: number): void {
  const zone = zoneContext?.zones.find((ring) => ring.id === entry.zoneId);
  if (!zone) {
    beginRejoin(entry, x, z);
    return;
  }
  const plan = planZoneWalk(zone, { x, z }, {
    clearance: PERSON_WALK_RADIUS + 0.1,
    ...(steppingContext.colliders ? { colliders: steppingContext.colliders } : {}),
    ...(steppingContext.bounds ? { bounds: steppingContext.bounds } : {}),
  });
  if (!plan) {
    beginRejoin(entry, x, z);
    return;
  }
  const points = plan.points.map((point) => ({ x: point.x, z: point.z }));
  const head = points[0];
  // 路线从格点开始，先接上当前位置，免得瞬移半格。
  if (head && Math.hypot(head.x - x, head.z - z) > 0.45) points.unshift({ x, z });
  const route: WalkRoute = { points, loop: false, pauseMs: 250 };
  entry.zoneRoute = route;
  entry.zoneFollower = createRouteFollower(route);
  entry.activeRoute = route;
  entry.activeFollower = entry.zoneFollower;
  entry.seatPhase = 'zone';
}

/** 出区回线：走到基准流线上最近的一点，到点后把 follower 重定位到那里（保留里程/圈数）。 */
function beginRejoin(entry: PersonAnimEntry, x: number, z: number): void {
  if (!entry.route) {
    entry.seatPhase = 'none';
    setActiveRoute(entry, null);
    return;
  }
  const merge = projectOnPolyline(entry.route.points, { x, z });
  entry.rejoinPoint = { x: merge.x, z: merge.z };
  entry.rejoinAlong = merge.along;
  entry.seatPhase = 'rejoin';
  setActiveRoute(entry, [{ x, z }, entry.rejoinPoint]);
}

function finishRejoin(entry: PersonAnimEntry): void {
  if (entry.follower && entry.route) {
    rebaseRouteFollower(entry.follower, entry.route, entry.rejoinAlong);
    entry.group.position.x = entry.follower.x;
    entry.group.position.z = entry.follower.z;
    entry.group.rotation.y = entry.follower.facing;
  }
  entry.activeRoute = null;
  entry.activeFollower = null;
  entry.zoneRoute = null;
  entry.zoneFollower = null;
  entry.zoneEntry = null;
  entry.rejoinPoint = null;
  entry.zoneId = null;
  entry.zoneDwell = 0;
  entry.zoneCooldownLaps = (entry.follower?.laps ?? 0) + 1;
  entry.seatPhase = 'none';
}

/**
 * 自主落座推进（每帧、沿路线行走的人物）。没有座位上下文时整段不执行。
 * 只在「沿基准线 / 在分区内」时找椅子；已经在 going/seated/returning 里不重新挑。
 */
function advanceSeat(entry: PersonAnimEntry, deltaSeconds: number): void {
  const x = entry.group.position.x;
  const z = entry.group.position.z;

  if (entry.seatPhase === 'returning') {
    const leave = entry.seatLeave;
    if (!leave || Math.hypot(x - leave.x, z - leave.z) <= SEAT_RETURN_M) {
      entry.seatLeave = null;
      if (entry.resumePhase === 'zone' && entry.zoneRoute) {
        entry.activeRoute = entry.zoneRoute;
        entry.activeFollower = entry.zoneFollower;
        entry.seatPhase = 'zone';
      } else {
        entry.seatPhase = 'none';
        setActiveRoute(entry, null);
      }
    }
    return;
  }
  if (entry.seatPhase === 'toZone' || entry.seatPhase === 'rejoin') return;
  if (!seatContext || !entry.route) return;

  const target = entry.seatTarget;
  const arrived = target
    ? Math.hypot(x - target.approach.x, z - target.approach.z) <= SEAT_ARRIVE_M
    : false;
  const zone = entry.seatPhase === 'zone'
    ? zoneContext?.zones.find((ring) => ring.id === entry.zoneId)
    : undefined;
  // 在区内只坐本区的椅子：不要让人员为了坐椅穿出分区。
  const seats = zone
    ? seatContext.seats.filter((seat) => pointInPolygon(seat, zone.polygon))
    : seatContext.seats;
  const events = stepSeatBehavior(
    entry.seatBehavior,
    {
      position: { x, z },
      seats,
      isTaken: (seatId) => {
        const holder = seatRegistry.holderOf(seatId);
        return holder !== null && holder !== entry.id;
      },
      canReach: seatReachable,
      dwellSeconds: seatDwellSeconds(entry.id, target?.id ?? ''),
      secondsPerTick: deltaSeconds,
    },
    arrived,
    DEFAULT_SEAT_BEHAVIOR
  );

  for (const event of events) {
    if (event.type === 'approach') {
      if (!seatRegistry.claim(event.seat.id, entry.id)) {
        // 抢座失败：退回游走态，下一帧换一把，不在这里抢。
        entry.seatBehavior.phase = 'roaming';
        entry.seatBehavior.seatId = null;
        continue;
      }
      entry.resumePhase = entry.seatPhase === 'zone' ? 'zone' : 'none';
      entry.seatPhase = 'going';
      entry.seatTarget = event.seat;
      entry.seatLeave = { x, z };
      setActiveRoute(entry, [{ x, z }, event.seat.approach]);
      continue;
    }
    if (event.type === 'sit') {
      entry.seatPhase = 'seated';
      entry.seated = true;
      entry.seatHeight = event.seat.seatHeight;
      entry.group.rotation.y = event.seat.facing;
      // 从接近点进座：水平最多 0.45 m，就是「坐下」这半个动作。
      entry.group.position.x = event.seat.x;
      entry.group.position.z = event.seat.z;
      continue;
    }
    // stand
    seatRegistry.release(entry.id);
    entry.seated = false;
    entry.seatHeight = null;
    entry.sitLift = null;
    entry.group.position.y = entry.baseY;
    const leave = entry.seatLeave;
    entry.seatTarget = null;
    if (leave) {
      entry.seatPhase = 'returning';
      setActiveRoute(entry, [{ x, z }, leave]);
    } else {
      entry.seatPhase = 'none';
      setActiveRoute(entry, null);
    }
  }
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
  // PersonAction 比 PersonClips 宽（wave / emote 未落资产），按可空索引取片段。
  const clip = (entry.clips as unknown as Record<string, ThreeNS.AnimationClip | null | undefined>)[action] ?? null;
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
    manualMoving: existing?.group === group ? existing.manualMoving : null,
    seated: existing?.group === group ? existing.seated : false,
    seatHeight: existing?.group === group ? existing.seatHeight : null,
    sitLift: existing?.group === group ? existing.sitLift : null,
    baseY: existing?.group === group ? existing.baseY : group.position.y,
    activeRoute: existing?.group === group ? existing.activeRoute : null,
    activeFollower: existing?.group === group ? existing.activeFollower : null,
    seatPhase: existing?.group === group ? existing.seatPhase : 'none',
    seatTarget: existing?.group === group ? existing.seatTarget : null,
    seatLeave: existing?.group === group ? existing.seatLeave : null,
    seatBehavior: existing?.group === group ? existing.seatBehavior : createSeatBehavior(),
    resumePhase: existing?.group === group ? existing.resumePhase : 'none',
    zoneId: existing?.group === group ? existing.zoneId : null,
    zoneDwell: existing?.group === group ? existing.zoneDwell : 0,
    zoneRoute: existing?.group === group ? existing.zoneRoute : null,
    zoneFollower: existing?.group === group ? existing.zoneFollower : null,
    zoneCooldownLaps: existing?.group === group ? existing.zoneCooldownLaps : 0,
    zoneEntry: existing?.group === group ? existing.zoneEntry : null,
    rejoinPoint: existing?.group === group ? existing.rejoinPoint : null,
    rejoinAlong: existing?.group === group ? existing.rejoinAlong : 0,
    roamTag: existing?.group === group ? existing.roamTag : '',
  };
  entries.set(spec.id, entry);
  if (entry.follower && entry.manualMoving === null && !entry.activeRoute) {
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
      // 玩家接管结束：把 NPC 可能占着的椅子一并释放。
      seatRegistry.release(id);
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

/**
 * 漫游态（B3）：2D 画布拿它给人位换色。
 * - `walking` 沿流线走（含进区路上 / 回线路上）；
 * - `zone` 已进区、正在区内活动；
 * - `seated` 正坐着。
 */
export type PersonRoamState = 'walking' | 'zone' | 'seated';

/** 一个人当前的漫游态；不在册或已脱离场景返回 null。 */
export function personRoamState(id: string): PersonRoamState | null {
  const entry = entries.get(id);
  if (!entry || !entry.group.parent) return null;
  if (entry.seated || entry.seatPhase === 'seated') return 'seated';
  // 进区路上和区内都算「在分区里」：2D 上一个点不用区分「正在进」和「已经进」。
  return entry.seatPhase === 'toZone' || entry.seatPhase === 'zone' ? 'zone' : 'walking';
}

/**
 * 一个 2D 岗位点位（3D 实例 id 为 `${workerId}#${index}`）的聚合漫游态。
 * 任一人坐着就算 seated，否则任一人进区就算 zone；无人在册返回 null（不画状态环）。
 */
export function workerRoamState(workerId: string, count: number): PersonRoamState | null {
  const total = Math.max(0, Math.min(Math.floor(count), 64));
  let aggregate: PersonRoamState | null = null;
  for (let index = 0; index < total; index += 1) {
    const state = personRoamState(`${workerId}#${index}`);
    if (state === 'seated') return 'seated';
    if (state === 'zone' || (state === 'walking' && aggregate === null)) aggregate = state;
  }
  return aggregate;
}

/** 漫游态订阅：只在真的跳档时回调（每帧最多一次），2D 画布用它合并重绘。 */
const roamListeners = new Set<() => void>();

export function subscribePersonRoam(listener: () => void): () => void {
  roamListeners.add(listener);
  return () => {
    roamListeners.delete(listener);
  };
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
  /** 漫游态：none 沿线 / toZone 进区 / zone 区内 / going、seated、returning 落座 / rejoin 回线。 */
  seatPhase: RoamPhase;
  /** 当前占用（或即将去坐）的座位 id。 */
  seatId: string | null;
  /** 当前所在分区 id（不在分区内为 null）。 */
  zoneId: string | null;
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
      seatPhase: entry.seatPhase,
      seatId: entry.seatTarget?.id ?? entry.seatBehavior.seatId,
      zoneId: entry.zoneId,
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
 *
 * `owner` 决定用哪套行走上下文（碰撞盒 + 围栏）：室内 `local`、户外 `outdoor`。
 * 两个渲染循环各自传自己的 owner，就不再靠「最后注入的那个」碰运气。
 */
export function advancePeopleAnimations(
  deltaSeconds: number,
  scene?: ThreeNS.Scene,
  owner = 'local'
): number {
  advanceCalls += 1;
  if (entries.size === 0 || !(deltaSeconds > 0)) return 0;
  steppingContext = walkContexts.get(owner) ?? {};
  let active = 0;
  let anyMoving = false;
  // 漫游态跳档（B3）：只在真的换挡时通知一次，不每帧发。
  let roamChanged = false;
  for (const [id, entry] of entries) {
    if (!entry.group.parent) {
      if (entry.mixer) {
        entry.mixer.stopAllAction();
        entry.mixer.uncacheRoot(entry.mixer.getRoot());
      }
      // 人没了就别占着椅子，否则那个座到刷新前都没人敢坐。
      seatRegistry.release(id);
      entries.delete(id);
      roamChanged = true;
      continue;
    }
    if (scene) {
      let owner: ThreeNS.Object3D | null = entry.group.parent;
      while (owner && owner !== scene) owner = owner.parent;
      if (!owner) continue;
    }
    active += 1;
    const roamTag = `${entry.seatPhase}|${entry.zoneId ?? ''}|${entry.seated ? 1 : 0}`;
    if (roamTag !== entry.roamTag) {
      entry.roamTag = roamTag;
      roamChanged = true;
    }
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
      advanceZonePhase(entry, deltaSeconds);
      advanceSeat(entry, deltaSeconds);
      if (entry.seatPhase === 'seated') {
        // 坐着：位置锁在坐姿锚点，只推进姿态（混音器或程序化关节），不走路。
        playClip(entry, 'sit');
        if (entry.rig) alignRigSeated(entry);
        alignSeatedGroup(entry);
        if (entry.mixer) entry.mixer.update(deltaSeconds);
        continue;
      }
      const route = entry.activeRoute ?? entry.route;
      const follower = entry.activeRoute ? entry.activeFollower : entry.follower;
      if (!follower) {
        if (entry.mixer) entry.mixer.update(deltaSeconds);
        continue;
      }
      const result = stepRouteFollower(follower, route, deltaSeconds, steppingContext);
      entry.group.position.x = result.x;
      entry.group.position.z = result.z;
      entry.group.rotation.y = result.facing;
      const action: PersonAction = result.moving ? 'walk' : 'idle';
      if (action !== entry.currentAction) playClip(entry, action);
      if (entry.rig) {
        if (result.moving) entry.phase += deltaSeconds * routeSpeedOf(route) * 3.2;
        poseWalk(entry.rig, entry.phase, result.moving ? 1 : 0);
      }
      if (result.moving) anyMoving = true;
    }
    if (entry.mixer) entry.mixer.update(deltaSeconds);
  }
  if (anyMoving) shadowRefresher?.();
  if (roamChanged) {
    for (const listener of roamListeners) listener();
  }
  return active;
}
