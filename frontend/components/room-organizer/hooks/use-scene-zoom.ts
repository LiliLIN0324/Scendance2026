import { useCallback, useEffect, useRef } from 'react';
import type * as ThreeNS from 'three';
import type { OrbitControls as OrbitControlsType } from 'three/examples/jsm/controls/OrbitControls.js';

/** 点场景 zoom 的时长（毫秒）与俯角（度）：docs/49 需求A 定案。 */
export const SCENE_ZOOM_MS = 600;
export const SCENE_ZOOM_ELEVATION_DEG = 42.5;
/** 已在焦点上的场景再点一次，按当前距离推近一档。 */
export const SCENE_ZOOM_CLOSER_RATIO = 0.75;

/** ease-in-out cubic。 */
function easeInOut(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

export interface SceneZoomDest {
  /** 目标点（场景包围盒中心）。 */
  target: { x: number; y: number; z: number };
  /** 轨道距离（米）：max(8, 包围盒最长边 × 2.5)。 */
  distance: number;
  /** 到位后应用的轨道钳制（焦点=该场景）。缺省不动钳制。 */
  clamp?: { minDistance: number; maxDistance: number };
}

/**
 * 点场景 → 平滑 zoom（docs/49 需求A）。
 * - 600ms ease-in-out；target 移到场景包围盒中心，俯角 42.5°，方位角保持当前值（不甩镜头）。
 * - 打断规则：过渡中点另一个场景 = 重新定向（token 作废旧动画）；用户拖拽 = controls
 *   的 start 事件立刻中止。到位后没有任何提示。
 */
export function useSceneZoom({ cameraRef, controlsRef, invalidate }: {
  cameraRef: React.MutableRefObject<ThreeNS.PerspectiveCamera | null>;
  controlsRef: React.MutableRefObject<OrbitControlsType | null>;
  invalidate?: () => void;
}): { zoomToScene(dest: SceneZoomDest): void; cancelSceneZoom(): void } {
  const tokenRef = useRef(0);

  const cancelSceneZoom = useCallback(() => {
    tokenRef.current += 1;
  }, []);

  // 用户一上手（拖拽/滚轮）就立刻中止过渡，控制权还给人。
  useEffect(() => {
    const controls = controlsRef.current;
    if (!controls) return;
    controls.addEventListener('start', cancelSceneZoom);
    return () => controls.removeEventListener('start', cancelSceneZoom);
  }, [controlsRef, cancelSceneZoom]);

  const zoomToScene = useCallback((dest: SceneZoomDest) => {
    const camera = cameraRef.current;
    const controls = controlsRef.current;
    if (!camera || !controls || !Number.isFinite(dest.distance) || dest.distance <= 0) return;
    const id = ++tokenRef.current;

    const fromPos = { x: camera.position.x, y: camera.position.y, z: camera.position.z };
    const fromTarget = { x: controls.target.x, y: controls.target.y, z: controls.target.z };
    // 方位角保持当前相机相对新 target 的方向，只改距离与俯角。
    const azimuth = Math.atan2(fromPos.x - fromTarget.x, fromPos.z - fromTarget.z);
    const elevation = (SCENE_ZOOM_ELEVATION_DEG * Math.PI) / 180;
    const horizontal = dest.distance * Math.cos(elevation);
    const toTarget = dest.target;
    const toPos = {
      x: toTarget.x + horizontal * Math.sin(azimuth),
      y: toTarget.y + dest.distance * Math.sin(elevation),
      z: toTarget.z + horizontal * Math.cos(azimuth),
    };

    const startedAt = performance.now();
    const step = (now: number) => {
      if (id !== tokenRef.current) return;
      const t = Math.min(1, (now - startedAt) / SCENE_ZOOM_MS);
      const k = easeInOut(t);
      camera.position.set(
        fromPos.x + (toPos.x - fromPos.x) * k,
        fromPos.y + (toPos.y - fromPos.y) * k,
        fromPos.z + (toPos.z - fromPos.z) * k,
      );
      controls.target.set(
        fromTarget.x + (toTarget.x - fromTarget.x) * k,
        fromTarget.y + (toTarget.y - fromTarget.y) * k,
        fromTarget.z + (toTarget.z - fromTarget.z) * k,
      );
      controls.update();
      invalidate?.();
      if (t < 1) {
        requestAnimationFrame(step);
        return;
      }
      // 到位后再上场地尺度的钳制：动画途中收紧 maxDistance 会把飞行中的相机瞬间拽停。
      if (dest.clamp) {
        controls.minDistance = dest.clamp.minDistance;
        controls.maxDistance = dest.clamp.maxDistance;
      }
      console.debug(
        `[scene-zoom] settled in ${(performance.now() - startedAt).toFixed(0)}ms`
        + ` dist=${dest.distance.toFixed(1)}m elev=${SCENE_ZOOM_ELEVATION_DEG}°`
        + (dest.clamp ? ` clamp=[${dest.clamp.minDistance}, ${dest.clamp.maxDistance.toFixed(1)}]` : ''),
      );
    };
    requestAnimationFrame(step);
  }, [cameraRef, controlsRef, invalidate]);

  return { zoomToScene, cancelSceneZoom };
}
