import { useCallback, useRef } from 'react';
import { lerpReviewCamera, type ReviewCamera } from '../lib/review-pins';
import type * as ThreeNS from 'three';
import type { OrbitControls as OrbitControlsType } from 'three/examples/jsm/controls/OrbitControls.js';

const FLY_MS = 720;

/** 把轨道相机从当前机位平滑飞到钉上记下的视角。 */
export function useCameraFly({
  cameraRef,
  controlsRef,
  invalidate,
  onExit2D,
}: {
  cameraRef: React.MutableRefObject<ThreeNS.PerspectiveCamera | null>;
  controlsRef: React.MutableRefObject<OrbitControlsType | null>;
  invalidate(): void;
  onExit2D(): void;
}): (dest: ReviewCamera) => void {
  const token = useRef(0);
  return useCallback((dest: ReviewCamera) => {
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!camera || !controls) return;
    onExit2D();
    const from: ReviewCamera = {
      position: [camera.position.x, camera.position.y, camera.position.z],
      target: [controls.target.x, controls.target.y, controls.target.z],
    };
    const id = ++token.current;
    const start = performance.now();
    const step = (now: number) => {
      if (id !== token.current) return;
      const liveCamera = cameraRef.current;
      const liveControls = controlsRef.current;
      if (!liveCamera || !liveControls) return;
      const frame = lerpReviewCamera(from, dest, Math.min(1, (now - start) / FLY_MS));
      liveCamera.position.set(frame.position[0], frame.position[1], frame.position[2]);
      liveControls.target.set(frame.target[0], frame.target[1], frame.target[2]);
      liveControls.update();
      invalidate();
      if ((now - start) < FLY_MS) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }, [cameraRef, controlsRef, invalidate, onExit2D]);
}
