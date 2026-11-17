/**
 * 3D 设计范围「框外毛玻璃」（2026-11-17 用户：「3D 的时候设计白框外并没有添加蒙版」「就是没有模糊」）。
 *
 * 2D 画布的做法是：把框外那块底图 `filter: blur(7px)` 重画一遍，再压一层白色薄纱
 * （见 `lib/outdoor-plan-canvas.ts` 的 `drawDesignScopeMask`）。3D 是 WebGL 透视场景，
 * 没法对已经画完的一帧做「只糊框外」的返工——除非上后处理。
 *
 * **2026-11-17 回修（用户「为什么给我设计场地里面都加模糊了」）**：
 * 第一版图省事，用一层 `backdrop-filter: blur()` 的 HTML 面 + `clip-path` 挖洞。
 * 实测 Chromium 157 的 `backdrop-filter` 完全不吃 `clip-path`——连「只裁一个三角形」
 * 都不生效，模糊直接铺满整个元素，结果连设计范围**里面**也一起糊了。
 * 所以改成和 2D 同一套：把这一帧已经渲染好的画面，按 `evenodd` 只在框外重画一遍
 * （`ctx.filter = blur(7px)`），再压薄白纱。框内像素完全不碰，语义与 2D 一模一样。
 *
 * 本文件只做绘制，`ctx` 由调用方准备好（已按 DPR 缩放到 CSS px）；
 * 逐帧取值（相机投影、节流）在 `outdoor-plan-3d.tsx` 的渲染循环里。
 */

/** 模糊当量：7 px 与 2D 的 `blur(7px)` 同一档（再大就只剩色块，看不出框外是同一张地图）。 */
export const SCOPE_FROST_BLUR_PX = 7;

/**
 * 白纱：3D 里另有一层贴地白纱（`plan-footprint-builder` 的 scopeMask，0.45），
 * 这里只补一点点提亮，别叠成白墙。
 */
export const SCOPE_FROST_VEIL = 'rgba(255, 255, 255, 0.2)';

/** 屏幕系一个点（CSS px，左上角为原点）。 */
export interface ScopeFrostPoint {
  x: number;
  y: number;
}

export interface ScopeFrostDrawOptions {
  /** 舞台 CSS 宽高（画布坐标系，与 `ring` 同一口径）。 */
  width: number;
  height: number;
  /** 设计范围投影后的屏幕点；<3 点视为没有范围，整层不画。 */
  ring: readonly ScopeFrostPoint[];
  /** 取样源：这一帧刚渲染完的 WebGL canvas。 */
  source: CanvasImageSource;
  blurPx?: number;
  veil?: string;
}

/**
 * 框外毛玻璃：整块视口 − 设计范围环（evenodd 一次填完，不留接缝），
 * 先把取样源糊一层，再压薄白纱。
 *
 * 返回 false 表示这一帧什么都没画（范围退化 / 尺寸非法），调用方据此把整层藏掉——
 * 宁可没有毛玻璃，也不能糊了框内。
 */
export function drawScopeFrost(
  ctx: CanvasRenderingContext2D,
  options: ScopeFrostDrawOptions,
): boolean {
  const { width, height, ring, source } = options;
  if (!(width > 0) || !(height > 0) || ring.length < 3) return false;
  if (ring.some(point => !Number.isFinite(point.x) || !Number.isFinite(point.y))) return false;
  const blur = options.blurPx ?? SCOPE_FROST_BLUR_PX;
  const veil = options.veil ?? SCOPE_FROST_VEIL;

  // 上一帧的内容必须清掉：否则框内会残留上一次的模糊像素。
  ctx.clearRect(0, 0, width, height);
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, width, height);
  ring.forEach((point, index) => {
    if (index === 0) ctx.moveTo(point.x, point.y);
    else ctx.lineTo(point.x, point.y);
  });
  ctx.closePath();
  ctx.clip('evenodd');
  if ('filter' in ctx) {
    // 取样源是框内框外同一张图：糊的只是「画到框外的这一份」，框内那份没被碰过。
    ctx.filter = `blur(${blur}px)`;
    ctx.drawImage(source, 0, 0, width, height);
    ctx.filter = 'none';
  }
  // 白纱只负责提亮：0.2 与 3D 贴地白纱同档，再高框外就真白了，路网全丢对不上位置。
  ctx.fillStyle = veil;
  ctx.fillRect(0, 0, width, height);
  ctx.restore();
  return true;
}
