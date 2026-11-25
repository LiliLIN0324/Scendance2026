import { useRef } from 'react';
import type * as ThreeNS from 'three';
import type { OrbitControls as OrbitControlsType } from 'three/examples/jsm/controls/OrbitControls.js';

/**
 * 2026-11-25 S1-a：室内 3D 引擎退役后的空壳。
 *
 * 编辑器里已经没有任何 `<canvas>` 把 DOM 交给 three（Viewport 在 E2 撤掉），
 * `canvasRef.current` 恒为 null，`useThreeScene` 的 renderer 永远不会 attach，
 * `isReady` 永远是 false——整条 395 行的引擎在主路径上是死的。
 *
 * 这里保留同一份返回形状（refs 全空、invalidate/requestShadowUpdate 为 no-op），
 * 让上百个「有就画、没有就跳过」的消费点原样编译与运行；真正的删除按消费点
 * 一片一片做（S1-b 起）。行为与退役前完全一致：不 attach、不上屏、不报错。
 */
export interface DormantThreeShell {
  isReady: boolean;
  error: string | null;
  invalidate(): void;
  requestShadowUpdate(): void;
  threeModuleRef: React.MutableRefObject<typeof import('three') | null>;
  sceneRef: React.MutableRefObject<ThreeNS.Scene | null>;
  cameraRef: React.MutableRefObject<ThreeNS.PerspectiveCamera | null>;
  rendererRef: React.MutableRefObject<ThreeNS.WebGLRenderer | null>;
  controlsRef: React.MutableRefObject<OrbitControlsType | null>;
  worldPositionFromClient(clientX: number, clientY: number): { x: number; z: number } | null;
}

const noop = () => {};

export function useDormantThreeShell(): DormantThreeShell {
  const threeModuleRef = useRef<typeof import('three') | null>(null);
  const sceneRef = useRef<ThreeNS.Scene | null>(null);
  const cameraRef = useRef<ThreeNS.PerspectiveCamera | null>(null);
  const rendererRef = useRef<ThreeNS.WebGLRenderer | null>(null);
  const controlsRef = useRef<OrbitControlsType | null>(null);
  return {
    isReady: false,
    error: null,
    invalidate: noop,
    requestShadowUpdate: noop,
    threeModuleRef,
    sceneRef,
    cameraRef,
    rendererRef,
    controlsRef,
    worldPositionFromClient: () => null,
  };
}
