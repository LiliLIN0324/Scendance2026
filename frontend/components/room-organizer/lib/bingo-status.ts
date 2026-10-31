/**
 * 创作工作台「评审收藏」状态球读的本机记录。
 *
 * 不发链接、不写评论、不完成评审。那两段还在未合的分享菜单和方案页上：
 * - 收藏 + 待评审：`scendance.reviewMark.v1`（分享菜单发出评审链接时写入）
 * - 完成回执：`scendance-review-share-return-v1`（方案页「完成评审」写入）
 *
 * 同一浏览器里这两笔都在 localStorage。这里只读标记，并允许清掉回执。
 * 不建 Supabase，也不按设备同步。
 */

import { reviewPlanKeyForClientUrl } from '../../review-share-page/load-plan';

export const BINGO_MARK_KEY = 'scendance.reviewMark.v1';
export const BINGO_RETURN_KEY = 'scendance-review-share-return-v1';

const SHARE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_TITLE = 80;
const MAX_KEY = 80;
const MAX_PLANS = 40;

/** 球上的三态。待发不是另一条存储，而是「还没有待评审标记、也没有回执」。 */
export type BingoPhase = 'to-send' | 'awaiting' | 'returned';

export interface BingoPlan {
  projectKey: string;
  title: string;
  shareId: string;
  markedAt: string;
  /** 与 `/review` 甲方钉存储的 planKey 对齐（PR #37 share-pins）。 */
  reviewPlanKey: string;
  /** 甲方打开的链接。创作者侧 Bingo 只读反馈，不当成「去评审页写评论」入口。 */
  clientHref: string;
  returned: boolean;
}

export interface BingoReceipt {
  planKey: string;
  at: string;
  href: string;
}

export interface BingoSnapshot {
  phase: BingoPhase;
  plans: BingoPlan[];
  receipt: BingoReceipt | null;
}

export interface BingoReadable {
  getItem(key: string): string | null;
}

export interface BingoClearable {
  removeItem(key: string): void;
}

export function emptyBingoSnapshot(): BingoSnapshot {
  return { phase: 'to-send', plans: [], receipt: null };
}

export function reviewPlanHref(shareId: string): string {
  return `/review/${shareId}`;
}

/** 回执里若是方案编号，打开 `/review/<id>`；否则打开方案页根路径。 */
export function reviewReceiptHref(planKey: string): string {
  return SHARE_ID.test(planKey) ? reviewPlanHref(planKey) : '/review/';
}

export function bingoPhase(plans: number, hasReceipt: boolean): BingoPhase {
  if (hasReceipt) return 'returned';
  if (plans > 0) return 'awaiting';
  return 'to-send';
}

export function bingoPhaseLabel(phase: BingoPhase): string {
  if (phase === 'returned') return '已回执';
  if (phase === 'awaiting') return '待评';
  return '待发';
}

export function bingoBallLabel(snapshot: BingoSnapshot): string {
  if (snapshot.phase === 'returned') return '收反馈，已回执';
  if (snapshot.phase === 'awaiting') return `收反馈，待评，${snapshot.plans.length} 份链接`;
  return '收反馈，待发';
}

export function formatBingoTime(iso: string): string {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return '';
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(date);
}

export function readBingoSnapshot(storage: BingoReadable | null): BingoSnapshot {
  if (!storage) return emptyBingoSnapshot();
  const receipt = readRecord(storage, BINGO_RETURN_KEY, parseReceipt);
  const plans = readRecord(storage, BINGO_MARK_KEY, value => parsePlans(value, receipt)) ?? [];
  return { phase: bingoPhase(plans.length, receipt !== null), plans, receipt };
}

export function clearBingoReceipt(storage: BingoClearable): void {
  storage.removeItem(BINGO_RETURN_KEY);
}

function readRecord<T>(storage: BingoReadable, key: string, parse: (value: unknown) => T | null): T | null {
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    return parse(JSON.parse(raw) as unknown);
  } catch {
    return null;
  }
}

function parsePlans(value: unknown, receipt: BingoReceipt | null): BingoPlan[] {
  if (!Array.isArray(value)) return [];
  const plans: BingoPlan[] = [];
  for (const entry of value) {
    const plan = parsePlan(entry, receipt);
    if (!plan) continue;
    plans.push(plan);
    if (plans.length >= MAX_PLANS) break;
  }
  return plans;
}

function parsePlan(value: unknown, receipt: BingoReceipt | null): BingoPlan | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (record.saved !== true || record.status !== 'needs-review') return null;
  if (typeof record.shareId !== 'string') return null;
  const shareId = clip(record.shareId, MAX_KEY);
  if (!shareId) return null;
  if (typeof record.projectKey !== 'string' || typeof record.markedAt !== 'string') return null;
  const projectKey = clip(record.projectKey, MAX_KEY);
  if (!projectKey || !record.markedAt) return null;
  const clientUrl = typeof record.clientUrl === 'string' ? clip(record.clientUrl, 512) : '';
  const clientHref = clientUrl || (SHARE_ID.test(shareId) ? reviewPlanHref(shareId) : '/review/');
  const storedReviewKey = typeof record.reviewPlanKey === 'string' ? clip(record.reviewPlanKey, MAX_KEY) : '';
  const reviewPlanKey = storedReviewKey || reviewPlanKeyForClientUrl(clientHref) || projectKey;
  const receiptKeys = new Set([projectKey, shareId, reviewPlanKey]);
  return {
    projectKey,
    title: typeof record.title === 'string' && clip(record.title, MAX_TITLE) ? clip(record.title, MAX_TITLE) : '未命名活动',
    shareId,
    markedAt: record.markedAt,
    reviewPlanKey,
    clientHref,
    returned: receipt !== null && receiptKeys.has(receipt.planKey),
  };
}

function parseReceipt(value: unknown): BingoReceipt | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (record.version !== 1) return null;
  if (typeof record.planKey !== 'string') return null;
  const planKey = clip(record.planKey, MAX_KEY);
  if (!planKey) return null;
  if (typeof record.at !== 'string' || !Number.isFinite(Date.parse(record.at))) return null;
  return { planKey, at: record.at, href: reviewReceiptHref(planKey) };
}

function clip(value: string, max: number): string {
  return value.replace(/[\u0000-\u001f]/g, '').trim().slice(0, max);
}
