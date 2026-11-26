import { describe, expect, it } from 'vitest';
import {
  ensureScopeMigrated,
  isLegacyScopeReadOnly,
  resolveProjectScope,
  SCOPE_DATA_PREFIX,
  SCOPE_MIGRATION_MARKER_PREFIX,
  LEGACY_LOCAL_SCOPE,
  type KeyValueStorage,
} from './project-scope';

function memoryStorage(initial: Record<string, string> = {}): KeyValueStorage & { map: Map<string, string> } {
  const map = new Map<string, string>(Object.entries(initial));
  return {
    map,
    getItem: (key: string) => (map.has(key) ? (map.get(key) as string) : null),
    setItem: (key: string, value: string) => { map.set(key, value); },
    removeItem: (key: string) => { map.delete(key); },
  };
}

function envelope(projectId: string, payload: unknown = { note: 'draft' }): string {
  return JSON.stringify({ v: 1, projectId, payload });
}

describe('resolveProjectScope', () => {
  it('透传已给的 projectId 并去空白', () => {
    expect(resolveProjectScope('  house-abc123 ')).toBe('house-abc123');
  });
  it('空 id 回落本机默认槽', () => {
    expect(resolveProjectScope('')).toBe(LEGACY_LOCAL_SCOPE);
    expect(resolveProjectScope(null)).toBe(LEGACY_LOCAL_SCOPE);
    expect(resolveProjectScope(undefined)).toBe(LEGACY_LOCAL_SCOPE);
  });
});

describe('ensureScopeMigrated', () => {
  it('① 无旧键：不复制、不落新键、不写 marker', () => {
    const store = memoryStorage();
    const result = ensureScopeMigrated('p1', { storage: store });
    expect(result).toEqual({ status: 'no-legacy', copied: false });
    expect(store.map.size).toBe(0);
  });

  it('② 同 id：复制一次，二次调用幂等不重复，旧桶转只读', () => {
    const legacyKey = `${SCOPE_DATA_PREFIX}${LEGACY_LOCAL_SCOPE}`;
    const store = memoryStorage({ [legacyKey]: envelope('p1', { seats: 40 }) });

    const first = ensureScopeMigrated('p1', { storage: store });
    expect(first).toEqual({ status: 'migrated', copied: true });

    const targetKey = `${SCOPE_DATA_PREFIX}p1`;
    const written = JSON.parse(store.getItem(targetKey) as string);
    expect(written.projectId).toBe('p1');
    expect(written.payload).toEqual({ seats: 40 });
    expect(store.getItem(`${SCOPE_MIGRATION_MARKER_PREFIX}p1`)).toBe(LEGACY_LOCAL_SCOPE);
    expect(isLegacyScopeReadOnly(LEGACY_LOCAL_SCOPE, store)).toBe(true);

    // 二次调用：marker 已在，幂等跳过，不再复制。
    const second = ensureScopeMigrated('p1', { storage: store });
    expect(second).toEqual({ status: 'already-migrated', copied: false });
    expect(store.map.get(targetKey)).toBe(store.map.get(targetKey));
  });

  it('③ 不同 id：不复制、旧键仍可读、不进当前项目、旧桶不标只读', () => {
    const legacyKey = `${SCOPE_DATA_PREFIX}${LEGACY_LOCAL_SCOPE}`;
    const store = memoryStorage({ [legacyKey]: envelope('other-house', { seats: 12 }) });

    const result = ensureScopeMigrated('p1', { storage: store });
    expect(result).toEqual({ status: 'different-id', copied: false });

    // 新键未写、无 marker。
    expect(store.getItem(`${SCOPE_DATA_PREFIX}p1`)).toBe(null);
    expect(store.getItem(`${SCOPE_MIGRATION_MARKER_PREFIX}p1`)).toBe(null);
    // 旧草稿原样保留、可读，未转只读。
    expect(JSON.parse(store.getItem(legacyKey) as string).projectId).toBe('other-house');
    expect(isLegacyScopeReadOnly(LEGACY_LOCAL_SCOPE, store)).toBe(false);
  });

  it('④ 新键已有数据：不覆盖、不合并、不报错', () => {
    const targetKey = `${SCOPE_DATA_PREFIX}p1`;
    const legacyKey = `${SCOPE_DATA_PREFIX}${LEGACY_LOCAL_SCOPE}`;
    const store = memoryStorage({
      [targetKey]: envelope('p1', { seats: 99, fresh: true }),
      [legacyKey]: envelope('p1', { seats: 1, stale: true }),
    });

    const result = ensureScopeMigrated('p1', { storage: store });
    expect(result).toEqual({ status: 'target-has-data', copied: false });
    const kept = JSON.parse(store.getItem(targetKey) as string);
    expect(kept.payload).toEqual({ seats: 99, fresh: true });
  });

  it('旧槽坏数据按无旧键处理，不抛异常', () => {
    const legacyKey = `${SCOPE_DATA_PREFIX}${LEGACY_LOCAL_SCOPE}`;
    const store = memoryStorage({ [legacyKey]: '{not-json' });
    const result = ensureScopeMigrated('p1', { storage: store });
    expect(result.status).toBe('no-legacy');
    expect(result.copied).toBe(false);
  });

  it('存储不可用回落 unavailable，不抛异常', () => {
    const result = ensureScopeMigrated('p1', { storage: null });
    expect(result).toEqual({ status: 'unavailable', copied: false });
  });
});

describe('isLegacyScopeReadOnly', () => {
  it('无标记返回 false，存储异常保守返回 false', () => {
    const store = memoryStorage();
    expect(isLegacyScopeReadOnly('local', store)).toBe(false);
    expect(isLegacyScopeReadOnly(undefined, store)).toBe(false);
    expect(isLegacyScopeReadOnly('local', null)).toBe(false);
  });
});
