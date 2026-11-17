import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PROJECT_CACHE_MAX_BYTES,
  PROJECT_TRASH_TTL_MS,
  findProjectCacheByLocalId,
  isProjectCacheEntry,
  isTrashExpired,
  listProjectCache,
  listProjectTrash,
  moveProjectCacheToTrash,
  putProjectCache,
  readProjectCache,
  readProjectCacheSummary,
  removeProjectCache,
  restoreProjectCache,
  selectProjectCacheEvictions,
  type ProjectCacheEntry,
} from './project-cache';
import { listSourceRecords, readSourceRecord, updateSourceForm } from './source-storage';

vi.mock('./source-storage', () => ({
  listSourceRecords: vi.fn(),
  readSourceRecord: vi.fn(),
  updateSourceForm: vi.fn(),
}));

const store = new Map<string, unknown>();
const key = (scope: string | [string, string]) => JSON.stringify(scope);

beforeEach(() => {
  store.clear();
  vi.mocked(readSourceRecord).mockImplementation(async scope => store.get(key(scope)) as never);
  vi.mocked(updateSourceForm).mockImplementation(async (scope, update) => {
    const next = update(store.get(key(scope)));
    if (next === undefined) store.delete(key(scope));
    else store.set(key(scope), next);
    return next as never;
  });
  vi.mocked(listSourceRecords).mockImplementation(async namespace => {
    return [...store.entries()]
      .map(([raw, value]) => ({ key: JSON.parse(raw) as [string, string], value }))
      .filter(record => Array.isArray(record.key) && record.key[0] === namespace);
  });
});

const projectId = '11111111-1111-4111-8111-111111111111';
const scene = { schemaVersion: 1, venue: { shape: 'rectangle', width: 12, depth: 8, height: 3 }, objects: [] };

function entry(overrides: Partial<ProjectCacheEntry> = {}): Omit<ProjectCacheEntry, 'bytes' | 'cachedAt'> & { cachedAt?: number } {
  return {
    projectId,
    name: '新活动 11-17',
    revision: 3,
    scene,
    updatedAt: 1_760_000_000_000,
    studioId: 'studio-a',
    ...overrides,
  };
}

describe('project cache', () => {
  it('round-trips one project per id and computes bytes', async () => {
    expect(await putProjectCache(entry())).toBe(true);
    const cached = await readProjectCache(projectId);
    expect(cached?.name).toBe('新活动 11-17');
    expect(cached?.revision).toBe(3);
    expect(cached?.bytes).toBe(JSON.stringify(scene).length);
    expect(await readProjectCacheSummary(projectId)).toMatchObject({ cached: true, revision: 3 });
    expect(await readProjectCache('missing')).toBeNull();
  });

  it('keeps projectId as the only identity and accepts a localId bridge', async () => {
    await putProjectCache(entry({ localId: 'local-activity-1' }));
    const cached = await readProjectCache(projectId);
    expect(cached?.localId).toBe('local-activity-1');
    expect(await readProjectCache('local-activity-1')).toBeNull();
    expect(isProjectCacheEntry({ ...entry(), bytes: 1, cachedAt: 1 }, projectId)).toBe(true);
    expect(isProjectCacheEntry({ ...entry(), projectId: 'other', bytes: 1, cachedAt: 1 }, projectId)).toBe(false);
  });

  it('refuses scenes above the per-project budget instead of breaking the save flow', async () => {
    const huge = { schemaVersion: 1, blob: 'x'.repeat(PROJECT_CACHE_MAX_BYTES + 10) };
    expect(await putProjectCache(entry({ scene: huge }))).toBe(false);
    expect(await readProjectCache(projectId)).toBeNull();
  });

  it('evicts the oldest entries at the cache limit', async () => {
    for (let index = 0; index < 21; index += 1) {
      await putProjectCache(entry({ projectId: `p-${index}`, name: `项目 ${index}`, cachedAt: 1_000 + index }));
    }
    const all = await listProjectCache();
    expect(all).toHaveLength(20);
    expect(all.some(item => item.projectId === 'p-0')).toBe(false);
    expect(all.some(item => item.projectId === 'p-20')).toBe(true);
  });

  it('moves a deleted project into trash and restores nothing implicitly', async () => {
    await putProjectCache(entry());
    await moveProjectCacheToTrash(projectId, 2_000);
    expect(await readProjectCache(projectId)).toBeNull();
    const trash = await listProjectTrash(2_000 + 1_000);
    expect(trash).toHaveLength(1);
    expect(trash[0]?.deletedAt).toBe(2_000);
    expect(trash[0]?.scene).toEqual(scene);
  });

  it('finds the cloud project cached for a local activity id', async () => {
    await putProjectCache(entry({ localId: 'local-1' }));
    await putProjectCache(entry({ projectId: 'other', localId: 'local-2' }));
    expect((await findProjectCacheByLocalId('local-1'))?.projectId).toBe(projectId);
    expect((await findProjectCacheByLocalId('local-2'))?.projectId).toBe('other');
    expect(await findProjectCacheByLocalId('local-missing')).toBeNull();
  });

  it('restores a trashed cache copy when the cloud project is restored', async () => {
    await putProjectCache(entry());
    await moveProjectCacheToTrash(projectId, 2_000);
    await restoreProjectCache(projectId);
    expect((await readProjectCache(projectId))?.name).toBe('新活动 11-17');
    expect(await listProjectTrash(2_001)).toHaveLength(0);
  });

  it('drops trash entries after seven days', async () => {
    await putProjectCache(entry());
    await moveProjectCacheToTrash(projectId, 5_000);
    expect(await listProjectTrash(5_000 + PROJECT_TRASH_TTL_MS - 1)).toHaveLength(1);
    expect(await listProjectTrash(5_000 + PROJECT_TRASH_TTL_MS)).toHaveLength(0);
    expect(isTrashExpired({ deletedAt: 5_000 }, 5_000 + PROJECT_TRASH_TTL_MS)).toBe(true);
  });

  it('removes a cache entry without touching other projects', async () => {
    await putProjectCache(entry());
    await putProjectCache(entry({ projectId: 'keep', name: '保留' }));
    await removeProjectCache(projectId);
    expect(await readProjectCache(projectId)).toBeNull();
    expect((await readProjectCache('keep'))?.name).toBe('保留');
  });

  it('computes evictions deterministically, oldest first', () => {
    const entries = Array.from({ length: 3 }, (_, index) => ({
      ...entry({ projectId: `p-${index}` }),
      bytes: 10,
      cachedAt: 100 + index,
    })) as ProjectCacheEntry[];
    expect(selectProjectCacheEvictions(entries, 2)).toEqual(['p-0']);
    expect(selectProjectCacheEvictions(entries, 3)).toEqual([]);
  });
});
