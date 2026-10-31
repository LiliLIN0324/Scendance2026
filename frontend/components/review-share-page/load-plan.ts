/**
 * 可评论方案页读哪一份平面。
 *
 * 进入方式：`/review/#layout=…`。`#layout=` 片段与编辑器 `encodeShareUrl` 相同，
 * 路径必须是 `/review/`。同一片段若落在 `/` 或 `/editor`，会打开完整工作台。
 * 没有片段时，先读本机当前布置（`scendance-editor-local-v1`）；都没有，或 `?demo=1`，用示例场地。
 * 片段在但解不开时停在错误，不改显另一份方案。
 */

import { STORAGE_KEY } from '../room-organizer/lib/constants';
import { INITIAL_LAYOUT } from '../room-organizer/lib/initial-layout';
import { parseStoredLayout } from '../room-organizer/lib/schema';
import { isShareHash, readShareHash } from '../room-organizer/lib/share';
import type { RoomLayout } from '../room-organizer/lib/types';

export const REVIEW_SHARE_PATH = '/review/';

export const REVIEW_PLAN_NOTICES = {
  link: '这是分享链接里的方案快照。此页只读，可查看平面并评论。',
  local: '这是这台浏览器当前保存的布置。对方要看同一份，请打开 /review/#layout= 评审链接。',
  sample: '没有分享快照，也没有本机布置。先展示示例场地，方便试用评论。',
} as const;

export const REVIEW_PLAN_ERRORS = {
  'too-large': '这条评审链接太长，页面没有打开其中的方案。请让分享者重新生成链接。',
  unreadable: '这条评审链接里的方案读不出来。请让分享者重新复制完整链接。',
} as const;

export type ReviewPlanSource = keyof typeof REVIEW_PLAN_NOTICES;

export interface LoadedReviewPlan {
  source: ReviewPlanSource;
  layout: RoomLayout;
  planKey: string;
  notice: string;
}

export type LoadReviewPlanResult =
  | { ok: true; plan: LoadedReviewPlan }
  | { ok: false; reason: keyof typeof REVIEW_PLAN_ERRORS };

/** 分享菜单用：绝对 origin + 已有 `#layout=` 片段 → 对方打开的评审页。 */
export function reviewShareHref(origin: string, layoutHash: string): string | null {
  if (!isShareHash(layoutHash)) return null;
  try {
    const base = new URL(origin);
    return `${base.origin}${REVIEW_SHARE_PATH}${layoutHash}`;
  } catch {
    return null;
  }
}

export function readLocalReviewLayout(storage: Pick<Storage, 'getItem'> | null): RoomLayout | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return parseStoredLayout(JSON.parse(raw));
  } catch {
    return null;
  }
}

export async function loadReviewPlan(input: {
  hash: string;
  search: string;
  localLayout: RoomLayout | null;
}): Promise<LoadReviewPlanResult> {
  if (isShareHash(input.hash)) {
    const decoded = await readShareHash(input.hash);
    if (!decoded.ok) return { ok: false, reason: decoded.reason };
    return {
      ok: true,
      plan: {
        source: 'link',
        layout: decoded.layout,
        planKey: `link:${fnv1a(input.hash)}`,
        notice: REVIEW_PLAN_NOTICES.link,
      },
    };
  }
  const demo = new URLSearchParams(input.search.replace(/^\?/, '')).get('demo') === '1';
  if (!demo && input.localLayout) {
    return {
      ok: true,
      plan: {
        source: 'local',
        layout: input.localLayout,
        planKey: localPlanKey(input.localLayout),
        notice: REVIEW_PLAN_NOTICES.local,
      },
    };
  }
  return {
    ok: true,
    plan: {
      source: 'sample',
      layout: INITIAL_LAYOUT,
      planKey: 'sample:initial',
      notice: REVIEW_PLAN_NOTICES.sample,
    },
  };
}

export function localPlanKey(layout: RoomLayout): string {
  const id = layout.id?.trim() ?? '';
  if (/^[A-Za-z0-9-]{8,64}$/.test(id)) return `local:${id}`;
  return `local:${fnv1a(contentFingerprint(layout))}`;
}

function contentFingerprint(layout: RoomLayout): string {
  const floors = layout.floors.map((floor) => `${floor.id}:${floor.items.map((item) => item.id).join(',')}`).join('|');
  return `${layout.name}\n${layout.width}\n${layout.height}\n${floors}`;
}

function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
