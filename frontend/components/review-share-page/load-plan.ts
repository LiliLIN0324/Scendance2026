/**
 * 可评论方案页读哪一份平面。
 *
 * 三种进入方式：
 * - `/r/<code>`：短链，从 Supabase 取回整份快照（发给客户的地址）；
 * - `/review/#review=<code>`：旧短链，同样取回快照；
 * - `/review/#layout=…`：长链，与编辑器 `encodeShareUrl` 相同，快照就在 URL 里。
 * 没有片段时，先读本机当前布置（`scendance-editor-local-v1`）；都没有，或 `?demo=1`，用示例场地。
 * 片段在但解不开时停在错误，不改显另一份方案。
 */

import { STORAGE_KEY } from '../room-organizer/lib/constants';
import { INITIAL_LAYOUT } from '../room-organizer/lib/initial-layout';
import { createSharingExample } from '../room-organizer/lib/sharing-example';
import { parseStoredLayout } from '../room-organizer/lib/schema';
import { isShareHash, readShareHash, readSharePayload, type ReadPlanShareIdentity } from '../room-organizer/lib/share';
import { readReviewLink, reviewCodeFromHash, reviewCodeFromPath, reviewShortHref } from './review-link-cloud';
import { parseReviewAccess, type ReviewAccess } from './review-access';
import type { RoomLayout } from '../room-organizer/lib/types';
import type { SitePlanData } from '../../../supabase/functions/_shared/site-plan';

export const REVIEW_SHARE_PATH = '/review/';

export const REVIEW_PLAN_NOTICES = {
  link: '分享链接里的方案快照，只读。',
  local: '这台浏览器当前保存的布置。',
  sample: '示例场地，可试用落钉。',
} as const;

export const REVIEW_PLAN_ERRORS = {
  'too-large': '链接太长，没打开方案，请重新生成。',
  unreadable: '方案读不出来，请复制完整链接。',
  'not-found': '短链已失效，请重新获取。',
  offline: '暂时读不到，请检查网络后重试。',
} as const;

export type ReviewPlanSource = keyof typeof REVIEW_PLAN_NOTICES;

export interface LoadedReviewPlan {
  source: ReviewPlanSource;
  layout: RoomLayout;
  planKey: string;
  notice: string;
  /** 链接绑定的交付版本身份（SC-10）；旧链接与本机方案没有这一段。 */
  identity: ReadPlanShareIdentity | null;
  /** 链接携带的户外规划；旧链接与本机方案没有这一段。 */
  outdoorPlan?: SitePlanData | null | undefined;
  /** 这条评审对应的规范长哈希；短链从服务端取回，Bingo 回执与钉版本都按它对齐。 */
  shareHash: string | null;
  /** 短链上的发送权限。长链与本机方案没有这一段，按全部允许处理。 */
  reviewAccess: ReviewAccess;
}

export type LoadReviewPlanResult =
  | { ok: true; plan: LoadedReviewPlan }
  | { ok: false; reason: keyof typeof REVIEW_PLAN_ERRORS };

/** 分享菜单用：有短码就给 `/r/<code>`。没有短码时不要拿来生成客户链接。 */
export function reviewShareHref(origin: string, layoutHash: string, shortCode?: string | null): string | null {
  if (!isShareHash(layoutHash)) return null;
  try {
    const base = new URL(origin);
    if (shortCode) return reviewShortHref(base.origin, shortCode);
    return `${base.origin}${REVIEW_SHARE_PATH}${layoutHash}`;
  } catch {
    return null;
  }
}

/** 与 `/review/#layout=` 页 `loadReviewPlan` 使用的 planKey 一致，供 Bingo 对齐甲方钉。 */
export function reviewPlanKeyForShareHash(hash: string): string | null {
  if (!isShareHash(hash)) return null;
  return `link:${fnv1a(hash)}`;
}

export function reviewPlanKeyForClientUrl(url: string): string | null {
  try {
    return reviewPlanKeyForShareHash(new URL(url).hash);
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
  pathname?: string;
  localLayout: RoomLayout | null;
}): Promise<LoadReviewPlanResult> {
  const code = reviewCodeFromPath(input.pathname ?? '') ?? reviewCodeFromHash(input.hash);
  if (code) {
    const record = await readReviewLink(code);
    if (!record.ok) {
      return { ok: false, reason: record.reason === 'not-found' || record.reason === 'bad-response' ? 'not-found' : 'offline' };
    }
    const decoded = await readSharePayload(record.value.payload);
    if (!decoded.ok) return { ok: false, reason: decoded.reason };
    const reviewAccess = parseReviewAccess(
      record.value.payload && typeof record.value.payload === 'object'
        ? (record.value.payload as { reviewAccess?: unknown }).reviewAccess
        : undefined,
    );
    return {
      ok: true,
      plan: {
        source: 'link',
        layout: decoded.layout,
        planKey: `link:${fnv1a(record.value.longHash)}`,
        notice: REVIEW_PLAN_NOTICES.link,
        identity: decoded.identity,
        outdoorPlan: decoded.outdoor,
        shareHash: record.value.longHash,
        reviewAccess,
      },
    };
  }
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
        identity: decoded.identity,
        outdoorPlan: decoded.outdoor,
        shareHash: input.hash,
        reviewAccess: parseReviewAccess(undefined),
      },
    };
  }
  const query=new URLSearchParams(input.search.replace(/^\?/, ''));
  const example=query.get('example');
  if(example==='sharing') {
    const layout=createSharingExample({...INITIAL_LAYOUT,name:'分享会示例（虚构）'});
    return {ok:true,plan:{source:'sample',layout,planKey:'sample:sharing',notice:'虚构示例场地，轮廓与物料均为示意。',identity:null,shareHash:null,reviewAccess:parseReviewAccess(undefined)}};
  }
  if(example==='hall-d5') {
    const layout:RoomLayout={name:'Hall D5 尺寸参考（示意）',width:16.5,height:17.2,
      floors:[{id:'hall-d5-example',name:'场地轮廓（示意）',floorColor:'#f5f6f7',items:[]}]};
    return {ok:true,plan:{source:'sample',layout,planKey:'sample:hall-d5',notice:'尺寸参考官网标称，轮廓仅为示意。门位、门宽、开启方向、通道及现场条件未知，未作消防或无障碍验收。',identity:null,shareHash:null,reviewAccess:parseReviewAccess(undefined)}};
  }
  const demo = query.get('demo') === '1';
  if (!demo && input.localLayout) {
    return {
      ok: true,
      plan: {
        source: 'local',
        layout: input.localLayout,
        planKey: localPlanKey(input.localLayout),
        notice: REVIEW_PLAN_NOTICES.local,
        identity: null,
        shareHash: null,
        reviewAccess: parseReviewAccess(undefined),
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
      identity: null,
      shareHash: null,
      reviewAccess: parseReviewAccess(undefined),
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
