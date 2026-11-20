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

  // ---- P0-A（主计划 §4 实现约束 1/2，2026-11-20）：项目/会话/版本一致性 ----

  it('P0-A：ok 时返回绑定的项目与版本，调用方不得另读快照取项目', async () => {
    const outcome = await ensurePublishedArchive(controller(), gate());
    expect(outcome).toMatchObject({ ok: true, projectId: 'p1', revision: 5 });
  });

  it('P0-A：闸门清单对应别的云项目时拒绝落库', async () => {
    const save = vi.fn(async () => ({}));
    const outcome = await ensurePublishedArchive(controller({ saveCompleteProject: save }), gate({ projectId: 'p2', scopeId: 'p2' }));
    expect(outcome.ok).toBe(false);
    expect(outcome.error).toContain('不是当前云项目');
    expect(save).not.toHaveBeenCalled();
  });

  it('P0-A：有未保存改动时不落 published 清单', async () => {
    const save = vi.fn(async () => ({}));
    const dirty = controller({
      getSnapshot: () => ({
        configured: true, sessionId: 's1', revision: 5, dirty: true,
        project: { id: 'p1', name: '项目' },
        lease: { projectId: 'p1', sessionId: 's1', generation: 2, expiresAt: new Date(Date.now() + 60_000).toISOString(), revision: 5 },
      }),
      saveCompleteProject: save,
    });
    const outcome = await ensurePublishedArchive(dirty, gate());
    expect(outcome.ok).toBe(false);
    expect(outcome.error).toContain('没保存');
    expect(save).not.toHaveBeenCalled();
  });

  it('P0-A：闸门 capturedRevision 与落库版本不一致时 fail-closed', async () => {
    const save = vi.fn(async () => ({}));
    const outcome = await ensurePublishedArchive(controller({ saveCompleteProject: save }), gate({ capturedRevision: 4 }));
    expect(outcome.ok).toBe(false);
    expect(outcome.error).toContain('v4');
    expect(outcome.error).toContain('v5');
    expect(save).not.toHaveBeenCalled();
  });

  it('P0-A：归档期间切项目或换账号时清单不再使用', async () => {
    let phase = 0;
    const snap = () => phase === 0
      ? { configured: true, sessionId: 's1', userId: 'u1', revision: 5, project: { id: 'p1', name: '项目' }, lease: { projectId: 'p1', sessionId: 's1', generation: 2, expiresAt: new Date(Date.now() + 60_000).toISOString(), revision: 5 } }
      : { configured: true, sessionId: 's1', userId: 'u1', revision: 5, project: { id: 'p2', name: '另一个项目' }, lease: { projectId: 'p2', sessionId: 's1', generation: 2, expiresAt: new Date(Date.now() + 60_000).toISOString(), revision: 5 } };
    const switching = controller({
      getSnapshot: snap,
      saveCompleteProject: vi.fn(async () => { phase = 1; return {}; }),
    });
    const outcome = await ensurePublishedArchive(switching, gate({ projectId: 'p1' }));
    expect(outcome.ok).toBe(false);
    expect(outcome.error).toContain('已变化');
    expect(outcome.projectId).toBeUndefined();
  });

  it('P0-A：归档期间又保存了新版本时拒绝使用旧清单', async () => {
    let saved = false;
    const snap = () => ({
      configured: true, sessionId: 's1', revision: saved ? 6 : 5,
      project: { id: 'p1', name: '项目' },
      lease: { projectId: 'p1', sessionId: 's1', generation: 2, expiresAt: new Date(Date.now() + 60_000).toISOString(), revision: 5 },
    });
    const raced = controller({
      getSnapshot: snap,
      saveCompleteProject: vi.fn(async () => { saved = true; return {}; }),
    });
    const outcome = await ensurePublishedArchive(raced, gate());
    expect(outcome.ok).toBe(false);
    expect(outcome.error).toContain('新版本');
    expect(outcome.revision).toBeUndefined();
  });
});
