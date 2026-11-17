import {
  listSourceRecords,
  readSourceRecord,
  updateSourceForm,
} from './source-storage';

/**
 * 每个项目一份本机缓存。
 *
 * 设计口径（2026-11-17 项目生命周期整改）：
 * - 缓存的身份是 projectId，不是“当前画布”。草稿只是 origin=local 的项目状态。
 * - 打开项目先读缓存再拉云；保存成功、自动保存、新建成功、打开成功都回写。
 * - 删除项目把缓存移入回收站，7 天后清理；回收站恢复只能恢复场景，不恢复云端身份。
 * - 缓存是尽力而为：存储不可用、超额、数据损坏都只返回 null/false，绝不阻断主流程。
 *
 * 存储复用已有的 IndexedDB forms（source-storage），键为 [namespace, projectId]，
 * 这样不需要再开一套数据库，也能沿用现有的写入串行化与配额错误处理。
 */

const CACHE_NAMESPACE = 'project-cache';
const TRASH_NAMESPACE = 'project-trash';

/** 最多保留 20 个项目；超出按 cachedAt 最旧淘汰。 */
export const PROJECT_CACHE_LIMIT = 20;
/** 单个项目缓存上限，超过则放弃缓存并保留云端为准。 */
export const PROJECT_CACHE_MAX_BYTES = 6 * 1024 * 1024;
/** 全部缓存上限，超过先淘汰最旧的项目。 */
export const PROJECT_CACHE_TOTAL_BYTES = 60 * 1024 * 1024;
/** 回收站保留 7 天。 */
export const PROJECT_TRASH_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface ProjectCacheEntry {
  projectId: string;
  /** 从本机活动升上云时保留的原活动 id，用于把旧草稿/资料接回来。 */
  localId?: string;
  studioId?: string;
  name: string;
  /** 云端版本；本机项目为 null。 */
  revision: number | null;
  scene: unknown;
  /** 项目内容最后变化时间（毫秒）。 */
  updatedAt: number;
  /** 写入缓存的时间（毫秒），LRU 依据。 */
  cachedAt: number;
  /** 场景 JSON 的字符数，用于配额控制。 */
  bytes: number;
}

export interface TrashedProjectCacheEntry extends ProjectCacheEntry {
  deletedAt: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function finiteTime(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function sceneBytes(scene: unknown): number {
  try {
    return JSON.stringify(scene)?.length ?? 0;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

export function isProjectCacheEntry(value: unknown, expectedId?: string): value is ProjectCacheEntry {
  if (!isRecord(value)) return false;
  if (typeof value.projectId !== 'string' || !value.projectId) return false;
  if (expectedId && value.projectId !== expectedId) return false;
  if (typeof value.name !== 'string') return false;
  if (value.revision !== null && (typeof value.revision !== 'number' || !Number.isSafeInteger(value.revision) || value.revision < 0)) return false;
  if (!finiteTime(value.updatedAt) || !finiteTime(value.cachedAt)) return false;
  if (!Number.isSafeInteger(value.bytes) || (value.bytes as number) < 0) return false;
  if (value.localId !== undefined && typeof value.localId !== 'string') return false;
  if (value.studioId !== undefined && typeof value.studioId !== 'string') return false;
  if (value.scene === undefined) return false;
  return true;
}

function normalize(input: Omit<ProjectCacheEntry, 'bytes' | 'cachedAt'> & Partial<Pick<ProjectCacheEntry, 'cachedAt'>>): ProjectCacheEntry | null {
  const bytes = sceneBytes(input.scene);
  if (!Number.isFinite(bytes) || bytes > PROJECT_CACHE_MAX_BYTES) return null;
  const cachedAt = input.cachedAt && finiteTime(input.cachedAt) ? input.cachedAt : Date.now();
  const entry: ProjectCacheEntry = {
    projectId: input.projectId,
    name: input.name,
    revision: input.revision,
    scene: input.scene,
    updatedAt: finiteTime(input.updatedAt) ? input.updatedAt : cachedAt,
    cachedAt,
    bytes,
  };
  if (input.localId) entry.localId = input.localId;
  if (input.studioId) entry.studioId = input.studioId;
  return isProjectCacheEntry(entry) ? entry : null;
}

/** 纯函数：给定现有缓存和上限，返回应当淘汰的 projectId（最旧优先）。 */
export function selectProjectCacheEvictions(entries: ProjectCacheEntry[], limit = PROJECT_CACHE_LIMIT): string[] {
  const sorted = [...entries].sort((a, b) => a.cachedAt - b.cachedAt);
  const evictions: string[] = [];
  let total = sorted.reduce((sum, entry) => sum + entry.bytes, 0);
  while (sorted.length - evictions.length > Math.max(1, limit) || total > PROJECT_CACHE_TOTAL_BYTES) {
    const oldest = sorted[evictions.length];
    if (!oldest) break;
    evictions.push(oldest.projectId);
    total -= oldest.bytes;
  }
  return evictions;
}

export function isTrashExpired(entry: Pick<TrashedProjectCacheEntry, 'deletedAt'>, now = Date.now()): boolean {
  return !finiteTime(entry.deletedAt) || now - entry.deletedAt >= PROJECT_TRASH_TTL_MS;
}

export async function readProjectCache(projectId: string): Promise<ProjectCacheEntry | null> {
  if (!projectId) return null;
  try {
    const value = await readSourceRecord<unknown>([CACHE_NAMESPACE, projectId]);
    return isProjectCacheEntry(value, projectId) ? value : null;
  } catch {
    return null;
  }
}

export async function listProjectCache(): Promise<ProjectCacheEntry[]> {
  try {
    const records = await listSourceRecords<unknown>(CACHE_NAMESPACE);
    return records.map(record => record.value).filter((value): value is ProjectCacheEntry => isProjectCacheEntry(value));
  } catch {
    return [];
  }
}

/** 本机活动 id → 云项目：挂云后的同一份内容只保留一个项目身份。 */
export async function findProjectCacheByLocalId(localId: string): Promise<ProjectCacheEntry | null> {
  if (!localId) return null;
  const entries = await listProjectCache();
  return entries.find(entry => entry.localId === localId) ?? null;
}

export async function putProjectCache(
  input: Omit<ProjectCacheEntry, 'bytes' | 'cachedAt'> & Partial<Pick<ProjectCacheEntry, 'cachedAt'>>,
): Promise<boolean> {
  const entry = normalize(input);
  if (!entry) return false;
  try {
    await updateSourceForm([CACHE_NAMESPACE, entry.projectId], () => entry);
  } catch {
    return false;
  }
  try {
    const all = await listProjectCache();
    const evictions = selectProjectCacheEvictions(all);
    await Promise.all(evictions.filter(id => id !== entry.projectId).map(id => removeProjectCache(id)));
  } catch {
    // 淘汰失败不影响本次写入。
  }
  return true;
}

export async function removeProjectCache(projectId: string): Promise<void> {
  if (!projectId) return;
  try {
    await updateSourceForm([CACHE_NAMESPACE, projectId], () => undefined);
  } catch {
    // 缓存清理是尽力而为。
  }
}

export async function moveProjectCacheToTrash(projectId: string, deletedAt = Date.now()): Promise<void> {
  const entry = await readProjectCache(projectId);
  if (!entry) return;
  try {
    await updateSourceForm([TRASH_NAMESPACE, projectId], () => ({ ...entry, deletedAt } satisfies TrashedProjectCacheEntry));
  } catch {
    return;
  }
  await removeProjectCache(projectId);
}

/** 恢复云端项目时把本机副本放回缓存；只恢复场景，不恢复云端版本。 */
export async function restoreProjectCache(projectId: string): Promise<void> {
  if (!projectId) return;
  try {
    const entry = await readSourceRecord<unknown>([TRASH_NAMESPACE, projectId]);
    if (!isTrashedEntry(entry, projectId)) return;
    const { deletedAt: _deletedAt, ...restored } = entry;
    await putProjectCache(restored);
    await removeProjectTrash(projectId);
  } catch {
    // 恢复缓存是尽力而为。
  }
}

function isTrashedEntry(value: unknown, expectedId?: string): value is TrashedProjectCacheEntry {
  return isProjectCacheEntry(value, expectedId) && isRecord(value) && finiteTime(value.deletedAt);
}

export async function listProjectTrash(now = Date.now()): Promise<TrashedProjectCacheEntry[]> {
  try {
    const records = await listSourceRecords<unknown>(TRASH_NAMESPACE);
    const entries = records.map(record => record.value).filter((value): value is TrashedProjectCacheEntry => isTrashedEntry(value));
    const expired = entries.filter(entry => isTrashExpired(entry, now));
    if (expired.length) await Promise.all(expired.map(entry => removeProjectTrash(entry.projectId)));
    return entries.filter(entry => !isTrashExpired(entry, now));
  } catch {
    return [];
  }
}

export async function removeProjectTrash(projectId: string): Promise<void> {
  if (!projectId) return;
  try {
    await updateSourceForm([TRASH_NAMESPACE, projectId], () => undefined);
  } catch {
    // 同上。
  }
}

/** 缓存读写用的统计信息，面板上直接显示“本机已缓存 V3”。 */
export async function readProjectCacheSummary(projectId: string): Promise<{ cached: boolean; revision: number | null; updatedAt: number | null }> {
  const entry = await readProjectCache(projectId);
  return entry
    ? { cached: true, revision: entry.revision, updatedAt: entry.updatedAt }
    : { cached: false, revision: null, updatedAt: null };
}
