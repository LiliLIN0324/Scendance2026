/**
 * 创作者 Bingo 侧：只读汇总甲方反馈。
 *
 * **主来源**：PR #37 `/review` 画内钉（`scendance-review-share-pins-v1`）。
 * **兼容**：旧侧栏 `comments.ts` / UUID 演示评论，只读、仅在无钉时回落。
 */

import { commentThreads, readReviewComments } from '../../review-share-page/comments';
import { readReviewSharePins } from '../../review-share-page/share-pins';
import { reviewPlanKeyForClientUrl } from '../../review-share-page/load-plan';
import { isReviewShareId, listReviewComments } from './review-share';
import type { ReviewPin } from './review-pins';
import type { BingoPlan } from './bingo-status';

export type BingoFeedbackSource = 'share-pin' | 'legacy-comment';

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
  source: BingoFeedbackSource;
  pinStatus?: 'open' | 'resolved';
  placement?: string;
}

export interface BingoPlanFeedback {
  /** 甲方画内钉条数（含 open/resolved）。 */
  sharePinCount: number;
  /** 旧侧栏评论条数，仅兼容。 */
  legacyCount: number;
  pinCount: number;
  pins: BingoFeedbackPin[];
}

export function reviewPlanKeysForBingoPlan(plan: Pick<BingoPlan, 'projectKey' | 'shareId' | 'reviewPlanKey' | 'clientHref'>): string[] {
  const keys = new Set<string>();
  if (plan.reviewPlanKey) keys.add(plan.reviewPlanKey);
  if (plan.projectKey) keys.add(plan.projectKey);
  if (plan.shareId) keys.add(plan.shareId);
  const fromUrl = reviewPlanKeyForClientUrl(plan.clientHref);
  if (fromUrl) keys.add(fromUrl);
  return [...keys];
}

export function readBingoPlanFeedback(
  plan: Pick<BingoPlan, 'projectKey' | 'shareId' | 'reviewPlanKey' | 'clientHref'>,
  storage: Pick<Storage, 'getItem'> | null = typeof window !== 'undefined' ? window.localStorage : null,
): BingoPlanFeedback {
  const sharePins = new Map<string, BingoFeedbackPin>();
  for (const key of reviewPlanKeysForBingoPlan(plan)) {
    for (const pin of readReviewSharePins(key, storage)) {
      sharePins.set(`${key}:${pin.id}`, mapSharePin(pin));
    }
  }
  const primary = [...sharePins.values()];
  if (primary.length > 0) {
    primary.sort((a, b) => a.body.localeCompare(b.body, 'zh-CN'));
    return {
      sharePinCount: primary.length,
      legacyCount: 0,
      pinCount: primary.length,
      pins: primary,
    };
  }

  const legacy = readLegacyComments(plan, storage);
  const legacyCount = legacy.reduce((sum, pin) => sum + 1 + pin.replies.length, 0);
  return {
    sharePinCount: 0,
    legacyCount,
    pinCount: legacyCount,
    pins: legacy,
  };
}

export function feedbackSummaryLabel(feedback: BingoPlanFeedback, returned: boolean): string {
  if (feedback.sharePinCount > 0) {
    return `甲方 ${feedback.sharePinCount} 条画内钉评`;
  }
  if (feedback.legacyCount > 0) {
    return `旧侧栏 ${feedback.legacyCount} 条（只读兼容）`;
  }
  if (returned) return '甲方已点完成，暂无钉评';
  return '还没有甲方钉评';
}

function mapSharePin(pin: ReviewPin): BingoFeedbackPin {
  const placement = pin.itemId ? `物件 ${pin.itemId}` : `地面 (${Math.round(pin.x * 10) / 10}, ${Math.round(pin.z * 10) / 10})`;
  return {
    id: pin.id,
    author: '甲方钉评',
    body: pin.text,
    createdAt: '',
    replies: [],
    source: 'share-pin',
    pinStatus: pin.status,
    placement,
  };
}

function readLegacyComments(
  plan: Pick<BingoPlan, 'projectKey' | 'shareId' | 'clientHref'>,
  storage: Pick<Storage, 'getItem'> | null,
): BingoFeedbackPin[] {
  const pins = new Map<string, BingoFeedbackPin>();

  if (isReviewShareId(plan.shareId)) {
    for (const pin of threadFromShareComments(plan.shareId)) {
      pins.set(pin.id, pin);
    }
  }

  for (const key of reviewPlanKeysForBingoPlan(plan)) {
    for (const pin of threadFromPageComments(key, storage)) {
      if (!pins.has(pin.id)) pins.set(pin.id, pin);
    }
  }

  return [...pins.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

function threadFromPageComments(planKey: string, storage: Pick<Storage, 'getItem'> | null): BingoFeedbackPin[] {
  const { comments } = readReviewComments(planKey, storage);
  if (comments.length === 0) return [];
  return commentThreads(comments).map(thread => ({
    id: thread.root.id,
    author: thread.root.author,
    body: thread.root.body,
    createdAt: thread.root.createdAt,
    replies: thread.replies.map(reply => ({
      author: reply.author,
      body: reply.body,
      createdAt: reply.createdAt,
    })),
    source: 'legacy-comment' as const,
  }));
}

function threadFromShareComments(shareId: string): BingoFeedbackPin[] {
  const comments = listReviewComments(shareId);
  if (comments.length === 0) return [];
  const roots = comments.filter(comment => comment.parentId === null);
  return roots.map(root => ({
    id: root.id,
    author: root.author,
    body: root.body,
    createdAt: root.createdAt,
    source: 'legacy-comment' as const,
    replies: comments
      .filter(reply => reply.parentId === root.id)
      .map(reply => ({ author: reply.author, body: reply.body, createdAt: reply.createdAt })),
  }));
}

export function formatFeedbackTime(iso: string): string {
  if (!iso) return '';
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
