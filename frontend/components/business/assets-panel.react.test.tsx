// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { type CloudAsset } from '@/lib/assets-api';
import { BackendSession, getBackendConfig } from '@/lib/backend-session';
import { backendSceneToLayout } from '../room-organizer/lib/backend-adapter';
import { ensureGlbAsset } from '../room-organizer/three/glb-assets';
import { AssetsPanel } from './assets-panel';
import type { Scene } from '../../../supabase/functions/_shared/domain';

vi.mock('./scene-preview', () => ({ ScenePreview: () => <div>真实模型预览容器</div> }));
vi.mock('../room-organizer/three/glb-assets', () => ({ ensureGlbAsset: vi.fn().mockResolvedValue(undefined) }));
const projectId = '10000000-0000-4000-8000-000000000001';
const userId = '20000000-0000-4000-8000-000000000001';
const scene: Scene = { schemaVersion: 1, venue: { shape: 'rectangle', width: 12, depth: 10, height: 3, entrances: [] }, objects: [], camera: 'overview', lighting: 'neutral' };
const asset: CloudAsset = { id: '30000000-0000-4000-8000-000000000001', name: '木椅', source: 'hunyuan', format: 'glb', byte_size: 2048, metadata: { sourceSize: { width: .5, depth: .5, height: .9 } } };
const authorized = { id: asset.id, name: asset.name, url: 'https://example.supabase.co/storage/signed/chair.glb' };
let controller: BackendSession;
let requests: MockInstance<BackendSession['businessRequest']>;
let createJob: MockInstance<BackendSession['createGenerationJob']>;
let authorize: MockInstance<BackendSession['authorizeAsset']>;
let markAdded: MockInstance<BackendSession['markGenerationAdded']>;
let listJobs: MockInstance<BackendSession['listGenerationJobs']>;

beforeEach(async () => {
  vi.mocked(ensureGlbAsset).mockClear();
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ access_token: 'test', refresh_token: 'test', expires_in: 3600, user: { id: userId } }))));
  controller = new BackendSession(getBackendConfig({ url: 'https://example.supabase.co', anonKey: 'public' }));
  await controller.signIn('test@example.com', 'password');
  vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ id: projectId, name: '测试', studio_id: 'studio', revision: 0, scene })));
  await controller.getProject(projectId);
  createJob = vi.spyOn(controller, 'createGenerationJob');
  listJobs = vi.spyOn(controller, 'listGenerationJobs').mockResolvedValue([]);
  authorize = vi.spyOn(controller, 'authorizeAsset').mockResolvedValue(authorized);
  markAdded = vi.spyOn(controller, 'markGenerationAdded');
  requests = vi.spyOn(controller, 'businessRequest').mockImplementation(async path => {
    if (path === '/assets') return [asset] as never;
    throw new Error(`Unexpected route ${path}`);
  });
});
afterEach(() => { cleanup(); controller.dispose(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function setup(bound = false) {
  const onApplyLayout = vi.fn();
  const props = { controller, layout: backendSceneToLayout(scene), onApplyLayout, bound, busy: false };
  const view = render(<AssetsPanel {...props}/>);
  fireEvent.click(screen.getByRole('button', { name: '个人云素材' }));
  return { ...view, props, onApplyLayout };
}
describe('personal cloud assets', () => {
  it('only lists personal assets without another AI generation entry or requests', async () => {
    setup(); await screen.findByRole('button', { name: '预览 木椅' });
    expect(screen.queryByRole('tab')).toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByText(/生成任务/)).toBeNull();
    expect(requests.mock.calls.every(([path]) => path === '/assets')).toBe(true);
    expect(listJobs).not.toHaveBeenCalled();
    expect(createJob).not.toHaveBeenCalled();
  });
  it('refreshes personal assets explicitly without polling generation jobs', async () => {
    vi.useFakeTimers(); setup();
    await act(async () => { await Promise.resolve(); });
    expect(requests).toHaveBeenCalledOnce();
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(requests).toHaveBeenCalledOnce();
    requests.mockResolvedValueOnce([{ ...asset, name: '新木椅' }]);
    fireEvent.click(screen.getByRole('button', { name: '刷新素材' }));
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByRole('button', { name: '预览 新木椅' })).toBeTruthy();
    expect(requests).toHaveBeenCalledTimes(2);
    expect(listJobs).not.toHaveBeenCalled();
    expect(createJob).not.toHaveBeenCalled();
  });
  it('reauthorizes at explicit placement and keeps asset IDs, sizes and original material', async () => {
    const view = setup(); fireEvent.click(await screen.findByRole('button', { name: '预览 木椅' }));
    const add = await screen.findByRole('button', { name: '确认加入当前画布' });
    expect(ensureGlbAsset).toHaveBeenCalledWith(asset.id, authorized.url);
    expect(view.onApplyLayout).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('模型宽（米）'), { target: { value: '1.2' } });
    fireEvent.click(add);
    await waitFor(() => expect(view.onApplyLayout).toHaveBeenCalledOnce());
    expect(authorize).toHaveBeenCalledTimes(2);
    expect(view.onApplyLayout.mock.calls[0][0].floors[0].items[0]).toMatchObject({ assetId: asset.id, materialId: 'asset', width: 1.2, color: '#ffffff' });
    expect(markAdded).not.toHaveBeenCalled();
    expect(requests.mock.calls.some(([path]) => path.includes('/scene'))).toBe(false);
  });
  it('preserves canvas edits while confirmation authorization is pending', async () => {
    const view = setup(); fireEvent.click(await screen.findByRole('button', { name: '预览 木椅' }));
    let finish!: (asset: typeof authorized) => void;
    authorize.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    fireEvent.click(await screen.findByRole('button', { name: '确认加入当前画布' }));
    view.rerender(<AssetsPanel {...view.props} layout={{ ...view.props.layout, width: 14 }}/>);
    await act(async () => { finish(authorized); });
    expect(view.onApplyLayout).not.toHaveBeenCalled();
    expect(screen.getByText(/确认期间画布已变化/)).toBeTruthy();
  });
  it('keeps the previous list available when a manual refresh fails', async () => {
    setup(); await screen.findByRole('button', { name: '预览 木椅' });
    requests.mockRejectedValueOnce(new Error('连接中断'));
    fireEvent.click(screen.getByRole('button', { name: '刷新素材' }));
    await screen.findByText('连接中断');
    expect(screen.getByRole('button', { name: '预览 木椅' })).toBeTruthy();
  });
  it('requires valid dimensions and edit permission to add a personal asset', async () => {
    const view = setup(); fireEvent.click(await screen.findByRole('button', { name: '预览 木椅' }));
    const add = await screen.findByRole('button', { name: '确认加入当前画布' });
    expect((screen.getByLabelText('模型高（米）') as HTMLInputElement).value).toBe('0.9');
    fireEvent.change(screen.getByLabelText('模型宽（米）'), { target: { value: '0' } });
    expect(add.hasAttribute('disabled')).toBe(true);
    fireEvent.change(screen.getByLabelText('模型宽（米）'), { target: { value: '1' } });
    expect(add.hasAttribute('disabled')).toBe(false);
    view.rerender(<AssetsPanel {...view.props} bound={true}/>);
    expect(add.hasAttribute('disabled')).toBe(true);
    fireEvent.click(add);
    expect(view.onApplyLayout).not.toHaveBeenCalled();
  });
  it('discards pending preview completion after sign out', async () => {
    let finish!: (asset: typeof authorized) => void;
    authorize.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    setup(); fireEvent.click(await screen.findByRole('button', { name: '预览 木椅' }));
    await act(async () => { await controller.signOut(); finish(authorized); });
    expect(screen.queryByRole('region', { name: '三维素材预览' })).toBeNull();
    expect(screen.getByText(/请先登录工作室/)).toBeTruthy();
  });
});
