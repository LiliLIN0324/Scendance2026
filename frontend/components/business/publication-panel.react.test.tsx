// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SceneApiError, type BackendSession } from '@/lib/backend-session';
import { PublicationPanel } from './publication-panel';

const projectId = '30000000-0000-4000-8000-000000000001';
const id = '50000000-0000-4000-8000-000000000001';
const published = { shareId: id, publicationId: id, revision: 7, createdAt: '2026-10-02T12:00:00Z', token: 'a'.repeat(64), url: `https://app.example/view/#${'a'.repeat(64)}` };
afterEach(cleanup);

describe('publication panel', () => {
  it('requires a saved draft and publishes precisely the known cloud revision, then revokes', async () => {
    const request = vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce(published).mockResolvedValueOnce({ revoked: true });
    const controller = { businessRequest: request } as unknown as BackendSession;
    const view = render(<PublicationPanel controller={controller} projectId={projectId} revision={7} dirty />);
    await screen.findByText('还没有发布过此项目。');
    expect((screen.getByRole('button', { name: '发布版本 7' }) as HTMLButtonElement).disabled).toBe(true);
    view.rerender(<PublicationPanel controller={controller} projectId={projectId} revision={7} dirty={false} />);
    fireEvent.click(screen.getByRole('button', { name: '发布版本 7' }));
    await screen.findByRole('textbox', { name: '客户分享链接' });
    expect(request).toHaveBeenNthCalledWith(2, `/projects/${projectId}/publish`, 'POST', { expectedRevision: 7 });
    expect((screen.getByRole('textbox', { name: '客户分享链接' }) as HTMLInputElement).value).toBe(published.url);
    fireEvent.click(screen.getByRole('button', { name: '撤销版本 7 的分享' }));
    await screen.findByText(/链接已撤销/);
    expect(request).toHaveBeenNthCalledWith(3, `/projects/${projectId}/shares/${id}`, 'DELETE');
    expect(screen.queryByRole('textbox', { name: '客户分享链接' })).toBeNull();
  });

  it('does not show a new link when cloud revision changed', async () => {
    const request = vi.fn().mockResolvedValueOnce([]).mockRejectedValueOnce(new SceneApiError('REVISION_CONFLICT', 409, null));
    render(<PublicationPanel controller={{ businessRequest: request } as unknown as BackendSession} projectId={projectId} revision={7} dirty={false} />);
    await screen.findByText('还没有发布过此项目。');
    fireEvent.click(screen.getByRole('button', { name: '发布版本 7' }));
    await screen.findByText(/云端版本已变化/);
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('ignores a previous project response after switching project', async () => {
    let resolveOld!: (value: unknown) => void;
    const request = vi.fn().mockReturnValueOnce(new Promise(resolve => { resolveOld = resolve; })).mockResolvedValueOnce([]);
    const controller = { businessRequest: request } as unknown as BackendSession;
    const view = render(<PublicationPanel controller={controller} projectId={projectId} revision={7} dirty={false} />);
    view.rerender(<PublicationPanel controller={controller} projectId={id} revision={0} dirty={false} />);
    await screen.findByText('还没有发布过此项目。');
    resolveOld([{ ...published, revokedAt: null }]);
    await waitFor(() => expect(screen.queryByRole('button', { name: '撤销版本 7 的分享' })).toBeNull());
  });
});
