import * as THREE from 'three';
import type { FurnitureItem } from '../lib/types';
import {
  createWalkAvatar,
  disposeOwnedModel,
  ensureGlbAsset,
} from './glb-assets';

/**
 * 户外漫游玩家 avatar 的独立控制器。
 *
 * 这里故意不复用 `hooks/use-walk-avatar.ts`：那个 hook 是室内漫游用的，
 * 会顺带创建一个“游客” NPC、维护打招呼距离，并按 scene.position 计算脚底。
 * 户外需要的是同一套 idle/walk/sit 姿态，但落点在世界坐标、脚底要抬到
 * `PLAN_LAYER_BASE_Y`（0.052 m），且加载失败时必须把胶囊体占位留在原地。
 *
 * 本模块只负责“已取得 GLB actor 之后”的动画与摆位，不接触
 * `OutdoorPlan3D` 的场景生命周期；接线由 E7b 单独做。
 */

/** 与 `outdoor-plan-3d.tsx` 的 `PLAN_LAYER_BASE_Y` 保持一致。 */
export const OUTDOOR_PLAYER_AVATAR_BASE_Y = 0.052;

/** 玩家模型的标称身高；与 walkRole 卡片的口径一致。 */
export const OUTDOOR_PLAYER_AVATAR_HEIGHT = 1.75;

export interface OutdoorPlayerAvatarRole {
  assetId: string;
  glbUrl: string;
  name?: string;
}

export interface OutdoorPlayerAvatarFrame {
  x: number;
  y: number;
  z: number;
  yaw: number;
  moving: boolean;
  thirdPerson: boolean;
  seated?: boolean;
  seatHeight?: number;
  delta: number;
}

export interface OutdoorPlayerAvatarActor {
  group: THREE.Group;
  mixer: THREE.AnimationMixer;
  idle: THREE.AnimationAction;
  walk: THREE.AnimationAction;
  sit?: THREE.AnimationAction | null;
}

/**
 * 玩家控制器只做 idle / walk / sit。
 * talk / wave 故意不在这里出现：crowd 与玩家 GLB 只有 Idle_Loop / Walk_Loop
 * （16 个 labor 资产逐个解析，见 2026-11-16 进度文档 E7c），缺片段不冒充播放。
 * 要真播交谈 / 挥手，先换入带对应 clip 的资产。
 */
export type OutdoorPlayerAvatarAction = 'idle' | 'walk' | 'sit';

export interface OutdoorPlayerPresentationInput {
  /** 漫游已启用（退出漫游后即使还有旧帧也不显示玩家）。 */
  walkEnabled: boolean;
  /** 当前帧视角：第三人称 / 过肩为 true，第一人称与鸟瞰为 false。 */
  thirdPerson: boolean;
  /** 已接管场景 NPC 时，玩家占位不出现。 */
  controlled: boolean;
  /** 玩家 GLB 控制器已就绪。 */
  hasGlb: boolean;
}

export interface OutdoorPlayerPresentation {
  /** 该显示“玩家”的帧：漫游中、第三人称、且没有接管 NPC。 */
  showPlayer: boolean;
  /** GLB 已就绪时显示模型；胶囊体同时隐藏，避免两个身体叠在一起。 */
  showGlb: boolean;
  /** 胶囊体只在玩家该显示但 GLB 未就绪时出现（加载中 / 失败 / 缺角色）。 */
  showCapsule: boolean;
}

/**
 * E7b 的显示口径收敛成纯函数，供 3D 主循环与单测共用：
 * 第三人称看到 GLB，第一人称 / 鸟瞰 / 退出漫游 / 接管 NPC 一律隐藏；
 * GLB 加载中、失败、断网或缺角色时保留胶囊体兜底。
 */
export function outdoorPlayerPresentation(
  input: OutdoorPlayerPresentationInput,
): OutdoorPlayerPresentation {
  const showPlayer = input.walkEnabled && input.thirdPerson && !input.controlled;
  return {
    showPlayer,
    showGlb: showPlayer && input.hasGlb,
    showCapsule: showPlayer && !input.hasGlb,
  };
}

export interface OutdoorPlayerAvatarState {
  visible: boolean;
  seated: boolean;
  moving: boolean;
  action: OutdoorPlayerAvatarAction;
  y: number;
}

export interface OutdoorPlayerAvatarHandle {
  readonly group: THREE.Group;
  setFrame(frame: OutdoorPlayerAvatarFrame): void;
  state(): OutdoorPlayerAvatarState;
  dispose(): void;
}

export type OutdoorPlayerAvatarLoader = (
  role: OutdoorPlayerAvatarRole,
) => Promise<OutdoorPlayerAvatarActor | null>;

export interface CreateOutdoorPlayerAvatarOptions {
  scene: THREE.Scene;
  role: OutdoorPlayerAvatarRole;
  baseY?: number;
  fadeSeconds?: number;
  /** 测试/上层可注入加载器；缺省走 ensureGlbAsset + createWalkAvatar。 */
  load?: OutdoorPlayerAvatarLoader;
}

function defaultItem(role: OutdoorPlayerAvatarRole): FurnitureItem {
  return {
    id: 'outdoor-walk-avatar',
    type: 'glb-asset',
    name: role.name ?? '角色',
    width: 0.55,
    depth: 0.45,
    height: OUTDOOR_PLAYER_AVATAR_HEIGHT,
    color: '#ffffff',
    icon: '◇',
    assetId: role.assetId,
    glbUrl: role.glbUrl,
    uniformScale: true,
  };
}

/** 默认加载器：先入缓存，再克隆一个由玩家控制器持有的实例。 */
export const loadOutdoorPlayerAvatar: OutdoorPlayerAvatarLoader = async (role) => {
  if (!role.assetId || !role.glbUrl) return null;
  await ensureGlbAsset(role.assetId, role.glbUrl);
  return createWalkAvatar(defaultItem(role));
};

/** 坐姿头部相对 group 的高度；量不到头部时不硬切坐姿，避免把人沉进地面。 */
function measureSitHeadY(actor: OutdoorPlayerAvatarActor): number | null {
  if (!actor.sit) return null;
  actor.sit.reset().setEffectiveWeight(1).play();
  actor.mixer.setTime(0.6);
  actor.group.updateMatrixWorld(true);
  let head: THREE.Object3D | null = null;
  actor.group.traverse((node) => {
    if (!head && /head/i.test(node.name)) head = node;
  });
  actor.sit.stop();
  if (!head) return null;
  const world = new THREE.Vector3();
  (head as THREE.Object3D).getWorldPosition(world);
  const height = world.y - actor.group.position.y;
  return Number.isFinite(height) && height > 0 ? height : null;
}

function createController(
  scene: THREE.Scene,
  actor: OutdoorPlayerAvatarActor,
  baseY: number,
  fadeSeconds: number,
): OutdoorPlayerAvatarHandle {
  const group = actor.group;
  let disposed = false;
  let visible = false;
  let seated = false;
  let moving = false;
  let action: OutdoorPlayerAvatarAction = 'idle';
  let sitHeadY: number | null = null;
  let sitMeasured = false;

  group.visible = false;
  group.position.y = baseY;
  scene.add(group);
  actor.idle.reset().play();

  function enterSeat(): void {
    actor.idle.fadeOut(fadeSeconds);
    actor.walk.fadeOut(fadeSeconds);
    actor.sit!.reset().fadeIn(fadeSeconds).play();
    action = 'sit';
  }

  function leaveSeat(): void {
    actor.sit?.fadeOut(fadeSeconds);
    actor.idle.reset().fadeIn(fadeSeconds).play();
    action = 'idle';
  }

  function setFrame(frame: OutdoorPlayerAvatarFrame): void {
    if (disposed) return;

    const wantsSeat = frame.seated === true && Boolean(actor.sit);
    if (wantsSeat && !sitMeasured) {
      sitMeasured = true;
      sitHeadY = measureSitHeadY(actor);
    }
    // 没有坐姿 clip，或量不到头部：保持站姿，不把角色按坐姿眼高往下扣。
    const nextSeated = wantsSeat && sitHeadY !== null;
    if (nextSeated !== seated) {
      seated = nextSeated;
      // 起身后如果还在走，下面的 moving 分支会重新切到 walk。
      moving = false;
      if (seated) enterSeat();
      else leaveSeat();
    }

    if (!seated && frame.moving !== moving) {
      moving = frame.moving;
      if (moving) {
        actor.walk.reset().play().crossFadeFrom(actor.idle, fadeSeconds, false);
        action = 'walk';
      } else {
        actor.idle.reset().play().crossFadeFrom(actor.walk, fadeSeconds, false);
        action = 'idle';
      }
    }

    const seatedY = seated && sitHeadY !== null
      ? Math.max(0, frame.y - sitHeadY)
      : 0;
    group.position.set(frame.x, baseY + seatedY, frame.z);
    group.rotation.y = frame.yaw;
    visible = frame.thirdPerson === true;
    group.visible = visible;

    const delta = Number.isFinite(frame.delta)
      ? Math.min(Math.max(frame.delta, 0), 0.1)
      : 0;
    actor.mixer.update(delta);
  }

  function state(): OutdoorPlayerAvatarState {
    return { visible, seated, moving, action, y: group.position.y };
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    group.visible = false;
    actor.mixer.stopAllAction();
    actor.mixer.uncacheRoot(group);
    scene.remove(group);
    disposeOwnedModel(group);
  }

  return { group, setFrame, state, dispose };
}

/**
 * 加载并创建户外玩家 avatar。加载失败返回 null，调用方继续显示胶囊体；
 * 本函数不会把失败写进场景。
 */
export async function createOutdoorPlayerAvatar(
  options: CreateOutdoorPlayerAvatarOptions,
): Promise<OutdoorPlayerAvatarHandle | null> {
  const { scene, role, baseY = OUTDOOR_PLAYER_AVATAR_BASE_Y, fadeSeconds = 0.16 } = options;
  let actor: OutdoorPlayerAvatarActor | null = null;
  try {
    actor = await (options.load ?? loadOutdoorPlayerAvatar)(role);
  } catch {
    return null;
  }
  if (!actor?.group || !actor.mixer || !actor.idle || !actor.walk) return null;
  return createController(scene, actor, baseY, fadeSeconds);
}

export type OutdoorPlayerAvatarSlotStatus = 'empty' | 'loading' | 'ready' | 'failed';

/**
 * 玩家 avatar 的生命周期槽：场景一段、角色一段分开管。
 *
 * 参考成熟 3D 场景里“request generation”的做法：
 * - `setRole` 立刻作废旧代际并释放当前实例，旧加载晚到只会被 dispose，不会叠加；
 * - 加载失败 / 缺 idle-walk 时槽位保持 `failed`，调用方继续用胶囊体；
 * - `dispose` 后所有晚到结果都丢弃，适配场景重建与卸载；
 * - 预加载就是挂槽后立即 `setRole`，不需要等进入第三人称。
 *
 * 槽本身不碰 React，也不决定显隐；显隐继续走 `outdoorPlayerPresentation`。
 */
export interface OutdoorPlayerAvatarSlot {
  readonly status: OutdoorPlayerAvatarSlotStatus;
  readonly role: OutdoorPlayerAvatarRole | null;
  handle(): OutdoorPlayerAvatarHandle | null;
  setRole(role: OutdoorPlayerAvatarRole | null | undefined): void;
  setFrame(frame: OutdoorPlayerAvatarFrame): void;
  dispose(): void;
}

export interface CreateOutdoorPlayerAvatarSlotOptions {
  scene: THREE.Scene;
  load?: OutdoorPlayerAvatarLoader;
  baseY?: number;
  fadeSeconds?: number;
}

function normalizedRole(
  role: OutdoorPlayerAvatarRole | null | undefined,
): OutdoorPlayerAvatarRole | null {
  if (!role?.assetId || !role.glbUrl) return null;
  return {
    assetId: role.assetId,
    glbUrl: role.glbUrl,
    ...(role.name ? { name: role.name } : {}),
  };
}

export function createOutdoorPlayerAvatarSlot(
  options: CreateOutdoorPlayerAvatarSlotOptions,
): OutdoorPlayerAvatarSlot {
  let disposed = false;
  let generation = 0;
  let currentRole: OutdoorPlayerAvatarRole | null = null;
  let status: OutdoorPlayerAvatarSlotStatus = 'empty';
  let handle: OutdoorPlayerAvatarHandle | null = null;

  function disposeHandle(): void {
    const current = handle;
    handle = null;
    current?.dispose();
  }

  function setRole(role: OutdoorPlayerAvatarRole | null | undefined): void {
    if (disposed) return;
    const run = ++generation;
    // 先卸旧实例：换角色不叠加，旧 mixer / 几何立刻释放。
    disposeHandle();
    currentRole = normalizedRole(role);
    if (!currentRole) {
      status = 'empty';
      return;
    }
    status = 'loading';
    void createOutdoorPlayerAvatar({
      scene: options.scene,
      role: currentRole,
      ...(options.load ? { load: options.load } : {}),
      ...(options.baseY !== undefined ? { baseY: options.baseY } : {}),
      ...(options.fadeSeconds !== undefined ? { fadeSeconds: options.fadeSeconds } : {}),
    }).then((next) => {
      // 场景重建 / 换角色 / 卸载后晚到的结果一律释放，不进场景。
      if (disposed || run !== generation) {
        next?.dispose();
        return;
      }
      if (!next) {
        status = 'failed';
        return;
      }
      handle = next;
      status = 'ready';
    }).catch(() => {
      if (!disposed && run === generation) status = 'failed';
    });
  }

  function setFrame(frame: OutdoorPlayerAvatarFrame): void {
    handle?.setFrame(frame);
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    generation += 1;
    disposeHandle();
    currentRole = null;
    status = 'empty';
  }

  return {
    get status() { return status; },
    get role() { return currentRole; },
    handle: () => handle,
    setRole,
    setFrame,
    dispose,
  };
}
