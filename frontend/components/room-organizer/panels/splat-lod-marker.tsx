'use client';

import { useEffect, useRef, useState } from 'react';
import {
  SPLAT_LOD_ENTER_M,
  SPLAT_POI_COLORS,
  formatSplatLodDistance,
  splatLodDistanceM,
} from '../lib/splat-lod';
import type * as ThreeNS from 'three';

type ChangeSource = Readonly<{
  addEventListener(type: 'change', listener: () => void): void;
  removeEventListener(type: 'change', listener: () => void): void;
}>;

/**
 * 整景区视距下的锚点 POI：点云退化成图标后，屏幕空间只留这一枚点位。
 *
 * 位置和场景点位层同源（`toScreen` 投影世界坐标），尺寸固定不随距离缩小；
 * 距离读数按 OrbitControls 的 change 刷新，不写进 React 全局状态。
 */
export function SplatLodMarker({
  visible,
  name,
  anchor,
  metersPerUnit,
  cameraRef,
  controlsRef,
  toScreen,
  cameraReady,
}: {
  visible: boolean;
  name: string;
  anchor: Readonly<{ x: number; z: number }> | null;
  metersPerUnit: number;
  cameraRef: Readonly<{ current: ThreeNS.PerspectiveCamera | null }>;
  controlsRef: Readonly<{ current: ChangeSource | null }>;
  toScreen(point: { x: number; y: number; z: number }): { x: number; y: number } | null;
  cameraReady: boolean;
}): JSX.Element | null {
  const [placed, setPlaced] = useState<{ x: number; y: number; distanceM: number } | null>(null);
  const placedRef = useRef<typeof placed>(null);
  const anchorX = anchor?.x ?? null;
  const anchorZ = anchor?.z ?? null;

  useEffect(() => {
    if (!visible || !cameraReady || anchorX === null || anchorZ === null) {
      placedRef.current = null;
      setPlaced(null);
      return undefined;
    }
    const update = () => {
      const camera = cameraRef.current;
      if (!camera) {
        placedRef.current = null;
        setPlaced(null);
        return;
      }
      const distanceM = splatLodDistanceM(camera.position, { x: anchorX, z: anchorZ }, metersPerUnit);
      const point = toScreen({ x: anchorX, y: 0, z: anchorZ });
      const next = point ? { x: point.x, y: point.y, distanceM } : null;
      // change 事件覆盖不到的程序化运镜靠 500ms 心跳兜底；值没变不 setState，避免无谓重渲染。
      const prev = placedRef.current;
      const same = prev !== null && next !== null
        && Math.abs(prev.x - next.x) < 0.5 && Math.abs(prev.y - next.y) < 0.5
        && Math.abs(prev.distanceM - next.distanceM) < 0.5;
      if (!same) {
        placedRef.current = next;
        setPlaced(next);
      }
    };
    update();
    const controls = controlsRef.current;
    controls?.addEventListener('change', update);
    window.addEventListener('resize', update);
    const beat = window.setInterval(update, 500);
    return () => {
      window.clearInterval(beat);
      controls?.removeEventListener('change', update);
      window.removeEventListener('resize', update);
    };
  }, [visible, cameraReady, anchorX, anchorZ, metersPerUnit, cameraRef, controlsRef, toScreen]);

  if (!visible || !placed) return null;
  return (
    <div
      data-testid="splat-lod-poi"
      data-distance-m={Math.round(placed.distanceM)}
      style={{
        position: 'absolute', left: placed.x, top: placed.y, transform: 'translate(-50%,-50%)',
        display: 'flex', alignItems: 'center', gap: 6, padding: '4px 10px 4px 6px',
        borderRadius: 999, background: SPLAT_POI_COLORS.card,
        border: `1px solid ${SPLAT_POI_COLORS.cardBorder}`,
        boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
        pointerEvents: 'none', whiteSpace: 'nowrap', zIndex: 7,
      }}
    >
      <span
        data-testid="splat-lod-poi-dot"
        aria-hidden="true"
        style={{
          width: 10, height: 10, borderRadius: '50%',
          background: SPLAT_POI_COLORS.dot,
          border: `2px solid ${SPLAT_POI_COLORS.dotRing}`,
          boxShadow: '0 0 0 1px rgba(53,98,74,0.35)',
        }}
      />
      <span style={{ fontSize: 11, lineHeight: '16px', color: SPLAT_POI_COLORS.label }}>
        {name} · {formatSplatLodDistance(placed.distanceM)} · 近到 {SPLAT_LOD_ENTER_M} m 显示点云
      </span>
    </div>
  );
}
