// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { BackendSession, getBackendConfig, type GenerationJob } from '@/lib/backend-session';
import { ensureGlbAsset } from '../three/glb-assets';
import { GeneratedModelLibrary } from './generated-model-library';

vi.mock('../three/glb-assets', async original => ({
  ...(await original<typeof import('../three/glb-assets')>()), ensureGlbAsset: vi.fn(),
}));
const id = '10000000-0000-4000-8000-000000000001';
const assetId = '20000000-0000-4000-8000-000000000001';
function job(state: GenerationJob['state'] = 'queued'): GenerationJob {
  return { id, owner_id: 'member', prompt: '绿色藤编椅', state, asset_id: state === 'ready' ? assetId : null,
    provider_job_id: null, next_poll_at: '2026-10-03T03:00:00Z', attempts: 0, error_code: null,
    provider_usage: null, created_at: '2026-10-03T03:00:00Z', updated_at: '2026-10-03T03:00:00Z' };
}
let controller: BackendSession;
let list: MockInstance<BackendSession['listGenerationJobs']>;
let create: MockInstance<BackendSession['createGenerationJob']>;
beforeEach(() => {
  sessionStorage.clear();
  controller = new BackendSession(getBackendConfig({ url: '', anonKey: '' }));
  const snapshot = { ...controller.getSnapshot(), user: { id: 'member' },
    project: { id: 'project' } as NonNullable<ReturnType<BackendSession['getSnapshot']>['project']>, writeBlocked: false };
  vi.spyOn(controller, 'getSnapshot').mockReturnValue(snapshot);
  list = vi.spyOn(controller, 'listGenerationJobs').mockResolvedValue([]);
  create = vi.spyOn(controller, 'createGenerationJob').mockResolvedValue(job());
  vi.mocked(ensureGlbAsset).mockResolvedValue(undefined);
});
afterEach(() => { cleanup(); controller.dispose(); vi.useRealTimers(); vi.restoreAllMocks(); vi.mocked(ensureGlbAsset).mockReset(); });

describe('single object generation UI', () => {
  it('refuses a new chat submission if the earlier request record is unreadable', async () => {
    sessionStorage.setItem('scendance:3d-intent:member','{broken');
    const result=vi.fn();
    render(<GeneratedModelLibrary controller={controller} onAdd={vi.fn()} presentation="assistant" onAssistantResult={result}
      assistantRequest={{requestId:id,prompt:'藤编椅',userId:'member',projectId:'project'}}/>);
    await waitFor(()=>expect(result).toHaveBeenCalled());expect(create).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toContain('无法读取上一次模型请求');
  });

  it('keeps the earlier uncertain request when a new chat request arrives', async () => {
    const prior={requestId:id,prompt:'原来的椅子'};
    sessionStorage.setItem('scendance:3d-intent:member',JSON.stringify(prior));
    const result=vi.fn();
    render(<GeneratedModelLibrary controller={controller} onAdd={vi.fn()} presentation="assistant" onAssistantResult={result}
      assistantRequest={{requestId:assetId,prompt:'新的灯具',userId:'member',projectId:'project'}}/>);
    await waitFor(()=>expect(result).toHaveBeenCalled());
    expect(create).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button',{name:'核对并继续同一请求'}));
    await waitFor(()=>expect(create).toHaveBeenCalledWith('原来的椅子',id));
  });

  it('does not submit a chat request created under another account', async () => {
    const result=vi.fn();
    render(<GeneratedModelLibrary controller={controller} onAdd={vi.fn()} presentation="assistant" onAssistantResult={result}
      assistantRequest={{requestId:id,prompt:'藤编椅',userId:'another-user',projectId:'project'}}/>);
    await waitFor(()=>expect(result).toHaveBeenCalled());
    expect(create).not.toHaveBeenCalled();
  });

  it('only creates a paid job after an explicit click', async () => {
    render(<GeneratedModelLibrary controller={controller} onAdd={vi.fn()}/>);
    await waitFor(() => expect(list).toHaveBeenCalledOnce());
    expect(create).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('物料描述'), { target: { value: '  绿色藤编椅  ' } });
    fireEvent.click(screen.getByRole('button', { name: '生成 3D 模型' }));
    await waitFor(() => expect(create).toHaveBeenCalledOnce());
    expect(create.mock.calls[0]![0]).toBe('绿色藤编椅');
    expect(create.mock.calls[0]![1]).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('recovers an uncertain creation after remount and explicitly retries the identical intent', async () => {
    create.mockRejectedValueOnce(new TypeError('connection reset'));
    const first = render(<GeneratedModelLibrary controller={controller} onAdd={vi.fn()}/>);
    fireEvent.change(screen.getByLabelText('物料描述'), { target: { value: '绿色藤编椅' } });
    fireEvent.click(screen.getByRole('button', { name: '生成 3D 模型' }));
    await screen.findByRole('alert');
    const original = create.mock.calls[0]; first.unmount();
    render(<GeneratedModelLibrary controller={controller} onAdd={vi.fn()}/>);
    expect((screen.getByLabelText('物料描述') as HTMLTextAreaElement).disabled).toBe(true);
    expect(create).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: '核对并继续同一请求' }));
    await waitFor(() => expect(create).toHaveBeenCalledTimes(2));
    expect(create.mock.calls[1]).toEqual(original);
    await waitFor(() => expect(sessionStorage.getItem('scendance:3d-intent:member')).toBeNull());
  });

  it('does not retry a submit_unknown task while polling', async () => {
    vi.useFakeTimers(); list.mockResolvedValue([job('submit_unknown')]);
    render(<GeneratedModelLibrary controller={controller} onAdd={vi.fn()}/>);
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByRole('status').textContent).toContain('待核对');
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(list).toHaveBeenCalledOnce(); expect(create).not.toHaveBeenCalled();
  });

  it('resumes active task status reads without another generation', async () => {
    vi.useFakeTimers(); list.mockResolvedValueOnce([job('processing')]).mockResolvedValue([job('ready')]);
    render(<GeneratedModelLibrary controller={controller} onAdd={vi.fn()}/>);
    await act(async () => { await Promise.resolve(); await vi.advanceTimersByTimeAsync(30_000); });
    expect(screen.getByRole('status').textContent).toContain('已就绪');
    expect(list).toHaveBeenCalledTimes(2); expect(create).not.toHaveBeenCalled();
  });

  it('uses the real authorized GLB and user dimensions before placing a generated asset', async () => {
    list.mockResolvedValue([job('ready')]);
    const authorize = vi.spyOn(controller, 'authorizeAsset').mockResolvedValue({ id: assetId, name: '藤编椅', url: 'https://storage.example/chair.glb' });
    const onAdd = vi.fn(); render(<GeneratedModelLibrary controller={controller} onAdd={onAdd}/>);
    await screen.findByRole('button', { name: '加入场地预览' });
    fireEvent.change(screen.getByLabelText('生成模型宽度'), { target: { value: '0.6' } });
    fireEvent.click(screen.getByRole('button', { name: '加入场地预览' }));
    await waitFor(() => expect(onAdd).toHaveBeenCalledOnce());
    expect(authorize).toHaveBeenCalledWith(assetId);
    expect(ensureGlbAsset).toHaveBeenCalledWith(assetId, 'https://storage.example/chair.glb');
    expect(onAdd.mock.calls[0]![0]).toMatchObject({ assetId, source: 'generated', width: 0.6, name: '藤编椅' });
  });

  it('does not place a late download into a different project', async () => {
    list.mockResolvedValue([job('ready')]);
    vi.spyOn(controller, 'authorizeAsset').mockResolvedValue({ id: assetId, name: '藤编椅', url: 'https://storage.example/chair.glb' });
    let finish!: () => void;
    vi.mocked(ensureGlbAsset).mockImplementation(() => new Promise(resolve => { finish = () => resolve(); }));
    const onAdd = vi.fn(); const view = render(<GeneratedModelLibrary controller={controller} onAdd={onAdd}/>);
    fireEvent.click(await screen.findByRole('button', { name: '加入场地预览' }));
    await waitFor(() => expect(finish).toBeTypeOf('function'));
    vi.mocked(controller.getSnapshot).mockReturnValue({ ...controller.getSnapshot(), project: { ...controller.getSnapshot().project!, id: 'other' } });
    view.rerender(<GeneratedModelLibrary controller={controller} onAdd={onAdd}/>);
    await act(async () => { finish(); });
    expect(onAdd).not.toHaveBeenCalled(); expect(screen.getByRole('alert').textContent).toContain('已变化');
  });

  it('keeps ready models unavailable while the floor is full or editing is blocked', async () => {
    list.mockResolvedValue([job('ready')]);
    render(<GeneratedModelLibrary controller={controller} disabled onAdd={vi.fn()}/>);
    expect((await screen.findByRole('button', { name: '加入场地预览' }) as HTMLButtonElement).disabled).toBe(true);
    expect(ensureGlbAsset).not.toHaveBeenCalled();
  });

  it('marks a task added only after its real asset occurs in the saved cloud scene', async () => {
    list.mockResolvedValue([job('ready')]);
    const saved = { ...controller.getSnapshot(), dirty: true, project: { ...controller.getSnapshot().project!, revision: 1,
      scene: { schemaVersion: 1 as const, venue: { width: 12, depth: 10, height: 3, shape: 'rectangle' as const, entrances: [] },
        objects: [{ id, materialId: 'asset' as const, assetId, position: { x: 1, z: 1 }, rotation: 0,
          size: { width: 1, depth: 1, height: 1 }, color: '#ffffff', locked: false, notes: '' }],
        camera: 'overview' as const, lighting: 'neutral' as const } } };
    vi.mocked(controller.getSnapshot).mockReturnValue(saved);
    const mark = vi.spyOn(controller, 'markGenerationAdded').mockResolvedValue({ ...job('ready'), state: 'added' });
    const view = render(<GeneratedModelLibrary controller={controller} onAdd={vi.fn()}/>);
    await screen.findByRole('button', { name: '加入场地预览' });
    expect(mark).not.toHaveBeenCalled();
    vi.mocked(controller.getSnapshot).mockReturnValue({ ...saved, dirty: false });
    view.rerender(<GeneratedModelLibrary controller={controller} onAdd={vi.fn()}/>);
    await waitFor(() => expect(mark).toHaveBeenCalledWith(id, 'project'));
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('已保存到场地'));
  });
});
