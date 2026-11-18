/**
 * 发布状态一次算齐（M7.1，轮次 83）。
 *
 * 之前 `formatReleaseStatusCard()` 与 `statusCardSnapshot()` 各算一遍台账：
 * 调用方只要少传一个参数，卡片说“全绿 1 条”、快照说“0”，就会在工单里自相矛盾。
 *
 * 这里只做一件事：**算一次台账，卡片与快照都用它**，并把“门禁齐没齐”一并给出。
 * 依然守旧规矩：本模块不下“可发布”结论，只报“门禁就绪/未齐”与全绿条数。
 */

import { gateFactsForCard, type GateReading } from './outdoor-gate-reading';
import {
  defaultLedger,
  formatReleaseStatusCard,
  statusCardSnapshot,
  summarizeLedger,
  type CaseLedgerRow,
  type ReleaseStatusInput,
  type StatusSnapshot,
} from './outdoor-release-status-card';

export interface ReleaseBundleInput extends ReleaseStatusInput {
  /** 已声明“云端真跑过”的用例号；给了 ledger 时以 ledger 为准。 */
  cloudPass?: readonly number[];
}

export interface ReleaseBundle {
  /** 可直接粘进工单的多行文本。 */
  card: string;
  /** 可两轮直接 diff 的对象。 */
  snapshot: StatusSnapshot;
  /** 卡片与快照共用的那一份台账（便于外层复核）。 */
  ledger: CaseLedgerRow[];
  /** 三类全绿条数（由台账算，手填无效）。 */
  allGreen: number;
  /** 门禁三项是否都在本提交上跑过且通过。 */
  gateReady: boolean;
}

export function releaseStatusBundle(input: ReleaseBundleInput): ReleaseBundle {
  const ledger = input.ledger
    ? [...input.ledger]
    : defaultLedger(input.evidence, input.cloudPass ?? []);
  const shared: ReleaseStatusInput = { ...input, ledger };
  const gate = input.reading
    ? gateFactsForCard(input.reading)
    : (input.gate ?? {});
  return {
    card: formatReleaseStatusCard(shared),
    snapshot: statusCardSnapshot(shared),
    ledger,
    allGreen: summarizeLedger(ledger).allGreen,
    gateReady: gate.typecheck === true && gate.tests === true && gate.build === true,
  };
}

/** 门禁读数 → 三行摘要（给工单里贴“这次门禁跑到什么程度”用）。 */
export function gateSummaryLine(reading: GateReading): string {
  const facts = gateFactsForCard(reading);
  const cell = (value: boolean | undefined) => (value === undefined ? '未验' : value ? '通过' : '未过');
  return `门禁：类型 ${cell(facts.typecheck)} / 用例 ${cell(facts.tests)} / 构建 ${cell(facts.build)}`;
}
