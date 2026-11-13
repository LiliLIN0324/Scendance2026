import { useEffect, useRef, useState } from 'react';
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
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  cameraRef: React.MutableRefObject<THREE.PerspectiveCamera | null>;
  orbitRef: React.MutableRefObject<OrbitControlsType | null>;
  /** 场地边界（ENU 米制）；不足 3 点时不做越界判定。 */
  boundary: readonly WalkBoundaryPoint[];
  /** 固定眼高（米），默认 1.6。 */
  eyeHeight?: number;
  /** 步行速度（米/秒），默认 1.8；Shift 翻倍。 */
  walkSpeed?: number;
  /** 第二次 Esc / 退出钮：整条漫游态交回外层收口。 */
  onExit?: (() => void) | undefined;
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
    canvasRef,
    cameraRef,
    orbitRef,
    boundary,
    eyeHeight = 1.6,
    walkSpeed = 1.8,
    onExit,
  } = options;

  const [phase, setPhase] = useState<OutdoorWalkPhase>('pending');
  const phaseRef = useRef<OutdoorWalkPhase>(phase);
  phaseRef.current = phase;
  const lockedOnceRef = useRef(false);

  const boundaryRef = useRef(boundary);
  boundaryRef.current = boundary;
  const eyeHeightRef = useRef(eyeHeight);
  eyeHeightRef.current = eyeHeight;
  const walkSpeedRef = useRef(walkSpeed);
  walkSpeedRef.current = walkSpeed;
  const onExitRef = useRef(onExit);
  onExitRef.current = onExit;

  // 指针锁状态同步：锁落地 → locked；锁曾工作过又被 Esc 释放 → unlocked；
  // 浏览器拒绝锁 / 手势丢失 → drag（拖拽看视角兜底，不走进死胡同）。
  useEffect(() => {
    if (!enabled) {
      setPhase('pending');
      return undefined;
    }
    const canvas = canvasRef.current;
    const doc = canvas?.ownerDocument ?? document;
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
  }, [enabled, canvasRef]);

  useEffect(() => {
    if (!enabled) return undefined;

    const canvas = canvasRef.current;
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

      // 进场落点：当前 x/z 已在边界内就站原地；在环外（环绕镜头拉到了场外）
      // 就落到边界质心。眼高固定，朝向保持当前 yaw/pitch。
      const ring = boundaryRef.current;
      const currentEnu = worldToEnu(camera.position.x, camera.position.z);
      if (ring.length >= 3 && !pointInBoundaryRing(currentEnu, ring)) {
        const centroid = boundaryCentroid(ring);
        if (centroid) {
          camera.position.set(centroid.x, eyeHeightRef.current, -centroid.y);
        }
      } else {
        camera.position.y = eyeHeightRef.current;
      }
      const player = camera.position.clone();

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
      // 曾成功过的锁，点按（无位移）重新抢锁。
      const dragEuler = new THREE.Euler(0, 0, 0, 'YXZ');
      let dragPointer: number | null = null;
      let dragX = 0;
      let dragY = 0;
      let dragMoved = false;
      const onDragStart = (event: PointerEvent) => {
        if (controls?.isLocked || event.button !== 0) return;
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
        if (!controls?.isLocked && phaseRef.current !== 'drag' && phaseRef.current !== 'unlocked') return;

        const sprint = pressed.has('ShiftLeft') || pressed.has('ShiftRight');
        const speed = walkSpeedRef.current * (sprint ? 2 : 1);

        let dz = 0;
        let dx = 0;
        if (pressed.has('KeyW') || pressed.has('ArrowUp')) dz -= 1;
        if (pressed.has('KeyS') || pressed.has('ArrowDown')) dz += 1;
        if (pressed.has('KeyA') || pressed.has('ArrowLeft')) dx -= 1;
        if (pressed.has('KeyD') || pressed.has('ArrowRight')) dx += 1;

        if (dx !== 0 || dz !== 0) {
          camera.getWorldDirection(cameraForward);
          forward.set(cameraForward.x, 0, cameraForward.z).normalize();
          right.crossVectors(forward, camera.up).normalize();
          const len = Math.hypot(dx, dz) || 1;
          const distance = (speed * delta) / len;
          stepTo.x = player.x + (-dz * forward.x + dx * right.x) * distance;
          stepTo.z = player.z + (-dz * forward.z + dx * right.z) * distance;
          const clamped = constrainWorldToBoundary(player, stepTo, boundaryRef.current);
          player.x = clamped.x;
          player.z = clamped.z;
        }
        player.y = eyeHeightRef.current;
        camera.position.copy(player);
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
  }, [enabled, canvasRef, cameraRef, orbitRef]);

  return { phase };
}
