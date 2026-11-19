/**
 * docs/47 B1 可布置域计算（2026-11-20）：边界多边形 − 建筑足迹 − 车行/后勤走廊缓冲 −
 * hard 块（水域/围栏）→ 可布置域（网格基底 + 轴对齐矩形集合）与指标（可用面积 / 最大内接矩形）。
 *
 * 依赖择优（docs/47 §七 要求卡内先做对比记录，落码前定案）：
 * - turf / @turf/difference：geojson 语义 + 依赖树大（前端静态导出全量进包），docs/44「不引依赖」原则，弃。
 * - polyclip-ts（零依赖 Martinez）：npm 实测可达（0.16.8，解包 462 KB），但 Martinez 系布尔
 *   运算在共点/共边退化输入上脆弱——本仓输入恰是这种：OSM 水域多边形贴场地边界、建筑角点
 *   与边界共边（site-plan-editing.planRingsOverlap「共边不算重叠」、outdoor-event-logic
 *   .strictlyInsideRing「贴墙不算穿楼」的判据注释都记录了这些常态）。为吃这口脏拓扑再引一个
 *   布尔库，风险大于收益，弃。
 * - 自研扫描线积分 + 网格基底：对共边/共点拓扑免疫（逐采样判内外，不做布尔拓扑手术）；
 *   面积在扫描线方向精确、垂直方向误差 ≤ 1 格；对 B2 的分区分配（矩形落位）而言，
 *   网格 + 轴对齐矩形集合正是直接可用的 substrate。选它。
 *
 * 局限如实声明：矩形集合是分辨率网格的轴对齐逼近（阶梯状），最大内接矩形为轴对齐；
 * 不产出平滑矢量差集——后续消费者真需要平滑轮廓时，再单独评估 polyclip-ts 并过人。
 * 建筑取真实足迹（不加缓冲）：落位净空由 clearForObject 在物件落位时按真实尺寸执行，
 * 本模块只提供「哪里根本不可布置」的基底；绿地（soft）不扣——可摆但有代价，不进禁区。
 */
import { outdoorCorridorStrips } from "./outdoor-event-logic";
import type { PlanPoint } from "../../../../supabase/functions/_shared/site-plan";

export interface PlaceableDomainInput {
  /** 活动范围轮廓（局部 ENU 米，闭合环；≥3 个有限坐标点，否则明确报错不猜）。 */
  boundary: PlanPoint[];
  /** 建筑足迹（禁区）。 */
  buildings?: PlanPoint[][] | undefined;
  /** hard 块：水域/围栏等禁区环（A2 分级 hard 档的几何）。 */
  hardBlocks?: PlanPoint[][] | undefined;
  /** 车行/后勤走廊中心线（按 corridorWidthM 缓冲成禁区）。 */
  corridorLines?: PlanPoint[][] | undefined;
  /** 走廊缓冲总宽（米）；默认 3，与 plan 路线 widthM 缺省一致。 */
  corridorWidthM?: number | undefined;
  /** 网格步长（米）；默认 1。必须为正。 */
  resolutionM?: number | undefined;
}

export interface PlaceableRect {
  /** 4 点轴对齐矩形环（顺时针或逆时针均可，本仓环函数对方向不敏感）。 */
  polygon: PlanPoint[];
  areaM2: number;
}

export interface PlaceableDomain {
  /** 实际采用的步长（输入过粗/过细时可能与请求值不同：跨度 > MAX_DIM 时自动放粗）。 */
  resolutionM: number;
  /** 可布置面积（扫描线积分，米²）。场地全堵时为 0——如实为零，不编数。 */
  areaM2: number;
  /** 边界总面积（鞋带公式，米²）。 */
  boundaryAreaM2: number;
  /** 最大轴对齐内接矩形（网格精确）；场地全堵时 null。 */
  maxRect: (PlaceableRect & { widthM: number; heightM: number }) | null;
  /** 可布置多边形集合：轴对齐矩形、互不重叠、并集=网格自由区（B2 分区分配的落位 substrate）。 */
  rects: PlaceableRect[];
  /** 网格列数（x 方向）。 */
  cols: number;
  /** 网格行数（y 方向）。 */
  rows: number;
  /** 网格原点（=边界包围盒左下角）。 */
  originX: number;
  originY: number;
  /** 1=可布置 0=禁区；行主序（index = j*cols + i，j 沿 y、i 沿 x）。B2 直接消费。 */
  cells: Uint8Array;
}

/** 网格单边上限：超过就按比例放粗步长（2000×2000 的 Uint8Array ≈ 4 MB，扫描线仍是一次遍历）。 */
const MAX_DIM = 2000;
const DEFAULT_RESOLUTION_M = 1;
const DEFAULT_CORRIDOR_WIDTH_M = 3;
/** 矩形集合防爆上限：真实场地远到不了；到了说明分辨率与场地不匹配，明确报错而不是静默截断。 */
const MAX_RECTS = 4000;

type Interval = [number, number];

function shoelaceAreaM2(ring: readonly PlanPoint[]): number {
  let sum = 0;
  for (let i = 0; i < ring.length; i += 1) {
    const a = ring[i]!;
    const b = ring[(i + 1) % ring.length]!;
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

/**
 * 闭合环与水平扫描线 y 的 even-odd 区间。半开规则（lo ≤ y < hi）保证顶点恰在
 * 扫描线上时不重复计——环闭合则交点数恒为偶数；水平边与零长边自然跳过。
 * 对共点/共边脏拓扑免疫：这里只做逐边求交，不做布尔拓扑手术。
 */
function ringIntervalsAtY(ring: readonly PlanPoint[], y: number): Interval[] {
  const xs: number[] = [];
  for (let i = 0; i < ring.length; i += 1) {
    const a = ring[i]!;
    const b = ring[(i + 1) % ring.length]!;
    if (a.y === b.y) continue;
    const lo = Math.min(a.y, b.y);
    const hi = Math.max(a.y, b.y);
    if (y < lo || y >= hi) continue;
    const t = (y - a.y) / (b.y - a.y);
    xs.push(a.x + t * (b.x - a.x));
  }
  xs.sort((m, n) => m - n);
  const intervals: Interval[] = [];
  for (let i = 0; i + 1 < xs.length; i += 2)
    intervals.push([xs[i]!, xs[i + 1]!]);
  return intervals;
}

/** 从有序不相交区间里扣掉一段（结果仍有序不相交）。 */
function subtractInterval(base: Interval[], cut: Interval): Interval[] {
  const [c0, c1] = cut;
  const next: Interval[] = [];
  for (const [b0, b1] of base) {
    if (c1 <= b0 || c0 >= b1) {
      next.push([b0, b1]);
      continue;
    }
    if (c0 > b0) next.push([b0, Math.min(c0, b1)]);
    if (c1 < b1) next.push([Math.max(c1, b0), b1]);
  }
  return next;
}

interface PendingRect {
  i0: number;
  i1: number;
  j0: number;
  j1: number;
}

/** 行自由区间 → 网格自由格行段（格中心落在自由区间内才自由，与面积口径同一套判据）。 */
function cellRunsFromIntervals(
  intervals: Interval[],
  originX: number,
  res: number,
  cols: number,
): Array<[number, number]> {
  const runs: Array<[number, number]> = [];
  for (const [fx0, fx1] of intervals) {
    const i0 = Math.max(0, Math.ceil((fx0 - originX) / res - 0.5));
    const i1 = Math.min(cols - 1, Math.ceil((fx1 - originX) / res - 0.5) - 1);
    if (i1 < i0) continue;
    runs.push([i0, i1]);
  }
  return runs;
}

/** 柱状图法最大内接矩形（逐行高度 + 单调栈），对网格自由区精确。 */
function maxRectInGrid(
  cells: Uint8Array,
  cols: number,
  rows: number,
  originX: number,
  originY: number,
  res: number,
): (PlaceableRect & { widthM: number; heightM: number }) | null {
  const heights = new Int32Array(cols);
  let best: { i0: number; i1: number; j0: number; areaCells: number } | null =
    null;
  const stack: number[] = [];
  for (let j = 0; j < rows; j += 1) {
    for (let i = 0; i < cols; i += 1)
      heights[i] = cells[j * cols + i] ? heights[i]! + 1 : 0;
    stack.length = 0;
    for (let i = 0; i <= cols; i += 1) {
      const h = i === cols ? 0 : heights[i]!;
      while (stack.length && heights[stack[stack.length - 1]!]! >= h) {
        const height = heights[stack.pop()!]!;
        const left = stack.length ? stack[stack.length - 1]! + 1 : 0;
        const area = height * (i - left);
        if (!best || area > best.areaCells)
          best = { i0: left, i1: i - 1, j0: j - height + 1, areaCells: area };
      }
      stack.push(i);
    }
  }
  if (!best || best.areaCells <= 0) return null;
  const x0 = originX + best.i0 * res;
  const x1 = originX + (best.i1 + 1) * res;
  const y0 = originY + best.j0 * res;
  const y1 = originY + (best.j0 + best.areaCells / (best.i1 - best.i0 + 1)) * res;
  return {
    polygon: [
      { x: x0, y: y0 },
      { x: x1, y: y0 },
      { x: x1, y: y1 },
      { x: x0, y: y1 },
    ],
    areaM2: best.areaCells * res * res,
    widthM: (best.i1 - best.i0 + 1) * res,
    heightM: y1 - y0,
  };
}

/**
 * 可布置域计算。输入缺据（轮廓 <3 点/坐标非有限）明确报错；障碍环退化（<3 点）整条丢弃；
 * 全堵场地如实返回零面积/空矩形集合，不编数。绿地（soft）不扣——可摆但有代价，不进禁区。
 */
export function computePlaceableDomain(
  input: PlaceableDomainInput,
): PlaceableDomain {
  const boundary = (input.boundary ?? []).filter(
    (p) => Number.isFinite(p?.x) && Number.isFinite(p?.y),
  );
  if (boundary.length < 3)
    throw new Error(
      "活动范围轮廓不完整（少于 3 个有效坐标点），可布置域不猜、不算。",
    );
  const resolutionM = input.resolutionM ?? DEFAULT_RESOLUTION_M;
  if (!Number.isFinite(resolutionM) || resolutionM <= 0)
    throw new Error("resolutionM 必须是正数（米）。");

  const xs = boundary.map((p) => p.x);
  const ys = boundary.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const spanX = Math.max(0.001, maxX - minX);
  const spanY = Math.max(0.001, maxY - minY);
  const res = Math.max(resolutionM, Math.max(spanX, spanY) / MAX_DIM);
  const cols = Math.max(1, Math.ceil(spanX / res));
  const rows = Math.max(1, Math.ceil(spanY / res));

  // 障碍环收集：建筑/hard 块原样；走廊中心线按总宽缓冲成逐段条带（端帽收在确认端点内，
  // 与 outdoorCorridorStrips 既有语义一致——走廊超出边界的部分由区间求交自然裁掉）。
  const obstacleRings: PlanPoint[][] = [];
  for (const ring of [...(input.buildings ?? []), ...(input.hardBlocks ?? [])]) {
    const pts = (ring ?? []).filter(
      (p) => Number.isFinite(p?.x) && Number.isFinite(p?.y),
    );
    if (pts.length >= 3) obstacleRings.push(pts);
  }
  const corridorWidth =
    input.corridorWidthM ?? DEFAULT_CORRIDOR_WIDTH_M;
  if (Number.isFinite(corridorWidth) && corridorWidth > 0)
    for (const line of input.corridorLines ?? []) {
      const pts = (line ?? []).filter(
        (p) => Number.isFinite(p?.x) && Number.isFinite(p?.y),
      );
      if (pts.length >= 2)
        for (const strip of outdoorCorridorStrips(pts, corridorWidth))
          obstacleRings.push(strip);
    }
  // 逐障碍包围盒预筛（planning.ts 同款手段）：扫描线不在其 y 范围内就不做环运算。
  const obstacleBoxes = obstacleRings.map((ring) => {
    let lo = Infinity;
    let hi = -Infinity;
    for (const p of ring) {
      lo = Math.min(lo, p.y);
      hi = Math.max(hi, p.y);
    }
    return { ring, lo, hi };
  });

  const cells = new Uint8Array(cols * rows);
  const rowRuns: Array<Array<[number, number]>> = [];
  let areaM2 = 0;
  for (let j = 0; j < rows; j += 1) {
    const y = minY + (j + 0.5) * res;
    let free = ringIntervalsAtY(boundary, y);
    for (const box of obstacleBoxes) {
      if (y < box.lo || y >= box.hi) continue;
      const cut = ringIntervalsAtY(box.ring, y);
      for (const interval of cut) free = subtractInterval(free, interval);
    }
    areaM2 += res * free.reduce((sum, [a, b]) => sum + (b - a), 0);
    const runs = cellRunsFromIntervals(free, minX, res, cols);
    rowRuns.push(runs);
    for (const [i0, i1] of runs)
      for (let i = i0; i <= i1; i += 1) cells[j * cols + i] = 1;
  }

  // 行段纵向合并成矩形集合：同一 [i0,i1] 的行段连续就向上长，断开就封口——
  // 产出互不重叠、并集恰为网格自由区的轴对齐矩形集合（可布置多边形集合）。
  const finished: PendingRect[] = [];
  let pending: PendingRect[] = [];
  for (let j = 0; j < rows; j += 1) {
    const runs = rowRuns[j]!;
    const used = new Set<PendingRect>();
    const nextPending: PendingRect[] = [];
    for (const [i0, i1] of runs) {
      const match = pending.find(
        (p) => !used.has(p) && p.i0 === i0 && p.i1 === i1,
      );
      if (match) {
        match.j1 = j;
        used.add(match);
        nextPending.push(match);
      } else {
        nextPending.push({ i0, i1, j0: j, j1: j });
      }
    }
    for (const p of pending) if (!used.has(p)) finished.push(p);
    pending = nextPending;
  }
  finished.push(...pending);
  if (finished.length > MAX_RECTS)
    throw new Error(
      `可布置域矩形分解出 ${finished.length} 块，超过安全上限 ${MAX_RECTS}——场地几何与 ${res}m 步长不匹配，请调大 resolutionM 后再算。`,
    );
  const rects: PlaceableRect[] = finished.map((r) => {
    const x0 = minX + r.i0 * res;
    const x1 = minX + (r.i1 + 1) * res;
    const y0 = minY + r.j0 * res;
    const y1 = minY + (r.j1 + 1) * res;
    return {
      polygon: [
        { x: x0, y: y0 },
        { x: x1, y: y0 },
        { x: x1, y: y1 },
        { x: x0, y: y1 },
      ],
      areaM2: (x1 - x0) * (y1 - y0),
    };
  });

  return {
    resolutionM: res,
    areaM2,
    boundaryAreaM2: shoelaceAreaM2(boundary),
    maxRect: maxRectInGrid(cells, cols, rows, minX, minY, res),
    rects,
    cols,
    rows,
    originX: minX,
    originY: minY,
    cells,
  };
}
