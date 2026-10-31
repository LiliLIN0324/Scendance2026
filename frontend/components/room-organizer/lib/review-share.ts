/**
 * 可评论方案页的存储。
 *
 * 真链 vs 本机演示（本文件就是边界）：
 * - **本机演示**：`issueReviewShare` 把当时的平面摘要写入 `localStorage`
 *   （键 `scendance.reviewShare.v1.<id>`）。评论在 `scendance.reviewComments.v1.<id>`。
 *   打开 `/review/<id>` 只在**创建链接的这台浏览器**里有效。换设备、无痕窗口、
 *   清站点数据都会打不开。不上传，不走 Supabase。
 * - **已有云端只读**：发布后的 `/view#token`（`lib/share-api`）仍是跨设备只读方案，
 *   那边没有这套评论。本模块不替代它。
 * - 快照不含交接单、制作计划、模型地址和底图，避免把内部资料写进评审链接。
 * - **Bingo（收藏 + 状态球）后画界面。** 发评审链接时在本机记下
 *   `saved + needs-review`，供以后的状态球读取。本模块不渲染 Bingo，
 *   也不把晴光换成第二套评审 Agent。
 */
import type { RoomLayout } from './types';

export const REVIEW_SHARE_STORAGE = 'local-demo' as const;

const SHARE_PREFIX = 'scendance.reviewShare.v1.';
const COMMENT_PREFIX = 'scendance.reviewComments.v1.';
const MARK_KEY = 'scendance.reviewMark.v1';
const MAX_MARKS = 40;
const MAX_ITEMS = 240;
const MAX_COMMENTS = 80;
const MAX_TITLE = 80;
const MAX_NAME = 80;
const MAX_AUTHOR = 24;
const MAX_BODY = 500;
const MAX_PAYLOAD = 200_000;

const SHARE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

export interface ReviewPlanItem {
  id: string;
  name: string;
  width: number;
  depth: number;
  height: number;
  color: string;
  /** 场地中心为原点，米。没有落点的物料这两项为 null，只出现在清单里。 */
  x: number | null;
  z: number | null;
  rotation: number;
}

export interface ReviewShareSnapshot {
  id: string;
  title: string;
  createdAt: string;
  /** 场地进深方向的边，对应 RoomLayout.height。 */
  width: number;
  depth: number;
  items: ReviewPlanItem[];
  storage: typeof REVIEW_SHARE_STORAGE;
}

export interface ReviewComment {
  id: string;
  parentId: string | null;
  author: string;
  body: string;
  createdAt: string;
}

/**
 * 创作者侧「这份要审」。Bingo 后刀用收藏和状态球把它画出来。
 * 评审本身发生在 `/review/<id>`，不在创作者左侧模式栏。
 */
export interface ReviewBingoMark {
  saved: true;
  status: 'needs-review';
  projectKey: string;
  title: string;
  shareId: string;
  markedAt: string;
}

export function isReviewShareId(id: string): boolean {
  return SHARE_ID.test(id);
}

export function reviewSharePath(id: string): string {
  return `/review/${id}`;
}

export function reviewShareUrl(origin: string, id: string): string {
  const base = origin.replace(/\/$/, '');
  return `${base}${reviewSharePath(id)}`;
}

/** 从当前布置冻一版给对方看的摘要。后续编辑不会改已发出的链接。 */
export function snapshotFromLayout(layout: RoomLayout): Omit<ReviewShareSnapshot, 'id' | 'createdAt' | 'storage'> {
  const floor = layout.floors[0];
  const items: ReviewPlanItem[] = [];
  for (const item of floor?.items ?? []) {
    if (items.length >= MAX_ITEMS) break;
    const width = finitePositive(item.width);
    const depth = finitePositive(item.depth);
    const height = finitePositive(item.height);
    if (width === null || depth === null || height === null) continue;
    const x = item.position ? finite(item.position.x) : null;
    const z = item.position ? finite(item.position.z) : null;
    items.push({
      id: clip(item.id, 80) || 'item',
      name: clip(item.name, MAX_NAME) || '未命名物料',
      width, depth, height,
      color: HEX_COLOR.test(item.color) ? item.color : '#d7e0d8',
      x, z,
      rotation: finite(item.rotation) ?? 0,
    });
  }
  const width = finitePositive(layout.width) ?? 1;
  const depth = finitePositive(layout.height) ?? 1;
  return { title: clip(layout.name, MAX_TITLE) || '未命名活动', width, depth, items };
}

export function issueReviewShare(layout: RoomLayout, origin: string): { snapshot: ReviewShareSnapshot; url: string } {
  const id = crypto.randomUUID();
  if (!isReviewShareId(id)) throw new Error('评审链接编号无效。');
  const snapshot: ReviewShareSnapshot = {
    ...snapshotFromLayout(layout),
    id,
    createdAt: new Date().toISOString(),
    storage: REVIEW_SHARE_STORAGE,
  };
  writeJson(SHARE_PREFIX + id, snapshot);
  const url = reviewShareUrl(origin, id);
  rememberReviewMark({
    saved: true,
    status: 'needs-review',
    projectKey: clip(layout.id ?? '', 80) || 'local-draft',
    title: snapshot.title,
    shareId: id,
    markedAt: snapshot.createdAt,
  });
  return { snapshot, url };
}

/** 最近一次把这个项目标成待评审的记录。没有发过链接就是 null。 */
export function reviewMarkFor(projectKey: string): ReviewBingoMark | null {
  const key = clip(projectKey, 80);
  return readReviewMarks().find(mark => mark.projectKey === key) ?? null;
}

export function readReviewMarks(): ReviewBingoMark[] {
  const parsed = readJson(MARK_KEY);
  if (!Array.isArray(parsed)) return [];
  const marks: ReviewBingoMark[] = [];
  for (const entry of parsed) {
    const mark = parseMark(entry);
    if (mark) marks.push(mark);
  }
  return marks;
}

export function readReviewShare(id: string): ReviewShareSnapshot | null {
  if (!isReviewShareId(id)) return null;
  const parsed = readJson(SHARE_PREFIX + id);
  return parsed ? parseSnapshot(id, parsed) : null;
}

export function listReviewComments(shareId: string): ReviewComment[] {
  if (!isReviewShareId(shareId)) return [];
  const parsed = readJson(COMMENT_PREFIX + shareId);
  if (!Array.isArray(parsed)) return [];
  const comments: ReviewComment[] = [];
  for (const entry of parsed) {
    const comment = parseComment(entry);
    if (comment) comments.push(comment);
    if (comments.length >= MAX_COMMENTS) break;
  }
  return comments.filter(comment => comment.parentId === null || comments.some(parent => parent.id === comment.parentId && parent.parentId === null));
}

export function addReviewComment(shareId: string, input: { parentId: string | null; author: string; body: string }): ReviewComment {
  if (!readReviewShare(shareId)) throw new Error('这份方案不在本机，评论没有写下。');
  const body = clip(input.body, MAX_BODY);
  if (!body) throw new Error('写一句再发表。');
  const existing = listReviewComments(shareId);
  if (existing.length >= MAX_COMMENTS) throw new Error('评论已满，这条没有写下。');
  const parentId = input.parentId;
  if (parentId !== null) {
    const parent = existing.find(comment => comment.id === parentId);
    if (!parent || parent.parentId !== null) throw new Error('只能回复一条已发表的评论。');
  }
  const comment: ReviewComment = {
    id: crypto.randomUUID(),
    parentId,
    author: clip(input.author, MAX_AUTHOR) || '访客',
    body,
    createdAt: new Date().toISOString(),
  };
  if (!isReviewShareId(comment.id)) throw new Error('评论编号无效。');
  writeJson(COMMENT_PREFIX + shareId, [...existing, comment]);
  return comment;
}

function rememberReviewMark(mark: ReviewBingoMark): void {
  const rest = readReviewMarks().filter(entry => entry.projectKey !== mark.projectKey);
  writeJson(MARK_KEY, [mark, ...rest].slice(0, MAX_MARKS));
}

function parseMark(value: unknown): ReviewBingoMark | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (record.saved !== true || record.status !== 'needs-review') return null;
  if (typeof record.shareId !== 'string' || !isReviewShareId(record.shareId)) return null;
  if (typeof record.projectKey !== 'string' || typeof record.markedAt !== 'string') return null;
  const projectKey = clip(record.projectKey, 80);
  if (!projectKey) return null;
  return {
    saved: true,
    status: 'needs-review',
    projectKey,
    title: typeof record.title === 'string' && clip(record.title, MAX_TITLE) ? clip(record.title, MAX_TITLE) : '未命名活动',
    shareId: record.shareId,
    markedAt: record.markedAt,
  };
}

function parseSnapshot(id: string, value: unknown): ReviewShareSnapshot | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (record.id !== id || record.storage !== REVIEW_SHARE_STORAGE) return null;
  const width = finitePositive(record.width);
  const depth = finitePositive(record.depth);
  const createdAt = typeof record.createdAt === 'string' ? record.createdAt : '';
  if (width === null || depth === null || !createdAt) return null;
  const items: ReviewPlanItem[] = [];
  if (Array.isArray(record.items)) {
    for (const entry of record.items) {
      if (!entry || typeof entry !== 'object') continue;
      const item = entry as Record<string, unknown>;
      const itemWidth = finitePositive(item.width);
      const itemDepth = finitePositive(item.depth);
      const itemHeight = finitePositive(item.height);
      if (typeof item.id !== 'string' || itemWidth === null || itemDepth === null || itemHeight === null) continue;
      items.push({
        id: clip(item.id, 80) || 'item',
        name: typeof item.name === 'string' && clip(item.name, MAX_NAME) ? clip(item.name, MAX_NAME) : '未命名物料',
        width: itemWidth,
        depth: itemDepth,
        height: itemHeight,
        color: typeof item.color === 'string' && HEX_COLOR.test(item.color) ? item.color : '#d7e0d8',
        x: finite(item.x),
        z: finite(item.z),
        rotation: finite(item.rotation) ?? 0,
      });
      if (items.length >= MAX_ITEMS) break;
    }
  }
  return {
    id,
    title: typeof record.title === 'string' && clip(record.title, MAX_TITLE) ? clip(record.title, MAX_TITLE) : '未命名活动',
    createdAt,
    width, depth, items,
    storage: REVIEW_SHARE_STORAGE,
  };
}

function parseComment(value: unknown): ReviewComment | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (typeof record.id !== 'string' || !isReviewShareId(record.id)) return null;
  if (record.parentId !== null && (typeof record.parentId !== 'string' || !isReviewShareId(record.parentId))) return null;
  const body = typeof record.body === 'string' ? clip(record.body, MAX_BODY) : '';
  if (!body || typeof record.createdAt !== 'string') return null;
  return {
    id: record.id,
    parentId: record.parentId,
    author: typeof record.author === 'string' && clip(record.author, MAX_AUTHOR) ? clip(record.author, MAX_AUTHOR) : '访客',
    body,
    createdAt: record.createdAt,
  };
}

function writeJson(key: string, value: unknown): void {
  const json = JSON.stringify(value);
  if (json.length > MAX_PAYLOAD) throw new Error('这份方案太大，评审链接没有生成。');
  try {
    localStorage.setItem(key, json);
  } catch {
    throw new Error('这台浏览器存不下这份评审链接。');
  }
}

function readJson(key: string): unknown {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) as unknown : null;
  } catch {
    return null;
  }
}

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function finitePositive(value: unknown): number | null {
  const number = finite(value);
  return number !== null && number > 0 ? number : null;
}

function clip(value: string, max: number): string {
  return value.replace(/[\u0000-\u001f]/g, '').trim().slice(0, max);
}
