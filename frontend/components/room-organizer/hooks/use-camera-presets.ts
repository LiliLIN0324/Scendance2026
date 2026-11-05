import { useCallback, useRef, useState } from 'react';
import { calculateRoomFraming, cameraDistanceClamp } from '../lib/camera-framing';
import type { ViewportPadding } from '../lib/camera-framing';
import type { CameraPreset } from '../lib/types';
import type * as ThreeNS from 'three';
import type { OrbitControls as OrbitControlsType } from 'three/examples/jsm/controls/OrbitControls.js';

interface PresetView {
  position: readonly [number, number, number];
  target: readonly [number, number, number];
}

/** 相机焦点框：钳制与取景都跟着它走（docs/19）。null = 跟随「底图概览 ?? 场地」。 */
export interface SceneFocusFrame {
  width: number;
  depth: number;
  centerX: number;
  centerZ: number;
}

const PRESETS: Record<CameraPreset, (size: number) => PresetView> = {
  iso: (size) => ({ position: [size * 0.8, size * 0.9, size * 0.8], target: [0, 0, 0] }),
  top: (size) => ({ position: [0, size * 1.6, 0.001], target: [0, 0, 0] }),
  front: (size) => ({ position: [0, size * 0.4, size * 1.4], target: [0, size * 0.3, 0] }),
  corner: (size) => ({ position: [size * 1.1, size * 0.6, -size * 0.6], target: [0, 0, 0] }),
};

export interface UseCameraPresetsOptions {
  cameraRef: React.MutableRefObject<ThreeNS.PerspectiveCamera | null>;
  controlsRef: React.MutableRefObject<OrbitControlsType | null>;
  /** Read only; the scene's existing resize observer owns resize timing. */
  canvasRef?: React.MutableRefObject<HTMLCanvasElement | null>;
  roomSize: number;
  roomWidth?: number;
  roomDepth?: number;
  /**
   * 取景框：有调研底图时用它框整片区域，否则框场地本身。
   * 中心可以不在原点上——底图是按地理偏移摆的。
   */
  overview?: { width: number; depth: number; centerX: number; centerZ: number };
  /** Total stacked building height in metres. */
  buildingHeight?: number;
  viewportPadding?: Partial<ViewportPadding>;
  /** Request a render on the next animation frame (render-on-demand). */
  invalidate?: () => void;
}

export function useCameraPresets({ cameraRef, controlsRef, canvasRef, roomSize, roomWidth, roomDepth, overview, buildingHeight = 3, viewportPadding, invalidate }: UseCameraPresetsOptions): {
  applyPreset(preset: CameraPreset): void;
  focusOn(target: { x: number; z: number }, distance?: number, floorY?: number): void;
  fitToRoom(): void;
  ensureRoomInView(): void;
  /** 把焦点切到某个场景框（点场景 zoom 时）；null 回到「底图概览 ?? 场地」。 */
  setSceneFocus(frame: SceneFocusFrame | null): void;
} {
  const roomFramingActive = useRef(true);
  const [sceneFocus, setSceneFocus] = useState<SceneFocusFrame | null>(null);
  const safeSize = Number.isFinite(roomSize) ? Math.max(2, roomSize) : 2;
  const safeHeight = Number.isFinite(buildingHeight) && buildingHeight > 0 ? buildingHeight : 3;
  const width = roomWidth !== undefined && Number.isFinite(roomWidth) && roomWidth > 0 ? roomWidth : safeSize;
  const depth = roomDepth !== undefined && Number.isFinite(roomDepth) && roomDepth > 0 ? roomDepth : safeSize;
  // 焦点优先：点过的场景框住它自己；否则有底图框底图（它的范围更大），都没有框场地。
  const activeFrame = sceneFocus ?? (overview && overview.width > 0 ? overview : null);
  const frameWidth = activeFrame ? activeFrame.width : width;
  const frameDepth = activeFrame ? activeFrame.depth : depth;
  const frameCenterX = activeFrame ? activeFrame.centerX : 0;
  const frameCenterZ = activeFrame ? activeFrame.centerZ : 0;
  const frameSize = Math.max(frameWidth, frameDepth, safeHeight);

  // 钳制只跟当前焦点框走：场地焦点是 2m ~ 对角线×3；焦点切到全湖底图才放大。
  // 不再拿「相机当前离多远」去单调撑大 maxDistance——那正是 12km 底图把相机锁死的根因。
  const lastClampRef = useRef<{ minDistance: number; maxDistance: number } | null>(null);
  const applyCameraClamp = useCallback((controls: OrbitControlsType) => {
    const clamp = cameraDistanceClamp(frameWidth, frameDepth);
    const last = lastClampRef.current;
    controls.minDistance = clamp.minDistance;
    controls.maxDistance = clamp.maxDistance;
    if (!last || last.minDistance !== clamp.minDistance || last.maxDistance !== clamp.maxDistance) {
      lastClampRef.current = clamp;
      console.debug(`[camera-clamp] frame=${frameWidth.toFixed(1)}x${frameDepth.toFixed(1)} min=${clamp.minDistance} max=${clamp.maxDistance.toFixed(1)}`);
    }
  }, [frameWidth, frameDepth]);

  const frameCurrentView = useCallback(() => {
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!camera) return;
    if (controls) applyCameraClamp(controls);
    const canvas = canvasRef?.current ?? controls?.domElement;
    const frame = calculateRoomFraming(camera, { width: frameWidth, depth: frameDepth, height: safeHeight, centerX: frameCenterX, centerZ: frameCenterZ }, {
      ...(canvas ? { viewport: { width: canvas.clientWidth, height: canvas.clientHeight } } : {}),
      ...(viewportPadding ? { padding: viewportPadding } : {}),
      ...(controls ? { orbitTarget: controls.target, minDistance: controls.minDistance } : {}),
    });
    if (!frame) return;
    if (frame.dollyOut > 0) {
      // 取景需要的距离可能被焦点钳制卡住（窄视口 + 小焦点框）：临时放宽到取景所需，
      // 下一次 applyCameraClamp 会把它收回来——钳制仍由焦点框拥有，只是不卡取景。
      if (controls) {
        const needed = camera.position.distanceTo(controls.target) + frame.dollyOut;
        if (needed > controls.maxDistance) controls.maxDistance = needed;
      }
      const backward = camera.position.clone().set(0, 0, 1).applyQuaternion(camera.quaternion);
      camera.position.addScaledVector(backward, frame.dollyOut);
    }
    // 记录取景基线：滚轮 dolly 超出它时由 controls change 回调按距离临时放大 far。
    camera.userData.baseFar = frame.far;
    const farChanged = camera.far !== frame.far;
    if (farChanged) {
      camera.far = frame.far;
      camera.updateProjectionMatrix();
    }
    if (frame.dollyOut > 0 || farChanged) invalidate?.();
  }, [cameraRef, controlsRef, canvasRef, frameWidth, frameDepth, frameCenterX, frameCenterZ, safeHeight, viewportPadding, invalidate, applyCameraClamp]);

  const ensureRoomInView = useCallback(() => {
    if (roomFramingActive.current) frameCurrentView();
  }, [frameCurrentView]);

  const applyPreset = useCallback(
    (preset: CameraPreset) => {
      const camera = cameraRef.current;
      const controls = controlsRef.current;
      if (!camera) return;

      roomFramingActive.current = true;
      // 先按新焦点框应用钳制再 update：否则旧钳制（比如场地焦点的 37m）会把刚摆好的
      // 全湖机位瞬间拽回来。
      if (controls) applyCameraClamp(controls);
      const view = PRESETS[preset](frameSize);
      camera.position.set(view.position[0] + frameCenterX, view.position[1], view.position[2] + frameCenterZ);
      camera.lookAt(frameCenterX, view.target[1], frameCenterZ);

      if (controls) {
        controls.target.set(frameCenterX, view.target[1], frameCenterZ);
        controls.update();
      }
      frameCurrentView();
      invalidate?.();
    },
    [cameraRef, controlsRef, frameSize, frameCenterX, frameCenterZ, frameCurrentView, applyCameraClamp, invalidate]
  );

  const focusOn = useCallback(
    // `floorY` lifts both the camera and the orbit target onto the item's
    // floor plane — without it, focusing an upper-floor item dives the camera
    // into the storey below and frames empty floor (#126).
    (target: { x: number; z: number }, distance = 3, floorY = 0) => {
      const camera = cameraRef.current;
      const controls = controlsRef.current;
      if (!camera) return;

      roomFramingActive.current = false;
      camera.position.set(target.x + distance * 0.6, floorY + distance * 0.8, target.z + distance * 0.6);
      camera.lookAt(target.x, floorY, target.z);

      if (controls) {
        controls.target.set(target.x, floorY, target.z);
        controls.update();
      }
      invalidate?.();
    },
    [cameraRef, controlsRef, invalidate]
  );

  const fitToRoom = useCallback(() => {
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!camera) return;

    roomFramingActive.current = true;
    const distance = Math.max(frameSize, safeHeight);
    const targetY = safeHeight / 2;

    if (controls) applyCameraClamp(controls);
    camera.position.set(distance * 0.6 + frameCenterX, distance * 0.7 + targetY, distance * 0.6 + frameCenterZ);
    camera.lookAt(frameCenterX, targetY, frameCenterZ);

    if (controls) {
      controls.target.set(frameCenterX, targetY, frameCenterZ);
      controls.update();
    }
    frameCurrentView();
    invalidate?.();
  }, [cameraRef, controlsRef, frameSize, frameCenterX, frameCenterZ, safeHeight, frameCurrentView, applyCameraClamp, invalidate]);

  return { applyPreset, focusOn, fitToRoom, ensureRoomInView, setSceneFocus };
}
