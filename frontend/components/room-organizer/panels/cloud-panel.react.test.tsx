// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BackendSession, createBackendSession, getBackendConfig, type Scene } from '@/lib/backend-session';
import { registerSourceFlush } from '@/lib/source-storage';
import { backendSceneToLayout } from '../lib/backend-adapter';
import { CloudPanel } from './cloud-panel';

vi.mock('@/lib/backend-session', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/backend-session')>();
  return { ...actual, createBackendSession: vi.fn() };
});
vi.mock('../three/glb-assets', () => ({ ensureGlbAsset: vi.fn() }));

const projectId = '10000000-0000-4000-8000-000000000001';
const otherId = '10000000-0000-4000-8000-000000000002';
const studioId = '20000000-0000-4000-8000-000000000001';
const scene: Scene = { schemaVersion: 1, venue: { width: 12, depth: 10, height: 3, shape: 'rectangle', entrances: [] }, objects: [], camera: 'overview', lighting: 'neutral' };
const original = { id: projectId, name: '原云项目', studio_id: studioId, revision: 2, scene };
const other = { ...original, id: otherId, name: '另一个云项目' };
const mockFetch = vi.fn<typeof fetch>();
let controller: BackendSession;

function json(body: unknown) { return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } }); }
function queue(body: unknown) { mockFetch.mockResolvedValueOnce(json(body)); }

beforeEach(async () => {
  mockFetch.mockReset();
  vi.stubGlobal('fetch', mockFetch);
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value(this: HTMLDialogElement) { this.setAttribute('open', ''); } });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value(this: HTMLDialogElement) { this.removeAttribute('open'); } });
  controller = new BackendSession(getBackendConfig({ url: 'https://example.supabase.co', anonKey: 'sb_publishable_test' }));
  vi.mocked(createBackendSession).mockReturnValue(controller);
  queue({ access_token: 'access-test', refresh_token: 'refresh-test', expires_in: 3600, user: { id: 'user-a', email: 'test@example.com' } });
  await controller.signIn('test@example.com', 'password');
  queue(original);
  await controller.getProject(projectId);
});

afterEach(() => {
  cleanup();
  controller.dispose();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('CloudPanel delayed project replacement', () => {
  it('waits for live source inputs before sending the new project request', async () => {
    let finishFlush!:()=>void;
    const unregister=registerSourceFlush(projectId,()=>new Promise<void>(resolve=>{finishFlush=resolve;}));
    const create=vi.spyOn(controller,'createProject').mockRejectedValue(new Error('测试停止于创建请求'));
    queue([]);
    queue([{id:studioId,name:'工作室',role:'owner',displayName:'A'}]);
    const rendered=render(<CloudPanel layout={backendSceneToLayout(scene,{projectId})} onLoadLayout={vi.fn()}/>);
    fireEvent.click(rendered.container.querySelector('.sc-cloud-trigger')!);
    await waitFor(()=>expect(screen.getByRole('button',{name:'把当前画布创建为新项目'}).hasAttribute('disabled')).toBe(false));
    fireEvent.click(screen.getByRole('button',{name:'把当前画布创建为新项目'}));
    await waitFor(()=>expect(finishFlush).toBeTypeOf('function'));
    expect(create).not.toHaveBeenCalled();
    await act(async()=>{finishFlush();});
    expect(create).toHaveBeenCalledOnce();
    expect(await screen.findByText('测试停止于创建请求')).toBeTruthy();
    unregister();
  });

  it('never labels a local scene preset as saved to the cloud', async () => {
    queue([other]);
    queue([{ id: studioId, name: '工作室', role: 'owner', displayName: 'A' }]);
    const layout = { ...backendSceneToLayout(scene), scenePreset: 'popup' as const };
    render(<CloudPanel layout={layout} onLoadLayout={vi.fn()} />);
    expect(screen.getByRole('button', { name: /预设 · 本地保存/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /云端已保存/ })).toBeNull();
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(4));
    expect(controller.getSnapshot().draft).not.toEqual(layout);
  });
  it.each(['open', 'acquire', 'create'] as const)('preserves edits made while the %s request is pending', async action => {
    const initialLayout = backendSceneToLayout(scene, { projectId, name: original.name });
    const onLoadLayout = vi.fn();
    queue([other]);
    queue([{ id: studioId, name: '工作室', role: 'owner', displayName: 'A' }]);
    const rendered = render(<CloudPanel layout={initialLayout} onLoadLayout={onLoadLayout} />);
    fireEvent.click(rendered.container.querySelector('.sc-cloud-trigger')!);
    await waitFor(() => expect(screen.getByRole('button', { name: '打开' }).hasAttribute('disabled')).toBe(false));

    let finish!: (response: Response) => void;
    mockFetch.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const label = action === 'open' ? '打开' : action === 'acquire' ? '获取编辑权' : '把当前画布创建为新项目';
    fireEvent.click(screen.getByRole('button', { name: label }));
    await waitFor(() => expect(finish).toBeTypeOf('function'));

    // The dialog can be closed while busy, so edits on the canvas must remain safe.
    fireEvent.click(screen.getByRole('button', { name: '关闭云项目' }));
    const changedLayout = { ...initialLayout, width: 13 };
    rendered.rerender(<CloudPanel layout={changedLayout} onLoadLayout={onLoadLayout} />);
    const sessionId = controller.getSnapshot().sessionId;
    if (action === 'acquire') {
      queue({ sessionId, generation: 4, revision: 2, expiresAt: new Date().toISOString() });
    }
    await act(async () => {
      finish(json(action === 'acquire'
        ? { sessionId, generation: 4, revision: 2, scene, expiresAt: new Date(Date.now() + 90_000).toISOString() }
        : other));
    });
    await waitFor(() => expect(screen.getByText(/加载期间画布有新改动/)).toBeTruthy());
    expect(onLoadLayout).not.toHaveBeenCalled();
    expect(controller.getSnapshot().writeBlocked).toBe(true);
    fireEvent.click(rendered.container.querySelector('.sc-cloud-trigger')!);
    expect(screen.getByRole('button', { name: '保存到云端' }).hasAttribute('disabled')).toBe(true);
    expect(screen.queryByText(/已载入最新版本并获得编辑权|已打开云端方案|新项目已保存/)).toBeNull();
    if (action === 'acquire') {
      const lastRequest = mockFetch.mock.calls.at(-1)!;
      expect(String(lastRequest[0])).toContain(`/projects/${projectId}/lease/release`);
    }
  });
});


it('uses the canonical auth page instead of a second cloud login form', () => {
  const anonymous = new BackendSession(getBackendConfig({ url: 'https://example.supabase.co', anonKey: 'sb_publishable_test' }));
  const rendered = render(<CloudPanel controller={anonymous} layout={backendSceneToLayout(scene)} onLoadLayout={vi.fn()} />);
  fireEvent.click(rendered.container.querySelector('.sc-cloud-trigger')!);
  expect(screen.queryByLabelText('密码')).toBeNull();
  expect(screen.getByRole('link', { name: '前往登录' }).getAttribute('href')).toBe('/auth');
  fireEvent.click(screen.getByRole('link', { name: '前往登录' }));
  expect(rendered.container.querySelector('dialog')?.hasAttribute('open')).toBe(false);
  anonymous.dispose();
});

it('closes the cloud dialog when signing out redirects to auth', async () => {
  queue([]);
  queue([]);
  const rendered = render(<CloudPanel controller={controller} layout={backendSceneToLayout(scene)} onLoadLayout={vi.fn()} />);
  fireEvent.click(rendered.container.querySelector('.sc-cloud-trigger')!);
  expect(rendered.container.querySelector('dialog')?.hasAttribute('open')).toBe(true);
  await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(4));
  queue({});
  fireEvent.click(screen.getByRole('button', { name: '退出登录' }));
  await waitFor(() => expect(controller.getSnapshot().user).toBeNull());
  expect(rendered.container.querySelector('dialog')?.hasAttribute('open')).toBe(false);
});
