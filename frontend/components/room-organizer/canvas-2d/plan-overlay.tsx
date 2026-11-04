'use client';

import { formatMeasureLabel, type PlanAnnotation, type PlanPoint } from '../../../lib/plan-annotation';

/** 品牌绿（与 render.ts 中 PLAN_SELECT_SOFT / marquee 同色）。 */
const BRAND_GREEN = '#4A7C59';
const BRAND_GREEN_FILL = 'rgba(74, 124, 89, 0.12)';

export interface PlanOverlayProps {
  annotations: readonly PlanAnnotation[];
  /** 米→像素倍率（与 render.ts 的 scale 同义）。 */
  scale: number;
  /** 世界原点 (0,0) 在画布上的像素坐标（房间中心）。 */
  origin: { x: number; y: number };
  /** 整层显示开关；false 时渲染空层。 */
  visible: boolean;
}

/**
 * 第 7.5 批「规划标注层」2D 覆盖渲染。
 *
 * 纯展示组件：不接事件、不改状态，交互全部由 use-plan-annotations 与
 * use-canvas-2d-interaction 完成。坐标映射与 render.ts 一致——
 * 世界米制、房间中心为原点，px = origin + world * scale。
 *
 * - zone：半透明绿底 + 1px 虚线框，左上角 label + stageNo 徽章；
 * - route：2px 绿色虚线折线，端点圆点；
 * - measure：实线，中点显示「12.4 m」。
 */
export function PlanOverlay({ annotations, scale, origin, visible }: PlanOverlayProps): JSX.Element | null {
  if (!visible) return null;

  const toPx = (p: PlanPoint): { x: number; y: number } => ({
    x: origin.x + p.x * scale,
    y: origin.y + p.z * scale,
  });

  return (
    <svg
      aria-label="规划标注层"
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        zIndex: 25,
      }}
    >
      {annotations.map((ann) => {
        switch (ann.geometry.kind) {
          case 'rect': {
            const g = ann.geometry;
            const topLeft = toPx({ x: g.x, z: g.z });
            const w = g.width * scale;
            const h = g.depth * scale;
            const badgeY = topLeft.y + 14;
            return (
              <g key={ann.id}>
                <rect
                  x={topLeft.x}
                  y={topLeft.y}
                  width={w}
                  height={h}
                  fill={BRAND_GREEN_FILL}
                  stroke={BRAND_GREEN}
                  strokeWidth={1}
                  strokeDasharray="5 4"
                />
                <circle cx={topLeft.x + 9} cy={badgeY} r={8} fill={BRAND_GREEN} />
                <text
                  x={topLeft.x + 9}
                  y={badgeY + 3.5}
                  fontSize={10}
                  fill="#fff"
                  textAnchor="middle"
                >
                  {ann.stageNo}
                </text>
                <text
                  x={topLeft.x + 22}
                  y={badgeY + 3.5}
                  fontSize={11}
                  fill={BRAND_GREEN}
                  fontWeight={600}
                >
                  {ann.label}
                </text>
              </g>
            );
          }
          case 'polyline': {
            const pts = ann.geometry.points.map(toPx);
            const pointsAttr = pts.map((p) => `${p.x},${p.y}`).join(' ');
            return (
              <g key={ann.id}>
                <polyline
                  points={pointsAttr}
                  fill="none"
                  stroke={BRAND_GREEN}
                  strokeWidth={2}
                  strokeDasharray="6 4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                {pts.map((p, i) => (
                  <circle key={i} cx={p.x} cy={p.y} r={3} fill={BRAND_GREEN} />
                ))}
                {pts.length > 0 && (
                  <text
                    x={pts[0].x}
                    y={pts[0].y - 8}
                    fontSize={11}
                    fill={BRAND_GREEN}
                    fontWeight={600}
                  >
                    {ann.label}
                  </text>
                )}
              </g>
            );
          }
          case 'measure': {
            const from = toPx(ann.geometry.from);
            const to = toPx(ann.geometry.to);
            const midX = (from.x + to.x) / 2;
            const midY = (from.y + to.y) / 2;
            return (
              <g key={ann.id}>
                <line
                  x1={from.x}
                  y1={from.y}
                  x2={to.x}
                  y2={to.y}
                  stroke={BRAND_GREEN}
                  strokeWidth={1.5}
                />
                <circle cx={from.x} cy={from.y} r={2.5} fill={BRAND_GREEN} />
                <circle cx={to.x} cy={to.y} r={2.5} fill={BRAND_GREEN} />
                <text
                  x={midX}
                  y={midY - 6}
                  fontSize={11}
                  fill={BRAND_GREEN}
                  fontWeight={600}
                  textAnchor="middle"
                >
                  {formatMeasureLabel(ann.geometry.from, ann.geometry.to)}
                </text>
              </g>
            );
          }
          default:
            return null;
        }
      })}
    </svg>
  );
}
