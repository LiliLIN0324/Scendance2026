'use client';

import { ArrowLeft, ArrowUp, Check, Loader2, Maximize2, Minimize2, RefreshCw, SlidersHorizontal, Sparkles, Trash2, X } from 'lucide-react';
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { createPortal, flushSync } from 'react-dom';
import { buildAgentContext } from '@/lib/assistant-context';
import { useBackendSession, SceneApiError, type BackendSession, type SceneProposal, type AgentRun } from '@/lib/backend-session';
import { assertGeometryActionSource, geometryProjectId, isLocalActivityWorkspace } from '@/lib/geometry-workbench';
import { validateLocalProjectRestoreCandidate, serializeLocalProjectBackup, serializeLocalProjectBackupV3, serializeLocalProjectBackupV4, type LocalProjectRestoreCandidate } from '@/lib/local-project-backup';
import { readMaterialCheckins, restoreMaterialCheckinsIfUnchanged } from '@/lib/material-checkin-storage';
import { decodeSourceDocuments } from '@/lib/source-backup';
import { readSourceScopeSnapshot, sameSourceScopeSnapshot, restoreSourceScopeIfUnchanged, type SourceScopeSnapshot } from '@/lib/source-storage';
import { listStoredSources, storeSource, deleteSource, suggestSourceKind, readSourceForm, storeSourceForm, deleteSourceForm, registerSourceFlush, flushSourceScope, copySourceScope, registerSourceEditor, withSourceRestoreLock, type SourceEditorLease } from '@/lib/source-storage';
import { canonical } from '../../../../supabase/functions/_shared/domain';
import { mergeMaterialCheckinLedgers, type MaterialCheckinLedger } from '../../../../supabase/functions/_shared/material-checkin-contract';
import { useSelection } from '../contexts';
import { useMaterialCheckins, type MaterialCheckinState } from '../hooks/use-material-checkins';
import { backendSceneToLayout, layoutToBackendScene } from '../lib/backend-adapter';
import { STORAGE_KEY } from '../lib/constants';
import { appendCreativeBriefTemplate, briefInstruction, IDEA_CARDS, INITIAL_BRIEF, MANUAL_BRIEF_TEMPLATE, mergeProposalPresentation, proposalSummary, type CreativeBrief } from '../lib/creative-brief';
import { localStorageOrNull, parseLayoutJson, sameLayoutContent } from '../lib/persistence';
import { addDesign, MAX_DESIGNS } from '../lib/scene-layers';
import { ensureGlbAsset, getGlbAssetState } from '../three/glb-assets';
import { proposalDifferences } from '../three/proposal-preview';
import { ActivityWorkflowGuide } from './activity-workflow-guide';
import { MaterialCustomization, type MaterialCustomizationSeed } from './material-customization';
import { ProjectReviewPanel } from './project-review-panel';
import { ReconstructionPanel } from './reconstruction-panel';
import { SceneDeliveryPanel } from './scene-delivery-panel';
import { ScenePresetsPanel } from './scene-presets-panel';
import { VenuePhotosPanel, type VenuePhoto } from './venue-photos-panel';
import { VenueShapePresets } from './venue-shape-presets';
import type { ActivityTaskPanelContext } from './activity-task-workspace';
import type { EventOperations } from '../../../../supabase/functions/_shared/event-operations-contract';
import type { ProductionPlan } from '../../../../supabase/functions/_shared/production-plan-contract';
import type { FurnitureItem, RoomLayout } from '../lib/types';
import type { ProjectReviewCapture, ProjectReviewSnapshot, ProjectReviewSource } from '@/lib/project-review';
import type { ProjectReviewBase, ProjectReviewCaptureOptions } from '@/lib/project-review-workflow';
import './creative-studio.css';

type ReferenceImage = VenuePhoto;
type Message = { id: string; role: 'user' | 'assistant'; text: string; modelSuggestions?: SceneProposal['modelSuggestions']; materialSuggestions?: SceneProposal['materialSuggestions'] };
type RunMarker = { requestId: string; runId?: string; projectId?: string; baseKey: string; briefKey: string };
const runStorageKey = (scope: string) => `scendance:agent-run:${scope}`;
type CandidatePreview = { label: 'A' | 'B' | 'C'; title: string; preview: Preview };
type Preview = { assets: { assetUrls: Record<string,string>; assetNames: Record<string,string> }; proposal: SceneProposal; layout: RoomLayout; base: RoomLayout; briefKey: string; scope: string };
type CheckinRestoreWrite = { scope: string; before: MaterialCheckinLedger | undefined; attempted: MaterialCheckinLedger | undefined };
type SourceRestoreWrite = { scope: string; before: SourceScopeSnapshot; attempted: SourceScopeSnapshot };
const sameCheckins = (left: MaterialCheckinLedger | undefined, right: MaterialCheckinLedger | undefined) => canonical(left ?? null) === canonical(right ?? null);
interface Props { reviewContext?: string; controller: BackendSession; layout: RoomLayout; onApply(layout: RoomLayout): void; prepareRestoreLayout?(next: RoomLayout): RoomLayout; commitRestoredLayout?(next: RoomLayout): void; onUpdateItem?: ((id: string, patch: Partial<FurnitureItem>) => void) | undefined; onUpdateEventOperations?: ((value: EventOperations | undefined) => void) | undefined; onUpdateProductionPlan?: ((value: ProductionPlan | undefined) => void) | undefined; onBindProject?(projectId: string): void; onPreview?: ((layout: RoomLayout | null) => void) | undefined; children: ReactNode }
export interface CreativeBriefState { brief: CreativeBrief; ready: boolean; error: string | null; hasSavedBrief: boolean }
export interface LocalProjectBackupActions {
  prepareBackup(options?:{includeSourceDocuments?:boolean}): Promise<string>; restoreBackup(candidate: LocalProjectRestoreCandidate): Promise<void>; undoRestore(): Promise<void>;
  backupPending: boolean; canUndoRestore: boolean;
}
interface StudioValue extends LocalProjectBackupActions {
  sourcesRestoring: boolean;
  checkins: MaterialCheckinState;
  reviewSource: ProjectReviewSource;
  getReviewSource(): ProjectReviewSource;
  prepareReview(): Promise<ProjectReviewBase>;
  scope: string; controller: BackendSession; layout: RoomLayout; onApply(layout: RoomLayout): void; onUpdateItem?: ((id: string, patch: Partial<FurnitureItem>) => void) | undefined; onUpdateEventOperations?: ((value: EventOperations | undefined) => void) | undefined; onUpdateProductionPlan?: ((value: ProductionPlan | undefined) => void) | undefined; onPreview?: ((layout: RoomLayout | null) => void) | undefined; updateImage(id: string, patch: Partial<VenuePhoto>): void;
  brief: CreativeBrief; setBrief: React.Dispatch<React.SetStateAction<CreativeBrief>>;
  briefReady: boolean; briefError: string | null; hasSavedBrief: boolean; retryBrief(): void;
  images: ReferenceImage[]; addImages(files: FileList | null, kind?: ReferenceImage['kind']): Promise<void>; removeImage(id: string): void;
  busy: boolean; preparing: boolean; notice: string; connection: string; generate(message?: string, options?: {intent:'model'}): Promise<void>;
  messages: Message[]; expanded: boolean; setExpanded(value: boolean): void; preview: Preview | null; stale: boolean; expired: boolean;
  jevEnabled: boolean; setJevEnabled(value:boolean):void; run: AgentRun | null; candidates: CandidatePreview[]; selectCandidate(label: 'A'|'B'|'C'):void; cancelRun():Promise<void>; recoverRun():Promise<void>; recoverable:boolean;
  directApply: boolean; setDirectApply(value: boolean): void; applyPreview(): Promise<void>; discardPreview(): void;
}
const StudioContext = createContext<StudioValue | null>(null);
function useStudio(): StudioValue { const value=useContext(StudioContext); if(!value) throw new Error('Creative studio unavailable'); return value; }
/** Library consumers can render independently of the creative workspace. */
export function useCreativeBrief(): CreativeBrief | null { return useContext(StudioContext)?.brief ?? null; }
export function useCreativeBriefState(): CreativeBriefState | null {
  const studio=useContext(StudioContext);
  return studio?{brief:studio.brief,ready:studio.briefReady,error:studio.briefError,hasSavedBrief:studio.hasSavedBrief}:null;
}
export function useLocalProjectBackup(): LocalProjectBackupActions | null { return useContext(StudioContext); }
export function useMaterialCheckinState(): MaterialCheckinState { return useStudio().checkins; }
const initialMessages: Message[] = [{ id:'welcome', role:'assistant', text:'活动需求、客户方案与执行资料可以先在本机整理。需要 AI 布置或物料候选时，再连接场景服务。' }];
const PARTIAL_RUN_NOTICE='后续处理中断，已保留通过检查的方案，请核对后继续。';

export function CreativeStudioProvider({ reviewContext, controller, layout, onApply, prepareRestoreLayout, commitRestoredLayout, onUpdateItem, onUpdateEventOperations, onUpdateProductionPlan, onBindProject, onPreview, children }: Props): JSX.Element {
  const cloud=useBackendSession(controller);
  const { allSelectedIds }=useSelection();
  const [brief,setBriefValue]=useState<CreativeBrief>(INITIAL_BRIEF);
  const [briefReady,setBriefReady]=useState(false);
  const [briefError,setBriefError]=useState<string|null>(null);
  const [hasSavedBrief,setHasSavedBrief]=useState(false);
  const [briefLoadAttempt,setBriefLoadAttempt]=useState(0);
  const briefValueRef=useRef(brief);briefValueRef.current=brief;
  const briefHydration=useRef<Promise<void>>(Promise.resolve());
  const briefStorage=useRef({scope:layout.id??'local',ready:false,dirty:false,revision:0,error:null as string|null,edits:{} as Partial<CreativeBrief>});
  const briefDrafts=useRef(new Map<string,{brief:CreativeBrief;storage:typeof briefStorage.current}>());
  const briefSaveQueue=useRef<Promise<void>>(Promise.resolve());
  const briefTimer=useRef<ReturnType<typeof setTimeout>>();
  const briefEditEpoch=useRef(0);
  const [backupPending,setBackupPending]=useState(false);
  const [sourcesRestoring,setSourcesRestoring]=useState(false);
  const backupBusy=useRef(false), restoreWriting=useRef(false);
  const operationEpoch=useRef(0);
  const editorLease=useRef<{scope:string;lease:SourceEditorLease}>();
  const editorLeases=useRef(new Map<string,SourceEditorLease>());
  const adoptedScope=useRef<string>();
  const [undoPoint,setUndoPoint]=useState<{beforeLayout:RoomLayout;beforeBrief:CreativeBrief|undefined;targetScope:string;targetBrief:CreativeBrief|undefined;targetDraft:ReturnType<typeof briefDrafts.current.get>;afterLayout:RoomLayout;afterEdits:number;afterBrief:CreativeBrief|undefined;checkinChange?:CheckinRestoreWrite;sourceChange?:SourceRestoreWrite}|null>(null);
  const undoPointRef=useRef<typeof undoPoint>(null);
  const failedRollback=useRef<{scope:string;original:CreativeBrief|undefined;attempted:CreativeBrief|undefined}|null>(null);
  const undoRecovery=useRef<{scope:string;before:CreativeBrief|undefined;attempted:CreativeBrief|undefined}[]|null>(null);
  const checkinRecovery=useRef<CheckinRestoreWrite|null>(null);
  const sourceRecovery=useRef<SourceRestoreWrite|null>(null);
  const preparedRestoreIds=useRef(new WeakMap<LocalProjectRestoreCandidate,string>());
  const setBrief=useCallback<React.Dispatch<React.SetStateAction<CreativeBrief>>>(update=>{
    const next=typeof update==='function'?update(briefValueRef.current):update;
    if(!briefStorage.current.ready)for(const key of Object.keys(next) as (keyof CreativeBrief)[]){
      if(!Object.is(next[key],briefValueRef.current[key]))briefStorage.current.edits={...briefStorage.current.edits,[key]:next[key]};
    }
    briefStorage.current.dirty=true;briefStorage.current.revision++;briefEditEpoch.current++;
    briefValueRef.current=next;setBriefValue(next);setHasSavedBrief(false);
  },[]);
  const [images,setImages]=useState<ReferenceImage[]>([]);
  const savedImages=useRef(new WeakSet<ReferenceImage>());
  const [busy,setBusy]=useState(false);
  const [notice,setNotice]=useState('');
  const [messages,setMessages]=useState<Message[]>(initialMessages);
  const [lastExplanation,setLastExplanation]=useState('');
  const preparation=useRef<{layout:RoomLayout;userId:string|undefined;projectId:string|undefined;cancelled:boolean}|null>(null);
  const preservingPreparation=useRef(false);
  preservingPreparation.current=!!preparation.current&&(preparation.current.layout===layout||!!preparation.current.projectId&&preparation.current.projectId===layout.id)&&(!preparation.current.userId||preparation.current.userId===cloud.user?.id);
  const scope=layout.id??'local';
  const scopeRef=useRef(scope); scopeRef.current=scope;
  const agentScope=`${controller.config.apiUrl}:${cloud.user?.id??'anonymous'}:${scope}`;
  const agentScopeRef=useRef(agentScope);agentScopeRef.current=agentScope;
  useLayoutEffect(()=>{
    const lease=registerSourceEditor(scope);editorLease.current={scope,lease};editorLeases.current.set(scope,lease);
    return()=>{
      const pendingImageWrites=uploadQueue.current;
      const replacement=editorLease.current?.scope===scope?editorLease.current.lease:undefined;
      if(replacement)editorLease.current=undefined;
      if(!lease.acquired)void lease.release();
      if(replacement&&!replacement.acquired)void replacement.release();
      queueMicrotask(()=>{void Promise.allSettled([briefSaveQueue.current,pendingImageWrites]).then(async()=>{
        await Promise.all([lease.release(),replacement?.release()]);
        const held=editorLeases.current.get(scope);if(held===lease||held===replacement)editorLeases.current.delete(scope);
      });});
    };
  },[scope]);
  useEffect(()=>{if(preservingPreparation.current)return;runEpoch.current++;markerRef.current=null;requestPending.current=false;setBusy(false);setMessages(initialMessages);setAcceptedDecisions([]);setLastExplanation('');setPreview(null);setCandidates([]);setRun(null);setRecoverable(false);setNotice('');},[agentScope]);
  const saveBrief=useCallback(async(saveScope:string,storage=briefStorage.current,value=briefValueRef.current):Promise<void>=>{
    if(restoreWriting.current)throw new Error('正在恢复本地资料，请稍后再保存。');
    if(storage.scope!==saveScope||!storage.ready)throw new Error(storage.error??'活动需求尚未读取完成，请稍后重试。');
    if(!storage.dirty)return;
    const revision=storage.revision;
    const lease=editorLeases.current.get(saveScope);
    const write=briefSaveQueue.current.catch(()=>{}).then(async()=>{await lease?.ready;await storeSourceForm(`${saveScope}:brief`,value);});
    briefSaveQueue.current=write;
    try{
      await write;
      if(storage.revision===revision){
        storage.dirty=false;storage.error=null;
        if(briefDrafts.current.get(saveScope)?.storage===storage)briefDrafts.current.delete(saveScope);
        if(briefStorage.current===storage&&scopeRef.current===saveScope){setBriefError(null);setHasSavedBrief(true);}
      }
    }catch(error){
      const message=`活动需求保存失败，当前输入仍保留在此页面，请重试。${error instanceof Error?` ${error.message}`:''}`;
      storage.error=message;
      if(briefStorage.current===storage&&scopeRef.current===saveScope)setBriefError(message);
      throw new Error(message);
    }
  },[]);
  useEffect(()=>{
    if(preservingPreparation.current){briefStorage.current.scope=scope;return;}
    if(adoptedScope.current===scope){adoptedScope.current=undefined;briefHydration.current=Promise.resolve();return;}
    if(briefStorage.current.scope!==scope){
      const previous=briefStorage.current;
      if(previous.dirty){
        const draft={brief:briefValueRef.current,storage:previous};
        briefDrafts.current.set(previous.scope,draft);
        if(previous.ready)void saveBrief(previous.scope,previous,draft.brief).catch(()=>{});
      }
      const cached=briefDrafts.current.get(scope);
      briefStorage.current=cached?.storage??{scope,ready:false,dirty:false,revision:0,error:null,edits:{}};
      briefValueRef.current=cached?.brief??INITIAL_BRIEF;setBriefValue(briefValueRef.current);setHasSavedBrief(false);
      if(cached?.storage.ready){
        setBriefReady(true);setBriefError(cached.storage.error);setHasSavedBrief(!cached.storage.dirty&&!cached.storage.error);
        briefHydration.current=Promise.resolve();return;
      }
    }
    const storage=briefStorage.current;
    let cancelled=false;
    storage.ready=false;storage.error=null;setBriefReady(false);setBriefError(null);
    briefHydration.current=(editorLease.current?.lease.ready??Promise.resolve()).then(()=>readSourceForm<CreativeBrief>(`${scope}:brief`)).then(saved=>{
      if(cancelled)return;
      storage.ready=true;
      const restored=saved?{...INITIAL_BRIEF,...saved}:INITIAL_BRIEF;
      briefValueRef.current={...restored,...storage.edits};setBriefValue(briefValueRef.current);
      storage.edits={};setHasSavedBrief(saved!==undefined&&!storage.dirty);
      setBriefReady(true);
    }).catch(error=>{
      if(cancelled)return;
      const message=`活动需求读取失败，当前输入已保留，请重试。${error instanceof Error?` ${error.message}`:''}`;
      storage.error=message;setBriefError(message);
    });
    return()=>{cancelled=true;};
  },[scope,briefLoadAttempt,saveBrief]);
  useEffect(()=>{
    if(!briefReady||!briefStorage.current.dirty||backupPending)return;
    const timer=setTimeout(()=>{briefTimer.current=undefined;void saveBrief(scope).catch(()=>{});},250);briefTimer.current=timer;
    return()=>{clearTimeout(timer);if(briefTimer.current===timer)briefTimer.current=undefined;};
  },[brief,briefReady,scope,saveBrief,backupPending]);
  function retryBrief():void { if(briefStorage.current.ready)void saveBrief(scope).catch(()=>{});else setBriefLoadAttempt(value=>value+1); }
  const [expanded,setExpanded]=useState(false);
  const [directApply,setDirectApply]=useState(true);
  const [jevEnabled,setJevEnabled]=useState(false);
  const [run,setRun]=useState<AgentRun|null>(null);
  const [candidates,setCandidates]=useState<CandidatePreview[]>([]);
  const [recoverable,setRecoverable]=useState(false);
  const [acceptedDecisions,setAcceptedDecisions]=useState<string[]>([]);
  const runEpoch=useRef(0), recoveredScope=useRef('');
  const markerRef=useRef<RunMarker|null>(null);
  const cancelledRequest=useRef<string|null>(null);
  const [preview,setPreview]=useState<Preview|null>(null);
  const [expired,setExpired]=useState(false);
  const layoutRef=useRef(layout); layoutRef.current=layout;
  const imageRef=useRef(images); imageRef.current=images;
  const alive=useRef(true);
  const requestPending=useRef(false);
  const uploadQueue=useRef<Promise<void>>(Promise.resolve());
  const imageEpoch=useRef(0);
  useLayoutEffect(()=>{operationEpoch.current++;},[layout,controller,cloud.user?.id,cloud.project?.id]);
  const controllerRef=useRef(controller);controllerRef.current=controller;
  async function assertCurrentLocalRecords(currentLayout:RoomLayout):Promise<void> {
    const currentScope=agentScopeRef.current,currentBrief=briefRef.current;
    await assertGeometryActionSource(currentLayout,controller);
    if(!alive.current||layoutRef.current!==currentLayout||agentScopeRef.current!==currentScope||briefRef.current!==currentBrief)throw new Error('核对本机资料期间项目或需求已变化，当前输入已保留，请重试。');
  }
  const requestedCloudCheckins=typeof window!=='undefined'&&new URL(window.location.href).searchParams.has('project');
  const checkins=useMaterialCheckins({projectId:layout.id,enabled:!!layout.id&&isLocalActivityWorkspace(controller,requestedCloudCheckins),prepareWrite:async()=>{
    const target=scopeRef.current,owner=controllerRef.current,lease=editorLease.current,userId=owner.getSnapshot().user?.id;
    if(!lease||lease.scope!==target)throw new Error('项目资料尚未准备完成，请稍后保存点验。');
    const check=()=>{
      if(checkinRecovery.current)throw new Error('上次点验恢复的回退尚未完成，请先重试恢复或撤销恢复。');
      if(!alive.current||controllerRef.current!==owner||scopeRef.current!==target||editorLease.current!==lease||!lease.lease.acquired||backupBusy.current||restoreWriting.current||owner.getSnapshot().user?.id!==userId||!isLocalActivityWorkspace(owner))throw new Error('项目或资料状态已变化，点验输入已保留，请重新核对后保存。');
    };
    await lease.lease.ready;check();return check;
  }});
  const geometryAssetKey=[...new Set(layout.floors.flatMap(floor=>floor.items.flatMap(item=>item.assetId?[item.assetId]:[])))].sort().join(',');
  useEffect(()=>{
    if(!cloud.user||!isLocalActivityWorkspace(controller,requestedCloudCheckins)||!geometryAssetKey)return;
    const userId=cloud.user.id,projectId=cloud.project?.id,apiUrl=controller.config.apiUrl;
    let cancelled=false;
    const current=()=>!cancelled&&alive.current&&controllerRef.current===controller&&controller.config.apiUrl===apiUrl&&scopeRef.current===scope&&controller.getSnapshot().user?.id===userId&&controller.getSnapshot().project?.id===projectId&&isLocalActivityWorkspace(controller,requestedCloudCheckins);
    void Promise.all(geometryAssetKey.split(',').filter(id=>getGlbAssetState(id).status!=='ready').map(async id=>{
      // Reauthorize by asset ID only; local scene text and execution records are not required to load a model.
      const asset=await controller.authorizeAsset(id);
      if(current())await ensureGlbAsset(id,asset.url);
    })).catch(()=>{if(current())setNotice('部分模型尚未载入，场景与本机记录已保留。请核对素材访问权限，重新登录后重试。');});
    return()=>{cancelled=true;};
  },[controller,scope,cloud.user?.id,cloud.project?.id,cloud.geometryBinding,geometryAssetKey,requestedCloudCheckins]);
  const reviewContextRef=useRef(reviewContext);reviewContextRef.current=reviewContext;
  const reviewResetEpoch=useRef(0);
  const [,refreshReviewSource]=useState(0);
  function invalidateReviewSource():void {
    reviewResetEpoch.current++;
    if(alive.current)refreshReviewSource(value=>value+1);
  }
  const reviewTracker=useRef<{inputs:unknown[];serial:number;prefix:string}>({inputs:[],serial:0,prefix:crypto.randomUUID()});
  function getReviewSource():ProjectReviewSource {
    const session=controllerRef.current.getSnapshot();
    const inputs=[layoutRef.current,briefValueRef.current,imageRef.current,controllerRef.current,
      session.user?.id,session.project?.id,scopeRef.current,reviewContextRef.current,reviewResetEpoch.current];
    const tracker=reviewTracker.current;
    if(inputs.some((value,index)=>value!==tracker.inputs[index])){tracker.inputs=inputs;tracker.serial++;}
    return {scope:scopeRef.current,revision:`${tracker.prefix}:${tracker.serial}`};
  }
  const reviewSource=getReviewSource();
  function beginBackupOperation() {
    if(backupBusy.current)throw new Error('正在处理备份，请等待当前操作完成。');
    backupBusy.current=true;setBackupPending(true);
    if(briefTimer.current!==undefined){clearTimeout(briefTimer.current);briefTimer.current=undefined;}
    const base={layout:layoutRef.current,scope:scopeRef.current,epoch:operationEpoch.current,edits:briefEditEpoch.current,user:controller.getSnapshot().user?.id,project:controller.getSnapshot().project?.id};
    return {base,check(){
      const current=controller.getSnapshot();
      if(!alive.current||controllerRef.current!==controller||operationEpoch.current!==base.epoch||layoutRef.current!==base.layout||scopeRef.current!==base.scope||briefEditEpoch.current!==base.edits||current.user?.id!==base.user||current.project?.id!==base.project)throw new Error('操作期间项目或需求已变化，已停止处理并保留当前输入，请重新选择备份。');
    }};
  }
  function endBackupOperation():void {
    restoreWriting.current=false;backupBusy.current=false;
    if(alive.current){
      if(!editorLease.current||editorLease.current.scope!==scopeRef.current){
        const nextScope=scopeRef.current,lease=registerSourceEditor(nextScope);editorLease.current={scope:nextScope,lease};editorLeases.current.set(nextScope,lease);
      }
      setBackupPending(false);
      if(!sourceRecovery.current)setSourcesRestoring(false);
    }
  }
  async function flushBackupBase(operation:ReturnType<typeof beginBackupOperation>):Promise<CreativeBrief|undefined> {
    await flushSourceScope(operation.base.scope);operation.check();
    // The current flusher reports its own write error; an older scope's failed
    // draft stays in its cache and must not masquerade as this scope's failure.
    await briefSaveQueue.current.catch(()=>{});operation.check();
    const saved=await readSourceForm<CreativeBrief>(`${operation.base.scope}:brief`);operation.check();
    return saved;
  }
  async function prepareBackup(options?:{includeSourceDocuments?:boolean}):Promise<string> {
    if(sourceRecovery.current)throw new Error('图纸资料回退尚未完成，请先重试恢复或撤销恢复。');
    const activeScope=scopeRef.current;
    if(failedRollback.current?.scope===activeScope||undoRecovery.current?.some(entry=>entry.scope===activeScope))throw new Error('当前项目的资料回退尚未完成，请先重试恢复或撤销恢复，再下载场景与活动备份。');
    const operation=beginBackupOperation();
    try {
      const saved=await flushBackupBase(operation);
      if(checkinRecovery.current)throw new Error('上次点验恢复的回退尚未完成，请先重试恢复或撤销恢复，再下载备份。');
      const briefSnapshot={state:'ready' as const,scope:operation.base.scope,brief:saved===undefined?{status:'absent' as const}:{status:'present' as const,value:saved}};
      const ledger=operation.base.layout.id?await readMaterialCheckins(operation.base.layout.id):undefined;operation.check();
      if(ledger&&!isLocalActivityWorkspace(controller))throw new Error('此项目还有本机点验记录，请切换到对应本地项目后备份，原记录已保留。');
      if(options?.includeSourceDocuments){
        if(!operation.base.layout.id)throw new Error('请先保存活动编号，再备份图纸。');
        const documents=await readSourceScopeSnapshot(operation.base.scope);operation.check();
        const text=await serializeLocalProjectBackupV4(operation.base.layout,briefSnapshot,{state:'ready',scope:operation.base.scope,
          materialCheckins:ledger?{status:'present',value:ledger}:{status:'absent'}},documents);
        const after=await readSourceScopeSnapshot(operation.base.scope);operation.check();
        if(!await sameSourceScopeSnapshot(documents,after))throw new Error('打包期间图纸已有改动，请重新下载。');
        operation.check();return text;
      }
      const text=operation.base.layout.id?serializeLocalProjectBackupV3(operation.base.layout,briefSnapshot,{state:'ready',scope:operation.base.layout.id,
        materialCheckins:ledger?{status:'present',value:ledger}:{status:'absent'}}):serializeLocalProjectBackup(operation.base.layout,briefSnapshot);
      operation.check();return text;
    } finally {endBackupOperation();}
  }
  async function prepareReview():Promise<ProjectReviewBase> {
    if(sourceRecovery.current)throw new Error('请先完成图纸资料的恢复回退，再准备评审。');
    if(checkinRecovery.current)throw new Error('请先完成点验资料的恢复回退，再准备评审。');
    const source=getReviewSource();
    if(failedRollback.current?.scope===source.scope||undoRecovery.current?.some(entry=>entry.scope===source.scope))throw new Error('请先完成资料恢复或撤销恢复，再准备评审。');
    const operation=beginBackupOperation();
    try{
      // Flush only the brief being exported. Rewriting an unchanged reconstruction
      // form would reload its reference image and invalidate this very preparation.
      await briefHydration.current;operation.check();
      await saveBrief(operation.base.scope);operation.check();
      await briefSaveQueue.current;operation.check();
      const brief=await readSourceForm<CreativeBrief>(`${operation.base.scope}:brief`);operation.check();
      if(source.scope!==getReviewSource().scope||source.revision!==getReviewSource().revision)throw new Error('内容已变化，请重新准备评审。');
      let saved:RoomLayout|null=null;
      try{const stored=localStorageOrNull()?.getItem(STORAGE_KEY);saved=stored?parseLayoutJson(stored):null;}catch{/* A valid in-memory review remains explicitly a draft. */}
      return {layout:operation.base.layout,briefSnapshot:{state:'ready',scope:source.scope,brief:brief===undefined?{status:'absent'}:{status:'present',value:brief}},source,
        dataState:saved&&(saved.id??'local')===source.scope&&sameLayoutContent(saved,operation.base.layout)?'saved':'unsaved-draft',
        dataKind:operation.base.layout.eventOperations?.dataKind??'unspecified'};
    }finally{endBackupOperation();}
  }
  function assertLocalRestore():void {
    if(requestPending.current)throw new Error('助手仍在处理，请先等待或取消当前任务，再恢复或切换活动。');
    if(!isLocalActivityWorkspace(controller))throw new Error('当前工作台连接了云项目，请先切换到本地项目再恢复备份。');
    if(!prepareRestoreLayout||!commitRestoredLayout)throw new Error('此工作台尚未开放完整备份恢复。');
  }
  async function disconnectSceneForRestore():Promise<void> {
    if(!controller.getSnapshot().geometryBinding)return;
    const before={layout:layoutRef.current,scope:scopeRef.current,edits:briefEditEpoch.current,user:controller.getSnapshot().user?.id};
    await controller.disconnectGeometryWorkbench();
    if(!alive.current||controllerRef.current!==controller||layoutRef.current!==before.layout||scopeRef.current!==before.scope||briefEditEpoch.current!==before.edits||controller.getSnapshot().user?.id!==before.user)throw new Error('断开场景连接期间活动有新改动，未继续恢复。当前资料已保留，请重新核对。');
  }
  async function writeBackupBrief(targetScope:string,value:CreativeBrief|undefined):Promise<void> {
    if(value===undefined)await deleteSourceForm(`${targetScope}:brief`);
    else await storeSourceForm(`${targetScope}:brief`,value);
  }
  async function repairCheckinRecovery(check:()=>void):Promise<void> {
    const recovery=checkinRecovery.current;if(!recovery)return;
    const current=await readMaterialCheckins(recovery.scope);check();
    if(!sameCheckins(current,recovery.before)&&!sameCheckins(current,recovery.attempted))throw new Error('点验回退期间已有新记录，不能覆盖，原恢复点仍保留。');
    if(!sameCheckins(current,recovery.before))await restoreMaterialCheckinsIfUnchanged(recovery.scope,current,recovery.before,check);
    check();checkinRecovery.current=null;
  }
  async function compensateCheckins(change:CheckinRestoreWrite):Promise<void> {
    try{await restoreMaterialCheckinsIfUnchanged(change.scope,change.attempted,change.before);}
    catch(error){checkinRecovery.current=change;throw error;}
  }
  function adoptSourceImages(snapshot:SourceScopeSnapshot):void {
    if(snapshot.scope!==scopeRef.current)return;
    const restored=snapshot.sources.filter(source=>source.blob).map(source=>({...source,url:URL.createObjectURL(source.blob!)}));
    for(const image of restored)savedImages.current.add(image);
    imageEpoch.current++;
    for(const image of imageRef.current)URL.revokeObjectURL(image.url);
    imageRef.current=restored;setImages(restored);
  }
  async function verifySourceWrite(snapshot:SourceScopeSnapshot,check:()=>void):Promise<void> {
    const saved=await readSourceScopeSnapshot(snapshot.scope);check();
    if(!await sameSourceScopeSnapshot(saved,snapshot))throw new Error('图纸保存后的核对失败，恢复未完成。');
    check();
  }
  async function compensateSources(change:SourceRestoreWrite):Promise<void> {
    // Keep the recovery point until both atomic replacement and readback succeed.
    sourceRecovery.current=change;
    const current=await readSourceScopeSnapshot(change.scope);
    if(!await sameSourceScopeSnapshot(current,change.before))await restoreSourceScopeIfUnchanged(change.scope,change.attempted,change.before);
    await verifySourceWrite(change.before,()=>{});
    adoptSourceImages(change.before);sourceRecovery.current=null;
  }
  async function repairSourceRecovery(check:()=>void):Promise<void> {
    const recovery=sourceRecovery.current;if(!recovery)return;
    check();await compensateSources(recovery);check();
  }
  const sameBrief=(a:CreativeBrief|undefined,b:CreativeBrief|undefined)=>a===undefined||b===undefined?a===b:canonical(a)===canonical(b);
  async function writeAndReadBrief(targetScope:string,value:CreativeBrief|undefined,check:()=>void):Promise<CreativeBrief|undefined> {
    check();
    await writeBackupBrief(targetScope,value);check();
    const saved=await readSourceForm<CreativeBrief>(`${targetScope}:brief`);check();
    if(!sameBrief(saved,value))throw new Error('活动需求保存后的核对失败，原项目已保留。');
    return saved;
  }
  function adoptRestoredBrief(targetScope:string,saved:CreativeBrief|undefined):void {
    briefDrafts.current.delete(targetScope);
    briefStorage.current={scope:targetScope,ready:true,dirty:false,revision:0,error:null,edits:{}};
    briefValueRef.current=saved===undefined?INITIAL_BRIEF:{...INITIAL_BRIEF,...saved};
    adoptedScope.current=targetScope;briefHydration.current=Promise.resolve();
    setBriefValue(briefValueRef.current);setBriefReady(true);setBriefError(null);setHasSavedBrief(saved!==undefined);setBriefLoadAttempt(value=>value+1);
  }
  async function releaseEditorForRestore(pauseSources=false):Promise<void> {
    if(pauseSources)flushSync(()=>setSourcesRestoring(true));
    restoreWriting.current=true;
    const held=editorLease.current;editorLease.current=undefined;
    await held?.lease.release();
    if(held&&editorLeases.current.get(held.scope)===held.lease)editorLeases.current.delete(held.scope);
  }
  async function restoreBackup(candidate:LocalProjectRestoreCandidate):Promise<void> {
    invalidateReviewSource();
    assertLocalRestore();
    const checked=validateLocalProjectRestoreCandidate(candidate);
    await disconnectSceneForRestore();
    assertLocalRestore();
    if(undoRecovery.current)throw new Error('上次撤销恢复的资料回退尚未完成，请先重试撤销；当前所选文件仍保留。');
    // File provenance remains meaningful even for programmatic restore callers.
    const priorId=preparedRestoreIds.current.get(candidate);
    const next=prepareRestoreLayout!(!checked.layout.id&&priorId?{...checked.layout,id:priorId}:checked.layout),targetScope=next.id??'local';
    const incomingSources=checked.sourceDocuments?.status==='present'?{scope:targetScope,...await decodeSourceDocuments(checked.sourceDocuments,targetScope)}:undefined;
    if(!candidate.layout.id&&next.id)preparedRestoreIds.current.set(candidate,next.id);
    const desired=checked.brief.status==='present'?checked.brief.value:undefined;
    const targetDraft=briefDrafts.current.get(targetScope);
    const operation=beginBackupOperation();
    try {
      let beforeBrief=await flushBackupBase(operation);assertLocalRestore();
      await releaseEditorForRestore(!!incomingSources||!!sourceRecovery.current);operation.check();
      await withSourceRestoreLock([operation.base.scope,targetScope,...(failedRollback.current?[failedRollback.current.scope]:[]),...(checkinRecovery.current?[checkinRecovery.current.scope]:[]),...(sourceRecovery.current?[sourceRecovery.current.scope]:[])],async()=>{
        operation.check();assertLocalRestore();
        await repairSourceRecovery(operation.check);
        await repairCheckinRecovery(operation.check);
        const recovery=failedRollback.current;
        if(recovery){
          const current=await readSourceForm<CreativeBrief>(`${recovery.scope}:brief`);operation.check();
          if(!sameBrief(current,recovery.original)&&!sameBrief(current,recovery.attempted))throw new Error('上次回退未完成的目标资料已有新变化，原恢复值仍保留在此页面，请保留当前页面和原备份，核对后再处理。');
          await writeAndReadBrief(recovery.scope,recovery.original,operation.check);failedRollback.current=null;
          if(recovery.scope===operation.base.scope)beforeBrief=recovery.original;
        }
        const targetBrief=await readSourceForm<CreativeBrief>(`${targetScope}:brief`);operation.check();
        const targetCheckins=await readMaterialCheckins(targetScope);operation.check();
        const desiredCheckins=checked.materialCheckins.status==='present'
          ?targetCheckins?mergeMaterialCheckinLedgers(targetCheckins,checked.materialCheckins.value):checked.materialCheckins.value:targetCheckins;
        const checkinChange:CheckinRestoreWrite|undefined=sameCheckins(targetCheckins,desiredCheckins)?undefined:{scope:targetScope,before:targetCheckins,attempted:desiredCheckins};
        const sourceChange:SourceRestoreWrite|undefined=incomingSources?{scope:targetScope,before:await readSourceScopeSnapshot(targetScope),attempted:incomingSources}:undefined;
        operation.check();
        let touched=false,checkinsTouched=false,sourcesTouched=false;
        try {
          if(sourceChange){await restoreSourceScopeIfUnchanged(targetScope,sourceChange.before,sourceChange.attempted,operation.check);sourcesTouched=true;
            await verifySourceWrite(sourceChange.attempted,operation.check);}
          if(checkinChange){await restoreMaterialCheckinsIfUnchanged(targetScope,targetCheckins,desiredCheckins,operation.check);checkinsTouched=true;operation.check();}
          touched=true;
          const saved=await writeAndReadBrief(targetScope,desired,operation.check);assertLocalRestore();
          flushSync(()=>{commitRestoredLayout!(next);adoptRestoredBrief(targetScope,saved);});
          const afterLayout=layoutRef.current;
          const point={beforeLayout:operation.base.layout,beforeBrief,targetScope,targetBrief,targetDraft,afterLayout,afterEdits:briefEditEpoch.current,afterBrief:saved,...(checkinChange?{checkinChange}:{}),...(sourceChange?{sourceChange}:{})};
          undoPointRef.current=point;setUndoPoint(point);
          if(sourceChange)adoptSourceImages(sourceChange.attempted);
          if(checkinChange)checkins.retry();
        } catch(error) {
          let sourceRollbackError:unknown;
          if(sourcesTouched&&sourceChange)try{await compensateSources(sourceChange);}catch(caught){sourceRollbackError=caught;}
          let checkinRollbackError:unknown;
          if(checkinsTouched&&checkinChange)try{await compensateCheckins(checkinChange);}catch(caught){checkinRollbackError=caught;}
          if(touched)try {await writeAndReadBrief(targetScope,targetBrief,()=>{});}catch(rollbackError){
            failedRollback.current={scope:targetScope,original:targetBrief,attempted:desired};
            if(scopeRef.current===targetScope){
              briefStorage.current.error='上次恢复的活动需求回退未完成，当前输入仍在此页面，请重试保存或恢复。';
              setBriefError(briefStorage.current.error);setHasSavedBrief(false);
            }
            throw new Error(`${error instanceof Error?error.message:'恢复失败。'} 原活动需求回退也失败，当前草稿与所选文件仍保留，请保留此页面并重试。${checkinRollbackError?' 点验记录回退也未完成。':''}${rollbackError instanceof Error?` ${rollbackError.message}`:''}`);
          }
          if(sourceRollbackError)throw new Error(`${error instanceof Error?error.message:'恢复失败。'} 图纸资料回退未完成，已暂停图纸编辑，请保留本页并重试恢复。`);
          if(checkinRollbackError)throw new Error(`${error instanceof Error?error.message:'恢复失败。'} 点验记录回退未完成，原恢复值仍保留，请保留此页面重试。`);
          throw error;
        }
      });
    } finally {endBackupOperation();}
  }
  const canUndoRestore=!!undoPoint&&!backupPending&&!busy&&undoPoint.afterLayout===layout&&undoPoint.afterEdits===briefEditEpoch.current&&isLocalActivityWorkspace(controller)&&
    (!undoPoint.checkinChange||!!checkinRecovery.current||checkins.ready&&sameCheckins(checkins.ledger,undoPoint.checkinChange.attempted));
  async function undoRestore():Promise<void> {
    invalidateReviewSource();
    assertLocalRestore();
    await disconnectSceneForRestore();
    assertLocalRestore();
    const point=undoPointRef.current;
    if(!point||point.afterLayout!==layoutRef.current||point.afterEdits!==briefEditEpoch.current)throw new Error('恢复后项目或需求已有新编辑，不能覆盖这些编辑；请保留当前页面和原备份，核对后再处理。');
    const next=prepareRestoreLayout!(point.beforeLayout),nextScope=next.id??'local';
    const operation=beginBackupOperation();
    try {
      await flushBackupBase(operation);
      await releaseEditorForRestore(!!point.sourceChange||!!sourceRecovery.current);operation.check();
      await withSourceRestoreLock([point.targetScope,nextScope,...(checkinRecovery.current?[checkinRecovery.current.scope]:[]),...(sourceRecovery.current?[sourceRecovery.current.scope]:[])],async()=>{
        operation.check();assertLocalRestore();
        await repairSourceRecovery(operation.check);
        await repairCheckinRecovery(operation.check);
        const recovery=undoRecovery.current;
        if(recovery){
          // Read every key before repairing any: a new edit must never be guessed
          // to be one of this transaction's partial writes.
          for(const entry of recovery){
            const saved=await readSourceForm<CreativeBrief>(`${entry.scope}:brief`);operation.check();
            if(!sameBrief(saved,entry.before)&&!sameBrief(saved,entry.attempted))throw new Error('上次撤销回退涉及的资料已有新修改，原恢复点仍保留，不能覆盖新资料。');
          }
          const errors:unknown[]=[];
          for(const entry of recovery)try{await writeAndReadBrief(entry.scope,entry.before,operation.check);}catch(error){errors.push(error);}
          if(errors.length)throw new Error('上次撤销的资料回退仍未完成，原恢复点已保留，请在本地存储恢复后重试撤销。');
          undoRecovery.current=null;
        }
        const currentBrief=await readSourceForm<CreativeBrief>(`${point.targetScope}:brief`);operation.check();
        if(!sameBrief(currentBrief,point.afterBrief))throw new Error('恢复后的活动需求已变化，不能覆盖新资料。');
        const originalBrief=await readSourceForm<CreativeBrief>(`${nextScope}:brief`);operation.check();
        if(nextScope!==point.targetScope&&!sameBrief(originalBrief,point.beforeBrief))throw new Error('原项目的活动需求在恢复后已有新修改，原恢复点仍保留，不能覆盖这些新资料。');
        const compensations=[{scope:nextScope,before:originalBrief,attempted:point.beforeBrief},...(point.targetScope===nextScope?[]:[{scope:point.targetScope,before:currentBrief,attempted:point.targetBrief}])];
        const currentCheckins=point.checkinChange?await readMaterialCheckins(point.targetScope):undefined;operation.check();
        if(point.checkinChange&&!sameCheckins(currentCheckins,point.checkinChange.attempted))throw new Error('恢复后已有新的点验记录，不能覆盖这些记录；原恢复点仍保留。');
        const checkinUndo:CheckinRestoreWrite|undefined=point.checkinChange?{scope:point.targetScope,before:currentCheckins,attempted:point.checkinChange.before}:undefined;
        const sourceUndo:SourceRestoreWrite|undefined=point.sourceChange?{scope:point.targetScope,before:point.sourceChange.attempted,attempted:point.sourceChange.before}:undefined;
        let touched=false,checkinsTouched=false,sourcesTouched=false;
        try {
          if(sourceUndo){await restoreSourceScopeIfUnchanged(sourceUndo.scope,sourceUndo.before,sourceUndo.attempted,operation.check);sourcesTouched=true;
            await verifySourceWrite(sourceUndo.attempted,operation.check);}
          if(checkinUndo){await restoreMaterialCheckinsIfUnchanged(checkinUndo.scope,checkinUndo.before,checkinUndo.attempted,operation.check);checkinsTouched=true;operation.check();}
          touched=true;
          const saved=await writeAndReadBrief(nextScope,point.beforeBrief,operation.check);
          if(point.targetScope!==nextScope)await writeAndReadBrief(point.targetScope,point.targetBrief,operation.check);
          assertLocalRestore();
          flushSync(()=>{
            commitRestoredLayout!(next);adoptRestoredBrief(nextScope,saved);
            if(point.targetDraft&&point.targetScope!==nextScope)briefDrafts.current.set(point.targetScope,point.targetDraft);
            undoPointRef.current=null;setUndoPoint(null);
            if(checkinUndo)checkins.retry();
          });
          if(sourceUndo)adoptSourceImages(sourceUndo.attempted);
        } catch(error) {
          let sourceRollbackError:unknown;
          if(sourcesTouched&&sourceUndo)try{await compensateSources(sourceUndo);}catch(caught){sourceRollbackError=caught;}
          let checkinRollbackError:unknown;
          if(checkinsTouched&&checkinUndo)try{await compensateCheckins(checkinUndo);}catch(caught){checkinRollbackError=caught;}
          if(touched){
            const failures:unknown[]=[];
            for(const entry of compensations)try{await writeAndReadBrief(entry.scope,entry.before,()=>{});}catch(rollbackError){failures.push(rollbackError);}
            if(failures.length){
              undoRecovery.current=compensations;
              briefStorage.current.error='上次撤销恢复的活动需求回退未完成，当前输入仍保留，请重试撤销恢复。';
              setBriefError(briefStorage.current.error);setHasSavedBrief(false);
              throw new Error(`${error instanceof Error?error.message:'撤销恢复失败。'} 活动需求回退也失败，原恢复点仍保留，请在本地存储恢复后重试撤销。${checkinRollbackError?' 点验记录回退也未完成。':''}${failures[0] instanceof Error?` ${failures[0].message}`:''}`);
            }
          }
          if(sourceRollbackError)throw new Error(`${error instanceof Error?error.message:'撤销恢复失败。'} 图纸资料回退未完成，已暂停图纸编辑，请保留本页并重试撤销。`);
          if(checkinRollbackError)throw new Error(`${error instanceof Error?error.message:'撤销恢复失败。'} 点验记录回退未完成，原恢复点仍保留，请保留此页面重试撤销。`);
          throw error;
        }
      });
    } finally {endBackupOperation();}
  }
  useEffect(()=>{
    if(preservingPreparation.current)return;
    const epoch=++imageEpoch.current;
    uploadQueue.current=listStoredSources(scope).then(stored=>{
      if(!alive.current || epoch!==imageEpoch.current)return;
      const restored=stored.filter(source=>source.blob).map(source=>({...source,url:URL.createObjectURL(source.blob!)}));
      for(const image of restored)savedImages.current.add(image);
      imageRef.current=restored;setImages(restored);
    }).catch(()=>{ /* Saving reports unavailable IndexedDB when files are selected. */ });
    for(const image of imageRef.current) URL.revokeObjectURL(image.url);
    imageRef.current=[];
    setImages([]);
  },[scope]);
  useEffect(()=>{
    if(preservingPreparation.current)return;
    if(!cloud.user||!geometryProjectId(controller,scope))return;
    let cancelled=false;
    void uploadQueue.current.then(async()=>{
      const sources=await controller.listSources();
      const saved=await listStoredSources(scope).catch(()=>[]);
      const missing=sources.filter(source=>!imageRef.current.some(image=>image.assetId===source.assetId));
      const restored=await Promise.all(missing.map(async source=>({...source,kind:saved.find(image=>image.assetId===source.assetId)?.kind??source.kind,id:saved.find(image=>image.assetId===source.assetId)?.id??source.assetId,url:await controller.sourceImageUrl(source.assetId),uploadedKind:source.kind})));
      if(cancelled||scopeRef.current!==scope)return;
      imageRef.current=[...imageRef.current,...restored.filter(source=>!imageRef.current.some(image=>image.assetId===source.assetId))].slice(0,12);setImages(imageRef.current);
    }).catch(error=>{if(!cancelled)setNotice(error instanceof Error?error.message:'云端资料暂时无法恢复，本机资料已保留。');});
    return()=>{cancelled=true;};
  },[controller,cloud.user,cloud.project?.id,scope]);
  useEffect(()=>registerSourceFlush(scope,async()=>{
    await Promise.all([uploadQueue.current,briefHydration.current]);
    if(!alive.current||scopeRef.current!==scope)throw new Error('场地资料正在切换，请稍后重试创建项目。');
    await Promise.all([
      saveBrief(scope),
      ...(sourceRecovery.current?[]:imageRef.current.filter(image=>!savedImages.current.has(image)).map(async image=>{
        const {url,...stored}=image;await storeSource({...stored,scope,kind:image.kind??'photo',width:image.width!,height:image.height!});savedImages.current.add(image);
      })),
    ]);
  }),[scope,saveBrief]);
  const briefKey=JSON.stringify({brief,images:images.map(i=>({id:i.id,kind:i.kind}))});
  const briefRef=useRef(briefKey); briefRef.current=briefKey;
  const connection=!cloud.configured?'离线引导':busy&&preparation.current?'正在准备工作台':!cloud.user||cloud.writeBlocked?'功能已开放':'项目已连接';
  const stale=!!preview && (expired || Date.parse(preview.proposal.expires_at)<=Date.now() || preview.scope!==agentScope || preview.base!==layout || preview.briefKey!==briefKey || cloud.writeBlocked || preview.proposal.project_id!==cloud.project?.id || preview.proposal.base_revision!==cloud.revision || preview.proposal.local_revision!==cloud.localRevision || preview.proposal.session_id!==cloud.sessionId || preview.proposal.generation!==cloud.lease?.generation);
  useEffect(()=>{ alive.current=true; const lifecycleEpoch=imageEpoch; return ()=>{ alive.current=false; lifecycleEpoch.current++; for(const img of imageRef.current) URL.revokeObjectURL(img.url); }; },[]);
  useEffect(()=>{
    setExpired(false);
    if(!preview) return undefined;
    let timeout:ReturnType<typeof setTimeout>;
    const expire=()=>{
      const remaining=Date.parse(preview.proposal.expires_at)-Date.now();
      if(!Number.isFinite(remaining) || remaining<=0) { setExpired(true); return; }
      // Browser timers cap at signed 32-bit milliseconds. Long-lived test or
      // server responses must not accidentally expire on the next tick.
      timeout=setTimeout(expire,Math.min(remaining,2_147_000_000));
    };
    expire();
    return ()=>clearTimeout(timeout);
  },[preview]);
  useEffect(()=>{ onPreview?.(preview&&!stale?preview.layout:null); },[onPreview,preview,stale]);
  useEffect(()=>()=>onPreview?.(null),[onPreview]);
  function say(text:string,modelSuggestions?:SceneProposal['modelSuggestions'],materialSuggestions?:SceneProposal['materialSuggestions']):void { setMessages(items=>[...items.slice(-38),{id:crypto.randomUUID(),role:'assistant',text,modelSuggestions,materialSuggestions}]); }

  async function addImages(files: FileList|null, requestedKind?: ReferenceImage['kind']):Promise<void> {
    if(backupBusy.current||sourceRecovery.current)throw new Error('正在处理备份或图纸回退，请完成后再添加图片。');
    if(!files?.length) return;
    // Snapshot before the input is cleared. Every selection is processed in
    // order; a second selection no longer invalidates the first decode.
    const batch=Array.from(files);
    const epoch=imageEpoch.current, imageScope=scopeRef.current;
    const active=()=>alive.current&&epoch===imageEpoch.current&&imageScope===scopeRef.current;
    const task=uploadQueue.current.then(async()=>{
      if(!active()) return;
      setNotice('');
      const added:ReferenceImage[]=[];
      try {
        if(batch.length+imageRef.current.length>12) throw new Error('最多添加 12 张图纸或现场照片。');
        for(const file of batch) {
          if(!['image/png','image/jpeg','image/webp'].includes(file.type)) throw new Error('请选择 PNG、JPEG 或 WebP 图片。');
          if(file.size>5*1024*1024) throw new Error('每张图片不能超过 5 MB。');
          const bitmap=await createImageBitmap(file);
          const valid=bitmap.width>0&&bitmap.height>0&&bitmap.width<=4096&&bitmap.height<=4096;
          const width=bitmap.width,height=bitmap.height;
          let pixels:Uint8ClampedArray|undefined;
          try { const canvas=document.createElement('canvas');canvas.width=64;canvas.height=64; const context=canvas.getContext('2d');if(context){context.drawImage(bitmap,0,0,64,64);pixels=context.getImageData(0,0,64,64).data;} } catch { /* Filename suggestion still available. */ }
          const kind=requestedKind??suggestSourceKind(file.name,pixels);
          bitmap.close();
          if(!valid) throw new Error('图片长宽请控制在 4096 像素以内。');
          if(!active()) break;
          added.push({id:crypto.randomUUID(),name:file.name,url:URL.createObjectURL(file),width,height,kind,blob:file});
        }
        if(!active()) { for(const img of added) URL.revokeObjectURL(img.url); return; }
        // Update the ref immediately: the following queued batch can start
        // before React commits this state, and must still see the new count.
        imageRef.current=[...imageRef.current,...added];
        setImages(imageRef.current);
        try { await Promise.all(added.map(async image=>{const {url,...stored}=image;await storeSource({...stored,scope:imageScope,kind:image.kind??'photo',width:image.width!,height:image.height!});savedImages.current.add(image);})); } catch(error) { if(active()) setNotice(error instanceof Error?error.message:'本机保存失败，图片仍在本次会话中。'); }
      } catch(error) { for(const img of added) URL.revokeObjectURL(img.url); if(active()) setNotice(error instanceof Error?error.message:'图片无法读取，请更换文件。'); }
    });
    uploadQueue.current=task;
    return task;
  }
  function removeImage(id:string):void {
    if(backupBusy.current||sourceRecovery.current)return;
    const image=imageRef.current.find(value=>value.id===id);if(!image)return;
    const requestedScope=scopeRef.current,epoch=imageEpoch.current;
    const task=uploadQueue.current.then(async()=>{
      if(scopeRef.current!==requestedScope||imageEpoch.current!==epoch)return;
      if(image.assetId)await controller.removeSource(image.assetId);
      if(scopeRef.current!==requestedScope||imageEpoch.current!==epoch||!imageRef.current.includes(image))return;
      await deleteSource(id);
      if(scopeRef.current!==requestedScope||imageEpoch.current!==epoch)return;
      URL.revokeObjectURL(image.url);imageRef.current=imageRef.current.filter(value=>value.id!==id);setImages(imageRef.current);
    });
    uploadQueue.current=task.catch(error=>{if(scopeRef.current===requestedScope)setNotice(error instanceof Error?error.message:'项目资料移除失败，请重试。');});
  }
  function updateImage(id:string,patch:Partial<VenuePhoto>):void {
    if(backupBusy.current||sourceRecovery.current)return;
    imageRef.current=imageRef.current.map(image=>image.id===id?{...image,...patch}:image);setImages(imageRef.current);
    const updated=imageRef.current.find(image=>image.id===id);
    if(updated){const {url,...stored}=updated;const epoch=imageEpoch.current;
      const current=()=>alive.current&&scopeRef.current===scope&&imageEpoch.current===epoch;
      const write=uploadQueue.current.then(async()=>{if(current()){await storeSource({...stored,scope,kind:stored.kind??'photo',width:stored.width!,height:stored.height!});savedImages.current.add(updated);}});
      uploadQueue.current=write.catch(error=>{if(current())setNotice(error instanceof Error?error.message:'资料保存失败。');});}
  }
  function forgetRun():void {
    markerRef.current=null;setRecoverable(false);
    try { localStorage.removeItem(runStorageKey(agentScopeRef.current)); } catch { /* A leftover marker can only trigger a status read. */ }
  }
  function rememberRun(marker:RunMarker,scope:string):void {
    // Saving the identity before POST prevents accidental duplicate paid runs after disconnects.
    localStorage.setItem(runStorageKey(scope),JSON.stringify(marker));
    markerRef.current=marker;
  }
  async function consumeRun(result:AgentRun,base:RoomLayout,submittedBrief:string,submittedScope:string,allowDirect:boolean,epoch:number):Promise<void> {
    if(result.state==='cancelled'){setCandidates([]);setPreview(null);forgetRun();say('任务已取消，当前方案保持不变。');return;}
    if(!result.candidates.length){forgetRun();say(result.message || (result.state==='failed'?`任务未完成（${result.errorCode??'UNKNOWN'}），原方案已保留。`:'已读取当前场景，本次没有修改物件。'));return;}
    if(layoutRef.current!==base || briefRef.current!==submittedBrief) throw new Error('生成期间方案或需求已变化，旧提案未应用。请根据最新内容重新生成。');
    const scene=layoutToBackendScene(base), first=result.candidates[0]!.proposal;
    if(result.candidates.some(({proposal})=>canonical(proposal.base_scene)!==canonical(scene)||proposal.project_id!==first.project_id||proposal.base_revision!==first.base_revision||proposal.local_revision!==first.local_revision||proposal.session_id!==first.session_id||proposal.generation!==first.generation))throw new Error('返回的候选方案基线不一致，原方案已保留。');
    if(result.candidates.some(({proposal})=>!Number.isFinite(Date.parse(proposal.expires_at))||Date.parse(proposal.expires_at)<=Date.now()))throw new Error('提案已过期，请重新生成。');
    const interrupted=result.state==='complete'&&!!result.errorCode;
    const canAnnounceRetained=():boolean=>{
      if(!interrupted||result.jevEnabled&&result.evaluation?.status==='partial'||!alive.current||agentScopeRef.current!==submittedScope||epoch!==runEpoch.current||layoutRef.current!==base||briefRef.current!==submittedBrief)return false;
      const current=controller.getSnapshot();
      return !current.writeBlocked&&result.candidates.every(({proposal})=>Date.parse(proposal.expires_at)>Date.now()&&proposal.project_id===current.project?.id&&proposal.base_revision===current.revision&&proposal.local_revision===current.localRevision&&proposal.session_id===current.sessionId&&proposal.generation===current.lease?.generation);
    };
    const announceRetained=():void=>{setNotice(current=>current?`${current}\n${PARTIAL_RUN_NOTICE}`:PARTIAL_RUN_NOTICE);};
    setLastExplanation(first.explanation);
    if(result.candidates.length===1&&canonical(first.candidate)===canonical(scene)){
      const announce=canAnnounceRetained();
      forgetRun();say(first.explanation||(!interrupted?result.message:undefined)||'已读取当前场景，本次没有修改物件。',first.modelSuggestions,first.materialSuggestions);
      if(announce)announceRetained();return;
    }
    const prepared=await Promise.all(result.candidates.map(async item=>{
      const assets=await controller.authorizeAssets(item.proposal.candidate);
      await Promise.all(Object.entries(assets.assetUrls).map(([id,url])=>ensureGlbAsset(id,url)));
      const next=mergeProposalPresentation(base,backendSceneToLayout(item.proposal.candidate,{projectId:base.id!,name:base.name,...assets}));
      return {label:item.label,title:item.title,preview:{proposal:item.proposal,assets,layout:next,base,briefKey:submittedBrief,scope:submittedScope}};
    }));
    if(!alive.current||agentScopeRef.current!==submittedScope||epoch!==runEpoch.current)return;
    if(layoutRef.current!==base||briefRef.current!==submittedBrief)throw new Error('生成期间方案或需求已变化，旧提案未应用。请根据最新内容重新生成。');
    const announce=canAnnounceRetained();
    const preferred=prepared.find(item=>item.label===result.evaluation?.choice)??prepared[0]!;
    if(allowDirect&&result.executionMode==='direct'&&!result.jevEnabled&&prepared.length===1){await applyCandidate(preferred.preview);}
    else {setCandidates(prepared);setPreview(preferred.preview);say(result.jevEnabled?'候选方案已准备好。可以分别预览比较，最终由你选择并确认应用。':first.explanation||'方案提案已返回，请核对修改范围后确认应用。',first.modelSuggestions,first.materialSuggestions);}
    if(announce&&alive.current&&agentScopeRef.current===submittedScope&&epoch===runEpoch.current)announceRetained();
  }
  async function followRun(initial:AgentRun,base:RoomLayout,submittedBrief:string,submittedScope:string,epoch:number,allowDirect:boolean):Promise<void> {
    let result=initial;
    const pollingDeadline=Date.now()+120_000;
    const active=()=>alive.current&&agentScopeRef.current===submittedScope&&epoch===runEpoch.current;
    while(active()){
      setRun(result);
      const marker=markerRef.current;
      if(marker){try{rememberRun({...marker,runId:result.id},submittedScope);}catch{setNotice('任务已提交，但本机记录更新失败；请保持页面打开。');}}
      if(!['queued','running'].includes(result.state))break;
      if(Date.now()>=pollingDeadline)throw new Error('任务仍在处理，已暂停自动查询。请稍后查询原任务，不要重复提交。');
      await new Promise(resolve=>setTimeout(resolve,2000));
      if(!active())return;
      result=await controller.getAgentRun(result.id);
    }
    if(active())await consumeRun(result,base,submittedBrief,submittedScope,allowDirect,epoch);
  }
  async function recoverRun():Promise<void> {
    if(requestPending.current)return;
    const scope=agentScopeRef.current,base=layoutRef.current,submittedBrief=briefRef.current;
    const marker=markerRef.current;
    if(!marker)return;
    const epoch=++runEpoch.current;requestPending.current=true;setBusy(true);setRecoverable(false);setNotice('');
    try {
      await restoreRunConnection(marker,base);
      if(epoch!==runEpoch.current||scope!==agentScopeRef.current)return;
      const result=marker.runId?await controller.getAgentRun(marker.runId):await controller.getAgentRunByRequest(marker.requestId);
      if(marker.baseKey!==canonical(layoutToBackendScene(base))||marker.briefKey!==submittedBrief){
        if(epoch!==runEpoch.current||scope!==agentScopeRef.current)return;
        setRun(result);setNotice('已查询原任务；场景或需求已变化，旧候选不会应用。');
        if(!['queued','running'].includes(result.state))forgetRun();else setRecoverable(true);
        return;
      }
      await followRun(result,base,submittedBrief,scope,epoch,false);
    } catch(error){if(epoch===runEpoch.current&&scope===agentScopeRef.current){setRecoverable(true);setNotice(error instanceof Error?error.message:'原任务状态暂不可读取，请稍后查询。');}}
    finally{if(epoch===runEpoch.current){requestPending.current=false;setBusy(false);}}
  }
  useEffect(()=>{
    if(preservingPreparation.current)return;
    if(!cloud.user||(!geometryProjectId(controller,scope)&&!isLocalActivityWorkspace(controller))||recoveredScope.current===agentScope)return;
    recoveredScope.current=agentScope;
    try{
      const raw=localStorage.getItem(runStorageKey(agentScope));
      if(!raw)return;
      const marker=JSON.parse(raw) as RunMarker;
      if(typeof marker.requestId!=='string'||typeof marker.baseKey!=='string'||typeof marker.briefKey!=='string'||(marker.runId!==undefined&&typeof marker.runId!=='string')||(marker.projectId!==undefined&&typeof marker.projectId!=='string'))throw new Error('任务记录无法读取，请保留此页面记录并联系管理员核对。');
      markerRef.current=marker;setRecoverable(true);if(briefReady)void recoverRun();else recoveredScope.current='';
    }catch(error){setRecoverable(true);setNotice(error instanceof Error?error.message:'任务记录无法读取。');}
    // Recovery runs once after this project's brief has loaded. Changes do not launch another paid run.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[agentScope,briefReady,cloud.user,cloud.project?.id,scope]);
  async function restoreRunConnection(marker:RunMarker,base:RoomLayout):Promise<void> {
    if(!geometryProjectId(controller,base.id)&&base.id&&isLocalActivityWorkspace(controller)) {
      await controller.resumeGeometryWorkbench(layoutToBackendScene(base),base.name,base.id);
    }
    const projectId=geometryProjectId(controller,base.id);
    if(!projectId||marker.projectId&&marker.projectId!==projectId)throw new Error('原任务的场景连接未能恢复，未重新提交生成。请核对原活动的连接后再查询或取消。');
  }
  async function cancelRun():Promise<void> {
    if(preparation.current){preparation.current.cancelled=true;say('任务已取消，当前方案保持不变。');return;}
    const scope=agentScopeRef.current,marker=markerRef.current;
    if(!marker)return;
    cancelledRequest.current=marker.requestId;
    const epoch=++runEpoch.current;requestPending.current=true;setBusy(true);setPreview(null);setCandidates([]);
    try{
      await restoreRunConnection(marker,layoutRef.current);
      if(scope!==agentScopeRef.current||epoch!==runEpoch.current)return;
      const original=marker.runId?{id:marker.runId}:await controller.getAgentRunByRequest(marker.requestId);
      const result=await controller.cancelAgentRun(original.id);
      if(scope!==agentScopeRef.current||epoch!==runEpoch.current)return;
      setRun(result);forgetRun();say('任务已取消，当前方案保持不变。');
    }catch(error){if(scope===agentScopeRef.current&&epoch===runEpoch.current){setRecoverable(true);setNotice(error instanceof Error?error.message:'取消结果待核对，请查询原任务。');}}
    finally{if(epoch===runEpoch.current){requestPending.current=false;setBusy(false);}}
  }
  async function generate(message?:string,options?:{intent:'model'}):Promise<void> {
    if(requestPending.current||recoverable)return;
    setExpanded(true);setNotice('');
    if(message?.trim())setMessages(items=>[...items.slice(-38),{id:crypto.randomUUID(),role:'user',text:message.trim()}]);
    if(!cloud.configured){
      const text='需求入口已经准备好。当前尚未连接 AI 服务，暂时不能生成真实方案。你可以完善需求、添加现场照片，并使用物料库手动布置。';
      setNotice(text);say(text);return;
    }
    let base=layoutRef.current,submittedScope=agentScopeRef.current;
    let requestedBrief=briefRef.current;
    const epoch=++runEpoch.current;
    requestPending.current=true;setBusy(true);
    let dispatched=false;
    let ownPreparation:typeof preparation.current=null;
    try{
      await assertCurrentLocalRecords(base);
      if(!briefStorage.current.ready)await briefHydration.current;
      if(!alive.current||epoch!==runEpoch.current||submittedScope!==agentScopeRef.current)return;
      if(!briefStorage.current.ready||briefStorage.current.scope!==(base.id??'local'))throw new Error(briefStorage.current.error??'活动需求尚未读取完成，请稍后重试。');
      if(layoutRef.current!==base)throw new Error('生成期间方案或需求已变化，旧提案未应用。请根据最新内容重新生成。');
      requestedBrief=JSON.stringify({brief:briefValueRef.current,images:imageRef.current.map(image=>({id:image.id,kind:image.kind}))});
      if(!cloud.user||cloud.writeBlocked||!geometryProjectId(controller,base.id)){
        const localGeometry=!!base.id&&isLocalActivityWorkspace(controller);
        const pending={layout:base,userId:cloud.user?.id,cancelled:false,projectId:undefined as string|undefined};
        ownPreparation=pending;preparation.current=pending;
        await flushSourceScope(base.id??'local');
        if(!alive.current||pending.cancelled||epoch!==runEpoch.current)return;
        await assertCurrentLocalRecords(layoutRef.current);
        if(layoutRef.current!==base||briefRef.current!==requestedBrief){say('准备期间方案或需求已变化，本次未提交。请按当前内容重新发送。');return;}
        const project=localGeometry
          ?await controller.ensureGeometryWorkbenchReady(layoutToBackendScene(base),base.name,base.id!)
          :await controller.ensureWorkbenchReady(layoutToBackendScene(base),base.name,base.id);
        if(!alive.current||pending.cancelled||epoch!==runEpoch.current)return;
        await assertCurrentLocalRecords(layoutRef.current);
        if(layoutRef.current!==base||briefRef.current!==requestedBrief){say('准备期间方案或需求已变化，本次未提交。请按当前内容重新发送。');return;}
        pending.userId=controller.getSnapshot().user?.id;pending.projectId=project.id;
        let copied:ReferenceImage[]|undefined;
        if(!localGeometry&&base.id!==project.id){
          try{await copySourceScope(base.id??'local',project.id);const sources=await listStoredSources(project.id);copied=sources.map(source=>({...source,url:URL.createObjectURL(source.blob!)}));}
          catch{
            let releaseNotice='';
            const preparedCloud=controller.getSnapshot();
            if(preparedCloud.project?.id===project.id&&preparedCloud.lease?.projectId===project.id&&!preparedCloud.writeBlocked){
              try{await controller.releaseLease();}
              catch{releaseNotice=' 新项目的编辑权未能释放，请在账户与项目中核对。';}
            }
            throw new Error(`云项目已准备好，但活动需求和场地资料未能迁移。原本地草稿与当前输入已保留，请重试后再发送。${releaseNotice}`);
          }
          if(!alive.current||pending.cancelled||layoutRef.current!==base||briefRef.current!==requestedBrief||epoch!==runEpoch.current){for(const image of copied??[])URL.revokeObjectURL(image.url);return;}
          await assertCurrentLocalRecords(layoutRef.current);
          flushSync(()=>{if(copied){for(const image of imageRef.current)URL.revokeObjectURL(image.url);imageRef.current=copied;setImages(copied);}onBindProject?.(project.id);});
        }else flushSync(()=>setBusy(true));
        base=layoutRef.current;submittedScope=agentScopeRef.current;
        if(geometryProjectId(controller,base.id)!==project.id)throw new Error('工作台尚未完成连接，请重试；当前草稿已保留。');
        preparation.current=null;
      }
      const submittedBrief=briefRef.current;
      await assertCurrentLocalRecords(layoutRef.current);
      const submittedBriefValue=briefValueRef.current;
      const modelRequest=options?.intent==='model';
      const modelBrief=[
        '本轮仅处理指定物料，保留当前场景的固定结构、锁定对象和未指定物件；活动需求仅作物料适配背景，不重新规划整场。',
        submittedBriefValue.description.trim()&&`活动背景：${submittedBriefValue.description.trim()}`,
        submittedBriefValue.mustHave.trim()&&`必须保留的要求：${submittedBriefValue.mustHave.trim()}`,
        submittedBriefValue.venueConditions?.trim()&&`已确认现场条件：${submittedBriefValue.venueConditions.trim()}`,
        submittedBriefValue.style?.trim()&&`风格要求：${submittedBriefValue.style.trim()}`,
        submittedBriefValue.palette?.trim()&&`配色要求：${submittedBriefValue.palette.trim()}`,
        submittedBriefValue.atmosphere?.trim()&&`氛围要求：${submittedBriefValue.atmosphere.trim()}`,
      ].filter(Boolean).join('\n');
      const allowDirect=!modelRequest&&directApply;
      const scene=layoutToBackendScene(base),context=buildAgentContext({briefInstruction:modelRequest?modelBrief:message&&!submittedBriefValue.description.trim()?'':briefInstruction(submittedBriefValue,base.width,base.height),message:modelRequest?`仅创建或调整本次请求指定的物料，不重新设计整场。\n${message?.trim()??''}`:message?.trim()||'请按上述需求生成布置方案。',confirmedMaterialDecisions:acceptedDecisions,recentMessages:message?messages.filter(item=>item.id!=='welcome'):[],lastProposalExplanation:message?lastExplanation:''});
      if(context.omittedHistory)say(`已省略 ${context.omittedHistory} 条较早或过长的背景对话；当前需求完整保留。`);
      if(!message)setMessages(items=>[...items.slice(-38),{id:crypto.randomUUID(),role:'user',text:`生成${submittedBriefValue.event}方案：${submittedBriefValue.description.trim()}`}]);
      const remoteProjectId=geometryProjectId(controller,base.id);
      if(!remoteProjectId)throw new Error('当前活动的场景连接已变化，请重新核对后发送。');
      const marker:RunMarker={requestId:crypto.randomUUID(),projectId:remoteProjectId,baseKey:canonical(scene),briefKey:submittedBrief};
      try{rememberRun(marker,submittedScope);}catch{throw new Error('无法保存任务编号，尚未提交。请恢复浏览器本机存储后重试。');}
      requestPending.current=true;setBusy(true);setPreview(null);setCandidates([]);setRun(null);dispatched=true;
      const result=await controller.startAgentRun({requestId:marker.requestId,instruction:context.instruction,context:context.context,scene,selectedIds:[...allSelectedIds].filter(id=>scene.objects.some(object=>object.id===id)),jevEnabled,executionMode:allowDirect?'direct':'preview'});
      if(cancelledRequest.current===marker.requestId){
        if(agentScopeRef.current===submittedScope){
          const cancelled=await controller.cancelAgentRun(result.id);
          if(alive.current&&agentScopeRef.current===submittedScope&&markerRef.current?.requestId===marker.requestId){setRun(cancelled);forgetRun();setBusy(false);requestPending.current=false;say('任务已取消，当前方案保持不变。');}
        }
        return;
      }
      await followRun(result,base,submittedBrief,submittedScope,epoch,allowDirect);
    }catch(error){if(alive.current&&(agentScopeRef.current===submittedScope||preparation.current?.layout===layoutRef.current)&&epoch===runEpoch.current){
      const text=error instanceof Error?error.message:controller.getSnapshot().error?.message??'生成失败，原方案已保留。';setNotice(text);say(text);
      if(dispatched){
        if(error instanceof SceneApiError&&([400,401,403,404,409,422].includes(error.status)||['SERVICE_NOT_CONFIGURED','BILLING_NOT_CONFIGURED','AI_INPUT_TOO_LARGE'].includes(error.code)))forgetRun();
        else setRecoverable(true);
      }
    }}finally{if(preparation.current===ownPreparation)preparation.current=null;if(epoch===runEpoch.current){requestPending.current=false;if(alive.current)setBusy(false);}}
  }
  async function applyCandidate(selected:Preview):Promise<void> {
    if(agentScopeRef.current!==selected.scope)return;
    await assertCurrentLocalRecords(layoutRef.current);
    if ((selected.base.designBook?.variants.length ?? 0) >= MAX_DESIGNS) throw new Error('请先在图层面板移除不再需要的方案，再确认提案。');
    const result=await controller.applySceneProposal(selected.proposal,layoutToBackendScene(layoutRef.current));
    if(!alive.current || agentScopeRef.current!==selected.scope)return;
    await assertCurrentLocalRecords(layoutRef.current);
    if(!result.acceptedLocally || layoutRef.current!==selected.base) throw new Error('应用期间本地有新修改，已保留本地草稿。云端已有新版本，请核对后重新打开。');
    const next=mergeProposalPresentation(selected.base,backendSceneToLayout(result.scene,{projectId:selected.base.id!,name:selected.base.name,...selected.assets}));
    onApply(addDesign(selected.base,next));setPreview(null);setCandidates([]);forgetRun();
    setAcceptedDecisions(items=>[...items,`已应用方案：${selected.proposal.explanation}`.slice(0,1000)].slice(-20));
    if(selected.proposal.warnings.length) setNotice(selected.proposal.warnings.map(warning=>{
      const names=warning.ids.map(id=>next.floors.flatMap(floor=>floor.items).find(item=>item.id===id)?.name??'物件');
      return `${warning.code==='OVERLAP'?'物件重叠':warning.code==='OUT_OF_BOUNDS'?'超出场地边界':'待检查事项'}：${names.join('、')}`;
    }).join('；'));
    say(`${selected.proposal.explanation}\n提案已应用。你可以继续调整，或用撤销返回应用前的本地方案。`,selected.proposal.modelSuggestions,selected.proposal.materialSuggestions);
  }
  async function applyPreview():Promise<void> {
    if(!preview || requestPending.current || busy || stale) return;
    if(Date.parse(preview.proposal.expires_at)<=Date.now()) { setExpired(true); return; }
    const selected=preview,epoch=++runEpoch.current;
    requestPending.current=true;setBusy(true);setNotice('');
    try { await applyCandidate(selected); }
    catch(error) { if(alive.current && agentScopeRef.current===selected.scope)setNotice(error instanceof Error?error.message:'应用失败，原方案已保留。'); }
    finally { if(epoch===runEpoch.current){requestPending.current=false;if(alive.current)setBusy(false);} }
  }
  const checkinView=checkinRecovery.current?{...checkins,ready:false,error:'点验记录回退尚未完成，请先重试恢复或撤销恢复。'}:checkins;
  const value:StudioValue={sourcesRestoring,checkins:checkinView,reviewSource,getReviewSource,prepareReview,scope:agentScope,controller,layout,onApply,onUpdateItem,onUpdateEventOperations,onUpdateProductionPlan,onPreview,updateImage,brief,setBrief,briefReady,briefError,hasSavedBrief,retryBrief,prepareBackup,restoreBackup,undoRestore,backupPending,canUndoRestore,images,addImages,removeImage,busy,preparing:preservingPreparation.current,notice,connection,generate,messages,expanded,setExpanded,preview,stale,expired,directApply,setDirectApply,jevEnabled,setJevEnabled,run,candidates,recoverable,recoverRun,cancelRun,selectCandidate:label=>{const item=candidates.find(value=>value.label===label);if(item&&!stale)setPreview(item.preview);},applyPreview,discardPreview:()=>{setPreview(null);setCandidates([]);forgetRun();}};
  return <StudioContext.Provider value={value}>{children}</StudioContext.Provider>;
}

export function CreativeBriefPanel({ showNotice=true, descriptionRef, referenceOpenRequest=0, referencePanelRef }: { showNotice?: boolean; descriptionRef?: RefObject<HTMLTextAreaElement>; referenceOpenRequest?: number; referencePanelRef?: RefObject<HTMLDivElement> }):JSX.Element {
  const studio=useStudio();
  const update=(patch:Partial<CreativeBrief>)=>studio.setBrief(current=>({...current,...patch}));
  const templateOnly=studio.brief.description.trim()===MANUAL_BRIEF_TEMPLATE.trim();
  const [templateNotice,setTemplateNotice]=useState<{text:string;error:boolean}|null>(null);
  useEffect(()=>setTemplateNotice(null),[studio.scope]);
  function addBriefTemplate():void {
    if(!studio.briefReady||studio.briefError||studio.backupPending)return;
    try{
      const next=appendCreativeBriefTemplate(studio.brief.description);
      if(next===studio.brief.description){setTemplateNotice({text:'当前文字已含提纲，未重复添加。',error:false});return;}
      update({description:next});setTemplateNotice({text:'提纲已加入当前输入，请逐项填写并核对。',error:false});
    }catch(error){setTemplateNotice({text:error instanceof Error?error.message:'提纲未能添加，原文字保持不变。',error:true});}
  }
  // One idea at a time, swapped on demand: three stacked articles were mostly noise.
  const [ideaIndex,setIdeaIndex]=useState(0);
  const idea=IDEA_CARDS[ideaIndex%IDEA_CARDS.length];
  return <fieldset className="cr-brief" disabled={studio.backupPending} style={{border:0,padding:0,minWidth:0}}>
    <div className="sc-section-heading"><div><h2>活动需求</h2></div></div>
    {!studio.briefReady&&!studio.briefError&&<p className="cr-hint" role="status">正在读取活动需求，当前输入会保留。</p>}
    {studio.briefReady&&!studio.hasSavedBrief&&!studio.briefError&&<p className="cr-hint">当前需求尚未保存；默认活动类型和人数仅供参考，请按实际情况填写。</p>}
    {showNotice&&studio.briefError&&<p className="cr-notice" role="alert">{studio.briefError}<button type="button" onClick={studio.retryBrief}>{studio.briefReady?'重试保存需求':'重试读取需求'}</button></p>}
    <label className="cr-label">客户需求<textarea ref={descriptionRef} aria-label="客户需求" maxLength={1800} rows={5} placeholder="描述活动目标、分区与来宾体验……" value={studio.brief.description} onChange={e=>update({description:e.target.value})}/></label>
    <button className="awg-template-button" type="button" disabled={!studio.briefReady||!!studio.briefError||studio.backupPending} onClick={addBriefTemplate}>添加活动简报提纲</button>
    {templateNotice&&<p className={templateNotice.error?'cr-notice':'cr-hint'} role={templateNotice.error?'alert':'status'}>{templateNotice.text}</p>}
    {templateOnly&&<p className="cr-hint">先补充活动目标和参与观众，再生成整场布置方案。</p>}
    <div className="cr-brief-basics">
      <label className="cr-label">活动类型<select value={studio.brief.event} onChange={e=>update({event:e.target.value})}>{['品牌快闪','露营派对','工作坊','小型黑客松','展览市集','婚礼聚会','其他活动'].map(label=><option key={label}>{label}</option>)}</select></label>
      <label className="cr-label">预计人数<input type="number" min={1} max={40} value={studio.brief.guests||''} onChange={e=>update({guests:e.target.valueAsNumber||0})}/></label>
    </div>
    <label className="cr-label">一定要有 <span>选填</span><input maxLength={350} placeholder="帐篷、签到区、无障碍通道……" value={studio.brief.mustHave} onChange={e=>update({mustHave:e.target.value})}/></label>
    <details className="cr-optional"><summary>风格、配色与氛围（可选）</summary>
    <label className="cr-label">风格要求 <span>选填</span><input aria-label="风格要求" maxLength={120} placeholder="自然露营、简约现代、复古市集……" value={studio.brief.style??''} onChange={e=>update({style:e.target.value})}/></label>
    <label className="cr-label">配色要求 <span>选填</span><input aria-label="配色要求" maxLength={120} placeholder="米白与橄榄绿，少量暖橙点缀" value={studio.brief.palette??''} onChange={e=>update({palette:e.target.value})}/></label>
    <label className="cr-label">氛围要求 <span>选填</span><input aria-label="氛围要求" maxLength={120} placeholder="温暖的夜场、明亮交流、安静观展……" value={studio.brief.atmosphere??''} onChange={e=>update({atmosphere:e.target.value})}/></label>
    </details>
    <details className="cr-optional cr-venue-details"><summary>图纸、照片与现场条件（可选）{studio.images.length>0&&<small> · 已添加 {studio.images.length} 张</small>}</summary>
    <fieldset className="cr-floorplan-choice"><legend>平面图</legend><div role="radiogroup" aria-label="是否有平面图">
      <label><input type="radio" name="floorplan-choice" checked={studio.brief.hasFloorplan!==false} onChange={()=>update({hasFloorplan:true})}/>有平面图，上传资料</label>
      <label><input type="radio" name="floorplan-choice" checked={studio.brief.hasFloorplan===false} onChange={()=>update({hasFloorplan:false})}/>没有平面图，选择场地形状</label>
    </div></fieldset>
    {studio.brief.hasFloorplan===false ? <VenueShapePresets layout={studio.layout} onApply={studio.onApply}/> : <VenuePhotosPanel images={studio.images} addImages={studio.addImages} removeImage={studio.removeImage} onKindChange={(id,kind)=>studio.updateImage(id,{kind})}/>}
    {studio.brief.hasFloorplan===false && studio.images.length>0 && <p className="cr-hint">已上传的资料仍保留；生成时会使用这些资料。切回“有平面图”可查看或删除。</p>}
    <label className="cr-label">已确认的现场条件 <span>选填</span><textarea aria-label="已确认的现场条件" maxLength={500} rows={3} placeholder="例如：北侧中间是入口，东侧有两根固定柱；入口前保留通道。请填写你确认的信息。" value={studio.brief.venueConditions??''} onChange={e=>update({venueConditions:e.target.value})}/></label>
    <p className="cr-hint">要求会随方案请求提交。添加图纸或照片后，可结合实测尺寸重建空间；未确认的结构会先请你核对。</p>
    </details>
    <div ref={referencePanelRef} tabIndex={-1} aria-label="图纸与场地对应核对">{studio.sourcesRestoring?<p role="status">正在核实图纸恢复，请完成后继续编辑。</p>:<ReconstructionPanel controller={studio.controller} layout={studio.layout} onApply={studio.onApply} onPreview={studio.onPreview} images={studio.images} updateImage={studio.updateImage} brief={studio.brief} openReferenceRequest={referenceOpenRequest} onAddReferenceImages={files=>studio.addImages(files,'floorplan')}/>}</div>
    <label className="cr-check"><input type="checkbox" checked={studio.brief.allowIdeas} onChange={e=>update({allowIdeas:e.target.checked})}/><span><strong>也给我一些意料之外的灵感</strong><small>可以提出建议，由你确认是否采用</small></span></label>
    <button className="cr-generate" type="button" disabled={studio.busy||studio.recoverable||!studio.brief.description.trim()||templateOnly||!!studio.briefError} onClick={()=>void studio.generate()}>{studio.busy?<Loader2 className="cr-spin" size={18}/>:<Sparkles size={18}/>}<span>{studio.busy?'正在整理方案…':studio.jevEnabled?'生成三个方案':studio.directApply?'生成布置方案':'生成布置预览'}</span></button>
    <p className="cr-hint">根据当前场景与资源库生成布置方案。本轮策划不读取照片；图纸与照片重建需单独确认。</p>

    {showNotice&&studio.notice&&<p className="cr-notice" role="status">{studio.notice}</p>}
    <div className="cr-ideas"><div><h3>布置思路</h3><button type="button" aria-label="换一条布置思路" onClick={()=>setIdeaIndex(current=>(current+1)%IDEA_CARDS.length)}><RefreshCw size={13}/></button></div><article><strong>{idea.title}</strong><p>{idea.text}</p></article></div>
  </fieldset>;
}

function AssistantMascot(): JSX.Element {
  // eslint-disable-next-line @next/next/no-img-element
  return <img className="cr-mascot" src="/assets/assistant/puppy.png" alt="Binggo 小狗" draggable={false} width={30} height={30}/>;
}

export type GeneratedVariant = { sourceAssetId: string; variantAssetId: string; objectIds?: string[] };
export type GenerationContext = { sourceAssetId?: string; sourceObjectIds: string[]; onVariantReady(variant: GeneratedVariant): void };
type ChatMode = 'plan'|'model';
type BusinessMode = ChatMode|'delivery'|'review'|'commercial';
const CHAT_MODES = {plan:'场景策划',model:'物料建模'} as const;
export function CreativeAssistant({ generationPanel, commercialPanel, activityTaskPanel, onOpenTemplates, workspaceOpenRequest = 0, workspaceEntryRef, toolsOpenRequest=0, toolsEntryRef, deliveryOpenRequest = 0, deliveryEntryRef, referenceOpenRequest=0, referenceEntryRef, docked=false, businessHostRef, onConversationVisibilityChange, onWorkspaceVisibilityChange, conversationCloseRequest=0, reviewOpenRequest=0, reviewEntryRef, captureReview, localSaveError=false, conversationOpenRequest=0, conversationEntryRef, assistantEntryHostRef }: {
  onOpenTemplates?:()=>void;
  localSaveError?: boolean|undefined;
  conversationOpenRequest?: number;
  conversationEntryRef?: RefObject<HTMLButtonElement>;
  assistantEntryHostRef?: RefObject<HTMLDivElement>;
  reviewOpenRequest?: number;
  reviewEntryRef?: RefObject<HTMLButtonElement>;
  captureReview?: (snapshot:ProjectReviewSnapshot, options:ProjectReviewCaptureOptions, getSource:()=>ProjectReviewSource)=>Promise<ProjectReviewCapture>;
  generationPanel?: ReactNode | ((context: GenerationContext) => ReactNode);
  commercialPanel?: ReactNode;
  activityTaskPanel?: (context: ActivityTaskPanelContext) => ReactNode;
  workspaceOpenRequest?: number;
  workspaceEntryRef?: RefObject<HTMLButtonElement>;
  toolsOpenRequest?: number;
  toolsEntryRef?: RefObject<HTMLButtonElement>;
  deliveryOpenRequest?: number;
  deliveryEntryRef?: RefObject<HTMLButtonElement>;
  referenceOpenRequest?: number;
  referenceEntryRef?: RefObject<HTMLButtonElement>;
  docked?: boolean;
  businessHostRef?: RefObject<HTMLDivElement>;
  onConversationVisibilityChange?: (open:boolean)=>void;
  onWorkspaceVisibilityChange?: (open:boolean)=>void;
  conversationCloseRequest?: number;
}):JSX.Element {
  const studio=useStudio(); const {setExpanded}=studio; const {selectedItem,allSelectedIds,selectOnly}=useSelection();
  const [drafts,setDrafts]=useState({plan:'',model:''}); const feed=useRef<HTMLDivElement>(null);
  const content=useRef<HTMLDivElement>(null);
  const businessEntry=useRef<HTMLButtonElement|null>(null);
  const conversation=useRef<HTMLElement>(null);
  const chatToggle=useRef<HTMLButtonElement>(null);
  const suggestionsToggle=useRef<HTMLButtonElement>(null),suggestionsCard=useRef<HTMLElement>(null);
  const focusChat=useRef(false);
  const [mode,setMode]=useState<ChatMode>('plan');
  const [businessMode,setBusinessMode]=useState<BusinessMode>('plan');
  const [planCategory,setPlanCategory]=useState<'brief'|'reference'>('brief');
  const [suggestionsOpen,setSuggestionsOpen]=useState(false);
  const [suggestionsDismissed,setSuggestionsDismissed]=useState(false);
  const [localReferenceRequest,setLocalReferenceRequest]=useState(0);
  const latestScopeRef=useRef(studio.scope);latestScopeRef.current=studio.scope;
  const lastResetScopeRef=useRef<string|null>(null);
  const afterRestoreScopeRef=useRef<string|null>(null);
  const [templatesOpen,setTemplatesOpen]=useState(false);
  const [workspaceExpanded,setWorkspaceExpanded]=useState(false);
  const [businessOpened,setBusinessOpened]=useState(false);
  const [chatCollapsed,setChatCollapsed]=useState(false);
  const chatHidden=docked?!studio.expanded:workspaceExpanded&&chatCollapsed;
  const [businessHost,setBusinessHost]=useState<HTMLDivElement|null>(businessHostRef?.current??null);
  const [assistantEntryHost,setAssistantEntryHost]=useState<HTMLDivElement|null>(assistantEntryHostRef?.current??null);
  const dockingInitialized=useRef(false);
  const handledConversationClose=useRef(0),handledConversationOpen=useRef(0);
  const returnConversationFocus=useRef(false),currentExpanded=useRef(studio.expanded);currentExpanded.current=studio.expanded;
  const closeFocusOrigin=useRef<Element|null>(null);
  const closeChat=useCallback(()=>{returnConversationFocus.current=true;closeFocusOrigin.current=document.activeElement;setExpanded(false);},[setExpanded]);
  const mobile=()=>typeof window!=='undefined'&&(window.matchMedia?window.matchMedia('(max-width:680px)').matches:window.innerWidth<=680);
  const narrow=()=>typeof window!=='undefined'&&window.innerWidth<=1080;
  useLayoutEffect(()=>{if(docked&&businessHostRef?.current)setBusinessHost(businessHostRef.current);},[docked,businessHostRef]);
  useLayoutEffect(()=>{if(docked&&assistantEntryHostRef?.current)setAssistantEntryHost(assistantEntryHostRef.current);},[docked,assistantEntryHostRef]);
  useEffect(()=>{if(!docked||dockingInitialized.current)return;dockingInitialized.current=true;setOpened(true);setExpanded(!mobile());},[docked,setExpanded]);
  useEffect(()=>{if(docked)onConversationVisibilityChange?.(studio.expanded);},[docked,studio.expanded,onConversationVisibilityChange]);
  useEffect(()=>{if(docked)onWorkspaceVisibilityChange?.(workspaceExpanded);},[docked,workspaceExpanded,onWorkspaceVisibilityChange]);
  useEffect(()=>{if(conversationCloseRequest===handledConversationClose.current)return;handledConversationClose.current=conversationCloseRequest;closeChat();},[conversationCloseRequest,closeChat]);
  useEffect(()=>{
    if(studio.expanded||!returnConversationFocus.current||!conversationEntryRef?.current)return undefined;
    returnConversationFocus.current=false;const entry=conversationEntryRef.current,origin=closeFocusOrigin.current;
    let cancelled=false;
    const canReturnFocus=()=>{
      if(cancelled||currentExpanded.current||!entry.isConnected)return false;
      const active=document.activeElement;
      return !active||active===document.body||active===origin||active===entry||active.getClientRects().length===0||getComputedStyle(active).visibility==='hidden';
    };
    if(typeof requestAnimationFrame!=='function'){
      queueMicrotask(()=>{if(canReturnFocus())entry.focus();});
      return()=>{cancelled=true;};
    }
    let frame:number,attempts=0;
    const focusWhenVisible=():void=>{
      if(!canReturnFocus())return;
      attempts++;
      if(entry.getClientRects().length>0&&getComputedStyle(entry).visibility!=='hidden'){
        entry.focus();if(document.activeElement===entry)return;
      }
      if(attempts<8)frame=requestAnimationFrame(focusWhenVisible);
    };
    frame=requestAnimationFrame(focusWhenVisible);
    return()=>{cancelled=true;cancelAnimationFrame(frame);};
  },[studio.expanded,conversationEntryRef,conversationCloseRequest,toolsOpenRequest]);
  const workspaceScroll=useRef<Partial<Record<'floating'|'expanded',{content:number;conversation:number}>>>({});
  const pendingWorkspaceScroll=useRef<{content:number;conversation:number}>();
  const [opened,setOpened]=useState(false);
  const [modelOpened,setModelOpened]=useState(false);
  const [deliveryOpened,setDeliveryOpened]=useState(false);
  const [deliveryViewRequest,setDeliveryViewRequest]=useState<{serial:number;view:'operations'|'materials'}>();
  const deliveryViewSerial=useRef(0);
  const [reviewOpened,setReviewOpened]=useState(false);
  const reviewTarget=useRef<HTMLDivElement>(null),focusReview=useRef(false),handledReview=useRef(0);
  const [commercialOpened,setCommercialOpened]=useState(false);
  const commercialTarget=useRef<HTMLDivElement>(null),focusCommercial=useRef(false);
  const [modelTool,setModelTool]=useState<'generate'|'customize'>('generate');
  const [materialSeed,setMaterialSeed]=useState<MaterialCustomizationSeed>();
  useEffect(()=>{if(studio.expanded)setOpened(true);},[studio.expanded]);
  useLayoutEffect(()=>{
    if(pendingWorkspaceScroll.current){
      if(content.current)content.current.scrollTop=pendingWorkspaceScroll.current.content;
      if(feed.current)feed.current.scrollTop=pendingWorkspaceScroll.current.conversation;
    }
    pendingWorkspaceScroll.current=undefined;
  },[workspaceExpanded]);
  useLayoutEffect(()=>{
    if(!focusChat.current||chatHidden)return;
    focusChat.current=false;
    if((docked||!templatesOpen)&&(mode==='plan'||mode==='model'))messageInput.current?.focus();
    else conversation.current?.focus();
  },[chatHidden,mode,templatesOpen,studio.expanded]);
  const messageInput=useRef<HTMLTextAreaElement>(null);
  const settings=useRef<HTMLDetailsElement>(null),settingsToggle=useRef<HTMLElement>(null);
  useEffect(()=>{if((!studio.expanded||chatHidden)&&settings.current)settings.current.open=false;},[studio.expanded,chatHidden]);
  const fallbackEntry=useRef<HTMLButtonElement>(null);
  const deliveryFocusTarget=useRef<HTMLDivElement>(null);
  const briefDetails=useRef<HTMLDetailsElement>(null);
  const briefDescription=useRef<HTMLTextAreaElement>(null);
  const referencePanel=useRef<HTMLDivElement>(null);
  const focusReference=useRef(false), returnToReferenceEntry=useRef(false), handledReferenceRequest=useRef(0);
  const focusBrief=useRef(false);
  const focusDelivery=useRef(false);
  const focusWorkspace=useRef(false);
  const returnToDeliveryEntry=useRef(false);
  const returnToWorkspaceEntry=useRef(false);
  const handledWorkspaceRequest=useRef(0);
  const handledToolsRequest=useRef(0);
  const handledDeliveryRequest=useRef(0);
  const wasExpanded=useRef(false);
  const preparingScope=useRef(studio.preparing);preparingScope.current=studio.preparing;
  useEffect(()=>{
    if(reviewOpenRequest===handledReview.current)return;handledReview.current=reviewOpenRequest;
    businessEntry.current=reviewEntryRef?.current??null;openReview();
  },[reviewOpenRequest]);
  useEffect(()=>{if(focusReview.current&&businessMode==='review'&&(docked?workspaceExpanded:studio.expanded)&&(!docked||businessHost)){focusReview.current=false;reviewTarget.current?.focus();}},[businessMode,workspaceExpanded,studio.expanded,businessHost,docked]);
  useEffect(()=>{
    if(preparingScope.current)return;
    const restored=afterRestoreScopeRef.current===studio.scope;
    afterRestoreScopeRef.current=null;lastResetScopeRef.current=studio.scope;
    setDrafts({plan:'',model:''});setMaterialSeed(undefined);setModelTool('generate');
    setMode('plan');setBusinessMode(restored?'delivery':'plan');setPlanCategory('brief');setSuggestionsOpen(false);setSuggestionsDismissed(false);setDeliveryViewRequest(undefined);if(restored)setDeliveryOpened(true);setTemplatesOpen(false);
  },[studio.scope]);
  useEffect(()=>{
    if(workspaceOpenRequest===handledWorkspaceRequest.current)return;
    handledWorkspaceRequest.current=workspaceOpenRequest;
    businessEntry.current=workspaceEntryRef?.current??null;
    returnToWorkspaceEntry.current=true;returnToDeliveryEntry.current=false;returnToReferenceEntry.current=false;
    focusBrief.current=false;focusReference.current=false;focusDelivery.current=false;focusReview.current=false;focusCommercial.current=false;focusWorkspace.current=false;
    if(!businessOpened){setBusinessMode('plan');setPlanCategory('brief');setTemplatesOpen(false);focusBrief.current=true;}
    else if(templatesOpen||businessMode==='model')focusWorkspace.current=true;
    else if(businessMode==='review')focusReview.current=true;
    else if(businessMode==='delivery')focusDelivery.current=true;
    else if(businessMode==='commercial')focusCommercial.current=true;
    else if(planCategory==='reference')focusReference.current=true;
    else focusBrief.current=true;
    resizeWorkspace(true);if(!docked)setExpanded(true);
  },[workspaceOpenRequest,setExpanded]);
  useEffect(()=>{
    if(referenceOpenRequest===handledReferenceRequest.current)return;
    handledReferenceRequest.current=referenceOpenRequest;focusReference.current=true;
    businessEntry.current=referenceEntryRef?.current??null;
    focusBrief.current=false;focusDelivery.current=false;returnToReferenceEntry.current=true;
    setBusinessMode('plan');setPlanCategory('reference');setTemplatesOpen(false);resizeWorkspace(true);if(!docked)setExpanded(true);
  },[referenceOpenRequest,setExpanded]);
  useEffect(()=>{
    if(deliveryOpenRequest===handledDeliveryRequest.current)return;
    handledDeliveryRequest.current=deliveryOpenRequest;
    businessEntry.current=deliveryEntryRef?.current??null;
    returnToDeliveryEntry.current=true;returnToWorkspaceEntry.current=false;returnToReferenceEntry.current=false;
    focusDelivery.current=true;
    setDeliveryOpened(true);setBusinessMode('delivery');setTemplatesOpen(false);if(docked)resizeWorkspace(true);else setExpanded(true);
  },[deliveryOpenRequest,setExpanded]);
  useEffect(()=>{
    const businessVisible=docked?workspaceExpanded:studio.expanded;
    if(businessVisible && !templatesOpen && businessMode==='plan' && focusReference.current){
      focusReference.current=false;if(briefDetails.current)briefDetails.current.open=true;
      referencePanel.current?.focus();referencePanel.current?.scrollIntoView?.({block:'nearest'});
    }else if(businessVisible && !templatesOpen && businessMode==='plan' && focusBrief.current){
      focusBrief.current=false;
      if(briefDetails.current)briefDetails.current.open=true;
      briefDescription.current?.focus();
    }else if(businessVisible && !templatesOpen && businessMode==='delivery' && (focusDelivery.current||!docked&&!wasExpanded.current)){
      focusDelivery.current=false;deliveryFocusTarget.current?.focus();
    }else if(businessVisible && !templatesOpen && businessMode==='review' && focusReview.current){
      focusReview.current=false;reviewTarget.current?.focus();
    }else if(businessVisible && !templatesOpen && businessMode==='commercial' && focusCommercial.current && (!docked||businessHost)){
      focusCommercial.current=false;commercialTarget.current?.focus();
    }else if(businessVisible && focusWorkspace.current && (!docked||businessHost)){
      focusWorkspace.current=false;content.current?.focus();
    }else if(!docked&&studio.expanded && !wasExpanded.current && chatHidden) chatToggle.current?.focus();
    else if(!docked&&studio.expanded && !wasExpanded.current && !templatesOpen && (mode==='plan'||mode==='model'&&modelTool==='generate')) (chatHidden?chatToggle.current:messageInput.current)?.focus();
    else if(!studio.expanded&&wasExpanded.current&&!conversationEntryRef) (returnToReferenceEntry.current ? referenceEntryRef?.current ?? workspaceEntryRef?.current ?? fallbackEntry.current : returnToWorkspaceEntry.current ? workspaceEntryRef?.current ?? fallbackEntry.current : returnToDeliveryEntry.current ? deliveryEntryRef?.current ?? fallbackEntry.current : fallbackEntry.current)?.focus();
    wasExpanded.current=studio.expanded;
  },[studio.expanded,workspaceExpanded,businessHost,mode,businessMode,planCategory,modelTool,templatesOpen,chatHidden,workspaceOpenRequest,workspaceEntryRef,deliveryOpenRequest,deliveryEntryRef,referenceOpenRequest,localReferenceRequest,referenceEntryRef,conversationEntryRef]);
  useEffect(()=>{feed.current?.scrollTo({top:feed.current.scrollHeight,behavior:'smooth'});},[studio.messages,studio.busy]);
  const sceneItems=studio.layout.floors.flatMap(floor=>floor.items);
  const selectedItems=sceneItems.filter(item=>allSelectedIds.has(item.id));
  const selectedCount=selectedItems.length;
  const operationScope=mode==='model'?selectedCount?`选中 ${selectedCount} 件`:'单件物料':selectedCount?`场景策划 · 选中 ${selectedCount} 件`:'场景策划 · 整个场景';
  const sourceAssetId=selectedItems.length&&selectedItems.every(item=>item.assetId&&item.assetId===selectedItems[0]!.assetId&&!item.locked)?selectedItems[0]!.assetId:undefined;
  function previewMaterial(input: Omit<MaterialCustomizationSeed,'id'|'scope'|'userId'|'projectId'|'apiUrl'>):void {
    const cloud=studio.controller.getSnapshot();
    if(!cloud.user||!cloud.project||geometryProjectId(studio.controller,studio.layout.id)!==cloud.project.id)return;
    setMaterialSeed({...input,id:crypto.randomUUID(),scope:studio.scope,userId:cloud.user.id,projectId:cloud.project.id,apiUrl:studio.controller.config.apiUrl});
    setModelTool('customize');setModelOpened(true);setMode('model');setBusinessMode('model');setTemplatesOpen(false);
    if(docked)resizeWorkspace(true);
  }
  const generationContext:GenerationContext={...(sourceAssetId?{sourceAssetId}:{}),sourceObjectIds:sourceAssetId?selectedItems.map(item=>item.id):[],onVariantReady:variant=>previewMaterial({...variant,objectIds:variant.objectIds??[],name:'纹理新版本',reason:'核对纹理与原模型后，仅替换指定物件。',materialScope:'all_materials'})};
  function applyMaterial(next:RoomLayout):void {
    const changed=next.floors.flatMap(floor=>floor.items).filter(item=>item.assetId&&sceneItems.some(previous=>previous.id===item.id&&previous.assetId!==item.assetId));
    studio.onApply(next);
    if(changed.length&&changed.every(item=>item.assetId===changed[0]!.assetId))previewMaterial({sourceAssetId:changed[0]!.assetId!,objectIds:changed.map(item=>item.id),name:'已更新的物料',reason:'可继续调整或预览恢复父版本。',materialScope:'all_materials'});
    else setMaterialSeed(undefined);
  }
  const draftMode=mode==='model'?'model':'plan';
  const draft=drafts[draftMode];
  const setDraft=(value:string)=>setDrafts(current=>({...current,[draftMode]:value}));
  const submit=()=>{if(!draft.trim()||studio.busy||studio.recoverable)return;const text=draft;setDraft('');setSuggestionsOpen(false);void studio.generate(text,mode==='model'?{intent:'model'}:undefined);};
  const summary=studio.preview?proposalSummary(studio.preview.base,studio.preview.layout):null;
  const differences=studio.preview?proposalDifferences(studio.preview.base,studio.preview.layout):[];
  const chatPending=studio.busy?studio.run?.progress||'正在提交任务…':studio.recoverable?'原任务结果待核对':studio.preview||studio.candidates.length>0?studio.stale?'候选需重新生成':'有方案待确认':studio.notice?'有助手提示待查看':'';
  function resizeWorkspace(next:boolean):void {
    const current={content:content.current?.scrollTop??0,conversation:feed.current?.scrollTop??0};
    workspaceScroll.current[workspaceExpanded?'expanded':'floating']=current;
    pendingWorkspaceScroll.current=workspaceScroll.current[next?'expanded':'floating']??current;
    if(next&&chatCollapsed&&conversation.current?.contains(document.activeElement))setChatCollapsed(false);
    setWorkspaceExpanded(next);
    if(next)setBusinessOpened(true);
    if(docked){
      onWorkspaceVisibilityChange?.(next);if(next&&narrow())setExpanded(false);
      if(!next&&content.current?.contains(document.activeElement))queueMicrotask(()=>{
        const clicked=businessEntry.current;
        const entry=clicked?.isConnected&&!clicked.closest('[hidden]')?clicked:returnToReferenceEntry.current?referenceEntryRef?.current:returnToDeliveryEntry.current?deliveryEntryRef?.current:workspaceEntryRef?.current;
        (entry??(studio.expanded?messageInput.current:(conversationEntryRef?.current??fallbackEntry.current)))?.focus();
      });
    }
  }
  function openTools():void {
    returnConversationFocus.current=false;businessEntry.current=toolsEntryRef?.current??null;
    focusBrief.current=false;focusReference.current=false;focusDelivery.current=false;focusReview.current=false;focusCommercial.current=false;focusWorkspace.current=false;
    resizeWorkspace(false);if(docked&&narrow())setExpanded(false);
  }
  const openToolsRef=useRef(openTools);openToolsRef.current=openTools;
  useEffect(()=>{
    if(toolsOpenRequest===handledToolsRequest.current)return;handledToolsRequest.current=toolsOpenRequest;
    openToolsRef.current();
  },[toolsOpenRequest]);
  function openChat():void {
    if(docked){if(narrow())resizeWorkspace(false);if(studio.expanded)queueMicrotask(()=>messageInput.current?.focus());else{focusChat.current=true;setExpanded(true);}return;}
    if(!studio.expanded){focusChat.current=true;setExpanded(true);return;}
    if(chatHidden){focusChat.current=true;setChatCollapsed(false);}
    else messageInput.current?.focus();
  }
  const openChatRef=useRef(openChat);openChatRef.current=openChat;
  useEffect(()=>{
    if(conversationOpenRequest===handledConversationOpen.current)return;handledConversationOpen.current=conversationOpenRequest;
    returnToDeliveryEntry.current=false;returnToWorkspaceEntry.current=false;returnToReferenceEntry.current=false;
    openChatRef.current();
  },[conversationOpenRequest]);
  function toggleChat():void {
    if(docked){if(studio.expanded)closeChat();else openChat();return;}
    if(!workspaceExpanded)return;
    if(chatHidden)openChat();
    else{
      if(conversation.current?.contains(document.activeElement))chatToggle.current?.focus();
      setChatCollapsed(true);
    }
  }
  function finishBackupNavigation():void {
    const scope=latestScopeRef.current;
    afterRestoreScopeRef.current=lastResetScopeRef.current===scope?null:scope;
    focusDelivery.current=docked;focusBrief.current=false;
    setDeliveryOpened(true);setBusinessMode('delivery');setTemplatesOpen(false);
    if(docked){resizeWorkspace(true);queueMicrotask(()=>deliveryFocusTarget.current?.focus());}
  }
  function openBrief(event?:React.MouseEvent<HTMLButtonElement>):void {
    if(event)businessEntry.current=event.currentTarget;
    setPlanCategory('brief');focusReference.current=false;focusDelivery.current=false;focusReview.current=false;
    if(docked){focusBrief.current=true;returnToWorkspaceEntry.current=true;returnToReferenceEntry.current=false;returnToDeliveryEntry.current=false;setBusinessMode('plan');setTemplatesOpen(false);resizeWorkspace(true);queueMicrotask(()=>briefDescription.current?.focus());return;}
    if(studio.expanded&&businessMode==='plan'&&!templatesOpen){
      if(briefDetails.current)briefDetails.current.open=true;
      briefDescription.current?.focus();
    }else{
      focusBrief.current=true;setBusinessMode('plan');setTemplatesOpen(false);setExpanded(true);
    }
  }
  function openReference(event?:React.MouseEvent<HTMLButtonElement>):void{if(event)businessEntry.current=event.currentTarget;focusReference.current=true;focusBrief.current=false;focusDelivery.current=false;returnToReferenceEntry.current=true;returnToWorkspaceEntry.current=false;returnToDeliveryEntry.current=false;setBusinessMode('plan');setPlanCategory('reference');setTemplatesOpen(false);setLocalReferenceRequest(value=>value+1);resizeWorkspace(true);if(!docked)setExpanded(true);}
  function openDelivery(event?:React.MouseEvent<HTMLButtonElement>):void{if(event)businessEntry.current=event.currentTarget;focusDelivery.current=true;returnToDeliveryEntry.current=true;returnToWorkspaceEntry.current=false;returnToReferenceEntry.current=false;setDeliveryOpened(true);setBusinessMode('delivery');setTemplatesOpen(false);resizeWorkspace(true);if(!docked)setExpanded(true);queueMicrotask(()=>deliveryFocusTarget.current?.focus());}
  function openDeliveryView(view:'operations'|'materials',event:React.MouseEvent<HTMLButtonElement>):void {
    setDeliveryViewRequest({serial:++deliveryViewSerial.current,view});openDelivery(event);
  }
  function openModelTools(event?:React.MouseEvent<HTMLButtonElement>):void{if(event)businessEntry.current=event.currentTarget;setBusinessMode('model');setModelOpened(true);setTemplatesOpen(false);resizeWorkspace(true);}
  function chooseModelExample(label:string,prompt:string):void {
    if(drafts.model.trim()&&drafts.model!==prompt&&!window.confirm(`是否用“${label}”示例替换当前建模输入？`))return;
    setMode('model');setDrafts(current=>({...current,model:prompt}));openChat();
  }
  function openReview(event?:React.MouseEvent<HTMLButtonElement>):void {
    if(event)businessEntry.current=event.currentTarget;focusBrief.current=false;focusReference.current=false;focusDelivery.current=false;
    returnToWorkspaceEntry.current=false;returnToReferenceEntry.current=false;returnToDeliveryEntry.current=false;
    focusReview.current=true;setReviewOpened(true);setBusinessMode('review');setTemplatesOpen(false);resizeWorkspace(true);if(!docked)setExpanded(true);
  }
  function openTemplates():void {
    if(onOpenTemplates){resizeWorkspace(false);onOpenTemplates();return;}
    setTemplatesOpen(true);resizeWorkspace(true);
  }
  function openCommercial():void {
    if(commercialPanel==null)return;
    focusBrief.current=false;focusReference.current=false;focusDelivery.current=false;focusReview.current=false;
    focusCommercial.current=true;setCommercialOpened(true);setBusinessMode('commercial');setTemplatesOpen(false);resizeWorkspace(true);if(!docked)setExpanded(true);
  }
  const businessCategory=templatesOpen?'templates':businessMode==='plan'?planCategory:businessMode;
  function selectBusinessCategory(event:React.ChangeEvent<HTMLSelectElement>):void {
    if(!businessEntry.current)businessEntry.current=workspaceEntryRef?.current??referenceEntryRef?.current??deliveryEntryRef?.current??(conversationEntryRef?.current??fallbackEntry.current);
    switch(event.target.value){
      case 'brief':openBrief();break;
      case 'reference':openReference();break;
      case 'delivery':openDelivery();break;
      case 'review':openReview();break;
      case 'templates':openTemplates();break;
      case 'model':openModelTools();break;
      case 'commercial':openCommercial();break;
    }
  }
  const hasConversation=studio.messages.some(message=>message.id!=='welcome');
  const assistantLauncher=!studio.expanded?<button ref={fallbackEntry} aria-controls="creative-assistant" className="cr-assistant-capsule" type="button" onClick={()=>{returnToDeliveryEntry.current=false;returnToWorkspaceEntry.current=false;returnToReferenceEntry.current=false;openChat();}} aria-expanded={false} aria-label="打开 Binggo Agent"><span className="cr-assistant-capsule-avatar" aria-hidden="true"><AssistantMascot/></span><span>Binggo</span></button>:null;
  const suggestionsVisible=!suggestionsDismissed&&(!hasConversation||suggestionsOpen);
  const hasBrief=studio.briefReady&&!studio.briefError&&studio.hasSavedBrief&&!!studio.brief.description.trim();
  const resultSuggestions:Array<{label:string;open:(event:React.MouseEvent<HTMLButtonElement>)=>void}>=[];
  if(!hasBrief)resultSuggestions.push({label:'完善活动需求',open:openBrief});
  if(!studio.images.some(image=>image.kind==='floorplan'))resultSuggestions.push({label:'准备场地图纸',open:openReference});
  if(studio.layout.eventOperations?.tasks.length)resultSuggestions.push({label:'整理执行时间表',open:event=>openDeliveryView('operations',event)});
  if(sceneItems.length)resultSuggestions.push({label:'核对物料交接',open:event=>openDeliveryView('materials',event)});
  if(hasBrief)resultSuggestions.push({label:'准备客户方案',open:openReview});
  function renderMessage(m:Message):JSX.Element {return <div key={m.id} className={`cr-message is-${m.role}`}>{m.role==='assistant'&&<span className="cr-message-avatar" aria-hidden="true"><AssistantMascot/></span>}<div className="cr-message-body"><span className="sr-only">{m.role==='assistant'?'Binggo':'你'}</span><p>{m.text}</p>{m.modelSuggestions?.map((suggestion,index)=><article className="cr-model-suggestion" key={`${m.id}-${index}`}><strong>{suggestion.name}</strong><p>{suggestion.reason}</p><p>{suggestion.prompt}</p><small>可继续描述尺寸，让 DeepSeek 查找资源或使用参数化建模；不支持的造型会明确说明。</small></article>)}{m.materialSuggestions?.map((suggestion,index)=><article className="cr-model-suggestion" key={`${m.id}-material-${index}`}><strong>{suggestion.name}</strong><p>{suggestion.reason}</p><button type="button" onClick={()=>{const {scope:materialScope,...input}=suggestion;previewMaterial({...input,materialScope});}}>预览材质调整</button><small>仅调整指定的 {suggestion.objectIds.length} 件物料；原版本保留，确认后应用。</small></article>)}</div></div>;}
  const businessContent=(
      <div id="creative-business" tabIndex={-1} className={`cr-workspace-content ${docked?'cr-business-content':''}`} hidden={docked&&!workspaceExpanded} ref={content} onKeyDown={event=>{if(docked&&event.key==='Escape'&&!event.defaultPrevented){event.stopPropagation();const clicked=businessEntry.current;resizeWorkspace(false);if(clicked?.isConnected&&clicked.closest('[hidden]')&&!content.current?.contains(clicked)){setExpanded(true);queueMicrotask(()=>clicked.focus());}}}}>
        <header className="cr-business-heading"><label className="cr-business-category">资料分类<select value={businessCategory} onChange={selectBusinessCategory}><option value="brief">活动需求</option><option value="reference">图纸与尺寸</option><option value="delivery">执行资料</option><option value="review">方案评审</option><option value="templates">场景模板</option><option value="model">物料工具</option>{commercialPanel!=null&&<option value="commercial">合同与约定</option>}</select></label>{!onOpenTemplates&&<div>{docked&&templatesOpen&&<button type="button" onClick={()=>setTemplatesOpen(false)}>返回当前工作区</button>}{docked&&<button type="button" onClick={()=>resizeWorkspace(false)}><ArrowLeft size={14}/>返回素材</button>}</div>}</header>
        {studio.briefError&&<p className="cr-agent-notice" role="alert">{studio.briefError}<button type="button" onClick={studio.retryBrief}>{studio.briefReady?'重试保存需求':'重试读取需求'}</button></p>}
        <div hidden={templatesOpen||businessMode==='model'||businessMode==='review'||businessMode==='commercial'}><ActivityWorkflowGuide layout={studio.layout} briefState={{brief:studio.brief,ready:studio.briefReady,error:studio.briefError,hasSavedBrief:studio.hasSavedBrief}} onOpenBrief={openBrief}/></div>
        <section id="agent-panel-plan" aria-label="场景策划" hidden={businessMode!=='plan'||templatesOpen}><details ref={briefDetails} className="cr-agent-brief" open><summary>活动需求与场地资料</summary><CreativeBriefPanel showNotice={false} descriptionRef={briefDescription} referenceOpenRequest={referenceOpenRequest+localReferenceRequest} referencePanelRef={referencePanel}/></details></section>
        <section id="agent-panel-model" aria-label="物料建模" hidden={businessMode!=='model'||templatesOpen}>
          <nav className="cr-model-tools" aria-label="3D 内容工具">{([['generate','物料建模'],['customize','材质调整']] as const).map(([key,label])=><button type="button" key={key} aria-pressed={modelTool===key} onClick={()=>setModelTool(key)}>{label}</button>)}</nav>
          <div hidden={modelTool!=='generate'}><p className="sc-note">选择物料类型，在聊天中填写尺寸与样式，发送后核对候选方案。</p><div className="cr-parametric-families">{[['桌','生成一张长 1.6 米、宽 0.8 米、高 0.75 米的矩形桌，先给预览'],['椅','生成一把有靠背的椅子，座面宽 0.5 米，先给预览'],['柜台','生成一个长 2 米、深 0.6 米、高 1 米的直柜台，先给预览'],['地台','生成一个长 3 米、宽 2 米、高 0.3 米的矩形地台，先给预览'],['背景板','生成一块宽 3 米、高 2.4 米并带底座的背景板，先给预览'],['柜体','生成一个宽 1.2 米、深 0.4 米、高 1.8 米的开放柜体，分 4 层，先给预览']].map(([label,prompt])=><button type="button" key={label} onClick={()=>chooseModelExample(label!,prompt!)}>{label}</button>)}</div>{modelOpened&&((typeof generationPanel==='function'?generationPanel(generationContext):generationPanel)??<p className="sc-note">登录并打开云项目后可查看历史模型。</p>)}</div>
          {modelOpened&&<div hidden={modelTool!=='customize'}>{materialSeed?.scope===studio.scope&&<button type="button" className="sc-button" onClick={()=>setMaterialSeed(undefined)}>使用当前选中物件</button>}<MaterialCustomization controller={studio.controller} layout={studio.layout} onApply={applyMaterial} seed={materialSeed?.scope===studio.scope?materialSeed:undefined} active={(docked?workspaceExpanded:studio.expanded)&&!templatesOpen&&businessMode==='model'&&modelTool==='customize'}/></div>}
        </section>
        <section id="agent-panel-delivery" aria-label="执行交付" hidden={businessMode!=='delivery'||templatesOpen}>{deliveryOpened&&<div ref={deliveryFocusTarget} tabIndex={-1} role="group" aria-label="执行工作单"><SceneDeliveryPanel activityTaskPanel={activityTaskPanel?.({layout:studio.layout,disabled:studio.busy||studio.backupPending,checkins:studio.checkins,briefState:{brief:studio.brief,ready:studio.briefReady,error:studio.briefError,hasSavedBrief:studio.hasSavedBrief}})} deliveryViewRequest={deliveryViewRequest} layout={studio.layout} controller={studio.controller} checkins={studio.checkins} onLocate={selectOnly} onUpdateItem={studio.onUpdateItem} onUpdateEventOperations={studio.onUpdateEventOperations} onUpdateProductionPlan={studio.onUpdateProductionPlan} backupActions={studio} briefState={{brief:studio.brief,ready:studio.briefReady,error:studio.briefError,hasSavedBrief:studio.hasSavedBrief}} onOpenBrief={openBrief} onBackupRestored={finishBackupNavigation}/></div>}</section>
        <section id="agent-panel-review" aria-label="方案评审" hidden={businessMode!=='review'||templatesOpen}>{reviewOpened&&<div ref={reviewTarget} tabIndex={-1} role="group" aria-label="当前方案评审"><ProjectReviewPanel storageIdentity={JSON.stringify([studio.controller.config.apiUrl,studio.controller.getSnapshot().user?.id??null,studio.reviewSource.scope])} source={studio.reviewSource} actions={{getSource:studio.getReviewSource,prepare:studio.prepareReview,...(captureReview?{capture:(snapshot,options)=>{if(studio.preview||studio.busy)throw new Error('请先结束候选预览或当前任务，再捕获画面。');return captureReview(snapshot,options,studio.getReviewSource);}}:{})}} inputLocked={studio.backupPending} disabled={studio.busy||!studio.briefReady||!!studio.briefError}/></div>}</section>
        {commercialPanel!=null&&<section id="agent-panel-commercial" aria-label="合同与约定" hidden={businessMode!=='commercial'||templatesOpen}>{commercialOpened&&<div ref={commercialTarget} tabIndex={-1} role="group" aria-label="合同与约定资料">{commercialPanel}</div>}</section>}
        {!onOpenTemplates&&<section aria-label="场景模板资源" hidden={!templatesOpen}>{templatesOpen&&<ScenePresetsPanel layout={studio.layout} onApply={studio.onApply}/>}</section>}
        <p className="cr-selection-context" hidden={businessMode==='commercial'}>当前场景：{sceneItems.length} 件物料 · 已选中 {selectedCount} 件{selectedItem?` · ${selectedItem.name}`:''}</p>
      </div>
  );
  return <div className={`cr-assistant ${docked?'is-docked':''} ${studio.expanded?'is-open':''} ${!docked&&studio.expanded&&workspaceExpanded?'is-workspace-expanded':''} ${selectedItem?'has-properties':''}`}>
    {docked&&businessOpened&&businessHost&&createPortal(businessContent,businessHost,'creative-business')}
    {(docked||opened||studio.expanded)&&<section hidden={!studio.expanded} id="creative-assistant" className={`cr-chat ${!docked&&workspaceExpanded?'is-expanded':''}`} aria-label="Agent" onKeyDown={event=>{if(event.key==='Escape'&&!event.defaultPrevented){event.stopPropagation();closeChat();}}}>
      <header><div className="cr-header-brand"><div><strong>Binggo</strong><small title={localSaveError?undefined:studio.layout.name} role={localSaveError?'alert':undefined}>{localSaveError?'本机保存失败，请导出备份':`${operationScope} · ${studio.layout.name}`}</small></div></div><div className="cr-chat-header-actions"><button type="button" aria-label={docked?'收起聊天':'收起 Agent'} onClick={closeChat}><X size={18}/></button></div></header>
      {!docked&&<div className="cr-workspace-tools">{templatesOpen&&<button type="button" onClick={()=>setTemplatesOpen(false)}><ArrowLeft size={14}/>返回当前工作区</button>}<button className="cr-workspace-toggle" type="button" aria-pressed={workspaceExpanded} onMouseDown={event=>{if(event.button===0)event.preventDefault();}} onClick={()=>resizeWorkspace(!workspaceExpanded)}>{workspaceExpanded?<Minimize2 size={14}/>:<Maximize2 size={14}/>}<span>{workspaceExpanded?'恢复浮窗':'展开工作区'}</span></button><span>{studio.connection}</span><div className="cr-chat-toggle-wrap" hidden={!workspaceExpanded}><button ref={chatToggle} className="cr-chat-toggle" type="button" aria-label={chatHidden?'展开聊天':'收起聊天'} aria-controls="creative-conversation" aria-expanded={!chatHidden} aria-describedby={chatHidden&&chatPending?'creative-conversation-status':undefined} onClick={toggleChat}>{chatHidden?'展开聊天':'收起聊天'}</button>{chatHidden&&chatPending&&<span id="creative-conversation-status" className="cr-chat-pending" role="status" aria-live="polite">{chatPending} · 展开聊天查看</span>}</div></div>}
      <div className={`cr-plan-panel cr-workspace-body ${chatHidden?'is-chat-collapsed':''}`}>
      {!docked&&businessContent}
      <section id="creative-conversation" className="cr-conversation" aria-label="Binggo 聊天" hidden={chatHidden} ref={conversation} tabIndex={-1}>

      <div className="cr-chat-feed" ref={feed}>
        {studio.messages.filter(message=>message.id==='welcome').map(renderMessage)}
        {!suggestionsVisible&&<button ref={suggestionsToggle} type="button" className="cr-suggestions-toggle" aria-expanded={false} aria-controls="creative-result-suggestions" onClick={()=>{setSuggestionsDismissed(false);setSuggestionsOpen(true);queueMicrotask(()=>suggestionsCard.current?.focus());}}>查看建议</button>}
        <section ref={suggestionsCard} tabIndex={-1} id="creative-result-suggestions" className="cr-result-suggestions" aria-label="成果建议" hidden={!suggestionsVisible}><header><strong>想先处理哪一项？</strong><button type="button" aria-label="关闭成果建议" onClick={()=>{setSuggestionsDismissed(true);setSuggestionsOpen(false);queueMicrotask(()=>suggestionsToggle.current?.focus());}}><X size={16}/></button></header><div>{resultSuggestions.slice(0,3).map((suggestion,index)=><button type="button" key={suggestion.label} onClick={suggestion.open}><span className="cr-suggestion-letter" aria-hidden="true">{['A','B','C'][index]}</span><span>{suggestion.label}</span></button>)}</div></section>
        <div aria-live="polite"><div>{studio.messages.filter(message=>message.id!=='welcome').map(renderMessage)}</div>
        {studio.busy&&<div className="cr-chat-working"><Loader2 className="cr-spin" size={15}/><span>{studio.run?.progress||'正在提交任务…'}</span>{(!studio.run||['queued','running'].includes(studio.run.state))&&<button type="button" onClick={()=>void studio.cancelRun()}>取消任务</button>}</div>}
        {studio.recoverable&&<div className="cr-proposal"><p>原任务结果待核对。查询会继续读取原任务，不会再次提交生成。</p><button type="button" disabled={studio.busy} onClick={()=>void studio.recoverRun()}>查询原任务</button><button type="button" disabled={studio.busy} onClick={()=>void studio.cancelRun()}>取消原任务</button></div>}
        {studio.candidates.length>0&&studio.run?.jevEnabled&&<div className="cr-candidates" aria-label="JEV 方案比较">
          <p>{studio.run.evaluation?.message||'可分别预览候选方案。'}</p>
          {studio.run.evaluation?.status==='complete'&&<p>模型推荐概率表示本轮方案间的相对偏好，不是真实成功率。{studio.run.evaluation.confidence!==undefined?`评价信心 ${(studio.run.evaluation.confidence*100).toFixed(0)}%。`:''}</p>}
          <div>{studio.candidates.map(item=><button type="button" key={item.label} aria-pressed={studio.preview===item.preview} disabled={studio.busy||studio.stale} onClick={()=>studio.selectCandidate(item.label)}><strong>方案 {item.label} · {item.title}</strong>{studio.run?.evaluation?.status==='complete'&&studio.run.evaluation.probabilities&&<span>模型推荐概率 {(studio.run.evaluation.probabilities[item.label]*100).toFixed(1)}%</span>}</button>)}</div>
          {studio.run.evaluation?.status==='complete'&&studio.run.evaluation.probabilities&&<p>均不推荐：{(studio.run.evaluation.probabilities.NONE*100).toFixed(1)}%{studio.run.evaluation.choice==='NONE'?' · 建议调整需求后重试。':''}</p>}
        </div>}
        {studio.preview&&summary&&<div className="cr-proposal"><span>方案提案 · 尚未应用</span><strong>新增 {summary.added} · 移除 {summary.removed} · 共 {summary.total} 件</strong><p>{studio.preview.proposal.explanation}</p>{studio.preview.proposal.warnings.length>0&&<div role="status"><p>提案包含 {studio.preview.proposal.warnings.length} 项场地检查提示：</p><ul>{studio.preview.proposal.warnings.map((warning,index)=>{const names=warning.ids.map(id=>studio.preview!.layout.floors.flatMap(floor=>floor.items).find(item=>item.id===id)?.name??'物件');return <li key={`${warning.code}-${index}`}>{warning.code==='OVERLAP'?'物件重叠':warning.code==='OUT_OF_BOUNDS'?'超出场地边界':'待检查事项'}：{names.join('、')}</li>;})}</ul></div>}<ul>{differences.map(change=><li key={change.id}>{({added:'新增',removed:'移除',changed:'调整'} as const)[change.kind]} · {change.after?.item.name ?? change.before?.item.name}<small>{change.after ? ` · ${change.after.item.width} × ${change.after.item.depth} m` : ''}</small></li>)}</ul><p>画布中的半透明模型是候选方案。绿色框为新增，蓝色框为改动，橙色框为原位置，红色框为移除；确认前不会保存。</p>{studio.stale?<p role="status">{studio.expired?'提案已过期，请重新生成。':'场景、需求或编辑权已变化，请重新生成。'}</p>:<div><button type="button" onClick={()=>void studio.applyPreview()} disabled={studio.busy}><Check size={14}/>确认应用</button><button type="button" onClick={studio.discardPreview} disabled={studio.busy}><Trash2 size={14}/>放弃</button></div>}</div>}
        {studio.preview&&workspaceExpanded&&!studio.stale&&<button className="cr-return-canvas" type="button" onClick={()=>resizeWorkspace(false)}><Minimize2 size={14}/>回到画布预览</button>}
        </div>
      {studio.notice&&<p className="cr-agent-notice" role="status">{studio.notice}</p>}
      </div>
      <form id="creative-message-form" className="cr-chat-composer" onSubmit={event=>{event.preventDefault();submit();}}>
        <label className="sr-only" htmlFor="creative-message">告诉助手你的想法</label><textarea ref={messageInput} id="creative-message" value={draft} maxLength={1800} onChange={event=>setDraft(event.target.value)} placeholder={mode==='model'?'填写物料尺寸、样式和摆放要求……':'告诉我想怎么调整……'} rows={2} onKeyDown={event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.nativeEvent.isComposing){event.preventDefault();submit();}}}/>
        <div className="cr-composer-toolbar"><label className="sr-only" htmlFor="creative-work-mode">工作模式</label><select id="creative-work-mode" value={mode} onChange={event=>{const next=event.target.value as ChatMode;setMode(next);if(next==='model')setModelOpened(true);if(!docked){setBusinessMode(next);setTemplatesOpen(false);}}}>{(Object.keys(CHAT_MODES) as ChatMode[]).map(key=><option value={key} key={key}>{CHAT_MODES[key]}</option>)}</select>
          <details ref={settings} className="cr-agent-settings" onKeyDown={event=>{if(event.key==='Escape'&&event.currentTarget.open){event.preventDefault();event.stopPropagation();event.currentTarget.open=false;settingsToggle.current?.focus();}}}>
            <summary ref={settingsToggle} aria-label="助手设置"><SlidersHorizontal size={16}/><small>{studio.jevEnabled?'JEV 开 · 先比较':mode==='model'?'物料先预览':studio.directApply?'直接应用':'确认后应用'}</small></summary><div className="cr-settings-panel">
      <div className="cr-agent-mode"><label><input type="checkbox" checked={studio.directApply} disabled={studio.busy||studio.jevEnabled||mode==='model'} onChange={event=>studio.setDirectApply(event.target.checked)}/>明确指令直接应用</label><span>{mode==='model'?'仅用于场景策划；物料建模始终先预览':studio.directApply?'明确调整通过校验后应用，可撤销':'先预览，再确认应用'}</span></div>
      <div className="cr-agent-mode"><label><input type="checkbox" checked={studio.jevEnabled} disabled={studio.busy} onChange={event=>studio.setJevEnabled(event.target.checked)}/>JEV 决策模式</label><span>生成 3 个方案，由你最终选择</span></div>
      <p className="cr-hint">场景策划与物料建模使用 DeepSeek。{studio.jevEnabled?'比较方案后由你确认应用。':'模糊需求先预览；已应用的调整可撤销。'}</p>
            </div></details><button aria-label="发送消息" type="submit" disabled={!draft.trim()||studio.busy||studio.recoverable}><ArrowUp size={19}/></button>
        </div>
      </form>
      <footer><span>{studio.jevEnabled?'比较方案后由你确认应用':mode==='model'?'核对物料候选后确认应用':studio.directApply?'明确调整通过校验后应用，模糊需求先预览':'确认提案后修改当前场景'}</span></footer>
      </section>
      </div>
    </section>}
    {!studio.expanded&&chatPending&&<span className="sr-only" role="status" aria-live="polite">{chatPending}</span>}
    {assistantLauncher&&(docked&&assistantEntryHost?createPortal(assistantLauncher,assistantEntryHost):assistantLauncher)}
  </div>;
}
