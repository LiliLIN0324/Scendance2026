/**
 * 观景位书签（纯函数，零 three 依赖）。
 *
 * 客户评审时最常问的不是"能不能再走一圈"，而是"把刚才那个角度再给我看一眼"。
 * 这里把一个机位（位置 + 朝向 + 视角档 + 名字）编成一段可贴进链接的短串：
 *
 *   https://…/view/#wspot1.eyJuIjoi…      （分享页 / 工作台都能读）
 *
 * 只存必要字段、做范围校验；解析失败一律返回 null，不抛异常——坏链接不该让
 * 整个查看器白屏。
 */
import type { WalkViewMode } from './walk-view-modes';

export const WALK_SPOT_PREFIX = 'wspot1.';
/** 单份方案最多存几个观景位（面板上限，避免本地存储越滚越大）。 */
export const MAX_WALK_SPOTS = 12;
const MAX_NAME_LENGTH = 40;

export interface WalkSpot {
  name: string;
  /** 世界系（x 东、z = −北，米）。 */
  x: number;
  z: number;
  /** 朝向角（弧度）：0 = 朝 +z（南）。 */
  yaw: number;
  /** 俯仰（弧度，可选）。 */
  pitch?: number;
  /** 进入这个书签时用哪一档视角。 */
  view?: WalkViewMode;
}

function base64UrlEncode(text: string): string {
  const binary = unescape(encodeURIComponent(text));
  return globalThis.btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlDecode(text: string): string {
  const padded = text.replace(/-/g, '+').replace(/_/g, '/');
  const binary = globalThis.atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
  return decodeURIComponent(escape(binary));
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/** 机位 → 可贴进链接的短串。 */
export function encodeWalkSpot(spot: WalkSpot): string {
  const payload = {
    n: (spot.name || '观景位').slice(0, MAX_NAME_LENGTH),
    x: Math.round(spot.x * 100) / 100,
    z: Math.round(spot.z * 100) / 100,
    y: Math.round(spot.yaw * 1000) / 1000,
    ...(finite(spot.pitch) ? { p: Math.round(spot.pitch * 1000) / 1000 } : {}),
    ...(spot.view ? { v: spot.view } : {}),
  };
  return WALK_SPOT_PREFIX + base64UrlEncode(JSON.stringify(payload));
}

/** 短串 → 机位；解析失败返回 null（坏链接不该炸掉页面）。 */
export function decodeWalkSpot(token: string): WalkSpot | null {
  if (typeof token !== 'string' || !token.startsWith(WALK_SPOT_PREFIX)) return null;
  const body = token.slice(WALK_SPOT_PREFIX.length).trim();
  if (!body) return null;
  let payload: unknown;
  try {
    payload = JSON.parse(base64UrlDecode(body));
  } catch {
    return null;
  }
  if (!payload || typeof payload !== 'object') return null;
  const record = payload as Record<string, unknown>;
  if (!finite(record.x) || !finite(record.z) || !finite(record.y)) return null;
  const view = record.v;
  const allowedViews: WalkViewMode[] = ['orbit', 'first', 'third', 'shoulder'];
  return {
    name: typeof record.n === 'string' && record.n.trim() ? record.n.trim().slice(0, MAX_NAME_LENGTH) : '观景位',
    x: record.x,
    z: record.z,
    yaw: record.y,
    ...(finite(record.p) ? { pitch: record.p } : {}),
    ...(typeof view === 'string' && allowedViews.includes(view as WalkViewMode) ? { view: view as WalkViewMode } : {}),
  };
}

/** 从任意 hash / URL 里取机位（支持 `#wspot1…` 和带前缀的完整 URL）。 */
export function readWalkSpotFromHash(hash: string): WalkSpot | null {
  if (typeof hash !== 'string' || !hash) return null;
  const index = hash.indexOf(WALK_SPOT_PREFIX);
  if (index < 0) return null;
  return decodeWalkSpot(hash.slice(index).split('&')[0]!);
}

/** 把机位写成分享链接；不覆盖原有 query。 */
export function walkSpotUrl(href: string, spot: WalkSpot): string {
  const base = href.split('#')[0]!;
  return `${base}#${encodeWalkSpot(spot)}`;
}

/**
 * 存一个新机位：同名覆盖、超出上限丢最旧的。
 * 返回新数组，不改入参（便于 React 状态更新）。
 */
export function upsertWalkSpot(spots: readonly WalkSpot[], spot: WalkSpot): WalkSpot[] {
  const name = (spot.name || '观景位').slice(0, MAX_NAME_LENGTH);
  const rest = spots.filter((item) => item.name !== name);
  const next = [...rest, { ...spot, name }];
  return next.length > MAX_WALK_SPOTS ? next.slice(next.length - MAX_WALK_SPOTS) : next;
}

export function removeWalkSpot(spots: readonly WalkSpot[], name: string): WalkSpot[] {
  return spots.filter((item) => item.name !== name);
}
