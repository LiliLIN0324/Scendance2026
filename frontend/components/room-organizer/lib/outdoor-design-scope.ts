/**
 * 设计范围（「大陆」）：比场地壳更大的一圈外框，框内才是设计区。
 *
 * 现实场景决定了它必须存在：IN77 这类场地，舞台、签到、摊位都在场地壳里，
 * 但人流从地铁口、路口一路进来——那段流线在场地外面，却仍然属于这次设计。
 * 谷地工坊的做法是先画一块大的「大陆」，再在里面细分；外面压暗当背景。
 *
 * 2026-11-15 用户拍板：这个框**只做矩形**，不要多段线。
 * 它本质是取景参照（对齐图纸、好读数），不规则多边形反而难用，
 * 所以这里只保留「矩形」这一种几何，别再长出别的形状。
 *
 * 这个模块只做纯几何，不碰 canvas、不碰 schema：
 * - 由场地边界外接矩形外扩一圈，得到快速可用的框；
 * - 面积、命中测试、路径串，供画布与提示条共用同一套真值。
 */

export interface ScopePoint {
  x: number;
  y: number;
}

/** 外扩一步的默认值（米）：够放一条入口动线，又不至于把整条街框进来。 */
export const DEFAULT_SCOPE_MARGIN_M = 20;

/** 外扩上限：再大就退化成「整个地图」，蒙版失去意义。 */
export const MAX_SCOPE_MARGIN_M = 120;

/** 设计范围最短边（米）：小于这个值当作拖框时的手抖，不落数据。 */
export const MIN_SCOPE_SIDE_M = 2;

/**
 * 由场地边界得到矩形设计范围。
 *
 * 取边界的轴对齐外接矩形，四条边各外扩 margin；
 * 不做逐边外法线斜接——那会跟着多边形长出不规则形状，与「只做矩形」的约定冲突。
 */
export function expandRect(boundary: readonly ScopePoint[], marginM: number): ScopePoint[] {
  if (boundary.length < 3) return [];
  const margin = Math.max(0, Math.min(MAX_SCOPE_MARGIN_M, marginM));
  const xs = boundary.map((point) => point.x);
  const ys = boundary.map((point) => point.y);
  return rectRing(
    { x: Math.min(...xs) - margin, y: Math.min(...ys) - margin },
    { x: Math.max(...xs) + margin, y: Math.max(...ys) + margin },
  );
}

/** 两个对角点 → 矩形四角（左上 → 右上 → 右下 → 左下，顺时针）。 */
export function rectRing(a: ScopePoint, b: ScopePoint): ScopePoint[] {
  const x0 = Math.min(a.x, b.x);
  const x1 = Math.max(a.x, b.x);
  const y0 = Math.min(a.y, b.y);
  const y1 = Math.max(a.y, b.y);
  return [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
}

/**
 * 2026-11-17 用户拍板「红线跟着白框走」的同步规则：
 * - 红线改动后**仍完整落在白框内** → 白框不动（在框里拖不用管）；
 * - 红线任一边**顶出白框** → 白框重置为「新红线外扩 margin」（框永远兜得住红线）；
 * - 本来就没有白框 → 顺手生成一个。
 *
 * 返回 null = 白框无需改动；返回环 = 调用方把它写进 plan.designScope。
 * 只看外接矩形够用：白框恒为矩形（2026-11-15 拍板），红线再怎么绕外接矩形超了就是超了。
 */
export function syncScopeForBoundary(
  currentScope: readonly ScopePoint[] | undefined,
  boundary: readonly ScopePoint[],
  marginM: number,
): ScopePoint[] | null {
  if (boundary.length < 3) return null;
  const scope = currentScope ?? [];
  if (scope.length < 3) return expandRect(boundary, marginM);
  const bx = boundary.map((point) => point.x);
  const by = boundary.map((point) => point.y);
  const sx = scope.map((point) => point.x);
  const sy = scope.map((point) => point.y);
  const sticksOut = Math.max(...bx) > Math.max(...sx)
    || Math.min(...bx) < Math.min(...sx)
    || Math.max(...by) > Math.max(...sy)
    || Math.min(...by) < Math.min(...sy);
  return sticksOut ? expandRect(boundary, marginM) : null;
}

/** 拖框够不够大：两边都不小于 minSideM 才认（挡掉手抖单击与细条）。 */
export function rectBigEnough(ring: readonly ScopePoint[], minSideM = MIN_SCOPE_SIDE_M): boolean {
  if (ring.length !== 4) return false;
  const xs = ring.map((point) => point.x);
  const ys = ring.map((point) => point.y);
  return Math.max(...xs) - Math.min(...xs) >= minSideM
    && Math.max(...ys) - Math.min(...ys) >= minSideM;
}

/**
 * 设计范围的边（ENU 口径：x 东、y 北）。
 *
 * 2026-11-15 用户指令「几个侧边，点的时候也可以按照对应的方向拖动」：
 * 拖边只改一个方向——北/南只动 y，东/西只动 x，矩形永远保持轴对齐。
 */
export type ScopeEdge = 'north' | 'south' | 'east' | 'west';

/** 边 → 中文短名（拖动提示与提交回执用同一套说法）。 */
export function scopeEdgeLabel(edge: ScopeEdge): string {
  return edge === 'north' ? '北' : edge === 'south' ? '南' : edge === 'east' ? '东' : '西';
}

/** 这条边是横向还是竖向（决定悬停光标是 ↕ 还是 ↔）。 */
export function scopeEdgeIsHorizontal(edge: ScopeEdge): boolean {
  return edge === 'north' || edge === 'south';
}

/**
 * 拖一条边改尺寸：只移动这条边，对边钉住，另外两个方向的坐标原样保留。
 *
 * - coordinate 是这条边落到的新位置（北/南看 y，东/西看 x），调用方自己负责吸附网格；
 * - 不跟着指针走成「矩形外接」：那样一往回拖，松手时对边会跳——这里对边一定不动；
 * - 撞到对边就夹住（留最短边 MIN_SCOPE_SIDE_M），不会拖成反矩形。
 *
 * 不是 4 点的旧数据（多段线）返回 null：只认矩形，和 rectBigEnough 同口径。
 */
export function resizeScopeEdge(
  ring: readonly ScopePoint[],
  edge: ScopeEdge,
  coordinate: number,
  minSideM = MIN_SCOPE_SIDE_M,
): ScopePoint[] | null {
  if (ring.length !== 4) return null;
  const xs = ring.map((point) => point.x);
  const ys = ring.map((point) => point.y);
  let x0 = Math.min(...xs);
  let x1 = Math.max(...xs);
  let y0 = Math.min(...ys);
  let y1 = Math.max(...ys);
  if (edge === 'north') y1 = Math.max(coordinate, y0 + minSideM);
  else if (edge === 'south') y0 = Math.min(coordinate, y1 - minSideM);
  else if (edge === 'east') x1 = Math.max(coordinate, x0 + minSideM);
  else x0 = Math.min(coordinate, x1 - minSideM);
  return rectRing({ x: x0, y: y0 }, { x: x1, y: y1 });
}

/**
 * 辺的命中（像素口径，纯函数）：
 * - 离角点（默认 12 px）先让给角：角是双向缩放，边是单向，两套不能抢；
 * - 再找 8 px 带内最近的边，返回它；都不在带内就不接管（让画布继续平移/选物件）。
 *
 * 传入的是已经投影好的四个像素角，所以这里不需要知道视口/瓦片。
 */
export function nearestScopeEdgePx(
  cornersPx: readonly ScopePoint[],
  px: ScopePoint,
  opts: { tolerancePx?: number; cornerRadiusPx?: number } = {},
): ScopeEdge | null {
  if (cornersPx.length !== 4) return null;
  const tolerance = opts.tolerancePx ?? 8;
  const cornerRadius = opts.cornerRadiusPx ?? 12;
  if (cornersPx.some(corner => Math.hypot(corner.x - px.x, corner.y - px.y) <= cornerRadius)) return null;
  const xs = cornersPx.map(corner => corner.x);
  const ys = cornersPx.map(corner => corner.y);
  const left = Math.min(...xs);
  const right = Math.max(...xs);
  const top = Math.min(...ys);
  const bottom = Math.max(...ys);
  const withinX = px.x >= left - tolerance && px.x <= right + tolerance;
  const withinY = px.y >= top - tolerance && px.y <= bottom + tolerance;
  const candidates: Array<{ edge: ScopeEdge; dist: number }> = [];
  if (withinX && Math.abs(px.y - top) <= tolerance) candidates.push({ edge: 'north', dist: Math.abs(px.y - top) });
  if (withinX && Math.abs(px.y - bottom) <= tolerance) candidates.push({ edge: 'south', dist: Math.abs(px.y - bottom) });
  if (withinY && Math.abs(px.x - left) <= tolerance) candidates.push({ edge: 'west', dist: Math.abs(px.x - left) });
  if (withinY && Math.abs(px.x - right) <= tolerance) candidates.push({ edge: 'east', dist: Math.abs(px.x - right) });
  candidates.sort((a, b) => a.dist - b.dist);
  return candidates[0]?.edge ?? null;
}

/** 环面积（鞋带公式，取绝对值；顶点顺时针/逆时针都能算）。 */
export function scopeAreaM2(ring: readonly ScopePoint[]): number {
  if (ring.length < 3) return 0;
  let sum = 0;
  for (let i = 0; i < ring.length; i += 1) {
    const a = ring[i]!;
    const b = ring[(i + 1) % ring.length]!;
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

/** 点是否在环内（射线法）。用于判断某个物料/流线点是否落在设计区里。 */
export function scopeContainsPoint(ring: readonly ScopePoint[], point: ScopePoint): boolean {
  if (ring.length < 3) return false;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const a = ring[i]!;
    const b = ring[j]!;
    const intersects = (a.y > point.y) !== (b.y > point.y)
      && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x;
    if (intersects) inside = !inside;
  }
  return inside;
}

/**
 * 环 → SVG/Path2D 路径串。
 * 蒙版就是「整块视口减去这个环」，所以调用方拿到同一份串可以做两件事：
 * 描边（设计范围线）和当 evenodd 的洞（框外压暗）。
 */
export function ringToPath(ring: readonly ScopePoint[]): string {
  if (ring.length === 0) return '';
  const [first, ...rest] = ring;
  const head = `M ${round(first!.x)} ${round(first!.y)}`;
  const tail = rest.map((point) => `L ${round(point.x)} ${round(point.y)}`).join(' ');
  return `${head}${tail ? ` ${tail}` : ''} Z`;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
