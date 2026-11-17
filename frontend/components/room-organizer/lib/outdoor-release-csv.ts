/**
 * 台账 CSV 导出（M7.1，轮次 87）。
 *
 * 待补清单是给人看的一段话；CSV 是给人**逐行填**的一张表。
 * 所以这里只做“台账 → 表格”的翻译，不产生任何判断：
 *
 *   · 列固定五列：编号 / 用例 / 固定数据 / 浏览器 / 云端；
 *   · **没有“结论”列**——结论只能由状态卡按三类全绿算，表格里填一个字都不算数；
 *   · 单元格只写 `pass` / `partial` / `none` / `有` / `无`，不写自然语言，免得两列口径打架。
 */

import { ACCEPTANCE_RULES } from './outdoor-acceptance-selfcheck';
import type { CaseLedgerRow } from './outdoor-release-status-card';

export const LEDGER_CSV_HEADER = ['编号', '用例', '固定数据', '浏览器', '云端'] as const;

const TITLE_OF = new Map(ACCEPTANCE_RULES.map((rule) => [rule.id, rule.title]));

/** CSV 转义：含逗号、引号、换行就整体加引号，内部引号翻倍。 */
function cell(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function stateCell(state: CaseLedgerRow['browser']): string {
  return state;
}

export function ledgerToCsv(ledger: readonly CaseLedgerRow[]): string {
  const lines = [LEDGER_CSV_HEADER.join(',')];
  for (const row of ledger) {
    lines.push(
      [
        String(row.id),
        cell(TITLE_OF.get(row.id) ?? `用例 ${row.id}`),
        row.fixedData ? '有' : '无',
        stateCell(row.browser),
        stateCell(row.cloud),
      ].join(','),
    );
  }
  return lines.join('\n');
}

/** 下载文件名：带上日期，两轮导出不会互相覆盖。 */
export function ledgerCsvName(asOf: string | undefined, today: string): string {
  const stamp = (asOf?.trim() || today).replace(/[\\/:*?"<>|\s]+/g, '-');
  return `outdoor-acceptance-ledger-${stamp}.csv`;
}
