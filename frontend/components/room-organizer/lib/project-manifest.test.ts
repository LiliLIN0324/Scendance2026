// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildCompleteManifest, manifestCompletenessLabel, publishGateBlockReason, publishGateSnapshot, registerPublishGateProvider, type PublishGateSnapshot } from './project-manifest';
import { MemoryStorage } from '@/lib/test-support-memory-storage';
import type { RoomLayout } from './types';
import type { StoredSource } from '@/lib/source-storage';

const localModel = '11111111-1111-4111-8111-111111111111';
const localScan = '22222222-2222-4222-8222-222222222222';
const cloudModel = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const cloudScan = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const REGISTRY = 'scendance:aholo-assets';

function seedRegistry(): void {
  localStorage.setItem(REGISTRY, JSON.stringify([
    { assetId: localModel, kind: 'glb', name: '舞台模型', bytes: 32, savedAt: Date.now() },
    { assetId: localScan, kind: 'spz', name: '西湖扫描', bytes: 64, savedAt: Date.now() },
  ]));
}

function layout(): RoomLayout {
  return {
    id: 'project-1',
    name: '活动',
    width: 10,
    height: 8,
    venueScan: { assetId: localScan, name: '西湖扫描' },
    floors: [{ id: 'ground', name: '一层', floorColor: '#fff', items: [{ id: 'i1', name: '物料', type: 'glb-asset', assetId: localModel }] }],
  } as unknown as RoomLayout;
}

function source(partial: Partial<StoredSource> & { id: string }): StoredSource {
  return { scope: 'project-1', name: partial.id, kind: 'photo', width: 10, height: 10, ...partial } as StoredSource;
}

let mem: MemoryStorage;
beforeEach(() => {
  mem = new MemoryStorage();
  vi.stubGlobal('Storage', MemoryStorage);
  vi.stubGlobal('localStorage', mem);
  window.localStorage = mem;
  localStorage.clear();
  registerPublishGateProvider(null);
});
afterEach(() => { mem?.clear(); vi.unstubAllGlobals(); });

describe('complete project manifest (C06)', () => {
  it('registers dependencies with real cloud ids and reports completeness', () => {
    seedRegistry();
    const cloudSource = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    const result = buildCompleteManifest({
      layout: layout(),
      scene: null,
      outdoorPlan: null,
      sources: [source({ id: 'src-1', assetId: cloudSource }), source({ id: 'src-2', assetId: cloudSource })],
      cloudAssetIds: { [localModel]: cloudModel },
      archiveAssetIds: { [localScan]: cloudScan },
    });
    expect(result.complete).toBe(true);
    // wire 形状严格对齐 A 契约：依赖项只含 assetId + visibility。
    expect(result.manifest.dependencies).toEqual(
      expect.arrayContaining([
        { assetId: cloudModel, visibility: 'private' },
        { assetId: cloudScan, visibility: 'private' },
        { assetId: cloudSource, visibility: 'private' },
      ]),
    );
    expect(result.manifest.dependencies.every(item => Object.keys(item).sort().join(',') === 'assetId,visibility')).toBe(true);
    // 同一云端资产只登记一次。
    expect(result.manifest.dependencies.filter(item => item.assetId === cloudSource)).toHaveLength(1);
    // sources 是按资料 id 索引的登记表。
    expect(Object.keys(result.manifest.sources)).toEqual(['src-1', 'src-2']);
  });

  it('lists gaps for assets never uploaded instead of fabricating cloud ids', () => {
    seedRegistry();
    const result = buildCompleteManifest({
      layout: layout(),
      scene: null,
      outdoorPlan: null,
      sources: [source({ id: 'src-2' })],
      cloudAssetIds: {},
      archiveAssetIds: {},
    });
    expect(result.complete).toBe(false);
    expect(result.gaps).toEqual([
      { localId: localModel, kind: 'model', name: '舞台模型', reason: 'not-uploaded' },
      { localId: localScan, kind: 'scan', name: '西湖扫描', reason: 'not-uploaded' },
      { localId: 'src-2', kind: 'source', name: 'src-2', reason: 'not-uploaded' },
    ]);
    expect(result.manifest.dependencies).toHaveLength(0);
    expect(manifestCompletenessLabel(result)).toContain('3 项未归档');
  });

  it('keeps unknown venue scan ids out of dependencies and into gaps', () => {
    seedRegistry();
    const result = buildCompleteManifest({ layout: layout(), scene: null, outdoorPlan: null, sources: [], cloudAssetIds: {}, archiveAssetIds: {} });
    expect(result.gaps.map(gap => gap.localId)).toContain(localScan);
  });
});

describe('publish gate for task C', () => {
  it('reports explicitly unavailable when room-organizer has not registered', async () => {
    const snapshot = await publishGateSnapshot();
    expect(snapshot.readyForPublish).toBe(false);
    expect(snapshot.complete).toBe(false);
    expect(snapshot.note).toContain('未接入');
  });

  it('consumes the registered provider and resets on unregister', async () => {
    const provider: PublishGateSnapshot = {
      scopeId: 'p1', projectId: 'p1', cloudRevision: 5, manifest: null, gaps: [], complete: true,
      readyForPublish: true, note: 'ok', conflict: null,
    };
    registerPublishGateProvider(async () => provider);
    expect(await publishGateSnapshot()).toMatchObject({ readyForPublish: true, cloudRevision: 5 });
    registerPublishGateProvider(null);
    expect((await publishGateSnapshot()).readyForPublish).toBe(false);
  });

  it('fails closed when the provider throws', async () => {
    registerPublishGateProvider(async () => { throw new Error('boom'); });
    const snapshot = await publishGateSnapshot();
    expect(snapshot.readyForPublish).toBe(false);
    expect(snapshot.note).toContain('失败');
  });
});

describe('publishGateBlockReason (2026-11-20 集成接通)', () => {
  const base: PublishGateSnapshot = {
    scopeId: 'p1', projectId: 'p1', cloudRevision: 5, manifest: null, gaps: [],
    complete: true, readyForPublish: true, note: 'ok', conflict: null,
  };

  it('allows publishing when dependencies are complete and there is no conflict', () => {
    expect(publishGateBlockReason(base)).toBeNull();
  });

  it('blocks with the gap names when dependencies are not fully archived', () => {
    const blocked = {
      ...base, complete: false,
      gaps: [
        { localId: 'scan-1', kind: 'scan' as const, name: '西湖扫描', reason: 'not-uploaded' as const },
        { localId: 'src-2', kind: 'source' as const, name: '底图.png', reason: 'not-uploaded' as const },
      ],
      note: '还有 2 项依赖未归档。',
    };
    const reason = publishGateBlockReason(blocked);
    expect(reason).toContain('2 项依赖未归档');
    expect(reason).toContain('西湖扫描');
    expect(reason).toContain('底图.png');
  });

  it('uses the note verbatim when the snapshot is unavailable without gaps (fail-closed)', () => {
    const unavailable: PublishGateSnapshot = {
      scopeId: '', projectId: null, cloudRevision: null, manifest: null, gaps: [],
      complete: false, readyForPublish: false, note: '完整归档状态未接入，不能声称可发布。', conflict: null,
    };
    expect(publishGateBlockReason(unavailable)).toContain('完整归档状态未接入');
  });

  it('blocks on an unresolved conflict even when dependencies are complete', () => {
    const conflicted = { ...base, conflict: { remoteRevision: 9, remoteName: '同事' } };
    const reason = publishGateBlockReason(conflicted);
    expect(reason).toContain('版本冲突');
    expect(reason).toContain('v9');
  });
});
