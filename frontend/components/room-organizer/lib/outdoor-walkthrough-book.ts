/**
 * 走查记录本（M7.1，轮次 72）。
 *
 * 卡片和台账已经能“吃”一份 `WalkthroughRecord`（轮次 71），但那份记录得有人手写。
 * 这里补上生成它的一层：一个不可变的、只能逐条往上标的记录本。
 *
 * 三条硬规矩：
 *   1) **没标就是没看**——空记录本不代表“全部无证据”以外的任何事，更不代表通过；
 *   2) **不可变**——每标一条都返回新对象，调用方可以安全地放进 React state；
 *   3) **记录本永远不下结论**——就算 11 条全标了 pass，也只说“看完了”，不说“可发布”。
 */

import { CASE_IDS, type BrowserEvidence, type WalkthroughRecord } from './outdoor-release-status-card';

export interface WalkthroughBook {
  /** 走查日期（人写）。没写就不编，让卡片回落到常量。 */
  asOf?: string;
  /** 只有真看过的号才在里面；没进这张表的号一律当没看。 */
  seen: Readonly<Record<number, BrowserEvidence>>;
}

export interface WalkthroughSummary {
  total: number;
  pass: number;
  partial: number;
  none: number;
  /** 已看条数（pass + partial）。 */
  looked: number;
  /** 可直接贴进工单的一行。 */
  line: string;
}

const CASE_SET: ReadonlySet<number> = new Set(CASE_IDS);

/** 新记录本。日期留空就留空，不拿当前时间冒充走查时间。 */
export function emptyBook(asOf?: string): WalkthroughBook {
  return asOf ? { asOf, seen: {} } : { seen: {} };
}

/** 编号必须是 1..11 的整数；0、12、1.5、NaN 一律拒收（不抛错，原样退回）。 */
export function isCaseId(id: number): boolean {
  return Number.isInteger(id) && CASE_SET.has(id);
}

/**
 * 标一条。非法编号直接返回同一个对象（引用不变），调用方据此判断“这一标没生效”。
 */
export function markSeen(
  book: WalkthroughBook,
  id: number,
  state: BrowserEvidence,
): WalkthroughBook {
  if (!isCaseId(id)) return book;
  return { ...book, seen: { ...book.seen, [id]: state } };
}

/** 已看条数：显式标成 `none` 也算没看。 */
export function lookedCount(book: WalkthroughBook): number {
  return CASE_IDS.filter((id) => {
    const state = book.seen[id];
    return state === 'pass' || state === 'partial';
  }).length;
}

export function summarizeWalkthrough(book: WalkthroughBook): WalkthroughSummary {
  let pass = 0;
  let partial = 0;
  for (const id of CASE_IDS) {
    const state = book.seen[id];
    if (state === 'pass') pass += 1;
    else if (state === 'partial') partial += 1;
  }
  const looked = pass + partial;
  const none = CASE_IDS.length - looked;
  const line = [
    `走查：已看 ${looked}/${CASE_IDS.length}`,
    `（通过 ${pass} / 不构成通过 ${partial}）`,
    none > 0 ? `/ 未看 ${none}` : '',
    '—— 记录本不下结论：可发布仍需三类全绿（含真实云端）',
  ]
    .filter(Boolean)
    .join(' ');
  return { total: CASE_IDS.length, pass, partial, none, looked, line };
}

/** 摊成卡片认得的 `WalkthroughRecord`：日期空白就不写，交给卡片回落常量。 */
export function bookToRecord(book: WalkthroughBook): WalkthroughRecord {
  const asOf = book.asOf?.trim();
  return asOf ? { asOf, seen: { ...book.seen } } : { seen: { ...book.seen } };
}
