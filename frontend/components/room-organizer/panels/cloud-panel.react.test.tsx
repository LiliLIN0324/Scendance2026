// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AssetsPanel } from '@/components/business/assets-panel';
import { PublicationPanel } from '@/components/business/publication-panel';
import { BackendSession, createBackendSession, getBackendConfig, type Scene } from '@/lib/backend-session';
import { readSourceRecord, registerSourceFlush } from '@/lib/source-storage';
import { materialCheckinLedgerSchema } from '../../../../supabase/functions/_shared/material-checkin-contract';
import { backendSceneToLayout } from '../lib/backend-adapter';
import { LOCAL_CHECKIN_CLOUD_MESSAGE, LOCAL_HANDOFF_CLOUD_MESSAGE, LOCAL_RECORDS_READ_MESSAGE } from '../lib/handoff-cloud-guard';
import { addDesign } from '../lib/scene-layers';
import { ensureGlbAsset } from '../three/glb-assets';
import { CloudPanel } from './cloud-panel';
import { useLocalProjectBackup } from './creative-studio';
import { LocalActivitiesPanel } from './local-activities-panel';
import type { RoomLayout } from '../lib/types';

vi.mock('@/lib/backend-session', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/backend-session')>();
  return { ...actual, createBackendSession: vi.fn() };
});
vi.mock('@/lib/source-storage', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/source-storage')>();
  return { ...actual, readSourceRecord: vi.fn() };
});
vi.mock('../three/glb-assets', () => ({ ensureGlbAsset: vi.fn() }));
vi.mock('./creative-studio', () => ({ useLocalProjectBackup: vi.fn(() => null) }));
vi.mock('./local-activities-panel', () => ({ LocalActivitiesPanel: vi.fn(() => null) }));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams(window.location.search) }));
vi.mock('@/components/business/publication-panel', () => ({ PublicationPanel: vi.fn(() => null) }));
vi.mock('@/components/business/assets-panel', () => ({ AssetsPanel: vi.fn(() => null) }));

const projectId = '10000000-0000-4000-8000-000000000001';
const otherId = '10000000-0000-4000-8000-000000000002';
const studioId = '20000000-0000-4000-8000-000000000001';
const scene: Scene = { schemaVersion: 1, venue: { width: 12, depth: 10, height: 3, shape: 'rectangle', entrances: [] }, objects: [], camera: 'overview', lighting: 'neutral' };
const original = { id: projectId, name: '原云项目', studio_id: studioId, revision: 2, scene };
const other = { ...original, id: otherId, name: '另一个云项目' };
const mockFetch = vi.fn<typeof fetch>();
const pointRecords = new Map<string, unknown>();
const unreadablePointScopes = new Set<string>();
let controller: BackendSession;

function json(body: unknown) { return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } }); }
function queue(body: unknown) { mockFetch.mockResolvedValueOnce(json(body)); }

beforeEach(async () => {
  localStorage.clear();
  window.history.replaceState(null, '', '/');
  mockFetch.mockReset();
  vi.mocked(useLocalProjectBackup).mockReturnValue(null);
  vi.mocked(LocalActivitiesPanel).mockClear();
  pointRecords.clear();unreadablePointScopes.clear();
  vi.mocked(readSourceRecord).mockReset().mockImplementation(async key => {
    if (typeof key === 'string' || key[0] !== 'material-checkins') return undefined;
    if (unreadablePointScopes.has(key[1])) throw new Error('演练点验读取失败');
    return pointRecords.get(key[1]);
  });
  vi.mocked(AssetsPanel).mockClear();
  vi.mocked(PublicationPanel).mockClear();
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

describe('CloudPanel independent quantity ledger protection', () => {
  const actionLabels = { create: '把当前画布创建为新项目', open: '打开', acquire: '获取编辑权', save: '保存到云端' } as const;
  function points(id = projectId) { return materialCheckinLedgerSchema.parse({ projectId: id, dataKind: 'rehearsal', sheets: [] }); }
  async function editable(): Promise<void> {
    queue({ sessionId: controller.getSnapshot().sessionId, generation: 4, revision: 2, scene, expiresAt: new Date(Date.now() + 90_000).toISOString() });
    await controller.acquireLease(projectId);
  }
  function projectLists(): void { queue([other]);queue([{ id: studioId, name: '工作室', role: 'owner', displayName: 'A' }]); }

  it.each((['create', 'open', 'acquire', 'save'] as const).flatMap(action => (['ledger', 'corrupt', 'read failure'] as const).map(record => ({ action, record }))))('refuses $action before its cloud request for an independent $record', async ({ action, record }) => {
    if (action === 'save') await editable();
    if (record === 'read failure') unreadablePointScopes.add(projectId);
    else pointRecords.set(projectId, record === 'ledger' ? points() : { corrupt: true });
    const getProject = vi.spyOn(controller, 'getProject'), acquire = vi.spyOn(controller, 'acquireLease');
    const create = vi.spyOn(controller, 'createProject'), saveScene = vi.spyOn(controller, 'saveScene');
    const initial = backendSceneToLayout(scene, { projectId, name: original.name }), onLoadLayout = vi.fn();
    projectLists();render(<CloudPanel controller={controller} layout={initial} onLoadLayout={onLoadLayout}/>);
    fireEvent.click(screen.getByRole('button', { name: '账户与项目' }));
    const button = await screen.findByRole('button', { name: actionLabels[action] });
    await waitFor(() => expect(button.hasAttribute('disabled')).toBe(false));
    const requests = mockFetch.mock.calls.length;fireEvent.click(button);
    expect(await screen.findByText(record === 'ledger' ? LOCAL_CHECKIN_CLOUD_MESSAGE : LOCAL_RECORDS_READ_MESSAGE)).toBeTruthy();
    expect(readSourceRecord).toHaveBeenCalledWith(['material-checkins', projectId]);
    expect(getProject).not.toHaveBeenCalled();expect(acquire).not.toHaveBeenCalled();expect(create).not.toHaveBeenCalled();expect(saveScene).not.toHaveBeenCalled();
    expect(mockFetch).toHaveBeenCalledTimes(requests);expect(onLoadLayout).not.toHaveBeenCalled();
    expect(initial.id).toBe(projectId);expect(controller.getSnapshot().project?.id).toBe(projectId);
  });

  it.each(['already recorded', 'during authorization'] as const)('keeps the original canvas when the target project has a ledger %s', async timing => {
    const initial = backendSceneToLayout(scene, { projectId, name: original.name }), onLoadLayout = vi.fn();
    let finishAssets!: (value: { assetUrls: Record<string, string>;assetNames: Record<string, string> }) => void;
    const authorize = vi.spyOn(controller, 'authorizeAssets');
    if (timing === 'already recorded') pointRecords.set(otherId, points(otherId));
    else authorize.mockImplementationOnce(() => new Promise(resolve => { finishAssets = resolve; }));
    projectLists();render(<CloudPanel controller={controller} layout={initial} onLoadLayout={onLoadLayout}/>);
    fireEvent.click(screen.getByRole('button', { name: '账户与项目' }));
    const open = await screen.findByRole('button', { name: '打开' });queue(other);fireEvent.click(open);
    if (timing === 'during authorization') {
      await waitFor(() => expect(finishAssets).toBeTypeOf('function'));pointRecords.set(otherId, points(otherId));
      await act(async () => { finishAssets({ assetUrls: {}, assetNames: {} }); });
    }
    expect(await screen.findByText(LOCAL_CHECKIN_CLOUD_MESSAGE)).toBeTruthy();
    expect(readSourceRecord).toHaveBeenCalledWith(['material-checkins', otherId]);
    expect(onLoadLayout).not.toHaveBeenCalled();expect(initial.id).toBe(projectId);
    if (timing === 'already recorded') expect(authorize).not.toHaveBeenCalled();
    else expect(authorize).toHaveBeenCalledOnce();
    expect(screen.queryByText(/已打开云端方案|已打开项目/)).toBeNull();
  });

  it.each(['create', 'open', 'acquire', 'save'] as const)('keeps the original canvas when a ledger appears while the $0 cloud request is pending', async action => {
    if (action === 'save') await editable();
    const initial = backendSceneToLayout(scene, { projectId, name: original.name }), onLoadLayout = vi.fn();
    projectLists();render(<CloudPanel controller={controller} layout={initial} onLoadLayout={onLoadLayout}/>);
    fireEvent.click(screen.getByRole('button', { name: '账户与项目' }));
    const button = await screen.findByRole('button', { name: actionLabels[action] });
    await waitFor(() => expect(button.hasAttribute('disabled')).toBe(false));
    let finish!: (response: Response) => void;
    mockFetch.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));fireEvent.click(button);
    await waitFor(() => expect(finish).toBeTypeOf('function'));const currentPoints = points();pointRecords.set(projectId, currentPoints);
    const sessionId = controller.getSnapshot().sessionId;
    if (action === 'acquire') queue({ sessionId, generation: 4, revision: 2, expiresAt: new Date().toISOString() });
    await act(async () => {
      finish(json(action === 'acquire' ? { sessionId, generation: 4, revision: 2, scene, expiresAt: new Date(Date.now() + 90_000).toISOString() }
        : action === 'save' ? { id: projectId, revision: 3, scene, updatedAt: new Date().toISOString(), warnings: [] } : other));
    });
    expect(await screen.findByText(action === 'create' ? /云端创建请求已返回，结果待核对；当前画布未替换/ : LOCAL_CHECKIN_CLOUD_MESSAGE)).toBeTruthy();
    expect(pointRecords.get(projectId)).toEqual(currentPoints);expect(onLoadLayout).not.toHaveBeenCalled();expect(initial.id).toBe(projectId);
    expect(screen.queryByText(/新项目已保存|已载入最新版本并获得编辑权|已打开云端方案|已保存云端版本/)).toBeNull();
    if (action === 'save') {
      expect(screen.queryByText('云端已保存')).toBeNull();
      expect(vi.mocked(PublicationPanel).mock.calls.at(-1)?.[0].dirty).toBe(true);
    }
    if (action === 'acquire') expect(String(mockFetch.mock.calls.at(-1)![0])).toContain(`/projects/${projectId}/lease/release`);
  });
});

afterEach(() => {
  cleanup();
  controller.dispose();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('CloudPanel delayed project replacement', () => {
  it.each(['url','button','acquire'] as const)('stops $0 before a replacement request when the original brief cannot flush', async entry => {
    const initial=backendSceneToLayout(scene,{projectId});
    const unregister=registerSourceFlush(projectId,async()=>{throw new Error('活动需求保存失败，原输入已保留。');});
    const getProject=vi.spyOn(controller,'getProject');
    const acquireLease=vi.spyOn(controller,'acquireLease');
    const onLoadLayout=vi.fn();
    queue([other]); queue([{id:studioId,name:'工作室',role:'owner',displayName:'A'}]);
    if(entry==='url')window.history.replaceState(null,'',`/editor/?project=${otherId}`);
    try{
      render(<CloudPanel controller={controller} layout={initial} onLoadLayout={onLoadLayout}/>);
      await waitFor(()=>expect(mockFetch).toHaveBeenCalledTimes(4));
      if(entry!=='url'){
        fireEvent.click(screen.getByRole('button',{name:'账户与项目'}));
        fireEvent.click(screen.getByRole('button',{name:entry==='button'?'打开':'获取编辑权'}));
      }
      expect(await screen.findByText('活动需求保存失败，原输入已保留。')).toBeTruthy();
      expect(getProject).not.toHaveBeenCalled(); expect(acquireLease).not.toHaveBeenCalled(); expect(onLoadLayout).not.toHaveBeenCalled();
      expect(mockFetch).toHaveBeenCalledTimes(4);
    }finally{unregister();}
  });

  it.each((['url', 'button'] as const).flatMap(entry => (['worksheet', 'activity', 'nested activity'] as const).map(kind => ({entry,kind}))))('does not read or replace a local $kind through a $entry', async ({entry,kind}) => {
    const local = backendSceneToLayout({ ...scene, objects: [{ id: '40000000-0000-4000-8000-000000000001', materialId: 'chair', position: { x: 2, z: 3 }, size: { width: 0.5, depth: 0.5, height: 0.9 }, rotation: 0, color: '#ffffff', locked: false, notes: '' }] });
    if(kind==='worksheet')local.floors[0]!.items[0]!.handoff = { ownerName: '布展负责人', dueDate: '2026-10-08', acceptance: '摆放完成并核对通道', status: 'todo', evidenceUrls: [], evidenceNote: '' };
    else if(kind==='activity')local.eventOperations={schemaVersion:1,dataKind:'unspecified',tasks:[]};
    // Test-only malformed nesting checks the cloud guard without widening the editor's design snapshot type.
    else local.designBook={activeId:'parent',variants:[{id:'parent',name:'方案',layout:{...backendSceneToLayout(scene),designBook:{activeId:'leaf',variants:[{id:'leaf',name:'活动',layout:{...backendSceneToLayout(scene),eventOperations:{schemaVersion:1,dataKind:'unspecified',tasks:[]}}}]}}}]} as unknown as NonNullable<RoomLayout['designBook']>;
    const getProject = vi.spyOn(controller, 'getProject');
    const onLoadLayout = vi.fn();
    queue([other]); queue([{ id: studioId, name: '工作室', role: 'owner', displayName: 'A' }]);
    if (entry === 'url') window.history.replaceState(null, '', `/editor/?project=${otherId}`);
    const rendered = render(<CloudPanel controller={controller} layout={local} onLoadLayout={onLoadLayout}/>);
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(4));
    if (entry === 'button') {
      fireEvent.click(screen.getByRole('button', { name: '账户与项目' }));
      await act(async () => { fireEvent.click(screen.getByRole('button', { name: '打开' })); });
    } else {
      await waitFor(() => expect(rendered.container.querySelector('dialog')?.hasAttribute('open')).toBe(true));
    }
    expect(screen.getByText(LOCAL_HANDOFF_CLOUD_MESSAGE)).toBeTruthy();
    expect(getProject).not.toHaveBeenCalled();
    expect(mockFetch).toHaveBeenCalledTimes(4);
    expect(onLoadLayout).not.toHaveBeenCalled();
    if(kind==='worksheet')expect(local.floors[0]!.items[0]!.handoff?.ownerName).toBe('布展负责人');
    else if(kind==='activity')expect(local.eventOperations?.tasks).toEqual([]);
    else expect((local.designBook?.variants[0]!.layout as RoomLayout | undefined)?.designBook?.variants[0]!.layout.eventOperations?.tasks).toEqual([]);
    expect(controller.getSnapshot().project?.id).toBe(projectId);
  });

  it('saves an externally bound Agent project without replacing its draft or creating another project', async () => {
    queue([original]); queue([{ id: studioId, name: '工作室', role: 'owner', displayName: 'A' }]);
    const onLoadLayout = vi.fn();
    const rendered = render(<CloudPanel controller={controller} layout={backendSceneToLayout(scene)} onLoadLayout={onLoadLayout} />);
    fireEvent.click(screen.getByRole('button', { name: '账户与项目' }));
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(4));
    queue({ sessionId: controller.getSnapshot().sessionId, generation: 4, revision: 2, scene, expiresAt: new Date(Date.now() + 90_000).toISOString() });
    const draft = { ...scene, lighting: 'warm' as const };
    await act(async () => { await controller.acquireLease(projectId); controller.setDraft(draft); });
    rendered.rerender(<CloudPanel controller={controller} layout={backendSceneToLayout(draft, { projectId })} onLoadLayout={onLoadLayout} />);
    expect(screen.getByRole('button', { name: '保存到云端' }).hasAttribute('disabled')).toBe(false);
    expect(vi.mocked(AssetsPanel).mock.calls.at(-1)?.[0].bound).toBe(true);
    expect(vi.mocked(PublicationPanel).mock.calls.at(-1)?.[0].dirty).toBe(true);
    expect(controller.getSnapshot().draft).toEqual(draft);
    queue({ id: projectId, revision: 3, scene: draft, updatedAt: new Date().toISOString(), warnings: [] });
    fireEvent.click(screen.getByRole('button', { name: '保存到云端' }));
    await screen.findByText('已保存云端版本 3。');
    expect(vi.mocked(PublicationPanel).mock.calls.at(-1)?.[0].dirty).toBe(false);
    expect(controller.getSnapshot().draft).toEqual(draft);
    expect(onLoadLayout).not.toHaveBeenCalled();
    expect(mockFetch.mock.calls.filter(([url, init]) => String(url).endsWith('/projects') && init?.method === 'POST')).toHaveLength(0);
  });

  it('keeps activity information added while a cloud save is pending without reporting it saved', async () => {
    queue({ sessionId: controller.getSnapshot().sessionId, generation: 4, revision: 2, scene, expiresAt: new Date(Date.now() + 90_000).toISOString() });
    await controller.acquireLease(projectId);
    queue([original]); queue([{ id: studioId, name: '工作室', role: 'owner', displayName: 'A' }]);
    const initial=backendSceneToLayout(scene,{projectId});
    const onLoadLayout=vi.fn();
    const view=render(<CloudPanel controller={controller} layout={initial} onLoadLayout={onLoadLayout}/>);
    fireEvent.click(screen.getByRole('button',{name:'账户与项目'}));
    await waitFor(()=>expect(mockFetch).toHaveBeenCalledTimes(5));
    let finish!:(response:Response)=>void;
    mockFetch.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
    fireEvent.click(screen.getByRole('button',{name:'保存到云端'}));
    await waitFor(()=>expect(finish).toBeTypeOf('function'));
    const changed={...initial,eventOperations:{schemaVersion:1 as const,dataKind:'rehearsal' as const,tasks:[]}};
    view.rerender(<CloudPanel controller={controller} layout={changed} onLoadLayout={onLoadLayout}/>);
    await act(async()=>{finish(json({id:projectId,revision:3,scene,updatedAt:new Date().toISOString(),warnings:[]}));});
    expect(screen.getByText(LOCAL_HANDOFF_CLOUD_MESSAGE)).toBeTruthy();
    expect(screen.queryByText('已保存云端版本 3。')).toBeNull();
    expect(vi.mocked(PublicationPanel).mock.calls.at(-1)?.[0].dirty).toBe(true);
    expect(changed.eventOperations).toEqual({schemaVersion:1,dataKind:'rehearsal',tasks:[]});
    expect(onLoadLayout).not.toHaveBeenCalled();
  });

  it('does not bind a different local canvas to an existing Agent lease', async () => {
    queue({ sessionId: controller.getSnapshot().sessionId, generation: 4, revision: 2, scene, expiresAt: new Date(Date.now() + 90_000).toISOString() });
    await controller.acquireLease(projectId);
    queue([original]); queue([{ id: studioId, name: '工作室', role: 'owner', displayName: 'A' }]);
    render(<CloudPanel controller={controller} layout={backendSceneToLayout(scene, { projectId: otherId })} onLoadLayout={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '账户与项目' }));
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(5));
    expect(screen.getByRole('button', { name: '保存到云端' }).hasAttribute('disabled')).toBe(true);
    expect(vi.mocked(AssetsPanel).mock.calls.at(-1)?.[0].bound).toBe(false);
    expect(vi.mocked(PublicationPanel).mock.calls.at(-1)?.[0].dirty).toBe(true);
  });

  it('keeps local design history and layer names when reopening the same saved cloud scene', async () => {
    window.history.replaceState(null, '', `/editor/?project=${projectId}`);
    queue([original]); queue([{ id: studioId, name: '工作室', role: 'owner', displayName: 'A' }]); queue(original);
    const base = backendSceneToLayout(scene, { projectId, name: original.name });
    const layout = { ...addDesign(base, base), itemLayers: [{ id: 'custom', name: '交流区', itemIds: [] }] };
    const onLoadLayout = vi.fn();
    render(<CloudPanel layout={layout} onLoadLayout={onLoadLayout}/>);
    await waitFor(() => expect(onLoadLayout).toHaveBeenCalledOnce());
    expect(onLoadLayout.mock.calls[0]![0].designBook).toEqual(layout.designBook);
    expect(onLoadLayout.mock.calls[0]![0].itemLayers).toEqual(layout.itemLayers);
  });
  it('shows only projects in the selected studio and labels the save destination', async () => {
    queue([other, { ...other, id: 'foreign-project', studio_id: 'studio-b', name: '其他工作室的项目' }]);
    queue([{ id: studioId, name: '当前工作室', role: 'owner', displayName: 'A' }, { id: 'studio-b', name: '另一工作室', role: 'owner', displayName: 'A' }]);
    const rendered = render(<CloudPanel layout={backendSceneToLayout(scene)} onLoadLayout={vi.fn()} />);
    fireEvent.click(rendered.container.querySelector('.sc-cloud-trigger')!);
    await screen.findByText('另一个云项目');
    expect(screen.queryByText('其他工作室的项目')).toBeNull();
    fireEvent.change(screen.getByLabelText('当前工作室'), { target: { value: 'studio-b' } });
    expect(screen.queryByText('另一个云项目')).toBeNull();
    expect(screen.getByText('其他工作室的项目')).toBeTruthy();
    expect(screen.getByText('新项目将归属「另一工作室」')).toBeTruthy();
  });
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

  it('opens the requested project after the current editing lease is released', async () => {
    const sessionId = controller.getSnapshot().sessionId;
    queue({ sessionId, generation: 4, revision: 2, scene, expiresAt: new Date(Date.now() + 90_000).toISOString() });
    await controller.acquireLease(projectId);
    window.history.replaceState(null, '', `/editor/?project=${otherId}`);
    queue([original, other]); queue([{ id: studioId, name: '工作室', role: 'owner', displayName: 'A' }]);
    const onLoadLayout = vi.fn();
    render(<CloudPanel layout={backendSceneToLayout(scene, { projectId, name: original.name })} onLoadLayout={onLoadLayout} />);
    await screen.findByText('请先释放当前项目的编辑权，再打开链接中的项目。');
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(5));
    expect(onLoadLayout).not.toHaveBeenCalled();
    queue({ sessionId, generation: 4, revision: 2, expiresAt: new Date().toISOString() }); queue(other);
    fireEvent.click(screen.getByRole('button', { name: '释放编辑权' }));
    await waitFor(() => expect(onLoadLayout).toHaveBeenCalledOnce());
    expect(controller.getSnapshot().project?.id).toBe(otherId);
  });
  it('keeps the matching unsaved canvas when returning through an editor project link', async () => {
    const sessionId = controller.getSnapshot().sessionId;
    queue({ sessionId, generation: 4, revision: 2, scene, expiresAt: new Date(Date.now() + 90_000).toISOString() });
    await controller.acquireLease(projectId);
    const draft = { ...scene, lighting: 'warm' as const };
    controller.setDraft(draft);
    window.history.replaceState(null, '', `/editor/?project=${projectId}`);
    queue([original]); queue([{ id: studioId, name: '工作室', role: 'owner', displayName: 'A' }]);
    const onLoadLayout = vi.fn();
    render(<CloudPanel layout={backendSceneToLayout(draft, { projectId, name: original.name })} onLoadLayout={onLoadLayout} />);
    await waitFor(() => expect(screen.getByText(/已保留这个项目的本地未保存改动/)).toBeTruthy());
    expect(onLoadLayout).not.toHaveBeenCalled();
    expect(controller.getSnapshot()).toMatchObject({ draft, dirty: true, writeBlocked: false });
  });

  it('reauthorizes restored private models without replacing unsaved placements', async () => {
    const assetId = '30000000-0000-4000-8000-000000000001';
    const draft: Scene = { ...scene, lighting: 'warm', objects: [{ id: '40000000-0000-4000-8000-000000000001', materialId: 'asset', assetId, position: { x: 2, z: 3 }, size: { width: 1, depth: 1, height: 1 }, rotation: 0, color: '#ffffff', locked: false, notes: '本地备注' }] };
    window.history.replaceState(null, '', `/editor/?project=${projectId}`);
    queue([original]); queue([{ id: studioId, name: '工作室', role: 'owner', displayName: 'A' }]);
    queue(original); queue({ id: assetId, format: 'glb', name: '道具', url: 'https://storage.example/fresh.glb', expiresIn: 300 });
    const onLoadLayout = vi.fn();
    render(<CloudPanel layout={backendSceneToLayout(draft, { projectId, name: original.name, assetUrls: { [assetId]: 'https://storage.example/expired.glb' } })} onLoadLayout={onLoadLayout} />);
    await screen.findByText(/已保留这个项目的本地未保存改动/);
    expect(ensureGlbAsset).toHaveBeenCalledWith(assetId, 'https://storage.example/fresh.glb');
    expect(onLoadLayout).not.toHaveBeenCalled();
    expect(controller.getSnapshot().draft).toEqual(draft);
    expect(controller.getSnapshot().dirty).toBe(true);
  });

  it('updates the editor URL after opening another project', async () => {
    queue([other]); queue([{ id: studioId, name: '工作室', role: 'owner', displayName: 'A' }]);
    const onLoadLayout = vi.fn();
    const rendered = render(<CloudPanel layout={backendSceneToLayout(scene, { projectId, name: original.name })} onLoadLayout={onLoadLayout} />);
    fireEvent.click(rendered.container.querySelector('.sc-cloud-trigger:not([aria-controls])')!);
    await waitFor(() => expect(screen.getByRole('button', { name: '打开' })).toBeTruthy());
    queue(other);
    fireEvent.click(screen.getByRole('button', { name: '打开' }));
    await waitFor(() => expect(onLoadLayout).toHaveBeenCalledOnce());
    expect(new URLSearchParams(window.location.search).get('project')).toBe(otherId);
  });


  it('never labels a local scene preset as saved to the cloud', async () => {
    queue([other]);
    queue([{ id: studioId, name: '工作室', role: 'owner', displayName: 'A' }]);
    const layout = { ...backendSceneToLayout(scene), scenePreset: 'popup' as const };
    render(<CloudPanel layout={layout} onLoadLayout={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '账户与项目' }));
    expect(screen.getByText('本地草稿')).toBeTruthy();
    expect(screen.queryByText('云端已保存')).toBeNull();
    await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(4));
    expect(controller.getSnapshot().draft).not.toEqual(layout);
  });
  it.each((['open', 'acquire', 'create'] as const).flatMap(action => (['geometry', 'activity', 'nested activity'] as const).map(change => ({action,change}))))('preserves $change edits made while the $action request is pending', async ({action,change}) => {
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
    fireEvent.click(screen.getByRole('button', { name: '关闭账户面板' }));
    const changedLayout = change==='geometry' ? { ...initialLayout, width: 13 } : change==='activity' ? { ...initialLayout, eventOperations:{schemaVersion:1 as const,dataKind:'unspecified' as const,tasks:[]} } : {...initialLayout,designBook:{activeId:'parent',variants:[{id:'parent',name:'方案',layout:{...initialLayout,designBook:{activeId:'leaf',variants:[{id:'leaf',name:'活动',layout:{...initialLayout,eventOperations:{schemaVersion:1 as const,dataKind:'unspecified' as const,tasks:[]}}}]}}}]}};
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
    await waitFor(() => expect(screen.getByText(change==='geometry' ? /加载期间画布有新改动/ : LOCAL_HANDOFF_CLOUD_MESSAGE)).toBeTruthy());
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

it('filters projects by name and studio and clears an empty search', async () => {
  const secondStudio = '20000000-0000-4000-8000-000000000002';
  queue([original, { ...other, studio_id: secondStudio }]);
  queue([{ id: studioId, name: '一号工作室', role: 'owner', displayName: 'A' }, { id: secondStudio, name: '二号工作室', role: 'editor', displayName: 'A' }]);
  render(<CloudPanel controller={controller} layout={backendSceneToLayout(scene)} onLoadLayout={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: '账户与项目' }));
  await waitFor(() => expect(screen.getAllByRole('button', { name: '打开' })).toHaveLength(1));
  fireEvent.change(screen.getByRole('combobox', { name: '当前工作室' }), { target: { value: secondStudio } });
  expect(screen.getAllByRole('button', { name: '打开' })).toHaveLength(1);
  expect(screen.getByText('另一个云项目')).toBeTruthy();
  fireEvent.change(screen.getByRole('searchbox', { name: '搜索项目' }), { target: { value: '不存在' } });
  expect(screen.queryByRole('button', { name: '打开' })).toBeNull();
  expect(screen.getByText('没有匹配的项目')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '清除筛选' }));
  expect(screen.getAllByRole('button', { name: '打开' })).toHaveLength(1);
});

it('defaults demo permissions to all enabled and keeps changes separate from real access and canvas', () => {
  const offline = new BackendSession(getBackendConfig({ url: '', anonKey: '' }));
  const load = vi.fn();
  render(<CloudPanel controller={offline} layout={backendSceneToLayout(scene)} onLoadLayout={load} />);
  fireEvent.click(screen.getByRole('button', { name: '账户与项目' }));
  const requestCount = mockFetch.mock.calls.length;
  fireEvent.click(screen.getByRole('button', { name: '团队演示' }));
  fireEvent.change(screen.getByLabelText('演示成员姓名'), { target: { value: '陈知远' } });
  fireEvent.click(screen.getByRole('button', { name: '添加演示成员' }));
  expect(screen.getByText('4 位演示成员')).toBeTruthy();
  fireEvent.change(screen.getByRole('combobox', { name: '陈知远的演示角色' }), { target: { value: 'viewer' } });
  fireEvent.click(screen.getByRole('button', { name: '权限演示' }));
  expect(screen.getByText('功能默认开放 · 权限仅作演示')).toBeTruthy();
  expect(screen.getAllByRole('checkbox').every(checkbox => (checkbox as HTMLInputElement).checked)).toBe(true);
  fireEvent.click(screen.getByRole('checkbox', { name: '查看成员：导出方案' }));
  fireEvent.change(screen.getByRole('combobox', { name: '预览角色' }), { target: { value: 'viewer' } });
  expect(screen.getByText('适用于 2 位演示成员')).toBeTruthy();
  expect((screen.getByRole('checkbox', { name: '查看成员：导出方案' }) as HTMLInputElement).checked).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: '团队演示' }));
  expect((screen.getByRole('combobox', { name: '陈知远的演示角色' }) as HTMLSelectElement).value).toBe('viewer');
  fireEvent.click(screen.getByRole('button', { name: '移除演示成员陈知远' }));
  expect(screen.getByText('3 位演示成员')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '权限演示' }));
  expect((screen.getByRole('checkbox', { name: '查看成员：导出方案' }) as HTMLInputElement).checked).toBe(false);
  expect(screen.getByRole('checkbox', { name: '负责人：编辑场景' }).hasAttribute('disabled')).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: '重置演示' }));
  expect((screen.getByRole('checkbox', { name: '查看成员：导出方案' }) as HTMLInputElement).checked).toBe(true);
  expect(mockFetch).toHaveBeenCalledTimes(requestCount);
  expect(load).not.toHaveBeenCalled();
  expect(offline.getSnapshot().user).toBeNull();
  expect(offline.getSnapshot().writeBlocked).toBe(true);
  offline.dispose();
});

it('reports a failed project list without claiming the account is empty and allows retry', async () => {
  const list = vi.spyOn(controller, 'listProjects').mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce([other]);
  vi.spyOn(controller, 'listStudios').mockResolvedValue([{ id: studioId, name: '工作室', role: 'owner', displayName: 'A' }]);
  render(<CloudPanel controller={controller} layout={backendSceneToLayout(scene)} onLoadLayout={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: '账户与项目' }));
  expect(await screen.findByText('项目加载失败，请点击刷新列表重试。')).toBeTruthy();
  expect(screen.queryByText('这个工作室还没有项目')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '刷新列表' }));
  expect(await screen.findByText('另一个云项目')).toBeTruthy();
  expect(list).toHaveBeenCalledTimes(2);
});

it('offers local activities without cloud configuration but excludes a requested or connected cloud project', () => {
  const offline = new BackendSession(getBackendConfig({ url: '', anonKey: '' }));
  const actions = { prepareBackup: vi.fn(), restoreBackup: vi.fn(), undoRestore: vi.fn(), backupPending: false, canUndoRestore: false };
  vi.mocked(useLocalProjectBackup).mockReturnValue(actions);
  const local = backendSceneToLayout(scene, { projectId: 'house-local-activity' });
  const view = render(<CloudPanel controller={offline} layout={local} onLoadLayout={vi.fn()}/>);
  expect(vi.mocked(LocalActivitiesPanel).mock.calls.at(-1)?.[0]).toMatchObject({ layout: local, actions, disabled: false });
  vi.mocked(LocalActivitiesPanel).mockClear();
  window.history.replaceState(null, '', `/?project=${projectId}`);
  view.rerender(<CloudPanel controller={offline} layout={local} onLoadLayout={vi.fn()}/>);
  expect(LocalActivitiesPanel).not.toHaveBeenCalled();
  window.history.replaceState(null, '', '/');
  view.rerender(<CloudPanel controller={controller} layout={local} onLoadLayout={vi.fn()}/>);
  expect(LocalActivitiesPanel).not.toHaveBeenCalled();
  offline.dispose();
});

it('keeps account-panel keys away from canvas shortcuts while preserving native dialog defaults', () => {
  const offline = new BackendSession(getBackendConfig({ url: '', anonKey: '' }));
  render(<CloudPanel controller={offline} layout={backendSceneToLayout(scene)} onLoadLayout={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: '账户与项目' }));
  const canvasShortcut = vi.fn();
  window.addEventListener('keydown', canvasShortcut);
  const close = screen.getByRole('button', { name: '关闭账户面板' });
  expect(fireEvent.keyDown(close, { key: 'Escape' })).toBe(true);
  fireEvent.keyDown(close, { key: 'Delete' });
  fireEvent.keyDown(close, { key: 'z', ctrlKey: true });
  window.removeEventListener('keydown', canvasShortcut);
  expect(canvasShortcut).not.toHaveBeenCalled();
  offline.dispose();
});

it('keeps local activity controls available for a scene connection and does not offer whole-project publishing',async()=>{
  const localId='house-scene-connection',local=backendSceneToLayout(scene,{projectId:localId,name:'本机活动'});
  const state={...controller.getSnapshot(),geometryBinding:{version:1 as const,localActivityId:localId,cloudProjectId:projectId,userId:'user-a',apiUrl:controller.config.apiUrl}};
  vi.spyOn(controller,'getSnapshot').mockReturnValue(state);
  vi.spyOn(controller,'isGeometryBound').mockImplementation(id=>id===localId);
  vi.spyOn(controller,'listProjects').mockResolvedValue([original]);vi.spyOn(controller,'listStudios').mockResolvedValue([{id:studioId,name:'Test studio',role:'owner',displayName:'A'}]);
  const disconnect=vi.spyOn(controller,'disconnectGeometryWorkbench').mockResolvedValue(undefined);
  const actions={prepareBackup:vi.fn(),restoreBackup:vi.fn(),undoRestore:vi.fn(),backupPending:false,canUndoRestore:false};
  vi.mocked(useLocalProjectBackup).mockReturnValue(actions);
  render(<CloudPanel controller={controller} layout={local} onLoadLayout={vi.fn()}/>);
  fireEvent.click(screen.getByRole('button',{name:'账户与项目'}));
  expect(await screen.findByRole('region',{name:'当前活动的场景连接'})).toBeTruthy();
  expect(await screen.findByText('暂无其他云项目')).toBeTruthy();expect(screen.queryByText('这个工作室还没有项目')).toBeNull();
  expect(vi.mocked(LocalActivitiesPanel).mock.calls.at(-1)?.[0]).toMatchObject({layout:local,actions});
  expect(screen.queryByRole('button',{name:'保存到云端'})).toBeNull();
  fireEvent.click(screen.getByRole('button',{name:'发布管理'}));
  expect(screen.getByText('当前连接用于场景处理。需要交给客户的资料，请从“方案评审”核对并导出。')).toBeTruthy();
  expect(PublicationPanel).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button',{name:'我的项目'}));
  fireEvent.click(screen.getByRole('button',{name:'断开场景服务'}));await waitFor(()=>expect(disconnect).toHaveBeenCalledOnce());
  expect(local.id).toBe(localId);
});
