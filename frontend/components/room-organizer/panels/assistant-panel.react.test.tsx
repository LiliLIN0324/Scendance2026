// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BackendSession, getBackendConfig, type AssistantProposal, type AppliedProposal } from '@/lib/backend-session';
import { sceneHash, type Scene } from '../../../../supabase/functions/_shared/domain';
import { backendSceneToLayout } from '../lib/backend-adapter';
import { AssistantPanel } from './assistant-panel';

const projectId = '10000000-0000-4000-8000-000000000001';
const scene: Scene = { schemaVersion: 1, venue: { width: 12, depth: 10, height: 3, shape: 'rectangle', entrances: [] }, objects: [], camera: 'overview', lighting: 'neutral' };
const candidate: Scene = { ...scene, objects: [{ id: '20000000-0000-4000-8000-000000000001', materialId: 'chair', position: { x: 2, z: 2 }, rotation: 0, size: { width: .5, depth: .5, height: .8 }, color: '#ffffff', locked: false, notes: '' }] };
let controller: BackendSession;
const mockFetch = vi.fn<typeof fetch>();
function queue(body: unknown) { mockFetch.mockResolvedValueOnce(new Response(JSON.stringify(body))); }
async function proposal(): Promise<AssistantProposal> {
  const state = controller.getSnapshot();
  return { id: crypto.randomUUID(), project_id: projectId, session_id: state.sessionId, generation: state.lease!.generation,
    base_revision: state.revision!, local_revision: state.localRevision, base_hash: await sceneHash(state.draft!), candidate,
    explanation: '新增一把白色椅子。', warnings: [], applied_at: null, expires_at: new Date(Date.now() + 600_000).toISOString() };
}
beforeEach(async () => {
  mockFetch.mockReset(); vi.stubGlobal('fetch', mockFetch);
  controller = new BackendSession(getBackendConfig({ url: 'https://example.supabase.co', anonKey: 'public' }));
  queue({ access_token: 'test', refresh_token: 'test', expires_in: 3600, user: { id: 'test-user' } });
  await controller.signIn('a@example.com', 'test');
  queue({ id: projectId, studio_id: 'studio', name: '测试', revision: 4, scene });
  await controller.getProject(projectId);
  queue({ sessionId: controller.getSnapshot().sessionId, generation: 3, revision: 4, scene, expiresAt: new Date(Date.now() + 90_000).toISOString() });
  await controller.acquireLease(projectId);
});
afterEach(() => { cleanup(); controller.dispose(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function setup() {
  const layout = backendSceneToLayout(scene, { projectId, name: '测试' });
  const onApplied = vi.fn(); const onConnect = vi.fn();
  const props = { controller, layout, selectedIds: [], bound: true, busy: false, onConnect, onApplied, onSaved: vi.fn() };
  const view = render(<AssistantPanel {...props}/>);
  fireEvent.click(screen.getByRole('button', { name: 'AI 助理' }));
  return { ...view, props, onApplied };
}
async function generate() {
  fireEvent.change(screen.getByLabelText('你想举办什么活动？'), { target: { value: '放一把白椅子' } });
  fireEvent.click(screen.getByRole('button', { name: '生成提案' }));
  await screen.findByRole('region', { name: '提案预览' });
}
describe('assistant confirmation and canvas protection', () => {
  it('previews without applying, then applies once after explicit confirmation', async () => {
    vi.spyOn(controller, 'generateProposal').mockImplementation(proposal);
    const apply = vi.spyOn(controller, 'applyProposal').mockResolvedValue({ id: projectId, revision: 5, scene: candidate, previousScene: scene, undoGroup: 'test' });
    const view = setup(); await generate();
    expect(screen.getByRole('img', { name: '提案俯视预览' })).toBeTruthy();
    expect(apply).not.toHaveBeenCalled(); expect(view.onApplied).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '确认应用并保存' }));
    await waitFor(() => expect(view.onApplied).toHaveBeenCalledTimes(1));
    expect(view.onApplied.mock.calls[0]![0].floors[0].items).toHaveLength(1);
    expect(screen.getByText(/已应用并保存为云端版本 5/)).toBeTruthy();
  });
  it('disables a preview after any canvas change', async () => {
    vi.spyOn(controller, 'generateProposal').mockImplementation(proposal);
    const view = setup(); await generate();
    view.rerender(<AssistantPanel {...view.props} layout={{ ...view.props.layout, width: 13 }}/>);
    expect(screen.getByRole('button', { name: '确认应用并保存' }).hasAttribute('disabled')).toBe(true);
    expect(view.onApplied).not.toHaveBeenCalled();
  });
  it('preserves canvas edits made while the apply request is in flight', async () => {
    vi.spyOn(controller, 'generateProposal').mockImplementation(proposal);
    let finish!: (value: AppliedProposal) => void;
    vi.spyOn(controller, 'applyProposal').mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const view = setup(); await generate();
    fireEvent.click(screen.getByRole('button', { name: '确认应用并保存' }));
    view.rerender(<AssistantPanel {...view.props} layout={{ ...view.props.layout, width: 13 }}/>);
    await act(async () => { finish({ id: projectId, revision: 5, scene: candidate, previousScene: scene, undoGroup: 'test' }); });
    expect(view.onApplied).not.toHaveBeenCalled();
    expect(view.props.onSaved).toHaveBeenCalledWith(candidate);
    expect(screen.getByText(/提交期间的新改动仍保留在本地/)).toBeTruthy();
  });
  it('requires a bound cloud project and directs the user to login', () => {
    const view = setup();
    view.rerender(<AssistantPanel {...view.props} bound={false}/>);
    expect(screen.getByRole('button', { name: '生成提案' }).hasAttribute('disabled')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '打开云项目' }));
    expect(view.props.onConnect).toHaveBeenCalledOnce();
  });
});
