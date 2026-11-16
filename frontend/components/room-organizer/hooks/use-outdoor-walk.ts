import { useEffect, useRef, useState, type MutableRefObject } from 'react';
import * as THREE from 'three';
import type { OrbitControls as OrbitControlsType } from 'three/examples/jsm/controls/OrbitControls.js';
import type { PointerLockControls as PointerLockControlsType } from 'three/examples/jsm/controls/PointerLockControls.js';
import { adoptWalkPointerLock, walkPointerLocked } from '../lib/walk-engage';
import {
  boundaryCentroid,
  constrainWorldToBoundary,
  pointInBoundaryRing,
  worldToEnu,
  type WalkBoundaryPoint,
} from '../lib/outdoor-walk-boundary';
import {
  rigOffsetForYaw,
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
 * 户外规划 3D 的裸第一人称步行（一期）。
 *
 * 与室内 `use-walkthrough` 同一条指针锁 / WASD / RAF 骨架，但一期砍掉：
 * 设施与墙线段碰撞、座位 / findSeat / 坐姿、第三人称 avatar / 肩视角。
 * 边界只用 `plan.boundary` 多边形做点内钳制；不接室内 `FurnitureItem[]` /
 * `InteriorWall[]` 那套碰撞类型。
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

// 与室内 PointerLockControls / 拖拽兜底一致的手感参数。
const DRAG_LOOK_SPEED = 0.0025;
const DRAG_PITCH_LIMIT = Math.PI / 2 - 0.01;
const DRAG_CLICK_SLOP = 4;

const pointerLockControlsPromise = import('three/examples/jsm/controls/PointerLockControls.js');

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

  // 指针锁状态同步：锁落地 → locked；锁曾工作过又被 Esc 释放 → unlocked；
  // 浏览器拒绝锁 / 手势丢失 → drag（拖拽看视角兜底，不走进死胡同）。
  useEffect(() => {
    if (!enabled || !canvas) {
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
    if (orbit) orbit.enabled = false;

    const cleanup: Array<() => void> = [];
    const pressed = new Set<string>();
    let cancelled = false;
    let controls: PointerLockControlsType | null = null;
    let savedCameraPosition: THREE.Vector3 | null = null;
    let rafId = 0;

    const releaseLock = () => {
      if (canvas.ownerDocument.pointerLockElement === canvas) {
        try { canvas.ownerDocument.exitPointerLock(); } catch { /* already unlocked */ }
      }
    };
    cleanup.push(releaseLock);

    const onKeyDown = (event: KeyboardEvent) => {
      if (MOVEMENT_KEYS.has(event.code)) pressed.add(event.code);
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
      adoptWalkPointerLock(controls, canvas);
      const adopt = () => { if (controls) adoptWalkPointerLock(controls, canvas); };
      canvas.ownerDocument.addEventListener('pointerlockchange', adopt);
      cleanup.push(() => canvas.ownerDocument.removeEventListener('pointerlockchange', adopt));

      savedCameraPosition = camera.position.clone();
      const spawnPosition = spawnRef.current;

      // 进场落点：当前 x/z 已在边界内就站原地；在环外（环绕镜头拉到了场外）
      // 就落到边界质心。眼高固定，朝向保持当前 yaw/pitch。
      const ring = boundaryRef.current;
      const currentEnu = worldToEnu(camera.position.x, camera.position.z);
      if (spawnPosition) {
        camera.position.set(spawnPosition.x, eyeHeightRef.current, spawnPosition.z);
        camera.lookAt(camera.position.x + Math.sin(spawnPosition.yaw), camera.position.y, camera.position.z + Math.cos(spawnPosition.yaw));
      } else if (ring.length >= 3 && !pointInBoundaryRing(currentEnu, ring)) {
        const centroid = boundaryCentroid(ring);
        if (centroid) {
          camera.position.set(centroid.x, eyeHeightRef.current, -centroid.y);
        }
      } else {
        camera.position.y = eyeHeightRef.current;
      }
      const player = camera.position.clone();
      let enteredBounds = !spawnPosition || ring.length < 3 || pointInBoundaryRing(worldToEnu(player.x, player.z), ring);
      const lookDir = new THREE.Vector3();
      camera.getWorldDirection(lookDir);
      let yaw = Math.atan2(lookDir.x, lookDir.z);
      // 步行 / 跟随档进场水平化俯仰：环绕机位是 58° polar 俯视，直接沿用会贴地看地；
      // 保留 yaw 朝向、把 pitch 拉到水平。鸟瞰档相机交回 OrbitControls 摆高空俯视，不动。
      if (viewModeRef.current !== 'orbit') {
        const entryEuler = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ');
        entryEuler.x = 0;
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

      const releaseHeldKeys = () => pressed.clear();
      window.addEventListener('blur', releaseHeldKeys);
      cleanup.push(() => window.removeEventListener('blur', releaseHeldKeys));
      controls.addEventListener('unlock', releaseHeldKeys);
      cleanup.push(() => controls?.removeEventListener('unlock', releaseHeldKeys));

      // 指针锁兜底：锁被拒 / 掉锁后，左键拖拽看视角，WASD 照常走；
      // 点按（无位移）可在冷启动或退锁后请求锁定。
      const dragEuler = new THREE.Euler(0, 0, 0, 'YXZ');
      let dragPointer: number | null = null;
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
        if (wasClick) requestLock();
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
      cleanup.push(() => {
        if (savedCameraPosition) camera.position.copy(savedCameraPosition);
      });

      const cameraForward = new THREE.Vector3();
      const forward = new THREE.Vector3();
      const right = new THREE.Vector3();
      const stepTo = { x: 0, z: 0 };

      let lastTime = performance.now();
      const step = () => {
        rafId = requestAnimationFrame(step);
        const now = performance.now();
        const delta = Math.min(0.05, (now - lastTime) / 1000);
        lastTime = now;

        if (controls) adoptWalkPointerLock(controls, canvas);

        const rig = rigOffsetForYaw(viewModeRef.current, yaw);

        // #82 鸟瞰档：相机交回 OrbitControls 做高空环绕，hook 不步行、不摆位、不持指针锁；
        // 帧照常透出（avatar 按 thirdPerson=false 隐藏；近邻 E 提示由场景层在鸟瞰档跳过）。
        if (rig.orbitCamera) {
          if (controls?.isLocked) controls.unlock();
          // 鸟瞰档：WASD 推的是「接管中的人」，机位保持俯视整体跟着人平移。
          const sprintAerial = pressed.has('ShiftLeft') || pressed.has('ShiftRight');
          const aerialSpeed = ORBIT_MOVE_SPEED_MPS * (sprintAerial ? 2 : 1);
          let adz = 0;
          let adx = 0;
          if (pressed.has('KeyW') || pressed.has('ArrowUp')) adz -= 1;
          if (pressed.has('KeyS') || pressed.has('ArrowDown')) adz += 1;
          if (pressed.has('KeyA') || pressed.has('ArrowLeft')) adx -= 1;
          if (pressed.has('KeyD') || pressed.has('ArrowRight')) adx += 1;
          const prevX = player.x;
          const prevZ = player.z;
          if (adx !== 0 || adz !== 0) {
            camera.getWorldDirection(cameraForward);
            forward.set(cameraForward.x, 0, cameraForward.z);
            if (forward.lengthSq() < 1e-6) forward.set(0, 0, -1);
            forward.normalize();
            right.crossVectors(forward, camera.up).normalize();
            const len = Math.hypot(adx, adz) || 1;
            const distance = (aerialSpeed * delta) / len;
            stepTo.x = player.x + (-adz * forward.x + adx * right.x) * distance;
            stepTo.z = player.z + (-adz * forward.z + adx * right.z) * distance;
            // 与步行同一套边界约束，鸟瞰里也不能把人推出场地。
            const clamped = enteredBounds ? constrainWorldToBoundary(player, stepTo, boundaryRef.current) : stepTo;
            player.x = clamped.x;
            player.z = clamped.z;
            if (!enteredBounds) enteredBounds = pointInBoundaryRing(worldToEnu(player.x, player.z), boundaryRef.current);
          }
          const movedX = player.x - prevX;
          const movedZ = player.z - prevZ;
          const orbitMoving = Math.hypot(movedX, movedZ) > 0.0001;
          if (orbitMoving) yaw = Math.atan2(movedX, movedZ);
          // 机位保持原有高空偏移，按人的位移整体平移（环绕中心跟着人）。
          camera.position.x += movedX;
          camera.position.z += movedZ;
          const orbit = orbitRef.current;
          if (orbit) {
            orbit.target.x += movedX;
            orbit.target.z += movedZ;
            orbit.update();
          }
          moving = orbitMoving;
          onWalkFrameRef.current?.({
            x: player.x,
            y: player.y,
            z: player.z,
            yaw,
            moving: orbitMoving,
            thirdPerson: rig.thirdPerson,
            delta,
          });
          return;
        }

        if (!controls?.isLocked && phaseRef.current !== 'drag' && phaseRef.current !== 'unlocked') return;

        // 落座态：锚点钉在座位点、眼高切坐姿、忽略 WASD；起身由组件把 active 置 false。
        const seatState = seatRefLocal.current?.current ?? null;
        if (seatState?.active) {
          player.x = seatState.x;
          player.z = seatState.z;
          player.y = seatState.eyeY;
          if (typeof seatState.yaw === 'number') yaw = seatState.yaw;
          moving = false;
          camera.position.set(
            player.x + rig.x,
            player.y + rig.heightDelta,
            player.z + rig.z,
          );
          onWalkFrameRef.current?.({
            x: player.x,
            y: player.y,
            z: player.z,
            yaw,
            moving: false,
            thirdPerson: rig.thirdPerson,
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

        const prevX = player.x;
        const prevZ = player.z;
        if (dx !== 0 || dz !== 0) {
          camera.getWorldDirection(cameraForward);
          forward.set(cameraForward.x, 0, cameraForward.z).normalize();
          right.crossVectors(forward, camera.up).normalize();
          const len = Math.hypot(dx, dz) || 1;
          const distance = (speed * delta) / len;
          stepTo.x = player.x + (-dz * forward.x + dx * right.x) * distance;
          stepTo.z = player.z + (-dz * forward.z + dx * right.z) * distance;
          // 接管场地外路段上的人物时，可以先沿线走回范围；从进入范围起再限制越界。
          const clamped = enteredBounds ? constrainWorldToBoundary(player, stepTo, boundaryRef.current) : stepTo;
          player.x = clamped.x;
          player.z = clamped.z;
          if (!enteredBounds) enteredBounds = pointInBoundaryRing(worldToEnu(player.x, player.z), boundaryRef.current);
        }
        player.y = eyeHeightRef.current;
        const movedX = player.x - prevX;
        const movedZ = player.z - prevZ;
        moving = Math.hypot(movedX, movedZ) > 0.0001;
        if (moving) yaw = Math.atan2(movedX, movedZ);
        camera.position.set(
          player.x + rig.x,
          player.y + rig.heightDelta,
          player.z + rig.z,
        );
        onWalkFrameRef.current?.({
          x: player.x,
          y: player.y,
          z: player.z,
          yaw,
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
      for (const fn of cleanup) {
        try { fn(); } catch { /* swallow */ }
      }
      if (orbit) orbit.enabled = true;
    };
  }, [enabled, canvas, cameraRef, orbitRef]);

  return { phase };
}
