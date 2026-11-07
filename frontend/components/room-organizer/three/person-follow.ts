import type * as ThreeNS from 'three';
import { personFollowSample } from './people-anim';

/** 跟拍实际依赖的控制器面：平移 target 即可，update 由渲染循环每帧开头统一调。 */
interface FollowControls {
  target: ThreeNS.Vector3;
  update(): boolean;
}

/**
 * PEOPLE-04 后半：近景跟拍一名行走中的人物。
 *
 * 相机驱动是纯平移跟随：进入时把机位摆到目标背后近景，之后每帧把人物位移
 * 同量加到 camera.position 与 controls.target 上——OrbitControls 的旋转/缩放
 * 权始终在用户手里，跟拍只是「镜头跟着人平移」，不锁操作。
 *
 * 状态与 people-anim 同款模块级单例（渲染循环每帧调 advancePersonFollow）：
 *  - 目标被删除（注册表摘除）→ 自动退出并回调 UI 收摊；
 *  - 第一人称漫游接管相机期间冻结，退出漫游后重新取近景机位；
 *  - 相机态不持久化：保存/重开/换场后跟拍自然结束，资源零新增。
 */

/** 近景机位：人物背后水平距离。 */
const FOLLOW_DISTANCE_M = 3.5;
/** 近景机位高度（胸口 target 1.2 m + 抬高 1.8 m，polar 角仍在 OrbitControls 72° 限内）。 */
const FOLLOW_EYE_HEIGHT_M = 3.0;
/** 跟拍注视高度：人物胸口，不盯脚底。 */
const FOLLOW_TARGET_HEIGHT_M = 1.2;

let targetId: string | null = null;
/** 上一次推进时目标的位置；null = 尚未取机位（刚进入/切换/漫游恢复）。 */
let lastPos: { x: number; z: number } | null = null;
/** 目标消失（人物被删）时的 UI 收摊回调。手动退出不触发。 */
let endCallback: (() => void) | null = null;
/** dev 探针：最近一次推进到的相机位（走查用）。 */
let probeCamera: { x: number; y: number; z: number } | null = null;

/**
 * 开始/停止跟拍。`id` 为 null 退出；换 id 视为切换目标（机位重摆）。
 * `onEnd` 只在「目标自己消失」时回调一次——UI 用它清跟拍态。
 */
export function setPersonFollowTarget(id: string | null, onEnd?: () => void): void {
  targetId = id;
  lastPos = null;
  endCallback = id ? (onEnd ?? null) : null;
}

/** 当前跟拍目标（测试/调试探针）。 */
export function personFollowTargetId(): string | null {
  return targetId;
}

// 浏览器走查探针（仅 dev 构建挂 window；生产构建不暴露任何全局）。
const followCameraBox: { current: ThreeNS.PerspectiveCamera | null } = { current: null };
if (process.env.NODE_ENV !== 'production' && typeof window !== 'undefined') {
  (window as unknown as {
    __personFollowProbe?: () => unknown;
    __setPersonFollowTarget?: typeof setPersonFollowTarget;
    __personFollowCamera?: typeof followCameraBox;
  }).__personFollowProbe = () => ({
    targetId,
    lastPos,
    camera: probeCamera,
  });
  (window as unknown as { __setPersonFollowTarget?: typeof setPersonFollowTarget }).__setPersonFollowTarget =
    setPersonFollowTarget;
  (window as unknown as { __personFollowCamera?: typeof followCameraBox }).__personFollowCamera = followCameraBox;
}

/**
 * 每帧推进跟拍。在渲染循环里、人物动画推进之后调用（读到的就是本帧行进位）。
 * 返回 true = 相机被移动，调用方置脏；false = 无事发生（可整帧早退）。
 */
export function advancePersonFollow(
  camera: ThreeNS.PerspectiveCamera,
  controls: FollowControls | null,
  walkthroughActive: boolean
): boolean {
  probeCamera = { x: camera.position.x, y: camera.position.y, z: camera.position.z };
  followCameraBox.current = camera;
  if (!targetId) return false;
  if (walkthroughActive) {
    // 第一人称漫游时相机归 PointerLockControls：冻结跟拍，退出漫游后重新取机位。
    lastPos = null;
    return false;
  }
  const sample = personFollowSample(targetId);
  if (!sample) {
    // 人物被删除或已脱离场景：自动退出，交还相机控制权。
    targetId = null;
    lastPos = null;
    const end = endCallback;
    endCallback = null;
    end?.();
    return false;
  }
  if (!lastPos) {
    // 进入跟拍：机位摆到人物背后（facing 是 atan2(dx,dz)，前方 = (sin,cos)）。
    const backX = -Math.sin(sample.facing);
    const backZ = -Math.cos(sample.facing);
    camera.position.set(sample.x + backX * FOLLOW_DISTANCE_M, FOLLOW_EYE_HEIGHT_M, sample.z + backZ * FOLLOW_DISTANCE_M);
    if (controls) {
      controls.target.set(sample.x, FOLLOW_TARGET_HEIGHT_M, sample.z);
      controls.update();
    } else {
      camera.lookAt(sample.x, FOLLOW_TARGET_HEIGHT_M, sample.z);
    }
    lastPos = { x: sample.x, z: sample.z };
    return true;
  }
  const dx = sample.x - lastPos.x;
  const dz = sample.z - lastPos.z;
  lastPos = { x: sample.x, z: sample.z };
  if (dx === 0 && dz === 0) return false;
  camera.position.x += dx;
  camera.position.z += dz;
  if (controls) {
    // 只平移不 update：渲染循环每帧开头会 controls.update()，从实际
    // position/target 重算球坐标，这里抢跑反而把 damping 双步进。
    controls.target.x += dx;
    controls.target.z += dz;
  } else {
    camera.lookAt(sample.x, FOLLOW_TARGET_HEIGHT_M, sample.z);
  }
  return true;
}
