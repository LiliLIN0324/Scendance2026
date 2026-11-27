import type { CameraPreset } from '../lib/types';

/**
 * 2026-11-25 S1-b：相机预设与场景推近的休眠壳。
 *
 * 这两个 hook 的全部行为都是「读 cameraRef / controlsRef 再动相机」；S1-a 之后
 * 两个 ref 恒为 null（编辑器没有 canvas 交给 three），任何取景、推近、钳制都不会
 * 生效。这里保留同名 API 让消费点（导出机位、地图取景、场景点推近）原样编译，
 * 行为与退役前一致：什么也不做。
 *
 * 真正的删除按消费点分片做（S1-c 起）；届时 applyPreset 从 use-import-export
 * 的签名里一起摘掉。
 */

export const SCENE_ZOOM_MS = 600;
export const SCENE_ZOOM_ELEVATION_DEG = 42.5;
export const SCENE_ZOOM_CLOSER_RATIO = 0.75;

export interface SceneFocusFrame {
  width: number;
  depth: number;
  centerX: number;
  centerZ: number;
}

export interface SceneZoomDest {
  target: { x: number; y: number; z: number };
  distance: number;
  clamp?: { minDistance: number; maxDistance: number };
}

const noop = () => {};

export function useCameraPresets(_options: unknown): {
  applyPreset(preset: CameraPreset): void;
  focusOn(target: { x: number; z: number }, distance?: number, floorY?: number): void;
  fitToRoom(): void;
  ensureRoomInView(): void;
  setSceneFocus(frame: SceneFocusFrame | null): void;
} {
  return {
    applyPreset: noop,
    focusOn: noop,
    fitToRoom: noop,
    ensureRoomInView: noop,
    setSceneFocus: noop,
  };
}

export function useSceneZoom(_options: unknown): {
  zoomToScene(dest: SceneZoomDest): void;
  cancelSceneZoom(): void;
} {
  return { zoomToScene: noop, cancelSceneZoom: noop };
}
