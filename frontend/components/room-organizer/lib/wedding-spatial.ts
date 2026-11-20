import type { PlanPoint } from '../../../../supabase/functions/_shared/site-plan';

/** Draft design parameters, not a building-code or egress certification. */
export const WEDDING_DEFAULTS = {
  guests: 60,
  seatsPerTable: 10,
  aisleM: 2.5,
  serviceAisleM: 1.5,
  rowClearanceM: 0.65,
  chairGapM: 0.3,
  photographerM: 2,
  tableDiameterM: 1.8,
  /** 从入口侧起算的迎宾带纵深上限（米）；实际取场地比例后夹在此范围。 */
  frontDepthM: 3.2,
  frontDepthMaxM: 12,
  /** 小于该面积或短边小于 2 m 的自由区不再切分区——切出来也放不下桌椅。 */
  minZoneAreaM2: 6,
  minZoneSideM: 2,
  /** 可布置域网格步长（米）。0.5 m 在 70 m 见方约 2 万格，静态导出可接受。 */
  resolutionM: 0.5,
  /** 通道两侧的落位净空（米）：canPlace 会给通道加宽后再判重叠，网格必须同口径。 */
  routeClearanceM: 0.5,
  /** 仪式区与宴席区之间的空档（米），用于让通道与收边有位置。 */
  zoneGapM: 0.8,
  /** 仪式焦点从分区边缘向内退的距离（米）：背景进深 + 收边。 */
  focusInsetM: 1.5,
  /** 观礼席单侧列数上限：超过这个宽度就不再算「组团」，而是横向长排。 */
  maxColumns: 5,
} as const;

/** 轴对齐矩形（米，ENU：+x 东、+y 北）。 */
export interface PlanRect {
  w: number;
  e: number;
  s: number;
  n: number;
}

export type WeddingCardinal = 'north' | 'south' | 'east' | 'west';
/** 景观方向：正交四向 + 斜向四角。斜向只用于取分量，分区仍是正交轴线。 */
export type WeddingDirection = WeddingCardinal | 'northeast' | 'northwest' | 'southeast' | 'southwest';

/**
 * 场地主轴：`axis` 是量深度的方向，`sign` 指向「远端」。
 * 入口侧起算的归一化位置 t=0 在入口一侧，t=1 在远端。
 */
export interface WeddingAxis {
  axis: 'x' | 'y';
  sign: 1 | -1;
}

export interface SeatPose {
  position: PlanPoint;
  rotationDeg: number;
  row: number;
  column: number;
  side: -1 | 1;
}

export const rectFromRing = (ring: readonly PlanPoint[]): PlanRect => ({
  w: Math.min(...ring.map((p) => p.x)),
  e: Math.max(...ring.map((p) => p.x)),
  s: Math.min(...ring.map((p) => p.y)),
  n: Math.max(...ring.map((p) => p.y)),
});

export const rectRing = (rect: PlanRect): PlanPoint[] => [
  { x: rect.w, y: rect.s },
  { x: rect.e, y: rect.s },
  { x: rect.e, y: rect.n },
  { x: rect.w, y: rect.n },
];

export const rectWidth = (rect: PlanRect): number => rect.e - rect.w;
export const rectDepth = (rect: PlanRect): number => rect.n - rect.s;
export const rectArea = (rect: PlanRect): number => Math.max(0, rectWidth(rect)) * Math.max(0, rectDepth(rect));
export const rectCenter = (rect: PlanRect): PlanPoint => ({ x: (rect.w + rect.e) / 2, y: (rect.s + rect.n) / 2 });

export const directionOfAxis = (axis: WeddingAxis): WeddingCardinal =>
  axis.axis === 'y' ? (axis.sign > 0 ? 'north' : 'south') : axis.sign > 0 ? 'east' : 'west';

/** 斜向拆成两个正交分量；正交方向返回自身。 */
export const directionParts = (direction: WeddingDirection): WeddingCardinal[] => {
  switch (direction) {
    case 'northeast': return ['north', 'east'];
    case 'northwest': return ['north', 'west'];
    case 'southeast': return ['south', 'east'];
    case 'southwest': return ['south', 'west'];
    default: return [direction];
  }
};

export const isDiagonalDirection = (direction: WeddingDirection): boolean => directionParts(direction).length > 1;

export const axisToward = (direction: WeddingCardinal): WeddingAxis =>
  direction === 'north'
    ? { axis: 'y', sign: 1 }
    : direction === 'south'
      ? { axis: 'y', sign: -1 }
      : direction === 'east'
        ? { axis: 'x', sign: 1 }
        : { axis: 'x', sign: -1 };

/** 把任意方向吸附到最近的坐标轴；零向量回北向，不猜斜轴。 */
export function snapAxis(dx: number, dy: number): WeddingAxis {
  if (!Number.isFinite(dx) || !Number.isFinite(dy) || (Math.abs(dx) < 1e-6 && Math.abs(dy) < 1e-6))
    return { axis: 'y', sign: 1 };
  return Math.abs(dy) >= Math.abs(dx)
    ? { axis: 'y', sign: dy >= 0 ? 1 : -1 }
    : { axis: 'x', sign: dx >= 0 ? 1 : -1 };
}

export const axisDepth = (rect: PlanRect, axis: WeddingAxis): number =>
  axis.axis === 'y' ? rectDepth(rect) : rectWidth(rect);

export const axisWidth = (rect: PlanRect, axis: WeddingAxis): number =>
  axis.axis === 'y' ? rectWidth(rect) : rectDepth(rect);

/** 沿主轴的单位向量，指向远端。 */
export const axisUnit = (axis: WeddingAxis): PlanPoint =>
  axis.axis === 'y' ? { x: 0, y: axis.sign } : { x: axis.sign, y: 0 };

/** 横轴单位向量（主轴逆时针 90°）。 */
export const crossUnit = (axis: WeddingAxis): PlanPoint =>
  axis.axis === 'y' ? { x: 1, y: 0 } : { x: 0, y: 1 };

const clamp = (value: number, low: number, high: number): number => Math.min(high, Math.max(low, value));

/**
 * 沿主轴取 t0–t1 的带（t=0 在入口侧，t=1 在远端）。带始终落在矩形内，
 * 方向由 axis.sign 决定，不按画布北侧硬编码。
 */
export function bandRect(rect: PlanRect, axis: WeddingAxis, t0: number, t1: number): PlanRect {
  const low = clamp(Math.min(t0, t1), 0, 1);
  const high = clamp(Math.max(t0, t1), 0, 1);
  if (axis.axis === 'y') {
    const span = rectDepth(rect);
    return axis.sign > 0
      ? { ...rect, s: rect.s + low * span, n: rect.s + high * span }
      : { ...rect, s: rect.n - high * span, n: rect.n - low * span };
  }
  const span = rectWidth(rect);
  return axis.sign > 0
    ? { ...rect, w: rect.w + low * span, e: rect.w + high * span }
    : { ...rect, w: rect.e - high * span, e: rect.e - low * span };
}

/** t 从入口侧量起（0=入口侧，1=远端），u 是横轴 0–1 的位置；返回世界坐标点。 */
export function pointInRectAt(rect: PlanRect, axis: WeddingAxis, t: number, u: number): PlanPoint {
  const along = axis.sign > 0 ? t : 1 - t;
  if (axis.axis === 'y') return { x: rect.w + u * (rect.e - rect.w), y: rect.s + along * (rect.n - rect.s) };
  return { x: rect.w + along * (rect.e - rect.w), y: rect.s + u * (rect.n - rect.s) };
}

/** 把矩形沿横轴切成若干条（权重为相对宽度），返回值从横轴负向到正向排列。 */
export function splitAcross(rect: PlanRect, axis: WeddingAxis, weights: readonly number[]): PlanRect[] {
  const usable = weights.filter((weight) => weight > 0);
  const total = usable.reduce((sum, weight) => sum + weight, 0);
  if (!usable.length || total <= 0) return [];
  const low = axis.axis === 'y' ? rect.w : rect.s;
  const high = axis.axis === 'y' ? rect.e : rect.n;
  const slices: PlanRect[] = [];
  let consumed = 0;
  for (const weight of usable) {
    const a = low + ((high - low) * consumed) / total;
    consumed += weight;
    const b = low + ((high - low) * consumed) / total;
    slices.push(axis.axis === 'y' ? { ...rect, w: a, e: b } : { ...rect, s: a, n: b });
  }
  return slices;
}

/** 沿主轴朝远端收进一定米数（用于把焦点从分区边缘退到背景内侧）。 */
export function insetAlong(rect: PlanRect, axis: WeddingAxis, meters: number): PlanRect {
  const depth = axisDepth(rect, axis);
  if (depth <= 0) return rect;
  const t = Math.min(0.4, Math.max(0, meters / depth));
  return bandRect(rect, axis, 0, 1 - t);
}

/**
 * 仪式焦点：分区朝向 `axis` 一侧的边缘中点，再向区内退 `insetM`。
 * 观礼席从焦点反向排开，因此座椅与焦点朝向同一条轴。
 */
export function ceremonyFocus(rect: PlanRect, axis: WeddingAxis, insetM = 1.5): PlanPoint {
  const center = rectCenter(rect);
  const inset = Math.min(insetM, Math.max(0, axisDepth(rect, axis) / 3));
  if (axis.axis === 'y') return { x: center.x, y: axis.sign > 0 ? rect.n - inset : rect.s + inset };
  return { x: axis.sign > 0 ? rect.e - inset : rect.w + inset, y: center.y };
}

/**
 * 观礼席：围绕一条中央通道左右成对成列，逐席朝向 `facing` 指向的焦点。
 * 行从焦点背面依次后退，留出摄影位（photographerM）与排间净距。
 */
export function ceremonySeats(input: {
  focus: PlanPoint;
  facing: PlanPoint;
  count: number;
  width: number;
  depth: number;
  columns: number;
  aisleM?: number;
  rowClearanceM?: number;
  gapM?: number;
  photographerM?: number;
}): SeatPose[] {
  const { focus, width, depth } = input;
  const columns = Math.max(1, Math.floor(input.columns));
  const aisle = input.aisleM ?? WEDDING_DEFAULTS.aisleM;
  const clearance = input.rowClearanceM ?? WEDDING_DEFAULTS.rowClearanceM;
  const gap = input.gapM ?? WEDDING_DEFAULTS.chairGapM;
  const photo = input.photographerM ?? WEDDING_DEFAULTS.photographerM;
  const length = Math.hypot(input.facing.x, input.facing.y) || 1;
  const fx = input.facing.x / length;
  const fy = input.facing.y / length;
  // 横轴 = 朝向逆时针 90°。
  const lx = -fy;
  const ly = fx;
  const diagonal = Math.hypot(width, depth);
  return Array.from({ length: input.count }, (_, index) => {
    const row = Math.floor(index / (columns * 2));
    const side: -1 | 1 = index % 2 ? 1 : -1;
    const column = Math.floor(index / 2) % columns;
    const back = photo + 1 + depth / 2 + row * (depth + clearance);
    const lateral = side * (aisle / 2 + 0.6 + diagonal / 2 + column * (diagonal + gap));
    const x = focus.x - fx * back + lx * lateral;
    const y = focus.y - fy * back + ly * lateral;
    // 椅面局部 +y 为朝向；转到焦点。
    return {
      position: { x, y },
      rotationDeg: (-Math.atan2(focus.x - x, focus.y - y) * 180) / Math.PI,
      row,
      column,
      side,
    };
  });
}

/**
 * 宴席桌心：沿主轴从入口侧成排推进，中央通道两侧各留一列或多列完整桌椅组。
 * 返回顺序 = 近排优先、由通道向外，便于先放客人最先落座的桌子。
 */
export function banquetCenters(
  rect: PlanRect,
  envelope: number,
  axis: WeddingAxis,
  options: { aisleM?: number; serviceAisleM?: number } = {},
): PlanPoint[] {
  const depth = axisDepth(rect, axis);
  const width = axisWidth(rect, axis);
  const aisle = options.aisleM ?? WEDDING_DEFAULTS.aisleM;
  const pitch = envelope * 2 + (options.serviceAisleM ?? WEDDING_DEFAULTS.serviceAisleM);
  const center = rectCenter(rect);
  const lateralCenter = axis.axis === 'y' ? center.x : center.y;
  const near = axis.sign > 0
    ? axis.axis === 'y' ? rect.s : rect.w
    : axis.axis === 'y' ? rect.n : rect.e;
  const offsets: number[] = [];
  // 与落位检查同一口径：中央通道两侧还要留出通道净空，再加 5 cm 容差，避免与走廊共边。
  const first = aisle / 2 + envelope + 0.05;
  for (let i = 0; first + i * (envelope * 2 + 1.2) + envelope <= width / 2 + 0.001; i++) {
    const offset = first + i * (envelope * 2 + 1.2);
    offsets.push(offset);
  }
  // 窄场地连一组都放不进两侧时，退回居中一列；是否真的放得下由落位检查回答。
  if (!offsets.length) offsets.push(0);
  const rows: number[] = [];
  for (let i = 0; envelope + 0.5 + i * pitch + envelope <= depth + 0.001; i++) rows.push(envelope + 0.5 + i * pitch);
  if (!rows.length) rows.push(depth / 2);
  const points: PlanPoint[] = [];
  for (const row of rows) {
    for (const offset of offsets) {
      for (const side of offsets[0] === 0 ? [0] : [-1, 1]) {
        const lateral = lateralCenter + side * offset;
        const along = near + axis.sign * row;
        points.push(axis.axis === 'y' ? { x: lateral, y: along } : { x: along, y: lateral });
      }
    }
  }
  return points;
}

/** 观礼容量估算：只用于决定分区大小，实际数量一律来自落位结果。
 *  与 ceremonySeats 同一套口径：焦点向区内退 1.5 m、列数上限 5、末排需容纳整椅。 */
export function estimateCeremonySeats(
  rect: PlanRect,
  axis: WeddingAxis,
  seat: { width: number; depth: number },
): number {
  const depth = axisDepth(rect, axis);
  const width = axisWidth(rect, axis);
  const diagonal = Math.hypot(seat.width, seat.depth);
  const usableDepth = depth - WEDDING_DEFAULTS.focusInsetM - WEDDING_DEFAULTS.photographerM - 1 - seat.depth / 2;
  if (usableDepth <= 0) return 0;
  const rows = Math.floor(usableDepth / (seat.depth + WEDDING_DEFAULTS.rowClearanceM)) + 1;
  const half = width / 2 - WEDDING_DEFAULTS.aisleM / 2 - 0.6 - diagonal / 2;
  if (half <= 0) return 0;
  const columns = clamp(Math.floor(half / (diagonal + WEDDING_DEFAULTS.chairGapM)) + 1, 0, WEDDING_DEFAULTS.maxColumns);
  return Math.max(0, rows * columns * 2);
}

/** 宴席容量估算（桌数）：同上，只用于分区取舍。 */
export function estimateBanquetTables(
  rect: PlanRect,
  axis: WeddingAxis,
  envelope: number,
): number {
  const depth = axisDepth(rect, axis);
  const width = axisWidth(rect, axis);
  const pitch = envelope * 2 + WEDDING_DEFAULTS.serviceAisleM;
  // 与 banquetCenters 同一套起排条件：第一排先让出通道半宽与一个整组半径。
  const rows = depth >= envelope * 2 + 0.5 ? Math.floor((depth - envelope - 0.5) / pitch) + 1 : 0;
  const perSide = width / 2 >= WEDDING_DEFAULTS.aisleM / 2 + WEDDING_DEFAULTS.routeClearanceM + envelope
    ? Math.floor((width / 2 - WEDDING_DEFAULTS.aisleM / 2 - WEDDING_DEFAULTS.routeClearanceM - envelope) / (envelope * 2 + 1.2)) + 1
    : 0;
  return rows * perSide * 2;
}
