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
  /**
   * 逐条证据台账：给了就以它算出三类全绿条数，`allGreen` 手填值不再生效
   * （避免“表里 0 条、卡里写 3 条”这种漂移）。
   */
  ledger?: readonly CaseLedgerRow[];
  /** 三类全绿的用例数（由人填；缺省 0）。给了 ledger 时以 ledger 为准。 */
  allGreen?: number;
  /** 真实走查记录：给了就以它算浏览器那列与日期，不再用 `BROWSER_EVIDENCE`。 */
  evidence?: WalkthroughRecord;
}

/** 证据快照日期：下面的表只代表这一天对照表的实际内容，表变了就要同步改。 */
export const EVIDENCE_AS_OF = '2026-11-17 正式站走查第二轮';

/**
 * 本轮标过证据、却没填走查日期时的显式标注。
 * 不能拿上一轮的日期顶替——日期与证据跨轮正是 2026-11-18 修的那个矛盾。
 */
export const UNSET_ROUND_AS_OF = '本轮走查，日期未填';

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

/** 浏览器证据三态：没看 / 看了但不构成通过 / 走查通过。 */
export type BrowserEvidence = 'none' | 'partial' | 'pass';

/**
 * 一次真实走查的记录（人写的原始材料）。
 * 有了它，卡片和台账的浏览器那列不再手写常量，而是从记录算出来。
 */
export interface WalkthroughRecord {
  /** 走查日期；不写就沿用 `EVIDENCE_AS_OF`。 */
  asOf?: string;
  /**
   * 逐条状态。**这一轮标过什么就以什么为准**，没写的号一律当 `none`——
   * 没记录就是没证据，不默认给 partial。
   * 例外：整份记录一条都没标（`seen` 为空）时，视为「这一轮还没走查」，
   * 整列回落到对照表快照（见 `browserEvidenceFrom`）。
   */
  seen: Readonly<Record<number, BrowserEvidence>>;
}

/**
 * 把走查记录摊成「编号 → 三态」。
 *
 * 两条口径（2026-11-18 修）：
 * 1) **没有记录**（没传记录，或记录里一条都没标）→ 回落到 `BROWSER_EVIDENCE`——
 *    也就是对照表上那一列真实走查（2026-11-17 第二轮）的结果。
 *    旧写法只在 `record` 为 `undefined` 时回落，可实际链路
 *    `loadBook() → bookToRecord()` 永远返回一个对象（空记录本也是 `{seen:{}}`），
 *    于是真实界面里 11 条全成「无证据」，而卡片日期又写着那一轮的日期——
 *    **日期与证据跨了两轮，自相矛盾**。
 * 2) **有记录**（哪怕只标了一条）→ 整份按记录替换，没提到的号一律 `none`，
 *    不拿上一轮的结果顶替（这一轮没看就是没看）。
 */
export function browserEvidenceFrom(
  record?: WalkthroughRecord,
): Readonly<Record<number, BrowserEvidence>> {
  if (!record || Object.keys(record.seen).length === 0) return BROWSER_EVIDENCE;
  const out: Record<number, BrowserEvidence> = {};
  for (const id of CASE_IDS) {
    out[id] = record.seen[id] ?? 'none';
  }
  return out;
}

/**
 * 走查日期：
 * - 本轮一条都没标（或没有记录）→ 用快照日期，因为浏览器列显示的就是快照；
 * - 本轮标过 → 用本轮填的日期；没填就明说「日期未填」，不回落到上一轮。
 */
export function evidenceAsOf(record?: WalkthroughRecord): string {
  const hasSeen = !!record && Object.keys(record.seen).length > 0;
  if (!hasSeen) return EVIDENCE_AS_OF;
  return record?.asOf?.trim() || UNSET_ROUND_AS_OF;
}

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

export interface CaseLedgerRow {
  id: number;
  /** 固定数据（确定性用例）有没有覆盖；false 表示连固定数据都缺。 */
  fixedData: boolean;
  /** 真实浏览器那一列的状态。 */
  browser: 'pass' | 'partial' | 'none';
  /** 真实云端那一列的状态。 */
  cloud: 'pass' | 'partial' | 'none';
}

/**
 * 三类全绿的**唯一**判据（轮次 93 抽出）：固定数据有、浏览器过、云端过；partial 一律不算。
 * 卡片、台账、报告里的“逐条判断”都必须调它，免得各自写一份条件而在某天悄悄分叉。
 */
export function isAllGreen(row: CaseLedgerRow): boolean {
  return row.fixedData && row.browser === 'pass' && row.cloud === 'pass';
}

/** 三类全绿只有一种算法：固定数据有、浏览器过、云端过。partial 一律不算。 */
export function summarizeLedger(rows: readonly CaseLedgerRow[]): {
  allGreen: number;
  fixedOnly: number;
  total: number;
} {
  const allGreen = rows.filter(isAllGreen).length;
  const fixedOnly = rows.filter(
    (row) => row.fixedData && (row.browser !== 'pass' || row.cloud !== 'pass'),
  ).length;
  return { allGreen, fixedOnly, total: rows.length };
}

/** 验收用例编号（对照表 11 行）；台账按它整行铺开，缺行就等于在隐瞒缺口。 */
export const CASE_IDS: readonly number[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];

/**
 * 从证据快照 + 固定数据清单直接生出台账。
 *
 * 浏览器那列只认 `BROWSER_EVIDENCE`（没有一条被标成 pass，这是实情）；
 * 云端那列目前一条实证也没有，所以整列写 `none`。
 * 调用方只需告诉“哪几条有固定数据”，剩下的不再由人填。
 */
export function ledgerFromEvidence(
  fixedDataIds: readonly number[],
  evidence?: WalkthroughRecord,
  cloudPassIds: readonly number[] = [],
): CaseLedgerRow[] {
  const fixed = new Set(fixedDataIds);
  const browser = browserEvidenceFrom(evidence);
  // 云端那列只能“声明”，绝不能从浏览器结果推出来：没声明的号一律 none。
  const cloud = new Set(cloudPassIds.filter((id) => CASE_IDS.includes(id)));
  return CASE_IDS.map((id) => ({
    id,
    fixedData: fixed.has(id),
    browser: browser[id] ?? 'none',
    cloud: cloud.has(id) ? 'pass' : 'none',
  }));
}

/**
 * 每条用例的**固定数据证据**（只写能点到具体测试文件的）。
 *
 * 轮次 102 口径纠正：此前只写了「#2 #5」，依据是“只有这两条能逐条点名”；
 * 但对照表（`2026-11-16-outdoor-evidence-matrix.md`）从轮次 33 起就给 11 条里 9 条
 * 列了具体文件与条数，旧写法把已有的证据报少了——卡片因此说“缺固定数据”，那是错的。
 *
 * 本表只读“有这个文件且它跑得过”，**不声称覆盖充分**；文件不存在的不写（如旧文档里的
 * `indoor-zone-door` 已不存在，改用实存的 `plan-door-snap` / `plan-indoor-walls`）。
 */
export const FIXED_DATA_EVIDENCE: Readonly<Record<number, readonly string[]>> = {
  1: ['outdoor-event-turn', 'instruction-layers', 'outdoor-map-context'],
  2: ['outdoor-venue-candidates', 'outdoor-venue-sync', 'outdoor-project-store'],
  3: ['instruction-layers', 'outdoor-event-turn'],
  4: ['outdoor-pending-task', 'pending-brief'],
  5: ['outdoor-case5-offline', 'outdoor-map-context', 'outdoor-walk-boundary'],
  6: ['outdoor-login-copy', 'turn-failure-diag'],
  7: ['outdoor-apply-once'],
  8: ['outdoor-flow-restore', 'outdoor-apply-once', 'outdoor-project-store'],
  9: ['outdoor-apply-once', 'turn-trace'],
  10: ['turn-failure-diag', 'turn-trace'],
  11: ['plan-door-snap', 'zones'],
};

/** 有固定数据证据的用例号（由上面的表推出，不另维护一份）。 */
export const FIXED_DATA_CASES: readonly number[] = Object.keys(FIXED_DATA_EVIDENCE)
  .map(Number)
  .sort((a, b) => a - b);

/** 卡默认用的台账：直接由上面的常量生成，不给人填的余地。 */
export function defaultLedger(
  evidence?: WalkthroughRecord,
  cloudPassIds: readonly number[] = [],
): CaseLedgerRow[] {
  return ledgerFromEvidence(FIXED_DATA_CASES, evidence, cloudPassIds);
}

/** 云端那列：有台账才算得出来，没台账就明说没报。 */
function cloudLine(ledger: readonly CaseLedgerRow[] | undefined): string {
  if (!ledger) return '· 云端证据：未验（本次没带台账）';
  const pass = ledger.filter((row) => row.cloud === 'pass').length;
  const rest = ledger.length - pass;
  // 0 条通过最容易被误读成“都行”，所以把两种真实原因并列写出来。
  const emptyNote = pass === 0 ? '（要么没跑、要么还没声明）' : '';
  return `· 云端证据：${pass} 条通过 / ${rest} 条未验${emptyNote}`;
}

export interface StatusSnapshot {
  evidenceAsOf: string;
  cases: { total: number; ready: number; missing: number; browserOnly: number };
  browser: { pass: number[]; partial: number[]; none: number[] };
  /** 没带台账时为 null（而不是写一串 0 冒充“都没过”）。 */
  cloud: { pass: number; unverified: number } | null;
  gate: { typecheck?: boolean; tests?: boolean; build?: boolean };
  allGreen: number;
}

/**
 * 卡的可对比版：同样的输入得到同样的对象，可以拿两轮结果直接 diff。
 * 数组一律升序，键顺序固定，避免“内容没变却 diff 一片”。
 */
export function statusCardSnapshot(input: ReleaseStatusInput): StatusSnapshot {
  const totals = summarizeAssessment(input.rows);
  const ids = input.rows.map((row) => row.id);
  const gate = input.reading ? gateFactsForCard(input.reading) : (input.gate ?? {});
  const ledger = input.ledger;
  const evidence = browserEvidenceFrom(input.evidence);
  const idsOf = (state: BrowserEvidence) => ids.filter((id) => evidence[id] === state).sort((a, b) => a - b);
  return {
    evidenceAsOf: evidenceAsOf(input.evidence),
    cases: {
      total: input.rows.length,
      ready: totals.ready,
      missing: totals.missing,
      browserOnly: totals.browserOnly,
    },
    browser: {
      pass: idsOf('pass'),
      partial: idsOf('partial'),
      none: idsOf('none'),
    },
    cloud: ledger
      ? {
          pass: ledger.filter((row) => row.cloud === 'pass').length,
          unverified: ledger.filter((row) => row.cloud !== 'pass').length,
        }
      : null,
    gate: { ...gate },
    allGreen: ledger ? summarizeLedger(ledger).allGreen : (input.allGreen ?? 0),
  };
}

/** 证据清单：空列表就只写「0 条」，不留一个空括号。 */
function listWithIds(ids: readonly number[]): string {
  if (ids.length === 0) return '0 条';
  return `${ids.length} 条（${ids.map((id) => `#${id}`).join(' ')}）`;
}

export function formatReleaseStatusCard(input: ReleaseStatusInput): string {
  const totals = summarizeAssessment(input.rows);
  const gate = input.reading ? gateFactsForCard(input.reading) : (input.gate ?? {});
  const allGreen = input.ledger ? summarizeLedger(input.ledger).allGreen : (input.allGreen ?? 0);
  const gateReady = gate.typecheck === true && gate.tests === true && gate.build === true;
  const ids = input.rows.map((row) => row.id);
  const evidence = browserEvidenceFrom(input.evidence);
  const withEvidence = ids.filter((id) => evidence[id] === 'partial');
  const withoutEvidence = ids.filter((id) => evidence[id] === 'none');
  const passed = ids.filter((id) => evidence[id] === 'pass');
  return [
    '发布前状态卡',
    input.rows.length === 0
      ? '· 验收用例 0 条：还没有可判的用例（先跑一次会话再用）'
      : `· 验收用例 ${input.rows.length} 条：可判 ${totals.ready} / 缺料 ${totals.missing} / 只能浏览器 ${totals.browserOnly}`,
    `· 浏览器证据（${evidenceAsOf(input.evidence)}）：${passed.length > 0 ? `已通过 ${listWithIds(passed)} / ` : ''}有部分 ${listWithIds(withEvidence)} / 无证据 ${listWithIds(withoutEvidence)}`,
    cloudLine(input.ledger),
    `· 指标：${input.metrics.text.trim() || '本次会话没有指标记录'}`,
    `· 门禁：类型 ${gateCell(gate.typecheck)} / 用例 ${gateCell(gate.tests)} / 构建 ${gateCell(gate.build)}（${gateReady ? '门禁就绪' : '门禁未齐'}）`,
    ...(input.reading ? [`· 读数：${input.reading.line}`] : []),
    `· 结论：不可发布（三类全绿 ${allGreen} 条）`,
  ].join('\n');
}
