/**
 * canvas-heading-badges.ts —— 2D 画布顶左浮标（CanvasHeading）的容量 / 座位徽标视图模型。
 *
 * 纯函数：只把 layout / 当前楼层 / 需求人数镜像翻译成徽标文案与色调，不读 store、不接 UI。
 *
 * 口径边界（文案红线）：
 * - 所有件数、座位数都是「估算」；可计算的徽标文案带「估算」，算不出的走「待核验」。
 * - 只做软提示：不下无障碍、消防、疏散、核定容量结论，不写合规 / 通过 / 安全类字样。
 * - 人数缺失、场地尺寸不完整、楼层或座椅识别不到时走待核验，不补脚手架默认人数。
 */

import { estimateCapacity } from '@/lib/capacity-meter';
import { countSingleSeats } from './seat-requirement';
import { materialCount } from './structural-layout';
import type { RoomLayout } from './types';

export type HeadingBadgeTone = 'ok' | 'warn' | 'pending';

export interface HeadingBadge {
  tone: HeadingBadgeTone;
  text: string;
}

export interface HeadingBadgeModel {
  /** 场地件数估算徽标。 */
  capacity: HeadingBadge;
  /** 需求人数 vs 已摆座位对账徽标。 */
  seating: HeadingBadge;
}

/** 逼近上限的饱和度阈值：已摆件数 ≥ 上限 90% 视为逼近。 */
const NEAR_LIMIT_RATIO = 0.9;
/** 剩余件数 ≤ 此值也视为余量偏紧。 */
const TIGHT_REMAINING = 2;

/** 场地宽深几何是否完整可算；缺尺寸 / 非正数都不算完整。 */
function hasCompleteGeometry(layout: RoomLayout | undefined): boolean {
  return !!layout &&
    Number.isFinite(layout.width) && layout.width > 0 &&
    Number.isFinite(layout.height) && layout.height > 0;
}

/** 件数估算徽标：口径与编辑器物料计数一致（当前楼层、排除门 / 柱 / 出入口等结构标记件）。 */
function buildCapacityBadge(layout: RoomLayout | undefined, floorIndex: number): HeadingBadge {
  const floor = layout?.floors[floorIndex];
  if (!hasCompleteGeometry(layout) || !floor) {
    return { tone: 'pending', text: '件数估算待核验' };
  }

  const placed = materialCount(floor.items);
  const estimate = estimateCapacity(layout!.width, layout!.height, placed);

  // 上限算不出（极小场地 / 尺寸不完整）时不硬给数字，走待核验。
  if (estimate.maxItems <= 0) {
    return { tone: 'pending', text: '件数估算待核验' };
  }

  const nearLimit = estimate.ratio >= NEAR_LIMIT_RATIO || estimate.remaining <= TIGHT_REMAINING;
  const tone: HeadingBadgeTone = nearLimit ? 'warn' : 'ok';
  return {
    tone,
    text: `估算上限 ${estimate.maxItems} 件 · 已摆 ${placed} 件`,
  };
}

/** 人数 / 座位对账徽标：人数镜像为 null 时不编数；座椅识别不到时走待核验。 */
function buildSeatingBadge(
  layout: RoomLayout | undefined,
  floorIndex: number,
  headcount: number | null,
): HeadingBadge {
  if (!Number.isSafeInteger(headcount) || headcount == null || headcount < 1) {
    return { tone: 'pending', text: '人数待核验' };
  }

  const seats = countSingleSeats(layout, floorIndex);
  if (seats === null) {
    return { tone: 'pending', text: '座位待核验' };
  }

  const gap = headcount - seats;
  if (gap > 0) {
    return { tone: 'warn', text: `座位还差 ${gap}（估算）` };
  }
  return { tone: 'ok', text: `座位已够 ${headcount} 人（估算）` };
}

export function buildHeadingBadges(input: {
  layout: RoomLayout | undefined;
  activeFloorIndex: number;
  headcount: number | null;
}): HeadingBadgeModel {
  return {
    capacity: buildCapacityBadge(input.layout, input.activeFloorIndex),
    seating: buildSeatingBadge(input.layout, input.activeFloorIndex, input.headcount),
  };
}
