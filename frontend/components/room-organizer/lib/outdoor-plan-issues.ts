/**
 * 户外方案问题的跨面板总线。
 *
 * 问题清单原本只活在 `outdoor-plan-canvas.tsx` 的「规划信息」四页签里；
 * 创作者 Bingo 要变成审校台，就必须拿到同一份问题，并能请求画布飞过去。
 * 这里发布问题快照和已落实的场地层计数（供 Bingo 订阅），并转发单条定位请求（供画布执行）。
 * 不重新计算问题，也不另存第二份真相。
 */

export interface OutdoorPlanIssue {
  /** 画布内的稳定键；同一次渲染内唯一。 */
  key: string;
  /** 面向创作者的一句话，已含对象名与原因。 */
  text: string;
  /** 定位锚点（方案本地米）。缺省 = 当前楼层算不出来，消费方不要拿它飞视图。 */
  anchor?: { x: number; y: number };
  color?: string;
  facilityId?: string;
}

export type OutdoorPlanIssueSnapshot = readonly OutdoorPlanIssue[];

/** 已画上的场地层。Bingo「已落实」只读这一份，不另算红线、分区和动线。 */
export interface OutdoorPlanSettled {
  boundaryClosed: boolean;
  zoneCount: number;
  routeCount: number;
}

const EMPTY: OutdoorPlanIssueSnapshot = Object.freeze([]);
const EMPTY_SETTLED: OutdoorPlanSettled = Object.freeze({ boundaryClosed: false, zoneCount: 0, routeCount: 0 });
let snapshot: OutdoorPlanIssueSnapshot = EMPTY;
let settled: OutdoorPlanSettled = EMPTY_SETTLED;
const listeners = new Set<() => void>();

/** 两个锚点是否相同（缺省也算一种取值，不能直接比字段）。 */
function sameAnchor(a?: { x: number; y: number }, b?: { x: number; y: number }): boolean {
  if (!a || !b) return !a && !b;
  return a.x === b.x && a.y === b.y;
}

/** 发布当前问题快照；内容没变就不通知，避免 Bingo 每次重渲染。 */
export function publishOutdoorPlanIssues(next: OutdoorPlanIssueSnapshot): void {
  const cleaned = next.filter(issue => issue.key && issue.text);
  const same = cleaned.length === snapshot.length && cleaned.every((issue, index) => {
    const previous = snapshot[index];
    return previous !== undefined
      && previous.key === issue.key
      && previous.text === issue.text
      && sameAnchor(previous.anchor, issue.anchor);
  });
  if (same) return;
  snapshot = Object.freeze(cleaned.map(issue => ({
    ...issue,
    ...(issue.anchor ? { anchor: { ...issue.anchor } } : {}),
  })));
  for (const listener of listeners) listener();
}

export function publishOutdoorPlanSettled(next: OutdoorPlanSettled): void {
  if (
    settled.boundaryClosed === next.boundaryClosed
    && settled.zoneCount === next.zoneCount
    && settled.routeCount === next.routeCount
  ) return;
  settled = Object.freeze({
    boundaryClosed: next.boundaryClosed,
    zoneCount: next.zoneCount,
    routeCount: next.routeCount,
  });
  for (const listener of listeners) listener();
}

export function getOutdoorPlanSettled(): OutdoorPlanSettled {
  return settled;
}

export function clearOutdoorPlanIssues(): void {
  if (snapshot.length === 0 && settled === EMPTY_SETTLED) return;
  snapshot = EMPTY;
  settled = EMPTY_SETTLED;
  for (const listener of listeners) listener();
}

export function subscribeOutdoorPlanIssues(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function getOutdoorPlanIssues(): OutdoorPlanIssueSnapshot {
  return snapshot;
}

export const OUTDOOR_PLAN_ISSUE_FOCUS_EVENT = 'scendance:outdoor-plan-issue-focus';

/** Bingo 点一条问题 → 画布居中并选中对应实体。 */
export function requestOutdoorPlanIssueFocus(key: string): void {
  if (typeof window === 'undefined' || !key) return;
  window.dispatchEvent(new CustomEvent(OUTDOOR_PLAN_ISSUE_FOCUS_EVENT, { detail: { key } }));
}

export const OUTDOOR_PLAN_POINT_FOCUS_EVENT = 'scendance:outdoor-plan-point-focus';

/** Bingo 点一条户外钉 → 画布居中到钉的 ENU 锚点。 */
export function requestOutdoorPlanPointFocus(x: number, y: number): void {
  if (typeof window === 'undefined' || !Number.isFinite(x) || !Number.isFinite(y)) return;
  window.dispatchEvent(new CustomEvent(OUTDOOR_PLAN_POINT_FOCUS_EVENT, { detail: { x, y } }));
}

export function onOutdoorPlanPointFocus(handler: (point: { x: number; y: number }) => void): () => void {
  if (typeof window === 'undefined') return () => undefined;
  const listener = (event: Event) => {
    const detail = (event as CustomEvent<{ x?: unknown; y?: unknown }>).detail;
    if (typeof detail?.x === 'number' && typeof detail.y === 'number' && Number.isFinite(detail.x) && Number.isFinite(detail.y)) {
      handler({ x: detail.x, y: detail.y });
    }
  };
  window.addEventListener(OUTDOOR_PLAN_POINT_FOCUS_EVENT, listener);
  return () => window.removeEventListener(OUTDOOR_PLAN_POINT_FOCUS_EVENT, listener);
}

export function onOutdoorPlanIssueFocus(handler: (key: string) => void): () => void {
  if (typeof window === 'undefined') return () => undefined;
  const listener = (event: Event) => {
    const key = (event as CustomEvent<{ key?: unknown }>).detail?.key;
    if (typeof key === 'string' && key) handler(key);
  };
  window.addEventListener(OUTDOOR_PLAN_ISSUE_FOCUS_EVENT, listener);
  return () => window.removeEventListener(OUTDOOR_PLAN_ISSUE_FOCUS_EVENT, listener);
}
