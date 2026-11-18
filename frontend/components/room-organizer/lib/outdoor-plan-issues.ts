/**
 * 户外方案问题的跨面板总线。
 *
 * 问题清单原本只活在 `outdoor-plan-canvas.tsx` 的「规划信息」四页签里；
 * 创作者 Bingo 要变成审校台，就必须拿到同一份问题，并能请求画布飞过去。
 * 这里只做两件事：发布快照（供 Bingo 订阅）与转发单条定位请求（供画布执行），
 * 不重新计算问题，也不另存第二份真相。
 */

export interface OutdoorPlanIssue {
  /** 画布内的稳定键；同一次渲染内唯一。 */
  key: string;
  /** 面向创作者的一句话，已含对象名与原因。 */
  text: string;
  /** 定位锚点（方案本地米）。 */
  anchor: { x: number; y: number };
  color?: string;
  facilityId?: string;
}

export type OutdoorPlanIssueSnapshot = readonly OutdoorPlanIssue[];

const EMPTY: OutdoorPlanIssueSnapshot = Object.freeze([]);
let snapshot: OutdoorPlanIssueSnapshot = EMPTY;
const listeners = new Set<() => void>();

/** 发布当前问题快照；内容没变就不通知，避免 Bingo 每次重渲染。 */
export function publishOutdoorPlanIssues(next: OutdoorPlanIssueSnapshot): void {
  const cleaned = next.filter(issue => issue.key && issue.text);
  const same = cleaned.length === snapshot.length && cleaned.every((issue, index) => {
    const previous = snapshot[index];
    return previous !== undefined
      && previous.key === issue.key
      && previous.text === issue.text
      && previous.anchor.x === issue.anchor.x
      && previous.anchor.y === issue.anchor.y;
  });
  if (same) return;
  snapshot = Object.freeze(cleaned.map(issue => ({ ...issue, anchor: { ...issue.anchor } })));
  for (const listener of listeners) listener();
}

export function clearOutdoorPlanIssues(): void {
  if (snapshot.length === 0) return;
  snapshot = EMPTY;
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

export function onOutdoorPlanIssueFocus(handler: (key: string) => void): () => void {
  if (typeof window === 'undefined') return () => undefined;
  const listener = (event: Event) => {
    const key = (event as CustomEvent<{ key?: unknown }>).detail?.key;
    if (typeof key === 'string' && key) handler(key);
  };
  window.addEventListener(OUTDOOR_PLAN_ISSUE_FOCUS_EVENT, listener);
  return () => window.removeEventListener(OUTDOOR_PLAN_ISSUE_FOCUS_EVENT, listener);
}
