// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { evaluatePublishBlockers, hasUnpublishedChanges, type PublishBlocker } from './publish-flow';
import type { PublishGateSnapshot } from './project-manifest';
import type { RoomLayout } from './types';
import type { BackendSnapshot } from '@/lib/backend-session';
import { setAssetCloudScope } from './asset-cloud';
import { rememberAholoAsset } from './aholo-assets';

function snapshot(overrides: Partial<BackendSnapshot> = {}): BackendSnapshot {
  return {
    configured: true,
    sessionId: 's1',
    user: { id: 'user-1' },
    recoveryReady: false,
    project: { id: 'proj-1', name: '项目', studio_id: 'st-1', revision: 4 },
    lease: { projectId: 'proj-1', sessionId: 's1', generation: 1, expiresAt: new Date(Date.now() + 60_000).toISOString(), revision: 4 },
    revision: 4,
    draft: null,
    localRevision: 4,
    dirty: false,
    status: 'editing',
    writeBlocked: false,
    error: null,
    ...overrides,
  } as BackendSnapshot;
}

function gate(overrides: Partial<PublishGateSnapshot> = {}): PublishGateSnapshot {
  return {
    scopeId: 'layout-1',
    projectId: 'proj-1',
    cloudRevision: 4,
    manifest: null,
    gaps: [],
    complete: true,
    readyForPublish: true,
    note: 'ok',
    conflict: null,
    ...overrides,
  };
}

function layout(overrides: Partial<RoomLayout> = {}): RoomLayout {
  return {
    id: 'layout-1',
    name: '周末共创工作坊',
    width: 12,
    height: 10,
    floors: [{ floorId: 'f1', items: [] }],
    ...overrides,
  } as unknown as RoomLayout;
}

describe('evaluatePublishBlockers（发布预检求值，接口约定 §2）', () => {
  beforeEach(() => {
    localStorage.clear();
    setAssetCloudScope(null, null);
  });

  it('可发布时返回空清单', () => {
    const blockers = evaluatePublishBlockers({ snapshot: snapshot(), gate: gate(), layout: layout() });
    expect(blockers).toEqual([]);
  });

  it('按序覆盖全部阻塞代码', () => {
    const blockers = evaluatePublishBlockers({
      snapshot: snapshot({
        configured: false,
        user: null,
        project: null,
        writeBlocked: true,
        revision: null,
        dirty: true,
      }),
      gate: gate({
        complete: false,
        gaps: [{ localId: 'scan-1', kind: 'scan', name: '西湖 0233 · 极速档', reason: 'not-uploaded' }],
        note: '',
        conflict: { remoteRevision: 9, remoteName: '另一台设备' },
      }),
      layout: layout(),
    });
    const codes = blockers.map((blocker: PublishBlocker) => blocker.code);
    expect(codes).toEqual([
      'not-configured', 'login-required', 'no-project', 'read-only', 'unsaved', 'archive-gaps', 'conflict',
    ]);
    expect(blockers.find(b => b.code === 'archive-gaps')?.message).toContain('西湖 0233 · 极速档');
    expect(blockers.find(b => b.code === 'conflict')?.message).toContain('v9');
  });

  it('dirty 且本机模型未上云时并列 local-assets（指向保存动作）', () => {
    // localAssetIdsInLayout 只认注册表里有记录的本机资产（且 assetId 是 UUID 形）：
    // 先登记一个，再让画布引用它。
    rememberAholoAsset({ assetId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', name: '本机扫描', kind: 'spz', bytes: 1024, savedAt: Date.now() });
    const withScan = {
      ...layout(),
      floors: [{ floorId: 'f1', items: [{ id: 'obj-1', assetId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }] }],
    } as unknown as RoomLayout;
    const blockers = evaluatePublishBlockers({
      snapshot: snapshot({ dirty: true }),
      gate: gate(),
      layout: withScan,
    });
    const codes = blockers.map(b => b.code);
    expect(codes).toContain('unsaved');
    expect(codes).toContain('local-assets');
    expect(blockers.find(b => b.code === 'local-assets')?.action).toBe('save-changes');
  });

  it('归档闸门未接入（fail-closed）如实给 note 文案', () => {
    const blockers = evaluatePublishBlockers({
      snapshot: snapshot(),
      gate: gate({ complete: false, gaps: [], note: '完整归档状态未接入，不能声称可发布。' }),
      layout: layout(),
    });
    expect(blockers.map(b => b.code)).toEqual(['archive-gaps']);
    expect(blockers[0]!.message).toContain('未接入');
  });
});

describe('hasUnpublishedChanges（PUB-07 的「当前修改未发布」判定）', () => {
  it('dirty 即未发布', () => {
    expect(hasUnpublishedChanges(snapshot({ dirty: true }))).toBe(true);
  });
  it('localRevision 超过云端 revision 即未发布', () => {
    expect(hasUnpublishedChanges(snapshot({ localRevision: 6, revision: 4 }))).toBe(true);
  });
  it('干净已保存为 false；缺版本字段不误报', () => {
    expect(hasUnpublishedChanges(snapshot())).toBe(false);
    expect(hasUnpublishedChanges(snapshot({ localRevision: 6, revision: null }))).toBe(false);
  });
});
