import { describe, expect, it } from 'vitest';
import {
  aggregateInboxItems,
  countUnreadInboxItems,
  deduplicateInboxItems,
  isDoneInboxItem,
  isUnreadInboxItem,
  sortInboxItemsByRecency,
  type InboxItem,
} from './inbox';

function item(overrides: Partial<InboxItem> = {}): InboxItem {
  return {
    id: overrides.id ?? 'item-1',
    kind: overrides.kind ?? 'notice',
    title: overrides.title ?? '一条待回应',
    summary: overrides.summary ?? '',
    status: overrides.status ?? 'pending',
    createdAt: overrides.createdAt ?? '2026-11-20T10:00:00.000Z',
    unread: overrides.unread ?? true,
    source: overrides.source ?? { panel: 'messages' },
  };
}

describe('inbox 条目口径', () => {
  it('只把未读且未处理的条目计入红点', () => {
    const items = [
      item({ id: 'a', status: 'pending', unread: true }),
      item({ id: 'b', status: 'read', unread: false }),
      item({ id: 'c', status: 'done', unread: true }),
      item({ id: 'd', status: 'pending', unread: false }),
    ];
    expect(countUnreadInboxItems(items)).toBe(1);
    expect(isUnreadInboxItem(items[0])).toBe(true);
    expect(isDoneInboxItem(items[2])).toBe(true);
  });

  it('按 id 去重并保留先出现的一条', () => {
    const first = item({ id: 'dup', title: '首条' });
    const second = item({ id: 'dup', title: '后条' });
    const deduped = deduplicateInboxItems([first, second]);
    expect(deduped).toHaveLength(1);
    expect(deduped[0].title).toBe('首条');
  });

  it('按时间倒序，非法时间稳定排到末尾', () => {
    const older = item({ id: 'old', createdAt: '2026-11-19T09:00:00.000Z' });
    const newest = item({ id: 'new', createdAt: '2026-11-20T11:00:00.000Z' });
    const broken = item({ id: 'broken', createdAt: '' });
    const sorted = sortInboxItemsByRecency([older, broken, newest]);
    expect(sorted.map(entry => entry.id)).toEqual(['new', 'old', 'broken']);
  });

  it('合并多来源：去重、排序并汇总未闭环数', () => {
    const team = [
      item({ id: 't1', kind: 'team', source: { panel: 'messages' }, createdAt: '2026-11-20T08:00:00.000Z' }),
      item({ id: 't2', kind: 'team', status: 'done', unread: false, createdAt: '2026-11-20T07:00:00.000Z' }),
    ];
    const bingo = [
      item({ id: 't1', kind: 'team' }),
      item({ id: 'p1', kind: 'review-pin', source: { panel: 'bingo', refId: 'pin-9', focus: { objectId: 'chair', x: 1, z: 2 } }, createdAt: '2026-11-20T12:00:00.000Z' }),
    ];
    const { items, unreadCount } = aggregateInboxItems([team, bingo]);
    expect(items.map(entry => entry.id)).toEqual(['p1', 't1', 't2']);
    expect(unreadCount).toBe(2);
    expect(items[0].source.focus).toEqual({ objectId: 'chair', x: 1, z: 2 });
  });
});
