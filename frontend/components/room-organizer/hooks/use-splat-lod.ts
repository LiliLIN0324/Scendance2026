import { useEffect, useRef, useState } from 'react';
import { nextSplatLod, splatLodDistanceM, type SplatLodMode } from '../lib/splat-lod';
import type * as ThreeNS from 'three';

/** 事件源只要求 OrbitControls 的 change；不直接依赖 three 的运行时。 */
type ChangeSource = Readonly<{
  addEventListener(type: 'change', listener: () => void): void;
  removeEventListener(type: 'change', listener: () => void): void;
}>;

export interface UseSplatLodDeps {
  isReady: boolean;
  cameraRef: Readonly<{ current: ThreeNS.PerspectiveCamera | null }>;
  controlsRef: Readonly<{ current: ChangeSource | null }>;
  /** 点云落位（世界坐标，锚点投影后的位置）。没有点云时为 null。 */
  anchor: Readonly<{ x: number; z: number }> | null;
  /** 世界单位 → 真实米的换算（锚点 metersPerUnit）。 */
  metersPerUnit: number;
  /** 只在整景区预设下启用；关掉时始终按近景处理，不改既有行为。 */
  enabled: boolean;
}

/**
 * 第 3 步的 React 侧：按相机到锚点的水平距离，在「点云」与「锚点 POI」之间切换。
 *
 * 只在模式翻转时 setState（不是每帧），所以控件拖动不会带着整棵树重渲染；
 * 距离读数由 POI 组件自己按 change 事件刷新。
 * `measured` 表示至少量过一次距离：自动挂载点云要等它为 true，避免相机还没就绪时误判成近景。
 */
export function useSplatLod(deps: UseSplatLodDeps): Readonly<{ mode: SplatLodMode; measured: boolean }> {
  const [mode, setMode] = useState<SplatLodMode>('splat');
  const modeRef = useRef<SplatLodMode>(mode);
  modeRef.current = mode;
  const [measured, setMeasured] = useState(false);
  const measuredRef = useRef(false);
  const anchorX = deps.anchor?.x ?? null;
  const anchorZ = deps.anchor?.z ?? null;

  useEffect(() => {
    if (!deps.isReady) return undefined;
    const controls = deps.controlsRef.current;
    const camera = deps.cameraRef.current;
    if (!controls || !camera) return undefined;

    const apply = (next: SplatLodMode) => {
      if (next === modeRef.current) return;
      modeRef.current = next;
      setMode(next);
    };

    const measure = () => {
      if (!measuredRef.current) {
        measuredRef.current = true;
        setMeasured(true);
      }
      if (!deps.enabled || anchorX === null || anchorZ === null) {
        apply('splat');
        return;
      }
      const distance = splatLodDistanceM(
        camera.position,
        { x: anchorX, z: anchorZ },
        deps.metersPerUnit,
      );
      apply(nextSplatLod(modeRef.current, distance));
    };

    measure();
    controls.addEventListener('change', measure);
    return () => controls.removeEventListener('change', measure);
  }, [deps.isReady, deps.enabled, anchorX, anchorZ, deps.metersPerUnit, deps.cameraRef, deps.controlsRef]);

  return { mode, measured };
}
