/**
 * 收件箱适配层：各业务面板产出的「待回应条目」统一形状。
 *
 * 条目产生、动作落盘、状态回写与失效清理归各业务面板；这里只做跨源去重、
 * 按时间排序与未闭环计数，不持久化、不发往后端。邀请 / 钉评等跨设备条目
 * 等后端契约就位后再接入，本机自检条目先留本机。
 *
 * 形状见 docs/plans/2026-11-20-cross-loop-inbox-plan.md §2.1；这是前端适配层
 * 契约，不另起并行 wire schema。
 */

export type InboxItemKind =
  | 'team'
  | 'notice'
  | 'invite'
  | 'agent-question'
  | 'review-pin'
  | 'saved-draft';

export type InboxSourcePanel = 'messages' | 'bingo' | 'delivery' | 'plans' | 'account';

export type InboxItemStatus = 'pending' | 'done' | 'read';

/** 回跳画布定位：物件 id 与 ENU 锚点均可缺省。 */
export interface InboxItemFocus {
  objectId?: string;
  x?: number;
  z?: number;
}

export interface InboxSource {
  panel: InboxSourcePanel;
  refId?: string;
  focus?: InboxItemFocus;
}

export interface InboxItem {
  id: string;
  kind: InboxItemKind;
  title: string;
  summary: string;
  status: InboxItemStatus;
  /** ISO 时间；空或非法值排到末尾。 */
  createdAt: string;
  unread: boolean;
  source: InboxSource;
}

/** 已处理条目不再计入待回应，也不亮红点。 */
export function isDoneInboxItem(item: InboxItem): boolean {
  return item.status === 'done';
}

/** 红点口径：未读且未处理；已读 / 已处理不亮。 */
export function isUnreadInboxItem(item: InboxItem): boolean {
  return item.unread && item.status !== 'done';
}

/** 未闭环（待回应）条目数；红点与左轨汇总用同一口径。 */
export function countUnreadInboxItems(items: readonly InboxItem[]): number {
  return items.reduce((sum, item) => sum + (isUnreadInboxItem(item) ? 1 : 0), 0);
}

/** 按条目 id 去重，保留先出现的一条；跨源 join 时同条不重复计数。 */
export function deduplicateInboxItems(items: readonly InboxItem[]): InboxItem[] {
  const seen = new Set<string>();
  const deduped: InboxItem[] = [];
  for (const item of items) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    deduped.push(item);
  }
  return deduped;
}

function recencyTimestamp(createdAt: string): number {
  const time = Date.parse(createdAt);
  return Number.isFinite(time) ? time : Number.NEGATIVE_INFINITY;
}

/** 最近的在前；时间非法 / 缺失的稳定排到末尾，保持同序。 */
export function sortInboxItemsByRecency(items: readonly InboxItem[]): InboxItem[] {
  return [...items].sort((a, b) => recencyTimestamp(b.createdAt) - recencyTimestamp(a.createdAt));
}

/** 合并多个来源的条目：去重 → 按时间排序，并给出未闭环计数。 */
export function aggregateInboxItems(
  groups: readonly (readonly InboxItem[])[],
): { items: InboxItem[]; unreadCount: number } {
  const items = sortInboxItemsByRecency(deduplicateInboxItems(groups.flat()));
  return { items, unreadCount: countUnreadInboxItems(items) };
}
