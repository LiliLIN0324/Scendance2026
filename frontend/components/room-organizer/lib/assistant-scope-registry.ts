'use client';
import { readAssistantSessionBodies, writeAssistantSessionBodies, ASSISTANT_SESSION_BODIES_STORAGE_KEY } from './assistant-session-bodies';
import { readAssistantSessionIndex, writeAssistantSessionIndex, ASSISTANT_SESSIONS_STORAGE_KEY } from './assistant-sessions';

/**
 * 会话按活动归属的配套设施（2026-11-13 用户指令「每个项目的聊天历史都自动记住」）。
 *
 * 存储本体早就支持 `…scope.<scope>` 分槽，这里补两件它缺的东西：
 * ① scope → 活动名 的名录（右上角历史按项目分组要显示名字，不能只显示内部 id）；
 * ② 换键迁移：旧版本所有活动共用 `project:<外壳id>` 一份历史，切到活动键时把那份整体搬过去。
 */

export const ASSISTANT_SCOPE_NAMES_KEY = 'scendance.assistant-scope-names.v1';
const MAX_NAMES = 200;

/** 与 hooks/use-assistant-sessions 的 scopedAssistantStorage 同构（那边是 hook 文件，这里不能反向依赖）。 */
function scopedStorage(scope: string): Storage | undefined {
  if (typeof window === 'undefined') return undefined;
  const key = (value: string): string => `${value}.scope.${encodeURIComponent(scope)}`;
  return {
    get length() { return 0; },
    clear() { throw new Error('不支持清空全部会话'); },
    key() { return null; },
    getItem(value: string) { return window.localStorage.getItem(key(value)); },
    setItem(value: string, data: string) { window.localStorage.setItem(key(value), data); },
    removeItem(value: string) { window.localStorage.removeItem(key(value)); },
  } as Storage;
}

export function readScopeNames(): Record<string, string> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(ASSISTANT_SCOPE_NAMES_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === 'string' && value.trim()) out[key] = value.trim().slice(0, 80);
    }
    return out;
  } catch { return {}; }
}

/** 记住「这个 scope 是哪个活动」。名字没变就不写盘，避免每次 render 都动 localStorage。 */
export function rememberScopeName(scope: string, name: string): void {
  if (typeof window === 'undefined') return;
  const trimmed = (name ?? '').trim();
  if (!scope || !trimmed) return;
  const names = readScopeNames();
  if (names[scope] === trimmed.slice(0, 80)) return;
  const next: Record<string, string> = { ...names, [scope]: trimmed.slice(0, 80) };
  const keys = Object.keys(next);
  if (keys.length > MAX_NAMES) for (const key of keys.slice(0, keys.length - MAX_NAMES)) delete next[key];
  try { window.localStorage.setItem(ASSISTANT_SCOPE_NAMES_KEY, JSON.stringify(next)); } catch { /* 配额满就只留在内存的这一轮 */ }
}

/** 换键迁移：目标槽还没有会话、来源槽有会话时，整体搬过去并从来源删除。返回是否搬了。 */
export function adoptScopeHistory(fromScope: string, toScope: string): boolean {
  if (!fromScope || !toScope || fromScope === toScope) return false;
  const from = scopedStorage(fromScope);
  const to = scopedStorage(toScope);
  if (!from || !to) return false;
  if (readAssistantSessionIndex(to)) return false;
  const index = readAssistantSessionIndex(from);
  if (!index || index.sessions.length === 0) return false;
  const bodies = readAssistantSessionBodies(from);
  if (!writeAssistantSessionIndex(index, to)) return false;
  writeAssistantSessionBodies(bodies, to);
  // 确认写进目标槽才清来源；写失败就保留旧副本，宁可留两份也不丢。
  if (!readAssistantSessionIndex(to)) return false;
  try {
    from.removeItem(ASSISTANT_SESSIONS_STORAGE_KEY);
    from.removeItem(ASSISTANT_SESSION_BODIES_STORAGE_KEY);
  } catch { /* 来源清不掉也只是留一份旧副本，不影响当前读取 */ }
  return true;
}

/** `project:<id>` → 「活动名」；名录里没有就用 id 尾号兜底，绝不显示完整内部 id。 */
export function scopeDisplayName(scope: string, names: Record<string, string> = readScopeNames()): string {
  const mapped = names[scope]?.trim();
  if (mapped) return mapped;
  const id = scope.startsWith('project:') ? scope.slice('project:'.length) : scope;
  const tail = id.replace(/[^0-9a-zA-Z]/g, '').slice(-4);
  return tail ? `活动 ${tail}` : '未命名活动';
}