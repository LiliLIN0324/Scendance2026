import { useEffect, useRef, useState, type MutableRefObject } from 'react';
import * as THREE from 'three';
import type { OrbitControls as OrbitControlsType } from 'three/examples/jsm/controls/OrbitControls.js';
import type { PointerLockControls as PointerLockControlsType } from 'three/examples/jsm/controls/PointerLockControls.js';
import { bearingFromLook } from '../lib/gm-compass-bearing';
import { adoptWalkPointerLock, walkPointerLocked } from '../lib/walk-engage';
import {
  boundaryCentroid,
  constrainWorldToBoundary,
  pointInBoundaryRing,
  worldToEnu,
  type WalkBoundaryPoint,
} from '../lib/outdoor-walk-boundary';
import {
  boxCollider,
  resolveWalkerStep,
  walkerClearanceAt,
  type WalkCollider,
  type WalkerPosition,
} from '../lib/walk-collision';
import {
  aerialPolarLimit,
  rigOffsetForYaw,
  viewRigOffset,
  type WalkViewMode,
} from '../lib/walk-view-modes';

/** 鸟瞰档里 WASD 推人的速度（米/秒）；鸟瞰看的是全局，给得比步行快一点。 */
const ORBIT_MOVE_SPEED_MPS = 3.2;

/** 每帧透出的玩家锚点姿态，供户外组件摆占位 avatar 与跟随相机。 */
export interface OutdoorWalkFrame {
  x: number;
  y: number;
  z: number;
  yaw: number;
  moving: boolean;
  thirdPerson: boolean;
  delta: number;
  /** 落座态：占位 avatar 据此切坐姿并改用坐姿眼高对齐。 */
  seated?: boolean;
  /** 落座椅面高度（米），人物碱关节按它对齐，避免屁股浮在椅面上。 */
  seatHeight?: number;
}

/**
 * 坐姿锁定状态：落座后锚点被钉在座位世界坐标、眼高切坐姿、忽略步行输入；
 * `active = false`（或置 null）即起身回到站立眼高与自由步行。
 */
export interface SeatWalkState {
  active: boolean;
  /** 当前落座条目 id（起身时判断是否同一座位）。 */
  seatId?: string;
  /** 座位世界坐标（x 东、z 北，three 世界系）。 */
  x: number;
  z: number;
  /** 坐姿眼高（含楼层基准，米）。 */
  eyeY: number;
  /** 椅面高度（米，地面为 0）；落座时把人物碱关节对齐到这个高度。 */
  seatHeight?: number;
  /** 落座朝向（弧度，可选；缺省保持当前 yaw）。 */
  yaw?: number;
}

/**
 * 户外步行障碍：规划 ENU 米（x 东、y 北），占地中心 + 宽深。
 * `rotationDeg` 与设施占地一致：东为 0、逆时针为正。
 */
export interface OutdoorWalkObstacle {
  x: number;
  y: number;
  width: number;
  depth: number;
  rotationDeg?: number;
}

/**
 * 户外规划 3D 的裸第一人称步行（一期）。
 *
 * 与室内 `use-walkthrough` 同一条指针锁 / WASD / RAF 骨架。边界用
 * `plan.boundary` 多边形钳制；设施与场景物件占地走 `obstacles`（ENU 矩形），
 * 复用 `resolveWalkerStep` 滑动，不接室内 `FurnitureItem[]`。第三人称相机
 * 沿视线回拉，被占地挡住时收到人眼前，避免镜头穿进模型。
 *
 * 生命周期：
 *  - `enabled` 翻真：停用 OrbitControls，挂 PointerLockControls，相机落到固定眼高；
 *    指针锁由右轨按钮在点击手势内先行发起（`requestOutdoorWalkPointerLock`），
 *    这里 `adoptWalkPointerLock` 接住早到的锁。
 *  - WASD / 方向键步行，Shift 加速；眼高固定，Y 不随地形浮动。
 *  - Esc：浏览器先退指针锁；第二次 Esc（锁已释放）或再点漫游钮退出，
 *    恢复 OrbitControls 与进漫游前的相机机位。
 */

export type OutdoorWalkPhase = 'pending' | 'locked' | 'drag' | 'unlocked';

export interface UseOutdoorWalkOptions {
  enabled: boolean;
  canvas: HTMLCanvasElement | null;
  cameraRef: React.MutableRefObject<THREE.PerspectiveCamera | null>;
  orbitRef: React.MutableRefObject<OrbitControlsType | null>;
  /** 接管巡游人物时，从人物当前位置和朝向进场。 */
  spawn?: { x: number; z: number; yaw: number } | undefined;
  /** 场地边界（ENU 米制）；不足 3 点时不做越界判定。 */
  boundary: readonly WalkBoundaryPoint[];
  /** 固定眼高（米），默认 1.6。 */
  eyeHeight?: number;
  /** 步行速度（米/秒），默认 1.8；Shift 翻倍。 */
  walkSpeed?: number;
  /** 视角档位；默认第一人称。third/shoulder 把相机摆到锚点后上方并透出帧给 avatar。 */
  viewMode?: WalkViewMode;
  /** 每帧玩家锚点姿态回调（摆占位 avatar 用）。 */
  onWalkFrame?: (frame: OutdoorWalkFrame) => void;
  /** 第二次 Esc / 退出钮：整条漫游态交回外层收口。 */
  onExit?: (() => void) | undefined;
  /** 坐姿锁定口：组件 E 键落座 / 起身时写入；缺省为站立自由步行。 */
  seatRef?: MutableRefObject<SeatWalkState | null>;
  /**
   * 设施 / 场景物件占地。人走不进盒子；第三人称镜头被挡住时沿视线拉近。
   * 只在引用变化时重建碰撞体。
   */
  obstacles?: readonly OutdoorWalkObstacle[];
}

const MOVEMENT_KEYS = new Set([
  'KeyW',
  'KeyA',
  'KeyS',
  'KeyD',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'ShiftLeft',
  'ShiftRight',
]);

// PointerLockControls 的水平系数是 0.002 × pointerSpeed。拖拽兜底用同一弧度/像素，
// 否则拒锁后的拖动比指针锁快一截，同一下甩鼠标两套手感对不上。
const LOOK_RAD_PER_PX = 0.002;
const DRAG_LOOK_SPEED = LOOK_RAD_PER_PX;
const DRAG_PITCH_LIMIT = Math.PI / 2 - 0.01;
const DRAG_CLICK_SLOP = 4;
/** 身体半径（米），与室内步行同一量级。 */
const WALKER_RADIUS = 0.3;
/** 第三人称镜头离墙的空隙（米）。 */
const CAMERA_CLEARANCE = 0.25;
/** 眼高被压得过低时，相机仍停在地面和近裁剪面之上。 */
export const WALK_MIN_CAMERA_Y = 0.45;
const NO_COLLIDERS: readonly WalkCollider[] = [];
/** 水平移动输入平滑（越大越快贴满速）；与成熟 FPS 起步/停车手感接近。 */
const WALK_MOVE_BLEND = 14;

const pointerLockControlsPromise = import('three/examples/jsm/controls/PointerLockControls.js');

/**
 * 罗盘方位角，0 = 朝北。视线是 three 世界方向（北 = -z），
 * 与 OrbitControls `atan2(-(cam-target).x, (cam-target).z)` 同号。
 */
export function walkCompassHeading(lookX: number, lookZ: number): number {
  return bearingFromLook(lookX, lookZ);
}

/** ENU 占地 → 步行碰撞盒（世界 x 东、z = -北）。非正尺寸丢弃。 */
export function obstaclesToWalkColliders(obstacles: readonly OutdoorWalkObstacle[]): WalkCollider[] {
  const colliders: WalkCollider[] = [];
  for (const obstacle of obstacles) {
    if (!Number.isFinite(obstacle.x) || !Number.isFinite(obstacle.y)) continue;
    if (!(obstacle.width > 0) || !(obstacle.depth > 0)) continue;
    const rotationDeg = Number.isFinite(obstacle.rotationDeg) ? obstacle.rotationDeg ?? 0 : 0;
    colliders.push(boxCollider(
      obstacle.x,
      -obstacle.y,
      obstacle.width,
      obstacle.depth,
      (rotationDeg * Math.PI) / 180,
      false,
    ));
  }
  return colliders;
}

function blockerClear(colliders: readonly WalkCollider[], point: WalkerPosition, radius: number): boolean {
  return walkerClearanceAt(colliders, point) >= radius;
}

/**
 * 沿 from→to 收到第一处会穿盒的位置之前。终点在墙外但线段穿过墙时也要停，
 * 不能只看终点（第三人称 4 m 回拉经常落在模型背面）。
 * 人已经站在盒里时保持 from，交给 `resolveWalkerStep` 把身体推出去。
 */
export function pullWalkCamera(
  colliders: readonly WalkCollider[],
  from: WalkerPosition,
  to: WalkerPosition,
  radius: number,
): WalkerPosition {
  if (colliders.length === 0) return { x: to.x, z: to.z };
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const distance = Math.hypot(dx, dz);
  if (distance < 1e-4) return { x: from.x, z: from.z };
  const stride = Math.max(radius * 0.5, 0.05);
  const steps = Math.min(64, Math.ceil(distance / stride));
  let lastX = from.x;
  let lastZ = from.z;
  for (let i = 1; i <= steps; i += 1) {
    const t = i / steps;
    const point = { x: from.x + dx * t, z: from.z + dz * t };
    if (!blockerClear(colliders, point, radius)) break;
    lastX = point.x;
    lastZ = point.z;
  }
  return { x: lastX, z: lastZ };
}

/** 清掉 OrbitControls 残留的阻尼增量，避免退出步行后第一帧 update 把机位甩开。 */
function settleOrbit(orbit: OrbitControlsType | null): void {
  if (!orbit) return;
  const internals = orbit as OrbitControlsType & {
    _sphericalDelta?: { set: (theta: number, phi: number, radius: number) => void };
    _panOffset?: { set: (x: number, y: number, z: number) => void };
    _scale?: number;
  };
  internals._sphericalDelta?.set(0, 0, 0);
  internals._panOffset?.set(0, 0, 0);
  if (typeof internals._scale === 'number') internals._scale = 1;
}

function typingTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement
    && target.matches('input, textarea, select, [contenteditable="true"]');
}

export function useOutdoorWalk(options: UseOutdoorWalkOptions): { phase: OutdoorWalkPhase } {
  const {
    enabled,
    canvas,
    cameraRef,
    orbitRef,
    spawn,
    boundary,
    eyeHeight = 1.6,
    walkSpeed = 1.8,
    viewMode = 'first',
    onWalkFrame,
    onExit,
    seatRef,
    obstacles,
  } = options;

  const [phase, setPhase] = useState<OutdoorWalkPhase>('pending');
  const phaseRef = useRef<OutdoorWalkPhase>(phase);
  phaseRef.current = phase;
  const lockedOnceRef = useRef(false);

  const boundaryRef = useRef(boundary);
  boundaryRef.current = boundary;
  const spawnRef = useRef(spawn);
  spawnRef.current = spawn;
  const eyeHeightRef = useRef(eyeHeight);
  eyeHeightRef.current = eyeHeight;
  const walkSpeedRef = useRef(walkSpeed);
  walkSpeedRef.current = walkSpeed;
  const viewModeRef = useRef(viewMode);
  viewModeRef.current = viewMode;
  const onWalkFrameRef = useRef(onWalkFrame);
  onWalkFrameRef.current = onWalkFrame;
  const onExitRef = useRef(onExit);
  onExitRef.current = onExit;
  const seatRefLocal = useRef(seatRef);
  seatRefLocal.current = seatRef;
  const obstaclesRef = useRef(obstacles);
  obstaclesRef.current = obstacles;
  // 本轮步行占用 OrbitControls 的代号。退出清理若和场景层「鸟瞰档还原 enabled」
  // 落在同一次提交里，后者会把刚打开的轨道又关掉；微任务只认还没被下一轮占用的代号。
  const orbitHoldRef = useRef(0);

  // 指针锁状态同步：锁落地 → locked；锁曾工作过又被 Esc 释放 → unlocked；
  // 浏览器拒绝锁 / 手势丢失 → drag（拖拽看视角兜底，不走进死胡同）。
  // 预拉 PointerLockControls，避免首进漫游还在等分包时锁不住按钮手势。
  useEffect(() => {
    void pointerLockControlsPromise;
  }, []);

  useEffect(() => {
    if (!enabled || !canvas) {
      lockedOnceRef.current = false;
      setPhase('pending');
      return undefined;
    }
    const doc = canvas.ownerDocument;
    let settled = false;
    const sync = () => {
      const locked = walkPointerLocked(canvas);
      if (locked) {
        settled = true;
        lockedOnceRef.current = true;
        setPhase('locked');
      } else if (settled) {
        setPhase(lockedOnceRef.current ? 'unlocked' : 'drag');
      }
    };
    const onError = () => {
      settled = true;
      setPhase(lockedOnceRef.current ? 'unlocked' : 'drag');
    };
    doc.addEventListener('pointerlockchange', sync);
    doc.addEventListener('pointerlockerror', onError);
    const timer = window.setTimeout(() => {
      if (!settled && !walkPointerLocked(canvas)) {
        settled = true;
        setPhase('drag');
      }
    }, 700);
    sync();
    return () => {
      window.clearTimeout(timer);
      doc.removeEventListener('pointerlockchange', sync);
      doc.removeEventListener('pointerlockerror', onError);
    };
  }, [enabled, canvas]);

  useEffect(() => {
    if (!enabled) return undefined;

    const camera = cameraRef.current;
    if (!canvas || !camera) return undefined;

    const orbit = orbitRef.current;
    const orbitHold = ++orbitHoldRef.current;
    settleOrbit(orbit);
    if (orbit) orbit.enabled = false;

    const cleanup: Array<() => void> = [];
    const pressed = new Set<string>();
    let smoothDx = 0;
    let smoothDz = 0;
    let cancelled = false;
    let controls: PointerLockControlsType | null = null;
    let dragPointer: number | null = null;
    let rafId = 0;
    // 进场同步记下编辑机位。等指针锁分包回来再记时，鸟瞰 effect 已经挪过相机。
    const savedCameraPosition = camera.position.clone();
    const savedCameraQuaternion = camera.quaternion.clone();
    const savedOrbitTarget = orbit ? orbit.target.clone() : null;
    cleanup.push(() => {
      if (dragPointer != null) {
        try { canvas.releasePointerCapture(dragPointer); } catch { /* already released */ }
        dragPointer = null;
      }
      camera.position.copy(savedCameraPosition);
      camera.quaternion.copy(savedCameraQuaternion);
      if (orbit && savedOrbitTarget) orbit.target.copy(savedOrbitTarget);
      settleOrbit(orbit);
      try { orbit?.update(); } catch { /* disposed */ }
    });

    const releaseLock = () => {
      if (canvas.ownerDocument.pointerLockElement === canvas) {
        try { canvas.ownerDocument.exitPointerLock(); } catch { /* already unlocked */ }
      }
    };
    cleanup.push(releaseLock);

    const onKeyDown = (event: KeyboardEvent) => {
      if (typingTarget(event.target) || !MOVEMENT_KEYS.has(event.code)) return;
      pressed.add(event.code);
      // 方向键默认滚页面，会把画布和罗盘一起拽走。
      if (event.code.startsWith('Arrow')) event.preventDefault();
    };
    const onKeyUp = (event: KeyboardEvent) => pressed.delete(event.code);
    // 第一次 Esc 被浏览器预留退锁；锁已释放后再按 Esc 才整条退出漫游。
    const onEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (controls?.isLocked) return;
      onExitRef.current?.();
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('keydown', onEscape);
    cleanup.push(() => window.removeEventListener('keydown', onKeyDown));
    cleanup.push(() => window.removeEventListener('keyup', onKeyUp));
    cleanup.push(() => window.removeEventListener('keydown', onEscape));

    void (async () => {
      const controlsModule = await pointerLockControlsPromise;
      if (cancelled) return;

      controls = new controlsModule.PointerLockControls(camera, canvas);
      controls.pointerSpeed = DRAG_LOOK_SPEED / LOOK_RAD_PER_PX;
      controls.minPolarAngle = Math.PI / 2 - DRAG_PITCH_LIMIT;
      controls.maxPolarAngle = Math.PI / 2 + DRAG_PITCH_LIMIT;
      adoptWalkPointerLock(controls, canvas);
      const adopt = () => { if (controls) adoptWalkPointerLock(controls, canvas); };
      canvas.ownerDocument.addEventListener('pointerlockchange', adopt);
      cleanup.push(() => canvas.ownerDocument.removeEventListener('pointerlockchange', adopt));

      const spawnPosition = spawnRef.current;
      const ring = boundaryRef.current;
      const aerialEntry = viewModeRef.current === 'orbit';
      // 鸟瞰相机由场景层摆在高处。这里只记脚下锚点，不能把镜头压到眼高。
      let playerX = aerialEntry && orbit ? orbit.target.x : camera.position.x;
      let playerZ = aerialEntry && orbit ? orbit.target.z : camera.position.z;
      if (spawnPosition) {
        playerX = spawnPosition.x;
        playerZ = spawnPosition.z;
      } else if (!aerialEntry) {
        const currentEnu = worldToEnu(camera.position.x, camera.position.z);
        if (ring.length >= 3 && !pointInBoundaryRing(currentEnu, ring)) {
          const centroid = boundaryCentroid(ring);
          if (centroid) {
            playerX = centroid.x;
            playerZ = -centroid.y;
          }
        }
      }
      const player = new THREE.Vector3(playerX, eyeHeightRef.current, playerZ);
      if (!aerialEntry) {
        const eyeY = Math.max(player.y, WALK_MIN_CAMERA_Y);
        camera.position.set(player.x, eyeY, player.z);
        if (spawnPosition) {
          camera.lookAt(player.x + Math.sin(spawnPosition.yaw), eyeY, player.z + Math.cos(spawnPosition.yaw));
        }
      }
      let enteredBounds = !spawnPosition || ring.length < 3 || pointInBoundaryRing(worldToEnu(player.x, player.z), ring);
      const lookDir = new THREE.Vector3();
      camera.getWorldDirection(lookDir);
      let yaw = Math.atan2(lookDir.x, lookDir.z);
      // 步行 / 跟随档进场水平化俯仰：环绕机位是 58° polar 俯视，直接沿用会贴地看地；
      // 保留 yaw 朝向、把 pitch 拉到水平。鸟瞰档相机交回 OrbitControls 摆高空俯视，不动。
      if (viewModeRef.current !== 'orbit') {
        const entryEuler = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ');
        entryEuler.x = 0;
        entryEuler.z = 0;
        camera.quaternion.setFromEuler(entryEuler);
      }
      let moving = false;

      const markRefused = () => {
        if (!cancelled) setPhase(lockedOnceRef.current ? 'unlocked' : 'drag');
      };
      const requestLock = () => {
        if (controls?.isLocked) return;
        try {
          void Promise.resolve(canvas.requestPointerLock()).catch(markRefused);
        } catch {
          markRefused();
        }
      };
      const clearRefused = () => {
        lockedOnceRef.current = true;
        setPhase('locked');
      };
      canvas.ownerDocument.addEventListener('pointerlockerror', markRefused);
      cleanup.push(() => canvas.ownerDocument.removeEventListener('pointerlockerror', markRefused));
      controls.addEventListener('lock', clearRefused);
      cleanup.push(() => controls?.removeEventListener('lock', clearRefused));

      const releaseHeldKeys = () => {
        pressed.clear();
        smoothDx = 0;
        smoothDz = 0;
      };
      window.addEventListener('blur', releaseHeldKeys);
      cleanup.push(() => window.removeEventListener('blur', releaseHeldKeys));
      controls.addEventListener('unlock', releaseHeldKeys);
      cleanup.push(() => controls?.removeEventListener('unlock', releaseHeldKeys));

      // 指针锁兜底：锁被拒 / 掉锁后，左键拖拽看视角，WASD 照常走；
      // 点按（无位移）可在冷启动或退锁后请求锁定。
      const dragEuler = new THREE.Euler(0, 0, 0, 'YXZ');
      let dragX = 0;
      let dragY = 0;
      let dragMoved = false;
      const onDragStart = (event: PointerEvent) => {
        if (viewModeRef.current === 'orbit' || controls?.isLocked || event.button !== 0) return;
        dragPointer = event.pointerId;
        dragX = event.clientX;
        dragY = event.clientY;
        dragMoved = false;
        try { canvas.setPointerCapture(event.pointerId); } catch { /* jsdom / older engines */ }
      };
      const onDragMove = (event: PointerEvent) => {
        if (controls?.isLocked || dragPointer !== event.pointerId) return;
        if (!dragMoved && Math.hypot(event.clientX - dragX, event.clientY - dragY) < DRAG_CLICK_SLOP) return;
        dragMoved = true;
        dragEuler.setFromQuaternion(camera.quaternion);
        dragEuler.y -= (event.clientX - dragX) * DRAG_LOOK_SPEED;
        dragEuler.x -= (event.clientY - dragY) * DRAG_LOOK_SPEED;
        dragEuler.x = Math.max(-DRAG_PITCH_LIMIT, Math.min(DRAG_PITCH_LIMIT, dragEuler.x));
        camera.quaternion.setFromEuler(dragEuler);
        dragX = event.clientX;
        dragY = event.clientY;
      };
      const onDragCancel = (event: PointerEvent) => {
        if (dragPointer !== event.pointerId) return;
        dragPointer = null;
        try { canvas.releasePointerCapture(event.pointerId); } catch { /* already released */ }
      };
      const onDragEnd = (event: PointerEvent) => {
        if (dragPointer !== event.pointerId) return;
        const wasClick = !dragMoved;
        onDragCancel(event);
        // 环境永久拒绝指针锁时，单击不能再 retry（只会刷 pointerlockerror）；
        // 只有曾经锁成功过、被 Esc 放开后才用单击收回锁。
        if (wasClick && !controls?.isLocked && lockedOnceRef.current) requestLock();
      };
      canvas.addEventListener('pointerdown', onDragStart);
      canvas.addEventListener('pointermove', onDragMove);
      canvas.addEventListener('pointerup', onDragEnd);
      canvas.addEventListener('pointercancel', onDragCancel);
      cleanup.push(() => canvas.removeEventListener('pointerdown', onDragStart));
      cleanup.push(() => canvas.removeEventListener('pointermove', onDragMove));
      cleanup.push(() => canvas.removeEventListener('pointerup', onDragEnd));
      cleanup.push(() => canvas.removeEventListener('pointercancel', onDragCancel));

      cleanup.push(() => controls?.unlock());
      cleanup.push(() => controls?.disconnect());

      const cameraForward = new THREE.Vector3();
      const forward = new THREE.Vector3();
      const right = new THREE.Vector3();
      const stepTo = { x: 0, z: 0 };
      const resolved = { x: 0, z: 0 };
      let colliderSource: readonly OutdoorWalkObstacle[] | undefined;
      let colliderCache: readonly WalkCollider[] = NO_COLLIDERS;

      const readColliders = (): readonly WalkCollider[] => {
        const list = obstaclesRef.current;
        if (!list || list.length === 0) return NO_COLLIDERS;
        if (list === colliderSource) return colliderCache;
        colliderSource = list;
        colliderCache = obstaclesToWalkColliders(list);
        return colliderCache;
      };

      const readHorizontalLook = (): void => {
        camera.getWorldDirection(cameraForward);
        const hx = cameraForward.x;
        const hz = cameraForward.z;
        if (hx * hx + hz * hz > 1e-6) {
          forward.set(hx, 0, hz).normalize();
          yaw = Math.atan2(forward.x, forward.z);
          return;
        }
        forward.set(Math.sin(yaw), 0, Math.cos(yaw));
        if (forward.lengthSq() < 1e-6) forward.set(0, 0, -1);
        else forward.normalize();
      };

      const slidePlayer = (dx: number, dz: number, speed: number, delta: number): { movedX: number; movedZ: number } => {
        const prevX = player.x;
        const prevZ = player.z;
        stepTo.x = player.x;
        stepTo.z = player.z;
        if (dx !== 0 || dz !== 0) {
          right.crossVectors(forward, camera.up);
          if (right.lengthSq() < 1e-6) right.set(1, 0, 0);
          else right.normalize();
          const len = Math.hypot(dx, dz) || 1;
          const distance = (speed * delta) / len;
          stepTo.x = player.x + (-dz * forward.x + dx * right.x) * distance;
          stepTo.z = player.z + (-dz * forward.z + dx * right.z) * distance;
        }
        const blockers = readColliders();
        if (blockers.length > 0) {
          resolveWalkerStep(blockers, player, stepTo, WALKER_RADIUS, resolved);
          stepTo.x = resolved.x;
          stepTo.z = resolved.z;
        }
        const clamped = enteredBounds ? constrainWorldToBoundary(player, stepTo, boundaryRef.current) : stepTo;
        if (blockers.length > 0 && (clamped.x !== stepTo.x || clamped.z !== stepTo.z)) {
          resolveWalkerStep(blockers, player, clamped, WALKER_RADIUS, resolved);
          player.x = resolved.x;
          player.z = resolved.z;
        } else if (blockers.length > 0) {
          player.x = stepTo.x;
          player.z = stepTo.z;
        } else {
          player.x = clamped.x;
          player.z = clamped.z;
        }
        if (!enteredBounds) enteredBounds = pointInBoundaryRing(worldToEnu(player.x, player.z), boundaryRef.current);
        return { movedX: player.x - prevX, movedZ: player.z - prevZ };
      };

      const placeFollowCamera = (rigX: number, rigZ: number, heightDelta: number, thirdPerson: boolean): void => {
        let camX = player.x + rigX;
        let camZ = player.z + rigZ;
        const blockers = readColliders();
        if (thirdPerson && blockers.length > 0 && (rigX !== 0 || rigZ !== 0)) {
          const pulled = pullWalkCamera(
            blockers,
            { x: player.x, z: player.z },
            { x: camX, z: camZ },
            CAMERA_CLEARANCE,
          );
          camX = pulled.x;
          camZ = pulled.z;
        }
        camera.position.set(camX, Math.max(player.y + heightDelta, WALK_MIN_CAMERA_Y), camZ);
      };

      let lastTime = performance.now();
      const step = () => {
        rafId = requestAnimationFrame(step);
        const now = performance.now();
        const delta = Math.min(0.05, (now - lastTime) / 1000);
        lastTime = now;

        if (controls) adoptWalkPointerLock(controls, canvas);

        const mode = viewRigOffset(viewModeRef.current);

        // #82 鸟瞰档：相机交回 OrbitControls 做高空环绕，hook 不摆跟随机位、不持指针锁。
        if (mode.orbitCamera) {
          if (controls?.isLocked) controls.unlock();
          const sprintAerial = pressed.has('ShiftLeft') || pressed.has('ShiftRight');
          const aerialSpeed = ORBIT_MOVE_SPEED_MPS * (sprintAerial ? 2 : 1);
          let adz = 0;
          let adx = 0;
          if (pressed.has('KeyW') || pressed.has('ArrowUp')) adz -= 1;
          if (pressed.has('KeyS') || pressed.has('ArrowDown')) adz += 1;
          if (pressed.has('KeyA') || pressed.has('ArrowLeft')) adx -= 1;
          if (pressed.has('KeyD') || pressed.has('ArrowRight')) adx += 1;
          const moveBlend = 1 - Math.exp(-WALK_MOVE_BLEND * delta);
          if (adx !== 0 || adz !== 0) {
            smoothDx += (adx - smoothDx) * moveBlend;
            smoothDz += (adz - smoothDz) * moveBlend;
          } else {
            smoothDx *= 1 - moveBlend;
            smoothDz *= 1 - moveBlend;
          }
          readHorizontalLook();
          const driving = Math.hypot(smoothDx, smoothDz) > 0.001;
          const moved = slidePlayer(driving ? smoothDx : 0, driving ? smoothDz : 0, aerialSpeed, delta);
          const orbitMoving = Math.hypot(moved.movedX, moved.movedZ) > 0.0001;
          const bodyYaw = orbitMoving ? Math.atan2(moved.movedX, moved.movedZ) : yaw;
          camera.position.x += moved.movedX;
          camera.position.z += moved.movedZ;
          const liveOrbit = orbitRef.current;
          if (liveOrbit) {
            liveOrbit.target.x += moved.movedX;
            liveOrbit.target.z += moved.movedZ;
            liveOrbit.maxPolarAngle = aerialPolarLimit(camera.position.distanceTo(liveOrbit.target));
            liveOrbit.update();
          }
          moving = orbitMoving;
          onWalkFrameRef.current?.({
            x: player.x,
            y: player.y,
            z: player.z,
            yaw: bodyYaw,
            moving: orbitMoving,
            thirdPerson: false,
            delta,
          });
          return;
        }

        if (!controls?.isLocked && phaseRef.current !== 'drag' && phaseRef.current !== 'unlocked') return;

        readHorizontalLook();
        const lookYaw = yaw;

        // 落座态：锚点钉在座位点、眼高切坐姿、忽略 WASD；起身由组件把 active 置 false。
        const seatState = seatRefLocal.current?.current ?? null;
        if (seatState?.active) {
          player.x = seatState.x;
          player.z = seatState.z;
          player.y = seatState.eyeY;
          const seatYaw = typeof seatState.yaw === 'number' ? seatState.yaw : lookYaw;
          moving = false;
          const seatRig = rigOffsetForYaw(viewModeRef.current, seatYaw);
          placeFollowCamera(seatRig.x, seatRig.z, seatRig.heightDelta, seatRig.thirdPerson);
          onWalkFrameRef.current?.({
            x: player.x,
            y: player.y,
            z: player.z,
            yaw: seatYaw,
            moving: false,
            thirdPerson: seatRig.thirdPerson,
            delta,
            seated: true,
            ...(typeof seatState.seatHeight === 'number' ? { seatHeight: seatState.seatHeight } : {}),
          });
          return;
        }

        const sprint = pressed.has('ShiftLeft') || pressed.has('ShiftRight');
        const speed = walkSpeedRef.current * (sprint ? 2 : 1);

        let dz = 0;
        let dx = 0;
        if (pressed.has('KeyW') || pressed.has('ArrowUp')) dz -= 1;
        if (pressed.has('KeyS') || pressed.has('ArrowDown')) dz += 1;
        if (pressed.has('KeyA') || pressed.has('ArrowLeft')) dx -= 1;
        if (pressed.has('KeyD') || pressed.has('ArrowRight')) dx += 1;

        const moveBlend = 1 - Math.exp(-WALK_MOVE_BLEND * delta);
        if (dx !== 0 || dz !== 0) {
          smoothDx += (dx - smoothDx) * moveBlend;
          smoothDz += (dz - smoothDz) * moveBlend;
        } else {
          smoothDx *= 1 - moveBlend;
          smoothDz *= 1 - moveBlend;
        }

        const driving = Math.hypot(smoothDx, smoothDz) > 0.001;
        const moved = slidePlayer(driving ? smoothDx : 0, driving ? smoothDz : 0, speed, delta);
        player.y = eyeHeightRef.current;
        moving = Math.hypot(moved.movedX, moved.movedZ) > 0.0001;
        // 相机跟当前视线，不跟位移方向；人模只在迈步时转向移动方向。
        const bodyYaw = moving ? Math.atan2(moved.movedX, moved.movedZ) : lookYaw;
        const rig = rigOffsetForYaw(viewModeRef.current, lookYaw);
        placeFollowCamera(rig.x, rig.z, rig.heightDelta, rig.thirdPerson);
        onWalkFrameRef.current?.({
          x: player.x,
          y: player.y,
          z: player.z,
          yaw: bodyYaw,
          moving,
          thirdPerson: rig.thirdPerson,
          delta,
        });
      };
      rafId = requestAnimationFrame(step);
      cleanup.push(() => cancelAnimationFrame(rafId));
    })();

    return () => {
      cancelled = true;
      cancelAnimationFrame(rafId);
      for (const fn of cleanup) {
        try { fn(); } catch { /* swallow */ }
      }
      // 同步先打开，避免没有鸟瞰 effect 的调用方要等一拍。
      // 同一次提交里场景层若按进漫游前的 enabled=false 把轨道又关掉，微任务再打开一次。
      if (orbit) orbit.enabled = true;
      queueMicrotask(() => {
        if (orbitHoldRef.current !== orbitHold || !orbit) return;
        settleOrbit(orbit);
        orbit.enabled = true;
      });
    };
  }, [enabled, canvas, cameraRef, orbitRef]);

  return { phase };
}
