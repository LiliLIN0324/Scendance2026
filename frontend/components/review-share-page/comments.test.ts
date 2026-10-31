import { describe, expect, it } from 'vitest';
import {
  appendReviewComment,
  commentThreads,
  readReviewComments,
  REVIEW_COMMENT_PLANS,
  REVIEW_COMMENT_STORAGE_KEY,
  REVIEW_COMMENTS_PER_PLAN,
  type ReviewComment,
} from './comments';

function memory(): Storage {
  const data = new Map<string, string>();
  return {
    get length() { return data.size; },
    clear: () => data.clear(),
    getItem: (key) => data.get(key) ?? null,
    key: (index) => [...data.keys()][index] ?? null,
    removeItem: (key) => { data.delete(key); },
    setItem: (key, value) => { data.set(key, value); },
  };
}

function post(storage: Storage, body: string, extra: { planKey?: string; parentId?: string | null; author?: string; id?: string; now?: Date } = {}) {
  return appendReviewComment(storage, {
    planKey: extra.planKey ?? 'sample:initial',
    author: extra.author ?? '甲方',
    body,
    parentId: extra.parentId ?? null,
    ...(extra.id ? { id: extra.id } : {}),
    ...(extra.now ? { now: extra.now } : {}),
  });
}

describe('review share comments', () => {
  it('stores a comment and a single-level reply, then reads them back', () => {
    const storage = memory();
    const root = post(storage, '主舞台偏左', { id: 'root', now: new Date('2026-10-31T01:00:00Z') });
    expect(root.ok).toBe(true);
    const reply = post(storage, '舞台保持居中', { parentId: 'root', author: '布置', id: 'reply', now: new Date('2026-10-31T02:00:00Z') });
    expect(reply.ok).toBe(true);
    if (!reply.ok) return;
    const nested = post(storage, '再往下说', { parentId: 'reply' });
    expect(nested).toEqual({ ok: false, reason: 'reply-nested' });
    const read = readReviewComments('sample:initial', storage);
    expect(read.lastAuthor).toBe('布置');
    expect(commentThreads(read.comments).map((thread) => [thread.root.body, thread.replies.map((item) => item.body)])).toEqual([
      ['主舞台偏左', ['舞台保持居中']],
    ]);
    expect(storage.getItem(REVIEW_COMMENT_STORAGE_KEY)).toContain('主舞台偏左');
  });

  it('keeps threads for different plans apart', () => {
    const storage = memory();
    expect(post(storage, '甲方案', { planKey: 'link:aaaa', id: 'a' }).ok).toBe(true);
    expect(post(storage, '乙方案', { planKey: 'link:bbbb', id: 'b' }).ok).toBe(true);
    expect(readReviewComments('link:aaaa', storage).comments.map((comment) => comment.body)).toEqual(['甲方案']);
    expect(readReviewComments('link:bbbb', storage).comments.map((comment) => comment.body)).toEqual(['乙方案']);
  });

  it('refuses an empty name, an empty note, a missing parent, and a full plan', () => {
    const storage = memory();
    expect(post(storage, '有意见', { author: '  ' })).toEqual({ ok: false, reason: 'author' });
    expect(post(storage, '   ')).toEqual({ ok: false, reason: 'body' });
    expect(post(storage, '找不到', { parentId: 'missing' })).toEqual({ ok: false, reason: 'reply-target' });
    for (let index = 0; index < REVIEW_COMMENTS_PER_PLAN; index += 1) {
      expect(post(storage, `第${index}条`, { id: `id-${index}` }).ok).toBe(true);
    }
    expect(post(storage, '再多一条', { id: 'overflow' })).toEqual({ ok: false, reason: 'full' });
  });

  it('drops damaged records and replaces them on the next successful comment', () => {
    const storage = memory();
    storage.setItem(REVIEW_COMMENT_STORAGE_KEY, '{');
    expect(readReviewComments('sample:initial', storage)).toEqual({ comments: [], lastAuthor: '' });
    expect(post(storage, '重新留下', { id: 'fresh' }).ok).toBe(true);
    const raw = storage.getItem(REVIEW_COMMENT_STORAGE_KEY) ?? '';
    expect(JSON.parse(raw).byPlan['sample:initial']).toHaveLength(1);
  });

  it('reports a storage failure without pretending the comment was kept', () => {
    const storage = memory();
    storage.setItem = () => { throw new Error('quota'); };
    expect(post(storage, '写不进')).toEqual({ ok: false, reason: 'storage' });
    expect(readReviewComments('sample:initial', storage).comments).toEqual([]);
  });

  it('forgets the oldest other plan once the plan cap is passed', () => {
    const storage = memory();
    for (let index = 0; index < REVIEW_COMMENT_PLANS; index += 1) {
      expect(post(storage, '旧', { planKey: `link:${index}`, id: `old-${index}`, now: new Date(Date.UTC(2026, 0, index + 1)) }).ok).toBe(true);
    }
    expect(post(storage, '新方案', { planKey: 'link:new', id: 'new', now: new Date('2026-12-01T00:00:00Z') }).ok).toBe(true);
    expect(readReviewComments('link:0', storage).comments).toEqual([]);
    expect(readReviewComments('link:new', storage).comments.map((comment: ReviewComment) => comment.body)).toEqual(['新方案']);
    expect(readReviewComments('link:1', storage).comments).toHaveLength(1);
  });
});
