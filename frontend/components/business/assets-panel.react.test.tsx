// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { intentStorageKey, readGenerationIntent, type CloudAsset } from '@/lib/assets-api';
import { BackendSession, getBackendConfig, SceneApiError, type GenerationJob } from '@/lib/backend-session';
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
const job: GenerationJob = { id: '40000000-0000-4000-8000-000000000001', owner_id: userId, prompt: '木椅', state: 'ready', asset_id: asset.id, provider_job_id: 'provider-1', error_code: null, created_at: '2026-10-02T00:00:00Z', updated_at: '2026-10-02T00:00:00Z', next_poll_at: '2026-10-02T00:00:00Z', attempts: 1, provider_usage: {} };
let controller: BackendSession;
let jobs: GenerationJob[];
let savedScene: Scene;
let requests: MockInstance<BackendSession['businessRequest']>;
let createJob: MockInstance<BackendSession['createGenerationJob']>;
let authorize: MockInstance<BackendSession['authorizeAsset']>;
let markAdded: MockInstance<BackendSession['markGenerationAdded']>;
let listJobs: MockInstance<BackendSession['listGenerationJobs']>;

beforeEach(async () => {
  vi.stubEnv('NEXT_PUBLIC_GENERATION_ENABLED', 'true');
  window.localStorage.clear(); jobs = []; savedScene = scene;
  vi.mocked(ensureGlbAsset).mockClear();
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ access_token: 'test', refresh_token: 'test', expires_in: 3600, user: { id: userId } }))));
  controller = new BackendSession(getBackendConfig({ url: 'https://example.supabase.co', anonKey: 'public' }));
  await controller.signIn('test@example.com', 'password');
  vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ id: projectId, name: '测试', studio_id: 'studio', revision: 0, scene })));
  await controller.getProject(projectId);
  createJob = vi.spyOn(controller, 'createGenerationJob').mockResolvedValue({ ...job, state: 'queued', asset_id: null });
  listJobs = vi.spyOn(controller, 'listGenerationJobs').mockImplementation(async () => jobs);
  authorize = vi.spyOn(controller, 'authorizeAsset').mockResolvedValue(authorized);
  markAdded = vi.spyOn(controller, 'markGenerationAdded').mockResolvedValue({ ...job, state: 'added' });
  requests = vi.spyOn(controller, 'businessRequest').mockImplementation(async path => {
    if (path === '/assets') return [asset] as never;
    if (path === `/projects/${projectId}`) return { scene: savedScene } as never;
    throw new Error(`Unexpected route ${path}`);
  });
});
afterEach(() => { cleanup(); controller.dispose(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
function setup(bound = false) {
  const onApplyLayout = vi.fn();
  const props = { controller, layout: backendSceneToLayout(scene), onApplyLayout, bound, busy: false };
  const view = render(<AssetsPanel {...props}/>);
  fireEvent.click(screen.getByRole('button', { name: '素材与三维生成' }));
  return { ...view, props, onApplyLayout };
}
function generationTab(): void { fireEvent.click(screen.getByRole('tab', { name: '生成任务' })); }
function inputPrompt(value = '木椅'): void { fireEvent.change(screen.getByLabelText('描述需要的三维物件'), { target: { value } }); }

describe('personal assets and generation recovery', () => {
  it('does not duplicate the existing public model library', async () => {
    setup(); await screen.findByRole('button', { name: '预览 木椅' });
    expect(screen.getAllByRole('tab').map(tab => tab.textContent)).toEqual(['个人素材', '生成任务']);
    expect(requests.mock.calls.every(([path]) => path === '/assets')).toBe(true);
  });
  it('keeps submissions off by default while existing task previews remain available', async () => {
    vi.stubEnv('NEXT_PUBLIC_GENERATION_ENABLED', undefined); jobs = [job];
    setup(); generationTab(); inputPrompt();
    expect(screen.getByRole('button', { name: '确认创建生成任务' }).hasAttribute('disabled')).toBe(true);
    fireEvent.submit(screen.getByLabelText('描述需要的三维物件').closest('form')!);
    fireEvent.click(await screen.findByRole('button', { name: '预览生成结果' }));
    await screen.findByRole('region', { name: '三维素材预览' });
    expect(createJob).not.toHaveBeenCalled();
  });
  it('does not retry a persisted request while generation is disabled', () => {
    vi.stubEnv('NEXT_PUBLIC_GENERATION_ENABLED', 'false');
    window.localStorage.setItem(intentStorageKey(controller.config.apiUrl, userId), JSON.stringify({ requestId: crypto.randomUUID(), prompt: '旧请求' }));
    setup(); generationTab();
    expect(screen.getByRole('button', { name: '使用原请求编号重试' }).hasAttribute('disabled')).toBe(true);
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
  it('replays the same intent through the session generation method after a lost response and reload', async () => {
    createJob.mockRejectedValueOnce(new TypeError('连接中断'));
    const view = setup(); generationTab(); inputPrompt('木制沙龙椅');
    fireEvent.click(screen.getByRole('button', { name: '确认创建生成任务' }));
    await screen.findByText('连接中断');
    const [prompt, requestId] = createJob.mock.calls[0];
    expect(readGenerationIntent(window.localStorage, intentStorageKey(controller.config.apiUrl, userId))).toEqual({ prompt, requestId });
    view.unmount(); setup(); generationTab();
    fireEvent.click(screen.getByRole('button', { name: '使用原请求编号重试' }));
    await screen.findByText(/生成任务已记录/);
    expect(createJob.mock.calls).toEqual([[prompt, requestId], [prompt, requestId]]);
  });
  it('shows submit_unknown without offering another paid task', async () => {
    jobs = [{ ...job, state: 'submit_unknown', asset_id: null, error_code: 'PROVIDER_TIMEOUT' }];
    setup(); generationTab(); await screen.findByText(/提供商提交结果不确定/); inputPrompt();
    expect(screen.getByRole('button', { name: '确认创建生成任务' }).hasAttribute('disabled')).toBe(true);
    expect(createJob).not.toHaveBeenCalled();
  });
  it('preserves an uncertain request after response timeout and never retries automatically', async () => {
    vi.useFakeTimers(); createJob.mockImplementation(() => new Promise(() => {}));
    setup(); generationTab(); inputPrompt();
    fireEvent.click(screen.getByRole('button', { name: '确认创建生成任务' }));
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(screen.getByText(/提交响应超时/)).toBeTruthy();
    expect(createJob).toHaveBeenCalledOnce();
    expect(readGenerationIntent(window.localStorage, intentStorageKey(controller.config.apiUrl, userId))?.prompt).toBe('木椅');
  });
  it.each(['SERVICE_NOT_CONFIGURED', 'BILLING_NOT_CONFIGURED'])('does not fabricate a model for %s', async code => {
    createJob.mockRejectedValueOnce(new SceneApiError(code, 503, null));
    setup(); generationTab(); inputPrompt();
    fireEvent.click(screen.getByRole('button', { name: '确认创建生成任务' }));
    await screen.findByText(code === 'SERVICE_NOT_CONFIGURED' ? '三维生成服务尚未配置，请联系管理员完成配置。' : '生成预算尚未配置，请联系管理员。');
    expect(screen.getByRole('button', { name: '使用原请求编号重试' }).hasAttribute('disabled')).toBe(true);
    expect(screen.queryByRole('button', { name: '预览生成结果' })).toBeNull();
  });
  it('checks the saved server scene before calling the session mark-added method', async () => {
    jobs = [job]; setup(true); generationTab();
    fireEvent.click(await screen.findByRole('button', { name: '已保存，核对并同步状态' }));
    await screen.findByText(/云端已保存版本不含该素材/); expect(markAdded).not.toHaveBeenCalled();
    savedScene = { ...scene, objects: [{ id: crypto.randomUUID(), materialId: 'asset', assetId: asset.id, position: { x: 6, z: 5 }, rotation: 0, size: { width: 1, depth: 1, height: 1 }, color: '#ffffff', locked: false, notes: '' }] };
    fireEvent.click(screen.getByRole('button', { name: '已保存，核对并同步状态' }));
    await screen.findByText(/服务器已确认素材存在/);
    expect(markAdded).toHaveBeenCalledWith(job.id, projectId);
  });
  it('polls through the session list method only', async () => {
    vi.useFakeTimers(); setup(); generationTab();
    await act(async () => { await Promise.resolve(); });
    const initial = listJobs.mock.calls.length; jobs = [{ ...job, state: 'processing', asset_id: null }];
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(listJobs).toHaveBeenCalledTimes(initial + 1);
    expect(screen.getByText('正在生成')).toBeTruthy(); expect(createJob).not.toHaveBeenCalled();
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
