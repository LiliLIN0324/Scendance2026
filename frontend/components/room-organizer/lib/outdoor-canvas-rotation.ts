/**
 * 2026-11-17 罗盘拖转 2D：屏幕系角标（框角 L / 锁定钮 / 标签锚点）跟着地图转。
 *
 * 做法：这些部件的几何全部先在「轴对齐屏幕系」（bearing=0 的投影）里按旧数学算好，
 * 再把结果点绕画布中心旋转 -bearing 映射回真实屏幕——正变换与 planPointToPixel
 * 内部的旋转完全一致，bearing=0 时逐字节等于旧行为。
 */

/** 轴对齐屏幕点 → 真实屏幕点（绕画布中心转 -bearing）。 */
export function axisToScreen(
  px: { x: number; y: number },
  viewport: { canvasW: number; canvasH: number; bearing?: number },
): { x: number; y: number } {
  const bearing = viewport.bearing ?? 0;
  if (!bearing) return px;
  const cx = viewport.canvasW / 2;
  const cy = viewport.canvasH / 2;
  const dx = px.x - cx;
  const dy = px.y - cy;
  const cos = Math.cos(-bearing);
  const sin = Math.sin(-bearing);
  return { x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos };
}

/** 真实屏幕点 → 轴对齐屏幕点（axisToScreen 的逆变换，+bearing）。 */
export function screenToAxis(
  px: { x: number; y: number },
  viewport: { canvasW: number; canvasH: number; bearing?: number },
): { x: number; y: number } {
  const bearing = viewport.bearing ?? 0;
  if (!bearing) return px;
  const cx = viewport.canvasW / 2;
  const cy = viewport.canvasH / 2;
  const dx = px.x - cx;
  const dy = px.y - cy;
  const cos = Math.cos(bearing);
  const sin = Math.sin(bearing);
  return { x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos };
}
