'use client';

import { useEffect, useRef } from 'react';

export type RailForm = 'door' | 'ball' | 'pyramid' | 'cube';

export const RAIL_EYES: Record<RailForm, [number, number][]> = {
  door: [[42.8, 36.2], [61.6, 34.2]],
  ball: [[42.8, 42.5], [61.6, 40.5]],
  pyramid: [[42.8, 60.8], [61.6, 58.8]],
  cube: [[42.8, 42.6], [61.6, 40.6]],
};

const FORMS: Record<RailForm, { src: string; eyes: [number, number][] }> = {
  door: { src: '/assets/rail/door.png', eyes: RAIL_EYES.door },
  ball: { src: '/assets/rail/ball.png', eyes: RAIL_EYES.ball },
  pyramid: { src: '/assets/rail/pyramid.png', eyes: RAIL_EYES.pyramid },
  cube: { src: '/assets/rail/cube.png', eyes: RAIL_EYES.cube },
};

/** 眼睛跟着鼠标走：只写 CSS 变量，不触发 React 重渲染。 */
function useEyeFollow(ref: React.RefObject<HTMLSpanElement>) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let frame = 0;
    let px = 0;
    let py = 0;
    const update = () => {
      frame = 0;
      const box = el.getBoundingClientRect();
      const dx = px - box.left - box.width / 2;
      const dy = py - box.top - box.height / 2;
      const dist = Math.hypot(dx, dy) || 1;
      const reach = Math.min(1, dist / 40);
      const nx = (dx / dist) * reach;
      const ny = (dy / dist) * reach;
      const shift = Math.min(3.8, box.width * 0.135);
      el.style.setProperty('--eye-x', `${(nx * shift).toFixed(2)}px`);
      el.style.setProperty('--eye-y', `${(ny * shift).toFixed(2)}px`);
      el.style.setProperty('--tilt-y', `${(-nx * 15).toFixed(2)}deg`);
      el.style.setProperty('--tilt-x', `${(ny * 11).toFixed(2)}deg`);
    };
    const onMove = (event: PointerEvent) => {
      px = event.clientX;
      py = event.clientY;
      if (!frame) frame = requestAnimationFrame(update);
    };
    const reset = () => {
      el.style.setProperty('--eye-x', '0px');
      el.style.setProperty('--eye-y', '0px');
      el.style.setProperty('--tilt-y', '0deg');
      el.style.setProperty('--tilt-x', '0deg');
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('blur', reset);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('blur', reset);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [ref]);
}

/** 左轨形体：手绘软形体 + 两只白眼睛，眼睛随鼠标轻微移动。 */
export function RailAvatar({ form, size = 28 }: { form: RailForm; size?: number }): JSX.Element {
  const ref = useRef<HTMLSpanElement>(null);
  useEyeFollow(ref);
  const { src, eyes } = FORMS[form];
  return (
    <span ref={ref} className={`sc-rail-avatar is-${form}`} style={{ width: size, height: size }}>
      <span className="sc-rail-avatar-tilt">
        <img src={src} alt="" width={size} height={size} draggable={false} />
        <span className="sc-rail-avatar-face" aria-hidden="true">
          {eyes.map(([x, y], index) => (
            <i key={index} className={`sc-rail-eye is-${index === 0 ? 'left' : 'right'}`} style={{ left: `${x}%`, top: `${y}%` }} />
          ))}
        </span>
      </span>
    </span>
  );
}
