'use client';

import { ArrowLeft, ArrowUp, Check, LayoutTemplate, Loader2, Maximize2, Minimize2, RefreshCw, Sparkles, Trash2, X } from 'lucide-react';
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { flushSync } from 'react-dom';
import { buildAgentContext } from '@/lib/assistant-context';
import { useBackendSession, SceneApiError, type BackendSession, type SceneProposal, type AgentRun } from '@/lib/backend-session';
import { listStoredSources, storeSource, deleteSource, suggestSourceKind, readSourceForm, storeSourceForm, deleteSourceForm, registerSourceFlush, flushSourceScope, copySourceScope, registerSourceEditor, withSourceRestoreLock, type SourceEditorLease } from '@/lib/source-storage';
import { parseLocalProjectBackupJson, serializeLocalProjectBackup, type LocalProjectRestoreCandidate } from '@/lib/local-project-backup';
import { canonical } from '../../../../supabase/functions/_shared/domain';
import { useSelection } from '../contexts';
import { backendSceneToLayout, layoutToBackendScene } from '../lib/backend-adapter';
import { appendCreativeBriefTemplate, briefInstruction, IDEA_CARDS, INITIAL_BRIEF, MANUAL_BRIEF_TEMPLATE, mergeProposalPresentation, proposalSummary, type CreativeBrief } from '../lib/creative-brief';
import { assertNoLocalHandoffCloudTransition } from '../lib/handoff-cloud-guard';
import { addDesign, MAX_DESIGNS } from '../lib/scene-layers';
import { ensureGlbAsset } from '../three/glb-assets';
import { proposalDifferences } from '../three/proposal-preview';
import { MaterialCustomization, type MaterialCustomizationSeed } from './material-customization';
import { ActivityWorkflowGuide } from './activity-workflow-guide';
import { ReconstructionPanel } from './reconstruction-panel';
import { SceneDeliveryPanel } from './scene-delivery-panel';
import { ScenePresetsPanel } from './scene-presets-panel';
import { VenuePhotosPanel, type VenuePhoto } from './venue-photos-panel';
import { VenueShapePresets } from './venue-shape-presets';
import type { EventOperations } from '../../../../supabase/functions/_shared/event-operations-contract';
import type { FurnitureItem, RoomLayout } from '../lib/types';
import './creative-studio.css';

type ReferenceImage = VenuePhoto;
type Message = { id: string; role: 'user' | 'assistant'; text: string; modelSuggestions?: SceneProposal['modelSuggestions']; materialSuggestions?: SceneProposal['materialSuggestions'] };
type RunMarker = { requestId: string; runId?: string; baseKey: string; briefKey: string };
const runStorageKey = (scope: string) => `scendance:agent-run:${scope}`;
type CandidatePreview = { label: 'A' | 'B' | 'C'; title: string; preview: Preview };
type Preview = { assets: { assetUrls: Record<string,string>; assetNames: Record<string,string> }; proposal: SceneProposal; layout: RoomLayout; base: RoomLayout; briefKey: string; scope: string };
interface Props { controller: BackendSession; layout: RoomLayout; onApply(layout: RoomLayout): void; prepareRestoreLayout?(next: RoomLayout): RoomLayout; commitRestoredLayout?(next: RoomLayout): void; onUpdateItem?: ((id: string, patch: Partial<FurnitureItem>) => void) | undefined; onUpdateEventOperations?: ((value: EventOperations | undefined) => void) | undefined; onBindProject?(projectId: string): void; onPreview?: ((layout: RoomLayout | null) => void) | undefined; children: ReactNode }
export interface CreativeBriefState { brief: CreativeBrief; ready: boolean; error: string | null; hasSavedBrief: boolean }
export interface LocalProjectBackupActions {
  prepareBackup(): Promise<string>; restoreBackup(candidate: LocalProjectRestoreCandidate): Promise<void>; undoRestore(): Promise<void>;
  backupPending: boolean; canUndoRestore: boolean;
}
interface StudioValue extends LocalProjectBackupActions {
  scope: string; controller: BackendSession; layout: RoomLayout; onApply(layout: RoomLayout): void; onUpdateItem?: ((id: string, patch: Partial<FurnitureItem>) => void) | undefined; onUpdateEventOperations?: ((value: EventOperations | undefined) => void) | undefined; onPreview?: ((layout: RoomLayout | null) => void) | undefined; updateImage(id: string, patch: Partial<VenuePhoto>): void;
  brief: CreativeBrief; setBrief: React.Dispatch<React.SetStateAction<CreativeBrief>>;
  briefReady: boolean; briefError: string | null; hasSavedBrief: boolean; retryBrief(): void;
  images: ReferenceImage[]; addImages(files: FileList | null): Promise<void>; removeImage(id: string): void;
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
const initialMessages: Message[] = [{ id:'welcome', role:'assistant', text:'我是 Binggo，当前项目的助手。选择场景策划来完善活动需求、调整布置，选择物料建模来创建或修改物件，或打开执行交付核对活动安排与物料工作单。选中物件后可针对它们调整；新物料候选由你确认后应用。' }];

export function CreativeStudioProvider({ controller, layout, onApply, prepareRestoreLayout, commitRestoredLayout, onUpdateItem, onUpdateEventOperations, onBindProject, onPreview, children }: Props): JSX.Element {
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
  const backupBusy=useRef(false), restoreWriting=useRef(false);
  const operationEpoch=useRef(0);
  const editorLease=useRef<{scope:string;lease:SourceEditorLease}>();
  const editorLeases=useRef(new Map<string,SourceEditorLease>());
  const adoptedScope=useRef<string>();
  const [undoPoint,setUndoPoint]=useState<{beforeLayout:RoomLayout;beforeBrief:CreativeBrief|undefined;targetScope:string;targetBrief:CreativeBrief|undefined;targetDraft:ReturnType<typeof briefDrafts.current.get>;afterLayout:RoomLayout;afterEdits:number;afterBrief:CreativeBrief|undefined}|null>(null);
  const undoPointRef=useRef<typeof undoPoint>(null);
  const failedRollback=useRef<{scope:string;original:CreativeBrief|undefined;attempted:CreativeBrief|undefined}|null>(null);
  const undoRecovery=useRef<{scope:string;before:CreativeBrief|undefined;attempted:CreativeBrief|undefined}[]|null>(null);
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
      const replacement=editorLease.current?.scope===scope?editorLease.current.lease:undefined;
      if(replacement)editorLease.current=undefined;
      if(!lease.acquired)void lease.release();
      if(replacement&&!replacement.acquired)void replacement.release();
      queueMicrotask(()=>{void briefSaveQueue.current.catch(()=>{}).then(async()=>{
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
  async function prepareBackup():Promise<string> {
    const activeScope=scopeRef.current;
    if(failedRollback.current?.scope===activeScope||undoRecovery.current?.some(entry=>entry.scope===activeScope))throw new Error('当前项目的资料回退尚未完成，请先重试恢复或撤销恢复，再下载场景与活动备份。');
    const operation=beginBackupOperation();
    try {
      const saved=await flushBackupBase(operation);
      const text=serializeLocalProjectBackup(operation.base.layout,{state:'ready',scope:operation.base.scope,brief:saved===undefined?{status:'absent'}:{status:'present',value:saved}});
      operation.check();return text;
    } finally {endBackupOperation();}
  }
  function assertLocalRestore():void {
    if(controller.getSnapshot().project)throw new Error('当前工作台连接了云项目，请先切换到本地项目再恢复备份。');
    if(!prepareRestoreLayout||!commitRestoredLayout)throw new Error('此工作台尚未开放完整备份恢复。');
  }
  async function writeBackupBrief(targetScope:string,value:CreativeBrief|undefined):Promise<void> {
    if(value===undefined)await deleteSourceForm(`${targetScope}:brief`);
    else await storeSourceForm(`${targetScope}:brief`,value);
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
  async function releaseEditorForRestore():Promise<void> {
    restoreWriting.current=true;
    const held=editorLease.current;editorLease.current=undefined;
    await held?.lease.release();
    if(held&&editorLeases.current.get(held.scope)===held.lease)editorLeases.current.delete(held.scope);
  }
  async function restoreBackup(candidate:LocalProjectRestoreCandidate):Promise<void> {
    assertLocalRestore();
    if(undoRecovery.current)throw new Error('上次撤销恢复的资料回退尚未完成，请先重试撤销；当前所选文件仍保留。');
    // Revalidate even callers that did not use the file picker. Serialization checks
    // the original values before JSON can omit or coerce an invalid field.
    if(!candidate||typeof candidate.layoutWasRepaired!=='boolean'||(candidate.source!=='backup'&&candidate.source!=='legacy-layout')||candidate.source==='legacy-layout'&&(candidate.createdAt!==null||candidate.brief.status!=='not-in-file')||candidate.source==='backup'&&(candidate.createdAt===null||!['present','absent'].includes(candidate.brief.status)))throw new Error('备份候选格式无效，请重新选择文件。');
    const checked=parseLocalProjectBackupJson(serializeLocalProjectBackup(candidate.layout,{state:'ready',scope:candidate.layout.id??'local',brief:candidate.brief.status==='present'?candidate.brief:{status:'absent'}},candidate.createdAt??undefined));
    const priorId=preparedRestoreIds.current.get(candidate);
    const next=prepareRestoreLayout!(!checked.layout.id&&priorId?{...checked.layout,id:priorId}:checked.layout),targetScope=next.id??'local';
    if(!candidate.layout.id&&next.id)preparedRestoreIds.current.set(candidate,next.id);
    const desired=candidate.brief.status==='present'?checked.brief.status==='present'?checked.brief.value:undefined:undefined;
    const targetDraft=briefDrafts.current.get(targetScope);
    const operation=beginBackupOperation();
    try {
      let beforeBrief=await flushBackupBase(operation);assertLocalRestore();
      await releaseEditorForRestore();operation.check();
      await withSourceRestoreLock([operation.base.scope,targetScope,...(failedRollback.current?[failedRollback.current.scope]:[])],async()=>{
        operation.check();assertLocalRestore();
        const recovery=failedRollback.current;
        if(recovery){
          const current=await readSourceForm<CreativeBrief>(`${recovery.scope}:brief`);operation.check();
          if(!sameBrief(current,recovery.original)&&!sameBrief(current,recovery.attempted))throw new Error('上次回退未完成的目标资料已有新变化，原恢复值仍保留在此页面，请保留当前页面和原备份，核对后再处理。');
          await writeAndReadBrief(recovery.scope,recovery.original,operation.check);failedRollback.current=null;
          if(recovery.scope===operation.base.scope)beforeBrief=recovery.original;
        }
        const targetBrief=await readSourceForm<CreativeBrief>(`${targetScope}:brief`);operation.check();
        let touched=false;
        try {
          touched=true;
          const saved=await writeAndReadBrief(targetScope,desired,operation.check);assertLocalRestore();
          flushSync(()=>{commitRestoredLayout!(next);adoptRestoredBrief(targetScope,saved);});
          const afterLayout=layoutRef.current;
          const point={beforeLayout:operation.base.layout,beforeBrief,targetScope,targetBrief,targetDraft,afterLayout,afterEdits:briefEditEpoch.current,afterBrief:saved};
          undoPointRef.current=point;setUndoPoint(point);
        } catch(error) {
          if(touched)try {await writeAndReadBrief(targetScope,targetBrief,()=>{});}catch(rollbackError){
            failedRollback.current={scope:targetScope,original:targetBrief,attempted:desired};
            if(scopeRef.current===targetScope){
              briefStorage.current.error='上次恢复的活动需求回退未完成，当前输入仍在此页面，请重试保存或恢复。';
              setBriefError(briefStorage.current.error);setHasSavedBrief(false);
            }
            throw new Error(`${error instanceof Error?error.message:'恢复失败。'} 原活动需求回退也失败，当前草稿与所选文件仍保留，请保留此页面并重试。${rollbackError instanceof Error?` ${rollbackError.message}`:''}`);
          }
          throw error;
        }
      });
    } finally {endBackupOperation();}
  }
  const canUndoRestore=!!undoPoint&&!backupPending&&undoPoint.afterLayout===layout&&undoPoint.afterEdits===briefEditEpoch.current&&!cloud.project;
  async function undoRestore():Promise<void> {
    assertLocalRestore();
    const point=undoPointRef.current;
    if(!point||point.afterLayout!==layoutRef.current||point.afterEdits!==briefEditEpoch.current)throw new Error('恢复后项目或需求已有新编辑，不能覆盖这些编辑；请保留当前页面和原备份，核对后再处理。');
    const next=prepareRestoreLayout!(point.beforeLayout),nextScope=next.id??'local';
    const operation=beginBackupOperation();
    try {
      await flushBackupBase(operation);
      await releaseEditorForRestore();operation.check();
      await withSourceRestoreLock([point.targetScope,nextScope],async()=>{
        operation.check();assertLocalRestore();
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
        let touched=false;
        try {
          touched=true;
          const saved=await writeAndReadBrief(nextScope,point.beforeBrief,operation.check);
          if(point.targetScope!==nextScope)await writeAndReadBrief(point.targetScope,point.targetBrief,operation.check);
          assertLocalRestore();
          flushSync(()=>{
            commitRestoredLayout!(next);adoptRestoredBrief(nextScope,saved);
            if(point.targetDraft&&point.targetScope!==nextScope)briefDrafts.current.set(point.targetScope,point.targetDraft);
            undoPointRef.current=null;setUndoPoint(null);
          });
        } catch(error) {
          if(touched){
            const failures:unknown[]=[];
            for(const entry of compensations)try{await writeAndReadBrief(entry.scope,entry.before,()=>{});}catch(rollbackError){failures.push(rollbackError);}
            if(failures.length){
              undoRecovery.current=compensations;
              briefStorage.current.error='上次撤销恢复的活动需求回退未完成，当前输入仍保留，请重试撤销恢复。';
              setBriefError(briefStorage.current.error);setHasSavedBrief(false);
              throw new Error(`${error instanceof Error?error.message:'撤销恢复失败。'} 活动需求回退也失败，原恢复点仍保留，请在本地存储恢复后重试撤销。${failures[0] instanceof Error?` ${failures[0].message}`:''}`);
            }
          }
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
      imageRef.current=restored;setImages(restored);
    }).catch(()=>{ /* Saving reports unavailable IndexedDB when files are selected. */ });
    for(const image of imageRef.current) URL.revokeObjectURL(image.url);
    imageRef.current=[];
    setImages([]);
  },[scope]);
  useEffect(()=>{
    if(preservingPreparation.current)return;
    if(!cloud.user||cloud.project?.id!==scope)return;
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
      ...imageRef.current.map(({url,...image})=>storeSource({...image,scope,kind:image.kind??'photo',width:image.width!,height:image.height!})),
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

  async function addImages(files: FileList|null):Promise<void> {
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
          const kind=suggestSourceKind(file.name,pixels);
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
        try { await Promise.all(added.map(({url,...image})=>storeSource({...image,scope:imageScope,kind:image.kind??'photo',width:image.width!,height:image.height!}))); } catch(error) { if(active()) setNotice(error instanceof Error?error.message:'本机保存失败，图片仍在本次会话中。'); }
      } catch(error) { for(const img of added) URL.revokeObjectURL(img.url); if(active()) setNotice(error instanceof Error?error.message:'图片无法读取，请更换文件。'); }
    });
    uploadQueue.current=task;
    return task;
  }
  function removeImage(id:string):void {
    const image=imageRef.current.find(value=>value.id===id);if(!image)return;
    const requestedScope=scopeRef.current;
    const remove=()=>{if(scopeRef.current!==requestedScope)return;URL.revokeObjectURL(image.url);imageRef.current=imageRef.current.filter(value=>value.id!==id);setImages(imageRef.current);void deleteSource(id).catch(error=>setNotice(error instanceof Error?error.message:'删除本机记录失败。'));};
    if(image.assetId){void controller.removeSource(image.assetId).then(remove).catch(error=>setNotice(error instanceof Error?error.message:'项目资料移除失败，请重试。'));}else remove();
  }
  function updateImage(id:string,patch:Partial<VenuePhoto>):void {
    imageRef.current=imageRef.current.map(image=>image.id===id?{...image,...patch}:image);setImages(imageRef.current);
    const updated=imageRef.current.find(image=>image.id===id);
    if(updated){const {url,...stored}=updated;void storeSource({...stored,scope,kind:stored.kind??'photo',width:stored.width!,height:stored.height!}).catch(error=>setNotice(error instanceof Error?error.message:'资料保存失败。'));}
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
    setLastExplanation(first.explanation);
    if(result.candidates.length===1&&canonical(first.candidate)===canonical(scene)){
      forgetRun();say(first.explanation||result.message||'已读取当前场景，本次没有修改物件。',first.modelSuggestions,first.materialSuggestions);return;
    }
    const prepared=await Promise.all(result.candidates.map(async item=>{
      const assets=await controller.authorizeAssets(item.proposal.candidate);
      await Promise.all(Object.entries(assets.assetUrls).map(([id,url])=>ensureGlbAsset(id,url)));
      const next=mergeProposalPresentation(base,backendSceneToLayout(item.proposal.candidate,{projectId:base.id!,name:base.name,...assets}));
      return {label:item.label,title:item.title,preview:{proposal:item.proposal,assets,layout:next,base,briefKey:submittedBrief,scope:submittedScope}};
    }));
    if(!alive.current||agentScopeRef.current!==submittedScope||epoch!==runEpoch.current)return;
    if(layoutRef.current!==base||briefRef.current!==submittedBrief)throw new Error('生成期间方案或需求已变化，旧提案未应用。请根据最新内容重新生成。');
    const preferred=prepared.find(item=>item.label===result.evaluation?.choice)??prepared[0]!;
    if(allowDirect&&result.executionMode==='direct'&&!result.jevEnabled&&prepared.length===1){await applyCandidate(preferred.preview);}
    else {setCandidates(prepared);setPreview(preferred.preview);say(result.jevEnabled?'候选方案已准备好。可以分别预览比较，最终由你选择并确认应用。':first.explanation||'方案提案已返回，请核对修改范围后确认应用。',first.modelSuggestions,first.materialSuggestions);}
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
    if(!cloud.user||cloud.project?.id!==scope||recoveredScope.current===agentScope)return;
    recoveredScope.current=agentScope;
    try{
      const raw=localStorage.getItem(runStorageKey(agentScope));
      if(!raw)return;
      const marker=JSON.parse(raw) as RunMarker;
      if(typeof marker.requestId!=='string'||typeof marker.baseKey!=='string'||typeof marker.briefKey!=='string'||(marker.runId!==undefined&&typeof marker.runId!=='string'))throw new Error('任务记录无法读取，请保留此页面记录并联系管理员核对。');
      markerRef.current=marker;setRecoverable(true);if(briefReady)void recoverRun();else recoveredScope.current='';
    }catch(error){setRecoverable(true);setNotice(error instanceof Error?error.message:'任务记录无法读取。');}
    // Recovery runs once after this project's brief has loaded. Changes do not launch another paid run.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[agentScope,briefReady,cloud.user,cloud.project?.id,scope]);
  async function cancelRun():Promise<void> {
    if(preparation.current){preparation.current.cancelled=true;say('任务已取消，当前方案保持不变。');return;}
    const scope=agentScopeRef.current,marker=markerRef.current;
    if(!marker)return;
    cancelledRequest.current=marker.requestId;
    const epoch=++runEpoch.current;requestPending.current=true;setBusy(true);setPreview(null);setCandidates([]);
    try{
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
      assertNoLocalHandoffCloudTransition(base);
      if(!briefStorage.current.ready)await briefHydration.current;
      if(!alive.current||epoch!==runEpoch.current||submittedScope!==agentScopeRef.current)return;
      if(!briefStorage.current.ready||briefStorage.current.scope!==(base.id??'local'))throw new Error(briefStorage.current.error??'活动需求尚未读取完成，请稍后重试。');
      if(layoutRef.current!==base)throw new Error('生成期间方案或需求已变化，旧提案未应用。请根据最新内容重新生成。');
      requestedBrief=JSON.stringify({brief:briefValueRef.current,images:imageRef.current.map(image=>({id:image.id,kind:image.kind}))});
      if(!cloud.user||cloud.writeBlocked||cloud.project?.id!==base.id){
        const pending={layout:base,userId:cloud.user?.id,cancelled:false,projectId:undefined as string|undefined};
        ownPreparation=pending;preparation.current=pending;
        await flushSourceScope(base.id??'local');
        if(!alive.current||pending.cancelled||epoch!==runEpoch.current)return;
        assertNoLocalHandoffCloudTransition(layoutRef.current);
        if(layoutRef.current!==base||briefRef.current!==requestedBrief){say('准备期间方案或需求已变化，本次未提交。请按当前内容重新发送。');return;}
        const project=await controller.ensureWorkbenchReady(layoutToBackendScene(base),base.name,base.id);
        if(!alive.current||pending.cancelled||epoch!==runEpoch.current)return;
        assertNoLocalHandoffCloudTransition(layoutRef.current);
        if(layoutRef.current!==base||briefRef.current!==requestedBrief){say('准备期间方案或需求已变化，本次未提交。请按当前内容重新发送。');return;}
        pending.userId=controller.getSnapshot().user?.id;pending.projectId=project.id;
        let copied:ReferenceImage[]|undefined;
        if(base.id!==project.id){
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
          assertNoLocalHandoffCloudTransition(layoutRef.current);
          flushSync(()=>{if(copied){for(const image of imageRef.current)URL.revokeObjectURL(image.url);imageRef.current=copied;setImages(copied);}onBindProject?.(project.id);});
        }else flushSync(()=>setBusy(true));
        base=layoutRef.current;submittedScope=agentScopeRef.current;
        if(base.id!==project.id)throw new Error('工作台尚未完成连接，请重试；当前草稿已保留。');
        preparation.current=null;
      }
      const submittedBrief=briefRef.current;
      assertNoLocalHandoffCloudTransition(layoutRef.current);
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
      const marker:RunMarker={requestId:crypto.randomUUID(),baseKey:canonical(scene),briefKey:submittedBrief};
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
    assertNoLocalHandoffCloudTransition(layoutRef.current);
    if ((selected.base.designBook?.variants.length ?? 0) >= MAX_DESIGNS) throw new Error('请先在图层面板移除不再需要的方案，再确认提案。');
    const result=await controller.applySceneProposal(selected.proposal,layoutToBackendScene(layoutRef.current));
    if(!alive.current || agentScopeRef.current!==selected.scope)return;
    assertNoLocalHandoffCloudTransition(layoutRef.current);
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
  const value:StudioValue={scope:agentScope,controller,layout,onApply,onUpdateItem,onUpdateEventOperations,onPreview,updateImage,brief,setBrief,briefReady,briefError,hasSavedBrief,retryBrief,prepareBackup,restoreBackup,undoRestore,backupPending,canUndoRestore,images,addImages,removeImage,busy,preparing:preservingPreparation.current,notice,connection,generate,messages,expanded,setExpanded,preview,stale,expired,directApply,setDirectApply,jevEnabled,setJevEnabled,run,candidates,recoverable,recoverRun,cancelRun,selectCandidate:label=>{const item=candidates.find(value=>value.label===label);if(item&&!stale)setPreview(item.preview);},applyPreview,discardPreview:()=>{setPreview(null);setCandidates([]);forgetRun();}};
  return <StudioContext.Provider value={value}>{children}</StudioContext.Provider>;
}

export function CreativeBriefPanel({ showNotice=true, descriptionRef }: { showNotice?: boolean; descriptionRef?: RefObject<HTMLTextAreaElement> }):JSX.Element {
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
  return <div className="cr-brief">
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
    <ReconstructionPanel controller={studio.controller} layout={studio.layout} onApply={studio.onApply} onPreview={studio.onPreview} images={studio.images} updateImage={studio.updateImage} brief={studio.brief}/>
    <label className="cr-check"><input type="checkbox" checked={studio.brief.allowIdeas} onChange={e=>update({allowIdeas:e.target.checked})}/><span><strong>也给我一些意料之外的灵感</strong><small>可以提出建议，由你确认是否采用</small></span></label>
    <button className="cr-generate" type="button" disabled={studio.busy||studio.recoverable||!studio.brief.description.trim()||templateOnly||!!studio.briefError} onClick={()=>void studio.generate()}>{studio.busy?<Loader2 className="cr-spin" size={18}/>:<Sparkles size={18}/>}<span>{studio.busy?'正在整理方案…':studio.jevEnabled?'生成三个方案':studio.directApply?'生成布置方案':'生成布置预览'}</span></button>
    <p className="cr-hint">根据当前场景与资源库生成布置方案。本轮策划不读取照片；图纸与照片重建需单独确认。</p>

    {showNotice&&studio.notice&&<p className="cr-notice" role="status">{studio.notice}</p>}
    <div className="cr-ideas"><div><h3>布置思路</h3><button type="button" aria-label="换一条布置思路" onClick={()=>setIdeaIndex(current=>(current+1)%IDEA_CARDS.length)}><RefreshCw size={13}/></button></div><article><strong>{idea.title}</strong><p>{idea.text}</p></article></div>
  </div>;
}

function AssistantMascot({ busy }: { busy: boolean }): JSX.Element {
  // A transparent user-provided character; only the element moves, never the launcher.
  // eslint-disable-next-line @next/next/no-img-element
  return <img className={`cr-mascot ${busy ? 'is-thinking' : ''}`} src="/assets/assistant/puppy.png" alt="Binggo 小狗" draggable={false} width={60} height={60}/>;
}

export type GeneratedVariant = { sourceAssetId: string; variantAssetId: string; objectIds?: string[] };
export type GenerationContext = { sourceAssetId?: string; sourceObjectIds: string[]; onVariantReady(variant: GeneratedVariant): void };
type WorkMode = 'plan'|'model'|'delivery';
const WORK_MODES = {plan:'场景策划',model:'物料建模',delivery:'执行交付'} as const;
export function CreativeAssistant({ generationPanel, workspaceOpenRequest = 0, workspaceEntryRef, deliveryOpenRequest = 0, deliveryEntryRef }: {
  generationPanel?: ReactNode | ((context: GenerationContext) => ReactNode);
  workspaceOpenRequest?: number;
  workspaceEntryRef?: RefObject<HTMLButtonElement>;
  deliveryOpenRequest?: number;
  deliveryEntryRef?: RefObject<HTMLButtonElement>;
}):JSX.Element {
  const studio=useStudio(); const {setExpanded}=studio; const {selectedItem,allSelectedIds,selectOnly}=useSelection();
  const [drafts,setDrafts]=useState({plan:'',model:''}); const feed=useRef<HTMLDivElement>(null);
  const content=useRef<HTMLDivElement>(null);
  const conversation=useRef<HTMLElement>(null);
  const chatToggle=useRef<HTMLButtonElement>(null);
  const focusChat=useRef(false);
  const [mode,setMode]=useState<WorkMode>('plan');
  const latestScopeRef=useRef(studio.scope);latestScopeRef.current=studio.scope;
  const lastResetScopeRef=useRef<string|null>(null);
  const afterRestoreScopeRef=useRef<string|null>(null);
  const [templatesOpen,setTemplatesOpen]=useState(false);
  const [workspaceExpanded,setWorkspaceExpanded]=useState(false);
  const [chatCollapsed,setChatCollapsed]=useState(false);
  const chatHidden=workspaceExpanded&&chatCollapsed;
  const workspaceScroll=useRef<Partial<Record<'floating'|'expanded',{content:number;conversation:number}>>>({});
  const pendingWorkspaceScroll=useRef<{content:number;conversation:number}>();
  const [opened,setOpened]=useState(false);
  const [modelOpened,setModelOpened]=useState(false);
  const [deliveryOpened,setDeliveryOpened]=useState(false);
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
    if(!templatesOpen&&(mode==='plan'||mode==='model'))messageInput.current?.focus();
    else conversation.current?.focus();
  },[chatHidden,mode,templatesOpen]);
  const messageInput=useRef<HTMLTextAreaElement>(null);
  const launcher=useRef<HTMLButtonElement>(null);
  const deliveryFocusTarget=useRef<HTMLDivElement>(null);
  const briefDetails=useRef<HTMLDetailsElement>(null);
  const briefDescription=useRef<HTMLTextAreaElement>(null);
  const focusBrief=useRef(false);
  const focusDelivery=useRef(false);
  const returnToDeliveryEntry=useRef(false);
  const returnToWorkspaceEntry=useRef(false);
  const handledWorkspaceRequest=useRef(0);
  const handledDeliveryRequest=useRef(0);
  const wasExpanded=useRef(false);
  const preparingScope=useRef(studio.preparing);preparingScope.current=studio.preparing;
  useEffect(()=>{
    if(preparingScope.current)return;
    const restored=afterRestoreScopeRef.current===studio.scope;
    afterRestoreScopeRef.current=null;lastResetScopeRef.current=studio.scope;
    setDrafts({plan:'',model:''});setMaterialSeed(undefined);setModelTool('generate');
    setMode(restored?'delivery':'plan');if(restored)setDeliveryOpened(true);setTemplatesOpen(false);
  },[studio.scope]);
  useEffect(()=>{
    if(workspaceOpenRequest===handledWorkspaceRequest.current)return;
    handledWorkspaceRequest.current=workspaceOpenRequest;
    returnToWorkspaceEntry.current=true;returnToDeliveryEntry.current=false;
    if(mode==='plan'&&studio.briefReady&&!studio.brief.description.trim())focusBrief.current=true;
    resizeWorkspace(true);setTemplatesOpen(false);setExpanded(true);
  },[workspaceOpenRequest,setExpanded]);
  useEffect(()=>{
    if(deliveryOpenRequest===handledDeliveryRequest.current)return;
    handledDeliveryRequest.current=deliveryOpenRequest;
    returnToDeliveryEntry.current=true;returnToWorkspaceEntry.current=false;
    focusDelivery.current=true;
    setDeliveryOpened(true);setMode('delivery');setTemplatesOpen(false);setExpanded(true);
  },[deliveryOpenRequest,setExpanded]);
  useEffect(()=>{
    if(studio.expanded && !templatesOpen && mode==='plan' && focusBrief.current){
      focusBrief.current=false;
      if(briefDetails.current)briefDetails.current.open=true;
      briefDescription.current?.focus();
    }else if(studio.expanded && !templatesOpen && mode==='delivery' && (focusDelivery.current||!wasExpanded.current)){
      focusDelivery.current=false;deliveryFocusTarget.current?.focus();
    }else if(studio.expanded && !wasExpanded.current && chatHidden) chatToggle.current?.focus();
    else if(studio.expanded && !wasExpanded.current && !templatesOpen && (mode==='plan'||mode==='model'&&modelTool==='generate')) (chatHidden?chatToggle.current:messageInput.current)?.focus();
    else if(!studio.expanded&&wasExpanded.current) (returnToWorkspaceEntry.current ? workspaceEntryRef?.current ?? launcher.current : returnToDeliveryEntry.current ? deliveryEntryRef?.current ?? launcher.current : launcher.current)?.focus();
    wasExpanded.current=studio.expanded;
  },[studio.expanded,mode,modelTool,templatesOpen,chatHidden,workspaceOpenRequest,workspaceEntryRef,deliveryOpenRequest,deliveryEntryRef]);
  useEffect(()=>{feed.current?.scrollTo({top:feed.current.scrollHeight,behavior:'smooth'});},[studio.messages,studio.busy]);
  const sceneItems=studio.layout.floors.flatMap(floor=>floor.items);
  const selectedItems=sceneItems.filter(item=>allSelectedIds.has(item.id));
  const selectedCount=selectedItems.length;
  const sourceAssetId=selectedItems.length&&selectedItems.every(item=>item.assetId&&item.assetId===selectedItems[0]!.assetId&&!item.locked)?selectedItems[0]!.assetId:undefined;
  function previewMaterial(input: Omit<MaterialCustomizationSeed,'id'|'scope'|'userId'|'projectId'|'apiUrl'>):void {
    const cloud=studio.controller.getSnapshot();
    if(!cloud.user||!cloud.project||cloud.project.id!==studio.layout.id)return;
    setMaterialSeed({...input,id:crypto.randomUUID(),scope:studio.scope,userId:cloud.user.id,projectId:cloud.project.id,apiUrl:studio.controller.config.apiUrl});
    setModelTool('customize');setModelOpened(true);setMode('model');setTemplatesOpen(false);
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
  const submit=()=>{if(!draft.trim()||studio.busy||studio.recoverable)return;const text=draft;setDraft('');void studio.generate(text,mode==='model'?{intent:'model'}:undefined);};
  const modeSummary=studio.jevEnabled?'三个方案，确认后应用':mode==='model'?'物料候选确认后应用':studio.directApply?'明确调整直接应用':'预览后确认应用';
  const summary=studio.preview?proposalSummary(studio.preview.base,studio.preview.layout):null;
  const differences=studio.preview?proposalDifferences(studio.preview.base,studio.preview.layout):[];
  const chatPending=studio.busy?studio.run?.progress||'正在提交任务…':studio.recoverable?'原任务结果待核对':studio.preview||studio.candidates.length>0?studio.stale?'候选需重新生成':'有方案待确认':studio.notice?'有助手提示待查看':'';
  function resizeWorkspace(next:boolean):void {
    const current={content:content.current?.scrollTop??0,conversation:feed.current?.scrollTop??0};
    workspaceScroll.current[workspaceExpanded?'expanded':'floating']=current;
    pendingWorkspaceScroll.current=workspaceScroll.current[next?'expanded':'floating']??current;
    if(next&&chatCollapsed&&conversation.current?.contains(document.activeElement))setChatCollapsed(false);
    setWorkspaceExpanded(next);
  }
  function openChat():void {
    if(chatHidden){focusChat.current=true;setChatCollapsed(false);}
    else if(!templatesOpen&&(mode==='plan'||mode==='model'))messageInput.current?.focus();
    else conversation.current?.focus();
  }
  function toggleChat():void {
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
    focusDelivery.current=false;focusBrief.current=false;
    setDeliveryOpened(true);setMode('delivery');setTemplatesOpen(false);
  }
  function openBrief():void {
    if(studio.expanded&&mode==='plan'&&!templatesOpen){
      if(briefDetails.current)briefDetails.current.open=true;
      briefDescription.current?.focus();
    }else{
      focusBrief.current=true;setMode('plan');setTemplatesOpen(false);setExpanded(true);
    }
  }
  return <div className={`cr-assistant ${studio.expanded?'is-open':''} ${studio.expanded&&workspaceExpanded?'is-workspace-expanded':''} ${selectedItem?'has-properties':''}`}>
    {(opened||studio.expanded)&&<section hidden={!studio.expanded} id="creative-assistant" className={`cr-chat ${workspaceExpanded?'is-expanded':''}`} aria-label="Agent" onKeyDown={event=>{if(event.key==='Escape'){event.stopPropagation();studio.setExpanded(false);}}}>
      <header><div className="cr-header-brand"><span className="cr-avatar"><AssistantMascot busy={studio.busy}/></span><div><strong>{workspaceExpanded?'活动工作区':`Binggo · ${templatesOpen?'场景模板':WORK_MODES[mode]}`}</strong><small title={studio.layout.name}>{studio.layout.name}</small></div></div><div className="cr-chat-header-actions"><label className="sr-only" htmlFor="creative-work-mode">工作模式</label><select id="creative-work-mode" value={mode} onChange={event=>{const next=event.target.value as WorkMode;setMode(next);setTemplatesOpen(false);if(next==='model')setModelOpened(true);if(next==='delivery')setDeliveryOpened(true);}}>{(Object.keys(WORK_MODES) as WorkMode[]).map(key=><option value={key} key={key}>{WORK_MODES[key]}</option>)}</select><button className="cr-workspace-toggle" type="button" aria-pressed={workspaceExpanded} onMouseDown={event=>{if(event.button===0)event.preventDefault();}} onClick={()=>resizeWorkspace(!workspaceExpanded)}>{workspaceExpanded?<Minimize2 size={14}/>:<Maximize2 size={14}/>}<span>{workspaceExpanded?'恢复浮窗':'展开工作区'}</span></button><button type="button" aria-label="收起 Agent" onClick={()=>studio.setExpanded(false)}><X size={18}/></button></div></header>
      <div className="cr-workspace-tools">{templatesOpen?<button type="button" onClick={()=>setTemplatesOpen(false)}><ArrowLeft size={14}/>返回当前工作区</button>:<button type="button" onClick={()=>setTemplatesOpen(true)}><LayoutTemplate size={14}/>场景模板</button>}<span>{studio.connection}</span><div className="cr-chat-toggle-wrap" hidden={!workspaceExpanded}><button ref={chatToggle} className="cr-chat-toggle" type="button" aria-label={chatHidden?'展开聊天':'收起聊天'} aria-controls="creative-conversation" aria-expanded={!chatHidden} aria-describedby={chatHidden&&chatPending?'creative-conversation-status':undefined} onClick={toggleChat}>{chatHidden?'展开聊天':'收起聊天'}</button>{chatHidden&&chatPending&&<span id="creative-conversation-status" className="cr-chat-pending" role="status" aria-live="polite">{chatPending} · 展开聊天查看</span>}</div></div>
      <div className={`cr-plan-panel cr-workspace-body ${chatHidden?'is-chat-collapsed':''}`}>
      <div className="cr-workspace-content" ref={content}>
        {studio.briefError&&<p className="cr-agent-notice" role="alert">{studio.briefError}<button type="button" onClick={studio.retryBrief}>{studio.briefReady?'重试保存需求':'重试读取需求'}</button></p>}
        <div hidden={templatesOpen||mode==='model'}><ActivityWorkflowGuide layout={studio.layout} briefState={{brief:studio.brief,ready:studio.briefReady,error:studio.briefError,hasSavedBrief:studio.hasSavedBrief}} onOpenBrief={openBrief}/></div>
        <section id="agent-panel-plan" aria-label="场景策划" hidden={mode!=='plan'||templatesOpen}><details ref={briefDetails} className="cr-agent-brief" open><summary>活动需求与场地资料</summary><CreativeBriefPanel showNotice={false} descriptionRef={briefDescription}/></details></section>
        <section id="agent-panel-model" aria-label="物料建模" hidden={mode!=='model'||templatesOpen}>
          <nav className="cr-model-tools" aria-label="3D 内容工具">{([['generate','物料建模'],['customize','材质调整']] as const).map(([key,label])=><button type="button" key={key} aria-pressed={modelTool===key} onClick={()=>setModelTool(key)}>{label}</button>)}</nav>
          <div hidden={modelTool!=='generate'}><p className="sc-note">选择物料类型，在聊天中填写尺寸与样式，发送后核对候选方案。</p><div className="cr-parametric-families">{[['桌','生成一张长 1.6 米、宽 0.8 米、高 0.75 米的矩形桌，先给预览'],['椅','生成一把有靠背的椅子，座面宽 0.5 米，先给预览'],['柜台','生成一个长 2 米、深 0.6 米、高 1 米的直柜台，先给预览'],['地台','生成一个长 3 米、宽 2 米、高 0.3 米的矩形地台，先给预览'],['背景板','生成一块宽 3 米、高 2.4 米并带底座的背景板，先给预览'],['柜体','生成一个宽 1.2 米、深 0.4 米、高 1.8 米的开放柜体，分 4 层，先给预览']].map(([label,prompt])=><button type="button" key={label} onClick={()=>{setDrafts(current=>({...current,model:prompt!}));openChat();}}>{label}</button>)}</div>{modelOpened&&((typeof generationPanel==='function'?generationPanel(generationContext):generationPanel)??<p className="sc-note">登录并打开云项目后可查看历史模型。</p>)}</div>
          {modelOpened&&<div hidden={modelTool!=='customize'}>{materialSeed?.scope===studio.scope&&<button type="button" className="sc-button" onClick={()=>setMaterialSeed(undefined)}>使用当前选中物件</button>}<MaterialCustomization controller={studio.controller} layout={studio.layout} onApply={applyMaterial} seed={materialSeed?.scope===studio.scope?materialSeed:undefined} active={studio.expanded&&!templatesOpen&&mode==='model'&&modelTool==='customize'}/></div>}
        </section>
        <section id="agent-panel-delivery" aria-label="执行交付" hidden={mode!=='delivery'||templatesOpen}>{deliveryOpened&&<div ref={deliveryFocusTarget} tabIndex={-1} role="group" aria-label="执行工作单"><SceneDeliveryPanel layout={studio.layout} controller={studio.controller} onLocate={selectOnly} onUpdateItem={studio.onUpdateItem} onUpdateEventOperations={studio.onUpdateEventOperations} backupActions={studio} briefState={{brief:studio.brief,ready:studio.briefReady,error:studio.briefError,hasSavedBrief:studio.hasSavedBrief}} onOpenBrief={openBrief} onBackupRestored={finishBackupNavigation}/></div>}</section>
        <section aria-label="场景模板资源" hidden={!templatesOpen}>{templatesOpen&&<ScenePresetsPanel layout={studio.layout} onApply={studio.onApply}/>}</section>
        <p className="cr-selection-context">当前场景：{sceneItems.length} 件物料 · 已选中 {selectedCount} 件{selectedItem?` · ${selectedItem.name}`:''}</p>
      </div>
      <section id="creative-conversation" className="cr-conversation" aria-label="Binggo 聊天" hidden={chatHidden} ref={conversation} tabIndex={-1}>
      <header className="cr-conversation-heading"><strong>Binggo · 聊天</strong><small>{mode==='delivery'||templatesOpen?'任务与候选记录':modeSummary}</small></header>
      <details className="cr-agent-settings" hidden={mode==='delivery'||templatesOpen}><summary>助手设置 <small>{modeSummary}</small></summary>
      <div className="cr-agent-mode"><label><input type="checkbox" checked={studio.directApply} disabled={studio.busy||studio.jevEnabled||mode==='model'} onChange={event=>studio.setDirectApply(event.target.checked)}/>明确指令直接应用</label><span>{mode==='model'?'仅用于场景策划；物料建模始终先预览':studio.directApply?'明确调整通过校验后应用，可撤销':'先预览，再确认应用'}</span></div>
      <div className="cr-agent-mode"><label><input type="checkbox" checked={studio.jevEnabled} disabled={studio.busy} onChange={event=>studio.setJevEnabled(event.target.checked)}/>JEV 决策模式</label><span>生成 3 个方案，由你最终选择</span></div>
      <p className="cr-hint">场景策划与物料建模使用 DeepSeek。{studio.jevEnabled?'比较方案后由你确认应用。':'模糊需求先预览；已应用的调整可撤销。'}</p>
      </details>
      <div className="cr-chat-feed" ref={feed}>
        {(mode==='delivery'||templatesOpen)&&<p className="cr-hint">切换到场景策划或物料建模可继续对话。</p>}
        <div aria-live="polite"><div hidden={mode==='delivery'||templatesOpen}>{studio.messages.map(m=><div key={m.id} className={`cr-message is-${m.role}`}><span>{m.role==='assistant'?'Binggo':'你'}</span><p>{m.text}</p>{m.modelSuggestions?.map((suggestion,index)=><article className="cr-model-suggestion" key={`${m.id}-${index}`}><strong>{suggestion.name}</strong><p>{suggestion.reason}</p><p>{suggestion.prompt}</p><small>可继续描述尺寸，让 DeepSeek 查找资源或使用参数化建模；不支持的造型会明确说明。</small></article>)}{m.materialSuggestions?.map((suggestion,index)=><article className="cr-model-suggestion" key={`${m.id}-material-${index}`}><strong>{suggestion.name}</strong><p>{suggestion.reason}</p><button type="button" onClick={()=>{const {scope:materialScope,...input}=suggestion;previewMaterial({...input,materialScope});}}>预览材质调整</button><small>仅调整指定的 {suggestion.objectIds.length} 件物料；原版本保留，确认后应用。</small></article>)}</div>)}</div>
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
      <form className="cr-chat-composer" hidden={mode==='delivery'||templatesOpen} onSubmit={e=>{e.preventDefault();submit();}}><label className="sr-only" htmlFor="creative-message">告诉助手你的想法</label><textarea ref={messageInput} id="creative-message" value={draft} maxLength={1800} onChange={e=>setDraft(e.target.value)} placeholder={mode==='model'?'填写物料尺寸、样式和摆放要求……':'告诉我想怎么调整……'} rows={2} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing){e.preventDefault();submit();}}}/><button aria-label="发送消息" type="submit" disabled={!draft.trim()||studio.busy||studio.recoverable}><ArrowUp size={19}/></button></form>
      <footer hidden={mode==='delivery'||templatesOpen}><span>{studio.jevEnabled?'比较方案后由你确认应用':mode==='model'?'核对物料候选后确认应用':studio.directApply?'明确调整通过校验后应用，模糊需求先预览':'确认提案后修改当前场景'}</span></footer>
      </section>
      </div>
    </section>}
    <button ref={launcher} aria-controls="creative-assistant" className="cr-assistant-launcher" type="button" onClick={()=>{if(!studio.expanded){returnToDeliveryEntry.current=false;returnToWorkspaceEntry.current=false;}studio.setExpanded(!studio.expanded);}} aria-expanded={studio.expanded} aria-label={studio.expanded?'关闭 Binggo Agent':'打开 Binggo Agent'}><span><AssistantMascot busy={studio.busy}/></span>{studio.expanded?'收起 Binggo':'Binggo · Agent'}<i/></button>
  </div>;
}
