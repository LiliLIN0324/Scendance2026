// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { intentStorageKey } from '@/lib/assets-api';
import { BackendSession, getBackendConfig, type GenerationCapabilities, type GenerationJob } from '@/lib/backend-session';
import { ensureGlbAsset } from '../three/glb-assets';
import { GeneratedModelLibrary } from './generated-model-library';

vi.mock('../three/glb-assets', async original => ({
  ...(await original<typeof import('../three/glb-assets')>()), ensureGlbAsset: vi.fn(),
}));
const id = '10000000-0000-4000-8000-000000000001';
const assetId = '20000000-0000-4000-8000-000000000001';
const legacyIntent = { requestId: '30000000-0000-4000-8000-000000000001', prompt: '旧面板中的木椅' };
const sessionKey = 'scendance:3d-intent:member';
const localKey = () => intentStorageKey(controller.config.apiUrl, 'member');
function job(state: GenerationJob['state'] = 'queued'): GenerationJob {
  return { id, owner_id: 'member', prompt: '绿色藤编椅', state, asset_id: state === 'ready' ? assetId : null,
    provider_job_id: null, next_poll_at: '2026-10-03T03:00:00Z', attempts: 0, error_code: null,
    provider_usage: null, created_at: '2026-10-03T03:00:00Z', updated_at: '2026-10-03T03:00:00Z' };
}
let controller: BackendSession;
let list: MockInstance<BackendSession['listGenerationJobs']>;
let create: MockInstance<BackendSession['createGenerationJob']>;
beforeEach(() => {
  sessionStorage.clear(); localStorage.clear();
  controller = new BackendSession(getBackendConfig({ url: '', anonKey: '' }));
  const snapshot = { ...controller.getSnapshot(), user: { id: 'member' },
    project: { id: 'project' } as NonNullable<ReturnType<BackendSession['getSnapshot']>['project']>, writeBlocked: false };
  vi.spyOn(controller, 'getSnapshot').mockReturnValue(snapshot);
  Object.assign(controller,{getGenerationCapabilities:vi.fn().mockResolvedValue({model:'hy-3d-3.0',textToModel:true,imageToModel:true,texture:false,textureRequiresImage:true}),uploadGenerationReference:vi.fn().mockResolvedValue({id:assetId})});
  list = vi.spyOn(controller, 'listGenerationJobs').mockResolvedValue([]);
  create = vi.spyOn(controller, 'createGenerationJob').mockResolvedValue(job());
  vi.mocked(ensureGlbAsset).mockResolvedValue(undefined);
});
afterEach(() => { cleanup(); controller.dispose(); vi.useRealTimers(); vi.restoreAllMocks(); vi.mocked(ensureGlbAsset).mockReset(); });

describe('single object generation UI', () => {
  it('retires all new HY3 creation controls and never resubmits saved legacy intents', async()=>{
    localStorage.setItem(localKey(),JSON.stringify(legacyIntent));
    sessionStorage.setItem(sessionKey,JSON.stringify(legacyIntent));
    render(<GeneratedModelLibrary controller={controller} onAdd={vi.fn()}/>);
    await waitFor(()=>expect(list).toHaveBeenCalledOnce());
    expect(screen.queryByLabelText('生成方式')).toBeNull();
    expect(screen.queryByLabelText('物料描述')).toBeNull();
    expect(screen.queryByLabelText('模型参考图')).toBeNull();
    expect(screen.queryByRole('button',{name:'生成 3D 模型'})).toBeNull();
    expect(create).not.toHaveBeenCalled();
    expect(localStorage.getItem(localKey())).toBe(JSON.stringify(legacyIntent));
    expect(sessionStorage.getItem(sessionKey)).toBe(JSON.stringify(legacyIntent));
  });
  it('keeps historical texture versions available for a deliberate preview',async()=>{
    list.mockResolvedValue([{...job('ready'),kind:'texture',source_asset_id:id}]);
    const onVariantReady=vi.fn();
    render(<GeneratedModelLibrary controller={controller} onAdd={vi.fn()} sourceAssetId={id} sourceObjectIds={['selected-instance']} onVariantReady={onVariantReady}/>);
    fireEvent.click(await screen.findByRole('button',{name:'预览纹理版本'}));
    expect(onVariantReady).toHaveBeenCalledWith({sourceAssetId:id,variantAssetId:assetId,objectIds:['selected-instance']});
    expect(create).not.toHaveBeenCalled();
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

  it('keeps historical models usable and cleared dimensions empty until corrected', async () => {
    list.mockResolvedValue([job('ready')]);
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<GeneratedModelLibrary controller={controller} onAdd={vi.fn()}/>);
    const add = await screen.findByRole('button', { name: '加入场地预览' });
    expect(screen.getByRole('heading',{name:'历史模型'})).toBeTruthy();
    fireEvent.change(screen.getByLabelText('生成模型宽度'), { target: { value: '' } });
    expect((screen.getByLabelText('生成模型宽度') as HTMLInputElement).value).toBe('');
    expect((add as HTMLButtonElement).disabled).toBe(true);
    expect(errors.mock.calls.some(args => args.some(value => String(value).includes('NaN')))).toBe(false);
    fireEvent.change(screen.getByLabelText('生成模型宽度'), { target: { value: '0.6' } });
    expect((add as HTMLButtonElement).disabled).toBe(false);
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
    expect(onAdd).not.toHaveBeenCalled(); expect(screen.queryByRole('alert')).toBeNull();
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

describe('Lux3D (Aholo) generation entry', () => {
  const luxCapabilities = { model: 'hy-3d-3.0', textToModel: true, imageToModel: true, texture: false, textureRequiresImage: true, aholoTextToModel: true, aholoImageToModel: true } as const;
  function capabilityMock(over: Partial<GenerationCapabilities> = luxCapabilities) {
    return vi.fn().mockResolvedValue({ ...luxCapabilities, ...over });
  }
  it('shows the entry only when the aholo capability is advertised', async () => {
    Object.assign(controller, { getGenerationCapabilities: capabilityMock({ aholoTextToModel: false }) });
    const off = render(<GeneratedModelLibrary controller={controller} onAdd={vi.fn()}/>);
    await screen.findByRole('heading', { name: '历史模型' });
    await act(async () => { await Promise.resolve(); });
    expect(screen.queryByRole('button', { name: '生成物件' })).toBeNull();
    off.unmount();
    Object.assign(controller, { getGenerationCapabilities: capabilityMock() });
    render(<GeneratedModelLibrary controller={controller} onAdd={vi.fn()}/>);
    expect(await screen.findByRole('button', { name: '生成物件' })).toBeTruthy();
    expect(screen.queryByLabelText('物料描述')).toBeNull();
    expect(screen.queryByLabelText('生成方式')).toBeNull();
  });
  it('teaches the three-step flow and waiting expectation next to the entry', async () => {
    Object.assign(controller, { getGenerationCapabilities: capabilityMock() });
    render(<GeneratedModelLibrary controller={controller} onAdd={vi.fn()}/>);
    const guide = await screen.findByLabelText('生成教程');
    expect(guide.textContent).toContain('加入场地预览');
    expect(guide.textContent).toContain('3-5 分钟');
    expect(guide.textContent).toContain('Aholo Lux3D');
    // 教程只随能力位出现，不随已退役 HY3 控件复活
    expect(screen.queryByLabelText('物料描述')).toBeNull();
  });
  it('routes an uploaded reference image to the image-to-3D identity and clears it after submit', async () => {
    Object.assign(controller, { getGenerationCapabilities: capabilityMock(), uploadGenerationReference: vi.fn().mockResolvedValue({ id: assetId }) });
    render(<GeneratedModelLibrary controller={controller} onAdd={vi.fn()}/>);
    const input = await screen.findByLabelText('参考图（可选）');
    fireEvent.change(input, { target: { files: [new File(['png'], 'venue.png', { type: 'image/png' })] } });
    await waitFor(() => expect(controller.uploadGenerationReference).toHaveBeenCalledOnce());
    expect(screen.getByText(/已选参考图：venue.png/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('物件描述'), { target: { value: '现场照片里的讲台' } });
    fireEvent.click(screen.getByRole('button', { name: '生成物件' }));
    await waitFor(() => expect(create).toHaveBeenCalledOnce());
    expect(create.mock.calls[0]![2]).toEqual({ kind: 'image', referenceImageAssetId: assetId, provider: 'aholo' });
    await waitFor(() => expect(screen.queryByText(/已选参考图/)).toBeNull());
  });
  it('submits an explicit aholo declaration and refreshes the task list', async () => {
    Object.assign(controller, { getGenerationCapabilities: capabilityMock() });
    render(<GeneratedModelLibrary controller={controller} onAdd={vi.fn()}/>);
    fireEvent.change(await screen.findByLabelText('物件描述'), { target: { value: '  一张白色圆桌  ' } });
    fireEvent.click(screen.getByRole('button', { name: '生成物件' }));
    await waitFor(() => expect(create).toHaveBeenCalledOnce());
    expect(create.mock.calls[0]![2]).toEqual({ provider: 'aholo' });
    expect(create.mock.calls[0]![0]).toBe('一张白色圆桌');
    await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
  });
  it('rejects an empty prompt locally without calling the paid endpoint', async () => {
    Object.assign(controller, { getGenerationCapabilities: capabilityMock() });
    render(<GeneratedModelLibrary controller={controller} onAdd={vi.fn()}/>);
    await screen.findByRole('button', { name: '生成物件' });
    expect((screen.getByRole('button', { name: '生成物件' }) as HTMLButtonElement).disabled).toBe(true);
    expect(create).not.toHaveBeenCalled();
  });
  it('surfaces a provider rejection without clearing the draft prompt', async () => {
    Object.assign(controller, { getGenerationCapabilities: capabilityMock() });
    create.mockRejectedValueOnce(Object.assign(new Error('x'), { code: 'SERVICE_NOT_CONFIGURED', status: 503 }));
    render(<GeneratedModelLibrary controller={controller} onAdd={vi.fn()}/>);
    fireEvent.change(await screen.findByLabelText('物件描述'), { target: { value: '一张白色圆桌' } });
    fireEvent.click(screen.getByRole('button', { name: '生成物件' }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeTruthy());
    expect((screen.getByLabelText('物件描述') as HTMLInputElement).value).toBe('一张白色圆桌');
  });
});
