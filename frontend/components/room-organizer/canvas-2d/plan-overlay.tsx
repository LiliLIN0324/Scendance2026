'use client';

import { formatMeasureLabel, type PlanAnnotation, type PlanPoint } from '../../../lib/plan-annotation';
import { doorRenderStyle } from './door-render';
import { worldToScreen, type View2DTransform } from './render';

/** 品牌绿（与 render.ts 中 PLAN_SELECT_SOFT / marquee 同色）。 */
const BRAND_GREEN = '#4A7C59';
const BRAND_GREEN_FILL = 'rgba(74, 124, 89, 0.12)';
/** 绘制中的临时草稿用更浅的笔触，避免与已确认标注混淆。 */
const DRAFT_STROKE = 'rgba(74, 124, 89, 0.65)';
/** 推测门旁小字（中性灰，不引新色板）。 */
const INFERRED_LABEL_INK = '#6b7280';
/** 推测门开门弧的虚线 pattern（与 drawRoomOutline 隐藏墙 [6,4] 同节奏）。 */
const INFERRED_ARC_DASH = '6 4';

export interface PlanOverlayProps {
  annotations: readonly PlanAnnotation[];
  /**
   * 2D 渲染器使用的真实 fit-and-center 变换（与 render2DTopDown 同源）。
   * 未挂载 / 尺寸未就绪时传 null，组件直接返回 null，避免用近似 scale 错位。
   */
  transform: View2DTransform | null;
  /** 房间尺寸（米），与 render.ts 同一套 worldToScreen 约定。 */
  layout: Pick<{ width: number; height: number }, 'width' | 'height'>;
  /** 整层显示开关；false 时渲染空层。 */
  visible: boolean;
  /** 正在画但还没落地的临时点（世界坐标），绘制中跟随鼠标反馈。 */
  draftPoints?: readonly PlanPoint[];
}

/**
 * 第 7.5 批「规划标注层」2D 覆盖渲染。
 *
 * 纯展示组件：不接事件、不改状态，交互全部由 use-plan-annotations 与
 * use-canvas-2d-interaction 完成。坐标映射与 render.ts 同源——
 * 通过 worldToScreen 把世界米制坐标投影到 CSS px，与家具 / 网格严格重合。
 *
 * - zone：半透明绿底 + 1px 虚线框，左上角 label + stageNo 徽章；
 * - route：2px 绿色虚线折线，端点圆点；
 * - measure：实线，中点显示「12.4 m」；
 * - draftPoints：绘制中临时反馈（更浅、无填充）。
 */
export function PlanOverlay({
  annotations,
  transform,
  layout,
  visible,
  draftPoints,
}: PlanOverlayProps): JSX.Element | null {
  if (!visible || !transform) return null;

  const toPx = (p: PlanPoint): { x: number; y: number } => {
    const s = worldToScreen(p.x, p.z, transform, layout);
    return { x: s.px, y: s.py };
  };

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
            const w = g.width * transform.scale;
            const h = g.depth * transform.scale;
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
          case 'door': {
            const g = ann.geometry;
            // 样式决策抽成纯函数 doorRenderStyle：inferred:true → 门弧虚线 + 「门未确认」小字。
            // 门扇（关位贴墙 / 开位向室内）无论推测与否都保持实线，只虚线开门弧。
            const style = doorRenderStyle(g);
            // 门洞沿墙 position ± widthM/2；铰链取门洞一端，门长=widthM。
            // 关位端点 = 铰链 + 沿墙方向 * L；开位端点 = 铰链 + 室内法线 * L。
            // 房间中心为原点；worldToScreen 已把 (worldX, worldZ) 投影到 CSS px。
            const halfL = g.widthM / 2;
            const wallLen = g.widthM;
            let hingeW = { x: 0, z: 0 };
            let along = { x: 1, z: 0 }; // 沿墙单位向量（指向门洞另一端）
            let inward = { x: 0, z: -1 }; // 室内法线（指向房间内）
            if (g.wall === 'south') {
              hingeW = { x: g.position - halfL, z: layout.height / 2 };
              along = { x: 1, z: 0 };
              inward = { x: 0, z: -1 };
            } else if (g.wall === 'north') {
              hingeW = { x: g.position - halfL, z: -layout.height / 2 };
              along = { x: 1, z: 0 };
              inward = { x: 0, z: 1 };
            } else if (g.wall === 'west') {
              hingeW = { x: -layout.width / 2, z: g.position - halfL };
              along = { x: 0, z: 1 };
              inward = { x: 1, z: 0 };
            } else {
              hingeW = { x: layout.width / 2, z: g.position - halfL };
              along = { x: 0, z: 1 };
              inward = { x: -1, z: 0 };
            }
            const hinge = toPx(hingeW);
            const closedEnd = toPx({
              x: hingeW.x + along.x * wallLen,
              z: hingeW.z + along.z * wallLen,
            });
            const openEnd = toPx({
              x: hingeW.x + inward.x * wallLen,
              z: hingeW.z + inward.z * wallLen,
            });
            // 门弧：从关位端点绕铰链 90° 扫到开位端点。
            // SVG arc：rx=ry=门长在屏幕上的像素长度；large-arc=0；sweep 按几何方向定。
            const arcR = wallLen * transform.scale;
            // 铰链→关位 与 铰链→开位 是两条垂直向量；叉积符号决定 sweep 方向。
            const cross = along.x * inward.z - along.z * inward.x;
            const sweepFlag = cross > 0 ? 1 : 0;
            // 门旁小字锚点：把小字放「铰链 + 1.6 倍室内法线」位置（房间内侧、离墙稍远）。
            const labelAnchor = toPx({
              x: hingeW.x + inward.x * (wallLen * 1.6),
              z: hingeW.z + inward.z * (wallLen * 1.6),
            });
            return (
              <g key={ann.id} data-door-inferred={style.dashed ? 'true' : 'false'}>
                {/* 门扇关位（贴墙）：始终实线，推测门也不虚 */}
                <line
                  x1={hinge.x}
                  y1={hinge.y}
                  x2={closedEnd.x}
                  y2={closedEnd.y}
                  stroke={BRAND_GREEN}
                  strokeWidth={1.5}
                />
                {/* 门扇开位（向室内打开）：始终实线 */}
                <line
                  x1={hinge.x}
                  y1={hinge.y}
                  x2={openEnd.x}
                  y2={openEnd.y}
                  stroke={BRAND_GREEN}
                  strokeWidth={1.2}
                />
                {/* 门扇扫过的 90° 弧：真实门实线；推测门（inferred:true）虚线 */}
                <path
                  d={`M ${closedEnd.x} ${closedEnd.y} A ${arcR} ${arcR} 0 0 ${sweepFlag} ${openEnd.x} ${openEnd.y}`}
                  fill="none"
                  stroke={BRAND_GREEN}
                  strokeWidth={1}
                  strokeDasharray={style.dashed ? INFERRED_ARC_DASH : undefined}
                />
                <circle cx={hinge.x} cy={hinge.y} r={2.5} fill={BRAND_GREEN} />
                {style.label && (
                  <text
                    x={labelAnchor.x}
                    y={labelAnchor.y}
                    fontSize={11}
                    fill={INFERRED_LABEL_INK}
                    textAnchor="middle"
                  >
                    {style.label}
                  </text>
                )}
              </g>
            );
          }
          default:
            return null;
        }
      })}
      {draftPoints && draftPoints.length > 0 && (
        <g>
          {draftPoints.map((p, i) => {
            const s = toPx(p);
            return <circle key={i} cx={s.x} cy={s.y} r={3.5} fill={DRAFT_STROKE} />;
          })}
          {draftPoints.length >= 2 && (
            <polyline
              points={draftPoints.map((p) => {
                const s = toPx(p);
                return `${s.x},${s.y}`;
              }).join(' ')}
              fill="none"
              stroke={DRAFT_STROKE}
              strokeWidth={1.5}
              strokeDasharray="3 3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}
        </g>
      )}
    </svg>
  );
}
