import { useEffect, useMemo, useRef, useState } from 'react';
import { buildWalkColliders, resolveWalkerStep } from '../lib/walk-collision';
import { adoptWalkPointerLock, walkPointerLocked } from '../lib/walk-engage';
import { SEAT_TYPES, findSeat, type SeatTarget } from '../lib/walk-seat';
import type { FurnitureItem, InteriorWall } from '../lib/types';
import type { WalkCollider, WalkCollisionOptions, WalkerPosition } from '../lib/walk-collision';
import type * as ThreeNS from 'three';
import type { OrbitControls as OrbitControlsType } from 'three/examples/jsm/controls/OrbitControls.js';
import type { PointerLockControls as PointerLockControlsType } from 'three/examples/jsm/controls/PointerLockControls.js';

type ThreeModule = typeof import('three');

const NO_ITEMS: readonly FurnitureItem[] = [];
const NO_WALLS: readonly InteriorWall[] = [];

export type WalkViewMode = 'first' | 'third' | 'shoulder';

export interface UseWalkthroughOptions {
  enabled: boolean;
  canvasRef: React.RefObject<HTMLCanvasElement>;
  threeModuleRef: React.MutableRefObject<ThreeModule | null>;
  cameraRef: React.MutableRefObject<ThreeNS.PerspectiveCamera | null>;
  orbitRef: React.MutableRefObject<OrbitControlsType | null>;
  eyeHeight?: number;
  walkSpeed?: number;
  /** Room footprint (metres) used to clamp the walker inside the walls. */
  roomWidth?: number;
  roomDepth?: number;
  /**
   * 环境预览把 Aholo 3DGS 场景按真实米制立好之后，这条边界替换 footprint 围栏：
   * 人走的是点云里的实际空间，而不是布置区那一小块（1:1 实景漫游）。
   */
  walkBounds?: Readonly<{ minX: number; maxX: number; minZ: number; maxZ: number }> | null;
  /** The active floor's furniture and partitions the walker collides with (#156). */
  items?: readonly FurnitureItem[];
  interiorWalls?: readonly InteriorWall[];
  /** 楼层地面标高（米）：坐具的坐面与坐姿眼高都从这里起算。 */
  floorY?: number;
  /** Request a render on the next animation frame (render-on-demand). */
  invalidate?: () => void;
  /**
   * Called when the user presses Escape a second time (while pointer lock is
   * already released) to leave walkthrough entirely (see #67). The first Esc is
   * browser-reserved and only exits pointer lock.
   */
  onExit?: () => void;
  viewMode?: WalkViewMode;
  onWalkFrame?: (frame: { x: number; y: number; z: number; yaw: number; moving: boolean; thirdPerson: boolean; delta: number }) => void;
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

// Keep the walker a little inside the exterior walls so the camera never clips
// through them or steps off the floor plate. Furniture and interior walls are
// solid via lib/walk-collision (#156); this footprint clamp stays the outer
// guard for the exterior walls (see #67).
const WALL_MARGIN = 0.35;
// Shoulder-width walker: wide enough that the camera's near plane never pokes
// into a sofa, narrow enough to fit a 0.8 m doorway with room to spare (#156).
const WALKER_RADIUS = 0.3;

/**
 * Clamp the walker to a metric box (Aholo 3DGS 场景的真实范围) instead of the
 * room footprint. Exported so the 1:1 围栏 can be unit-tested without WebGL.
 */
export function clampToWalkBounds(
  position: { x: number; z: number },
  bounds: Readonly<{ minX: number; maxX: number; minZ: number; maxZ: number }>,
  margin = WALL_MARGIN
): void {
  const minX = bounds.minX + margin;
  const maxX = bounds.maxX - margin;
  const minZ = bounds.minZ + margin;
  const maxZ = bounds.maxZ - margin;
  if (maxX > minX) position.x = Math.max(minX, Math.min(maxX, position.x));
  if (maxZ > minZ) position.z = Math.max(minZ, Math.min(maxZ, position.z));
}

/**
 * First-person walkthrough mode using PointerLockControls.
 *
 * When `enabled` flips on, this hook:
 *  - Disables the orbit controls.
 *  - Lazy-loads PointerLockControls and attaches them to the canvas.
 *  - Captures the pointer on the button's gesture, so the cursor disappears and
 *    mouse-look steers; if the browser refuses the lock (embedded webview,
 *    permissions policy, lost focus) the walk falls back to drag-look with the
 *    cursor visible, so "走进场" never dead-ends (#351).
 *  - Moves the camera to eye level and listens for WASD / arrow movement,
 *    with Shift for sprint.
 *  - Slides the walker around furniture and interior walls (#156) and clamps
 *    it to the room footprint so it can't leave the plate.
 *  - On disable / unmount, restores orbit controls and the camera pose.
 *
 * `eyeHeight` (which tracks the active floor) is read live from a ref so a floor
 * switch mid-walk only re-seats the camera's height — it never tears the mode
 * down and drops pointer lock (see #67).
 */
export type WalkthroughPhase = 'pending' | 'locked' | 'drag' | 'unlocked';

// Look sensitivity and pitch clamp for the pointer-lock-free fallback. Chrome's
// PointerLockControls uses 0.002 * pointerSpeed and clamps at ±(π/2 − 0.01);
// matching them keeps the feel identical whichever way the look is driven.
const DRAG_LOOK_SPEED = 0.0025;
const DRAG_PITCH_LIMIT = Math.PI / 2 - 0.01;
// A press that travels fewer CSS pixels is a click that retries pointer lock;
// anything more is a drag-look gesture and must not also request the lock.
const DRAG_CLICK_SLOP = 4;

export interface UseWalkthroughResult {
  /**
   * `pending` while the button's pointer-lock request is in flight, `locked`
   * once the cursor is captured, `drag` when the browser refused the lock, and
   * `unlocked` when a lock that had worked was released (Esc). Both fallback
   * phases keep the walk running with the cursor visible and the left button
   * held to look around (#351); only `unlocked` can retake the lock, with a
   * press-release on the canvas.
   */
  phase: WalkthroughPhase;
  /** 近前可坐的坐具；没有就是 null。UI 用它显示「按 F 坐下」。 */
  nearSeat: SeatTarget | null;
  /** 正坐着：镜头已在坐姿眼高，按 F 或走动即起身。 */
  seated: boolean;
}

const pointerLockControlsPromise = import('three/examples/jsm/controls/PointerLockControls.js');

export function useWalkthrough(options: UseWalkthroughOptions): UseWalkthroughResult {
  const {
    enabled,
    canvasRef,
    threeModuleRef,
    cameraRef,
    orbitRef,
    eyeHeight = 1.6,
    walkSpeed = 3.0,
    roomWidth = Infinity,
    roomDepth = Infinity,
    walkBounds = null,
    items = NO_ITEMS,
    interiorWalls = NO_WALLS,
    floorY = 0,
    invalidate,
    onExit,
    viewMode = 'first',
    onWalkFrame,
  } = options;

  const [phase, setPhase] = useState<WalkthroughPhase>('pending');
  // 坐：近前有没有可坐的、以及此刻坐没坐。状态只在变化时推进 React，
  // 每帧的判定结果放在 ref 里给 RAF 循环用。
  const [nearSeat, setNearSeat] = useState<SeatTarget | null>(null);
  const [seated, setSeated] = useState(false);
  // Read by the RAF loop without re-running the init effect: while the phase
  // is `drag` the loop keeps scrolling the walker even though no pointer lock
  // is held (the drag fallback still walks with WASD).
  const phaseRef = useRef<WalkthroughPhase>(phase);
  phaseRef.current = phase;
  // True once a lock actually landed: a released lock may be retaken by a
  // canvas click, while a lock the browser refuses never is (that only spams
  // pointerlockerror and never works in that environment).
  const lockedOnceRef = useRef(false);

  // Colliders are rebuilt only when the floor's contents change, never per
  // frame (#156). Outside walkthrough the memo is skipped entirely.
  const colliders = useMemo<readonly WalkCollider[]>(
    () => (enabled ? buildWalkColliders(items, interiorWalls, { roomWidth, roomDepth }) : []),
    [enabled, items, interiorWalls, roomWidth, roomDepth]
  );
  // 坐具单独挑出来：每帧只需要在十几件里找最近的一把，不必扫全屋物料。
  const seats = useMemo<readonly FurnitureItem[]>(
    () => (enabled ? items.filter(item => SEAT_TYPES.has(item.type) && !!item.position) : []),
    [enabled, items]
  );

  // Live values the RAF loop / Esc handler read without re-running the init
  // effect (which would drop pointer lock). Updated every render.
  const eyeHeightRef = useRef(eyeHeight);
  const walkSpeedRef = useRef(walkSpeed);
  const roomWidthRef = useRef(roomWidth);
  const roomDepthRef = useRef(roomDepth);
  const walkBoundsRef = useRef(walkBounds);
  const collidersRef = useRef(colliders);
  const seatsRef = useRef(seats);
  const floorYRef = useRef(floorY);
  /** 近前那把坐具与当前坐姿；RAF 每帧读，不触发重渲染。 */
  const seatRef = useRef<{ near: SeatTarget | null; seated: SeatTarget | null; nearId: string | null }>({
    near: null,
    seated: null,
    nearId: null,
  });
  /** F 键只在按下那一帧被消费一次。 */
  const seatToggleRef = useRef(false);
  const invalidateRef = useRef(invalidate);
  const onExitRef = useRef(onExit);
  const avatarRef = useRef({ viewMode, onWalkFrame });
  avatarRef.current = { viewMode, onWalkFrame };
  eyeHeightRef.current = eyeHeight;
  walkSpeedRef.current = walkSpeed;
  roomWidthRef.current = roomWidth;
  roomDepthRef.current = roomDepth;
  walkBoundsRef.current = walkBounds;
  collidersRef.current = colliders;
  seatsRef.current = seats;
  floorYRef.current = floorY;
  invalidateRef.current = invalidate;
  onExitRef.current = onExit;

  // Re-seat the camera's height when the active floor (eyeHeight) changes while
  // walking, preserving x/z. Deliberately separate from the init effect so a
  // floor switch never re-inits and drops pointer lock (see #67).
  useEffect(() => {
    if (!enabled) return;
    const camera = cameraRef.current;
    if (!camera) return;
    camera.position.y = eyeHeight;
    invalidateRef.current?.();
  }, [enabled, eyeHeight, cameraRef]);

  // Warm the controls module so the first walk click doesn't wait on a network
  // fetch before it can adopt a lock the button already requested.
  useEffect(() => {
    void pointerLockControlsPromise;
  }, []);

  useEffect(() => {
    if (!enabled) {
      setPhase('pending');
      // 退出漫游：坐姿与近前坐具都作废，下次进来重新判定。
      seatRef.current = { near: null, seated: null, nearId: null };
      seatToggleRef.current = false;
      setSeated(false);
      setNearSeat(null);
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
        // The browser released the capture (Esc) while the mode stayed on:
        // keep walking with the drag fallback instead of freezing.
        setPhase(lockedOnceRef.current ? 'unlocked' : 'drag');
      }
    };
    const onError = () => {
      settled = true;
      setPhase(lockedOnceRef.current ? 'unlocked' : 'drag');
    };
    doc.addEventListener('pointerlockchange', sync);
    doc.addEventListener('pointerlockerror', onError);
    // A lock that never arrives (hidden canvas, missing gesture) must not sit
    // on "正在进入" forever. Fall back to drag-look so the walk always starts;
    // a later press-release on the canvas retries the lock.
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
    const THREE = threeModuleRef.current;
    const camera = cameraRef.current;
    if (!canvas || !THREE || !camera) return undefined;

    const orbit = orbitRef.current;
    if (orbit) orbit.enabled = false;

    const cleanup: Array<() => void> = [];
    const pressed = new Set<string>();
    let cancelled = false;
    let controls: PointerLockControlsType | null = null;
    // Release a lock the rail button took even if controls never finished
    // attaching (toggle off during the import).
    const releaseLock = () => {
      if (canvas.ownerDocument.pointerLockElement === canvas) {
        try { canvas.ownerDocument.exitPointerLock(); } catch { /* already unlocked */ }
      }
    };
    cleanup.push(releaseLock);
    let savedCameraPosition: ThreeNS.Vector3 | null = null;
    let rafId = 0;

    const onKeyDown = (event: KeyboardEvent) => {
      if (MOVEMENT_KEYS.has(event.code)) pressed.add(event.code);
      // F：坐下 / 起身。真正消费在下一帧的循环里，那里才看得到近前有没有坐具。
      if (event.code === 'KeyF') seatToggleRef.current = true;
    };
    const onKeyUp = (event: KeyboardEvent) => pressed.delete(event.code);
    // Escape exit: the browser reserves the first Escape to release pointer
    // lock, so we only act on an Escape received while already unlocked — that
    // second press leaves walkthrough mode entirely (see #67).
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

    const clampToFootprint = (position: WalkerPosition): void => {
      // 环境预览立着真实米制的点云时，围栏换成点云边界：这段是 1:1 实景漫游。
      const bounds = walkBoundsRef.current;
      if (bounds) {
        clampToWalkBounds(position, bounds);
        return;
      }
      const halfW = roomWidthRef.current / 2 - WALL_MARGIN;
      const halfD = roomDepthRef.current / 2 - WALL_MARGIN;
      if (Number.isFinite(halfW) && halfW > 0) {
        position.x = Math.max(-halfW, Math.min(halfW, position.x));
      }
      if (Number.isFinite(halfD) && halfD > 0) {
        position.z = Math.max(-halfD, Math.min(halfD, position.z));
      }
    };

    void (async () => {
      const controlsModule = await pointerLockControlsPromise;
      if (cancelled) return;

      controls = new controlsModule.PointerLockControls(camera, canvas);
      adoptWalkPointerLock(controls, canvas);
      const adopt = () => { if (controls) adoptWalkPointerLock(controls, canvas); };
      canvas.ownerDocument.addEventListener('pointerlockchange', adopt);
      cleanup.push(() => canvas.ownerDocument.removeEventListener('pointerlockchange', adopt));
      savedCameraPosition = camera.position.clone();
      const bounds = avatarRef.current.onWalkFrame ? walkBoundsRef.current : null;
      camera.position.set(bounds ? (bounds.minX + bounds.maxX) / 2 : 0, eyeHeightRef.current,
        bounds ? (bounds.minZ + bounds.maxZ) / 2 : 3);
      camera.lookAt(camera.position.x, camera.position.y, camera.position.z - 1);
      clampToFootprint(camera.position);
      const player = camera.position.clone();

      // Not controls.lock(): it drops the promise requestPointerLock returns,
      // so a refused lock was an unhandled rejection the player never saw
      // (#351). PointerLockControls still tracks the lock through
      // pointerlockchange, whoever requested it.
      const markRefused = () => {
        if (!cancelled) setPhase(lockedOnceRef.current ? 'unlocked' : 'drag');
      };
      const requestLock = () => {
        if (controls?.isLocked) return;
        try {
          // Older Safari returns undefined instead of a promise.
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
      // A keyup fired in another window never reaches us: Alt/Cmd-Tab (blur)
      // and any pointer-lock release strand held codes in `pressed`, and the
      // walker auto-marches on return until the key is tapped again (#216).
      // Drop every held key whenever focus or the lock is lost.
      const releaseHeldKeys = () => pressed.clear();
      window.addEventListener('blur', releaseHeldKeys);
      cleanup.push(() => window.removeEventListener('blur', releaseHeldKeys));
      controls.addEventListener('unlock', releaseHeldKeys);
      cleanup.push(() => controls?.removeEventListener('unlock', releaseHeldKeys));

      // Pointer-lock-free fallback: a refused or dropped lock must not freeze
      // the walk. The cursor stays visible, holding the left button drags the
      // view, WASD keeps scrolling through the RAF loop, and a press-release
      // without travel retries the lock inside the gesture (#351).
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
        invalidateRef.current?.();
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
        // A press-release without travel retakes a lock that had worked and
        // was released (Esc). In an environment that refuses pointer lock
        // outright, clicking must not retry: it only logs pointerlockerror.
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
      // Release pointer lock BEFORE disconnecting: an exit path that tears the
      // mode down while still locked would otherwise leave the cursor captured
      // with no mousemove handler attached (#114). No-op when already unlocked.
      cleanup.push(() => controls?.unlock());
      cleanup.push(() => controls?.disconnect());
      cleanup.push(() => {
        if (savedCameraPosition) camera.position.copy(savedCameraPosition);
        invalidateRef.current?.();
      });
      // Paint the eye-level starting pose. The main RAF tick no longer calls
      // OrbitControls.update() in this mode (#114), so nothing else marks the
      // first walkthrough frame dirty.
      invalidateRef.current?.();

      const forward = new THREE.Vector3();
      const cameraForward = new THREE.Vector3();
      const right = new THREE.Vector3();
      // Scratch for the collision step — reused every frame so the loop
      // allocates nothing (#156).
      const walkFrom: WalkerPosition = { x: 0, z: 0 };
      const walkTo: WalkerPosition = { x: 0, z: 0 };
      const walkOut: WalkerPosition = { x: 0, z: 0 };
      const walkOptions: WalkCollisionOptions = {};
      /** 坐下：镜头降到坐姿眼高，位置钉在坐具中心。 */
      const sitDown = (seat: SeatTarget): void => {
        seatRef.current.seated = seat;
        seatRef.current.near = seat;
        seatRef.current.nearId = seat.id;
        setSeated(true);
        setNearSeat(seat);
        player.x = seat.x;
        player.z = seat.z;
        player.y = seat.eyeY;
        camera.position.copy(player);
        invalidateRef.current?.();
      };
      /** 起身：从坐具中心按最近的一面推出去，复用同一套碰撞推挤。 */
      const standUp = (): void => {
        const seat = seatRef.current.seated;
        seatRef.current.seated = null;
        setSeated(false);
        if (!seat) return;
        walkOptions.roomWidth = roomWidthRef.current;
        walkOptions.roomDepth = roomDepthRef.current;
        walkFrom.x = seat.x;
        walkFrom.z = seat.z;
        resolveWalkerStep(collidersRef.current, walkFrom, walkFrom, WALKER_RADIUS, walkOut, walkOptions);
        player.x = walkOut.x;
        player.z = walkOut.z;
        clampToFootprint(player);
        invalidateRef.current?.();
      };
      let lastTime = performance.now();
      const step = () => {
        rafId = requestAnimationFrame(step);
        const now = performance.now();
        const delta = Math.min(0.05, (now - lastTime) / 1000);
        lastTime = now;

        if (controls) adoptWalkPointerLock(controls, canvas);
        // Keep walking when pointer lock was refused or dropped: the drag
        // fallback owns the camera look, the loop still owns the movement.
        if (!controls?.isLocked && phaseRef.current !== 'drag' && phaseRef.current !== 'unlocked') return;
        // Walkthrough is an active mode: mouse-look mutates the camera outside
        // this loop, so render every frame while pointer lock is engaged.
        invalidateRef.current?.();

        const sprint = pressed.has('ShiftLeft') || pressed.has('ShiftRight');
        const speed = walkSpeedRef.current * (sprint ? 2 : 1);

        let dz = 0;
        let dx = 0;
        if (pressed.has('KeyW') || pressed.has('ArrowUp')) dz -= 1;
        if (pressed.has('KeyS') || pressed.has('ArrowDown')) dz += 1;
        if (pressed.has('KeyA') || pressed.has('ArrowLeft')) dx -= 1;
        if (pressed.has('KeyD') || pressed.has('ArrowRight')) dx += 1;

        const len = Math.hypot(dx, dz) || 1;
        camera.getWorldDirection(cameraForward);
        forward.set(cameraForward.x, 0, cameraForward.z).normalize();
        right.crossVectors(forward, camera.up).normalize();
        const avatar = avatarRef.current;

        // 坐：F 切换。坐着时镜头定在坐姿眼高（第一人称），按方向键起身接着走。
        const seatState = seatRef.current;
        if (seatToggleRef.current) {
          seatToggleRef.current = false;
          if (seatState.seated) standUp();
          else if (seatState.near) sitDown(seatState.near);
        }
        if (seatState.seated) {
          if (dx !== 0 || dz !== 0) {
            standUp();
          } else {
            player.x = seatState.seated.x;
            player.z = seatState.seated.z;
            player.y = seatState.seated.eyeY;
            camera.position.copy(player);
            avatar.onWalkFrame?.({ x: player.x, y: player.y, z: player.z,
              yaw: Math.atan2(forward.x, forward.z), moving: false, thirdPerson: false, delta });
            return;
          }
        }

        const distance = speed * delta / len;
        walkFrom.x = player.x;
        walkFrom.z = player.z;
        walkTo.x = player.x + (-dz * forward.x + dx * right.x) * distance;
        walkTo.z = player.z + (-dz * forward.z + dx * right.z) * distance;
        // Slide around furniture and interior walls (#156). Room dims decide
        // whether outdoor items count; Infinity (no room) reads as "inside".
        walkOptions.roomWidth = roomWidthRef.current;
        walkOptions.roomDepth = roomDepthRef.current;
        if (dx !== 0 || dz !== 0) {
          resolveWalkerStep(collidersRef.current, walkFrom, walkTo, WALKER_RADIUS, walkOut, walkOptions);
          player.x = walkOut.x;
          player.z = walkOut.z;
          clampToFootprint(player);
        }
        player.y = eyeHeightRef.current;
        camera.position.copy(player);
        // 近前有没有可坐的：只在换了一把（或走开）时推进 React，UI 才能稳定显示提示。
        const candidate = seatsRef.current.length > 0 ? findSeat(seatsRef.current, player, floorYRef.current) : null;

        if ((candidate?.id ?? null) !== seatState.nearId) {
          seatState.nearId = candidate?.id ?? null;
          seatState.near = candidate;
          setNearSeat(candidate);
        } else {
          seatState.near = candidate;
        }
        if (avatar.viewMode === 'third') {
          camera.position.addScaledVector(cameraForward, -4).addScaledVector(right, 0.65);
        } else if (avatar.viewMode === 'shoulder') {
          camera.position.addScaledVector(cameraForward, -1.5).addScaledVector(right, 0.42);
          camera.position.y -= 0.18;
        }
        const movedX = player.x - walkFrom.x;
        const movedZ = player.z - walkFrom.z;
        const moving = Math.hypot(movedX, movedZ) > 0.0001;
        avatar.onWalkFrame?.({ x: player.x, y: player.y, z: player.z,
          yaw: Math.atan2(moving ? movedX : forward.x, moving ? movedZ : forward.z),
          moving, thirdPerson: avatar.viewMode !== 'first', delta });
      };
      rafId = requestAnimationFrame(step);
      cleanup.push(() => cancelAnimationFrame(rafId));
    })();

    return () => {
      cancelled = true;
      for (const fn of cleanup) {
        try {
          fn();
        } catch {
          /* swallow */
        }
      }
      if (orbit) orbit.enabled = true;
    };
  }, [enabled, canvasRef, threeModuleRef, cameraRef, orbitRef]);

  return { phase, nearSeat, seated };
}
