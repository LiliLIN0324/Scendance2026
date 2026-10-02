// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { backendSceneToLayout } from '@/components/room-organizer/lib/backend-adapter';
import { BackendSession, getBackendConfig, type Scene, type SceneProposal } from '@/lib/backend-session';
import Page from './page';
import type { RoomLayout } from '@/components/room-organizer/lib/types';
import type { ComponentType } from 'react';

type EditorProps = { controller: BackendSession; onShowIntro: () => void };
let activeController: BackendSession;
let activeLayout: RoomLayout;
const onApply = vi.fn();

// Keep the async editor boundary. Only the WebGL shell is replaced; the actual
// brief, reference-image lifecycle, conversation and proposal components run.
vi.mock('next/dynamic', async () => {
  const { lazy, Suspense } = await import('react');
  return {
    default: (load: () => Promise<ComponentType<EditorProps>>) => {
      const Editor = lazy(async () => ({ default: await load() }));
      return function DynamicEditor(props: EditorProps) {
        return <Suspense fallback={<p>正在加载测试工作台</p>}><Editor {...props} /></Suspense>;
      };
    },
  };
});
vi.mock('@/lib/backend-session', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/backend-session')>();
  return { ...actual, createBackendSession: () => activeController };
});
vi.mock('@/components/room-organizer', async () => {
  const { SelectionProvider } = await import('@/components/room-organizer/contexts');
  const { CreativeStudioProvider, CreativeBriefPanel, CreativeAssistant } = await import('@/components/room-organizer/panels/creative-studio');
  return {
    RoomOrganizer: ({ controller, onShowIntro }: EditorProps) => <SelectionProvider value={{ selectedItemId: null, selectedItem: null, setSelectedItemId: () => {}, extraSelectedIds: new Set(), setExtraSelectedIds: () => {}, allSelectedIds: new Set(), selectOnly: () => {} }}>
      <CreativeStudioProvider controller={controller} layout={activeLayout} onApply={onApply}>
        <button onClick={onShowIntro}>返回介绍页</button>
        <CreativeBriefPanel /><CreativeAssistant />
      </CreativeStudioProvider>
    </SelectionProvider>,
  };
});

const projectId = '10000000-0000-4000-8000-000000000001';
const scene: Scene = { schemaVersion: 1, venue: { width: 10, depth: 8, height: 3, shape: 'rectangle', entrances: [] }, objects: [], camera: 'overview', lighting: 'warm' };
const candidate: Scene = { ...scene, objects: [{ id: '20000000-0000-4000-8000-000000000001', materialId: 'chair', position: { x: 2, z: 2 }, rotation: 0, size: { width: 0.5, depth: 0.5, height: 0.9 }, color: '#507050', locked: false, notes: '' }] };
const proposal: SceneProposal = { id: '30000000-0000-4000-8000-000000000001', project_id: projectId, session_id: '40000000-0000-4000-8000-000000000001', user_id: 'user-test', generation: 1, base_revision: 1, local_revision: 0, base_hash: 'a'.repeat(64), base_scene: scene, candidate, expires_at: '2099-01-01T00:00:00Z', applied_at: null, explanation: '保留一处交流座位。', warnings: [] };
const revokeObjectURL = vi.fn();
const createObjectURL = vi.fn();
const originalCreateURL = Object.getOwnPropertyDescriptor(URL, 'createObjectURL');
const originalRevokeURL = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL');
const originalScroll = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollTo');

function restore(object: object, key: string, descriptor: PropertyDescriptor | undefined): void {
  if (descriptor) Object.defineProperty(object, key, descriptor);
  else Reflect.deleteProperty(object, key);
}

beforeEach(() => {
  activeController = new BackendSession(getBackendConfig({ url: '', anonKey: '' }));
  activeLayout = backendSceneToLayout(scene, { projectId, name: '客户方案' });
  onApply.mockReset();
  createObjectURL.mockReset().mockReturnValue('blob:kept-reference');
  revokeObjectURL.mockReset();
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectURL });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectURL });
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, value: vi.fn() });
  vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ width: 400, height: 300, close: vi.fn() })));
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('No live requests in this test'); }));
});

afterEach(() => {
  cleanup();
  activeController.dispose();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  restore(URL, 'createObjectURL', originalCreateURL);
  restore(URL, 'revokeObjectURL', originalRevokeURL);
  restore(HTMLElement.prototype, 'scrollTo', originalScroll);
});

describe('introduction round trips', () => {
  it('defers the editor, then preserves the real brief, image, conversation and unsent message when returning', async () => {
    const rendered = render(<Page />);
    expect(screen.getByRole('heading', { name: '欢迎来到场域' })).toBeTruthy();
    expect(rendered.container.querySelector('input[type="file"]')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '先体验本地工作台' }));
    fireEvent.change(await screen.findByRole('textbox', { name: '客户需求' }), { target: { value: '举办一场 24 人自然风聚会。' } });
    fireEvent.change(rendered.container.querySelector('input[type="file"]')!, { target: { files: [new File(['image'], 'venue.png', { type: 'image/png' })] } });
    await screen.findByRole('img', { name: '参考：venue.png' });
    fireEvent.click(screen.getByRole('button', { name: '打开场域助手' }));
    fireEvent.change(screen.getByRole('textbox', { name: '告诉助手你的想法' }), { target: { value: '为活动保留合影区。' } });
    fireEvent.click(screen.getByRole('button', { name: '发送消息' }));
    fireEvent.change(screen.getByRole('textbox', { name: '告诉助手你的想法' }), { target: { value: '这条还没有发送。' } });

    fireEvent.click(screen.getByRole('button', { name: '返回介绍页' }));
    expect(screen.getByRole('heading', { name: '欢迎来到场域' })).toBeTruthy();
    expect(screen.queryByRole('textbox', { name: '客户需求' })).toBeNull();
    expect(screen.queryByRole('region', { name: '场域智能助手' })).toBeNull();
    expect(revokeObjectURL).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '先体验本地工作台' }));

    expect((await screen.findByRole('textbox', { name: '客户需求' }) as HTMLTextAreaElement).value).toBe('举办一场 24 人自然风聚会。');
    expect(screen.getByRole('img', { name: '参考：venue.png' }).getAttribute('src')).toBe('blob:kept-reference');
    expect(screen.getByText('为活动保留合影区。')).toBeTruthy();
    expect((screen.getByRole('textbox', { name: '告诉助手你的想法' }) as HTMLTextAreaElement).value).toBe('这条还没有发送。');
    expect(createObjectURL).toHaveBeenCalledOnce();
    rendered.unmount();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:kept-reference');
  });

  it('keeps a pending real proposal available for confirmation without regenerating it', async () => {
    const snapshot = { ...activeController.getSnapshot(), configured: true, user: { id: 'user-test', email: 'editor@example.com' }, writeBlocked: false, status: 'editing' as const, revision: 1, project: { id: projectId, studio_id: 'studio-test', name: '客户方案', revision: 1, scene } };
    vi.spyOn(activeController, 'getSnapshot').mockReturnValue(snapshot);
    const generate = vi.spyOn(activeController, 'requestProposal').mockResolvedValue(proposal);
    vi.spyOn(activeController, 'authorizeAssets').mockResolvedValue({ assetUrls: {}, assetNames: {} });
    const apply = vi.spyOn(activeController, 'applySceneProposal').mockResolvedValue({ id: projectId, revision: 2, scene: candidate, previousScene: scene, updatedAt: '2026-10-02T10:00:00Z', undoGroup: 'undo-test', acceptedLocally: true });
    render(<Page />);
    fireEvent.click(screen.getByRole('button', { name: '进入工作台' }));
    fireEvent.change(await screen.findByRole('textbox', { name: '客户需求' }), { target: { value: '保留一处交流座位。' } });
    fireEvent.click(screen.getByRole('button', { name: 'Generate 生成布置方案' }));
    await screen.findByText('方案提案 · 尚未应用');
    fireEvent.click(screen.getByRole('button', { name: '返回介绍页' }));
    expect(screen.getByText('editor@example.com')).toBeTruthy();
    expect(apply).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '进入工作台' }));
    fireEvent.click(await screen.findByRole('button', { name: '确认应用' }));
    await waitFor(() => expect(onApply).toHaveBeenCalledOnce());
    expect(generate).toHaveBeenCalledOnce();
    expect(apply).toHaveBeenCalledWith(proposal, scene);
  });
});
