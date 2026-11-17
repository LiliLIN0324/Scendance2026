'use client';

import { useId, useSyncExternalStore } from 'react';
import './walk-figure.css';

/** 锁定稿 walk-v7。24 单位高，中线 x=12，头顶 0、脚底约 24。无五官。 */
const OUTLINE = '#333333';
const MINT = '#A8C9B2';
const COLLAR = 'rgb(52, 86, 66)';
const COLLAR_D = 'M 9.45 7.65 L 14.55 7.65 L 12 10.7 Z';

function subscribeReducedMotion(onChange: () => void): () => void {
  if (typeof window.matchMedia !== 'function') return () => {};
  const media = window.matchMedia('(prefers-reduced-motion: reduce)');
  if (typeof media.addEventListener !== 'function') return () => {};
  media.addEventListener('change', onChange);
  return () => media.removeEventListener('change', onChange);
}

function readReducedMotion(): boolean {
  return typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function partAttr(annotate: boolean, part: string, side?: 'left' | 'right'): Record<string, string> {
  if (!annotate) return {};
  return side ? { 'data-part': part, 'data-side': side } : { 'data-part': part };
}

/**
 * 同一套几何画两次：先描边再盖填充，重叠处的内描边被盖住，只留外轮廓。
 * 手臂绕肩点外张 8.5°，顶部仍有约 0.28 嵌进躯干，所以是一整块剪影。
 */
function FigureShapes({ fill, stroked, annotate }: { fill: string; stroked: boolean; annotate: boolean }): JSX.Element {
  const ink = stroked
    ? {
      fill,
      stroke: OUTLINE,
      strokeWidth: 1,
      strokeLinejoin: 'round' as const,
      strokeLinecap: 'round' as const,
      vectorEffect: 'non-scaling-stroke' as const,
    }
    : { fill };
  return (
    <>
      <circle {...partAttr(annotate, 'head')} cx="12" cy="4.05" r="4.05" {...ink} />
      <rect {...partAttr(annotate, 'torso')} x="8.725" y="7.45" width="6.55" height="8.35" rx="1.15" {...ink} />
      <rect
        {...partAttr(annotate, 'arm', 'left')}
        x="7.185"
        y="8.85"
        width="1.82"
        height="7.15"
        rx="0.7"
        transform="rotate(-8.5 8.095 8.85)"
        {...ink}
      />
      <rect
        {...partAttr(annotate, 'arm', 'right')}
        x="14.995"
        y="8.85"
        width="1.82"
        height="7.15"
        rx="0.7"
        transform="rotate(8.5 15.905 8.85)"
        {...ink}
      />
      <g className="walk-figure-leg is-left" {...partAttr(annotate, 'leg', 'left')}>
        <rect x="8.79" y="15.35" width="2.85" height="8.55" rx="0.55" {...ink} />
      </g>
      <g className="walk-figure-leg is-right" {...partAttr(annotate, 'leg', 'right')}>
        <rect x="12.36" y="15.35" width="2.85" height="8.55" rx="0.55" {...ink} />
      </g>
    </>
  );
}

/** 地图 / 室内漫游钮上的小人。白钮和进出漫游仍由外层按钮负责。 */
export function WalkFigureIcon({
  size = 22,
  active = false,
  hovered = false,
}: {
  size?: number;
  active?: boolean;
  hovered?: boolean;
}): JSX.Element {
  const reduced = useSyncExternalStore(subscribeReducedMotion, readReducedMotion, () => false);
  const rawId = useId().replace(/:/g, '');
  const gradId = `walk-figure-shade-${rawId}`;
  const maskId = `walk-figure-notch-${rawId}`;
  const glowWideId = `walk-figure-glow-wide-${rawId}`;
  const glowTightId = `walk-figure-glow-tight-${rawId}`;
  const className = [
    'walk-figure',
    active ? 'is-active' : 'is-idle',
    hovered ? 'is-hover' : '',
    reduced ? 'is-reduced' : '',
    active && !reduced ? 'is-stepping' : '',
  ].filter(Boolean).join(' ');

  return (
    <svg
      aria-hidden="true"
      className={className}
      data-stand="v7"
      data-state={active ? 'active' : hovered ? 'hover' : 'idle'}
      width={size}
      height={size}
      viewBox="-1.2 -1.4 26.4 27"
      fill="none"
    >
      <defs>
        <linearGradient id={gradId} x1="3" y1="0" x2="20" y2="24" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#5C8E70" />
          <stop offset="0.48" stopColor="#4A7C59" />
          <stop offset="1" stopColor="#426F54" />
        </linearGradient>
        <filter id={glowWideId} x="-70%" y="-70%" width="240%" height="240%" colorInterpolationFilters="sRGB">
          <feGaussianBlur stdDeviation="1.85" />
        </filter>
        <filter id={glowTightId} x="-50%" y="-50%" width="200%" height="200%" colorInterpolationFilters="sRGB">
          <feGaussianBlur stdDeviation="0.7" />
        </filter>
        {/* 裆部只挖掉描边，避免 0.72 的浅缝被两条内轮廓糊成深槽。 */}
        <mask id={maskId} maskUnits="userSpaceOnUse">
          <rect x="-2" y="-2" width="30" height="32" fill="#ffffff" />
          <rect x="11.58" y="15.6" width="0.84" height="9.2" fill="#000000" />
        </mask>
      </defs>
      <g className="walk-figure-glow" mask={`url(#${maskId})`}>
        <g opacity="0.5" filter={`url(#${glowWideId})`}>
          <FigureShapes fill={MINT} stroked={false} annotate={false} />
        </g>
        <g opacity="0.92" filter={`url(#${glowTightId})`}>
          <FigureShapes fill={MINT} stroked={false} annotate={false} />
        </g>
      </g>
      <g className="walk-figure-body">
        <g className="walk-figure-ink" mask={`url(#${maskId})`}>
          <FigureShapes fill={OUTLINE} stroked annotate={false} />
        </g>
        <g className="walk-figure-fill">
          <FigureShapes fill={`url(#${gradId})`} stroked={false} annotate />
        </g>
        <path className="walk-figure-collar" data-part="collar" d={COLLAR_D} fill={COLLAR} />
      </g>
    </svg>
  );
}
