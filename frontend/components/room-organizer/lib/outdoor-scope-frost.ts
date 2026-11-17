/**
 * 3D 设计范围「框外毛玻璃」（2026-11-17 用户：「3D 的时候设计白框外并没有添加蒙版」「就是没有模糊」）。
 *
 * 2D 画布的做法是：把框外那块底图 `filter: blur(7px)` 重画一遍，再压一层白色薄纱
 * （见 `lib/outdoor-plan-canvas.ts` 的 `drawDesignScopeMask`）。3D 是 WebGL 透视场景，
 * 没法对已经画完的一帧做「只糊框外」的返工——除非上后处理。这里用零依赖的等价做法：
 * 盖一层 `backdrop-filter: blur()` 的 HTML 面，用 `clip-path` 把设计范围那圈挖掉。
 * 屏幕空间挖洞，和 2D 的「屏幕空间模糊」是同一种语义，所以两边看起来才是一套。
 *
 * 本文件只做纯计算（投影后的百分比点 → CSS `polygon()`），方便单测锁住形状；
 * 逐帧取值在 `outdoor-plan-3d.tsx` 的渲染循环里。
 */

/** 模糊当量：7 px 与 2D 的 `blur(7px)` 同一档（再大就只剩色块，看不出框外是同一张地图）。 */
export const SCOPE_FROST_BLUR_PX = 7;

/** 白纱：3D 里另有一层贴地白纱（`plan-footprint-builder` 的 scopeMask），这里只补一点点，别叠成白墙。 */
export const SCOPE_FROST_VEIL = 'rgba(255, 255, 255, 0.2)';

/** 外圈永远是整屏；内圈（设计范围投影）对消成洞。 */
const OUTER_RING = '0% 0%, 100% 0%, 100% 100%, 0% 100%';

export interface ScopeFrostScreenPoint {
  /** 屏幕百分比（0–100，左上角为原点）。 */
  x: number;
  y: number;
}

/** 超出视口的部分夹到这个范围：clip-path 允许越界点，但别让样式字符串被无意义地撑长。 */
const CLAMP_PERCENT = 160;

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/** 多边形有向面积（屏幕系，y 向下）。 */
function signedArea(points: readonly ScopeFrostScreenPoint[]): number {
  let area = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index]!;
    const next = points[(index + 1) % points.length]!;
    area += current.x * next.y - next.x * current.y;
  }
  return area / 2;
}

/**
 * 设计范围环（屏幕百分比点）→ CSS `clip-path: polygon(...)`。
 *
 * `polygon()` 按非零环绕规则填充：外圈顺时针、内圈逆时针，中间那块才真的空出来。
 * 投影会把环的绕向按镜头方向翻过来，所以这里按**算出来的**有向面积定绕向，
 * 不赌数据是怎么写的。环退化（点点重合 / 几乎没面积）、点数不足、出现非有限值一律返回
 * `null`——调用方据此把毛玻璃整层藏掉，宁可没有，也别糊了框内。
 */
export function scopeFrostClipPath(points: readonly ScopeFrostScreenPoint[]): string | null {
  if (points.length < 3) return null;
  if (points.some(point => !Number.isFinite(point.x) || !Number.isFinite(point.y))) return null;
  const clamped = points.map(point => ({
    x: round(Math.max(-CLAMP_PERCENT, Math.min(CLAMP_PERCENT, point.x))),
    y: round(Math.max(-CLAMP_PERCENT, Math.min(CLAMP_PERCENT, point.y))),
  }));
  const area = signedArea(clamped);
  // 屏幕上小于 0.5%² 的环看不出洞，直接当退化处理。
  if (Math.abs(area) < 0.5) return null;
  // 外圈（OUTER_RING）在 y 向下的屏幕系里是顺时针（面积为正），内圈必须反向才能挖洞。
  const hole = area < 0 ? clamped : [...clamped].reverse();
  return `polygon(${OUTER_RING}, ${hole.map(point => `${point.x}% ${point.y}%`).join(', ')})`;
}
