'use client';
import { isFreshActivityId, localRestoreAvailable, proveFreshActivityScopeUnused, requireLocalRestoreAvailable, type FreshActivityScopeClearance } from '@/lib/local-project-restore';

import { ArrowLeft, ArrowUp, Check, Loader2, Maximize2, Minimize2, RefreshCw, SlidersHorizontal, Sparkles, Trash2, X } from '@/components/solid-icons';
import { useRouter } from 'next/navigation';
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type MutableRefObject, type ReactNode, type RefObject } from 'react';
import { createPortal, flushSync } from 'react-dom';
import { buildAgentContext } from '@/lib/assistant-context';
import { useBackendSession, SceneApiError, type BackendSession, type SceneProposal, type AgentRun, type AgentRunInput } from '@/lib/backend-session';
import { humanRecipeId } from '@/lib/recipe-display';
import { deriveSeededVariants, recipeHash as promptRecipeHash } from '@/lib/recipe-proposal';
import { assertGeometryActionSource, geometryProjectId, isLocalActivityWorkspace } from '@/lib/geometry-workbench';
import {localWriteCapabilityGuard,type LocalWriteCapability} from '@/lib/local-write-lease';
import { validateLocalProjectRestoreCandidate, serializeLocalProjectBackup, serializeLocalProjectBackupV3, serializeLocalProjectBackupV4, type LocalProjectRestoreCandidate } from '@/lib/local-project-backup';
import { readMaterialCheckins, restoreMaterialCheckinsIfUnchanged } from '@/lib/material-checkin-storage';
import { decodeSourceDocuments } from '@/lib/source-backup';
import { readSourceScopeSnapshot, sameSourceScopeSnapshot, readSourceScopeSnapshotV2, sameSourceScopeSnapshotV2, readSourceRecordSnapshot, restoreSourceScopeIfUnchanged, type SourceScopeSnapshot } from '@/lib/source-storage';
import {recheckSourceEditors,type SourceRecheckReader} from '@/lib/source-editor-recheck';
import { listStoredSources, storeSource, deleteSource, suggestSourceKind, readSourceForm, storeSourceForm, updateSourceForm, deleteSourceForm, registerSourceFlush, flushSourceScope, copySourceScope, registerSourceEditor, withSourceRestoreLock, type SourceEditorLease, type SourceWriteGuard } from '@/lib/source-storage';
import { canonical, sceneHash } from '../../../../supabase/functions/_shared/domain';
import { agentSeatingAllocationSchema, agentSeatingSpecsSchema } from '../../../../supabase/functions/_shared/agent-contract';
import { mergeMaterialCheckinLedgers, type MaterialCheckinLedger } from '../../../../supabase/functions/_shared/material-checkin-contract';
import { useSelection } from '../contexts';
import { useMaterialCheckins, type MaterialCheckinState } from '../hooks/use-material-checkins';
import { layoutStore } from '../hooks/use-layout-store';
import { getActiveAssistantSessionId, subscribeActiveAssistantSession } from '../hooks/use-assistant-sessions';
import { backendSceneToLayout, layoutToBackendScene } from '../lib/backend-adapter';
import { agentRunFailureMessage } from '../lib/agent-run-failure';
import { buildPlanObservation, computePlanFingerprint, type AgentPlanObservation, type OutdoorPlanCapture } from '../lib/plan-agent-observation';
import { STORAGE_KEY } from '../lib/constants';
import { BRIEF_EVENT_OPTIONS, briefInstruction, composeBriefReference, IDEA_CARDS, INITIAL_BRIEF, isBlankBriefScaffold, mergeProposalPresentation, migrateBriefDescription, proposalSummary, type CreativeBrief } from '../lib/creative-brief';
import { countSingleSeats } from '../lib/seat-requirement';
import {prepareLegacyBriefPreservation,hasPreservedLegacyBrief} from '../lib/legacy-brief';
import { localStorageOrNull, parseLayoutJson, sameLayoutContent } from '../lib/persistence';
import { captureLocalDraftIntegrityFence } from '../lib/local-draft-integrity';
import { sameRecoveryFormValue } from '@/lib/recovery-form-value';
import { reviewAgentAnnotations, type AnnotationProof, type AnnotationProjectBinding, type AnnotationReviewResult } from '@/lib/agent-annotation-review';
import type {PendingCandidateAccess,PendingCandidateCapture} from '../lib/pending-candidate-registry';
import { checkCandidateInventory, type CandidateInventory } from '../lib/candidate-inventory';
import {inventoryForSessionCandidate,rememberSessionCandidateInventory,type SessionCandidateInventory} from '../lib/session-candidate-inventory';
import {readVenueSourceRevision,type VenueSourceRevision} from '@/lib/venue-source-revision';
import {registerReadonlyDraftReader} from '../lib/readonly-draft-registry';
import type {createSourceEditorCoordinator} from '@/lib/source-editor-coordinator';
import type { ActivitySessionToken } from '../lib/activity-session-epoch';
import { buildReviewReference } from '../lib/review-copy';
import { appendAgentRunEvents, appendAgentStep, clearAgentSteerNotes, closeAgentStep, endAgentRun, getAgentRun, setAgentPhase, setAgentSteerDelivered, setAgentThoughtCount, startAgentRun } from './agent-chat-store';
import { setBriefHeadcount } from './brief-headcount-store';
import { addDesign, MAX_DESIGNS } from '../lib/scene-layers';
import { materialCount, venueArea } from '../lib/structural-layout';
import { HEADCOUNT_MAX, isDemoBackend, proposalWarningText, seatingShortfallText } from '../lib/workbench-agent';
import { type WorkbenchMode } from '../lib/workbench-mode';
import { ensureGlbAsset, getGlbAssetState } from '../three/glb-assets';
import { proposalDifferences } from '../three/proposal-preview';
import { MaterialCustomization, type MaterialCustomizationSeed } from './material-customization';
import { ProjectReviewPanel } from './project-review-panel';
import { useReconstructionPanel } from './reconstruction-panel';
import { SceneDeliveryPanel, exportActivityHandoff, type MobilityExportCapture, type DialogueExportCapture } from './scene-delivery-panel';
import type { DeliveryCapture } from '../lib/delivery-package';
import { REFERENCE_SOURCE_UNVERIFIED } from '../lib/reference-source-status';
import { ScenePresetsPanel } from './scene-presets-panel';
import { VenuePhotosPanel, type VenuePhoto } from './venue-photos-panel';
import { markSourceDraftSaved, rememberUnsavedSource, removeSourceDraft, subscribeUnsavedSourceDrafts, unsavedSourceDrafts } from './unsaved-source-drafts';
import type { ActivityTaskPanelContext } from './activity-task-workspace';
import type {FloorSessionToken} from '../lib/floor-session-epoch';
import type { EventOperations } from '../../../../supabase/functions/_shared/event-operations-contract';
import type { ProductionPlan } from '../../../../supabase/functions/_shared/production-plan-contract';
import type { FurnitureItem, RoomLayout } from '../lib/types';
import type { ProjectReviewCapture, ProjectReviewSnapshot, ProjectReviewSource } from '@/lib/project-review';
import type { ProjectReviewBase, ProjectReviewCaptureOptions } from '@/lib/project-review-workflow';
import { ModelTextDisclosure } from './model-text-disclosure';
import './creative-studio.css';

type ReferenceImage = VenuePhoto;

function UnsavedSourceNotice({scope}:{scope:string}):JSX.Element|null {
  const [,refresh]=useState(0);
  useEffect(()=>subscribeUnsavedSourceDrafts(()=>refresh(value=>value+1)),[]);
  const drafts=unsavedSourceDrafts();
  if(!drafts.length)return null;
  return <section role="alert" className="sc-note"><strong>有图片尚未保存到本机</strong>
    <p>请下载原图或保留此页面；刷新、关闭页面后内存中的图片可能丢失。</p>
    <ul>{drafts.map(({scope:owner,image})=><li key={`${owner}:${image.id}`}>{owner===scope?'当前活动':'其他活动'} · {image.name} <a href={image.url} download={image.name}>下载原图</a></li>)}</ul>
  </section>;
}
type Message = { id: string; role: 'user' | 'assistant'; text: string; modelText?: string | undefined; modelSuggestions?: SceneProposal['modelSuggestions']; materialSuggestions?: SceneProposal['materialSuggestions'] };
type RunMarker = { requestId: string; runId?: string; projectId?: string; baseKey: string; briefKey: string; seatingToken?:string; annotationSnapshot?:true };
const runStorageKey = (scope: string) => `scendance:agent-run:${scope}`;
type CandidatePreview = { label: 'A' | 'B' | 'C'; title: string; preview: Preview };
export const isUnchangedProposal = (proposal: SceneProposal): boolean => canonical(proposal.candidate)===canonical(proposal.base_scene);
export type UnchangedRunResult = {kind:'unchanged';runId:string;message:string};
export function zeroSeatingShortfall(warnings:SceneProposal['warnings']):string|null {
  const seating=warnings.filter(w=>/^(?:SHARED_)?SEATING_SHORTFALL:/u.test(w.code));
  if(seating.length!==1)return null;
  const warning=seating[0]!;
  if(!/^(?:SEATING_SHORTFALL:\d{1,3}:0:|SHARED_SEATING_SHORTFALL:\d{1,3}:0:0:)(?:object_limit|no_placement|scan_limit|preset_unverified)$/u.test(warning.code))return null;
  return seatingShortfallText(warning);
}
type VenueBinding={scope:string;digest:string;epoch:number};
export interface VenueSourceGuard {
  getConfirmed(scope:string):VenueSourceRevision;
  isSettled(scope:string):boolean;
  subscribeInvalidation(listener:()=>void):()=>void;
}
type AnnotationEvidence={observation:NonNullable<AgentRunInput['context']['annotationObservation']>;provenance:readonly AnnotationProof[];projectBinding:AnnotationProjectBinding|null;base:RoomLayout};
type Preview = { assets: { assetUrls: Record<string,string>; assetNames: Record<string,string> }; proposal: SceneProposal; layout: RoomLayout; base: RoomLayout; briefKey: string; scope: string; sessionToken?: ActivitySessionToken | null | undefined; floorToken?:FloorSessionToken|null|undefined; venueBinding?: VenueBinding | null | undefined; seatingCapture?:Extract<SeatingAllocationCapture,{status:'ready'}>|null|undefined; annotationEvidence?:AnnotationEvidence|undefined };
type CheckinRestoreWrite = { scope: string; before: MaterialCheckinLedger | undefined; attempted: MaterialCheckinLedger | undefined };
type SourceRestoreWrite = { scope: string; before: SourceScopeSnapshot; attempted: SourceScopeSnapshot };
type ApplyRecovery = { projectId: string; revision: number; proposalId: string; outcome: 'pending' | 'committed' | 'cleanup_failed'; storageScope?: string; baseRevision?: number; baseHash?: string; candidateHash?: string };
type ApplyRecoveryReview = { proposalId: string; status: 'base_matches' | 'candidate_matches' | 'unknown'; message: string; observedRevision?: number; observedHash?: string };
const applyRecoveryKey = (scope: string) => `scendance:agent-apply-recovery:${scope}`;
const projectRecoveryScope = (apiUrl: string, projectId: string) => `${apiUrl.replace(/\/+$/, '')}:project:${projectId.toLowerCase()}`;
function readApplyRecovery(scope: string): ApplyRecovery | null {
  try {
    const raw = localStorageOrNull()?.getItem(applyRecoveryKey(scope));
    if (raw === undefined || raw === null) return null;
    let value: unknown;
    try { value=JSON.parse(raw); } catch { return { projectId:'',revision:0,proposalId:'',outcome:'pending',storageScope:scope }; }
    if (!value || typeof value !== 'object') return { projectId:'',revision:0,proposalId:'',outcome:'pending',storageScope:scope };
    const record = value as Partial<ApplyRecovery>;
    return typeof record.projectId === 'string' && Number.isInteger(record.revision) && typeof record.proposalId === 'string'
      ? { projectId: record.projectId, revision: record.revision!, proposalId: record.proposalId,
        outcome: record.outcome === 'cleanup_failed' ? 'cleanup_failed' : record.outcome === undefined || record.outcome === 'committed' ? 'committed' : 'pending', storageScope:scope,
        ...(Number.isInteger(record.baseRevision) ? { baseRevision:record.baseRevision! } : {}),
        ...(typeof record.baseHash==='string' && /^[a-f0-9]{64}$/i.test(record.baseHash) ? { baseHash:record.baseHash } : {}),
        ...(typeof record.candidateHash==='string' && /^[a-f0-9]{64}$/i.test(record.candidateHash) ? { candidateHash:record.candidateHash } : {}) }
      : { projectId:'',revision:0,proposalId:'',outcome:'pending',storageScope:scope };
  } catch { return null; }
}

/** 这些错误只由提交路由在写入前返回；不能把本地 409 或网络错误当作远端拒绝。 */
function definitelyRejectedBeforeApply(error: unknown): boolean {
  if (!(error instanceof SceneApiError)) return false;
  return (error.status === 422 && ['DIMENSION_CONFLICT','STRUCTURAL_COLLISION'].includes(error.code))
    || (error.status === 403 && error.code === 'ORIGIN_FORBIDDEN')
    || (error.status === 415 && error.code === 'JSON_REQUIRED')
    || (error.status === 400 && ['VALIDATION_ERROR','INVALID_JSON'].includes(error.code));
}

function removeApplyRecovery(scope: string, expected: ApplyRecovery): boolean {
  try {
    const storage=localStorageOrNull();
    if(!storage)return false;
    const key=applyRecoveryKey(scope),raw=storage.getItem(key);
    if(!raw)return false;
    const actual: unknown=JSON.parse(raw);
    if(!actual || typeof actual !== 'object' || (actual as Partial<ApplyRecovery>).proposalId!==expected.proposalId) return false;
    storage.removeItem(key);
    return storage.getItem(key) === null;
  } catch { return false; }
}

function updateApplyRecovery(scope: string, next: ApplyRecovery): boolean {
  try {
    const storage=localStorageOrNull();
    if(!storage)return false;
    const key=applyRecoveryKey(scope),raw=storage.getItem(key);
    if(!raw)return false;
    const actual:unknown=JSON.parse(raw);
    if(!actual || typeof actual !== 'object' || (actual as Partial<ApplyRecovery>).proposalId!==next.proposalId) return false;
    const payload=JSON.stringify(next);
    storage.setItem(key,payload);
    return storage.getItem(key)===payload;
  } catch { return false; }
}

/** 跨标签协调提交；无法取得锁时不触发请求。 */
export async function withApplyLock<T>(scope: string, run: () => Promise<T>): Promise<T> {
  let locks: LockManager | undefined;
  try { locks=typeof navigator==='undefined'?undefined:navigator.locks; } catch { /* Treat inaccessible coordination as unavailable. */ }
  if(!locks?.request)throw new Error('当前浏览器无法安全协调多个窗口的布置应用，本次应用请求尚未发送。请使用支持的浏览器。');
  return locks.request(applyRecoveryKey(scope),{mode:'exclusive',ifAvailable:true},async lock=>{
    if(!lock)throw new Error('另一个窗口正在处理这次布置，本窗口的应用请求尚未发送。请先核对原窗口。');
    return run();
  });
}
const sameCheckins = (left: MaterialCheckinLedger | undefined, right: MaterialCheckinLedger | undefined) => canonical(left ?? null) === canonical(right ?? null);
export type SeatingAllocationCapture={status:'ready';value:AgentRunInput['context']['seatingAllocation'];specs?:AgentRunInput['context']['seatingSpecs']|undefined;defaults?:{desk?:string|undefined;chair?:string|undefined}|undefined;token:string;annotationObservation?:AgentRunInput['context']['annotationObservation'];annotationProvenance?:readonly AnnotationProof[];readAnnotationReview?:()=>{observation:NonNullable<AgentRunInput['context']['annotationObservation']>;provenance:readonly AnnotationProof[]}|null;isCurrent:()=>boolean}|{status:'unavailable'};
interface Props { pendingCandidates?:PendingCandidateAccess|undefined; reviewContext?: string; controller: BackendSession; layout: RoomLayout; captureImage?: DeliveryCapture | undefined; sourceCoordinator?: ReturnType<typeof createSourceEditorCoordinator> | undefined; venueSourceGuard?: VenueSourceGuard | undefined; sessionToken?: ActivitySessionToken | null | undefined; isSessionCurrent?: ((token:ActivitySessionToken|null|undefined)=>boolean) | undefined; floorToken?:FloorSessionToken|null|undefined; isFloorCurrent?:((token:FloorSessionToken|null|undefined)=>boolean)|undefined; captureMobility?:(()=>MobilityExportCapture)|undefined; captureDialogue?:(()=>DialogueExportCapture|null)|undefined; captureSeatingAllocation?:(()=>SeatingAllocationCapture)|undefined; captureOutdoorPlan?:(()=>OutdoorPlanCapture|undefined)|undefined; getCurrentLayout?: (() => RoomLayout) | undefined; onApply(layout: RoomLayout, options?: {expectedBase:RoomLayout;expectedFloor?:FloorSessionToken}): void; sourceWriteGuard?: SourceWriteGuard | undefined; writeCapability?: LocalWriteCapability | undefined; preflightApply?(base: RoomLayout, candidate: RoomLayout): string | null; validateGenerationIntent?(): string | null; validateCandidateRequirements?(base: RoomLayout, candidate: RoomLayout): string | null; prepareRestoreLayout?(next: RoomLayout): RoomLayout; commitRestoredLayout?(next: RoomLayout): void; commitFreshActivityLayout?(next: RoomLayout, clearance: FreshActivityScopeClearance): void; onUpdateItem?: ((id: string, patch: Partial<FurnitureItem>) => void) | undefined; onUpdateEventOperations?: ((value: EventOperations | undefined) => void) | undefined; onUpdateProductionPlan?: ((value: ProductionPlan | undefined) => void) | undefined; onBindProject?(projectId: string): void; onPreview?: ((layout: RoomLayout | null) => void) | undefined; children: ReactNode }
export interface CreativeBriefState { brief: CreativeBrief; ready: boolean; error: string | null; hasSavedBrief: boolean }
function serializeReadonlyBrief(scope:string,kind:'original'|'draft',value:unknown):string {
  const envelope={format:'scendance-readonly-brief-v1',scope,kind,notice:kind==='original'?'原始本机保存记录；来源及确认状态均需独立核对。':'当前未保存的页面草稿；不代表已保存或已确认。',value};
  const json=JSON.stringify(envelope,null,2);
  if(!json||!sameRecoveryFormValue(JSON.parse(json).value,value))throw new Error('内容无法无损导出，请保留当前页面。');
  return json;
}
function downloadReadonlyBrief(json:string,kind:'original'|'draft'):void {
  const url=URL.createObjectURL(new Blob([json],{type:'application/json;charset=utf-8'}));
  try{const link=document.createElement('a');link.href=url;link.download=kind==='original'?'原始本机需求记录.json':'当前未保存需求草稿.json';link.click();}
  finally{setTimeout(()=>URL.revokeObjectURL(url),0);}
}
export interface LocalProjectBackupActions {
  prepareBackup(options?:{includeSourceDocuments?:boolean}): Promise<string>; restoreBackup(candidate: LocalProjectRestoreCandidate,assertSwitchCurrent?:()=>void): Promise<void>; createFreshActivity?(candidate: LocalProjectRestoreCandidate, assertSwitchCurrent?: () => void): Promise<void>; undoRestore(): Promise<void>;
  backupPending: boolean; canUndoRestore: boolean;
}
interface StudioValue extends LocalProjectBackupActions {
  setCandidateInventory(preview:Preview,value:CandidateInventory|undefined,chatScope:string,chatId:string|null):boolean;
  getBoundCandidateInventory(preview:Preview):CandidateInventory|undefined;
  getSessionInventory(candidate:RoomLayout,chatScope:string,chatId:string|null):CandidateInventory|undefined;
  rememberSessionInventory(candidate:RoomLayout,value:CandidateInventory|undefined,chatScope:string,chatId:string|null):void;
  canRememberSessionInventory(chatScope:string,chatId:string|null):boolean;
  sourceCoordinator?: ReturnType<typeof createSourceEditorCoordinator> | undefined;
  onDrawingRecheckReader(reader:SourceRecheckReader|null):void;
  recheckVenueSources():Promise<boolean>;
  sourceRecheckNotice:string;
  briefExportNotice:string;
  exportOriginalBrief():Promise<void>;
  exportBriefDraft():void;
  sourceWriteGuard?: SourceWriteGuard | undefined;
  sourcesRestoring: boolean;
  captureImage?: DeliveryCapture | undefined;
  checkins: MaterialCheckinState;
  reviewSource: ProjectReviewSource;
  getReviewSource(): ProjectReviewSource;
  prepareReview(): Promise<ProjectReviewBase>;
  /** 对话里确认后在本机生成执行资料草案；对话需求须另行核对。 */
  exportActivity(): Promise<void>;
  /** 云项目的当前画布物料草案，不代表完整交接或已冻结版本。 */
  exportCloudMaterialDraft(): Promise<void>;
  captureLocalDraftExport(): {isCurrent():boolean;release():void} | null;
  capturePendingCandidates?: (()=>PendingCandidateCapture|null)|undefined;
  cloudMaterialDraftAvailable: boolean;
  captureMobility?: (()=>MobilityExportCapture)|undefined;
  captureDialogue?: (()=>DialogueExportCapture|null)|undefined;
  scope: string; controller: BackendSession; layout: RoomLayout; getCurrentLayout?: (()=>RoomLayout) | undefined; onApply(layout: RoomLayout): void; onUpdateItem?: ((id: string, patch: Partial<FurnitureItem>) => void) | undefined; onUpdateEventOperations?: ((value: EventOperations | undefined) => void) | undefined; onUpdateProductionPlan?: ((value: ProductionPlan | undefined) => void) | undefined; onPreview?: ((layout: RoomLayout | null) => void) | undefined; updateImage(id: string, patch: Partial<VenuePhoto>): void;
  brief: CreativeBrief; setBrief: React.Dispatch<React.SetStateAction<CreativeBrief>>;
  briefReady: boolean; briefError: string | null; hasSavedBrief: boolean; retryBrief(): void;
  images: ReferenceImage[]; addImages(files: FileList | null, kind?: ReferenceImage['kind']): Promise<void>; removeImage(id: string): void;
  autoGenerateRequest: number;
  busy: boolean; preparing: boolean; notice: string; connection: string; generate(message?: string, options?: {intent?:'model'; requirePreview?: true; seatingAllocation?:AgentRunInput['context']['seatingAllocation'] | undefined; seatingSpecs?:AgentRunInput['context']['seatingSpecs'] | undefined}): Promise<UnchangedRunResult|void>;
  messages: Message[]; expanded: boolean; setExpanded(value: boolean): void; preview: Preview | null; stale: boolean; expired: boolean;
  jevEnabled: boolean; setJevEnabled(value:boolean):void; run: AgentRun | null; candidates: CandidatePreview[]; selectCandidate(label: 'A'|'B'|'C'):void; cancelRun():Promise<void>; recoverRun():Promise<void>; recoverable:boolean;
  applyPreview(): Promise<void>; discardPreview(): void; discardPreviewForHistoryReview(): boolean;
  candidateRequirementError(base: RoomLayout, candidate: RoomLayout): string | null;
  candidateAnnotationAdvisory(candidate:Preview):string|null;
  candidateSeatAdvisory(candidate:Preview): string | null;
  applyRecovery: ApplyRecovery | null; applyRecoveryReview: ApplyRecoveryReview | null; reviewingApplyRecovery: boolean;
  reviewApplyRecovery(): Promise<void>; acknowledgeApplyRecovery(): Promise<void>;
}
const StudioContext = createContext<StudioValue | null>(null);
function useStudio(): StudioValue { const value=useContext(StudioContext); if(!value) throw new Error('Creative studio unavailable'); return value; }
/** Library consumers can render independently of the creative workspace. */
export function useCreativeBrief(): CreativeBrief | null { return useContext(StudioContext)?.brief ?? null; }
export function useCreativeBriefState(): CreativeBriefState | null {
  const studio=useContext(StudioContext);
  return studio?{brief:studio.brief,ready:studio.briefReady,error:studio.briefError,hasSavedBrief:studio.hasSavedBrief}:null;
}
/** v2.4 AgentPanel：只取出方案需要的那几项（复用现有 AI 生成，不新增算法）。
 *  云端提案现在也要在Bingo栏里「确认布置 / 撤回」，所以把预览与确认这几项一起放出来。 */
export function useStudioAgent(): Pick<StudioValue, 'generate'|'busy'|'run'|'connection'|'notice'|'controller'|'brief'|'setBrief'|'hasSavedBrief'
  |'preview'|'stale'|'expired'|'recoverable'|'selectCandidate'|'applyPreview'|'discardPreview'|'discardPreviewForHistoryReview'|'cancelRun'|'exportActivity'|'exportCloudMaterialDraft'|'cloudMaterialDraftAvailable'|'candidateRequirementError'|'candidateAnnotationAdvisory'|'setCandidateInventory'|'getBoundCandidateInventory'|'getSessionInventory'|'rememberSessionInventory'|'canRememberSessionInventory'|'applyRecovery'|'applyRecoveryReview'|'reviewingApplyRecovery'|'reviewApplyRecovery'|'acknowledgeApplyRecovery'>|null { return useContext(StudioContext); }
export function useLocalProjectBackup(): LocalProjectBackupActions | null { return useContext(StudioContext); }
export function useMaterialCheckinState(): MaterialCheckinState { return useStudio().checkins; }
const initialMessages: Message[] = [{ id:'welcome', role:'assistant', text:'活动需求、客户方案与执行资料可以先在本机整理。需要 AI 布置或物料候选时，再连接场景服务。' }];
type MessageDrafts={plan:string;model:string};
const unsentMessageDrafts=new Map<string,{owner:string;value:MessageDrafts}>();
let draftWarningInstalled=false;
function warnUnsentDrafts(event:BeforeUnloadEvent){event.preventDefault();event.returnValue='';}
function rememberMessageDraft(scope:string,owner:string,value:MessageDrafts){
  if(value.plan.trim()||value.model.trim())unsentMessageDrafts.set(scope,{owner,value:{...value}});else unsentMessageDrafts.delete(scope);
  if(typeof window!=='undefined'&&unsentMessageDrafts.size&&!draftWarningInstalled){window.addEventListener('beforeunload',warnUnsentDrafts);draftWarningInstalled=true;}
  if(typeof window!=='undefined'&&!unsentMessageDrafts.size&&draftWarningInstalled){window.removeEventListener('beforeunload',warnUnsentDrafts);draftWarningInstalled=false;}
}
/** Test isolation only; normal editing retains unsent messages until explicitly cleared. */
export function clearUnsentMessageDraftsForTests(){unsentMessageDrafts.clear();if(typeof window!=='undefined'&&draftWarningInstalled)window.removeEventListener('beforeunload',warnUnsentDrafts);draftWarningInstalled=false;}
const PARTIAL_RUN_NOTICE='后续处理中断，已保留通过检查的方案，请核对后继续。';
const ANNOTATION_BLOCK='新布置占用了已标路线或预留区，请调整后重新生成。';

export function CreativeStudioProvider({ pendingCandidates, reviewContext, controller, layout, sourceCoordinator, venueSourceGuard, sessionToken, isSessionCurrent, floorToken, isFloorCurrent, captureImage, captureMobility, captureDialogue, captureSeatingAllocation, captureOutdoorPlan, getCurrentLayout, onApply, sourceWriteGuard, writeCapability, preflightApply, validateGenerationIntent, validateCandidateRequirements, prepareRestoreLayout, commitRestoredLayout, commitFreshActivityLayout, onUpdateItem, onUpdateEventOperations, onUpdateProductionPlan, onBindProject, onPreview, children }: Props): JSX.Element {
  const applyAuthority=useRef<{capability:LocalWriteCapability|undefined;source:SourceWriteGuard|undefined;revoked:boolean;abort:AbortController}|null>(null);
  if(!applyAuthority.current&&(writeCapability||sourceWriteGuard))applyAuthority.current={capability:writeCapability,source:sourceWriteGuard,revoked:false,abort:new AbortController()};
  else if(applyAuthority.current&&(writeCapability!==applyAuthority.current.capability||sourceWriteGuard!==applyAuthority.current.source)){
    applyAuthority.current.revoked=true;applyAuthority.current.abort.abort();
  }
  const cloud=useBackendSession(controller);
  const { allSelectedIds }=useSelection();
  const [brief,setBriefValue]=useState<CreativeBrief>(INITIAL_BRIEF);
  const [briefReady,setBriefReady]=useState(false);
  const [briefError,setBriefError]=useState<string|null>(null);
  const [hasSavedBrief,setHasSavedBrief]=useState(false);
  const [briefLoadAttempt,setBriefLoadAttempt]=useState(0);
  const briefValueRef=useRef(brief);briefValueRef.current=brief;
  const briefHydration=useRef<Promise<void>>(Promise.resolve());
  const briefStorage=useRef({scope:layout.id??'local',ready:false,dirty:false,revision:0,error:null as string|null,edits:{} as Partial<CreativeBrief>,legacyOriginal:null as unknown});
  const briefCapability=useRef(writeCapability);briefCapability.current=writeCapability;
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
  const sourceWriters=useRef<{scope:string;brief:ReturnType<ReturnType<typeof createSourceEditorCoordinator>['register']>;images:ReturnType<ReturnType<typeof createSourceEditorCoordinator>['register']>}|null>(null);
  const setBrief=useCallback<React.Dispatch<React.SetStateAction<CreativeBrief>>>(update=>{
    const next=typeof update==='function'?update(briefValueRef.current):update;
    if(!briefStorage.current.ready)for(const key of Object.keys(next) as (keyof CreativeBrief)[]){
      if(!Object.is(next[key],briefValueRef.current[key]))briefStorage.current.edits={...briefStorage.current.edits,[key]:next[key]};
    }
    try{sourceWriters.current?.brief.markDirty();}catch{/* coordinator remains unknown */}
    briefStorage.current.dirty=true;briefStorage.current.revision++;briefEditEpoch.current++;
    briefValueRef.current=next;setBriefValue(next);setHasSavedBrief(false);
  },[]);
  const [images,setImages]=useState<ReferenceImage[]>([]);
  const [autoGenerateRequest,setAutoGenerateRequest]=useState(0);
  const savedImages=useRef(new WeakSet<ReferenceImage>());
  const [busy,setBusy]=useState(false);
  const [notice,setNotice]=useState('');
  const [applyRecovery,setApplyRecovery]=useState<ApplyRecovery|null>(null);
  const applyRecoveryRef=useRef<ApplyRecovery|null>(null);
  const [applyRecoveryReview,setApplyRecoveryReview]=useState<ApplyRecoveryReview|null>(null);
  const [reviewingApplyRecovery,setReviewingApplyRecovery]=useState(false);
  const [messages,setMessages]=useState<Message[]>(initialMessages);
  const [lastExplanation,setLastExplanation]=useState('');
  const preparation=useRef<{layout:RoomLayout;userId:string|undefined;projectId:string|undefined;cancelled:boolean}|null>(null);
  const preservingPreparation=useRef(false);
  preservingPreparation.current=!!preparation.current&&(preparation.current.layout===layout||!!preparation.current.projectId&&preparation.current.projectId===layout.id)&&(!preparation.current.userId||preparation.current.userId===cloud.user?.id);
  const scope=layout.id??'local';
  const scopeWriteGuards=useRef(new Map<string,SourceWriteGuard|undefined>());scopeWriteGuards.current.set(scope,sourceWriteGuard);
  const scopeRef=useRef(scope); scopeRef.current=scope;
  const agentScope=`${controller.config.apiUrl}:${cloud.user?.id??'anonymous'}:${scope}`;
  const agentScopeRef=useRef(agentScope);agentScopeRef.current=agentScope;
  useEffect(()=>{
    const removeBrief=registerReadonlyDraftReader(scope,'brief',()=>{
      const cached=briefDrafts.current.get(scope);
      if(cached?.storage.dirty)return {status:'captured',value:cached.brief};
      if(briefStorage.current.scope!==scope)return {status:'unavailable',reason:'需求编辑范围已变化'};
      if(briefStorage.current.dirty)return {status:'captured',value:briefValueRef.current};
      return briefStorage.current.ready?{status:'none'}:{status:'unavailable',reason:'需求尚未读取完成'};
    });
    const removeChat=registerReadonlyDraftReader(scope,'creative-conversation',()=>{
      const draft=unsentMessageDrafts.get(agentScope)?.value;
      return draft?{status:'captured',value:draft}:{status:'none'};
    });
    return ()=>{removeBrief();removeChat();};
  },[scope,agentScope]);
  const cloudRecoveryScope=cloud.project?.id ? projectRecoveryScope(controller.config.apiUrl,cloud.project.id) : null;
  useLayoutEffect(()=>{
    if(!sourceCoordinator||sourceCoordinator.scope!==scope)return;
    let brief:ReturnType<ReturnType<typeof createSourceEditorCoordinator>['register']>|undefined;
    try{brief=sourceCoordinator.register('brief');const images=sourceCoordinator.register('images');sourceWriters.current={scope,brief,images};
      return()=>{if(sourceWriters.current?.brief===brief)sourceWriters.current=null;try{brief?.destroy();}catch{/* coordinator already unavailable */}try{images.destroy();}catch{/* coordinator already unavailable */}};
    }catch{try{brief?.destroy();}catch{/* coordinator already unavailable */}return;}
  },[sourceCoordinator,scope]);
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
  useEffect(()=>{if(preservingPreparation.current)return;runEpoch.current++;markerRef.current=null;requestPending.current=false;setBusy(false);setMessages(initialMessages);setAcceptedDecisions([]);setLastExplanation('');setTrackedPreview(null);setCandidates([]);setRun(null);setRecoverable(false);setNotice('');const recovery=(cloudRecoveryScope&&readApplyRecovery(cloudRecoveryScope))||readApplyRecovery(agentScope);applyRecoveryRef.current=recovery;setApplyRecovery(recovery);},[agentScope]);
  useEffect(()=>{if(!cloudRecoveryScope)return;const recovery=readApplyRecovery(cloudRecoveryScope);if(recovery){applyRecoveryRef.current=recovery;setApplyRecovery(recovery);}},[cloudRecoveryScope]);
  useEffect(()=>{setApplyRecoveryReview(null);setReviewingApplyRecovery(false);},[agentScope,applyRecovery?.proposalId,applyRecovery?.revision,applyRecovery?.outcome]);
  useEffect(()=>{setApplyRecoveryReview(null);setReviewingApplyRecovery(false);},[sessionToken?.scope,sessionToken?.epoch]);
  const saveBrief=useCallback(async(saveScope:string,storage=briefStorage.current,value=briefValueRef.current,guard?:SourceWriteGuard):Promise<void>=>{
    if(restoreWriting.current)throw new Error('正在恢复本地资料，请稍后再保存。');
    if(storage.scope!==saveScope||!storage.ready)throw new Error(storage.error??'活动需求尚未读取完成，请稍后重试。');
    if(!storage.dirty)return;
    const revision=storage.revision;
    const writer=sourceWriters.current?.scope===saveScope?sourceWriters.current.brief:null;let ticket:object|undefined;try{ticket=writer?.beginWrite();}catch{/* coordinator remains unknown */}
    const lease=editorLeases.current.get(saveScope);
    const write=briefSaveQueue.current.catch(()=>{}).then(async()=>{
      await lease?.ready;
      const original=storage.legacyOriginal;
      if(original!==null){
        const capability=localWriteCapabilityGuard(briefCapability.current);
        const check=()=>{capability.assertStillHeld();guard?.assertStillHeld();if(capability.signal.aborted||guard?.signal.aborted)throw new Error('本机编辑权已失效。');};
        const preserved=prepareLegacyBriefPreservation(original as object);
        const next={...value,...(preserved.legacyBriefRecord?{legacyBriefRecord:preserved.legacyBriefRecord}:{}),...(preserved.unconfirmedSavedBrief?{unconfirmedSavedBrief:preserved.unconfirmedSavedBrief}:{})};
        check();await updateSourceForm(`${saveScope}:brief`,current=>{check();if(!sameRecoveryFormValue(current,original))throw new Error('旧需求已在其他位置变化，请先核对。');return next;},{signal:capability.signal,assertStillHeld:check});
        check();const readback=await readSourceRecordSnapshot(`${saveScope}:brief`);check();
        if(!readback.present||!sameRecoveryFormValue(readback.value,next)||!hasPreservedLegacyBrief(original,readback.value))throw new Error('旧需求保存结果待核对，当前输入已保留。');
        storage.legacyOriginal=null;
      }else if(guard)await storeSourceForm(`${saveScope}:brief`,value,guard);else await storeSourceForm(`${saveScope}:brief`,value);
    });
    briefSaveQueue.current=write;
    try{
      await write;
      if(writer&&ticket)try{writer.finishWrite(ticket,true);}catch{/* stale writer remains unknown */}
      if(storage.revision===revision){
        storage.dirty=false;storage.error=null;
        if(briefDrafts.current.get(saveScope)?.storage===storage)briefDrafts.current.delete(saveScope);
        if(briefStorage.current===storage&&scopeRef.current===saveScope){setBriefError(null);setHasSavedBrief(true);}
      }
    }catch(error){
      if(writer&&ticket)try{writer.finishWrite(ticket,false);}catch{/* stale writer remains unknown */}
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
        if(previous.ready)void saveBrief(previous.scope,previous,draft.brief,scopeWriteGuards.current.get(previous.scope)).catch(()=>{});
      }
      const cached=briefDrafts.current.get(scope);
      briefStorage.current=cached?.storage??{scope,ready:false,dirty:false,revision:0,error:null,edits:{},legacyOriginal:null};
      briefValueRef.current=cached?.brief??INITIAL_BRIEF;setBriefValue(briefValueRef.current);setHasSavedBrief(false);
      if(cached?.storage.ready){
        setBriefReady(true);setBriefError(cached.storage.error);setHasSavedBrief(!cached.storage.dirty&&!cached.storage.error);
        briefHydration.current=Promise.resolve();return;
      }
    }
    const storage=briefStorage.current;
    let cancelled=false;
    const writer=sourceWriters.current?.scope===scope?sourceWriters.current.brief:null;let readTicket:object|undefined;try{readTicket=writer?.beginRead();}catch{/* coordinator remains unknown */}
    storage.ready=false;storage.error=null;setBriefReady(false);setBriefError(null);
    briefHydration.current=(editorLease.current?.lease.ready??Promise.resolve()).then(()=>readSourceRecordSnapshot(`${scope}:brief`)).then(record=>{
      if(cancelled)return;
      if(!record||typeof record!=='object'||(record.present!==true&&record.present!==false))throw new Error('已保存需求记录无法识别');
      const raw=record.present?record.value:undefined;
      if(record.present&&(!raw||typeof raw!=='object'||Array.isArray(raw)))throw new Error('已保存需求记录无法识别');
      const saved=raw as CreativeBrief|undefined;
      if(saved&&(['event','description','mustHave'] as const).some(key=>saved[key]!==undefined&&typeof saved[key]!=='string')||saved?.guests!==undefined&&(typeof saved.guests!=='number'||!Number.isFinite(saved.guests))||saved?.allowIdeas!==undefined&&typeof saved.allowIdeas!=='boolean')throw new Error('已保存需求记录无法识别');
      storage.ready=true;
      const preserved=saved?prepareLegacyBriefPreservation(saved):saved;
      storage.legacyOriginal=saved&&!hasPreservedLegacyBrief(saved,saved)?structuredClone(saved):null;
      const restored=preserved?{...INITIAL_BRIEF,...preserved,description:migrateBriefDescription(preserved.description??'')}:INITIAL_BRIEF;
      briefValueRef.current={...restored,...storage.edits};setBriefValue(briefValueRef.current);
      storage.edits={};setHasSavedBrief(record.present&&!storage.dirty);
      if(writer&&readTicket)try{writer.readSucceeded(readTicket);}catch{/* stale writer remains unknown */}
      setBriefReady(true);
    }).catch(error=>{
      if(writer&&readTicket)try{writer.readFailed(readTicket);}catch{/* stale writer remains unknown */}
      if(cancelled)return;
      const message=`活动需求读取失败，当前输入已保留，请重试。${error instanceof Error?` ${error.message}`:''}`;
      storage.error=message;setBriefError(message);
    });
    return()=>{cancelled=true;};
  },[scope,briefLoadAttempt,saveBrief]);
  useEffect(()=>{
    if(!briefReady||!briefStorage.current.dirty||backupPending)return;
    const guard=sourceWriteGuard;
    const timer=setTimeout(()=>{briefTimer.current=undefined;void saveBrief(scope,undefined,undefined,guard).catch(()=>{});},250);briefTimer.current=timer;
    return()=>{clearTimeout(timer);if(briefTimer.current===timer)briefTimer.current=undefined;};
  },[brief,briefReady,scope,saveBrief,backupPending]); // A new lease alone must not silently replay an old dirty draft.
  // Only explicitly confirmed headcount is published to 2D scoring.
  useEffect(()=>{
    setBriefHeadcount(briefReady && brief.guestsConfirmed === true ? brief.guests : null);
    return () => setBriefHeadcount(null);
  },[briefReady,brief.guests,brief.guestsConfirmed,scope]);
  function retryBrief():void { if(briefStorage.current.ready)void saveBrief(scope,undefined,undefined,sourceWriteGuard).catch(()=>{});else setBriefLoadAttempt(value=>value+1); }
  const [expanded,setExpanded]=useState(false);
  const [jevEnabled,setJevEnabled]=useState(false);
  const [run,setRun]=useState<AgentRun|null>(null);
  const [candidates,setCandidates]=useState<CandidatePreview[]>([]);
  const [recoverable,setRecoverable]=useState(false);
  const [acceptedDecisions,setAcceptedDecisions]=useState<string[]>([]);
  const runEpoch=useRef(0), recoveredScope=useRef('');
  const markerRef=useRef<RunMarker|null>(null);
  const cancelledRequest=useRef<string|null>(null);
  const [preview,setPreview]=useState<Preview|null>(null);
  const previewRef=useRef(preview);previewRef.current=preview;
  const trackedPreview=useRef<{owner:Preview;access:PendingCandidateAccess}|null>(null);
  function setTrackedPreview(next:Preview|null):void {
    if(next&&pendingCandidates&&!pendingCandidates.register('cloud',next))throw new Error('活动已变化，未保留旧方案预览。');
    if(!next&&trackedPreview.current){trackedPreview.current.access.clear('cloud',trackedPreview.current.owner);trackedPreview.current=null;}
    if(next&&pendingCandidates)trackedPreview.current={owner:next,access:pendingCandidates};
    previewRef.current=next;setPreview(next);
  }
  function capturePendingCandidates():PendingCandidateCapture|null {
    if(!pendingCandidates)return null;
    const captured=pendingCandidates.capture();if(!captured)return null;
    // A new activity can render before the old cloud preview's cleanup effect.
    // Until cleanup, never make that stale preview look like an empty workspace.
    return previewRef.current&&!captured.cloud?{...captured,cloud:true,hasPending:true}:captured;
  }
  useEffect(()=>()=>{const tracked=trackedPreview.current;if(tracked&&tracked.access===pendingCandidates){tracked.access.clear('cloud',tracked.owner);trackedPreview.current=null;}},[pendingCandidates]);
  useEffect(()=>{
    if(!pendingCandidates)return;
    const identity=()=>{const s=controller.getSnapshot();return JSON.stringify([s.user?.id,s.project?.id,s.sessionId,s.lease?.generation]);};
    let previous=identity();
    const unowner=controller.subscribe(()=>{const next=identity();if(next!==previous){previous=next;pendingCandidates.invalidate();}});
    const unchat=subscribeActiveAssistantSession(`activity:${layout.id??''}`,()=>pendingCandidates.invalidate());
    return()=>{unowner();unchat();};
  },[pendingCandidates,controller,layout.id]);
  const [expired,setExpired]=useState(false);
  const layoutRef=useRef(layout); layoutRef.current=layout;
  const materialDraftExportPending=useRef(false);
  const venueGuardRequired=useRef(!!venueSourceGuard);if(venueSourceGuard)venueGuardRequired.current=true;
  const venueGuardRef=useRef(venueSourceGuard);venueGuardRef.current=venueSourceGuard;
  const venueEpoch=useRef(0),venueGuardReady=useRef(false);
  const [,setVenueRevisionTick]=useState(0);
  useEffect(()=>{
    if(!venueSourceGuard)return;
    let active=true;venueGuardReady.current=false;venueEpoch.current++;
    try{
      const unsubscribe=venueSourceGuard.subscribeInvalidation(()=>{if(!active)return;venueEpoch.current++;setVenueRevisionTick(n=>n+1);});
      if(typeof unsubscribe!=='function')throw new Error('来源监听不可用');
      venueGuardReady.current=true;
      return()=>{active=false;venueGuardReady.current=false;venueEpoch.current++;unsubscribe();};
    }catch{venueGuardReady.current=false;venueEpoch.current++;setVenueRevisionTick(n=>n+1);return()=>{active=false;};}
  },[venueSourceGuard]);
  const venueBindingCurrent=(binding:VenueBinding|null|undefined):boolean=>{
    if(!venueGuardRequired.current)return true;
    try{const guard=venueGuardRef.current;if(!guard||!venueGuardReady.current||!binding||binding.epoch!==venueEpoch.current||!guard.isSettled(binding.scope))return false;
      const confirmed=guard.getConfirmed(binding.scope);return confirmed.status==='observed'&&confirmed.scope===binding.scope&&confirmed.digest===binding.digest;
    }catch{return false;}
  };
  async function verifyVenueBinding(base:RoomLayout,expected?:VenueBinding|null):Promise<VenueBinding|null>{
    if(!venueGuardRequired.current)return null;
    const guard=venueGuardRef.current,scope=base.id,epoch=venueEpoch.current;
    if(!guard||!venueGuardReady.current||!scope)throw new Error('场地图纸或比例资料尚未核对，请确认后重试。');
    const confirmed=guard.getConfirmed(scope);
    if(confirmed.status!=='observed'||confirmed.scope!==scope||(expected&&(expected.scope!==scope||expected.digest!==confirmed.digest||expected.epoch!==epoch)))throw new Error('场地图纸或比例资料已变化，请重新核对。');
    const observed=await readVenueSourceRevision(scope,{isSettled:()=>venueGuardRef.current===guard&&venueGuardReady.current&&venueEpoch.current===epoch&&guard.isSettled(scope)});
    const binding={scope,digest:confirmed.digest,epoch};
    if(observed.status!=='observed'||observed.scope!==scope||observed.digest!==confirmed.digest||!venueBindingCurrent(binding))throw new Error('场地图纸或比例资料尚未核对，请确认后重试。');
    return binding;
  }
  const sessionGuardRequired=useRef(!!isSessionCurrent);if(isSessionCurrent)sessionGuardRequired.current=true;
  const seatingCaptureRequired=useRef(!!captureSeatingAllocation);if(captureSeatingAllocation)seatingCaptureRequired.current=true;
  const seatingCaptureRef=useRef(captureSeatingAllocation);seatingCaptureRef.current=captureSeatingAllocation;
  const outdoorPlanCaptureRef=useRef(captureOutdoorPlan);outdoorPlanCaptureRef.current=captureOutdoorPlan;
  const seatingCurrent=(capture:Extract<SeatingAllocationCapture,{status:'ready'}>|null|undefined):boolean=>{
    if(!capture)return !seatingCaptureRequired.current;
    try{return !!seatingCaptureRef.current&&capture.isCurrent();}catch{return false;}
  };
  const sessionGuard=useRef(isSessionCurrent);sessionGuard.current=isSessionCurrent;
  const sessionValid=(token:ActivitySessionToken|null|undefined):boolean=>{
    try{return !sessionGuardRequired.current||!!sessionGuard.current&&sessionGuard.current(token);}catch{return false;}
  };
  const floorGuardRequired=useRef(!!isFloorCurrent);if(isFloorCurrent)floorGuardRequired.current=true;
  const floorGuard=useRef(isFloorCurrent);floorGuard.current=isFloorCurrent;
  const floorValid=(token:FloorSessionToken|null|undefined):boolean=>{
    try{return !floorGuardRequired.current||!!floorGuard.current&&floorGuard.current(token);}catch{return false;}
  };
  const currentLayoutGetter=useRef(getCurrentLayout);currentLayoutGetter.current=getCurrentLayout;
  const baseIsCurrent=(base:RoomLayout):boolean=>{
    try { const current=currentLayoutGetter.current?.()??layoutRef.current;return current.id===base.id&&sameRecoveryFormValue(current,base); }
    catch{return false;}
  };
  /** Read-only export fence: a later identical-looking state must not revive an old capture. */
  function captureLocalDraftExport():ReturnType<typeof captureLocalDraftIntegrityFence> {
    const owner=controllerRef.current,base=layoutRef.current,activityToken=sessionToken,selectedFloor=floorToken;
    if(!base.id||!activityToken||!selectedFloor||!sessionGuardRequired.current||!floorGuardRequired.current||!currentLayoutGetter.current)return null;
    const state=layoutStore.getState(),session=owner.getSnapshot(),scope=scopeRef.current,chatScope=`activity:${base.id}`;
    const identity={user:session.user?.id,sessionId:session.sessionId,project:session.project?.id,revision:session.revision,
      localRevision:session.localRevision,lease:session.lease?.generation,writeBlocked:session.writeBlocked,
      recoveryReady:session.recoveryReady,status:session.status};
    const storeRevision=state.revision,activeFloorIndex=state.activeFloorIndex;
    let copy:RoomLayout;try{copy=structuredClone(base);}catch{return null;}
    const chatId=getActiveAssistantSessionId(chatScope),authority=owner.localDraftAuthorityVersion(),apiUrl=owner.config.apiUrl;
    const current=()=>{
      const next=owner.getSnapshot(),store=layoutStore.getState();
      return alive.current&&controllerRef.current===owner&&scopeRef.current===scope&&isLocalActivityWorkspace(owner)&&
        sessionValid(activityToken)&&floorValid(selectedFloor)&&owner.localDraftAuthorityVersion()===authority&&owner.config.apiUrl===apiUrl&&
        next.user?.id===identity.user&&next.sessionId===identity.sessionId&&next.project?.id===identity.project&&
        next.revision===identity.revision&&next.localRevision===identity.localRevision&&next.lease?.generation===identity.lease&&
        next.writeBlocked===identity.writeBlocked&&next.recoveryReady===identity.recoveryReady&&next.status===identity.status&&
        store.revision===storeRevision&&store.activeFloorIndex===activeFloorIndex&&getActiveAssistantSessionId(chatScope)===chatId&&
        sameRecoveryFormValue(copy,store.layout)&&sameRecoveryFormValue(copy,currentLayoutGetter.current?.());
    };
    return captureLocalDraftIntegrityFence(current,[invalidate=>owner.subscribe(invalidate),invalidate=>layoutStore.subscribe(invalidate),invalidate=>subscribeActiveAssistantSession(chatScope,invalidate)]);
  }
  function captureGuardedDialogue():DialogueExportCapture|null {
    const fence=captureLocalDraftExport();
    if(!fence)return null;
    let snapshot:DialogueExportCapture|null=null;
    try {
      snapshot=captureDialogue?.()??null;
      if(!snapshot||!snapshot.isCurrent()||!fence.isCurrent()){snapshot?.release();fence.release();return null;}
      const captured=snapshot;
      return {
        project:reference=>{if(!fence.isCurrent()||!captured.isCurrent())throw new Error('活动或对话已变化，请重新导出。');return captured.project(reference);},
        isCurrent:()=>fence.isCurrent()&&captured.isCurrent(),
        release:()=>{captured.release();fence.release();},
      };
    } catch {snapshot?.release();fence.release();return null;}
  }
  const imageRef=useRef(images); imageRef.current=images;
  const alive=useRef(true);
  const inventoryGeneration=useRef(0);
  const sessionInventory=useRef<SessionCandidateInventory|null>(null);
  function inventoryScope(chatScope:string,chatId:string|null):string|null {
    const owner=controllerRef.current,actor=owner.getSnapshot().user?.id,activity=layoutRef.current.id;
    if(!actor||!activity||chatScope!==`activity:${activity}`||!chatId||getActiveAssistantSessionId(chatScope)!==chatId)return null;
    return JSON.stringify([owner.config.apiUrl,actor,activity,chatId]);
  }
  function getSessionInventory(candidate:RoomLayout,chatScope:string,chatId:string|null):CandidateInventory|undefined {
    const scope=inventoryScope(chatScope,chatId);
    return scope?inventoryForSessionCandidate(sessionInventory.current,scope,candidate):undefined;
  }
  function canRememberSessionInventory(chatScope:string,chatId:string|null):boolean{return !!inventoryScope(chatScope,chatId);}
  function rememberSessionInventory(candidate:RoomLayout,value:CandidateInventory|undefined,chatScope:string,chatId:string|null):void {
    const scope=inventoryScope(chatScope,chatId);if(!scope)return;
    const next=rememberSessionCandidateInventory(sessionInventory.current,scope,candidate,value);
    if(!sameRecoveryFormValue(sessionInventory.current,next))inventoryGeneration.current++;
    sessionInventory.current=next;
  }
  useEffect(()=>{
    const owner=controllerRef.current,chatScope=`activity:${layoutRef.current.id??''}`;
    let actor=owner.getSnapshot().user?.id??null;
    const clear=()=>{
      if(sessionInventory.current||sharedInventory.current){setTrackedPreview(null);setCandidates([]);}
      sessionInventory.current=null;inventoryGeneration.current++;
    };
    const unowner=owner.subscribe(()=>{const next=owner.getSnapshot().user?.id??null;if(next!==actor){actor=next;clear();}});
    const unchat=subscribeActiveAssistantSession(chatScope,clear);
    return ()=>{unowner();unchat();clear();};
  },[controller,layout.id]);
  const sharedInventory=useRef<{proposalId:string;preview:Preview;candidate:RoomLayout;value:CandidateInventory;fence:ReturnType<typeof captureLocalDraftIntegrityFence>;continuity:ReturnType<typeof captureLocalDraftIntegrityFence>}|null>(null);
  function getBoundCandidateInventory(selected:Preview):CandidateInventory|undefined {
    const record=sharedInventory.current;
    try{return record?.preview===selected&&record.fence?.isCurrent()&&sameRecoveryFormValue(record.candidate,selected.layout)?structuredClone(record.value):undefined;}catch{return undefined;}
  }
  useEffect(()=>()=>{sharedInventory.current?.fence?.release();sharedInventory.current?.continuity?.release();sharedInventory.current=null;inventoryGeneration.current++;},[]);
  /** Bind user-entered counts to the exact preview and live authorities, synchronously. */
  function setCandidateInventory(selected:Preview,value:CandidateInventory|undefined,chatScope:string,chatId:string|null):boolean {
    if(previewRef.current!==selected)return false;
    inventoryGeneration.current++;
    sharedInventory.current?.fence?.release();sharedInventory.current?.continuity?.release();sharedInventory.current=null;
    if(!value)return true;
    let candidate:RoomLayout,inventory:CandidateInventory;
    try{candidate=structuredClone(selected.layout);inventory=structuredClone(value);}catch{return false;}
    const owner=controllerRef.current,state=layoutStore.getState(),session=owner.getSnapshot();
    const identity=()=>{const s=owner.getSnapshot(),l=layoutStore.getState();return JSON.stringify([owner.config.apiUrl,owner.localDraftAuthorityVersion(),s.user?.id??null,s.project?.id??null,s.revision,s.localRevision,s.sessionId,s.lease?.generation??null,s.writeBlocked,l.revision,l.activeFloorIndex]);};
    // A successful apply legitimately advances cloud revisions; all other
    // authority and editor changes must still invalidate the in-flight review.
    const continuityIdentity=()=>{const s=owner.getSnapshot(),l=layoutStore.getState();return JSON.stringify([owner.config.apiUrl,owner.localDraftAuthorityVersion(),s.user?.id??null,s.project?.id??null,s.sessionId,s.lease?.generation??null,s.writeBlocked,l.revision,l.activeFloorIndex]);};
    const initial=identity(),continuityInitial=continuityIdentity(),activity=selected.sessionToken,floor=selected.floorToken;
    const continuous=()=>alive.current&&previewRef.current===selected&&controllerRef.current===owner&&agentScopeRef.current===selected.scope&&
      sessionValid(activity)&&floorValid(floor)&&venueBindingCurrent(selected.venueBinding)&&seatingCurrent(selected.seatingCapture)&&
      continuityIdentity()===continuityInitial&&getActiveAssistantSessionId(chatScope)===chatId&&sameRecoveryFormValue(candidate,selected.layout);
    const current=()=>continuous()&&identity()===initial&&
      session.project?.id===selected.proposal.project_id&&session.revision===selected.proposal.base_revision&&
      session.localRevision===selected.proposal.local_revision&&session.sessionId===selected.proposal.session_id&&session.lease?.generation===selected.proposal.generation&&
      state.activeFloorIndex===layoutStore.getState().activeFloorIndex;
    const fence=captureLocalDraftIntegrityFence(current,[
      invalidate=>owner.subscribe(()=>{if(identity()!==initial)invalidate();}),
      invalidate=>layoutStore.subscribe(()=>{if(identity()!==initial)invalidate();}),
      invalidate=>subscribeActiveAssistantSession(chatScope,()=>invalidate()),
    ]);
    const continuity=captureLocalDraftIntegrityFence(continuous,[
      invalidate=>owner.subscribe(()=>{if(continuityIdentity()!==continuityInitial)invalidate();}),
      invalidate=>layoutStore.subscribe(()=>{if(continuityIdentity()!==continuityInitial)invalidate();}),
      invalidate=>subscribeActiveAssistantSession(chatScope,()=>invalidate()),
    ]);
    sharedInventory.current={proposalId:selected.proposal.id,preview:selected,candidate,value:inventory,fence,continuity};
    return !!fence&&!!continuity;
  }
  function checkCandidateInventoryAuthority(selected:Preview,generation:number,afterCommit=false):void {
    if(generation!==inventoryGeneration.current)throw new Error('物料数量核对在应用期间已变化，请重新核对。');
    const record=sharedInventory.current;
    if(!record||record.proposalId!==selected.proposal.id)return;
    if(record.preview!==selected||!(afterCommit?record.continuity:record.fence)?.isCurrent()||!sameRecoveryFormValue(record.candidate,selected.layout))throw new Error('候选或物料数量核对已变化，请重新核对。');
    const check=checkCandidateInventory(selected.layout,record.value);
    if(check.status==='violated'||record.value.invalidInput)throw new Error(check.message);
  }
  const requestPending=useRef(false);
  const uploadQueue=useRef<Promise<void>>(Promise.resolve());
  const imageEpoch=useRef(0);
  const drawingRecheckReader=useRef<SourceRecheckReader|null>(null);
  const onDrawingRecheckReader=useCallback((reader:SourceRecheckReader|null)=>{drawingRecheckReader.current=reader;},[]);
  const [sourceRecheckNotice,setSourceRecheckNotice]=useState('');
  const [briefExportNotice,setBriefExportNotice]=useState('');
  async function exportOriginalBrief():Promise<void>{
    const base=layoutRef.current,target=scopeRef.current,token=sessionToken;
    try{
      if(!sessionValid(token)||!baseIsCurrent(base))throw new Error('活动已切换，请重新选择。');
      const record=await readSourceRecordSnapshot(`${target}:brief`);
      if(!sessionValid(token)||scopeRef.current!==target||!baseIsCurrent(base))throw new Error('活动已切换，请重新选择。');
      if(!record.present){setBriefExportNotice('当前活动没有已保存的需求记录。');return;}
      downloadReadonlyBrief(serializeReadonlyBrief(target,'original',record.value),'original');setBriefExportNotice('已准备原始本机需求记录；请核对其来源和确认状态。');
    }catch(error){if(alive.current&&scopeRef.current===target)setBriefExportNotice(error instanceof Error?error.message:'原始需求记录读取失败。');}
  }
  function exportBriefDraft():void{
    try{
      const target=scopeRef.current,base=layoutRef.current;
      if(!sessionValid(sessionToken)||!baseIsCurrent(base)||briefStorage.current.scope!==target)throw new Error('活动已切换，请重新选择。');
      if(!briefStorage.current.dirty){setBriefExportNotice('当前没有未保存的需求草稿。');return;}
      downloadReadonlyBrief(serializeReadonlyBrief(target,'draft',briefValueRef.current),'draft');setBriefExportNotice('已准备当前未保存草稿；内容仍需核对。');
    }catch(error){setBriefExportNotice(error instanceof Error?error.message:'未保存草稿无法导出。');}
  }
  async function recheckVenueSources():Promise<boolean>{
    const coordinator=sourceCoordinator,writers=sourceWriters.current,drawing=drawingRecheckReader.current,base=layoutRef.current,turnToken=sessionToken;
    if(!coordinator||!writers||!drawing||!writeCapability||!base.id||coordinator.scope!==base.id||writers.scope!==base.id){setSourceRecheckNotice('图纸资料暂不能重新核对，当前输入已保留。');return false;}
    let capability:ReturnType<typeof localWriteCapabilityGuard>;try{capability=localWriteCapabilityGuard(writeCapability);}catch{setSourceRecheckNotice('本机编辑权不可用，当前输入已保留。');return false;}
    const assertCurrent=()=>{capability.assertStillHeld();if(capability.signal.aborted||!alive.current||!sessionValid(turnToken)||scopeRef.current!==base.id||!baseIsCurrent(base)||sourceWriters.current!==writers||drawingRecheckReader.current!==drawing)throw new Error('当前活动或资料已变化');};
    const briefReader:SourceRecheckReader={writer:writers.brief,read:()=>readSourceRecordSnapshot(`${base.id}:brief`),matchesCurrent:value=>{
      if(!value||typeof value!=='object'||briefStorage.current.scope!==base.id||!briefStorage.current.ready||briefStorage.current.dirty)return false;
      const record=value as {present:boolean;value?:unknown};if(record.present===false)return sameRecoveryFormValue(briefValueRef.current,INITIAL_BRIEF);
      if(record.present!==true)return false;
      if(!record.value||typeof record.value!=='object'||Array.isArray(record.value))return false;
      const saved=record.value as Partial<CreativeBrief>;
      return sameRecoveryFormValue(briefValueRef.current,{...INITIAL_BRIEF,...saved,description:migrateBriefDescription(saved.description??'')});
    }};
    const imagesReader:SourceRecheckReader={writer:writers.images,read:async()=>{
      const reference=imageRef.current;if(reference.some(image=>!image.blob)||unsavedSourceDrafts(base.id).length)return {reference,equal:false};
      const persisted=await readSourceScopeSnapshotV2(base.id!);
      const sources=reference.map(image=>{const {url:_,...stored}=image;return {...stored,scope:base.id!,kind:image.kind??'photo',width:image.width!,height:image.height!};});
      const equal=await sameSourceScopeSnapshotV2(persisted,{...persisted,sources});return {reference,equal};
    },matchesCurrent:value=>!!value&&typeof value==='object'&&(value as {reference:unknown;equal:boolean}).reference===imageRef.current&&(value as {equal:boolean}).equal&&!unsavedSourceDrafts(base.id).length};
    setSourceRecheckNotice('正在核对已保存的图纸资料…');
    const ok=await recheckSourceEditors(coordinator,base.id,{brief:briefReader,drawing,images:imagesReader},assertCurrent);
    if(alive.current&&sessionValid(turnToken)&&scopeRef.current===base.id)setSourceRecheckNotice(ok?'图纸资料已重新核对，请重新确认场地尺寸。':'资料已变化或读取失败，当前输入已保留，请人工核对。');
    return ok;
  }
  useLayoutEffect(()=>{operationEpoch.current++;},[layout,controller,cloud.user?.id,cloud.project?.id]);
  const controllerRef=useRef(controller);controllerRef.current=controller;
  async function assertCurrentLocalRecords(currentLayout:RoomLayout):Promise<void> {
    const currentScope=agentScopeRef.current,currentBrief=briefRef.current;
    await assertGeometryActionSource(currentLayout,controller);
    if(!alive.current||layoutRef.current!==currentLayout||agentScopeRef.current!==currentScope||briefRef.current!==currentBrief)throw new Error('核对资料期间项目或需求已变化，当前输入已保留，请重试。');
  }
  const requestedCloudCheckins=typeof window!=='undefined'&&new URL(window.location.href).searchParams.has('project');
  const checkinCapability=useRef<{value:LocalWriteCapability;revoked:boolean}|null>(null);
  if(!checkinCapability.current&&writeCapability)checkinCapability.current={value:writeCapability,revoked:false};
  else if(checkinCapability.current&&writeCapability!==checkinCapability.current.value)checkinCapability.current.revoked=true;
  const checkins=useMaterialCheckins({projectId:layout.id,enabled:!!layout.id&&isLocalActivityWorkspace(controller,requestedCloudCheckins),
    ...(checkinCapability.current ? {writeCapability:checkinCapability.current.value} : {}),prepareWrite:async()=>{
    const target=scopeRef.current,owner=controllerRef.current,lease=editorLease.current,userId=owner.getSnapshot().user?.id;
    if(!lease||lease.scope!==target)throw new Error('项目资料尚未准备完成，请稍后保存点验。');
    const check=()=>{
      if(checkinCapability.current?.revoked)throw new Error('本机编辑权已变化，点验输入已保留，请重新核对。');
      sourceWriteGuard?.assertStillHeld();if(sourceWriteGuard?.signal.aborted)throw new Error('本机编辑权已失效，点验输入已保留。');
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
  function beginBackupOperation(assertSwitchCurrent?:()=>void) {
    if(backupBusy.current)throw new Error('正在处理备份，请等待当前操作完成。');
    backupBusy.current=true;setBackupPending(true);
    if(briefTimer.current!==undefined){clearTimeout(briefTimer.current);briefTimer.current=undefined;}
    const base={layout:layoutRef.current,scope:scopeRef.current,epoch:operationEpoch.current,edits:briefEditEpoch.current,user:controller.getSnapshot().user?.id,project:controller.getSnapshot().project?.id};
    return {base,check(){
      assertSwitchCurrent?.();
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
    operation.check();
    await flushSourceScope(operation.base.scope,scopeWriteGuards.current.get(operation.base.scope));operation.check();
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
    const taskGuard=sourceWriteGuard;
    if(sourceRecovery.current)throw new Error('请先完成图纸资料的恢复回退，再准备评审。');
    if(checkinRecovery.current)throw new Error('请先完成点验资料的恢复回退，再准备评审。');
    const source=getReviewSource();
    if(failedRollback.current?.scope===source.scope||undoRecovery.current?.some(entry=>entry.scope===source.scope))throw new Error('请先完成资料恢复或撤销恢复，再准备评审。');
    const operation=beginBackupOperation();
    try{
      // Flush only the brief being exported. Rewriting an unchanged reconstruction
      // form would reload its reference image and invalidate this very preparation.
      await briefHydration.current;operation.check();
      await saveBrief(operation.base.scope,undefined,undefined,taskGuard);operation.check();
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
  async function disconnectSceneForRestore(purpose:'restore'|'fresh'='restore'):Promise<void> {
    if(!controller.getSnapshot().geometryBinding)return;
    const before={layout:layoutRef.current,scope:scopeRef.current,edits:briefEditEpoch.current,user:controller.getSnapshot().user?.id};
    await controller.disconnectGeometryWorkbench();
    if(!alive.current||controllerRef.current!==controller||layoutRef.current!==before.layout||scopeRef.current!==before.scope||briefEditEpoch.current!==before.edits||controller.getSnapshot().user?.id!==before.user)throw new Error(purpose==='fresh'?'断开场景连接期间活动有新改动，未继续新建。当前资料已保留，请重新核对。':'断开场景连接期间活动有新改动，未继续恢复。当前资料已保留，请重新核对。');
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
    briefStorage.current={scope:targetScope,ready:true,dirty:false,revision:0,error:null,edits:{},legacyOriginal:saved&&!hasPreservedLegacyBrief(saved,saved)?structuredClone(saved):null};
    briefValueRef.current=saved===undefined?INITIAL_BRIEF:{...INITIAL_BRIEF,...prepareLegacyBriefPreservation(saved)};
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
  async function createFreshActivity(candidate:LocalProjectRestoreCandidate,assertSwitchCurrent?:()=>void):Promise<void> {
    assertSwitchCurrent?.();
    if(requestPending.current)throw new Error('助手仍在处理，请先等待或取消当前任务，再新建活动。');
    if(!isLocalActivityWorkspace(controller))throw new Error('当前工作台连接了云项目，请先切换到本地项目再新建活动。');
    if(!commitFreshActivityLayout)throw new Error('此工作台尚未开放新建活动。');
    const checked=validateLocalProjectRestoreCandidate(candidate);
    if(checked.source!=='backup'||checked.backupVersion!==3||checked.brief.status!=='absent'||checked.materialCheckins.status!=='absent'||checked.sourceDocuments.status!=='not-in-file')throw new Error('新建活动不能用来恢复旧备份。');
    const proposed=checked.layout;
    if(proposed.eventOperations||proposed.productionPlan||proposed.designBook||proposed.floorPlanImage||proposed.itemLayers)throw new Error('新建活动不能带入旧的执行资料或方案历史。');
    const proposedId=proposed.id;
    if(!isFreshActivityId(proposedId)||proposedId===scopeRef.current)throw new Error('新活动编号无效或与当前活动重复，未切换。');
    assertSwitchCurrent?.();
    const lease=writeCapability?localWriteCapabilityGuard(writeCapability):undefined;
    lease?.assertStillHeld();
    await disconnectSceneForRestore('fresh');
    assertSwitchCurrent?.();
    lease?.assertStillHeld();
    const operation=beginBackupOperation(assertSwitchCurrent);
    try {
      await flushBackupBase(operation);
      lease?.assertStillHeld();
      await releaseEditorForRestore(false);
      operation.check();
      await withSourceRestoreLock([operation.base.scope,proposedId],async()=>{
        operation.check();
        lease?.assertStillHeld();
        const clearance=await proveFreshActivityScopeUnused(proposedId,operation.base.scope);
        operation.check();
        lease?.assertStillHeld();
        flushSync(()=>{
          operation.check();
          lease?.assertStillHeld();
          commitFreshActivityLayout!(proposed,clearance);
          adoptRestoredBrief(proposedId,undefined);
        });
      });
    } finally {endBackupOperation();}
  }
  async function restoreBackup(candidate:LocalProjectRestoreCandidate,assertSwitchCurrent?:()=>void):Promise<void> {
    requireLocalRestoreAvailable();
    assertSwitchCurrent?.();
    invalidateReviewSource();
    assertLocalRestore();
    const checked=validateLocalProjectRestoreCandidate(candidate);
    assertSwitchCurrent?.();
    await disconnectSceneForRestore();
    assertSwitchCurrent?.();
    assertLocalRestore();
    if(undoRecovery.current)throw new Error('上次撤销恢复的资料回退尚未完成，请先重试撤销；当前所选文件仍保留。');
    // File provenance remains meaningful even for programmatic restore callers.
    const priorId=preparedRestoreIds.current.get(candidate);
    const next=prepareRestoreLayout!(!checked.layout.id&&priorId?{...checked.layout,id:priorId}:checked.layout),targetScope=next.id??'local';
    const incomingSources=checked.sourceDocuments?.status==='present'?{scope:targetScope,...await decodeSourceDocuments(checked.sourceDocuments,targetScope)}:undefined;
    assertSwitchCurrent?.();
    if(!candidate.layout.id&&next.id)preparedRestoreIds.current.set(candidate,next.id);
    const desired=checked.brief.status==='present'?checked.brief.value:undefined;
    const targetDraft=briefDrafts.current.get(targetScope);
    const operation=beginBackupOperation(assertSwitchCurrent);
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
          const saved=await writeAndReadBrief(targetScope,desired,operation.check);assertLocalRestore();operation.check();
          flushSync(()=>{operation.check();commitRestoredLayout!(next);adoptRestoredBrief(targetScope,saved);});
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
  const canUndoRestore=localRestoreAvailable()&&!!undoPoint&&!backupPending&&!busy&&undoPoint.afterLayout===layout&&undoPoint.afterEdits===briefEditEpoch.current&&isLocalActivityWorkspace(controller)&&
    (!undoPoint.checkinChange||!!checkinRecovery.current||checkins.ready&&sameCheckins(checkins.ledger,undoPoint.checkinChange.attempted));
  async function undoRestore():Promise<void> {
    requireLocalRestoreAvailable();
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
    const writer=sourceWriters.current?.scope===scope?sourceWriters.current.images:null;let readTicket:object|undefined;try{readTicket=writer?.beginRead();}catch{/* coordinator remains unknown */}
    const epoch=++imageEpoch.current;
    const cached=unsavedSourceDrafts(scope).filter(draft=>draft.ready).map(draft=>draft.image);
    uploadQueue.current=listStoredSources(scope).then(stored=>{
      if(!alive.current || epoch!==imageEpoch.current)return;
      const currentDrafts=unsavedSourceDrafts(scope).filter(draft=>draft.ready).map(draft=>draft.image);
      const restored=stored.filter(source=>source.blob&&!currentDrafts.some(image=>image.id===source.id)).map(source=>({...source,url:URL.createObjectURL(source.blob!)}));
      for(const image of restored)savedImages.current.add(image);
      imageRef.current=[...currentDrafts,...restored];setImages(imageRef.current);
      if(writer&&readTicket)try{if(unsavedSourceDrafts(scope).length)writer.readFailed(readTicket);else writer.readSucceeded(readTicket);}catch{/* stale writer remains unknown */}
    }).catch(()=>{if(writer&&readTicket)try{writer.readFailed(readTicket);}catch{/* stale writer remains unknown */}});
    const pendingUrls=new Set(unsavedSourceDrafts().map(draft=>draft.image.url));
    for(const image of imageRef.current) if(!pendingUrls.has(image.url))URL.revokeObjectURL(image.url);
    imageRef.current=cached;
    setImages(cached);
  },[scope]);
  useEffect(()=>{
    if(preservingPreparation.current)return;
    if(!cloud.user||!geometryProjectId(controller,scope))return;
    const writer=sourceWriters.current?.scope===scope?sourceWriters.current.images:null;let readTicket:object|undefined;try{readTicket=writer?.beginRead();}catch{/* coordinator remains unknown */}
    let cancelled=false;
    void uploadQueue.current.then(async()=>{
      const sources=await controller.listSources();
      const saved=await listStoredSources(scope);
      const missing=sources.filter(source=>!imageRef.current.some(image=>image.assetId===source.assetId));
      const restored=await Promise.all(missing.map(async source=>({...source,kind:saved.find(image=>image.assetId===source.assetId)?.kind??source.kind,id:saved.find(image=>image.assetId===source.assetId)?.id??source.assetId,url:await controller.sourceImageUrl(source.assetId),uploadedKind:source.kind})));
      if(cancelled||scopeRef.current!==scope)return;
      imageRef.current=[...imageRef.current,...restored.filter(source=>!imageRef.current.some(image=>image.assetId===source.assetId))].slice(0,12);setImages(imageRef.current);
      if(writer&&readTicket)try{if(imageRef.current.some(image=>!image.blob)||unsavedSourceDrafts(scope).length)writer.readFailed(readTicket);else writer.readSucceeded(readTicket);}catch{/* stale writer remains unknown */}
    }).catch(error=>{if(writer&&readTicket)try{writer.readFailed(readTicket);}catch{/* stale writer remains unknown */}if(!cancelled)setNotice(error instanceof Error?error.message:'云端资料暂时无法恢复，资料已保留。');});
    return()=>{cancelled=true;};
  },[controller,cloud.user,cloud.project?.id,scope]);
  useEffect(()=>registerSourceFlush(scope,async(guard)=>{
    const taskGuard=guard??scopeWriteGuards.current.get(scope);
    await Promise.all([uploadQueue.current,briefHydration.current]);
    if(!alive.current||scopeRef.current!==scope)throw new Error('场地资料正在切换，请稍后重试创建项目。');
    await Promise.all([
      saveBrief(scope,undefined,undefined,taskGuard),
      ...(sourceRecovery.current?[]:imageRef.current.filter(image=>!savedImages.current.has(image)).map(async image=>{
        const {url,...stored}=image;const source={...stored,scope,kind:image.kind??'photo',width:image.width!,height:image.height!};
        if(taskGuard)await storeSource(source,taskGuard);else await storeSource(source);savedImages.current.add(image);markSourceDraftSaved(scope,image);
      })),
    ]);
  }),[scope,saveBrief]);
  const briefKey=JSON.stringify({brief,images:images.map(i=>({id:i.id,kind:i.kind}))});
  const briefRef=useRef(briefKey); briefRef.current=briefKey;
  const connection=!cloud.configured?'离线引导':busy&&preparation.current?'正在准备工作台':!cloud.user||cloud.writeBlocked?'功能已开放':'项目已连接';
  const stale=!!preview && (!sessionValid(preview.sessionToken) || !floorValid(preview.floorToken) || !venueBindingCurrent(preview.venueBinding) || !seatingCurrent(preview.seatingCapture) || expired || Date.parse(preview.proposal.expires_at)<=Date.now() || preview.scope!==agentScope || preview.base!==layout || preview.briefKey!==briefKey || cloud.writeBlocked || preview.proposal.project_id!==cloud.project?.id || preview.proposal.base_revision!==cloud.revision || preview.proposal.local_revision!==cloud.localRevision || preview.proposal.session_id!==cloud.sessionId || preview.proposal.generation!==cloud.lease?.generation);
  useEffect(()=>{ alive.current=true; const lifecycleEpoch=imageEpoch; return ()=>{ alive.current=false; lifecycleEpoch.current++; const pendingUrls=new Set(unsavedSourceDrafts().map(draft=>draft.image.url));for(const img of imageRef.current)if(!pendingUrls.has(img.url))URL.revokeObjectURL(img.url); }; },[]);
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
  useEffect(()=>{
    try { if((currentLayoutGetter.current?.()??layoutRef.current).id!==layoutRef.current.id)return; }
    catch{return;}
    onPreview?.(preview&&!stale&&baseIsCurrent(preview.base)?preview.layout:null);
  },[onPreview,preview,stale]);
  useEffect(()=>()=>onPreview?.(null),[onPreview]);
  function say(text:string,modelSuggestions?:SceneProposal['modelSuggestions'],materialSuggestions?:SceneProposal['materialSuggestions']):void { setMessages(items=>[...items.slice(-38),{id:crypto.randomUUID(),role:'assistant',text,modelSuggestions,materialSuggestions}]); }
  function sayModel(text:string,modelText:string|undefined,modelSuggestions?:SceneProposal['modelSuggestions'],materialSuggestions?:SceneProposal['materialSuggestions']):void { setMessages(items=>[...items.slice(-38),{id:crypto.randomUUID(),role:'assistant',text,modelText,modelSuggestions,materialSuggestions}]); }
  function beginImagesWrite(targetScope:string){
    const writer=sourceWriters.current?.scope===targetScope?sourceWriters.current.images:null;let ticket:object|undefined;
    try{writer?.markDirty();ticket=writer?.beginWrite();}catch{/* unavailable observer stays unknown */}
    return {writer,ticket};
  }
  function finishImagesWrite(pending:ReturnType<typeof beginImagesWrite>,ok:boolean){
    if(pending.writer&&pending.ticket)try{pending.writer.finishWrite(pending.ticket,ok);}catch{/* stale writer stays unknown */}
  }

  async function addImages(files: FileList|null, requestedKind?: ReferenceImage['kind']):Promise<void> {
    if(backupBusy.current||sourceRecovery.current)throw new Error('正在处理备份或图纸回退，请完成后再添加图片。');
    if(!files?.length) return;
    // Snapshot before the input is cleared. Every selection is processed in
    // order; a second selection no longer invalidates the first decode.
    const batch=Array.from(files);
    const epoch=imageEpoch.current, imageScope=scopeRef.current, taskGuard=sourceWriteGuard;
    const tracked=beginImagesWrite(imageScope);let saved=false;
    // Keep the original File immediately, including while decoding or waiting in the queue.
    const staged=batch.map(file=>{
      if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>5*1024*1024)return null;
      const image:ReferenceImage={id:crypto.randomUUID(),name:file.name,url:URL.createObjectURL(file),blob:file};
      rememberUnsavedSource(imageScope,image,false);return image;
    });
    const active=()=>alive.current&&epoch===imageEpoch.current&&imageScope===scopeRef.current;
    const task=uploadQueue.current.then(async()=>{
      if(!active()) return;
      setNotice('');
      const added:ReferenceImage[]=[];
      try {
        if(batch.length+imageRef.current.length>12) throw new Error('最多添加 12 张图纸或现场照片。');
        for(const [index,file] of batch.entries()) {
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
          const pending=staged[index]!;
          const image:ReferenceImage={...pending,width,height,kind};rememberUnsavedSource(imageScope,image,true);
          if(!active()) break;
          added.push(image);
        }
        if(!active()) return;
        // Update the ref immediately: the following queued batch can start
        // before React commits this state, and must still see the new count.
        imageRef.current=[...imageRef.current,...added];
        setImages(imageRef.current);
        setAutoGenerateRequest(value=>value+1);
        try { await Promise.all(added.map(async image=>{const {url,...stored}=image;const source={...stored,scope:imageScope,kind:image.kind??'photo',width:image.width!,height:image.height!};if(taskGuard)await storeSource(source,taskGuard);else await storeSource(source);savedImages.current.add(image);markSourceDraftSaved(imageScope,image);})); saved=active()&&!unsavedSourceDrafts(imageScope).length; } catch(error) { if(active()) setNotice(error instanceof Error?error.message:'本机保存失败，图片仍在本次会话中。'); }
      } catch(error) { if(active()) setNotice(error instanceof Error?error.message:'图片无法读取，请更换文件。'); }
    });
    void task.then(()=>finishImagesWrite(tracked,saved),()=>finishImagesWrite(tracked,false));
    uploadQueue.current=task;
    return task;
  }
  function removeImage(id:string):void {
    if(backupBusy.current||sourceRecovery.current)return;
    const image=imageRef.current.find(value=>value.id===id);if(!image)return;
    const requestedScope=scopeRef.current,epoch=imageEpoch.current,taskGuard=sourceWriteGuard;
    const tracked=beginImagesWrite(requestedScope);let saved=false;
    const task=uploadQueue.current.then(async()=>{
      if(scopeRef.current!==requestedScope||imageEpoch.current!==epoch)return;
      taskGuard?.assertStillHeld();if(taskGuard?.signal.aborted)throw new Error('本机写入租约已失效。');
      if(image.assetId)await controller.removeSource(image.assetId);
      if(scopeRef.current!==requestedScope||imageEpoch.current!==epoch||!imageRef.current.includes(image))return;
      if(taskGuard)await deleteSource(id,taskGuard);else await deleteSource(id);
      if(scopeRef.current!==requestedScope||imageEpoch.current!==epoch)return;
      removeSourceDraft(requestedScope,id);URL.revokeObjectURL(image.url);imageRef.current=imageRef.current.filter(value=>value.id!==id);setImages(imageRef.current);saved=!unsavedSourceDrafts(requestedScope).length;
    });
    void task.then(()=>finishImagesWrite(tracked,saved),()=>finishImagesWrite(tracked,false));uploadQueue.current=task.catch(error=>{if(scopeRef.current===requestedScope)setNotice(error instanceof Error?error.message:'项目资料移除失败，请重试。');});
  }
  function updateImage(id:string,patch:Partial<VenuePhoto>):void {
    if(backupBusy.current||sourceRecovery.current)return;
    const tracked=beginImagesWrite(scope);let saved=false;
    imageRef.current=imageRef.current.map(image=>image.id===id?{...image,...patch}:image);setImages(imageRef.current);
    const updated=imageRef.current.find(image=>image.id===id);
    if(updated){const {url,...stored}=updated;const epoch=imageEpoch.current,taskGuard=sourceWriteGuard;
      if(updated.blob)rememberUnsavedSource(scope,updated,true);
      const current=()=>alive.current&&scopeRef.current===scope&&imageEpoch.current===epoch;
      const write=uploadQueue.current.then(async()=>{if(current()){const source={...stored,scope,kind:stored.kind??'photo',width:stored.width!,height:stored.height!};if(taskGuard)await storeSource(source,taskGuard);else await storeSource(source);savedImages.current.add(updated);markSourceDraftSaved(scope,updated);saved=!unsavedSourceDrafts(scope).length;}});
      void write.then(()=>finishImagesWrite(tracked,saved),()=>finishImagesWrite(tracked,false));
      uploadQueue.current=write.catch(error=>{if(current())setNotice(error instanceof Error?error.message:'资料保存失败。');});}
    else finishImagesWrite(tracked,false);
  }
  function forgetRun():void {
    markerRef.current=null;setRecoverable(false);
    try { localStorage.removeItem(runStorageKey(agentScopeRef.current)); } catch { /* A leftover marker can only trigger a status read. */ }
  }
  /** Snapshot only controller-owned identity and the active project lease. */
  function annotationProjectBinding(base:RoomLayout):AnnotationProjectBinding|null {
    try {
      const state=controller.getSnapshot(),lease=state.lease,localActivityId=base.id;
      if(!localActivityId||!state.user?.id||!state.project?.id||!lease||state.writeBlocked||
        lease.projectId!==state.project.id||lease.sessionId!==state.sessionId||
        !Number.isFinite(Date.parse(lease.expiresAt))||Date.parse(lease.expiresAt)<=Date.now())return null;
      const mappedProjectId=geometryProjectId(controller,localActivityId);if(!mappedProjectId)return null;
      return {actorId:state.user.id,sessionId:state.sessionId,leaseGeneration:lease.generation,localActivityId,projectId:state.project.id,mappedProjectId};
    }catch{return null;}
  }
  function candidateAnnotationReview(selected:Preview,candidate:RoomLayout=selected.layout):AnnotationReviewResult|null {
    const evidence=selected.annotationEvidence;if(!evidence)return null;
    try {
      const current=selected.seatingCapture?.readAnnotationReview?.()??null;
      const currentBase=currentLayoutGetter.current?.()??layoutRef.current;
      const proposalBound=!!evidence.projectBinding&&selected.proposal.user_id===evidence.projectBinding.actorId&&selected.proposal.session_id===evidence.projectBinding.sessionId&&selected.proposal.generation===evidence.projectBinding.leaseGeneration;
      return reviewAgentAnnotations({observation:evidence.observation,currentObservation:current?.observation??{status:'unavailable'},
        provenance:evidence.provenance,currentProvenance:current?.provenance??[],capturedBase:evidence.base,currentBase,candidate,
        candidateBinding:evidence.observation.status==='ready'?evidence.observation.binding:null,
        projectBinding:evidence.projectBinding,currentProjectBinding:proposalBound?annotationProjectBinding(selected.base):null,proposalProjectId:selected.proposal.project_id});
    }catch{return reviewAgentAnnotations({observation:{status:'unavailable'},currentObservation:{status:'unavailable'},provenance:[],currentProvenance:[],
      capturedBase:evidence.base,currentBase:evidence.base,candidate,candidateBinding:null,projectBinding:null,currentProjectBinding:null,proposalProjectId:null});}
  }
  function candidateAnnotationAdvisory(selected:Preview):string|null {
    const result=candidateAnnotationReview(selected);if(!result)return null;
    return result.status==='violated'?ANNOTATION_BLOCK:'规划标注尚未完整核验；路线净宽、出入口、消防与现场条件仍需核对。本次仅供预览，暂不能应用。';
  }
  function annotationBindingCurrent(selected:Preview):boolean {
    const captured=selected.annotationEvidence?.projectBinding;
    if(!captured)return true; // The review remains unknown; no authority is inferred.
    return selected.proposal.user_id===captured.actorId&&selected.proposal.project_id===captured.projectId&&
      selected.proposal.session_id===captured.sessionId&&selected.proposal.generation===captured.leaseGeneration&&
      sameRecoveryFormValue(captured,annotationProjectBinding(selected.base));
  }
  function candidateRequirementError(base: RoomLayout, candidate: RoomLayout): string | null {
    const selected=previewRef.current;
    if(selected?.base===base && selected.annotationEvidence){
      if(candidateAnnotationReview(selected,candidate)?.status==='violated')return ANNOTATION_BLOCK;
      return '规划标注和现场条件尚未完整核验，本次仅供预览，暂不能应用。';
    }
    return validateCandidateRequirements?.(base, candidate) ?? null;
  }
  function candidateSeatAdvisory(selected:Preview):string|null {
    if(!captureDialogue)return null;
    let capture:DialogueExportCapture|null=null;
    try {
      capture=captureDialogue();
      if(!capture||!capture.isCurrent()||previewRef.current!==selected)return '当前对话需求暂未核对，座席数量待核验。';
      const snapshot=capture.project({guests:brief.guestsConfirmed===true?brief.guests:null});
      if(!capture.isCurrent()||previewRef.current!==selected||snapshot.availability!=='available'||snapshot.comparison.headcount==='conflict')return '当前对话需求暂未核对，座席数量待核验。';
      const {headcount,layoutMode,allSeated}=snapshot.fields;
      if(layoutMode.status!=='recorded'||layoutMode.value!=='desk-chair')return null;
      if(headcount.status!=='recorded'||!Number.isSafeInteger(headcount.value)||!headcount.value||headcount.value<1)return '课桌椅布局的人数尚未确认，座席数量待核验。';
      const seats=countSingleSeats(selected.layout,selected.floorToken?.floorIndex??layoutStore.getState().activeFloorIndex);
      if(seats===null)return `按 ${headcount.value} 人规划课桌椅；候选场地或楼层信息不完整，座席数量待核验。`;
      const target=headcount.strength==='must'?`${headcount.value} 人`:`约 ${headcount.value} 人`;
      const note=allSeated.status==='recorded'?(allSeated.value===false?'已说明不要求人人入座。':'已要求所有人入座。'):'是否需要所有人入座仍需核对。';
      const coverage=seats<headcount.value?'目前不能确认座席足以覆盖规划人数。':'椅子数量达到规划人数，但不能代替座席核验。';
      return `按 ${target} 规划课桌椅，候选共识别 ${seats} 把单人椅（包括原有和新增）。${note}${coverage}其他家具容量、座位用途、桌椅配比及现场条件仍需核验。`;
    } catch {return '当前对话需求暂未核对，座席数量待核验。';}
    finally {capture?.release();}
  }
  function currentApplyRecovery(): ApplyRecovery | null {
    const projectId=controller.getSnapshot().project?.id;
    return (projectId && readApplyRecovery(projectRecoveryScope(controller.config.apiUrl,projectId))) || readApplyRecovery(agentScopeRef.current);
  }
  /** Refuse to forget an unknown run or an unreadable recovery marker. */
  function discardPreviewForHistoryReview():boolean {
    if(!alive.current||!sessionValid(sessionToken)||requestPending.current||recoverable||applyRecoveryRef.current||reviewingApplyRecovery)return false;
    try {
      const storage=localStorageOrNull();if(!storage)return false;
      const scope=agentScopeRef.current,key=runStorageKey(scope),projectId=controller.getSnapshot().project?.id;
      if(storage.getItem(applyRecoveryKey(scope))!==null || (projectId&&storage.getItem(applyRecoveryKey(projectRecoveryScope(controller.config.apiUrl,projectId)))!==null))return false;
      const raw=storage.getItem(key);
      if(raw!==null){
        const marker=JSON.parse(raw) as RunMarker;
        // Only a visible terminal result belonging to this exact run may be
        // discarded; unknown/running tasks keep their ID for later readback.
        if(!previewRef.current||run?.state!=='complete'||!marker.runId||marker.runId!==run.id||markerRef.current?.runId!==run.id)return false;
        storage.removeItem(key);
        if(storage.getItem(key)!==null)return false;
      } else if(markerRef.current)return false;
      markerRef.current=null;setRecoverable(false);setTrackedPreview(null);setCandidates([]);
      return true;
    } catch {return false;}
  }
  async function reviewApplyRecovery(): Promise<void> {
    const turnToken=sessionToken;if(!sessionValid(turnToken))return;
    const recovery=applyRecoveryRef.current;
    if(!recovery || reviewingApplyRecovery)return;
    const currentScope=agentScopeRef.current,recoveryScope=recovery.storageScope ?? currentScope;
    setReviewingApplyRecovery(true);setApplyRecoveryReview(null);
    try {
      if(!recovery.projectId) {
        setApplyRecoveryReview({proposalId:recovery.proposalId,status:'unknown',message:'核对记录不完整，无法自动读取项目；请手动打开云项目对照。'});
        return;
      }
      const review=await withApplyLock(recoveryScope,async()=>{
        const stored=readApplyRecovery(recoveryScope);
        if(!stored || stored.projectId!==recovery.projectId || stored.proposalId!==recovery.proposalId || stored.revision!==recovery.revision) throw new Error('记录已变化');
        const project=await controller.peekProject(recovery.projectId);
        if(project.id.toLowerCase()!==recovery.projectId.toLowerCase() || !Number.isInteger(project.revision)) throw new Error('读取结果无效');
        const hash=await sceneHash(project.scene);
        const candidateMatches=!!recovery.candidateHash && project.revision===recovery.revision && hash===recovery.candidateHash;
        const baseMatches=!!recovery.baseHash && recovery.baseRevision!==undefined && project.revision===recovery.baseRevision && hash===recovery.baseHash;
        const status:ApplyRecoveryReview['status']=candidateMatches?'candidate_matches':baseMatches?'base_matches':'unknown';
        const message=candidateMatches
          ? `云端当前第 ${project.revision} 版与这次候选内容一致；仍需核对本地草稿。`
          : baseMatches ? `云端当前第 ${project.revision} 版与提交前场景一致；仍不能排除请求稍后完成，请继续核对。`
          : `云端当前第 ${project.revision} 版，无法仅凭现有记录确定本次应用状态；请手动对照。`;
        return {proposalId:recovery.proposalId,status,message,observedRevision:project.revision,observedHash:hash};
      });
      if(alive.current&&sessionValid(turnToken)&&agentScopeRef.current===currentScope)setApplyRecoveryReview(review);
    } catch {
      if(alive.current&&sessionValid(turnToken)&&agentScopeRef.current===currentScope)setApplyRecoveryReview({proposalId:recovery.proposalId,status:'unknown',message:'暂时无法只读核对云端版本；结果仍未知，请检查连接或手动核对。'});
    } finally {if(alive.current&&sessionValid(turnToken)&&agentScopeRef.current===currentScope)setReviewingApplyRecovery(false);}
  }
  async function acknowledgeApplyRecovery(): Promise<void> {
    const turnToken=sessionToken;if(!sessionValid(turnToken))return;
    const recovery=applyRecoveryRef.current;
    const recoveryScope=recovery?.storageScope ?? agentScopeRef.current;
    const currentScope=agentScopeRef.current;
    const review=applyRecoveryReview;
    if(!recovery || !review || review.proposalId!==recovery.proposalId){setNotice('请先查看云端只读核对结果，再决定是否解除提醒。');return;}
    try {
      await withApplyLock(recoveryScope,async()=>{
        if(!sessionValid(turnToken))throw new Error('活动已切换，提醒仍保留');
        const storage=localStorageOrNull();
        if(!storage) throw new Error('本机存储不可用');
        const key=applyRecoveryKey(recoveryScope),raw=storage.getItem(key);
        if(raw && recovery?.proposalId) {
          const stored:unknown=JSON.parse(raw);
          const value=stored as Partial<ApplyRecovery>;
          if(!stored || typeof stored!=='object' || value.proposalId!==recovery.proposalId || value.projectId!==recovery.projectId || value.revision!==recovery.revision
            || value.baseRevision!==recovery.baseRevision || value.baseHash!==recovery.baseHash || value.candidateHash!==recovery.candidateHash) throw new Error('核对记录已变化');
        }
        if(review.observedRevision!==undefined && review.observedHash) {
          const remote=await controller.peekProject(recovery.projectId);
          if(remote.id.toLowerCase()!==recovery.projectId.toLowerCase() || remote.revision!==review.observedRevision || await sceneHash(remote.scene)!==review.observedHash) {
            throw new Error('云端版本已变化，请重新只读核对');
          }
        }
        if(!sessionValid(turnToken))throw new Error('活动已切换，提醒仍保留');
        storage.removeItem(key);
        if(storage.getItem(key)!==null) throw new Error('提醒仍然存在');
      });
      if(alive.current && sessionValid(turnToken) && agentScopeRef.current===currentScope){applyRecoveryRef.current=null;setApplyRecovery(null);setApplyRecoveryReview(null);setNotice('已解除版本差异提醒；请确保本地与云端内容已经核对。');}
    } catch(error) { if(alive.current && sessionValid(turnToken) && agentScopeRef.current===currentScope)setNotice(error instanceof Error ? `${error.message}，提醒尚未清除。` : '提醒暂时无法清除，请恢复本机存储后重试。'); }
  }
  function rememberRun(marker:RunMarker,scope:string):void {
    // Saving the identity before POST prevents accidental duplicate paid runs after disconnects.
    localStorage.setItem(runStorageKey(scope),JSON.stringify(marker));
    markerRef.current=marker;
  }
  async function consumeRun(result:AgentRun,base:RoomLayout,submittedBrief:string,submittedScope:string,epoch:number,turnToken:ActivitySessionToken|null|undefined,turnFloor:FloorSessionToken|null|undefined,venueBinding:VenueBinding|null,seatingCapture:Extract<SeatingAllocationCapture,{status:'ready'}>|null,annotationEvidence?:AnnotationEvidence):Promise<UnchangedRunResult|void> {
    if(!alive.current||epoch!==runEpoch.current||agentScopeRef.current!==submittedScope||!sessionValid(turnToken)||!floorValid(turnFloor)||!venueBindingCurrent(venueBinding)||!seatingCurrent(seatingCapture))return;
    if(result.state==='cancelled'){setCandidates([]);setTrackedPreview(null);forgetRun();say('任务已取消，当前方案保持不变。');return;}
    if(!result.candidates.length){forgetRun();sayModel(result.state==='failed'?agentRunFailureMessage(result.errorCode):'本次没有生成候选，画布未改变。',result.message);return;}
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
    setLastExplanation('上次方案说明未经核验，请以当前场景与用户要求为准。');
    if(result.candidates.length===1&&canonical(first.candidate)===canonical(scene)){
      const announce=canAnnounceRetained();
      const shortfall=result.state==='complete'&&!result.errorCode?zeroSeatingShortfall(first.warnings):null;
      forgetRun();sayModel(shortfall??'已读取当前场景，本次没有修改物件。',first.explanation||(!interrupted?result.message:undefined),first.modelSuggestions,first.materialSuggestions);
      if(announce)announceRetained();
      if(shortfall)return {kind:'unchanged',runId:result.id,message:shortfall};
      return;
    }
    const prepared=await Promise.all(result.candidates.map(async item=>{
      const assets=await controller.authorizeAssets(item.proposal.candidate);
      await Promise.all(Object.entries(assets.assetUrls).map(([id,url])=>ensureGlbAsset(id,url)));
      const next=mergeProposalPresentation(base,backendSceneToLayout(item.proposal.candidate,{projectId:base.id!,name:base.name,...assets}));
      return {label:item.label,title:item.title,preview:{proposal:item.proposal,assets,layout:next,base,briefKey:submittedBrief,scope:submittedScope,sessionToken:turnToken,floorToken:turnFloor,venueBinding,seatingCapture,...(annotationEvidence?{annotationEvidence}:{})}};
    }));
    if(!alive.current||!sessionValid(turnToken)||!floorValid(turnFloor)||agentScopeRef.current!==submittedScope||epoch!==runEpoch.current||!seatingCurrent(seatingCapture))return;
    await verifyVenueBinding(base,venueBinding);
    if(!sessionValid(turnToken)||!floorValid(turnFloor)||!venueBindingCurrent(venueBinding)||!seatingCurrent(seatingCapture))return;
    if(layoutRef.current!==base||briefRef.current!==submittedBrief)throw new Error('生成期间方案或需求已变化，旧提案未应用。请根据最新内容重新生成。');
    const announce=canAnnounceRetained();
    const preferred=prepared.find(item=>item.label===result.evaluation?.choice)??prepared[0]!;
    setTrackedPreview(preferred.preview);setCandidates(prepared);sayModel(result.jevEnabled?'候选方案已准备好。可以分别预览比较，最终由你选择并确认布置。':'方案提案已返回，请核对修改范围后确认布置。',first.explanation,first.modelSuggestions,first.materialSuggestions);
    if(announce&&alive.current&&agentScopeRef.current===submittedScope&&epoch===runEpoch.current)announceRetained();
  }
  async function followRun(initial:AgentRun,base:RoomLayout,submittedBrief:string,submittedScope:string,epoch:number,turnToken:ActivitySessionToken|null|undefined,turnFloor:FloorSessionToken|null|undefined,venueBinding:VenueBinding|null,seatingCapture:Extract<SeatingAllocationCapture,{status:'ready'}>|null,annotationEvidence?:AnnotationEvidence):Promise<UnchangedRunResult|void> {
    let result=initial;
    const pollingDeadline=Date.now()+120_000;
    const active=()=>alive.current&&sessionValid(turnToken)&&floorValid(turnFloor)&&venueBindingCurrent(venueBinding)&&seatingCurrent(seatingCapture)&&agentScopeRef.current===submittedScope&&epoch===runEpoch.current;
    const pauseIfSourceChanged=()=>{if(alive.current&&sessionValid(turnToken)&&agentScopeRef.current===submittedScope&&epoch===runEpoch.current&&(!floorValid(turnFloor)||!venueBindingCurrent(venueBinding)||!seatingCurrent(seatingCapture))){setRecoverable(true);setNotice(seatingCapture?.annotationObservation?'楼层、图纸、规划标注或活动会话需求已变化，原任务编号已保留；请核对原任务状态，暂不能应用旧候选。':'楼层、图纸或活动会话需求已变化，原任务编号已保留；请核对原任务状态，暂不能应用旧候选。');}};
    if(!active()){pauseIfSourceChanged();return;}
    // 第 8 批：把云端这一趟写成运行时账本——头部「N 条思考」用的是云端给的
    // 真实模型调用轮数（call_count，上限 6 轮），步骤流用的是云端自己写的
    // 进度句（每次工具调用一条中文步骤）。前端不自己编进度。
    startAgentRun('layout');
    let lastProgress='';
    let stepStartedAt=Date.now();
    let steerNoticeShown=false;
    const eventRunId=initial.id,eventProjectId=initial.projectId,eventActor=controller.getSnapshot().user?.id;
    let eventCursor=0,eventUnavailable=!eventActor;
    const eventActive=()=>active()&&result.id===eventRunId&&controller.getSnapshot().project?.id===eventProjectId&&controller.getSnapshot().user?.id===eventActor;
    const readEvents=async(terminal:boolean):Promise<void>=>{
      if(eventUnavailable||!eventActive())return;
      // An old service may not expose events; failure never prevents the task or its preview.
      for(let page=0;page<(terminal?3:1);page++){
        let timer:ReturnType<typeof setTimeout>|undefined;
        try{
          const response=await Promise.race([
            controller.getAgentRunEvents(eventRunId,eventCursor),
            new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('event timeout')),2000);}),
          ]);
          if(!eventActive())return;
          appendAgentRunEvents(response.events);eventCursor=response.nextCursor;
          if(response.events.length<50)return;
        }catch{eventUnavailable=true;return;}
        finally{if(timer)clearTimeout(timer);}
      }
    };
    /**
     * 运行条里塞进来的备注，交给正在跑的这一趟。工作线程在下一轮模型调用之前取走，
     * 所以送达时机是「下一次它要思考的时候」，不是立刻——界面上说的也是这个。
     *
     * 任务已经收尾时会回 AGENT_RUN_STOPPED：那条备注没有执行机会，必须如实说，
     * 不能打着「已提交」的绿灯糊过去。
     */
    const deliverSteerNotes=async(current:AgentRun):Promise<void>=>{
      setAgentSteerDelivered(current.steerTotal??0);
      const pending=getAgentRun().steerNotes;
      if(!pending.length)return;
      clearAgentSteerNotes();
      for(const note of pending){
        try{await controller.steerAgentRun(current.id,note);}
        catch{
          if(!steerNoticeShown){steerNoticeShown=true;say('这趟已经收尾，你刚写的那句备注没有生效；要改的话请把要求写进新一轮。');}
          return;
        }
      }
    };
    const publish=(now:number):void=>{
      const progress=(result.progress??'').trim();
      if(progress&&progress!==lastProgress){
        if(lastProgress)closeAgentStep(now-stepStartedAt);
        lastProgress=progress;
        stepStartedAt=now;
        // 这一趟在确认前不改画布，所以每一步都是只读步——不装成写入步。
        appendAgentStep({toolName:progress,durationMs:0,isReadonly:true,startedAt:now});
      }
      setAgentThoughtCount(result.callCount);
      // 阶段是云端的真值（第几段工作），刷新后重新读档也接得上；拿不到就清空，
      // 界面不显示阶段——不拿轮数顶替阶段。
      setAgentPhase(result.phase??null);
    };
    while(active()){
      setRun(result);
      publish(Date.now());
      await readEvents(!['queued','running'].includes(result.state));
      if(!active()){pauseIfSourceChanged();return;}
      await deliverSteerNotes(result);
      if(!active()){pauseIfSourceChanged();return;}
      const marker=markerRef.current;
      if(marker){try{rememberRun({...marker,runId:result.id},submittedScope);}catch{setNotice('任务已提交，但本机记录更新失败；请保持页面打开。');}}
      if(!['queued','running'].includes(result.state))break;
      if(Date.now()>=pollingDeadline)throw new Error('任务仍在处理，已暂停自动查询。请稍后查询原任务，不要重复提交。');
      await new Promise(resolve=>setTimeout(resolve,2000));
      if(!active()){pauseIfSourceChanged();return;}
      result=await controller.getAgentRun(result.id);
    }
    if(lastProgress)closeAgentStep(Date.now()-stepStartedAt);
    // 本轮既没给候选也没改动画布 → 出空结果回执卡，不许沉默结束。
    endAgentRun({emptyOutcome:!result.candidates.length});
    if(active())return await consumeRun(result,base,submittedBrief,submittedScope,epoch,turnToken,turnFloor,venueBinding,seatingCapture,annotationEvidence);
    return;
  }
  async function recoverRun():Promise<void> {
    const turnToken=sessionToken;if(!sessionValid(turnToken))return;
    if(floorGuardRequired.current){setNotice('原任务缺少可核对的楼层版本，编号已保留；请人工核对原任务，暂不能恢复旧候选。');return;}
    if(venueGuardRequired.current){setNotice('原任务缺少可核对的图纸版本，编号已保留；请人工核对原任务，暂不能恢复旧候选。');return;}
    if(requestPending.current || applyRecoveryRef.current || currentApplyRecovery())return;
    const scope=agentScopeRef.current,base=layoutRef.current,submittedBrief=briefRef.current;
    const marker=markerRef.current;
    if(!marker)return;
    const epoch=++runEpoch.current;requestPending.current=true;setBusy(true);setRecoverable(false);setNotice('');
    try {
      await restoreRunConnection(marker,base);
      if(!sessionValid(turnToken)||epoch!==runEpoch.current||scope!==agentScopeRef.current)return;
      const result=marker.runId?await controller.getAgentRun(marker.runId):await controller.getAgentRunByRequest(marker.requestId);
      const currentSeating=seatingCaptureRef.current?.();
      const seatingCapture=currentSeating?.status==='ready'?currentSeating:null;
      // A persisted run ID does not retain in-memory annotation authority;
      // never attach today's snapshot to a run that predates this feature.
      if(marker.annotationSnapshot || seatingCapture?.annotationObservation!==undefined){setRun(result);setRecoverable(true);setNotice('已查询原任务；原标注快照无法重新核对，旧候选不可应用，任务记录已保留。');return;}
      if(seatingCaptureRequired.current&&(!seatingCapture||!marker.seatingToken||marker.seatingToken!==seatingCapture.token||!seatingCurrent(seatingCapture))){
        setRun(result);setNotice('已查询原任务；活动会话或桌椅配比无法核对，旧候选不会应用。');
        if(!['queued','running'].includes(result.state))forgetRun();else setRecoverable(true);
        return;
      }
      if(marker.baseKey!==canonical(layoutToBackendScene(base))||marker.briefKey!==submittedBrief){
        if(epoch!==runEpoch.current||scope!==agentScopeRef.current)return;
        setRun(result);setNotice('已查询原任务；场景或需求已变化，旧候选不会应用。');
        if(!['queued','running'].includes(result.state))forgetRun();else setRecoverable(true);
        return;
      }
      await followRun(result,base,submittedBrief,scope,epoch,turnToken,null,null,seatingCapture);
    } catch(error){if(epoch===runEpoch.current&&scope===agentScopeRef.current){setRecoverable(true);setNotice(error instanceof Error?error.message:'原任务状态暂不可读取，请稍后查询。');}}
    finally{if(epoch===runEpoch.current){requestPending.current=false;setBusy(false);}}
  }
  useEffect(()=>{
    if(preservingPreparation.current)return;
    if(currentApplyRecovery())return;
    if(!cloud.user||(!geometryProjectId(controller,scope)&&!isLocalActivityWorkspace(controller))||recoveredScope.current===agentScope)return;
    recoveredScope.current=agentScope;
    try{
      const raw=localStorage.getItem(runStorageKey(agentScope));
      if(!raw)return;
      const marker=JSON.parse(raw) as RunMarker;
      if(typeof marker.requestId!=='string'||typeof marker.baseKey!=='string'||typeof marker.briefKey!=='string'||(marker.runId!==undefined&&typeof marker.runId!=='string')||(marker.projectId!==undefined&&typeof marker.projectId!=='string')||(marker.seatingToken!==undefined&&typeof marker.seatingToken!=='string')||(marker.annotationSnapshot!==undefined&&marker.annotationSnapshot!==true))throw new Error('任务记录无法读取，请保留此页面记录并联系管理员核对。');
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
    const turnToken=sessionToken;if(!sessionValid(turnToken))return;
    if(preparation.current){preparation.current.cancelled=true;runEpoch.current++;say('正在停止准备，本次不会提交生成；请等待连接操作结束。');return;}
    const scope=agentScopeRef.current,marker=markerRef.current;
    if(!marker){if(requestPending.current){runEpoch.current++;requestPending.current=false;setBusy(false);say('已停止准备，本次未提交生成。');}return;}
    cancelledRequest.current=marker.requestId;
    const epoch=++runEpoch.current;requestPending.current=true;setBusy(true);setTrackedPreview(null);setCandidates([]);
    try{
      await restoreRunConnection(marker,layoutRef.current);
      if(!sessionValid(turnToken)||scope!==agentScopeRef.current||epoch!==runEpoch.current)return;
      const original=marker.runId?{id:marker.runId}:await controller.getAgentRunByRequest(marker.requestId);
      const result=await controller.cancelAgentRun(original.id);
      if(scope!==agentScopeRef.current||epoch!==runEpoch.current)return;
      setRun(result);forgetRun();say('任务已取消，当前方案保持不变。');
    }catch(error){if(scope===agentScopeRef.current&&epoch===runEpoch.current){setRecoverable(true);setNotice(error instanceof Error?error.message:'取消结果待核对，请查询原任务。');}}
    finally{if(epoch===runEpoch.current){requestPending.current=false;setBusy(false);}}
  }
  async function generate(message?:string,options?:{intent?:'model'; requirePreview?: true; seatingAllocation?:AgentRunInput['context']['seatingAllocation'] | undefined; seatingSpecs?:AgentRunInput['context']['seatingSpecs'] | undefined}):Promise<UnchangedRunResult|void> {
    const turnToken=sessionToken;if(!sessionValid(turnToken)){setNotice('活动正在切换，请稍后重试。');return;}
    let seatingCapture:Extract<SeatingAllocationCapture,{status:'ready'}>|null=null;
    try{const captured=seatingCaptureRef.current?.();if(captured?.status==='ready')seatingCapture=captured;
      else if(seatingCaptureRequired.current){setNotice('当前会话的桌椅配比尚未核对，本次没有提交。');return;}}
    catch{setNotice('当前会话的桌椅配比无法读取，本次没有提交。');return;}
    if(!seatingCurrent(seatingCapture)){setNotice(seatingCapture?.annotationObservation?'当前活动需求或规划标注已变化，本次没有提交。':'当前会话或桌椅配比已变化，本次没有提交。');return;}
    if(seatingCapture&&options?.seatingAllocation!==undefined&&!sameRecoveryFormValue(seatingCapture.value??null,options.seatingAllocation)){
      setNotice('当前会话的桌椅配比已变化，本次没有提交。');return;
    }
    if(seatingCapture&&options?.seatingSpecs!==undefined&&!sameRecoveryFormValue(seatingCapture.specs??null,options.seatingSpecs)){
      setNotice('当前会话的桌椅规格已变化，本次没有提交。');return;
    }
    const inputAllocation=seatingCapture?seatingCapture.value:options?.seatingAllocation;
    const allocationResult=inputAllocation===undefined?null:agentSeatingAllocationSchema.safeParse(inputAllocation);
    if(allocationResult&&!allocationResult.success){setNotice('桌椅配比无法核对，本次没有提交。');return;}
    const seatingAllocation=allocationResult?.success?allocationResult.data:undefined;
    const inputSpecs=seatingCapture?seatingCapture.specs:options?.seatingSpecs;
    const specsResult=inputSpecs===undefined?null:agentSeatingSpecsSchema.safeParse(inputSpecs);
    if(specsResult&&!specsResult.success){setNotice('桌椅规格无法核对，本次没有提交。');return;}
    const seatingSpecs=specsResult?.success?specsResult.data:undefined;
    const annotationObservation=seatingCapture?.annotationObservation;
    let messageForModel=seatingAllocation&&!message?.includes(seatingAllocation.evidence)&&!message?.includes(JSON.stringify(seatingAllocation.evidence))
      ?`${message?.trim()||'请按当前活动需求生成布置方案。'}\n用户原话：${JSON.stringify(seatingAllocation.evidence)}；桌椅配比仍需结合用户要求核对。`:message;
    const quotes=new Set<string>();
    for(const item of [seatingSpecs?.desk,seatingSpecs?.chair])for(const fact of Object.values(item??{}))if(fact)quotes.add(fact.evidence);
    for(const quote of quotes)if(!messageForModel?.includes(quote)&&!messageForModel?.includes(JSON.stringify(quote)))messageForModel=`${messageForModel?.trim()||'请按当前活动需求生成布置方案。'}\n桌椅规格的用户原话：${JSON.stringify(quote)}；实物与现场仍需核验。`;
    for(const [name,quote] of [['桌子',seatingCapture?.defaults?.desk],['椅子',seatingCapture?.defaults?.chair]] as const)if(quote&&!messageForModel?.includes(quote)&&!messageForModel?.includes(JSON.stringify(quote)))messageForModel=`${messageForModel?.trim()||'请按当前活动需求生成布置方案。'}\n用户选择${name}示意默认的原话：${JSON.stringify(quote)}；示意默认不是已确认实物。`;
    const turnFloor=floorToken;if(!floorValid(turnFloor)){setNotice('楼层正在切换，请稍后重试。');return;}
    const taskGuard=sourceWriteGuard;
    if(requestPending.current||recoverable)return;
    if(applyRecoveryRef.current || currentApplyRecovery()){setNotice('云端与本地版本尚待核对，请先处理版本差异。');return;}
    setExpanded(true);setNotice('');
    if(message?.trim())setMessages(items=>[...items.slice(-38),{id:crypto.randomUUID(),role:'user',text:message.trim()}]);
    const initialIntentError=validateGenerationIntent?.();
    if(initialIntentError){setNotice(initialIntentError);say(initialIntentError);return;}
    if(!cloud.configured){
      const text='生成能力尚未连接服务商。在设置里填入自定义服务商地址和密钥后即可开始；在此之前，你可以完善需求、添加现场照片，并使用物料库手动布置。';
      setNotice(text);say(text);return;
    }
    let base=layoutRef.current,submittedScope=agentScopeRef.current;
    let requestedBrief=briefRef.current;
    let venueBinding:VenueBinding|null=null;
    const epoch=++runEpoch.current;
    requestPending.current=true;setBusy(true);
    let dispatched=false,creationResponded=false,dispatchedRequestId:string|null=null;
    let ownPreparation:typeof preparation.current=null;
    try{
      venueBinding=await verifyVenueBinding(base);
      if(!alive.current||epoch!==runEpoch.current||submittedScope!==agentScopeRef.current)return;
      if(!sessionValid(turnToken)||!floorValid(turnFloor)||!baseIsCurrent(base))throw new Error('活动、楼层或场地已变化，请重新核对。');
      await assertCurrentLocalRecords(base);
      if(!briefStorage.current.ready)await briefHydration.current;
      if(!alive.current||epoch!==runEpoch.current||submittedScope!==agentScopeRef.current)return;
      const assertGenerationIntent=()=>{taskGuard?.assertStillHeld();if(taskGuard?.signal.aborted)throw new Error('本机写入租约已失效。');if(!seatingCurrent(seatingCapture))throw new Error(seatingCapture?.annotationObservation?'活动需求或规划标注已变化，本次没有提交。':'活动会话或桌椅配比已变化，本次没有提交。');const error=validateGenerationIntent?.();if(error)throw new Error(error);};
      assertGenerationIntent();
      if(!briefStorage.current.ready||briefStorage.current.scope!==(base.id??'local'))throw new Error(briefStorage.current.error??'活动需求尚未读取完成，请稍后重试。');
      if(layoutRef.current!==base)throw new Error('生成期间方案或需求已变化，旧提案未应用。请根据最新内容重新生成。');
      requestedBrief=JSON.stringify({brief:briefValueRef.current,images:imageRef.current.map(image=>({id:image.id,kind:image.kind}))});
      if(!cloud.user||cloud.writeBlocked||!geometryProjectId(controller,base.id)){
        const localGeometry=!!base.id&&isLocalActivityWorkspace(controller);
        const pending={layout:base,userId:cloud.user?.id,cancelled:false,projectId:undefined as string|undefined};
        ownPreparation=pending;preparation.current=pending;
        await flushSourceScope(base.id??'local',taskGuard);
        if(!alive.current||pending.cancelled||epoch!==runEpoch.current)return;
        if(!floorValid(turnFloor))throw new Error('楼层已变化，本次生成尚未提交。');
        await assertCurrentLocalRecords(layoutRef.current);
        if(layoutRef.current!==base||briefRef.current!==requestedBrief){say('准备期间方案或需求已变化，本次未提交。请按当前内容重新发送。');return;}
        assertGenerationIntent();
        const project=localGeometry
          ?await controller.ensureGeometryWorkbenchReady(layoutToBackendScene(base),base.name,base.id!)
          :await controller.ensureWorkbenchReady(layoutToBackendScene(base),base.name,base.id);
        if(!alive.current||pending.cancelled||epoch!==runEpoch.current)return;
        if(!floorValid(turnFloor))throw new Error('云项目已准备，但楼层已变化；本次生成尚未提交，请核对后重新发送。');
        await assertCurrentLocalRecords(layoutRef.current);
        if(layoutRef.current!==base||briefRef.current!==requestedBrief){say('准备期间方案或需求已变化，本次未提交。请按当前内容重新发送。');return;}
        assertGenerationIntent();
        pending.userId=controller.getSnapshot().user?.id;pending.projectId=project.id;
        let copied:ReferenceImage[]|undefined;
        if(!localGeometry&&base.id!==project.id){
          try{await copySourceScope(base.id??'local',project.id,taskGuard);const sources=await listStoredSources(project.id);copied=sources.map(source=>({...source,url:URL.createObjectURL(source.blob!)}));}
          catch{
            let releaseNotice='';
            const preparedCloud=controller.getSnapshot();
            if(preparedCloud.project?.id===project.id&&preparedCloud.lease?.projectId===project.id&&!preparedCloud.writeBlocked){
              try{await controller.releaseLease();}
              catch{releaseNotice=' 新项目的编辑权未能释放，请在右上「项目」的「我的项目」中核对。';}
            }
            throw new Error(`云项目已准备好，但活动需求和场地资料未能迁移。原本地草稿与当前输入已保留，请重试后再发送。${releaseNotice}`);
          }
          if(!alive.current||pending.cancelled||layoutRef.current!==base||briefRef.current!==requestedBrief||epoch!==runEpoch.current){for(const image of copied??[])URL.revokeObjectURL(image.url);return;}
          await assertCurrentLocalRecords(layoutRef.current);
          try { assertGenerationIntent(); } catch(error) { for(const image of copied??[])URL.revokeObjectURL(image.url); throw error; }
          preparation.current=null;
          flushSync(()=>{if(copied){for(const image of imageRef.current)URL.revokeObjectURL(image.url);imageRef.current=copied;setImages(copied);}onBindProject?.(project.id);});
          setNotice('云项目已建立；原活动对话保留在历史中的其他活动，请核对当前需求后重新发送，本次未提交生成。');
          return;
        }else flushSync(()=>setBusy(true));
        base=layoutRef.current;submittedScope=agentScopeRef.current;
        if(geometryProjectId(controller,base.id)!==project.id)throw new Error('工作台尚未完成连接，请重试；当前草稿已保留。');
        preparation.current=null;
      }
      const submittedBrief=briefRef.current;
      await assertCurrentLocalRecords(layoutRef.current);
      assertGenerationIntent();
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
      const scene=layoutToBackendScene(base),context=buildAgentContext({briefInstruction:modelRequest?modelBrief:message&&!submittedBriefValue.description.trim()?'':briefInstruction(submittedBriefValue,base.width,base.height),message:modelRequest?`仅创建或调整本次请求指定的物料，不重新设计整场。\n${messageForModel?.trim()??''}`:messageForModel?.trim()||'请按上述需求生成布置方案。',confirmedMaterialDecisions:acceptedDecisions,recentMessages:message?messages.filter(item=>item.id!=='welcome'):[],lastProposalExplanation:message?lastExplanation:''});
      if(context.omittedHistory)say(`已省略 ${context.omittedHistory} 条较早或过长的背景对话；当前需求完整保留。`);
      if(!message)setMessages(items=>[...items.slice(-38),{id:crypto.randomUUID(),role:'user',text:`生成${submittedBriefValue.eventConfirmed === true ? submittedBriefValue.event : '活动'}方案：${submittedBriefValue.description.trim()}`}]);
      const remoteProjectId=geometryProjectId(controller,base.id);
      if(!remoteProjectId)throw new Error('当前活动的场景连接已变化，请重新核对后发送。');
      let annotationEvidence:AnnotationEvidence|undefined;
      if(annotationObservation){
        try{annotationEvidence={observation:structuredClone(annotationObservation),provenance:structuredClone(seatingCapture?.annotationProvenance??[]),projectBinding:annotationProjectBinding(base),base:structuredClone(base)};}
        catch{throw new Error('规划标注无法完整冻结，本次生成尚未提交。');}
      }
      let planObservation:AgentPlanObservation|undefined;
      const outdoorCapture=outdoorPlanCaptureRef.current?.();
      if(outdoorCapture){
        try{
          const frozenPlan=structuredClone(outdoorCapture.plan);
          const planHash=await computePlanFingerprint(frozenPlan);
          planObservation=buildPlanObservation({plan:frozenPlan,anchor:outdoorCapture.anchor,selected:outdoorCapture.selected,...(planHash?{planHash}:{})});
        }catch{throw new Error('户外平面草稿无法完整冻结，本次生成尚未提交。');}
      }
      const pendingRecovery=readApplyRecovery(projectRecoveryScope(controller.config.apiUrl,remoteProjectId));
      if(pendingRecovery){applyRecoveryRef.current=pendingRecovery;setApplyRecovery(pendingRecovery);throw new Error('此云项目有待核对的提交结果，请先查看云端版本。');}
      const marker:RunMarker={requestId:crypto.randomUUID(),projectId:remoteProjectId,baseKey:canonical(scene),briefKey:submittedBrief,...(seatingCapture?{seatingToken:seatingCapture.token}:{}),...(annotationObservation?{annotationSnapshot:true as const}:{})};
      if(!sessionValid(turnToken)||!floorValid(turnFloor)||!venueBindingCurrent(venueBinding))throw new Error('活动、楼层或图纸已变化，本次生成尚未提交。');
      await verifyVenueBinding(base,venueBinding);
      if(!alive.current||epoch!==runEpoch.current||submittedScope!==agentScopeRef.current)return;
      assertGenerationIntent();
      if(!sessionValid(turnToken)||!floorValid(turnFloor)||!baseIsCurrent(base)||!venueBindingCurrent(venueBinding))throw new Error('活动、楼层或图纸已变化，本次生成尚未提交。');
      try{rememberRun(marker,submittedScope);}catch{throw new Error('无法保存任务编号，尚未提交。请恢复浏览器本机存储后重试。');}
      requestPending.current=true;setBusy(true);setTrackedPreview(null);setCandidates([]);setRun(null);dispatched=true;dispatchedRequestId=marker.requestId;
      if(annotationObservation)say(annotationObservation.status==='ready'?'本次将提供规划标注供模型读取；标注尚未核验，提供不代表已经用于排布或安全检查。':'本次无法完整读取规划标注，模型不会据此检查区域、路线或入口。');
      const result=await controller.startAgentRun({requestId:marker.requestId,instruction:context.instruction,context:{...context.context,...(seatingAllocation?{seatingAllocation}:{}),...(seatingSpecs?{seatingSpecs}:{}),...(annotationObservation?{annotationObservation}:{}),...(planObservation?{planObservation}:{})},scene,selectedIds:[...allSelectedIds].filter(id=>scene.objects.some(object=>object.id===id)),jevEnabled,executionMode:'preview'});
      creationResponded=true;
      if(cancelledRequest.current===marker.requestId){
        if(agentScopeRef.current===submittedScope){
          const cancelled=await controller.cancelAgentRun(result.id);
          if(alive.current&&agentScopeRef.current===submittedScope&&markerRef.current?.requestId===marker.requestId){setRun(cancelled);forgetRun();setBusy(false);requestPending.current=false;say('任务已取消，当前方案保持不变。');}
        }
        return;
      }
      return await followRun(result,base,submittedBrief,submittedScope,epoch,turnToken,turnFloor,venueBinding,seatingCapture,annotationEvidence);
    }catch(error){if(alive.current&&(agentScopeRef.current===submittedScope||preparation.current?.layout===layoutRef.current)&&epoch===runEpoch.current){
      const text=error instanceof Error?error.message:controller.getSnapshot().error?.message??'生成失败，原方案已保留。';setNotice(text);say(text);
      if(dispatched&&!applyRecoveryRef.current&&agentScopeRef.current===submittedScope&&markerRef.current?.requestId===dispatchedRequestId){
        if(error instanceof SceneApiError&&([400,401,403,404,409,422].includes(error.status)||['SERVICE_NOT_CONFIGURED','BILLING_NOT_CONFIGURED','AI_INPUT_TOO_LARGE'].includes(error.code)||(!creationResponded&&error.status===503&&['AGENT_ANNOTATION_UNAVAILABLE','AGENT_ANNOTATION_GUARD_UNAVAILABLE'].includes(error.code))))forgetRun();
        else setRecoverable(true);
      }
    }}finally{const cancelledPreparation=!!ownPreparation&&preparation.current===ownPreparation&&ownPreparation.cancelled;if(preparation.current===ownPreparation)preparation.current=null;if(epoch===runEpoch.current||cancelledPreparation){requestPending.current=false;if(alive.current)setBusy(false);}}
    return;
  }
  async function applyCandidate(selected:Preview):Promise<void> {
    if(previewRef.current!==selected)throw new Error('候选已变化，请重新核对。');
    if(isUnchangedProposal(selected.proposal))throw new Error('这版与当前场景一致，无需应用；请继续核对是否满足需求。');
    const chatScope=`activity:${selected.layout.id??''}`,chatId=getActiveAssistantSessionId(chatScope);
    const briefEpoch=briefEditEpoch.current;
    const dialogue=captureDialogue?.()??null;
    if(captureDialogue&&!dialogue)throw new Error('当前对话尚未核对完成，请先核对历史需求并重新生成方案。');
    const checkRequirements=()=>{
      if(briefEditEpoch.current!==briefEpoch||briefRef.current!==selected.briefKey||getActiveAssistantSessionId(chatScope)!==chatId||dialogue&&!dialogue.isCurrent())throw new Error('应用期间需求或对话已变化，已保留当前画布。');
      if(dialogue && dialogue.project().availability!=='available')throw new Error('当前对话尚未核对完成，请稍后重试。');
      if(dialogue && !dialogue.isCurrent())throw new Error('应用期间需求或对话已变化，已保留当前画布。');
    };
    try {
    checkRequirements();
    const inherited=getSessionInventory(selected.layout,chatScope,chatId);
    if(inherited && sharedInventory.current?.preview!==selected && !setCandidateInventory(selected,inherited,chatScope,chatId))throw new Error('物料数量无法绑定当前候选，请重新核对。');
    const inventoryVersion=inventoryGeneration.current;
    const authority=applyAuthority.current;
    const capability=authority?.capability ? localWriteCapabilityGuard(authority.capability) : undefined;
    const checkWriteAuthority=()=>{
      if(authority!==applyAuthority.current||authority?.revoked)throw new Error('本机编辑权已变化，原草稿已保留。');
      capability?.assertStillHeld();authority?.source?.assertStillHeld();
      if(capability?.signal.aborted||authority?.source?.signal.aborted)throw new Error('本机编辑权已失效，原草稿已保留。');
    };
    const checkAuthority=()=>{checkWriteAuthority();checkRequirements();if(previewRef.current!==selected)throw new Error('候选已变化，请重新核对。');if(!sessionValid(selected.sessionToken))throw new Error('活动已切换，旧候选不能应用，请重新生成。');if(!floorValid(selected.floorToken))throw new Error('楼层已切换，旧候选不能应用，请重新生成。');if(!venueBindingCurrent(selected.venueBinding))throw new Error('场地图纸或比例资料已变化，请重新核对。');if(!seatingCurrent(selected.seatingCapture))throw new Error(selected.seatingCapture?.annotationObservation?'活动需求或规划标注已变化，旧候选不能应用，请重新生成。':'活动会话或桌椅配比已变化，旧候选不能应用，请重新生成。');if(!annotationBindingCurrent(selected))throw new Error('账号、项目或编辑权已变化，旧候选不能应用，请重新生成。');checkCandidateInventoryAuthority(selected,inventoryVersion);};
    checkAuthority();
    await withApplyLock(projectRecoveryScope(controller.config.apiUrl,selected.proposal.project_id),()=>applyCandidateLocked(selected,checkAuthority,checkWriteAuthority,checkRequirements,[capability?.signal,authority?.source?.signal,authority?.abort.signal].filter((s):s is AbortSignal=>!!s),inventoryVersion));
    } finally { dialogue?.release(); }
  }
  async function applyCandidateLocked(selected:Preview,checkAuthority:()=>void,checkWriteAuthority:()=>void,checkRequirements:()=>void,signals:AbortSignal[],inventoryVersion:number):Promise<void> {
    checkAuthority();
    if(!sessionValid(selected.sessionToken))throw new Error('活动已切换，旧候选不能应用，请重新生成。');
    if(!venueBindingCurrent(selected.venueBinding))throw new Error('场地图纸或比例资料已变化，请重新核对。');
    if(agentScopeRef.current!==selected.scope)return;
    const storageScope=projectRecoveryScope(controller.config.apiUrl,selected.proposal.project_id);
    if(applyRecoveryRef.current || readApplyRecovery(storageScope) || readApplyRecovery(selected.scope))throw new Error('云端与本地版本尚待核对，请先处理版本差异。');
    await assertCurrentLocalRecords(layoutRef.current);
    if(layoutRef.current!==selected.base || !baseIsCurrent(selected.base) || briefRef.current!==selected.briefKey) throw new Error('场景或需求已变化，请重新生成候选。');
    if ((selected.base.designBook?.variants.length ?? 0) >= MAX_DESIGNS) throw new Error('请先在图层面板移除不再需要的方案，再确认提案。');
    const prepared=addDesign(selected.base,selected.layout);
    const preparedKey=canonical(prepared);
    const requirementError=candidateRequirementError(selected.base,prepared);
    if(requirementError)throw new Error(requirementError);
    const preflightError=preflightApply?.(selected.base,prepared);
    if(preflightError)throw new Error(preflightError);
    let baseHash:string,candidateHash:string;
    try { [baseHash,candidateHash]=await Promise.all([sceneHash(selected.proposal.base_scene),sceneHash(selected.proposal.candidate)]); }
    catch { throw new Error('无法建立候选核对信息，布置应用尚未提交云端。'); }
    await verifyVenueBinding(selected.base,selected.venueBinding);
    if(!sessionValid(selected.sessionToken) || !floorValid(selected.floorToken) || !venueBindingCurrent(selected.venueBinding) || agentScopeRef.current!==selected.scope || layoutRef.current!==selected.base || !baseIsCurrent(selected.base) || briefRef.current!==selected.briefKey || canonical(prepared)!==preparedKey) throw new Error('场景、楼层、图纸或需求已变化，请重新生成候选。');
    const refreshedRequirementError=candidateRequirementError(selected.base,prepared);
    if(refreshedRequirementError)throw new Error(refreshedRequirementError);
    const refreshedPreflightError=preflightApply?.(selected.base,prepared);
    if(refreshedPreflightError)throw new Error(refreshedPreflightError);
    checkAuthority();
    const scene=layoutToBackendScene(layoutRef.current);
    const pending:ApplyRecovery={projectId:selected.proposal.project_id,revision:selected.proposal.base_revision+1,baseRevision:selected.proposal.base_revision,baseHash,candidateHash,proposalId:selected.proposal.id,outcome:'pending',storageScope};
    const recoveryKey=applyRecoveryKey(storageScope);
    try {
      checkAuthority();
      const storage=localStorageOrNull();
      if(!storage || storage.getItem(recoveryKey)!==null) throw new Error('本机核对记录不可写或已存在');
      const payload=JSON.stringify(pending);
      storage.setItem(recoveryKey,payload);
      if(storage.getItem(recoveryKey)!==payload)throw new Error('本机核对记录未能读回');
    } catch {
      const existing=readApplyRecovery(storageScope);
      if(existing && alive.current && agentScopeRef.current===selected.scope){applyRecoveryRef.current=existing;setApplyRecovery(existing);}
      throw new Error('无法保存本次操作的核对记录，布置应用尚未提交云端。请检查本机存储后重试。');
    }
    applyRecoveryRef.current=pending;
    let result: Awaited<ReturnType<BackendSession['applySceneProposal']>>;
    try {
      checkAuthority();
      let abort!:()=>void;
      const interrupted=new Promise<never>((_resolve,reject)=>{abort=()=>reject(new Error('本机编辑权在提交期间失效'));for(const signal of signals)signal.addEventListener('abort',abort,{once:true});});
      try { checkAuthority();result=await Promise.race([controller.applySceneProposal(selected.proposal,scene),interrupted]);checkWriteAuthority();checkCandidateInventoryAuthority(selected,inventoryVersion,true); }
      finally { for(const signal of signals)signal.removeEventListener('abort',abort); }
    } catch(error) {
      if(definitelyRejectedBeforeApply(error)) {
        if(removeApplyRecovery(storageScope,pending)) {
          if(alive.current&&agentScopeRef.current===selected.scope){applyRecoveryRef.current=null;setApplyRecovery(null);}
          throw new Error('云端明确拒绝本次应用，未写入候选。请检查方案后重试。');
        }
        const recovery:ApplyRecovery={...pending,outcome:'cleanup_failed'};
        updateApplyRecovery(storageScope,recovery);
        if(alive.current&&agentScopeRef.current===selected.scope){applyRecoveryRef.current=recovery;setApplyRecovery(recovery);setTrackedPreview(null);setCandidates([]);}
        throw new Error('云端明确拒绝本次应用，但本机核对记录未能清除；请核对后解除提醒。');
      }
      if(alive.current&&agentScopeRef.current===selected.scope){setApplyRecovery(pending);setTrackedPreview(null);setCandidates([]);}
      throw new Error('云端提交结果尚不明确，未重复提交。请保留本地草稿，并只读核对云端版本后再处理。');
    }
    const recovery:ApplyRecovery={...pending,projectId:result.id,revision:result.revision,outcome:'committed'};
    const recoverySaved=updateApplyRecovery(storageScope,recovery);
    if(!alive.current || agentScopeRef.current!==selected.scope)return;
    let next:RoomLayout;
    try {
      await verifyVenueBinding(selected.base,selected.venueBinding);
      await assertCurrentLocalRecords(layoutRef.current);
      checkRequirements();
      if(!result.acceptedLocally || layoutRef.current!==selected.base) throw new Error('应用期间本地有新修改，已保留本地草稿。');
      if(!sessionValid(selected.sessionToken) || !floorValid(selected.floorToken) || !venueBindingCurrent(selected.venueBinding) || !baseIsCurrent(selected.base)) throw new Error('应用期间本地活动、楼层、图纸或内容已变化，已保留当前画布。');
      if(!seatingCurrent(selected.seatingCapture)) throw new Error(selected.seatingCapture?.annotationObservation?'应用期间规划标注或活动需求已变化，已保留当前画布。':'应用期间活动会话或桌椅配比已变化，已保留当前画布。');
      if(!annotationBindingCurrent(selected))throw new Error('应用期间账号、项目或编辑权已变化，已保留当前画布。');
      if(canonical(result.scene)!==canonical(selected.proposal.candidate)) throw new Error('云端返回的场景与预览候选不一致。');
      next=mergeProposalPresentation(selected.base,backendSceneToLayout(result.scene,{projectId:selected.base.id!,name:selected.base.name,...selected.assets}));
      if(!sameLayoutContent(selected.layout,next) || canonical(prepared)!==preparedKey) throw new Error('云端结果转换后与预检候选不一致。');
      onApply(prepared,{expectedBase:selected.base,...(selected.floorToken?{expectedFloor:selected.floorToken}:{})});
    } catch(error) {
      applyRecoveryRef.current=recovery;setApplyRecovery(recovery);setTrackedPreview(null);setCandidates([]);forgetRun();
      const reason=error instanceof Error?` ${error.message}`:'';
      throw new Error(`云端已提交第 ${result.revision} 版，本机应用结果未能确认。${reason}请先保留本地草稿，再打开云端项目核对版本差异。${recoverySaved?'':' 本机提醒未能保存，请保持此页打开。'}`);
    }
    if(!removeApplyRecovery(storageScope,recovery)) {
      const cleanup:ApplyRecovery={...recovery,outcome:'cleanup_failed'};
      updateApplyRecovery(storageScope,cleanup);
      applyRecoveryRef.current=cleanup;setApplyRecovery(cleanup);setNotice('当前画布已应用，但本机核对记录未能清除，请核对后解除提醒。');
    } else { applyRecoveryRef.current=null;setApplyRecovery(null); }
    setTrackedPreview(null);setCandidates([]);forgetRun();
    setAcceptedDecisions(items=>[...items,'已由用户确认应用一版方案；模型说明未核验。'].slice(-20));
    if(selected.proposal.warnings.length) setNotice(selected.proposal.warnings.map(warning=>proposalWarningText(warning,id=>next.floors.flatMap(floor=>floor.items).find(item=>item.id===id)?.name??'物件')).join('；'));
    sayModel('提案已应用。你可以继续调整，或用撤销返回应用前的本地方案。',selected.proposal.explanation,selected.proposal.modelSuggestions,selected.proposal.materialSuggestions);
  }
  async function applyPreview():Promise<void> {
    if(!preview || requestPending.current || busy || stale) return;
    if(isUnchangedProposal(preview.proposal)){setNotice('这版与当前场景一致，无需应用；请继续核对是否满足需求。');return;}
    const recovery=applyRecoveryRef.current ?? currentApplyRecovery();
    if(recovery){applyRecoveryRef.current=recovery;setApplyRecovery(recovery);setNotice('云端与本地版本尚待核对，请先处理版本差异。');return;}
    if(Date.parse(preview.proposal.expires_at)<=Date.now()) { setExpired(true); return; }
    const selected=preview,epoch=++runEpoch.current;
    requestPending.current=true;setBusy(true);setNotice('');
    try { await applyCandidate(selected); }
    catch(error) { if(alive.current && agentScopeRef.current===selected.scope)setNotice(error instanceof Error?error.message:'应用失败，原方案已保留。'); }
    finally { if(epoch===runEpoch.current){requestPending.current=false;if(alive.current)setBusy(false);} }
  }
  // 对话里确认后生成执行资料草案，不打开执行页。
  async function exportActivity():Promise<void> {
    const candidateFence=pendingCandidates?capturePendingCandidates():null;
    if(pendingCandidates&&(!candidateFence||candidateFence.hasPending))throw new Error('当前有尚未应用的方案预览，请先确认布置或撤回预览，再导出。');
    const base=layoutRef.current,scope=scopeRef.current,owner=controllerRef.current;
    if(!isLocalActivityWorkspace(owner))throw new Error('云项目暂不支持此执行资料草案，请切换到本地活动后导出。');
    const mobility=captureMobility?.();
    const stillCurrent=()=>alive.current&&layoutRef.current===base&&scopeRef.current===scope&&controllerRef.current===owner&&(!candidateFence||candidateFence.isCurrent());
    await exportActivityHandoff({layout:base,prepareBackup,stillCurrent,...(mobility?{mobility}:{}),...(captureDialogue?{captureDialogue:captureGuardedDialogue}: {})});
  }
  async function exportCloudMaterialDraft():Promise<void> {
    if(materialDraftExportPending.current)throw new Error('物料草案正在准备，请稍候。');
    const candidateFence=pendingCandidates?capturePendingCandidates():null;
    if(pendingCandidates&&(!candidateFence||candidateFence.hasPending))throw new Error('当前有尚未应用的方案预览，请先确认布置或撤回预览，再导出。');
    const base=layoutRef.current,scope=scopeRef.current,owner=controllerRef.current,token=sessionToken,floor=floorToken;
    const start=owner.getSnapshot(),user=start.user?.id,project=start.project?.id,revision=start.revision,localRevision=start.localRevision,lease=start.lease?.generation,dirty=start.dirty,writeBlocked=start.writeBlocked;
    if(!user||!project||base.id!==project||revision===null||isLocalActivityWorkspace(owner))throw new Error('当前不是可核对的云项目，请在本地活动中使用已有导出入口。');
    if(start.status==='saving'||requestPending.current||backupBusy.current||applyRecoveryRef.current||currentApplyRecovery())throw new Error('当前任务、保存或版本核对尚未完成，暂不能导出物料草案。');
    let captured:RoomLayout;
    try{captured=structuredClone(base);}catch{throw new Error('当前场景无法完整复制，未导出草案。');}
    const stillCurrent=()=>{
      try{const now=owner.getSnapshot(),current=currentLayoutGetter.current?.()??layoutRef.current;
        return alive.current&&controllerRef.current===owner&&scopeRef.current===scope&&sessionValid(token)&&floorValid(floor)&&
          now.user?.id===user&&now.project?.id===project&&now.revision===revision&&now.localRevision===localRevision&&now.lease?.generation===lease&&now.dirty===dirty&&now.writeBlocked===writeBlocked&&now.status!=='saving'&&!isLocalActivityWorkspace(owner)&&
          (!candidateFence||candidateFence.isCurrent())&&!requestPending.current&&!backupBusy.current&&!applyRecoveryRef.current&&!currentApplyRecovery()&&sameRecoveryFormValue(captured,current);
      }catch{return false;}
    };
    materialDraftExportPending.current=true;
    try{if(!stillCurrent())throw new Error('项目、版本、楼层或场景已变化，未导出草案。');
      const {exportCloudMaterialDraft:download}=await import('../lib/cloud-material-draft');
      await download({layout:captured,dirty,stillCurrent});
    }finally{materialDraftExportPending.current=false;}
  }
  const checkinView=checkinRecovery.current?{...checkins,ready:false,error:'点验记录回退尚未完成，请先重试恢复或撤销恢复。'}:checkins;
  const value:StudioValue={setCandidateInventory,getBoundCandidateInventory,getSessionInventory,rememberSessionInventory,canRememberSessionInventory,sourceCoordinator,onDrawingRecheckReader,recheckVenueSources,sourceRecheckNotice,briefExportNotice,exportOriginalBrief,exportBriefDraft,sourceWriteGuard,sourcesRestoring,captureImage,checkins:checkinView,reviewSource,getReviewSource,prepareReview,exportActivity,exportCloudMaterialDraft,captureLocalDraftExport,capturePendingCandidates:pendingCandidates?capturePendingCandidates:undefined,cloudMaterialDraftAvailable:!!cloud.user&&!!cloud.project&&layout.id===cloud.project.id&&!isLocalActivityWorkspace(controller),captureMobility,captureDialogue:captureDialogue?captureGuardedDialogue:undefined,scope:agentScope,controller,layout,getCurrentLayout,onApply,onUpdateItem,onUpdateEventOperations,onUpdateProductionPlan,onPreview,updateImage,brief,setBrief,briefReady,briefError,hasSavedBrief,retryBrief,prepareBackup,restoreBackup,createFreshActivity,undoRestore,backupPending,canUndoRestore,images,addImages,removeImage,autoGenerateRequest,busy,preparing:preservingPreparation.current,notice,connection,generate,messages,expanded,setExpanded,preview,stale,expired,jevEnabled,setJevEnabled,run,candidates,recoverable,recoverRun,cancelRun,candidateRequirementError,candidateAnnotationAdvisory,candidateSeatAdvisory,applyRecovery,applyRecoveryReview,reviewingApplyRecovery,reviewApplyRecovery,acknowledgeApplyRecovery,selectCandidate:label=>{const item=candidates.find(value=>value.label===label);if(item&&!stale){if(item.preview!==previewRef.current){inventoryGeneration.current++;sharedInventory.current?.fence?.release();sharedInventory.current?.continuity?.release();}setTrackedPreview(item.preview);}},applyPreview,discardPreviewForHistoryReview,discardPreview:()=>{setTrackedPreview(null);setCandidates([]);forgetRun();}};
  return <StudioContext.Provider value={value}><UnsavedSourceNotice scope={scope}/>{children}</StudioContext.Provider>;
}

export function CreativeBriefPanel({ showNotice=true, descriptionRef, referenceOpenRequest=0, referencePanelRef, referencePanel, view='brief', onSkip, onBackToChat, onSwitchView, forcePreview=false }: { showNotice?: boolean; descriptionRef?: RefObject<HTMLTextAreaElement>; referenceOpenRequest?: number; referencePanelRef?: RefObject<HTMLDivElement>; referencePanel?: ReactNode; view?: 'brief'|'reference'|'rebuild'; onSkip?:()=>void; onBackToChat?:()=>void; onSwitchView?:((view:'brief'|'reference'|'rebuild')=>void)|undefined; forcePreview?: boolean }):JSX.Element {
  const studio=useStudio();
  const update=(patch:Partial<CreativeBrief>)=>studio.setBrief(current=>({...current,...patch}));
  const blankScaffold=isBlankBriefScaffold(studio.brief.description);
  const [referenceNotice,setReferenceNotice]=useState<{text:string;error:boolean}|null>(null);
  useEffect(()=>setReferenceNotice(null),[studio.scope]);
  function addBriefReference():void {
    if(!studio.briefReady||studio.briefError||studio.backupPending)return;
    const original=studio.brief.description;
    try{
      const next=composeBriefReference(original,studio.brief);
      if(next===original.trim()){setReferenceNotice({text:'参考已是最新，未重复添加。',error:false});return;}
      update({description:next});
      setReferenceNotice({text:original.trim()&&!blankScaffold?'已在本机生成参考，原文保留在前面，可直接改。':'已按当前活动类型和人数生成参考（本机规则），可直接改。',error:false});
    }catch(error){setReferenceNotice({text:error instanceof Error?error.message:'参考未能生成，原文字保持不变。',error:true});}
  }
  // One idea at a time, swapped on demand: three stacked articles were mostly noise.
  const [ideaIndex,setIdeaIndex]=useState(0);
  const idea=IDEA_CARDS[ideaIndex%IDEA_CARDS.length];
  // 重建的表单、任务与候选只有一份状态；页签决定放哪一块，来回切换不打断进行中的识别。
  const zones=useReconstructionPanel({controller:studio.controller,layout:studio.layout,getCurrentLayout:studio.getCurrentLayout,sourceCoordinator:studio.sourceCoordinator,onDrawingRecheckReader:studio.onDrawingRecheckReader,onApply:studio.onApply,onPreview:studio.onPreview,images:studio.images,updateImage:studio.updateImage,brief:studio.brief,sourceWriteGuard:studio.sourceWriteGuard,openReferenceRequest:referenceOpenRequest,autoGenerateRequest:studio.autoGenerateRequest,sourcesRestoring:studio.sourcesRestoring,onAddReferenceImages:files=>studio.addImages(files,'floorplan'),onBackToChat});
  const restoring=<p role="status">正在核实图纸恢复，请完成后继续编辑。</p>;
  if(view==='reference') return <fieldset className="cr-brief" disabled={studio.backupPending} style={{border:0,padding:0,minWidth:0}}>
    <VenuePhotosPanel images={studio.images} addImages={studio.addImages} removeImage={studio.removeImage} onKindChange={(id,kind)=>studio.updateImage(id,{kind})}/>
    <div ref={referencePanelRef} tabIndex={-1} aria-label="图纸与场地对应核对">{referencePanel}</div>{studio.sourceCoordinator&&<><button type="button" className="rc-secondary" onClick={()=>void studio.recheckVenueSources()}>重新核对已保存的图纸资料</button>{studio.sourceRecheckNotice&&<p role="status">{studio.sourceRecheckNotice}</p>}</>}
    {studio.sourcesRestoring?restoring:<>{zones.site}{zones.notice}{onSwitchView&&<p className="cr-hint"><button type="button" className="rc-secondary" onClick={()=>onSwitchView('rebuild')}>去场地重建出 3D 预览</button></p>}</>}
  </fieldset>;
  if(view==='rebuild') return <fieldset className="cr-brief" disabled={studio.backupPending} style={{border:0,padding:0,minWidth:0}}>
    {studio.sourcesRestoring?restoring:<>{zones.rebuild}{zones.notice}{onSwitchView&&<p className="cr-hint">图纸、照片与已知尺寸在「图纸与照片」页核对。<button type="button" className="rc-secondary" onClick={()=>onSwitchView('reference')}>去图纸与照片</button></p>}</>}
  </fieldset>;
  return <fieldset className="cr-brief" disabled={studio.backupPending} style={{border:0,padding:0,minWidth:0}}>
    <section className="cr-brief-sec">
      <h3 className="cr-sec-title"><span className="cr-sec-no" aria-hidden="true">01</span>目标与来宾体验</h3>
    {!studio.briefReady&&!studio.briefError&&<p className="cr-hint" role="status">正在读取活动需求，当前输入会保留。</p>}
    {studio.briefReady&&!studio.hasSavedBrief&&!studio.briefError&&<p className="cr-hint">尚未保存；请填写活动类型和人数。</p>}
    {showNotice&&studio.briefError&&<p className="cr-notice" role="alert">{studio.briefError}<button type="button" onClick={studio.retryBrief}>{studio.briefReady?'重试保存需求':'重试读取需求'}</button></p>}
    <details><summary>下载需求记录或草稿</summary><p>分别下载本机保存原记录和页面中未保存的草稿，内容与确认状态仍需核对。</p><button type="button" onClick={()=>void studio.exportOriginalBrief()}>下载原始本机需求记录</button><button type="button" onClick={studio.exportBriefDraft}>下载当前未保存需求草稿</button>{studio.briefExportNotice&&<p role="status">{studio.briefExportNotice}</p>}</details>
    {([['来源待确认的旧记录',studio.brief.legacyBriefRecord],['当前未确认的保存值（可能为默认值）',studio.brief.unconfirmedSavedBrief]] as const).map(([label,record])=>record&&<details key={label}><summary>{label}</summary><p>仅供核对，不代表已确认的活动需求。</p>{record.event!==undefined&&<p>活动：{record.event||'空值'}</p>}{record.guests!==undefined&&<p>人数：{record.guests}</p>}{record.allowIdeas!==undefined&&<p>允许扩展创意：{record.allowIdeas?'是':'否'}</p>}</details>)}
    <div className="cr-field-head"><span>客户需求</span><button className="awg-template-button cr-template-icon" type="button" aria-label="生成需求参考" title="按当前活动类型与人数生成一段参考（本机规则）" disabled={!studio.briefReady||!!studio.briefError||studio.backupPending} onClick={addBriefReference}><span aria-hidden="true">✦</span></button></div>
    <textarea className="cr-field-input" ref={descriptionRef} aria-label="客户需求" maxLength={1800} rows={8} placeholder="描述活动目标、分区与来宾体验……" value={studio.brief.description} onChange={e=>{setReferenceNotice(null);update({description:e.target.value});}}/>
    {(blankScaffold||!studio.brief.description.trim())&&<p className="cr-hint">点右上角 ✦，按当前活动类型和人数生成一段参考；也可以直接写客户原话。</p>}
    {referenceNotice&&<p className={referenceNotice.error?'cr-notice':'cr-hint'} role={referenceNotice.error?'alert':'status'}>{referenceNotice.text}</p>}
    </section>
    <section className="cr-brief-sec">
      <h3 className="cr-sec-title"><span className="cr-sec-no" aria-hidden="true">02</span>活动类型与规模</h3>
    <div className="cr-brief-card">
      <label className="cr-stat">活动类型<select value={studio.brief.eventConfirmed === true ? studio.brief.event : ''} onChange={e=>update({event:e.target.value,eventConfirmed:!!e.target.value})}><option value="">请选择活动类型</option>{studio.brief.eventConfirmed === true&&!(BRIEF_EVENT_OPTIONS as readonly string[]).includes(studio.brief.event)&&<option value={studio.brief.event}>{studio.brief.event}</option>}{BRIEF_EVENT_OPTIONS.map(label=><option key={label}>{label}</option>)}</select></label>
      <label className="cr-stat">预计人数<span className="cr-stat-line"><input type="number" aria-label="预计人数" min={1} max={HEADCOUNT_MAX} value={studio.brief.guestsConfirmed === true ? studio.brief.guests||'' : ''} onChange={e=>update({guests:e.target.valueAsNumber||0,guestsConfirmed:!!e.target.value})}/><i>人</i></span></label>
    </div>
    </section>
    <section className="cr-brief-sec">
    <label className="cr-label">必需项<input maxLength={350} placeholder="帐篷、签到区、无障碍通道……" value={studio.brief.mustHave} onChange={e=>update({mustHave:e.target.value})}/></label>
    <label className="cr-check"><input type="checkbox" checked={studio.brief.ideasConfirmed === true && studio.brief.allowIdeas} onChange={e=>update({allowIdeas:e.target.checked,ideasConfirmed:true})}/><span><strong>也给我一些意料之外的灵感</strong><small>可以提出建议，由你确认是否采用</small></span></label>
    </section>
    <div className="cr-brief-footer">
    <button className="cr-generate is-manual" type="button" disabled={studio.busy||studio.recoverable||!studio.brief.description.trim()||blankScaffold||!!studio.briefError} onClick={()=>void studio.generate(undefined, forcePreview?{requirePreview:true}:undefined)}>{studio.busy?<Loader2 className="cr-spin" size={16}/>:<Sparkles size={16}/>}<span>{studio.busy?'正在整理方案…':studio.jevEnabled?'按这份细表生成三个方案':'按这份细表生成预览'}</span></button>
    <button className="cr-brief-skip" type="button" onClick={()=>onSkip?.()}>暂不填写 · 先回画布</button>
    </div>
    {showNotice&&studio.notice&&<p className="cr-notice" role="status">{studio.notice}</p>}
    <div className="cr-ideas"><div><h3>布置思路</h3><button type="button" aria-label="换一条布置思路" onClick={()=>setIdeaIndex(current=>(current+1)%IDEA_CARDS.length)}><RefreshCw size={20}/></button></div><article><strong>{idea.title}</strong><p>{idea.text}</p></article></div>
  </fieldset>;
}

function AssistantMascot(): JSX.Element {
  // eslint-disable-next-line @next/next/no-img-element
  return <img className="cr-mascot" src="/assets/assistant/qingguang-3d-24@2x.png" alt="Bingo" draggable={false} width={24} height={24}/>;
}

export type GeneratedVariant = { sourceAssetId: string; variantAssetId: string; objectIds?: string[] };
export type GenerationContext = { sourceAssetId?: string; sourceObjectIds: string[]; onVariantReady(variant: GeneratedVariant): void };
type ChatMode = 'plan'|'model';
type BusinessMode = ChatMode|'delivery'|'review'|'commercial';
const CHAT_MODES = {plan:'场景策划',model:'物料生成'} as const;
/** 左栏工具轨可调用的入口集合（活动需求 / 图纸尺寸 / 执行资料 / 方案评审 / 场景模板 / 物料工具 / 合同约定）。 */
export type BusinessToolsApi = {
  openBrief():void;
  openReference():void;
  /** 左轨「重建」与简报里的入口都走这条；抽屉里不再有页签。 */
  openRebuild():void;
  openDelivery():void;
  openReview():void;
  openTemplates():void;
  openModelTools():void;
  openCommercial():void;
};

export function CreativeAssistant({ generationPanel, commercialPanel, referenceImagePanel, activityTaskPanel, onOpenTemplates, hideCategorySelect=false, workspaceOpenRequest=0, workspaceEntryRef, toolsOpenRequest=0, toolsEntryRef, deliveryOpenRequest = 0, backupOpenRequest = 0, deliveryEntryRef, referenceOpenRequest=0, referenceEntryRef, docked=false, suppressAgentLauncher=false, businessHostRef, onConversationVisibilityChange, onWorkspaceVisibilityChange, conversationCloseRequest=0, reviewOpenRequest=0, reviewEntryRef, captureReview, localSaveError=false, conversationOpenRequest=0, conversationEntryRef, assistantEntryHostRef, workbenchMode = 'layout', workbenchModeSerial = 0, autoOpen = true, toolsApiRef }: {
  onOpenTemplates?:()=>void;
  /** 左栏工具轨已列出这些去处时，标题栏不再重复一个分类下拉。 */
  hideCategorySelect?: boolean;
  localSaveError?: boolean|undefined;
  conversationOpenRequest?: number;
  conversationEntryRef?: RefObject<HTMLButtonElement>;
  assistantEntryHostRef?: RefObject<HTMLDivElement>;
  reviewOpenRequest?: number;
  reviewEntryRef?: RefObject<HTMLButtonElement>;
  captureReview?: (snapshot:ProjectReviewSnapshot, options:ProjectReviewCaptureOptions, getSource:()=>ProjectReviewSource)=>Promise<ProjectReviewCapture>;
  generationPanel?: ReactNode | ((context: GenerationContext) => ReactNode);
  commercialPanel?: ReactNode;
  /** 参考底图开关：画布右上角不再浮，跟着「图纸尺寸」面板走。 */
  referenceImagePanel?: ReactNode;
  activityTaskPanel?: (context: ActivityTaskPanelContext) => ReactNode;
  /** 左栏「活动资料」只在人点击时自增，打开工作区并回到上次的资料分类（挂载时不自开）。 */
  workspaceOpenRequest?: number;
  workspaceEntryRef?: RefObject<HTMLButtonElement>;
  toolsOpenRequest?: number;
  toolsEntryRef?: RefObject<HTMLButtonElement>;
  deliveryOpenRequest?: number;
  backupOpenRequest?: number;
  deliveryEntryRef?: RefObject<HTMLButtonElement>;
  referenceOpenRequest?: number;
  referenceEntryRef?: RefObject<HTMLButtonElement>;
  docked?: boolean;
  /** 工作台已挂 AgentPanel 时为 true：禁止再露旧Bingo胶囊。 */
  suppressAgentLauncher?: boolean;
  businessHostRef?: RefObject<HTMLDivElement>;
  onConversationVisibilityChange?: (open:boolean)=>void;
  onWorkspaceVisibilityChange?: (open:boolean)=>void;
  conversationCloseRequest?: number;
  /** Phase 1 top-level IA: 布置 | 评审 | 执行 */
  workbenchMode?: WorkbenchMode;
  workbenchModeSerial?: number;
  /** v2.4：右栏由 AgentPanel 接管时，旧聊天默认不自动展开。 */
  autoOpen?: boolean;
  /** 左栏工具轨需要的入口；由 room-organizer 读取后渲染「活动需求 / 图纸尺寸 / …」按钮。 */
  toolsApiRef?: MutableRefObject<BusinessToolsApi | null>;
}):JSX.Element {
  const studio=useStudio(); const {setExpanded}=studio; const {selectedItem,allSelectedIds,selectOnly}=useSelection();
  const [seatAdvisoryState,setSeatAdvisoryState]=useState<{preview:Preview;text:string|null}|null>(null);
  useEffect(()=>{
    const preview=studio.preview;
    if(!preview){setSeatAdvisoryState(null);return;}
    const text=studio.candidateSeatAdvisory(preview);
    setSeatAdvisoryState(previous=>previous?.preview===preview&&previous.text===text?previous:{preview,text});
  },[studio.preview,studio.candidateSeatAdvisory]);
  const seatAdvisory=seatAdvisoryState?.preview===studio.preview?seatAdvisoryState?.text:null;
  // 编辑权被接手时画布只是按钮变灰，不重渲染就看不见——这里单独订阅云端会话。
  const leaseState=useBackendSession(studio.controller);
  const router=useRouter();
  const [projectsError,setProjectsError]=useState('');
  /** 画布上这份就是那个云项目，可你手上没有编辑权——改动只进本机。 */
  const leaseLost=!!leaseState.user&&!!leaseState.project&&leaseState.writeBlocked&&leaseState.project.id===studio.layout.id;
  const demoBackend=isDemoBackend();
  const demoHint=demoBackend?'演示后端：方案由本机 mock 服务生成，未连接真实模型。':studio.connection==='离线引导'?'尚未连接 AI 服务，方案不会生成。':'确认后才写入场地。';
  const draftOwner=canonical({api:studio.controller.config.apiUrl,user:leaseState.user?.id??null});
  const [drafts,setDrafts]=useState<MessageDrafts>(()=>unsentMessageDrafts.get(studio.scope)?.value??{plan:'',model:''}); const feed=useRef<HTMLDivElement>(null);
  const draftsRef=useRef(drafts);draftsRef.current=drafts;
  const draftScope=useRef(studio.scope),draftOwnerRef=useRef(draftOwner),otherDrafts=useRef(unsentMessageDrafts);
  const content=useRef<HTMLDivElement>(null);
  const businessEntry=useRef<HTMLButtonElement|null>(null);
  const conversation=useRef<HTMLElement>(null);
  const chatToggle=useRef<HTMLButtonElement>(null);
  const suggestionsToggle=useRef<HTMLButtonElement>(null),suggestionsCard=useRef<HTMLElement>(null);
  const focusChat=useRef(false);
  const [mode,setMode]=useState<ChatMode>('plan');
  const [businessMode,setBusinessMode]=useState<BusinessMode>('plan');
  const [planCategory,setPlanCategory]=useState<'brief'|'reference'|'rebuild'>('brief');
  const [suggestionsOpen,setSuggestionsOpen]=useState(false);
  const [suggestionsDismissed,setSuggestionsDismissed]=useState(false);
  // 第9批 UI：三候选横排（seed 派生）。纯本地态，不进撤销栈、不触发生成管线。
  const [variantRowOpen,setVariantRowOpen]=useState(false);
  const [selectedVariantIdx,setSelectedVariantIdx]=useState(0);
  useEffect(()=>{ setVariantRowOpen(false); setSelectedVariantIdx(0); },[studio.preview?.proposal.id, studio.preview?.briefKey]);
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
  useEffect(()=>{if(!docked||dockingInitialized.current)return;dockingInitialized.current=true;setOpened(true);setExpanded(autoOpen&&!mobile());},[docked,setExpanded,autoOpen]);
  // 工作台右栏已是 AgentPanel。这里再把 expanded 报成「对话打开」会加上 has-conversation，
  // 把主面板 display:none，旧聊天带着第二颗「确认布置」占住主路径。
  const agentOwnsChat=docked&&suppressAgentLauncher;
  useEffect(()=>{if(docked)onConversationVisibilityChange?.(agentOwnsChat?false:studio.expanded);},[docked,agentOwnsChat,studio.expanded,onConversationVisibilityChange]);
  // 左栏展开与否只在真的变化时回报。挂在依赖里会让父组件的回调换身份时重跑：
  // 点选物料把 leftMode 一切，父回调重建，这条 effect 就把「工作区还开着」重新
  // 报一遍，把用户刚关掉的左栏又掀起来。resizeWorkspace 里已有直接调用，不会漏报。
  const reportWorkspaceVisibility=useRef(onWorkspaceVisibilityChange);
  reportWorkspaceVisibility.current=onWorkspaceVisibilityChange;
  useEffect(()=>{if(docked)reportWorkspaceVisibility.current?.(workspaceExpanded);},[docked,workspaceExpanded]);
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
  const [deliveryViewRequest,setDeliveryViewRequest]=useState<{serial:number;view:'operations'|'materials'|'backup'}>();
  const deliveryViewSerial=useRef(0);
  const [reviewOpened,setReviewOpened]=useState(false);
  const reviewTarget=useRef<HTMLDivElement>(null),focusReview=useRef(false),handledReview=useRef(0);
  const [commercialOpened,setCommercialOpened]=useState(false);
  const commercialTarget=useRef<HTMLDivElement>(null),focusCommercial=useRef(false);
  const handledWorkbenchMode=useRef(0);
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
  const handledToolsRequest=useRef(0);
  const handledWorkspaceRequest=useRef(0);
  const handledDeliveryRequest=useRef(0);
  const handledBackupRequest=useRef(0);
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
    if(draftScope.current!==studio.scope){
      const previous=draftsRef.current;rememberMessageDraft(draftScope.current,draftOwnerRef.current,previous);
      const saved=otherDrafts.current.get(studio.scope);const next=saved?.owner===draftOwner?saved.value:{plan:'',model:''};
      draftScope.current=studio.scope;draftOwnerRef.current=draftOwner;draftsRef.current=next;setDrafts(next);
    }
    setMaterialSeed(undefined);setModelTool('generate');
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
    if(backupOpenRequest===handledBackupRequest.current)return;
    handledBackupRequest.current=backupOpenRequest;
    setDeliveryViewRequest({serial:++deliveryViewSerial.current,view:'backup'});
    businessEntry.current=deliveryEntryRef?.current??null;
    returnToDeliveryEntry.current=true;returnToWorkspaceEntry.current=false;returnToReferenceEntry.current=false;
    focusDelivery.current=true;
    setDeliveryOpened(true);setBusinessMode('delivery');setTemplatesOpen(false);if(docked)resizeWorkspace(true);else setExpanded(true);
  },[backupOpenRequest,setExpanded]);
  useEffect(()=>{
    if(workbenchModeSerial===handledWorkbenchMode.current)return;
    handledWorkbenchMode.current=workbenchModeSerial;
    setTemplatesOpen(false);
    // 对话打开评审/执行时同步工作区内容，不靠左轨模式标，也不把左栏掀成表单。
    // 表单打开只走对话 chip 的 reviewOpenRequest / deliveryOpenRequest 路径。
    // 若工作区正开着，只把内容同步回当前模式对应的视图，不动展开态。
    if(workbenchMode==='layout'){setBusinessMode(current=>current==='plan'?current:'plan');setPlanCategory('brief');}
  },[workbenchModeSerial,workbenchMode,setExpanded]);
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
  const prefillReview=()=>buildReviewReference({
    name:studio.layout.name??'',event:studio.brief.eventConfirmed === true ? studio.brief.event : '',guests:studio.brief.guestsConfirmed === true ? studio.brief.guests : 0,
    mustHave:studio.brief.mustHave,venueConditions:studio.brief.venueConditions,
    style:studio.brief.style,palette:studio.brief.palette,atmosphere:studio.brief.atmosphere,
    area:venueArea(studio.layout),items:materialCount(sceneItems),
  });
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
  const generationContext:GenerationContext={...(sourceAssetId?{sourceAssetId}:{}),sourceObjectIds:sourceAssetId?selectedItems.map(item=>item.id):[],onVariantReady:variant=>previewMaterial({...variant,objectIds:variant.objectIds??[],name:'纹理新版本',reason:'核对纹理与原模型后，仅替换指定物件。',materialScope:'all_materials',modelSuggested:false})};
  function applyMaterial(next:RoomLayout):void {
    const changed=next.floors.flatMap(floor=>floor.items).filter(item=>item.assetId&&sceneItems.some(previous=>previous.id===item.id&&previous.assetId!==item.assetId));
    studio.onApply(next);
    if(changed.length&&changed.every(item=>item.assetId===changed[0]!.assetId))previewMaterial({sourceAssetId:changed[0]!.assetId!,objectIds:changed.map(item=>item.id),name:'已更新的物料',reason:'可继续调整或预览恢复父版本。',materialScope:'all_materials',modelSuggested:false});
    else setMaterialSeed(undefined);
  }
  const draftMode=mode==='model'?'model':'plan';
  const draft=drafts[draftMode];
  const setDraft=(value:string)=>{const next={...draftsRef.current,[draftMode]:value};draftsRef.current=next;rememberMessageDraft(draftScope.current,draftOwnerRef.current,next);setDrafts(next);};
  const anonymousOwner=canonical({api:studio.controller.config.apiUrl,user:null});
  const archivedDrafts=[...otherDrafts.current.entries()].filter(([scope,record])=>scope!==studio.scope&&(record.owner===draftOwner||record.owner===anonymousOwner)).flatMap(([scope,record])=>(['plan','model'] as const).filter(kind=>record.value[kind].trim()).map(kind=>({scope,kind,text:record.value[kind]})));
  const submit=()=>{if(!draft.trim()||studio.busy||studio.recoverable)return;const text=draft;setDraft('');setSuggestionsOpen(false);const lock=docked&&suppressAgentLauncher?{requirePreview:true as const}:{};void studio.generate(text,mode==='model'?{intent:'model',...lock}:lock);};
  const summary=studio.preview?proposalSummary(studio.preview.base,studio.preview.layout):null;
  const previewUnchanged=studio.preview?isUnchangedProposal(studio.preview.proposal):false;
  const annotationAdvisory=studio.preview?studio.candidateAnnotationAdvisory(studio.preview):null;
  const differences=studio.preview?proposalDifferences(studio.preview.base,studio.preview.layout):[];
  // 第9批 UI：预览卡 5 位人话配方编号。base_hash 是提案自带的 64 位 sha256 hex，
  // 直接取前 5 个 hex 字符映射；真实 Recipe seed 没从管线暴露，所以旁注「seed：本机生成」。
  const previewBaseHash=studio.preview?.proposal.base_hash??'';
  const previewRecipeId=previewBaseHash?humanRecipeId(previewBaseHash):'';
  const variantIds=useMemo(()=>{
    if(!variantRowOpen||!previewBaseHash)return [] as string[];
    // 从 base_hash 前 8 位 hex 派生一个本地 base seed（确定性，不硬造随机值）。
    const localBaseSeed=parseInt(previewBaseHash.slice(0,8),16)>>>0;
    const seeds=deriveSeededVariants(localBaseSeed,3);
    return seeds.map(seed=>humanRecipeId(promptRecipeHash({seed,prompt:studio.preview?.briefKey??'scene'})));
  },[variantRowOpen,previewBaseHash,studio.preview?.briefKey]);
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
  /** 被抢权后唯一的去处是项目页；走之前先把本机图纸落盘，落不了就不走。 */
  async function goProjects():Promise<void> {
    setProjectsError('');
    try{await flushSourceScope(studio.layout.id??'local',studio.sourceWriteGuard);}
    catch{setProjectsError('本机图纸未能落盘，请稍后重试或先导出备份。');return;}
    router.push('/projects/');
  }
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
    if(docked){if(!event){returnToWorkspaceEntry.current=true;returnToReferenceEntry.current=false;returnToDeliveryEntry.current=false;}
      focusBrief.current=true;setBusinessMode('plan');setTemplatesOpen(false);resizeWorkspace(true);queueMicrotask(()=>briefDescription.current?.focus());return;}
    if(!event){returnToWorkspaceEntry.current=true;returnToReferenceEntry.current=false;returnToDeliveryEntry.current=false;}
    if(studio.expanded&&businessMode==='plan'&&!templatesOpen){
      if(briefDetails.current)briefDetails.current.open=true;
      if(!docked)resizeWorkspace(true);
      briefDescription.current?.focus();
    }else{
      focusBrief.current=true;setBusinessMode('plan');setTemplatesOpen(false);setExpanded(true);
      if(!docked)resizeWorkspace(true);
    }
  }
  function openReference(event?:React.MouseEvent<HTMLButtonElement>):void{if(event)businessEntry.current=event.currentTarget;focusReference.current=true;focusBrief.current=false;focusDelivery.current=false;returnToReferenceEntry.current=true;returnToWorkspaceEntry.current=false;returnToDeliveryEntry.current=false;setBusinessMode('plan');setPlanCategory('reference');setTemplatesOpen(false);setLocalReferenceRequest(value=>value+1);resizeWorkspace(true);if(!docked)setExpanded(true);}
  /** 场地重建页：与图纸页共用重建状态，切页签不打断任务；进出都靠 focusWorkspace 把焦点交给工作区。 */
  function openRebuild(event?:React.MouseEvent<HTMLButtonElement>):void{if(event)businessEntry.current=event.currentTarget;focusBrief.current=false;focusReference.current=false;focusDelivery.current=false;focusWorkspace.current=true;returnToReferenceEntry.current=false;returnToDeliveryEntry.current=false;setBusinessMode('plan');setPlanCategory('rebuild');setTemplatesOpen(false);resizeWorkspace(true);if(!docked)setExpanded(true);}
  function openDelivery(event?:React.MouseEvent<HTMLButtonElement>):void{if(event)businessEntry.current=event.currentTarget;focusDelivery.current=true;returnToDeliveryEntry.current=true;returnToWorkspaceEntry.current=false;returnToReferenceEntry.current=false;setDeliveryOpened(true);setBusinessMode('delivery');setTemplatesOpen(false);resizeWorkspace(true);if(!docked)setExpanded(true);queueMicrotask(()=>deliveryFocusTarget.current?.focus());}
  function openDeliveryView(view:'operations'|'materials',event:React.MouseEvent<HTMLButtonElement>):void {
    setDeliveryViewRequest({serial:++deliveryViewSerial.current,view});openDelivery(event);
  }
  function openModelTools(event?:React.MouseEvent<HTMLButtonElement>):void{if(event)businessEntry.current=event.currentTarget;setModelTool('generate');setBusinessMode('model');setModelOpened(true);setTemplatesOpen(false);resizeWorkspace(true);}
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
  // 左栏工具栏出口：room-organizer 直接调用这些入口，不必把 handler 提升到上层。
  if(toolsApiRef)toolsApiRef.current={openBrief,openReference,openRebuild,openDelivery,openReview,openTemplates,openModelTools,openCommercial};
  const businessCategory=templatesOpen?'templates':businessMode==='plan'?planCategory:businessMode;
  const primaryCategoryValue = businessCategory === 'commercial' ? 'more' : businessCategory;
  const hasConversation=studio.messages.some(message=>message.id!=='welcome');
  // docked workbench: AgentPanel owns Agent entry; hide legacy capsule.
  const assistantLauncher=(!suppressAgentLauncher&&!studio.expanded)?<button ref={fallbackEntry} aria-controls="creative-assistant" className="cr-assistant-capsule" type="button" onClick={()=>{returnToDeliveryEntry.current=false;returnToWorkspaceEntry.current=false;returnToReferenceEntry.current=false;openChat();}} aria-expanded={false} aria-label="打开 Bingo Agent"><span className="cr-assistant-capsule-avatar" aria-hidden="true"><AssistantMascot/></span><span>Bingo</span></button>:null
  const suggestionsVisible=!suggestionsDismissed&&(!hasConversation||suggestionsOpen);
  const hasBrief=studio.briefReady&&!studio.briefError&&studio.hasSavedBrief&&!!studio.brief.description.trim();
  const resultSuggestions:Array<{label:string;open:(event:React.MouseEvent<HTMLButtonElement>)=>void}>=[];
  if(!hasBrief)resultSuggestions.push({label:'完善活动需求',open:openBrief});
  if(!studio.images.some(image=>image.kind==='floorplan'))resultSuggestions.push({label:'准备场地图纸',open:openReference});
  if(studio.layout.eventOperations?.tasks.length)resultSuggestions.push({label:'整理执行时间表',open:event=>openDeliveryView('operations',event)});
  if(sceneItems.length)resultSuggestions.push({label:'核对物料交接',open:event=>openDeliveryView('materials',event)});
  if(hasBrief)resultSuggestions.push({label:'准备客户方案',open:openReview});
  function renderMessage(m:Message):JSX.Element {return <div key={m.id} className={`cr-message is-${m.role}`}>{m.role==='assistant'&&<span className="cr-message-avatar" aria-hidden="true"><AssistantMascot/></span>}<div className="cr-message-body"><span className="sr-only">{m.role==='assistant'?'Bingo':'你'}</span><p>{m.text}</p>{(m.modelText || m.modelSuggestions?.length || m.materialSuggestions?.length) ? <ModelTextDisclosure>{m.modelText&&<p>{m.modelText}</p>}{m.modelSuggestions?.map((suggestion,index)=><article className="cr-model-suggestion" key={`${m.id}-${index}`}><strong>{suggestion.name}</strong><p>{suggestion.reason}</p><p>{suggestion.prompt}</p><small>可继续描述尺寸。不支持的造型会明确说明。</small></article>)}{m.materialSuggestions?.map((suggestion,index)=><article className="cr-model-suggestion" key={`${m.id}-material-${index}`}><strong>{suggestion.name}</strong><p>{suggestion.reason}</p><button type="button" onClick={()=>{const {scope:materialScope,...input}=suggestion;previewMaterial({...input,materialScope,modelSuggested:true});}}>预览材质调整</button><small>仅调整指定的 {suggestion.objectIds.length} 件物料；原版本保留，确认后应用。</small></article>)}</ModelTextDisclosure> : null}</div></div>;}
  const businessContent=(
      <div id="creative-business" tabIndex={-1} className={`cr-workspace-content ${docked?'cr-business-content':''}`} hidden={docked&&!workspaceExpanded} ref={content} onKeyDown={event=>{if(docked&&event.key==='Escape'&&!event.defaultPrevented){event.stopPropagation();const clicked=businessEntry.current;resizeWorkspace(false);if(clicked?.isConnected&&clicked.closest('[hidden]')&&!content.current?.contains(clicked)){setExpanded(true);queueMicrotask(()=>clicked.focus());}}}}>
        {(workbenchMode==='review'||workbenchMode==='delivery'||!hideCategorySelect||!onOpenTemplates)&&<header className="cr-business-heading">
          {workbenchMode==='review'?<div className="cr-mode-banner"><strong>发给客户</strong><span>核对后导出离线 HTML，由你发送</span></div>:workbenchMode==='delivery'?<div className="cr-mode-banner"><strong>执行 · 本机内部资料</strong><span>活动安排、点验、导出与本机备份</span></div>:
          (!hideCategorySelect&&<label className="cr-business-category"><span className="sr-only">布置工具</span><select value={primaryCategoryValue} onChange={event=>{const value=event.target.value;if(value==='more'||value==='commercial')openCommercial();else if(value==='brief')openBrief();else if(value==='reference')openReference();else if(value==='rebuild')openRebuild();else if(value==='templates')openTemplates();else if(value==='model')openModelTools();else if(value==='delivery')openDelivery();else if(value==='review')openReview();}}><option value="brief">活动需求</option><option value="reference">图纸与照片</option><option value="rebuild">场地重建</option><option value="templates">场景模板</option><option value="model">物料工具</option><option value="more">更多…</option><option value="delivery" hidden>执行资料</option><option value="review" hidden>方案评审</option>{commercialPanel!=null&&<option value="commercial" hidden>合同与约定</option>}</select></label>)}
          {!onOpenTemplates&&<div>{docked&&templatesOpen&&<button type="button" onClick={()=>setTemplatesOpen(false)}>返回当前工作区</button>}{docked&&<button type="button" onClick={()=>resizeWorkspace(false)}><ArrowLeft size={16}/>返回素材</button>}</div>}
        </header>}
        {studio.briefError&&<p className="cr-agent-notice" role="alert">{studio.briefError}<button type="button" onClick={studio.retryBrief}>{studio.briefReady?'重试保存需求':'重试读取需求'}</button></p>}
        {leaseLost&&<p className="cr-agent-notice" role={projectsError?'alert':'status'}>{projectsError||'这个项目现在由别人编辑，你的改动只保留在本机。'}{!projectsError&&<button type="button" onClick={()=>void goProjects()}>去项目页接手编辑</button>}</p>}
        {businessMode==='commercial'&&workbenchMode==='layout'&&<p className="cr-hint" role="status">合同与约定已放入「更多」。深度商业档案仍保留，不占主流程。</p>}
        <section id="agent-panel-plan" aria-label="场景策划" hidden={businessMode!=='plan'||templatesOpen}><details ref={briefDetails} className="cr-agent-brief" open><summary>{planCategory==='reference'?'图纸与照片':planCategory==='rebuild'?'场地重建':'活动需求与场地资料'}</summary><CreativeBriefPanel view={planCategory} showNotice={false} forcePreview={docked&&suppressAgentLauncher} descriptionRef={briefDescription} referenceOpenRequest={referenceOpenRequest+localReferenceRequest} referencePanelRef={referencePanel} referencePanel={referenceImagePanel} onSkip={()=>{resizeWorkspace(false);}} onBackToChat={()=>openChatRef.current()} onSwitchView={value=>{if(value==='rebuild')openRebuild();else if(value==='reference')openReference();else openBrief();}}/></details></section>
        <section id="agent-panel-model" aria-label="物料生成" hidden={businessMode!=='model'||templatesOpen}>
          <nav className="cr-model-tools" aria-label="3D 内容工具">{([['generate','物料生成'],['customize','材质调整']] as const).map(([key,label])=><button type="button" key={key} aria-pressed={modelTool===key} onClick={()=>setModelTool(key)}>{label}</button>)}</nav>
          <div hidden={modelTool!=='generate'}>{modelOpened&&((typeof generationPanel==='function'?generationPanel(generationContext):generationPanel)??<p className="sc-note">登录并打开云项目后可查看历史模型。</p>)}</div>
          {modelOpened&&<div hidden={modelTool!=='customize'}>{materialSeed?.scope===studio.scope&&<button type="button" className="sc-button" onClick={()=>setMaterialSeed(undefined)}>使用当前选中物件</button>}<MaterialCustomization controller={studio.controller} layout={studio.layout} onApply={applyMaterial} seed={materialSeed?.scope===studio.scope?materialSeed:undefined} active={(docked?workspaceExpanded:studio.expanded)&&!templatesOpen&&businessMode==='model'&&modelTool==='customize'}/></div>}
        </section>
        <section id="agent-panel-delivery" aria-label="执行交付" hidden={businessMode!=='delivery'||templatesOpen}>{deliveryOpened&&<div ref={deliveryFocusTarget} tabIndex={-1} role="group" aria-label="执行工作单"><SceneDeliveryPanel captureImage={studio.captureImage} capturePendingCandidates={studio.capturePendingCandidates} captureLocalDraftExport={studio.captureLocalDraftExport} activityTaskPanel={activityTaskPanel?.({layout:studio.layout,disabled:studio.busy||studio.backupPending,checkins:studio.checkins,briefState:{brief:studio.brief,ready:studio.briefReady,error:studio.briefError,hasSavedBrief:studio.hasSavedBrief}})} deliveryViewRequest={deliveryViewRequest} layout={studio.layout} controller={studio.controller} captureMobility={studio.captureMobility} captureDialogue={studio.captureDialogue} checkins={studio.checkins} onLocate={selectOnly} onUpdateItem={studio.onUpdateItem} onUpdateEventOperations={studio.onUpdateEventOperations} onUpdateProductionPlan={studio.onUpdateProductionPlan} backupActions={studio} briefState={{brief:studio.brief,ready:studio.briefReady,error:studio.briefError,hasSavedBrief:studio.hasSavedBrief}} onOpenBrief={openBrief} onBackupRestored={finishBackupNavigation}/></div>}</section>
        <section id="agent-panel-review" aria-label="方案评审" hidden={businessMode!=='review'||templatesOpen}>{reviewOpened&&<div ref={reviewTarget} tabIndex={-1} role="group" aria-label="当前方案评审"><ProjectReviewPanel storageIdentity={JSON.stringify([studio.controller.config.apiUrl,studio.controller.getSnapshot().user?.id??null,studio.reviewSource.scope])} source={studio.reviewSource} actions={{getSource:studio.getReviewSource,prepare:studio.prepareReview,prefill:prefillReview,...(captureReview?{capture:(snapshot,options)=>{if(studio.preview||studio.busy)throw new Error('请先结束候选预览或当前任务，再捕获画面。');return captureReview(snapshot,options,studio.getReviewSource);}}:{})}} inputLocked={studio.backupPending} disabled={studio.busy||!studio.briefReady||!!studio.briefError}/></div>}</section>
        {commercialPanel!=null&&<section id="agent-panel-commercial" aria-label="合同与约定" hidden={businessMode!=='commercial'||templatesOpen}>{commercialOpened&&<div ref={commercialTarget} tabIndex={-1} role="group" aria-label="合同与约定资料">{commercialPanel}</div>}</section>}
        {!onOpenTemplates&&<section aria-label="场景模板资源" hidden={!templatesOpen}>{templatesOpen&&<ScenePresetsPanel layout={studio.layout} onApply={studio.onApply}/>}</section>}
      </div>
  );
  return <div className={`cr-assistant ${docked?'is-docked':''} ${studio.expanded?'is-open':''} ${!docked&&studio.expanded&&workspaceExpanded?'is-workspace-expanded':''} ${selectedItem?'has-properties':''}`}>
    {docked&&businessOpened&&businessHost&&createPortal(businessContent,businessHost,'creative-business')}
    {!(docked&&suppressAgentLauncher)&&(docked||opened||studio.expanded)&&<section hidden={!studio.expanded} id="creative-assistant" className={`cr-chat ${!docked&&workspaceExpanded?'is-expanded':''}`} aria-label="Agent" onKeyDown={event=>{if(event.key==='Escape'&&!event.defaultPrevented){event.stopPropagation();closeChat();}}}>
      <header><div className="cr-header-brand"><div><strong>Bingo</strong><small title={localSaveError?undefined:studio.layout.name} role={localSaveError?'alert':undefined}>{localSaveError?'本机保存失败，请导出备份':`${operationScope} · ${studio.layout.name}`}</small></div></div><div className="cr-chat-header-actions"><button type="button" aria-label={docked?'关闭聊天':'关闭 Agent'} onClick={closeChat}><X size={20}/></button></div></header>
      {!docked&&<div className="cr-workspace-tools">{templatesOpen&&<button type="button" onClick={()=>setTemplatesOpen(false)}><ArrowLeft size={16}/>返回当前工作区</button>}<button className="cr-workspace-toggle" type="button" aria-pressed={workspaceExpanded} onMouseDown={event=>{if(event.button===0)event.preventDefault();}} onClick={()=>resizeWorkspace(!workspaceExpanded)}>{workspaceExpanded?<Minimize2 size={16}/>:<Maximize2 size={16}/>}<span>{workspaceExpanded?'恢复浮窗':'展开工作区'}</span></button><span>{studio.connection}</span><div className="cr-chat-toggle-wrap" hidden={!workspaceExpanded}><button ref={chatToggle} className="cr-chat-toggle" type="button" aria-label={chatHidden?'展开聊天':'收起聊天'} aria-controls="creative-conversation" aria-expanded={!chatHidden} aria-describedby={chatHidden&&chatPending?'creative-conversation-status':undefined} onClick={toggleChat}>{chatHidden?'展开聊天':'收起聊天'}</button>{chatHidden&&chatPending&&<span id="creative-conversation-status" className="cr-chat-pending" role="status" aria-live="polite">{chatPending} · 展开聊天查看</span>}</div></div>}
      <div className={`cr-plan-panel cr-workspace-body ${chatHidden?'is-chat-collapsed':''}`}>
      {!docked&&businessContent}
      <section id="creative-conversation" className="cr-conversation" aria-label="Bingo 聊天" hidden={chatHidden} ref={conversation} tabIndex={-1}>

      <div className="cr-chat-feed" ref={feed}>
        {studio.messages.filter(message=>message.id==='welcome').map(renderMessage)}
        {!suggestionsVisible&&<button ref={suggestionsToggle} type="button" className="cr-suggestions-toggle" aria-expanded={false} aria-controls="creative-result-suggestions" onClick={()=>{setSuggestionsDismissed(false);setSuggestionsOpen(true);queueMicrotask(()=>suggestionsCard.current?.focus());}}>查看建议</button>}
        <section ref={suggestionsCard} tabIndex={-1} id="creative-result-suggestions" className="cr-result-suggestions" aria-label="成果建议" hidden={!suggestionsVisible}><header><strong>想先处理哪一项？</strong><button type="button" aria-label="关闭成果建议" onClick={()=>{setSuggestionsDismissed(true);setSuggestionsOpen(false);queueMicrotask(()=>suggestionsToggle.current?.focus());}}><X size={20}/></button></header><div>{resultSuggestions.slice(0,3).map((suggestion,index)=><button type="button" key={suggestion.label} onClick={suggestion.open}><span className="cr-suggestion-letter" aria-hidden="true">{['A','B','C'][index]}</span><span>{suggestion.label}</span></button>)}</div></section>
        <div aria-live="polite"><div>{studio.messages.filter(message=>message.id!=='welcome').map(renderMessage)}</div>
        {studio.busy&&<div className="cr-chat-working"><Loader2 className="cr-spin" size={16}/><span>{studio.run?.progress||'正在提交任务…'}</span>{(!studio.run||['queued','running'].includes(studio.run.state))&&<button type="button" onClick={()=>void studio.cancelRun()}>取消任务</button>}</div>}
        {studio.applyRecovery&&<div className="cr-proposal" role="alert"><p>{studio.applyRecovery.outcome==='pending'?'云端提交结果尚不明确，未重复提交。请保留本地草稿，并只读核对云端版本。':studio.applyRecovery.outcome==='cleanup_failed'?'本机核对记录未能清除，请核对云端与本地版本后解除提醒。':`云端已提交第 ${studio.applyRecovery.revision} 版，本机应用结果未能确认。请先保留本地草稿，再打开云端项目核对差异。`}</p><button type="button" disabled={studio.busy||studio.reviewingApplyRecovery} onClick={()=>void studio.reviewApplyRecovery()}>{studio.reviewingApplyRecovery?'正在只读核对…':'只读核对云端版本'}</button>{studio.applyRecoveryReview&&<><p>{studio.applyRecoveryReview.message}</p><button type="button" disabled={studio.busy||studio.reviewingApplyRecovery} onClick={()=>void studio.acknowledgeApplyRecovery()}>{studio.applyRecoveryReview.status==='unknown'?'我已手动核对，解除提醒':'已查看核对结果，解除提醒'}</button></>}</div>}
        {studio.recoverable&&!studio.applyRecovery&&<div className="cr-proposal"><p>原任务结果待核对。查询会继续读取原任务，不会再次提交生成。</p><button type="button" disabled={studio.busy} onClick={()=>void studio.recoverRun()}>查询原任务</button><button type="button" disabled={studio.busy} onClick={()=>void studio.cancelRun()}>取消原任务</button></div>}
        {studio.candidates.length>0&&studio.run?.jevEnabled&&<div className="cr-candidates" aria-label="JEV 方案比较">
          <p>可分别预览候选方案；模型评价不代表安全或规范验收。</p>{studio.run.evaluation?.message&&<ModelTextDisclosure><p>{studio.run.evaluation.message}</p></ModelTextDisclosure>}
          {studio.run.evaluation?.status==='complete'&&<p>模型推荐概率表示本轮方案间的相对偏好，不是真实成功率。{studio.run.evaluation.confidence!==undefined?`评价信心 ${(studio.run.evaluation.confidence*100).toFixed(0)}%。`:''}</p>}
          <div>{studio.candidates.map(item=><button type="button" key={item.label} aria-pressed={studio.preview===item.preview} disabled={studio.busy||studio.stale} onClick={()=>studio.selectCandidate(item.label)}><strong>方案 {item.label}</strong>{isUnchangedProposal(item.preview.proposal)&&<span>当前场景，无变化</span>}{studio.run?.evaluation?.status==='complete'&&studio.run.evaluation.probabilities&&<span>模型推荐概率 {(studio.run.evaluation.probabilities[item.label]*100).toFixed(1)}%</span>}</button>)}</div><ModelTextDisclosure>{studio.candidates.map(item=><p key={item.label}>方案 {item.label}：{item.title}</p>)}</ModelTextDisclosure>
          {studio.run.evaluation?.status==='complete'&&studio.run.evaluation.probabilities&&<p>均不推荐：{(studio.run.evaluation.probabilities.NONE*100).toFixed(1)}%{studio.run.evaluation.choice==='NONE'?' · 建议调整需求后重试。':''}</p>}
        </div>}
        {studio.preview&&summary&&<div className="cr-proposal"><span>方案提案 · 尚未应用</span>{previewRecipeId&&<span className="cr-recipe-badge" data-testid="recipe-id" style={{marginLeft:8,padding:'2px 6px',borderRadius:4,background:'#F4F5F7',fontSize:12,color:'#4A7C59',fontWeight:600,letterSpacing:0.5}}>{`方案 #${previewRecipeId}`}</span>}{previewRecipeId&&<span data-testid="seed-origin" style={{marginLeft:6,fontSize:11,opacity:0.7}}>seed：本机生成</span>}<strong>新增 {summary.added} · 移除 {summary.removed} · 共 {summary.total} 件</strong><p>请核对下方实际改动；通行、消防及规范条件仍需独立核验。</p>{seatAdvisory&&<p role="status">{seatAdvisory}</p>}<p>{REFERENCE_SOURCE_UNVERIFIED}</p><ModelTextDisclosure><p>{studio.preview.proposal.explanation}</p></ModelTextDisclosure>{previewRecipeId&&<div style={{display:'flex',alignItems:'center',gap:8,margin:'4px 0 8px',flexWrap:'wrap'}}><button type="button" data-testid="variants-toggle" onClick={()=>setVariantRowOpen(v=>!v)} style={{display:'inline-flex',alignItems:'center',gap:4,fontSize:12,padding:'3px 8px',border:'1px solid var(--sc-line,#ccc)',borderRadius:4,background:'transparent',cursor:'pointer'}}><RefreshCw size={12}/>换一批</button>{variantRowOpen&&variantIds.length>0&&<div style={{display:'flex',gap:6}}>{variantIds.map((id,idx)=>{const active=idx===selectedVariantIdx;return <button key={id} type="button" data-testid={`variant-${idx}`} aria-pressed={active} onClick={()=>setSelectedVariantIdx(idx)} style={{padding:'4px 8px',fontSize:12,fontFamily:'monospace',borderRadius:4,cursor:'pointer',border:`1.5px solid ${active?'#4A7C59':'var(--sc-line,#ccc)'}`,background:active?'#F4F5F7':'transparent',color:active?'#4A7C59':'inherit'}}>#{id}</button>;})}</div>}</div>}{studio.preview.proposal.warnings.length>0&&<div role="status"><p>提案包含 {studio.preview.proposal.warnings.length} 项场地检查提示：</p><ul>{studio.preview.proposal.warnings.map((warning,index)=><li key={`${warning.code}-${index}`}>{proposalWarningText(warning,id=>studio.preview!.layout.floors.flatMap(floor=>floor.items).find(item=>item.id===id)?.name??'物件')}</li>)}</ul></div>}<ul>{differences.map(change=><li key={change.id}>{({added:'新增',removed:'移除',changed:'调整'} as const)[change.kind]} · {change.after?.item.name ?? change.before?.item.name}<small>{change.after ? ` · ${change.after.item.width} × ${change.after.item.depth} m` : ''}</small></li>)}</ul>{annotationAdvisory&&<p role="status">{annotationAdvisory}</p>}<p>画布中的半透明模型是候选方案。绿色框为新增，蓝色框为改动，橙色框为原位置，红色框为移除；确认前不会保存。</p>{studio.stale?<p role="status">{studio.expired?'提案已过期，请重新生成。':'场景、需求或编辑权已变化，请重新生成。'}</p>:previewUnchanged?<div><p role="status">这版与当前场景一致，没有改动物件；可作为对照，是否满足需求仍需核对。</p><button type="button" onClick={studio.discardPreview}><Trash2 size={16}/>放弃</button></div>:studio.busy||studio.recoverable?<p role="status">{studio.recoverable&&!studio.busy?'上一版还在恢复，确认先不亮。':'正在整理这一版…'}</p>:<div><button type="button" disabled={!!annotationAdvisory} onClick={()=>void studio.applyPreview()}><Check size={16}/>确认布置</button><button type="button" onClick={studio.discardPreview}><Trash2 size={16}/>放弃</button></div>}</div>}
        {studio.preview&&workspaceExpanded&&!studio.stale&&<button className="cr-return-canvas" type="button" onClick={()=>resizeWorkspace(false)}><Minimize2 size={16}/>回到画布预览</button>}
        </div>
      {studio.notice&&<p className="cr-agent-notice" role="status">{studio.notice}</p>}
      </div>
      <form id="creative-message-form" className="cr-chat-composer" onSubmit={event=>{event.preventDefault();submit();}}>
        {archivedDrafts.length>0&&<details><summary>其他活动的未发送草稿</summary><p>草稿仅保留在本页面，刷新或关闭后会丢失。请核对后再取回。</p>{archivedDrafts.map(item=><div key={`${item.scope}:${item.kind}`}><p>{item.text}</p><button type="button" disabled={!!draft.trim()} onClick={()=>setDraft(item.text)}>取回到当前输入</button></div>)}</details>}
        <label className="sr-only" htmlFor="creative-message">告诉助手你的想法</label><textarea ref={messageInput} id="creative-message" value={draft} maxLength={1800} onChange={event=>setDraft(event.target.value)} placeholder={mode==='model'?'填写物料尺寸、样式和摆放要求……':'告诉我想怎么调整……'} rows={2} onKeyDown={event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.nativeEvent.isComposing){event.preventDefault();submit();}}}/>
        <div className="cr-composer-toolbar"><label className="sr-only" htmlFor="creative-work-mode">工作模式</label><select id="creative-work-mode" value={mode} onChange={event=>{const next=event.target.value as ChatMode;setMode(next);if(next==='model')setModelOpened(true);if(!docked){setBusinessMode(next);setTemplatesOpen(false);}}}>{(Object.keys(CHAT_MODES) as ChatMode[]).map(key=><option value={key} key={key}>{CHAT_MODES[key]}</option>)}</select>
          <details ref={settings} className="cr-agent-settings" onKeyDown={event=>{if(event.key==='Escape'&&event.currentTarget.open){event.preventDefault();event.stopPropagation();event.currentTarget.open=false;settingsToggle.current?.focus();}}}>
            <summary ref={settingsToggle} aria-label="助手设置"><SlidersHorizontal size={16}/><small>{studio.jevEnabled?'JEV 开 · 先比较':mode==='model'?'物料先预览':'确认后应用'}</small></summary><div className="cr-settings-panel">
      {!demoBackend&&<div className="cr-agent-mode"><span>先预览，再确认布置</span></div>}
      <div className="cr-agent-mode"><label><input type="checkbox" checked={studio.jevEnabled} disabled={studio.busy} onChange={event=>studio.setJevEnabled(event.target.checked)}/>JEV 决策模式</label><span>生成 3 个方案，由你最终选择</span></div>
      <p className="cr-hint">{demoHint}</p>
            </div></details><button aria-label="发送消息" type="submit" disabled={!draft.trim()||studio.busy||studio.recoverable}><ArrowUp size={20}/></button>
        </div>
      </form>
      <footer/>
      </section>
      </div>
    </section>}
    {!studio.expanded&&chatPending&&<span className="sr-only" role="status" aria-live="polite">{chatPending}</span>}
    {assistantLauncher&&(docked&&assistantEntryHost?createPortal(assistantLauncher,assistantEntryHost):assistantLauncher)}
  </div>;
}
