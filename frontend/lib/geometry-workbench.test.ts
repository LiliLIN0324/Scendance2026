import { beforeEach, describe, expect, it, vi } from 'vitest';
import { backendSceneToLayout, layoutToBackendScene } from '../components/room-organizer/lib/backend-adapter';
import { assertGeometryActionSource, geometryProjectId, hasRequestedCloudProject, isEditorLocalProjectLink, isLocalActivityWorkspace } from './geometry-workbench';
import { readSourceRecord } from './source-storage';
import type { BackendSession, BackendSnapshot } from './backend-session';

vi.mock('./source-storage', () => ({ readSourceRecord: vi.fn(), updateSourceForm: vi.fn() }));
const localId = 'house-geometry-rehearsal', remoteId = '10000000-0000-4000-8000-000000000001';
const scene = { schemaVersion: 1 as const, venue: { width: 10, depth: 8, height: 3, shape: 'rectangle' as const, entrances: [] }, objects: [], camera: 'overview' as const, lighting: 'neutral' as const };
function session(kind: 'local' | 'geometry' | 'cloud' | 'invalid' = 'local') {
  const state = { project: kind === 'local' ? null : { id: remoteId },
    geometryBinding: kind === 'geometry' || kind === 'invalid' ? { version: 1, localActivityId: localId, cloudProjectId: remoteId, userId: 'user-a', apiUrl: 'https://scene.example/api' } : null,
  } as BackendSnapshot;
  return { getSnapshot: () => state, isGeometryBound: (id: string) => kind === 'geometry' && id === localId } as BackendSession;
}
beforeEach(() => vi.mocked(readSourceRecord).mockReset().mockResolvedValue(undefined));

describe('local activity and remote scene boundaries', () => {
  it('本机案例链接可新建本机活动，缺记录或真实云链接仍保留云项目守卫', () => {
    const id = 'replica-scotiabank';
    let record: string | null = JSON.stringify({ v: 1, projectId: id, name: '经典案例',
      createdAt: '2026-11-19T00:00:00Z', updatedAt: '2026-11-19T00:00:00Z', plan: null });
    const location = { href: `http://localhost/editor/?project=${id}&mode=outdoor` };
    vi.stubGlobal('window', { location, localStorage: { getItem: () => record } });
    try {
      expect(hasRequestedCloudProject()).toBe(false);
      expect(isLocalActivityWorkspace(session())).toBe(true);
      expect(isLocalActivityWorkspace(session('cloud'))).toBe(false);
      record = null;
      expect(hasRequestedCloudProject()).toBe(true);
      location.href = `http://localhost/editor/?project=${remoteId}`;
      expect(hasRequestedCloudProject()).toBe(true);
      expect(isLocalActivityWorkspace(session())).toBe(false);
    } finally { vi.unstubAllGlobals(); }
  });
  it('本机草稿链接不是云端项目 id', () => {
    expect(isEditorLocalProjectLink('house-abc12345')).toBe(true);
    expect(isEditorLocalProjectLink('default-outdoor')).toBe(true);
    expect(isEditorLocalProjectLink('replica-banbury')).toBe(true);
    expect(isEditorLocalProjectLink('10000000-0000-4000-8000-000000000001')).toBe(false);
    expect(isEditorLocalProjectLink('not-a-project')).toBe(false);
  });
  it('裸 uuid 挂着本机信封时按本机工作区处理，挂着云项目仍是云通道', () => {
    const record = JSON.stringify({ v: 1, projectId: remoteId, name: '历史裸槽',
      createdAt: '2026-11-19T00:00:00Z', updatedAt: '2026-11-19T00:00:00Z', plan: null });
    const location = { href: `http://localhost/editor/?project=${remoteId}` };
    vi.stubGlobal('window', { location, localStorage: { getItem: () => record } });
    try {
      // 裸 uuid 仍是「云号长相」，但本机存着这个 scope 的信封、controller 没挂云项目：按本机草稿干活。
      expect(hasRequestedCloudProject()).toBe(true);
      expect(isLocalActivityWorkspace(session())).toBe(true);
      // 一旦 controller 真挂上了云项目，就是云通道，不因本机副本降级。
      expect(isLocalActivityWorkspace(session('cloud'))).toBe(false);
    } finally { vi.unstubAllGlobals(); }
  });
  it('裸 uuid + 本机信封：走本机资料核对，不被「已是团队项目」守卫拦下', async () => {
    const record = JSON.stringify({ v: 1, projectId: remoteId, name: '历史裸槽',
      createdAt: '2026-11-19T00:00:00Z', updatedAt: '2026-11-19T00:00:00Z', plan: null });
    const location = { href: `http://localhost/editor/?project=${remoteId}` };
    vi.stubGlobal('window', { location, localStorage: { getItem: () => record } });
    try {
      // 带本地执行信息的裸槽草稿：以前会被当成云项目，在云守卫那里拒绝；现在按本机核对本机记录。
      const layout = { ...backendSceneToLayout(scene, { projectId: remoteId }),
        eventOperations: { schemaVersion: 1 as const, dataKind: 'rehearsal' as const, tasks: [] } };
      await expect(assertGeometryActionSource(layout, session())).resolves.toBeUndefined();
      expect(readSourceRecord).toHaveBeenCalledWith(['material-checkins', remoteId]);
    } finally { vi.unstubAllGlobals(); }
  });
  it('house- 本机活动与默认草稿不被当成云项目', () => {
    const cases = ['house-abc12345-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'default-outdoor'];
    for (const id of cases) {
      const location = { href: `http://localhost/editor/?project=${id}&mode=outdoor` };
      vi.stubGlobal('window', { location, localStorage: { getItem: () => null } });
      try {
        expect(hasRequestedCloudProject()).toBe(false);
        expect(isLocalActivityWorkspace(session())).toBe(true);
      } finally { vi.unstubAllGlobals(); }
    }
  });
  it('keeps valid scene bindings local, including before switching to another local activity, but respects cloud URLs', () => {
    expect(isLocalActivityWorkspace(session(), false)).toBe(true);
    expect(isLocalActivityWorkspace(session('geometry'), false)).toBe(true);
    expect(isLocalActivityWorkspace(session('geometry'), true)).toBe(false);
    expect(isLocalActivityWorkspace(session('cloud'), false)).toBe(false);
    expect(isLocalActivityWorkspace(session('invalid'), false)).toBe(false);
    expect(geometryProjectId(session('geometry'), localId)).toBe(remoteId);
    expect(geometryProjectId(session('geometry'), 'other-local')).toBeNull();
    expect(geometryProjectId(session('geometry'), remoteId)).toBeNull();
    expect(geometryProjectId(session('cloud'), remoteId)).toBe(remoteId);
    expect(geometryProjectId(session('invalid'), remoteId)).toBeNull();
  });
  it('allows valid activity records and an independent ledger without putting either in the scene payload', async () => {
    const layout = { ...backendSceneToLayout(scene, { projectId: localId }), eventOperations: { schemaVersion: 1 as const, dataKind: 'rehearsal' as const, tasks: [] } };
    const original = structuredClone(layout);
    vi.mocked(readSourceRecord).mockResolvedValue({ schemaVersion: 1, projectId: localId, dataKind: 'rehearsal', sheets: [] });
    await expect(assertGeometryActionSource(layout, session('geometry'))).resolves.toBeUndefined();
    expect(readSourceRecord).toHaveBeenCalledWith(['material-checkins', localId]);
    expect(layoutToBackendScene(layout)).toEqual(scene);
    expect(layout).toEqual(original);
    await expect(assertGeometryActionSource(layout, session('cloud'))).rejects.toThrow('本地执行信息');
  });
  it('refuses corrupt business fields or unreadable/cross-activity facts before scene work', async () => {
    const layout = backendSceneToLayout(scene, { projectId: localId });
    await expect(assertGeometryActionSource({ ...layout, productionPlan: { broken: true } as never }, session())).rejects.toThrow('无法完整核对');
    expect(readSourceRecord).not.toHaveBeenCalled();
    vi.mocked(readSourceRecord).mockRejectedValueOnce(new Error('原记录读取失败'));
    await expect(assertGeometryActionSource(layout, session())).rejects.toThrow('原记录读取失败');
    vi.mocked(readSourceRecord).mockResolvedValue({ schemaVersion: 1, projectId: 'another', dataKind: 'rehearsal', sheets: [] });
    await expect(assertGeometryActionSource(layout, session())).rejects.toThrow('另一个项目');
  });
});
