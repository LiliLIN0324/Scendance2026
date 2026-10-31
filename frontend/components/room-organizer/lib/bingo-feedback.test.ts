// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import { appendReviewComment } from '../../review-share-page/comments';
import { appendReviewSharePin } from '../../review-share-page/share-pins';
import { addReviewComment, issueReviewShare } from './review-share';
import { feedbackSummaryLabel, readBingoPlanFeedback } from './bingo-feedback';
import { readBingoSnapshot, type BingoReadable } from './bingo-status';
import { makeLayout } from './__testfixtures__/fixtures';

const pinDraft = {
  itemId: null,
  x: 1,
  y: 0,
  z: -2,
  offset: null,
  camera: {
    position: [3.4, 2.8, 0.4] as const,
    target: [1, 0, -2] as const,
  },
};

function bucket(seed: Record<string, string> = {}) {
  const map = new Map(Object.entries(seed));
  return {
    getItem(key: string) { return map.get(key) ?? null; },
    setItem(key: string, value: string) { map.set(key, value); },
  } satisfies Pick<Storage, 'getItem' | 'setItem'>;
}

describe('readBingoPlanFeedback', () => {
  it('prefers PR #37 share pins keyed by reviewPlanKey', () => {
    const storage = bucket();
    const planKey = 'link:deadbeef';
    const pinned = appendReviewSharePin(storage, { planKey, text: '通道再宽', draft: pinDraft });
    expect(pinned.ok).toBe(true);
    appendReviewComment(storage, {
      planKey,
      author: '旧侧栏',
      body: '这条不应压过画内钉',
      parentId: null,
    });
    const feedback = readBingoPlanFeedback({
      projectKey: 'local-draft',
      shareId: 'local-draft',
      reviewPlanKey: planKey,
      clientHref: 'http://localhost/review/#layout=x',
    }, storage);
    expect(feedback.sharePinCount).toBe(1);
    expect(feedback.pins[0]?.body).toBe('通道再宽');
    expect(feedback.pins[0]?.source).toBe('share-pin');
    expect(feedbackSummaryLabel(feedback, false)).toBe('甲方 1 条画内钉评');
  });

  it('falls back to legacy sidebar comments only when no share pins exist', () => {
    const storage = bucket();
    appendReviewComment(storage, {
      planKey: 'local-draft',
      author: '客户甲',
      body: '入口再宽一点',
      parentId: null,
    });
    const feedback = readBingoPlanFeedback({
      projectKey: 'local-draft',
      shareId: 'local-draft',
      reviewPlanKey: 'local-draft',
      clientHref: '/review/',
    }, storage);
    expect(feedback.sharePinCount).toBe(0);
    expect(feedback.legacyCount).toBe(1);
    expect(feedback.pins[0]?.source).toBe('legacy-comment');
    expect(feedbackSummaryLabel(feedback, false)).toBe('旧侧栏 1 条（只读兼容）');
  });

  it('reads uuid demo comments only as legacy when no share pins', () => {
    localStorage.clear();
    const layout = makeLayout({ id: 'house-launch' });
    const issued = issueReviewShare(layout, 'http://localhost');
    addReviewComment(issued.snapshot.id, { parentId: null, author: '甲方', body: '舞台再往前' });
    const feedback = readBingoPlanFeedback({
      shareId: issued.snapshot.id,
      projectKey: 'house-launch',
      reviewPlanKey: issued.snapshot.id,
      clientHref: `/review/${issued.snapshot.id}`,
    });
    expect(feedback.sharePinCount).toBe(0);
    expect(feedback.pins[0]?.body).toBe('舞台再往前');
    expect(feedback.pins[0]?.source).toBe('legacy-comment');
  });
});

describe('bingo snapshot with client links', () => {
  it('uses clientUrl and reviewPlanKey on marks for hash review links', () => {
    const storage = bucket() as BingoReadable & { setItem(k: string, v: string): void };
    storage.setItem('scendance.reviewMark.v1', JSON.stringify([{
      saved: true,
      status: 'needs-review',
      projectKey: 'local-draft',
      title: '春季场',
      shareId: 'local-draft',
      markedAt: '2026-10-31T00:00:00.000Z',
      clientUrl: 'http://localhost/review/#layout=abc',
      reviewPlanKey: 'link:0a4b1c2d',
    }]));
    const snapshot = readBingoSnapshot(storage);
    expect(snapshot.plans[0]?.clientHref).toBe('http://localhost/review/#layout=abc');
    expect(snapshot.plans[0]?.reviewPlanKey).toBe('link:0a4b1c2d');
  });
});
