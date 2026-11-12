// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useEffect, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AssetsPanel } from '@/components/business/assets-panel';
import { BackendSession, createBackendSession, getBackendConfig, type Scene } from '@/lib/backend-session';
import { readSourceRecord, registerSourceFlush } from '@/lib/source-storage';
import { materialCheckinLedgerSchema } from '../../../../supabase/functions/_shared/material-checkin-contract';
import {canonical,sha256} from '../../../../supabase/functions/_shared/domain';
import { backendSceneToLayout, LOCAL_ZONES_CLOUD_MESSAGE } from '../lib/backend-adapter';
import { subscribeNotices, type Notice } from '../lib/editor-notices';
import { LOCAL_CHECKIN_CLOUD_MESSAGE, LOCAL_HANDOFF_CLOUD_MESSAGE, LOCAL_RECORDS_READ_MESSAGE } from '../lib/handoff-cloud-guard';
import { addDesign } from '../lib/scene-layers';
import { ensureGlbAsset } from '../three/glb-assets';
import { CloudPanel } from './cloud-panel';
import {createActivitySessionTracker} from '../lib/activity-session-epoch';
import {createLayoutStore} from '../hooks/use-layout-store';
import type { RoomLayout } from '../lib/types';

function watchNotices(): { next(match: RegExp | string): Promise<Notice>; stop(): void } {
  const pending: Notice[] = [];
  const waiters: Array<{ match: RegExp | string; resolve: (notice: Notice) => void }> = [];
  const matches = (match: RegExp | string, message: string) => typeof match === 'string' ? message === match : match.test(message);
  const stop = subscribeNotices(notice => {
    const waiter = waiters.find(entry => matches(entry.match, notice.message));
    if (waiter) { waiters.splice(waiters.indexOf(waiter), 1); waiter.resolve(notice); }
    else pending.push(notice);
  });
  return {
    next(match) {
      const hit = pending.find(notice => matches(match, notice.message));
      if (hit) { pending.splice(pending.indexOf(hit), 1); return Promise.resolve(hit); }
      return new Promise((resolve, reject) => {
        const timer = window.setTimeout(() => reject(new Error(`notice not seen: ${match}`)), 4000);
        waiters.push({ match, resolve: notice => { window.clearTimeout(timer); resolve(notice); } });
      });
    },
    stop,
  };
}

vi.mock('@/lib/backend-session', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/backend-session')>();
  return { ...actual, createBackendSession: vi.fn() };
});
vi.mock('@/lib/source-storage', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/source-storage')>();
  return { ...actual, readSourceRecord: vi.fn() };
});
vi.mock('@/lib/material-checkin-storage',async original=>{const actual=await original<typeof import('@/lib/material-checkin-storage')>();return {...actual,readMaterialCheckins:async(id:string)=>actual.checkedMaterialCheckins(id,await readSourceRecord(actual.materialCheckinStorageKey(id)))};});
vi.mock('../three/glb-assets', () => ({ ensureGlbAsset: vi.fn() }));
const { push, replace } = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams(window.location.search), useRouter: () => ({ push, replace }) }));
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

function openAccount(section: '我的项目' | '物料' | '团队与权限' = '我的项目'): void {
  fireEvent.click(screen.getByRole('button', { name: '账户中心' }));
  // 默认落在项目；物料 / 团队在左栏团队列表下方。
  if (section !== '我的项目') fireEvent.click(screen.getByRole('button', { name: section }));
}

function openProjects(container: HTMLElement): void {
  fireEvent.click(container.querySelector('.sc-cloud-trigger')!);
}

/** 项目卡改为双击进入；当前卡用「当前项目」标签。 */
function enterListedProject(): void {
  fireEvent.doubleClick(screen.getByRole('button', { name: /^打开 / }));
}
function enterCurrentProject(): void {
  fireEvent.doubleClick(screen.getByRole('button', { name: /^当前项目 / }));
}
function openProjectMenu(projectName: string): void {
  const summary = screen.getByLabelText(`${projectName} 更多操作`);
  const details = summary.closest('details');
  if (details && !details.open) fireEvent.click(summary);
}

beforeEach(async () => {
  localStorage.clear();
  window.history.replaceState(null, '', '/');
  mockFetch.mockReset();
  push.mockReset();
  replace.mockReset();
  pointRecords.clear();unreadablePointScopes.clear();
  vi.mocked(readSourceRecord).mockReset().mockImplementation(async key => {
    if (typeof key === 'string' || key[0] !== 'material-checkins') return undefined;
    if (unreadablePointScopes.has(key[1])) throw new Error('演练点验读取失败');
    return pointRecords.get(key[1]);
  });
  vi.mocked(AssetsPanel).mockClear();
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
  function points(id = projectId) { return materialCheckinLedgerSchema.parse({ projectId: id, dataKind: 'rehearsal', sheets: [] }); }
  async function editable(): Promise<void> {
    queue({ sessionId: controller.getSnapshot().sessionId, generation: 4, revision: 2, scene, expiresAt: new Date(Date.now() + 90_000).toISOString() });
    await controller.acquireLease(projectId);
  }
  function projectLists(): void { queue([other]);queue([{ id: studioId, name: '工作室', role: 'owner', displayName: 'A' }]); }
  async function triggerAction(
    action: 'create' | 'open' | 'acquire' | 'save',
    view?: ReturnType<typeof render>,
    onLoadLayout: (layout: RoomLayout) => void = vi.fn<(layout: RoomLayout) => void>(),
  ): Promise<void> {
    if (action === 'create') {
      fireEvent.click(screen.getByRole('button', { name: '新方案' }));
      return;
    }
    if (action === 'open') { enterListedProject(); return; }
    if (action === 'acquire') { enterCurrentProject(); return; }
    // 自动保存依赖画布指纹与草稿一致，并 debounce 1.2s。
    const draft = { ...scene, lighting: 'warm' as const };
    await act(async () => { controller.setDraft(draft); });
    view!.rerender(<CloudPanel controller={controller} layout={backendSceneToLayout(draft, { projectId, name: original.name })} onLoadLayout={onLoadLayout} />);
  }

  it.each((['create', 'open', 'acquire', 'save'] as const).flatMap(action => (['ledger', 'corrupt', 'read failure'] as const).map(record => ({ action, record }))))('refuses $action before its cloud request for an independent $record', async ({ action, record }) => {
    if (action === 'save') await editable();
    if (record === 'read failure') unreadablePointScopes.add(projectId);
    else pointRecords.set(projectId, record === 'ledger' ? points() : { corrupt: true });
    const getProject = vi.spyOn(controller, 'getProject'), acquire = vi.spyOn(controller, 'acquireLease');
    const create = vi.spyOn(controller, 'createProject'), saveScene = vi.spyOn(controller, 'saveScene');
    const initial = backendSceneToLayout(scene, { projectId, name: original.name }), onLoadLayout = vi.fn();
    projectLists();
    queue(other); // 账户面板打开后 peek 卡片预览，不切换当前项目
    const view = render(<CloudPanel controller={controller} layout={initial} onLoadLayout={onLoadLayout}/>);
    openAccount();
    await waitFor(() => expect(mockFetch.mock.calls.length).toBeGreaterThanOrEqual(5));
    const requests = mockFetch.mock.calls.length;
    await triggerAction(action, view, onLoadLayout);
    expect(await screen.findByText(record === 'ledger' ? LOCAL_CHECKIN_CLOUD_MESSAGE : LOCAL_RECORDS_READ_MESSAGE, {}, { timeout: 3000 })).toBeTruthy();
    expect(readSourceRecord).toHaveBeenCalledWith(['material-checkins', projectId]);
    expect(getProject).not.toHaveBeenCalled();expect(acquire).not.toHaveBeenCalled();expect(create).not.toHaveBeenCalled();expect(saveScene).not.toHaveBeenCalled();
    expect(mockFetch).toHaveBeenCalledTimes(requests);expect(onLoadLayout).not.toHaveBeenCalled();
    expect(initial.id).toBe(projectId);expect(controller.getSnapshot().project?.id).toBe(projectId);
  });

  it.each(['open','acquire','create'] as const)('does not issue %s cloud request when outgoing local save fails',async action=>{
    const initial=backendSceneToLayout(scene,{projectId,name:original.name}),onLoadLayout=vi.fn();
    const beforeSwitch=vi.fn(()=>{throw new Error('当前活动未保存，未切换。');});
    projectLists();queue(other);render(<CloudPanel controller={controller} layout={initial} onLoadLayout={onLoadLayout} onBeforeActivitySwitch={beforeSwitch}/>);
    openAccount();await waitFor(()=>expect(mockFetch.mock.calls.length).toBeGreaterThanOrEqual(5));
    const getProject=vi.spyOn(controller,'getProject'),acquire=vi.spyOn(controller,'acquireLease'),create=vi.spyOn(controller,'createProject');
    await triggerAction(action);
    expect((await screen.findAllByText('当前活动未保存，未切换。')).length).toBeGreaterThan(0);
    expect(beforeSwitch).toHaveBeenCalledWith(initial);expect(getProject).not.toHaveBeenCalled();expect(acquire).not.toHaveBeenCalled();expect(create).not.toHaveBeenCalled();
    expect(onLoadLayout).not.toHaveBeenCalled();expect(controller.getSnapshot().project?.id).toBe(projectId);
  });
  it('rejects a delayed cloud project before selecting it when the outgoing activity changes',async()=>{
    const initial=backendSceneToLayout(scene,{projectId,name:original.name}),onLoadLayout=vi.fn();let current=true;
    const beforeSwitch=vi.fn(()=>()=>{if(!current)throw new Error('活动已变化，未切换。');});
    projectLists();queue(other);render(<CloudPanel controller={controller} layout={initial} onLoadLayout={onLoadLayout} onBeforeActivitySwitch={beforeSwitch}/>);
    openAccount();await waitFor(()=>expect(mockFetch.mock.calls.length).toBeGreaterThanOrEqual(5));
    let finish!:(value:Response)=>void;
    mockFetch.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));enterListedProject();
    await waitFor(()=>expect(typeof finish).toBe('function'));current=false;
    await act(async()=>{finish(json(other));});
    expect((await screen.findAllByText('活动已变化，未切换。')).length).toBeGreaterThan(0);
    expect(onLoadLayout).not.toHaveBeenCalled();expect(controller.getSnapshot().project?.id).toBe(projectId);
  });
  it.each(['open','create'] as const)('captures the activity fence before waiting for source flush on %s',async action=>{
    const initial=backendSceneToLayout(scene,{projectId,name:original.name}),onLoadLayout=vi.fn();let epoch=0,finishFlush!:()=>void;
    const unregister=registerSourceFlush(projectId,()=>new Promise<void>(resolve=>{finishFlush=resolve;}));
    const beforeSwitch=vi.fn(()=>{const captured=epoch;return ()=>{if(epoch!==captured)throw new Error('活动已变化，未切换。');};});
    try{
      projectLists();queue(other);render(<CloudPanel controller={controller} layout={initial} onLoadLayout={onLoadLayout} onBeforeActivitySwitch={beforeSwitch}/>);
      openAccount();await waitFor(()=>expect(mockFetch.mock.calls.length).toBeGreaterThanOrEqual(5));
      const getProject=vi.spyOn(controller,'getProject'),create=vi.spyOn(controller,'createProject');
      await triggerAction(action);await waitFor(()=>expect(typeof finishFlush).toBe('function'));
      expect(beforeSwitch).toHaveBeenCalledOnce();epoch+=2;
      await act(async()=>{finishFlush();});
      expect((await screen.findAllByText('活动已变化，未切换。')).length).toBeGreaterThan(0);
      expect(getProject).not.toHaveBeenCalled();expect(create).not.toHaveBeenCalled();expect(onLoadLayout).not.toHaveBeenCalled();
    }finally{unregister();}
  });
  it('loads another project exactly once after its lease is obtained and the outgoing draft remains current',async()=>{
    const initial=backendSceneToLayout(scene,{projectId,name:original.name});let current=initial;
    const onLoadLayout=vi.fn((next:RoomLayout)=>{current=next;});
    const beforeSwitch=vi.fn((expected?:RoomLayout)=>{expect(expected).toBe(initial);return ()=>{if(current!==initial)throw new Error('活动已变化');};});
    projectLists();queue(other);render(<CloudPanel controller={controller} layout={initial} onLoadLayout={onLoadLayout} getCurrentLayout={()=>current} onBeforeActivitySwitch={beforeSwitch}/>);
    openAccount();await screen.findByRole('button',{name:/^打开 /});
    queue(other);queue({sessionId:controller.getSnapshot().sessionId,generation:4,revision:2,scene,expiresAt:new Date(Date.now()+90_000).toISOString()});
    enterListedProject();await waitFor(()=>expect(onLoadLayout).toHaveBeenCalledTimes(1));
    expect(current.id).toBe(otherId);expect(controller.getSnapshot().project?.id).toBe(otherId);expect(controller.getSnapshot().writeBlocked).toBe(false);
  });
  it('blocks cloud writes if the outgoing draft changes after the other project is selected',async()=>{
    const initial=backendSceneToLayout(scene,{projectId,name:original.name});let current=initial,valid=true;
    const onLoadLayout=vi.fn((next:RoomLayout)=>{current=next;});
    const beforeSwitch=vi.fn(()=>()=>{if(!valid)throw new Error('活动已变化，未切换。');});
    let finishAssets!:(value:{assetUrls:Record<string,string>;assetNames:Record<string,string>})=>void;
    vi.spyOn(controller,'authorizeAssets').mockImplementationOnce(()=>new Promise(resolve=>{finishAssets=resolve;}));
    projectLists();queue(other);render(<CloudPanel controller={controller} layout={initial} onLoadLayout={onLoadLayout} getCurrentLayout={()=>current} onBeforeActivitySwitch={beforeSwitch}/>);
    openAccount();await screen.findByRole('button',{name:/^打开 /});
    queue(other);queue({sessionId:controller.getSnapshot().sessionId,generation:4,revision:2,scene,expiresAt:new Date(Date.now()+90_000).toISOString()});
    enterListedProject();await waitFor(()=>expect(typeof finishAssets).toBe('function'));valid=false;queue({});
    await act(async()=>{finishAssets({assetUrls:{},assetNames:{}});});
    expect((await screen.findAllByText(/云端项目与当前画布未完成匹配，云端写入已暂停/)).length).toBeGreaterThan(0);
    expect(onLoadLayout).not.toHaveBeenCalled();expect(current.id).toBe(projectId);
    expect(controller.getSnapshot()).toMatchObject({project:{id:otherId},writeBlocked:true,error:{code:'CANVAS_PROJECT_MISMATCH'}});
    const count=mockFetch.mock.calls.length;await expect(controller.businessRequest('/projects','POST',{})).rejects.toMatchObject({code:'CANVAS_PROJECT_MISMATCH'});
    expect(mockFetch).toHaveBeenCalledTimes(count);
  });

  it.each(['already recorded', 'during authorization'] as const)('keeps the original canvas when the target project has a ledger %s', async timing => {
    const initial = backendSceneToLayout(scene, { projectId, name: original.name }), onLoadLayout = vi.fn();
    let finishAssets!: (value: { assetUrls: Record<string, string>;assetNames: Record<string, string> }) => void;
    const authorize = vi.spyOn(controller, 'authorizeAssets');
    if (timing === 'already recorded') pointRecords.set(otherId, points(otherId));
    else authorize.mockImplementationOnce(() => new Promise(resolve => { finishAssets = resolve; }));
    projectLists();render(<CloudPanel controller={controller} layout={initial} onLoadLayout={onLoadLayout}/>);
    openAccount();
    await screen.findByRole('button', { name: /^打开 / });queue(other);
    if(timing==='during authorization')queue({sessionId:controller.getSnapshot().sessionId,generation:4,revision:2,scene,expiresAt:new Date(Date.now()+90_000).toISOString()});
    enterListedProject();
    if (timing === 'during authorization') {
      await waitFor(() => expect(finishAssets).toBeTypeOf('function'));pointRecords.set(otherId, points(otherId));queue({});
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
    projectLists();
    if (action === 'open') queue(other);
    const view = render(<CloudPanel controller={controller} layout={initial} onLoadLayout={onLoadLayout}/>);
    openAccount();
    await waitFor(() => expect(screen.getByRole('button', { name: action === 'create' ? '新方案' : action === 'open' ? /^打开 / : /^当前项目 / }).hasAttribute('disabled')).toBe(false));
    let finish!: (response: Response) => void;
    mockFetch.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    await triggerAction(action, view, onLoadLayout);
    await waitFor(() => expect(finish).toBeTypeOf('function'), { timeout: 3000 });const currentPoints = points();pointRecords.set(projectId, currentPoints);
    const sessionId = controller.getSnapshot().sessionId;
    if (action === 'acquire') queue({ sessionId, generation: 4, revision: 2, expiresAt: new Date().toISOString() });
    await act(async () => {
      finish(json(action === 'acquire' ? { sessionId, generation: 4, revision: 2, scene, expiresAt: new Date(Date.now() + 90_000).toISOString() }
        : action === 'save' ? { id: projectId, revision: 3, scene, updatedAt: new Date().toISOString(), warnings: [] } : other));
    });
    expect(await screen.findByText(action === 'create' ? /云端创建请求已返回，结果待核对；当前画布未替换/ : LOCAL_CHECKIN_CLOUD_MESSAGE)).toBeTruthy();
    expect(pointRecords.get(projectId)).toEqual(currentPoints);expect(onLoadLayout).not.toHaveBeenCalled();expect(initial.id).toBe(projectId);
    expect(screen.queryByText(/新项目已保存|已载入最新版本并获得编辑权|已打开项目|已保存云端版本/)).toBeNull();
    if (action === 'save') {
      expect(screen.queryByText('已保存')).toBeNull();
    }
    if (action === 'acquire') expect(String(mockFetch.mock.calls.at(-1)![0])).toContain(`/projects/${projectId}/lease/release`);
  });
});

describe('CloudPanel local zone protection', () => {
  const zone = { id: 'rest', name: '休息区', color: '#4A7C59', x: -1, z: -1, w: 2, d: 2 };
  const withZone = (base: RoomLayout): RoomLayout => ({ ...base, floors: [{ ...base.floors[0]!, zones: [zone] }] });

  it('does not replace a local zone when opening a different cloud project', async () => {
    queue([other]); queue([{ id: studioId, name: '工作室', role: 'owner', displayName: 'A' }]); queue(other);
    const local = withZone(backendSceneToLayout(scene, { projectId, name: original.name }));
    const onLoadLayout = vi.fn();
    render(<CloudPanel controller={controller} layout={local} onLoadLayout={onLoadLayout}/>);
    openAccount();
    await screen.findByRole('button', { name: /^打开 / });
    const getProject = vi.spyOn(controller, 'getProject');
    enterListedProject();
    await waitFor(() => expect(screen.getAllByText(LOCAL_ZONES_CLOUD_MESSAGE).length).toBeGreaterThanOrEqual(2));
    expect(getProject).not.toHaveBeenCalled();
    expect(onLoadLayout).not.toHaveBeenCalled();
    expect(local.floors[0]!.zones).toEqual([zone]);
    expect(screen.queryByText('当前 · 已保存')).toBeNull();
  });

  it('rechecks the current local zone after an in-flight cloud project request', async () => {
    queue([other]); queue([{ id: studioId, name: '工作室', role: 'owner', displayName: 'A' }]); queue(other);
    const initial = backendSceneToLayout(scene, { projectId, name: original.name });
    const onLoadLayout = vi.fn();
    const view = render(<CloudPanel controller={controller} layout={initial} onLoadLayout={onLoadLayout}/>);
    openAccount();
    await screen.findByRole('button', { name: /^打开 / });
    let finish!: (response: Response) => void;
    mockFetch.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    enterListedProject();
    await waitFor(() => expect(finish).toBeTypeOf('function'));
    const local = withZone(initial);
    view.rerender(<CloudPanel controller={controller} layout={local} onLoadLayout={onLoadLayout}/>);
    await act(async () => { finish(json(other)); });
    await waitFor(() => expect(screen.getAllByText(LOCAL_ZONES_CLOUD_MESSAGE).length).toBeGreaterThanOrEqual(2));
    expect(onLoadLayout).not.toHaveBeenCalled();
    expect(local.floors[0]!.zones).toEqual([zone]);
    expect(controller.getSnapshot().project?.id).toBe(projectId);
  });

  it('does not label a locally zoned layout as cloud-saved or send autosave', async () => {
    queue({ sessionId: controller.getSnapshot().sessionId, generation: 4, revision: 2, scene, expiresAt: new Date(Date.now() + 90_000).toISOString() });
    await controller.acquireLease(projectId);
    const save = vi.spyOn(controller, 'saveScene');
    const draft = { ...scene, lighting: 'warm' as const };
    await act(async () => { controller.setDraft(draft); });
    const local = withZone(backendSceneToLayout(draft, { projectId, name: original.name }));
    queue([original]); queue([{ id: studioId, name: '工作室', role: 'owner', displayName: 'A' }]);
    render(<CloudPanel controller={controller} layout={local} onLoadLayout={vi.fn()}/>);
    openAccount();
    expect(await screen.findByText(LOCAL_ZONES_CLOUD_MESSAGE)).toBeTruthy();
    expect(screen.queryByText('当前 · 已保存')).toBeNull();
    await new Promise(resolve => setTimeout(resolve, 1500));
    expect(save).not.toHaveBeenCalled();
    expect(local.floors[0]!.zones).toEqual([zone]);
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
    queue(other); // 失败后 showAccount / 手动打开面板时的卡片 peek
    if(entry==='url')window.history.replaceState(null,'',`/editor/?project=${otherId}`);
    try{
      render(<CloudPanel controller={controller} layout={initial} onLoadLayout={onLoadLayout}/>);
      await waitFor(()=>expect(mockFetch.mock.calls.length).toBeGreaterThanOrEqual(4));
      if(entry!=='url'){
        openAccount();
        await waitFor(() => expect(mockFetch.mock.calls.length).toBeGreaterThanOrEqual(5));
        const requests = mockFetch.mock.calls.length;
        if (entry === 'button') enterListedProject();
        else enterCurrentProject();
        expect(await screen.findByText('活动需求保存失败，原输入已保留。')).toBeTruthy();
        expect(getProject).not.toHaveBeenCalled(); expect(acquireLease).not.toHaveBeenCalled(); expect(onLoadLayout).not.toHaveBeenCalled();
        expect(mockFetch).toHaveBeenCalledTimes(requests);
      } else {
        expect(await screen.findByText('活动需求保存失败，原输入已保留。')).toBeTruthy();
        expect(getProject).not.toHaveBeenCalled(); expect(acquireLease).not.toHaveBeenCalled(); expect(onLoadLayout).not.toHaveBeenCalled();
        await waitFor(() => expect(mockFetch.mock.calls.length).toBeGreaterThanOrEqual(4));
      }
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
    queue(other); // 打开账户面板时的卡片 peek
    if (entry === 'url') window.history.replaceState(null, '', `/editor/?project=${otherId}`);
    const notices = entry === 'url' ? watchNotices() : null;
    render(<CloudPanel controller={controller} layout={local} onLoadLayout={onLoadLayout}/>);
    await waitFor(() => expect(mockFetch.mock.calls.length).toBeGreaterThanOrEqual(entry === 'url' ? 2 : 4));
    if (entry === 'button') {
      openAccount();
      await waitFor(() => expect(mockFetch.mock.calls.length).toBeGreaterThanOrEqual(5));
      const requests = mockFetch.mock.calls.length;
      await act(async () => { enterListedProject(); });
      expect(screen.getByText(LOCAL_HANDOFF_CLOUD_MESSAGE)).toBeTruthy();
      expect(getProject).not.toHaveBeenCalled();
      expect(mockFetch).toHaveBeenCalledTimes(requests);
    } else {
      await notices!.next(LOCAL_HANDOFF_CLOUD_MESSAGE);
      notices!.stop();
      expect(document.querySelector('dialog.sc-account-dialog')?.hasAttribute('open')).toBe(false);
      expect(getProject).not.toHaveBeenCalled();
    }
    expect(onLoadLayout).not.toHaveBeenCalled();
    if(kind==='worksheet')expect(local.floors[0]!.items[0]!.handoff?.ownerName).toBe('布展负责人');
    else if(kind==='activity')expect(local.eventOperations?.tasks).toEqual([]);
    else expect((local.designBook?.variants[0]!.layout as RoomLayout | undefined)?.designBook?.variants[0]!.layout.eventOperations?.tasks).toEqual([]);
    expect(controller.getSnapshot().project?.id).toBe(projectId);
  });

  it('autosaves an externally bound Agent project without replacing its draft or creating another project', async () => {
    queue([original]); queue([{ id: studioId, name: '工作室', role: 'owner', displayName: 'A' }]);
    const onLoadLayout = vi.fn();
    const rendered = render(<CloudPanel controller={controller} layout={backendSceneToLayout(scene)} onLoadLayout={onLoadLayout} />);
    openAccount();
    await waitFor(() => expect(mockFetch.mock.calls.length).toBeGreaterThanOrEqual(4));
    queue({ sessionId: controller.getSnapshot().sessionId, generation: 4, revision: 2, scene, expiresAt: new Date(Date.now() + 90_000).toISOString() });
    const draft = { ...scene, lighting: 'warm' as const };
    await act(async () => { await controller.acquireLease(projectId); controller.setDraft(draft); });
    rendered.rerender(<CloudPanel controller={controller} layout={backendSceneToLayout(draft, { projectId })} onLoadLayout={onLoadLayout} />);
    expect(vi.mocked(AssetsPanel).mock.calls.at(-1)?.[0].bound).toBe(true);
    expect(controller.getSnapshot().draft).toEqual(draft);
    queue({ id: projectId, revision: 3, scene: draft, updatedAt: new Date().toISOString(), warnings: [] });
    await waitFor(() => expect(controller.getSnapshot().dirty).toBe(false), { timeout: 3000 });
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
    openAccount();
    await waitFor(()=>expect(mockFetch.mock.calls.length).toBeGreaterThanOrEqual(4));
    let finish!:(response:Response)=>void;
    mockFetch.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
    await act(async () => { controller.setDraft({ ...scene, lighting: 'cool' }); });
    view.rerender(<CloudPanel controller={controller} layout={backendSceneToLayout({ ...scene, lighting: 'cool' }, { projectId })} onLoadLayout={onLoadLayout}/>);
    await waitFor(()=>expect(finish).toBeTypeOf('function'), { timeout: 3000 });
    const changed={...initial,eventOperations:{schemaVersion:1 as const,dataKind:'rehearsal' as const,tasks:[]}};
    view.rerender(<CloudPanel controller={controller} layout={changed} onLoadLayout={onLoadLayout}/>);
    await act(async()=>{finish(json({id:projectId,revision:3,scene,updatedAt:new Date().toISOString(),warnings:[]}));});
    expect(screen.getByText(LOCAL_HANDOFF_CLOUD_MESSAGE)).toBeTruthy();
    expect(screen.queryByText(/已自动保存|已保存云端版本/)).toBeNull();
    expect(changed.eventOperations).toEqual({schemaVersion:1,dataKind:'rehearsal',tasks:[]});
    expect(onLoadLayout).not.toHaveBeenCalled();
  });

  it('does not bind a different local canvas to an existing Agent lease', async () => {
    queue({ sessionId: controller.getSnapshot().sessionId, generation: 4, revision: 2, scene, expiresAt: new Date(Date.now() + 90_000).toISOString() });
    await controller.acquireLease(projectId);
    queue([original]); queue([{ id: studioId, name: '工作室', role: 'owner', displayName: 'A' }]);
    render(<CloudPanel controller={controller} layout={backendSceneToLayout(scene, { projectId: otherId })} onLoadLayout={vi.fn()} />);
    openAccount();
    await waitFor(() => expect(mockFetch.mock.calls.length).toBeGreaterThanOrEqual(4));
    expect(vi.mocked(AssetsPanel).mock.calls.at(-1)?.[0].bound).toBe(false);
    expect(controller.getSnapshot().writeBlocked).toBe(false);
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
    openProjects(rendered.container);
    await screen.findByText('另一个云项目');
    expect(screen.queryByText('其他工作室的项目')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '另一工作室' }));
    expect(screen.queryByText('另一个云项目')).toBeNull();
    expect(screen.getByText('其他工作室的项目')).toBeTruthy();

  });
  it('waits for live source inputs before sending the new project request', async () => {
    let finishFlush!:()=>void;
    const unregister=registerSourceFlush(projectId,()=>new Promise<void>(resolve=>{finishFlush=resolve;}));
    const create=vi.spyOn(controller,'createProject').mockRejectedValue(new Error('测试停止于创建请求'));
    queue([]);
    queue([{id:studioId,name:'工作室',role:'owner',displayName:'A'}]);
    const rendered=render(<CloudPanel layout={backendSceneToLayout(scene,{projectId})} onLoadLayout={vi.fn()}/>);
    openProjects(rendered.container);
    await waitFor(()=>expect(screen.getByRole('button',{name:'新方案'}).hasAttribute('disabled')).toBe(false));
    fireEvent.click(screen.getByRole('button',{name:'新方案'}));
    await waitFor(()=>expect(finishFlush).toBeTypeOf('function'));
    expect(create).not.toHaveBeenCalled();
    await act(async()=>{finishFlush();});
    expect(create).toHaveBeenCalledOnce();
    expect(await screen.findByText('测试停止于创建请求')).toBeTruthy();
    unregister();
  });
  it('keeps the local canvas and avoids duplicate creation when the cloud result is a read-only projection',async()=>{
    vi.spyOn(controller,'listProjects').mockResolvedValue([]);vi.spyOn(controller,'listStudios').mockResolvedValue([{id:studioId,name:'工作室',role:'owner',displayName:'A'}]);
    let finish!:(project:typeof other & {projection:{status:string;changed:boolean;requiresOriginalSceneForWrite:boolean}})=>void;
    const create=vi.spyOn(controller,'createProject').mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
    const current=backendSceneToLayout(scene,{projectId}),onLoad=vi.fn();const view=render(<CloudPanel layout={current} onLoadLayout={onLoad}/>);
    openProjects(view.container);await waitFor(()=>expect(screen.getByRole('button',{name:'新方案'}).hasAttribute('disabled')).toBe(false));
    const before=onLoad.mock.calls.length;fireEvent.click(screen.getByRole('button',{name:'新方案'}));
    await waitFor(()=>expect(create).toHaveBeenCalledOnce());
    expect(onLoad).toHaveBeenCalledTimes(before);
    await act(async()=>finish({...other,projection:{status:'read_only',changed:true,requiresOriginalSceneForWrite:true}}));
    expect(await screen.findByText(new RegExp(`云端项目已创建（编号 ${otherId}）.*未核验原始记录`.replace('（','\\（').replace('）','\\）')))).toBeTruthy();expect(onLoad).toHaveBeenCalledTimes(before);expect(create).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button',{name:'新方案'}));await waitFor(()=>expect(screen.getByText(/云端项目已创建.*目前仅供只读核对/)).toBeTruthy());
    expect(create).toHaveBeenCalledOnce();expect(onLoad).toHaveBeenCalledTimes(before);
  });
  it('never duplicates a projected project from a cached thumbnail as if it were complete',async()=>{
    vi.spyOn(controller,'listProjects').mockResolvedValue([other]);vi.spyOn(controller,'listStudios').mockResolvedValue([{id:studioId,name:'工作室',role:'owner',displayName:'A'}]);
    const peek=vi.spyOn(controller,'peekProject').mockResolvedValue({...other,projection:{status:'read_only',changed:true,requiresOriginalSceneForWrite:true}});
    const request=vi.spyOn(controller,'businessRequest');const onLoad=vi.fn();const view=render(<CloudPanel controller={controller} layout={backendSceneToLayout(scene,{projectId})} onLoadLayout={onLoad}/>);
    openProjects(view.container);await screen.findByText(other.name);openProjectMenu(other.name);const before=onLoad.mock.calls.length;
    fireEvent.click(within(screen.getByRole('group',{name:`${other.name} 操作`})).getByRole('button',{name:'复制'}));expect(await screen.findByText(/普通视图省略了未核验的原始记录/)).toBeTruthy();
    expect(peek).toHaveBeenCalled();expect(request.mock.calls.some(([path,method])=>path==='/projects'&&method==='POST')).toBe(false);expect(onLoad).toHaveBeenCalledTimes(before);
  });
  it('only fetches a restricted original on explicit request and drops a late A → B → A response',async()=>{
    vi.spyOn(controller,'listProjects').mockResolvedValue([other]);vi.spyOn(controller,'listStudios').mockResolvedValue([{id:studioId,name:'工作室',role:'owner',displayName:'A'}]);
    vi.spyOn(controller,'peekProject').mockResolvedValue({...other,projection:{status:'read_only',changed:true,requiresOriginalSceneForWrite:true}});
    let finish!:(value:{scene:unknown;revision:number;originalSceneHash:string})=>void;
    const read=vi.spyOn(controller,'readOriginalScene').mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
    const current=backendSceneToLayout(scene,{projectId}),store=createLayoutStore({layout:current,activeFloorIndex:0}),tracker=createActivitySessionTracker(store);tracker.start();
    const tree=()=> <CloudPanel controller={controller} layout={current} sessionToken={tracker.capture()} isSessionCurrent={tracker.isCurrent} onLoadLayout={vi.fn()}/>;
    const view=render(tree());openProjects(view.container);await screen.findByText(other.name);openProjectMenu(other.name);
    const menu=screen.getByRole('group',{name:`${other.name} 操作`});await waitFor(()=>expect(within(menu).getByRole('button',{name:'核对原始记录'})).toBeTruthy());
    fireEvent.click(within(menu).getByRole('button',{name:'核对原始记录'}));expect(read).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button',{name:'授权读取并查看原文'}));await waitFor(()=>expect(finish).toBeTypeOf('function'));
    act(()=>{store.setState({layout:{...current,id:'another-activity'}});store.setState({layout:current});});
    await act(async()=>{finish({scene:{...scene,objects:[{...scene.objects[0],notes:'不应显示旧原文'}]},revision:2,originalSceneHash:'a'.repeat(64)});});
    view.rerender(tree());expect(screen.queryByLabelText('授权查看的原始记录')).toBeNull();tracker.stop();
  });
  it('shows the authorized original only on request and keeps submission disabled',async()=>{
    vi.spyOn(controller,'listProjects').mockResolvedValue([other]);vi.spyOn(controller,'listStudios').mockResolvedValue([{id:studioId,name:'工作室',role:'owner',displayName:'A'}]);
    vi.spyOn(controller,'peekProject').mockResolvedValue({...other,projection:{status:'read_only',changed:true,requiresOriginalSceneForWrite:true}});
    const read=vi.spyOn(controller,'readOriginalScene').mockResolvedValue({scene:{...scene,objects:[{id:'private-note',notes:'授权原始记录'}]},revision:2,originalSceneHash:'a'.repeat(64)});
    const current=backendSceneToLayout(scene,{projectId}),store=createLayoutStore({layout:current,activeFloorIndex:0}),tracker=createActivitySessionTracker(store);tracker.start();const onLoad=vi.fn();
    const view=render(<CloudPanel controller={controller} layout={current} sessionToken={tracker.capture()} isSessionCurrent={tracker.isCurrent} onLoadLayout={onLoad}/>);
    openProjects(view.container);await screen.findByText(other.name);openProjectMenu(other.name);
    const menu=screen.getByRole('group',{name:`${other.name} 操作`});await waitFor(()=>expect(within(menu).getByRole('button',{name:'核对原始记录'})).toBeTruthy());
    fireEvent.click(within(menu).getByRole('button',{name:'核对原始记录'}));expect(read).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button',{name:'授权读取并查看原文'}));expect((await screen.findByLabelText('授权查看的原始记录')).textContent).toContain('授权原始记录');
    expect(screen.getByRole('button',{name:'下载原始记录'})).toBeTruthy();expect((screen.getByRole('button',{name:'确认提交修改'}) as HTMLButtonElement).disabled).toBe(true);
    expect(onLoad).not.toHaveBeenCalled();tracker.stop();
  });
  it('offers local position preview from the restricted project menu without saving or loading a scene',async()=>{
    vi.spyOn(controller,'listProjects').mockResolvedValue([other]);vi.spyOn(controller,'listStudios').mockResolvedValue([{id:studioId,name:'工作室',role:'owner',displayName:'A'}]);
    vi.spyOn(controller,'peekProject').mockResolvedValue({...other,projection:{status:'read_only',changed:true,requiresOriginalSceneForWrite:true}});
    const id='50000000-0000-4000-8000-000000000001',raw:Scene={...scene,objects:[{id,materialId:'chair',position:{x:2,z:3},rotation:0,size:{width:.5,depth:.5,height:.85},color:'#ffffff',locked:false,notes:'原始备注'}]};
    vi.spyOn(controller,'readOriginalScene').mockResolvedValue({scene:raw,revision:2,originalSceneHash:await sha256(canonical(raw))});
    const request=vi.spyOn(controller,'businessRequest');const current=backendSceneToLayout(scene,{projectId}),store=createLayoutStore({layout:current,activeFloorIndex:0}),tracker=createActivitySessionTracker(store);tracker.start();const onLoad=vi.fn();
    const view=render(<CloudPanel controller={controller} layout={current} sessionToken={tracker.capture()} isSessionCurrent={tracker.isCurrent} onLoadLayout={onLoad}/>);
    openProjects(view.container);await screen.findByText(other.name);openProjectMenu(other.name);
    const menu=screen.getByRole('group',{name:`${other.name} 操作`});await waitFor(()=>expect(within(menu).getByRole('button',{name:'核对原始记录'})).toBeTruthy());
    fireEvent.click(within(menu).getByRole('button',{name:'核对原始记录'}));fireEvent.click(screen.getByRole('button',{name:'授权读取并查看原文'}));await screen.findByLabelText('授权查看的原始记录');
    fireEvent.change(screen.getByLabelText('选择物件'),{target:{value:id}});fireEvent.change(screen.getByLabelText('横向位置（米）'),{target:{value:'4'}});
    fireEvent.click(screen.getByRole('button',{name:'预览位置差异'}));expect((await screen.findByRole('list',{name:'位置差异列表'})).textContent).toContain('横向：2 → 4');
    expect(onLoad).not.toHaveBeenCalled();expect(request.mock.calls.some(([,method])=>method==='POST'||method==='PUT')).toBe(false);
    expect((screen.getByRole('button',{name:'确认提交修改'}) as HTMLButtonElement).disabled).toBe(true);tracker.stop();
  });
  it('does not display a late original record after the signed-in account changes',async()=>{
    vi.spyOn(controller,'listProjects').mockResolvedValue([other]);vi.spyOn(controller,'listStudios').mockResolvedValue([{id:studioId,name:'工作室',role:'owner',displayName:'A'}]);
    vi.spyOn(controller,'peekProject').mockResolvedValue({...other,projection:{status:'read_only',changed:true,requiresOriginalSceneForWrite:true}});
    let finish!:(value:{scene:unknown;revision:number;originalSceneHash:string})=>void;vi.spyOn(controller,'readOriginalScene').mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
    let snapshot=controller.getSnapshot();vi.spyOn(controller,'getSnapshot').mockImplementation(()=>snapshot);
    const current=backendSceneToLayout(scene,{projectId}),store=createLayoutStore({layout:current,activeFloorIndex:0}),tracker=createActivitySessionTracker(store);tracker.start();
    const tree=()=> <CloudPanel controller={controller} layout={current} sessionToken={tracker.capture()} isSessionCurrent={tracker.isCurrent} onLoadLayout={vi.fn()}/>;
    const view=render(tree());openProjects(view.container);await screen.findByText(other.name);openProjectMenu(other.name);
    const menu=screen.getByRole('group',{name:`${other.name} 操作`});await waitFor(()=>expect(within(menu).getByRole('button',{name:'核对原始记录'})).toBeTruthy());
    fireEvent.click(within(menu).getByRole('button',{name:'核对原始记录'}));fireEvent.click(screen.getByRole('button',{name:'授权读取并查看原文'}));
    await waitFor(()=>expect(finish).toBeTypeOf('function'));snapshot={...snapshot,user:{id:'other-user'}};
    await act(async()=>{finish({scene:{secret:'原账户原文'},revision:2,originalSceneHash:'a'.repeat(64)});});view.rerender(tree());
    expect(screen.queryByText(/原账户原文/)).toBeNull();expect(screen.queryByLabelText('授权查看的原始记录')).toBeNull();tracker.stop();
  });

  it('opens the requested project after the current editing lease is released', async () => {
    const sessionId = controller.getSnapshot().sessionId;
    queue({ sessionId, generation: 4, revision: 2, scene, expiresAt: new Date(Date.now() + 90_000).toISOString() });
    await controller.acquireLease(projectId);
    window.history.replaceState(null, '', `/editor/?project=${otherId}`);
    queue([original, other]); queue([{ id: studioId, name: '工作室', role: 'owner', displayName: 'A' }]);
    const onLoadLayout = vi.fn();
    const notices = watchNotices();
    render(<CloudPanel layout={backendSceneToLayout(scene, { projectId, name: original.name })} onLoadLayout={onLoadLayout} />);
    await notices.next('请先释放当前项目的编辑权，再打开链接中的项目。');
    notices.stop();
    expect(document.querySelector('dialog.sc-account-dialog')?.hasAttribute('open')).toBe(false);
    expect(onLoadLayout).not.toHaveBeenCalled();
    // 深链冲突不再自动弹账户面板；用户自己打开后再释放编辑权。
    queue(other); // 手动打开后的卡片 peek
    openAccount();
    await screen.findByLabelText(`${original.name} 更多操作`);
    queue({ sessionId, generation: 4, revision: 2, expiresAt: new Date().toISOString() }); queue(other);
    openProjectMenu(original.name);
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
    const notices = watchNotices();
    render(<CloudPanel layout={backendSceneToLayout(draft, { projectId, name: original.name })} onLoadLayout={onLoadLayout} />);
    await notices.next(/已保留这个项目的本地未保存改动/);
    notices.stop();
    expect(document.querySelector('dialog.sc-account-dialog')?.hasAttribute('open')).toBe(false);
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
    const notices = watchNotices();
    render(<CloudPanel layout={backendSceneToLayout(draft, { projectId, name: original.name, assetUrls: { [assetId]: 'https://storage.example/expired.glb' } })} onLoadLayout={onLoadLayout} />);
    await notices.next(/已保留这个项目的本地未保存改动/);
    notices.stop();
    expect(document.querySelector('dialog.sc-account-dialog')?.hasAttribute('open')).toBe(false);
    expect(ensureGlbAsset).toHaveBeenCalledWith(assetId, 'https://storage.example/fresh.glb');
    expect(onLoadLayout).not.toHaveBeenCalled();
    expect(controller.getSnapshot().draft).toEqual(draft);
    expect(controller.getSnapshot().dirty).toBe(true);
  });

  it('updates the editor URL after opening another project', async () => {
    queue([other]); queue([{ id: studioId, name: '工作室', role: 'owner', displayName: 'A' }]);
    queue(other); // peek preview
    const onLoadLayout = vi.fn();
    const rendered = render(<CloudPanel layout={backendSceneToLayout(scene, { projectId, name: original.name })} onLoadLayout={onLoadLayout} />);
    openProjects(rendered.container);
    await waitFor(() => expect(screen.getByRole('button', { name: /^打开 / })).toBeTruthy());
    queue(other);
    queue({ sessionId: controller.getSnapshot().sessionId, generation: 4, revision: 2, scene: other.scene ?? scene, expiresAt: new Date(Date.now() + 90_000).toISOString() });
    enterListedProject();
    await waitFor(() => expect(onLoadLayout).toHaveBeenCalled());
    expect(new URLSearchParams(window.location.search).get('project')).toBe(otherId);
  });


  it('never labels a local scene preset as saved to the cloud', async () => {
    queue([other]);
    queue([{ id: studioId, name: '工作室', role: 'owner', displayName: 'A' }]);
    queue(other); // 卡片预览
    const layout = { ...backendSceneToLayout(scene), scenePreset: 'popup' as const };
    render(<CloudPanel layout={layout} onLoadLayout={vi.fn()} />);
    openAccount();
    expect(await screen.findByText('当前 · 草稿')).toBeTruthy();
    expect(screen.queryByText(/已保存/)).toBeNull();
    await waitFor(() => expect(mockFetch.mock.calls.length).toBeGreaterThanOrEqual(4));
    expect(controller.getSnapshot().draft).not.toEqual(layout);
  });
  it.each((['open', 'acquire', 'create'] as const).flatMap(action => (['geometry', 'activity', 'nested activity'] as const).map(change => ({action,change}))))('preserves $change edits made while the $action request is pending', async ({action,change}) => {
    const initialLayout = backendSceneToLayout(scene, { projectId, name: original.name });
    const onLoadLayout = vi.fn();
    queue([other]);
    queue([{ id: studioId, name: '工作室', role: 'owner', displayName: 'A' }]);
    queue(other); // peek
    const rendered = render(<CloudPanel layout={initialLayout} onLoadLayout={onLoadLayout} />);
    openProjects(rendered.container);
    await waitFor(() => expect(screen.getByRole('button', { name: /^打开 / }).hasAttribute('disabled')).toBe(false));

    let finish!: (response: Response) => void;
    mockFetch.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    if (action === 'open') enterListedProject();
    else if (action === 'acquire') enterCurrentProject();
    else fireEvent.click(screen.getByRole('button', { name: '新方案' }));
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
    openProjects(rendered.container);
    expect(screen.queryByRole('button', { name: '保存' })).toBeNull();
    expect(screen.queryByText(/已载入最新版本并获得编辑权|已打开云端方案|新项目已保存/)).toBeNull();
    if (action === 'acquire') {
      const lastRequest = mockFetch.mock.calls.at(-1)!;
      expect(String(lastRequest[0])).toContain(`/projects/${projectId}/lease/release`);
    }
  });
});


it('logs in inside the same account dialog and keeps the workspace behind it', async () => {
  queue({ access_token: 'login-access', refresh_token: 'login-refresh', expires_in: 3600, user: { id: 'login-user', email: 'login@example.com' } });
  queue([]);
  queue([]);
  const anonymous = new BackendSession(getBackendConfig({ url: 'https://example.supabase.co', anonKey: 'sb_publishable_test' }));
  const rendered = render(<CloudPanel controller={anonymous} layout={backendSceneToLayout(scene)} onLoadLayout={vi.fn()} />);
  openProjects(rendered.container);
  expect(document.querySelector('dialog')?.hasAttribute('open')).toBe(true);
  expect(screen.getByRole('heading', { name: '欢迎回来' })).toBeTruthy();
  expect(screen.queryByRole('link', { name: '登录' })).toBeNull();
  expect(push).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('邮箱'), { target: { value: 'login@example.com' } });
  fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'a-long-password' } });
  fireEvent.click(screen.getByRole('button', { name: '登录并进入工作台' }));
  await waitFor(() => expect(anonymous.getSnapshot().user?.email).toBe('login@example.com'));
  // 登录成功后浮窗就地变账户中心，不跳整页。
  expect(document.querySelector('dialog')?.hasAttribute('open')).toBe(true);
  expect(screen.queryByLabelText('密码')).toBeNull();
  expect(push).not.toHaveBeenCalled();
  anonymous.dispose();
});

it('opens the login card when the workspace URL asks for login', () => {
  window.history.replaceState(null, '', '/?login=1');
  const anonymous = new BackendSession(getBackendConfig({ url: 'https://example.supabase.co', anonKey: 'sb_publishable_test' }));
  render(<CloudPanel controller={anonymous} layout={backendSceneToLayout(scene)} onLoadLayout={vi.fn()} />);
  expect(document.querySelector('dialog')?.hasAttribute('open')).toBe(true);
  expect(screen.getByRole('heading', { name: '欢迎回来' })).toBeTruthy();
  anonymous.dispose();
});

it('follows a safe next destination after signing in from the modal', async () => {
  window.history.replaceState(null, '', '/?login=1&next=%2Fprojects%3Fview%3Drecent%23saved');
  queue({ access_token: 'next-access', refresh_token: 'next-refresh', expires_in: 3600, user: { id: 'next-user', email: 'next@example.com' } });
  queue([]);
  queue([]);
  const anonymous = new BackendSession(getBackendConfig({ url: 'https://example.supabase.co', anonKey: 'sb_publishable_test' }));
  render(<CloudPanel controller={anonymous} layout={backendSceneToLayout(scene)} onLoadLayout={vi.fn()} />);
  fireEvent.change(screen.getByLabelText('邮箱'), { target: { value: 'next@example.com' } });
  fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'a-long-password' } });
  fireEvent.click(screen.getByRole('button', { name: '登录并进入工作台' }));
  await waitFor(() => expect(replace).toHaveBeenCalledWith('/projects?view=recent#saved'));
  expect(push).not.toHaveBeenCalled();
  anonymous.dispose();
});

it('closes the account dialog when signing out', async () => {
  queue([]);
  queue([]);
  const rendered = render(<CloudPanel controller={controller} layout={backendSceneToLayout(scene)} onLoadLayout={vi.fn()} />);
  openProjects(rendered.container);
  expect(document.querySelector('dialog')?.hasAttribute('open')).toBe(true);
  await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(4));
  queue({});
  fireEvent.click(screen.getByRole('button', { name: '退出登录' }));
  await waitFor(() => expect(controller.getSnapshot().user).toBeNull());
  expect(document.querySelector('dialog')?.hasAttribute('open')).toBe(false);
});

it('filters projects by name and studio and clears an empty search', async () => {
  const secondStudio = '20000000-0000-4000-8000-000000000002';
  queue([original, { ...other, studio_id: secondStudio }]);
  queue([{ id: studioId, name: '一号工作室', role: 'owner', displayName: 'A' }, { id: secondStudio, name: '二号工作室', role: 'editor', displayName: 'A' }]);
  render(<CloudPanel controller={controller} layout={backendSceneToLayout(scene)} onLoadLayout={vi.fn()} />);
  openAccount();
  // 当前工作室里只有已打开的「原云项目」：卡片是当前态，没有「打开」入口。
  await waitFor(() => expect(screen.getByRole('button', { name: /^当前项目 / })).toBeTruthy());
  expect(screen.queryByRole('button', { name: /^打开 / })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '二号工作室' }));
  expect(screen.getAllByRole('button', { name: /^打开 / })).toHaveLength(1);
  expect(screen.getByText('另一个云项目')).toBeTruthy();
  fireEvent.change(screen.getByRole('searchbox', { name: '搜索项目' }), { target: { value: '不存在' } });
  expect(screen.queryByRole('button', { name: /^打开 / })).toBeNull();
  expect(screen.getByText('没有匹配的项目')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '清除筛选' }));
  expect(screen.getAllByRole('button', { name: /^打开 / })).toHaveLength(1);
});

it('returns to the project list when a sidebar team is clicked from 物料 or 团队', async () => {
  const secondStudio = '20000000-0000-4000-8000-000000000002';
  queue([original, { ...other, studio_id: secondStudio }]);
  queue([{ id: studioId, name: '一号工作室', role: 'owner', displayName: 'A' }, { id: secondStudio, name: '二号工作室', role: 'editor', displayName: 'A' }]);
  render(<CloudPanel controller={controller} layout={backendSceneToLayout(scene)} onLoadLayout={vi.fn()} />);
  openAccount('团队与权限');
  expect(await screen.findByRole('region', { name: '团队' })).toBeTruthy();
  expect(screen.getByRole('button', { name: '我的项目' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '一号工作室' }));
  expect(screen.queryByRole('button', { name: '我的项目' })).toBeNull();
  expect(screen.getByRole('region', { name: '我的项目' }).hasAttribute('hidden')).toBe(false);
  openAccount('物料');
  expect(screen.getByRole('button', { name: '我的项目' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '二号工作室' }));
  expect(screen.queryByRole('button', { name: '我的项目' })).toBeNull();
  expect(await screen.findByText('另一个云项目')).toBeTruthy();
});

it('shows the login card instead of fake demo people when signed out', () => {
  const offline = new BackendSession(getBackendConfig({ url: '', anonKey: '' }));
  const load = vi.fn();
  const props = { controller: offline, layout: backendSceneToLayout(scene), onLoadLayout: load };
  const view = render(<CloudPanel {...props} />);
  view.rerender(<CloudPanel {...props} openRequest={{ serial: 1, section: 'team' }} />);
  expect(screen.getByRole('heading', { name: '欢迎回来' })).toBeTruthy();
  expect(screen.getByRole('button', { name: '访客进入' })).toBeTruthy();
  ['林雨舟', '许知夏', '陈知远'].forEach(name => expect(screen.queryByText(name)).toBeNull());
  expect(screen.queryByRole('region', { name: '权限演示空间' })).toBeNull();
  expect(screen.queryByRole('combobox', { name: '预览角色' })).toBeNull();
  expect(load).not.toHaveBeenCalled();
  expect(offline.getSnapshot().user).toBeNull();
  offline.dispose();
});

it('reports a failed project list without claiming the account is empty and allows retry', async () => {
  const list = vi.spyOn(controller, 'listProjects').mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce([other]);
  vi.spyOn(controller, 'listStudios').mockResolvedValue([{ id: studioId, name: '工作室', role: 'owner', displayName: 'A' }]);
  render(<CloudPanel controller={controller} layout={backendSceneToLayout(scene)} onLoadLayout={vi.fn()} />);
  openAccount();
  expect(await screen.findByText('项目加载失败，请点击刷新重试。')).toBeTruthy();
  expect(screen.queryByText('这个工作室还没有项目')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '刷新' }));
  expect(await screen.findByText('另一个云项目')).toBeTruthy();
  expect(list).toHaveBeenCalledTimes(2);
});

describe('CloudPanel source protection before leaving the workspace', () => {
  const message = '演练约定有未保存修改，请先保存或放弃修改。';
  const signOutControl = () => screen.getByRole('button', { name: '退出登录' });

  it('keeps the dialog and live draft when 退出登录 cannot flush, then proceeds once after saving', async () => {
    const scope = 'house-navigation-draft';
    const flush = vi.fn();
    function Draft(): JSX.Element {
      const [value, setValue] = useState('');
      const [saved, setSaved] = useState('');
      useEffect(() => registerSourceFlush(scope, async () => {
        flush();
        if (value !== saved) throw new Error(message);
      }), [value, saved]);
      return <><input aria-label="演练约定名称" value={value} onChange={event => setValue(event.target.value)}/><button type="button" onClick={() => setSaved(value)}>保存演练输入</button></>;
    }
    const signOut = vi.spyOn(controller, 'signOut');
    queue([]); queue([]);
    const view = render(<><Draft/><CloudPanel controller={controller} layout={backendSceneToLayout(scene, { projectId: scope })} onLoadLayout={vi.fn()}/></>);
    try {
      await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(4));
      fireEvent.change(screen.getByRole('textbox', { name: '演练约定名称' }), { target: { value: '演练：保留这份约定输入' } });
      openAccount();
      expect(fireEvent.click(signOutControl())).toBe(true);
      expect(await screen.findByText(message)).toBeTruthy();
      expect(document.querySelector('dialog')?.hasAttribute('open')).toBe(true);
      expect((screen.getByRole('textbox', { name: '演练约定名称' }) as HTMLInputElement).value).toBe('演练：保留这份约定输入');
      expect(push).not.toHaveBeenCalled(); expect(replace).not.toHaveBeenCalled();
      expect(signOut).not.toHaveBeenCalled();
      expect(flush).toHaveBeenCalledOnce();
      fireEvent.click(screen.getByRole('button', { name: '保存演练输入' }));
      queue({});
      const control = signOutControl();
      fireEvent.click(control); fireEvent.click(control);
      await waitFor(() => expect(document.querySelector('dialog')?.hasAttribute('open')).toBe(false));
      expect(flush).toHaveBeenCalledTimes(2);
      expect((screen.getByRole('textbox', { name: '演练约定名称' }) as HTMLInputElement).value).toBe('演练：保留这份约定输入');
      expect(signOut).toHaveBeenCalledOnce();
      expect(push).not.toHaveBeenCalled(); expect(replace).not.toHaveBeenCalled();
    } finally { view.unmount(); }
  });

  it('waits for the actual 退出登录 flush and ignores repeated clicks', async () => {
    const scope = 'house-navigation-pending';
    let finish!: () => void;
    const flush = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
    const unregister = registerSourceFlush(scope, flush);
    const signOut = vi.spyOn(controller, 'signOut');
    queue([]); queue([]);
    const view = render(<CloudPanel controller={controller} layout={backendSceneToLayout(scene, { projectId: scope })} onLoadLayout={vi.fn()}/>);
    try {
      await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(4));
      openAccount();
      const control = signOutControl();
      fireEvent.click(control); fireEvent.click(control);
      await waitFor(() => expect(flush).toHaveBeenCalledOnce());
      expect(document.querySelector('dialog')?.hasAttribute('open')).toBe(true);
      expect(control.hasAttribute('disabled')).toBe(true);
      expect(push).not.toHaveBeenCalled(); expect(replace).not.toHaveBeenCalled(); expect(signOut).not.toHaveBeenCalled();
      queue({});
      await act(async () => { finish(); });
      await waitFor(() => expect(document.querySelector('dialog')?.hasAttribute('open')).toBe(false));
      expect(flush).toHaveBeenCalledOnce();
      expect(signOut).toHaveBeenCalledOnce();
      expect(push).not.toHaveBeenCalled(); expect(replace).not.toHaveBeenCalled();
    } finally { unregister(); view.unmount(); }
  });
});

it('closes the login dialog from the backdrop and leaves clicks inside the card alone', () => {
  const offline = new BackendSession(getBackendConfig({ url: '', anonKey: '' }));
  const props = { controller: offline, layout: backendSceneToLayout(scene), onLoadLayout: vi.fn() };
  const view = render(<CloudPanel {...props} />);
  view.rerender(<CloudPanel {...props} openRequest={{ serial: 1, section: 'team' }} />);
  const dialog = document.querySelector('dialog') as HTMLDialogElement;
  vi.spyOn(dialog, 'getBoundingClientRect').mockReturnValue({
    x: 80, y: 40, top: 40, left: 80, bottom: 640, right: 1120, width: 1040, height: 600, toJSON() { return {}; },
  });
  fireEvent.click(screen.getByRole('heading', { name: '欢迎回来' }), { clientX: 240, clientY: 160 });
  expect(dialog.hasAttribute('open')).toBe(true);
  fireEvent.click(dialog, { clientX: 400, clientY: 200 });
  expect(dialog.hasAttribute('open')).toBe(true);
  fireEvent.click(dialog, { clientX: 12, clientY: 12 });
  expect(dialog.hasAttribute('open')).toBe(false);
  offline.dispose();
});

it('keeps account-panel keys away from canvas shortcuts while preserving native dialog defaults', () => {
  const offline = new BackendSession(getBackendConfig({ url: '', anonKey: '' }));
  render(<CloudPanel controller={offline} layout={backendSceneToLayout(scene)} onLoadLayout={vi.fn()} />);
  openAccount();
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
  const localId='house-scene-connection',local=backendSceneToLayout(scene,{projectId:localId,name:'活动'});
  const state={...controller.getSnapshot(),geometryBinding:{version:1 as const,localActivityId:localId,cloudProjectId:projectId,userId:'user-a',apiUrl:controller.config.apiUrl}};
  vi.spyOn(controller,'getSnapshot').mockReturnValue(state);
  vi.spyOn(controller,'isGeometryBound').mockImplementation(id=>id===localId);
  vi.spyOn(controller,'listProjects').mockResolvedValue([original]);vi.spyOn(controller,'listStudios').mockResolvedValue([{id:studioId,name:'Test studio',role:'owner',displayName:'A'}]);
  const disconnect=vi.spyOn(controller,'disconnectGeometryWorkbench').mockResolvedValue(undefined);
  render(<CloudPanel controller={controller} layout={local} onLoadLayout={vi.fn()}/>);
  openAccount();
  expect(await screen.findByRole('region',{name:'当前活动的场景连接'})).toBeTruthy();
  expect(screen.queryByText('这个工作室还没有项目')).toBeNull();
  expect(screen.queryByText('这里还没有方案')).toBeNull();
  expect(screen.queryByRole('button',{name:'保存'})).toBeNull();
  fireEvent.click(screen.getByRole('button',{name:'断开场景服务'}));await waitFor(()=>expect(disconnect).toHaveBeenCalledOnce());
  expect(local.id).toBe(localId);
});

describe('CloudPanel preferences section', () => {
  it('shows the active unit and measurement switch, forwarding changes', () => {
    const onPreferenceChange = vi.fn();
    const initial = backendSceneToLayout(scene, { projectId, name: original.name });
    render(<CloudPanel controller={controller} layout={initial} onLoadLayout={vi.fn()}
      preferences={{ lengthUnit: 'ft', showMeasurements: false }}
      onPreferenceChange={onPreferenceChange} />);
    fireEvent.click(screen.getByRole('button', { name: '账户中心' }));
    fireEvent.click(screen.getByRole('button', { name: '设置' }));
    expect(screen.getByRole('button', { name: /英尺/ }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: /米/ }).getAttribute('aria-pressed')).toBe('false');
    const checkbox = screen.getByRole('checkbox') as HTMLInputElement;
    expect(checkbox.checked).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: /米/ }));
    expect(onPreferenceChange).toHaveBeenLastCalledWith({ lengthUnit: 'm' });
    fireEvent.click(checkbox);
    expect(onPreferenceChange).toHaveBeenLastCalledWith({ showMeasurements: true });
  });
});

describe('CloudPanel section entry points', () => {
  it('opens 账户中心 from the avatar and follows explicit requests to other sections', () => {
    queue([]);
    queue([{ id: studioId, name: '工作室', role: 'owner', displayName: 'A' }]);
    const initial = backendSceneToLayout(scene, { projectId, name: original.name });
    const props = { controller, layout: initial, onLoadLayout: vi.fn() };
    const { rerender } = render(<CloudPanel {...props}/>);
    fireEvent.click(screen.getByRole('button', { name: '账户中心' }));
    // 默认项目主表面；物料 / 团队在左栏团队下方，退出在三点菜单。
    expect(screen.getByRole('region', { name: '我的项目' })).toBeTruthy();
    expect(screen.getByRole('navigation', { name: '账户分区' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '物料' }));
    expect(screen.getByRole('region', { name: '账户物料' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '物料' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: '我的项目' })).toBeTruthy();
    rerender(<CloudPanel {...props} openRequest={{ serial: 1, section: 'projects' }}/>);
    expect(screen.getByRole('region', { name: '我的项目' })).toBeTruthy();
    rerender(<CloudPanel {...props} openRequest={{ serial: 2, section: 'team' }}/>);
    expect(screen.getByRole('button', { name: '团队与权限' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: '我的项目' })).toBeTruthy();
  });

  it('puts 团队与权限 under the team list instead of a separate settings surface', () => {
    queue([]);
    queue([{ id: studioId, name: '工作室', role: 'owner', displayName: 'A' }]);
    const initial = backendSceneToLayout(scene, { projectId, name: original.name });
    const props = { controller, layout: initial, onLoadLayout: vi.fn() };
    const { rerender } = render(<CloudPanel {...props}/>);
    fireEvent.click(screen.getByRole('button', { name: '账户中心' }));
    expect(screen.getByRole('heading', { name: '账户中心' })).toBeTruthy();
    expect(screen.getByLabelText('更多')).toBeTruthy();
    expect(screen.getByRole('button', { name: '退出登录' })).toBeTruthy();
    expect(screen.getByRole('navigation', { name: '账户分区' }).textContent).toContain('团队与权限');

    rerender(<CloudPanel {...props} openRequest={{ serial: 1, section: 'team' }}/>);
    expect(screen.getByRole('heading', { name: '账户中心' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '关闭设置面板' })).toBeNull();
    expect(screen.getByRole('button', { name: '退出登录' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '我的项目' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '团队与权限' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('region', { name: '团队' })).toBeTruthy();
    expect(screen.queryByRole('region', { name: '权限演示空间' })).toBeNull();
  });

  it('keeps routine draft notes off the project header and only surfaces save errors', async () => {
    queue([original]);
    queue([{ id: studioId, name: '工作室', role: 'owner', displayName: 'A' }]);
    const initial = backendSceneToLayout(scene, { projectId, name: original.name });
    const props = { controller, layout: initial, onLoadLayout: vi.fn(), draftNote: { label: '已保存到本机', error: false } };
    const view = render(<CloudPanel {...props} />);
    fireEvent.click(screen.getByRole('button', { name: '账户中心' }));
    expect(screen.queryByText('已保存到本机')).toBeNull();
    expect(await screen.findByText('当前 · 草稿')).toBeTruthy();
    view.rerender(<CloudPanel {...props} draftNote={{ label: '本机草稿保存失败', error: true, title: '磁盘写入失败' }} />);
    expect(screen.getByText('本机草稿保存失败')).toBeTruthy();
    expect(screen.getByText('当前 · 草稿')).toBeTruthy();
  });
});
