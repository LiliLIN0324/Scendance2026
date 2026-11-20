// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { ensurePublishedArchive, toPublishedManifest } from './complete-archive';
import type { BackendSession } from '@/lib/backend-session';
import type { PublishGateSnapshot } from './project-manifest';

const SCENE = { schemaVersion: 1 as const, venue: { shape: 'rectangle' as const, width: 12, depth: 10, height: 3, entrances: [] }, objects: [], camera: 'overview' as const, lighting: 'neutral' as const };

function gate(overrides: Partial<PublishGateSnapshot> = {}): PublishGateSnapshot {
  return {
    scopeId: 'p1', projectId: 'p1', cloudRevision: 3, manifest: {
      version: 1, scene: SCENE, outdoor: null, sources: {},
      dependencies: [{ assetId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', visibility: 'private' }],
    },
    gaps: [], complete: true, readyForPublish: true, note: 'ok', conflict: null,
    ...overrides,
  };
}

function controller(overrides: Partial<Record<'getSnapshot' | 'saveCompleteProject', unknown>> = {}): BackendSession {
  return {
    getSnapshot: () => ({
      configured: true, sessionId: 's1', revision: 5,
      project: { id: 'p1', name: '项目' },
      lease: { projectId: 'p1', sessionId: 's1', generation: 2, expiresAt: new Date(Date.now() + 60_000).toISOString(), revision: 5 },
    }),
    saveCompleteProject: vi.fn(async () => ({ projectId: 'p1', revision: 5, confirmedAt: new Date().toISOString(), dependencyCount: 1, manifest: {} })),
    ...overrides,
  } as unknown as BackendSession;
}

describe('toPublishedManifest', () => {
  it('flips every dependency to published visibility without touching other fields', () => {
    const manifest = gate().manifest!;
    const published = toPublishedManifest(manifest, manifest.scene!);
    expect(published.dependencies).toEqual([{ assetId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', visibility: 'published' }]);
    expect(published.scene).toBe(manifest.scene);
    expect(published.outdoor).toBe(manifest.outdoor);
    expect(published.sources).toBe(manifest.sources);
    // 原清单不被就地修改。
    expect(manifest.dependencies[0]).toEqual({ assetId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', visibility: 'private' });
  });
});

describe('ensurePublishedArchive', () => {
  it('saves the published manifest under the current lease and revision', async () => {
    const save = vi.fn(async () => ({}));
    const outcome = await ensurePublishedArchive(controller({ saveCompleteProject: save }), gate());
    expect(outcome).toMatchObject({ ok: true, revision: 5 });
    expect(save).toHaveBeenCalledWith('p1', expect.objectContaining({
      sessionId: 's1', generation: 2, expectedRevision: 5,
      manifest: expect.objectContaining({ version: 1, dependencies: [{ assetId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', visibility: 'published' }] }),
    }));
  });

  it('refuses each unfinished precondition with a readable reason instead of sending', async () => {
    const save = vi.fn(async () => ({}));
    const makeController = (snapshotPatch: Record<string, unknown>) => controller({
      getSnapshot: () => ({
        configured: true, sessionId: 's1', revision: 5,
        project: { id: 'p1', name: '项目' },
        lease: { projectId: 'p1', sessionId: 's1', generation: 2, expiresAt: new Date(Date.now() + 60_000).toISOString(), revision: 5 },
        ...snapshotPatch,
      }),
      saveCompleteProject: save,
    }) as BackendSession;
    const unbound = makeController({ project: null, lease: null });
    await expect(ensurePublishedArchive(unbound, gate())).resolves.toMatchObject({ ok: false, error: expect.stringContaining('云项目') });
    const noLease = makeController({ lease: null });
    await expect(ensurePublishedArchive(noLease, gate())).resolves.toMatchObject({ ok: false, error: expect.stringContaining('租约') });
    const stale = makeController({ revision: null });
    await expect(ensurePublishedArchive(stale, gate())).resolves.toMatchObject({ ok: false, error: expect.stringContaining('保存') });
    const wrongLease = makeController({ lease: { projectId: 'other', sessionId: 's1', generation: 1, expiresAt: new Date().toISOString(), revision: 1 } });
    await expect(ensurePublishedArchive(wrongLease, gate())).resolves.toMatchObject({ ok: false, error: expect.stringContaining('租约') });
    await expect(ensurePublishedArchive(controller({ saveCompleteProject: save }), gate({ complete: false, gaps: [{ localId: 'scan-1', kind: 'scan', name: '西湖扫描', reason: 'not-uploaded' }] })))
      .resolves.toMatchObject({ ok: false, error: expect.stringContaining('西湖扫描') });
    await expect(ensurePublishedArchive(controller({ saveCompleteProject: save }), gate({ manifest: { version: 1, scene: null, outdoor: null, sources: {}, dependencies: [] } })))
      .resolves.toMatchObject({ ok: false, error: expect.stringContaining('场景转码') });
    expect(save).not.toHaveBeenCalled();
  });

  it('surfaces the server error verbatim when the save request fails', async () => {
    const save = vi.fn(async () => { throw Object.assign(new Error('REVISION_CONFLICT'), { code: 'REVISION_CONFLICT' }); });
    const outcome = await ensurePublishedArchive(controller({ saveCompleteProject: save }), gate());
    expect(outcome).toMatchObject({ ok: false, error: 'REVISION_CONFLICT' });
  });
});
