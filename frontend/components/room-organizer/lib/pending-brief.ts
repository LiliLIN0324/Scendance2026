/**
 * 无地点设计句的待恢复槽。
 *
 * 用户口径（2026-11-16）：地图优先——地点没定就先退回选址。但这句话不能只留在
 * 聊天气泡里：选完地点、确认范围之后，要能把它接回来继续做。
 *
 * 这里只负责「按活动存取与校验」，不决定什么时候接回；接回时机由工作流掌握。
 * 键按 scope 隔离，换活动读不到别的活动的句子；超过有效期视为过期，不静默复用。
 */

export type PendingBrief = {
  /** 用户原话，未改写。 */
  text: string;
  /** 写入时间（毫秒），用于过期判断。 */
  at: number;
  /** 写入时的阶段，便于接回时判断是否还需要。 */
  stage: string;
};

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_TEXT = 500;

function key(scope: string): string {
  return `scendance:outdoor-pending-brief:${scope}`;
}

function store(): Storage | null {
  try {
    if (typeof localStorage === "undefined") return null;
    return localStorage;
  } catch {
    return null;
  }
}

/** 只收「有实际内容、且没超长」的句子；空白句不占槽。 */
export function normalizeBriefText(text: string): string | null {
  const trimmed = text.replace(/\s+/g, " ").trim();
  if (!trimmed) return null;
  return trimmed.slice(0, MAX_TEXT);
}

export function writePendingBrief(
  scope: string,
  text: string,
  stage: string,
  now: number = Date.now(),
): PendingBrief | null {
  const normalized = normalizeBriefText(text);
  if (!scope || !normalized) return null;
  const value: PendingBrief = { text: normalized, at: now, stage };
  const storage = store();
  if (!storage) return null;
  try {
    storage.setItem(key(scope), JSON.stringify(value));
    return value;
  } catch {
    return null;
  }
}

export function readPendingBrief(
  scope: string,
  now: number = Date.now(),
  ttlMs: number = DEFAULT_TTL_MS,
): PendingBrief | null {
  const storage = store();
  if (!storage || !scope) return null;
  let raw: string | null = null;
  try {
    raw = storage.getItem(key(scope));
  } catch {
    return null;
  }
  if (!raw) return null;
  let value: PendingBrief | null = null;
  try {
    value = JSON.parse(raw) as PendingBrief | null;
  } catch {
    return null;
  }
  if (
    !value ||
    typeof value.text !== "string" ||
    typeof value.at !== "number" ||
    !Number.isFinite(value.at) ||
    typeof value.stage !== "string"
  )
    return null;
  const normalized = normalizeBriefText(value.text);
  if (!normalized) return null;
  if (now - value.at > ttlMs) return null;
  return { text: normalized, at: value.at, stage: value.stage };
}

export function clearPendingBrief(scope: string): void {
  const storage = store();
  if (!storage || !scope) return;
  try {
    storage.removeItem(key(scope));
  } catch {}
}
