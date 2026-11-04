/**
 * M5-A Outcome 报表：一次 AI 生成跑完的「账本」。
 *
 * 纯类型 + 纯辅助函数，不接 UI、不接 store，也不依赖任何房间组织模块。
 * Bingo 审校台后续会把 {@link outcomeSummary} 贴到「本次报告」卡上。
 */

/** 空结果原因：整次生成为什么一件都没放。 */
export type ScopeEmptyReason =
  | 'NO_FLOOR' // 目标楼层不存在
  | 'NO_SPOT' // 扫了一圈全场地都没有合法落点
  | 'FULLY_BLOCKED' // 所有候选都过不了几何/约束
  | 'SCOPE_FILTERED' // 用户圈定的范围被过滤光了
  | 'UNKNOWN';

/** 被拒/被跳过的单件。 */
export interface OutcomeEntry<TItem> {
  item: TItem;
  /** 为什么没放。 */
  reason: string;
  /**
   * 机器可读 code，对齐 placement-rules 的 ViolationCode 风格：
   * 'OUT_OF_BOUNDS' | 'BBOX_OVERLAP' | 'WALL_INTERSECTION' | 'LOCKED' |
   * 'NO_SPOT' | 'UNKNOWN_ASSET' | 其它自定义字符串。
   */
  code: string;
}

/** 一次生成的完整账本。 */
export interface GenerationOutcome<TItem = unknown> {
  /** 实际放下的件。 */
  placed: TItem[];
  /** 过不了判据被拒的件。 */
  refused: OutcomeEntry<TItem>[];
  /** 因锁定/找不到目标/范围外被跳过的件（不是判据错，是「这次不动它」）。 */
  skipped: OutcomeEntry<TItem>[];
  /** 整次为空时的原因；有任意一件放置时为 undefined。 */
  scopeEmpty?: ScopeEmptyReason;
}

/** scopeEmpty 到中文人话的映射，给 {@link outcomeSummary} 用。 */
const SCOPE_EMPTY_ZH: Readonly<Record<ScopeEmptyReason, string>> = {
  NO_FLOOR: '目标楼层不存在',
  NO_SPOT: '全场地找不到合法落点',
  FULLY_BLOCKED: '所有候选都过不了几何闸',
  SCOPE_FILTERED: '圈定范围被过滤光',
  UNKNOWN: '原因不明',
};

/** 空账本（含原因）。 */
export function emptyOutcome<TItem = unknown>(reason: ScopeEmptyReason): GenerationOutcome<TItem> {
  return {
    placed: [],
    refused: [],
    skipped: [],
    scopeEmpty: reason,
  };
}

/**
 * 合并多次生成的账本。
 *
 * - placed / refused / skipped 直接拼接（不去重——同一件被多次放是不同 op）；
 * - scopeEmpty 只有当总 placed 数为 0 时才保留最后一个非 undefined 原因，
 *   否则整段账本视为「放成功过」，不再标注空跑原因。
 */
export function combineOutcomes<TItem>(...outs: Array<GenerationOutcome<TItem>>): GenerationOutcome<TItem> {
  const placed: TItem[] = [];
  const refused: OutcomeEntry<TItem>[] = [];
  const skipped: OutcomeEntry<TItem>[] = [];

  for (const out of outs) {
    placed.push(...out.placed);
    refused.push(...out.refused);
    skipped.push(...out.skipped);
  }

  const merged: GenerationOutcome<TItem> = { placed, refused, skipped };

  if (placed.length === 0) {
    // 反向遍历，取最后一个非空原因。
    for (let i = outs.length - 1; i >= 0; i -= 1) {
      const candidate = outs[i]?.scopeEmpty;
      if (candidate) {
        merged.scopeEmpty = candidate;
        break;
      }
    }
  }

  return merged;
}

/**
 * 给 Bingo 卡用的一句话中文摘要。
 *
 * - 整次一件没放且带 scopeEmpty 时：`本次没放成：{中文人话}`；
 * - 否则：`放了 N 件`，并按是否有 refused / skipped 追加后缀。
 */
export function outcomeSummary<TItem>(out: GenerationOutcome<TItem>): string {
  if (out.placed.length === 0 && out.scopeEmpty) {
    return `本次没放成：${SCOPE_EMPTY_ZH[out.scopeEmpty]}`;
  }

  let text = `放了 ${out.placed.length} 件`;
  if (out.refused.length > 0) text += `、被拒 ${out.refused.length} 件`;
  if (out.skipped.length > 0) text += `、跳过 ${out.skipped.length} 件`;
  return text;
}

/** 按 code 分组计数：`{ [code]: count }`。 */
export function countByCode<TItem>(entries: OutcomeEntry<TItem>[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const entry of entries) {
    counts[entry.code] = (counts[entry.code] ?? 0) + 1;
  }
  return counts;
}
