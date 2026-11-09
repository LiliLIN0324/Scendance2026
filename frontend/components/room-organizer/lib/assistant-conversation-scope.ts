/**
 * 把活动、存储位置和账号分开编码。
 * 没有可信账号的旧键保持原样：不改写归属，也不提供删除。
 * 尚未接入会话列表或面板。见 docs/plans/2026-11-09-需求版本与跨轮记忆草案.md。
 */

const PREFIX = 'conv:v1:';

export interface AccountConversationScope {
  activityScope: string;
  store: string;
  actorId: string;
}

export function assistantConversationScope(activityScope: string, store: string, actorId: string | null): string {
  if (typeof activityScope !== 'string' || !activityScope.trim() || activityScope === 'legacy') throw new Error('INVALID_ACTIVITY_SCOPE');
  if (typeof store !== 'string' || !store.trim()) throw new Error('INVALID_STORE');
  if (actorId === null || actorId === undefined || !actorId.trim()) return activityScope;
  return `${PREFIX}${encodeURIComponent(activityScope)}:${encodeURIComponent(store)}:${encodeURIComponent(actorId)}`;
}

export function parseAccountConversationScope(scope: string): AccountConversationScope | null {
  if (typeof scope !== 'string' || !scope.startsWith(PREFIX)) return null;
  const parts = scope.slice(PREFIX.length).split(':');
  if (parts.length !== 3) return null;
  try {
    const activityScope = decodeURIComponent(parts[0] ?? '');
    const store = decodeURIComponent(parts[1] ?? '');
    const actorId = decodeURIComponent(parts[2] ?? '');
    if (!activityScope || !store || !actorId) return null;
    return {activityScope, store, actorId};
  } catch {
    return null;
  }
}

export function isAccountConversationScope(scope: string): boolean {
  return parseAccountConversationScope(scope) !== null;
}

/** 只认同一存储位置上的同一账号。活动不同仍算同一所有者；无主旧键永远不匹配。 */
export function sameConversationOwner(left: string, right: string): boolean {
  const a = parseAccountConversationScope(left);
  const b = parseAccountConversationScope(right);
  if (!a || !b) return false;
  return a.store === b.store && a.actorId === b.actorId;
}

export function visiblePeerScopes(current: string, discovered: readonly string[]): string[] {
  return discovered.filter(scope => scope !== current && sameConversationOwner(current, scope));
}

/** 无主键只被点名保留。adopt / delete 都不会改写或移除调用方手里的键。 */
export function unownedHistoryAction(action: 'adopt' | 'delete' | 'retain'): {allowed: boolean; effect: 'none'} {
  return {allowed: action === 'retain', effect: 'none'};
}

export function retainedUnownedScopes(scopes: readonly string[]): string[] {
  return scopes.filter(scope => !isAccountConversationScope(scope));
}
