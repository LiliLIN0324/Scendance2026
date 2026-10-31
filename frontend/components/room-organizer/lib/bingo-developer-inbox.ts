/**
 * 开发端 Bingo 收件箱：只读甲方在本机演示里留下的反馈，不打开甲方评审页。
 */
import { commentThreads, readReviewComments, type ReviewThread } from '../../review-share-page/comments';
import { readReviewSharePins } from '../../review-share-page/review-share-pins';

const SHARE_COMMENT_PREFIX = 'scendance.reviewComments.v1.';
const SHARE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface DeveloperFeedbackLine {
  author: string;
  body: string;
}

export interface DeveloperFeedbackSummary {
  /** 顶层意见条数（不含回复） */
  threadCount: number;
  lines: DeveloperFeedbackLine[];
}

export function readDeveloperFeedback(
  storage: Pick<Storage, 'getItem'> | null,
  input: { shareId: string; projectKey: string },
): DeveloperFeedbackSummary {
  if (!storage) return { threadCount: 0, lines: [] };
  for (const planKey of planKeysForMark(input)) {
    const { pins } = readReviewSharePins(planKey, storage);
    if (pins.length > 0) {
      return {
        threadCount: pins.length,
        lines: pins.slice(0, 6).map(pin => ({ author: pin.author, body: pin.text })),
      };
    }
  }
  const shareComments = readShareComments(storage, input.shareId);
  if (shareComments.length > 0) {
    return summarizeShareComments(shareComments);
  }
  for (const planKey of planKeysForMark(input)) {
    const { comments } = readReviewComments(planKey, storage);
    if (comments.length === 0) continue;
    const threads = commentThreads(comments);
    return {
      threadCount: threads.length,
      lines: threads.flatMap(thread => [
        { author: thread.root.author, body: thread.root.body },
        ...thread.replies.map(reply => ({ author: reply.author, body: reply.body })),
      ]).slice(0, 6),
    };
  }
  return { threadCount: 0, lines: [] };
}

function planKeysForMark(input: { shareId: string; projectKey: string }): string[] {
  const keys = new Set<string>();
  if (input.shareId) keys.add(input.shareId);
  if (input.projectKey) keys.add(input.projectKey);
  keys.add(`share:${input.shareId}`);
  return [...keys];
}

function readShareComments(storage: Pick<Storage, 'getItem'>, shareId: string): DeveloperFeedbackLine[] {
  if (!SHARE_ID.test(shareId)) return [];
  try {
    const raw = storage.getItem(SHARE_COMMENT_PREFIX + shareId);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const lines: DeveloperFeedbackLine[] = [];
    for (const entry of parsed) {
      if (!entry || typeof entry !== 'object') continue;
      const record = entry as Record<string, unknown>;
      const author = typeof record.author === 'string' ? record.author : '访客';
      const body = typeof record.body === 'string' ? record.body.trim() : '';
      if (!body) continue;
      lines.push({ author, body });
      if (lines.length >= 6) break;
    }
    return lines;
  } catch {
    return [];
  }
}

function summarizeShareComments(lines: readonly DeveloperFeedbackLine[]): DeveloperFeedbackSummary {
  return { threadCount: lines.length, lines: lines.slice(0, 6) };
}

export function formatFeedbackPreview(threads: ReviewThread[]): DeveloperFeedbackSummary {
  return {
    threadCount: threads.length,
    lines: threads.flatMap(thread => [
      { author: thread.root.author, body: thread.root.body },
      ...thread.replies.map(reply => ({ author: reply.author, body: reply.body })),
    ]).slice(0, 6),
  };
}
