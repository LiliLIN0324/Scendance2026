/**
 * 待补清单（M7.1，轮次 86）。
 *
 * 状态卡只说“三类全绿几条”，但人真正要干的是：**哪几条还差什么**。
 * 这一层把台账翻成一张可贴进工单的清单，一条一行，写清缺的是固定数据、浏览器还是云端。
 *
 * 两条硬规矩：
 *   1) **没台账就是没算**——空台账不许输出“无缺口”，那是把“不知道”写成“齐了”；
 *   2) **清单不下结论**——末行永远只是“共 N 条待补”，发布判断仍由状态卡给。
 */

import { ACCEPTANCE_RULES } from './outdoor-acceptance-selfcheck';
import {
  summarizeLedger,
  CASE_IDS,
  type CaseLedgerRow,
} from './outdoor-release-status-card';

export type GapKind = 'fixed' | 'browser' | 'cloud';

export interface CaseGap {
  id: number;
  title: string;
  /** 缺的类别，按“固定数据 → 浏览器 → 云端”的推进顺序排列。 */
  missing: readonly GapKind[];
  /** 可直接贴进工单的一行。 */
  line: string;
}

const TITLE_OF = new Map(ACCEPTANCE_RULES.map((rule) => [rule.id, rule.title]));

const LABEL: Record<GapKind, string> = {
  fixed: '固定数据',
  browser: '浏览器',
  cloud: '云端',
};

function gapsOf(row: CaseLedgerRow): GapKind[] {
  const missing: GapKind[] = [];
  if (!row.fixedData) missing.push('fixed');
  if (row.browser !== 'pass') missing.push('browser');
  if (row.cloud !== 'pass') missing.push('cloud');
  return missing;
}

/**
 * 有缺口的行，按用例号升序。三类全绿的行不进清单（它不是待办）。
 * 台账里没有的用例号也不补——缺行是调用方的事，这一层不无中生有。
 */
export function missingEvidence(ledger: readonly CaseLedgerRow[]): CaseGap[] {
  return ledger
    .filter((row) => gapsOf(row).length > 0)
    .slice()
    .sort((a, b) => a.id - b.id)
    .map((row) => {
      const missing = gapsOf(row);
      const title = TITLE_OF.get(row.id) ?? `用例 ${row.id}`;
      return {
        id: row.id,
        title,
        missing,
        line: `#${row.id} ${title} —— 缺：${missing.map((kind) => LABEL[kind]).join('、')}`,
      };
    });
}

export function formatGapList(ledger: readonly CaseLedgerRow[]): string {
  if (ledger.length === 0) {
    return '待补清单：没有台账（未算，不等于已补齐）';
  }
  const gaps = missingEvidence(ledger);
  const { allGreen, total } = summarizeLedger(ledger);
  if (gaps.length === 0) {
    return `待补清单：台账 ${total} 条无缺口（三类全绿 ${allGreen} 条）—— 结论仍以状态卡为准`;
  }
  return [
    ...gaps.map((gap) => gap.line),
    `共 ${gaps.length} 条待补 · 台账 ${total} 条 · 三类全绿 ${allGreen} 条（缺口未补前不可发布）`,
  ].join('\n');
}

/** 台账缺了哪几个用例号（不是“都齐了”，是“少了几行”）。 */
export function missingRows(ledger: readonly CaseLedgerRow[]): number[] {
  const present = new Set(ledger.map((row) => row.id));
  return CASE_IDS.filter((id) => !present.has(id));
}
