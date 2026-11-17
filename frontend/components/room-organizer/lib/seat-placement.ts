/**
 * 户外设施 → 座位落点（纯函数层，零 three / React 依赖，便于单测）。
 *
 * 与 `walk-seat` 同一套坐面高度 / 坐姿眼高口径；区别是户外设施没有 FurnitureItem.type，
 * 可坐判定改走物件库 slug 的**物件段**与中文名关键词（椅 / 沙发 / 凳 / 长椅）。
 *
 * 2026-11-17 修正（基线审计三个真问题之一）：
 * - slug 只取尾部 4 个词（`prop-signal.objectSlugTokens`），场景名前缀不再冒充坐具；
 *   旧口径下 `portable`→`table`、`tracked`→`rack`、`festival-stage-…` 全部误命中。
 * - 游乐设施（飞椅）、医疗器械（疏散椅）、整片休息区不再当成可落座单件。
 * - 桌椅套装不再用设施中心当座位（会坐进桌面），改为四向座位锚点。
 *
 * 坐标系：输入输出均为规划 ENU（x 东、y 北，米）；世界坐标换算仍由场景层完成。
 * 坐姿真人 clip 未到位前，本层只负责「能不能坐、坐哪、坐多高」，不播坐姿动画。
 */

import { hasAnyText, hasAnyToken } from './prop-signal';

/** 可坐物件 slug 词（整词比，小写）。 */
const SEAT_SLUG_TOKENS = ['chair', 'armchair', 'sofa', 'couch', 'bench', 'seat', 'stool', 'loveseat', 'recliner'] as const;

/** 可坐物件中文名关键词。 */
const SEAT_NAME_TOKENS = ['椅', '沙发', '凳', '长椅', '等候椅'] as const;

/** 名字里带这些词的一律不算可坐：游乐设施与医疗器械（2026-11-17 审计 8 件错位之一）。 */
const SEAT_NAME_EXCLUDE = ['飞椅', '疏散椅', '吊椅', '轮椅', '休息区'] as const;

/** 这两类桶里出现「椅」多半是游乐/载具，不注册落座。 */
const NON_SEAT_BUCKETS = new Set(['rides', 'vehicles']);

/** 桌椅套装：名字里既有桌/台又有椅/凳，中心点是桌面，不是座位。 */
const SEAT_SET_DESK = ['桌', '台面', '吧台', 'counter', 'table', 'desk'] as const;
const SEAT_SET_CHAIR = ['椅', '凳', 'chair', 'stool', 'bench'] as const;

/** 坐姿眼高 = 坐面 + 这么多（米），与 walk-seat 一致。 */
const SEATED_EYE_OFFSET = 0.63;

/** 套装没有尺寸时，座位锚点按这个半径外推（米）。 */
const DEFAULT_SEAT_RING_M = 0.55;

export interface SeatFacilityInput {
  id: string;
  name: string;
  position: { x: number; y: number };
  /** 平面朝向角（度，东为零、逆时针为正）。 */
  rotationDeg?: number;
  /** 物件库 slug / 模板 id / override slug，用于可坐关键词判定。 */
  ref?: string | undefined;
  /** 模型标称高度（米），用于坐面高度收边。 */
  height?: number;
  /** 设施占地（米）；桌椅套装据此推算座位锚点，缺省按 1.1 m 见方。 */
  width?: number;
  depth?: number;
  /** 物料桶（seating / rides / vehicles …）；只有排除项会用到。 */
  category?: string | undefined;
  /** 额外标签（例如「可坐」），命中即加分。 */
  tags?: readonly string[] | undefined;
  /**
   * 能力表定稿：目录已标成 seat / seat-set。
   * 关键词漏判的新物料靠它进座位表，不再为单个物料加名字词。
   */
  canSeat?: boolean | undefined;
}

/** 一个可落座的座位目标。 */
export interface SeatTarget {
  id: string;
  name: string;
  /** 落座落点（设施中心，ENU 米）。 */
  x: number;
  y: number;
  /** 平面朝向角（度）。 */
  rotationDeg: number;
  /** 坐面高度（米，从地面起算）。 */
  seatHeight: number;
  /** 坐下后的相机眼高（含楼层基准）。 */
  eyeY: number;
}

function lowerTokens(text: string): string {
  return (text ?? '').toLowerCase();
}

function isExcludedSeatName(name: string): boolean {
  return hasAnyText(name, SEAT_NAME_EXCLUDE);
}

function seatNameHit(input: SeatFacilityInput): boolean {
  const name = input.name ?? '';
  if (isExcludedSeatName(name)) return false;
  if (hasAnyText(name, SEAT_NAME_TOKENS)) return true;
  // 标签（例如「可坐」）与中文子类别同样算数，避免名字翻译丢词时判不出。
  if (hasAnyText((input.tags ?? []).join(' '), SEAT_NAME_TOKENS)) return true;
  return false;
}

/** 设施是否可坐：能力表定稿优先；否则名称 / 标签命中，或 slug 的物件段命中；游乐与载具桶另排除。 */
export function isSeatFacility(input: SeatFacilityInput): boolean {
  if (isExcludedSeatName(input.name ?? '')) return false;
  if (input.category && NON_SEAT_BUCKETS.has(input.category)) return false;
  if (input.canSeat === true) return true;
  if (seatNameHit(input)) return true;
  return hasAnyToken(input.ref, SEAT_SLUG_TOKENS);
}

/** 桌椅套装：能坐，但落座点不在设施中心。 */
export function isSeatSetFacility(input: SeatFacilityInput): boolean {
  if (!isSeatFacility(input)) return false;
  const name = lowerTokens(input.name ?? '');
  const desk = hasAnyText(name, SEAT_SET_DESK);
  const chair = hasAnyText(name, SEAT_SET_CHAIR);
  return desk && chair;
}

/** 坐面高度：沙发略低，椅 / 凳常规；用模型高度收边，避免异常模型坐进地里或悬空。 */
export function seatSurfaceHeight(input: SeatFacilityInput): number {
  const isCushioned = hasAnyToken(input.ref, ['sofa', 'couch', 'loveseat'])
    || (input.name ?? '').includes('沙发');
  const base = isCushioned ? 0.42 : 0.45;
  const capped = typeof input.height === 'number' && input.height > 0
    ? Math.min(base, input.height * 0.55)
    : base;
  return Math.max(0.28, capped);
}

function seatTarget(input: SeatFacilityInput, groundY: number, overrides?: Partial<Pick<SeatTarget, 'id' | 'x' | 'y' | 'rotationDeg'>>): SeatTarget {
  const seatHeight = seatSurfaceHeight(input);
  return {
    id: overrides?.id ?? input.id,
    name: input.name,
    x: overrides?.x ?? input.position.x,
    y: overrides?.y ?? input.position.y,
    rotationDeg: overrides?.rotationDeg ?? input.rotationDeg ?? 0,
    seatHeight,
    eyeY: groundY + seatHeight + SEATED_EYE_OFFSET,
  };
}

/** 单个设施 → 座位目标；不可坐或桌椅套装（另走锚点）返回 null。 */
export function seatTargetOf(
  input: SeatFacilityInput,
  groundY = 0,
): SeatTarget | null {
  if (!isSeatFacility(input) || isSeatSetFacility(input)) return null;
  return seatTarget(input, groundY);
}

/**
 * 桌椅套装的四向座位锚点（2026-11-17）。
 * 旧口径把套装中心当座位，人一坐下就坐进桌面；这里按占地外推四个座位，
 * 朝向各自指向套件中心。拿不到尺寸时用 0.55 m 半径兜底。
 */
export function seatSetTargets(input: SeatFacilityInput, groundY = 0): SeatTarget[] {
  if (!isSeatSetFacility(input)) return [];
  const halfW = Math.max(DEFAULT_SEAT_RING_M, (input.width ?? DEFAULT_SEAT_RING_M * 2) / 2);
  const halfD = Math.max(DEFAULT_SEAT_RING_M, (input.depth ?? DEFAULT_SEAT_RING_M * 2) / 2);
  const baseAngle = input.rotationDeg ?? 0;
  const ring = [
    { dx: 0, dy: halfD, face: -90 },
    { dx: halfW, dy: 0, face: 180 },
    { dx: 0, dy: -halfD, face: 90 },
    { dx: -halfW, dy: 0, face: 0 },
  ] as const;
  return ring.map((entry, index) => seatTarget(input, groundY, {
    id: `${input.id}#seat${index + 1}`,
    x: input.position.x + entry.dx,
    y: input.position.y + entry.dy,
    rotationDeg: baseAngle + entry.face,
  }));
}

/** 一批设施里挑出可落座的座位目标；桌椅套装按四个锚点展开。 */
export function seatFacilityTargets(
  facilities: readonly SeatFacilityInput[],
  groundY = 0,
): SeatTarget[] {
  return facilities.flatMap(facility => {
    if (isSeatSetFacility(facility)) return seatSetTargets(facility, groundY);
    const single = seatTargetOf(facility, groundY);
    return single ? [single] : [];
  });
}
