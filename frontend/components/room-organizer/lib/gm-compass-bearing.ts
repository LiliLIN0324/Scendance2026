/** 罗盘一步：左右弯箭头各转 90°。与 3D `orbitByDelta(±π/2)` 同口径。 */
export const COMPASS_STEP = Math.PI / 2;

/** 外部方位采样间隔。拖动合帧走 rAF，不走这个间隔。 */
export const BEARING_SAMPLE_MS = 90;

/** 小于此弧度的方位抖动不发布到 React / DOM。约 0.23°。 */
export const BEARING_PUBLISH_EPSILON = 0.004;

/** 把方位角收进 (-π, π]。 */
export function normalizeBearing(rad: number): number {
  if (!Number.isFinite(rad)) return 0;
  const tau = Math.PI * 2;
  let value = rad % tau;
  if (value > Math.PI) value -= tau;
  if (value <= -Math.PI) value += tau;
  return value;
}

/**
 * `orbitByDelta(+δ)` 之后的方位角。
 * 与 3D 相同：正增量让 `getBearing` 减小，屏幕上的北顺时针转。
 */
export function bearingAfterOrbit(bearing: number, deltaTheta: number): number {
  if (!deltaTheta || !Number.isFinite(deltaTheta)) return normalizeBearing(bearing);
  return normalizeBearing(bearing - deltaTheta);
}

/**
 * 步行相机水平朝向，与 `getBearing` / `bearingAfterOrbit` 同号。
 * look 是世界前向（three：北 = -Z）。正对北方时返回 0。
 */
export function bearingFromLook(lookX: number, lookZ: number): number {
  if (!Number.isFinite(lookX) || !Number.isFinite(lookZ)) return 0;
  if (lookX * lookX + lookZ * lookZ < 1e-12) return 0;
  return normalizeBearing(Math.atan2(lookX, -lookZ));
}

/** 屏幕上玫瑰图的 CSS 转角（度，顺时针为正）= -bearing。 */
export function roseRotationDeg(bearingRad: number): number {
  return (-normalizeBearing(bearingRad) * 180) / Math.PI;
}

/** 两个方位的最短夹角，范围 [0, π]。跨 ±π 的同一朝向视为 0。 */
export function bearingSeparation(a: number, b: number): number {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return Number.POSITIVE_INFINITY;
  const delta = Math.abs(normalizeBearing(a) - normalizeBearing(b));
  return Math.min(delta, Math.PI * 2 - delta);
}

/** 相对上次已发布的方位，是否值得再画一帧罗盘。 */
export function shouldPublishBearing(
  previous: number,
  next: number,
  epsilon = BEARING_PUBLISH_EPSILON,
): boolean {
  if (!Number.isFinite(next)) return false;
  return bearingSeparation(previous, next) > epsilon;
}

/** `now` 距离上次采样是否已到间隔。 */
export function shouldSampleBearing(now: number, lastSampleAt: number, intervalMs = BEARING_SAMPLE_MS): boolean {
  return now - lastSampleAt >= intervalMs;
}

/**
 * 同一时刻的多次回调合成一帧。已有帧 id 时直接返回，不再排第二帧。
 * 调用方在帧回调里先把 id 清零，再执行 `callback`。
 */
export function coalesceAnimationFrame(
  pendingFrame: number,
  request: (callback: () => void) => number,
  callback: () => void,
): number {
  if (pendingFrame) return pendingFrame;
  return request(callback);
}

/**
 * 屏幕位移 → 北朝上画布位移。
 * 绘制时用了 `rotate(-bearing)`，手指拖动要先旋回北朝上，再交给原来的平移公式。
 * bearing 为 0 时原样返回。
 */
export function uprightDelta(dx: number, dy: number, bearing: number): { x: number; y: number } {
  if (!bearing) return { x: dx, y: dy };
  const cos = Math.cos(bearing);
  const sin = Math.sin(bearing);
  return {
    x: dx * cos - dy * sin,
    y: dx * sin + dy * cos,
  };
}

/** 绕视图中心旋转后，轴对齐瓦片框要向外扩多少 CSS 像素，四角才不会空。 */
export function tileOverflowPad(width: number, height: number, bearing: number): number {
  if (!bearing || !width || !height) return 0;
  const cos = Math.abs(Math.cos(bearing));
  const sin = Math.abs(Math.sin(bearing));
  const halfW = (width / 2) * cos + (height / 2) * sin;
  const halfH = (width / 2) * sin + (height / 2) * cos;
  return Math.ceil(Math.max(halfW - width / 2, halfH - height / 2, 0));
}

/** 绘制前把北朝上的画面绕视图中心转到当前方位。bearing 为 0 时不动。 */
export function applyBearingTransform(
  ctx: { translate(x: number, y: number): void; rotate(rad: number): void },
  width: number,
  height: number,
  bearing: number,
): void {
  if (!bearing) return;
  ctx.translate(width / 2, height / 2);
  ctx.rotate(-bearing);
  ctx.translate(-width / 2, -height / 2);
}

/**
 * 地图转了之后，文字仍朝屏幕上方。
 * 方位角为 0 时恢复上下文原来的 fillText/strokeText，北朝上的绘制与未接罗盘时相同。
 */
export function installUprightText(ctx: CanvasRenderingContext2D, bearingOf: () => number): void {
  const tagged = ctx as CanvasRenderingContext2D & {
    __gmFill?: CanvasRenderingContext2D['fillText'];
    __gmStroke?: CanvasRenderingContext2D['strokeText'];
    __gmOn?: boolean;
  };
  const bearing = bearingOf();
  if (!bearing) {
    if (tagged.__gmOn && tagged.__gmFill && tagged.__gmStroke) {
      ctx.fillText = tagged.__gmFill;
      ctx.strokeText = tagged.__gmStroke;
      tagged.__gmOn = false;
    }
    return;
  }
  if (!tagged.__gmFill || !tagged.__gmStroke) {
    tagged.__gmFill = ctx.fillText.bind(ctx);
    tagged.__gmStroke = ctx.strokeText.bind(ctx);
  }
  if (tagged.__gmOn) return;
  const fill = tagged.__gmFill;
  const stroke = tagged.__gmStroke;
  const call = (raw: (text: string, x: number, y: number, maxWidth?: number) => void, text: string, x: number, y: number, maxWidth?: number) => {
    if (typeof maxWidth === 'number') raw(text, x, y, maxWidth);
    else raw(text, x, y);
  };
  const wrap = (raw: (text: string, x: number, y: number, maxWidth?: number) => void) =>
    (text: string, x: number, y: number, maxWidth?: number): void => {
      const live = bearingOf();
      if (!live) {
        call(raw, String(text), x, y, maxWidth);
        return;
      }
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(live);
      call(raw, String(text), 0, 0, maxWidth);
      ctx.restore();
    };
  ctx.fillText = wrap(fill);
  ctx.strokeText = wrap(stroke);
  tagged.__gmOn = true;
}
