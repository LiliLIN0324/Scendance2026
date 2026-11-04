'use client';

import { useEffect, useState } from 'react';

/**
 * 场景点位层（docs/49 需求A）：有经纬度的扫描场地在 3D 底图上各钉一个点，
 * 点一下平滑 zoom 过去。样式按视觉把关定案：8px 品牌绿实心点 + 2px 白描边；
 * 聚焦中的点位加一圈 24px 半透明绿环（呼吸 1.6s）；标注文字只用中性灰。
 * 强调色只有品牌绿一种，别加第二个。
 */

export interface SceneGeoDotMark {
  /** 场地资产 id。 */
  id: string;
  name: string;
  /** 世界坐标（锚点投影出来的，y 视为 0）。 */
  x: number;
  z: number;
}

const BRAND_GREEN = '#35624A';
/** 标注文字中性灰两档：主/次。 */
const LABEL_GRAY = '#52524e';

const KEYFRAMES = '@keyframes scGeoDotBreathe{0%,100%{transform:translate(-50%,-50%) scale(.72);opacity:.55}50%{transform:translate(-50%,-50%) scale(1);opacity:.16}}';

export function SceneGeoDots({ dots, focusedId, toScreen, controlsRef, cameraReady, onPick }: {
  dots: readonly SceneGeoDotMark[];
  focusedId: string | null;
  toScreen(point: { x: number; y: number; z: number }): { x: number; y: number } | null;
  controlsRef: React.RefObject<{ addEventListener(type: 'change', listener: () => void): void; removeEventListener(type: 'change', listener: () => void): void } | null>;
  cameraReady: boolean;
  onPick(id: string): void;
}): JSX.Element | null {
  const [placed, setPlaced] = useState<{ id: string; name: string; x: number; y: number }[]>([]);

  useEffect(() => {
    if (!cameraReady || dots.length === 0) { setPlaced([]); return undefined; }
    const update = () => {
      setPlaced(dots.flatMap(dot => {
        const point = toScreen({ x: dot.x, y: 0, z: dot.z });
        return point ? [{ id: dot.id, name: dot.name, x: point.x, y: point.y }] : [];
      }));
    };
    update();
    const controls = controlsRef.current;
    controls?.addEventListener('change', update);
    window.addEventListener('resize', update);
    return () => {
      controls?.removeEventListener('change', update);
      window.removeEventListener('resize', update);
    };
  }, [dots, toScreen, controlsRef, cameraReady]);

  if (dots.length === 0) return null;
  return <div data-testid="scene-geo-dots" style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 6 }}>
    <style>{KEYFRAMES}</style>
    {placed.map(dot => {
      const focused = dot.id === focusedId;
      return <button
        key={dot.id}
        type="button"
        data-testid={`scene-geo-dot-${dot.id}`}
        aria-label={`场景 ${dot.name}`}
        onClick={() => onPick(dot.id)}
        style={{
          position: 'absolute', left: dot.x, top: dot.y, transform: 'translate(-50%,-50%)',
          width: 8, height: 8, borderRadius: '50%',
          background: BRAND_GREEN, border: '2px solid #ffffff',
          padding: 0, cursor: 'pointer', pointerEvents: 'auto',
        }}
      >
        {focused && <span aria-hidden="true" style={{
          position: 'absolute', left: '50%', top: '50%', width: 24, height: 24,
          borderRadius: '50%', border: `1.5px solid ${BRAND_GREEN}`,
          animation: 'scGeoDotBreathe 1.6s ease-in-out infinite',
          pointerEvents: 'none',
        }}/>}
        <span style={{
          position: 'absolute', left: '50%', top: 10, transform: 'translateX(-50%)',
          fontSize: 10, lineHeight: '14px', color: LABEL_GRAY, whiteSpace: 'nowrap',
          pointerEvents: 'none',
        }}>{dot.name}</span>
      </button>;
    })}
  </div>;
}
