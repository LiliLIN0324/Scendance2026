/**
 * 创作者 Bingo 侧：只读汇总甲方在本机留下的钉评 / 回复。
 * 不写评论、不完成评审；那是 `/review` 甲方页的事。
 */

import { commentThreads, readReviewComments, type ReviewComment as PageComment } from '../../review-share-page/comments';
import { listReviewComments, isReviewShareId, type ReviewComment as ShareComment } from './review-share';
import type { BingoPlan } from './bingo-status';

export interface BingoFeedbackReply {
  author: string;
  body: string;
  createdAt: string;
}

export interface BingoFeedbackPin {
  id: string;
  author: string;
  body: string;
  createdAt: string;
  replies: BingoFeedbackReply[];
}

export interface BingoPlanFeedback {
  pinCount: number;
  pins: BingoFeedbackPin[];
}

export function readBingoPlanFeedback(plan: Pick<BingoPlan, 'shareId' | 'projectKey'>, storage: Pick<Storage, 'getItem'> | null = typeof window !== 'undefined' ? window.localStorage : null): BingoPlanFeedback {
  const pins = new Map<string, BingoFeedbackPin>();

  for (const pin of pinsFromShareComments(plan.shareId)) {
    pins.set(pin.id, pin);
  }

  for (const key of feedbackPlanKeys(plan)) {
    for (const pin of pinsFromPageComments(key, storage)) {
      if (!pins.has(pin.id)) pins.set(pin.id, pin);
    }
  }

  const list = [...pins.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const pinCount = list.reduce((sum, pin) => sum + 1 + pin.replies.length, 0);
  return { pinCount, pins: list };
}

export function feedbackSummaryLabel(feedback: BingoPlanFeedback, returned: boolean): string {
  if (feedback.pinCount > 0) return `甲方 ${feedback.pinCount} 条反馈`;
  if (returned) return '甲方已点完成，暂无文字';
  return '还没有甲方反馈';
}

function feedbackPlanKeys(plan: Pick<BingoPlan, 'shareId' | 'projectKey'>): string[] {
  const keys = new Set<string>();
  if (plan.projectKey) keys.add(plan.projectKey);
  if (plan.shareId) keys.add(plan.shareId);
  return [...keys];
}

function pinsFromShareComments(shareId: string): BingoFeedbackPin[] {
  if (!isReviewShareId(shareId)) return [];
  const comments = listReviewComments(shareId);
  if (comments.length === 0) return [];
  return threadFromFlat(comments);
}

function threadFromFlatPage(comments: readonly PageComment[]): BingoFeedbackPin[] {
  return commentThreads(comments).map(thread => ({
    id: thread.root.id,
    author: thread.root.author,
    body: thread.root.body,
    createdAt: thread.root.createdAt,
    replies: thread.replies.map(reply => ({ author: reply.author, body: reply.body, createdAt: reply.createdAt })),
  }));
}

function pinsFromPageComments(planKey: string, storage: Pick<Storage, 'getItem'> | null): BingoFeedbackPin[] {
  const { comments } = readReviewComments(planKey, storage);
  if (comments.length === 0) return [];
  return threadFromFlatPage(comments);
}

function threadFromFlat(comments: readonly ShareComment[]): BingoFeedbackPin[] {
  const roots = comments.filter(comment => comment.parentId === null);
  return roots.map(root => ({
    id: root.id,
    author: root.author,
    body: root.body,
    createdAt: root.createdAt,
    replies: comments
      .filter(reply => reply.parentId === root.id)
      .map(reply => ({ author: reply.author, body: reply.body, createdAt: reply.createdAt })),
  }));
}


export function formatFeedbackTime(iso: string): string {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return iso.slice(0, 16).replace('T', ' ');
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(date);
}
