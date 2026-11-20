// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CaseAdminSection } from './case-admin';
import { registerPublishGateProvider, type PublishGateSnapshot } from '../lib/project-manifest';
import type { CloudCaseSessionContract } from '../lib/cloud-cases';
import type { BackendSession } from '@/lib/backend-session';

afterEach(cleanup);

const PHOTO_ID = '11111111-1111-4111-8111-111111111111';

const DRAFT = {
  id: 'cn-yuquan-chrysanthemum',
  title: '杭州植物园菊花展',
  description: '官网案例复刻',
  category: '花卉展',
  coverAssetId: null,
  sortOrder: 0,
  provenance: '官网案例 · 杭州网；区块/物料为拟设演示',
  projectId: 'proj-official-1',
  version: 3,
  status: 'published' as const,
  publicationId: 'pub-9',
  revision: 4,
  publishedAt: '2026-11-19T02:00:00.000Z',
  createdAt: '2026-11-19T00:00:00.000Z',
  updatedAt: '2026-11-19T02:00:00.000Z',
};

function adminSession(): CloudCaseSessionContract {
  return {
    getCloudCapabilities: vi.fn(async () => ({ version: 1, superAdmin: true, officialStudioId: 'studio-official' })),
    listCloudCases: vi.fn(async () => []),
    readCloudCase: vi.fn(async () => ({})),
    upsertCloudCase: vi.fn(async () => ({ ...DRAFT, version: 4 })),
    listCloudCaseDrafts: vi.fn(async () => [DRAFT]),
    publishCloudCase: vi.fn(async () => ({ ...DRAFT, version: 4, revision: 5, publishedAt: '2026-11-20T00:00:00.000Z' })),
    unpublishCloudCase: vi.fn(async () => ({ ...DRAFT, revision: null, publicationId: null, publishedAt: null, status: 'unpublished' })),
    listCloudCaseVersions: vi.fn(async () => [
      { publicationId: 'pub-9', revision: 4, createdAt: '2026-11-19T02:00:00.000Z' },
      { publicationId: 'pub-5', revision: 3, createdAt: '2026-11-18T02:00:00.000Z' },
    ]),
    restoreCloudCase: vi.fn(async () => ({ ...DRAFT, version: 5, revision: 3 })),
  } as unknown as CloudCaseSessionContract;
}

function controllerStub(snapshot: { project?: { id: string } | null; revision?: number } = { project: { id: 'proj-official-1' }, revision: 7 }): BackendSession {
  return { getSnapshot: () => snapshot } as unknown as BackendSession;
}

describe('CaseAdminSection', () => {
  it('没接通时如实说明，不出现管理表单', () => {
    render(<CaseAdminSection session={null} controller={null} layoutId="layout-1" layoutName="菊花展"/>);
    expect(screen.getByTestId('case-admin').textContent).toContain('还没有接通');
    expect(screen.queryByTestId('case-save-draft')).toBeNull();
  });

  it('非管理员按服务端判定如实说明', async () => {
    const session = adminSession();
    (session.getCloudCapabilities as ReturnType<typeof vi.fn>).mockResolvedValue({ version: 1, superAdmin: false });
    render(<CaseAdminSection session={session} controller={controllerStub()} layoutName="菊花展"/>);
    expect(await screen.findByText(/案例管理仅平台管理员可用/)).toBeTruthy();
    expect(screen.queryByTestId('case-save-draft')).toBeNull();
  });

  it('权限探测连不上时给出可操作的中文，不把 "Failed to fetch" 甩给用户', async () => {
    const session = adminSession();
    (session.getCloudCapabilities as ReturnType<typeof vi.fn>).mockRejectedValue(new TypeError('Failed to fetch'));
    render(<CaseAdminSection session={session} controller={controllerStub()} layoutName="菊花展" />);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('案例管理权限没有确认');
    expect(alert.textContent).toContain('没能连上云端服务');
    expect(alert.textContent).not.toContain('Failed to fetch');
    expect(screen.getByTestId('case-admin-error-hint').textContent).toContain('localhost:3000');
    expect(screen.getByRole('button', { name: '重试' })).toBeTruthy();
  });

  it('管理员进入后拉草稿并预填当前项目关联案例', async () => {
    const session = adminSession();
    render(<CaseAdminSection session={session} controller={controllerStub()} layoutName="菊花展"/>);
    expect(await screen.findByTestId('case-save-draft')).toBeTruthy();
    await waitFor(() => expect((screen.getByLabelText('稳定案例 ID') as HTMLInputElement).value).toBe('cn-yuquan-chrysanthemum'));
    expect((screen.getByLabelText('案例标题') as HTMLInputElement).value).toBe('杭州植物园菊花展');
    expect(screen.getByText(/当前项目关联案例「杭州植物园菊花展」/).textContent).toContain('公众版本 v4');
    expect(session.listCloudCaseDrafts).toHaveBeenCalledOnce();
  });

  it('发布把已保存版本作为 expectedRevision 传给服务端，成功后报新公众版本', async () => {
    const session = adminSession();
    render(<CaseAdminSection session={session} controller={controllerStub({ project: { id: 'proj-official-1' }, revision: 7 })} layoutName="菊花展"/>);
    // 等草稿拉回、表单按关联案例预填后再发布，避免在 formDraft 就绪前点击。
    await screen.findByText(/当前项目关联案例/);
    fireEvent.click(screen.getByTestId('case-publish'));
    const notice = await screen.findByTestId('case-admin-notice');
    expect(notice.textContent).toContain('已发布公众版本 v5');
    expect(session.publishCloudCase).toHaveBeenCalledOnce();
    expect((session.publishCloudCase as ReturnType<typeof vi.fn>).mock.calls[0]).toEqual([
      'cn-yuquan-chrysanthemum',
      { requestId: expect.any(String), expectedVersion: 3, expectedRevision: 7 },
    ]);
  });

  it('发布失败（CAS 冲突等）只报错并保留原入口，不清任何已发布状态', async () => {
    const session = adminSession();
    (session.publishCloudCase as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('CASE_VERSION_CONFLICT'));
    render(<CaseAdminSection session={session} controller={controllerStub()} layoutName="菊花展"/>);
    await screen.findByText(/当前项目关联案例/);
    fireEvent.click(screen.getByTestId('case-publish'));
    const notice = await screen.findByTestId('case-admin-notice');
    expect(notice.textContent).toContain('发布没有成功');
    expect(notice.textContent).toContain('CASE_VERSION_CONFLICT');
    expect(notice.textContent).toContain('案例入口仍是上一个版本');
    // 草稿行还在，关联说明还在——原入口没有被清掉。
    expect(screen.getByTestId('case-draft-cn-yuquan-chrysanthemum')).toBeTruthy();
    expect(screen.getByText(/当前项目关联案例/)).toBeTruthy();
  });

  it('有未保存改动时不给发布（expectedRevision 无法保证）', async () => {
    const session = adminSession();
    render(<CaseAdminSection session={session} controller={controllerStub({ project: { id: 'proj-official-1' }, revision: Number.NaN })} layoutName="菊花展"/>);
    const publish = await screen.findByTestId('case-publish');
    expect((publish as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/还有改动没保存/)).toBeTruthy();
    expect(session.publishCloudCase).not.toHaveBeenCalled();
  });

  it('未挂云项目时保存与发布都不可用', async () => {
    const session = adminSession();
    render(<CaseAdminSection session={session} controller={controllerStub({ project: null, revision: 3 })} layoutName="菊花展"/>);
    await screen.findByTestId('case-save-draft');
    expect((screen.getByTestId('case-save-draft') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId('case-publish') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/还没挂到云项目上/)).toBeTruthy();
  });

  it('历史列出不可变版本并支持恢复；恢复走服务端、不改旧发布', async () => {
    const session = adminSession();
    render(<CaseAdminSection session={session} controller={controllerStub()} layoutName="菊花展"/>);
    fireEvent.click(await screen.findByRole('button', { name: '查看历史版本 杭州植物园菊花展' }));
    expect(await screen.findByText(/v3 ·/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '恢复案例 杭州植物园菊花展 到 v3' }));
    const notice = await screen.findByTestId('case-admin-notice');
    expect(notice.textContent).toContain('已恢复历史版本');
    expect(session.restoreCloudCase).toHaveBeenCalledOnce();
    expect((session.restoreCloudCase as ReturnType<typeof vi.fn>).mock.calls[0]).toEqual([
      'cn-yuquan-chrysanthemum',
      { requestId: expect.any(String), expectedVersion: 3, publicationId: 'pub-5' },
    ]);
  });

  it('下架调服务端并说明影响范围（固定交付不受影响）', async () => {
    const session = adminSession();
    render(<CaseAdminSection session={session} controller={controllerStub()} layoutName="菊花展"/>);
    fireEvent.click(await screen.findByRole('button', { name: '下架 杭州植物园菊花展' }));
    const notice = await screen.findByTestId('case-admin-notice');
    expect(notice.textContent).toContain('已下架');
    expect(notice.textContent).toContain('已发出的固定交付不受影响');
    expect(session.unpublishCloudCase).toHaveBeenCalledOnce();
  });

  it('封面（C09）：从关联草稿预填，可在已归档照片里选择并随草稿保存', async () => {
    const session = adminSession();
    (session.listCloudCaseDrafts as ReturnType<typeof vi.fn>).mockResolvedValue([{ ...DRAFT, coverAssetId: PHOTO_ID }]);
    (session.upsertCloudCase as ReturnType<typeof vi.fn>).mockResolvedValue({ ...DRAFT, coverAssetId: PHOTO_ID, version: 4 });
    registerPublishGateProvider(async () => ({
      scopeId: 'layout-1', projectId: 'proj-official-1', cloudRevision: 7,
      manifest: { version: 1, scene: { schemaVersion: 1 }, outdoor: null, sources: {}, dependencies: [{ assetId: PHOTO_ID, visibility: 'published' }] },
      gaps: [], complete: true, readyForPublish: true, note: '', conflict: null, capturedRevision: 7,
    } as unknown as PublishGateSnapshot));
    const controller = {
      getSnapshot: () => ({ project: { id: 'proj-official-1' }, revision: 7, lease: { projectId: 'proj-official-1', sessionId: 's1', generation: 1 } }),
      saveCompleteProject: vi.fn(async () => ({})),
      listArchiveAssets: vi.fn(async () => [{
        id: PHOTO_ID, name: '入口主视觉', kind: 'photo', format: 'jpg', byteSize: 1024, sha256: 'a'.repeat(64),
        ownerId: 'u', studioId: null, integrity: 'full' as const, metadata: {}, createdAt: '2026-11-19T00:00:00.000Z',
      }]),
    } as unknown as BackendSession;
    try {
      render(<CaseAdminSection session={session} controller={controller} layoutName="菊花展"/>);
      // 先等草稿拉回、表单按关联案例预填（下方关联说明行出现），否则点击保存读到的是未预填的闭包。
      await screen.findByText(/当前项目关联案例/);
      const select = (await screen.findByLabelText('案例封面')) as HTMLSelectElement;
      // 等草稿与封面候选都拉回再断言，避免在异步预填完成前读到空值。
      await waitFor(() => expect(select.value).toBe(PHOTO_ID));
      await waitFor(() => expect(screen.getByRole('option', { name: '入口主视觉（照片）' })).toBeTruthy());
      expect(screen.queryByTestId('case-cover-note')).toBeNull();
      fireEvent.change(select, { target: { value: '' } });
      fireEvent.click(screen.getByTestId('case-save-draft'));
      await screen.findByTestId('case-admin-notice');
      const upsert = session.upsertCloudCase as ReturnType<typeof vi.fn>;
      expect(upsert.mock.calls[0][1].coverAssetId).toBeNull();
      fireEvent.change(screen.getByLabelText('案例封面'), { target: { value: PHOTO_ID } });
      fireEvent.click(screen.getByTestId('case-save-draft'));
      await waitFor(() => expect(upsert.mock.calls.length).toBe(2));
      expect(upsert.mock.calls[1][1].coverAssetId).toBe(PHOTO_ID);
    } finally {
      registerPublishGateProvider(null);
    }
  });

  it('封面候选为空时给明确指引，保存仍按无封面提交', async () => {
    const session = adminSession();
    registerPublishGateProvider(async () => ({
      scopeId: 'layout-1', projectId: 'proj-official-1', cloudRevision: 7,
      manifest: { version: 1, scene: { schemaVersion: 1 }, outdoor: null, sources: {}, dependencies: [] },
      gaps: [], complete: true, readyForPublish: true, note: '', conflict: null, capturedRevision: 7,
    } as unknown as PublishGateSnapshot));
    const controller = {
      getSnapshot: () => ({ project: { id: 'proj-official-1' }, revision: 7, lease: { projectId: 'proj-official-1', sessionId: 's1', generation: 1 } }),
      saveCompleteProject: vi.fn(async () => ({})),
    } as unknown as BackendSession;
    try {
      render(<CaseAdminSection session={session} controller={controller} layoutName="菊花展"/>);
      await screen.findByText(/当前项目关联案例/);
      const select = (await screen.findByLabelText('案例封面')) as HTMLSelectElement;
      await waitFor(() => expect(select.options).toHaveLength(1));
      expect(screen.getByTestId('case-cover-note').textContent).toContain('还没有已归档的依赖');
      fireEvent.click(screen.getByTestId('case-save-draft'));
      await screen.findByTestId('case-admin-notice');
      expect((session.upsertCloudCase as ReturnType<typeof vi.fn>).mock.calls[0][1].coverAssetId).toBeNull();
    } finally {
      registerPublishGateProvider(null);
    }
  });

  it('权限探测失败可重试', async () => {
    const session = adminSession();
    const caps = session.getCloudCapabilities as ReturnType<typeof vi.fn>;
    caps.mockRejectedValueOnce(new Error('网络断开')).mockResolvedValueOnce({ version: 1, superAdmin: true });
    render(<CaseAdminSection session={session} controller={controllerStub()} layoutName="菊花展"/>);
    expect((await screen.findByRole('alert')).textContent).toContain('网络断开');
    fireEvent.click(screen.getByRole('button', { name: '重试' }));
    expect(await screen.findByTestId('case-save-draft')).toBeTruthy();
    expect(caps).toHaveBeenCalledTimes(2);
  });
});
