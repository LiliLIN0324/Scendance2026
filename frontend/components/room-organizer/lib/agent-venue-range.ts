import type { SitePlanData } from '../../../../supabase/functions/_shared/site-plan';
import type { OutdoorTurn } from './outdoor-agent-contract';
import { createOutdoorMapContext } from './outdoor-map-context';
import { checkBoundaryRing } from './site-plan-editing';
import { planRingAreaM2 } from '../../../../supabase/functions/_shared/site-plan';

/**
 * 旧版本把「范围依据」当成一条画布 note 贴在地图正中（2026-11-19 的实现）。
 * 2026-11-20 用户拍板：用户不关心边界是从哪一步推出来的，这类口径只留在内部数据里，
 * 既不新建、也不再把历史方案里的那条画出来。
 */
export const AGENT_RANGE_BASIS_NOTE = 'Agent 场地范围依据';

export interface VenueRangeBasis {
  kind: 'mapped-grass' | 'place-outline' | 'concept' | 'user-dimensions';
  detail: string;
  location?: 'mapped' | 'assumed';
  scale?: 'mapped' | 'assumed' | 'user-provided';
}
export interface VenueRangeProposal {
  boundary: SitePlanData['boundary'];
  basis: VenueRangeBasis;
  /** P0-A：候选层的水体核对结论（压水 / 数据未取全待核），随草案回给范围确认卡。空数组 = 取全且不压水。 */
  waterLines: string[];
}
const rectangle = (width: number, depth: number): SitePlanData['boundary'] => rectangleAt(0, 0, width, depth);
const rectangleAt = (cx: number, cy: number, width: number, depth: number): SitePlanData['boundary'] => [
  { x: cx - width / 2, y: cy - depth / 2 }, { x: cx + width / 2, y: cy - depth / 2 },
  { x: cx + width / 2, y: cy + depth / 2 }, { x: cx - width / 2, y: cy + depth / 2 },
];

type PlanPointLike = { x: number; y: number };
/** `map.water()` 的形状（ENU 米，与 plan 同基准）。closed=true 是水面多边形，false 是水道折线。 */
export interface WaterRing {
  id: string;
  name: string;
  points: PlanPointLike[];
  closed: boolean;
}

/** 寻找无水子区时的网格步长与最小边长；步长小一点漏判少，代价是格子数。 */
const WATER_STEP_M = 5;
const WATER_MIN_SIDE_M = 10;
/** 网格上限：超了就宁可不猜，也不拿一张 5 米格网把浏览器卡住。 */
const WATER_MAX_CELLS = 40000;

function planBounds(points: readonly PlanPointLike[]): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  for (const point of points) {
    minX = Math.min(minX, point.x); maxX = Math.max(maxX, point.x);
    minY = Math.min(minY, point.y); maxY = Math.max(maxY, point.y);
  }
  return { minX, minY, maxX, maxY };
}

function orientation(a: PlanPointLike, b: PlanPointLike, c: PlanPointLike): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

/** 两段相交（含端点接触）。共边也算相交——范围贴在水岸线上不当作“可落地”。 */
function segmentsCross(a: PlanPointLike, b: PlanPointLike, c: PlanPointLike, d: PlanPointLike): boolean {
  const eps = 1e-9;
  const o1 = orientation(a, b, c); const o2 = orientation(a, b, d);
  const o3 = orientation(c, d, a); const o4 = orientation(c, d, b);
  if (((o1 > eps && o2 < -eps) || (o1 < -eps && o2 > eps)) && ((o3 > eps && o4 < -eps) || (o3 < -eps && o4 > eps))) return true;
  const onSegment = (p: PlanPointLike, q: PlanPointLike, r: PlanPointLike): boolean =>
    Math.abs(orientation(p, q, r)) <= eps
    && r.x >= Math.min(p.x, q.x) - eps && r.x <= Math.max(p.x, q.x) + eps
    && r.y >= Math.min(p.y, q.y) - eps && r.y <= Math.max(p.y, q.y) + eps;
  return onSegment(a, b, c) || onSegment(a, b, d) || onSegment(c, d, a) || onSegment(c, d, b);
}

/**
 * 活动范围是否碰到水面：顶点落入、环顶点落入水面、或任一边与水边相交都算。
 * 2026-11-22 测试记录（锁定区域）：水上森林整块轮廓含河道，默认范围把水包了进去。
 */
export function ringTouchesWater(ring: readonly PlanPointLike[], waters: readonly WaterRing[]): boolean {
  if (ring.length < 3 || waters.length === 0) return false;
  const box = planBounds(ring);
  for (const water of waters) {
    const points = water.points;
    if (points.length < 2) continue;
    const waterBox = planBounds(points);
    if (waterBox.maxX < box.minX || waterBox.minX > box.maxX || waterBox.maxY < box.minY || waterBox.minY > box.maxY) continue;
    // 水面顶点落进范围，或范围顶点落进水面（后者只对闭合水面成立）。
    if (points.some((point) => pointInside(point, ring as SitePlanData['boundary']))) return true;
    if (water.closed && ring.some((point) => pointInside(point, points))) return true;
    const waterEdges = water.closed ? points.length : points.length - 1;
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i]; const b = ring[(i + 1) % ring.length];
      for (let j = 0; j < waterEdges; j++) {
        if (segmentsCross(a, b, points[j], points[(j + 1) % points.length])) return true;
      }
    }
  }
  return false;
}

/** 直方图法求全 true 子矩形（O(cols×rows)）。 */
function largestFreeRect(free: readonly boolean[][], cols: number, rows: number):
  { c0: number; r0: number; c1: number; r1: number } | null {
  const heights = new Array<number>(cols + 1).fill(0);
  let best: { area: number; c0: number; r0: number; c1: number; r1: number } = { area: 0, c0: 0, r0: 0, c1: -1, r1: -1 };
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) heights[c] = free[r][c] ? heights[c] + 1 : 0;
    heights[cols] = 0;
    const stack: number[] = [];
    for (let c = 0; c <= cols; c++) {
      while (stack.length && heights[stack[stack.length - 1]] >= heights[c]) {
        const top = stack.pop()!;
        const left = stack.length ? stack[stack.length - 1] + 1 : 0;
        const h = heights[top];
        const area = h * (c - left);
        if (h > 0 && area > best.area) best = { area, c0: left, r0: r - h + 1, c1: c - 1, r1: r };
      }
      stack.push(c);
    }
  }
  return best.area > 0 ? { c0: best.c0, r0: best.r0, c1: best.c1, r1: best.r1 } : null;
}

/**
 * 在外轮廓内找最大的无水轴对齐子矩形（水体掩膜的收缩版：不做多边形差集，只保证结果不压水）。
 * 找不到够大的（≥ 10 米边）就回 null，由调用方退回原轮廓——宁可说“没识别出可用区块”，
 * 也不裁出一个 3 米宽的假范围。
 */
export function largestWaterFreeRect(
  ring: readonly PlanPointLike[],
  waters: readonly WaterRing[],
  stepM = WATER_STEP_M,
  minSideM = WATER_MIN_SIDE_M,
): SitePlanData['boundary'] | null {
  if (ring.length < 3 || waters.length === 0) return null;
  const box = planBounds(ring);
  const cols = Math.max(1, Math.ceil((box.maxX - box.minX) / stepM));
  const rows = Math.max(1, Math.ceil((box.maxY - box.minY) / stepM));
  if (cols * rows > WATER_MAX_CELLS) return null;
  const free: boolean[][] = [];
  for (let r = 0; r < rows; r++) {
    const row: boolean[] = [];
    for (let c = 0; c < cols; c++) {
      const x0 = box.minX + c * stepM; const x1 = Math.min(box.maxX, x0 + stepM);
      const y0 = box.minY + r * stepM; const y1 = Math.min(box.maxY, y0 + stepM);
      const cell = [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
      row.push(pointInside({ x: (x0 + x1) / 2, y: (y0 + y1) / 2 }, ring as SitePlanData['boundary'])
        && !ringTouchesWater(cell, waters));
    }
    free.push(row);
  }
  const best = largestFreeRect(free, cols, rows);
  if (!best) return null;
  const x0 = box.minX + best.c0 * stepM; const x1 = box.minX + (best.c1 + 1) * stepM;
  const y0 = box.minY + best.r0 * stepM; const y1 = box.minY + (best.r1 + 1) * stepM;
  if (Math.min(x1 - x0, y1 - y0) < minSideM) return null;
  return [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
}

/**
 * P0-A（2026-11-25 幕景Agent Test「锁定区域」）：水体核对的三层口径——候选范围、确认后的红线、分区。
 * 掩膜取全时指名压到水的层；没取全（地图依据缺失或不完整）就补一句待核（状态回执），
 * 不把「不知道」说成「没事」。返回空数组 = 掩膜取全且都不压水，不需要说话。
 *
 * `complete` 必须如实传：地图依据就绪但附近本来就没有水，不等于缺数据——
 * 只有 load 取全（map.status === 'ready'）才允许下「不压水」的结论。
 */
export function waterCheckLines(
  boundary: readonly PlanPointLike[],
  zones: ReadonlyArray<{ name: string; ring: readonly PlanPointLike[] }>,
  waters: readonly WaterRing[],
  complete: boolean,
  boundaryLabel = '活动红线',
): string[] {
  const lines: string[] = [];
  if (ringTouchesWater(boundary, waters)) lines.push(`${boundaryLabel}压到水面。`);
  const pressing = zones.filter(zone => ringTouchesWater(zone.ring, waters)).map(zone => zone.name);
  if (pressing.length) lines.push(`压到水面的分区：${pressing.join('、')}。`);
  if (!complete) lines.push(`水体数据未取得或不完整：活动范围${zones.length ? '与分区' : ''}是否压水待核。`);
  return lines;
}

/** The probe rectangle only bounds evidence retrieval; it is never presented as a mapped lawn. */
export async function proposeAutomaticVenueRange(input: {
  plan: SitePlanData; anchor: NonNullable<SitePlanData['anchor']>; name: string;
  footprint: SitePlanData['boundary'] | null; signal: AbortSignal;
}): Promise<VenueRangeProposal> {
  const adapter = createOutdoorMapContext();
  const probe: SitePlanData = { ...input.plan, anchor: input.anchor, boundary: rectangle(500, 500),
    zones: [], facilities: [], routes: [], nodes: [], workers: [], vehicles: [], annotations: [], measurements: [], walls: [], designScope: rectangle(500, 500) };
  /** 水体几何与证据同一次 load 取回：不额外发请求，也不拿底图像素去猜水在哪。 */
  let waters: WaterRing[] = [];
  let complete = false;
  const proposal = (boundary: SitePlanData['boundary'], basis: VenueRangeBasis): VenueRangeProposal => ({
    boundary, basis, waterLines: waterCheckLines(boundary, [], waters, complete, '候选范围'),
  });
  try {
    const map = await adapter.load(`venue-probe:${input.name}`, probe, [], false, input.signal);
    input.signal.throwIfAborted();
    waters = ((map as { water?: () => WaterRing[] }).water?.() ?? []);
    complete = map.status === 'ready';
    const grass = (map.openAreas?.() ?? []).filter(area => area.tags.landuse === 'grass'
      && !['private', 'no'].includes(area.tags.access ?? '') && area.ring.length <= 200 && checkBoundaryRing(area.ring).ok)
      .filter(area => planRingAreaM2(area.ring) >= 100 && planRingAreaM2(area.ring) <= 30000)
      .filter(area => !input.footprint || area.ring.every(point => pointInside(point, input.footprint!)))
      // A：压到水面的草地候选不当作可用场地，换下一个；没剩的就走兜底。
      .filter(area => !ringTouchesWater(area.ring, waters))
      .sort((a, b) => centerDistance(a.ring) - centerDistance(b.ring));
    if (grass[0]) return proposal(grass[0].ring, { kind: 'mapped-grass', location: 'mapped', scale: 'mapped', detail: `地图草地候选：${grass[0].name || input.name}（${grass[0].id}）；地图标记不代表已获活动使用许可。` });
  } catch { input.signal.throwIfAborted(); }
  if (input.footprint && checkBoundaryRing(input.footprint).ok) {
    // B：地点轮廓本身就把湖/河包在里面（水上森林、沿河公园都是这种），收缩到轮廓内最大无水区块。
    const cleared = waters.length ? largestWaterFreeRect(input.footprint, waters) : null;
    return proposal(cleared ?? input.footprint, { kind: 'place-outline', location: 'mapped', scale: 'mapped',
        detail: cleared
          ? '仅取得地点整体轮廓（含水面），已收缩到轮廓内最大的无水区块；这是范围候选，可用聊天缩小，不能当作实测活动用地。'
          : '仅取得地点整体轮廓，尚未识别具体可用草坪；这是范围候选，可用聊天缩小，不能当作实测活动用地。' });
  }
  const concept = rectangle(40, 30);
  const nearby = waters.length && ringTouchesWater(concept, waters)
    ? largestWaterFreeRect(rectangle(120, 120), waters)
    : null;
  if (nearby) {
    const width = Math.min(40, nearby[1].x - nearby[0].x);
    const depth = Math.min(30, nearby[2].y - nearby[0].y);
    const centerX = (nearby[0].x + nearby[1].x) / 2;
    const centerY = (nearby[0].y + nearby[2].y) / 2;
    return proposal(rectangleAt(centerX, centerY, width, depth), { kind: 'concept', location: 'assumed', scale: 'assumed',
        detail: '未取得真实用地边界，且锤点附近压到水面，已改在最近的无水区块按 40×30 内建概念草案；尺寸与位置均为待核对假设，可直接说长宽或上传带尺寸图纸调整。' });
  }
  return proposal(concept, { kind: 'concept', location: 'assumed', scale: 'assumed',
    detail: '未取得真实用地边界，先按 40×30 米建立概念草案；地点定位已保留，尺寸和草坪实际位置均为待核对假设。可直接说长宽或上传带尺寸图纸调整。' });
}

function centerDistance(ring: SitePlanData['boundary']): number {
  return Math.hypot(ring.reduce((sum, p) => sum + p.x, 0) / ring.length, ring.reduce((sum, p) => sum + p.y, 0) / ring.length);
}
function pointInside(p: { x: number; y: number }, ring: SitePlanData['boundary']): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Pure geometry edits; missing metres and directions are never supplied by this function. */
export function reviseVenueRange(ring: SitePlanData['boundary'], request: NonNullable<OutdoorTurn['facts']['scope']>): SitePlanData['boundary'] {
  let next = ring.map(point => ({ ...point }));
  if (request.portion) {
    const axis = request.portion === 'east' || request.portion === 'west' ? 'x' : 'y';
    const values = next.map(point => point[axis]);
    const cut = (Math.min(...values) + Math.max(...values)) / 2;
    const direction = request.portion === 'east' || request.portion === 'north' ? 1 : -1;
    const clipped: typeof next = [];
    for (let i = 0; i < next.length; i++) {
      const a = next[i], b = next[(i + 1) % next.length];
      const aIn = direction * (a[axis] - cut) >= 0, bIn = direction * (b[axis] - cut) >= 0;
      if (aIn) clipped.push(a);
      if (aIn !== bIn) {
        const t = (cut - a[axis]) / (b[axis] - a[axis]);
        clipped.push({ x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) });
      }
    }
    next = clipped.filter((p, i) => i === 0 || Math.hypot(p.x - clipped[i - 1].x, p.y - clipped[i - 1].y) > 0.001);
    if (next.length > 1 && Math.hypot(next[0].x - next.at(-1)!.x, next[0].y - next.at(-1)!.y) < 0.001) next.pop();
  }
  if (!checkBoundaryRing(next).ok) throw new Error('这块范围无法按该方向截取成一个有效区域；请用聊天说明要保留哪一片。');
  const xs = next.map(p => p.x), ys = next.map(p => p.y);
  const width = Math.max(...xs) - Math.min(...xs), depth = Math.max(...ys) - Math.min(...ys);
  const cx = (Math.max(...xs) + Math.min(...xs)) / 2, cy = (Math.max(...ys) + Math.min(...ys)) / 2;
  const sx = (request.widthM ?? width) / width, sy = (request.depthM ?? depth) / depth;
  const radians = (request.rotationDeg ?? 0) * Math.PI / 180;
  next = next.map(p => {
    const x = (p.x - cx) * sx, y = (p.y - cy) * sy;
    return { x: Math.round((cx + x * Math.cos(radians) - y * Math.sin(radians) + (request.shiftEastM ?? 0)) * 100) / 100,
      y: Math.round((cy + x * Math.sin(radians) + y * Math.cos(radians) + (request.shiftNorthM ?? 0)) * 100) / 100 };
  });
  if (!checkBoundaryRing(next).ok) throw new Error('调整后的范围不合法，原方案保留，请重新说明尺寸。');
  return next;
}
