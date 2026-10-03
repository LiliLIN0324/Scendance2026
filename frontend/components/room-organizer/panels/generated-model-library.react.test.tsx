// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { intentStorageKey } from '@/lib/assets-api';
import { BackendSession, getBackendConfig, type GenerationJob } from '@/lib/backend-session';
import { ensureGlbAsset } from '../three/glb-assets';
import { GeneratedModelLibrary, type ModelGenerationSeed } from './generated-model-library';

vi.mock('../three/glb-assets', async original => ({
  ...(await original<typeof import('../three/glb-assets')>()), ensureGlbAsset: vi.fn(),
}));
const id = '10000000-0000-4000-8000-000000000001';
const assetId = '20000000-0000-4000-8000-000000000001';
const legacyIntent = { requestId: '30000000-0000-4000-8000-000000000001', prompt: '旧面板中的木椅' };
const sessionIntent = { requestId: '30000000-0000-4000-8000-000000000002', prompt: '当前页的灯具' };
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
  it('uploads an image explicitly, persists the full intent and recovers it without a new paid identity',async()=>{
    create.mockRejectedValueOnce(new Error('network unknown'));
    const view=render(<GeneratedModelLibrary controller={controller} onAdd={vi.fn()}/>);
    await waitFor(()=>expect((screen.getByRole('option',{name:'参考图生成'}) as HTMLOptionElement).disabled).toBe(false));
    fireEvent.change(screen.getByLabelText('生成方式'),{target:{value:'image'}});
    fireEvent.change(screen.getByLabelText('物料描述'),{target:{value:'参考图中的花瓶'}});
    fireEvent.change(screen.getByLabelText('模型参考图'),{target:{files:[new File(['image'],'vase.png',{type:'image/png'})]}});
    await screen.findByText('vase.png');
    fireEvent.click(screen.getByRole('button',{name:'生成 3D 模型'}));
    await screen.findByRole('alert');
    expect(create.mock.calls[0]![2]).toEqual({kind:'image',referenceImageAssetId:assetId,sourceAssetId:undefined});
    const saved=JSON.parse(localStorage.getItem(localKey())!);
    expect(saved).toMatchObject({kind:'image',referenceImageAssetId:assetId,prompt:'参考图中的花瓶'});
    expect((screen.getByLabelText('生成方式') as HTMLSelectElement).disabled).toBe(true);
    view.unmount();render(<GeneratedModelLibrary controller={controller} onAdd={vi.fn()}/>);
    fireEvent.click(screen.getByRole('button',{name:'核对并继续同一请求'}));
    await waitFor(()=>expect(create).toHaveBeenCalledTimes(2));
    expect(create.mock.calls[1]).toEqual(create.mock.calls[0]);
  });
  it('lets a first request rejected before creation be corrected, but never discards an uncertain restored request',async()=>{
    const invalid=Object.assign(new Error('INVALID_REFERENCE_IMAGE'),{code:'INVALID_REFERENCE_IMAGE'});
    create.mockRejectedValue(invalid);
    const view=render(<GeneratedModelLibrary controller={controller} onAdd={vi.fn()}/>);
    fireEvent.change(screen.getByLabelText('物料描述'),{target:{value:'vase'}});
    await waitFor(()=>expect((screen.getByRole('button',{name:'生成 3D 模型'}) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole('button',{name:'生成 3D 模型'}));
    fireEvent.click(await screen.findByRole('button',{name:'修改未通过检查的输入'}));
    expect(localStorage.getItem(localKey())).toBeNull();
    expect((screen.getByLabelText('物料描述') as HTMLTextAreaElement).disabled).toBe(false);
    view.unmount();localStorage.setItem(localKey(),JSON.stringify(legacyIntent));
    render(<GeneratedModelLibrary controller={controller} onAdd={vi.fn()}/>);
    fireEvent.click(screen.getByRole('button',{name:'核对并继续同一请求'}));
    await screen.findByRole('alert');
    expect(screen.queryByRole('button',{name:'修改未通过检查的输入'})).toBeNull();
    expect(JSON.parse(localStorage.getItem(localKey())!)).toEqual(legacyIntent);
  });
  it('blocks conflicting saved image sources sharing a request id',()=>{
    localStorage.setItem(localKey(),JSON.stringify({...legacyIntent,kind:'image',referenceImageAssetId:assetId}));
    sessionStorage.setItem(sessionKey,JSON.stringify({...legacyIntent,kind:'image',referenceImageAssetId:id}));
    render(<GeneratedModelLibrary controller={controller} onAdd={vi.fn()}/>);
    expect(screen.getByRole('alert').textContent).toContain('编号相同但内容不一致');
    expect(create).not.toHaveBeenCalled();
  });
  it('offers a checked texture result for explicit variant preview instead of adding another object',async()=>{
    const ready={...job('ready'),kind:'texture' as const,source_asset_id:id};
    list.mockResolvedValue([ready]);const onAdd=vi.fn(),onVariantReady=vi.fn();
    render(<GeneratedModelLibrary controller={controller} onAdd={onAdd} sourceAssetId={id} sourceObjectIds={['selected-instance']} onVariantReady={onVariantReady}/>);
    fireEvent.click(await screen.findByRole('button',{name:'预览纹理版本'}));
    expect(onAdd).not.toHaveBeenCalled();expect(onVariantReady).toHaveBeenCalledWith({sourceAssetId:id,variantAssetId:assetId,objectIds:['selected-instance']});
    expect(screen.queryByRole('button',{name:'加入场地预览'})).toBeNull();
  });

  it('only creates a paid job after an explicit click', async () => {
    render(<GeneratedModelLibrary controller={controller} onAdd={vi.fn()}/>);
    await waitFor(() => expect(list).toHaveBeenCalledOnce());
    expect(create).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('物料描述'), { target: { value: '  绿色藤编椅  ' } });
    await waitFor(()=>expect((screen.getByRole('button',{name:'生成 3D 模型'}) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: '生成 3D 模型' }));
    await waitFor(() => expect(create).toHaveBeenCalledOnce());
    expect(create.mock.calls[0]![0]).toBe('绿色藤编椅');
    expect(create.mock.calls[0]![1]).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('prefills a scoped Agent suggestion without submitting a paid request', async () => {
    const seed:ModelGenerationSeed={id:'suggestion',scope:'scope',apiUrl:controller.config.apiUrl,userId:'member',projectId:'project',name:'花形拱门',prompt:'单件米白色花形拱门，无背景'};
    render(<GeneratedModelLibrary controller={controller} seed={seed} onAdd={vi.fn()}/>);
    await waitFor(()=>expect((screen.getByLabelText('物料描述') as HTMLTextAreaElement).value).toBe(seed.prompt));
    expect(create).not.toHaveBeenCalled();
  });

  it('preserves a nonempty generation draft until the user explicitly accepts the suggestion', async () => {
    const seed:ModelGenerationSeed={id:'suggestion',scope:'scope',apiUrl:controller.config.apiUrl,userId:'member',projectId:'project',name:'花形拱门',prompt:'单件米白色花形拱门，无背景'};
    const view=render(<GeneratedModelLibrary controller={controller} onAdd={vi.fn()}/>);
    fireEvent.change(screen.getByLabelText('物料描述'),{target:{value:'我的绿色椅子'}});
    view.rerender(<GeneratedModelLibrary controller={controller} seed={seed} onAdd={vi.fn()}/>);
    expect((screen.getByLabelText('物料描述') as HTMLTextAreaElement).value).toBe('我的绿色椅子');
    fireEvent.click(screen.getByRole('button',{name:'用此建议替换草稿'}));
    expect((screen.getByLabelText('物料描述') as HTMLTextAreaElement).value).toBe(seed.prompt);
    expect(create).not.toHaveBeenCalled();
  });

  it('never replaces an unresolved paid request with an Agent suggestion', async () => {
    localStorage.setItem(localKey(),JSON.stringify(legacyIntent));
    const seed:ModelGenerationSeed={id:'suggestion',scope:'scope',apiUrl:controller.config.apiUrl,userId:'member',projectId:'project',name:'花形拱门',prompt:'单件米白色花形拱门，无背景'};
    render(<GeneratedModelLibrary controller={controller} seed={seed} onAdd={vi.fn()}/>);
    expect((screen.getByLabelText('物料描述') as HTMLTextAreaElement).value).toBe(legacyIntent.prompt);
    expect((screen.getByRole('button',{name:'使用此生成描述'}) as HTMLButtonElement).disabled).toBe(true);
    expect(JSON.parse(localStorage.getItem(localKey())!)).toEqual(legacyIntent);
    expect(create).not.toHaveBeenCalled();
  });

  it.each([{userId:'another-user'}, {projectId:'another-project'}, {apiUrl:'https://another.example'}])('ignores a suggestion from another scope %j', async mismatch => {
    const seed:ModelGenerationSeed={id:'suggestion',scope:'scope',apiUrl:controller.config.apiUrl,userId:'member',projectId:'project',name:'拱门',prompt:'单件花形拱门',...mismatch};
    render(<GeneratedModelLibrary controller={controller} seed={seed} onAdd={vi.fn()}/>);
    await waitFor(()=>expect(list).toHaveBeenCalledOnce());
    expect((screen.getByLabelText('物料描述') as HTMLTextAreaElement).value).toBe('');
    expect(screen.queryByLabelText('Binggo 生成建议')).toBeNull();
  });

  it('clears an unsubmitted prompt when the project changes and does not replay an old suggestion', async () => {
    const seed:ModelGenerationSeed={id:'suggestion',scope:'scope',apiUrl:controller.config.apiUrl,userId:'member',projectId:'project',name:'拱门',prompt:'单件花形拱门'};
    const view=render(<GeneratedModelLibrary controller={controller} seed={seed} onAdd={vi.fn()}/>);
    await waitFor(()=>expect((screen.getByLabelText('物料描述') as HTMLTextAreaElement).value).toBe(seed.prompt));
    vi.mocked(controller.getSnapshot).mockReturnValue({...controller.getSnapshot(),project:{...controller.getSnapshot().project!,id:'other-project'}});
    view.rerender(<GeneratedModelLibrary controller={controller} seed={seed} onAdd={vi.fn()}/>);
    expect((screen.getByLabelText('物料描述') as HTMLTextAreaElement).value).toBe('');
    expect(create).not.toHaveBeenCalled();
  });

  it('recovers an uncertain creation after remount and explicitly retries the identical intent', async () => {
    create.mockRejectedValueOnce(new TypeError('connection reset'));
    const first = render(<GeneratedModelLibrary controller={controller} onAdd={vi.fn()}/>);
    fireEvent.change(screen.getByLabelText('物料描述'), { target: { value: '绿色藤编椅' } });
    await waitFor(()=>expect((screen.getByRole('button',{name:'生成 3D 模型'}) as HTMLButtonElement).disabled).toBe(false));
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
    expect(localStorage.getItem(localKey())).toBeNull();
  });

  it('recovers the old cloud-assets request without changing its ID or prompt', async () => {
    localStorage.setItem(localKey(), JSON.stringify(legacyIntent));
    create.mockRejectedValueOnce(new TypeError('connection reset'));
    const first = render(<GeneratedModelLibrary controller={controller} onAdd={vi.fn()}/>);
    expect((screen.getByLabelText('物料描述') as HTMLTextAreaElement).value).toBe(legacyIntent.prompt);
    expect(create).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '核对并继续同一请求' }));
    await screen.findByRole('alert');
    expect(JSON.parse(localStorage.getItem(localKey())!)).toEqual(legacyIntent);
    first.unmount(); render(<GeneratedModelLibrary controller={controller} onAdd={vi.fn()}/>);
    fireEvent.click(screen.getByRole('button', { name: '核对并继续同一请求' }));
    await waitFor(() => expect(localStorage.getItem(localKey())).toBeNull());
    expect(create.mock.calls).toEqual([[legacyIntent.prompt, legacyIntent.requestId], [legacyIntent.prompt, legacyIntent.requestId]]);
  });

  it('recovers local and session requests one at a time without overwriting either', async () => {
    localStorage.setItem(localKey(), JSON.stringify(legacyIntent));
    sessionStorage.setItem(sessionKey, JSON.stringify(sessionIntent));
    render(<GeneratedModelLibrary controller={controller} onAdd={vi.fn()}/>);
    expect(screen.getByText(/有 2 项未确认请求/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '核对并继续同一请求' }));
    await waitFor(() => expect((screen.getByLabelText('物料描述') as HTMLTextAreaElement).value).toBe(sessionIntent.prompt));
    expect(localStorage.getItem(localKey())).toBeNull();
    expect(JSON.parse(sessionStorage.getItem(sessionKey)!)).toEqual(sessionIntent);
    expect(create.mock.calls).toEqual([[legacyIntent.prompt, legacyIntent.requestId]]);
    fireEvent.click(screen.getByRole('button', { name: '核对并继续同一请求' }));
    await waitFor(() => expect(sessionStorage.getItem(sessionKey)).toBeNull());
    expect(create.mock.calls).toEqual([[legacyIntent.prompt, legacyIntent.requestId], [sessionIntent.prompt, sessionIntent.requestId]]);
    expect(screen.getByRole('button', { name: '生成 3D 模型' })).toBeTruthy();
  });

  it('does not resubmit an acknowledged legacy job, including a matching session copy', async () => {
    const acknowledged = { ...legacyIntent, jobId: id };
    localStorage.setItem(localKey(), JSON.stringify(acknowledged));
    sessionStorage.setItem(sessionKey, JSON.stringify(legacyIntent));
    render(<GeneratedModelLibrary controller={controller} onAdd={vi.fn()}/>);
    await waitFor(() => expect(list).toHaveBeenCalledOnce());
    expect(screen.queryByRole('button', { name: '核对并继续同一请求' })).toBeNull();
    expect((screen.getByRole('button', { name: '生成 3D 模型' }) as HTMLButtonElement).disabled).toBe(true);
    expect(create).not.toHaveBeenCalled();
    expect(JSON.parse(localStorage.getItem(localKey())!)).toEqual(acknowledged);
    expect(sessionStorage.getItem(sessionKey)).toBeNull();
  });

  it('cleans up identical pending copies with one explicit request', async () => {
    localStorage.setItem(localKey(), JSON.stringify(legacyIntent));
    sessionStorage.setItem(sessionKey, JSON.stringify(legacyIntent));
    render(<GeneratedModelLibrary controller={controller} onAdd={vi.fn()}/>);
    fireEvent.click(screen.getByRole('button', { name: '核对并继续同一请求' }));
    await waitFor(() => expect(sessionStorage.getItem(sessionKey)).toBeNull());
    expect(localStorage.getItem(localKey())).toBeNull();
    expect(create).toHaveBeenCalledOnce();
  });

  it.each(['local', 'session'] as const)('blocks creation when %s storage is corrupt and supports rereading after repair', async source => {
    const storage = source === 'local' ? localStorage : sessionStorage;
    const key = source === 'local' ? localKey() : sessionKey;
    storage.setItem(key, '{broken');
    render(<GeneratedModelLibrary controller={controller} onAdd={vi.fn()}/>);
    expect(screen.getByRole('alert').textContent).toContain('无法读取上一次生成请求');
    expect((screen.getByRole('button', { name: '生成 3D 模型' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '刷新任务状态' }));
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(storage.getItem(key)).toBe('{broken');
    expect(create).not.toHaveBeenCalled();
    storage.setItem(key, JSON.stringify(legacyIntent));
    fireEvent.click(screen.getByRole('button', { name: '重新读取生成请求' }));
    expect(screen.queryByRole('alert')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '核对并继续同一请求' }));
    await waitFor(() => expect(create).toHaveBeenCalledWith(legacyIntent.prompt, legacyIntent.requestId));
  });

  it('blocks new requests when saved requests cannot be read', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('storage denied'); });
    render(<GeneratedModelLibrary controller={controller} onAdd={vi.fn()}/>);
    expect(screen.getByRole('alert').textContent).toContain('无法读取上一次生成请求');
    expect((screen.getByRole('button', { name: '生成 3D 模型' }) as HTMLButtonElement).disabled).toBe(true);
    expect(create).not.toHaveBeenCalled();
  });

  it('does not submit if the request cannot be durably stored', async () => {
    render(<GeneratedModelLibrary controller={controller} onAdd={vi.fn()}/>);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('storage denied'); });
    fireEvent.change(screen.getByLabelText('物料描述'), { target: { value: '绿色藤编椅' } });
    await waitFor(()=>expect((screen.getByRole('button',{name:'生成 3D 模型'}) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: '生成 3D 模型' }));
    expect((await screen.findByRole('alert')).textContent).toContain('无法保存生成请求编号');
    expect(create).not.toHaveBeenCalled();
    expect((screen.getByRole('button', { name: '生成 3D 模型' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('preserves an acknowledged job if storage cleanup fails', async () => {
    localStorage.setItem(localKey(), JSON.stringify(legacyIntent));
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('storage denied'); });
    const first = render(<GeneratedModelLibrary controller={controller} onAdd={vi.fn()}/>);
    fireEvent.click(screen.getByRole('button', { name: '核对并继续同一请求' }));
    await screen.findByRole('alert');
    expect(JSON.parse(localStorage.getItem(localKey())!)).toEqual({ ...legacyIntent, jobId: id });
    first.unmount(); render(<GeneratedModelLibrary controller={controller} onAdd={vi.fn()}/>);
    expect(screen.queryByRole('button', { name: '核对并继续同一请求' })).toBeNull();
    expect(create).toHaveBeenCalledOnce();
  });

  it('blocks conflicting payloads sharing the same saved request ID', () => {
    localStorage.setItem(localKey(), JSON.stringify(legacyIntent));
    sessionStorage.setItem(sessionKey, JSON.stringify({ ...legacyIntent, prompt: '不同的内容' }));
    render(<GeneratedModelLibrary controller={controller} onAdd={vi.fn()}/>);
    expect(screen.getByRole('alert').textContent).toContain('编号相同但内容不一致');
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

  it('shows the Tencent provider and keeps cleared dimensions empty until corrected', async () => {
    list.mockResolvedValue([job('ready')]);
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<GeneratedModelLibrary controller={controller} onAdd={vi.fn()}/>);
    const add = await screen.findByRole('button', { name: '加入场地预览' });
    expect(screen.getByText(/腾讯 HY-3D-3.0/)).toBeTruthy();
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
