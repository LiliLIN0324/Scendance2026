/**
 * 可评论方案页的评论存储。
 *
 * 演示持久化：全部写在本机 localStorage，键名 `REVIEW_COMMENT_STORAGE_KEY`。
 * 刷新后仍在；不写 Supabase，不跨设备。损坏的 JSON 读成空记录，下一次成功发表会整键替换。
 * 每份方案最多 80 条，最多保留 40 份方案（按最近一条评论的时间丢掉更旧的方案）。
 * 回复只挂在顶层评论下，不能再回复一条回复。
 */

export const REVIEW_COMMENT_STORAGE_KEY = 'scendance-review-share-comments-v1';
export const REVIEW_COMMENT_AUTHOR_MAX = 24;
export const REVIEW_COMMENT_BODY_MAX = 500;
export const REVIEW_COMMENTS_PER_PLAN = 80;
export const REVIEW_COMMENT_PLANS = 40;

export interface ReviewComment {
  id: string;
  planKey: string;
  parentId: string | null;
  author: string;
  body: string;
  createdAt: string;
}

export interface ReviewThread {
  root: ReviewComment;
  replies: ReviewComment[];
}

export type ReviewCommentFailure =
  | 'author'
  | 'body'
  | 'reply-target'
  | 'reply-nested'
  | 'full'
  | 'storage'
  | 'plan';

export type AppendReviewCommentResult =
  | { ok: true; comments: ReviewComment[]; comment: ReviewComment; lastAuthor: string }
  | { ok: false; reason: ReviewCommentFailure };

interface CommentFile {
  version: 1;
  lastAuthor: string;
  byPlan: Record<string, ReviewComment[]>;
}

type CommentStore = Pick<Storage, 'getItem' | 'setItem'>;

const emptyFile = (): CommentFile => ({ version: 1, lastAuthor: '', byPlan: {} });

export function readReviewComments(
  planKey: string,
  storage: Pick<Storage, 'getItem'> | null,
): { comments: ReviewComment[]; lastAuthor: string } {
  const file = parseFile(storage?.getItem(REVIEW_COMMENT_STORAGE_KEY) ?? null);
  return { comments: file.byPlan[planKey] ?? [], lastAuthor: file.lastAuthor };
}

export function commentThreads(comments: readonly ReviewComment[]): ReviewThread[] {
  const roots = comments.filter((comment) => comment.parentId === null).sort(byTime);
  return roots.map((root) => ({
    root,
    replies: comments.filter((comment) => comment.parentId === root.id).sort(byTime),
  }));
}

export function appendReviewComment(
  storage: CommentStore,
  input: {
    planKey: string;
    author: string;
    body: string;
    parentId: string | null;
    now?: Date;
    id?: string;
  },
): AppendReviewCommentResult {
  if (!input.planKey || input.planKey.length > 80) return { ok: false, reason: 'plan' };
  const author = cleanText(input.author, REVIEW_COMMENT_AUTHOR_MAX);
  const body = cleanText(input.body, REVIEW_COMMENT_BODY_MAX);
  if (!author) return { ok: false, reason: 'author' };
  if (!body) return { ok: false, reason: 'body' };

  let file: CommentFile;
  try {
    file = parseFile(storage.getItem(REVIEW_COMMENT_STORAGE_KEY));
  } catch {
    return { ok: false, reason: 'storage' };
  }
  const existing = file.byPlan[input.planKey] ?? [];
  if (existing.length >= REVIEW_COMMENTS_PER_PLAN) return { ok: false, reason: 'full' };
  if (input.parentId) {
    const parent = existing.find((comment) => comment.id === input.parentId);
    if (!parent) return { ok: false, reason: 'reply-target' };
    if (parent.parentId !== null) return { ok: false, reason: 'reply-nested' };
  }

  const comment: ReviewComment = {
    id: input.id ?? newCommentId(),
    planKey: input.planKey,
    parentId: input.parentId,
    author,
    body,
    createdAt: (input.now ?? new Date()).toISOString(),
  };
  const byPlan = evictPlans(
    { ...file.byPlan, [input.planKey]: [...existing, comment] },
    input.planKey,
  );
  const next: CommentFile = { version: 1, lastAuthor: author, byPlan };
  try {
    storage.setItem(REVIEW_COMMENT_STORAGE_KEY, JSON.stringify(next));
  } catch {
    return { ok: false, reason: 'storage' };
  }
  return { ok: true, comments: byPlan[input.planKey] ?? [], comment, lastAuthor: author };
}

function cleanText(value: string, max: number): string | null {
  const text = value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim();
  if (!text || [...text].length > max) return null;
  return text;
}

function byTime(left: ReviewComment, right: ReviewComment): number {
  return left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id);
}

function newCommentId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function parseFile(raw: string | null): CommentFile {
  if (!raw) return emptyFile();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return emptyFile();
  }
  if (!parsed || typeof parsed !== 'object') return emptyFile();
  const record = parsed as Record<string, unknown>;
  if (record.version !== 1 || !record.byPlan || typeof record.byPlan !== 'object') return emptyFile();
  const byPlan: Record<string, ReviewComment[]> = {};
  for (const [planKey, value] of Object.entries(record.byPlan as Record<string, unknown>)) {
    if (!planKey || planKey.length > 80 || !Array.isArray(value)) continue;
    const comments = value.filter(isComment).filter((comment) => comment.planKey === planKey).slice(0, REVIEW_COMMENTS_PER_PLAN);
    const ids = new Set(comments.map((comment) => comment.id));
    byPlan[planKey] = comments.filter((comment) => comment.parentId === null || (ids.has(comment.parentId) && comments.some((parent) => parent.id === comment.parentId && parent.parentId === null)));
  }
  const lastAuthor = typeof record.lastAuthor === 'string' ? cleanText(record.lastAuthor, REVIEW_COMMENT_AUTHOR_MAX) ?? '' : '';
  return { version: 1, lastAuthor, byPlan };
}

function isComment(value: unknown): value is ReviewComment {
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  return typeof row.id === 'string' && row.id.length > 0 && row.id.length <= 80
    && typeof row.planKey === 'string'
    && (row.parentId === null || (typeof row.parentId === 'string' && row.parentId.length > 0 && row.parentId.length <= 80))
    && typeof row.author === 'string' && [...row.author].length >= 1 && [...row.author].length <= REVIEW_COMMENT_AUTHOR_MAX
    && typeof row.body === 'string' && [...row.body].length >= 1 && [...row.body].length <= REVIEW_COMMENT_BODY_MAX
    && typeof row.createdAt === 'string' && Number.isFinite(Date.parse(row.createdAt));
}

function evictPlans(byPlan: Record<string, ReviewComment[]>, keep: string): Record<string, ReviewComment[]> {
  const keys = Object.keys(byPlan);
  if (keys.length <= REVIEW_COMMENT_PLANS) return byPlan;
  const ranked = keys
    .filter((key) => key !== keep)
    .sort((left, right) => latest(byPlan[left]) - latest(byPlan[right]) || left.localeCompare(right));
  const drop = new Set(ranked.slice(0, keys.length - REVIEW_COMMENT_PLANS));
  const next: Record<string, ReviewComment[]> = {};
  for (const key of keys) {
    if (!drop.has(key)) next[key] = byPlan[key] ?? [];
  }
  return next;
}

function latest(comments: ReviewComment[] | undefined): number {
  if (!comments || comments.length === 0) return 0;
  return comments.reduce((stamp, comment) => Math.max(stamp, Date.parse(comment.createdAt) || 0), 0);
}
