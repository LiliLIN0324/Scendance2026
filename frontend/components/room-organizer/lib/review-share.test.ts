// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { addReviewComment, forgetReviewLinkMark, issueReviewShare, listReviewComments, readReviewShare, reviewMarkFor, REVIEW_SHARE_STORAGE } from './review-share';
import type { RoomLayout } from './types';

function layout(): RoomLayout {
  return {
    id: 'house-launch',
    name: '发布会',
    width: 12,
    height: 9,
    floors: [{
      id: 'floor',
      name: '一层',
      floorColor: '#fff',
      items: [{
        id: 'desk',
        type: 'table',
        name: '签到桌',
        width: 1.6,
        depth: 0.6,
        height: 0.75,
        color: '#c4a574',
        icon: 'table',
        position: { x: 1, z: -2 },
        rotation: 0,
        handoff: { ownerName: '现场甲', dueDate: '2026-10-09', acceptance: '内部', status: 'todo', evidenceUrls: [], evidenceNote: '不要进评审链接' },
      }],
    }],
    productionPlan: { schemaVersion: 1 } as RoomLayout['productionPlan'],
    floorPlanImage: 'data:image/png;base64,secret',
  };
}

describe('review share local demo', () => {
  it('freezes a same-browser snapshot without internal handoff data', () => {
    const issued = issueReviewShare(layout(), 'https://studio.example');
    expect(issued.snapshot.storage).toBe(REVIEW_SHARE_STORAGE);
    expect(issued.url).toBe(`https://studio.example/review/${issued.snapshot.id}`);
    expect(issued.snapshot).toMatchObject({ title: '发布会', width: 12, depth: 9 });
    expect(issued.snapshot.items[0]).toMatchObject({ name: '签到桌', x: 1, z: -2 });
    expect(JSON.stringify(issued.snapshot)).not.toContain('现场甲');
    expect(JSON.stringify(issued.snapshot)).not.toContain('floorPlanImage');
    expect(readReviewShare(issued.snapshot.id)?.title).toBe('发布会');
    expect(readReviewShare('not-a-uuid')).toBeNull();
    expect(reviewMarkFor('house-launch')).toMatchObject({
      saved: true,
      status: 'needs-review',
      shareId: issued.snapshot.id,
      title: '发布会',
    });
  });

  it('stores a comment and one reply on that snapshot', () => {
    const { snapshot } = issueReviewShare(layout(), 'http://localhost');
    const comment = addReviewComment(snapshot.id, { parentId: null, author: '甲方', body: '入口再宽一点' });
    const reply = addReviewComment(snapshot.id, { parentId: comment.id, author: '', body: '下版改通道' });
    expect(reply.author).toBe('访客');
    expect(reply.parentId).toBe(comment.id);
    expect(listReviewComments(snapshot.id).map(entry => entry.body)).toEqual(['入口再宽一点', '下版改通道']);
    expect(() => addReviewComment(snapshot.id, { parentId: reply.id, author: '甲', body: '再套一层' })).toThrow(/只能回复/);
  });
});

describe('review link local mark cleanup', () => {
  const MARK_KEY = 'scendance.reviewMark.v1';
  function mark(projectKey: string, clientUrl: string) {
    return {
      saved: true,
      status: 'needs-review' as const,
      projectKey,
      title: '发布会',
      shareId: projectKey,
      markedAt: '2026-11-20T00:00:00.000Z',
      clientUrl,
      reviewPlanKey: `review-v2:${projectKey}`,
      versionBinding: 'sha256-v1',
    };
  }

  it('removes only the matching project and link after revocation', () => {
    localStorage.clear();
    const target = mark('project-1', 'https://studio.example/r/abcdef1234567890abcdef12');
    const otherLink = mark('project-1', 'https://studio.example/r/111111111111111111111111');
    const otherProject = mark('project-2', 'https://studio.example/r/222222222222222222222222');
    localStorage.setItem(MARK_KEY, JSON.stringify([target, otherLink, otherProject]));

    forgetReviewLinkMark('project-1', target.clientUrl);
    let rest = JSON.parse(localStorage.getItem(MARK_KEY)!) as typeof target[];
    expect(rest.map(entry => entry.clientUrl)).toEqual([otherLink.clientUrl, otherProject.clientUrl]);

    forgetReviewLinkMark('project-1');
    rest = JSON.parse(localStorage.getItem(MARK_KEY)!) as typeof target[];
    expect(rest.map(entry => entry.projectKey)).toEqual(['project-2']);
  });
});
