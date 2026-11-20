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
});
