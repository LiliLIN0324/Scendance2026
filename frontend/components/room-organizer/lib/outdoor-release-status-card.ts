/**
 * 发布前状态卡（M7.1，2026-11-17）。
 *
 * 把三样东西拼成一张能直接粘进工单的固定文本：
 *   1) 11 条验收用例的「可判 / 缺料 / 只能浏览器」；
 *   2) 本次会话的指标汇总（`metricsSummary().text`）；
 *   3) 发版门禁三项目前有没有实测（没跑就写“未验”，不默认通过）。
 *
 * 硬约束与自检清单一致：**本卡永远不下“可发布”结论**。门禁三项全绿也只写
 * “门禁就绪”，末行固定写“不可发布（N 条三类全绿）”——因为全绿与否由人在对照表里定。
 */

import type { CaseAssessment } from './outdoor-acceptance-selfcheck';
import { summarizeAssessment } from './outdoor-acceptance-selfcheck';
import { gateFactsForCard, type GateReading } from './outdoor-gate-reading';
import type { MetricsSummary } from './outdoor-metrics-book';

export interface GateFacts {
  /** 类型检查是否在本提交上跑过且为 0 错。 */
  typecheck?: boolean;
  /** 户外套件是否跑过且全过。 */
  tests?: boolean;
  /** 静态导出是否跑过且 exit 0。 */
  build?: boolean;
}

export interface ReleaseStatusInput {
  rows: readonly CaseAssessment[];
  metrics: MetricsSummary;
  gate?: GateFacts;
  /** 门禁读数（`readGates` 的结果）：给了就用它算门禁行，并把读数行附在下面。 */
  reading?: GateReading;
  /** 三类全绿的用例数（由人填；缺省 0）。 */
  allGreen?: number;
}

/** 证据快照日期：下面的表只代表这一天对照表的实际内容，表变了就要同步改。 */
export const EVIDENCE_AS_OF = '2026-11-17 正式站走查第二轮';

/**
 * 每条用例目前在「真实浏览器」这一列有没有证据（照 `2026-11-16-outdoor-evidence-matrix.md` 拄录）。
 * `none` = 一行实证也没有；`partial` = 有部分证据但仍不构成通过。
 */
export const BROWSER_EVIDENCE: Readonly<Record<number, 'none' | 'partial'>> = {
  1: 'partial',
  2: 'none',
  3: 'partial',
  4: 'partial',
  5: 'none',
  6: 'partial',
  7: 'partial',
  8: 'partial',
  9: 'partial',
  10: 'partial',
  11: 'partial',
};

export const RELEASE_STATUS_PREFIX = '[outdoor-release]';

/**
 * 把状态卡整张打到控制台（首行前缀固定，后面是多行正文），并返回卡文给调用方。
 * 同样可注入 `log`：jsdom 里不能真写控制台，生产里默认走 console.info。
 */
export function logReleaseStatus(
  input: ReleaseStatusInput,
  deps: { log?: (line: string) => void } = {},
): string {
  const card = formatReleaseStatusCard(input);
  const log = deps.log ?? ((line: string) => console.info(line));
  log(`${RELEASE_STATUS_PREFIX}\n${card}`);
  return card;
}

function gateCell(value: boolean | undefined): string {
  if (value === undefined) return '未验';
  return value ? '通过' : '未过';
}

export function formatReleaseStatusCard(input: ReleaseStatusInput): string {
  const totals = summarizeAssessment(input.rows);
  const gate = input.reading ? gateFactsForCard(input.reading) : (input.gate ?? {});
  const allGreen = input.allGreen ?? 0;
  const gateReady = gate.typecheck === true && gate.tests === true && gate.build === true;
  const ids = input.rows.map((row) => row.id);
  const withEvidence = ids.filter((id) => BROWSER_EVIDENCE[id] === 'partial');
  const withoutEvidence = ids.filter((id) => BROWSER_EVIDENCE[id] === 'none');
  return [
    '发布前状态卡',
    `· 验收用例 ${input.rows.length} 条：可判 ${totals.ready} / 缺料 ${totals.missing} / 只能浏览器 ${totals.browserOnly}`,
    `· 浏览器证据（${EVIDENCE_AS_OF}）：有部分 ${withEvidence.length} 条（${withEvidence.map((id) => `#${id}`).join(' ')}）/ 无证据 ${withoutEvidence.length} 条（${withoutEvidence.map((id) => `#${id}`).join(' ')}）`,
    `· 指标：${input.metrics.text}`,
    `· 门禁：类型 ${gateCell(gate.typecheck)} / 用例 ${gateCell(gate.tests)} / 构建 ${gateCell(gate.build)}（${gateReady ? '门禁就绪' : '门禁未齐'}）`,
    ...(input.reading ? [`· 读数：${input.reading.line}`] : []),
    `· 结论：不可发布（三类全绿 ${allGreen} 条）`,
  ].join('\n');
}
