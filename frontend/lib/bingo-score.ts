/**
 * bingo-score.ts —— Bingo 体检量化分。
 *
 * 纯函数：输入一份 RoomLayout（建议传 settle 收敛后的 layout），
 * 可选传 SettleReport 以统计「自动挪开 / 挪不动」件数。
 * 分项从 placement-rules 的 Violation.code 归类，total 为四项平均。
 *
 * 与 placement-rules / settle-placement 并列、不互相改写原对象。
 */

import type { RoomLayout } from '../components/room-organizer/lib/types';
import { collectViolations, type ViolationCode } from './placement-rules';
import type { SettleReport } from './settle-placement';

export interface BingoScoreBreakdown {
  /** 0-100 间距合规率（CHAIR_ISLAND 类扣分）。 */
  spacing: number;
  /** 0-100 通道合规率（MAIN_AISLE_BLOCKED 扣分）。 */
  aisle: number;
  /** 0-100 出界合规率（OUT_OF_BOUNDS 扣分）。 */
  bounds: number;
  /** 0-100 压墙合规率（WALL_INTERSECTION / WALL_OVERLAP / WALL_PENETRATION 扣分）。 */
  wall: number;
}

export interface BingoScore {
  /** 0-100 加权总分（四项平均，整数）。 */
  total: number;
  breakdown: BingoScoreBreakdown;
  /** 检查了几件（所有 floor 的 furniture 总数）。 */
  itemCount: number;
  /** 合规几件。 */
  passedCount: number;
  /** 违规几件（按涉及的不同 itemId 计）。 */
  failedCount: number;
  /** settle 自动挪开几件（steps 里出现过 moved 的不同 itemId）。 */
  fixedCount: number;
  /** 挪不动几件（remainingViolations 里不同 itemId，已标红）。 */
  stuckCount: number;
  /** 中文一句摘要。 */
  summary: string;
}

/** 压墙类 code 集合（实际代码用 WALL_INTERSECTION，兼容别名）。 */
const WALL_CODES: ReadonlySet<string> = new Set(['WALL_INTERSECTION', 'WALL_OVERLAP', 'WALL_PENETRATION']);

/** 单项得分：max(0, 100 - 违规占比*100)。itemCount<=0 视为空场地，给满分。 */
function scoreForViolationCount(violationCount: number, itemCount: number): number {
  if (itemCount <= 0) return 100;
  const ratio = violationCount / itemCount;
  return Math.max(0, Math.round(100 - ratio * 100));
}

/**
 * 计算体检分。
 * @param layout 被体检的布局（建议传 settleReport.layout 收敛后版本）。
 * @param settleReport 可选；传入时统计 fixedCount / stuckCount 并影响 summary 文案。
 */
export function computeBingoScore(
  layout: RoomLayout,
  settleReport?: SettleReport,
): BingoScore {
  const violations = collectViolations(layout);
  const itemCount = layout.floors.reduce((sum, floor) => sum + floor.items.length, 0);

  const spacingCount = violations.filter((v) => v.code === 'CHAIR_ISLAND').length;
  const aisleCount = violations.filter((v) => v.code === 'MAIN_AISLE_BLOCKED').length;
  const boundsCount = violations.filter((v) => v.code === 'OUT_OF_BOUNDS').length;
  const wallCount = violations.filter((v) => WALL_CODES.has(v.code)).length;

  const breakdown: BingoScoreBreakdown = {
    spacing: scoreForViolationCount(spacingCount, itemCount),
    aisle: scoreForViolationCount(aisleCount, itemCount),
    bounds: scoreForViolationCount(boundsCount, itemCount),
    wall: scoreForViolationCount(wallCount, itemCount),
  };

  const total = Math.round(
    (breakdown.spacing + breakdown.aisle + breakdown.bounds + breakdown.wall) / 4,
  );

  const failedItemIds = new Set(violations.map((v) => v.itemId));
  const failedCount = failedItemIds.size;
  const passedCount = Math.max(0, itemCount - failedCount);

  let fixedCount = 0;
  let stuckCount = 0;
  if (settleReport) {
    const movedIds = new Set<string>();
    for (const step of settleReport.steps) {
      for (const m of step.moved) movedIds.add(m.itemId);
    }
    fixedCount = movedIds.size;
    const stuckIds = new Set(settleReport.remainingViolations.map((v) => v.itemId));
    stuckCount = stuckIds.size;
  }

  let summary: string;
  if (total >= 95 && stuckCount === 0) {
    summary = `粗略检查发现 ${failedCount} 件待调整；入口、疏散与现场条件仍需核验。`;
  } else if (fixedCount > 0 && stuckCount === 0) {
    summary = `发现 ${fixedCount} 处堵点已自动挪开，${itemCount} 件全部就位`;
  } else if (stuckCount > 0) {
    summary = `发现 ${fixedCount} 处堵点已自动挪开，${stuckCount} 处挪不动已标红（请手动调整）`;
  } else {
    summary = `粗略检查提示 ${failedCount} 件需关注；实际通行与现场条件仍需核验。`;
  }

  return {
    total,
    breakdown,
    itemCount,
    passedCount,
    failedCount,
    fixedCount,
    stuckCount,
    summary,
  };
}

/** 违规 code → 中文人话（给被拒件列表用，不把 BBOX_OVERLAP 这种 code 直接给用户看）。 */
export function violationCodeLabel(code: ViolationCode | string): string {
  switch (code) {
    case 'MAIN_AISLE_BLOCKED':
      return '压主通道';
    case 'OUT_OF_BOUNDS':
      return '出界';
    case 'WALL_INTERSECTION':
    case 'WALL_OVERLAP':
    case 'WALL_PENETRATION':
      return '压墙';
    case 'CHAIR_ISLAND':
      return '椅子成岛';
    case 'BBOX_OVERLAP':
      return '家具重叠';
    case 'LOCKED':
      return '已锁定';
    case 'NO_SPOT':
      return '无合法落点';
    case 'NO_FLOOR':
      return '目标楼层不存在';
    case 'FULLY_BLOCKED':
      return '候选全被拦';
    case 'SCOPE_FILTERED':
      return '范围被过滤';
    case 'UNKNOWN_ASSET':
      return '素材未知';
    default:
      return code;
  }
}
