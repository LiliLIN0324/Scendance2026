// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readCompleteShare, readShare } from '@/lib/share-api';
import { createStarterOutdoorPlan } from '@/components/room-organizer/lib/outdoor-project-store';
import { SceneApiError } from '../../../client/scene-client';
import SharedViewPage from './page';

vi.mock('@/lib/share-api', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/share-api')>(), readShare: vi.fn(), readCompleteShare: vi.fn() }));
vi.mock('next/dynamic', () => ({ default: () => () => <div>只读三维预览</div> }));
const token = 'a'.repeat(64);
const snapshot = {
  publicationId: '50000000-0000-4000-8000-000000000001', name: '已发布客户方案', revision: 4, createdAt: '2026-10-02T12:00:00Z',
  scene: { schemaVersion: 1 as const, camera: 'overview' as const, lighting: 'neutral' as const, venue: { shape: 'rectangle' as const, width: 12, depth: 10, height: 3, entrances: [] }, objects: [] },
  materials: [], assets: [],
};
afterEach(() => { cleanup(); vi.useRealTimers(); vi.resetAllMocks(); window.history.replaceState(null, '', '/'); });

describe('anonymous publication view', () => {
  it('renders complete outdoor geometry and resource links, then removes them after revocation', async () => {
    const outdoor = createStarterOutdoorPlan();
    outdoor.facilities = Array.from({ length: 91 }, (_, index) => ({ id: crypto.randomUUID(), templateId: 'table', name: `设施 ${index + 1}`, position: { x: index, y: 0 }, rotationDeg: 0, size: { width: 1, depth: 1 }, notes: '' }));
    window.history.replaceState(null, '', `/view/#c${token}`);
    vi.mocked(readCompleteShare).mockResolvedValueOnce({ publicationId: snapshot.publicationId, revision: 4,
      manifest: { version: 1, scene: snapshot.scene, outdoor, dependencies: [] },
      assets: [{ id: crypto.randomUUID(), name: '执行资料.pdf', kind: 'attachment', format: 'pdf', byteSize: 16, sha256: 'b'.repeat(64), integrity: 'full', metadata: {}, url: 'https://storage.example/authorized.pdf', expiresIn: 300 }],
    }).mockRejectedValueOnce(new SceneApiError('SHARE_NOT_FOUND', 404, null));
    render(<SharedViewPage />);
    await screen.findByRole('heading', { name: '户外规划' });
    expect(document.querySelectorAll('svg.sc-share-outdoor-map rect')).toHaveLength(91);
    expect(screen.getByRole('link', { name: '执行资料.pdf' }).getAttribute('href')).toBe('https://storage.example/authorized.pdf');
    expect(document.querySelector('input,textarea,[contenteditable="true"]')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '刷新模型资源' }));
    await screen.findByText(/分享链接不存在或已撤销/);
    expect(document.querySelector('svg.sc-share-outdoor-map')).toBeNull();
    expect(screen.queryByRole('link', { name: '执行资料.pdf' })).toBeNull();
  });
  it('does not send a token from the query string', async () => {
    window.history.replaceState(null, '', `/view/?token=${token}`);
    render(<SharedViewPage />);
    await screen.findByText(/分享链接不完整/);
    expect(readShare).not.toHaveBeenCalled();
  });

  it('refreshes short-lived resources through share.read and removes a revoked snapshot', async () => {
    window.history.replaceState(null, '', `/view/#${token}`);
    vi.mocked(readShare).mockResolvedValueOnce(snapshot).mockRejectedValueOnce(new SceneApiError('SHARE_NOT_FOUND', 404, null));
    render(<SharedViewPage />);
    await screen.findByText('已发布客户方案');
    expect(readShare).toHaveBeenCalledWith(token);
    fireEvent.click(screen.getByRole('button', { name: '刷新模型资源' }));
    await screen.findByText(/分享链接不存在或已撤销/);
    expect(screen.queryByText('已发布客户方案')).toBeNull();
    expect(screen.queryByText('只读三维预览')).toBeNull();
  });

  it('offers no edit, Agent, library, lease or internal-note controls', async () => {
    window.history.replaceState(null, '', `/view/#${token}`);
    vi.mocked(readShare).mockResolvedValue(snapshot);
    render(<SharedViewPage />);
    await screen.findByText('已发布客户方案');
    expect(document.querySelector('input,textarea,select,[contenteditable="true"]')).toBeNull();
    for (const selector of ['#agent-panel', '.sc-agent-panel', '.cr-assistant', '#workbench-material-shelf', '.sc-cloud-trigger']) {
      expect(document.querySelector(selector)).toBeNull();
    }
    expect(screen.queryByRole('button', { name: /删除|编辑|保存|撤销|发布|登录/ })).toBeNull();
    expect(document.body.textContent).not.toMatch(/素材库|租约|编辑权|内部备注|PRIVATE_/);
  });

  it('announces authorization expiry without claiming the snapshot is current', async () => {
    vi.useFakeTimers();
    window.history.replaceState(null, '', `/view/#${token}`);
    vi.mocked(readShare).mockResolvedValue(snapshot);
    render(<SharedViewPage />);
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByText('已发布客户方案')).toBeTruthy();
    await act(async () => { vi.advanceTimersByTime(300_000); });
    expect(screen.getByText(/资源授权已到期/)).toBeTruthy();
    expect(readShare).toHaveBeenCalledTimes(1);
  });

  it('states the page scope under the title instead of implying everything is public', async () => {
    window.history.replaceState(null, '', `/view/#${token}`);
    vi.mocked(readShare).mockResolvedValue(snapshot);
    render(<SharedViewPage />);
    await screen.findByText('已发布客户方案');
    expect(screen.getByText(/此页包含：三维布置、物料清单与模型来源说明/).textContent).toContain('资料原件与扫描文件不随普通发布公开');
  });
});

describe('complete share content honesty (PUB-11, 2026-11-20 P1-B)', () => {
  const uuid = () => crypto.randomUUID();
  const object = (extra: Record<string, unknown>) => ({
    id: uuid(), materialId: 'table' as const, position: { x: 0, z: 0 }, rotation: 0,
    size: { width: 1, depth: 0.6, height: 0.75 }, color: '#4a5568', locked: false, notes: '', ...extra,
  });
  const asset = (extra: Record<string, unknown>) => ({
    id: uuid(), name: '资源', kind: 'attachment', format: 'pdf', byteSize: 16, sha256: 'b'.repeat(64),
    integrity: 'full' as const, metadata: {}, url: 'https://storage.example/a', expiresIn: 300, ...extra,
  });

  it('itemizes what the customer actually gets, per category, with missing models flagged', async () => {
    const publishedModelId = uuid();
    const missingModelId = uuid();
    window.history.replaceState(null, '', `/view/#c${token}`);
    vi.mocked(readCompleteShare).mockResolvedValueOnce({
      publicationId: snapshot.publicationId, revision: 6,
      manifest: {
        version: 1, dependencies: [],
        scene: { schemaVersion: 1 as const, camera: 'overview' as const, lighting: 'neutral' as const,
          venue: { shape: 'rectangle' as const, width: 30, depth: 20, height: 3, entrances: [] },
          objects: [
            object({}),
            object({ materialId: 'asset', assetId: publishedModelId }),
            object({ materialId: 'asset', assetId: missingModelId }),
          ] },
        outdoor: null,
      },
      assets: [
        asset({ name: '场地扫描.spz', kind: 'scan', format: 'spz' }),
        asset({ name: '执行资料.pdf', kind: 'attachment', format: 'pdf' }),
        asset({ id: publishedModelId, name: '展台.glb', kind: 'model', format: 'glb' }),
      ],
    });
    render(<SharedViewPage />);
    await screen.findByRole('heading', { name: '对外可见内容' });
    const scope = screen.getByTestId('share-scope').textContent;
    expect(scope).toContain('三维布置 · 3 件物件（1 件内置道具、2 件外部模型）');
    expect(scope).toContain('场地 30 × 20 米');
    expect(scope).toContain('资源文件 · 实景扫描 1、附件 1、模型 1');
    expect(scope).toContain('实景扫描文件以资源形式提供下载；本页三维画面不渲染扫描背景');
    expect(scope).toContain('有 1 件外部模型没有随本版发布');
    expect(scope).toContain('发布者的原始资料原件不在对外范围');
    // 资源列表逐项带类别，扫描/附件不再冒充三维内容
    expect(screen.getByRole('link', { name: '展台.glb' }).closest('li')?.textContent).toContain('GLB · 模型');
    expect(screen.getByText('场地扫描.spz').closest('li')?.textContent).toContain('SPZ · 实景扫描');
  });
});
