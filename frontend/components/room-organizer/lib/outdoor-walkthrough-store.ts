/**
 * 走查记录本的落盘（M7.1，轮次 74）。
 *
 * 记录本本身是纯数据（轮次 72），但一刷新就没了——走查时人不会一口气标完 11 条。
 * 这里只做一件事：**把记录本原样存进一个键、原样读回来**，读坏了就当没有。
 *
 * 边界：
 *   - 只认 1..11 的整数编号和三档状态，其它一律丢掉（不因为存储脏数据就多出几行）；
 *   - 版本不对、JSON 坏、存的不是对象 → 返回空记录本，不抛错；
 *   - 存储不可用（隐私模式 / 配额满）→ `saveBook` 返回 false，**绝不抛给事件处理**；
 *   - 落盘不代表结论：存的是“看了哪几条”，不是“能不能发布”。
 */

import type { BrowserEvidence } from './outdoor-release-status-card';
import { emptyBook, isCaseId, type WalkthroughBook } from './outdoor-walkthrough-book';

export const WALKTHROUGH_KEY = 'scendance.outdoor.walkthrough.v1';

/** 存储的最小接口：只用到 getItem / setItem，方便测试注入假的。 */
export interface BookStorage {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
}

const STATES: ReadonlySet<BrowserEvidence> = new Set(['none', 'partial', 'pass']);

export function encodeBook(book: WalkthroughBook): string {
  const seen: Record<number, BrowserEvidence> = {};
  for (const [rawId, state] of Object.entries(book.seen)) {
    const id = Number(rawId);
    if (isCaseId(id) && STATES.has(state)) seen[id] = state;
  }
  const asOf = book.asOf?.trim();
  return JSON.stringify(asOf ? { v: 1, asOf, seen } : { v: 1, seen });
}

/**
 * 读回来。任何一处不对就当“没有记录”：宁可让卡片回落常量，也不拿脏数据冒充走查结果。
 */
export function decodeBook(raw: string | null | undefined): WalkthroughBook {
  if (!raw) return emptyBook();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return emptyBook();
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return emptyBook();
  const data = parsed as { v?: unknown; asOf?: unknown; seen?: unknown };
  if (data.v !== 1) return emptyBook();
  if (!data.seen || typeof data.seen !== 'object' || Array.isArray(data.seen)) return emptyBook();
  const seen: Record<number, BrowserEvidence> = {};
  for (const [rawId, state] of Object.entries(data.seen as Record<string, unknown>)) {
    const id = Number(rawId);
    if (isCaseId(id) && STATES.has(state as BrowserEvidence)) seen[id] = state as BrowserEvidence;
  }
  const asOf = typeof data.asOf === 'string' ? data.asOf.trim() : '';
  return asOf ? { asOf, seen } : { seen };
}

/** 默认拿浏览器存储；没有 `window` 或访问被拒就返回 undefined。 */
function defaultStorage(): BookStorage | undefined {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return undefined;
    return window.localStorage;
  } catch {
    return undefined;
  }
}

/** 存。返回 false 只表示“没存进去”，调用方不该因此中断流程。 */
export function saveBook(
  book: WalkthroughBook,
  deps: { storage?: BookStorage } = {},
): boolean {
  const storage = deps.storage ?? defaultStorage();
  if (!storage) return false;
  try {
    storage.setItem(WALKTHROUGH_KEY, encodeBook(book));
    return true;
  } catch {
    return false;
  }
}

/** 取。读不到、读坏了都返回空记录本。 */
export function loadBook(deps: { storage?: BookStorage } = {}): WalkthroughBook {
  const storage = deps.storage ?? defaultStorage();
  if (!storage) return emptyBook();
  try {
    return decodeBook(storage.getItem(WALKTHROUGH_KEY));
  } catch {
    return emptyBook();
  }
}
