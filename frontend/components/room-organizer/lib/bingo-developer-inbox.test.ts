import { describe, expect, it } from 'vitest';
import { REVIEW_COMMENT_STORAGE_KEY } from '../../review-share-page/comments';
import { readDeveloperFeedback } from './bingo-developer-inbox';

describe('readDeveloperFeedback', () => {
  it('reads share-scoped comments for the developer inbox without opening the client page', () => {
    const shareId = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
    const storage = {
      getItem(key: string) {
        if (key === `scendance.reviewComments.v1.${shareId}`) {
          return JSON.stringify([
            {
              id: '11111111-1111-4111-8111-111111111111',
              parentId: null,
              author: '甲方',
              body: '主舞台偏左',
              createdAt: '2026-10-31T12:00:00.000Z',
            },
          ]);
        }
        return null;
      },
    };
    const summary = readDeveloperFeedback(storage, { shareId, projectKey: 'local-draft' });
    expect(summary.threadCount).toBe(1);
    expect(summary.lines[0]?.body).toBe('主舞台偏左');
  });

  it('falls back to hash-plan comments when share comments are empty', () => {
    const storage = {
      getItem(key: string) {
        if (key !== REVIEW_COMMENT_STORAGE_KEY) return null;
        return JSON.stringify({
          version: 1,
          lastAuthor: '甲方',
          byPlan: {
            'local:house': [
              {
                id: 'c1',
                planKey: 'local:house',
                parentId: null,
                author: '甲方',
                body: '通道太窄',
                createdAt: '2026-10-31T12:00:00.000Z',
              },
            ],
          },
        });
      },
    };
    const summary = readDeveloperFeedback(storage, {
      shareId: 'bbbbbbbb-bbbb-4ccc-8ddd-eeeeeeeeeeee',
      projectKey: 'local:house',
    });
    expect(summary.threadCount).toBe(1);
    expect(summary.lines[0]?.body).toBe('通道太窄');
  });
});
