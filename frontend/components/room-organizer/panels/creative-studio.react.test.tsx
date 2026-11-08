// @vitest-environment jsdom

import { Blob as NodeBlob, Buffer as NodeBuffer } from 'node:buffer';
import { webcrypto } from 'node:crypto';
import { act, cleanup, fireEvent, render as renderUI, screen, waitFor, within } from '@testing-library/react';
import {getAgentRun} from './agent-chat-store';
import { StrictMode, useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BackendSession, SceneApiError, getBackendConfig, type BackendSnapshot, type Scene, type SceneProposal, type AgentRun, type AgentRunInput } from '@/lib/backend-session';
import { parseLocalProjectBackupJson, serializeLocalProjectBackup, serializeLocalProjectBackupV3, serializeLocalProjectBackupV4 } from '@/lib/local-project-backup';
import { createLocalWriteLeaseManager, localWriteCapabilityGuard } from '@/lib/local-write-lease';
import { useWorkspaceWriteGuards } from '../lib/workspace-write-guards';
import { createActivitySessionTracker } from '../lib/activity-session-epoch';
import { createFloorSessionTracker,type FloorSessionToken } from '../lib/floor-session-epoch';
import { createLayoutStore, layoutStore } from '../hooks/use-layout-store';
import * as assistantSessions from '../hooks/use-assistant-sessions';
import * as venueSourceRevision from '@/lib/venue-source-revision';
import {createVenueSourceConfirmation} from '@/lib/venue-source-confirmation';
import {createSourceEditorCoordinator} from '@/lib/source-editor-coordinator';
import {prepareLegacyBriefPreservation} from '../lib/legacy-brief';
import { localRestoreAvailable } from '@/lib/local-project-restore';
import * as sourceStorage from '@/lib/source-storage';
import { readMaterialCheckins } from '@/lib/material-checkin-storage';
import * as layoutPersistence from '../lib/persistence';
import { copySourceScope, deleteSourceForm, flushSourceScope, listStoredSources, listSourceRecords, readSourceForm, readSourceRecord, storeSourceForm, updateSourceForm,
  readSourceScopeSnapshot, restoreSourceScopeIfUnchanged, sameSourceScopeSnapshot, type StoredSource, type SourceScopeSnapshot } from '@/lib/source-storage';
import { canonical, sceneHash } from '../../../../supabase/functions/_shared/domain';
import { eventOperationsSchema } from '../../../../supabase/functions/_shared/event-operations-contract';
import { materialCheckinLedgerSchema, mergeMaterialCheckinLedgers } from '../../../../supabase/functions/_shared/material-checkin-contract';
import { productionPlanSchema } from '../../../../supabase/functions/_shared/production-plan-contract';
import { backendSceneToLayout, createMeasuredRoomLayout, layoutToBackendScene } from '../lib/backend-adapter';
import { buildBriefReference, INITIAL_BRIEF } from '../lib/creative-brief';
import {initialBriefMemory} from '../lib/brief-agent';
import {projectDialogueHandoff} from '../lib/dialogue-handoff';
import {bindPendingCandidateRegistry,createPendingCandidateRegistry} from '../lib/pending-candidate-registry';
import {hasBlockingActivityNeeds} from '../lib/activity-need-gate';
import {CandidateInventoryPanel} from './candidate-inventory-panel';
import type {DialogueExportCapture} from './scene-delivery-panel';
import {venueDimensionsMismatch} from '../lib/venue-scale-basis';
import { LOCAL_HANDOFF_CLOUD_MESSAGE, LOCAL_CHECKIN_CLOUD_MESSAGE, LOCAL_RECORDS_READ_MESSAGE } from '../lib/handoff-cloud-guard';
import { ensureGlbAsset } from '../three/glb-assets';
import * as cloudMaterialDraft from '../lib/cloud-material-draft';
import * as sceneDelivery from '../lib/scene-delivery';
import { loadScenePreset } from '../three/scene-presets';
import { CreativeAssistant, CreativeBriefPanel, CreativeStudioProvider, clearUnsentMessageDraftsForTests, useCreativeBrief, useCreativeBriefState, useLocalProjectBackup, useMaterialCheckinState, useStudioAgent, withApplyLock, zeroSeatingShortfall, type BusinessToolsApi, type LocalProjectBackupActions } from './creative-studio';
import { GeneratedModelLibrary } from './generated-model-library';
import { LocalActivitiesPanel } from './local-activities-panel';
import { clearUnsavedSourceDraftsForTests } from './unsaved-source-drafts';
import type { MaterialCustomizationSeed } from './material-customization';
import type { RoomLayout } from '../lib/types';
import type { WorkbenchMode } from '../lib/workbench-mode';

vi.mock('../three/glb-assets', async original => ({ ...(await original<typeof import('../three/glb-assets')>()), ensureGlbAsset: vi.fn().mockResolvedValue(undefined) }));
const { routerPush } = vi.hoisted(() => ({ routerPush: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: routerPush }) }));
vi.mock('../three/scene-presets', () => ({ loadScenePreset: vi.fn() }));
vi.mock('../contexts', () => ({ useSelection: () => ({ allSelectedIds: new Set<string>(), selectedItem: null }) }));
const sourceMocks = vi.hoisted(() => ({ readSourceForm: vi.fn(), readSourceRecord: vi.fn(), readSourceRecordSnapshot: vi.fn(), listSourceRecords: vi.fn().mockResolvedValue([]), updateSourceForm: vi.fn(), storeSourceForm: vi.fn(), deleteSourceForm: vi.fn(), copySourceScope: vi.fn(), listStoredSources: vi.fn(), readSourceScopeSnapshot: vi.fn(), restoreSourceScopeIfUnchanged: vi.fn() }));
vi.mock('@/lib/source-storage', async original => ({ ...(await original<typeof import('@/lib/source-storage')>()), ...sourceMocks }));
vi.mock('@/lib/material-checkin-storage', async original => {
  const actual = await original<typeof import('@/lib/material-checkin-storage')>();
  return { ...actual,
    readMaterialCheckins: async (id: string) => actual.checkedMaterialCheckins(id, await sourceMocks.readSourceRecord(actual.materialCheckinStorageKey(id))),
    mergeStoredMaterialCheckins: async (id: string, incoming: Parameters<typeof actual.mergeStoredMaterialCheckins>[1], beforeWrite = () => {}, capability?: Parameters<typeof actual.mergeStoredMaterialCheckins>[3]) => {
      const proposal = actual.checkedMaterialCheckins(id, incoming);
      if (!proposal) throw new Error('没有可保存的点验记录');
      const guard = capability ? localWriteCapabilityGuard(capability) : undefined;
      return sourceMocks.updateSourceForm(actual.materialCheckinStorageKey(id), (value: unknown) => {
        guard?.assertStillHeld(); beforeWrite();
        const current = actual.checkedMaterialCheckins(id, value);
        return current ? mergeMaterialCheckinLedgers(current, proposal) : proposal;
      }, guard);
    },
  };
});
let materialProps: { seed?: MaterialCustomizationSeed; layout: RoomLayout; onApply(next:RoomLayout):void };
vi.mock('./material-customization', () => ({ MaterialCustomization: (props: typeof materialProps) => { materialProps=props;return <output data-testid="material-seed">{JSON.stringify(props.seed ?? null)}</output>; } }));

const projectId = '10000000-0000-4000-8000-000000000001';
const scene: Scene = {
  schemaVersion: 1,
  venue: { width: 12, depth: 10, height: 3, shape: 'rectangle', entrances: [] },
  objects: [], camera: 'overview', lighting: 'warm',
};
const candidate: Scene = {
  ...scene,
  objects: [{ id: '20000000-0000-4000-8000-000000000001', materialId: 'chair', position: { x: 3, z: 4 }, rotation: 0, size: { width: 0.5, depth: 0.5, height: 0.9 }, color: '#ddc8a2', locked: false, notes: '' }],
};
const proposal: SceneProposal = {
  id: '30000000-0000-4000-8000-000000000001', project_id: projectId, session_id: '40000000-0000-4000-8000-000000000001', user_id: 'test-user',
  generation: 1, base_revision: 1, local_revision: 0, base_hash: 'a'.repeat(64), base_scene: scene, candidate,
  expires_at: '2099-01-01T00:00:00Z', applied_at: null, explanation: '增加一把椅子，保留中心通道。', warnings: [],
};
let controller: BackendSession;
let snapshot: BackendSnapshot;
let layout: RoomLayout;
const prepareProposal=vi.fn<(input:AgentRunInput)=>Promise<SceneProposal>>();
function runFrom(value:SceneProposal,input?:AgentRunInput):AgentRun {return {id:'60000000-0000-4000-8000-000000000001',projectId,requestId:input?.requestId??'70000000-0000-4000-8000-000000000001',state:'complete',progress:'完成',callCount:1,candidates:[{label:'A',title:'交流区',proposal:value}],evaluation:null,executionMode:input?.executionMode??'preview',jevEnabled:input?.jevEnabled??false,expiresAt:value.expires_at};}
const onApply = vi.fn<(next: RoomLayout) => void>();
const onPreview = vi.fn<(next: RoomLayout | null) => void>();
const createBitmap = vi.fn();
const createObjectURL = vi.fn();
const revokeObjectURL = vi.fn();
const forbiddenFetch = vi.fn(() => { throw new Error('This UI test must never access the network.'); });
const originalCreateObjectURL = Object.getOwnPropertyDescriptor(URL, 'createObjectURL');
const originalRevokeObjectURL = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL');
const originalScrollTo = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollTo');
const originalLocks = Object.getOwnPropertyDescriptor(navigator, 'locks');

function mockBrowserLocks(): void {
  const held=new Set<string>();
  Object.defineProperty(navigator,'locks',{ configurable:true, value:{
    async request(name:string,_options:LockOptions,callback:(lock:Lock|null)=>Promise<unknown>) {
      if(held.has(name))return callback(null);
      held.add(name);
      try{return await callback({name,mode:'exclusive'} as Lock);}finally{held.delete(name);}
    },
  } });
}

function restoreProperty(object: object, key: string, descriptor: PropertyDescriptor | undefined): void {
  if (descriptor) Object.defineProperty(object, key, descriptor);
  else Reflect.deleteProperty(object, key);
}

function ui(current = layout) {
  return <CreativeStudioProvider controller={controller} layout={current} onApply={onApply} onPreview={onPreview}>
    <CreativeAssistant/>
  </CreativeStudioProvider>;
}

function SecondaryConfirm() {
  const studio=useStudioAgent();
  return studio?.preview ? <button type="button" onClick={()=>void studio.applyPreview()}>左侧确认</button> : null;
}

function InventoryReviewProbe({available,invalidInput=false}:{available:number;invalidInput?:boolean}) {
  const studio=useStudioAgent();
  if(!studio?.preview)return null;
  return <button type="button" onClick={()=>{
    const preview=studio.preview!,item=preview.layout.floors.flatMap(floor=>floor.items).find(value=>value.type==='chair')!;
    const identity=item.assetId?{kind:'asset_id' as const,value:item.assetId}:item.materialId?{kind:'material_id' as const,value:item.materialId}:{kind:'type' as const,value:item.type};
    studio.setCandidateInventory(preview,{origin:'user_reported',entries:[{identity,dimensions:{width:item.width,depth:item.depth,height:item.height},available,name:'椅子'}],...(invalidInput?{invalidInput:true}:{})},'legacy',null);
  }}>核对数量</button>;
}
function RemountInventoryProbe() {
  const studio=useStudioAgent(),[open,setOpen]=useState(true),preview=studio?.preview;
  return <><button type="button" onClick={()=>setOpen(value=>!value)}>切换数量面板</button>{open&&preview&&<CandidateInventoryPanel candidate={preview.layout} scope="legacy" initialInventory={studio.getBoundCandidateInventory(preview)} onChange={value=>{studio.setCandidateInventory(preview,value,'legacy',null);}}/>}</>;
}
function CandidateSwitchProbe() {
  const studio=useStudioAgent();
  return studio?.preview?<button type="button" onClick={()=>{studio.selectCandidate('B');studio.selectCandidate('A');}}>切换候选后返回</button>:null;
}
function RememberAndSwitchInventoryProbe({invalidInput=false}:{invalidInput?:boolean}) {
  const studio=useStudioAgent();
  return studio?.preview?<button type="button" onClick={()=>{
    const candidate=studio.preview!.layout,item=candidate.floors.flatMap(floor=>floor.items).find(value=>!!value.assetId)!;
    const identity=item.assetId?{kind:'asset_id' as const,value:item.assetId}:item.materialId?{kind:'material_id' as const,value:item.materialId}:{kind:'type' as const,value:item.type};
    const dimensions={width:item.width,depth:item.depth,height:item.height},scope=`activity:${candidate.id}`;
    studio.rememberSessionInventory(candidate,{origin:'user_reported',entries:[{identity,dimensions,available:invalidInput?10:0,name:'椅子'}]},scope,'chat-a');
    if(invalidInput){const key=JSON.stringify([identity.kind,identity.value,dimensions.width,dimensions.depth,dimensions.height]);studio.rememberSessionInventory(candidate,{origin:'user_reported',entries:[],invalidInput:true,invalidInputValues:{[key]:'-1'}},scope,'chat-a');}
    studio.selectCandidate('B');
  }}>记住数量并换方案</button>:null;
}
function sharedAssetCandidates() {
  const assetId='50000000-0000-4000-8000-000000000001';
  const first={...proposal,candidate:{...candidate,objects:candidate.objects.map(item=>({...item,materialId:'asset' as const,assetId}))}};
  const other={...first,id:'30000000-0000-4000-8000-000000000002',candidate:{...first.candidate,objects:first.candidate.objects.map(item=>({...item,position:{x:5,z:4}}))}};
  return {first,other};
}

function IntentGenerationProbe() {
  const studio = useStudioAgent();
  return <button type="button" onClick={() => void studio?.generate('生成一版')}>测试生成</button>;
}

function CloudMaterialDraftProbe({done,failed}:{done:()=>void;failed:(error:unknown)=>void}) {
  const studio=useStudioAgent();
  return <button type="button" onClick={()=>void studio?.exportCloudMaterialDraft().then(done,failed)}>导出测试草案</button>;
}

function DeliveryShortcutTrial({ current = layout, operations = false }: { current?: RoomLayout; operations?: boolean }) {
  const [request, setRequest] = useState(0);
  const entry = useRef<HTMLButtonElement>(null);
  return <CreativeStudioProvider controller={controller} layout={current} onApply={onApply} onUpdateEventOperations={operations?()=>{}:undefined}>
    <button ref={entry} type="button" onClick={() => setRequest(value => value + 1)}>打开执行工作单</button>
    <CreativeAssistant deliveryOpenRequest={request} deliveryEntryRef={entry}/>
  </CreativeStudioProvider>;
}

function DockedTrial({ current = layout, generator, commercialPanel, onWorkspace, onConversation, onTemplates, operations = false, localSaveError = false, workbenchMode, reviewOpenRequest, deliveryOpenRequest }: {
  current?: RoomLayout; generator?: ReactNode; commercialPanel?: ReactNode; onWorkspace?: (visible: boolean) => void; onConversation?: (visible: boolean) => void; onTemplates?:()=>void; operations?: boolean; localSaveError?: boolean; workbenchMode?: WorkbenchMode; reviewOpenRequest?: number; deliveryOpenRequest?: number;
}) {
  const host = useRef<HTMLDivElement>(null), referenceEntry = useRef<HTMLButtonElement>(null), conversationEntry = useRef<HTMLButtonElement>(null);
  const workspaceEntry = useRef<HTMLButtonElement>(null), toolsEntry = useRef<HTMLButtonElement>(null);
  const [workspaceVisible, setWorkspaceVisible] = useState(false), [referenceRequest, setReferenceRequest] = useState(0);
  const [toolsRequest, setToolsRequest] = useState(0), [workspaceRequest, setWorkspaceRequest] = useState(0);
  const briefApi = useRef<BusinessToolsApi | null>(null);
  const [conversationCloseRequest, setConversationCloseRequest] = useState(0), [conversationOpenRequest, setConversationOpenRequest] = useState(0);
  const workspaceChanged = useCallback((visible: boolean) => { setWorkspaceVisible(visible); onWorkspace?.(visible); }, [onWorkspace]);
  const conversationChanged = useCallback((visible: boolean) => { onConversation?.(visible); }, [onConversation]);
  return <CreativeStudioProvider controller={controller} layout={current} onApply={onApply} onPreview={onPreview} onUpdateEventOperations={operations?()=>{}:undefined}>
    <button ref={toolsEntry} onClick={() => setToolsRequest(value => value + 1)}>素材</button>
    <button ref={workspaceEntry} onClick={() => setWorkspaceRequest(value => value + 1)}>资料</button>
    <button ref={conversationEntry} onClick={() => setConversationOpenRequest(value => value + 1)}>助手</button>
    <button ref={referenceEntry} onClick={() => setReferenceRequest(value => value + 1)}>外部图纸核对</button>
    <button onClick={() => setConversationCloseRequest(value => value + 1)}>外部收起聊天</button>
    <div data-testid="docked-business-host" ref={host} hidden={!workspaceVisible}/>
    <CreativeAssistant docked businessHostRef={host} generationPanel={generator} commercialPanel={commercialPanel} toolsApiRef={briefApi}
      {...(onTemplates?{onOpenTemplates:onTemplates}:{})}
      {...(workbenchMode?{workbenchMode,workbenchModeSerial:1}:{workbenchModeSerial:0})}
      {...(reviewOpenRequest?{reviewOpenRequest}:{})}
      {...(deliveryOpenRequest?{deliveryOpenRequest}:{})}
      workspaceEntryRef={workspaceEntry}
      workspaceOpenRequest={workspaceRequest}
      toolsOpenRequest={toolsRequest} toolsEntryRef={toolsEntry}
      referenceOpenRequest={referenceRequest} referenceEntryRef={referenceEntry}
      conversationCloseRequest={conversationCloseRequest}
      conversationOpenRequest={conversationOpenRequest} conversationEntryRef={conversationEntry}
      localSaveError={localSaveError}
      onWorkspaceVisibilityChange={workspaceChanged} onConversationVisibilityChange={conversationChanged}/>
  </CreativeStudioProvider>;
}

describe('docked workspace integration', () => {
  beforeEach(() => { vi.stubGlobal('innerWidth', 1440); });
  it('opens the shared shelf template destination and resumes the same unsaved activity form',async()=>{
    const onTemplates=vi.fn();
    renderUI(<DockedTrial onTemplates={onTemplates}/>);await act(async()=>{});
    fireEvent.click(screen.getByRole('button',{name:'资料'}));
    const demand=screen.getByRole('textbox',{name:'客户需求'}) as HTMLTextAreaElement;
    fireEvent.change(demand,{target:{value:'独立演练：尚未保存的活动说明'}});
    selectBusiness('场景模板');
    expect(onTemplates).toHaveBeenCalledOnce();
    expect(screen.queryByRole('region',{name:'场景模板资源'})).toBeNull();
    expect(screen.queryByRole('button',{name:'返回素材'})).toBeNull();
    expect(screen.queryByRole('button',{name:'返回当前工作区'})).toBeNull();
    expect(screen.getByTestId('docked-business-host').hidden).toBe(true);
    fireEvent.click(screen.getByRole('button',{name:'资料'}));
    expect(screen.getByRole('textbox',{name:'客户需求'})).toBe(demand);
    expect(demand.value).toBe('独立演练：尚未保存的活动说明');
    expect((screen.getByRole('combobox',{name:/布置工具|资料分类/}) as HTMLSelectElement).value).toBe('brief');
    expect(onApply).not.toHaveBeenCalled();expect(controller.startAgentRun).not.toHaveBeenCalled();
  });
  it('[compact navigation] keeps every old destination in the business area and removes the chat button grid',async()=>{
    renderUI(<DockedTrial/>);await act(async()=>{});
    expect(document.querySelector('.cr-docked-tools')).toBeNull();
    expect(screen.queryByRole('combobox',{name:/布置工具|资料分类/})).toBeNull();
    fireEvent.click(screen.getByRole('button',{name:'完善活动需求'}));
    const categories=screen.getByRole('combobox',{name:/布置工具|资料分类/}) as HTMLSelectElement;
    expect(Array.from(categories.options).filter(option=>!option.hidden).map(option=>option.text)).toEqual(['活动需求','图纸与照片','场地重建','场景模板','物料工具','更多…']);
    expect(screen.getByTestId('docked-business-host').contains(categories)).toBe(true);
    const input=screen.getByRole('textbox',{name:'客户需求'});input.focus();fireEvent.keyDown(input,{key:'Escape'});
    await waitFor(()=>expect(document.activeElement).toBe(screen.getByRole('button',{name:'完善活动需求'})));
    expect(controller.startAgentRun).not.toHaveBeenCalled();expect(onApply).not.toHaveBeenCalled();
  });

  it('[new project suggestions] opens real preparation screens without changing either chat draft or scope',async()=>{
    renderUI(<DockedTrial/>);await act(async()=>{});
    const suggestions=screen.getByRole('region',{name:'成果建议'});
    expect(within(suggestions).getAllByRole('button')).toHaveLength(3);
    for(const name of ['完善活动需求','准备场地图纸'])expect(within(suggestions).getByRole('button',{name})).toBeTruthy();
    expect(screen.getByText('活动需求、客户方案与执行资料可以先在本机整理。需要 AI 布置或物料候选时，再连接场景服务。')).toBeTruthy();
    const composer=screen.getByRole('textbox',{name:'告诉助手你的想法'}) as HTMLTextAreaElement;
    fireEvent.change(composer,{target:{value:'未发送的策划草稿'}});selectMode('model');
    fireEvent.change(composer,{target:{value:'未发送的物料草稿'}});
    fireEvent.click(screen.getByRole('button',{name:'完善活动需求'}));
    expect(screen.getByRole('textbox',{name:'客户需求'})).toBeTruthy();
    fireEvent.click(screen.getByRole('button',{name:'返回素材'}));
    fireEvent.click(screen.getByRole('button',{name:'准备场地图纸'}));
    expect(document.activeElement?.getAttribute('aria-label')).toBe('图纸与场地对应核对');
    expect(composer.value).toBe('未发送的物料草稿');
    expect((screen.getByRole('combobox',{name:'工作模式'}) as HTMLSelectElement).value).toBe('model');
    selectMode('plan');expect(composer.value).toBe('未发送的策划草稿');
    expect(controller.startAgentRun).not.toHaveBeenCalled();expect(onApply).not.toHaveBeenCalled();
  });

  it('[ready project suggestions] shows only existing outputs once a saved brief, drawing, items and tasks are present',async()=>{
    vi.mocked(readSourceForm).mockImplementation(async key=>key===`${projectId}:brief`?{...INITIAL_BRIEF,description:'假设演练：保留入口通道'}:undefined);
    vi.mocked(listStoredSources).mockResolvedValue([{id:'drawing',scope:projectId,name:'假设演练图纸',kind:'floorplan',width:1024,height:768,blob:new Blob(['drawing'],{type:'image/png'})}]);
    const operations=eventOperationsSchema.parse({dataKind:'rehearsal',tasks:[{id:'c0a00000-0000-4000-8000-000000000111',title:'假设演练布场',phase:'setup'}]});
    const prepared={...backendSceneToLayout(candidate,{projectId,name:'假设演练'}),eventOperations:operations};
    renderUI(<DockedTrial current={prepared}/>);await act(async()=>{});
    const suggestions=screen.getByRole('region',{name:'成果建议'});
    expect(within(suggestions).getAllByRole('button')).toHaveLength(4);
    for(const name of ['整理执行时间表','核对物料交接','准备客户方案'])expect(within(suggestions).getByRole('button',{name})).toBeTruthy();
    fireEvent.click(screen.getByRole('button',{name:'整理执行时间表'}));
    expect(screen.getByRole('group',{name:'执行工作单'})).toBeTruthy();
    expect(screen.getByRole('tab',{name:'活动安排'}).getAttribute('aria-selected')).toBe('true');
    fireEvent.click(screen.getByRole('button',{name:'核对物料交接'}));
    expect(screen.getByRole('group',{name:'执行工作单'})).toBeTruthy();
    expect(screen.getByRole('tab',{name:'物料工作单'}).getAttribute('aria-selected')).toBe('true');
    fireEvent.click(screen.getByRole('button',{name:'整理执行时间表'}));
    expect(screen.getByRole('tab',{name:'活动安排'}).getAttribute('aria-selected')).toBe('true');
    fireEvent.click(screen.getByRole('button',{name:'准备客户方案'}));
    expect(screen.getByRole('region',{name:'客户评审包'})).toBeTruthy();
    expect(screen.queryByTitle('客户评审预览')).toBeNull();
    expect(controller.startAgentRun).not.toHaveBeenCalled();expect(onApply).not.toHaveBeenCalled();
    expect(document.querySelector('a[download]')).toBeNull();
  });

  it('[suggestions after conversation] hides suggestions after sending and lets users reopen them without sending another request',async()=>{
    connected();vi.mocked(controller.startAgentRun).mockResolvedValueOnce(runFrom(proposal));
    renderUI(<DockedTrial/>);await act(async()=>{});
    const composer=screen.getByRole('textbox',{name:'告诉助手你的想法'}) as HTMLTextAreaElement;
    fireEvent.change(composer,{target:{value:'先预览椅子布置'}});fireEvent.click(screen.getByRole('button',{name:'发送消息'}));
    await screen.findByText('方案提案 · 尚未应用');
    expect(screen.queryByRole('region',{name:'成果建议'})).toBeNull();
    const confirm=screen.getByRole('button',{name:'确认布置'});
    fireEvent.change(composer,{target:{value:'下一条未发送输入'}});
    fireEvent.click(screen.getByRole('button',{name:'查看建议'}));
    expect(within(screen.getByRole('region',{name:'成果建议'})).getAllByRole('button').length).toBeLessThanOrEqual(4);
    fireEvent.click(screen.getByRole('button',{name:'准备场地图纸'}));
    expect(composer.value).toBe('下一条未发送输入');expect(screen.getByRole('button',{name:'确认布置'})).toBe(confirm);
    expect(controller.startAgentRun).toHaveBeenCalledOnce();expect(onApply).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button',{name:'关闭成果建议'}));expect(screen.queryByRole('region',{name:'成果建议'})).toBeNull();
  });

  it('[suggestion scope reset] starts the next activity with its own preparation suggestions and default execution tab',async()=>{
    const current=backendSceneToLayout(candidate,{projectId,name:'假设演练A'});
    const view=renderUI(<DockedTrial current={current} operations/>);await act(async()=>{});
    fireEvent.click(screen.getByRole('button',{name:'核对物料交接'}));
    expect(screen.getByRole('tab',{name:'物料工作单'}).getAttribute('aria-selected')).toBe('true');
    view.rerender(<DockedTrial current={{...layout,id:'suggestion-activity-B',name:'假设演练B'}} operations/>);await act(async()=>{});
    expect((screen.getByRole('combobox',{name:/布置工具|资料分类/}) as HTMLSelectElement).value).toBe('brief');
    expect(screen.queryByRole('button',{name:'核对物料交接'})).toBeNull();
    const suggestions=screen.getByRole('region',{name:'成果建议'});
    expect(within(suggestions).getAllByRole('button')).toHaveLength(3);
    for(const name of ['完善活动需求','准备场地图纸'])expect(within(suggestions).getByRole('button',{name})).toBeTruthy();
    selectBusiness('执行资料');
    expect(screen.getByRole('tab',{name:'活动安排'}).getAttribute('aria-selected')).toBe('true');
    expect(controller.startAgentRun).not.toHaveBeenCalled();expect(onApply).not.toHaveBeenCalled();
  });

  it('[chat independence] keeps model scope and its sendable draft through every business destination', async () => {
    connected(); vi.mocked(controller.startAgentRun).mockResolvedValueOnce(runFrom(proposal));
    renderUI(<DockedTrial/>); await act(async () => {});
    const composer = screen.getByRole('textbox', { name: '告诉助手你的想法' }) as HTMLTextAreaElement;
    fireEvent.change(composer, { target: { value: '原策划草稿' } });
    selectMode('model');
    const instruction = '生成一把宽0.5米的椅子，保留其他物件';
    fireEvent.change(composer, { target: { value: instruction } });
    for (const name of ['活动需求', '图纸与照片', '场地重建', '物料工具', '执行资料', '方案评审', '场景模板']) {
      selectBusiness(name);
      expect((screen.getByRole('combobox', { name: '工作模式' }) as HTMLSelectElement).value).toBe('model');
      expect(screen.getByRole('textbox', { name: '告诉助手你的想法' })).toBe(composer);
      expect(composer.value).toBe(instruction);
      expect((screen.getByRole('button', { name: '发送消息' }) as HTMLButtonElement).disabled).toBe(false);
    }
    fireEvent.click(screen.getByRole('button', { name: '发送消息' }));
    await screen.findByText('方案提案 · 尚未应用');
    const request = vi.mocked(controller.startAgentRun).mock.calls[0]![0];
    expect(request.instruction).toContain('仅创建或调整本次请求指定的物料');
    expect(request.executionMode).toBe('preview'); expect(controller.startAgentRun).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: '返回当前工作区' }));
    selectMode('plan'); expect(composer.value).toBe('原策划草稿');
    expect(onApply).not.toHaveBeenCalled();
  });

  it('[composer settings] keeps one associated form, real settings and IME protection through two Escape presses', async () => {
    connected(); let finish!: (run: AgentRun) => void;
    vi.mocked(controller.startAgentRun).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    renderUI(<DockedTrial/>); await act(async () => {});
    const composer = screen.getByRole('textbox', { name: '告诉助手你的想法' }) as HTMLTextAreaElement;
    const mode = screen.getByRole('combobox', { name: '工作模式' }) as HTMLSelectElement;
    const submit = screen.getByRole('button', { name: '发送消息' }) as HTMLButtonElement;
    const launcher = screen.getByRole('button', { name: '助手' });
    expect(document.querySelectorAll('#creative-message')).toHaveLength(1);
    expect(document.querySelectorAll('#creative-work-mode')).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: '助手' })).toHaveLength(1);
    expect(document.querySelector('.cr-assistant-capsule')).toBeNull();
    expect(composer.form).not.toBeNull(); expect(mode.form).toBe(composer.form); expect(submit.form).toBe(composer.form);
    const settings = screen.getByLabelText('助手设置'); fireEvent.click(settings);
    const details = settings.closest('details')!;
    const jev = screen.getByRole('checkbox', { name: 'JEV 决策模式' }) as HTMLInputElement;
    expect(screen.queryByRole('checkbox', { name: '明确指令直接应用' })).toBeNull();expect(jev.form).toBe(composer.form);
    expect(jev.checked).toBe(false);
    fireEvent.click(jev); expect(jev.checked).toBe(true);
    fireEvent.click(jev); expect(jev.checked).toBe(false);
    fireEvent.change(composer, { target: { value: '仍在输入法组合中' } });
    fireEvent.keyDown(composer, { key: 'Enter', isComposing: true });
    expect(controller.startAgentRun).not.toHaveBeenCalled(); expect(composer.value).toBe('仍在输入法组合中');
    jev.focus(); fireEvent.keyDown(jev, { key: 'Escape' });
    expect(details.open).toBe(false); expect(document.activeElement).toBe(settings);
    expect(screen.getByRole('textbox', { name: '告诉助手你的想法' })).toBe(composer);
    fireEvent.keyDown(settings, { key: 'Escape' });
    expect(screen.queryByRole('textbox', { name: '告诉助手你的想法' })).toBeNull();
    expect(screen.getByRole('button', { name: '助手' })).toBe(launcher);
    fireEvent.click(launcher);
    expect(screen.getByRole('textbox', { name: '告诉助手你的想法' })).toBe(composer); expect(composer.value).toBe('仍在输入法组合中');
    fireEvent.click(submit); await waitFor(() => expect(controller.startAgentRun).toHaveBeenCalledOnce());
    fireEvent.click(settings);
    expect(jev.checked).toBe(false);expect(jev.disabled).toBe(true);
    expect(vi.mocked(controller.startAgentRun).mock.calls[0]![0]).toMatchObject({ executionMode: 'preview', jevEnabled: false });
    await act(async () => finish(runFrom(proposal))); await screen.findByText('方案提案 · 尚未应用');
    expect(onApply).not.toHaveBeenCalled();
  });

  it('[business Escape] closes each focused Portal destination without closing chat or consuming a nested handled Escape', async () => {
    renderUI(<DockedTrial/>); await act(async () => {});
    selectMode('model');
    const host = screen.getByTestId('docked-business-host');
    const composer = screen.getByRole('textbox', { name: '告诉助手你的想法' });
    for (const name of ['活动需求', '图纸与照片', '场地重建', '物料工具', '执行资料', '方案评审', '场景模板']) {
      const entry = screen.getByRole('button', { name: '外部图纸核对' }); fireEvent.click(entry); selectBusiness(name);
      const target = name === '活动需求' ? screen.getByRole('textbox', { name: '客户需求' })
        : name === '执行资料' ? screen.getByRole('group', { name: '执行工作单' })
          : name === '物料工具' ? screen.getByRole('button', { name: '材质调整' })
          : name === '场景模板' ? screen.getByRole('button', { name: '返回当前工作区' })
          : name === '方案评审' ? screen.getByRole('group', { name: '当前方案评审' })
          : name === '场地重建' ? host.querySelector<HTMLElement>('[aria-label="场地重建与候选确认"]')!
          : host.querySelector<HTMLElement>('[aria-label="图纸与场地对应核对"]')!;
      target.focus(); fireEvent.keyDown(target, { key: 'Escape', cancelable: true });
      await waitFor(() => expect(host.hidden).toBe(true));
      await waitFor(() => expect(document.activeElement).toBe(entry));
      expect(screen.getByRole('textbox', { name: '告诉助手你的想法' })).toBe(composer);
    }
    const entry = screen.getByRole('button', { name: '外部图纸核对' }); fireEvent.click(entry); selectBusiness('活动需求');
    const demand = screen.getByRole('textbox', { name: '客户需求' });
    const consume = (event: Event) => event.preventDefault(); demand.addEventListener('keydown', consume);
    fireEvent.keyDown(demand, { key: 'Escape', cancelable: true });
    expect(host.hidden).toBe(false); expect(screen.getByRole('textbox', { name: '客户需求' })).toBe(demand);
    demand.removeEventListener('keydown', consume);
    fireEvent.keyDown(demand, { key: 'Escape', cancelable: true });
    await waitFor(() => expect(host.hidden).toBe(true));
    expect(screen.getByRole('textbox', { name: '告诉助手你的想法' })).toBe(composer);
  });

  it('keeps business and generator nodes in a stable host while changing tools, templates and chat visibility', async () => {
    const mounted = vi.fn();
    function Generator() {
      const [value, setValue] = useState(''); useEffect(() => { mounted(); }, []);
      return <input aria-label="停靠测试模型描述" value={value} onChange={event => setValue(event.target.value)}/>;
    }
    renderUI(<DockedTrial generator={<Generator/>}/>); await act(async () => {});
    const host = screen.getByTestId('docked-business-host');
    expect(host.querySelector('[aria-label="客户需求"]')).toBeNull();
    expect(host.querySelector('.rc-panel')).toBeNull(); expect(mounted).not.toHaveBeenCalled();
    const composer = screen.getByRole('textbox', { name: '告诉助手你的想法' }) as HTMLTextAreaElement;
    expect(screen.queryByRole('textbox', { name: '客户需求' })).toBeNull();
    expect(host.hidden).toBe(true);
    fireEvent.change(composer, { target: { value: '停靠策划草稿' } });
    selectBusiness('活动需求');
    const demand = screen.getByRole('textbox', { name: '客户需求' }) as HTMLTextAreaElement;
    expect(document.activeElement).toBe(demand);
    expect(host.contains(demand)).toBe(true); expect(host.contains(composer)).toBe(false);
    fireEvent.change(demand, { target: { value: '保留原需求文字' } });
    selectMode('model');
    selectBusiness('物料工具');
    const model = screen.getByRole('textbox', { name: '停靠测试模型描述' });
    fireEvent.change(model, { target: { value: '模型字段保留' } });
    expect((screen.getByRole('combobox', { name: '工作模式' }) as HTMLSelectElement).value).toBe('model');
    fireEvent.click(screen.getByRole('button', { name: '关闭聊天' }));
    expect(screen.queryByRole('textbox', { name: '告诉助手你的想法' })).toBeNull();
    expect(screen.getByRole('textbox', { name: '停靠测试模型描述' })).toBe(model);
    fireEvent.click(screen.getByRole('button', { name: '助手' }));
    expect(screen.getByRole('textbox', { name: '告诉助手你的想法' })).toBe(composer);
    selectBusiness('场景模板');
    expect(host.contains(screen.getAllByRole('button', { name: /载入模板/ })[0])).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '返回当前工作区' }));
    expect(screen.getByRole('textbox', { name: '停靠测试模型描述' })).toBe(model);
    expect((model as HTMLInputElement).value).toBe('模型字段保留'); expect(mounted).toHaveBeenCalledOnce();
    selectMode('plan'); expect(composer.value).toBe('停靠策划草稿');
    selectBusiness('活动需求');
    expect(screen.getByRole('textbox', { name: '客户需求' })).toBe(demand); expect(demand.value).toBe('保留原需求文字');
    selectBusiness('图纸与照片');
    const measures = screen.getByRole('textbox', { name: '场地尺寸' }) as HTMLTextAreaElement;
    await waitFor(() => expect(measures.disabled).toBe(false));
    fireEvent.change(measures, { target: { value: '总宽 12 米，总深 8 米' } });
    selectBusiness('场地重建');
    expect(host.querySelector('[aria-label="图纸尺寸与原图核对"]')).toBeNull();
    expect(host.querySelector('[aria-label="场地重建与候选确认"]')).not.toBeNull();
    selectBusiness('图纸与照片');
    expect((screen.getByRole('textbox', { name: '场地尺寸' }) as HTMLTextAreaElement).value).toBe('总宽 12 米，总深 8 米');
    expect(document.querySelectorAll('#creative-message')).toHaveLength(1);
    expect(controller.startAgentRun).not.toHaveBeenCalled(); expect(onApply).not.toHaveBeenCalled();
  });


  it('clears both chat drafts when the project scope changes without remounting the host composer', async () => {
    const value = renderUI(<DockedTrial/>); await act(async () => {});
    const composer = screen.getByRole('textbox', { name: '告诉助手你的想法' }) as HTMLTextAreaElement;
    fireEvent.change(composer, { target: { value: '项目A策划草稿' } });
    selectMode('model'); fireEvent.change(composer, { target: { value: '项目A建模草稿' } });
    value.rerender(<DockedTrial current={{ ...layout, id: 'docked-project-B', name: '项目B' }}/>);
    expect((screen.getByRole('combobox', { name: '工作模式' }) as HTMLSelectElement).value).toBe('plan');
    expect(screen.getByRole('textbox', { name: '告诉助手你的想法' })).toBe(composer); expect(composer.value).toBe('');
    selectMode('model'); expect(composer.value).toBe(''); expect(controller.startAgentRun).not.toHaveBeenCalled();
  });

  it.each([390, 768])('[narrow chat scopes] retains visible chat and both drafts when only the range changes at %s px', async width => {
    vi.stubGlobal('innerWidth', width);
    renderUI(<DockedTrial/>); await act(async () => {});
    if (!screen.queryByRole('textbox', { name: '告诉助手你的想法' })) fireEvent.click(screen.getByRole('button', { name: '助手' }));
    const composer = screen.getByRole('textbox', { name: '告诉助手你的想法' }) as HTMLTextAreaElement;
    const host = screen.getByTestId('docked-business-host');
    fireEvent.change(composer, { target: { value: '窄屏策划草稿' } });
    selectMode('model');
    expect(screen.getByRole('textbox', { name: '告诉助手你的想法' })).toBe(composer); expect(host.hidden).toBe(true);
    fireEvent.change(composer, { target: { value: '窄屏建模草稿' } });
    selectMode('plan'); expect(composer.value).toBe('窄屏策划草稿');
    selectMode('model'); expect(composer.value).toBe('窄屏建模草稿');
    expect(screen.getByRole('textbox', { name: '告诉助手你的想法' })).toBe(composer); expect(host.hidden).toBe(true);
    expect(controller.startAgentRun).not.toHaveBeenCalled(); expect(onApply).not.toHaveBeenCalled();
  });

  it('keeps a pending proposal discoverable and reopens the same confirmation without dispatching a second task', async () => {
    connected(); vi.mocked(controller.startAgentRun).mockResolvedValueOnce(runFrom(proposal));
    renderUI(<DockedTrial/>); await act(async () => {});
    fireEvent.change(screen.getByRole('textbox', { name: '告诉助手你的想法' }), { target: { value: '先给候选，再确认应用' } });
    fireEvent.click(screen.getByRole('button', { name: '发送消息' })); await screen.findByText('方案提案 · 尚未应用');
    const confirm = screen.getByRole('button', { name: '确认布置' });
    fireEvent.click(screen.getByRole('button', { name: '外部收起聊天' }));
    expect(screen.queryByRole('button', { name: '确认布置' })).toBeNull();
    const launch = screen.getByRole('button', { name: '助手' });
    expect(screen.getByRole('status').textContent).toBe('有方案待确认');
    expect(screen.getByRole('status').getAttribute('aria-live')).toBe('polite');
    expect(document.querySelector('.cr-docked-pending')).toBeNull();
    fireEvent.click(launch);
    expect(screen.getByRole('button', { name: '确认布置' })).toBe(confirm);
    expect(controller.startAgentRun).toHaveBeenCalledOnce(); expect(onApply).not.toHaveBeenCalled();
  });

  it('opens reference and completed backup destinations in the left host and focuses their existing content', async () => {
    const delivery = await import('./scene-delivery-panel'); let restored: (() => void) | undefined;
    const Original = delivery.SceneDeliveryPanel;
    vi.spyOn(delivery, 'SceneDeliveryPanel').mockImplementation(props => { restored = props.onBackupRestored; return <Original {...props}/>; });
    renderUI(<DockedTrial/>); await act(async () => {});
    fireEvent.click(screen.getByRole('button', { name: '外部图纸核对' }));
    const host = screen.getByTestId('docked-business-host');
    const reference = host.querySelector<HTMLElement>('[aria-label="图纸与场地对应核对"]')!;
    expect(document.activeElement).toBe(reference); expect(host.hidden).toBe(false);
    expect(host.querySelector('[aria-label="图纸尺寸与原图核对"]')).not.toBeNull();
    selectBusiness('场地重建');
    expect(host.querySelector('.rc-inputs')).not.toBeNull();
    selectBusiness('执行资料');
    expect(host.contains(screen.getByRole('group', { name: '执行工作单' }))).toBe(true);
    selectBusiness('活动需求');
    act(() => restored?.());
    const destination = screen.getByRole('group', { name: '执行工作单' });
    expect(host.contains(destination)).toBe(true); expect(document.activeElement).toBe(destination);
    expect((screen.getByRole('combobox', { name: '工作模式' }) as HTMLSelectElement).value).toBe('plan');
    expect(screen.getByRole('textbox', { name: '告诉助手你的想法' })).toBeTruthy();
    expect(onApply).not.toHaveBeenCalled(); expect(controller.startAgentRun).not.toHaveBeenCalled();
  });

  it('starts mobile with chat closed and keeps reference fields and conversation mutually exclusive', async () => {
    vi.stubGlobal('innerWidth', 390);
    const conversation = vi.fn(), workspace = vi.fn();
    renderUI(<DockedTrial onWorkspace={workspace} onConversation={conversation}/>); await act(async () => {});
    expect(screen.queryByRole('textbox', { name: '告诉助手你的想法' })).toBeNull();
    expect(screen.queryByRole('textbox', { name: '客户需求' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '外部图纸核对' }));
    const reference = screen.getByTestId('docked-business-host').querySelector<HTMLElement>('[aria-label="图纸与场地对应核对"]')!;
    expect(reference.closest('[hidden]')).toBeNull(); expect(document.activeElement).toBe(reference);
    expect(screen.queryByRole('textbox', { name: '告诉助手你的想法' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '助手' }));
    expect(screen.getByRole('textbox', { name: '告诉助手你的想法' })).toBeTruthy();
    expect(screen.queryByRole('textbox', { name: '客户需求' })).toBeNull();
    expect(workspace).toHaveBeenLastCalledWith(false); expect(conversation).toHaveBeenLastCalledWith(true);
    fireEvent.click(screen.getByRole('button', { name: '关闭聊天' }));
    expect(screen.queryByRole('textbox', { name: '告诉助手你的想法' })).toBeNull();
    expect(conversation).toHaveBeenLastCalledWith(false);
    const referenceEntry = screen.getByRole('button', { name: '外部图纸核对' });
    fireEvent.click(referenceEntry);
    fireEvent.click(screen.getByRole('button', { name: '返回素材' }));
    expect(screen.queryByRole('textbox', { name: '客户需求' })).toBeNull();
    expect(workspace).toHaveBeenLastCalledWith(false);
    await waitFor(() => expect(document.activeElement).toBe(referenceEntry));
    expect(controller.startAgentRun).not.toHaveBeenCalled();
  });
});

describe('workspace navigation continuity', () => {
  it('[commercial category] adds the supplied destination without mounting it until first open', async () => {
    vi.stubGlobal('innerWidth', 1440);
    const mounted = vi.fn();
    function CommercialNode() { useEffect(() => { mounted(); }, []); return <input aria-label="演练约定名称"/>; }
    renderUI(<DockedTrial commercialPanel={<CommercialNode/>}/>); await act(async () => {});
    expect(mounted).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '资料' }));
    const categories = screen.getByRole('combobox', { name: /布置工具|资料分类/ }) as HTMLSelectElement;
    expect(Array.from(categories.options).filter(option => !option.hidden).map(option => option.text)).toEqual(['活动需求', '图纸与照片', '场地重建', '场景模板', '物料工具', '更多…']);
    expect(mounted).not.toHaveBeenCalled();
    selectBusiness('图纸与照片'); expect(mounted).not.toHaveBeenCalled();
    selectBusiness('合同与约定'); expect(mounted).toHaveBeenCalledOnce();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('group', { name: '合同与约定资料' })));
    expect(document.querySelector<HTMLElement>('#agent-panel-plan')?.hidden).toBe(true);
    expect(controller.startAgentRun).not.toHaveBeenCalled(); expect(onApply).not.toHaveBeenCalled();
  });

  it('[commercial continuity] keeps the same unsaved node and source protection through categories, shelf, close and parent view rerender', async () => {
    vi.stubGlobal('innerWidth', 1440);
    const mounted = vi.fn(), unmounted = vi.fn(), onTemplates = vi.fn();
    function CommercialNode() {
      const [value, setValue] = useState(''), valueRef = useRef(value); valueRef.current = value;
      useEffect(() => { mounted(); return () => { unmounted(); }; }, []);
      useEffect(() => sourceStorage.registerSourceFlush(projectId, async () => { if (valueRef.current) throw new Error('演练约定有未保存修改'); }), []);
      return <input aria-label="演练约定名称" value={value} onChange={event => setValue(event.target.value)}/>;
    }
    const view = renderUI(<DockedTrial commercialPanel={<CommercialNode/>} onTemplates={onTemplates}/>); await act(async () => {});
    const dataEntry = screen.getByRole('button', { name: '资料' }), toolsEntry = screen.getByRole('button', { name: '素材' });
    fireEvent.click(dataEntry); selectBusiness('合同与约定');
    const input = screen.getByRole('textbox', { name: '演练约定名称' }) as HTMLInputElement;
    const target = screen.getByRole('group', { name: '合同与约定资料' });
    fireEvent.change(input, { target: { value: '演练：尚未保存的约定' } });
    for (const name of ['活动需求', '图纸与照片', '场地重建', '执行资料', '方案评审', '物料工具']) {
      selectBusiness(name); expect(screen.queryByRole('textbox', { name: '演练约定名称' })).toBeNull();
      await expect(flushSourceScope(projectId)).rejects.toThrow('演练约定有未保存修改');
      selectBusiness('合同与约定'); expect(screen.getByRole('textbox', { name: '演练约定名称' })).toBe(input);
    }
    selectBusiness('场景模板'); expect(onTemplates).toHaveBeenCalledOnce();
    expect(screen.getByTestId('docked-business-host').hidden).toBe(true);
    await expect(flushSourceScope(projectId)).rejects.toThrow('演练约定有未保存修改');
    fireEvent.click(dataEntry);
    expect((screen.getByRole('combobox', { name: /布置工具|资料分类/ }) as HTMLSelectElement).value).toBe('more');
    await waitFor(() => expect(document.activeElement).toBe(target));
    act(() => { toolsEntry.focus(); }); fireEvent.click(toolsEntry);
    expect(screen.getByTestId('docked-business-host').hidden).toBe(true);
    view.rerender(<DockedTrial current={{ ...layout, backendCamera: 'top' }} commercialPanel={<CommercialNode/>} onTemplates={onTemplates}/>); await act(async () => {});
    view.rerender(<DockedTrial current={{ ...layout, backendCamera: 'overview' }} commercialPanel={<CommercialNode/>} onTemplates={onTemplates}/>); await act(async () => {});
    await expect(flushSourceScope(projectId)).rejects.toThrow('演练约定有未保存修改');
    fireEvent.click(dataEntry);
    expect(screen.getByRole('textbox', { name: '演练约定名称' })).toBe(input); expect(input.value).toBe('演练：尚未保存的约定');
    await waitFor(() => expect(document.activeElement).toBe(target));
    act(() => { input.focus(); }); fireEvent.keyDown(input, { key: 'Escape', cancelable: true });
    await waitFor(() => expect(document.activeElement).toBe(dataEntry));
    expect(screen.getByTestId('docked-business-host').hidden).toBe(true);
    await expect(flushSourceScope(projectId)).rejects.toThrow('演练约定有未保存修改');
    fireEvent.click(dataEntry); await waitFor(() => expect(document.activeElement).toBe(target));
    expect(screen.getByRole('textbox', { name: '演练约定名称' })).toBe(input);
    expect(mounted).toHaveBeenCalledOnce(); expect(unmounted).not.toHaveBeenCalled();
    expect(controller.startAgentRun).not.toHaveBeenCalled(); expect(onApply).not.toHaveBeenCalled();
  });

  it.each([1440, 390])('[commercial chat separation] preserves both drafts and model mode while returning data focus at %s px', async width => {
    vi.stubGlobal('innerWidth', width);
    renderUI(<DockedTrial commercialPanel={<input aria-label="演练约定名称"/>}/>); await act(async () => {});
    const chatEntry = screen.getByRole('button', { name: '助手' }), dataEntry = screen.getByRole('button', { name: '资料' });
    if (!screen.queryByRole('textbox', { name: '告诉助手你的想法' })) fireEvent.click(chatEntry);
    const composer = screen.getByRole('textbox', { name: '告诉助手你的想法' }) as HTMLTextAreaElement;
    fireEvent.change(composer, { target: { value: '演练：未发送的策划草稿' } }); selectMode('model');
    fireEvent.change(composer, { target: { value: '演练：未发送的物料草稿' } });
    fireEvent.click(dataEntry); selectBusiness('合同与约定');
    const target = screen.getByRole('group', { name: '合同与约定资料' });
    await waitFor(() => expect(document.activeElement).toBe(target));
    fireEvent.keyDown(target, { key: 'Escape', cancelable: true });
    await waitFor(() => expect(document.activeElement).toBe(dataEntry));
    fireEvent.click(dataEntry); await waitFor(() => expect(document.activeElement).toBe(target));
    expect((screen.getByRole('combobox', { name: /布置工具|资料分类/ }) as HTMLSelectElement).value).toBe('more');
    fireEvent.click(chatEntry);
    expect((screen.getByRole('combobox', { name: '工作模式' }) as HTMLSelectElement).value).toBe('model');
    expect(screen.getByRole('textbox', { name: '告诉助手你的想法' })).toBe(composer); expect(composer.value).toBe('演练：未发送的物料草稿');
    selectMode('plan'); expect(composer.value).toBe('演练：未发送的策划草稿');
    fireEvent.click(dataEntry); await waitFor(() => expect(document.activeElement).toBe(target));
    expect(controller.startAgentRun).not.toHaveBeenCalled(); expect(onApply).not.toHaveBeenCalled();
  });

  it.each(['执行资料', '图纸与照片'] as const)('[repeat data entry] restores %s after materials without resetting fields or dispatching', async destination => {
    vi.stubGlobal('innerWidth', 1440);
    renderUI(<DockedTrial operations/>); await act(async () => {});
    const dataEntry = screen.getByRole('button', { name: '资料' }), toolsEntry = screen.getByRole('button', { name: '素材' });
    fireEvent.click(dataEntry);
    const demand = screen.getByRole('textbox', { name: '客户需求' }) as HTMLTextAreaElement;
    await waitFor(() => expect(document.activeElement).toBe(demand));
    fireEvent.change(demand, { target: { value: '演练：资料返回时保留原需求。' } });
    selectBusiness(destination);
    const host = screen.getByTestId('docked-business-host');
    const target = destination === '执行资料' ? screen.getByRole('group', { name: '执行工作单' }) : host.querySelector<HTMLElement>('[aria-label="图纸与场地对应核对"]')!;
    await waitFor(() => expect(document.activeElement).toBe(target));
    act(() => { toolsEntry.focus(); }); fireEvent.click(toolsEntry); expect(host.hidden).toBe(true);
    fireEvent.click(dataEntry);
    expect((screen.getByRole('combobox', { name: /布置工具|资料分类/ }) as HTMLSelectElement).value).toBe(destination === '执行资料' ? 'delivery' : 'reference');
    expect(host.contains(target)).toBe(true); await waitFor(() => expect(document.activeElement).toBe(target));
    selectBusiness('活动需求');
    const restored = screen.getByRole('textbox', { name: '客户需求' }) as HTMLTextAreaElement;
    if (destination === '执行资料') expect(restored).toBe(demand);
    expect(restored.value).toBe('演练：资料返回时保留原需求。');
    expect(controller.startAgentRun).not.toHaveBeenCalled(); expect(onApply).not.toHaveBeenCalled();
  });

  it.each([1440, 390])('[materials entry] hides business and naturally closes narrow chat while preserving the same proposal and both drafts at %s px', async width => {
    vi.stubGlobal('innerWidth', width); connected(); vi.mocked(controller.startAgentRun).mockResolvedValueOnce(runFrom(proposal));
    renderUI(<DockedTrial/>); await act(async () => {});
    const chatEntry = screen.getByRole('button', { name: '助手' });
    if (!screen.queryByRole('textbox', { name: '告诉助手你的想法' })) fireEvent.click(chatEntry);
    const composer = screen.getByRole('textbox', { name: '告诉助手你的想法' }) as HTMLTextAreaElement;
    fireEvent.change(composer, { target: { value: '演练：先预览一个椅子方案' } }); fireEvent.click(screen.getByRole('button', { name: '发送消息' }));
    await screen.findByText('方案提案 · 尚未应用'); const confirm = screen.getByRole('button', { name: '确认布置' });
    fireEvent.change(composer, { target: { value: '演练：素材切换前的策划草稿' } }); selectMode('model');
    fireEvent.change(composer, { target: { value: '演练：素材切换前的物料草稿' } });
    const dataEntry = screen.getByRole('button', { name: '资料' }), toolsEntry = screen.getByRole('button', { name: '素材' });
    fireEvent.click(dataEntry); expect(screen.getByTestId('docked-business-host').hidden).toBe(false);
    fireEvent.click(chatEntry);
    await waitFor(() => expect(document.activeElement).toBe(composer));
    act(() => { toolsEntry.focus(); }); fireEvent.click(toolsEntry); await act(async () => {});
    expect(screen.getByTestId('docked-business-host').hidden).toBe(true); expect(document.activeElement).toBe(toolsEntry);
    if (width === 390) expect(screen.queryByRole('textbox', { name: '告诉助手你的想法' })).toBeNull();
    else expect(screen.getByRole('textbox', { name: '告诉助手你的想法' })).toBe(composer);
    fireEvent.click(dataEntry); fireEvent.click(chatEntry);
    expect(screen.getByRole('textbox', { name: '告诉助手你的想法' })).toBe(composer); expect(composer.value).toBe('演练：素材切换前的物料草稿');
    expect((screen.getByRole('combobox', { name: '工作模式' }) as HTMLSelectElement).value).toBe('model');
    expect(screen.getByRole('button', { name: '确认布置' })).toBe(confirm);
    selectMode('plan'); expect(composer.value).toBe('演练：素材切换前的策划草稿');
    expect(controller.startAgentRun).toHaveBeenCalledOnce(); expect(controller.applySceneProposal).not.toHaveBeenCalled(); expect(onApply).not.toHaveBeenCalled();
  });

  it('[materials source protection] keeps an unsaved review registered while hidden and resumes its fields and focus from data', async () => {
    vi.stubGlobal('innerWidth', 1440);
    renderUI(<DockedTrial/>); await act(async () => {});
    const dataEntry = screen.getByRole('button', { name: '资料' }), toolsEntry = screen.getByRole('button', { name: '素材' });
    fireEvent.click(dataEntry); selectBusiness('方案评审');
    const review = screen.getByRole('group', { name: '当前方案评审' });
    fireEvent.click(screen.getByText('草稿与文件'));
    await waitFor(() => expect(screen.getByRole('button', { name: '保存说明草稿' }).hasAttribute('disabled')).toBe(false));
    const summary = screen.getByLabelText('简短方案说明（选填）') as HTMLTextAreaElement;
    fireEvent.change(summary, { target: { value: '演练：素材页往返仍未保存的方案说明。' } });
    act(() => { toolsEntry.focus(); }); fireEvent.click(toolsEntry); expect(screen.getByTestId('docked-business-host').hidden).toBe(true);
    await act(async () => { await expect(flushSourceScope(projectId)).rejects.toThrow('评审说明有未保存修改'); });
    fireEvent.click(dataEntry);
    expect((screen.getByRole('combobox', { name: /布置工具|资料分类/ }) as HTMLSelectElement).value).toBe('review');
    expect(screen.getByLabelText('简短方案说明（选填）')).toBe(summary); expect(summary.value).toBe('演练：素材页往返仍未保存的方案说明。');
    await waitFor(() => expect(document.activeElement).toBe(review));
    expect(controller.startAgentRun).not.toHaveBeenCalled(); expect(onApply).not.toHaveBeenCalled();
  });
});

describe('top assistant entry', () => {
  it.each([1440, 390])('[external assistant entry] opens from the top and returns focus after X and Escape at %s px', async width => {
    vi.stubGlobal('innerWidth', width);
    renderUI(<DockedTrial/>); await act(async () => {});
    const entry = screen.getByRole('button', { name: '助手' });
    const entryRect = new DOMRect(0, 0, 44, 40);
    const visibleRects: DOMRectList = Object.assign([entryRect], { item: (index: number) => index === 0 ? entryRect : null });
    const hiddenRects: DOMRectList = Object.assign([] as DOMRect[], { item: () => null });
    let entryVisible = true;
    vi.spyOn(entry, 'getClientRects').mockImplementation(() => entryVisible ? visibleRects : hiddenRects);
    const entryFocus = vi.spyOn(entry, 'focus');
    const nativeRequestFrame = globalThis.requestAnimationFrame, nativeCancelFrame = globalThis.cancelAnimationFrame;
    const frames = new Map<number, FrameRequestCallback>(); let nextFrame = 0;
    const flushFrame = async () => { await act(async () => {
      const currentFrames = Array.from(frames); frames.clear();
      for (const [id, callback] of currentFrames) callback(id * 16);
    }); };
    if (width === 390) {
      vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { const id = ++nextFrame; frames.set(id, callback); return id; });
      vi.stubGlobal('cancelAnimationFrame', (id: number) => { frames.delete(id); });
    }
    if (screen.queryByRole('textbox', { name: '告诉助手你的想法' })) {
      expect(document.querySelector('.cr-assistant-capsule')).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: '关闭聊天' }));
      await waitFor(() => expect(document.activeElement).toBe(entry));
    }
    const capsule = screen.getByRole('button', { name: '打开 Bingo Agent' });
    expect(capsule.classList.contains('cr-assistant-capsule')).toBe(true); expect(capsule.textContent).toBe('Bingo');
    expect(capsule.querySelector('img')?.getAttribute('src')).toBe('/assets/assistant/qingguang-3d-24@2x.png');
    fireEvent.click(entry);
    expect(document.querySelector('.cr-assistant-capsule')).toBeNull();
    const composer = screen.getByRole('textbox', { name: '告诉助手你的想法' }) as HTMLTextAreaElement;
    await waitFor(() => expect(document.activeElement).toBe(composer));
    fireEvent.change(composer, { target: { value: '演练：顶部入口策划草稿' } }); selectMode('model');
    fireEvent.change(composer, { target: { value: '演练：顶部入口物料草稿' } });
    const close = screen.getByRole('button', { name: '关闭聊天' });
    if (width === 390) { entryVisible = false; entryFocus.mockClear(); }
    act(() => { close.focus(); }); fireEvent.click(close);
    expect(screen.queryByRole('textbox', { name: '告诉助手你的想法' })).toBeNull();
    expect(screen.getByRole('button', { name: '打开 Bingo Agent' }).classList.contains('cr-assistant-capsule')).toBe(true);
    if (width === 390) {
      await flushFrame(); expect(entryFocus).not.toHaveBeenCalled(); expect(document.activeElement).not.toBe(entry);
      expect(frames.size).toBeGreaterThan(0);
      entryVisible = true; await flushFrame(); expect(document.activeElement).toBe(entry); expect(frames.size).toBe(0);
    } else await waitFor(() => expect(document.activeElement).toBe(entry));
    fireEvent.click(screen.getByRole('button', { name: '打开 Bingo Agent' }));
    expect(document.querySelector('.cr-assistant-capsule')).toBeNull();
    expect(screen.getByRole('textbox', { name: '告诉助手你的想法' })).toBe(composer); expect(composer.value).toBe('演练：顶部入口物料草稿');
    expect((screen.getByRole('combobox', { name: '工作模式' }) as HTMLSelectElement).value).toBe('model');
    if (width === 390) { entryVisible = false; entryFocus.mockClear(); }
    act(() => { composer.focus(); }); fireEvent.keyDown(composer, { key: 'Escape', cancelable: true });
    expect(screen.queryByRole('textbox', { name: '告诉助手你的想法' })).toBeNull();
    expect(screen.getByRole('button', { name: '打开 Bingo Agent' }).classList.contains('cr-assistant-capsule')).toBe(true);
    if (width === 390) {
      await flushFrame(); expect(entryFocus).not.toHaveBeenCalled(); expect(frames.size).toBeGreaterThan(0);
      entryVisible = true; fireEvent.click(entry);
      expect(frames.size).toBe(0); await flushFrame();
      expect(entryFocus).not.toHaveBeenCalled(); expect(document.activeElement).toBe(composer);
      expect(screen.getByRole('textbox', { name: '告诉助手你的想法' })).toBe(composer); expect(composer.value).toBe('演练：顶部入口物料草稿');
      expect((screen.getByRole('combobox', { name: '工作模式' }) as HTMLSelectElement).value).toBe('model');
      fireEvent.keyDown(composer, { key: 'Escape', cancelable: true });
      const workEntry = screen.getByRole('button', { name: '外部图纸核对' });
      vi.spyOn(workEntry, 'getClientRects').mockReturnValue(visibleRects);
      act(() => { workEntry.focus(); }); await flushFrame();
      expect(document.activeElement).toBe(workEntry); expect(entryFocus).not.toHaveBeenCalled(); expect(frames.size).toBe(0);
      vi.stubGlobal('requestAnimationFrame', nativeRequestFrame); vi.stubGlobal('cancelAnimationFrame', nativeCancelFrame);
    } else await waitFor(() => expect(document.activeElement).toBe(entry));
    fireEvent.click(entry); expect(document.querySelector('.cr-assistant-capsule')).toBeNull();
    selectMode('plan'); expect(composer.value).toBe('演练：顶部入口策划草稿');
    expect(controller.startAgentRun).not.toHaveBeenCalled(); expect(onApply).not.toHaveBeenCalled();
  });

  it.each([false, true])('[closed assistant capsule] keeps the dog and Bingo entry only while closed without an external button (docked=%s)', async docked => {
    vi.stubGlobal('innerWidth', 390);
    renderUI(<CreativeStudioProvider controller={controller} layout={layout} onApply={onApply}><CreativeAssistant docked={docked}/></CreativeStudioProvider>);
    await act(async () => {});
    const entry = screen.getByRole('button', { name: '打开 Bingo Agent' });
    expect(entry.classList.contains('cr-assistant-capsule')).toBe(true); expect(entry.textContent).toBe('Bingo');
    expect(entry.querySelector('img')?.getAttribute('src')).toBe('/assets/assistant/qingguang-3d-24@2x.png');
    expect(entry.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(entry);
    expect(screen.queryByRole('button', { name: '打开 Bingo Agent' })).toBeNull();
    expect(screen.queryByRole('button', { name: '关闭 Bingo Agent' })).toBeNull();
    expect(document.querySelector('.cr-assistant-capsule')).toBeNull();
    const composer = screen.getByRole('textbox', { name: '告诉助手你的想法' }) as HTMLTextAreaElement;
    fireEvent.change(composer, { target: { value: '演练：简单入口保留草稿' } });
    fireEvent.click(screen.getByRole('button', { name: docked ? '关闭聊天' : '关闭 Agent' }));
    expect(screen.getByRole('button', { name: '打开 Bingo Agent' }).textContent).toBe('Bingo');
    fireEvent.click(screen.getByRole('button', { name: '打开 Bingo Agent' }));
    expect(document.querySelector('.cr-assistant-capsule')).toBeNull();
    expect(screen.getByRole('textbox', { name: '告诉助手你的想法' })).toBe(composer); expect(composer.value).toBe('演练：简单入口保留草稿');
    expect(controller.startAgentRun).not.toHaveBeenCalled(); expect(onApply).not.toHaveBeenCalled();
  });

  it('[dismissible outcome card] follows the welcome, closes and reopens without changing drafts or mode', async () => {
    vi.stubGlobal('innerWidth', 1440);
    renderUI(<DockedTrial/>); await act(async () => {});
    const composer = screen.getByRole('textbox', { name: '告诉助手你的想法' }) as HTMLTextAreaElement;
    fireEvent.change(composer, { target: { value: '演练：成果卡策划草稿' } }); selectMode('model');
    fireEvent.change(composer, { target: { value: '演练：成果卡物料草稿' } });
    const card = screen.getByRole('region', { name: '成果建议' });
    expect(within(card).getByText('想先处理哪一项？')).toBeTruthy();
    expect(within(card).getAllByRole('button')).toHaveLength(3);
    const welcome = screen.getByText('活动需求、客户方案与执行资料可以先在本机整理。需要 AI 布置或物料候选时，再连接场景服务。');
    expect(welcome.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
    const close = within(card).getByRole('button', { name: '关闭成果建议' });
    act(() => { close.focus(); }); fireEvent.click(close);
    expect(screen.queryByRole('region', { name: '成果建议' })).toBeNull();
    expect(screen.getByRole('textbox', { name: '告诉助手你的想法' })).toBe(composer); expect(composer.value).toBe('演练：成果卡物料草稿');
    const restore = screen.getByRole('button', { name: '查看建议' });
    await waitFor(() => expect(document.activeElement).toBe(restore));
    fireEvent.click(restore);
    const restoredCard = screen.getByRole('region', { name: '成果建议' });
    await waitFor(() => expect(document.activeElement).toBe(restoredCard));
    fireEvent.click(within(restoredCard).getByRole('button', { name: '完善活动需求' }));
    expect(screen.getByRole('textbox', { name: '客户需求' })).toBeTruthy();
    expect(composer.value).toBe('演练：成果卡物料草稿');
    expect((screen.getByRole('combobox', { name: '工作模式' }) as HTMLSelectElement).value).toBe('model');
    selectMode('plan'); expect(composer.value).toBe('演练：成果卡策划草稿');
    expect(controller.startAgentRun).not.toHaveBeenCalled(); expect(onApply).not.toHaveBeenCalled();
  });

  it('[closed assistant status] announces actual work and reopens the same confirmation through the external entry', async () => {
    vi.stubGlobal('innerWidth', 390); connected();
    let finish!: (run: AgentRun) => void;
    vi.mocked(controller.startAgentRun).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const view = renderUI(<DockedTrial/>); await act(async () => {});
    const assistant = view.container.querySelector('.cr-assistant') as HTMLElement;
    expect(within(assistant).queryByRole('status')).toBeNull();
    const entry = screen.getByRole('button', { name: '助手' }); fireEvent.click(entry);
    const composer = screen.getByRole('textbox', { name: '告诉助手你的想法' });
    fireEvent.change(composer, { target: { value: '演练：保留待确认椅子方案' } }); fireEvent.click(screen.getByRole('button', { name: '发送消息' }));
    await waitFor(() => expect(controller.startAgentRun).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByRole('button', { name: '关闭聊天' }));
    const status = within(assistant).getByRole('status');
    expect(status.textContent).toBe('正在提交任务…'); expect(status.getAttribute('aria-live')).toBe('polite');
    expect(status.classList.contains('sr-only')).toBe(true); expect(document.querySelector('.cr-docked-pending')).toBeNull();
    await act(async () => { finish(runFrom(proposal)); });
    expect(within(assistant).getByRole('status')).toBe(status); expect(status.textContent).toBe('有方案待确认');
    expect(screen.queryByRole('button', { name: '确认布置' })).toBeNull();
    fireEvent.click(entry);
    const confirm = screen.getByRole('button', { name: '确认布置' });
    expect(within(assistant).queryByRole('status')).toBeNull(); expect(screen.getByRole('textbox', { name: '告诉助手你的想法' })).toBe(composer);
    fireEvent.click(screen.getByRole('button', { name: '关闭聊天' }));
    expect(within(assistant).getByRole('status').textContent).toBe('有方案待确认'); fireEvent.click(entry);
    expect(within(assistant).queryByRole('status')).toBeNull(); expect(screen.getByRole('button', { name: '确认布置' })).toBe(confirm);
    expect(controller.startAgentRun).toHaveBeenCalledOnce(); expect(onApply).not.toHaveBeenCalled();
  });

  it('[assistant save error] restores project context after the alert without changing mode or input', async () => {
    vi.stubGlobal('innerWidth', 1440);
    const view = renderUI(<DockedTrial/>); await act(async () => {});
    const composer = screen.getByRole('textbox', { name: '告诉助手你的想法' }) as HTMLTextAreaElement;
    selectMode('model'); fireEvent.change(composer, { target: { value: '演练：保存失败仍保留输入' } });
    const caption = document.querySelector('.cr-header-brand small')!;
    const context = caption.textContent; expect(context).toContain('单件物料'); expect(context).toContain(layout.name);
    expect(screen.queryByText('本机保存失败，请导出备份')).toBeNull();
    view.rerender(<DockedTrial localSaveError/>); await act(async () => {});
    expect(screen.getByRole('alert').textContent).toBe('本机保存失败，请导出备份');
    expect(screen.getByRole('textbox', { name: '告诉助手你的想法' })).toBe(composer); expect(composer.value).toBe('演练：保存失败仍保留输入');
    expect((screen.getByRole('combobox', { name: '工作模式' }) as HTMLSelectElement).value).toBe('model');
    view.rerender(<DockedTrial localSaveError={false}/>); await act(async () => {});
    expect(screen.queryByText('本机保存失败，请导出备份')).toBeNull(); expect(caption.textContent).toBe(context);
    expect(composer.value).toBe('演练：保存失败仍保留输入'); expect(controller.startAgentRun).not.toHaveBeenCalled(); expect(onApply).not.toHaveBeenCalled();
  });
});

describe('direct local delivery shortcut', () => {
  it('[reference integration] opens the original planning review panel and returns focus without remounting or losing drafts', async () => {
    function Trial() {
      const [request, setRequest] = useState(0), entry = useRef<HTMLButtonElement>(null);
      return <CreativeStudioProvider controller={controller} layout={layout} onApply={onApply}>
        <button ref={entry} onClick={() => setRequest(value => value + 1)}>核对参考底图</button>
        <CreativeAssistant referenceOpenRequest={request} referenceEntryRef={entry}/>
      </CreativeStudioProvider>;
    }
    const rendered = renderUI(<Trial/>);
    fireEvent.click(screen.getByRole('button', { name: '打开 Bingo Agent' }));
    await act(async () => {});
    fireEvent.change(screen.getByRole('textbox', { name: '告诉助手你的想法' }), { target: { value: '未发送策划草稿' } });
    selectBusiness('图纸与照片');
    const originalPanel = rendered.container.querySelector('.rc-panel'), originalComposer = screen.getByRole('textbox', { name: '告诉助手你的想法' });
    selectMode('model');
    fireEvent.change(originalComposer, { target: { value: '未发送建模草稿' } });
    fireEvent.click(screen.getByRole('button', { name: '关闭 Agent' }));
    const entry = screen.getByRole('button', { name: '核对参考底图' }); fireEvent.click(entry);
    const review = rendered.container.querySelector<HTMLElement>('[aria-label="图纸与场地对应核对"]')!;
    expect((screen.getByRole('combobox', { name: '工作模式' }) as HTMLSelectElement).value).toBe('model');
    expect(document.activeElement).toBe(review);
    expect(rendered.container.querySelector('[aria-label="图纸尺寸与原图核对"]')).not.toBeNull();
    expect(rendered.container.querySelector('[aria-label="场地重建与候选确认"]')).toBeNull();
    expect(rendered.container.querySelector('.rc-panel')).toBe(originalPanel);
    expect(screen.getByRole('textbox', { name: '告诉助手你的想法' })).toBe(originalComposer);
    expect((originalComposer as HTMLTextAreaElement).value).toBe('未发送建模草稿');
    expect(rendered.container.querySelectorAll('#creative-message')).toHaveLength(1);
    selectMode('plan'); expect((originalComposer as HTMLTextAreaElement).value).toBe('未发送策划草稿');
    selectMode('model'); expect((originalComposer as HTMLTextAreaElement).value).toBe('未发送建模草稿');
    fireEvent.click(screen.getByRole('button', { name: '关闭 Agent' })); expect(document.activeElement).toBe(entry);
    expect(onApply).not.toHaveBeenCalled(); expect(controller.startAgentRun).not.toHaveBeenCalled();
  });

  it('preserves the explicit restore destination when its completion runs before the scope reset effect',async()=>{
    const delivery=await import('./scene-delivery-panel');const Original=delivery.SceneDeliveryPanel;
    const restoredId='restored-before-scope-effect';const completed=vi.fn();
    vi.spyOn(delivery,'SceneDeliveryPanel').mockImplementation(props=>{
      const handled=useRef(false);
      useLayoutEffect(()=>{
        if(props.layout.id===restoredId&&!handled.current){handled.current=true;completed();props.onBackupRestored?.();}
      },[props.layout.id,props.onBackupRestored]);
      return <Original {...props}/>;
    });
    const view=renderUI(ui());fireEvent.click(screen.getByRole('button',{name:'打开 Bingo Agent'}));
    fireEvent.change(screen.getByRole('textbox',{name:'告诉助手你的想法'}),{target:{value:'旧项目策划输入'}});
    selectMode('model');fireEvent.change(screen.getByRole('textbox',{name:'告诉助手你的想法'}),{target:{value:'旧项目建模输入'}});openExecution();
    const mode=screen.getByRole('combobox',{name:'工作模式'}) as HTMLSelectElement;
    mode.focus();view.rerender(ui({...layout,id:restoredId,name:'恢复完成项目'}));
    expect(completed).toHaveBeenCalledOnce();expect(mode.value).toBe('plan');
    expect(document.activeElement).toBe(mode);
    expect(screen.getByRole('group',{name:'执行工作单'})).toBeTruthy();
    selectMode('plan');expect((screen.getByRole('textbox',{name:'告诉助手你的想法'}) as HTMLTextAreaElement).value).toBe('');
    selectMode('model');expect((screen.getByRole('textbox',{name:'告诉助手你的想法'}) as HTMLTextAreaElement).value).toBe('');
    view.rerender(ui({...layout,id:'ordinary-new-project',name:'普通新项目'}));expect(mode.value).toBe('plan');
    expect(onApply).not.toHaveBeenCalled();expect(controller.startAgentRun).not.toHaveBeenCalled();
  });

  it('returns to the completion page after a restored project scope resets the workspace',async()=>{
    const delivery=await import('./scene-delivery-panel');const Original=delivery.SceneDeliveryPanel;
    let restored:(()=>void)|undefined;
    vi.spyOn(delivery,'SceneDeliveryPanel').mockImplementation(props=>{restored=props.onBackupRestored;return <Original {...props}/>;});
    const view=renderUI(ui());fireEvent.click(screen.getByRole('button',{name:'打开 Bingo Agent'}));
    selectMode('model');fireEvent.change(screen.getByRole('textbox',{name:'告诉助手你的想法'}),{target:{value:'旧项目的未发送建模输入'}});openExecution();
    const changed={...layout,id:'restored-local-project',name:'恢复后的项目'};view.rerender(ui(changed));
    const mode=screen.getByRole('combobox',{name:'工作模式'}) as HTMLSelectElement;
    expect(mode.value).toBe('plan');expect(restored).toBeTypeOf('function');
    act(()=>{restored!();});expect(mode.value).toBe('plan');
    expect(screen.getByRole('group',{name:'执行工作单'})).toBeTruthy();
    selectMode('model');expect((screen.getByRole('textbox',{name:'告诉助手你的想法'}) as HTMLTextAreaElement).value).toBe('');
    expect(onApply).not.toHaveBeenCalled();expect(controller.startAgentRun).not.toHaveBeenCalled();
  });

  it('opens the generic workspace at planning first and retains drafts and the selected tool when reopened', async () => {
    function Trial(){
      const entry=useRef<HTMLButtonElement>(null);const api=useRef<BusinessToolsApi|null>(null);
      return <CreativeStudioProvider controller={controller} layout={layout} onApply={onApply}><button ref={entry} onClick={()=>api.current?.openBrief()}>打开活动工作区</button><CreativeAssistant toolsApiRef={api} workspaceEntryRef={entry}/></CreativeStudioProvider>;
    }
    renderUI(<Trial/>);await act(async()=>{});const entry=screen.getByRole('button',{name:'打开活动工作区'});fireEvent.click(entry);
    const mode=screen.getByRole('combobox',{name:'工作模式'}) as HTMLSelectElement;
    expect(mode.value).toBe('plan');expect(screen.queryByRole('group',{name:'执行工作单'})).toBeNull();
    expect(screen.getByRole('region',{name:'Agent'}).classList.contains('is-expanded')).toBe(true);
    expect(document.activeElement).toBe(screen.getByRole('textbox',{name:'客户需求'}));
    fireEvent.change(screen.getByRole('textbox',{name:'客户需求'}),{target:{value:'原活动简报文字'}});
    fireEvent.change(screen.getByRole('textbox',{name:'告诉助手你的想法'}),{target:{value:'策划未发送文字'}});
    selectMode('model');fireEvent.change(screen.getByRole('textbox',{name:'告诉助手你的想法'}),{target:{value:'建模未发送文字'}});
    fireEvent.click(screen.getByRole('button',{name:'材质调整'}));fireEvent.keyDown(screen.getByRole('region',{name:'Agent'}),{key:'Escape'});
    expect(document.activeElement).toBe(entry);fireEvent.click(entry);
    expect(mode.value).toBe('model');selectMode('model');expect(screen.getByRole('button',{name:'材质调整'}).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('region',{name:'Agent'}).classList.contains('is-expanded')).toBe(true);
    expect((screen.getByRole('textbox',{name:'告诉助手你的想法'}) as HTMLTextAreaElement).value).toBe('建模未发送文字');
    selectMode('plan');expect((screen.getByRole('textbox',{name:'告诉助手你的想法'}) as HTMLTextAreaElement).value).toBe('策划未发送文字');
    expect((screen.getByRole('textbox',{name:'客户需求'}) as HTMLTextAreaElement).value).toBe('原活动简报文字');
    expect(controller.startAgentRun).not.toHaveBeenCalled();expect(onApply).not.toHaveBeenCalled();
  });

  it('opens the existing execution list in one click without preparing cloud or Agent work', async () => {
    const current = backendSceneToLayout(candidate, { name: '演练 · 执行入口' });
    const prepare = vi.spyOn(controller, 'ensureWorkbenchReady');
    renderUI(<DeliveryShortcutTrial current={current}/>);
    expect(screen.queryByRole('region', { name: '场景交付' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '打开执行工作单' }));
    const work = await screen.findByRole('group', { name: '执行工作单' });
    expect(document.activeElement).toBe(work);
    expect(screen.getByText('采购汇总 · 1 类')).toBeDefined();
    fireEvent.click(screen.getByRole('tab', { name: '导出' }));
    expect(screen.getByRole('button', { name: '导出执行清单 CSV' })).toBeDefined();
    expect(prepare).not.toHaveBeenCalled(); expect(controller.startAgentRun).not.toHaveBeenCalled();
    expect(onApply).not.toHaveBeenCalled();
  });

  it('returns keyboard focus to the shortcut after Escape and opens the same list again', async () => {
    renderUI(<DeliveryShortcutTrial/>);
    const entry = screen.getByRole('button', { name: '打开执行工作单' });
    fireEvent.click(entry);
    fireEvent.keyDown(await screen.findByRole('group', { name: '执行工作单' }), { key: 'Escape' });
    await waitFor(() => expect(document.activeElement).toBe(entry));
    fireEvent.click(entry);
    expect(await screen.findByRole('group', { name: '执行工作单' })).toBe(document.activeElement);
    expect(onApply).not.toHaveBeenCalled();
  });

  it('opens execution directly while preserving the modeling draft and material tool', async () => {
    renderUI(<DeliveryShortcutTrial/>);fireEvent.click(screen.getByRole('button',{name:'打开 Bingo Agent'}));
    selectMode('model');
    fireEvent.change(screen.getByRole('textbox',{name:'告诉助手你的想法'}),{target:{value:'一把绿色椅子，尚未发送'}});
    fireEvent.click(screen.getByRole('button',{name:'材质调整'}));
    fireEvent.click(screen.getByRole('button',{name:'打开执行工作单'}));
    const work=await screen.findByRole('group',{name:'执行工作单'});
    expect(document.activeElement).toBe(work);
    expect((screen.getByRole('combobox',{name:'工作模式'}) as HTMLSelectElement).value).toBe('model');
    expect((screen.getByRole('textbox',{name:'告诉助手你的想法'}) as HTMLTextAreaElement).value).toBe('一把绿色椅子，尚未发送');
    selectMode('model');
    expect(screen.getByRole('button',{name:'材质调整'}).getAttribute('aria-pressed')).toBe('true');
    expect((screen.getByRole('textbox',{name:'告诉助手你的想法'}) as HTMLTextAreaElement).value).toBe('一把绿色椅子，尚未发送');
    expect(controller.startAgentRun).not.toHaveBeenCalled();expect(onApply).not.toHaveBeenCalled();
  });

  it.each([false,true])('opens and focuses the original demand form from activity operations (saved=%s)', async saved => {
    if(saved)vi.mocked(readSourceForm).mockImplementation(async key => key.endsWith(':brief') ? {event:'工作坊',guests:30,description:'已保存的活动需求',mustHave:'',allowIdeas:false} : undefined);
    const prepare=vi.spyOn(controller,'ensureWorkbenchReady');
    const view=renderUI(<DeliveryShortcutTrial operations/>);
    const entry=screen.getByRole('button',{name:'打开执行工作单'});
    fireEvent.click(entry);
    await screen.findByRole('group',{name:'执行工作单'});
    const details=view.container.querySelector<HTMLDetailsElement>('.cr-agent-brief')!;
    expect(details.open).toBe(true);
    fireEvent.click(await screen.findByRole('button',{name:saved?'查看活动需求':'打开活动需求表单'}));
    const input=screen.getByRole('textbox',{name:'客户需求'});
    await waitFor(()=>expect(document.activeElement).toBe(input));
    expect(details.open).toBe(true);
    expect((screen.getByRole('combobox',{name:'工作模式'}) as HTMLSelectElement).value).toBe('plan');
    expect(screen.getAllByRole('textbox',{name:'客户需求'})).toHaveLength(1);
    expect((input as HTMLTextAreaElement).value).toBe(saved?'已保存的活动需求':'');
    expect(prepare).not.toHaveBeenCalled(); expect(controller.startAgentRun).not.toHaveBeenCalled(); expect(onApply).not.toHaveBeenCalled();
    fireEvent.keyDown(input,{key:'Escape'});
    await waitFor(()=>expect(document.activeElement).toBe(entry));
    fireEvent.click(entry);
    expect(await screen.findByRole('group',{name:'执行工作单'})).toBe(document.activeElement);
  });
});

function render(element: React.ReactElement) {
  const view=renderUI(element);
  fireEvent.click(screen.getByRole('button', {name:'打开 Bingo Agent'}));
  const brief=view.container.querySelector<HTMLDetailsElement>('.cr-agent-brief')!;
  if(!brief.open)fireEvent.click(screen.getByText('活动需求与场地资料'));
  fireEvent.click(screen.getByLabelText('助手设置'));
  return view;
}
function selectMode(value:'plan'|'model'):void {
  fireEvent.change(screen.getByRole('combobox',{name:'工作模式'}),{target:{value}});
}
function selectBusiness(name:string):void {
  const destinations:Record<string,string>={'活动需求':'brief','图纸与照片':'reference','场地重建':'rebuild','执行资料':'delivery','方案评审':'review','场景模板':'templates','物料工具':'model','合同与约定':'commercial'};
  if(!screen.queryByRole('combobox',{name:/布置工具|资料分类/}))fireEvent.click(screen.getByRole('button',{name:'外部图纸核对'}));
  fireEvent.change(screen.getByRole('combobox',{name:/布置工具|资料分类/}),{target:{value:destinations[name]}});
}
function openExecution():void {
  selectBusiness('执行资料');
}

function connected(): void {
  Object.assign(snapshot, {
    configured: true, user: { id: 'test-user' }, sessionId:proposal.session_id,localRevision:0,lease:{projectId,sessionId:proposal.session_id,generation:1,revision:1,expiresAt:'2099-01-01T00:00:00Z'}, writeBlocked: false, status: 'editing', revision: 1,
    project: { id: projectId, studio_id: 'studio-test', name: '客户方案', revision: 1, scene },
  });
}

function enterBrief(): void {
  fireEvent.change(screen.getByRole('textbox', { name: '客户需求' }), { target: { value: '给 24 位来宾布置一个交流会，保留中心通道。' } });
}

async function generatePreview(): Promise<void> {
  enterBrief();
  fireEvent.click(screen.getByRole('button', { name: '按这份细表生成预览' }));
  await screen.findByText('方案提案 · 尚未应用');
}

function upload(container: HTMLElement, files: File[]): void {
  const input = container.querySelector('input[type="file"]')!;
  fireEvent.change(input, { target: { files } });
}

beforeEach(() => {
  mockBrowserLocks();
  vi.stubGlobal('crypto',webcrypto);
  localStorage.clear(); sessionStorage.clear();
  routerPush.mockReset();
  onApply.mockReset();
  onPreview.mockReset();
  forbiddenFetch.mockClear();
  vi.mocked(readSourceForm).mockReset().mockResolvedValue(undefined);
  sourceMocks.readSourceRecordSnapshot.mockReset().mockImplementation(async(key:string)=>{const value=await sourceMocks.readSourceForm(key);return value===undefined?{present:false}:{present:true,value};});
  vi.mocked(readSourceRecord).mockReset().mockResolvedValue(undefined);
  vi.mocked(updateSourceForm).mockReset();
  vi.mocked(storeSourceForm).mockReset().mockResolvedValue(undefined);
  vi.mocked(deleteSourceForm).mockReset().mockResolvedValue(undefined);
  vi.mocked(copySourceScope).mockReset().mockResolvedValue(undefined);
  vi.mocked(listStoredSources).mockReset().mockResolvedValue([]);
  vi.mocked(readSourceScopeSnapshot).mockReset();
  vi.mocked(restoreSourceScopeIfUnchanged).mockReset();
  vi.stubGlobal('fetch', forbiddenFetch);
  createBitmap.mockReset().mockImplementation(async () => ({ width: 1024, height: 768, close: vi.fn() }));
  createObjectURL.mockReset().mockReturnValue('blob:local-reference');
  revokeObjectURL.mockReset();
  vi.stubGlobal('createImageBitmap', createBitmap);
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, writable: true, value: createObjectURL });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, writable: true, value: revokeObjectURL });
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, value: vi.fn() });
  controller = new BackendSession(getBackendConfig({ url: '', anonKey: '' }));
  snapshot = { ...controller.getSnapshot() };
  vi.spyOn(controller, 'getSnapshot').mockImplementation(() => snapshot);
  vi.spyOn(controller, 'listSources').mockResolvedValue([]);
  prepareProposal.mockReset().mockResolvedValue(proposal);
  vi.spyOn(controller,'startAgentRun').mockImplementation(async input=>runFrom(await prepareProposal(input),input));
  vi.spyOn(controller,'getAgentRun');
  vi.spyOn(controller,'getAgentRunEvents').mockRejectedValue(new Error('event endpoint unavailable'));
  vi.spyOn(controller,'getAgentRunByRequest');
  vi.spyOn(controller,'cancelAgentRun');
  vi.spyOn(controller, 'authorizeAssets').mockResolvedValue({ assetUrls: {}, assetNames: {} });
  vi.spyOn(controller, 'peekProject').mockResolvedValue({ id:projectId, studio_id:'studio-test', name:'客户方案', revision:2, scene:candidate });
  vi.spyOn(controller, 'applySceneProposal').mockResolvedValue({ id: projectId, revision: 2, scene: candidate, previousScene: scene, updatedAt: '2026-10-02T10:00:00Z', undoGroup: 'undo-test', acceptedLocally: true });
  layout = backendSceneToLayout(scene, { projectId, name: '客户方案' });
});

afterEach(() => {
  cleanup();
  clearUnsentMessageDraftsForTests();
  clearUnsavedSourceDraftsForTests();
  controller.dispose();
  vi.useRealTimers();
  expect(forbiddenFetch).not.toHaveBeenCalled();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  restoreProperty(URL, 'createObjectURL', originalCreateObjectURL);
  restoreProperty(URL, 'revokeObjectURL', originalRevokeObjectURL);
  restoreProperty(HTMLElement.prototype, 'scrollTo', originalScrollTo);
  restoreProperty(navigator, 'locks', originalLocks);
});

describe('zero seating result',()=>{
  it('accepts only one bounded zero placement system warning',()=>{
    for(const code of ['SEATING_SHORTFALL:30:0:no_placement','SHARED_SEATING_SHORTFALL:30:0:0:object_limit']){
      expect(zeroSeatingShortfall([{code,ids:[]}])).toContain('本次新增');
    }
    for(const code of ['SEATING_SHORTFALL:0:0:no_placement','SEATING_SHORTFALL:101:0:no_placement','SEATING_SHORTFALL:30:1:no_placement','SHARED_SEATING_SHORTFALL:30:0:1:no_placement','SHARED_SEATING_SHORTFALL:30:0:0:fake'])expect(zeroSeatingShortfall([{code,ids:[]}])).toBeNull();
    expect(zeroSeatingShortfall([{code:'SEATING_SHORTFALL:30:0:no_placement',ids:['not-empty']}])).toBeNull();
    expect(zeroSeatingShortfall([{code:'SEATING_SHORTFALL:30:0:no_placement',ids:[]},{code:'SEATING_SHORTFALL:30:0:scan_limit',ids:[]}])).toBeNull();
  });
  it('returns a one-run zero result for an unchanged candidate without applying it',async()=>{
    connected();const received=vi.fn();
    prepareProposal.mockResolvedValueOnce({...proposal,candidate:scene,warnings:[{code:'SEATING_SHORTFALL:30:0:no_placement',ids:[]}],explanation:'模型文本不应作为回执'});
    function Probe(){const studio=useStudioAgent();return <button onClick={()=>void studio?.generate('生成活动方案').then(received)}>执行零结果</button>;}
    renderUI(<CreativeStudioProvider controller={controller} layout={layout} onApply={onApply}><Probe/><CreativeAssistant/></CreativeStudioProvider>);
    await waitFor(()=>expect(screen.getByRole('button',{name:'执行零结果'})).toBeTruthy());fireEvent.click(screen.getByRole('button',{name:'执行零结果'}));
    await waitFor(()=>expect(received).toHaveBeenCalledOnce());
    expect(received.mock.calls[0]![0]).toMatchObject({kind:'unchanged',runId:expect.any(String),message:expect.stringContaining('本次新增')});
    expect(received.mock.calls[0]![0].message).toContain('尝试其他区域并核对桌椅规格');expect(received.mock.calls[0]![0].message).toContain('你也可决定');
    expect(screen.getByText(/本次新增课桌椅组团 0 \/ 30 套/)).toBeTruthy();
    expect(JSON.stringify(received.mock.calls[0]![0])).not.toContain('模型文本');expect(controller.applySceneProposal).not.toHaveBeenCalled();expect(onApply).not.toHaveBeenCalled();
  });
});

describe('dialogue export capture',()=>{
  it('fences activity and floor transitions and releases the captured snapshot',()=>{
    const previous=layoutStore.getState();
    const local=structuredClone(layout);local.id='dialogue-capture-test';
    layoutStore.setState({layout:local,activeFloorIndex:0});
    const activity=createActivitySessionTracker(layoutStore),floor=createFloorSessionTracker(layoutStore);
    activity.start();floor.start();
    const released=vi.fn();let captured:DialogueExportCapture|null|undefined;
    function Probe(){const studio=useStudioAgent() as (ReturnType<typeof useStudioAgent>&{captureDialogue?:()=>DialogueExportCapture|null});return <button onClick={()=>{captured=studio?.captureDialogue?.();}}>捕获对话</button>;}
    try{
      renderUI(<CreativeStudioProvider controller={controller} layout={local} onApply={onApply}
        sessionToken={activity.capture()} isSessionCurrent={activity.isCurrent} floorToken={floor.capture()} isFloorCurrent={floor.isCurrent}
        getCurrentLayout={()=>layoutStore.getState().layout}
        captureDialogue={()=>({project:reference=>projectDialogueHandoff(null,reference),isCurrent:()=>true,release:released})}><Probe/></CreativeStudioProvider>);
      fireEvent.click(screen.getByRole('button',{name:'捕获对话'}));
      expect(captured?.isCurrent()).toBe(true);
      expect(captured?.project().availability).toBe('unavailable');
      act(()=>{layoutStore.setState({activeFloorIndex:1});layoutStore.setState({activeFloorIndex:0});});
      expect(captured?.isCurrent()).toBe(false);
      captured?.release();expect(released).toHaveBeenCalledOnce();
    }finally{cleanup();activity.stop();floor.stop();layoutStore.setState(previous,true);}
  });
});

describe('cloud material draft scope',()=>{
  it('does not download when a local proposal appears while a cloud draft is being prepared',async()=>{
    connected();const registry=createPendingCandidateRegistry(),scope={},access=bindPendingCandidateRegistry(registry,scope,()=>true),proposalOwner={};
    const download=vi.fn(),done=vi.fn(),failed=vi.fn(),original=cloudMaterialDraft.exportCloudMaterialDraft;
    let release!:(value:Pick<typeof sceneDelivery,'deliveryMaterials'|'downloadSceneDelivery'>)=>void;
    const load=vi.fn(()=>new Promise<Pick<typeof sceneDelivery,'deliveryMaterials'|'downloadSceneDelivery'>>(resolve=>{release=resolve;}));
    vi.spyOn(cloudMaterialDraft,'exportCloudMaterialDraft').mockImplementation(options=>original({...options,load}));
    renderUI(<CreativeStudioProvider pendingCandidates={access} controller={controller} layout={layout} onApply={onApply}><CloudMaterialDraftProbe done={done} failed={failed}/></CreativeStudioProvider>);
    fireEvent.click(screen.getByRole('button',{name:'导出测试草案'}));await waitFor(()=>expect(load).toHaveBeenCalledOnce());
    access.register('local',proposalOwner);release({deliveryMaterials:sceneDelivery.deliveryMaterials,downloadSceneDelivery:download});
    await waitFor(()=>expect(failed).toHaveBeenCalledOnce());expect(done).not.toHaveBeenCalled();expect(download).not.toHaveBeenCalled();
  });
  it.each([true,false])('downloads a labelled draft from the current cloud scene (dirty=%s)',async dirty=>{
    connected();snapshot.dirty=dirty;const download=vi.fn(),done=vi.fn(),failed=vi.fn(),original=cloudMaterialDraft.exportCloudMaterialDraft;
    vi.spyOn(cloudMaterialDraft,'exportCloudMaterialDraft').mockImplementation(options=>original({...options,load:async()=>({deliveryMaterials:sceneDelivery.deliveryMaterials,downloadSceneDelivery:download})}));
    renderUI(<CreativeStudioProvider controller={controller} layout={layout} onApply={onApply}><CloudMaterialDraftProbe done={done} failed={failed}/></CreativeStudioProvider>);
    fireEvent.click(screen.getByRole('button',{name:'导出测试草案'}));
    await waitFor(()=>expect(done).toHaveBeenCalledOnce());expect(failed).not.toHaveBeenCalled();expect(download).toHaveBeenCalledOnce();
    const html=String(download.mock.calls[0]![0]);expect(html).toContain('本机快照');expect(html).toContain(dirty?'本次包含尚未保存到云端的更改':'本次读取时无未保存更改');expect(html).toContain('未冻结');
  });
  it.each(['user','project','revision','localRevision','dirty','writeBlocked','lease','saving','floor','scene'] as const)('does not download after %s changes while preparing',async what=>{
    connected();const download=vi.fn(),done=vi.fn(),failed=vi.fn(),original=cloudMaterialDraft.exportCloudMaterialDraft;
    let release!:(value:Pick<typeof sceneDelivery,'deliveryMaterials'|'downloadSceneDelivery'>)=>void;
    let floorCurrent=true;const load=vi.fn(()=>new Promise<Pick<typeof sceneDelivery,'deliveryMaterials'|'downloadSceneDelivery'>>(resolve=>{release=resolve;}));
    vi.spyOn(cloudMaterialDraft,'exportCloudMaterialDraft').mockImplementation(options=>original({...options,load}));
    const content=(current:RoomLayout)=><CreativeStudioProvider controller={controller} layout={current} onApply={onApply} isFloorCurrent={()=>floorCurrent}><CloudMaterialDraftProbe done={done} failed={failed}/></CreativeStudioProvider>;
    const view=renderUI(content(layout));fireEvent.click(screen.getByRole('button',{name:'导出测试草案'}));await waitFor(()=>expect(load).toHaveBeenCalledOnce());
    if(what==='user')snapshot.user={id:'different-user'};
    else if(what==='project')snapshot.project={...snapshot.project!,id:'different-project'};
    else if(what==='revision')snapshot.revision=2;
    else if(what==='localRevision')snapshot.localRevision++;
    else if(what==='dirty')snapshot.dirty=!snapshot.dirty;
    else if(what==='writeBlocked')snapshot.writeBlocked=!snapshot.writeBlocked;
    else if(what==='lease')snapshot.lease={...snapshot.lease!,generation:snapshot.lease!.generation+1};
    else if(what==='saving')snapshot.status='saving';
    else if(what==='floor')floorCurrent=false;
    else {const changed=structuredClone(layout);changed.width++;view.rerender(content(changed));}
    release({deliveryMaterials:sceneDelivery.deliveryMaterials,downloadSceneDelivery:download});
    await waitFor(()=>expect(failed).toHaveBeenCalledOnce());expect(done).not.toHaveBeenCalled();expect(download).not.toHaveBeenCalled();
  });
});

describe('creative brief and assistant interaction', () => {
  it('registers a cloud candidate synchronously and clears only its own owner when discarded',async()=>{
    connected();const registry=createPendingCandidateRegistry(),scope={},access=bindPendingCandidateRegistry(registry,scope,()=>true),local={};
    access.register('local',local);
    render(<CreativeStudioProvider pendingCandidates={access} controller={controller} layout={layout} onApply={onApply} onPreview={onPreview}><CreativeAssistant/></CreativeStudioProvider>);
    await generatePreview();expect(access.capture()).toMatchObject({local:true,cloud:true});
    fireEvent.click(screen.getByRole('button',{name:'放弃'}));
    expect(access.capture()).toMatchObject({local:true,cloud:false,hasPending:true});
  });
  it('preserves unconfirmed older values in a guarded compare-and-set before saving edits',async()=>{
    const old={event:'公益讲座',guests:47,guestsConfirmed:false,allowIdeas:true,description:'原需求',mustHave:''};let stored:unknown=structuredClone(old);
    vi.mocked(readSourceForm).mockImplementation(async key=>key.endsWith(':brief')?structuredClone(stored) as never:undefined);
    vi.mocked(updateSourceForm).mockImplementation(async(_key,update,guard)=>{guard?.assertStillHeld();const next=update(structuredClone(stored));guard?.assertStillHeld();stored=structuredClone(next);return next as never;});
    vi.spyOn(sourceStorage,'readSourceRecordSnapshot').mockImplementation(async()=>({present:true,value:structuredClone(stored)}));
    const lease=await createLocalWriteLeaseManager({getLocks:()=>navigator.locks,getStorage:()=>window.localStorage}).acquire();
    renderUI(<CreativeStudioProvider controller={controller} layout={layout} writeCapability={lease.capability} onApply={onApply}><CreativeBriefPanel/></CreativeStudioProvider>);
    await screen.findByText('来源待确认的旧记录');expect(screen.getByText('当前未确认的保存值（可能为默认值）')).toBeTruthy();
    fireEvent.change(screen.getByRole('textbox',{name:'客户需求'}),{target:{value:'修改后的需求'}});
    await waitFor(()=>expect(updateSourceForm).toHaveBeenCalled());
    await waitFor(()=>expect(stored).toMatchObject({description:'修改后的需求',legacyBriefRecord:{event:'公益讲座',allowIdeas:true},unconfirmedSavedBrief:{guests:47}}));
    await lease.release();
  });
  it('does not overwrite a legacy brief changed after its initial read',async()=>{
    const old={event:'公益讲座',guests:47,allowIdeas:true,description:'原需求',mustHave:''};let stored:unknown=structuredClone(old);
    vi.mocked(readSourceForm).mockImplementation(async key=>key.endsWith(':brief')?structuredClone(stored) as never:undefined);
    vi.mocked(updateSourceForm).mockImplementation(async(_key,update,guard)=>{guard?.assertStillHeld();const next=update(structuredClone(stored));stored=structuredClone(next);return next as never;});
    const lease=await createLocalWriteLeaseManager({getLocks:()=>navigator.locks,getStorage:()=>window.localStorage}).acquire();
    renderUI(<CreativeStudioProvider controller={controller} layout={layout} writeCapability={lease.capability} onApply={onApply}><CreativeBriefPanel/></CreativeStudioProvider>);
    await screen.findByText('来源待确认的旧记录');stored={...old,description:'另一页面的新记录'};
    fireEvent.change(screen.getByRole('textbox',{name:'客户需求'}),{target:{value:'本页新输入'}});
    expect(await screen.findByText(/旧需求已在其他位置变化/)).toBeTruthy();expect(stored).toMatchObject({description:'另一页面的新记录'});
    expect((screen.getByRole('textbox',{name:'客户需求'}) as HTMLTextAreaElement).value).toBe('本页新输入');await lease.release();
  });
  it('keeps legacy data and the new input when no genuine local write capability exists',async()=>{
    const old={event:'公益讲座',guests:47,allowIdeas:false,description:'原需求',mustHave:''};
    vi.mocked(readSourceForm).mockImplementation(async key=>key.endsWith(':brief')?structuredClone(old) as never:undefined);
    renderUI(<CreativeStudioProvider controller={controller} layout={layout} onApply={onApply}><CreativeBriefPanel/></CreativeStudioProvider>);
    await screen.findByText('来源待确认的旧记录');fireEvent.change(screen.getByRole('textbox',{name:'客户需求'}),{target:{value:'本页新输入'}});
    expect((await screen.findByRole('alert')).textContent).toContain('活动需求保存失败');expect(updateSourceForm).not.toHaveBeenCalled();
    expect(vi.mocked(storeSourceForm).mock.calls.some(([key])=>key===`${projectId}:brief`)).toBe(false);
    expect((screen.getByRole('textbox',{name:'客户需求'}) as HTMLTextAreaElement).value).toBe('本页新输入');
  });
  it('downloads saved legacy data and the unsaved draft separately without flushing or writing',async()=>{
    const old={event:'公益讲座',guests:47,allowIdeas:false,description:'原需求',mustHave:''};
    vi.stubGlobal('Blob',NodeBlob);vi.spyOn(HTMLAnchorElement.prototype,'click').mockImplementation(()=>{});
    vi.mocked(readSourceForm).mockImplementation(async key=>key.endsWith(':brief')?structuredClone(old) as never:undefined);
    vi.spyOn(sourceStorage,'readSourceRecordSnapshot').mockResolvedValue({present:true,value:old});
    renderUI(<CreativeStudioProvider controller={controller} layout={layout} onApply={onApply}><CreativeBriefPanel/></CreativeStudioProvider>);
    await screen.findByText('来源待确认的旧记录');fireEvent.change(screen.getByRole('textbox',{name:'客户需求'}),{target:{value:'本页新输入'}});
    await screen.findByRole('alert');const writes=vi.mocked(storeSourceForm).mock.calls.length;
    fireEvent.click(screen.getByText('下载需求记录或草稿'));fireEvent.click(screen.getByRole('button',{name:'下载原始本机需求记录'}));
    await waitFor(()=>expect(createObjectURL).toHaveBeenCalled());
    const original=JSON.parse(await (createObjectURL.mock.calls.at(-1)![0] as NodeBlob).text());
    expect(original).toMatchObject({kind:'original',value:old});
    fireEvent.click(screen.getByRole('button',{name:'下载当前未保存需求草稿'}));
    const draft=JSON.parse(await (createObjectURL.mock.calls.at(-1)![0] as NodeBlob).text());
    expect(draft).toMatchObject({kind:'draft',value:{description:'本页新输入',legacyBriefRecord:{event:'公益讲座',guests:47,allowIdeas:false}}});
    expect(updateSourceForm).not.toHaveBeenCalled();expect(storeSourceForm).toHaveBeenCalledTimes(writes);
  });
  it('does not invent a saved record and still exports the draft when saved-record reads fail',async()=>{
    const old={event:'公益讲座',guests:47,allowIdeas:false,description:'原需求',mustHave:''};
    vi.stubGlobal('Blob',NodeBlob);vi.spyOn(HTMLAnchorElement.prototype,'click').mockImplementation(()=>{});
    vi.mocked(readSourceForm).mockImplementation(async key=>key.endsWith(':brief')?structuredClone(old) as never:undefined);
    const read=vi.spyOn(sourceStorage,'readSourceRecordSnapshot').mockResolvedValueOnce({present:true,value:old}).mockResolvedValueOnce({present:false}).mockRejectedValue(new Error('读取失败'));
    renderUI(<CreativeStudioProvider controller={controller} layout={layout} onApply={onApply}><CreativeBriefPanel/></CreativeStudioProvider>);
    await screen.findByText('来源待确认的旧记录');fireEvent.change(screen.getByRole('textbox',{name:'客户需求'}),{target:{value:'保留本页草稿'}});
    await screen.findByRole('alert');fireEvent.click(screen.getByText('下载需求记录或草稿'));createObjectURL.mockClear();
    fireEvent.click(screen.getByRole('button',{name:'下载原始本机需求记录'}));expect(await screen.findByText('当前活动没有已保存的需求记录。')).toBeTruthy();expect(createObjectURL).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button',{name:'下载原始本机需求记录'}));expect(await screen.findByText('读取失败')).toBeTruthy();expect(read).toHaveBeenCalledTimes(3);
    fireEvent.click(screen.getByRole('button',{name:'下载当前未保存需求草稿'}));const draft=JSON.parse(await (createObjectURL.mock.calls.at(-1)![0] as NodeBlob).text());
    expect(draft).toMatchObject({kind:'draft',value:{description:'保留本页草稿'}});
  });
  it('keeps the draft and reports an uncertain save if guarded legacy readback fails',async()=>{
    const old={event:'公益讲座',guests:47,allowIdeas:false,description:'原需求',mustHave:''};let stored:unknown=structuredClone(old);
    vi.mocked(readSourceForm).mockImplementation(async key=>key.endsWith(':brief')?structuredClone(stored) as never:undefined);
    vi.mocked(updateSourceForm).mockImplementation(async(_key,update,guard)=>{guard?.assertStillHeld();const next=update(structuredClone(stored));stored=structuredClone(next);return next as never;});
    vi.spyOn(sourceStorage,'readSourceRecordSnapshot').mockResolvedValueOnce({present:true,value:old}).mockRejectedValue(new Error('读取失败'));
    const lease=await createLocalWriteLeaseManager({getLocks:()=>navigator.locks,getStorage:()=>window.localStorage}).acquire();
    renderUI(<CreativeStudioProvider controller={controller} layout={layout} writeCapability={lease.capability} onApply={onApply}><CreativeBriefPanel/></CreativeStudioProvider>);
    await screen.findByText('来源待确认的旧记录');fireEvent.change(screen.getByRole('textbox',{name:'客户需求'}),{target:{value:'本页新输入'}});
    expect((await screen.findByRole('alert')).textContent).toContain('活动需求保存失败');
    expect(stored).toMatchObject({legacyBriefRecord:{event:'公益讲座',guests:47,allowIdeas:false}});
    expect((screen.getByRole('textbox',{name:'客户需求'}) as HTMLTextAreaElement).value).toBe('本页新输入');await lease.release();
  });
  it('reports brief, drawing and image readiness through the shared scoped coordinator',async()=>{
    const scope='isolated-combined-observer',coordinator=createSourceEditorCoordinator(scope),current={...layout,id:scope};
    const view=renderUI(<CreativeStudioProvider controller={controller} layout={current} sourceCoordinator={coordinator} onApply={onApply}><CreativeBriefPanel/></CreativeStudioProvider>);
    await waitFor(()=>expect(coordinator.snapshot().status).toBe('settled'));
    act(()=>{fireEvent.change(screen.getByRole('textbox',{name:'客户需求'}),{target:{value:'修改需求'}});expect(coordinator.snapshot().status).toBe('unknown');});
    await waitFor(()=>expect(coordinator.snapshot().status).toBe('settled'));
    view.unmount();expect(coordinator.snapshot().status).toBe('unknown');coordinator.destroy();
  });
  it('explicitly rechecks all three persisted source roles without replacing the current inputs',async()=>{
    const scope='isolated-recheck-success',coordinator=createSourceEditorCoordinator(scope),current={...layout,id:scope};
    const lease=await createLocalWriteLeaseManager({getLocks:()=>navigator.locks,getStorage:()=>window.localStorage}).acquire();
    vi.spyOn(sourceStorage,'readSourceRecordSnapshot').mockResolvedValue({present:false});
    vi.spyOn(sourceStorage,'readSourceScopeSnapshotV2').mockResolvedValue({version:2,scope,sources:[],form:{present:false}});
    const view=renderUI(<CreativeStudioProvider controller={controller} layout={current} sourceCoordinator={coordinator} writeCapability={lease.capability} onApply={onApply}><CreativeBriefPanel view="reference"/></CreativeStudioProvider>);
    await waitFor(()=>expect(coordinator.snapshot().status).toBe('settled'));act(()=>coordinator.invalidate());
    fireEvent.click(screen.getByRole('button',{name:'重新核对已保存的图纸资料'}));
    expect(await screen.findByText(/图纸资料已重新核对，请重新确认场地尺寸/)).toBeTruthy();expect(coordinator.snapshot().status).toBe('settled');
    view.unmount();coordinator.destroy();await lease.release();
  });
  it('keeps a newly edited draft and unknown status when it changes during source recheck',async()=>{
    const scope='isolated-recheck-race',coordinator=createSourceEditorCoordinator(scope),current={...layout,id:scope};
    const lease=await createLocalWriteLeaseManager({getLocks:()=>navigator.locks,getStorage:()=>window.localStorage}).acquire();
    let finish!:(value:{present:false})=>void;
    vi.spyOn(sourceStorage,'readSourceRecordSnapshot').mockImplementation(async key=>key===scope?new Promise(resolve=>{finish=resolve;}):{present:false});
    vi.spyOn(sourceStorage,'readSourceScopeSnapshotV2').mockResolvedValue({version:2,scope,sources:[],form:{present:false}});
    function Both(){const studio=useStudioAgent();return <><button onClick={()=>studio?.setBrief(previous=>({...previous,description:'核对期间的新草稿'}))}>修改需求</button><CreativeBriefPanel view="reference"/></>;}
    const view=renderUI(<CreativeStudioProvider controller={controller} layout={current} sourceCoordinator={coordinator} writeCapability={lease.capability} onApply={onApply}><Both/></CreativeStudioProvider>);
    await waitFor(()=>expect(coordinator.snapshot().status).toBe('settled'));act(()=>coordinator.invalidate());fireEvent.click(screen.getByRole('button',{name:'重新核对已保存的图纸资料'}));
    await waitFor(()=>expect(finish).toBeTypeOf('function'));fireEvent.click(screen.getByRole('button',{name:'修改需求'}));await act(async()=>finish({present:false}));
    expect(await screen.findByText(/资料已变化或读取失败/)).toBeTruthy();expect(coordinator.snapshot().status).toBe('unknown');
    view.unmount();coordinator.destroy();await lease.release();
  });
  it('keeps the current drawing and unknown state when a source reread fails',async()=>{
    const scope='isolated-recheck-read-failure',coordinator=createSourceEditorCoordinator(scope),current={...layout,id:scope};
    const lease=await createLocalWriteLeaseManager({getLocks:()=>navigator.locks,getStorage:()=>window.localStorage}).acquire();
    vi.spyOn(sourceStorage,'readSourceRecordSnapshot').mockImplementation(async key=>{if(key===scope)throw new Error('read failed');return {present:false};});
    vi.spyOn(sourceStorage,'readSourceScopeSnapshotV2').mockResolvedValue({version:2,scope,sources:[],form:{present:false}});
    const view=renderUI(<CreativeStudioProvider controller={controller} layout={current} sourceCoordinator={coordinator} writeCapability={lease.capability} onApply={onApply}><CreativeBriefPanel view="reference"/></CreativeStudioProvider>);
    await waitFor(()=>expect(coordinator.snapshot().status).toBe('settled'));const before=(screen.getByLabelText('场地尺寸') as HTMLTextAreaElement).value;
    act(()=>coordinator.invalidate());fireEvent.click(screen.getByRole('button',{name:'重新核对已保存的图纸资料'}));
    expect(await screen.findByText(/资料已变化或读取失败/)).toBeTruthy();expect((screen.getByLabelText('场地尺寸') as HTMLTextAreaElement).value).toBe(before);expect(coordinator.snapshot().status).toBe('unknown');
    view.unmount();coordinator.destroy();await lease.release();
  });
  it('rereads all source roles after React StrictMode effect replay',async()=>{
    const scope='isolated-strict-source-observer',coordinator=createSourceEditorCoordinator(scope),current={...layout,id:scope};
    const view=renderUI(<StrictMode><CreativeStudioProvider controller={controller} layout={current} sourceCoordinator={coordinator} onApply={onApply}><CreativeBriefPanel/></CreativeStudioProvider></StrictMode>);
    await waitFor(()=>expect(coordinator.snapshot().status).toBe('settled'));view.unmount();coordinator.destroy();
  });
  it('marks an image dirty before decoding and settles only after the original is saved',async()=>{
    const scope='isolated-image-observer',coordinator=createSourceEditorCoordinator(scope),current={...layout,id:scope};
    let finish!:(value:{width:number;height:number;close:()=>void})=>void;
    createBitmap.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));vi.spyOn(sourceStorage,'storeSource').mockResolvedValue(undefined);
    const view=renderUI(<CreativeStudioProvider controller={controller} layout={current} sourceCoordinator={coordinator} onApply={onApply}><CreativeBriefPanel view="reference"/></CreativeStudioProvider>);
    await waitFor(()=>expect(coordinator.snapshot().status).toBe('settled'));
    const input=view.container.querySelector<HTMLInputElement>('input[type="file"]')!;
    act(()=>{fireEvent.change(input,{target:{files:[new File(['image'],'floor.png',{type:'image/png'})]}});expect(coordinator.snapshot().status).toBe('unknown');});
    await waitFor(()=>expect(finish).toBeTypeOf('function'));await act(async()=>{finish({width:100,height:100,close:()=>{}});});
    await waitFor(()=>expect(coordinator.snapshot().status).toBe('settled'));view.unmount();coordinator.destroy();
  });
  it('keeps source status unknown when an image cannot be saved',async()=>{
    const scope='isolated-image-save-failure',coordinator=createSourceEditorCoordinator(scope),current={...layout,id:scope};
    vi.spyOn(sourceStorage,'storeSource').mockRejectedValue(new Error('写入失败'));
    const view=renderUI(<CreativeStudioProvider controller={controller} layout={current} sourceCoordinator={coordinator} onApply={onApply}><CreativeBriefPanel view="reference"/></CreativeStudioProvider>);
    await waitFor(()=>expect(coordinator.snapshot().status).toBe('settled'));
    fireEvent.change(view.container.querySelector<HTMLInputElement>('input[type="file"]')!,{target:{files:[new File(['image'],'floor.png',{type:'image/png'})]}});
    await screen.findByText('有图片尚未保存到本机');await waitFor(()=>expect(coordinator.snapshot()).toMatchObject({status:'unknown',reason:'write-failed:images'}));
    view.unmount();coordinator.destroy();
  });
  it('does not mark image sources settled after the local image store cannot be read',async()=>{
    const scope='isolated-image-read-failure',coordinator=createSourceEditorCoordinator(scope),current={...layout,id:scope};
    vi.mocked(listStoredSources).mockRejectedValue(new Error('读取失败'));
    const view=renderUI(<CreativeStudioProvider controller={controller} layout={current} sourceCoordinator={coordinator} onApply={onApply}><CreativeBriefPanel view="reference"/></CreativeStudioProvider>);
    await waitFor(()=>expect(coordinator.snapshot()).toMatchObject({status:'unknown',reason:'failed:images'}));
    view.unmount();coordinator.destroy();
  });
  it('keeps source status unknown when a cloud image has no local original',async()=>{
    connected();const scope='70000000-0000-4000-8000-000000000002',coordinator=createSourceEditorCoordinator(scope);
    snapshot={...snapshot,project:{...snapshot.project!,id:scope},lease:{...snapshot.lease!,projectId:scope}};
    vi.mocked(controller.listSources).mockResolvedValue([{assetId:'70000000-0000-4000-8000-000000000001',kind:'floorplan',name:'现场.png',width:100,height:100}]);
    vi.spyOn(controller,'sourceImageUrl').mockResolvedValue('https://example.test/image');
    const view=renderUI(<CreativeStudioProvider controller={controller} layout={{...layout,id:scope}} sourceCoordinator={coordinator} onApply={onApply}><CreativeBriefPanel/></CreativeStudioProvider>);
    await waitFor(()=>expect(coordinator.snapshot()).toMatchObject({status:'unknown',reason:'failed:images'}));
    view.unmount();coordinator.destroy();
  });
  it('reads the mocked absent checkin ledger through the real storage adapter', async () => {
    await expect(readMaterialCheckins(projectId)).resolves.toBeUndefined();
    expect(readSourceRecord).toHaveBeenCalledWith(['material-checkins', projectId]);
  });
  it('rejects unresolved needs before creating or dispatching a cloud run', async () => {
    connected();
    const validate = vi.fn(() => '活动需求仍有待确认的内容，请先核对。');
    const ensure = vi.spyOn(controller, 'ensureWorkbenchReady');
    renderUI(<CreativeStudioProvider controller={controller} layout={layout} onApply={onApply} validateGenerationIntent={validate}>
      <IntentGenerationProbe/><CreativeAssistant/>
    </CreativeStudioProvider>);
    fireEvent.click(screen.getByRole('button', { name: '测试生成' }));
    expect(await screen.findAllByText('活动需求仍有待确认的内容，请先核对。')).not.toHaveLength(0);
    expect(ensure).not.toHaveBeenCalled(); expect(controller.startAgentRun).not.toHaveBeenCalled();
  });

  it('allows an explicitly deferred need to preview but prevents direct application', async () => {
    connected();
    const memory=initialBriefMemory();memory.unresolvedActivityNeeds=['checkin'];memory.deferredActivityNeeds=['checkin'];
    const problem='活动需求仍有待确认的内容，请先核对。';
    renderUI(<CreativeStudioProvider controller={controller} layout={layout} onApply={onApply}
      validateGenerationIntent={()=>hasBlockingActivityNeeds(memory,true)?problem:null}
      validateCandidateRequirements={()=>hasBlockingActivityNeeds(memory,false)?problem:null}>
      <IntentGenerationProbe/><SecondaryConfirm/><CreativeAssistant/>
    </CreativeStudioProvider>);
    fireEvent.click(screen.getByRole('button',{name:'测试生成'}));
    const confirm=await screen.findByRole('button',{name:'左侧确认'});
    expect(controller.startAgentRun).toHaveBeenCalledOnce();
    fireEvent.click(confirm);
    expect(await screen.findAllByText(problem)).not.toHaveLength(0);
    expect(controller.applySceneProposal).not.toHaveBeenCalled();expect(onApply).not.toHaveBeenCalled();
  });

  it('does not dispatch from the detailed form when the confirmed dimensions disagree with the canvas', async () => {
    connected();
    const brief={...initialBriefMemory(),lengthM:12,widthM:10};
    const actual={...layout,width:10,height:8};
    const ensure=vi.spyOn(controller,'ensureWorkbenchReady');
    renderUI(<CreativeStudioProvider controller={controller} layout={actual} onApply={onApply} validateGenerationIntent={()=>venueDimensionsMismatch(brief,actual)}>
      <IntentGenerationProbe/><CreativeAssistant/>
    </CreativeStudioProvider>);
    fireEvent.click(screen.getByRole('button',{name:'测试生成'}));
    expect(await screen.findAllByText(/你要求按 12 × 10 米布置，但当前场地是 10 × 8 米/)).not.toHaveLength(0);
    expect(ensure).not.toHaveBeenCalled();expect(controller.startAgentRun).not.toHaveBeenCalled();expect(onApply).not.toHaveBeenCalled();
  });

  it('does not dispatch from the detailed form when the requested area is inconsistent with the scene footprint', async () => {
    connected();
    const brief={...initialBriefMemory(),areaM2:120};
    const actual={...layout,width:10,height:8};
    renderUI(<CreativeStudioProvider controller={controller} layout={actual} onApply={onApply} validateGenerationIntent={()=>venueDimensionsMismatch(brief,actual)}>
      <IntentGenerationProbe/><CreativeAssistant/>
    </CreativeStudioProvider>);
    fireEvent.click(screen.getByRole('button',{name:'测试生成'}));
    expect(await screen.findAllByText(/120 平方米.*80 平方米/)).not.toHaveLength(0);
    expect(controller.startAgentRun).not.toHaveBeenCalled();expect(onApply).not.toHaveBeenCalled();
  });

  it('rechecks unresolved needs after async cloud preparation and before dispatch or binding', async () => {
    snapshot={...snapshot,configured:true};
    const local=backendSceneToLayout(candidate,{name:'本地活动场地'});
    let finish!:()=>void, blocked=false;
    const ensure=vi.fn(()=>new Promise(resolve=>{finish=()=>resolve({ id: projectId });}));
    Object.assign(controller,{ensureWorkbenchReady:ensure});
    const bind=vi.fn();
    renderUI(<CreativeStudioProvider controller={controller} layout={local} onApply={onApply} onBindProject={bind}
      validateGenerationIntent={()=>blocked?'活动需求仍有待确认的内容，请先核对。':null}>
      <IntentGenerationProbe/><CreativeAssistant/>
    </CreativeStudioProvider>);
    fireEvent.click(screen.getByRole('button', { name: '测试生成' }));
    await waitFor(()=>expect(ensure).toHaveBeenCalledOnce());
    blocked=true;
    await act(async()=>finish());
    expect(await screen.findAllByText('活动需求仍有待确认的内容，请先核对。')).not.toHaveLength(0);
    expect(controller.startAgentRun).not.toHaveBeenCalled(); expect(bind).not.toHaveBeenCalled();
  });
  it('fills a readable reference from the current type and headcount without generating a scene',async()=>{
    connected();renderUI(ui());fireEvent.click(screen.getByRole('button',{name:'打开 Bingo Agent'}));
    const add=screen.getByRole('button',{name:'生成需求参考'});await waitFor(()=>expect(add.hasAttribute('disabled')).toBe(false));fireEvent.click(add);
    const demand=screen.getByRole('textbox',{name:'客户需求'}) as HTMLTextAreaElement;
    expect(demand.value).toBe(buildBriefReference({...INITIAL_BRIEF,event:'品牌快闪',guests:24}));
    expect(demand.value).toContain('【需求参考 · 这场活动】');
    expect(demand.value).not.toContain('品牌快闪');
    expect(demand.value).not.toMatch(/活动目标：\s*$/m);
    const generate=screen.getByRole('button',{name:'按这份细表生成预览'});expect(generate.hasAttribute('disabled')).toBe(false);
    expect(controller.startAgentRun).not.toHaveBeenCalled();expect(onApply).not.toHaveBeenCalled();
  });

  it('keeps the original text and refreshes the reference instead of stacking copies',async()=>{
    renderUI(ui());fireEvent.click(screen.getByRole('button',{name:'打开 Bingo Agent'}));
    const button=screen.getByRole('button',{name:'生成需求参考'});
    await waitFor(()=>expect(button.hasAttribute('disabled')).toBe(false));
    const input=screen.getByRole('textbox',{name:'客户需求'}) as HTMLTextAreaElement;
    fireEvent.change(input,{target:{value:'客户原话，请保留入口。'}});fireEvent.click(button);
    const reference=buildBriefReference({...INITIAL_BRIEF,event:'品牌快闪',guests:24});
    expect(input.value).toBe(`客户原话，请保留入口。\n\n${reference}`);
    fireEvent.click(button);
    expect(input.value).toBe(`客户原话，请保留入口。\n\n${reference}`);
    expect(screen.getByText('参考已是最新，未重复添加。')).toBeTruthy();
  });

  it('replaces a legacy blank scaffold on load instead of letting it block generation',async()=>{
    vi.mocked(readSourceForm).mockImplementation(async key=>key.endsWith(':brief')?{event:'工作坊',guests:16,description:'【创意简报与观众体验】\n活动目标：\n参与观众：\n布置要求：',mustHave:'',allowIdeas:true}:undefined);
    renderUI(ui());fireEvent.click(screen.getByRole('button',{name:'打开 Bingo Agent'}));
    const input=screen.getByRole('textbox',{name:'客户需求'}) as HTMLTextAreaElement;
    await waitFor(()=>expect(input.value).toBe(''));
    expect(screen.getByRole('button',{name:'按这份细表生成预览'}).hasAttribute('disabled')).toBe(true);
    const button=screen.getByRole('button',{name:'生成需求参考'});await waitFor(()=>expect(button.hasAttribute('disabled')).toBe(false));fireEvent.click(button);
    expect(input.value).toBe(buildBriefReference({...INITIAL_BRIEF,event:'工作坊',guests:16}));
    expect(input.value).not.toContain('活动目标：');
    expect(screen.getByRole('button',{name:'按这份细表生成预览'}).hasAttribute('disabled')).toBe(false);
  });

  it('leaves an oversized manual brief unchanged and reports the limit without truncating',async()=>{
    renderUI(ui());fireEvent.click(screen.getByRole('button',{name:'打开 Bingo Agent'}));
    const button=screen.getByRole('button',{name:'生成需求参考'});await waitFor(()=>expect(button.hasAttribute('disabled')).toBe(false));
    const input=screen.getByRole('textbox',{name:'客户需求'}) as HTMLTextAreaElement;const original='原'.repeat(1800);
    fireEvent.change(input,{target:{value:original}});fireEvent.click(button);
    expect(input.value).toBe(original);expect(screen.getByRole('alert').textContent).toContain('原文字保持不变');
  });

  it.each(['pending','failed'] as const)('does not generate a reference before the brief is safely readable (%s)',async state=>{
    vi.mocked(readSourceForm).mockImplementation(key=>key.endsWith(':brief')?state==='pending'?new Promise(()=>{}):Promise.reject(new Error('简报读取拒绝')):Promise.resolve(undefined));
    renderUI(ui());fireEvent.click(screen.getByRole('button',{name:'打开 Bingo Agent'}));
    const input=screen.getByRole('textbox',{name:'客户需求'}) as HTMLTextAreaElement;fireEvent.change(input,{target:{value:'读取期间保留的原输入'}});
    if(state==='failed')await screen.findByRole('alert');
    const button=screen.getByRole('button',{name:'生成需求参考'});expect(button.hasAttribute('disabled')).toBe(true);fireEvent.click(button);
    expect(input.value).toBe('读取期间保留的原输入');expect(vi.mocked(storeSourceForm).mock.calls.filter(([key])=>key.endsWith(':brief'))).toHaveLength(0);
  });

  it('keeps the reference button disabled while a backup operation is pending',async()=>{
    let actions!:LocalProjectBackupActions;
    function Probe(){actions=useLocalProjectBackup()!;return null;}
    renderUI(<CreativeStudioProvider controller={controller} layout={layout} onApply={onApply}><CreativeBriefPanel/><Probe/></CreativeStudioProvider>);
    const button=screen.getByRole('button',{name:'生成需求参考'});await waitFor(()=>expect(button.hasAttribute('disabled')).toBe(false));
    let finish!:(value:undefined)=>void;vi.mocked(readSourceForm).mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
    let preparation!:Promise<string>;act(()=>{preparation=actions.prepareBackup();});
    await waitFor(()=>expect(button.hasAttribute('disabled')).toBe(true));fireEvent.click(button);
    expect((screen.getByRole('textbox',{name:'客户需求'}) as HTMLTextAreaElement).value).toBe('');
    await waitFor(()=>expect(finish).toBeTypeOf('function'));await act(async()=>{finish(undefined);await preparation;});
    expect(button.hasAttribute('disabled')).toBe(false);
  });

  it.each(['activity', 'nested activity'] as const)('keeps unsupported %s out of a complete cloud project', async kind => {
    connected();
    const operations = { schemaVersion: 1 as const, dataKind: 'unspecified' as const, tasks: [] };
    const local = { ...layout, eventOperations: operations };
    const current = kind === 'activity' ? local : { ...layout, designBook: { activeId: 'parent', variants: [{ id: 'parent', name: '方案', layout: { ...layout, designBook: { activeId: 'leaf', variants: [{ id: 'leaf', name: '活动方案', layout: local }] } } }] } };
    const ready = vi.spyOn(controller, 'ensureWorkbenchReady');
    render(ui(current));
    fireEvent.change(screen.getByRole('textbox', { name: '告诉助手你的想法' }), { target: { value: '增加一张桌子' } });
    fireEvent.click(screen.getByRole('button', { name: '发送消息' }));
    await waitFor(() => expect(screen.getAllByText(LOCAL_HANDOFF_CLOUD_MESSAGE).length).toBeGreaterThan(0));
    expect(ready).not.toHaveBeenCalled(); expect(controller.startAgentRun).not.toHaveBeenCalled(); expect(onApply).not.toHaveBeenCalled();
    expect(local.eventOperations).toBe(operations);
  });

  it('preserves a local execution worksheet without preparing a cloud workbench or starting an Agent run', async () => {
    snapshot = { ...snapshot, configured: true };
    const local = backendSceneToLayout(candidate, { name: '本地执行场景' });
    local.floors[0]!.items[0]!.handoff = { ownerName: '布展负责人', dueDate: '2026-10-08', acceptance: '摆放完成并核对通道', status: 'todo', evidenceUrls: [], evidenceNote: '' };
    const ready = vi.spyOn(controller, 'ensureWorkbenchReady');
    const bind = vi.fn();
    render(<CreativeStudioProvider controller={controller} layout={local} onApply={onApply} onBindProject={bind}><CreativeAssistant/></CreativeStudioProvider>);
    fireEvent.change(screen.getByRole('textbox', { name: '告诉助手你的想法' }), { target: { value: '增加一张桌子' } });
    fireEvent.click(screen.getByRole('button', { name: '发送消息' }));
    await waitFor(() => expect(screen.getAllByText(LOCAL_HANDOFF_CLOUD_MESSAGE).length).toBeGreaterThan(0));
    expect(ready).not.toHaveBeenCalled();
    expect(controller.startAgentRun).not.toHaveBeenCalled();
    expect(bind).not.toHaveBeenCalled();
    expect(onApply).not.toHaveBeenCalled();
    expect(local.floors[0]!.items[0]!.handoff?.ownerName).toBe('布展负责人');
  });

  it('reports the new cloud binding and does not submit the old activity request automatically', async () => {
    snapshot={...snapshot,configured:true};
    const local={...backendSceneToLayout(candidate,{name:'本地活动场地'})};
    let finish!:()=>void;
    const ensureWorkbenchReady=vi.fn(()=>new Promise(resolve=>{finish=()=>{connected();resolve(snapshot.project);};}));
    Object.assign(controller,{ensureWorkbenchReady});
    prepareProposal.mockResolvedValueOnce({...proposal,base_scene:candidate,candidate:scene});
    vi.mocked(controller.startAgentRun).mockImplementationOnce(async input=>({...runFrom(await prepareProposal(input),input),executionMode:'preview'}));
    function Harness(){
      const [value,setValue]=useState(local);
      return <CreativeStudioProvider controller={controller} layout={value} onApply={onApply} onBindProject={id=>setValue(current=>({...current,id}))}><CreativeAssistant/></CreativeStudioProvider>;
    }
    renderUI(<Harness/>);
    fireEvent.click(screen.getByRole('button',{name:'打开 Bingo Agent'}));
    enterBrief();
    const instruction='生成一张长 1.6 米、宽 0.8 米、高 0.75 米的矩形桌，先给预览';
    fireEvent.change(screen.getByRole('textbox',{name:'告诉助手你的想法'}),{target:{value:instruction}});
    fireEvent.click(screen.getByRole('button',{name:'发送消息'}));
    await waitFor(()=>expect(ensureWorkbenchReady).toHaveBeenCalledOnce());
    expect(prepareProposal).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole('textbox',{name:'告诉助手你的想法'}),{target:{value:'下一条还没发送的需求'}});
    await act(async()=>finish());
    expect((await screen.findAllByText(/云项目已建立.*本次未提交生成/)).length).toBeGreaterThan(0);
    expect(prepareProposal).not.toHaveBeenCalled();
    expect(controller.startAgentRun).not.toHaveBeenCalled();
    await waitFor(()=>expect((screen.getByRole('textbox',{name:'客户需求'}) as HTMLTextAreaElement).value).not.toContain('24 位来宾'));
    expect((screen.getByRole('textbox',{name:'告诉助手你的想法'}) as HTMLTextAreaElement).value).toBe('');
    fireEvent.click(screen.getByText('其他活动的未发送草稿'));expect(screen.getByText('下一条还没发送的需求')).toBeTruthy();
    expect(screen.getByText(/刷新或关闭后会丢失/)).toBeTruthy();fireEvent.click(screen.getByRole('button',{name:'取回到当前输入'}));
    expect((screen.getByRole('textbox',{name:'告诉助手你的想法'}) as HTMLTextAreaElement).value).toBe('下一条还没发送的需求');
    expect(screen.queryByText(/请在右上「项目」的「我的项目」中核对/)).toBeNull();
    expect(onApply).not.toHaveBeenCalled();
  });
  it('keeps unsent activity drafts available after the assistant unmounts without inserting them into another activity',async()=>{
    const first={...layout,id:'draft-A'},second={...layout,id:'draft-B'};
    const tree=(value:RoomLayout)=><CreativeStudioProvider controller={controller} layout={value} onApply={onApply}><CreativeAssistant/></CreativeStudioProvider>;
    const view=render(tree(first));fireEvent.change(screen.getByRole('textbox',{name:'告诉助手你的想法'}),{target:{value:'A 的未发送草稿'}});
    view.rerender(tree(second));await waitFor(()=>expect((screen.getByRole('textbox',{name:'告诉助手你的想法'}) as HTMLTextAreaElement).value).toBe(''));
    view.unmount();const event=new Event('beforeunload',{cancelable:true});window.dispatchEvent(event);expect(event.defaultPrevented).toBe(true);
    render(tree(second));fireEvent.click(screen.getByText('其他活动的未发送草稿'));expect(screen.getByText('A 的未发送草稿')).toBeTruthy();
    expect((screen.getByRole('textbox',{name:'告诉助手你的想法'}) as HTMLTextAreaElement).value).toBe('');
  });

  it.each(['scene','brief','cancel'] as const)('does not start a paid Agent run if %s changes during automatic workbench preparation', async change=>{
    snapshot={...snapshot,configured:true};
    const local=backendSceneToLayout(candidate,{name:'本地活动场地'});
    let finish!:()=>void;
    const ready=vi.fn(()=>new Promise(resolve=>{finish=()=>{connected();resolve(snapshot.project);};}));
    Object.assign(controller,{ensureWorkbenchReady:ready});
    const rendered=render(ui(local));
    fireEvent.change(screen.getByRole('textbox',{name:'告诉助手你的想法'}),{target:{value:'生成一张桌子，先预览'}});
    fireEvent.click(screen.getByRole('button',{name:'发送消息'}));
    await waitFor(()=>expect(ready).toHaveBeenCalledOnce());
    if(change==='scene')rendered.rerender(ui({...local,name:'正在编辑的新场地'}));
    else if(change==='brief')enterBrief();
    else fireEvent.click(screen.getByRole('button',{name:'取消任务'}));
    await act(async()=>finish());
    expect(prepareProposal).not.toHaveBeenCalled();
    expect(onApply).not.toHaveBeenCalled();
  });

  it('opens complete templates separately without losing the planning draft or invoking generation', async () => {
    connected();
    const preset:RoomLayout={...layout,name:'办公室 · 留白',scenePreset:'office'};
    vi.mocked(loadScenePreset).mockResolvedValueOnce(preset);
    const create=vi.spyOn(controller,'createGenerationJob');
    renderUI(ui());
    fireEvent.click(screen.getByRole('button',{name:'打开 Bingo Agent'}));
    fireEvent.change(screen.getByRole('textbox',{name:'告诉助手你的想法'}),{target:{value:'保留这条未发送的需求'}});
    selectBusiness('场景模板');
    expect(screen.getAllByRole('button',{name:/载入模板/})).toHaveLength(10);
    fireEvent.click(screen.getByRole('button',{name:'返回当前工作区'}));
    expect((screen.getByRole('textbox',{name:'告诉助手你的想法'}) as HTMLTextAreaElement).value).toBe('保留这条未发送的需求');
    selectBusiness('场景模板');
    fireEvent.click(screen.getByRole('button',{name:/办公室 · 留白/}));
    expect(loadScenePreset).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button',{name:'确认载入'}));
    await waitFor(()=>expect(onApply).toHaveBeenCalledWith({...preset,id:layout.id,name:layout.name}));
    expect(loadScenePreset).toHaveBeenCalledWith('office');
    expect(prepareProposal).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
    expect(screen.getByRole('option',{name:'物料生成'})).toBeTruthy();
  });

  it('ignores a pending template download after returning to the current workspace', async () => {
    let finish!:(value:RoomLayout)=>void;
    vi.mocked(loadScenePreset).mockReset().mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
    renderUI(ui());fireEvent.click(screen.getByRole('button',{name:'打开 Bingo Agent'}));selectMode('model');
    fireEvent.change(screen.getByRole('textbox',{name:'告诉助手你的想法'}),{target:{value:'仍在建模的未发送输入'}});
    selectBusiness('场景模板');
    fireEvent.click(screen.getByRole('button',{name:/办公室 · 留白/}));
    expect(loadScenePreset).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button',{name:'确认载入'}));
    expect(loadScenePreset).toHaveBeenCalledOnce();expect(onApply).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button',{name:'返回当前工作区'}));
    await act(async()=>{finish({...layout,name:'迟到的办公室模板',scenePreset:'office'});});
    expect(onApply).not.toHaveBeenCalled();expect(controller.startAgentRun).not.toHaveBeenCalled();
    expect((screen.getByRole('combobox',{name:'工作模式'}) as HTMLSelectElement).value).toBe('model');
    expect((screen.getByRole('textbox',{name:'告诉助手你的想法'}) as HTMLTextAreaElement).value).toBe('仍在建模的未发送输入');
  });

  it('keeps text planning available alongside reconstruction for an existing v2 scene',async()=>{
    render(ui(createMeasuredRoomLayout(layout,{width:12,depth:10,height:3})));
    expect(screen.getByRole('button',{name:'按这份细表生成预览'})).toBeTruthy();
    expect(screen.getByText('按这份细表生成预览')).toBeTruthy();
    selectBusiness('场地重建');
    await waitFor(()=>expect(screen.getByRole('button',{name:'生成布置预览'}).hasAttribute('disabled')).toBe(false));
  });

  it('sends full resource requirements to the Agent without a built-in catalogue rejection', async () => {
    connected();render(ui());
    fireEvent.change(screen.getByRole('textbox', { name: '客户需求' }), { target: { value: '需要圆桌和帐篷，安排24人交流会' } });
    fireEvent.click(screen.getByRole('button', { name: '按这份细表生成预览' }));
    await screen.findByText('方案提案 · 尚未应用');
    expect(prepareProposal).toHaveBeenCalledWith(expect.objectContaining({ context:expect.objectContaining({brief: expect.stringContaining('需要圆桌和帐篷')}) }));
    expect(screen.queryByText('圆桌的处理方式')).toBeNull();
  });

  it('lets the Agent select a library tent and loads the authorized GLB before applying', async () => {
    connected();
    const assetId='50000000-0000-4000-8000-000000000001';
    const assetCandidate:Scene={...candidate,objects:[{...candidate.objects[0],materialId:'asset',assetId}]};
    const assetProposal={...proposal,candidate:assetCandidate};
    vi.mocked(prepareProposal).mockResolvedValueOnce(assetProposal);
    vi.mocked(controller.authorizeAssets).mockResolvedValueOnce({assetUrls:{[assetId]:'https://storage.example/tent.glb'},assetNames:{[assetId]:'资源库帐篷'}});
    vi.mocked(controller.applySceneProposal).mockResolvedValueOnce({id:projectId,revision:2,scene:assetCandidate,previousScene:scene,updatedAt:'2026-10-03T10:00:00Z',undoGroup:'undo-test',acceptedLocally:true});
    renderUI(ui());fireEvent.click(screen.getByRole('button',{name:'打开 Bingo Agent'}));
    fireEvent.change(screen.getByRole('textbox',{name:'告诉助手你的想法'}),{target:{value:'从资源库加入一顶帐篷'}});
    fireEvent.click(screen.getByRole('button',{name:'发送消息'}));
    await screen.findByText('方案提案 · 尚未应用');expect(onApply).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:'确认布置'}));await waitFor(()=>expect(onApply).toHaveBeenCalledOnce());
    expect(prepareProposal).toHaveBeenCalledWith(expect.objectContaining({instruction:expect.stringContaining('从资源库加入一顶帐篷')}));
    expect(ensureGlbAsset).toHaveBeenCalledWith(assetId,'https://storage.example/tent.glb');
    expect(controller.applySceneProposal).toHaveBeenCalledWith(assetProposal,layoutToBackendScene(layout));
    expect(onApply.mock.calls[0]![0].floors[0].items[0]).toMatchObject({assetId,name:'资源库帐篷'});
  });

  it('shows an unsupported shape without exposing HY3 creation', async () => {
    connected();
    prepareProposal.mockResolvedValueOnce({...proposal,candidate:scene,explanation:'资源库和参数族暂不支持花形拱门。'});
    vi.spyOn(controller,'listGenerationJobs').mockResolvedValue([]);
    const create=vi.spyOn(controller,'createGenerationJob');
    renderUI(<CreativeStudioProvider controller={controller} layout={layout} onApply={onApply}><CreativeAssistant generationPanel={<GeneratedModelLibrary controller={controller} onAdd={vi.fn()}/>}/></CreativeStudioProvider>);
    fireEvent.click(screen.getByRole('button',{name:'打开 Bingo Agent'}));
    fireEvent.change(screen.getByRole('textbox',{name:'告诉助手你的想法'}),{target:{value:'添加花形拱门'}});
    fireEvent.click(screen.getByRole('button',{name:'发送消息'}));
    await screen.findByText('资源库和参数族暂不支持花形拱门。');
    selectMode('model');
    expect(screen.queryByRole('button',{name:/HY3|生成 3D 模型/})).toBeNull();
    expect(screen.getByRole('heading',{name:'历史模型'})).toBeTruthy();
    expect(controller.authorizeAssets).not.toHaveBeenCalled();expect(create).not.toHaveBeenCalled();expect(onApply).not.toHaveBeenCalled();
  });

  it('hands exact material targets to a preview without applying the scene or calling HY3', async () => {
    connected();
    const suggestion={name:'椅面换色',reason:'保留原模型，调整选中椅子的基础色',objectIds:['20000000-0000-4000-8000-000000000001'],sourceAssetId:'50000000-0000-4000-8000-000000000001',scope:'choose_materials' as const,changes:{baseColor:'#aabbcc'}};
    vi.mocked(prepareProposal).mockResolvedValueOnce({...proposal,candidate:scene,materialSuggestions:[suggestion]});
    const create=vi.spyOn(controller,'createGenerationJob');
    renderUI(ui());fireEvent.click(screen.getByRole('button',{name:'打开 Bingo Agent'}));
    fireEvent.change(screen.getByRole('textbox',{name:'告诉助手你的想法'}),{target:{value:'把选中椅子的椅面改为灰蓝色'}});
    fireEvent.click(screen.getByRole('button',{name:'发送消息'}));
    { const original=await screen.findByText(suggestion.reason); const disclosure=original.closest('details')!; expect(disclosure.open).toBe(false); fireEvent.click(within(disclosure).getByText('查看模型原文（未经核验）')); }
    fireEvent.click(await screen.findByRole('button',{name:'预览材质调整'}));
    expect(JSON.parse(screen.getByTestId('material-seed').textContent!)).toMatchObject({sourceAssetId:suggestion.sourceAssetId,objectIds:suggestion.objectIds,changes:suggestion.changes,materialScope:'choose_materials',projectId,userId:'test-user'});
    expect(controller.applySceneProposal).not.toHaveBeenCalled();expect(onApply).not.toHaveBeenCalled();expect(create).not.toHaveBeenCalled();
    expect(screen.getByRole('button',{name:'材质调整'}).getAttribute('aria-pressed')).toBe('true');
    openExecution();
    fireEvent.click(screen.getByRole('tab',{name:'导出'}));
    expect(screen.getByRole('button',{name:'导出场景 GLB'})).toBeTruthy();
    selectMode('model');
    expect(screen.getByRole('button',{name:'材质调整'}).getAttribute('aria-pressed')).toBe('true');
  });
  it('tracks the newly applied version so the same instances can restore their parent', async () => {
    connected();
    const sourceAssetId='50000000-0000-4000-8000-000000000001',variantAssetId='50000000-0000-4000-8000-000000000002';
    const base:Scene={...candidate,objects:[{...candidate.objects[0]!,materialId:'asset',assetId:sourceAssetId}]};
    const current=backendSceneToLayout(base,{projectId,name:'材质测试'});
    const suggestion={objectIds:[base.objects[0]!.id],sourceAssetId,name:'蓝色椅子',reason:'仅选中实例',scope:'all_materials' as const,changes:{baseColor:'#285fad'}};
    vi.mocked(prepareProposal).mockResolvedValueOnce({...proposal,base_scene:base,candidate:base,materialSuggestions:[suggestion]});
    function Harness(){const [value,setValue]=useState(current);return <CreativeStudioProvider controller={controller} layout={value} onApply={setValue}><CreativeAssistant/></CreativeStudioProvider>;}
    renderUI(<Harness/>);fireEvent.click(screen.getByRole('button',{name:'打开 Bingo Agent'}));
    fireEvent.change(screen.getByRole('textbox',{name:'告诉助手你的想法'}),{target:{value:'给椅子换色'}});fireEvent.click(screen.getByRole('button',{name:'发送消息'}));
    { const original=await screen.findByText(suggestion.reason); const disclosure=original.closest('details')!; expect(disclosure.open).toBe(false); fireEvent.click(within(disclosure).getByText('查看模型原文（未经核验）')); }
    fireEvent.click(await screen.findByRole('button',{name:'预览材质调整'}));
    act(()=>materialProps.onApply({...current,floors:current.floors.map(floor=>({...floor,items:floor.items.map(item=>({...item,assetId:variantAssetId}))}))}));
    expect(materialProps.seed).toMatchObject({sourceAssetId:variantAssetId,objectIds:suggestion.objectIds});
    expect(materialProps.seed!.changes).toBeUndefined();
    fireEvent.click(screen.getByRole('button',{name:'使用当前选中物件'}));expect(materialProps.seed).toBeUndefined();
  });

  it('ignores a late suggestion after the signed-in account changes', async () => {
    connected();let finish!:(value:SceneProposal)=>void;
    vi.mocked(prepareProposal).mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
    const view=renderUI(ui());fireEvent.click(screen.getByRole('button',{name:'打开 Bingo Agent'}));
    fireEvent.change(screen.getByRole('textbox',{name:'告诉助手你的想法'}),{target:{value:'添加花形拱门'}});
    fireEvent.click(screen.getByRole('button',{name:'发送消息'}));
    await waitFor(()=>expect(finish).toBeTypeOf('function'));
    snapshot={...snapshot,user:{id:'another-user'}};view.rerender(ui());
    await act(async()=>{finish({...proposal,candidate:scene,modelSuggestions:[{name:'花形拱门',reason:'缺少该资源',prompt:'单件花形拱门'}]});});
    expect(screen.queryByRole('button',{name:'前往 HY3 生成'})).toBeNull();
    expect(controller.applySceneProposal).not.toHaveBeenCalled();expect(onApply).not.toHaveBeenCalled();
  });

  it('moves keyboard focus into the assistant and returns it on Escape', async () => {
    renderUI(ui());
    const launch = screen.getByRole('button', { name: '打开 Bingo Agent' });
    fireEvent.click(launch);
    expect(screen.getByRole('region',{name:'Agent'}).querySelector<HTMLImageElement>('img[alt="Bingo"]')?.getAttribute('src')).toBe('/assets/assistant/qingguang-3d-24@2x.png');
    const input = screen.getByRole('textbox', { name: '告诉助手你的想法' });
    expect(document.activeElement).toBe(input);
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByRole('region', { name: 'Agent' })).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: '打开 Bingo Agent' })));
  });

  it('explains the missing AI connection offline without fabricating a proposal or changing the scene', async () => {
    render(ui());
    expect(screen.getByRole('button', { name: '按这份细表生成预览' }).hasAttribute('disabled')).toBe(true);
    enterBrief();
    fireEvent.click(screen.getByRole('button', { name: '按这份细表生成预览' }));
    expect(await screen.findByRole('region', { name: 'Agent' })).toBeTruthy();
    expect(screen.getByRole('status').textContent).toContain('生成能力尚未连接服务商');
    expect(screen.queryByText('方案提案 · 尚未应用')).toBeNull();
    expect(screen.queryByRole('button', { name: '确认布置' })).toBeNull();
    expect(prepareProposal).not.toHaveBeenCalled();
    expect(onApply).not.toHaveBeenCalled();
  });

  it('shows local reference images and releases their URLs', async () => {
    vi.spyOn(sourceStorage, 'storeSource').mockResolvedValue(undefined);
    vi.spyOn(sourceStorage, 'deleteSource').mockResolvedValue(undefined);
    const rendered = render(ui());
    const file = new File(['image fixture'], 'venue.png', { type: 'image/png' });
    selectBusiness('图纸与照片');
    upload(rendered.container, [file]);
    await screen.findByRole('img', { name: '现场照片：venue.png' });
    expect(screen.getByLabelText('场地尺寸')).toBeTruthy();
    expect(prepareProposal).not.toHaveBeenCalled();
    selectBusiness('活动需求');
    expect(screen.getByRole('button',{name:'按这份细表生成预览'})).toBeTruthy();
    expect(screen.getByText('按这份细表生成预览')).toBeTruthy();
    selectBusiness('图纸与照片');
    fireEvent.click(screen.getByRole('button', { name: '移除 venue.png' }));
    await waitFor(() => expect(screen.queryByRole('img', { name: '现场照片：venue.png' })).toBeNull());
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:local-reference');
    upload(rendered.container, [file]);
    await screen.findByRole('img', { name: '现场照片：venue.png' });
    rendered.unmount();
    expect(revokeObjectURL).toHaveBeenCalledTimes(2);
  });

  it('persists the upload entry classification and restores it without reclassifying existing photos', async () => {
    const storage = await import('@/lib/source-storage');
    const stored = vi.spyOn(storage, 'storeSource').mockResolvedValue(undefined);
    const cloudUpload = vi.spyOn(controller, 'uploadSource');
    const current = createMeasuredRoomLayout(layout, { width: 12, depth: 10, height: 3 });
    const view = render(ui(current));
    selectBusiness('图纸与照片');
    await screen.findByLabelText('上传核对平面图');
    upload(view.container, [new File(['photo'], 'camera.png', { type: 'image/png' })]);
    await screen.findByRole('img', { name: '现场照片：camera.png' });
    fireEvent.change(screen.getByLabelText('上传核对平面图'), {
      target: { files: [new File(['plan'], 'scan.png', { type: 'image/png' })] },
    });
    await screen.findByRole('img', { name: '平面图：scan.png' });
    await waitFor(() => expect(stored).toHaveBeenCalledTimes(2));
    expect(stored.mock.calls.map(([image]) => ({ name: image.name, kind: image.kind, scope: image.scope }))).toEqual([
      { name: 'camera.png', kind: 'photo', scope: projectId }, { name: 'scan.png', kind: 'floorplan', scope: projectId },
    ]);
    expect((screen.getByRole('combobox', { name: 'camera.png 的资料类型' }) as HTMLSelectElement).value).toBe('photo');
    expect((screen.getByRole('combobox', { name: 'scan.png 的资料类型' }) as HTMLSelectElement).value).toBe('floorplan');
    const records = stored.mock.calls.map(([image]) => image);
    view.unmount(); vi.mocked(listStoredSources).mockResolvedValue(records);
    render(ui(current));
    selectBusiness('图纸与照片');
    expect(await screen.findByRole('img', { name: '现场照片：camera.png' })).toBeTruthy();
    expect(await screen.findByRole('img', { name: '平面图：scan.png' })).toBeTruthy();
    expect(cloudUpload).not.toHaveBeenCalled(); expect(controller.startAgentRun).not.toHaveBeenCalled();
  });

  it.each(['photo', 'floorplan'] as const)('keeps an in-flight %s file downloadable after switching projects without writing it to the new one', async kind => {
    const storage = await import('@/lib/source-storage');
    const stored = vi.spyOn(storage, 'storeSource').mockResolvedValue(undefined), close = vi.fn();
    let finish!: (bitmap: { width: number; height: number; close(): void }) => void;
    createBitmap.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const current = createMeasuredRoomLayout(layout, { width: 12, depth: 10, height: 3 });
    const view = render(ui(current)), file = new File(['old project'], 'old-scan.png', { type: 'image/png' });
    selectBusiness('图纸与照片');
    await screen.findByLabelText('上传核对平面图');
    if (kind === 'photo') upload(view.container, [file]);
    else fireEvent.change(screen.getByLabelText('上传核对平面图'), { target: { files: [file] } });
    await waitFor(() => expect(createBitmap).toHaveBeenCalledOnce());
    view.rerender(ui({ ...current, id: 'different-local-project' }));
    await act(async () => finish({ width: 1024, height: 768, close }));
    expect(close).toHaveBeenCalledOnce(); expect(stored).not.toHaveBeenCalled();
    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(screen.queryByRole('img', { name: /old-scan/ })).toBeNull();
    expect(screen.getByText(/其他活动 · old-scan.png/)).toBeTruthy();
    expect(screen.getByRole('link', { name: '下载原图' })).toBeTruthy();
    expect(controller.startAgentRun).not.toHaveBeenCalled();
  });

  it.each([
    ['unsupported format', () => new File(['vector'], 'venue.svg', { type: 'image/svg+xml' }), '请选择 PNG、JPEG 或 WebP 图片。'],
    ['oversized file', () => new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'venue.png', { type: 'image/png' }), '每张图片不能超过 5 MB。'],
  ])('rejects %s before creating a preview or decoding', async (_case, file, message) => {
    const rendered = render(ui());
    selectBusiness('图纸与照片');
    upload(rendered.container, [file()]);
    expect(await screen.findByText(message)).toBeTruthy();
    expect(screen.queryByRole('img', { name: '现场照片：venue.png' })).toBeNull();
    expect(createBitmap).not.toHaveBeenCalled();
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  it('closes an oversized decoded bitmap without adding a preview, while retaining the original file', async () => {
    const close = vi.fn();
    createBitmap.mockResolvedValueOnce({ width: 5000, height: 768, close });
    const rendered = render(ui());
    selectBusiness('图纸与照片');
    upload(rendered.container, [new File(['image'], 'wide.png', { type: 'image/png' })]);
    expect(await screen.findByText('图片长宽请控制在 4096 像素以内。')).toBeTruthy();
    expect(close).toHaveBeenCalledOnce();
    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(screen.getByRole('link', { name: '下载原图' })).toBeTruthy();
    expect(screen.queryByRole('img', { name: /wide.png/ })).toBeNull();
  });

  it.each(['消防验收通过','疏散没有问题','无障碍完全达标','紧急出口绝对安全'])('keeps model safety claim behind explicit unverified disclosure: %s',async claim=>{
    connected();vi.mocked(prepareProposal).mockResolvedValueOnce({...proposal,explanation:claim});
    render(ui());await generatePreview();
    const originals=screen.getAllByText(claim);
    expect(originals.length).toBeGreaterThan(0);
    for(const original of originals){const disclosure=original.closest('details');expect(disclosure).not.toBeNull();expect(disclosure!.open).toBe(false);expect(disclosure!.textContent).toContain('不代表消防');}
    expect(screen.getByText('请核对下方实际改动；通行、消防及规范条件仍需独立核验。')).toBeTruthy();
    fireEvent.click(within(originals[0]!.closest('details')!).getByText('查看模型原文（未经核验）'));
    expect(originals[0]!.closest('details')!.open).toBe(true);
  });

  it('presents the actual proposal for confirmation and applies only after the confirmation request succeeds', async () => {
    connected();
    render(ui());
    await generatePreview();
    expect(onPreview).toHaveBeenLastCalledWith(expect.objectContaining({ id: projectId }));
    expect(prepareProposal).toHaveBeenCalledWith(expect.objectContaining({ scene: layoutToBackendScene(layout), context: expect.objectContaining({brief:expect.stringContaining('给 24 位来宾')}) }));
    expect(onApply).not.toHaveBeenCalled();
    expect(controller.applySceneProposal).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '确认布置' }));
    await waitFor(() => expect(onApply).toHaveBeenCalledOnce());
    expect(onApply.mock.calls[0]![0].designBook?.variants.map(v => v.name)).toEqual(['原始方案', 'AI 方案 A']);
    expect(controller.applySceneProposal).toHaveBeenCalledWith(proposal, layoutToBackendScene(layout));
    expect(layoutToBackendScene(onApply.mock.calls[0][0])).toEqual(candidate);
    expect(onApply.mock.calls[0][0].designBook?.variants.map(variant=>variant.name)).toEqual(['原始方案','AI 方案 A']);
    expect(screen.queryByText('方案提案 · 尚未应用')).toBeNull();
  });

  it('blocks a known shortage through the deep confirmation entry',async()=>{
    connected();render(<CreativeStudioProvider controller={controller} layout={layout} onApply={onApply} onPreview={onPreview}><InventoryReviewProbe available={0}/><CreativeAssistant/></CreativeStudioProvider>);
    await generatePreview();fireEvent.click(screen.getByRole('button',{name:'核对数量'}));
    fireEvent.click(screen.getByRole('button',{name:'确认布置'}));
    expect((await screen.findAllByText(/缺 \d+ 件椅子/)).length).toBeGreaterThan(0);
    expect(controller.applySceneProposal).not.toHaveBeenCalled();expect(onApply).not.toHaveBeenCalled();
  });
  it('blocks invalid inventory input through the deep confirmation entry',async()=>{
    connected();render(<CreativeStudioProvider controller={controller} layout={layout} onApply={onApply} onPreview={onPreview}><InventoryReviewProbe available={0} invalidInput/><CreativeAssistant/></CreativeStudioProvider>);
    await generatePreview();fireEvent.click(screen.getByRole('button',{name:'核对数量'}));
    fireEvent.click(screen.getByRole('button',{name:'确认布置'}));
    expect((await screen.findAllByText(/物料数量输入无效/)).length).toBeGreaterThan(0);
    expect(controller.applySceneProposal).not.toHaveBeenCalled();expect(onApply).not.toHaveBeenCalled();
  });
  it('keeps an invalid entry blocked after the inventory panel unmounts and remounts',async()=>{
    connected();render(<CreativeStudioProvider controller={controller} layout={layout} onApply={onApply} onPreview={onPreview}><RemountInventoryProbe/><CreativeAssistant/></CreativeStudioProvider>);
    await generatePreview();fireEvent.change(screen.getByRole('textbox',{name:/椅子.*候选 1 件/}),{target:{value:'-1'}});
    fireEvent.click(screen.getByRole('button',{name:'切换数量面板'}));fireEvent.click(screen.getByRole('button',{name:'切换数量面板'}));
    expect((screen.getByRole('textbox',{name:/椅子.*候选 1 件/}) as HTMLInputElement).value).toBe('-1');
    fireEvent.click(screen.getByRole('button',{name:'确认布置'}));
    expect((await screen.findAllByText(/物料数量输入无效/)).length).toBeGreaterThan(0);
    expect(controller.applySceneProposal).not.toHaveBeenCalled();
  });

  it('checks inherited counts synchronously at the deep confirmation entry',async()=>{
    connected();vi.spyOn(assistantSessions,'getActiveAssistantSessionId').mockReturnValue('chat-a');
    const {first,other}=sharedAssetCandidates();
    vi.mocked(controller.startAgentRun).mockImplementationOnce(async input=>({...runFrom(first,input),candidates:[{label:'A',title:'方案A',proposal:first},{label:'B',title:'方案B',proposal:other}]}));
    render(<CreativeStudioProvider controller={controller} layout={layout} onApply={onApply} onPreview={onPreview}><RememberAndSwitchInventoryProbe/><CreativeAssistant/></CreativeStudioProvider>);
    await generatePreview();fireEvent.click(screen.getByRole('button',{name:'记住数量并换方案'}));
    fireEvent.click(screen.getByRole('button',{name:'确认布置'}));
    expect((await screen.findAllByText(/缺 \d+ 件椅子/)).length).toBeGreaterThan(0);
    expect(controller.applySceneProposal).not.toHaveBeenCalled();expect(onApply).not.toHaveBeenCalled();
  });
  it('keeps invalid input blocked in the next candidate instead of reusing the old sufficient count',async()=>{
    connected();vi.spyOn(assistantSessions,'getActiveAssistantSessionId').mockReturnValue('chat-a');
    const {first,other}=sharedAssetCandidates();
    vi.mocked(controller.startAgentRun).mockImplementationOnce(async input=>({...runFrom(first,input),candidates:[{label:'A',title:'方案A',proposal:first},{label:'B',title:'方案B',proposal:other}]}));
    render(<CreativeStudioProvider controller={controller} layout={layout} onApply={onApply} onPreview={onPreview}><RememberAndSwitchInventoryProbe invalidInput/><CreativeAssistant/></CreativeStudioProvider>);
    await generatePreview();fireEvent.click(screen.getByRole('button',{name:'记住数量并换方案'}));
    fireEvent.click(screen.getByRole('button',{name:'确认布置'}));
    expect((await screen.findAllByText(/物料数量输入无效/)).length).toBeGreaterThan(0);
    expect(controller.applySceneProposal).not.toHaveBeenCalled();
  });

  it('invalidates a candidate when its inherited inventory session switches away and back',async()=>{
    connected();vi.spyOn(assistantSessions,'getActiveAssistantSessionId').mockReturnValue('chat-a');
    const listeners=new Set<(id:string|null)=>void>();
    vi.spyOn(assistantSessions,'subscribeActiveAssistantSession').mockImplementation((_scope,listener)=>{listeners.add(listener);return ()=>{listeners.delete(listener);};});
    const {first,other}=sharedAssetCandidates();
    vi.mocked(controller.startAgentRun).mockImplementationOnce(async input=>({...runFrom(first,input),candidates:[{label:'A',title:'方案A',proposal:first},{label:'B',title:'方案B',proposal:other}]}));
    render(<CreativeStudioProvider controller={controller} layout={layout} onApply={onApply} onPreview={onPreview}><RememberAndSwitchInventoryProbe/><CreativeAssistant/></CreativeStudioProvider>);
    await generatePreview();fireEvent.click(screen.getByRole('button',{name:'记住数量并换方案'}));
    const confirm=screen.getByRole('button',{name:'确认布置'});
    act(()=>{for(const listener of listeners)listener('chat-b');for(const listener of listeners)listener('chat-a');confirm.click();});
    expect(controller.applySceneProposal).not.toHaveBeenCalled();expect(onApply).not.toHaveBeenCalled();
  });
  it('invalidates inherited inventory and its candidate on an account A to B to A switch',async()=>{
    connected();vi.spyOn(assistantSessions,'getActiveAssistantSessionId').mockReturnValue('chat-a');
    const listeners=new Set<()=>void>();
    vi.spyOn(controller,'subscribe').mockImplementation(listener=>{listeners.add(listener);return ()=>{listeners.delete(listener);};});
    const {first,other}=sharedAssetCandidates();
    vi.mocked(controller.startAgentRun).mockImplementationOnce(async input=>({...runFrom(first,input),candidates:[{label:'A',title:'方案A',proposal:first},{label:'B',title:'方案B',proposal:other}]}));
    render(<CreativeStudioProvider controller={controller} layout={layout} onApply={onApply} onPreview={onPreview}><RememberAndSwitchInventoryProbe/><CreativeAssistant/></CreativeStudioProvider>);
    await generatePreview();fireEvent.click(screen.getByRole('button',{name:'记住数量并换方案'}));
    const confirm=screen.getByRole('button',{name:'确认布置'}),original=snapshot.user;
    act(()=>{snapshot.user={id:'different-user'};for(const listener of listeners)listener();snapshot.user=original;for(const listener of listeners)listener();confirm.click();});
    expect(controller.applySceneProposal).not.toHaveBeenCalled();expect(onApply).not.toHaveBeenCalled();
  });

  it('does not treat unlisted inventory as zero when confirming a draft',async()=>{
    connected();render(<CreativeStudioProvider controller={controller} layout={layout} onApply={onApply} onPreview={onPreview}><InventoryReviewProbe available={50}/><CreativeAssistant/></CreativeStudioProvider>);
    await generatePreview();fireEvent.click(screen.getByRole('button',{name:'核对数量'}));
    fireEvent.click(screen.getByRole('button',{name:'确认布置'}));
    await waitFor(()=>expect(controller.applySceneProposal).toHaveBeenCalledOnce());
  });

  it('allows a reviewed candidate when the successful cloud apply advances revisions',async()=>{
    connected();const listeners=new Set<()=>void>();
    vi.spyOn(controller,'subscribe').mockImplementation(listener=>{listeners.add(listener);return ()=>{listeners.delete(listener);};});
    vi.mocked(controller.applySceneProposal).mockImplementationOnce(async()=>{
      snapshot.revision=2;snapshot.localRevision=1;
      snapshot.project={...snapshot.project!,revision:2,scene:candidate};
      if(snapshot.lease)snapshot.lease={...snapshot.lease,revision:2};
      for(const listener of listeners)listener();
      return {id:projectId,revision:2,scene:candidate,previousScene:scene,updatedAt:'2026-10-02T10:00:00Z',undoGroup:'undo-test',acceptedLocally:true};
    });
    render(<CreativeStudioProvider controller={controller} layout={layout} onApply={onApply} onPreview={onPreview}><InventoryReviewProbe available={50}/><CreativeAssistant/></CreativeStudioProvider>);
    await generatePreview();fireEvent.click(screen.getByRole('button',{name:'核对数量'}));fireEvent.click(screen.getByRole('button',{name:'确认布置'}));
    await waitFor(()=>expect(onApply).toHaveBeenCalledOnce());
    expect(screen.queryByText(/云端提交结果尚不明确/)).toBeNull();
  });

  it('rejects a deep confirmation when the inventory review belongs to another account',async()=>{
    connected();render(<CreativeStudioProvider controller={controller} layout={layout} onApply={onApply} onPreview={onPreview}><InventoryReviewProbe available={50}/><CreativeAssistant/></CreativeStudioProvider>);
    await generatePreview();fireEvent.click(screen.getByRole('button',{name:'核对数量'}));
    snapshot.user={id:'different-user'};
    fireEvent.click(screen.getByRole('button',{name:'确认布置'}));
    await waitFor(()=>expect(screen.queryByText('方案提案 · 尚未应用')).toBeNull());
    expect(controller.applySceneProposal).not.toHaveBeenCalled();expect(onApply).not.toHaveBeenCalled();
  });

  it('does not revive a review after an account switches away and back in one batch',async()=>{
    connected();const listeners=new Set<()=>void>();
    vi.spyOn(controller,'subscribe').mockImplementation(listener=>{listeners.add(listener);return ()=>{listeners.delete(listener);};});
    render(<CreativeStudioProvider controller={controller} layout={layout} onApply={onApply} onPreview={onPreview}><InventoryReviewProbe available={50}/><CreativeAssistant/></CreativeStudioProvider>);
    await generatePreview();fireEvent.click(screen.getByRole('button',{name:'核对数量'}));
    const original=snapshot.user;
    act(()=>{snapshot.user={id:'different-user'};for(const listener of listeners)listener();snapshot.user=original;for(const listener of listeners)listener();});
    const confirm=screen.queryByRole('button',{name:'确认布置'});if(confirm)fireEvent.click(confirm);
    await waitFor(()=>expect(screen.queryByText('正在应用…')).toBeNull());
    expect(controller.applySceneProposal).not.toHaveBeenCalled();expect(onApply).not.toHaveBeenCalled();
  });

  it('does not revive inventory after switching candidate away and back before render',async()=>{
    connected();const other={...proposal,id:'30000000-0000-4000-8000-000000000002',candidate:{...candidate,objects:candidate.objects.map(item=>({...item,position:{x:5,z:4}}))}};
    vi.mocked(controller.startAgentRun).mockImplementationOnce(async input=>({...runFrom(proposal,input),candidates:[{label:'A',title:'方案A',proposal},{label:'B',title:'方案B',proposal:other}]}));
    render(<CreativeStudioProvider controller={controller} layout={layout} onApply={onApply} onPreview={onPreview}><InventoryReviewProbe available={50}/><CandidateSwitchProbe/><CreativeAssistant/></CreativeStudioProvider>);
    await generatePreview();fireEvent.click(screen.getByRole('button',{name:'核对数量'}));fireEvent.click(screen.getByRole('button',{name:'切换候选后返回'}));
    fireEvent.click(screen.getByRole('button',{name:'确认布置'}));
    expect((await screen.findAllByText(/候选或物料数量核对已变化/)).length).toBeGreaterThan(0);
    expect(controller.applySceneProposal).not.toHaveBeenCalled();expect(onApply).not.toHaveBeenCalled();
  });

  it('does not revive inventory after switching chat away and back before render',async()=>{
    connected();const listeners=new Set<(id:string|null)=>void>();
    vi.spyOn(assistantSessions,'subscribeActiveAssistantSession').mockImplementation((_scope,listener)=>{listeners.add(listener);return ()=>{listeners.delete(listener);};});
    render(<CreativeStudioProvider controller={controller} layout={layout} onApply={onApply} onPreview={onPreview}><InventoryReviewProbe available={50}/><CreativeAssistant/></CreativeStudioProvider>);
    await generatePreview();fireEvent.click(screen.getByRole('button',{name:'核对数量'}));
    act(()=>{for(const listener of listeners)listener('another-session');for(const listener of listeners)listener(null);});
    expect(screen.queryByRole('button',{name:'确认布置'})).toBeNull();
    expect(controller.applySceneProposal).not.toHaveBeenCalled();expect(onApply).not.toHaveBeenCalled();
  });

  it('does not submit when inventory is entered after preflight started',async()=>{
    connected();let calls=0;
    const preflightApply=()=>{if(++calls===2)screen.getByRole('button',{name:'核对数量'}).click();return null;};
    render(<CreativeStudioProvider controller={controller} layout={layout} onApply={onApply} onPreview={onPreview} preflightApply={preflightApply}><InventoryReviewProbe available={0}/><CreativeAssistant/></CreativeStudioProvider>);
    await generatePreview();fireEvent.click(screen.getByRole('button',{name:'确认布置'}));
    await waitFor(()=>expect(calls).toBe(2));
    expect(controller.applySceneProposal).not.toHaveBeenCalled();expect(onApply).not.toHaveBeenCalled();
    expect((await screen.findAllByText(/物料数量核对在应用期间已变化/)).length).toBeGreaterThan(0);
  });

  it('keeps the outcome for review if inventory changes while the cloud request is in flight',async()=>{
    connected();let finish!:(value:{id:string;revision:number;scene:Scene;previousScene:Scene;updatedAt:string;undoGroup:string;acceptedLocally:boolean})=>void;
    vi.mocked(controller.applySceneProposal).mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
    render(<CreativeStudioProvider controller={controller} layout={layout} onApply={onApply} onPreview={onPreview}><InventoryReviewProbe available={0}/><CreativeAssistant/></CreativeStudioProvider>);
    await generatePreview();fireEvent.click(screen.getByRole('button',{name:'确认布置'}));await waitFor(()=>expect(finish).toBeTypeOf('function'));
    fireEvent.click(screen.getByRole('button',{name:'核对数量'}));
    await act(async()=>finish({id:projectId,revision:2,scene:candidate,previousScene:scene,updatedAt:'2026-10-02T10:00:00Z',undoGroup:'undo-test',acceptedLocally:true}));
    expect(onApply).not.toHaveBeenCalled();
    expect((await screen.findAllByText(/云端提交结果尚不明确/)).length).toBeGreaterThan(0);
  });

  it('does not write a recovery marker or post if the lease is lost during preflight',async()=>{
    connected();const lease=await createLocalWriteLeaseManager({getLocks:()=>navigator.locks,getStorage:()=>window.localStorage}).acquire();
    const source=localWriteCapabilityGuard(lease.capability);let calls=0;
    const preflightApply=()=>{if(++calls===2)void lease.release();return null;};
    render(<CreativeStudioProvider controller={controller} layout={layout} writeCapability={lease.capability} sourceWriteGuard={source} preflightApply={preflightApply} onApply={onApply}><CreativeAssistant/></CreativeStudioProvider>);
    await generatePreview();fireEvent.click(screen.getByRole('button',{name:'确认布置'}));
    await waitFor(()=>expect(calls).toBe(2));
    expect(controller.applySceneProposal).not.toHaveBeenCalled();expect(onApply).not.toHaveBeenCalled();
    expect(Object.keys(localStorage).some(key=>key.startsWith('scendance:agent-apply-recovery:'))).toBe(false);
    await lease.release();
  });

  it('keeps a pending record when the lease is lost during an in-flight cloud request',async()=>{
    connected();const lease=await createLocalWriteLeaseManager({getLocks:()=>navigator.locks,getStorage:()=>window.localStorage}).acquire();
    const source=localWriteCapabilityGuard(lease.capability);let finish!:(value:{id:string;revision:number;scene:Scene;previousScene:Scene;updatedAt:string;undoGroup:string;acceptedLocally:boolean})=>void;
    vi.mocked(controller.applySceneProposal).mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
    render(<CreativeStudioProvider controller={controller} layout={layout} writeCapability={lease.capability} sourceWriteGuard={source} onApply={onApply}><CreativeAssistant/></CreativeStudioProvider>);
    await generatePreview();fireEvent.click(screen.getByRole('button',{name:'确认布置'}));await waitFor(()=>expect(finish).toBeTypeOf('function'));
    await act(async()=>{await lease.release();});
    expect((await screen.findByRole('alert')).textContent).toContain('云端提交结果尚不明确');
    const key=Object.keys(localStorage).find(value=>value.startsWith('scendance:agent-apply-recovery:'))!;
    expect(JSON.parse(localStorage.getItem(key)!).outcome).toBe('pending');expect(onApply).not.toHaveBeenCalled();
    await act(async()=>finish({id:projectId,revision:2,scene:candidate,previousScene:scene,updatedAt:'2026-10-02T10:00:00Z',undoGroup:'undo-test',acceptedLocally:true}));
    expect(JSON.parse(localStorage.getItem(key)!).outcome).toBe('pending');expect(onApply).not.toHaveBeenCalled();
  });

  it('does not post when write authority is lost while reading back the pending record',async()=>{
    connected();const lease=await createLocalWriteLeaseManager({getLocks:()=>navigator.locks,getStorage:()=>window.localStorage}).acquire();
    const source=localWriteCapabilityGuard(lease.capability);
    render(<CreativeStudioProvider controller={controller} layout={layout} writeCapability={lease.capability} sourceWriteGuard={source} onApply={onApply}><CreativeAssistant/></CreativeStudioProvider>);
    await generatePreview();const original=Storage.prototype.getItem;
    vi.spyOn(Storage.prototype,'getItem').mockImplementation(function(this:Storage,key:string){const value=original.call(this,key);if(key.startsWith('scendance:agent-apply-recovery:')&&value)void lease.release();return value;});
    fireEvent.click(screen.getByRole('button',{name:'确认布置'}));
    await waitFor(()=>expect(screen.getByRole('alert').textContent).toContain('云端提交结果尚不明确'));
    expect(controller.applySceneProposal).not.toHaveBeenCalled();expect(onApply).not.toHaveBeenCalled();
    const key=Object.keys(localStorage).find(value=>value.startsWith('scendance:agent-apply-recovery:'))!;
    expect(JSON.parse(original.call(localStorage,key)!).outcome).toBe('pending');await lease.release();
  });

  it.each(['preflight', 'requirements'] as const)('does not submit the cloud proposal when %s validation refuses the prepared candidate', async kind => {
    connected();
    const preflightApply=vi.fn(() => kind === 'preflight' ? '候选存在本机冲突' : null);
    const validateCandidateRequirements=vi.fn(() => kind === 'requirements' ? '候选缺少必要座位' : null);
    render(<CreativeStudioProvider controller={controller} layout={layout} onApply={onApply} onPreview={onPreview}
      preflightApply={preflightApply} validateCandidateRequirements={validateCandidateRequirements}><CreativeAssistant/></CreativeStudioProvider>);
    await generatePreview();
    fireEvent.click(screen.getByRole('button', { name: '确认布置' }));
    expect(await screen.findByText(kind === 'preflight' ? '候选存在本机冲突' : '候选缺少必要座位')).toBeTruthy();
    expect(controller.applySceneProposal).not.toHaveBeenCalled();
    expect(onApply).not.toHaveBeenCalled();
    expect(validateCandidateRequirements).toHaveBeenCalledWith(layout, expect.objectContaining({designBook:expect.any(Object)}));
    if(kind === 'preflight') expect(preflightApply).toHaveBeenCalledOnce();
  });

  it('enforces the same requirement guard through the secondary confirmation entry', async () => {
    connected();
    const validateCandidateRequirements=vi.fn(() => '候选缺少必要座位');
    render(<CreativeStudioProvider controller={controller} layout={layout} onApply={onApply} onPreview={onPreview}
      validateCandidateRequirements={validateCandidateRequirements}><CreativeAssistant/><SecondaryConfirm/></CreativeStudioProvider>);
    await generatePreview();
    fireEvent.click(screen.getByRole('button', { name: '左侧确认' }));
    expect(await screen.findByText('候选缺少必要座位')).toBeTruthy();
    expect(validateCandidateRequirements).toHaveBeenCalledOnce();
    expect(controller.applySceneProposal).not.toHaveBeenCalled();
    expect(onApply).not.toHaveBeenCalled();
  });

  it('applies exactly the candidate passed to the preflight checks after cloud success', async () => {
    connected();
    const preflightApply=vi.fn((_base:RoomLayout, _candidate:RoomLayout) => null);
    const validateCandidateRequirements=vi.fn((_base:RoomLayout, _candidate:RoomLayout) => null);
    render(<CreativeStudioProvider controller={controller} layout={layout} onApply={onApply} onPreview={onPreview}
      preflightApply={preflightApply} validateCandidateRequirements={validateCandidateRequirements}><CreativeAssistant/></CreativeStudioProvider>);
    await generatePreview();
    fireEvent.click(screen.getByRole('button', { name: '确认布置' }));
    await waitFor(() => expect(onApply).toHaveBeenCalledOnce());
    expect(onApply.mock.calls[0]![0]).toBe(preflightApply.mock.calls[0]![1]);
    expect(onApply.mock.calls[0]![0]).toBe(validateCandidateRequirements.mock.calls[0]![1]);
  });

  it('preserves a recovery marker after cloud success but local application fails, including on reopen', async () => {
    connected();
    onApply.mockImplementationOnce(() => { throw new Error('本地几何检查失败'); });
    const rendered=render(ui());
    await generatePreview();
    fireEvent.click(screen.getByRole('button', { name: '确认布置' }));
    expect((await screen.findByRole('alert')).textContent).toContain('云端已提交第 2 版');
    expect(screen.getByRole('alert').textContent).toContain('本机应用结果未能确认');
    expect(controller.applySceneProposal).toHaveBeenCalledOnce();
    expect(screen.queryByRole('button', { name: '确认布置' })).toBeNull();
    rendered.unmount();
    render(ui());
    expect((await screen.findByRole('alert')).textContent).toContain('云端已提交第 2 版');
    expect(controller.applySceneProposal).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: '只读核对云端版本' }));
    expect(await screen.findByText(/与这次候选内容一致/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '已查看核对结果，解除提醒' }));
    await waitFor(()=>expect(screen.queryByRole('alert')).toBeNull());
  });

  it('does not submit when the synchronous workspace switches before React rerenders',async()=>{
    connected();let current=layout;
    render(<CreativeStudioProvider controller={controller} layout={layout} getCurrentLayout={()=>current} onApply={onApply} onPreview={onPreview}><CreativeAssistant/></CreativeStudioProvider>);
    await generatePreview();current={...layout,id:'other-activity'};
    fireEvent.click(screen.getByRole('button',{name:'确认布置'}));
    expect(await screen.findByText(/场景或需求已变化/)).toBeTruthy();
    expect(controller.applySceneProposal).not.toHaveBeenCalled();expect(onApply).not.toHaveBeenCalled();
  });

  it('fails closed when source reads are unknown or the source editor is unsettled',async()=>{
    connected();const observed={status:'observed' as const,scope:projectId,digest:'a'.repeat(64)};
    let settled=false;const guard={getConfirmed:()=>observed,isSettled:()=>settled,subscribeInvalidation:()=>()=>{}};
    const read=vi.spyOn(venueSourceRevision,'readVenueSourceRevision').mockImplementation(async(_scope,context)=>context.isSettled()?{status:'unknown'}:{status:'unknown'});
    render(<CreativeStudioProvider controller={controller} layout={layout} venueSourceGuard={guard} onApply={onApply}><CreativeAssistant/></CreativeStudioProvider>);
    enterBrief();fireEvent.click(screen.getByRole('button',{name:'按这份细表生成预览'}));
    expect((await screen.findAllByText(/场地图纸或比例资料尚未核对/)).length).toBeGreaterThan(0);expect(controller.startAgentRun).not.toHaveBeenCalled();
    settled=true;fireEvent.click(screen.getByRole('button',{name:'按这份细表生成预览'}));
    await waitFor(()=>expect(read).toHaveBeenCalledTimes(2));expect(controller.startAgentRun).not.toHaveBeenCalled();
  });

  it('cancels before a run marker exists and never dispatches the late preparation',async()=>{
    connected();const confirmed={status:'observed' as const,scope:projectId,digest:'a'.repeat(64)};
    const guard={getConfirmed:()=>confirmed,isSettled:()=>true,subscribeInvalidation:()=>()=>{}};
    let finish!:(value:typeof confirmed)=>void;
    const read=vi.spyOn(venueSourceRevision,'readVenueSourceRevision').mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;})).mockResolvedValue(confirmed);
    render(<CreativeStudioProvider controller={controller} layout={layout} venueSourceGuard={guard} onApply={onApply}><CreativeAssistant/></CreativeStudioProvider>);
    enterBrief();fireEvent.click(screen.getByRole('button',{name:'按这份细表生成预览'}));
    await waitFor(()=>expect(read).toHaveBeenCalledOnce());fireEvent.click(screen.getByRole('button',{name:'取消任务'}));
    await act(async()=>{finish(confirmed);await Promise.resolve();});
    expect(controller.startAgentRun).not.toHaveBeenCalled();expect(onApply).not.toHaveBeenCalled();
  });

  it('does not let a cancelled preparation disturb a newer generation',async()=>{
    connected();const confirmed={status:'observed' as const,scope:projectId,digest:'a'.repeat(64)};
    const guard={getConfirmed:()=>confirmed,isSettled:()=>true,subscribeInvalidation:()=>()=>{}};
    let finish!:(value:typeof confirmed)=>void;
    const read=vi.spyOn(venueSourceRevision,'readVenueSourceRevision').mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;})).mockResolvedValue(confirmed);
    render(<CreativeStudioProvider controller={controller} layout={layout} venueSourceGuard={guard} onApply={onApply}><CreativeAssistant/></CreativeStudioProvider>);
    enterBrief();fireEvent.click(screen.getByRole('button',{name:'按这份细表生成预览'}));await waitFor(()=>expect(read).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByRole('button',{name:'取消任务'}));
    fireEvent.click(screen.getByRole('button',{name:'按这份细表生成预览'}));await waitFor(()=>expect(controller.startAgentRun).toHaveBeenCalledOnce());
    await act(async()=>{finish(confirmed);await Promise.resolve();});expect(controller.startAgentRun).toHaveBeenCalledOnce();
    expect(await screen.findByRole('button',{name:'确认布置'})).toBeTruthy();expect(onApply).not.toHaveBeenCalled();
  });

  it('does not dispatch when cancellation occurs during the final source recheck',async()=>{
    connected();const confirmed={status:'observed' as const,scope:projectId,digest:'a'.repeat(64)};
    const guard={getConfirmed:()=>confirmed,isSettled:()=>true,subscribeInvalidation:()=>()=>{}};
    let finish!:(value:typeof confirmed)=>void;
    const read=vi.spyOn(venueSourceRevision,'readVenueSourceRevision').mockResolvedValueOnce(confirmed).mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
    render(<CreativeStudioProvider controller={controller} layout={layout} venueSourceGuard={guard} onApply={onApply}><CreativeAssistant/></CreativeStudioProvider>);
    enterBrief();fireEvent.click(screen.getByRole('button',{name:'按这份细表生成预览'}));await waitFor(()=>expect(read).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByRole('button',{name:'取消任务'}));await act(async()=>{finish(confirmed);await Promise.resolve();});
    expect(controller.startAgentRun).not.toHaveBeenCalled();expect(onApply).not.toHaveBeenCalled();
  });

  it('rereads source bytes before cloud confirmation even without a change event',async()=>{
    connected();const confirmed={status:'observed' as const,scope:projectId,digest:'a'.repeat(64)};
    let observed=confirmed;const guard={getConfirmed:()=>confirmed,isSettled:()=>true,subscribeInvalidation:()=>()=>{}};
    vi.spyOn(venueSourceRevision,'readVenueSourceRevision').mockImplementation(async()=>observed);
    render(<CreativeStudioProvider controller={controller} layout={layout} venueSourceGuard={guard} onApply={onApply}><CreativeAssistant/></CreativeStudioProvider>);
    await generatePreview();observed={...confirmed,digest:'b'.repeat(64)};
    fireEvent.click(screen.getByRole('button',{name:'确认布置'}));expect(await screen.findByText(/场地图纸或比例资料尚未核对/)).toBeTruthy();
    expect(controller.applySceneProposal).not.toHaveBeenCalled();expect(onApply).not.toHaveBeenCalled();
  });

  it('invalidates the preview on a cross-tab source change notification',async()=>{
    connected();const confirmed={status:'observed' as const,scope:projectId,digest:'a'.repeat(64)};let invalidate!:()=>void;
    const guard={getConfirmed:()=>confirmed,isSettled:()=>true,subscribeInvalidation:(listener:()=>void)=>{invalidate=listener;return()=>{};}};
    vi.spyOn(venueSourceRevision,'readVenueSourceRevision').mockResolvedValue(confirmed);
    render(<CreativeStudioProvider controller={controller} layout={layout} venueSourceGuard={guard} onApply={onApply}><CreativeAssistant/></CreativeStudioProvider>);
    await generatePreview();act(()=>invalidate());expect(screen.queryByRole('button',{name:'确认布置'})).toBeNull();
    expect(controller.applySceneProposal).not.toHaveBeenCalled();expect(onApply).not.toHaveBeenCalled();
  });

  it('uses the confirmed source snapshot through the real confirmation service before generation',async()=>{
    connected();const manager=createLocalWriteLeaseManager({getLocks:()=>navigator.locks,getStorage:()=>window.localStorage});const lease=await manager.acquire();
    let invalidate!:()=>void;const context={isCurrent:(scope:string)=>scope===projectId,isSettled:()=>true,subscribeInvalidation:(listener:()=>void)=>{invalidate=listener;return()=>{};}};
    vi.spyOn(sourceStorage,'readSourceScopeSnapshotV2').mockResolvedValue({version:2,scope:projectId,sources:[],form:{present:false}});
    const service=createVenueSourceConfirmation(lease.capability,context);const confirmed=await service.confirm(projectId);expect(confirmed.status).toBe('observed');
    const guard=service.guard(()=>confirmed);
    render(<CreativeStudioProvider controller={controller} layout={layout} venueSourceGuard={guard} onApply={onApply}><CreativeAssistant/></CreativeStudioProvider>);
    await generatePreview();act(()=>invalidate());expect(screen.queryByRole('button',{name:'确认布置'})).toBeNull();expect(onApply).not.toHaveBeenCalled();
    service.dispose();await lease.release();
  });

  it('retains the task marker when source changes during a dispatched generation',async()=>{
    connected();const confirmed={status:'observed' as const,scope:projectId,digest:'a'.repeat(64)};let invalidate!:()=>void;
    const guard={getConfirmed:()=>confirmed,isSettled:()=>true,subscribeInvalidation:(listener:()=>void)=>{invalidate=listener;return()=>{};}};
    vi.spyOn(venueSourceRevision,'readVenueSourceRevision').mockResolvedValue(confirmed);
    let finish!:(value:SceneProposal)=>void;vi.mocked(prepareProposal).mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
    render(<CreativeStudioProvider controller={controller} layout={layout} venueSourceGuard={guard} onApply={onApply}><CreativeAssistant/></CreativeStudioProvider>);
    enterBrief();fireEvent.click(screen.getByRole('button',{name:'按这份细表生成预览'}));await waitFor(()=>expect(finish).toBeTypeOf('function'));
    act(()=>invalidate());await act(async()=>{finish(proposal);});
    expect(await screen.findByText(/原任务编号已保留/)).toBeTruthy();
    expect(controller.applySceneProposal).not.toHaveBeenCalled();expect(onApply).not.toHaveBeenCalled();
    expect(Object.keys(localStorage).some(key=>key.startsWith('scendance:agent-run:'))).toBe(true);
  });

  it('retains the cloud-committed reminder if source changes while the application is in flight',async()=>{
    connected();const confirmed={status:'observed' as const,scope:projectId,digest:'a'.repeat(64)};let invalidate!:()=>void;
    const guard={getConfirmed:()=>confirmed,isSettled:()=>true,subscribeInvalidation:(listener:()=>void)=>{invalidate=listener;return()=>{};}};
    vi.spyOn(venueSourceRevision,'readVenueSourceRevision').mockResolvedValue(confirmed);
    let finish!:(value:{id:string;revision:number;scene:Scene;previousScene:Scene;updatedAt:string;undoGroup:string;acceptedLocally:boolean})=>void;
    vi.mocked(controller.applySceneProposal).mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
    render(<CreativeStudioProvider controller={controller} layout={layout} venueSourceGuard={guard} onApply={onApply}><CreativeAssistant/></CreativeStudioProvider>);
    await generatePreview();fireEvent.click(screen.getByRole('button',{name:'确认布置'}));await waitFor(()=>expect(finish).toBeTypeOf('function'));act(()=>invalidate());
    await act(async()=>{finish({id:projectId,revision:2,scene:candidate,previousScene:scene,updatedAt:'2026-10-02T10:00:00Z',undoGroup:'undo-test',acceptedLocally:true});});
    expect(onApply).not.toHaveBeenCalled();expect((await screen.findByRole('alert')).textContent).toContain('云端已提交第 2 版');
  });

  it('keeps a committed recovery record if the brief changes while the cloud application is in flight',async()=>{
    connected();let finish!:(value:{id:string;revision:number;scene:Scene;previousScene:Scene;updatedAt:string;undoGroup:string;acceptedLocally:boolean})=>void;
    vi.mocked(controller.applySceneProposal).mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
    render(<CreativeStudioProvider controller={controller} layout={layout} onApply={onApply}><CreativeAssistant/></CreativeStudioProvider>);
    await generatePreview();fireEvent.click(screen.getByRole('button',{name:'确认布置'}));await waitFor(()=>expect(finish).toBeTypeOf('function'));
    fireEvent.change(screen.getByRole('textbox',{name:'客户需求'}),{target:{value:'保留原有物料'}});
    await act(async()=>finish({id:projectId,revision:2,scene:candidate,previousScene:scene,updatedAt:'2026-10-02T10:00:00Z',undoGroup:'undo-test',acceptedLocally:true}));
    expect(onApply).not.toHaveBeenCalled();expect((await screen.findByRole('alert')).textContent).toContain('云端已提交第 2 版');
    const key=Object.keys(localStorage).find(value=>value.startsWith('scendance:agent-apply-recovery:'))!;
    expect(JSON.parse(localStorage.getItem(key)!).outcome).toBe('committed');
  });

  it('keeps a committed recovery record if dialogue changes while the cloud application is in flight',async()=>{
    connected();let current=true;const release=vi.fn();let finish!:(value:{id:string;revision:number;scene:Scene;previousScene:Scene;updatedAt:string;undoGroup:string;acceptedLocally:boolean})=>void;
    vi.mocked(controller.applySceneProposal).mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
    const captureDialogue=vi.fn(()=>({project:()=>projectDialogueHandoff(null),isCurrent:()=>current,release}));
    render(<CreativeStudioProvider controller={controller} layout={layout} captureDialogue={captureDialogue} onApply={onApply}><CreativeAssistant/></CreativeStudioProvider>);
    await generatePreview();fireEvent.click(screen.getByRole('button',{name:'确认布置'}));await waitFor(()=>expect(finish).toBeTypeOf('function'));
    current=false;
    await act(async()=>finish({id:projectId,revision:2,scene:candidate,previousScene:scene,updatedAt:'2026-10-02T10:00:00Z',undoGroup:'undo-test',acceptedLocally:true}));
    expect(onApply).not.toHaveBeenCalled();expect((await screen.findByRole('alert')).textContent).toContain('云端已提交第 2 版');expect(release).toHaveBeenCalledTimes(captureDialogue.mock.calls.length);
    const key=Object.keys(localStorage).find(value=>value.startsWith('scendance:agent-apply-recovery:'))!;
    expect(JSON.parse(localStorage.getItem(key)!).outcome).toBe('committed');
  });

  it('does not republish a preview when its parent rerenders with a new getter function',async()=>{
    connected();
    function Wrapper(){const [,rerender]=useState(0);return <><button onClick={()=>rerender(n=>n+1)}>刷新父级</button><CreativeStudioProvider controller={controller} layout={layout} getCurrentLayout={()=>layout} onApply={onApply} onPreview={onPreview}><CreativeAssistant/></CreativeStudioProvider></>;}
    render(<Wrapper/>);await generatePreview();
    await waitFor(()=>expect(onPreview.mock.calls.some(([value])=>value!==null)).toBe(true));
    const calls=onPreview.mock.calls.length;fireEvent.click(screen.getByRole('button',{name:'刷新父级'}));
    expect(onPreview.mock.calls).toHaveLength(calls);
  });

  it('never revives an old preview after the real store changes A → B → A in one batch',async()=>{
    connected();const store=createLayoutStore({layout,activeFloorIndex:0});const tracker=createActivitySessionTracker(store);tracker.start();
    const tree=()=> <CreativeStudioProvider controller={controller} layout={layout} getCurrentLayout={()=>store.getState().layout} sessionToken={tracker.capture()} isSessionCurrent={tracker.isCurrent} onApply={onApply} onPreview={onPreview}><CreativeAssistant/></CreativeStudioProvider>;
    const view=render(tree());await generatePreview();
    act(()=>{store.setState({layout:{...layout,id:'other-activity'}});store.setState({layout});fireEvent.click(screen.getByRole('button',{name:'确认布置'}));});
    await screen.findByText(/活动已切换，旧候选不能应用/);
    expect(controller.applySceneProposal).not.toHaveBeenCalled();expect(onApply).not.toHaveBeenCalled();
    view.rerender(tree());expect(screen.queryByRole('button',{name:'确认布置'})).toBeNull();
    await waitFor(()=>expect(onPreview.mock.calls.at(-1)?.[0]).toBeNull());tracker.stop();
  });
  it('does not apply an old candidate after same-batch floor A → B → A',async()=>{
    connected();const store=createLayoutStore({layout,activeFloorIndex:0}),tracker=createFloorSessionTracker(store);tracker.start();
    const tree=()=> <CreativeStudioProvider controller={controller} layout={layout} getCurrentLayout={()=>store.getState().layout} floorToken={tracker.capture()} isFloorCurrent={tracker.isCurrent} onApply={onApply} onPreview={onPreview}><CreativeAssistant/></CreativeStudioProvider>;
    const view=render(tree());await generatePreview();
    act(()=>{store.setState({activeFloorIndex:1});store.setState({activeFloorIndex:0});fireEvent.click(screen.getByRole('button',{name:'确认布置'}));});
    expect(await screen.findByText(/楼层已切换，旧候选不能应用/)).toBeTruthy();expect(controller.applySceneProposal).not.toHaveBeenCalled();expect(onApply).not.toHaveBeenCalled();
    view.rerender(tree());expect(screen.queryByRole('button',{name:'确认布置'})).toBeNull();tracker.stop();
  });
  it('retains a cloud-committed reminder if the floor changes before the response',async()=>{
    connected();const store=createLayoutStore({layout,activeFloorIndex:0}),tracker=createFloorSessionTracker(store);tracker.start();
    let finish!:(value:{id:string;revision:number;scene:Scene;previousScene:Scene;updatedAt:string;undoGroup:string;acceptedLocally:boolean})=>void;
    vi.mocked(controller.applySceneProposal).mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
    render(<CreativeStudioProvider controller={controller} layout={layout} getCurrentLayout={()=>store.getState().layout} floorToken={tracker.capture()} isFloorCurrent={tracker.isCurrent} onApply={onApply}><CreativeAssistant/></CreativeStudioProvider>);
    await generatePreview();fireEvent.click(screen.getByRole('button',{name:'确认布置'}));await waitFor(()=>expect(finish).toBeTypeOf('function'));
    act(()=>{store.setState({activeFloorIndex:1});store.setState({activeFloorIndex:0});});
    await act(async()=>{finish({id:projectId,revision:2,scene:candidate,previousScene:scene,updatedAt:'2026-10-02T10:00:00Z',undoGroup:'undo-test',acceptedLocally:true});});
    expect(onApply).not.toHaveBeenCalled();expect((await screen.findByRole('alert')).textContent).toContain('云端已提交第 2 版');tracker.stop();
  });
  it('keeps the original run for review when the floor changes during generation',async()=>{
    connected();const store=createLayoutStore({layout,activeFloorIndex:0}),tracker=createFloorSessionTracker(store);tracker.start();
    let finish!:(value:AgentRun)=>void;vi.mocked(controller.startAgentRun).mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
    render(<CreativeStudioProvider controller={controller} layout={layout} getCurrentLayout={()=>store.getState().layout} floorToken={tracker.capture()} isFloorCurrent={tracker.isCurrent} onApply={onApply}><CreativeAssistant/></CreativeStudioProvider>);
    enterBrief();fireEvent.click(screen.getByRole('button',{name:'按这份细表生成预览'}));await waitFor(()=>expect(finish).toBeTypeOf('function'));
    act(()=>{store.setState({activeFloorIndex:1});store.setState({activeFloorIndex:0});});await act(async()=>finish(runFrom(proposal)));
    expect(await screen.findByText(/楼层、图纸或活动会话需求已变化，原任务编号已保留/)).toBeTruthy();expect(screen.queryByRole('button',{name:'确认布置'})).toBeNull();
    expect(controller.applySceneProposal).not.toHaveBeenCalled();expect(onApply).not.toHaveBeenCalled();tracker.stop();
  });
  it('fails closed if a previously supplied floor guard disappears',async()=>{
    connected();const store=createLayoutStore({layout,activeFloorIndex:0}),tracker=createFloorSessionTracker(store);tracker.start();
    const view=render(<CreativeStudioProvider controller={controller} layout={layout} floorToken={tracker.capture()} isFloorCurrent={tracker.isCurrent} onApply={onApply}><CreativeAssistant/></CreativeStudioProvider>);
    await generatePreview();view.rerender(<CreativeStudioProvider controller={controller} layout={layout} onApply={onApply}><CreativeAssistant/></CreativeStudioProvider>);
    expect(screen.queryByRole('button',{name:'确认布置'})).toBeNull();expect(controller.applySceneProposal).not.toHaveBeenCalled();expect(onApply).not.toHaveBeenCalled();tracker.stop();
  });
  it('passes the exact captured floor token to the final guarded application',async()=>{
    connected();const store=createLayoutStore({layout,activeFloorIndex:0}),tracker=createFloorSessionTracker(store);tracker.start();const token=tracker.capture();
    const apply=vi.fn((_next:RoomLayout,_options?:{expectedBase:RoomLayout;expectedFloor?:FloorSessionToken})=>{});
    render(<CreativeStudioProvider controller={controller} layout={layout} getCurrentLayout={()=>store.getState().layout} floorToken={token} isFloorCurrent={tracker.isCurrent} onApply={apply}><CreativeAssistant/></CreativeStudioProvider>);
    await generatePreview();fireEvent.click(screen.getByRole('button',{name:'确认布置'}));await waitFor(()=>expect(apply).toHaveBeenCalledOnce());
    expect(apply.mock.calls[0]![1]).toMatchObject({expectedBase:layout});expect(apply.mock.calls[0]![1]?.expectedFloor).toBe(token);tracker.stop();
  });

  it('keeps the cloud-committed reminder if A → B → A happens before the response',async()=>{
    connected();const store=createLayoutStore({layout,activeFloorIndex:0});const tracker=createActivitySessionTracker(store);tracker.start();
    let finish!:(value:{id:string;revision:number;scene:Scene;previousScene:Scene;updatedAt:string;undoGroup:string;acceptedLocally:boolean})=>void;
    vi.mocked(controller.applySceneProposal).mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
    render(<CreativeStudioProvider controller={controller} layout={layout} getCurrentLayout={()=>store.getState().layout} sessionToken={tracker.capture()} isSessionCurrent={tracker.isCurrent} onApply={onApply} onPreview={onPreview}><CreativeAssistant/></CreativeStudioProvider>);
    await generatePreview();fireEvent.click(screen.getByRole('button',{name:'确认布置'}));await waitFor(()=>expect(finish).toBeTypeOf('function'));
    act(()=>{store.setState({layout:{...layout,id:'other-activity'}});store.setState({layout});});
    await act(async()=>{finish({id:projectId,revision:2,scene:candidate,previousScene:scene,updatedAt:'2026-10-02T10:00:00Z',undoGroup:'undo-test',acceptedLocally:true});});
    expect(onApply).not.toHaveBeenCalled();expect((await screen.findByRole('alert')).textContent).toContain('云端已提交第 2 版');
    const key=Object.keys(localStorage).find(value=>value.startsWith('scendance:agent-apply-recovery:'))!;
    expect(JSON.parse(localStorage.getItem(key)!).outcome).toBe('committed');tracker.stop();
  });

  it('does not fall back to an unguarded preview when the injected session guard disappears',async()=>{
    connected();const store=createLayoutStore({layout,activeFloorIndex:0});const tracker=createActivitySessionTracker(store);tracker.start();
    const view=render(<CreativeStudioProvider controller={controller} layout={layout} getCurrentLayout={()=>store.getState().layout} sessionToken={tracker.capture()} isSessionCurrent={tracker.isCurrent} onApply={onApply} onPreview={onPreview}><CreativeAssistant/></CreativeStudioProvider>);
    await generatePreview();
    view.rerender(<CreativeStudioProvider controller={controller} layout={layout} getCurrentLayout={()=>store.getState().layout} onApply={onApply} onPreview={onPreview}><CreativeAssistant/></CreativeStudioProvider>);
    expect(screen.queryByRole('button',{name:'确认布置'})).toBeNull();expect(controller.applySceneProposal).not.toHaveBeenCalled();tracker.stop();
  });

  it('does not publish a late generation after a same-batch A → B → A',async()=>{
    connected();const store=createLayoutStore({layout,activeFloorIndex:0});const tracker=createActivitySessionTracker(store);tracker.start();
    let finish!:(value:SceneProposal)=>void;vi.mocked(prepareProposal).mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
    render(<CreativeStudioProvider controller={controller} layout={layout} getCurrentLayout={()=>store.getState().layout} sessionToken={tracker.capture()} isSessionCurrent={tracker.isCurrent} onApply={onApply} onPreview={onPreview}><CreativeAssistant/></CreativeStudioProvider>);
    enterBrief();fireEvent.click(screen.getByRole('button',{name:'按这份细表生成预览'}));
    await waitFor(()=>expect(finish).toBeTypeOf('function'));act(()=>{store.setState({layout:{...layout,id:'other-activity'}});store.setState({layout});});
    await act(async()=>{finish(proposal);});expect(screen.queryByText('方案提案 · 尚未应用')).toBeNull();expect(controller.applySceneProposal).not.toHaveBeenCalled();expect(onApply).not.toHaveBeenCalled();tracker.stop();
  });

  it('retains a committed-cloud reminder if the synchronous workspace switches before the response',async()=>{
    connected();let current=layout;
    let finish!:(value:{id:string;revision:number;scene:Scene;previousScene:Scene;updatedAt:string;undoGroup:string;acceptedLocally:boolean})=>void;
    vi.mocked(controller.applySceneProposal).mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
    render(<CreativeStudioProvider controller={controller} layout={layout} getCurrentLayout={()=>current} onApply={onApply} onPreview={onPreview}><CreativeAssistant/></CreativeStudioProvider>);
    await generatePreview();fireEvent.click(screen.getByRole('button',{name:'确认布置'}));
    await waitFor(()=>expect(finish).toBeTypeOf('function'));
    current={...layout,id:'other-activity'};
    await act(async()=>{finish({id:projectId,revision:2,scene:candidate,previousScene:scene,updatedAt:'2026-10-02T10:00:00Z',undoGroup:'undo-test',acceptedLocally:true});});
    expect(onApply).not.toHaveBeenCalled();expect((await screen.findByRole('alert')).textContent).toContain('云端已提交第 2 版');
    const key=Object.keys(localStorage).find(value=>value.startsWith('scendance:agent-apply-recovery:'))!;
    expect(JSON.parse(localStorage.getItem(key)!).outcome).toBe('committed');
  });

  it('does not apply locally if the returned cloud scene differs from the preflighted preview', async () => {
    connected();
    const changed={...candidate,objects:candidate.objects.map(object=>({...object,position:{...object.position,x:object.position.x+.1}}))};
    vi.mocked(controller.applySceneProposal).mockResolvedValueOnce({ id: projectId, revision: 2, scene: changed, previousScene: scene, updatedAt: '2026-10-02T10:00:00Z', undoGroup: 'undo-test', acceptedLocally: true });
    render(ui());
    await generatePreview();
    fireEvent.click(screen.getByRole('button', { name: '确认布置' }));
    expect(await screen.findByText(/云端返回的场景与预览候选不一致/)).toBeTruthy();
    expect(onApply).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toContain('云端已提交第 2 版');
  });

  it('does not submit if the recovery record cannot be written and read back', async () => {
    connected();
    render(ui());
    await generatePreview();
    const original=Storage.prototype.setItem;
    vi.spyOn(Storage.prototype,'setItem').mockImplementation(function(this:Storage,key:string,value:string) {
      if(key.startsWith('scendance:agent-apply-recovery:')) throw new Error('storage denied');
      return original.call(this,key,value);
    });
    fireEvent.click(screen.getByRole('button', { name: '确认布置' }));
    expect(await screen.findByText(/核对记录.*尚未提交云端/)).toBeTruthy();
    expect(controller.applySceneProposal).not.toHaveBeenCalled();
    expect(onApply).not.toHaveBeenCalled();
  });

  it('does not submit if storage silently drops the recovery record', async () => {
    connected();
    render(ui());
    await generatePreview();
    const original=Storage.prototype.setItem;
    vi.spyOn(Storage.prototype,'setItem').mockImplementation(function(this:Storage,key:string,value:string) {
      if(key.startsWith('scendance:agent-apply-recovery:')) return;
      return original.call(this,key,value);
    });
    fireEvent.click(screen.getByRole('button', { name: '确认布置' }));
    expect(await screen.findByText(/核对记录.*尚未提交云端/)).toBeTruthy();
    expect(controller.applySceneProposal).not.toHaveBeenCalled();
    expect(onApply).not.toHaveBeenCalled();
  });

  it('does not send if browser-wide lock support is unavailable', async () => {
    connected();
    render(ui());
    await generatePreview();
    Object.defineProperty(navigator,'locks',{configurable:true,value:undefined});
    fireEvent.click(screen.getByRole('button',{name:'确认布置'}));
    expect(await screen.findByText(/无法安全协调多个窗口的布置应用/)).toBeTruthy();
    expect(controller.applySceneProposal).not.toHaveBeenCalled();
    expect(Object.keys(localStorage).some(value=>value.startsWith('scendance:agent-apply-recovery:'))).toBe(false);
  });

  it('permits only one active browser-wide submission for the same activity', async () => {
    let release!:()=>void;
    const first=withApplyLock('same-activity',()=>new Promise<string>(resolve=>{release=()=>resolve('done');}));
    await waitFor(()=>expect(release).toBeTypeOf('function'));
    const second=vi.fn(async()=> 'duplicate');
    await expect(withApplyLock('same-activity',second)).rejects.toThrow('另一个窗口正在处理');
    expect(second).not.toHaveBeenCalled();
    expect(await withApplyLock('other-activity',async()=> 'independent')).toBe('independent');
    release();
    expect(await first).toBe('done');
    expect(await withApplyLock('same-activity',async()=> 'next')).toBe('next');
  });

  it('persists a pending record before the request and blocks resubmission after a lost response and reopen', async () => {
    connected();
    let rejectRequest!: (error:Error)=>void;
    vi.mocked(controller.applySceneProposal).mockImplementationOnce(() => new Promise((_resolve,reject) => { rejectRequest=reject; }));
    const rendered=render(ui());
    await generatePreview();
    fireEvent.click(screen.getByRole('button', { name: '确认布置' }));
    await waitFor(() => expect(rejectRequest).toBeTypeOf('function'));
    const key=Object.keys(localStorage).find(value=>value.startsWith('scendance:agent-apply-recovery:'))!;
    expect(JSON.parse(localStorage.getItem(key)!).outcome).toBe('pending');
    await act(async()=>{rejectRequest(new Error('connection lost'));});
    expect((await screen.findByRole('alert')).textContent).toContain('提交结果尚不明确');
    expect(onApply).not.toHaveBeenCalled();
    rendered.unmount();
    render(ui());
    expect((await screen.findByRole('alert')).textContent).toContain('只读核对');
    expect(controller.applySceneProposal).toHaveBeenCalledOnce();
    expect(screen.queryByRole('button',{name:'确认布置'})).toBeNull();
  });

  it('shows a pending recovery immediately after reopening while the original response is still unresolved', async () => {
    connected();
    let rejectRequest!:(error:Error)=>void;
    vi.mocked(controller.applySceneProposal).mockImplementationOnce(() => new Promise((_resolve,reject) => { rejectRequest=reject; }));
    const rendered=render(ui());
    await generatePreview();
    fireEvent.click(screen.getByRole('button',{name:'确认布置'}));
    await waitFor(()=>expect(rejectRequest).toBeTypeOf('function'));
    rendered.unmount();
    render(ui());
    expect((await screen.findByRole('alert')).textContent).toContain('提交结果尚不明确');
    expect(controller.applySceneProposal).toHaveBeenCalledOnce();
    await act(async()=>{rejectRequest(new Error('connection lost'));});
    expect(controller.applySceneProposal).toHaveBeenCalledOnce();
  });

  it('shows the same cloud-project recovery in a different local activity', async () => {
    connected();
    const scope=`${controller.config.apiUrl}:project:${projectId}`;
    localStorage.setItem(`scendance:agent-apply-recovery:${scope}`,JSON.stringify({ projectId, revision:2, proposalId:proposal.id, outcome:'pending' }));
    render(ui({...layout,id:'20000000-0000-4000-8000-000000000009'}));
    expect((await screen.findByRole('alert')).textContent).toContain('提交结果尚不明确');
    expect(controller.applySceneProposal).not.toHaveBeenCalled();
  });

  it.each([
    ['base',1,scene,'与提交前场景一致'],
    ['candidate',2,candidate,'与这次候选内容一致'],
    ['other',3,scene,'无法仅凭现有记录确定'],
  ] as const)('read-only recovery classifies %s content without clearing the marker', async (_kind,revision,remoteScene,text) => {
    connected();
    const scope=`${controller.config.apiUrl}:project:${projectId}`;
    const key=`scendance:agent-apply-recovery:${scope}`;
    localStorage.setItem(key,JSON.stringify({ projectId, revision:2, baseRevision:1, proposalId:proposal.id,
      baseHash:await sceneHash(scene),candidateHash:await sceneHash(candidate),outcome:'pending' }));
    vi.mocked(controller.peekProject).mockResolvedValue({ id:projectId, studio_id:'studio-test',name:'客户方案',revision,scene:remoteScene });
    render(ui());
    await screen.findByRole('alert');
    expect(screen.queryByRole('button',{name:/解除提醒/})).toBeNull();
    fireEvent.click(screen.getByRole('button',{name:'只读核对云端版本'}));
    expect(await screen.findByText(new RegExp(text))).toBeTruthy();
    expect(controller.peekProject).toHaveBeenCalledWith(projectId);
    expect(localStorage.getItem(key)).not.toBeNull();
    expect(controller.applySceneProposal).not.toHaveBeenCalled();
  });

  it('keeps the recovery unknown and does not clear it when read-only lookup fails', async () => {
    connected();
    const scope=`${controller.config.apiUrl}:project:${projectId}`;
    const key=`scendance:agent-apply-recovery:${scope}`;
    localStorage.setItem(key,JSON.stringify({ projectId, revision:2, baseRevision:1, proposalId:proposal.id,
      baseHash:await sceneHash(scene),candidateHash:await sceneHash(candidate),outcome:'pending' }));
    vi.mocked(controller.peekProject).mockRejectedValue(new Error('network unavailable'));
    render(ui());await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button',{name:'只读核对云端版本'}));
    expect(await screen.findByText(/暂时无法只读核对云端版本；结果仍未知/)).toBeTruthy();
    expect(localStorage.getItem(key)).not.toBeNull();
    expect(screen.getByRole('button',{name:'我已手动核对，解除提醒'})).toBeTruthy();
    expect(controller.applySceneProposal).not.toHaveBeenCalled();
  });

  it('does not clear a recovery marker if the remote version changes after the read-only review', async () => {
    connected();
    const scope=`${controller.config.apiUrl}:project:${projectId}`;
    const key=`scendance:agent-apply-recovery:${scope}`;
    localStorage.setItem(key,JSON.stringify({ projectId, revision:2, baseRevision:1, proposalId:proposal.id,
      baseHash:await sceneHash(scene),candidateHash:await sceneHash(candidate),outcome:'pending' }));
    vi.mocked(controller.peekProject)
      .mockResolvedValueOnce({id:projectId,studio_id:'studio-test',name:'客户方案',revision:1,scene})
      .mockResolvedValueOnce({id:projectId,studio_id:'studio-test',name:'客户方案',revision:2,scene:candidate});
    render(ui());await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button',{name:'只读核对云端版本'}));
    expect(await screen.findByText(/与提交前场景一致/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button',{name:'已查看核对结果，解除提醒'}));
    expect(await screen.findByText(/云端版本已变化，请重新只读核对/)).toBeTruthy();
    expect(localStorage.getItem(key)).not.toBeNull();
  });

  it('does not clear a recovery marker while another window still owns the submission lock', async () => {
    connected();
    const scope=`${controller.config.apiUrl}:project:${projectId}`;
    const key=`scendance:agent-apply-recovery:${scope}`;
    localStorage.setItem(key,JSON.stringify({ projectId, revision:2, proposalId:proposal.id, outcome:'pending' }));
    let release!:()=>void;
    const other=withApplyLock(scope,()=>new Promise<void>(resolve=>{release=resolve;}));
    await waitFor(()=>expect(release).toBeTypeOf('function'));
    render(ui());
    await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button',{name:'只读核对云端版本'}));
    expect(await screen.findByText(/暂时无法只读核对云端版本/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button',{name:'我已手动核对，解除提醒'}));
    expect(await screen.findByText(/另一个窗口正在处理/)).toBeTruthy();
    expect(localStorage.getItem(key)).not.toBeNull();
    release();await other;
    fireEvent.click(screen.getByRole('button',{name:'只读核对云端版本'}));
    expect(await screen.findByText(/无法仅凭现有记录确定/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button',{name:'我已手动核对，解除提醒'}));
    await waitFor(()=>expect(localStorage.getItem(key)).toBeNull());
  });

  it.each(['SESSION_CHANGED','STALE_PROPOSAL'])('does not mistake local %s for proof that the server rejected the request', async code => {
    connected();
    vi.mocked(controller.applySceneProposal).mockRejectedValueOnce(new SceneApiError(code,409,null));
    render(ui());
    await generatePreview();
    fireEvent.click(screen.getByRole('button',{name:'确认布置'}));
    expect((await screen.findByRole('alert')).textContent).toContain('提交结果尚不明确');
    const key=Object.keys(localStorage).find(value=>value.startsWith('scendance:agent-apply-recovery:'))!;
    expect(JSON.parse(localStorage.getItem(key)!).outcome).toBe('pending');
    expect(onApply).not.toHaveBeenCalled();
  });

  it('clears the marker when the server explicitly rejects the candidate before applying', async () => {
    connected();
    vi.mocked(controller.applySceneProposal).mockRejectedValueOnce(new SceneApiError('STRUCTURAL_COLLISION',422,null));
    render(ui());
    await generatePreview();
    fireEvent.click(screen.getByRole('button',{name:'确认布置'}));
    expect(await screen.findByText(/云端明确拒绝本次应用/)).toBeTruthy();
    expect(Object.keys(localStorage).some(value=>value.startsWith('scendance:agent-apply-recovery:'))).toBe(false);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(onApply).not.toHaveBeenCalled();
  });

  it('keeps a reminder when a successful application cannot really delete its recovery record', async () => {
    connected();
    render(ui());
    await generatePreview();
    const original=Storage.prototype.removeItem;
    vi.spyOn(Storage.prototype,'removeItem').mockImplementation(function(this:Storage,key:string) {
      if(key.startsWith('scendance:agent-apply-recovery:')) return;
      return original.call(this,key);
    });
    fireEvent.click(screen.getByRole('button',{name:'确认布置'}));
    await waitFor(()=>expect(onApply).toHaveBeenCalledOnce());
    expect((await screen.findByRole('alert')).textContent).toContain('核对记录未能清除');
    const key=Object.keys(localStorage).find(value=>value.startsWith('scendance:agent-apply-recovery:'))!;
    expect(localStorage.getItem(key)).not.toBeNull();
    expect(JSON.parse(localStorage.getItem(key)!).outcome).toBe('cleanup_failed');
  });

  it('keeps a reminder if storage becomes unavailable immediately after local application', async () => {
    connected();
    onApply.mockImplementationOnce(() => { vi.spyOn(layoutPersistence,'localStorageOrNull').mockReturnValue(null); });
    render(ui());
    await generatePreview();
    fireEvent.click(screen.getByRole('button',{name:'确认布置'}));
    await waitFor(()=>expect(onApply).toHaveBeenCalledOnce());
    expect((await screen.findByRole('alert')).textContent).toContain('核对记录未能清除');
    expect(controller.applySceneProposal).toHaveBeenCalledOnce();
  });

  it('hides the confirm while the cloud is still writing this version', async () => {
    connected();
    let finish!: (value: { id: string; revision: number; scene: Scene; previousScene: Scene; updatedAt: string; undoGroup: string; acceptedLocally: boolean }) => void;
    vi.mocked(controller.applySceneProposal).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    render(ui());
    await generatePreview();
    fireEvent.click(screen.getByRole('button', { name: '确认布置' }));

    // 应用还在路上：确认与放弃都收起来，只留一句安静的进度。
    expect(await screen.findByText('正在整理这一版…')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '确认布置' })).toBeNull();
    expect(screen.queryByRole('button', { name: '放弃' })).toBeNull();

    await waitFor(() => expect(finish).toBeTypeOf('function'));
    await act(async () => { finish({ id: projectId, revision: 2, scene: candidate, previousScene: scene, updatedAt: '2026-10-02T10:00:00Z', undoGroup: 'undo-test', acceptedLocally: true }); });
    await waitFor(() => expect(onApply).toHaveBeenCalledOnce());
    expect(screen.queryByText('正在整理这一版…')).toBeNull();
  });

  it.each(['scene', 'brief', 'lease'] as const)('removes the apply action when the %s changes after a preview', async change => {
    connected();
    const rendered = render(ui());
    await generatePreview();
    if (change === 'scene') rendered.rerender(ui({ ...layout, width: 13 }));
    if (change === 'brief') fireEvent.change(screen.getByRole('textbox', { name: '客户需求' }), { target: { value: '改成 12 人工作坊。' } });
    if (change === 'lease') {
      snapshot = { ...snapshot, writeBlocked: true };
      rendered.rerender(ui());
    }
    expect(await screen.findByText('场景、需求或编辑权已变化，请重新生成。')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '确认布置' })).toBeNull();
    expect(onPreview).toHaveBeenLastCalledWith(null);
    expect(controller.applySceneProposal).not.toHaveBeenCalled();
    expect(onApply).not.toHaveBeenCalled();
  });

  it('takes a lost edit right to the projects page in one step', async () => {
    connected();
    snapshot = { ...snapshot, writeBlocked: true };
    render(ui());
    fireEvent.click(await screen.findByRole('button', { name: '去项目页接手编辑' }));
    await waitFor(() => expect(routerPush).toHaveBeenCalledWith('/projects/'));
  });

  it('preserves the canvas when the controller reports acceptedLocally false', async () => {
    connected();
    vi.mocked(controller.applySceneProposal).mockResolvedValueOnce({ id: projectId, revision: 2, scene: candidate, previousScene: scene, updatedAt: '2026-10-02T10:00:00Z', undoGroup: 'undo-test', acceptedLocally: false });
    render(ui());
    await generatePreview();
    fireEvent.click(screen.getByRole('button', { name: '确认布置' }));
    expect(await screen.findByText(/应用期间本地有新修改，已保留本地草稿/)).toBeTruthy();
    expect(onApply).not.toHaveBeenCalled();
    expect(screen.queryByText('提案已应用。你可以继续调整，或用撤销返回应用前的本地方案。')).toBeNull();
  });

  it('discards a pending generation result if the scene changes before its response arrives', async () => {
    connected();
    let finish!: (value: SceneProposal) => void;
    vi.mocked(prepareProposal).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const rendered = render(ui());
    enterBrief();
    fireEvent.click(screen.getByRole('button', { name: '按这份细表生成预览' }));
    await waitFor(() => expect(finish).toBeTypeOf('function'));
    rendered.rerender(ui({ ...layout, width: 13 }));
    await act(async () => { finish(proposal); });
    expect(screen.getByRole('status').textContent).toContain('生成期间方案或需求已变化');
    expect(screen.queryByText('方案提案 · 尚未应用')).toBeNull();
    expect(onApply).not.toHaveBeenCalled();
  });

  it('automatically clears the canvas preview at expiration without waiting for a confirm click', async () => {
    connected();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-02T10:00:00Z'));
    vi.mocked(prepareProposal).mockResolvedValueOnce({ ...proposal, expires_at: '2026-10-02T10:00:02Z' });
    render(ui());
    enterBrief();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: '按这份细表生成预览' })); });
    expect(screen.getByRole('button', { name: '确认布置' })).toBeTruthy();
    expect(onPreview).toHaveBeenLastCalledWith(expect.objectContaining({ id: projectId }));
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(screen.getByText('提案已过期，请重新生成。')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '确认布置' })).toBeNull();
    expect(onPreview).toHaveBeenLastCalledWith(null);
    expect(controller.applySceneProposal).not.toHaveBeenCalled();
    expect(onApply).not.toHaveBeenCalled();
  });

  it('clears the render-only preview when discarded or when its provider unmounts', async () => {
    connected();
    const rendered = render(ui());
    await generatePreview();
    expect(onPreview.mock.calls.at(-1)?.[0]).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '放弃' }));
    expect(onPreview).toHaveBeenLastCalledWith(null);
    expect(onApply).not.toHaveBeenCalled();
    await generatePreview();
    expect(onPreview.mock.calls.at(-1)?.[0]).not.toBeNull();
    rendered.unmount();
    expect(onPreview).toHaveBeenLastCalledWith(null);
  });

  it('lists individual overlap and boundary warnings against named objects', async () => {
    connected();
    vi.mocked(prepareProposal).mockResolvedValueOnce({ ...proposal, warnings: [
      { code: 'OVERLAP', ids: [candidate.objects[0].id] },
      { code: 'OUT_OF_BOUNDS', ids: [candidate.objects[0].id] },
    ] });
    render(ui());
    await generatePreview();
    expect(screen.getByText('物件重叠：椅子')).toBeTruthy();
    expect(screen.getByText('超出场地边界：椅子')).toBeTruthy();
    expect(onApply).not.toHaveBeenCalled();
  });
  it('renders incomplete safety coverage in plain language instead of an internal code',async()=>{
    connected();vi.mocked(prepareProposal).mockResolvedValueOnce({...proposal,warnings:[{code:'SAFETY_CHECKS_UNKNOWN',ids:[]}]});
    render(ui());await generatePreview();expect(screen.getByText(/出口、疏散、门扇、无障碍、消防和核定人数仍需核验/)).toBeTruthy();
    expect(document.body.textContent).not.toContain('SAFETY_CHECKS_UNKNOWN');expect(onApply).not.toHaveBeenCalled();
  });
});

function BriefStateProbe() {
  return <output data-testid="brief-state">{JSON.stringify({state:useCreativeBriefState(),legacy:useCreativeBrief()})}</output>;
}
function briefForm(current = layout) {
  return <CreativeStudioProvider controller={controller} layout={current} onApply={onApply}><CreativeBriefPanel/><BriefStateProbe/></CreativeStudioProvider>;
}
function briefState() { return JSON.parse(screen.getByTestId('brief-state').textContent!).state; }

function installBackupLocks(): void {
  const locks = new Map<string, { shared: number; exclusive: boolean; waiting: (() => boolean)[] }>();
  const request = (name: string, options: LockOptions, callback: (lock: Lock | null) => unknown): Promise<unknown> => new Promise((resolve, reject) => {
    const entry = locks.get(name) ?? { shared: 0, exclusive: false, waiting: [] }; locks.set(name, entry);
    let started = false, aborted = false;
    const available = () => !entry.exclusive && (options.mode === 'shared' || !entry.shared);
    const start = () => {
      if (aborted) return true;
      if (!available()) return false;
      started = true;
      if (options.mode === 'shared') entry.shared++; else entry.exclusive = true;
      Promise.resolve().then(() => callback({ name, mode: options.mode ?? 'exclusive' } as Lock)).then(resolve, reject).finally(() => {
        if (options.mode === 'shared') entry.shared--; else entry.exclusive = false;
        const waiting=entry.waiting.splice(0);
        for(let index=0;index<waiting.length;index++)if(!waiting[index]!()){entry.waiting.push(...waiting.slice(index));break;}
      });
      return true;
    };
    if (options.ifAvailable && !available()) { Promise.resolve(callback(null)).then(resolve, reject); return; }
    options.signal?.addEventListener('abort', () => { if (!started) { aborted = true; reject(new DOMException('Aborted', 'AbortError')); } }, { once: true });
    if (available()) start(); else entry.waiting.push(start);
  });
  Object.defineProperty(navigator, 'locks', { configurable: true, value: { request } });
}

describe('complete local backup transactions', () => {
  const oldBrief = prepareLegacyBriefPreservation({ event: '工作坊', guests: 0, description: '恢复前需求', mustHave: '', allowIdeas: false });
  const fileBrief = { ...oldBrief, description: '文件需求', guests: 3.5 };
  let actions: LocalProjectBackupActions;
  let changeLayout: (next: RoomLayout) => void;
  let forms: Map<string, unknown>;
  let sourceRecords: Map<string, StoredSource[]>;
  const sourceState = (scope = projectId): SourceScopeSnapshot => structuredClone({ scope, sources: sourceRecords.get(scope) ?? [], form: forms.get(scope) });
  const commit = vi.fn<(next: RoomLayout) => void>();
  const prepare = vi.fn<(next:RoomLayout)=>RoomLayout>();
  function Probe() { actions = useLocalProjectBackup()!; return <BriefStateProbe/>; }
  function ActivityProbe({current,onComplete}:{current:RoomLayout;onComplete:()=>void}) {
    return <LocalActivitiesPanel layout={current} actions={useLocalProjectBackup()!} onComplete={onComplete}/>;
  }
  function Trial({activitiesCompleted,review=false,briefView='brief'}:{activitiesCompleted?:()=>void;review?:boolean;briefView?:'brief'|'reference'} = {}) {
    const [current, setCurrent] = useState(layout); changeLayout = setCurrent;
    const [reviewRequest,setReviewRequest]=useState(0);
    return <CreativeStudioProvider controller={controller} layout={current} onApply={onApply} prepareRestoreLayout={prepare} commitRestoredLayout={next => { commit(next); setCurrent(next); }}>
      <CreativeBriefPanel view={briefView}/><Probe/><output data-testid="backup-layout">{JSON.stringify(current)}</output>
      {review&&<><button onClick={()=>setReviewRequest(value=>value+1)}>打开生产方案评审</button><CreativeAssistant reviewOpenRequest={reviewRequest}/></>}
      {activitiesCompleted&&<ActivityProbe current={current} onComplete={activitiesCompleted}/>}
    </CreativeStudioProvider>;
  }
  const file = (id = projectId, brief: 'present'|'absent'|'legacy' = 'present') => {
    const next = { ...layout, id, name: '文件布局', width: 14 };
    return parseLocalProjectBackupJson(brief === 'legacy' ? JSON.stringify(next) : serializeLocalProjectBackup(next, { state: 'ready', scope: id, brief: brief === 'present' ? { status: 'present', value: fileBrief } : { status: 'absent' } }));
  };
  const checkinKey=()=>JSON.stringify(['material-checkins',projectId]);
  const ledger=(n=1)=>materialCheckinLedgerSchema.parse({projectId,dataKind:'rehearsal',sheets:[{
    id:`aa900000-0000-4000-8000-${String(n).padStart(12,'0')}`,acquisitionId:'aa900000-0000-4000-8000-000000000100',
    acquisitionSnapshot:{title:'演练租赁椅'},unit:'piece',agreements:[{id:`aa900000-0000-4000-8000-${String(n+1000).padStart(12,'0')}`,
      agreedQuantity:20,basisNote:'演练约定',recordedAt:'2026-10-09T00:00:00+08:00',recordedBy:'演练统筹'}],events:[]}]});
  const checkinFile=(value:ReturnType<typeof ledger>|undefined)=>parseLocalProjectBackupJson(serializeLocalProjectBackupV3(
    {...layout,id:projectId,name:'点验文件布局'}, {state:'ready',scope:projectId,brief:{status:'present',value:fileBrief}},
    {state:'ready',scope:projectId,materialCheckins:value?{status:'present',value}:{status:'absent'}},
  ));
  async function mount(briefView: 'brief'|'reference' = 'brief') { const view = renderUI(<Trial briefView={briefView}/>); await waitFor(() => expect(briefState().ready).toBe(true)); return view; }
  beforeEach(() => {
    installBackupLocks(); commit.mockReset();prepare.mockReset().mockImplementation(next=>next);
    vi.mocked(listSourceRecords).mockResolvedValue([]);
    forms = new Map([[`${projectId}:brief`, oldBrief]]);
    sourceRecords = new Map();
    vi.mocked(listStoredSources).mockImplementation(async scope => structuredClone((sourceRecords.get(scope) ?? []).filter(source => source.blob)));
    vi.mocked(readSourceScopeSnapshot).mockImplementation(async scope => sourceState(scope));
    vi.mocked(restoreSourceScopeIfUnchanged).mockImplementation(async (scope, expected, desired, check = () => {}) => {
      check();
      if (!await sameSourceScopeSnapshot(sourceState(scope), expected)) throw new Error('图纸资料已有新变化，不能覆盖较新的记录。');
      check(); sourceRecords.set(scope, structuredClone(desired.sources));
      if (desired.form === undefined) forms.delete(scope); else forms.set(scope, structuredClone(desired.form));
    });
    vi.spyOn(sourceStorage, 'storeSource').mockImplementation(async source => {
      const records = sourceRecords.get(source.scope) ?? [];
      sourceRecords.set(source.scope, [...records.filter(record => record.id !== source.id), structuredClone(source)]);
    });
    vi.spyOn(sourceStorage, 'deleteSource').mockImplementation(async id => {
      for (const [scope, records] of sourceRecords) sourceRecords.set(scope, records.filter(record => record.id !== id));
    });
    vi.mocked(readSourceForm).mockImplementation(async key => forms.get(key));
    vi.mocked(storeSourceForm).mockImplementation(async (key, value) => { forms.set(key, value); });
    vi.mocked(deleteSourceForm).mockImplementation(async key => { forms.delete(key); });
    vi.mocked(readSourceRecord).mockImplementation(async key=>structuredClone(forms.get(JSON.stringify(key))) as never);
    vi.mocked(updateSourceForm).mockImplementation(async(key,update)=>{
      const address=JSON.stringify(key),next=update(structuredClone(forms.get(address)));
      if(next===undefined)forms.delete(address);else forms.set(address,structuredClone(next));return structuredClone(next) as never;
    });
  });
  afterEach(() => { Reflect.deleteProperty(navigator, 'locks'); });

  it('keeps live brief and drawing drafts when their composed ordinary capability expires',async()=>{
    const locks=navigator.locks,lease=await createLocalWriteLeaseManager({getLocks:()=>locks,getStorage:()=>window.localStorage}).acquire();
    vi.mocked(storeSourceForm).mockImplementation(async(key,value,guard)=>{guard?.assertStillHeld();forms.set(key,value);});
    function TrialWithLease(){const guards=useWorkspaceWriteGuards(lease.capability)!;return <CreativeStudioProvider controller={controller} layout={layout} onApply={onApply} sourceWriteGuard={guards.source}>
      <CreativeBriefPanel/><BriefStateProbe/><CreativeAssistant/></CreativeStudioProvider>;}
    renderUI(<TrialWithLease/>);await waitFor(()=>expect(briefState().ready).toBe(true));
    fireEvent.click(screen.getByRole('button',{name:'打开 Bingo Agent'}));selectBusiness('图纸与照片');
    await waitFor(()=>expect(screen.getByLabelText('场地尺寸').matches(':disabled')).toBe(false));
    vi.useFakeTimers();const before=structuredClone([...forms.entries()]);
    fireEvent.change(screen.getByRole('textbox',{name:'客户需求'}),{target:{value:'仍留在页面的需求'}});
    fireEvent.change(screen.getByLabelText('场地尺寸'),{target:{value:'仍留在页面的图纸尺寸'}});
    await act(async()=>{await lease.release();await vi.advanceTimersByTimeAsync(300);});
    expect((screen.getByRole('textbox',{name:'客户需求'}) as HTMLTextAreaElement).value).toBe('仍留在页面的需求');
    expect((screen.getByLabelText('场地尺寸') as HTMLTextAreaElement).value).toBe('仍留在页面的图纸尺寸');
    expect([...forms.entries()]).toEqual(before);
    expect(vi.mocked(storeSourceForm).mock.calls.filter(([,value])=>typeof value==='object'&&value!==null&&JSON.stringify(value).includes('仍留在页面')).length).toBeGreaterThanOrEqual(2);
  });
  it('keeps the point-check capability guarded when the provider prop disappears',async()=>{
    const locks=navigator.locks,lease=await createLocalWriteLeaseManager({getLocks:()=>locks,getStorage:()=>window.localStorage}).acquire();
    let current!:ReturnType<typeof useMaterialCheckinState>;
    function Probe(){current=useMaterialCheckinState();return <output>{current.ready?'ready':'loading'}</output>;}
    const tree=(capability?:typeof lease.capability)=><CreativeStudioProvider controller={controller} layout={layout} onApply={onApply} {...(capability?{writeCapability:capability}:{})}><Probe/></CreativeStudioProvider>;
    const view=renderUI(tree(lease.capability));await waitFor(()=>expect(current.ready).toBe(true));
    await act(async()=>{await current.onSave(ledger());});expect(forms.get(checkinKey())).toEqual(ledger());
    const writes=vi.mocked(updateSourceForm).mock.calls.length;view.rerender(tree());
    await act(async()=>{await expect(current.onSave(ledger(2))).rejects.toThrow('编辑权已变化');});
    expect(vi.mocked(updateSourceForm)).toHaveBeenCalledTimes(writes);expect(forms.get(checkinKey())).toEqual(ledger());
    await lease.release();
  });

  it('keeps the activity input when its queued guarded autosave loses the lease',async()=>{
    const abort=new AbortController(),guard={kind:'ordinary' as const,signal:abort.signal,assertStillHeld(){if(abort.signal.aborted)throw new Error('租约失效');}};
    vi.mocked(storeSourceForm).mockImplementation(async(_scope,_value,received)=>{received?.assertStillHeld();});
    renderUI(<CreativeStudioProvider controller={controller} layout={layout} onApply={onApply} sourceWriteGuard={guard}><CreativeBriefPanel/><BriefStateProbe/></CreativeStudioProvider>);
    await waitFor(()=>expect(briefState().ready).toBe(true));vi.useFakeTimers();
    fireEvent.change(screen.getByRole('textbox',{name:'客户需求'}),{target:{value:'失锁前未保存的需求'}});
    abort.abort();await act(async()=>{await vi.advanceTimersByTimeAsync(300);});
    expect(storeSourceForm).toHaveBeenCalledWith(`${projectId}:brief`,expect.objectContaining({description:'失锁前未保存的需求'}),guard);
    expect(briefState().error).toContain('保存失败');expect(briefState().brief.description).toBe('失锁前未保存的需求');
  });
  it('uses the previous scope guard for its queued save when switching activities',async()=>{
    const oldAbort=new AbortController(),newAbort=new AbortController();
    const oldGuard={kind:'ordinary' as const,signal:oldAbort.signal,assertStillHeld(){if(oldAbort.signal.aborted)throw new Error('旧租约失效');}};
    const newGuard={kind:'ordinary' as const,signal:newAbort.signal,assertStillHeld(){if(newAbort.signal.aborted)throw new Error('新租约失效');}};
    vi.mocked(storeSourceForm).mockImplementation(async(_scope,_value,received)=>{received?.assertStillHeld();});
    const tree=(current:RoomLayout,guard:typeof oldGuard)=><CreativeStudioProvider controller={controller} layout={current} onApply={onApply} sourceWriteGuard={guard}><CreativeBriefPanel/><BriefStateProbe/></CreativeStudioProvider>;
    const view=renderUI(tree(layout,oldGuard));await waitFor(()=>expect(briefState().ready).toBe(true));
    fireEvent.change(screen.getByRole('textbox',{name:'客户需求'}),{target:{value:'原活动尚未保存'}});
    oldAbort.abort();view.rerender(tree({...layout,id:'other-activity'},newGuard));
    await waitFor(()=>expect(storeSourceForm).toHaveBeenCalledWith(`${projectId}:brief`,expect.objectContaining({description:'原活动尚未保存'}),oldGuard));
    expect(vi.mocked(storeSourceForm).mock.calls.some(([key,,guard])=>key===`${projectId}:brief`&&guard===newGuard)).toBe(false);
    view.rerender(tree(layout,oldGuard));await waitFor(()=>expect(briefState().brief.description).toBe('原活动尚未保存'));
  });
  it('retains a decoded image if its captured guard expires before persistence',async()=>{
    const abort=new AbortController(),guard={kind:'ordinary' as const,signal:abort.signal,assertStillHeld(){if(abort.signal.aborted)throw new Error('租约失效');}};
    let finish!:(value:{width:number;height:number;close:()=>void})=>void;
    createBitmap.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
    const write=vi.spyOn(sourceStorage,'storeSource').mockImplementation(async(_source,received)=>{received?.assertStillHeld();});
    const view=renderUI(<CreativeStudioProvider controller={controller} layout={layout} onApply={onApply} sourceWriteGuard={guard}><CreativeAssistant/></CreativeStudioProvider>);
    fireEvent.click(screen.getByRole('button',{name:'打开 Bingo Agent'}));selectBusiness('图纸与照片');upload(view.container,[new File(['image'],'guarded.png',{type:'image/png'})]);
    await waitFor(()=>expect(createBitmap).toHaveBeenCalled());abort.abort();
    await act(async()=>finish({width:10,height:10,close:vi.fn()}));
    await waitFor(()=>expect(write).toHaveBeenCalledWith(expect.objectContaining({name:'guarded.png'}),guard));
    expect(await screen.findByRole('img',{name:'现场照片：guarded.png'})).toBeTruthy();
    expect(await screen.findByText(/租约失效/)).toBeTruthy();
  });
  it('keeps a failed image downloadable across scope changes and editor unmount',async()=>{
    const abort=new AbortController(),guard={kind:'ordinary' as const,signal:abort.signal,assertStillHeld(){if(abort.signal.aborted)throw new Error('租约失效');}};
    let finish!:(value:{width:number;height:number;close:()=>void})=>void;
    createBitmap.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
    vi.spyOn(sourceStorage,'storeSource').mockImplementation(async(_source,received)=>{received?.assertStillHeld();});
    const tree=(current:RoomLayout)=><CreativeStudioProvider controller={controller} layout={current} onApply={onApply} sourceWriteGuard={guard}><CreativeAssistant/></CreativeStudioProvider>;
    const view=renderUI(tree(layout));fireEvent.click(screen.getByRole('button',{name:'打开 Bingo Agent'}));selectBusiness('图纸与照片');
    upload(view.container,[new File(['original file'],'keep.png',{type:'image/png'})]);
    await waitFor(()=>expect(createBitmap).toHaveBeenCalled());abort.abort();
    await act(async()=>finish({width:10,height:10,close:vi.fn()}));
    expect(await screen.findByRole('img',{name:'现场照片：keep.png'})).toBeTruthy();
    view.rerender(tree({...layout,id:'different-activity'}));
    expect(screen.getByText(/其他活动 · keep.png/)).toBeTruthy();
    expect(screen.getByRole('link',{name:'下载原图'}).getAttribute('href')).toBe('blob:local-reference');
    expect(revokeObjectURL).not.toHaveBeenCalledWith('blob:local-reference');
    view.unmount();const exit=new Event('beforeunload',{cancelable:true});window.dispatchEvent(exit);expect(exit.defaultPrevented).toBe(true);
    renderUI(tree(layout));expect(screen.getByRole('link',{name:'下载原图'})).toBeTruthy();
  });
  it('retains the original file if scope changes while its image decode is still pending',async()=>{
    let finish!:(value:{width:number;height:number;close:()=>void})=>void;
    createBitmap.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
    const tree=(current:RoomLayout)=><CreativeStudioProvider controller={controller} layout={current} onApply={onApply}><CreativeAssistant/></CreativeStudioProvider>;
    const view=renderUI(tree(layout));fireEvent.click(screen.getByRole('button',{name:'打开 Bingo Agent'}));selectBusiness('图纸与照片');
    upload(view.container,[new File(['original'],'pending.png',{type:'image/png'})]);await waitFor(()=>expect(createBitmap).toHaveBeenCalled());
    view.rerender(tree({...layout,id:'different-activity'}));
    expect(screen.getByText(/其他活动 · pending.png/)).toBeTruthy();expect(screen.getByRole('link',{name:'下载原图'})).toBeTruthy();
    await act(async()=>finish({width:10,height:10,close:vi.fn()}));
    expect(revokeObjectURL).not.toHaveBeenCalledWith('blob:local-reference');
    view.rerender(tree(layout));expect(await screen.findByText(/当前活动 · pending.png/)).toBeTruthy();
    expect(screen.getByRole('link',{name:'下载原图'})).toBeTruthy();
  });
  it('uses the originally captured guard for the source copy after asynchronous cloud preparation',async()=>{
    snapshot={...snapshot,configured:true};const local=backendSceneToLayout(candidate,{name:'本地活动'});
    const abortA=new AbortController(),abortB=new AbortController();
    const guardA={kind:'ordinary' as const,signal:abortA.signal,assertStillHeld(){if(abortA.signal.aborted)throw new Error('旧租约失效');}};
    const guardB={kind:'ordinary' as const,signal:abortB.signal,assertStillHeld(){if(abortB.signal.aborted)throw new Error('新租约失效');}};
    let finish!:()=>void;const ensure=vi.fn(()=>new Promise(resolve=>{finish=()=>{connected();resolve(snapshot.project);};}));
    Object.assign(controller,{ensureWorkbenchReady:ensure});
    const tree=(guard:typeof guardA)=><CreativeStudioProvider controller={controller} layout={local} onApply={onApply} sourceWriteGuard={guard}><IntentGenerationProbe/><CreativeAssistant/></CreativeStudioProvider>;
    const view=renderUI(tree(guardA));fireEvent.click(screen.getByRole('button',{name:'测试生成'}));
    await waitFor(()=>expect(ensure).toHaveBeenCalledOnce());view.rerender(tree(guardB));
    await act(async()=>finish());
    await waitFor(()=>expect(copySourceScope).toHaveBeenCalledWith('local',projectId,guardA));
    expect(vi.mocked(copySourceScope).mock.calls[0]![2]).not.toBe(guardB);
  });

  const imageFixture = (id = 'original-image', name = '原现场照片.png', kind: StoredSource['kind'] = 'photo'): StoredSource => {
    const bytes = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/3ioAAAAASUVORK5CYII='), char => char.charCodeAt(0));
    return { id, scope: projectId, name, kind, width: 1, height: 1, blob: new NodeBlob([bytes], { type: 'image/png' }) as Blob };
  };
  const oldDrawing = { width: '12', depth: '10', height: '3', text: '原图纸现场条件', constraints: [], adjustment: '' };
  const newDrawing = { ...oldDrawing, width: '14', text: '文件图纸现场条件' };
  async function sourceFile(id = 'file-image', options?: { form: unknown }) {
    return parseLocalProjectBackupJson(await serializeLocalProjectBackupV4({ ...layout, name: '图纸文件布局', width: 14 },
      { state: 'ready', scope: projectId, brief: { status: 'present', value: fileBrief } },
      { state: 'ready', scope: projectId, materialCheckins: { status: 'absent' } },
      { scope: projectId, sources: [imageFixture(id, '文件平面图.png', 'floorplan')], form: options ? options.form : newDrawing }));
  }
  function seedSources() {
    vi.stubGlobal('Blob', NodeBlob);
    // Node's real Blob produces native ArrayBuffers; align jsdom's constructor for the production byte comparator.
    vi.stubGlobal('ArrayBuffer', NodeBuffer.alloc(0).buffer.constructor);
    createBitmap.mockResolvedValue({ width: 1, height: 1, close: vi.fn() });
    sourceRecords.set(projectId, [imageFixture()]); forms.set(projectId, structuredClone(oldDrawing));
  }

  const reviewAddress=()=>JSON.stringify(['project-review-library',JSON.stringify([controller.config.apiUrl,snapshot.user?.id??null,projectId])]);
  const savedReview=()=>({version:1 as const,draft:{revision:'saved-review-a',summary:'已保存A说明',pending:'已保存A待确认',savedAt:'2026-10-09T00:00:00Z'},files:[]});
  async function mountReview(){
    renderUI(<Trial review/>);await waitFor(()=>expect(briefState().ready).toBe(true));
    fireEvent.click(screen.getByRole('button',{name:'打开生产方案评审'}));
    const entry=await screen.findByText('草稿与文件',{exact:true});fireEvent.click(entry);entry.closest('details')!.open=true;
    await waitFor(()=>expect((screen.getByRole('button',{name:'保存说明草稿'}) as HTMLButtonElement).disabled).toBe(false));
  }

  it.skipIf(!localRestoreAvailable())('[review restore lock] rejects late review edits while the real provider restores a new activity and still completes normal review preparation',async()=>{
    const saved=savedReview();forms.set(reviewAddress(),saved);await mountReview();
    fireEvent.click(screen.getByRole('button',{name:'生成评审包'}));await screen.findByTitle('客户评审预览');
    fireEvent.change(screen.getByLabelText('简短方案说明（选填）'),{target:{value:'恢复前原本未保存的A说明'}});
    await act(async()=>{await expect(actions.restoreBackup(file('review-original-dirty-b'))).rejects.toThrow('评审说明有未保存修改');});
    expect(commit).not.toHaveBeenCalled();expect((screen.getByLabelText('简短方案说明（选填）') as HTMLTextAreaElement).value).toBe('恢复前原本未保存的A说明');
    fireEvent.click(screen.getByRole('button',{name:'放弃说明修改'}));
    fireEvent.click(screen.getByRole('button',{name:'生成评审包'}));await screen.findByTitle('客户评审预览');
    const target='review-restored-b';let release!:()=>void,writing=false;
    const held=new Promise<void>(resolve=>{release=resolve;}),normal=vi.mocked(storeSourceForm).getMockImplementation()!;
    vi.mocked(storeSourceForm).mockImplementation(async(key,value)=>{if(key===`${target}:brief`){writing=true;await held;}return normal(key,value);});
    let pending!:Promise<void>;
    await act(async()=>{pending=actions.restoreBackup(file(target));void pending.catch(()=>{});await Promise.resolve();});
    await waitFor(()=>expect(writing).toBe(true));
    const summary=screen.getByLabelText('简短方案说明（选填）') as HTMLTextAreaElement;
    const pendingNote=screen.getByLabelText('待确认项（选填）') as HTMLTextAreaElement;
    const disabledDuring=summary.matches(':disabled')&&pendingNote.matches(':disabled');
    const publicInputs=['包含当前活动需求','包含当前设计说明','包含当前画面','允许在评审画面中包含当前参考底图'].map(name=>screen.getByLabelText(name,{exact:true}) as HTMLInputElement);
    const disclosuresDisabled=publicInputs.every(input=>input.matches(':disabled'));
    const discard=screen.queryByRole('button',{name:'放弃说明修改'}) as HTMLButtonElement|null;
    const libraryDisabled=['保存说明草稿','载入已保存说明'].every(name=>(screen.getByRole('button',{name}) as HTMLButtonElement).disabled)&&(!discard||discard.disabled);
    fireEvent.change(summary,{target:{value:'恢复期间不应接受的新说明'}});fireEvent.change(pendingNote,{target:{value:'恢复期间不应接受的新待确认'}});
    fireEvent.click(publicInputs[0]!);const disclosureAccepted=publicInputs[0]!.checked;
    const acceptedSummary=summary.value,acceptedPending=pendingNote.value;
    const flushFailure=await flushSourceScope(projectId).then(()=>'',error=>error instanceof Error?error.message:String(error));
    await act(async()=>{release();await pending;});
    expect(disabledDuring).toBe(true);expect(disclosuresDisabled).toBe(true);expect(disclosureAccepted).toBe(false);expect(libraryDisabled).toBe(true);
    expect(acceptedSummary).toBe('');expect(acceptedPending).toBe('');expect(flushFailure).not.toContain('评审说明有未保存修改');
    expect(forms.get(reviewAddress())).toEqual(saved);
    expect(JSON.parse(screen.getByTestId('backup-layout').textContent!).id).toBe(target);expect(commit).toHaveBeenCalledOnce();
    expect((screen.getByLabelText('简短方案说明（选填）') as HTMLTextAreaElement).value).toBe('');
  });

  it.skipIf(!localRestoreAvailable())('[review restore lock] ignores a saved-review load already awaiting its read when provider restoration locks review input',async()=>{
    const saved=savedReview();forms.set(reviewAddress(),saved);await mountReview();
    fireEvent.click(screen.getByLabelText('包含当前活动需求',{exact:true}));
    const normalRead=vi.mocked(readSourceRecord).getMockImplementation()!,normalWrite=vi.mocked(storeSourceForm).getMockImplementation()!;
    let finishRead!:(value:unknown)=>void,loadReading=false,release!:()=>void,writing=false;
    const load=new Promise<unknown>(resolve=>{finishRead=resolve;}),held=new Promise<void>(resolve=>{release=resolve;});
    vi.mocked(readSourceRecord).mockImplementation(async key=>{if(JSON.stringify(key)===reviewAddress()){loadReading=true;return load;}return normalRead(key);});
    fireEvent.click(screen.getByRole('button',{name:'载入已保存说明'}));await waitFor(()=>expect(loadReading).toBe(true));
    const target='review-load-restored-b';
    vi.mocked(storeSourceForm).mockImplementation(async(key,value)=>{if(key===`${target}:brief`){writing=true;await held;}return normalWrite(key,value);});
    let pending!:Promise<void>;
    await act(async()=>{pending=actions.restoreBackup(file(target));void pending.catch(()=>{});await Promise.resolve();});
    await waitFor(()=>expect(writing).toBe(true));await act(async()=>{finishRead(saved);});
    const loadedSummary=(screen.getByLabelText('简短方案说明（选填）') as HTMLTextAreaElement).value;
    const disclosure=(screen.getByLabelText('包含当前活动需求',{exact:true}) as HTMLInputElement).checked;
    await act(async()=>{release();await pending;});
    expect(loadedSummary).toBe('');expect(disclosure).toBe(true);expect(forms.get(reviewAddress())).toEqual(saved);
    expect(JSON.parse(screen.getByTestId('backup-layout').textContent!).id).toBe(target);expect(commit).toHaveBeenCalledOnce();
  });

  it.skipIf(!localRestoreAvailable())('[V4 sources] restores same-scope images and drawing form in the mounted editor and undo restores originals', async () => {
    seedSources(); const before = sourceState(); await mount('reference'); const candidate = await sourceFile();
    await act(async () => { await actions.restoreBackup(candidate); });
    await waitFor(() => expect(document.querySelector('img[alt="平面图：文件平面图.png"]')).not.toBeNull());
    expect(document.querySelector('img[alt="现场照片：原现场照片.png"]')).toBeNull();
    expect(screen.getByText(/已识别：.*总宽 14 米/)).toBeDefined();
    expect(forms.get(projectId)).toEqual(newDrawing); expect(sourceRecords.get(projectId)!.map(source => source.id)).toEqual(['file-image']);
    expect(briefState().brief.description).toBe(fileBrief.description); expect(actions.canUndoRestore).toBe(true);
    await act(async () => { await actions.undoRestore(); });
    expect(await sameSourceScopeSnapshot(sourceState(), before)).toBe(true);
    await waitFor(() => expect(document.querySelector('img[alt="现场照片：原现场照片.png"]')).not.toBeNull());
    expect(document.querySelector('img[alt="平面图：文件平面图.png"]')).toBeNull();
    expect(screen.getByText(/已识别：.*总宽 12 米/)).toBeDefined();
    expect(forms.get(`${projectId}:brief`)).toEqual(oldBrief); expect(JSON.parse(screen.getByTestId('backup-layout').textContent!)).toEqual(layout);
    expect(controller.startAgentRun).not.toHaveBeenCalled();
  });

  it.skipIf(!localRestoreAvailable())('[V4 sources] preserves existing source bytes and form when restoring an older V3 file', async () => {
    seedSources(); const before = sourceState(); await mount();
    await act(async () => { await actions.restoreBackup(checkinFile(undefined)); });
    expect(restoreSourceScopeIfUnchanged).not.toHaveBeenCalled();
    expect(await sameSourceScopeSnapshot(sourceState(), before)).toBe(true);
    await act(async () => { await actions.undoRestore(); });
    expect(restoreSourceScopeIfUnchanged).not.toHaveBeenCalled();
    expect(await sameSourceScopeSnapshot(sourceState(), before)).toBe(true);
  });

  it.skipIf(!localRestoreAvailable()).each(['absent', 'registration only'] as const)('[V4 sources] keeps a restored %s form unchanged past autosave and allows undo', async kind => {
    seedSources(); const before = sourceState(); await mount();
    const form = kind === 'absent' ? undefined : { registration: { sourceId: 'file-image', points: [{ x: 0, z: 0 }] } };
    const candidate = await sourceFile('file-image', { form });
    await act(async () => { await actions.restoreBackup(candidate); });
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 350)); });
    expect(forms.get(projectId)).toEqual(form);
    await act(async () => { await actions.undoRestore(); });
    expect(await sameSourceScopeSnapshot(sourceState(), before)).toBe(true);
    expect(actions.canUndoRestore).toBe(false);
  });

  it.skipIf(!localRestoreAvailable())('[V4 sources] compensates written image bytes and form after layout commit fails', async () => {
    seedSources(); const before = sourceState(); await mount('reference'); const candidate = await sourceFile();
    commit.mockImplementationOnce(() => { throw new Error('图纸恢复布局提交拒绝'); });
    await act(async () => { await expect(actions.restoreBackup(candidate)).rejects.toThrow('图纸恢复布局提交拒绝'); });
    expect(restoreSourceScopeIfUnchanged).toHaveBeenCalledTimes(2);
    expect(await sameSourceScopeSnapshot(sourceState(), before)).toBe(true);
    expect(forms.get(`${projectId}:brief`)).toEqual(oldBrief); expect(actions.canUndoRestore).toBe(false);
    await waitFor(() => expect(document.querySelector('img[alt="现场照片：原现场照片.png"]')).not.toBeNull());
    expect(screen.getByText(/已识别：.*总宽 12 米/)).toBeDefined();
  });

  it.skipIf(!localRestoreAvailable())('[V4 sources] treats readback failure as a completed write requiring compensation', async () => {
    seedSources(); const before = sourceState(); await mount(); const candidate = await sourceFile(); let failed = false;
    vi.mocked(readSourceScopeSnapshot).mockImplementation(async scope => {
      const saved = sourceState(scope);
      if (!failed && saved.sources.some(source => source.id === 'file-image')) { failed = true; throw new Error('图片写入后的读回拒绝'); }
      return saved;
    });
    await act(async () => { await expect(actions.restoreBackup(candidate)).rejects.toThrow('图片写入后的读回拒绝'); });
    expect(failed).toBe(true); expect(restoreSourceScopeIfUnchanged).toHaveBeenCalledTimes(2);
    expect(commit).not.toHaveBeenCalled(); expect(await sameSourceScopeSnapshot(sourceState(), before)).toBe(true);
    expect(forms.get(`${projectId}:brief`)).toEqual(oldBrief); expect(actions.canUndoRestore).toBe(false);
  });

  it.skipIf(!localRestoreAvailable()).each(['form', 'image'] as const)('[V4 sources] refuses undo over newer %s edits', async change => {
    seedSources(); await mount(); const candidate = await sourceFile();
    await act(async () => { await actions.restoreBackup(candidate); });
    if (change === 'form') forms.set(projectId, { ...newDrawing, text: '恢复后新图纸说明' });
    else sourceRecords.get(projectId)![0]!.blob = new NodeBlob(['newer image bytes'], { type: 'image/png' }) as Blob;
    const edited = sourceState(), commits = commit.mock.calls.length;
    await act(async () => { await expect(actions.undoRestore()).rejects.toThrow('已有新变化'); });
    expect(await sameSourceScopeSnapshot(sourceState(), edited)).toBe(true); expect(commit).toHaveBeenCalledTimes(commits);
    expect(forms.get(`${projectId}:brief`)).toEqual(fileBrief);
  });

  it('[V4 sources] refuses complete backup with a cloud-only source instead of emitting a partial package', async () => {
    seedSources(); const { blob: _blob, ...reference } = imageFixture(); sourceRecords.set(projectId, [reference]); await mount();
    let output: string | undefined;
    await act(async () => { await expect(actions.prepareBackup({ includeSourceDocuments: true }).then(text => { output = text; })).rejects.toThrow('缺少本机原图'); });
    expect(output).toBeUndefined(); expect(restoreSourceScopeIfUnchanged).not.toHaveBeenCalled();
    expect(sourceRecords.get(projectId)).toEqual([reference]); expect(controller.startAgentRun).not.toHaveBeenCalled();
  });

  it.skipIf(!localRestoreAvailable())('[V4 sources] waits for queued cloud removal and keeps the subsequently restored image with the same local id', async () => {
    seedSources(); sourceRecords.get(projectId)![0]!.assetId = '80000000-0000-4000-8000-000000000001';
    let finish!: () => void;
    const remove = vi.spyOn(controller, 'removeSource').mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    await mount('reference'); const candidate = await sourceFile('original-image');
    fireEvent.click(screen.getByRole('button', { name: '移除 原现场照片.png', hidden: true }));
    await waitFor(() => expect(remove).toHaveBeenCalledOnce());
    let pending!: Promise<void>;
    await act(async () => { pending = actions.restoreBackup(candidate); void pending.catch(() => {}); await Promise.resolve(); });
    expect(commit).not.toHaveBeenCalled(); expect(restoreSourceScopeIfUnchanged).not.toHaveBeenCalled();
    await act(async () => { finish(); await pending; });
    await waitFor(() => expect(document.querySelector('img[alt="平面图：文件平面图.png"]')).not.toBeNull());
    expect(sourceRecords.get(projectId)).toEqual([expect.objectContaining({ id: 'original-image', name: '文件平面图.png', kind: 'floorplan' })]);
    await act(async () => { await flushSourceScope(projectId); });
    expect(sourceRecords.get(projectId)!.map(source => source.name)).toEqual(['文件平面图.png']);
    expect(controller.startAgentRun).not.toHaveBeenCalled();
  });

  it.skipIf(!localRestoreAvailable())('completes local-activity navigation after the real provider commits and changes its scope',async()=>{
    const complete=vi.fn(),original=ledger();forms.set(checkinKey(),original);
    renderUI(<Trial activitiesCompleted={complete}/>);await waitFor(()=>expect(briefState().ready).toBe(true));
    fireEvent.change(screen.getByLabelText('新活动名称'),{target:{value:'独立活动集成演练'}});
    fireEvent.click(screen.getByRole('button',{name:'新建活动'}));
    await waitFor(()=>expect(commit).toHaveBeenCalledOnce());
    await waitFor(()=>expect(complete).toHaveBeenCalledOnce());
    const current=JSON.parse(screen.getByTestId('backup-layout').textContent!) as RoomLayout;
    expect(current.id).not.toBe(projectId);expect(current.name).toBe('独立活动集成演练');
    expect((screen.getByLabelText('新活动名称') as HTMLInputElement).value).toBe('');
    expect(forms.get(checkinKey())).toEqual(original);
    expect(forms.has(JSON.stringify(['local-activity',projectId]))).toBe(true);
    expect(forms.get(JSON.stringify(['material-checkins',current.id]))).toBeUndefined();
  });
  it('keeps the current activity and archive untouched when new activity creation is paused', async () => {
    const complete=vi.fn(), original=ledger(); forms.set(checkinKey(),original);
    renderUI(<Trial activitiesCompleted={complete}/>); await waitFor(()=>expect(briefState().ready).toBe(true));
    expect(screen.getByText(/新建或打开其他活动暂不可用/)).toBeTruthy();
    const before=structuredClone([...forms.entries()]), writes=vi.mocked(updateSourceForm).mock.calls.length;
    fireEvent.submit(screen.getByRole('form',{name:'新建活动'}));
    await act(async()=>{});
    expect(commit).not.toHaveBeenCalled(); expect(complete).not.toHaveBeenCalled();
    expect(vi.mocked(updateSourceForm)).toHaveBeenCalledTimes(writes);
    expect([...forms.entries()]).toEqual(before);
    expect(JSON.parse(screen.getByTestId('backup-layout').textContent!).id).toBe(projectId);
  });
  it.skipIf(!localRestoreAvailable())('backs up a scene-connected local activity and disconnects only its remote context before restoring',async()=>{
    connected();snapshot={...snapshot,geometryBinding:{version:1,localActivityId:projectId,cloudProjectId:projectId,userId:'test-user',apiUrl:controller.config.apiUrl}};
    vi.spyOn(controller,'isGeometryBound').mockImplementation(id=>id===projectId&&!!snapshot.geometryBinding);
    const disconnect=vi.spyOn(controller,'disconnectGeometryWorkbench').mockImplementation(async()=>{
      snapshot={...snapshot,geometryBinding:null,project:null,lease:null,writeBlocked:true};controller.setDraft(scene);
    });
    const original=ledger();forms.set(checkinKey(),original);await mount();
    const backup=parseLocalProjectBackupJson(await actions.prepareBackup());expect(backup.materialCheckins).toEqual({status:'present',value:original});
    expect(disconnect).not.toHaveBeenCalled();
    await act(async()=>{await actions.restoreBackup(file('different-local-activity'));});
    expect(disconnect).toHaveBeenCalledOnce();expect(JSON.parse(screen.getByTestId('backup-layout').textContent!).id).toBe('different-local-activity');
    expect(forms.get(checkinKey())).toEqual(original);
  });

  it.skipIf(!localRestoreAvailable())('backs up independent checkins as V3 and preserves them through old or absent-ledger restores',async()=>{
    const original=ledger();forms.set(checkinKey(),original);await mount();
    const backup=parseLocalProjectBackupJson(await actions.prepareBackup());
    expect(backup.backupVersion).toBe(3);expect(backup.materialCheckins).toEqual({status:'present',value:original});
    await act(async()=>{await actions.restoreBackup(file());});expect(forms.get(checkinKey())).toEqual(original);
    await act(async()=>{await actions.undoRestore();});
    await act(async()=>{await actions.restoreBackup(checkinFile(undefined));});expect(forms.get(checkinKey())).toEqual(original);
    expect(updateSourceForm).not.toHaveBeenCalled();
  });
  it.skipIf(!localRestoreAvailable())('merges V3 facts idempotently and undo removes only this unchanged import',async()=>{
    const original=ledger();forms.set(checkinKey(),original);await mount();
    await act(async()=>{await actions.restoreBackup(checkinFile(ledger(2)));});
    await waitFor(()=>expect(actions.canUndoRestore).toBe(true));
    expect((forms.get(checkinKey()) as ReturnType<typeof ledger>).sheets).toHaveLength(2);
    await act(async()=>{await actions.undoRestore();});expect(forms.get(checkinKey())).toEqual(original);
    await act(async()=>{await actions.restoreBackup(checkinFile(original));});
    expect(forms.get(checkinKey())).toEqual(original);
  });
  it.skipIf(!localRestoreAvailable())('rejects conflicting checkin content before touching the brief or layout',async()=>{
    const original=ledger();forms.set(checkinKey(),original);await mount();
    const conflict=structuredClone(original);conflict.sheets[0].agreements[0].agreedQuantity=19;
    await act(async()=>{await expect(actions.restoreBackup(checkinFile(conflict))).rejects.toThrow();});
    expect(commit).not.toHaveBeenCalled();expect(forms.get(`${projectId}:brief`)).toEqual(oldBrief);
    expect(forms.get(checkinKey())).toEqual(original);expect(updateSourceForm).not.toHaveBeenCalled();
  });
  it.skipIf(!localRestoreAvailable())('does not undo an imported ledger over facts appended afterward',async()=>{
    forms.set(checkinKey(),ledger());await mount();
    await act(async()=>{await actions.restoreBackup(checkinFile(ledger(2)));});
    const newer=mergeMaterialCheckinLedgers(forms.get(checkinKey()) as ReturnType<typeof ledger>,ledger(3));forms.set(checkinKey(),newer);
    await act(async()=>{await expect(actions.undoRestore()).rejects.toThrow('新的点验记录');});
    expect(forms.get(checkinKey())).toEqual(newer);expect(JSON.parse(screen.getByTestId('backup-layout').textContent!).name).toBe('点验文件布局');
  });
  it.skipIf(!localRestoreAvailable())('compensates the ledger and brief when applying the restored layout fails',async()=>{
    const original=ledger();forms.set(checkinKey(),original);await mount();commit.mockImplementationOnce(()=>{throw new Error('模拟布局保存失败');});
    await act(async()=>{await expect(actions.restoreBackup(checkinFile(ledger(2)))).rejects.toThrow('模拟布局保存失败');});
    expect(forms.get(checkinKey())).toEqual(original);expect(forms.get(`${projectId}:brief`)).toEqual(oldBrief);
    expect(JSON.parse(screen.getByTestId('backup-layout').textContent!)).toEqual(layout);
  });
  it.skipIf(!localRestoreAvailable())('retains a failed fact compensation and repairs it before retrying the restore',async()=>{
    const original=ledger();forms.set(checkinKey(),original);await mount();
    const normal=vi.mocked(updateSourceForm).getMockImplementation()!;let writes=0;
    vi.mocked(updateSourceForm).mockImplementation(async(...args)=>{if(++writes===2)throw new Error('点验回退写入拒绝');return normal(...args);});
    commit.mockImplementationOnce(()=>{throw new Error('模拟布局保存失败');});
    await act(async()=>{await expect(actions.restoreBackup(checkinFile(ledger(2)))).rejects.toThrow('点验记录回退未完成');});
    await expect(actions.prepareBackup()).rejects.toThrow('点验恢复的回退尚未完成');
    await act(async()=>{await actions.restoreBackup(checkinFile(ledger(2)));});
    expect((forms.get(checkinKey()) as ReturnType<typeof ledger>).sheets).toHaveLength(2);
    await waitFor(()=>expect(actions.canUndoRestore).toBe(true));await act(async()=>{await actions.undoRestore();});
    expect(forms.get(checkinKey())).toEqual(original);
  });
  it.skipIf(!localRestoreAvailable())('restores imported facts again if the layout commit fails during undo',async()=>{
    const original=ledger();forms.set(checkinKey(),original);await mount();
    await act(async()=>{await actions.restoreBackup(checkinFile(ledger(2)));});
    const merged=structuredClone(forms.get(checkinKey()));commit.mockImplementationOnce(()=>{throw new Error('撤销布局失败');});
    await act(async()=>{await expect(actions.undoRestore()).rejects.toThrow('撤销布局失败');});
    expect(forms.get(checkinKey())).toEqual(merged);expect(forms.get(`${projectId}:brief`)).toEqual(fileBrief);
    await act(async()=>{await actions.undoRestore();});expect(forms.get(checkinKey())).toEqual(original);
  });

  it.skipIf(!localRestoreAvailable())('restores and undoes the complete production plan, but cannot undo over a newer plan edit',async()=>{
    const rowId='70000000-0000-4000-8000-000000000001';
    const original=productionPlanSchema.parse({dataKind:'rehearsal',staffing:[{id:rowId,roleName:'签到岗位',headcount:2}]});
    layout={...layout,productionPlan:original};await mount();
    const candidate=file();const updated=productionPlanSchema.parse({...original,staffing:[{...original.staffing[0]!,headcount:3}]});
    candidate.layout.productionPlan=updated;
    await act(async()=>{await actions.restoreBackup(candidate);});
    expect(JSON.parse(screen.getByTestId('backup-layout').textContent!).productionPlan).toEqual(updated);
    await act(async()=>{await actions.undoRestore();});
    expect(JSON.parse(screen.getByTestId('backup-layout').textContent!).productionPlan).toEqual(original);
    await act(async()=>{await actions.restoreBackup(candidate);});
    act(()=>changeLayout({...candidate.layout,productionPlan:{...updated,staffing:[{...updated.staffing[0]!,headcount:4}]}}));
    expect(actions.canUndoRestore).toBe(false);
    await expect(actions.undoRestore()).rejects.toThrow('新编辑');
    expect(JSON.parse(screen.getByTestId('backup-layout').textContent!).productionPlan.staffing[0].headcount).toBe(4);
  });
  it('恢复保障暂停时恢复和撤销都不写任何资料', async () => {
    seedSources(); await mount();
    const candidate=await sourceFile();
    const beforeForms=structuredClone([...forms.entries()]);
    const beforeSources=structuredClone([...sourceRecords.entries()]);
    const writes=vi.mocked(storeSourceForm).mock.calls.length;
    await expect(actions.restoreBackup(candidate)).rejects.toThrow('备份恢复暂不可用');
    await expect(actions.undoRestore()).rejects.toThrow('备份恢复暂不可用');
    expect(forms.size).toBe(beforeForms.length);
    expect([...forms.entries()]).toEqual(beforeForms);
    expect([...sourceRecords.entries()]).toEqual(beforeSources);
    expect(vi.mocked(storeSourceForm)).toHaveBeenCalledTimes(writes);
    expect(commit).not.toHaveBeenCalled();
    expect(actions.canUndoRestore).toBe(false);
  });

  it('passes the same lease guard to the registered activity brief flush', async () => {
    await mount();fireEvent.change(screen.getByRole('textbox',{name:'客户需求'}),{target:{value:'新的活动需求'}});
    const controllerAbort=new AbortController(),guard={kind:'ordinary' as const,signal:controllerAbort.signal,assertStillHeld(){}};
    await act(async()=>{await flushSourceScope(projectId,guard);});
    expect(storeSourceForm).toHaveBeenCalledWith(`${projectId}:brief`,expect.objectContaining({description:'新的活动需求'}),guard);
  });

  it('暂停恢复时仍能导出并读取独立点验备份，不能断开当前场景', async () => {
    connected(); snapshot={...snapshot,geometryBinding:{version:1,localActivityId:projectId,cloudProjectId:projectId,userId:'test-user',apiUrl:controller.config.apiUrl}};
    vi.spyOn(controller,'isGeometryBound').mockImplementation(id=>id===projectId);
    const disconnect=vi.spyOn(controller,'disconnectGeometryWorkbench');
    const original=ledger(); forms.set(checkinKey(),original); await mount();
    const exported=await actions.prepareBackup();
    const backup=parseLocalProjectBackupJson(exported);
    expect(backup.materialCheckins).toEqual({status:'present',value:original});
    const beforeForms=structuredClone([...forms.entries()]);
    await expect(actions.restoreBackup(file('different-local-activity'))).rejects.toThrow('备份恢复暂不可用');
    expect(disconnect).not.toHaveBeenCalled(); expect(commit).not.toHaveBeenCalled();
    expect([...forms.entries()]).toEqual(beforeForms);
    expect(parseLocalProjectBackupJson(exported).materialCheckins).toEqual(backup.materialCheckins);
  });

  it('rejects an in-memory V1 candidate augmented with new production data before writing either source',async()=>{
    await mount();const candidate=file();candidate.backupVersion=1;candidate.layout.productionPlan=productionPlanSchema.parse({});
    const writes=vi.mocked(storeSourceForm).mock.calls.length;
    await expect(actions.restoreBackup(candidate)).rejects.toThrow();
    expect(commit).not.toHaveBeenCalled();expect(vi.mocked(storeSourceForm).mock.calls).toHaveLength(writes);
    expect(forms.get(`${projectId}:brief`)).toEqual(oldBrief);
  });

  it('flushes the currently dirty provider and exports the real readback with empty/fractional facts preserved', async () => {
    await mount(); fireEvent.change(screen.getByRole('textbox', { name: '客户需求' }), { target: { value: '刚输入的真实需求' } });
    let text = ''; await act(async () => { text = await actions.prepareBackup(); });
    expect(parseLocalProjectBackupJson(text).brief).toMatchObject({ status: 'present', value: { guests: 0, description: '刚输入的真实需求', allowIdeas: false } });
    expect(forms.get(`${projectId}:brief`)).toMatchObject({ description: '刚输入的真实需求' });
    expect(commit).not.toHaveBeenCalled(); expect(onApply).not.toHaveBeenCalled();
  });
  it.each(['read', 'save'] as const)('refuses export after a %s failure and keeps the input', async failure => {
    await mount(); fireEvent.change(screen.getByRole('textbox', { name: '客户需求' }), { target: { value: '未丢的草稿' } });
    if (failure === 'read') vi.mocked(readSourceForm).mockRejectedValueOnce(new Error('读取拒绝'));
    else vi.mocked(storeSourceForm).mockRejectedValueOnce(new Error('写入拒绝'));
    await act(async () => { await expect(actions.prepareBackup()).rejects.toThrow(); });
    expect(briefState().brief.description).toBe('未丢的草稿'); expect(commit).not.toHaveBeenCalled();
  });
  it('stops a delayed export on A→B→A and rejects overlapping clicks', async () => {
    await mount(); let release!: (value: unknown) => void;
    vi.mocked(readSourceForm).mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    let pending!: Promise<string>; await act(async () => { pending = actions.prepareBackup(); void pending.catch(() => {}); await Promise.resolve(); });
    await expect(actions.prepareBackup()).rejects.toThrow('正在处理备份');
    act(() => { changeLayout({ ...layout, id: 'backup-b' }); }); act(() => { changeLayout(layout); });
    await act(async () => { release(oldBrief); await expect(pending).rejects.toThrow('已变化'); });
    expect(commit).not.toHaveBeenCalled();
  });
  it.skipIf(!localRestoreAvailable())('restores the same scope after dirty save, cancels its timer/cache, and undo restores layout plus brief', async () => {
    await mount(); vi.useFakeTimers();
    fireEvent.change(screen.getByRole('textbox', { name: '客户需求' }), { target: { value: '确认前的草稿' } });
    await act(async () => { await actions.restoreBackup(file()); await vi.advanceTimersByTimeAsync(600); await flushSourceScope(projectId); });
    expect(briefState()).toMatchObject({ hasSavedBrief: true, brief: fileBrief });
    expect(forms.get(`${projectId}:brief`)).toEqual(fileBrief); expect(JSON.parse(screen.getByTestId('backup-layout').textContent!).name).toBe('文件布局');
    expect(actions.canUndoRestore).toBe(true);
    await act(async () => { await actions.undoRestore(); await vi.advanceTimersByTimeAsync(600); });
    expect(forms.get(`${projectId}:brief`)).toMatchObject({ description: '确认前的草稿', guests: 0 });
    expect(briefState().brief.description).toBe('确认前的草稿');
    expect(JSON.parse(screen.getByTestId('backup-layout').textContent!)).toEqual(layout); expect(actions.canUndoRestore).toBe(false);
  });
  it.skipIf(!localRestoreAvailable())('drains a prior deferred save and prevents timers from queuing late old writes during restore', async () => {
    await mount(); vi.useFakeTimers(); let release!: () => void, held = false;
    vi.mocked(storeSourceForm).mockImplementation((key, value) => {
      if(key.endsWith(':brief')&&!held){held=true;return new Promise(resolve=>{release=()=>{forms.set(key,value);resolve();};});}
      forms.set(key,value);return Promise.resolve();
    });
    fireEvent.change(screen.getByRole('textbox', { name: '客户需求' }), { target: { value: '排队中的旧草稿' } });
    await act(async () => { await vi.advanceTimersByTimeAsync(250); });
    let pending!: Promise<void>; await act(async () => { pending = actions.restoreBackup(file()); void pending.catch(() => {}); await vi.advanceTimersByTimeAsync(600); });
    expect(vi.mocked(storeSourceForm).mock.calls.filter(([key])=>key.endsWith(':brief'))).toHaveLength(1);
    await act(async () => { release(); await pending; await vi.advanceTimersByTimeAsync(1000); await flushSourceScope(projectId); });
    expect(forms.get(`${projectId}:brief`)).toEqual(fileBrief); expect(briefState().brief).toMatchObject(fileBrief);
    expect(vi.mocked(storeSourceForm).mock.calls.filter(([key])=>key.endsWith(':brief')).at(-1)?.[1]).toEqual(fileBrief);
  });
  it.skipIf(!localRestoreAvailable())('stops restore during a delayed original flush after A→B→A and retains the original dirty cache', async () => {
    await mount(); let release!: () => void;
    vi.mocked(storeSourceForm).mockImplementationOnce((key, value) => new Promise(resolve => { release = () => { forms.set(key, value); resolve(); }; }));
    fireEvent.change(screen.getByRole('textbox', { name: '客户需求' }), { target: { value: 'A确认前输入' } });
    let pending!: Promise<void>; await act(async () => { pending = actions.restoreBackup(file()); void pending.catch(() => {}); await Promise.resolve(); });
    await waitFor(() => expect(release).toBeTypeOf('function'));
    act(() => { changeLayout({ ...layout, id: 'backup-b' }); }); act(() => { changeLayout(layout); });
    await act(async () => { release(); await expect(pending).rejects.toThrow('已变化'); });
    expect(commit).not.toHaveBeenCalled(); expect(briefState().brief.description).toBe('A确认前输入');
    expect(forms.get(`${projectId}:brief`)).toMatchObject({ description: 'A确认前输入' });
  });
  it.skipIf(!localRestoreAvailable()).each(['stay','switch'] as const)('at 100ms restore freezes the 250ms timer; %s keeps the final scope consistent',async transition=>{
    await mount();vi.useFakeTimers();let release!:()=>void,held=false;
    const layoutB={...layout,id:'backup-b',name:'B原布局',width:9};const briefB={...oldBrief,description:'B原需求'};forms.set('backup-b:brief',briefB);
    vi.mocked(storeSourceForm).mockImplementation((key,value)=>{
      if(key===`${projectId}:brief`&&!held){held=true;return new Promise(resolve=>{release=()=>{forms.set(key,value);resolve();};});}
      forms.set(key,value);return Promise.resolve();
    });
    fireEvent.change(screen.getByRole('textbox',{name:'客户需求'}),{target:{value:'A待保存编辑'}});
    await act(async()=>{await vi.advanceTimersByTimeAsync(100);});
    let pending!:Promise<void>;await act(async()=>{pending=actions.restoreBackup(file());void pending.catch(()=>{});await Promise.resolve();});
    await act(async()=>{await vi.advanceTimersByTimeAsync(150);});
    expect(vi.mocked(storeSourceForm).mock.calls.filter(([key])=>key.endsWith(':brief'))).toHaveLength(1);
    // W2 never starts: restore clears the old timer synchronously before its first await.
    if(transition==='switch')act(()=>{changeLayout(layoutB);});
    await act(async()=>{release();if(transition==='stay')await pending;else await expect(pending).rejects.toThrow('已变化');await vi.advanceTimersByTimeAsync(600);});
    if(transition==='stay'){expect(forms.get(`${projectId}:brief`)).toEqual(fileBrief);expect(briefState().brief).toMatchObject(fileBrief);}
    else{expect(JSON.parse(screen.getByTestId('backup-layout').textContent!)).toEqual(layoutB);expect(forms.get('backup-b:brief')).toEqual(briefB);expect(briefState().brief.description).toBe('B原需求');expect(commit).not.toHaveBeenCalled();}
  });
  it.skipIf(!localRestoreAvailable()).each(['absent', 'legacy'] as const)('clears existing same-scope brief for %s and undo restores the original', async status => {
    await mount(); await act(async () => { await actions.restoreBackup(file(projectId, status)); });
    expect(forms.has(`${projectId}:brief`)).toBe(false); expect(briefState().hasSavedBrief).toBe(false);
    await act(async () => { await flushSourceScope(projectId); }); expect(forms.has(`${projectId}:brief`)).toBe(false);
    await act(async () => { await actions.undoRestore(); }); expect(forms.get(`${projectId}:brief`)).toEqual(oldBrief);
  });
  it.skipIf(!localRestoreAvailable())('isolates a different target scope and undo preserves both scopes original needs', async () => {
    const other = { ...oldBrief, description: 'B原需求' }; forms.set('backup-b:brief', other);
    await mount(); await act(async () => { await actions.restoreBackup(file('backup-b')); });
    expect(briefState().brief).toMatchObject(fileBrief); expect(forms.get(`${projectId}:brief`)).toEqual(oldBrief);
    await act(async () => { await actions.undoRestore(); });
    expect(forms.get('backup-b:brief')).toEqual(other); expect(forms.get(`${projectId}:brief`)).toEqual(oldBrief);
    expect(briefState().brief.description).toBe('恢复前需求');
  });
  it.skipIf(!localRestoreAvailable())('rolls back the target brief when persistent layout commit refuses the candidate', async () => {
    await mount(); commit.mockImplementationOnce(() => { throw new Error('布局保存拒绝'); });
    await act(async () => { await expect(actions.restoreBackup(file())).rejects.toThrow('布局保存拒绝'); });
    expect(forms.get(`${projectId}:brief`)).toEqual(oldBrief); expect(briefState().brief.description).toBe('恢复前需求');
    expect(JSON.parse(screen.getByTestId('backup-layout').textContent!)).toEqual(layout); expect(actions.canUndoRestore).toBe(false);
  });
  it.skipIf(!localRestoreAvailable()).each(['write', 'readback'] as const)('keeps the original project and rolls back after target %s refusal', async failure => {
    await mount();
    if (failure === 'write') vi.mocked(storeSourceForm).mockRejectedValueOnce(new Error('目标写入拒绝'));
    else {
      let failed = false;
      // The parser clones the file value; compare its contents rather than its identity.
      vi.mocked(readSourceForm).mockImplementation(async key => { const value = forms.get(key); if ((value as typeof fileBrief | undefined)?.description === fileBrief.description && !failed) { failed = true; throw new Error('目标读回拒绝'); } return value; });
    }
    await act(async () => { await expect(actions.restoreBackup(file())).rejects.toThrow('拒绝'); });
    expect(commit).not.toHaveBeenCalled(); expect(forms.get(`${projectId}:brief`)).toEqual(oldBrief); expect(briefState().brief.description).toBe(oldBrief.description);
  });
  it.skipIf(!localRestoreAvailable())('blocks export after same-scope failed restore rollback and resumes export after retry', async () => {
    await mount(); commit.mockImplementationOnce(() => { throw new Error('布局保存拒绝'); });
    vi.mocked(storeSourceForm).mockImplementation(async (key, value) => { if (value === oldBrief) throw new Error('回滚拒绝'); forms.set(key, value); });
    const candidate = file();
    await act(async () => { await expect(actions.restoreBackup(candidate)).rejects.toThrow('回退也失败'); });
    expect(briefState().brief.description).toBe('恢复前需求'); expect(candidate.brief).toMatchObject({ value: fileBrief });
    expect(forms.get(`${projectId}:brief`)).toEqual(fileBrief);expect(JSON.parse(screen.getByTestId('backup-layout').textContent!)).toEqual(layout);
    let output:string|undefined;
    await act(async()=>{await expect(actions.prepareBackup().then(text=>{output=text;})).rejects.toThrow('回退尚未完成');});expect(output).toBeUndefined();
    vi.mocked(storeSourceForm).mockImplementation(async (key, value) => { forms.set(key, value); });
    await act(async () => { await actions.restoreBackup(candidate); }); expect(briefState().brief).toMatchObject(fileBrief);
    await act(async()=>{output=await actions.prepareBackup();});const restored=parseLocalProjectBackupJson(output!);expect(restored.layout.name).toBe('文件布局');expect(restored.brief).toEqual({status:'present',value:fileBrief});
    await act(async () => { await actions.undoRestore(); }); expect(forms.get(`${projectId}:brief`)).toEqual(oldBrief);
  });
  it.skipIf(!localRestoreAvailable())('blocks export after same-scope undo compensation fails and resumes it after undo retry',async()=>{
    await mount();await act(async()=>{await actions.restoreBackup(file());});
    commit.mockImplementationOnce(()=>{throw new Error('撤销布局保存拒绝');});
    vi.mocked(storeSourceForm).mockImplementation(async(key,value)=>{if((value as typeof fileBrief)?.description===fileBrief.description)throw new Error('文件需求补偿拒绝');forms.set(key,value);});
    await act(async()=>{await expect(actions.undoRestore()).rejects.toThrow('回退也失败');});
    expect(forms.get(`${projectId}:brief`)).toEqual(oldBrief);expect(briefState().brief).toMatchObject(fileBrief);expect(JSON.parse(screen.getByTestId('backup-layout').textContent!).name).toBe('文件布局');
    let output:string|undefined;
    await act(async()=>{await expect(actions.prepareBackup().then(text=>{output=text;})).rejects.toThrow('回退尚未完成');});expect(output).toBeUndefined();
    vi.mocked(storeSourceForm).mockImplementation(async(key,value)=>{forms.set(key,value);});
    await act(async()=>{await actions.undoRestore();output=await actions.prepareBackup();});
    const restored=parseLocalProjectBackupJson(output!);expect(restored.layout).toEqual(layout);expect(restored.brief).toEqual({status:'present',value:oldBrief});
  });
  it.skipIf(!localRestoreAvailable())('retains a different target original through failed rollback, retry, and undo', async () => {
    const other = { ...oldBrief, description: 'B原需求' }; forms.set('backup-b:brief', other);
    await mount(); commit.mockImplementationOnce(() => { throw new Error('布局拒绝'); });
    vi.mocked(storeSourceForm).mockImplementation(async (key, value) => { if (value === other) throw new Error('回滚拒绝'); forms.set(key, value); });
    const candidate = file('backup-b');
    await act(async () => { await expect(actions.restoreBackup(candidate)).rejects.toThrow('回退也失败'); });
    expect(briefState().brief.description).toBe(oldBrief.description);
    let output='';await act(async()=>{output=await actions.prepareBackup();});
    const unaffected=parseLocalProjectBackupJson(output);expect(unaffected.layout).toEqual(layout);expect(unaffected.brief).toEqual({status:'present',value:oldBrief});
    vi.mocked(storeSourceForm).mockImplementation(async (key, value) => { forms.set(key, value); });
    await act(async () => { await actions.restoreBackup(candidate); });
    await act(async () => { await actions.undoRestore(); }); expect(forms.get('backup-b:brief')).toEqual(other); expect(forms.get(`${projectId}:brief`)).toEqual(oldBrief);
  });
  it.skipIf(!localRestoreAvailable()).each(['only-A','A-and-B'] as const)('independently compensates undo keys after B readback fails and retries %s compensation failure',async failures=>{
    const other={...oldBrief,description:'B原需求'};forms.set('backup-b:brief',other);
    await mount();await act(async()=>{await actions.restoreBackup(file('backup-b'));});
    let readFailed=false,compensating=false;
    vi.mocked(readSourceForm).mockImplementation(async key=>{
      const value=forms.get(key);
      if(key==='backup-b:brief'&&value===other&&!readFailed){readFailed=true;compensating=true;throw new Error('B撤销读回失败');}
      return value;
    });
    vi.mocked(storeSourceForm).mockImplementation(async(key,value)=>{
      if(compensating&&(key===`${projectId}:brief`||failures==='A-and-B'&&key==='backup-b:brief'))throw new Error(`${key}补偿保存拒绝`);
      forms.set(key,value);
    });
    await act(async()=>{await expect(actions.undoRestore()).rejects.toThrow('回退也失败');});
    expect(JSON.parse(screen.getByTestId('backup-layout').textContent!).id).toBe('backup-b');expect(briefState().brief).toMatchObject(fileBrief);expect(actions.canUndoRestore).toBe(true);
    // B compensation must be attempted even if A compensation rejects.
    expect(vi.mocked(storeSourceForm).mock.calls.filter(([key])=>key==='backup-b:brief').at(-1)?.[1]).toEqual(fileBrief);
    if(failures==='only-A')expect(forms.get('backup-b:brief')).toEqual(fileBrief);else expect(forms.get('backup-b:brief')).toEqual(other);
    vi.mocked(storeSourceForm).mockImplementation(async(key,value)=>{forms.set(key,value);});
    await act(async()=>{await actions.undoRestore();});
    expect(JSON.parse(screen.getByTestId('backup-layout').textContent!)).toEqual(layout);expect(briefState().brief.description).toBe(oldBrief.description);expect(forms.get('backup-b:brief')).toEqual(other);expect(forms.get(`${projectId}:brief`)).toEqual(oldBrief);
  });
  it.skipIf(!localRestoreAvailable())('refuses retrying failed undo compensation after a user edit without overwriting the draft',async()=>{
    const other={...oldBrief,description:'B原需求'};forms.set('backup-b:brief',other);
    await mount();await act(async()=>{await actions.restoreBackup(file('backup-b'));});
    let failed=false,compensating=false;
    vi.mocked(readSourceForm).mockImplementation(async key=>{const value=forms.get(key);if(value===other&&!failed){failed=true;compensating=true;throw new Error('B读回失败');}return value;});
    vi.mocked(storeSourceForm).mockImplementation(async(key,value)=>{if(compensating)throw new Error('补偿拒绝');forms.set(key,value);});
    await act(async()=>{await expect(actions.undoRestore()).rejects.toThrow('回退也失败');});
    fireEvent.change(screen.getByRole('textbox',{name:'客户需求'}),{target:{value:'失败后新输入'}});
    const calls=vi.mocked(storeSourceForm).mock.calls.length;
    await expect(actions.undoRestore()).rejects.toThrow('新编辑');expect(vi.mocked(storeSourceForm).mock.calls).toHaveLength(calls);expect(briefState().brief.description).toBe('失败后新输入');
  });
  it.skipIf(!localRestoreAvailable())('keeps an inactive target dirty draft through restore and undo without blocking the current healthy scope',async()=>{
    const layoutB={...layout,id:'backup-b',name:'B原布局'};forms.set('backup-b:brief',{...oldBrief,description:'B已保存需求'});
    await mount();act(()=>{changeLayout(layoutB);});await waitFor(()=>expect(briefState().brief.description).toBe('B已保存需求'));
    vi.mocked(storeSourceForm).mockImplementation(async(key,value)=>{if(key==='backup-b:brief')throw new Error('B保存拒绝');forms.set(key,value);});
    fireEvent.change(screen.getByRole('textbox',{name:'客户需求'}),{target:{value:'B未保存的真实草稿'}});
    act(()=>{changeLayout(layout);});await waitFor(()=>expect(briefState().brief.description).toBe(oldBrief.description));
    await act(async()=>{await Promise.resolve();});
    vi.mocked(storeSourceForm).mockImplementation(async(key,value)=>{forms.set(key,value);});
    await act(async()=>{await actions.restoreBackup(file('backup-b'));await actions.undoRestore();});
    act(()=>{changeLayout(layoutB);});
    expect(briefState().brief.description).toBe('B未保存的真实草稿');expect(briefState().hasSavedBrief).toBe(false);
    await act(async()=>{await flushSourceScope('backup-b');});expect(forms.get('backup-b:brief')).toMatchObject({description:'B未保存的真实草稿'});
  });
  it('a cached ready draft cannot write after its pending scope lease is cancelled',async()=>{
    const layoutB={...layout,id:'backup-b',name:'B原布局'};forms.set('backup-b:brief',{...oldBrief,description:'B需求'});
    await mount();
    vi.mocked(storeSourceForm).mockImplementation(async(key,value)=>{if(key===`${projectId}:brief`)throw new Error('A首次保存拒绝');forms.set(key,value);});
    fireEvent.change(screen.getByRole('textbox',{name:'客户需求'}),{target:{value:'A仍待保存的草稿'}});
    act(()=>{changeLayout(layoutB);});await waitFor(()=>expect(briefState().brief.description).toBe('B需求'));await act(async()=>{await Promise.resolve();});
    let release!:()=>void,held!:()=>void;
    const started=new Promise<void>(resolve=>{held=resolve;});const wait=new Promise<void>(resolve=>{release=resolve;});
    const lock=navigator.locks.request(`scendance:source-editor:${projectId}`,{mode:'exclusive'},async()=>{held();await wait;});
    await act(async()=>{await started;});
    vi.mocked(storeSourceForm).mockImplementation(async(key,value)=>{forms.set(key,value);});
    const before=vi.mocked(storeSourceForm).mock.calls.filter(([key])=>key===`${projectId}:brief`).length;
    act(()=>{changeLayout(layout);});expect(briefState().brief.description).toBe('A仍待保存的草稿');
    act(()=>{changeLayout(layoutB);});
    await act(async()=>{await Promise.resolve();release();await lock;await Promise.resolve();});
    expect(vi.mocked(storeSourceForm).mock.calls.filter(([key])=>key===`${projectId}:brief`)).toHaveLength(before);expect(forms.get(`${projectId}:brief`)).toEqual(oldBrief);
    act(()=>{changeLayout(layout);});await act(async()=>{await flushSourceScope(projectId);});expect(forms.get(`${projectId}:brief`)).toMatchObject({description:'A仍待保存的草稿'});
  });
  it.skipIf(!localRestoreAvailable())('aborts a restore if the user types while the target write is pending and preserves that input', async () => {
    await mount(); let release!: () => void;
    vi.mocked(storeSourceForm).mockImplementationOnce((key, value) => new Promise(resolve => { release = () => { forms.set(key, value); resolve(); }; }));
    let pending!: Promise<void>; await act(async () => { pending = actions.restoreBackup(file()); void pending.catch(() => {}); await Promise.resolve(); });
    await waitFor(() => expect(release).toBeTypeOf('function'));
    fireEvent.change(screen.getByRole('textbox', { name: '客户需求' }), { target: { value: '恢复期间继续输入' } });
    await act(async () => { release(); await expect(pending).rejects.toThrow('已变化'); });
    expect(forms.get(`${projectId}:brief`)).toEqual(oldBrief); expect(briefState().brief.description).toBe('恢复期间继续输入'); expect(commit).not.toHaveBeenCalled();
    await act(async () => { await flushSourceScope(projectId); }); expect(forms.get(`${projectId}:brief`)).toMatchObject({ description: '恢复期间继续输入' });
  });
  it.skipIf(!localRestoreAvailable())('refuses undo after a new brief edit', async () => {
    await mount(); await act(async () => { await actions.restoreBackup(file()); });
    fireEvent.change(screen.getByRole('textbox', { name: '客户需求' }), { target: { value: '恢复后的新输入' } });
    expect(actions.canUndoRestore).toBe(false); await expect(actions.undoRestore()).rejects.toThrow('新编辑'); expect(briefState().brief.description).toBe('恢复后的新输入');
  });
  it.skipIf(!localRestoreAvailable())('refuses undo when the inactive original scope has a newer saved need',async()=>{
    await mount();await act(async()=>{await actions.restoreBackup(file('backup-b'));});
    const newer={...oldBrief,description:'另一页保存的A新需求'};forms.set(`${projectId}:brief`,newer);
    const writes=vi.mocked(storeSourceForm).mock.calls.filter(([key])=>key.endsWith(':brief')).length;
    await act(async()=>{await expect(actions.undoRestore()).rejects.toThrow('原项目的活动需求');});
    expect(vi.mocked(storeSourceForm).mock.calls.filter(([key])=>key.endsWith(':brief'))).toHaveLength(writes);expect(forms.get(`${projectId}:brief`)).toEqual(newer);expect(briefState().brief).toMatchObject(fileBrief);
  });
  it.skipIf(!localRestoreAvailable())('assigns an ID only once to a no-ID candidate across a failed commit and retry',async()=>{
    await mount();let ids=0;prepare.mockImplementation(next=>({...next,id:next.id??`legacy-target-${++ids}`}));
    const {id:_id,...legacy}=layout;const candidate=parseLocalProjectBackupJson(JSON.stringify({...legacy,name:'旧文件'}));
    commit.mockImplementationOnce(()=>{throw new Error('首次布局拒绝');});
    await act(async()=>{await expect(actions.restoreBackup(candidate)).rejects.toThrow('首次布局拒绝');});
    await act(async()=>{await actions.restoreBackup(candidate);});
    expect(ids).toBe(1);expect(JSON.parse(screen.getByTestId('backup-layout').textContent!).id).toBe('legacy-target-1');expect(candidate.layout.id).toBeUndefined();
  });
  it.skipIf(!localRestoreAvailable())('refuses an occupied target and unsupported cross-page protection before replacing any data', async () => {
    await mount(); const other = renderUI(<CreativeStudioProvider controller={controller} layout={{ ...layout, id: 'backup-b' }} onApply={onApply}><span>另一编辑器</span></CreativeStudioProvider>);
    await act(async () => { await expect(actions.restoreBackup(file('backup-b'))).rejects.toThrow('另一编辑页面'); }); expect(commit).not.toHaveBeenCalled();
    other.unmount(); Reflect.deleteProperty(navigator, 'locks');
    await act(async () => { await expect(actions.restoreBackup(file())).rejects.toThrow('Web Locks'); }); expect(forms.get(`${projectId}:brief`)).toEqual(oldBrief);
  });
  it.skipIf(!localRestoreAvailable())('refuses local restore while a real controller project is bound without calling cloud APIs', async () => {
    connected(); await mount();
    await expect(actions.restoreBackup(file())).rejects.toThrow('云项目'); expect(commit).not.toHaveBeenCalled(); expect(controller.applySceneProposal).not.toHaveBeenCalled();
  });
});

describe('original CreativeBrief storage state', () => {
  it.each([undefined,null,[],42])('does not replace a present malformed brief %j with defaults',async invalid=>{
    sourceMocks.readSourceRecordSnapshot.mockResolvedValue({present:true,value:invalid});
    renderUI(briefForm());expect((await screen.findByRole('alert')).textContent).toContain('活动需求读取失败');
    fireEvent.change(screen.getByRole('textbox',{name:'客户需求'}),{target:{value:'保留的新输入'}});
    await expect(flushSourceScope(projectId)).rejects.toThrow('读取失败');
    expect(updateSourceForm).not.toHaveBeenCalled();expect(vi.mocked(storeSourceForm).mock.calls.some(([key])=>key===`${projectId}:brief`)).toBe(false);
  });
  it('keeps both optional hooks null outside the provider', () => {
    renderUI(<BriefStateProbe/>);
    expect(JSON.parse(screen.getByTestId('brief-state').textContent!)).toEqual({state:null,legacy:null});
  });

  it('does not persist unedited default suggestions', async () => {
    vi.useFakeTimers(); renderUI(briefForm());
    await act(async () => { await Promise.resolve(); await vi.advanceTimersByTimeAsync(300); });
    expect(briefState()).toMatchObject({ready:true,error:null,hasSavedBrief:false});
    expect(screen.getByText('尚未保存；请填写活动类型和人数。')).toBeTruthy();
    await act(async () => { await flushSourceScope(projectId); });
    expect(vi.mocked(storeSourceForm).mock.calls.filter(([key]) => key.endsWith(':brief'))).toHaveLength(0);
  });

  it('requires explicit activity and count even when the chosen values match old defaults', async () => {
    renderUI(briefForm());
    await waitFor(() => expect(briefState().ready).toBe(true));
    const event = screen.getByRole('combobox', {name: '活动类型'}) as HTMLSelectElement;
    const guests = screen.getByRole('spinbutton', {name: '预计人数'}) as HTMLInputElement;
    expect(event.value).toBe('');
    expect(guests.value).toBe('');
    const ideas = screen.getByRole('checkbox', {name: /意料之外的灵感/}) as HTMLInputElement;
    expect(ideas.checked).toBe(false);
    fireEvent.click(ideas);
    expect(briefState().brief).toMatchObject({allowIdeas:true, ideasConfirmed:true});
    fireEvent.change(event, {target: {value: '品牌快闪'}});
    fireEvent.change(guests, {target: {value: '24'}});
    expect(briefState().brief).toMatchObject({event:'品牌快闪', eventConfirmed:true, guests:24, guestsConfirmed:true});
  });

  it('keeps a draft through a read failure, blocks flushing, and recovers by retrying the original key', async () => {
    vi.useFakeTimers();
    vi.mocked(readSourceForm).mockImplementation(async key => {
      if (key.endsWith(':brief')) throw new Error('存储暂时不可用');
      return undefined;
    });
    renderUI(briefForm());
    await act(async () => { await Promise.resolve(); });
    expect(briefState()).toMatchObject({ready:false,hasSavedBrief:false});
    expect(screen.getByRole('alert').textContent).toContain('活动需求读取失败');
    enterBrief();
    fireEvent.change(screen.getByRole('spinbutton', {name:'预计人数'}), {target:{value:'30'}});
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    await expect(flushSourceScope(projectId)).rejects.toThrow('活动需求读取失败');
    expect(vi.mocked(storeSourceForm).mock.calls.filter(([key]) => key.endsWith(':brief'))).toHaveLength(0);
    vi.mocked(readSourceForm).mockImplementation(async key => key.endsWith(':brief') ? prepareLegacyBriefPreservation({event:'工作坊',guests:12,description:'原需求',mustHave:'',allowIdeas:false}) : undefined);
    fireEvent.click(screen.getByRole('button', {name:'重试读取需求'}));
    await act(async () => { await Promise.resolve(); });
    expect(briefState()).toMatchObject({ready:true,error:null,hasSavedBrief:false,brief:{guests:30,description:'给 24 位来宾布置一个交流会，保留中心通道。'}});
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    expect(storeSourceForm).toHaveBeenCalledWith(`${projectId}:brief`, expect.objectContaining({guests:30,description:'给 24 位来宾布置一个交流会，保留中心通道。'}));
    expect(briefState()).toMatchObject({ready:true,error:null,hasSavedBrief:true});
  });

  it('preserves input entered while the original brief is still loading', async () => {
    vi.useFakeTimers();
    let finish!:(saved:unknown)=>void;
    vi.mocked(readSourceForm).mockImplementation(key => key.endsWith(':brief') ? new Promise(resolve=>{finish=resolve;}) : Promise.resolve(undefined));
    renderUI(briefForm()); enterBrief();
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    expect(vi.mocked(storeSourceForm).mock.calls.filter(([key]) => key.endsWith(':brief'))).toHaveLength(0);
    await act(async () => { finish(prepareLegacyBriefPreservation({event:'工作坊',guests:30,description:'存储中的旧需求',mustHave:'',allowIdeas:false})); });
    expect(briefState().brief.description).toBe('给 24 位来宾布置一个交流会，保留中心通道。');
    expect(briefState().brief.guests).toBe(30);
    await act(async () => { await flushSourceScope(projectId); });
    expect(storeSourceForm).toHaveBeenCalledWith(`${projectId}:brief`, expect.objectContaining({guests:30,description:'给 24 位来宾布置一个交流会，保留中心通道。'}));
  });

  it('shows write failure, retains the draft, and reopens a successfully retried brief from its scope', async () => {
    vi.useFakeTimers();
    const forms = new Map<string, unknown>();
    vi.mocked(readSourceForm).mockImplementation(async key => forms.get(key));
    vi.mocked(storeSourceForm).mockImplementation(async (key,value) => {
      if(key.endsWith(':brief')) throw new Error('本机空间不足');
      forms.set(key,value);
    });
    const view=renderUI(briefForm());
    await act(async () => { await Promise.resolve(); });
    enterBrief();
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    expect(screen.getByRole('alert').textContent).toContain('活动需求保存失败');
    expect(briefState()).toMatchObject({ready:true,hasSavedBrief:false,brief:{description:'给 24 位来宾布置一个交流会，保留中心通道。'}});
    await expect(flushSourceScope(projectId)).rejects.toThrow('活动需求保存失败');
    vi.mocked(storeSourceForm).mockImplementation(async (key,value) => { forms.set(key,value); });
    fireEvent.click(screen.getByRole('button', {name:'重试保存需求'}));
    await act(async () => { await Promise.resolve(); });
    expect(briefState()).toMatchObject({ready:true,error:null,hasSavedBrief:true});
    view.unmount(); renderUI(briefForm());
    await act(async () => { await Promise.resolve(); });
    expect(briefState()).toMatchObject({ready:true,error:null,hasSavedBrief:true,brief:{description:'给 24 位来宾布置一个交流会，保留中心通道。'}});
  });

  it('isolates scope changes and ignores a delayed brief from the prior scope', async () => {
    vi.useFakeTimers();
    let finish!:(saved:unknown)=>void;
    const nextId='10000000-0000-4000-8000-000000000002';
    vi.mocked(readSourceForm).mockImplementation(key => key===`${projectId}:brief` ? new Promise(resolve=>{finish=resolve;}) : Promise.resolve(key===`${nextId}:brief` ? prepareLegacyBriefPreservation({event:'工作坊',guests:30,description:'另一个活动',mustHave:'',allowIdeas:false}) : undefined));
    const view=renderUI(briefForm());await act(async()=>{await Promise.resolve();});enterBrief();
    view.rerender(briefForm({...layout,id:nextId}));
    await act(async () => { await Promise.resolve(); });
    expect(briefState()).toMatchObject({ready:true,error:null,hasSavedBrief:true,brief:{guests:30,description:'另一个活动'}});
    await act(async () => { finish(prepareLegacyBriefPreservation({event:'品牌快闪',guests:24,description:'迟到的旧活动',mustHave:'',allowIdeas:true})); await vi.advanceTimersByTimeAsync(300); });
    expect(briefState().brief.description).toBe('另一个活动');
    expect(vi.mocked(storeSourceForm).mock.calls.filter(([key]) => key.endsWith(':brief'))).toHaveLength(0);
    enterBrief(); await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    expect(storeSourceForm).toHaveBeenCalledWith(`${nextId}:brief`,expect.objectContaining({description:'给 24 位来宾布置一个交流会，保留中心通道。'}));
    expect(vi.mocked(storeSourceForm).mock.calls.some(([key]) => key===`${projectId}:brief`)).toBe(false);
  });

  it('saves the original brief key when switching before the debounce and restores it on immediate return', async () => {
    vi.useFakeTimers();
    const nextId='10000000-0000-4000-8000-000000000002';
    const forms=new Map<string,unknown>([[`${projectId}:brief`,prepareLegacyBriefPreservation({event:'工作坊',guests:30,description:'A旧需求',mustHave:'',allowIdeas:false})]]);
    vi.mocked(readSourceForm).mockImplementation(async key=>forms.get(key));
    vi.mocked(storeSourceForm).mockImplementation(async(key,value)=>{forms.set(key,value);});
    const view=renderUI(briefForm());
    await act(async()=>{await Promise.resolve();});
    fireEvent.change(screen.getByRole('textbox',{name:'客户需求'}),{target:{value:'A最新需求'}});
    view.rerender(briefForm({...layout,id:nextId}));
    view.rerender(briefForm());
    await act(async()=>{await Promise.resolve();await vi.advanceTimersByTimeAsync(320);});
    expect(briefState()).toMatchObject({ready:true,error:null,hasSavedBrief:true,brief:{guests:30,description:'A最新需求'}});
    expect(forms.get(`${projectId}:brief`)).toMatchObject({description:'A最新需求',guests:30});
    expect(storeSourceForm).toHaveBeenCalledWith(`${projectId}:brief`,expect.objectContaining({description:'A最新需求'}));
    expect(vi.mocked(storeSourceForm).mock.calls.some(([key])=>key===`${nextId}:brief`)).toBe(false);
  });

  it('retains an old-scope save failure in its draft cache without changing the new scope state', async () => {
    vi.useFakeTimers();
    const nextId='10000000-0000-4000-8000-000000000002';
    const forms=new Map<string,unknown>([
      [`${projectId}:brief`,prepareLegacyBriefPreservation({event:'工作坊',guests:30,description:'A旧需求',mustHave:'',allowIdeas:false})],
      [`${nextId}:brief`,prepareLegacyBriefPreservation({event:'展览市集',guests:12,description:'B已保存需求',mustHave:'',allowIdeas:false})],
    ]);
    vi.mocked(readSourceForm).mockImplementation(async key=>forms.get(key));
    let fail!:(reason:Error)=>void;
    vi.mocked(storeSourceForm).mockImplementation((key)=>key===`${projectId}:brief`?new Promise((_resolve,reject)=>{fail=reject;}):Promise.resolve());
    const view=renderUI(briefForm());
    await act(async()=>{await Promise.resolve();});
    fireEvent.change(screen.getByRole('textbox',{name:'客户需求'}),{target:{value:'A未保存新需求'}});
    view.rerender(briefForm({...layout,id:nextId}));
    await act(async()=>{await Promise.resolve();});
    expect(briefState()).toMatchObject({ready:true,error:null,hasSavedBrief:true,brief:{description:'B已保存需求'}});
    await act(async()=>{fail(new Error('A保存失败'));});
    expect(briefState()).toMatchObject({ready:true,error:null,hasSavedBrief:true,brief:{description:'B已保存需求'}});
    expect(screen.queryByRole('alert')).toBeNull();
    view.rerender(briefForm());
    expect(briefState()).toMatchObject({ready:true,hasSavedBrief:false,brief:{guests:30,description:'A未保存新需求'}});
    expect(screen.getByRole('alert').textContent).toContain('A保存失败');
    expect(forms.get(`${projectId}:brief`)).toMatchObject({description:'A旧需求'});
    expect(vi.mocked(readSourceForm).mock.calls.filter(([key])=>key===`${projectId}:brief`)).toHaveLength(1);
    vi.mocked(storeSourceForm).mockImplementation(async(key,value)=>{forms.set(key,value);});
    fireEvent.click(screen.getByRole('button',{name:'重试保存需求'}));
    await act(async()=>{await Promise.resolve();});
    expect(briefState()).toMatchObject({ready:true,error:null,hasSavedBrief:true,brief:{description:'A未保存新需求'}});
    expect(forms.get(`${projectId}:brief`)).toMatchObject({description:'A未保存新需求'});
  });

  it('restores a draft on A to B to A while the original-key save is still pending', async () => {
    vi.useFakeTimers();
    const nextId='10000000-0000-4000-8000-000000000002';
    vi.mocked(readSourceForm).mockImplementation(async key=>key===`${projectId}:brief`?prepareLegacyBriefPreservation({event:'工作坊',guests:30,description:'A旧需求',mustHave:'',allowIdeas:false}):undefined);
    let finish!:()=>void;
    vi.mocked(storeSourceForm).mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
    const view=renderUI(briefForm());
    await act(async()=>{await Promise.resolve();});
    fireEvent.change(screen.getByRole('textbox',{name:'客户需求'}),{target:{value:'A等待保存的新需求'}});
    view.rerender(briefForm({...layout,id:nextId}));
    await act(async()=>{await Promise.resolve();});
    view.rerender(briefForm());
    expect(briefState()).toMatchObject({ready:true,error:null,hasSavedBrief:false,brief:{guests:30,description:'A等待保存的新需求'}});
    await act(async()=>{finish();});
    expect(briefState()).toMatchObject({ready:true,error:null,hasSavedBrief:true,brief:{description:'A等待保存的新需求'}});
    expect(storeSourceForm).toHaveBeenCalledWith(`${projectId}:brief`,expect.objectContaining({description:'A等待保存的新需求'}));
  });

  it('blocks automatic cloud preparation after a brief read failure', async () => {
    snapshot={...snapshot,configured:true};
    vi.mocked(readSourceForm).mockImplementation(async key => { if(key.endsWith(':brief'))throw new Error('读取失败');return undefined; });
    const ready=vi.spyOn(controller,'ensureWorkbenchReady');
    const local={...layout}; delete local.id;
    render(ui(local));
    await screen.findByRole('button',{name:'重试读取需求'});
    fireEvent.change(screen.getByRole('textbox',{name:'告诉助手你的想法'}),{target:{value:'增加一张桌子'}});
    fireEvent.click(screen.getByRole('button',{name:'发送消息'}));
    await waitFor(()=>expect(screen.getAllByText(/活动需求读取失败/).length).toBeGreaterThan(0));
    expect(ready).not.toHaveBeenCalled(); expect(controller.startAgentRun).not.toHaveBeenCalled();
    expect(vi.mocked(storeSourceForm).mock.calls.filter(([key])=>key.endsWith(':brief'))).toHaveLength(0);
  });

  it('keeps the local identity and inputs when its scene binding cannot be saved', async () => {
    snapshot={...snapshot,configured:true};
    const local={...layout,id:'10000000-0000-4000-8000-000000000009'};
    const bind=vi.fn();
    const ready=vi.spyOn(controller,'ensureGeometryWorkbenchReady').mockRejectedValue(new Error('场景连接记录保存失败，请重试。'));
    render(<CreativeStudioProvider controller={controller} layout={local} onApply={onApply} onBindProject={bind}><CreativeAssistant/><BriefStateProbe/></CreativeStudioProvider>);
    enterBrief();
    fireEvent.change(screen.getByRole('textbox',{name:'告诉助手你的想法'}),{target:{value:'增加一张桌子'}});
    fireEvent.click(screen.getByRole('button',{name:'发送消息'}));
    await screen.findByText('场景连接记录保存失败，请重试。',{selector:'.cr-agent-notice'});
    expect(ready).toHaveBeenCalledOnce(); expect(copySourceScope).not.toHaveBeenCalled();
    expect(bind).not.toHaveBeenCalled();
    expect(controller.startAgentRun).not.toHaveBeenCalled(); expect(onApply).not.toHaveBeenCalled();
    expect(briefState().brief.description).toBe('给 24 位来宾布置一个交流会，保留中心通道。');
    expect(storeSourceForm).toHaveBeenCalledWith(`${local.id}:brief`,expect.objectContaining({description:'给 24 位来宾布置一个交流会，保留中心通道。'}));
    expect(local.id).toBe('10000000-0000-4000-8000-000000000009');
    expect(controller.getSnapshot().project).toBeNull();
  });
});


describe('context continuity and project isolation', () => {
  it('carries confirmed design requirements into successive assistant requests', async () => {
    connected(); render(ui()); enterBrief();
    selectBusiness('活动需求');
    fireEvent.change(screen.getByRole('textbox',{name:'客户需求'}),{target:{value:'风格简约现代，配色米白橄榄绿，材质温暖聚会。'}});
    const send=async(text:string)=>{
      fireEvent.change(screen.getByRole('textbox',{name:'告诉助手你的想法'}),{target:{value:text}});
      fireEvent.click(screen.getByRole('button',{name:'发送消息'}));
      await waitFor(()=>expect(screen.getByRole('button',{name:'确认布置'})).toBeTruthy());
    };
    await send('把交流区靠近入口');
    fireEvent.click(screen.getByRole('button',{name:'放弃'}));
    await send('再留宽一点');
    const prompt=JSON.stringify(vi.mocked(prepareProposal).mock.calls[1]![0]);
    for(const text of ['简约现代','米白橄榄绿','温暖聚会','把交流区靠近入口','再留宽一点']) expect(prompt).toContain(text);
    expect(prompt).not.toContain(proposal.explanation);expect(prompt).toContain('上次方案说明未经核验');
    expect(onApply).not.toHaveBeenCalled();
  });

  it('clears old brief and conversation on project switch and ignores an old in-flight response', async () => {
    connected(); const rendered=render(ui()); enterBrief();
    fireEvent.change(screen.getByRole('textbox',{name:'告诉助手你的想法'}),{target:{value:'旧项目策划草稿'}});
    selectMode('model');fireEvent.change(screen.getByRole('textbox',{name:'告诉助手你的想法'}),{target:{value:'生成一把木椅'}});selectMode('plan');
    let finish!:(value:SceneProposal)=>void;
    vi.mocked(prepareProposal).mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
    fireEvent.click(screen.getByRole('button',{name:'按这份细表生成预览'}));
    await waitFor(()=>expect(prepareProposal).toHaveBeenCalledOnce());
    const changed={...layout,id:'10000000-0000-4000-8000-000000000002'};
    rendered.rerender(ui(changed));
    expect((screen.getByRole('textbox',{name:'客户需求'}) as HTMLTextAreaElement).value).toBe('');
    expect((screen.getByRole('textbox',{name:'告诉助手你的想法'}) as HTMLTextAreaElement).value).toBe('');
    selectMode('model');expect((screen.getByRole('textbox',{name:'告诉助手你的想法'}) as HTMLTextAreaElement).value).toBe('');
    await act(async()=>{finish(proposal);});
    expect(screen.queryByText('方案提案 · 尚未应用')).toBeNull();
    expect(screen.queryByText(proposal.explanation)).toBeNull();
    expect(onApply).not.toHaveBeenCalled();
  });
});


describe('review workspace integration',()=>{
  beforeEach(()=>{vi.stubGlobal('innerWidth',1440);});
  it('prepares the real brief without re-flushing unrelated image forms, then expires on a layout edit',async()=>{
    let saved:unknown;
    vi.mocked(readSourceForm).mockImplementation(async key=>key===`${projectId}:brief`?saved:undefined);
    vi.mocked(storeSourceForm).mockImplementation(async(key,value)=>{if(key===`${projectId}:brief`)saved=value;});
    const sources=await import('@/lib/source-storage');const unrelated=vi.fn(async()=>{throw new Error('Unrelated image reload');});
    const unregister=sources.registerSourceFlush(projectId,unrelated);
    try{
      const view=renderUI(<DockedTrial/>);await act(async()=>{});
      selectBusiness('活动需求');
      fireEvent.change(screen.getByRole('textbox',{name:'客户需求'}),{target:{value:'评审专用活动需求：保留入口'}});
      selectBusiness('方案评审');
      fireEvent.click(screen.getByRole('checkbox',{name:'包含当前活动需求'}));
      await waitFor(()=>expect((screen.getByRole('button',{name:'生成评审包'}) as HTMLButtonElement).disabled).toBe(false));
      fireEvent.click(screen.getByRole('button',{name:'生成评审包'}));
      const preview=await screen.findByTitle('客户评审预览');
      expect(preview.getAttribute('srcdoc')).toContain('评审专用活动需求：保留入口');
      expect(unrelated).not.toHaveBeenCalled();expect(onApply).not.toHaveBeenCalled();
      expect(controller.startAgentRun).not.toHaveBeenCalled();
      view.rerender(<DockedTrial current={{...layout,width:layout.width+1}}/>);
      await waitFor(()=>expect(screen.queryByRole('button',{name:'下载评审文件（HTML）'})).toBeNull());
      expect(screen.getByText('评审内容已过期，请重新生成。')).toBeTruthy();
    }finally{unregister();}
  });
  it('keeps the existing model draft while entering and leaving review',async()=>{
    renderUI(<DockedTrial/>);await act(async()=>{});selectMode('model');
    fireEvent.change(screen.getByRole('textbox',{name:'告诉助手你的想法'}),{target:{value:'一把椅子的未发送需求'}});
    selectBusiness('方案评审');
    expect(screen.getByRole('region',{name:'客户评审包'})).toBeTruthy();
    expect((screen.getByRole('combobox',{name:'工作模式'}) as HTMLSelectElement).value).toBe('model');
    fireEvent.click(screen.getByRole('button',{name:'返回素材'}));
    expect((screen.getByRole('textbox',{name:'告诉助手你的想法'}) as HTMLTextAreaElement).value).toBe('一把椅子的未发送需求');
  });
  it('wires local review prefill without sending anything',async()=>{
    const view=renderUI(<DockedTrial workbenchMode="review"/>);await act(async()=>{});
    view.rerender(<DockedTrial workbenchMode="review" reviewOpenRequest={1}/>);await act(async()=>{});
    expect(screen.getByText('核对后导出离线 HTML，由你发送')).toBeTruthy();
    const summary=screen.getByLabelText('简短方案说明（选填）') as HTMLTextAreaElement;
    expect(summary.value).toBe('');
    fireEvent.click(screen.getByRole('button',{name:'生成说明参考'}));
    expect(summary.value).toContain('【方案简述参考');
    fireEvent.change(summary,{target:{value:'演练：人改过的说明'}});
    expect(summary.value).toBe('演练：人改过的说明');
    expect(document.body.textContent).not.toContain('已发送');
  });
  it('labels the execution workspace as local internal material',async()=>{
    renderUI(<DockedTrial workbenchMode="delivery" deliveryOpenRequest={1}/>);await act(async()=>{});
    expect(screen.getByText('执行 · 本机内部资料')).toBeTruthy();
    expect(screen.getByText('活动安排、点验、导出与本机备份')).toBeTruthy();
    expect(document.body.textContent).not.toContain('云端协作');
  });
});

describe('unified Agent', () => {
  it('offers two chat scopes and retains separate planning and modeling drafts', () => {
    renderUI(<CreativeStudioProvider controller={controller} layout={layout} onApply={onApply}><CreativeAssistant/></CreativeStudioProvider>);
    fireEvent.click(screen.getByRole('button', { name: '打开 Bingo Agent' }));
    const modes=screen.getByRole('combobox',{name:'工作模式'}) as HTMLSelectElement;
    expect(Array.from(modes.options).map(option=>option.text)).toEqual(['场景策划','物料生成']);
    fireEvent.change(screen.getByRole('textbox', { name: '告诉助手你的想法' }), { target: { value: '增加两把椅子' } });
    selectMode('model');
    expect((screen.getByRole('textbox',{name:'告诉助手你的想法'}) as HTMLTextAreaElement).value).toBe('');
    fireEvent.change(screen.getByRole('textbox', { name: '告诉助手你的想法' }), { target: { value: '生成一把木椅' } });
    expect(modes.value).toBe('model');
    selectMode('plan');
    expect((screen.getByRole('textbox', { name: '告诉助手你的想法' }) as HTMLTextAreaElement).value).toBe('增加两把椅子');
    selectMode('model');
    expect((screen.getByRole('textbox',{name:'告诉助手你的想法'}) as HTMLTextAreaElement).value).toBe('生成一把木椅');
    expect(prepareProposal).not.toHaveBeenCalled();
  });

  it('expands and restores the same form without losing demand, draft, focus, or either scroll position', async () => {
    const view=renderUI(ui());fireEvent.click(screen.getByRole('button',{name:'打开 Bingo Agent'}));
    await act(async()=>{});
    const panel=screen.getByRole('region',{name:'Agent'});
    const demand=screen.getByRole('textbox',{name:'客户需求'}) as HTMLTextAreaElement;
    const input=screen.getByRole('textbox',{name:'告诉助手你的想法'}) as HTMLTextAreaElement;
    fireEvent.change(demand,{target:{value:'为客户保留入口与交流区'}});
    fireEvent.change(input,{target:{value:'这条调整还没发送'}});
    const content=view.container.querySelector<HTMLElement>('.cr-workspace-content')!;
    const feed=view.container.querySelector<HTMLElement>('.cr-chat-feed')!;
    content.scrollTop=152;feed.scrollTop=64;
    demand.focus();vi.mocked(feed.scrollTo).mockClear();
    expect(view.container.querySelector<HTMLDetailsElement>('.cr-agent-settings')!.open).toBe(false);
    expect(screen.queryByRole('radiogroup',{name:'是否有平面图'})).toBeNull();
    expect(view.container.querySelector<HTMLDetailsElement>('.rc-inputs')).toBeNull();
    fireEvent.click(screen.getByRole('button',{name:'展开工作区'}));
    expect(panel.classList.contains('is-expanded')).toBe(true);
    expect((screen.getByRole('combobox',{name:'工作模式'}) as HTMLSelectElement).form).toBe(input.form);
    content.scrollTop=21;feed.scrollTop=3; // A taller viewport can clamp either browser scroll position.
    fireEvent.click(screen.getByRole('button',{name:'恢复浮窗'}));
    expect(panel.classList.contains('is-expanded')).toBe(false);
    expect(screen.getByRole('region',{name:'Agent'})).toBe(panel);
    expect(screen.getByRole('textbox',{name:'客户需求'})).toBe(demand);
    expect(screen.getByRole('textbox',{name:'告诉助手你的想法'})).toBe(input);
    expect(demand.value).toBe('为客户保留入口与交流区');expect(input.value).toBe('这条调整还没发送');
    expect(document.activeElement).toBe(demand);expect(content.scrollTop).toBe(152);expect(feed.scrollTop).toBe(64);expect(feed.scrollTo).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button',{name:'展开工作区'}));
    expect(content.scrollTop).toBe(21);expect(feed.scrollTop).toBe(3);
    expect(controller.startAgentRun).not.toHaveBeenCalled();
  });

  it('scrolls new chat messages independently of the current activity form', async () => {
    connected();vi.mocked(controller.startAgentRun).mockResolvedValueOnce(runFrom(proposal));
    const view=renderUI(ui());fireEvent.click(screen.getByRole('button',{name:'打开 Bingo Agent'}));
    fireEvent.click(screen.getByRole('button',{name:'展开工作区'}));
    const content=view.container.querySelector<HTMLElement>('.cr-workspace-content')!;
    const feed=view.container.querySelector<HTMLElement>('.cr-chat-feed')!;
    const conversation=view.container.querySelector<HTMLElement>('#creative-conversation')!;
    const demand=screen.getByRole('textbox',{name:'客户需求'});
    expect(content.contains(demand)).toBe(true);expect(feed.contains(demand)).toBe(false);
    expect(conversation.contains(feed)).toBe(true);expect(content.contains(conversation)).toBe(false);
    expect(conversation.contains(screen.getByRole('textbox',{name:'告诉助手你的想法'}))).toBe(true);
    content.scrollTop=219;vi.mocked(feed.scrollTo).mockClear();
    fireEvent.change(screen.getByRole('textbox',{name:'告诉助手你的想法'}),{target:{value:'请给我一个候选布局'}});
    fireEvent.click(screen.getByRole('button',{name:'发送消息'}));await screen.findByText('方案提案 · 尚未应用');
    expect(feed.contains(screen.getByText('方案提案 · 尚未应用'))).toBe(true);
    expect(content.scrollTop).toBe(219);expect(feed.scrollTo).toHaveBeenCalled();
    expect(controller.startAgentRun).toHaveBeenCalledOnce();expect(onApply).not.toHaveBeenCalled();
  });

  it('keeps an unapplied proposal discoverable across activity delivery, templates, and collapsed chat', async () => {
    connected();vi.mocked(controller.startAgentRun).mockResolvedValueOnce(runFrom(proposal));
    renderUI(ui());fireEvent.click(screen.getByRole('button',{name:'打开 Bingo Agent'}));
    fireEvent.change(screen.getByRole('textbox',{name:'告诉助手你的想法'}),{target:{value:'请先给出布置预览'}});
    fireEvent.click(screen.getByRole('button',{name:'发送消息'}));await screen.findByText('方案提案 · 尚未应用');
    const confirm=screen.getByRole('button',{name:'确认布置'});
    fireEvent.click(screen.getByRole('button',{name:'展开工作区'}));
    fireEvent.click(screen.getByRole('button',{name:'收起聊天'}));openExecution();
    selectBusiness('场景模板');
    const reopen=screen.getByRole('button',{name:'展开聊天'});
    expect(reopen.getAttribute('aria-describedby')).toBe('creative-conversation-status');
    expect(document.getElementById('creative-conversation-status')?.textContent).toContain('有方案待确认');
    expect(screen.queryByRole('button',{name:'确认布置'})).toBeNull();
    fireEvent.click(screen.getByRole('button',{name:'关闭 Agent'}));
    fireEvent.click(screen.getByRole('button',{name:'打开 Bingo Agent'}));
    expect(document.activeElement).toBe(reopen);
    const previewCalls=onPreview.mock.calls.length;fireEvent.click(reopen);
    expect(screen.getByRole('button',{name:'确认布置'})).toBe(confirm);
    expect(screen.getByText('方案提案 · 尚未应用')).toBeTruthy();
    expect(screen.getByRole('textbox',{name:'告诉助手你的想法'})).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole('region',{name:'Bingo 聊天'}));
    expect(onPreview.mock.calls).toHaveLength(previewCalls);
    expect(controller.startAgentRun).toHaveBeenCalledOnce();expect(onApply).not.toHaveBeenCalled();
    fireEvent.click(confirm);await waitFor(()=>expect(onApply).toHaveBeenCalledOnce());
  });

  it('keeps a modeling request local to materials and requires confirmation even for a server direct response', async () => {
    connected();vi.mocked(controller.startAgentRun).mockResolvedValueOnce({...runFrom(proposal),executionMode:'direct'});
    renderUI(ui());fireEvent.click(screen.getByRole('button',{name:'打开 Bingo Agent'}));enterBrief();
    fireEvent.change(screen.getByLabelText(/必需项/),{target:{value:'保留无障碍通道'}});
    selectMode('model');
    const input=screen.getByRole('textbox',{name:'告诉助手你的想法'});
    fireEvent.change(input,{target:{value:'创建一把宽 0.5 米的椅子'}});
    fireEvent.click(screen.getByRole('button',{name:'发送消息'}));
    await screen.findByText('方案提案 · 尚未应用');
    const request=vi.mocked(controller.startAgentRun).mock.calls[0]![0];
    expect(request).toMatchObject({executionMode:'preview',scene:layoutToBackendScene(layout),selectedIds:[]});
    expect(request.instruction).toContain('仅创建或调整本次请求指定的物料');
    expect(request.context.brief).toContain('给 24 位来宾');expect(request.context.brief).toContain('保留无障碍通道');
    expect(request.context.brief).not.toContain('请为客户设计一套完整的');expect(request.context.brief).not.toContain('主动布置适合主题的亮点');
    expect((screen.getByRole('combobox',{name:'工作模式'}) as HTMLSelectElement).value).toBe('model');
    expect(onApply).not.toHaveBeenCalled();expect(controller.applySceneProposal).not.toHaveBeenCalled();
    expect(screen.getAllByRole('button',{name:'确认布置'})).toHaveLength(1);
    fireEvent.click(screen.getByRole('button',{name:'展开工作区'}));
    const previewCalls=onPreview.mock.calls.length;
    fireEvent.click(screen.getByRole('button',{name:'回到画布预览'}));
    expect(screen.getByRole('region',{name:'Agent'}).classList.contains('is-expanded')).toBe(false);
    expect(screen.getByText('方案提案 · 尚未应用')).toBeTruthy();expect(onPreview.mock.calls).toHaveLength(previewCalls);
    expect(onApply).not.toHaveBeenCalled();expect(controller.startAgentRun).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button',{name:'确认布置'}));await waitFor(()=>expect(onApply).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByLabelText('助手设置'));
    expect(screen.queryByRole('checkbox',{name:'明确指令直接应用'})).toBeNull();
    expect(screen.getByText('先预览，再确认布置')).toBeTruthy();
  });

  it('requires explicit confirmation before applying a validated text request', async () => {
    connected();
    renderUI(<CreativeStudioProvider controller={controller} layout={layout} onApply={onApply}><CreativeAssistant/></CreativeStudioProvider>);
    fireEvent.click(screen.getByRole('button', { name: '打开 Bingo Agent' }));
    fireEvent.change(screen.getByRole('textbox', { name: '告诉助手你的想法' }), { target: { value: '增加一把椅子' } });
    fireEvent.click(screen.getByRole('button', { name: '发送消息' }));
    await screen.findByText('方案提案 · 尚未应用');expect(onApply).not.toHaveBeenCalled();expect(controller.applySceneProposal).not.toHaveBeenCalled();
    expect(prepareProposal).toHaveBeenCalledWith(expect.objectContaining({executionMode:'preview',jevEnabled:false}));
    fireEvent.click(screen.getByRole('button',{name:'确认布置'}));await waitFor(() => expect(onApply).toHaveBeenCalledOnce());
    expect(vi.mocked(prepareProposal).mock.calls[0]![0].context.brief).not.toContain('预计24人');
    expect(controller.applySceneProposal).toHaveBeenCalledWith(proposal, layoutToBackendScene(layout));
    expect(layoutToBackendScene(onApply.mock.calls[0][0])).toEqual(candidate);
    expect(onApply.mock.calls[0][0].designBook?.variants.map(variant=>variant.name)).toEqual(['原始方案','AI 方案 A']);
  });

  it('sends structured scenes to DeepSeek as material modifications without dropping structure', async () => {
    connected();
    const structured = createMeasuredRoomLayout(layout, { width: 12, depth: 10, height: 3 });
    const baseScene=layoutToBackendScene(structured);
    const structuredCandidate={...baseScene,objects:candidate.objects};
    vi.mocked(prepareProposal).mockResolvedValueOnce({...proposal,base_scene:baseScene,candidate:structuredCandidate});
    vi.mocked(controller.applySceneProposal).mockResolvedValueOnce({id:projectId,revision:2,scene:structuredCandidate,previousScene:baseScene,updatedAt:'2026-10-03T10:00:00Z',undoGroup:'undo-test',acceptedLocally:true});
    renderUI(<CreativeStudioProvider controller={controller} layout={structured} onApply={onApply}><CreativeAssistant/></CreativeStudioProvider>);
    fireEvent.click(screen.getByRole('button', { name: '打开 Bingo Agent' }));
    fireEvent.change(screen.getByRole('textbox', { name: '告诉助手你的想法' }), { target: { value: '增加一把椅子' } });
    fireEvent.click(screen.getByRole('button', { name: '发送消息' }));
    await waitFor(() => expect(prepareProposal).toHaveBeenCalledOnce());
    expect(prepareProposal).toHaveBeenCalledWith(expect.objectContaining({ scene: baseScene }));
    await screen.findByText('方案提案 · 尚未应用');expect(onApply).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:'确认布置'}));await waitFor(()=>expect(onApply).toHaveBeenCalledOnce());
    expect(layoutToBackendScene(onApply.mock.calls[0][0])).toEqual(structuredCandidate);
  });


  it('keeps generation content mounted across modes, sizes, and closing the Agent', () => {
    const mounted=vi.fn(), submitted=vi.fn();
    function Generator() {
      const [text,setText]=useState('');
      useEffect(()=>{mounted();},[]);
      return <><input aria-label="测试物料描述" value={text} onChange={event=>setText(event.target.value)}/><button onClick={submitted}>测试提交</button></>;
    }
    renderUI(<CreativeStudioProvider controller={controller} layout={layout} onApply={onApply}><CreativeAssistant generationPanel={<Generator/>}/></CreativeStudioProvider>);
    fireEvent.click(screen.getByRole('button',{name:'打开 Bingo Agent'}));
    selectMode('model');
    fireEvent.change(screen.getByRole('textbox',{name:'测试物料描述'}),{target:{value:'绿色休闲椅'}});
    const input=screen.getByRole('textbox',{name:'告诉助手你的想法'}) as HTMLTextAreaElement;
    fireEvent.change(input,{target:{value:'尚未发送的建模草稿'}});
    fireEvent.click(screen.getByRole('button',{name:'展开工作区'}));
    input.focus();fireEvent.click(screen.getByRole('button',{name:'收起聊天'}));
    const collapsed=screen.getByRole('button',{name:'展开聊天'});
    expect(collapsed.getAttribute('aria-controls')).toBe('creative-conversation');
    expect(collapsed.getAttribute('aria-expanded')).toBe('false');expect(document.activeElement).toBe(collapsed);
    expect(screen.queryByRole('textbox',{name:'告诉助手你的想法'})).toBeNull();
    expect(screen.getByRole('textbox',{name:'测试物料描述'})).toBeTruthy();
    fireEvent.click(screen.getByRole('button',{name:'材质调整'}));
    fireEvent.click(screen.getByRole('button',{name:'关闭 Agent'}));
    fireEvent.click(screen.getByRole('button',{name:'打开 Bingo Agent'}));
    expect(document.activeElement).toBe(screen.getByRole('button',{name:'展开聊天'}));
    expect(screen.queryByRole('textbox',{name:'告诉助手你的想法'})).toBeNull();
    fireEvent.click(screen.getByRole('button',{name:'物料生成'}));
    fireEvent.click(screen.getByRole('button',{name:'恢复浮窗'}));
    expect(screen.getByRole('textbox',{name:'告诉助手你的想法'})).toBe(input);
    expect(screen.queryByRole('button',{name:'展开聊天'})).toBeNull();
    expect(input.value).toBe('尚未发送的建模草稿');
    input.focus();
    fireEvent.click(screen.getByRole('button',{name:'展开工作区'}));
    expect(screen.getByRole('button',{name:'收起聊天'}).getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('textbox',{name:'告诉助手你的想法'})).toBe(input);
    expect(input.value).toBe('尚未发送的建模草稿');expect(document.activeElement).toBe(input);
    selectMode('plan');
    fireEvent.click(screen.getByRole('button',{name:'关闭 Agent'}));
    fireEvent.click(screen.getByRole('button',{name:'打开 Bingo Agent'}));
    selectMode('model');
    fireEvent.click(screen.getByRole('button',{name:'恢复浮窗'}));
    expect((screen.getByRole('textbox',{name:'测试物料描述'}) as HTMLInputElement).value).toBe('绿色休闲椅');
    expect(document.querySelectorAll('#creative-message')).toHaveLength(1);
    expect(mounted).toHaveBeenCalledOnce();
    expect(submitted).not.toHaveBeenCalled();
  });

  it('keeps the existing design limit when confirming a proposal', async () => {
    connected();
    const full={...layout,designBook:{activeId:'design-0',variants:Array.from({length:20},(_,index)=>({id:`design-${index}`,name:`方案 ${index}`,layout}))}};
    renderUI(<CreativeStudioProvider controller={controller} layout={full} onApply={onApply}><CreativeAssistant/></CreativeStudioProvider>);
    fireEvent.click(screen.getByRole('button',{name:'打开 Bingo Agent'}));
    fireEvent.change(screen.getByRole('textbox',{name:'告诉助手你的想法'}),{target:{value:'增加一把椅子'}});
    fireEvent.click(screen.getByRole('button',{name:'发送消息'}));
    await screen.findByText('方案提案 · 尚未应用');fireEvent.click(screen.getByRole('button',{name:'确认布置'}));
    await waitFor(()=>expect(screen.getByRole('status').textContent).toContain('请先在图层面板移除'));
    expect(controller.applySceneProposal).not.toHaveBeenCalled();
    expect(onApply).not.toHaveBeenCalled();
  });

  it('shows layout warnings after confirming an application', async () => {
    connected();
    vi.mocked(prepareProposal).mockResolvedValueOnce({...proposal,warnings:[{code:'OVERLAP',ids:[candidate.objects[0].id]},{code:'SAFETY_CHECKS_UNKNOWN',ids:[]}]});
    renderUI(<CreativeStudioProvider controller={controller} layout={layout} onApply={onApply}><CreativeAssistant/></CreativeStudioProvider>);
    fireEvent.click(screen.getByRole('button',{name:'打开 Bingo Agent'}));
    fireEvent.change(screen.getByRole('textbox',{name:'告诉助手你的想法'}),{target:{value:'增加一把椅子'}});
    fireEvent.click(screen.getByRole('button',{name:'发送消息'}));
    await screen.findByText('方案提案 · 尚未应用');expect(onApply).not.toHaveBeenCalled();fireEvent.click(screen.getByRole('button',{name:'确认布置'}));await waitFor(()=>expect(onApply).toHaveBeenCalledOnce());
    expect(screen.getByRole('status').textContent).toContain('物件重叠：椅子');
    expect(screen.getByRole('status').textContent).toContain('出口、疏散、门扇、无障碍、消防和核定人数仍需核验');
  });

  it('does not apply a direct response after a scene edit while generation is pending', async () => {
    connected();
    let finish!:(value:SceneProposal)=>void;
    vi.mocked(prepareProposal).mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
    const view=renderUI(<CreativeStudioProvider controller={controller} layout={layout} onApply={onApply}><CreativeAssistant/></CreativeStudioProvider>);
    fireEvent.click(screen.getByRole('button',{name:'打开 Bingo Agent'}));
    fireEvent.change(screen.getByRole('textbox',{name:'告诉助手你的想法'}),{target:{value:'增加一把椅子'}});
    fireEvent.click(screen.getByRole('button',{name:'发送消息'}));
    await waitFor(()=>expect(finish).toBeTypeOf('function'));
    view.rerender(<CreativeStudioProvider controller={controller} layout={{...layout,width:13}} onApply={onApply}><CreativeAssistant/></CreativeStudioProvider>);
    await act(async()=>{finish(proposal);});
    expect(controller.applySceneProposal).not.toHaveBeenCalled();
    expect(onApply).not.toHaveBeenCalled();
    expect(screen.getByRole('status').textContent).toContain('生成期间方案或需求已变化');
  });
});

describe('retained Agent partial results', () => {
  const partialNotice = '后续处理中断，已保留通过检查的方案，请核对后继续。';
  const providerMessage = '演练供应方内部正文，不应显示给操作者。';
  const providerProgress = '演练供应方内部进度，不应作为终态提示。';
  function partialRun(value = proposal, input?: AgentRunInput): AgentRun {
    return { ...runFrom(value, input), executionMode: 'preview', errorCode: 'DATABASE_ERROR', message: providerMessage, progress: providerProgress };
  }
  function send(instruction = '演练：先核对椅子方案'): void {
    fireEvent.change(screen.getByRole('textbox', { name: '告诉助手你的想法' }), { target: { value: instruction } });
    fireEvent.click(screen.getByRole('button', { name: '发送消息' }));
  }
  function expectSafeText(container: HTMLElement): void {
    expect(container.textContent).not.toContain('DATABASE_ERROR');
    expect(container.textContent).not.toContain(providerMessage); expect(container.textContent).not.toContain(providerProgress);
  }

  it.each(['preview', 'unchanged', 'direct'] as const)('[retained partial POST] keeps the valid %s result and shows a safe interruption notice', async mode => {
    connected();
    const value = mode === 'unchanged' ? { ...proposal, candidate: scene, explanation: '已核对当前场景，本次不调整物件。' } : proposal;
    vi.mocked(controller.startAgentRun).mockImplementationOnce(async input => ({ ...partialRun(value, input), executionMode: mode === 'direct' ? 'direct' : 'preview' }));
    function AppliedWorkspace() {
      const [current, setCurrent] = useState(layout);
      return <CreativeStudioProvider controller={controller} layout={current} onApply={next => { onApply(next); setCurrent(next); }} onPreview={onPreview}><CreativeAssistant/></CreativeStudioProvider>;
    }
    const view = renderUI(mode === 'direct' ? <AppliedWorkspace/> : ui()); fireEvent.click(screen.getByRole('button', { name: '打开 Bingo Agent' }));
    send();
    expect((await screen.findByText(partialNotice)).getAttribute('role')).toBe('status');
    if (mode === 'preview') {
      await screen.findByText('方案提案 · 尚未应用');
      expect(screen.getByRole('button', { name: '确认布置' })).toBeTruthy();
      expect(onPreview).toHaveBeenLastCalledWith(expect.objectContaining({ id: projectId }));
      expect(controller.applySceneProposal).not.toHaveBeenCalled(); expect(onApply).not.toHaveBeenCalled();
    } else if (mode === 'unchanged') {
      await screen.findByText(value.explanation);
      expect(screen.queryByText('方案提案 · 尚未应用')).toBeNull(); expect(controller.authorizeAssets).not.toHaveBeenCalled();
      expect(controller.applySceneProposal).not.toHaveBeenCalled(); expect(onApply).not.toHaveBeenCalled();
    } else {
      await screen.findByText('方案提案 · 尚未应用');
      expect(controller.applySceneProposal).not.toHaveBeenCalled();expect(onApply).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole('button',{name:'确认布置'}));await waitFor(()=>expect(onApply).toHaveBeenCalledOnce());
      expect(controller.applySceneProposal).toHaveBeenCalledWith(value, layoutToBackendScene(layout));
      expect(layoutToBackendScene(onApply.mock.calls[0]![0])).toEqual(candidate);
    }
    expect(controller.startAgentRun).toHaveBeenCalledOnce(); expectSafeText(view.container);
  });

  it.each(['requestId', 'runId'] as const)('[retained partial GET] reads the original %s without another paid dispatch', async route => {
    connected();
    let requestId = '70000000-0000-4000-8000-000000000001';
    const runId = partialRun().id;
    let view: ReturnType<typeof renderUI>;
    if (route === 'requestId') {
      vi.mocked(controller.startAgentRun).mockRejectedValueOnce(new TypeError('演练：首次提交结果未知'));
      view = renderUI(ui()); fireEvent.click(screen.getByRole('button', { name: '打开 Bingo Agent' })); send();
      const recover = await screen.findByRole('button', { name: '查询原任务' });
      requestId = vi.mocked(controller.startAgentRun).mock.calls[0]![0].requestId;
      vi.mocked(controller.getAgentRunByRequest).mockResolvedValueOnce({ ...partialRun(), requestId }); fireEvent.click(recover);
    } else {
      localStorage.setItem(`scendance:agent-run:${controller.config.apiUrl}:test-user:${projectId}`, JSON.stringify({ requestId, runId, projectId, baseKey: canonical(scene), briefKey: JSON.stringify({ brief: INITIAL_BRIEF, images: [] }) }));
      let finish!: (run: AgentRun) => void;
      vi.mocked(controller.getAgentRun).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
      vi.stubGlobal('innerWidth', 390); view = renderUI(<DockedTrial/>);
      await waitFor(() => expect(controller.getAgentRun).toHaveBeenCalledWith(runId));
      fireEvent.click(screen.getByRole('button', { name: '资料' })); fireEvent.click(screen.getByRole('button', { name: '素材' }));
      await act(async () => { finish({ ...partialRun(), requestId }); });
      fireEvent.click(screen.getByRole('button', { name: '助手' }));
    }
    await screen.findByText('方案提案 · 尚未应用'); expect((await screen.findByText(partialNotice)).getAttribute('role')).toBe('status');
    expect(screen.getByRole('button', { name: '确认布置' })).toBeTruthy(); expect(onApply).not.toHaveBeenCalled();
    expect(controller.applySceneProposal).not.toHaveBeenCalled(); expect(controller.startAgentRun).toHaveBeenCalledTimes(route === 'requestId' ? 1 : 0);
    if (route === 'requestId') {
      expect(controller.getAgentRunByRequest).toHaveBeenCalledOnce(); expect(controller.getAgentRunByRequest).toHaveBeenCalledWith(requestId);
      expect(controller.getAgentRun).not.toHaveBeenCalled();
    } else {
      expect(controller.getAgentRun).toHaveBeenCalledOnce(); expect(controller.getAgentRun).toHaveBeenCalledWith(runId);
      expect(controller.getAgentRunByRequest).not.toHaveBeenCalled();
    }
    const marker = JSON.parse(localStorage.getItem(`scendance:agent-run:${controller.config.apiUrl}:test-user:${projectId}`)!);
    expect(marker.requestId).toBe(requestId); expect(marker.runId).toBe(runId);
    expect(screen.queryByRole('button', { name: '查询原任务' })).toBeNull();
    fireEvent.change(screen.getByRole('textbox', { name: '告诉助手你的想法' }), { target: { value: '演练：核对后继续的新输入' } });
    expect(screen.getByRole('button', { name: '发送消息' }).hasAttribute('disabled')).toBe(false); expectSafeText(view.container);
  });

  it.each(['activity', 'lease', 'expired', 'scene', 'brief'] as const)('[retained partial invalid] never claims retained checked work after %s invalidates the late response', async change => {
    connected();
    let finish!: (run: AgentRun) => void;
    vi.mocked(controller.startAgentRun).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const view = renderUI(ui()); fireEvent.click(screen.getByRole('button', { name: '打开 Bingo Agent' })); send();
    await waitFor(() => expect(controller.startAgentRun).toHaveBeenCalledOnce());
    const original = vi.mocked(controller.startAgentRun).mock.calls[0]![0];
    if (change === 'activity') view.rerender(ui({ ...layout, id: '10000000-0000-4000-8000-000000000002', name: '演练活动B' }));
    if (change === 'lease') {
      snapshot = { ...snapshot, sessionId: '40000000-0000-4000-8000-000000000002', lease: { ...snapshot.lease!, generation: 2 } }; view.rerender(ui());
    }
    if (change === 'scene') view.rerender(ui({ ...layout, width: 13 }));
    if (change === 'brief') fireEvent.change(screen.getByRole('textbox', { name: '客户需求' }), { target: { value: '演练：改为新的参与目标。' } });
    const value = change === 'expired' ? { ...proposal, expires_at: '2000-01-01T00:00:00Z' } : proposal;
    await act(async () => { finish(partialRun(value, original)); });
    expect(screen.queryByText(partialNotice)).toBeNull(); expect(screen.queryByRole('button', { name: '确认布置' })).toBeNull();
    expect(onApply).not.toHaveBeenCalled(); expect(controller.applySceneProposal).not.toHaveBeenCalled(); expectSafeText(view.container);
  });

  it('[retained partial source wait] announces no retained result before asset checks finish or after its brief changes', async () => {
    connected();
    let finishAssets!: (assets: Awaited<ReturnType<BackendSession['authorizeAssets']>>) => void;
    vi.mocked(controller.authorizeAssets).mockImplementationOnce(() => new Promise(resolve => { finishAssets = resolve; }));
    vi.mocked(controller.startAgentRun).mockImplementationOnce(async input => partialRun(proposal, input));
    const view = renderUI(ui()); fireEvent.click(screen.getByRole('button', { name: '打开 Bingo Agent' })); send();
    await waitFor(() => expect(controller.authorizeAssets).toHaveBeenCalledOnce());
    expect(screen.queryByText(partialNotice)).toBeNull();
    fireEvent.change(screen.getByRole('textbox', { name: '客户需求' }), { target: { value: '演练：等待资源核对期间修改需求。' } });
    await act(async () => { finishAssets({ assetUrls: {}, assetNames: {} }); });
    expect(screen.queryByText(partialNotice)).toBeNull(); expect(screen.queryByRole('button', { name: '确认布置' })).toBeNull();
    expect(onApply).not.toHaveBeenCalled(); expect(controller.applySceneProposal).not.toHaveBeenCalled(); expectSafeText(view.container);
  });
});

describe('bounded Agent runs and JEV decisions',()=>{
  const send=()=>{fireEvent.change(screen.getByRole('textbox',{name:'告诉助手你的想法'}),{target:{value:'直接把交流区布置好'}});fireEvent.click(screen.getByRole('button',{name:'发送消息'}));};
  it('shows a non-blocking seating advisory based on the entire candidate, including existing chairs',async()=>{
    connected();
    const original={...candidate.objects[0]!,id:'20000000-0000-4000-8000-000000000002',position:{x:9,z:8}};
    const base={...scene,objects:[original]}, next={...scene,objects:[original,...candidate.objects]};
    layout=backendSceneToLayout(base,{projectId,name:'客户方案'});
    const draft={...proposal,base_scene:base,candidate:next};
    vi.mocked(controller.startAgentRun).mockResolvedValueOnce(runFrom(draft));
    const memory={...initialBriefMemory(),headcount:30,headcountMode:'prefer' as const,layoutMode:'desk-chair' as const,layoutModeConfirmed:true};
    const release=vi.fn();const captureDialogue=()=>({project:(reference?:{event?:string|null;guests?:number|null})=>projectDialogueHandoff(memory,reference),isCurrent:()=>true,release});
    render(<CreativeStudioProvider controller={controller} layout={layout} captureDialogue={captureDialogue} onApply={onApply}><CreativeAssistant/></CreativeStudioProvider>);send();
    expect((await screen.findByText(/候选共识别/)).textContent).toContain('候选共识别 2 把单人椅（包括原有和新增）');
    expect(screen.getByText(/是否需要所有人入座仍需核对/)).toBeTruthy();
    expect(screen.getByRole('button',{name:'确认布置'})).toBeTruthy();expect(onApply).not.toHaveBeenCalled();expect(release).toHaveBeenCalled();
  });
  it('does not treat unavailable dialogue as a passed seating check',async()=>{
    connected();const captureDialogue=()=>null;
    render(<CreativeStudioProvider controller={controller} layout={layout} captureDialogue={captureDialogue} onApply={onApply}><CreativeAssistant/></CreativeStudioProvider>);send();
    expect(await screen.findByText('当前对话需求暂未核对，座席数量待核验。')).toBeTruthy();
    expect(screen.getByRole('button',{name:'确认布置'})).toBeTruthy();expect(onApply).not.toHaveBeenCalled();
  });
  it('reads tool observations for this run and keeps the original scene unchanged',async()=>{
    connected();vi.mocked(controller.getAgentRunEvents).mockResolvedValueOnce({events:[
      {seq:1,tool:'get_scene',stage:'started',outcome:null,errorCode:null},
      {seq:2,tool:'get_scene',stage:'finished',outcome:'success',errorCode:null},
    ],nextCursor:2,mayBeIncomplete:true});
    render(ui());send();await screen.findByText('方案提案 · 尚未应用');
    expect(controller.getAgentRunEvents).toHaveBeenCalledWith('60000000-0000-4000-8000-000000000001',0);
    expect(getAgentRun().eventLog.map(event=>event.seq)).toEqual([1,2]);expect(onApply).not.toHaveBeenCalled();
  });
  it('still shows a candidate when an older server lacks tool observations',async()=>{
    connected();vi.mocked(controller.getAgentRunEvents).mockRejectedValueOnce(new Error('endpoint unavailable'));
    render(ui());send();await screen.findByText('方案提案 · 尚未应用');
    expect(controller.getAgentRunEvents).toHaveBeenCalledOnce();expect(getAgentRun().eventLog).toEqual([]);expect(onApply).not.toHaveBeenCalled();
  });
  it('reports an unknown failed run without guessing that the network failed',async()=>{
    connected();vi.mocked(controller.startAgentRun).mockResolvedValueOnce({...runFrom(proposal),state:'failed',errorCode:'AGENT_FAILED',candidates:[]});
    render(ui());send();
    await screen.findByText('本次任务未完成，未生成可用候选，原因尚未确定。请先核对任务状态，再决定下一步。');
    expect(screen.queryByText(/网络断了|重试就好/)).toBeNull();expect(onApply).not.toHaveBeenCalled();
  });
  it('reports the run deadline only when the backend explicitly supplies its error code',async()=>{
    connected();vi.mocked(controller.startAgentRun).mockResolvedValueOnce({...runFrom(proposal),state:'failed',errorCode:'AGENT_DEADLINE',candidates:[]});
    render(ui());send();
    await screen.findByText('本次任务达到运行时限，未返回可用候选。请先核对任务状态，再决定下一步。');
    expect(onApply).not.toHaveBeenCalled();
  });
  function comparison():AgentRun {
    const alternatives=(['A','B','C'] as const).map((label,index)=>({label,title:`布局${index+1}`,proposal:{...proposal,id:`30000000-0000-4000-8000-00000000000${index+1}`,candidate:{...candidate,objects:[{...candidate.objects[0]!,position:{x:3+index,z:4}}]}}}));
    return {...runFrom(proposal),jevEnabled:true,executionMode:'direct',candidates:alternatives,evaluation:{status:'complete',choice:'B',probabilities:{A:.2,B:.5,C:.2,NONE:.1},confidence:.33,message:'方案 B 更符合动线要求。'}};
  }
  it('keeps an unchanged candidate as a comparison and blocks every apply entry until a changed candidate is chosen',async()=>{
    connected();const run=comparison();
    run.candidates[1]={...run.candidates[1]!,proposal:{...run.candidates[1]!.proposal,candidate:scene}};
    vi.mocked(controller.startAgentRun).mockResolvedValueOnce(run);
    render(<CreativeStudioProvider controller={controller} layout={layout} onApply={onApply} onPreview={onPreview}><SecondaryConfirm/><CreativeAssistant/></CreativeStudioProvider>);send();
    const unchanged=await screen.findByRole('button',{name:/方案 B.*当前场景，无变化/});
    expect(unchanged.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText(/这版与当前场景一致，没有改动物件/)).toBeTruthy();
    expect(screen.queryByRole('button',{name:'确认布置'})).toBeNull();
    fireEvent.click(screen.getByRole('button',{name:'左侧确认'}));
    expect((await screen.findAllByText(/无需应用；请继续核对是否满足需求/)).length).toBeGreaterThan(0);
    expect(controller.applySceneProposal).not.toHaveBeenCalled();expect(onApply).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button',{name:/方案 C/}));
    fireEvent.click(screen.getByRole('button',{name:'确认布置'}));
    await waitFor(()=>expect(controller.applySceneProposal).toHaveBeenCalledWith(run.candidates[2]!.proposal,layoutToBackendScene(layout)));
  });
  it('keeps JEV off by default and presents three independently selectable candidates without applying',async()=>{
    connected();renderUI(ui());fireEvent.click(screen.getByRole('button',{name:'打开 Bingo Agent'}));
    fireEvent.click(screen.getByLabelText('助手设置'));
    const toggle=screen.getByRole('checkbox',{name:'JEV 决策模式'}) as HTMLInputElement;
    expect(toggle.checked).toBe(false);fireEvent.click(toggle);
    vi.mocked(controller.startAgentRun).mockResolvedValueOnce(comparison());send();
    const second=await screen.findByRole('button',{name:/方案 B.*50\.0/});
    expect(second.getAttribute('aria-pressed')).toBe('true');
    expect(onApply).not.toHaveBeenCalled();expect(controller.applySceneProposal).not.toHaveBeenCalled();
    expect(controller.startAgentRun).toHaveBeenCalledWith(expect.objectContaining({jevEnabled:true,scene:layoutToBackendScene(layout)}));
    fireEvent.click(screen.getByRole('button',{name:'展开工作区'}));
    fireEvent.click(screen.getByRole('button',{name:'收起聊天'}));openExecution();
    expect(document.getElementById('creative-conversation-status')?.textContent).toContain('有方案待确认');
    selectBusiness('场景模板');
    expect(screen.queryByRole('button',{name:/方案 B.*50\.0/})).toBeNull();
    fireEvent.click(screen.getByRole('button',{name:'展开聊天'}));
    expect(screen.getByRole('button',{name:/方案 B.*50\.0/})).toBe(second);
    expect(screen.getAllByRole('button',{name:/方案 [ABC]/})).toHaveLength(3);
    expect(controller.startAgentRun).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button',{name:/方案 C.*20\.0/}));
    expect(screen.getByRole('button',{name:/方案 C.*20\.0/}).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button',{name:'确认布置'}));
    await waitFor(()=>expect(controller.applySceneProposal).toHaveBeenCalledWith(comparison().candidates[2]!.proposal,layoutToBackendScene(layout)));
  });
  it('invalidates every candidate after any local edit',async()=>{
    connected();vi.mocked(controller.startAgentRun).mockResolvedValueOnce(comparison());const view=render(ui());send();
    await screen.findByRole('button',{name:/方案 A/});
    view.rerender(ui({...layout,width:14}));
    expect(screen.getAllByRole('button',{name:/方案 [ABC]/}).every(button=>button.hasAttribute('disabled'))).toBe(true);
    expect(screen.queryByRole('button',{name:'确认布置'})).toBeNull();
    expect(onPreview.mock.calls.at(-1)?.[0]).toBeNull();expect(onApply).not.toHaveBeenCalled();
  });
  it('retains partial candidates when evaluation is unavailable without inventing probabilities',async()=>{
    connected();const run=comparison();vi.mocked(controller.startAgentRun).mockResolvedValueOnce({...run,errorCode:'DATABASE_ERROR',candidates:run.candidates.slice(0,2),evaluation:{status:'partial',message:'只有两个有效方案，未执行三选评价。'}});render(ui());send();
    await screen.findByText('只有两个有效方案，未执行三选评价。');
    expect(screen.getAllByRole('button',{name:/方案 [AB]/})).toHaveLength(2);
    expect(screen.getAllByText('只有两个有效方案，未执行三选评价。')).toHaveLength(1);
    expect(screen.queryByText('后续处理中断，已保留通过检查的方案，请核对后继续。')).toBeNull();
    expect(screen.queryByText(/模型推荐概率/)).toBeNull();expect(onApply).not.toHaveBeenCalled();
  });
  it('recovers an uncertain dispatch by the original request ID without posting again',async()=>{
    connected();vi.mocked(controller.startAgentRun).mockRejectedValueOnce(new TypeError('network unknown'));render(ui());send();
    const recover=await screen.findByRole('button',{name:'查询原任务'});
    const original=vi.mocked(controller.startAgentRun).mock.calls[0]![0];
    fireEvent.click(screen.getByRole('button',{name:'展开工作区'}));
    fireEvent.click(screen.getByRole('button',{name:'收起聊天'}));openExecution();
    selectBusiness('场景模板');
    const reopen=screen.getByRole('button',{name:'展开聊天'});
    expect(reopen.getAttribute('aria-describedby')).toBe('creative-conversation-status');
    expect(document.getElementById('creative-conversation-status')?.textContent).toContain('原任务结果待核对');
    expect(screen.queryByRole('button',{name:'查询原任务'})).toBeNull();
    expect(controller.getAgentRunByRequest).not.toHaveBeenCalled();
    fireEvent.click(reopen);expect(screen.getByRole('button',{name:'查询原任务'})).toBe(recover);
    vi.mocked(controller.getAgentRunByRequest).mockResolvedValueOnce({...runFrom(proposal),requestId:original.requestId});
    fireEvent.click(recover);await screen.findByText('方案提案 · 尚未应用');
    expect(controller.getAgentRunByRequest).toHaveBeenCalledWith(original.requestId);
    expect(controller.startAgentRun).toHaveBeenCalledOnce();expect(onApply).not.toHaveBeenCalled();
  });
  it('cancels the original running task and ignores a later status response',async()=>{
    vi.useFakeTimers();connected();const running={...runFrom(proposal),state:'running' as const,candidates:[],progress:'正在查找物料'};
    vi.mocked(controller.startAgentRun).mockResolvedValueOnce(running);
    vi.mocked(controller.cancelAgentRun).mockResolvedValueOnce({...running,state:'cancelled'});
    render(ui());send();await act(async()=>{await Promise.resolve();});
    fireEvent.click(screen.getByRole('button',{name:'展开工作区'}));
    fireEvent.click(screen.getByRole('button',{name:'收起聊天'}));openExecution();
    expect(document.getElementById('creative-conversation-status')?.textContent).toContain('正在查找物料');
    selectBusiness('场景模板');
    expect(screen.queryByRole('button',{name:'取消任务'})).toBeNull();
    fireEvent.click(screen.getByRole('button',{name:'展开聊天'}));
    expect(document.querySelector('.cr-chat-feed')?.textContent).toContain('正在查找物料');
    fireEvent.click(screen.getByRole('button',{name:'取消任务'}));
    await act(async()=>{await Promise.resolve();await vi.advanceTimersByTimeAsync(2500);});
    expect(controller.cancelAgentRun).toHaveBeenCalledWith(running.id);
    expect(controller.getAgentRun).not.toHaveBeenCalled();expect(onApply).not.toHaveBeenCalled();
    expect(screen.queryByText('方案提案 · 尚未应用')).toBeNull();
  });
  it('routes 物料生成 to the unified material entry without legacy parametric chips',()=>{
    renderUI(ui());fireEvent.click(screen.getByRole('button',{name:'打开 Bingo Agent'}));selectMode('model');
    const panel=screen.getByRole('region',{name:'物料生成'});
    expect(within(panel).getByRole('button',{name:'物料生成'}).getAttribute('aria-pressed')).toBe('true');
    expect(within(panel).getByRole('button',{name:'材质调整'})).toBeTruthy();
    for(const name of ['桌','椅','柜台','地台','背景板','柜体'])expect(within(panel).queryByRole('button',{name})).toBeNull();
    expect(controller.startAgentRun).not.toHaveBeenCalled();
  });
  it('lands on the generation tab each time the material entry is opened again',async()=>{
    renderUI(<DockedTrial/>);await act(async()=>{});
    selectBusiness('物料工具');fireEvent.click(screen.getByRole('button',{name:'材质调整'}));
    expect(screen.getByRole('button',{name:'材质调整'}).getAttribute('aria-pressed')).toBe('true');
    selectBusiness('活动需求');selectBusiness('物料工具');
    expect(screen.getByRole('button',{name:'物料生成'}).getAttribute('aria-pressed')).toBe('true');
  });
});

it('honors the server preview decision even when direct application is selected',async()=>{
  connected();vi.mocked(controller.startAgentRun).mockResolvedValueOnce(runFrom(proposal));
  renderUI(ui());fireEvent.click(screen.getByRole('button',{name:'打开 Bingo Agent'}));
  fireEvent.change(screen.getByRole('textbox',{name:'告诉助手你的想法'}),{target:{value:'有没有更好的布局'}});
  fireEvent.click(screen.getByRole('button',{name:'发送消息'}));
  await screen.findByText('方案提案 · 尚未应用');
  expect(screen.queryByText('后续处理中断，已保留通过检查的方案，请核对后继续。')).toBeNull();
  expect(controller.applySceneProposal).not.toHaveBeenCalled();expect(onApply).not.toHaveBeenCalled();
});

it('cancels a dispatch that is acknowledged only after the cancellation was requested',async()=>{
  connected();let acknowledge!:(run:AgentRun)=>void;
  vi.mocked(controller.startAgentRun).mockImplementationOnce(()=>new Promise(resolve=>{acknowledge=resolve;}));
  vi.mocked(controller.getAgentRunByRequest).mockRejectedValueOnce(new Error('任务尚未写入'));
  vi.mocked(controller.cancelAgentRun).mockResolvedValueOnce({...runFrom(proposal),state:'cancelled',candidates:[]});
  renderUI(ui());fireEvent.click(screen.getByRole('button',{name:'打开 Bingo Agent'}));
  fireEvent.change(screen.getByRole('textbox',{name:'告诉助手你的想法'}),{target:{value:'摆放桌子'}});fireEvent.click(screen.getByRole('button',{name:'发送消息'}));
  fireEvent.click(await screen.findByRole('button',{name:'取消任务'}));
  await screen.findByText('原任务结果待核对。查询会继续读取原任务，不会再次提交生成。');
  await act(async()=>acknowledge(runFrom(proposal)));
  expect(controller.cancelAgentRun).toHaveBeenCalledWith(runFrom(proposal).id);
  expect(controller.applySceneProposal).not.toHaveBeenCalled();expect(onApply).not.toHaveBeenCalled();
});

it('keeps a newer task recoverable when a cancelled dispatch is acknowledged late',async()=>{
  connected();let acknowledge!:(run:AgentRun)=>void;
  vi.mocked(controller.startAgentRun).mockImplementationOnce(()=>new Promise(resolve=>{acknowledge=resolve;})).mockImplementationOnce(()=>new Promise(()=>{}));
  const cancelled={...runFrom(proposal),state:'cancelled' as const,candidates:[]};
  vi.mocked(controller.getAgentRunByRequest).mockResolvedValueOnce(runFrom(proposal));
  vi.mocked(controller.cancelAgentRun).mockResolvedValue(cancelled);
  render(ui());
  const send=(text:string)=>{fireEvent.change(screen.getByRole('textbox',{name:'告诉助手你的想法'}),{target:{value:text}});fireEvent.click(screen.getByRole('button',{name:'发送消息'}));};
  send('摆放桌子');fireEvent.click(await screen.findByRole('button',{name:'取消任务'}));
  await screen.findByText('任务已取消，当前方案保持不变。');
  send('改为摆放椅子');
  await waitFor(()=>expect(controller.startAgentRun).toHaveBeenCalledTimes(2));
  const second=vi.mocked(controller.startAgentRun).mock.calls[1]![0];
  const key=Object.keys(localStorage).find(value=>value.startsWith('scendance:agent-run:'))!;
  expect(JSON.parse(localStorage.getItem(key)!).requestId).toBe(second.requestId);
  await act(async()=>acknowledge(runFrom(proposal)));
  expect(JSON.parse(localStorage.getItem(key)!).requestId).toBe(second.requestId);
  expect(screen.getByRole('button',{name:'取消任务'})).toBeTruthy();
  expect(controller.applySceneProposal).not.toHaveBeenCalled();
});

it.each(['ledger','unreadable'] as const)('does not dispatch through a complete cloud project when independent checkins are %s',async state=>{
  connected();
  if(state==='ledger')vi.mocked(readSourceRecord).mockResolvedValue(materialCheckinLedgerSchema.parse({projectId}));
  else vi.mocked(readSourceRecord).mockRejectedValue(new Error('本机读取不可用'));
  render(ui());
  fireEvent.change(screen.getByRole('textbox',{name:'告诉助手你的想法'}),{target:{value:'调整场景布置'}});
  fireEvent.click(screen.getByRole('button',{name:'发送消息'}));
  await screen.findAllByText(state==='ledger'?LOCAL_CHECKIN_CLOUD_MESSAGE:LOCAL_RECORDS_READ_MESSAGE);
  expect(controller.startAgentRun).not.toHaveBeenCalled();expect(controller.applySceneProposal).not.toHaveBeenCalled();
  expect(onApply).not.toHaveBeenCalled();
});

describe('same local activity with a remote scene connection',()=>{
  const localId='house-bound-activity';
  const acquisitionId='81000000-0000-4000-8000-000000000001';
  const nextScene={...candidate,objects:candidate.objects.map(item=>({...item,position:{...item.position,x:item.position.x+1}}))};
  function activity(){
    const local=backendSceneToLayout(candidate,{projectId:localId,name:'本地活动演练'});
    local.eventOperations=eventOperationsSchema.parse({dataKind:'rehearsal',tasks:[{id:'82000000-0000-4000-8000-000000000001',title:'私有执行分工',phase:'setup',ownerName:'内部负责人',objectIds:[candidate.objects[0]!.id]}]});
    local.productionPlan=productionPlanSchema.parse({dataKind:'rehearsal',acquisitions:[{id:acquisitionId,title:'内部租赁方案',supplierName:'内部供应方',objectIds:[candidate.objects[0]!.id]}]});
    local.floors[0]!.items[0]!.handoff={ownerName:'内部物件负责人',dueDate:'',acceptance:'内部摆放核对',status:'todo',evidenceUrls:[],evidenceNote:'内部记录'};
    return local;
  }
  function facts(){return materialCheckinLedgerSchema.parse({projectId:localId,dataKind:'rehearsal',sheets:[{
    id:'83000000-0000-4000-8000-000000000001',acquisitionId,acquisitionSnapshot:{title:'内部租赁方案'},unit:'piece',
    agreements:[{id:'84000000-0000-4000-8000-000000000001',agreedQuantity:20,basisNote:'演练约定',recordedAt:'2026-10-09T01:00:00Z',recordedBy:'内部记录人'}],
    events:(['receive','return'] as const).map((kind,index)=>({id:`85000000-0000-4000-8000-00000000000${index+1}`,kind,batchRef:`内部批次${index+1}`,quantity:18,checkState:'checked',occurredAt:`2026-10-09T0${index+2}:00:00Z`,fromPartyName:'内部交出方',toPartyName:'内部接收方',evidenceNote:'内部现场记录',evidenceUrls:[],recordedAt:`2026-10-09T0${index+2}:01:00Z`,recordedBy:'内部记录人'})),
  }]});}
  function installBindingCheck(){
    vi.spyOn(controller,'isGeometryBound').mockImplementation(id=>!!snapshot.geometryBinding&&snapshot.geometryBinding.localActivityId===id&&snapshot.geometryBinding.cloudProjectId===snapshot.project?.id&&snapshot.geometryBinding.userId===snapshot.user?.id);
  }
  function bind(){
    connected();snapshot={...snapshot,geometryBinding:{version:1,localActivityId:localId,cloudProjectId:projectId,userId:'test-user',apiUrl:controller.config.apiUrl}};
    controller.setDraft(candidate);
  }
  function prepareResponse(){
    prepareProposal.mockResolvedValue({...proposal,base_scene:candidate,candidate:nextScene});
    vi.mocked(controller.applySceneProposal).mockResolvedValue({id:projectId,revision:2,scene:nextScene,previousScene:candidate,updatedAt:'2026-10-09T00:00:00Z',undoGroup:'group',acceptedLocally:true});
  }
  it('previews and applies geometry without changing identity, execution records or 20/18/18 facts',async()=>{
    installBindingCheck();bind();prepareResponse();const local=activity(),ledger=facts();
    vi.mocked(readSourceRecord).mockResolvedValue(ledger);
    render(ui(local));enterBrief();
    fireEvent.change(screen.getByRole('textbox',{name:'告诉助手你的想法'}),{target:{value:'把椅子向右移动一米，先预览'}});
    fireEvent.click(screen.getByRole('button',{name:'发送消息'}));await screen.findByText('方案提案 · 尚未应用');
    const request=vi.mocked(controller.startAgentRun).mock.calls[0]![0];
    expect(request.scene).toEqual(candidate);expect(JSON.stringify(request)).not.toContain('内部');
    fireEvent.click(screen.getByRole('button',{name:'确认布置'}));await waitFor(()=>expect(onApply).toHaveBeenCalledOnce());
    const next=onApply.mock.calls[0]![0];expect(next.id).toBe(localId);
    expect(next.eventOperations).toEqual(local.eventOperations);expect(next.productionPlan).toEqual(local.productionPlan);
    expect(next.floors[0]!.items[0]!.handoff).toEqual(local.floors[0]!.items[0]!.handoff);
    expect(layoutToBackendScene(next)).toEqual(nextScene);expect(updateSourceForm).not.toHaveBeenCalled();
    expect(copySourceScope).not.toHaveBeenCalled();expect(ledger.sheets[0]!.events.map(event=>'quantity' in event?event.quantity:null)).toEqual([18,18]);
  });
  it('prepares a first scene connection without rebinding or copying the local activity',async()=>{
    installBindingCheck();prepareResponse();snapshot={...snapshot,configured:true};const local=activity(),rebind=vi.fn();
    vi.mocked(readSourceRecord).mockResolvedValue(facts());
    const ensure=vi.spyOn(controller,'ensureGeometryWorkbenchReady').mockImplementation(async()=>{bind();return snapshot.project!;});
    render(<CreativeStudioProvider controller={controller} layout={local} onApply={onApply} onBindProject={rebind}><CreativeAssistant/></CreativeStudioProvider>);
    enterBrief();fireEvent.change(screen.getByRole('textbox',{name:'告诉助手你的想法'}),{target:{value:'移动椅子，先预览'}});
    fireEvent.click(screen.getByRole('button',{name:'发送消息'}));await screen.findByText('方案提案 · 尚未应用');
    expect(ensure).toHaveBeenCalledWith(candidate,local.name,localId);expect(rebind).not.toHaveBeenCalled();expect(copySourceScope).not.toHaveBeenCalled();
    expect(local.id).toBe(localId);expect(controller.startAgentRun).toHaveBeenCalledOnce();
  });
  it('restores only the original scene connection and queries the saved run after reopening',async()=>{
    installBindingCheck();snapshot={...snapshot,configured:true,user:{id:'test-user'}};const local=activity();
    const requestId='86000000-0000-4000-8000-000000000001',runId='87000000-0000-4000-8000-000000000001';
    localStorage.setItem(`scendance:agent-run:${controller.config.apiUrl}:test-user:${localId}`,JSON.stringify({requestId,runId,projectId,baseKey:canonical(candidate),briefKey:JSON.stringify({brief:INITIAL_BRIEF,images:[]})}));
    const resume=vi.spyOn(controller,'resumeGeometryWorkbench').mockImplementation(async()=>{bind();return snapshot.project!;});
    const ensure=vi.spyOn(controller,'ensureGeometryWorkbenchReady');
    vi.mocked(controller.getAgentRun).mockResolvedValue({...runFrom(proposal),id:runId,state:'cancelled',candidates:[]});
    render(ui(local));await screen.findByText('任务已取消，当前方案保持不变。');
    expect(resume).toHaveBeenCalledWith(candidate,local.name,localId);expect(controller.getAgentRun).toHaveBeenCalledWith(runId);
    expect(ensure).not.toHaveBeenCalled();expect(controller.startAgentRun).not.toHaveBeenCalled();expect(onApply).not.toHaveBeenCalled();
  });
  it.each([[true,false],[true,true],[false,false],[false,true]])('reauthorizes saved model references without transmitting scene records (scene bound: %s, identity changed: %s)',async(bound,changed)=>{
    vi.mocked(ensureGlbAsset).mockClear();
    installBindingCheck();bind();const assetId='88000000-0000-4000-8000-000000000001';
    if(!bound)snapshot={...snapshot,project:null,geometryBinding:null,lease:null};
    const local=backendSceneToLayout({...candidate,objects:[{...candidate.objects[0]!,materialId:'asset',assetId}]},{projectId:localId,name:'模型重开演练'});
    let finish!:(value:{id:string;url:string;name:string})=>void;
    const authorize=vi.spyOn(controller,'authorizeAsset').mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
    const view=renderUI(ui(local));await waitFor(()=>expect(authorize).toHaveBeenCalledWith(assetId));
    const firstAuthorization=finish;
    if(changed){snapshot={...snapshot,user:{id:'another-user'}};view.rerender(ui(local));}
    await act(async()=>firstAuthorization({id:assetId,url:'https://storage.example/fresh.glb',name:'原模型'}));
    if(changed)expect(ensureGlbAsset).not.toHaveBeenCalled();else await waitFor(()=>expect(ensureGlbAsset).toHaveBeenCalledWith(assetId,'https://storage.example/fresh.glb'));
    expect(onApply).not.toHaveBeenCalled();expect(controller.startAgentRun).not.toHaveBeenCalled();expect(copySourceScope).not.toHaveBeenCalled();
    expect(local.id).toBe(localId);
  });
});

describe('T-UI visible interaction',()=>{
  it('hides the direct-apply switch on the demo backend; preview-then-confirm is the only path',async()=>{
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL','http://localhost:3099');
    try{
      renderUI(<DockedTrial/>);await act(async()=>{});
      fireEvent.click(screen.getByLabelText('助手设置'));
      expect(screen.queryByRole('checkbox',{name:'明确指令直接应用'})).toBeNull();
      expect(screen.getByText(/演示后端/)).toBeTruthy();
    }finally{vi.unstubAllEnvs();}
  });
});

describe('scoped seating constraints in deep generation', () => {
  const evidence = '每2人一桌';
  const allocation = { status:'shared_desk' as const, peoplePerDesk:2, evidence, source:'user' as const };
  it('passes selected user-stated furniture sizes and evidence through the deep entry',async()=>{
    connected();
    const specs={desk:{width:{status:'reported' as const,valueM:1.8,evidence:'桌宽1.8米',source:'user' as const}},chair:{depth:{status:'unknown' as const,valueM:null,evidence:'椅深待定',source:'user' as const}}};
    const capture=()=>({status:'ready' as const,value:undefined,specs,token:'chat-a-specs',isCurrent:()=>true});
    renderUI(<CreativeStudioProvider controller={controller} layout={layout} onApply={onApply} captureSeatingAllocation={capture}><IntentGenerationProbe/></CreativeStudioProvider>);
    fireEvent.click(screen.getByRole('button',{name:'测试生成'}));
    await waitFor(()=>expect(controller.startAgentRun).toHaveBeenCalledOnce());
    const request=vi.mocked(controller.startAgentRun).mock.calls[0]![0];
    expect(request.context.seatingSpecs).toEqual(specs);
    expect(request.instruction).toContain(JSON.stringify('桌宽1.8米'));
    expect(request.instruction).toContain(JSON.stringify('椅深待定'));
  });
  it('treats a user choice of illustrative defaults as an assumption rather than physical specifications',async()=>{
    connected();const capture=()=>({status:'ready' as const,value:undefined,defaults:{desk:'桌子按默认规格'},token:'chat-a-defaults',isCurrent:()=>true});
    renderUI(<CreativeStudioProvider controller={controller} layout={layout} onApply={onApply} captureSeatingAllocation={capture}><IntentGenerationProbe/></CreativeStudioProvider>);
    fireEvent.click(screen.getByRole('button',{name:'测试生成'}));
    await waitFor(()=>expect(controller.startAgentRun).toHaveBeenCalledOnce());
    const request=vi.mocked(controller.startAgentRun).mock.calls[0]![0];
    expect(request.context.seatingSpecs).toBeUndefined();expect(request.instruction).toContain('示意默认不是已确认实物');expect(request.instruction).toContain('桌子按默认规格');
  });
  it('does not dispatch stale furniture specifications after the final venue check',async()=>{
    connected();let version=1;let finish!:(value:{status:'observed';scope:string;digest:string})=>void;
    const confirmed={status:'observed' as const,scope:projectId,digest:'a'.repeat(64)};
    const guard={getConfirmed:()=>confirmed,isSettled:()=>true,subscribeInvalidation:()=>()=>{}};
    vi.spyOn(venueSourceRevision,'readVenueSourceRevision').mockResolvedValueOnce(confirmed).mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
    const capture=()=>{const captured=version;return {status:'ready' as const,value:undefined,specs:{desk:{width:{status:'reported' as const,valueM:1.8,evidence:'桌宽1.8米',source:'user' as const}}},token:`spec-${captured}`,isCurrent:()=>version===captured};};
    renderUI(<CreativeStudioProvider controller={controller} layout={layout} onApply={onApply} venueSourceGuard={guard} captureSeatingAllocation={capture}><IntentGenerationProbe/></CreativeStudioProvider>);
    fireEvent.click(screen.getByRole('button',{name:'测试生成'}));
    await waitFor(()=>expect(finish).toBeTypeOf('function'));version++;
    await act(async()=>{finish(confirmed);});
    expect(controller.startAgentRun).not.toHaveBeenCalled();expect(onApply).not.toHaveBeenCalled();
  });
  it('passes the current user evidence and structured ratio to the cloud', async () => {
    connected();
    const capture = () => ({status:'ready' as const,value:allocation,token:'chat-a-1',isCurrent:()=>true});
    renderUI(<CreativeStudioProvider controller={controller} layout={layout} onApply={onApply} captureSeatingAllocation={capture}><IntentGenerationProbe/></CreativeStudioProvider>);
    fireEvent.click(screen.getByRole('button',{name:'测试生成'}));
    await waitFor(()=>expect(controller.startAgentRun).toHaveBeenCalledOnce());
    const request=vi.mocked(controller.startAgentRun).mock.calls[0]![0];
    expect(request.context.seatingAllocation).toEqual(allocation);
    expect(request.instruction).toContain(JSON.stringify(evidence));
  });
  it('does not invent a user allocation when none was given', async () => {
    connected();
    const capture = () => ({status:'ready' as const,value:undefined,token:'chat-a-1',isCurrent:()=>true});
    renderUI(<CreativeStudioProvider controller={controller} layout={layout} onApply={onApply} captureSeatingAllocation={capture}><IntentGenerationProbe/></CreativeStudioProvider>);
    fireEvent.click(screen.getByRole('button',{name:'测试生成'}));
    await waitFor(()=>expect(controller.startAgentRun).toHaveBeenCalledOnce());
    expect(vi.mocked(controller.startAgentRun).mock.calls[0]![0].context.seatingAllocation).toBeUndefined();
  });
  it('rejects a returned candidate after an A to B to A session transition', async () => {
    connected(); let epoch=1; let finish!:(value:AgentRun)=>void;
    vi.mocked(controller.startAgentRun).mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
    const capture = () => {const captured=epoch;return {status:'ready' as const,value:allocation,token:`chat-a-${captured}`,isCurrent:()=>epoch===captured};};
    renderUI(<CreativeStudioProvider controller={controller} layout={layout} onApply={onApply} captureSeatingAllocation={capture}><IntentGenerationProbe/><SecondaryConfirm/></CreativeStudioProvider>);
    fireEvent.click(screen.getByRole('button',{name:'测试生成'}));
    await waitFor(()=>expect(controller.startAgentRun).toHaveBeenCalledOnce());
    epoch+=2;
    await act(async()=>{finish(runFrom(proposal));});
    expect(screen.queryByRole('button',{name:'左侧确认'})).toBeNull();
    expect(controller.applySceneProposal).not.toHaveBeenCalled();expect(onApply).not.toHaveBeenCalled();
  });
  it('does not dispatch after the seating scope changes during the final venue check', async () => {
    connected(); let epoch=1; let finish!:(value:{status:'observed';scope:string;digest:string})=>void;
    const confirmed={status:'observed' as const,scope:projectId,digest:'a'.repeat(64)};
    const guard={getConfirmed:()=>confirmed,isSettled:()=>true,subscribeInvalidation:()=>()=>{}};
    vi.spyOn(venueSourceRevision,'readVenueSourceRevision').mockResolvedValueOnce(confirmed).mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
    const capture=()=>{const captured=epoch;return {status:'ready' as const,value:allocation,token:`chat-a-${captured}`,isCurrent:()=>epoch===captured};};
    renderUI(<CreativeStudioProvider controller={controller} layout={layout} onApply={onApply} venueSourceGuard={guard} captureSeatingAllocation={capture}><IntentGenerationProbe/></CreativeStudioProvider>);
    fireEvent.click(screen.getByRole('button',{name:'测试生成'}));
    await waitFor(()=>expect(finish).toBeTypeOf('function'));
    epoch+=2; await act(async()=>{finish(confirmed);});
    expect(controller.startAgentRun).not.toHaveBeenCalled();expect(onApply).not.toHaveBeenCalled();
  });
  it('does not recover an old candidate without its seating identity', async () => {
    connected(); const requestId='70000000-0000-4000-8000-000000000001';const runId=runFrom(proposal).id;
    localStorage.setItem(`scendance:agent-run:${controller.config.apiUrl}:test-user:${projectId}`,JSON.stringify({requestId,runId,projectId,baseKey:canonical(scene),briefKey:JSON.stringify({brief:INITIAL_BRIEF,images:[]})}));
    vi.mocked(controller.getAgentRun).mockResolvedValueOnce({...runFrom(proposal),requestId});
    const capture = () => ({status:'ready' as const,value:allocation,token:'chat-a-1',isCurrent:()=>true});
    renderUI(<CreativeStudioProvider controller={controller} layout={layout} onApply={onApply} captureSeatingAllocation={capture}><CreativeAssistant/><SecondaryConfirm/></CreativeStudioProvider>);
    await waitFor(()=>expect(controller.getAgentRun).toHaveBeenCalledWith(runId));
    fireEvent.click(screen.getByRole('button',{name:'打开 Bingo Agent'}));
    await screen.findByText('已查询原任务；活动会话或桌椅配比无法核对，旧候选不会应用。');
    expect(screen.queryByRole('button',{name:'左侧确认'})).toBeNull();expect(controller.applySceneProposal).not.toHaveBeenCalled();expect(onApply).not.toHaveBeenCalled();
  });
});
