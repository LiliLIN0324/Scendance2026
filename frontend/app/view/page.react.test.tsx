// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readShare } from '@/lib/share-api';
import { SceneApiError } from '../../../client/scene-client';
import SharedViewPage from './page';

vi.mock('@/lib/share-api', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/share-api')>(), readShare: vi.fn() }));
vi.mock('next/dynamic', () => ({ default: () => () => <div>只读三维预览</div> }));
const token = 'a'.repeat(64);
const snapshot = {
  publicationId: '50000000-0000-4000-8000-000000000001', name: '已发布客户方案', revision: 4, createdAt: '2026-10-02T12:00:00Z',
  scene: { schemaVersion: 1 as const, camera: 'overview' as const, lighting: 'neutral' as const, venue: { shape: 'rectangle' as const, width: 12, depth: 10, height: 3, entrances: [] }, objects: [] },
  materials: [], assets: [],
};
afterEach(() => { cleanup(); vi.useRealTimers(); vi.resetAllMocks(); window.history.replaceState(null, '', '/'); });

describe('anonymous publication view', () => {
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
