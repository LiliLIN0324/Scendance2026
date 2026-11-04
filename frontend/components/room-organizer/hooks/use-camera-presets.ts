import { useCallback, useRef } from 'react';
import { calculateRoomFraming } from '../lib/camera-framing';
import type { ViewportPadding } from '../lib/camera-framing';
import type { CameraPreset } from '../lib/types';
import type * as ThreeNS from 'three';
import type { OrbitControls as OrbitControlsType } from 'three/examples/jsm/controls/OrbitControls.js';

interface PresetView {
  position: readonly [number, number, number];
  target: readonly [number, number, number];
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
} {
  const roomFramingActive = useRef(true);
  const safeSize = Number.isFinite(roomSize) ? Math.max(2, roomSize) : 2;
  const safeHeight = Number.isFinite(buildingHeight) && buildingHeight > 0 ? buildingHeight : 3;
  const width = roomWidth !== undefined && Number.isFinite(roomWidth) && roomWidth > 0 ? roomWidth : safeSize;
  const depth = roomDepth !== undefined && Number.isFinite(roomDepth) && roomDepth > 0 ? roomDepth : safeSize;
  // 有底图就框底图：它的范围更大，也才是人此刻想看的。
  const frameWidth = overview && overview.width > 0 ? overview.width : width;
  const frameDepth = overview && overview.depth > 0 ? overview.depth : depth;
  const frameCenterX = overview ? overview.centerX : 0;
  const frameCenterZ = overview ? overview.centerZ : 0;
  const frameSize = Math.max(frameWidth, frameDepth, safeHeight);

  const frameCurrentView = useCallback(() => {
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!camera) return;
    const canvas = canvasRef?.current ?? controls?.domElement;
    const frame = calculateRoomFraming(camera, { width: frameWidth, depth: frameDepth, height: safeHeight, centerX: frameCenterX, centerZ: frameCenterZ }, {
      ...(canvas ? { viewport: { width: canvas.clientWidth, height: canvas.clientHeight } } : {}),
      ...(viewportPadding ? { padding: viewportPadding } : {}),
      ...(controls ? { orbitTarget: controls.target, minDistance: controls.minDistance } : {}),
    });
    if (!frame) return;
    if (frame.dollyOut > 0) {
      const backward = camera.position.clone().set(0, 0, 1).applyQuaternion(camera.quaternion);
      camera.position.addScaledVector(backward, frame.dollyOut);
    }
    if (controls) controls.maxDistance = Math.max(controls.maxDistance, camera.position.distanceTo(controls.target));
    const farChanged = camera.far !== frame.far;
    if (farChanged) {
      camera.far = frame.far;
      camera.updateProjectionMatrix();
    }
    if (frame.dollyOut > 0 || farChanged) invalidate?.();
  }, [cameraRef, controlsRef, canvasRef, frameWidth, frameDepth, frameCenterX, frameCenterZ, safeHeight, viewportPadding, invalidate]);

  const ensureRoomInView = useCallback(() => {
    if (roomFramingActive.current) frameCurrentView();
  }, [frameCurrentView]);

  const applyPreset = useCallback(
    (preset: CameraPreset) => {
      const camera = cameraRef.current;
      const controls = controlsRef.current;
      if (!camera) return;

      roomFramingActive.current = true;
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
    [cameraRef, controlsRef, frameSize, frameCenterX, frameCenterZ, frameCurrentView, invalidate]
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

    camera.position.set(distance * 0.6 + frameCenterX, distance * 0.7 + targetY, distance * 0.6 + frameCenterZ);
    camera.lookAt(frameCenterX, targetY, frameCenterZ);

    if (controls) {
      controls.target.set(frameCenterX, targetY, frameCenterZ);
      controls.update();
    }
    frameCurrentView();
    invalidate?.();
  }, [cameraRef, controlsRef, frameSize, frameCenterX, frameCenterZ, safeHeight, frameCurrentView, invalidate]);

  return { applyPreset, focusOn, fitToRoom, ensureRoomInView };
}
