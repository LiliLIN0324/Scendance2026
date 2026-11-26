/**
 * 项目 scope 身份解析与旧桶懒迁移原语（S4 裁定一）。
 *
 * 单一正源：持久桶 / 状态机 / 快照一致性都由外壳 `projectId` 派生 scope，
 * 不再借室内 `layout.id` 配 `'local'` 兜底反推（通道层见 59e86fba）。
 *
 * 懒迁移口径（裁定一）：
 * - 同 id：新键为空 + 旧键有数据 + 旧信封 `projectId` === 当前 projectId，
 *   整份复制到新键；marker 幂等防重放，中断后可安全重试；复制成功旧桶转只读。
 * - 不同 id：绝不并入当前项目，旧数据按原 id 保留只读草稿，不复制。
 * - 新键已有数据：以新键为准，不覆盖、不合并、不报错。
 * - 不抛异常、不弹 UI、不阻塞首帧；存储不可用一律回落 `unavailable`。
 *
 * 本模块只覆盖 localStorage 信封族；IndexedDB sources 等其它持久桶的搬移
 * 在各自存储层内实现，复用这里的 scope 解析与判定口径。
 */

import { outdoorSaveScope } from '../components/room-organizer/lib/outdoor-project-store';

/** 最小存储面：测试用 Map mock 即可满足。 */
export type KeyValueStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** 数据信封键前缀；旧槽与新槽共用同一前缀，仅 scope 段不同。 */
export const SCOPE_DATA_PREFIX = 'scendance:scope-data-v1:';
/** 迁移 marker：记这份新键是从哪个旧槽搬来的，幂等防重放。 */
export const SCOPE_MIGRATION_MARKER_PREFIX = 'scendance:scope-migrated:';
/** 旧桶只读标记：同 id 复制成功后落，供「不同 id」隔离路径判定。 */
export const SCOPE_READONLY_PREFIX = 'scendance:scope-readonly:';

/** 旧槽缺省：未绑定外壳 projectId 的本机草稿槽。 */
export const LEGACY_LOCAL_SCOPE = 'local';

export interface ScopeEnvelope {
  v: 1;
  /** 信封所属项目正源 id；与当前 scope 不符即不同 id，不迁移。 */
  projectId: string;
  payload: unknown;
}

export type MigrationStatus =
  | 'migrated' // 本次完成了一次同 id 复制
  | 'already-migrated' // marker 已在，幂等跳过
  | 'target-has-data' // 新键已有数据，以新键为准，不覆盖
  | 'no-legacy' // 旧槽无可用数据
  | 'different-id' // 旧信封属于别的项目，隔离不并入
  | 'unavailable'; // 存储不可用 / 读写异常，不抛

export interface MigrationResult {
  status: MigrationStatus;
  copied: boolean;
}

function safeDefaultStorage(): KeyValueStorage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** 由 projectId 派生持久/状态 scope 键；纯函数，不读全局。空 id 落默认本机槽。 */
export function resolveProjectScope(projectId: string | null | undefined): string {
  return outdoorSaveScope(projectId);
}

function dataKey(scope: string): string {
  return `${SCOPE_DATA_PREFIX}${scope}`;
}

function markerKey(scope: string): string {
  return `${SCOPE_MIGRATION_MARKER_PREFIX}${scope}`;
}

function readonlyKey(legacyScope: string): string {
  return `${SCOPE_READONLY_PREFIX}${legacyScope}`;
}

function parseEnvelope(raw: string | null): ScopeEnvelope | null {
  if (raw === null) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const record = parsed as Partial<ScopeEnvelope>;
    if (record.v !== 1 || typeof record.projectId !== 'string' || !record.projectId.trim()) return null;
    return { v: 1, projectId: record.projectId, payload: 'payload' in record ? record.payload : null };
  } catch {
    return null;
  }
}

export interface EnsureMigrationOptions {
  /** 旧槽 scope；缺省本机 `'local'` 槽。 */
  legacyScope?: string;
  /** 可注入存储（测试用 Map mock）；缺省 window.localStorage。 */
  storage?: KeyValueStorage | null;
}

/**
 * 同 id 懒迁移：新键空且旧键属于当前项目时整份复制到新键。
 * 幂等：marker 已在则不再复制；先写新键、成功后再落 marker 与旧桶只读标记，
 * 中途失败不留 marker，下次调用安全重试。任何异常回落 `unavailable`，不抛、不提示。
 */
export function ensureScopeMigrated(
  projectId: string | null | undefined,
  options: EnsureMigrationOptions = {},
): MigrationResult {
  const store = options.storage ?? safeDefaultStorage();
  if (!store) return { status: 'unavailable', copied: false };

  const targetScope = resolveProjectScope(projectId);
  const legacyScope = (options.legacyScope ?? LEGACY_LOCAL_SCOPE).trim() || LEGACY_LOCAL_SCOPE;

  try {
    // 幂等：已迁移过，不再复制。
    if (store.getItem(markerKey(targetScope)) !== null) {
      return { status: 'already-migrated', copied: false };
    }

    // 新键已有数据：以新键为准，不覆盖、不合并。
    const targetRaw = store.getItem(dataKey(targetScope));
    if (targetRaw !== null) {
      return { status: 'target-has-data', copied: false };
    }

    const legacyRaw = store.getItem(dataKey(legacyScope));
    const legacy = parseEnvelope(legacyRaw);
    if (!legacy) return { status: 'no-legacy', copied: false };

    // 不同 id：旧草稿属于别的项目，隔离保留，不并入当前项目。
    if (legacy.projectId !== targetScope) {
      return { status: 'different-id', copied: false };
    }

    // 同 id：整份复制到新键。
    store.setItem(dataKey(targetScope), JSON.stringify(legacy));
    // 写回读校验：半成品不落 marker，下次可重试。
    const verify = parseEnvelope(store.getItem(dataKey(targetScope)));
    if (!verify || verify.projectId !== targetScope) {
      return { status: 'unavailable', copied: false };
    }

    // 复制成功：落 marker（记旧槽）+ 旧桶只读标记。
    store.setItem(markerKey(targetScope), legacyScope);
    store.setItem(readonlyKey(legacyScope), '1');
    return { status: 'migrated', copied: true };
  } catch {
    return { status: 'unavailable', copied: false };
  }
}

/** 旧槽是否已转只读；存储异常按未只读处理（保守放行读取）。 */
export function isLegacyScopeReadOnly(
  legacyId: string | null | undefined,
  storage?: KeyValueStorage | null,
): boolean {
  const store = storage ?? safeDefaultStorage();
  if (!store) return false;
  const legacyScope = (legacyId ?? '').trim();
  if (!legacyScope) return false;
  try {
    return store.getItem(readonlyKey(legacyScope)) === '1';
  } catch {
    return false;
  }
}
