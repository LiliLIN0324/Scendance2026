'use client';

import { useEffect, useRef } from 'react';

/** 门厅形体是唯一保留的 Agent 脸；两只眼的位置按百分比写，供眼睛层定位。 */
export const RAIL_DOOR_EYES: [number, number][] = [
  [42.8, 36.2],
  [61.6, 34.2],
];

export const RAIL_DOOR_SRC = '/assets/rail/door.png';

/** 眼睛跟着鼠标走：只写 CSS 变量，不触发 React 重渲染。 */
export function useEyeFollow(ref: React.RefObject<HTMLSpanElement>) {
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

/**
 * 门厅形体：手绘软形体 + 两只白眼睛，眼睛随鼠标轻微移动。
 * 2026-11-21 用户：只保留门厅这一张脸，ball / cube / pyramid 三张已删除；
 * Bingo、空间、物料的轨钮与手机端对话条一律改用线性图标，不再有第二张脸。
 */
export function RailAvatar({ size = 28 }: { size?: number }): JSX.Element {
  const ref = useRef<HTMLSpanElement>(null);
  useEyeFollow(ref);
  return (
    <span ref={ref} className="sc-rail-avatar" style={{ width: size, height: size }}>
      <span className="sc-rail-avatar-tilt">
        <img src={RAIL_DOOR_SRC} alt="" width={size} height={size} draggable={false} />
        <span className="sc-rail-avatar-face" aria-hidden="true">
          {RAIL_DOOR_EYES.map(([x, y], index) => (
            <i key={index} className={`sc-rail-eye is-${index === 0 ? 'left' : 'right'}`} style={{ left: `${x}%`, top: `${y}%` }} />
          ))}
        </span>
      </span>
    </span>
  );
}
