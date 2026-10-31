// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import { appendReviewComment } from '../../review-share-page/comments';
import { addReviewComment, issueReviewShare } from './review-share';
import { feedbackSummaryLabel, readBingoPlanFeedback } from './bingo-feedback';
import { readBingoSnapshot, type BingoReadable } from './bingo-status';
import { makeLayout } from './__testfixtures__/fixtures';

function bucket(seed: Record<string, string> = {}) {
  const map = new Map(Object.entries(seed));
  return {
    getItem(key: string) { return map.get(key) ?? null; },
    setItem(key: string, value: string) { map.set(key, value); },
  } satisfies Pick<Storage, 'getItem' | 'setItem'>;
}

describe('readBingoPlanFeedback', () => {
  it('reads hash-review comments for the creator project key', () => {
    const storage = bucket();
    const result = appendReviewComment(storage, {
      planKey: 'local-draft',
      author: '客户甲',
      body: '入口再宽一点',
      parentId: null,
    });
    expect(result.ok).toBe(true);
    const feedback = readBingoPlanFeedback({ shareId: 'local-draft', projectKey: 'local-draft' }, storage);
    expect(feedback.pinCount).toBe(1);
    expect(feedback.pins[0]?.body).toBe('入口再宽一点');
    expect(feedbackSummaryLabel(feedback, false)).toBe('甲方 1 条反馈');
  });

  it('reads uuid demo share comments for issueReviewShare plans', () => {
    localStorage.clear();
    const layout = makeLayout({ id: 'house-launch' });
    const issued = issueReviewShare(layout, 'http://localhost');
    addReviewComment(issued.snapshot.id, { parentId: null, author: '甲方', body: '舞台再往前' });
    const feedback = readBingoPlanFeedback({ shareId: issued.snapshot.id, projectKey: 'house-launch' });
    expect(feedback.pinCount).toBe(1);
    expect(feedback.pins[0]?.body).toBe('舞台再往前');
  });
});

describe('bingo snapshot with client links', () => {
  it('uses clientUrl on marks for hash review links', () => {
    const storage = bucket() as BingoReadable & { setItem(k: string, v: string): void };
    storage.setItem('scendance.reviewMark.v1', JSON.stringify([{
      saved: true,
      status: 'needs-review',
      projectKey: 'local-draft',
      title: '春季场',
      shareId: 'local-draft',
      markedAt: '2026-10-31T00:00:00.000Z',
      clientUrl: 'http://localhost/review/#layout=abc',
    }]));
    const snapshot = readBingoSnapshot(storage);
    expect(snapshot.plans[0]?.clientHref).toBe('http://localhost/review/#layout=abc');
  });
});
