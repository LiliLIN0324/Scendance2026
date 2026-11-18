/**
 * 沿流线走（纯函数，零 three 依赖）。
 *
 * 漫游里选一条流线后，HUD 要回答三件事：我离这条线多远、下一个拐点在哪、
 * 还剩多少米 / 多少秒。这里只做几何，不碰相机也不读写 planning 数据。
 *
 * 坐标：three 世界系（x 东、z = −北，米），与 `use-outdoor-walk` 的玩家锚点同源。
 */

export interface RoutePoint {
  x: number;
  z: number;
}

export interface RouteProjection {
  /** 从起点沿折线走了多少米（投影点）。 */
  alongM: number;
  /** 到折线的横向偏离（米）。 */
  offRouteM: number;
  /** 投在哪一段（0 起）。 */
  segmentIndex: number;
}

export interface RouteGuidance extends RouteProjection {
  totalM: number;
  remainingM: number;
  /** 0–1，按沿线距离算。 */
  progress: number;
  /** 下一个拐点（当前段的终点）。 */
  nextX: number;
  nextZ: number;
  /** 到下一个拐点的直线距离（米）。 */
  toNextM: number;
  /** 按当前速度到终点还要多少秒；速度为 0 或缺失时为 null。 */
  etaSeconds: number | null;
}

/** 折线总长（米）。 */
export function polylineLength(points: readonly RoutePoint[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += Math.hypot(points[i]!.x - points[i - 1]!.x, points[i]!.z - points[i - 1]!.z);
  }
  return total;
}

/** 点投影到折线：取最近的一段；折线不足两点时返回 null。 */
export function projectOnPolyline(points: readonly RoutePoint[], point: RoutePoint): RouteProjection | null {
  if (points.length < 2) return null;
  let bestDistance = Infinity;
  let best: RouteProjection | null = null;
  let along = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const lengthSq = dx * dx + dz * dz;
    const length = Math.sqrt(lengthSq);
    if (length < 1e-9) continue;
    const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.z - a.z) * dz) / lengthSq));
    const px = a.x + dx * t;
    const pz = a.z + dz * t;
    const distance = Math.hypot(point.x - px, point.z - pz);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = { alongM: along + length * t, offRouteM: distance, segmentIndex: i - 1 };
    }
    along += length;
  }
  return best;
}

/** 沿流线走的导航信息；流线不足两点时返回 null。 */
export function guidanceAlongRoute(
  points: readonly RoutePoint[],
  point: RoutePoint,
  speedMps: number
): RouteGuidance | null {
  const projection = projectOnPolyline(points, point);
  if (!projection) return null;
  const totalM = polylineLength(points);
  const remainingM = Math.max(0, totalM - projection.alongM);
  const next = points[projection.segmentIndex + 1] ?? points[points.length - 1]!;
  return {
    ...projection,
    totalM,
    remainingM,
    progress: totalM > 0 ? Math.min(1, projection.alongM / totalM) : 0,
    nextX: next.x,
    nextZ: next.z,
    toNextM: Math.hypot(next.x - point.x, next.z - point.z),
    etaSeconds: speedMps > 0 ? remainingM / speedMps : null,
  };
}

/**
 * 覆盖率：玩家走过的采样点里，沿线最远到过多少（0–1）。
 *
 * 只取最远点而不是"走过哪些段"，因为沿流线走基本是单调前进；折返场景下
 * 这个值会偏乐观，HUD 只当进度条用，不当验收数据。
 */
export function routeCoverage(points: readonly RoutePoint[], visited: readonly RoutePoint[]): number {
  if (points.length < 2 || visited.length === 0) return 0;
  const total = polylineLength(points);
  if (total <= 0) return 0;
  let best = 0;
  for (const point of visited) {
    const projection = projectOnPolyline(points, point);
    if (projection && projection.alongM > best) best = projection.alongM;
  }
  return Math.min(1, best / total);
}

/** HUD 用的一句话。 */
export function describeRouteGuidance(guidance: RouteGuidance): string {
  const next = `下一个拐点 ${guidance.toNextM.toFixed(1)} m`;
  const eta = guidance.etaSeconds === null ? '' : ` · 约 ${Math.ceil(guidance.etaSeconds)} s`;
  const off = guidance.offRouteM > 1.5 ? ` · 偏离 ${guidance.offRouteM.toFixed(1)} m` : '';
  return `流线 ${Math.round(guidance.progress * 100)}% · 剩 ${guidance.remainingM.toFixed(1)} m${eta} · ${next}${off}`;
}
