"use client";

import { useSyncExternalStore } from "react";
import { z } from "zod";
import { assertFreshProposal, createSceneClient, SceneApiError, type EditorState, type Proposal } from "../../client/scene-client";
import { activityTaskRunRequestSchema, type ActivityTaskRun, type ActivityTaskRunRequest } from "../../supabase/functions/_shared/activity-task-contract";
import { agentRunRequestSchema, agentRunSchema, type AgentRun, type AgentRunRequest } from "../../supabase/functions/_shared/agent-contract";
import {parseAgentRunEvents,type AgentRunEventPage} from './agent-run-events';
import { resolvedMaterialSuggestionSchema, type MaterialSuggestion } from "../../supabase/functions/_shared/agent-material-contract";
import { materialVariantProposalRequestSchema } from "../../supabase/functions/_shared/asset-customization-contract";
import { briefExtractRequestSchema, briefExtractResponseSchema, briefConversationRequestSchema, briefConversationResponseSchema, parseBriefConversation, type BriefExtractResponse, type BriefConversationResponse } from "../../supabase/functions/_shared/brief-extract-contract";
import { assistantChatRequestSchema, assistantChatResponseSchema, type AssistantChatResult } from "../../supabase/functions/_shared/assistant-chat-contract";
import { chatProviderSchema, type ChatProviderId } from "../../supabase/functions/_shared/chat-provider";
import { canonical, sha256, proposalRequestSchema, sceneSchema, uuid, type Scene } from "../../supabase/functions/_shared/domain";
import { generationRequestSchema, type GenerationRequest } from "../../supabase/functions/_shared/generation-contract";
import { reconstructionRequestSchema, reconstructionJobSchema, sourceImageSchema, type ReconstructionRequest, type SourceImage } from "../../supabase/functions/_shared/reconstruction-contract";
import { geometryWorkbenchBindingKey, readGeometryWorkbenchBinding, writeGeometryWorkbenchBinding, type GeometryWorkbenchBinding } from "./geometry-workbench-binding";
import { createSupabaseBrowserClient } from "./supabase/client";
import type { Session, SupabaseClient, User } from "@supabase/supabase-js";
import {commitOriginalReview,isOriginalReviewReceipt,originalReviewReceiptKey,readOriginalReviewPending,type OriginalReviewReceipt} from './original-review-commit';
import {auditOriginalReviewStartup,type OriginalReviewCompletion,type OriginalReviewCompletionStore,type OriginalReviewCloudEvidence} from './original-review-completion';
import {createOriginalReviewLedger} from './original-review-ledger-idb';
import {localWriteCapabilityGuard,type LocalWriteCapability} from './local-write-lease';
import {sameRecoveryFormValue} from './recovery-form-value';
export { SceneApiError };
export type { AgentRun };
export type { ChatProviderId };
export type AgentRunInput = Pick<AgentRunRequest, "requestId" | "scene" | "selectedIds" | "instruction" | "context" | "jevEnabled" | "executionMode" | "provider">;
export type ActivityTaskRunInput = Pick<ActivityTaskRunRequest, "requestId" | "instruction" | "activityContext">;
export type { ActivityTaskRun };
export type { SourceImage, DimensionConstraint, SceneV2 } from "../../supabase/functions/_shared/reconstruction-contract";
export type ReconstructionJob = Pick<z.infer<typeof reconstructionJobSchema>, 'id' | 'state' | 'candidate' | 'issues' | 'error_code'> & { proposal?: SceneProposal | null | undefined };
export type ReconstructionInput = Pick<ReconstructionRequest, 'scene' | 'sources' | 'dimensions' | 'mode' | 'instruction' | 'selectedIds' | 'reviewedScene' | 'reviewedJobId'> & { requestId: string };
function parseReconstructionJob(input: unknown): ReconstructionJob {
  const parsed = reconstructionJobSchema.parse(input);
  return {...parsed, proposal: parsed.proposal ? proposalResponseSchema.parse(parsed.proposal) : parsed.proposal};
}
export type { Scene };
// Completion cleanup stays disabled until the ledger exposes a non-forgeable,
// session-bound authorization instead of ordinary capability-based deletion.
const ORIGINAL_REVIEW_COMPLETION_ENABLED:boolean=false;

/** Unexported: callers cannot supply a real storage and fabricate cloud evidence. */
async function reconcileVerifiedOriginalReview(options:{accountId:string;projectId:string;storage:Storage;ledger:OriginalReviewCompletionStore;isCurrent:()=>boolean;readCloud:()=>Promise<OriginalReviewCloudEvidence>}):Promise<'cleared'|'blocked'> {
 const {accountId,projectId,storage,ledger,isCurrent,readCloud}=options;
 try{
  const key=originalReviewReceiptKey(accountId,projectId);if(!isCurrent())return 'blocked';
  const pending=readOriginalReviewPending(storage,key),old=await ledger.get(key);
  const valid=(value:unknown):value is OriginalReviewCompletion=>!!value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join(',')==='appliedRevision,receipt,version'&&
   (value as OriginalReviewCompletion).version===1&&isOriginalReviewReceipt((value as OriginalReviewCompletion).receipt)&&
   (value as OriginalReviewCompletion).appliedRevision===(value as OriginalReviewCompletion).receipt.baseRevision+1;
  if(!isCurrent()||pending.state==='unavailable'||(old!==null&&!valid(old)))return 'blocked';
  const receipt=pending.state==='pending'?pending.receipt:old&&valid(old)?old.receipt:null;
  if(!receipt||receipt.projectId.toLowerCase()!==projectId.toLowerCase()||(old!==null&&(!valid(old)||!sameRecoveryFormValue(old.receipt,receipt))))return 'blocked';
  const cloud=await readCloud();
  if(!isCurrent()||cloud.projectId!==receipt.projectId||cloud.reviewId!==receipt.reviewId||cloud.baseHash!==receipt.baseHash||cloud.candidateHash!==receipt.candidateHash||cloud.baseRevision!==receipt.baseRevision||cloud.appliedRevision!==receipt.baseRevision+1||cloud.currentRevision!==receipt.baseRevision+1||cloud.currentSceneHash!==receipt.candidateHash)return 'blocked';
  const completion:OriginalReviewCompletion={version:1,receipt,appliedRevision:receipt.baseRevision+1};
  if(old===null){await ledger.put(key,completion);if(!isCurrent()||!sameRecoveryFormValue(await ledger.get(key),completion))return 'blocked';}
  else if(!sameRecoveryFormValue(old,completion))return 'blocked';
  const latest=readOriginalReviewPending(storage,key);
  if(latest.state==='unavailable'||(latest.state==='pending'&&!sameRecoveryFormValue(latest.receipt,receipt)))return 'blocked';
  if(latest.state==='pending')storage.removeItem(key);
  if(!isCurrent()||storage.getItem(key)!==null)return 'blocked';
  await ledger.delete(key);
  if(!isCurrent()||await ledger.get(key)!==null||storage.getItem(key)!==null)return 'blocked';
  return 'cleared';
 }catch{return 'blocked';}
}

/** Only the authenticated, locked coordinator below calls this guarded CAS. */
async function deleteVerifiedOriginalCompletion(key:string,expected:OriginalReviewCompletion,guard:ReturnType<typeof localWriteCapabilityGuard>,current:()=>boolean):Promise<void> {
  const check=()=>{guard.assertStillHeld();if(guard.signal.aborted||!current())throw new Error('核对权限已失效。');};
  check();
  const db=await new Promise<IDBDatabase>((resolve,reject)=>{
    let done=false;const request=indexedDB.open('scendance-original-review-ledger-v1',1);
    request.onupgradeneeded=()=>{try{request.transaction?.abort();}catch{};};
    request.onblocked=()=>{done=true;reject(new Error('完成记录正被占用。'));};
    request.onerror=()=>{done=true;reject(request.error??new Error('完成记录不可读取。'));};
    request.onsuccess=()=>{if(done){request.result.close();return;}try{check();done=true;resolve(request.result);}catch(error){request.result.close();reject(error);}};
  });
  try {await new Promise<void>((resolve,reject)=>{
    check();const tx=db.transaction('records','readwrite',{durability:'strict'}),abort=()=>{try{tx.abort();}catch{}};
    guard.signal.addEventListener('abort',abort,{once:true});
    const cleanup=()=>guard.signal.removeEventListener('abort',abort);
    tx.oncomplete=()=>{cleanup();try{check();resolve();}catch(error){reject(error);}};
    tx.onerror=tx.onabort=()=>{cleanup();reject(tx.error??new Error('完成记录事务已中断。'));};
    try{
      check();const store=tx.objectStore('records'),request=store.get(key);
      request.onsuccess=()=>{try{
        check();if(!sameRecoveryFormValue(request.result,expected))throw new Error('完成记录已变化。');
        const deletion=store.delete(key);deletion.onsuccess=()=>{try{check();}catch{abort();}};
      }catch{abort();}};
    }catch(error){abort();cleanup();reject(error);}
  });}finally{db.close();}
}

const originalReviewResponseSchema=z.object({
  id:uuid,projectId:uuid,baseRevision:z.number().int().nonnegative(),baseHash:z.string().regex(/^[a-f0-9]{64}$/),candidateHash:z.string().regex(/^[a-f0-9]{64}$/),
  expiresAt:z.string(),appliedAt:z.string().nullable(),appliedRevision:z.number().int().nonnegative().nullable(),
  changes:z.array(z.object({path:z.string(),before:z.object({present:z.boolean(),value:z.unknown().optional()}),after:z.object({present:z.boolean(),value:z.unknown().optional()})})).max(512),
});
function parseOriginalReview(raw:unknown,projectId:string,reviewId:string) {
  const parsed=originalReviewResponseSchema.safeParse(raw);
  if(!parsed.success||parsed.data.projectId!==projectId||parsed.data.id!==reviewId||!Number.isFinite(Date.parse(parsed.data.expiresAt))||
    ((parsed.data.appliedAt===null)!==(parsed.data.appliedRevision===null))||
    (parsed.data.appliedAt!==null&&!Number.isFinite(Date.parse(parsed.data.appliedAt))))throw new SceneApiError('INVALID_RESPONSE',502,null);
  return parsed.data;
}

export interface BackendConfig {
  configured: boolean;
  url: string;
  anonKey: string;
  apiUrl: string;
  error: string | null;
}

/** Explicit fixture-only private box preview, never a production HTTP exception. */
function isDevelopmentFixtureHost(host: string): boolean {
  if (process.env.NODE_ENV === 'production' || process.env.NEXT_PUBLIC_LOCAL_FIXTURE !== '1') return false;
  if (!/^(10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(?:1[6-9]|2\d|3[01])\.\d+\.\d+)$/.test(host)) return false;
  try { return new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').hostname === host; } catch { return false; }
}

/** Only public configuration belongs in a browser bundle. Verified guests can persist in this browser; lease identities never do. */
export function getBackendConfig(input?: { url?: string; anonKey?: string }): BackendConfig {
  const url = (input?.url ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim().replace(/\/+$/, "");
  // Supabase 新版控制台叫 publishable key，旧版叫 anon key；publishable 优先，旧名继续兼容。
  const anonKey = (input?.anonKey ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "").trim();
  let error: string | null = null;
  if (!url || !anonKey) error = "请配置 NEXT_PUBLIC_SUPABASE_URL 和 NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY（旧名 NEXT_PUBLIC_SUPABASE_ANON_KEY）。";
  else {
    try {
      const parsed = new URL(url);
      const local = ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname) || isDevelopmentFixtureHost(parsed.hostname);
      if ((parsed.protocol !== "https:" && !(local && parsed.protocol === "http:")) || parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== "/") {
        error = "Supabase URL 必须是 HTTPS 项目地址；本地服务可使用 HTTP。";
      }
    } catch { error = "Supabase URL 格式无效。"; }
    if (anonKey.startsWith("sb_secret_")) error = "前端只能使用公开的 anon / publishable key。";
    try {
      const payload = anonKey.split(".")[1];
      if (payload && JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/"))).role === "service_role") {
        error = "前端不能配置 service_role key。";
      }
    } catch { /* Publishable keys are opaque, not JWTs. */ }
  }
  return { configured: error === null, url, anonKey, apiUrl: `${url}/functions/v1/scene-api`, error };
}

export interface BackendUser { id: string; email?: string; is_anonymous?: boolean }
export interface Studio { id: string; name: string; role: "owner" | "editor"; displayName: string }
export interface ProjectSummary {
  id: string; name: string; studio_id: string; revision: number;
  updated_at?: string; current_editor?: string | null; lease_expires?: string | null;
}
export interface BackendProject extends ProjectSummary { scene: Scene; materials?: unknown[]; projection?: {requiresOriginalSceneForWrite:boolean;changed?:boolean;status?:string} }
export interface Lease {
  projectId: string; sessionId: string; generation: number; expiresAt: string; revision: number;
}
export interface BackendFailure { code: string; status: number; message: string }
export interface BackendSnapshot {
  configured: boolean;
  sessionId: string;
  user: BackendUser | null;
  recoveryReady: boolean;
  project: BackendProject | null;
  geometryBinding?: GeometryWorkbenchBinding | null;
  lease: Lease | null;
  revision: number | null;
  /** The latest locally submitted draft survives auth, network, and revision failures. */
  draft: Scene | null;
  localRevision: number;
  dirty: boolean;
  status: "unconfigured" | "signed_out" | "ready" | "editing" | "saving" | "blocked";
  writeBlocked: boolean;
  error: BackendFailure | null;
}

/** 用户级界面偏好（云端账号维度）。缺失字段由前端补本地默认值；工程底稿始终存米。 */
export interface AccountPreferences {
  unit?: 'm' | 'ft';
  showMeasurements?: boolean;
}
interface AuthResponse {
  access_token: string; refresh_token: string; expires_in: number; expires_at?: number; user: BackendUser;
}
interface Tokens { access: string; refresh: string; expiresAt: number }
type AuthResult = Partial<AuthResponse>;
function clearSupabaseCookies(): void {
  if (typeof document === "undefined") return;
  for (const cookie of document.cookie.split(";")) {
    const name = cookie.split("=")[0]?.trim();
    if (name?.startsWith("sb-")) document.cookie = `${name}=; Max-Age=0; path=/`;
  }
}
function toBackendUser(user: User): BackendUser {
  const anonymous = (user as User & { is_anonymous?: boolean }).is_anonymous === true;
  return { id: user.id, ...(user.email ? { email: user.email } : {}), ...(anonymous ? { is_anonymous: true } : {}) };
}
function toAuthResult(session: Session | null, user: User | null): AuthResult | null {
  if (!session?.access_token || !session.refresh_token || !user?.id) return null;
  return {
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    expires_in: session.expires_in ?? Math.max(1, (session.expires_at ?? Math.floor(Date.now() / 1000) + 3600) - Math.floor(Date.now() / 1000)),
    ...(session.expires_at === undefined ? {} : { expires_at: session.expires_at }),
    user: toBackendUser(user),
  };
}
export interface SaveResult { id: string; revision: number; scene: Scene; updatedAt: string; warnings: { code: string; ids: string[] }[] }
export interface AuthorizedAssets { assetUrls: Record<string, string>; assetNames: Record<string, string> }
/** Actual /proposals response from scene_private.proposals. */
export interface SceneProposal extends Proposal {
  user_id: string;
  base_scene: Scene;
  explanation: string;
  warnings: { code: string; ids: string[] }[];
  modelSuggestions?: { name: string; reason: string; prompt: string }[] | undefined;
  materialSuggestions?: MaterialSuggestion[] | undefined;
}
export interface SceneProposalInput {
  mode: "layout" | "modify";
  prompt: string;
  scene: Scene;
  selectedIds?: string[];
  requestId?: string;
}
/** Applying a proposal saves it on the server; do not issue a second save. */
export interface ApplySceneProposalResult {
  id: string; revision: number; scene: Scene; updatedAt: string;
  previousScene: Scene; undoGroup: string;
  /** False when the user edited locally while the apply request was in flight. */
  acceptedLocally: boolean;
}
const dateString = z.string().refine(value => Number.isFinite(Date.parse(value)));
const proposalResponseSchema = z.object({
  id: uuid, project_id: uuid, user_id: z.string().min(1), session_id: uuid,
  generation: z.number().int().positive(), base_revision: z.number().int().nonnegative(),
  local_revision: z.number().int().nonnegative(), base_hash: z.string().regex(/^[a-f0-9]{64}$/),
  base_scene: sceneSchema, candidate: sceneSchema, explanation: z.string(),
  warnings: z.array(z.object({ code: z.string(), ids: z.array(uuid) })),
  modelSuggestions: z.array(z.object({ name: z.string().min(1).max(120), reason: z.string().min(1).max(500), prompt: z.string().min(1).max(1024) })).max(3).optional(),
  materialSuggestions: z.array(resolvedMaterialSuggestionSchema).max(3).optional(),
  expires_at: dateString, applied_at: dateString.nullable(),
});
const applyProposalResponseSchema = z.object({
  id: uuid, revision: z.number().int().nonnegative(), scene: sceneSchema,
  updatedAt: dateString, previousScene: sceneSchema, undoGroup: uuid,
});
const generationJobSchema = z.object({
  id: uuid, owner_id: z.string().min(1), prompt: z.string(),
  kind: z.enum(['text','image','texture']).optional(), source_asset_id: uuid.nullable().optional(),
  reference_image_asset_id: uuid.nullable().optional(), provider_model: z.string().nullable().optional(),
  provider_mode: z.enum(['tokenhub','legacy','aholo']).nullable().optional(),
  state: z.enum(["queued", "submitting", "submitted", "processing", "archiving", "ready", "added", "failed", "rejected", "submit_unknown"]),
  provider_job_id: z.string().nullable(), asset_id: uuid.nullable(),
  next_poll_at: dateString, attempts: z.number().int().nonnegative(), error_code: z.string().nullable(),
  provider_usage: z.unknown(), created_at: dateString, updated_at: dateString, reused: z.boolean().optional(),
}).refine(job => !["ready", "added"].includes(job.state) || job.asset_id !== null);
export type GenerationJob = z.infer<typeof generationJobSchema>;
const generationCapabilitiesSchema = z.object({ model: z.string(), textToModel: z.boolean(), imageToModel: z.boolean(), texture: z.boolean(), textureRequiresImage: z.literal(true), aholoTextToModel: z.boolean().default(false), aholoImageToModel: z.boolean().default(false) });
export type GenerationCapabilities = z.infer<typeof generationCapabilitiesSchema>;
const chatProviderCapabilitySchema = z.object({ id: chatProviderSchema, label: z.string(), configured: z.boolean(), agentTools: z.boolean(), model: z.string() });
const chatCapabilitiesSchema = z.object({ active: z.object({ agent: chatProviderSchema.nullable(), brief: chatProviderSchema.nullable() }), providers: z.array(chatProviderCapabilitySchema) });
export type ChatCapabilities = z.infer<typeof chatCapabilitiesSchema>;
export type ChatProviderCapability = z.infer<typeof chatProviderCapabilitySchema>;
interface PaidRequest<T> { fingerprint: string; promise?: Promise<T>; result?: T }
interface RequestScope {
  projectId: string | null;
  lease: Pick<Lease, "projectId" | "sessionId" | "generation"> | null;
}
type LeaseResponse = Omit<Lease, "projectId">;
interface GeometryPreparation {
  current(): boolean;
  bindingFor(project: BackendProject): GeometryWorkbenchBinding;
  persist(binding: GeometryWorkbenchBinding): Promise<void>;
}

function failure(error: unknown): BackendFailure {
  const localCode = error instanceof Error && "code" in error && typeof error.code === "string" ? error.code : null;
  const code = error instanceof SceneApiError ? error.code : localCode ?? (error instanceof Error && error.name === "ZodError" ? "INVALID_RESPONSE" : "NETWORK_ERROR");
  const messages: Record<string, string> = {
    UNAUTHENTICATED: "登录已失效，草稿已保留，请重新登录并获取编辑权。",
    STUDIO_NOT_EMPTY: "工作室中仍有项目，请先处理其中的项目后再删除。",
    STUDIO_NOT_FOUND: "工作室已不存在，或你已没有访问权限，请刷新列表。",
    FORBIDDEN: "你没有执行此操作的权限，请联系工作室负责人。",
    OWNER_PROTECTED: "不能移除工作室负责人。",
    USER_NOT_FOUND: "未找到该邮箱对应的账号，请确认对方已注册并用登录邮箱邀请。",
    INVALID_CREDENTIALS: "邮箱或密码不正确。",
    REVISION_CONFLICT: "云端版本已变化，草稿已保留；请核对后重新获取编辑权。",
    LEASE_LOST: "编辑权已到期或交接，草稿已保留。",
    LEASE_BUSY: "另一编辑会话正在使用此项目。",
    PROJECT_BUSY: "项目仍有人持有编辑权，请先释放或等待到期后再删除。",
    RECONSTRUCTION_BUSY: "项目正在生成方案，请等待任务完成后再删除。",
    NETWORK_ERROR: "连接失败，草稿已保留，云端写入已暂停。",
    CLOUD_WRITE_BLOCKED: "请先获取有效编辑权再保存。",
    ORIGINAL_SCENE_REVIEW_REQUIRED: "此项目含未核验的原始文字，当前仅可只读核对；原始场景已保留，暂不能安全编辑。",
    MODEL_TEXT_REVIEW_REQUIRED: "原候选含未核验的模型文字，不能直接应用；请保留原记录并重新核对。",
    CLOUD_OPERATION_BUSY: "上一个保存或交接仍在进行。",
    CONFIGURATION_MISSING: "云端连接尚未配置。",
    INVALID_RESPONSE: "云端返回的数据格式无效。",
    ASSET_AUTHORIZATION_INVALID: "云端模型的授权信息无效，未替换当前画布，草稿已保留。",
    SESSION_CHANGED: "会话已变化，请重新操作。",
    DAILY_BUDGET_EXCEEDED: "今天的 AI 额度已用完，请明天再试。",
    BUDGET_EXCEEDED: "工作室 AI 总额度已用完，请联系管理员。",
    SERVICE_NOT_CONFIGURED: "AI 服务尚未配置，请联系工作室管理员。",
    BILLING_NOT_CONFIGURED: "AI 费用限制尚未配置，请联系工作室管理员。",
    AI_INVALID_PROPOSAL: "AI 未能生成可用方案，请调整要求后重试。",
    AI_INPUT_TOO_LARGE: "场景内容过长，请缩短物件备注或需求后重试。",
    PROVIDER_HTTP_ERROR: "AI 服务暂时不可用，请稍后手动重试。",
    PROVIDER_INVALID_JSON: "AI 服务返回异常，请稍后手动重试。",
    PROVIDER_TIMEOUT: "AI 响应超时，请稍后手动重试。",
    PROJECT_SWITCH_REQUIRES_RELEASE: "请先交接当前项目的编辑权。",
    LOCAL_ACTIVITY_ID_REQUIRED: "请先打开一个本地活动，再连接场景处理。",
    STALE_PROPOSAL: "方案生成期间场景或编辑权已变化，请根据当前场景重新生成。",
    CANVAS_PROJECT_MISMATCH: "云端项目与当前画布未完成匹配，云端写入已暂停；请重新打开当前活动并核对。",
    LAYOUT_REQUIRES_EMPTY_SCENE: "生成初稿需要空白场景；已有物料请使用修改方案。",
    AI_BUSY: "已有方案正在生成，请等待本次请求完成。",
    GENERATION_BUSY: "已有模型生成任务正在处理，请先查看任务状态。",
    IDEMPOTENCY_CONFLICT: "同一请求编号不能用于不同需求，请创建新的请求。",
  };
  return { code, status: error instanceof SceneApiError ? error.status : 0, message: messages[code] ?? (localCode && error instanceof Error ? error.message : `云端操作失败（${code}），草稿已保留。`) };
}

export class BackendSession {
  readonly config: BackendConfig;
  private snapshot: BackendSnapshot;
  private readonly listeners = new Set<() => void>();
  private tokens: Tokens | null = null;
  private recoveryTokens: Tokens | null = null;
  private readonly supabase: SupabaseClient | null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private operationPending = false;
  private renewing = false;
  private epoch = 0;
  private dispatchScopeEpoch = 0;
  private canvasProjectMismatch = false;
  private owners = 0;
  private lifecycle = 0;
  private readonly proposalRequestIds = new Map<string, string>();
  private lastAppliedReconstruction: { proposal: SceneProposal; epoch: number } | null = null;
  private readonly proposalRequests = new Map<string, PaidRequest<SceneProposal>>();
  private readonly generationRequests = new Map<string, PaidRequest<GenerationJob>>();
  private proposalPending = false;
  private generationPending = false;
  private workbenchPending: { key: string; promise: Promise<BackendProject> } | null = null;
  private workbenchBinding: { localId: string | undefined; projectId: string; userId: string } | null = null;
  private geometryEpoch = 0;
  private geometryPending: { key: string; scope: string; promise: Promise<BackendProject | null> } | null = null;
  private readonly geometryBindings = new Map<string, GeometryWorkbenchBinding>();
  private readonly clientApiUrl: string;
  private readonly client: ReturnType<typeof createSceneClient>;

  /** Conversation bodies are not valid on the deployed scene-api brief schema.
   * Only the dedicated function may receive responseMode or history. */
  private conversationClient():ReturnType<typeof createSceneClient> | null {
    if(process.env.NEXT_PUBLIC_CONVERSATION_API_ENABLED!=='1')return null;
    // The function must belong to the same validated Supabase project. Do not
    // accept an independent URL that could receive the user's access token.
    try {
      const project=new URL(this.config.url),api=new URL(this.config.apiUrl);
      const local=(['localhost','127.0.0.1','[::1]'].includes(project.hostname) || isDevelopmentFixtureHost(project.hostname));
      if(!this.config.configured || (project.protocol!=='https:' && !(local&&project.protocol==='http:')) ||
        project.username || project.password || project.pathname!=='/' || project.search || project.hash ||
        api.origin!==project.origin || api.username || api.password || api.search || api.hash ||
        api.pathname!=='/functions/v1/scene-api' || this.config.apiUrl!==`${this.config.url}/functions/v1/scene-api` ||
        this.config.apiUrl!==this.clientApiUrl)throw new Error('invalid conversation base');
      return createSceneClient(`${this.config.url}/functions/v1/conversation-api`,()=>this.accessToken());
    }catch{throw new SceneApiError('CONVERSATION_API_NOT_CONFIGURED',503,null);}
  }

  constructor(config: BackendConfig = getBackendConfig(), _storage?: Storage, _guestStorage?: Storage) {
    this.config = config;
    this.supabase = config.configured ? createSupabaseBrowserClient(config.url, config.anonKey) : null;
    this.clientApiUrl = config.apiUrl;
    // Never persist this in local/sessionStorage: duplicated tabs must not share a lease identity.
    const sessionId = crypto.randomUUID();
    this.snapshot = {
      configured: config.configured, sessionId, user: null, recoveryReady: false, project: null, geometryBinding: null, lease: null, revision: null,
      draft: null, localRevision: 0, dirty: false,
      status: config.configured ? "signed_out" : "unconfigured", writeBlocked: true, error: null,
    };
    this.client = createSceneClient(config.apiUrl, () => this.accessToken());
  }

  getSnapshot = (): BackendSnapshot => this.snapshot;
  /** Synchronous fence for creating an explicitly local-only, non-cloud draft. */
  canCreateUnboundLocalDraft(): boolean {
    const state=this.snapshot;
    return !this.geometryPending&&!this.workbenchPending&&!this.operationPending&&!this.proposalPending&&!this.generationPending&&
      !state.recoveryReady&&!state.project&&!state.geometryBinding&&!state.lease&&state.status!=='saving';
  }
  /** Changes when authentication or geometry preparation is invalidated. */
  localDraftAuthorityVersion(): string { return `${this.epoch}:${this.geometryEpoch}`; }
  isGeometryBound(localActivityId: string): boolean {
    const binding = this.snapshot.geometryBinding;
    return !!binding && binding.localActivityId === localActivityId && binding.userId === this.snapshot.user?.id &&
      binding.apiUrl === this.config.apiUrl && binding.apiUrl === this.clientApiUrl && binding.cloudProjectId === this.snapshot.project?.id;
  }
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  /** Effect lifecycle: cleanup/setup in StrictMode must not destroy a live session. */
  retain = (): (() => void) => {
    this.owners += 1;
    this.lifecycle += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.owners -= 1;
      const lifecycle = ++this.lifecycle;
      void Promise.resolve().then(() => {
        if (this.owners === 0 && lifecycle === this.lifecycle) this.dispose();
      });
    };
  };
  private update(patch: Partial<BackendSnapshot>) {
    const old=this.snapshot,next={...old,...patch};
    if(old.user?.id!==next.user?.id||old.project?.id!==next.project?.id||old.sessionId!==next.sessionId||
      old.lease?.projectId!==next.lease?.projectId||old.lease?.sessionId!==next.lease?.sessionId||old.lease?.generation!==next.lease?.generation||
      old.geometryBinding?.localActivityId!==next.geometryBinding?.localActivityId||old.geometryBinding?.cloudProjectId!==next.geometryBinding?.cloudProjectId)this.dispatchScopeEpoch++;
    this.snapshot = next;
    for (const listener of this.listeners) listener();
  }
  private stopRenewal() {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
  }
  private cancelGeometryPreparation(): void {
    ++this.geometryEpoch;
    if (this.snapshot.geometryBinding) this.workbenchBinding = null;
  }
  private invalidateGeometryWorkbench(dropProject = false): void {
    this.cancelGeometryPreparation();
    const drop = dropProject && !!this.snapshot.geometryBinding;
    if (drop) this.stopRenewal();
    this.update({ geometryBinding: null, ...(drop ? { project: null, revision: null, lease: null, writeBlocked: true } : {}) });
  }
  private assertGeometryCurrent(geometry?: GeometryPreparation): void {
    if (geometry && !geometry.current()) throw new SceneApiError("SESSION_CHANGED", 409, null);
  }
  private block(error: unknown) {
    this.stopRenewal();
    this.update({ writeBlocked: true, status: "blocked", error: failure(error) });
  }
  /** Fail closed if selecting a cloud project succeeded but replacing the canvas did not. */
  suspendForCanvasProjectMismatch(projectId:string):void {
    if(this.snapshot.project?.id!==projectId)return;
    this.canvasProjectMismatch=true;++this.epoch;
    this.block(new SceneApiError('CANVAS_PROJECT_MISMATCH',409,null));
  }
  /** Call only after the caller synchronously applied and verified this canvas identity. */
  acknowledgeCanvasProjectMatch(projectId:string):void {
    if(this.snapshot.project?.id!==projectId)throw new SceneApiError('SESSION_CHANGED',409,null);
    this.canvasProjectMismatch=false;
  }
  /** Release only the mismatched lease; failed release leaves writes blocked. */
  async releaseLeaseAfterCanvasMismatch(projectId:string):Promise<void> {
    const lease=this.snapshot.lease,epoch=this.epoch,scopeEpoch=this.dispatchScopeEpoch,actor=this.snapshot.user?.id;
    if(!this.canvasProjectMismatch)throw new SceneApiError('SESSION_CHANGED',409,null);
    if(!lease)return;
    if(lease.projectId!==projectId)throw new SceneApiError('SESSION_CHANGED',409,null);
    const check=()=>{if(!actor||this.epoch!==epoch||this.dispatchScopeEpoch!==scopeEpoch||this.snapshot.user?.id!==actor||!this.canvasProjectMismatch||this.snapshot.lease!==lease||this.snapshot.project?.id!==projectId||this.snapshot.sessionId!==lease.sessionId)throw new SceneApiError('SESSION_CHANGED',409,null);};
    try{await this.client.request(`/projects/${encodeURIComponent(projectId)}/lease/release`,'POST',{sessionId:lease.sessionId,generation:lease.generation},false,undefined,check);}
    catch(error){if(!(error instanceof SceneApiError&&error.code==='LEASE_LOST'))throw error;}
    check();this.update({lease:null});
  }
  private assertCanvasProjectMatch():void {
    if(this.canvasProjectMismatch)throw new SceneApiError('CANVAS_PROJECT_MISMATCH',409,null);
  }
  private requireConfig() {
    if (!this.config.configured) throw new SceneApiError("CONFIGURATION_MISSING", 0, null);
  }
  private async authRequest(grant: "password" | "refresh_token", body: unknown): Promise<AuthResponse> {
    if (!this.supabase) throw new SceneApiError("CONFIGURATION_MISSING", 0, null);
    const input = body as { email?: string; password?: string; refresh_token?: string };
    const response = grant === "password"
      ? await this.supabase.auth.signInWithPassword({ email: input.email ?? "", password: input.password ?? "" })
      : await this.supabase.auth.refreshSession({ refresh_token: input.refresh_token ?? "" });
    if (response.error || !response.data.session || !response.data.user) {
      const status = response.error?.status ?? 0;
      if (grant === "password" && status === 400) throw new SceneApiError("INVALID_CREDENTIALS", status, null);
      if (response.error && status === 0) throw new SceneApiError("NETWORK_ERROR", 0, null);
      if (!response.error || status >= 500) throw new SceneApiError("INVALID_RESPONSE", 502, null);
      throw new SceneApiError("UNAUTHENTICATED", status, null);
    }
    const result = toAuthResult(response.data.session, response.data.user);
    if (!result) throw new SceneApiError("INVALID_RESPONSE", 502, null);
    return result as AuthResponse;
  }
  private async emailAuthRequest(path: string, body: unknown): Promise<AuthResult> {
    if (!this.supabase) throw new SceneApiError("CONFIGURATION_MISSING", 0, null);
    const input = body as { email?: string; password?: string; token?: string; type?: "signup" | "recovery"; data?: Record<string, unknown> };
    const requestUrl = new URL(path, "https://auth.local");
    const requestPath = requestUrl.pathname.replace(/^\//, "");
    const redirectTo = requestUrl.searchParams.get("redirect_to") ?? undefined;
    let response: { data: { user?: User | null; session?: Session | null } | null; error: { code?: string; status?: number; message?: string } | null };
    if (requestPath === "signup") {
      response = input.email && input.password
        ? await this.supabase.auth.signUp({ email: input.email.trim(), password: input.password, options: { ...(input.data ? { data: input.data } : {}), ...(redirectTo ? { emailRedirectTo: redirectTo } : {}) } }) as typeof response
        : await this.supabase.auth.signInAnonymously({ options: { ...(input.data ? { data: input.data } : {}) } }) as typeof response;
    } else if (requestPath === "resend") {
      response = await this.supabase.auth.resend({ type: "signup", email: input.email?.trim() ?? "", ...(redirectTo ? { options: { emailRedirectTo: redirectTo } } : {}) }) as typeof response;
    } else if (requestPath === "recover") {
      response = await this.supabase.auth.resetPasswordForEmail(input.email?.trim() ?? "", redirectTo ? { redirectTo } : undefined) as typeof response;
    } else if (requestPath === "verify") {
      response = await this.supabase.auth.verifyOtp({ email: input.email?.trim() ?? "", token: input.token ?? "", type: input.type ?? "signup" }) as typeof response;
    } else {
      throw new SceneApiError("INVALID_RESPONSE", 500, null);
    }
    if (response.error) {
      const code = response.error.code ?? "";
      const message = response.error.message?.toLowerCase() ?? "";
      const errorKey = code || (
        message.includes("already registered") || message.includes("already exists") ? "user_already_exists"
        : response.error.status === 403 ? "otp_expired"
        : message.includes("expired") ? "otp_expired"
        : message.includes("rate") ? "over_email_send_rate_limit"
        : message.includes("not authorized") ? "email_address_not_authorized"
        : message.includes("signup") && message.includes("disabled") ? "signup_disabled"
        : message.includes("not found") ? "user_not_found"
        : ""
      );
      if (requestPath === "recover" && (errorKey === "user_not_found" || response.error.status === 404)) return {};
      const messages: Record<string, string> = {
        user_already_exists: "该邮箱已注册，请切换到登录。",
        weak_password: "请使用至少 12 位、更难猜测的密码。",
        same_password: "新密码不能与旧密码相同。",
        email_address_invalid: "请输入有效的邮箱地址。",
        over_email_send_rate_limit: "发送邮件过于频繁，请稍后再试。",
        over_request_rate_limit: "操作过于频繁，请稍后再试。",
        over_email_send_daily_limit: "今天的邮件发送额度已用完，请稍后再试。",
        email_address_not_authorized: "验证邮件服务尚未开放，请联系管理员。",
        signup_disabled: "注册暂未开放，请稍后再试。",
        otp_expired: "验证码已失效或不正确，请重新获取验证码。",
        email_not_confirmed: "请先使用邮件中的验证码确认邮箱。",
        reauthentication_needed: "验证已失效，请重新获取验证码。",
      };
      throw new Error(messages[errorKey] ?? (response.error.status === 429 ? "操作过于频繁，请稍后再试。" : "验证服务暂时不可用，请稍后重试。"));
    }
    if (!response.data) return {};
    return toAuthResult(response.data.session ?? null, response.data.user ?? response.data.session?.user ?? null) ?? (response.data.user ? { user: toBackendUser(response.data.user) } : {});
  }
  private acceptAuth(result: AuthResponse) {
    if (!result.access_token || !result.refresh_token || !result.user?.id || typeof result.expires_in !== "number" || !Number.isFinite(result.expires_in) || result.expires_in <= 0) throw new SceneApiError("INVALID_RESPONSE", 502, null);
    if (this.snapshot.user && this.snapshot.user.id !== result.user.id) this.invalidateGeometryWorkbench(true);
    this.tokens = { access: result.access_token, refresh: result.refresh_token, expiresAt: result.expires_at ? result.expires_at * 1000 : Date.now() + result.expires_in * 1000 };
    this.update({ user: result.user });
  }
  private persistTokens(_rejected?: Tokens | null): void {}
  private async accessToken(): Promise<string | null> {
    if (!this.supabase || this.snapshot.recoveryReady) return null;
    const actor = this.snapshot.user?.id;
    let { data, error } = await this.supabase.auth.getSession();
    if (error) throw new SceneApiError("UNAUTHENTICATED", error.status ?? 401, null);
    let session = data.session;
    if (!session) { this.tokens = null; return null; }
    const assertActor = (current: Session) => {
      if (!actor || this.snapshot.user?.id !== actor || typeof current.user?.id !== 'string' || current.user.id.toLowerCase() !== actor.toLowerCase())
        throw new SceneApiError('SESSION_CHANGED', 409, null);
    };
    // Auth storage can change independently in another tab. Never send its
    // token under an editor snapshot owned by a different account.
    assertActor(session);
    if (session.expires_at && session.expires_at * 1000 <= Date.now() + 30_000) {
      const refreshed = await this.supabase.auth.refreshSession();
      if (refreshed.error || !refreshed.data.session) {
        this.tokens = null;
        throw new SceneApiError("UNAUTHENTICATED", refreshed.error?.status ?? 401, null);
      }
      session = refreshed.data.session;
      assertActor(session);
    }
    this.tokens = { access: session.access_token, refresh: session.refresh_token, expiresAt: (session.expires_at ?? Math.floor(Date.now() / 1000) + 3600) * 1000 };
    return session.access_token;
  }
  private captureRequestScope(projectId = this.snapshot.project?.id ?? null): RequestScope {
    const lease = this.snapshot.lease;
    return { projectId, lease: lease?.projectId === projectId
      ? { projectId: lease.projectId, sessionId: lease.sessionId, generation: lease.generation } : null };
  }
  private isCurrentRequestScope(scope: RequestScope): boolean {
    const current = this.captureRequestScope();
    return current.projectId === scope.projectId && current.lease?.projectId === scope.lease?.projectId &&
      current.lease?.sessionId === scope.lease?.sessionId && current.lease?.generation === scope.lease?.generation;
  }
  /** Capture account/project/lease now, recheck after token refresh immediately before dispatch. */
  private scopedDispatchGuard(mutates:boolean):()=>void {
    const epoch=this.epoch,scopeEpoch=this.dispatchScopeEpoch,actor=this.snapshot.user?.id,scope=this.captureRequestScope();
    return ()=>{
      if(epoch!==this.epoch||scopeEpoch!==this.dispatchScopeEpoch||this.snapshot.user?.id!==actor||!this.isCurrentRequestScope(scope))throw new SceneApiError('SESSION_CHANGED',409,null);
      if(mutates)this.assertCanvasProjectMatch();
    };
  }
  private async request<T>(path: string, method = "GET", body?: unknown, scope = this.captureRequestScope(), blocksWrites: boolean | "business" = true, geometry?: GeometryPreparation, transport?: (beforeDispatch:()=>void) => Promise<T>,requestCurrent?:()=>boolean, suppressProjectFailure = false): Promise<T> {
    if(method.toUpperCase()!=='GET')this.assertCanvasProjectMatch();
    const epoch = this.epoch,scopeEpoch=this.dispatchScopeEpoch,actor=this.snapshot.user?.id;
    const beforeDispatch=()=>{
      if(epoch!==this.epoch||scopeEpoch!==this.dispatchScopeEpoch||this.snapshot.user?.id!==actor||!this.isCurrentRequestScope(scope)||geometry&&!geometry.current()||requestCurrent&&!requestCurrent())throw new SceneApiError('SESSION_CHANGED',409,null);
      if(method.toUpperCase()!=='GET')this.assertCanvasProjectMatch();
    };
    const credentials = this.tokens;
    try {
      this.requireConfig();
      const result = await (transport ? transport(beforeDispatch) : this.client.request<T>(path, method, body,false,undefined,beforeDispatch));
      if (epoch !== this.epoch||scopeEpoch!==this.dispatchScopeEpoch||this.snapshot.user?.id!==actor||!this.isCurrentRequestScope(scope)||requestCurrent&&!requestCurrent()) throw new SceneApiError("SESSION_CHANGED", 409, null);
      return result;
    } catch (error) {
      if (epoch === this.epoch && scopeEpoch===this.dispatchScopeEpoch && this.snapshot.user?.id===actor && (!geometry || geometry.current()) && (!requestCurrent||requestCurrent()) && this.isCurrentRequestScope(scope)) {
        if (error instanceof SceneApiError && (error.status === 401 || error.code === "UNAUTHENTICATED")) {
          // accessToken() rebuilds this.tokens on every call, so an object identity check can
          // never match after a request; compare the access token value instead.
          const currentTokens = this.tokens;
          if (!currentTokens || (credentials !== null && currentTokens.access === credentials.access)) {
            this.tokens = null;
            this.persistTokens(credentials);
            this.invalidateGeometryWorkbench(true);
            this.update({ user: null, writeBlocked: true, status: "blocked" });
          }
        }
        // Uncertainty blocks only the project/lease that made this request. A
        // late response from a handed-off editor must not stop the new lease.
        const permissionLost = error instanceof SceneApiError && (error.status === 401 || ["LEASE_LOST", "REVISION_CONFLICT"].includes(error.code));
        const materialPreviewFailure = path.endsWith('/material-variants') && error instanceof SceneApiError && ['VALIDATION_ERROR','MATERIAL_VARIANT_SELECTION_INVALID','OBJECT_LOCKED','MATERIAL_VARIANT_MISMATCH','ASSET_NOT_GLB','DIMENSION_CONFLICT','STRUCTURAL_COLLISION','IDEMPOTENCY_CONFLICT'].includes(error.code);
        const serviceFailure = materialPreviewFailure || error instanceof SceneApiError && ["SERVICE_NOT_CONFIGURED", "BILLING_NOT_CONFIGURED", "BUDGET_EXCEEDED", "DAILY_BUDGET_EXCEEDED", "AI_BUSY", "AI_IN_PROGRESS", "AI_PREVIOUS_REQUEST_FAILED", "AI_INVALID_PROPOSAL", "AI_INPUT_TOO_LARGE", "PROVIDER_HTTP_ERROR", "PROVIDER_INVALID_JSON", "PROVIDER_TIMEOUT", "GENERATION_BUSY"].includes(error.code);
        if (!suppressProjectFailure || error instanceof SceneApiError && (error.status === 401 || error.code === 'UNAUTHENTICATED')) {
          if (permissionLost || blocksWrites === true || (blocksWrites === false && !serviceFailure)) this.block(error);
          else this.update({ error: failure(error) });
        }
      }
      throw error;
    }
  }

  async signIn(email: string, password: string): Promise<BackendUser> {
    if (this.operationPending) throw new SceneApiError("CLOUD_OPERATION_BUSY", 409, null);
    this.stopRenewal();
    this.invalidateGeometryWorkbench(true);
    const epoch = ++this.epoch;
    this.tokens = null;
    this.recoveryTokens = null;
    this.update({ user: null, recoveryReady: false, lease: null, writeBlocked: true });
    try {
      const result = await this.authRequest("password", { email: email.trim(), password });
      if (epoch !== this.epoch) throw new SceneApiError("SESSION_CHANGED", 409, null);
      this.acceptAuth(result);
      this.update({ status: "ready", error: null });
      return result.user;
    } catch (error) {
      if (epoch === this.epoch) this.block(error);
      throw error;
    }
  }
  async signInAsGuest(): Promise<BackendUser> {
    if (this.operationPending || this.snapshot.recoveryReady) throw new SceneApiError("CLOUD_OPERATION_BUSY", 409, null);
    if (this.snapshot.user) return this.snapshot.user;
    const epoch = this.epoch;
    const result = await this.emailAuthRequest("signup", { data: { display_name: "访客" } });
    if (epoch !== this.epoch) throw new SceneApiError("SESSION_CHANGED", 409, null);
    if (!result.access_token || !result.refresh_token || !result.user?.id || typeof result.expires_in !== "number" || !Number.isFinite(result.expires_in)) throw new SceneApiError("INVALID_RESPONSE", 502, null);
    this.acceptAuth(result as AuthResponse);
    this.update({ status: "ready", error: null, project: null, lease: null, revision: null });
    return result.user;
  }
  private async verifyUser(access: string): Promise<BackendUser> {
    if (!this.supabase) throw new SceneApiError("CONFIGURATION_MISSING", 0, null);
    const { data, error } = await this.supabase.auth.getUser(access);
    if (error || !data.user) throw new SceneApiError(error?.status && error.status !== 0 ? "UNAUTHENTICATED" : "NETWORK_ERROR", error?.status ?? 0, null);
    return toBackendUser(data.user);
  }
  private captureRecovery(session: { access_token: string; refresh_token: string; expires_at?: number | null; expires_in?: number }): void {
    if (!session.access_token || !session.refresh_token) throw new SceneApiError("INVALID_RESPONSE", 502, null);
    this.tokens = null;
    this.recoveryTokens = {
      access: session.access_token,
      refresh: session.refresh_token,
      expiresAt: session.expires_at ? session.expires_at * 1000 : Date.now() + (session.expires_in ?? 3600) * 1000,
    };
    clearSupabaseCookies();
    this.update({ user: null, recoveryReady: true, writeBlocked: true, status: "blocked", error: null });
  }
  async restoreSession(recovery = false): Promise<void> {
    if (!this.config.configured || !this.supabase || (!recovery && this.snapshot.user)) return;
    const epoch = this.epoch;
    try {
      const { data, error } = await this.supabase.auth.getSession();
      if (error) throw error;
      if (!data.session) {
        if (!recovery && this.config.url.includes("localhost:3099")) {
          // Local mock backend: auto sign-in so local development never requires manual login.
          const result = await this.authRequest("password", { email: "dev@mock.local", password: "mock" });
          if (epoch !== this.epoch) return;
          this.acceptAuth(result);
          this.update({ status: "ready", error: null });
          return;
        }
        this.tokens = null;
        this.update({ user: null, recoveryReady: false, status: "signed_out", writeBlocked: true, error: null });
        return;
      }
      if (recovery) {
        this.captureRecovery(data.session);
          return;
      }
      const user = await this.verifyUser(data.session.access_token);
      if (epoch !== this.epoch) return;
      this.tokens = { access: data.session.access_token, refresh: data.session.refresh_token, expiresAt: (data.session.expires_at ?? Math.floor(Date.now() / 1000) + 3600) * 1000 };
      this.update({ user, status: "ready", error: null });
    } catch (error) {
      if (epoch !== this.epoch) return;
      this.block(error);
    }
  }
  async acceptCallback(callback: string, expectedType?: "recovery"): Promise<void> {
    if (!this.supabase) throw new SceneApiError("CONFIGURATION_MISSING", 0, null);
    const values = new URLSearchParams(callback.replace(/^#/, ""));
    if (expectedType && values.get("type") !== expectedType) throw new Error("请使用密码重置邮件中的验证码或链接。");
    if (values.has("error")) throw new Error("验证链接已失效，请返回登录页重新注册或登录。");
    const access = values.get("access_token"), refresh = values.get("refresh_token");
    if (!access || !refresh) throw new Error("验证链接不完整，请重新打开邮件中的链接。");
    if (values.get("type") === "recovery" || expectedType === "recovery") {
      this.captureRecovery({ access_token: access, refresh_token: refresh });
      return;
    }
    const { data, error } = await this.supabase.auth.setSession({ access_token: access, refresh_token: refresh });
    if (error || !data.session) throw new SceneApiError("UNAUTHENTICATED", error?.status ?? 401, null);
    const user = data.user ?? data.session.user;
    const result = toAuthResult(data.session, user);
    if (!result) throw new SceneApiError("INVALID_RESPONSE", 502, null);
    this.acceptAuth(result as AuthResponse);
    this.update({ status: "ready", error: null });
  }
  async resendSignup(email: string, redirectTo: string): Promise<void> {
    await this.emailAuthRequest(`resend?redirect_to=${encodeURIComponent(redirectTo)}`, { type: "signup", email: email.trim() });
  }
  async requestPasswordReset(email: string, redirectTo: string): Promise<void> {
    await this.emailAuthRequest(`recover?redirect_to=${encodeURIComponent(redirectTo)}`, { email: email.trim() });
  }
  async verifyEmailCode(email: string, token: string, type: "signup" | "recovery"): Promise<void> {
    if (!/^\d{6}$/.test(token)) throw new Error("请输入六位数字验证码。");
    const epoch = this.epoch;
    if (type === "recovery") {
      const response = await fetch(`${this.config.url}/auth/v1/verify`, {
        method: "POST",
        headers: { apikey: this.config.anonKey, "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), token, type }),
        cache: "no-store",
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        const key = result.code ?? result.error_code ?? (response.status === 403 ? "otp_expired" : "");
        const messages: Record<string, string> = { otp_expired: "验证码已失效或不正确，请重新获取验证码。", over_request_rate_limit: "操作过于频繁，请稍后再试。" };
        throw new Error(messages[key] ?? "验证服务暂时不可用，请稍后重试。");
      }
      if (!result.access_token || !result.refresh_token || !result.user?.id || typeof result.expires_in !== "number" || !Number.isFinite(result.expires_in) || result.expires_in <= 0) throw new SceneApiError("INVALID_RESPONSE", 502, null);
      if (epoch !== this.epoch) throw new SceneApiError("SESSION_CHANGED", 409, null);
      this.captureRecovery(result as AuthResponse);
      return;
    }
    const result = await this.emailAuthRequest("verify", { email: email.trim(), token, type });
    if (epoch !== this.epoch) throw new SceneApiError("SESSION_CHANGED", 409, null);
    if (!result.access_token || !result.refresh_token || !result.user?.id || typeof result.expires_in !== "number" || !Number.isFinite(result.expires_in) || result.expires_in <= 0) throw new SceneApiError("INVALID_RESPONSE", 502, null);
    this.acceptAuth(result as AuthResponse);
    this.update({ status: "ready", error: null });
  }
  async updatePassword(password: string): Promise<{ signedOutEverywhere: boolean }> {
    const recovery = this.recoveryTokens;
    if (!recovery || recovery.expiresAt <= Date.now()) throw new Error("验证已失效，请重新获取验证码。");
    if (password.length < 12) throw new Error("请使用至少 12 位、更难猜测的密码。");
    const epoch = this.epoch;
    const response = await fetch(`${this.config.url}/auth/v1/user`, {
      method: "PUT",
      headers: { apikey: this.config.anonKey, "Content-Type": "application/json", Authorization: `Bearer ${recovery.access}` },
      body: JSON.stringify({ password }),
      cache: "no-store",
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      const messages: Record<string, string> = { same_password: "新密码不能与旧密码相同。", weak_password: "请使用至少 12 位、更难猜测的密码。", reauthentication_needed: "验证已失效，请重新获取验证码。" };
      throw new Error(messages[result.code ?? result.error_code ?? ""] ?? "验证服务暂时不可用，请稍后重试。");
    }
    if (epoch !== this.epoch) throw new SceneApiError("SESSION_CHANGED", 409, null);
    ++this.epoch;
    this.tokens = null;
    this.recoveryTokens = null;
    clearSupabaseCookies();
    this.stopRenewal();
    this.invalidateGeometryWorkbench(true);
    this.update({ user: null, recoveryReady: false, project: null, lease: null, revision: null, status: "signed_out", writeBlocked: true, error: null });
    try {
      const signOut = await fetch(`${this.config.url}/auth/v1/logout?scope=global`, { method: "POST", headers: { apikey: this.config.anonKey, Authorization: `Bearer ${recovery.access}` } });
      return { signedOutEverywhere: signOut.ok };
    } catch { return { signedOutEverywhere: false }; }
  }
  clearPasswordRecovery(): void {
    ++this.epoch;
    this.recoveryTokens = null;
    clearSupabaseCookies();
    this.update({ recoveryReady: false });
  }
  async signUp(email: string, password: string, displayName: string, redirectTo: string): Promise<boolean> {
    const epoch = this.epoch;
    const result = await this.emailAuthRequest(`signup?redirect_to=${encodeURIComponent(redirectTo)}`, { email: email.trim(), password, data: { display_name: displayName.trim().slice(0, 80) } });
    if (epoch !== this.epoch) throw new SceneApiError("SESSION_CHANGED", 409, null);
    if (result.access_token && result.refresh_token && result.user?.id && Number.isFinite(result.expires_in)) {
      this.acceptAuth(result as AuthResponse);
      this.update({ status: "ready", error: null });
      return true;
    }
    return false;
  }
  async signOut(): Promise<void> {
    if (this.operationPending) throw new SceneApiError("CLOUD_OPERATION_BUSY", 409, null);
    if(this.canvasProjectMismatch&&this.snapshot.lease)await this.releaseLeaseAfterCanvasMismatch(this.snapshot.lease.projectId);
    try { if (this.snapshot.lease && !this.snapshot.writeBlocked) await this.releaseLease(); } catch { /* Lease expires within 90 seconds; draft remains. */ }
    ++this.epoch;
    this.tokens = null;
    this.recoveryTokens = null;
    this.stopRenewal();
    this.invalidateGeometryWorkbench(true);
    this.update({ user: null, recoveryReady: false, lease: null, status: this.config.configured ? "signed_out" : "unconfigured", writeBlocked: true, error: null });
    try { await this.supabase?.auth.signOut({ scope: "local" }); } catch { /* Local credentials have already been discarded. */ }
  }
  listStudios(): Promise<Studio[]> { return this.request("/studios"); }
  listProjects(): Promise<ProjectSummary[]> { return this.request("/projects"); }
  /** 读取当前账号的界面偏好；未登录或服务不可用时由调用方回退本机默认值。 */
  async getPreferences(): Promise<AccountPreferences> {
    return this.businessRequest<AccountPreferences>("/preferences", "GET");
  }
  /** 回写当前账号的界面偏好；只提交白名单字段，不触碰项目 / 租约状态。 */
  async savePreferences(prefs: AccountPreferences): Promise<AccountPreferences> {
    return this.businessRequest<AccountPreferences>("/preferences", "PATCH", prefs);
  }
  /** Scene processing uses a remote project without replacing the caller's local activity identity. */
  async ensureGeometryWorkbenchReady(scene: Scene, name: string, localActivityId: string): Promise<BackendProject> {
    const project = await this.prepareGeometryWorkbench(scene, name, localActivityId, true);
    if (!project) throw new SceneApiError("INVALID_RESPONSE", 502, null);
    return project;
  }
  /** Restore only a known mapping; this never creates an account, project or paid request. */
  resumeGeometryWorkbench(scene: Scene, name: string, localActivityId: string): Promise<BackendProject | null> {
    return this.prepareGeometryWorkbench(scene, name, localActivityId, false);
  }
  private prepareGeometryWorkbench(scene: Scene, name: string, localActivityId: string, create: boolean): Promise<BackendProject | null> {
    const parsed = sceneSchema.parse(scene);
    if (!localActivityId.trim()) throw new SceneApiError("LOCAL_ACTIVITY_ID_REQUIRED", 422, null);
    const scope = canonical({ localActivityId, epoch: this.epoch, apiUrl: this.config.apiUrl });
    const key = canonical({ scene: parsed, name, create, scope });
    if (this.geometryPending) {
      if (this.geometryPending.key === key) return this.geometryPending.promise;
      if (create || this.geometryPending.scope !== scope) ++this.geometryEpoch;
      return Promise.reject(new SceneApiError("CLOUD_OPERATION_BUSY", 409, null));
    }
    const epoch = this.epoch, generation = ++this.geometryEpoch, apiUrl = this.config.apiUrl, draftRevision = this.snapshot.localRevision;
    let userId: string | undefined;
    const active = () => epoch === this.epoch && generation === this.geometryEpoch && apiUrl === this.config.apiUrl &&
      apiUrl === this.clientApiUrl && (userId === undefined || userId === this.snapshot.user?.id);
    const current = () => { if (!active()) throw new SceneApiError("SESSION_CHANGED", 409, null); };
    const promise = (async () => {
      this.requireConfig(); current();
      if (this.operationPending || this.snapshot.recoveryReady) throw new SceneApiError("CLOUD_OPERATION_BUSY", 409, null);
      if (!this.snapshot.user) {
        if (!create) throw new SceneApiError("UNAUTHENTICATED", 401, null);
        await this.signInAsGuest(); current();
      }
      userId = this.snapshot.user!.id;
      const identity = { localActivityId, userId, apiUrl }, storageKey = geometryWorkbenchBindingKey(identity)[1];
      if (create && this.snapshot.localRevision === draftRevision && canonical(this.snapshot.draft) !== canonical(parsed)) this.setDraft(parsed);
      const binding = this.geometryBindings.get(storageKey) ?? await readGeometryWorkbenchBinding(identity);
      current();
      if (!binding && !create) return null;
      if (binding) this.geometryBindings.set(storageKey, binding);
      if (!create && this.snapshot.localRevision === draftRevision && canonical(this.snapshot.draft) !== canonical(parsed)) this.setDraft(parsed);
      const geometry: GeometryPreparation = {
        current: active,
        bindingFor: project => {
          const cloudProjectId = uuid.parse(project.id), known = this.geometryBindings.get(storageKey);
          if (known && known.cloudProjectId !== cloudProjectId) throw new SceneApiError("INVALID_RESPONSE", 502, null);
          const next: GeometryWorkbenchBinding = { version: 1, ...identity, cloudProjectId };
          this.geometryBindings.set(storageKey, next);
          return next;
        },
        persist: async value => { current(); await writeGeometryWorkbenchBinding(value); current(); },
      };
      if (binding && this.snapshot.project?.id !== binding.cloudProjectId) {
        if (this.snapshot.lease && !this.snapshot.writeBlocked) { await this.releaseLease(); current(); }
        await this.getProjectInSession(binding.cloudProjectId, undefined, geometry); current();
      }
      const localId = `geometry:${storageKey}`;
      if (binding) this.workbenchBinding = { localId, projectId: binding.cloudProjectId, userId };
      return await this.prepareWorkbenchReady(parsed, name, localId, geometry);
    })().catch(error => { if (active()) this.block(error); throw error; }).finally(() => {
      if (this.geometryPending?.promise === promise) this.geometryPending = null;
    });
    this.geometryPending = { key, scope, promise };
    return promise;
  }
  /** Release only the mirror; mapping and local facts remain available for a later reconnect. */
  async disconnectGeometryWorkbench(): Promise<void> {
    ++this.geometryEpoch;
    if (this.operationPending) throw new SceneApiError("CLOUD_OPERATION_BUSY", 409, null);
    const binding = this.snapshot.geometryBinding;
    if (!binding) return;
    const lease = this.snapshot.lease;
    if (lease?.projectId === binding.cloudProjectId && Date.parse(lease.expiresAt) > Date.now()) {
      this.operationPending = true;
      this.stopRenewal();
      try {
        await this.request(`/projects/${lease.projectId}/lease/release`, "POST", { sessionId: lease.sessionId, generation: lease.generation });
      } finally { this.operationPending = false; }
    }
    this.invalidateGeometryWorkbench(true);
    this.update({ status: this.snapshot.user ? "ready" : this.config.configured ? "signed_out" : "unconfigured", error: null });
  }
  /** First use creates a real private guest workspace; the local scene remains authoritative. */
  ensureWorkbenchReady(scene: Scene, name: string, localId?: string): Promise<BackendProject> {
    this.cancelGeometryPreparation();
    return this.prepareWorkbenchReady(scene, name, localId);
  }
  private prepareWorkbenchReady(scene: Scene, name: string, localId?: string, geometry?: GeometryPreparation): Promise<BackendProject> {
    const parsed = sceneSchema.parse(scene);
    const key = canonical({ scene: parsed, name, localId: localId ?? null });
    if (this.workbenchPending) {
      return this.workbenchPending.key === key ? this.workbenchPending.promise : Promise.reject(new SceneApiError("CLOUD_OPERATION_BUSY", 409, null));
    }
    const epoch = this.epoch;
    const current = () => { if (epoch !== this.epoch) throw new SceneApiError("SESSION_CHANGED", 409, null); this.assertGeometryCurrent(geometry); };
    const promise = (async () => {
      this.requireConfig();
      if (this.operationPending || this.snapshot.recoveryReady) throw new SceneApiError("CLOUD_OPERATION_BUSY", 409, null);
      if (!this.snapshot.user) {
        await this.signInAsGuest();
      }
      current();
      let project = this.snapshot.project;
      if (!project && localId && uuid.safeParse(localId).success) {
        const projects = await this.listProjects();
        current();
        if (projects.some(item => item.id === localId)) {
          try { project = await this.getProjectInSession(localId, undefined, geometry); }
          finally { if (!geometry && epoch === this.epoch && canonical(this.snapshot.draft) !== canonical(parsed)) this.setDraft(parsed); }
          current();
        }
      }
      const binding = this.workbenchBinding;
      const bound = project && (project.id === localId || binding && binding.localId === localId && binding.projectId === project.id && binding.userId === this.snapshot.user!.id);
      if (!bound) {
        if (this.snapshot.lease && !this.snapshot.writeBlocked) await this.releaseLease();
        current();
        const studios = await this.request<Studio[]>("/studios", "GET", undefined, this.captureRequestScope(), true, geometry);
        current();
        const studio = studios.find(item => item.role === "owner") ?? studios[0] ?? await this.request<Studio>("/studios", "POST", {
          requestId: crypto.randomUUID(), name: "我的工作室", displayName: "访客",
        }, this.captureRequestScope(), "business", geometry);
        current();
        project = await this.createProjectInSession(studio.id, name.trim() || "未命名方案", parsed, geometry);
        current();
        this.workbenchBinding = { localId, projectId: project.id, userId: this.snapshot.user!.id };
      }
      if (geometry) {
        const binding = geometry.bindingFor(project!);
        current(); this.update({ geometryBinding: binding });
        await geometry.persist(binding); current();
      }
      if (!this.snapshot.lease || this.snapshot.writeBlocked || Date.parse(this.snapshot.lease.expiresAt) <= Date.now()) {
        try { await this.acquireLeaseInSession(project!.id, undefined, geometry); }
        finally { if (!geometry && epoch === this.epoch && canonical(this.snapshot.draft) !== canonical(parsed)) this.setDraft(parsed); }
        current();
      }
      if (!geometry) {
        if (canonical(this.snapshot.draft) !== canonical(parsed)) this.setDraft(parsed);
        this.update({ geometryBinding: null });
      }
      return this.snapshot.project!;
    })().finally(() => { if (this.workbenchPending?.promise === promise) this.workbenchPending = null; });
    this.workbenchPending = { key, promise };
    return promise;
  }
  /** Asset, sharing and membership operations reuse the authenticated session. */
  businessRequest<T>(path: string, method = "GET", body?: unknown): Promise<T> {
    return this.request<T>(path, method, body, this.captureRequestScope(), "business");
  }
  async deleteProject(projectId: string, expectedRevision: number): Promise<void> {
    this.ensureCanSwitch();
    this.operationPending = true;
    try {
      const result = await this.businessRequest<{ deleted: boolean }>(`/projects/${uuid.parse(projectId)}`, "DELETE", { expectedRevision });
      if (result.deleted !== true) throw new Error('项目删除结果无效，请刷新列表核对。');
      if (this.snapshot.project?.id === projectId) {
        this.stopRenewal();
        this.update({ project: null, lease: null, revision: null, writeBlocked: true, status: "ready", error: null });
      }
    } finally { this.operationPending = false; }
  }
  async renameProject(name: string): Promise<BackendProject> {
    if (this.operationPending) throw new SceneApiError("CLOUD_OPERATION_BUSY", 409, null);
    const lease = this.writableLease();
    this.operationPending = true;
    try {
      const project = await this.request<BackendProject>(`/projects/${lease.projectId}`, "PATCH", {
        name, sessionId: lease.sessionId, generation: lease.generation, expectedRevision: this.snapshot.revision,
      });
      this.update({ project: { ...this.snapshot.project!, ...project }, revision: project.revision,
        lease: { ...(this.snapshot.lease ?? lease), revision: project.revision } });
      return project;
    } finally { this.operationPending = false; }
  }
  async authorizeAsset(assetId: string, scope = this.captureRequestScope()): Promise<{ id: string; url: string; name: string }> {
    uuid.parse(assetId);
    const result = await this.request<unknown>(`/assets/${encodeURIComponent(assetId)}/url`, "POST", undefined, scope, "business");
    if (!result || typeof result !== "object") throw new SceneApiError("ASSET_AUTHORIZATION_INVALID", 502, null);
    const asset = result as Record<string, unknown>;
    if (asset.id !== assetId || asset.format !== "glb" || typeof asset.name !== "string" || !asset.name.trim() ||
        typeof asset.url !== "string" || typeof asset.expiresIn !== "number" || !Number.isFinite(asset.expiresIn) || asset.expiresIn <= 0 || asset.expiresIn > 300) {
      throw new SceneApiError("ASSET_AUTHORIZATION_INVALID", 502, null);
    }
    let url: URL;
    try { url = new URL(asset.url); }
    catch { throw new SceneApiError("ASSET_AUTHORIZATION_INVALID", 502, null); }
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || isDevelopmentFixtureHost(url.hostname);
    if ((url.protocol !== "https:" && !(local && url.protocol === "http:")) || url.username || url.password || url.hash) {
      throw new SceneApiError("ASSET_AUTHORIZATION_INVALID", 502, null);
    }
    return { id: assetId, url: url.href, name: asset.name };
  }
  /** Resolve only referenced GLB IDs; signed URLs remain transient renderer inputs. */
  async authorizeAssets(scene: Scene): Promise<AuthorizedAssets> {
    const epoch = this.epoch;
    const scope = this.captureRequestScope();
    try {
      const parsed = sceneSchema.parse(scene);
      const ids = [...new Set(parsed.objects.flatMap(object => object.assetId ? [object.assetId] : []))];
      const assets = await Promise.all(ids.map(async assetId => {
        return this.authorizeAsset(assetId, scope);
      }));
      if (epoch !== this.epoch) throw new SceneApiError("SESSION_CHANGED", 409, null);
      return {
        assetUrls: Object.fromEntries(assets.map(asset => [asset.id, asset.url])),
        assetNames: Object.fromEntries(assets.map(asset => [asset.id, asset.name])),
      };
    } catch (error) {
      if (epoch === this.epoch && this.isCurrentRequestScope(scope)) this.block(error);
      throw error;
    }
  }
  private ensureCanSwitch() {
    if (this.operationPending) throw new SceneApiError("CLOUD_OPERATION_BUSY", 409, null);
    if(this.canvasProjectMismatch&&this.snapshot.lease)throw new SceneApiError('PROJECT_SWITCH_REQUIRES_RELEASE',409,null);
    if (this.snapshot.lease && !this.snapshot.writeBlocked) throw new SceneApiError("PROJECT_SWITCH_REQUIRES_RELEASE", 409, null);
  }
  private selectProject(project: BackendProject, geometryBinding?: GeometryWorkbenchBinding) {
    const scene = sceneSchema.parse(project.scene);
    this.update({ project: { ...project, scene }, revision: project.revision,
      draft: geometryBinding ? this.snapshot.draft ?? scene : scene, dirty: geometryBinding ? true : false,
      geometryBinding: geometryBinding ?? null,
      localRevision: this.snapshot.localRevision + 1, lease: null, writeBlocked: true, status: "ready", error: null });
  }
  async createProject(studioId: string, name: string, scene: Scene): Promise<BackendProject> {
    this.ensureCanSwitch();
    this.cancelGeometryPreparation();
    return this.createProjectInSession(studioId, name, scene);
  }
  private async createProjectInSession(studioId: string, name: string, scene: Scene, geometry?: GeometryPreparation): Promise<BackendProject> {
    this.ensureCanSwitch();
    this.operationPending = true;
    try {
      const project = await this.request<BackendProject>("/projects", "POST", { studioId, name, scene: sceneSchema.parse(scene) }, this.captureRequestScope(), true, geometry);
      const binding = geometry?.bindingFor(project);
      this.assertGeometryCurrent(geometry);
      this.selectProject(project, binding);
      return project;
    } finally { this.operationPending = false; }
  }
  /**
   * 只读拉项目 scene（卡片缩略等），不切换当前编辑会话、不抢编辑权。
   * 打开/替换画布请用 getProject。
   */
  async peekProject(projectId: string): Promise<BackendProject> {
    const project = await this.businessRequest<BackendProject>(`/projects/${encodeURIComponent(projectId)}`);
    return { ...project, scene: sceneSchema.parse(project.scene) };
  }
  /** A read-only authority is invalidated by sign-in/out, project or lease changes. */
  captureOriginalSceneReadGuard():()=>boolean {
    const epoch=this.epoch,scope=this.captureRequestScope(),user=this.snapshot.user?.id;
    return ()=>!!user&&epoch===this.epoch&&this.snapshot.user?.id===user&&this.isCurrentRequestScope(scope);
  }
  async readOriginalScene(projectId:string):Promise<{scene:unknown;revision:number;originalSceneHash:string}>{return this.#readOriginalScene(projectId);}
  async #readOriginalScene(projectId:string):Promise<{scene:unknown;revision:number;originalSceneHash:string}>{
    const id=uuid.parse(projectId),epoch=this.epoch,scope=this.captureRequestScope(),user=this.snapshot.user?.id;
    if(!user)throw new SceneApiError('UNAUTHENTICATED',401,null);
    const raw=await this.request<unknown>(`/projects/${encodeURIComponent(id)}/original-scene`,'GET',undefined,scope,'business');
    const result=z.object({projectId:uuid,scene:z.unknown(),revision:z.number().int().nonnegative(),originalSceneHash:z.string().regex(/^[a-f0-9]{64}$/)}).safeParse(raw);
    if(!result.success||result.data.projectId.toLowerCase()!==id.toLowerCase()||!sceneSchema.safeParse(result.data.scene).success)throw new SceneApiError('INVALID_RESPONSE',502,null);
    const hash=await sha256(canonical(result.data.scene));
    if(epoch!==this.epoch||!this.isCurrentRequestScope(scope)||this.snapshot.user?.id!==user)throw new SceneApiError('SESSION_CHANGED',409,null);
    if(hash!==result.data.originalSceneHash)throw new SceneApiError('INVALID_RESPONSE',502,null);
    return {scene:result.data.scene,revision:result.data.revision,originalSceneHash:hash};
  }
  /** These operations never select a project or replace the local canvas. */
  async beginOriginalReview(projectId:string,record:{revision:number;originalSceneHash:string}) {
    this.assertCanvasProjectMatch();
    const id=uuid.parse(projectId),guard=this.captureOriginalSceneReadGuard(),dispatch=this.scopedDispatchGuard(true),sessionId=this.snapshot.sessionId;
    if(!guard())throw new SceneApiError('SESSION_CHANGED',409,null);
    const raw=await this.client.request<unknown>(`/projects/${id}/original-scene/lease`,'POST',{
      sessionId,originalRevision:record.revision,originalSceneHash:record.originalSceneHash,
    },false,undefined,()=>{dispatch();if(!guard())throw new SceneApiError('SESSION_CHANGED',409,null);});
    if(!guard())throw new SceneApiError('SESSION_CHANGED',409,null);
    const parsed=z.object({sessionId:uuid,generation:z.number().int().nonnegative(),revision:z.number().int().nonnegative(),expiresAt:z.string(),originalSceneHash:z.string().regex(/^[a-f0-9]{64}$/)}).safeParse(raw);
    if(!parsed.success||parsed.data.sessionId!==sessionId||parsed.data.revision!==record.revision||parsed.data.originalSceneHash!==record.originalSceneHash||!Number.isFinite(Date.parse(parsed.data.expiresAt)))throw new SceneApiError('INVALID_RESPONSE',502,null);
    return parsed.data;
  }
  async prepareOriginalReview(projectId:string,lease:{sessionId:string;generation:number;revision:number;originalSceneHash:string},candidate:unknown,reviewId:string) {
    this.assertCanvasProjectMatch();
    const id=uuid.parse(projectId),review=uuid.parse(reviewId),guard=this.captureOriginalSceneReadGuard(),dispatch=this.scopedDispatchGuard(true);
    if(!guard()||lease.sessionId!==this.snapshot.sessionId)throw new SceneApiError('SESSION_CHANGED',409,null);
    const candidateHash=await sha256(canonical(candidate));
    if(!guard())throw new SceneApiError('SESSION_CHANGED',409,null);
    this.assertCanvasProjectMatch();
    const raw=await this.client.request<unknown>(`/projects/${id}/original-scene/reviews`,'POST',{sessionId:lease.sessionId,generation:lease.generation,expectedRevision:lease.revision,reviewId:review,originalSceneHash:lease.originalSceneHash,candidate},false,undefined,()=>{dispatch();if(!guard())throw new SceneApiError('SESSION_CHANGED',409,null);});
    if(!guard())throw new SceneApiError('SESSION_CHANGED',409,null);
    const result=parseOriginalReview(raw,id,review);
    if(result.baseRevision!==lease.revision||result.baseHash!==lease.originalSceneHash||result.candidateHash!==candidateHash||result.appliedAt!==null||result.appliedRevision!==null)throw new SceneApiError('INVALID_RESPONSE',502,null);
    return result;
  }
  async readOriginalReview(projectId:string,reviewId:string) {return this.#readOriginalReview(projectId,reviewId);}
  async #readOriginalReview(projectId:string,reviewId:string) {
    const id=uuid.parse(projectId),review=uuid.parse(reviewId),guard=this.captureOriginalSceneReadGuard();
    if(!guard())throw new SceneApiError('SESSION_CHANGED',409,null);
    const raw=await this.client.request<unknown>(`/projects/${id}/original-scene/reviews/${review}`,'GET',undefined,false,undefined,()=>{if(!guard())throw new SceneApiError('SESSION_CHANGED',409,null);});
    if(!guard())throw new SceneApiError('SESSION_CHANGED',409,null);
    return parseOriginalReview(raw,id,review);
  }
  /** Read both authoritative records under the same authenticated session. */
  async readOriginalReviewEvidence(receipt:OriginalReviewReceipt) {return this.#readOriginalReviewEvidence(receipt);}
  async #readOriginalReviewEvidence(receipt:OriginalReviewReceipt) {
    if(!isOriginalReviewReceipt(receipt))throw new SceneApiError('INVALID_RESPONSE',502,null);
    const guard=this.captureOriginalSceneReadGuard();
    if(!guard())throw new SceneApiError('SESSION_CHANGED',409,null);
    const review=await this.#readOriginalReview(receipt.projectId,receipt.reviewId);
    if(!guard())throw new SceneApiError('SESSION_CHANGED',409,null);
    const original=await this.#readOriginalScene(receipt.projectId);
    if(!guard())throw new SceneApiError('SESSION_CHANGED',409,null);
    return {projectId:review.projectId,reviewId:review.id,baseHash:review.baseHash,candidateHash:review.candidateHash,
      baseRevision:review.baseRevision,appliedRevision:review.appliedRevision,currentRevision:original.revision,currentSceneHash:original.originalSceneHash};
  }
  /** Never dispatch without a durable receipt and the authenticated project lock. */
  async commitAuthorizedOriginalReview(receipt:OriginalReviewReceipt,lease:{sessionId:string;generation:number;revision:number;originalSceneHash:string},capability:LocalWriteCapability,isActivityCurrent:()=>boolean):Promise<'committed'|'unknown'|'blocked'> {
    try {
      if(!ORIGINAL_REVIEW_COMPLETION_ENABLED||!isOriginalReviewReceipt(receipt))return 'blocked';
      const account=this.snapshot.user?.id,sessionGuard=this.captureOriginalSceneReadGuard(),guard=localWriteCapabilityGuard(capability);
      if(!account||typeof window==='undefined'||!navigator.locks||lease.sessionId!==this.snapshot.sessionId||lease.revision!==receipt.baseRevision||lease.originalSceneHash!==receipt.baseHash)return 'blocked';
      const current=()=>{try{guard.assertStillHeld();return !guard.signal.aborted&&sessionGuard()&&isActivityCurrent()&&this.snapshot.user?.id===account;}catch{return false;}};
      if(!current())return 'blocked';
      const result=await commitOriginalReview({storage:window.localStorage,locks:navigator.locks,accountId:account,receipt,isCurrent:current,submit:async()=>{
        const review=await this.#readOriginalReview(receipt.projectId,receipt.reviewId);
        if(!current()||review.appliedAt!==null||review.appliedRevision!==null||review.baseRevision!==receipt.baseRevision||review.baseHash!==receipt.baseHash||review.candidateHash!==receipt.candidateHash)throw new Error('候选已变化。');
        const original=await this.#readOriginalScene(receipt.projectId);
        if(!current()||original.revision!==receipt.baseRevision||original.originalSceneHash!==receipt.baseHash)throw new Error('原始场景已变化。');
        return this.#applyOriginalReview(receipt.projectId,lease,{id:receipt.reviewId,candidateHash:receipt.candidateHash});
      }});
      return result.state;
    }catch{return 'blocked';}
  }
  /** Isolated reconciliation; no editor or submission path calls this yet. */
  async reconcileOriginalReview(projectId:string,capability:LocalWriteCapability):Promise<'cleared'|'blocked'> {
    try {
      if(!ORIGINAL_REVIEW_COMPLETION_ENABLED)return 'blocked';
      const id=uuid.parse(projectId),account=this.snapshot.user?.id,sessionGuard=this.captureOriginalSceneReadGuard();
      if(!account||!sessionGuard()||typeof window==='undefined'||!navigator.locks)return 'blocked';
      const key=originalReviewReceiptKey(account,id),guard=localWriteCapabilityGuard(capability);
      const current=()=>{try{guard.assertStillHeld();return !guard.signal.aborted&&sessionGuard()&&this.snapshot.user?.id===account;}catch{return false;}};
      if(!current())return 'blocked';
      return await navigator.locks.request(key,{mode:'exclusive',ifAvailable:true},async lock=>{
        if(!lock||!current())return 'blocked' as const;
        const storage=window.localStorage,ledger=createOriginalReviewLedger(capability,account,guard.signal);
        const pending=readOriginalReviewPending(storage,key),existing=await ledger.read(key);
        if(!current()||pending.state==='unavailable')return 'blocked' as const;
        const receipt=pending.state==='pending'?pending.receipt:existing.present?existing.value.receipt:null;
        if(!isOriginalReviewReceipt(receipt)||receipt.projectId.toLowerCase()!==id.toLowerCase())return 'blocked' as const;
        let expected=existing;
        const view:OriginalReviewCompletionStore={
          get:async k=>{if(k!==key||!current())throw new Error('核对范围已变化。');const item=await ledger.read(k);return item.present?item.value:null;},
          list:async()=>ledger.list(),
          put:async(k:string,value:OriginalReviewCompletion)=>{if(k!==key||!current())throw new Error('核对范围已变化。');const next={present:true as const,value};if(await ledger.compareAndSwap(k,expected,next)!=='applied')throw new Error('完成记录未能核对。');expected=next;},
          delete:async k=>{if(k!==key||!current()||!expected.present)throw new Error('核对范围已变化。');await deleteVerifiedOriginalCompletion(k,expected.value,guard,current);expected={present:false};},
        };
        return reconcileVerifiedOriginalReview({accountId:account,projectId:id,storage,ledger:view,isCurrent:current,readCloud:()=>this.#readOriginalReviewEvidence(receipt)});
      });
    }catch{return 'blocked';}
  }
  /** Joint startup audit prototype; current writers are not yet all integrated. */
  async auditOriginalReviewReceipts(capability:LocalWriteCapability):Promise<'clear'|'blocked'> {
    try {
      const account=this.snapshot.user?.id,sessionGuard=this.captureOriginalSceneReadGuard();
      if(!account||!sessionGuard()||typeof window==='undefined')return 'blocked';
      const guard=localWriteCapabilityGuard(capability);guard.assertStillHeld();
      const ledger=createOriginalReviewLedger(capability,account,guard.signal);
      await auditOriginalReviewStartup({storage:window.localStorage,ledger:ledger.auditView});
      guard.assertStillHeld();
      // Ordinary writers have not yet all joined this audit/lock protocol.
      // Even an empty snapshot cannot grant write permission at startup.
      return 'blocked';
    }catch{return 'blocked';}
  }
  async #applyOriginalReview(projectId:string,lease:{sessionId:string;generation:number;revision:number;originalSceneHash:string},review:{id:string;candidateHash:string}) {
    this.assertCanvasProjectMatch();
    const id=uuid.parse(projectId),reviewId=uuid.parse(review.id),guard=this.captureOriginalSceneReadGuard(),dispatch=this.scopedDispatchGuard(true);
    if(!guard()||lease.sessionId!==this.snapshot.sessionId)throw new SceneApiError('SESSION_CHANGED',409,null);
    const raw=await this.client.request<unknown>(`/projects/${id}/original-scene/reviews/${reviewId}/apply`,'POST',{sessionId:lease.sessionId,generation:lease.generation,expectedRevision:lease.revision,originalSceneHash:lease.originalSceneHash,candidateHash:review.candidateHash,acknowledged:true},false,undefined,()=>{dispatch();if(!guard())throw new SceneApiError('SESSION_CHANGED',409,null);});
    if(!guard())throw new SceneApiError('SESSION_CHANGED',409,null);
    const result=z.object({id:uuid,revision:z.number().int().nonnegative()}).safeParse(raw);
    if(!result.success||result.data.id!==id||result.data.revision!==lease.revision+1)throw new SceneApiError('INVALID_RESPONSE',502,null);
    return {revision:result.data.revision};
  }
  async getProject(projectId: string, validate?: (project: BackendProject) => void): Promise<BackendProject> {
    this.ensureCanSwitch();
    this.cancelGeometryPreparation();
    return this.getProjectInSession(projectId, validate);
  }
  private async getProjectInSession(projectId: string, validate?: (project: BackendProject) => void, geometry?: GeometryPreparation): Promise<BackendProject> {
    this.ensureCanSwitch();
    this.operationPending = true;
    try {
      const project = await this.request<BackendProject>(`/projects/${encodeURIComponent(projectId)}`, "GET", undefined, this.captureRequestScope(), true, geometry);
      this.assertGeometryCurrent(geometry);
      if (geometry && project.id !== projectId) throw new SceneApiError("INVALID_RESPONSE", 502, null);
      if(project.projection?.requiresOriginalSceneForWrite)throw new SceneApiError('ORIGINAL_SCENE_REVIEW_REQUIRED',409,null);
      // The renderer can reject unsupported geometry before changing the active project.
      validate?.(project);
      this.selectProject(project, geometry?.bindingFor(project));
      return project;
    } catch (error) {
      if (!geometry || geometry.current()) this.block(error);
      throw error;
    } finally { this.operationPending = false; }
  }
  async acquireLease(projectId: string, validate?: (scene: Scene, project: BackendProject) => void): Promise<LeaseResponse & { scene: Scene }> {
    if (this.operationPending) throw new SceneApiError("CLOUD_OPERATION_BUSY", 409, null);
    if (this.snapshot.lease && !this.snapshot.writeBlocked && this.snapshot.lease.projectId !== projectId) throw new SceneApiError("PROJECT_SWITCH_REQUIRES_RELEASE", 409, null);
    this.cancelGeometryPreparation();
    return this.acquireLeaseInSession(projectId, validate);
  }
  private async acquireLeaseInSession(projectId: string, validate?: (scene: Scene, project: BackendProject) => void, geometry?: GeometryPreparation): Promise<LeaseResponse & { scene: Scene }> {
    if (this.operationPending) throw new SceneApiError("CLOUD_OPERATION_BUSY", 409, null);
    if (this.snapshot.lease && !this.snapshot.writeBlocked && this.snapshot.lease.projectId !== projectId) throw new SceneApiError("PROJECT_SWITCH_REQUIRES_RELEASE", 409, null);
    this.operationPending = true;
    const acquireEpoch=this.epoch,acquireScopeEpoch=this.dispatchScopeEpoch,acquireActor=this.snapshot.user?.id,acquireSession=this.snapshot.sessionId;
    let acquired: LeaseResponse | null = null;
    try {
      const project = this.snapshot.project?.id === projectId ? this.snapshot.project : await this.request<BackendProject>(`/projects/${encodeURIComponent(projectId)}`, "GET", undefined, this.captureRequestScope(), true, geometry);
      this.assertGeometryCurrent(geometry);
      if (geometry && project.id !== projectId) throw new SceneApiError("INVALID_RESPONSE", 502, null);
      const result = await this.request<LeaseResponse & { scene: Scene }>(`/projects/${encodeURIComponent(projectId)}/lease/acquire`, "POST", { sessionId: this.snapshot.sessionId }, this.captureRequestScope(), true, geometry);
      acquired = result;
      this.assertGeometryCurrent(geometry);
      const scene = sceneSchema.parse(result.scene);
      if (result.sessionId !== this.snapshot.sessionId || !Number.isFinite(Date.parse(result.expiresAt))) throw new SceneApiError("INVALID_RESPONSE", 502, null);
      validate?.(scene, project);
      this.stopRenewal();
      this.update({ lease: { projectId, sessionId: result.sessionId, generation: result.generation, expiresAt: result.expiresAt, revision: result.revision }, revision: result.revision,
        draft: geometry ? this.snapshot.draft ?? scene : scene, project: { ...project, scene, revision: result.revision }, dirty: !!geometry,
        geometryBinding: geometry ? geometry.bindingFor(project) : null,
        localRevision: this.snapshot.localRevision + 1, writeBlocked: false, status: "editing", error: null });
      this.timer = setInterval(() => { void this.renewLease().catch(() => { /* Exposed through snapshot.error. */ }); }, 30_000);
      return { ...result, scene };
    } catch (error) {
      // A supported JSON schema can still be unsupported by this editor. Release the
      // just-acquired lease without ever making its scene writable or replacing the draft.
      if (acquired?.sessionId === acquireSession) {
        try {
          const held=acquired;
          const checkRelease=()=>{const current=this.snapshot.lease;if(!acquireActor||this.epoch!==acquireEpoch||this.dispatchScopeEpoch!==acquireScopeEpoch||this.snapshot.user?.id!==acquireActor||this.snapshot.sessionId!==acquireSession||held.sessionId!==acquireSession||(current&&(current.projectId!==projectId||current.sessionId!==held.sessionId||current.generation!==held.generation)))throw new SceneApiError('SESSION_CHANGED',409,null);};
          await this.client.request(`/projects/${encodeURIComponent(projectId)}/lease/release`, "POST", { sessionId: held.sessionId, generation: held.generation },false,undefined,checkRelease);
        } catch { /* A failed release remains blocked locally and expires server-side. */ }
      }
      if (!geometry || geometry.current()) this.block(error);
      throw error;
    } finally { this.operationPending = false; }
  }
  private writableLease(): Lease {
    const lease = this.snapshot.lease;
    if (this.snapshot.writeBlocked || !lease) throw new SceneApiError("CLOUD_WRITE_BLOCKED", 409, null);
    if (Date.parse(lease.expiresAt) <= Date.now()) {
      const error = new SceneApiError("LEASE_LOST", 409, null);
      this.block(error);
      throw error;
    }
    return lease;
  }
  async renewLease(): Promise<void> {
    if (this.renewing || this.operationPending) return;
    const lease = this.writableLease();
    this.renewing = true;
    try {
      const result = await this.request<LeaseResponse>(`/projects/${lease.projectId}/lease/renew`, "POST", { sessionId: lease.sessionId, generation: lease.generation });
      if (this.snapshot.lease === lease && !this.snapshot.writeBlocked) this.update({ lease: { ...lease, expiresAt: result.expiresAt } });
    } finally { this.renewing = false; }
  }
  async releaseLease(): Promise<void> {
    if (this.operationPending) throw new SceneApiError("CLOUD_OPERATION_BUSY", 409, null);
    const lease = this.writableLease();
    this.operationPending = true;
    this.stopRenewal();
    try {
      await this.request(`/projects/${lease.projectId}/lease/release`, "POST", { sessionId: lease.sessionId, generation: lease.generation });
      this.update({ lease: null, writeBlocked: true, status: "ready", error: null });
    } finally { this.operationPending = false; }
  }
  /** UI may call after each local change; this never writes to the server. */
  setDraft(scene: Scene): void {
    this.update({ draft: sceneSchema.parse(scene), dirty: true, localRevision: this.snapshot.localRevision + 1 });
  }
  private proposalState(scene: Scene): EditorState {
    const parsed = sceneSchema.parse(scene);
    const lease = this.writableLease();
    if (this.snapshot.project?.id !== lease.projectId || this.snapshot.revision === null) throw new SceneApiError("CLOUD_WRITE_BLOCKED", 409, null);
    // Synchronize an edit that has not yet reached the React draft effect. Equal
    // snapshots must not invalidate a proposal merely because it was previewed.
    if (canonical(this.snapshot.draft) !== canonical(parsed)) this.setDraft(parsed);
    return { projectId: lease.projectId, sessionId: lease.sessionId, generation: lease.generation,
      expectedRevision: this.snapshot.revision, localRevision: this.snapshot.localRevision, scene: parsed };
  }
  private assertProposalContext(state: EditorState): void {
    // 校验的是「这个迟到的提案还属于当前编辑上下文吗」。租约已释放或被写锁时
    // writableLease 的 CLOUD_WRITE_BLOCKED（提示去拿编辑权）会误导——提案本就不该
    // 再应用，报 STALE_PROPOSAL；过期租约的 LEASE_LOST 保持透传。
    let lease: Lease;
    try {
      lease = this.writableLease();
    } catch (error) {
      if (error instanceof SceneApiError && error.code === "CLOUD_WRITE_BLOCKED") throw new SceneApiError("STALE_PROPOSAL", 409, null);
      throw error;
    }
    const scopeOk = this.isCurrentRequestScope({ projectId: state.projectId, lease: state });
    const checks = {
      leaseProjectId: lease.projectId === state.projectId,
      leaseSessionId: lease.sessionId === state.sessionId,
      leaseGeneration: lease.generation === state.generation,
      projectId: this.snapshot.project?.id === state.projectId,
      revision: this.snapshot.revision === state.expectedRevision,
      localRevision: this.snapshot.localRevision === state.localRevision,
      draft: canonical(this.snapshot.draft) === canonical(state.scene),
    };
    if (!scopeOk || Object.values(checks).some(v => !v)) throw new SceneApiError("STALE_PROPOSAL", 409, null);
  }
  /** Generate a preview only. Requests never change or save the scene. */
  async requestProposal(input: SceneProposalInput): Promise<SceneProposal> {
    if (this.operationPending) throw new SceneApiError("CLOUD_OPERATION_BUSY", 409, null);
    const parsed = sceneSchema.parse(input.scene);
    if (input.mode === "layout" && parsed.objects.length > 0) throw new SceneApiError("LAYOUT_REQUIRES_EMPTY_SCENE", 422, null);
    const state = this.proposalState(parsed);
    const epoch = this.epoch, actor = this.snapshot.user?.id;
    const requestInput = { projectId: state.projectId, sessionId: state.sessionId, generation: state.generation,
      expectedRevision: state.expectedRevision, localRevision: state.localRevision, scene: parsed,
      instruction: input.prompt.trim(), mode: input.mode, selectedIds: [...new Set(input.selectedIds ?? [])].sort() };
    const fingerprint = canonical(requestInput);
    const contextKey = `${epoch}:${fingerprint}`;
    let requestId = input.requestId ?? this.proposalRequestIds.get(contextKey) ?? crypto.randomUUID();
    let key = `${epoch}:${requestId}`;
    let existing = this.proposalRequests.get(key);
    if (existing?.result && (existing.result.applied_at !== null || Date.parse(existing.result.expires_at) <= Date.now())) {
      // A new user invocation may regenerate a definitively completed proposal
      // that can no longer be applied. Uncertain failures have no result and
      // retain their original idempotency key instead.
      this.proposalRequests.delete(key);
      for (const [context, id] of this.proposalRequestIds) if (id === requestId) this.proposalRequestIds.delete(context);
      requestId = crypto.randomUUID();
      key = `${epoch}:${requestId}`;
      existing = undefined;
    }
    const body = proposalRequestSchema.parse({ ...requestInput, requestId });
    if (body.selectedIds.some(id => !body.scene.objects.some(object => object.id === id))) throw new SceneApiError("OBJECT_NOT_FOUND", 422, null);
    this.proposalRequestIds.set(contextKey, requestId);
    if (existing && existing.fingerprint !== fingerprint) throw new SceneApiError("IDEMPOTENCY_CONFLICT", 409, null);
    if (existing?.promise) {
      const proposal = await existing.promise;
      await assertFreshProposal(proposal, state);
      this.assertProposalContext(state);
      return proposal;
    }
    if (this.proposalPending) throw new SceneApiError("AI_BUSY", 409, null);
    const record: PaidRequest<SceneProposal> = { fingerprint };
    this.proposalRequests.set(key, record);
    this.proposalPending = true;
    record.promise = (async () => {
      try {
        // Keep renewal running during an AI call: generation may exceed 30 seconds.
        const proposal = proposalResponseSchema.parse(await this.request<unknown>(`/projects/${state.projectId}/proposals`, "POST", body, { projectId: state.projectId, lease: state }, false));
        if (epoch !== this.epoch) throw new SceneApiError("SESSION_CHANGED", 409, null);
        await assertFreshProposal(proposal, state);
        this.assertProposalContext(state);
        if (canonical(proposal.base_scene) !== canonical(state.scene)) throw new SceneApiError("INVALID_RESPONSE", 502, null);
        record.result = proposal;
        return proposal;
      } catch (error) {
        // Keep the idempotency key after failure. A user retry reuses it; no
        // automatic retry may reserve a second paid request.
        delete record.promise;
        if (error instanceof SceneApiError && error.code === 'SESSION_CHANGED' && epoch === this.epoch && actor === this.snapshot.user?.id &&
            !this.isCurrentRequestScope({ projectId: state.projectId, lease: state })) throw new SceneApiError('STALE_PROPOSAL', 409, null);
        throw error;
      } finally { this.proposalPending = false; }
    })();
    return record.promise;
  }
  /** Start once; uncertain dispatches are recovered by request ID through GET. */
  async startAgentRun(input: AgentRunInput): Promise<AgentRun> {
    if (this.operationPending) throw new SceneApiError("CLOUD_OPERATION_BUSY", 409, null);
    const state = this.proposalState(input.scene);
    const body = agentRunRequestSchema.parse({ ...input, sessionId: state.sessionId, generation: state.generation, expectedRevision: state.expectedRevision, localRevision: state.localRevision });
    const run = agentRunSchema.parse(await this.request(`/projects/${state.projectId}/agent-runs`, 'POST', body, { projectId: state.projectId, lease: state }, false));
    if (run.projectId !== state.projectId || run.requestId !== input.requestId) throw new SceneApiError('INVALID_RESPONSE', 502, null);
    return run;
  }
  async getAgentRun(runId: string): Promise<AgentRun> {
    const projectId = this.snapshot.project?.id;
    if (!projectId) throw new SceneApiError('PROJECT_REQUIRED', 409, null);
    const run = agentRunSchema.parse(await this.businessRequest(`/projects/${projectId}/agent-runs/${uuid.parse(runId)}`));
    if (run.projectId !== projectId || run.id !== runId) throw new SceneApiError('INVALID_RESPONSE', 502, null);
    return run;
  }
  async getAgentRunEvents(runId:string,after:number):Promise<AgentRunEventPage> {
    const projectId=this.snapshot.project?.id,actor=this.snapshot.user?.id;
    if(!projectId||!actor)throw new SceneApiError('PROJECT_REQUIRED',409,null);
    if(!Number.isSafeInteger(after)||after<0||after>128)throw new SceneApiError('INVALID_RESPONSE',502,null);
    const epoch=this.epoch,lease=this.snapshot.lease;
    const matches=()=>this.epoch===epoch&&this.snapshot.project?.id===projectId&&this.snapshot.user?.id===actor&&
      this.snapshot.lease?.projectId===lease?.projectId&&this.snapshot.lease?.sessionId===lease?.sessionId&&this.snapshot.lease?.generation===lease?.generation;
    let invalidated=false;const stop=this.subscribe(()=>{if(!matches())invalidated=true;});
    try{
      // Optional observation endpoint: an old server's 404 must not mark the
      // project as failed or affect the active run.
      this.requireConfig();
      const value=await this.client.request(`/projects/${uuid.parse(projectId)}/agent-runs/${uuid.parse(runId)}/events?after=${after}`,'GET',undefined,false,undefined,()=>{if(invalidated||!matches())throw new SceneApiError('SESSION_CHANGED',409,null);});
      if(invalidated||!matches())throw new SceneApiError('SESSION_CHANGED',409,null);
      return parseAgentRunEvents(value,after);
    }finally{stop();}
  }
  async getAgentRunByRequest(requestId: string): Promise<AgentRun> {
    const projectId = this.snapshot.project?.id;
    if (!projectId) throw new SceneApiError('PROJECT_REQUIRED', 409, null);
    const run = agentRunSchema.parse(await this.businessRequest(`/projects/${projectId}/agent-runs/by-request/${uuid.parse(requestId)}`));
    if (run.projectId !== projectId || run.requestId !== requestId) throw new SceneApiError('INVALID_RESPONSE', 502, null);
    return run;
  }
  /**
   * 运行中改道：把这句备注交给正在跑的那一趟，工作线程在下一轮模型调用前取走。
   *
   * 返回服务端承认的送达总数（steerTotal）。任务已结束会被回 AGENT_RUN_STOPPED——
   * 那条备注没有执行机会，调用方必须如实告诉用户没送到，不能当成已生效。
   */
  async steerAgentRun(runId: string, note: string): Promise<AgentRun> {
    const projectId = this.snapshot.project?.id;
    if (!projectId) throw new SceneApiError('PROJECT_REQUIRED', 409, null);
    const run = agentRunSchema.parse(await this.businessRequest(`/projects/${projectId}/agent-runs/${uuid.parse(runId)}/notes`, 'POST', { note }));
    if (run.projectId !== projectId || run.id !== runId) throw new SceneApiError('INVALID_RESPONSE', 502, null);
    return run;
  }
  async cancelAgentRun(runId: string): Promise<AgentRun> {
    const projectId = this.snapshot.project?.id;
    if (!projectId) throw new SceneApiError('PROJECT_REQUIRED', 409, null);
    const run = agentRunSchema.parse(await this.businessRequest(`/projects/${projectId}/agent-runs/${uuid.parse(runId)}/cancel`, 'POST'));
    if (run.projectId !== projectId || run.id !== runId) throw new SceneApiError('INVALID_RESPONSE', 502, null);
    return run;
  }
  /** Task runs use the typed transport and existing session boundary, without synchronizing or uploading a scene. */
  private async activityRunRequest(path: string, method: 'GET' | 'POST', transport: (beforeDispatch:()=>void) => Promise<ActivityTaskRun>): Promise<ActivityTaskRun> {
    const actor = this.snapshot.user?.id, projectId = this.snapshot.project?.id;
    if (!actor || !projectId) throw new SceneApiError('PROJECT_REQUIRED', 409, null);
    const binding = this.snapshot.geometryBinding;
    const requestScope = this.captureRequestScope(), revision = this.snapshot.revision;
    const identity = () => this.snapshot.user?.id === actor && this.snapshot.project?.id === projectId &&
      this.snapshot.geometryBinding?.localActivityId === binding?.localActivityId &&
      this.snapshot.geometryBinding?.cloudProjectId === binding?.cloudProjectId &&
      this.isCurrentRequestScope(requestScope) && this.snapshot.revision === revision;
    let invalidated = false;
    const stop = this.subscribe(() => { if (!identity()) invalidated = true; });
    try {
      const run = await this.request(path, method, undefined, this.captureRequestScope(), 'business', undefined,transport,()=>!invalidated&&identity());
      if (invalidated || !identity()) throw new SceneApiError('SESSION_CHANGED', 409, null);
      return run;
    } finally { stop(); }
  }
  async startActivityTaskRun(input: ActivityTaskRunInput): Promise<ActivityTaskRun> {
    if (this.operationPending) throw new SceneApiError('CLOUD_OPERATION_BUSY', 409, null);
    const lease = this.writableLease(), projectId = this.snapshot.project?.id;
    if (!projectId || lease.projectId !== projectId || this.snapshot.revision === null || !this.snapshot.user || !Number.isFinite(Date.parse(lease.expiresAt))) {
      throw new SceneApiError('CLOUD_WRITE_BLOCKED', 409, null);
    }
    if (this.snapshot.geometryBinding ? !this.isGeometryBound(input.activityContext.projectId) : projectId !== input.activityContext.projectId) {
      throw new SceneApiError('ACTIVITY_SERVICE_REQUIRED', 409, null);
    }
    const body = activityTaskRunRequestSchema.parse({ ...input, kind: 'activity_tasks', sessionId: lease.sessionId,
      generation: lease.generation, expectedRevision: this.snapshot.revision });
    return this.activityRunRequest(`/projects/${projectId}/agent-runs`, 'POST', check => this.client.startActivityTaskRun(projectId, body,check));
  }
  /** 简报槽位提取：只读、不占租约，模型 key 在 Supabase secrets，浏览器不接触。未启用返回 enabled:false。 */
  async briefExtract(message: string, signal?: AbortSignal, provider?: ChatProviderId): Promise<BriefExtractResponse> {
    const input = briefExtractRequestSchema.parse({ message, ...(provider ? { provider } : {}) });
    const dispatch=this.scopedDispatchGuard(false);
    const result=await (this.conversationClient()??this.client).request('/brief/extract', 'POST', input, false, signal,dispatch,true);
    dispatch();return briefExtractResponseSchema.parse(result);
  }
  /** One opt-in call returns a reply and proposed facts; it never executes actions. */
  async briefConversation(message:string,history:Array<{role:'user'|'assistant';text:string}>,signal?:AbortSignal,provider?:ChatProviderId):Promise<BriefConversationResponse> {
    const input=briefConversationRequestSchema.parse({message,responseMode:'conversation_v1',history,...(provider?{provider}:{})});
    const client=this.conversationClient();
    if(!client)return {enabled:false,extraction:null,reply:null,unhandled:[],factEvidence:[]};
    const dispatch=this.scopedDispatchGuard(false);
    const response=await client.request('/brief/extract','POST',input,false,signal,dispatch,true);
    dispatch();
    const parsed=briefConversationResponseSchema.safeParse(response);
    if(!parsed.success)throw new SceneApiError('INVALID_RESPONSE',502,{category:'contract'});
    const result=parsed.data;
    // A classified model failure is {enabled:true, extraction:null, reason}.
    // Return it so the resolver can show that category. Do not turn it into an unclassified throw.
    if(result.enabled&&result.extraction&&result.reply&&result.reason===undefined){
      try{parseBriefConversation({extraction:result.extraction,reply:result.reply,unhandled:result.unhandled,factEvidence:result.factEvidence,...(result.materialQueries?{materialQueries:result.materialQueries}:{})},input.message);}
      catch{throw new SceneApiError('INVALID_RESPONSE',502,{category:'contract'});}
    } else if(!result.enabled&&(result.extraction!==null||result.reply!==null||result.unhandled.length||result.factEvidence.length||result.materialQueries?.length))throw new SceneApiError('INVALID_RESPONSE',502,{category:'contract'});
    return result;
  }
  /** Explicitly enabled read-only conversation; does not execute scene actions. */
  async assistantChat(message: string, history: Array<{role:'user'|'assistant';text:string}>, signal?: AbortSignal, responseMode?: "outdoor_v1", provider?: ChatProviderId): Promise<AssistantChatResult> {
    const input = assistantChatRequestSchema.parse({ message, history, ...(responseMode ? { responseMode } : {}), ...(provider ? { provider } : {}) });
    const client=this.conversationClient();
    if(!client)return {status:'disabled',answer:null};
    const dispatch=this.scopedDispatchGuard(false);
    const result=await client.request('/assistant/chat', 'POST', input, false, signal,dispatch,true);
    dispatch();return assistantChatResponseSchema.parse(result);
  }
  async getActivityTaskRun(id: string): Promise<ActivityTaskRun> {
    const projectId = this.snapshot.project?.id;
    if (!projectId) throw new SceneApiError('PROJECT_REQUIRED', 409, null);
    return this.activityRunRequest(`/projects/${projectId}/agent-runs/${uuid.parse(id)}`, 'GET', check => this.client.getActivityTaskRun(projectId, id,check));
  }
  async getActivityTaskRunByRequest(requestId: string): Promise<ActivityTaskRun> {
    const projectId = this.snapshot.project?.id;
    if (!projectId) throw new SceneApiError('PROJECT_REQUIRED', 409, null);
    return this.activityRunRequest(`/projects/${projectId}/agent-runs/by-request/${uuid.parse(requestId)}`, 'GET', check => this.client.getActivityTaskRunByRequest(projectId, requestId,check));
  }
  async cancelActivityTaskRun(id: string): Promise<ActivityTaskRun> {
    const projectId = this.snapshot.project?.id;
    if (!projectId) throw new SceneApiError('PROJECT_REQUIRED', 409, null);
    return this.activityRunRequest(`/projects/${projectId}/agent-runs/${uuid.parse(id)}/cancel`, 'POST', check => this.client.cancelActivityTaskRun(projectId, id,check));
  }
  /** Deterministic asset replacement prepares a preview; only applySceneProposal saves it. */
  async prepareMaterialVariantProposal(input: { requestId: string; scene: Scene; objectIds: string[]; sourceAssetId: string; variantAssetId: string }): Promise<SceneProposal> {
    if (this.operationPending) throw new SceneApiError("CLOUD_OPERATION_BUSY", 409, null);
    const state = this.proposalState(input.scene), epoch = this.epoch;
    const body = materialVariantProposalRequestSchema.parse({ sessionId: state.sessionId, generation: state.generation, expectedRevision: state.expectedRevision, localRevision: state.localRevision, ...input });
    const proposal = proposalResponseSchema.parse(await this.request(`/projects/${state.projectId}/material-variants`, "POST", body, { projectId: state.projectId, lease: state }, false));
    if (epoch !== this.epoch) throw new SceneApiError("SESSION_CHANGED", 409, null);
    await assertFreshProposal(proposal, state);
    this.assertProposalContext(state);
    if (canonical(proposal.base_scene) !== canonical(state.scene)) throw new SceneApiError("INVALID_RESPONSE", 502, null);
    return proposal;
  }
  async applySceneProposal(proposal: SceneProposal, scene: Scene): Promise<ApplySceneProposalResult> {
    if (this.operationPending) throw new SceneApiError("CLOUD_OPERATION_BUSY", 409, null);
    const state = this.proposalState(scene);
    const epoch = this.epoch;
    const scope: RequestScope = { projectId: state.projectId, lease: state };
    this.operationPending = true;
    try {
      const checked = proposalResponseSchema.parse(proposal);
      await assertFreshProposal(checked, state);
      this.assertProposalContext(state);
      this.update({ status: "saving", error: null });
      const result = applyProposalResponseSchema.parse(await this.request<unknown>(`/projects/${state.projectId}/proposals/apply`, "POST", {
        proposalId: checked.id, sessionId: state.sessionId, generation: state.generation,
        expectedRevision: state.expectedRevision, localRevision: state.localRevision, currentScene: state.scene,
      }, scope));
      if (epoch !== this.epoch) throw new SceneApiError("SESSION_CHANGED", 409, null);
      if (!this.isCurrentRequestScope(scope)) throw new SceneApiError("STALE_PROPOSAL", 409, null);
      if (result.id !== state.projectId || result.undoGroup !== checked.id || result.revision !== state.expectedRevision + 1 ||
          canonical(result.scene) !== canonical(checked.candidate) || canonical(result.previousScene) !== canonical(checked.base_scene)) {
        throw new SceneApiError("INVALID_RESPONSE", 502, null);
      }
      for (const record of this.proposalRequests.values()) {
        if (record.result?.id === checked.id) record.result = { ...record.result, applied_at: result.updatedAt };
      }
      const acceptedLocally = !this.snapshot.writeBlocked && this.snapshot.localRevision === state.localRevision &&
        canonical(this.snapshot.draft) === canonical(state.scene) && this.snapshot.lease?.generation === state.generation;
      this.update({ revision: result.revision, project: { ...this.snapshot.project!, revision: result.revision, scene: result.scene },
        ...(this.snapshot.lease ? { lease: { ...this.snapshot.lease, revision: result.revision } } : {}),
        ...(acceptedLocally ? { draft: result.scene, dirty: false, localRevision: this.snapshot.localRevision + 1 } : { dirty: true }),
        ...(!this.snapshot.writeBlocked ? { status: "editing", error: null } : {}),
      });
      if(checked.base_scene.schemaVersion===1&&checked.candidate.schemaVersion===2)this.lastAppliedReconstruction={proposal:checked,epoch:this.epoch};
      return { ...result, acceptedLocally };
    } catch (error) {
      // A stale preview is a local validation failure, not a loss of editing rights.
      if (epoch === this.epoch && this.isCurrentRequestScope(scope) && !(error instanceof SceneApiError && error.code === "STALE_PROPOSAL")) this.block(error);
      throw error;
    } finally { this.operationPending = false; }
  }
  /** Source bytes remain private; no base64 payload or credentials are persisted with a scene. */
  async uploadSource(file: Blob, name: string, kind: SourceImage['kind']): Promise<SourceImage> {
    this.assertCanvasProjectMatch();
    this.requireConfig();
    const lease = this.writableLease();
    const scope = this.captureRequestScope(),dispatch=this.scopedDispatchGuard(true);
    const epoch = this.epoch;
    const token = await this.accessToken();
    if (!token) throw new SceneApiError("UNAUTHENTICATED", 401, null);
    const form = new FormData(); form.append("file", file, name); form.append("projectId", lease.projectId); form.append("kind", kind);
    dispatch();this.writableLease();
    const response = await fetch(`${this.config.apiUrl}/assets/sources`, { method: "POST", headers: {Authorization: `Bearer ${token}`}, body: form, cache: "no-store" });
    const result = await response.json();
    if (epoch !== this.epoch || !this.isCurrentRequestScope(scope)) throw new SceneApiError("SESSION_CHANGED", 409, null);
    if (!response.ok) throw new SceneApiError(result.error?.code ?? "SOURCE_UPLOAD_FAILED", response.status, result.error?.details);
    return sourceImageSchema.parse(result);
  }
  async listSources(): Promise<SourceImage[]> {
    const projectId = this.snapshot.project?.id;
    if (!projectId) throw new SceneApiError("PROJECT_REQUIRED", 409, null);
    return z.array(sourceImageSchema).parse(await this.request(`/projects/${projectId}/sources`, 'GET', undefined, this.captureRequestScope(), false));
  }
  async removeSource(assetId: string): Promise<void> {
    const lease=this.writableLease();
    const result=await this.request<{removed:boolean}>(`/projects/${lease.projectId}/sources/${uuid.parse(assetId)}`, 'DELETE', undefined, this.captureRequestScope(), false);
    if(result.removed!==true)throw new SceneApiError('INVALID_RESPONSE',502,null);
  }
  async sourceImageUrl(assetId: string): Promise<string> {
    const result = await this.request<{id: string; url: string}>(`/assets/${uuid.parse(assetId)}/url`, "POST", undefined, this.captureRequestScope(), false);
    if (result.id !== assetId || typeof result.url !== 'string') throw new SceneApiError("INVALID_RESPONSE", 502, null);
    const url = new URL(result.url);
    if (url.username || url.password || (url.protocol !== 'https:' && !(url.protocol === 'http:' && (['localhost','127.0.0.1','[::1]'].includes(url.hostname) || isDevelopmentFixtureHost(url.hostname))))) throw new SceneApiError("INVALID_RESPONSE", 502, null);
    return url.href;
  }
  async createReconstruction(input: ReconstructionInput): Promise<ReconstructionJob> {
    const state = this.proposalState(input.scene);
    const request = reconstructionRequestSchema.parse({ ...input, sessionId: state.sessionId, generation: state.generation, expectedRevision: state.expectedRevision, localRevision: state.localRevision });
    const job = parseReconstructionJob(await this.request(`/projects/${state.projectId}/reconstructions`, 'POST', request, {projectId:state.projectId,lease:state}, false));
    this.assertProposalContext(state);
    return job;
  }
  async getReconstruction(jobId: string): Promise<ReconstructionJob> {
    const projectId = this.snapshot.project?.id;
    if (!projectId) throw new SceneApiError("PROJECT_REQUIRED", 409, null);
    const job = parseReconstructionJob(await this.request(`/projects/${projectId}/reconstructions/${uuid.parse(jobId)}`, 'GET', undefined, this.captureRequestScope(), false));
    if (job.id !== jobId) throw new SceneApiError("INVALID_RESPONSE", 502, null);
    return job;
  }
  async getGenerationCapabilities(): Promise<GenerationCapabilities> {
    return generationCapabilitiesSchema.parse(await this.businessRequest('/generation/capabilities'));
  }
  /** 服务端已配置的 chat provider 槽位；不含密钥值，前端只能在 configured 项间选择。 */
  async getChatCapabilities(): Promise<ChatCapabilities> {
    return chatCapabilitiesSchema.parse(await this.businessRequest('/chat/capabilities'));
  }
  async uploadGenerationReference(file: File): Promise<{ id: string }> {
    this.assertCanvasProjectMatch();
    if (!['image/png','image/jpeg'].includes(file.type) || !file.size || file.size > 5 * 1024 * 1024) throw new Error('请选择 5 MB 以内的 PNG 或 JPEG 参考图。');
    this.requireConfig();
    const scope = this.captureRequestScope(), epoch = this.epoch,dispatch=this.scopedDispatchGuard(true), token = await this.accessToken();
    const credentials = this.tokens;
    if (!token) throw new SceneApiError('UNAUTHENTICATED', 401, null);
    try {
      dispatch();
      const response = await fetch(`${this.config.apiUrl}/assets/floorplan`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': file.type }, body: file, cache: 'no-store' });
      if (epoch !== this.epoch || !this.isCurrentRequestScope(scope)) throw new SceneApiError('SESSION_CHANGED', 409, null);
      if (response.status === 401) throw new SceneApiError('UNAUTHENTICATED', 401, null);
      const result = await response.json();
      if (epoch !== this.epoch || !this.isCurrentRequestScope(scope)) throw new SceneApiError('SESSION_CHANGED', 409, null);
      if (!response.ok) throw new SceneApiError(result.error?.code ?? 'SOURCE_UPLOAD_FAILED', response.status, result.error?.details);
      return z.object({ id: uuid }).parse(result);
    } catch (error) {
      if (epoch === this.epoch && this.isCurrentRequestScope(scope)) {
        if (error instanceof SceneApiError && error.status === 401) {
          if (!this.tokens || this.tokens === credentials) { this.tokens = null; this.persistTokens(credentials); this.update({ user: null }); }
          this.block(error);
        } else this.update({ error: failure(error) });
      }
      throw error;
    }
  }
  /** 本机 GLB 上传口：原始二进制直传，带进度；服务端按文件哈希去重并登记资产。本机副本不在这里处理。 */
  async uploadLocalAsset(
    file: Blob,
    meta: { name: string; source: 'aholo' | 'upload'; sourceId?: string },
    onProgress?: (loaded: number, total: number) => void,
  ): Promise<{ id: string; byteSize: number; sha256: string; reused?: boolean; metadata?: Record<string, unknown> }> {
    this.assertCanvasProjectMatch();
    if (!file.size) throw new SceneApiError('EMPTY_ASSET', 422, null);
    if (file.size > 10 * 1024 * 1024) throw new SceneApiError('ASSET_TOO_LARGE', 413, { limit: 10 * 1024 * 1024 });
    if (!meta.name.trim()) throw new SceneApiError('ASSET_NAME_REQUIRED', 422, null);
    if (meta.source === 'aholo' && !meta.sourceId) throw new SceneApiError('SOURCE_ID_REQUIRED', 422, null);
    this.requireConfig();
    const scope = this.captureRequestScope(), epoch = this.epoch,dispatch=this.scopedDispatchGuard(true), token = await this.accessToken();
    const credentials = this.tokens;
    if (!token) throw new SceneApiError('UNAUTHENTICATED', 401, null);
    const query = new URLSearchParams({ name: meta.name.trim().slice(0, 120), source: meta.source, ...(meta.sourceId ? { sourceId: meta.sourceId } : {}) });
    try {
      dispatch();
      const result = await this.sendAssetBlob(`${this.config.apiUrl}/assets/glb?${query.toString()}`, token, file, onProgress,dispatch);
      if (epoch !== this.epoch || !this.isCurrentRequestScope(scope)) throw new SceneApiError('SESSION_CHANGED', 409, null);
      const parsed = z.object({
        id: uuid,
        byteSize: z.number().int().positive(),
        sha256: z.string().regex(/^[a-f0-9]{64}$/),
        reused: z.boolean().optional(),
        metadata: z.record(z.string(), z.unknown()).optional(),
      }).parse(result);
      return {
        id: parsed.id,
        byteSize: parsed.byteSize,
        sha256: parsed.sha256,
        ...(parsed.reused !== undefined ? { reused: parsed.reused } : {}),
        ...(parsed.metadata !== undefined ? { metadata: parsed.metadata } : {}),
      };
    } catch (error) {
      if (epoch === this.epoch && this.isCurrentRequestScope(scope)) {
        if (error instanceof SceneApiError && error.status === 401) {
          if (!this.tokens || this.tokens === credentials) { this.tokens = null; this.persistTokens(credentials); this.update({ user: null }); }
          this.block(error);
        } else this.update({ error: failure(error) });
      }
      throw error;
    }
  }
  /** 浏览器有 XHR 时用它拿上传进度；没有（单测 / SSR）退回 fetch。两条路径的错误形状保持一致。 */
  private sendAssetBlob(url: string, token: string, file: Blob, onProgress?: (loaded: number, total: number) => void,beforeDispatch?:()=>void): Promise<unknown> {
    if (typeof XMLHttpRequest === 'undefined') {
      beforeDispatch?.();
      return fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'model/gltf-binary' }, body: file, cache: 'no-store' })
        .then(async response => {
          const result = await response.json().catch(() => null);
          if (!response.ok) throw new SceneApiError(result?.error?.code ?? 'ASSET_UPLOAD_FAILED', response.status, result?.error?.details);
          return result;
        });
    }
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', url, true);
      xhr.timeout = 180_000;
      xhr.setRequestHeader('Authorization', `Bearer ${token}`);
      xhr.setRequestHeader('Content-Type', 'model/gltf-binary');
      xhr.upload.onprogress = event => { if (event.lengthComputable) onProgress?.(event.loaded, event.total); };
      xhr.onload = () => {
        let result: { error?: { code?: string; details?: unknown } } | null = null;
        try { result = JSON.parse(xhr.responseText); } catch { /* 非 JSON 错误体按状态码处理 */ }
        if (xhr.status < 200 || xhr.status >= 300) {
          reject(new SceneApiError(result?.error?.code ?? 'ASSET_UPLOAD_FAILED', xhr.status, result?.error?.details));
          return;
        }
        resolve(result);
      };
      xhr.onerror = () => reject(new SceneApiError('NETWORK_ERROR', 0, null));
      xhr.ontimeout = () => reject(new SceneApiError('ASSET_UPLOAD_TIMEOUT', 408, null));
      xhr.onabort = () => reject(new SceneApiError('ASSET_UPLOAD_ABORTED', 499, null));
      try{beforeDispatch?.();xhr.send(file);}catch(error){reject(error);}
    });
  }
  async createGenerationJob(prompt: string, requestId: string, options?: Partial<Pick<GenerationRequest, 'kind' | 'referenceImageAssetId' | 'sourceAssetId' | 'provider'>>): Promise<GenerationJob> {
    const parsed = generationRequestSchema.parse({ prompt: prompt.trim(), requestId, ...options });
    // Preserve the existing text request body and identity across reloads and upgrades; the
    // explicit vendor declaration joins the body only when present.
    const body = parsed.kind === 'text'
      ? { prompt: parsed.prompt, requestId: parsed.requestId, ...(parsed.provider ? { provider: parsed.provider } : {}) }
      : parsed;
    const fingerprint = canonical(body);
    const key = `${this.epoch}:${body.requestId}`;
    const existing = this.generationRequests.get(key);
    if (existing && existing.fingerprint !== fingerprint) throw new SceneApiError("IDEMPOTENCY_CONFLICT", 409, null);
    if (existing?.promise) return existing.promise;
    if (this.generationPending) throw new SceneApiError("GENERATION_BUSY", 409, null);
    const record: PaidRequest<GenerationJob> = { fingerprint };
    this.generationRequests.set(key, record);
    this.generationPending = true;
    record.promise = (async () => {
      try { return generationJobSchema.parse(await this.businessRequest<unknown>("/jobs", "POST", body)); }
      catch (error) { delete record.promise; throw error; }
      finally { this.generationPending = false; }
    })();
    return record.promise;
  }
  async getGenerationJob(id: string): Promise<GenerationJob> {
    const job = generationJobSchema.parse(await this.businessRequest<unknown>(`/jobs/${uuid.parse(id)}`));
    if (job.id !== id) throw new SceneApiError("INVALID_RESPONSE", 502, null);
    return job;
  }
  async listGenerationJobs(): Promise<GenerationJob[]> {
    return z.array(generationJobSchema).parse(await this.businessRequest<unknown>("/jobs"));
  }
  /** Call after saving a scene containing asset_id; the server verifies that reference. */
  async markGenerationAdded(id: string, projectId: string): Promise<GenerationJob> {
    const targetProject = uuid.parse(projectId);
    // The target is verified by the server; request lifetime is tied to the
    // active editor/account, which may legitimately be a different project.
    const scope = this.captureRequestScope();
    const job = generationJobSchema.parse(await this.request<unknown>(`/jobs/${uuid.parse(id)}/added`, "POST", { projectId: targetProject }, scope, "business", undefined, undefined, undefined, targetProject !== scope.projectId));
    if (job.id !== id || job.state !== "added") throw new SceneApiError("INVALID_RESPONSE", 502, null);
    return job;
  }
  /** A v2 -> v1 local undo can restore only an authoritative, known pre-apply snapshot. */
  private async saveReconstructionUndo(scene: Scene, proposal: SceneProposal): Promise<SaveResult> {
    this.setDraft(scene);
    const lease=this.writableLease(),epoch=this.epoch,scope=this.captureRequestScope();
    const revision=this.snapshot.revision!,localRevision=this.snapshot.localRevision;
    this.operationPending=true;this.update({status:'saving',error:null});
    try {
      const raw=await this.request<unknown>(`/projects/${lease.projectId}/history/restore`,'POST',{
        sessionId:lease.sessionId,generation:lease.generation,expectedRevision:revision,proposalId:proposal.id,currentScene:proposal.candidate,
      },scope);
      const result=applyProposalResponseSchema.extend({warnings:z.array(z.object({code:z.string(),ids:z.array(uuid)}))}).parse(raw);
      if(epoch!==this.epoch||!this.isCurrentRequestScope(scope))throw new SceneApiError('SESSION_CHANGED',409,null);
      if(result.id!==lease.projectId||result.revision!==revision+1||result.undoGroup!==proposal.id||canonical(result.scene)!==canonical(proposal.base_scene)||canonical(result.previousScene)!==canonical(proposal.candidate))throw new SceneApiError('INVALID_RESPONSE',502,null);
      const unchanged=this.snapshot.localRevision===localRevision&&canonical(this.snapshot.draft)===canonical(scene);
      this.lastAppliedReconstruction=null;
      this.update({revision:result.revision,project:{...this.snapshot.project!,revision:result.revision,scene:result.scene},lease:{...lease,revision:result.revision},...(unchanged?{draft:result.scene,dirty:false}:{dirty:true}),status:'editing',error:null});
      return result;
    }catch(error){if(epoch===this.epoch&&this.isCurrentRequestScope(scope))this.block(error);throw error;}
    finally{this.operationPending=false;}
  }
  async saveScene(scene: Scene): Promise<SaveResult> {
    if (this.operationPending) throw new SceneApiError("CLOUD_OPERATION_BUSY", 409, null);
    const restore=this.lastAppliedReconstruction;
    if(scene.schemaVersion===1&&this.snapshot.project?.scene.schemaVersion===2&&restore?.epoch===this.epoch&&restore.proposal.project_id===this.snapshot.project.id&&canonical(scene)===canonical(restore.proposal.base_scene)&&canonical(this.snapshot.project.scene)===canonical(restore.proposal.candidate))return this.saveReconstructionUndo(scene,restore.proposal);
    this.setDraft(scene);
    const lease = this.writableLease();
    const draft = this.snapshot.draft!;
    const localRevision = this.snapshot.localRevision;
    this.operationPending = true;
    this.update({ status: "saving", error: null });
    try {
      const result = await this.request<SaveResult>(`/projects/${lease.projectId}/scene`, "PUT", { sessionId: lease.sessionId, generation: lease.generation, expectedRevision: this.snapshot.revision, scene: draft });
      const saved = sceneSchema.parse(result.scene);
      const unchanged = this.snapshot.localRevision === localRevision;
      this.update({ revision: result.revision, lease: { ...(this.snapshot.lease ?? lease), revision: result.revision }, project: { ...this.snapshot.project!, scene: saved, revision: result.revision }, ...(unchanged ? { draft: saved, dirty: false } : {}), ...(!this.snapshot.writeBlocked ? { status: "editing", error: null } : {}) });
      return { ...result, scene: saved };
    } catch (error) {
      this.block(error);
      throw error;
    } finally { this.operationPending = false; }
  }
  /** Stop timers and invalidate in-flight responses; never discard the caller's editor draft. */
  dispose(): void {
    ++this.epoch;
    ++this.lifecycle;
    this.stopRenewal();
    void this.supabase?.auth.stopAutoRefresh();
    this.tokens = null;
    this.recoveryTokens = null;
    this.invalidateGeometryWorkbench(true);
    this.update({ user: null, recoveryReady: false, lease: null, writeBlocked: true, status: this.config.configured ? "signed_out" : "unconfigured" });
    this.listeners.clear();
  }
}

export function createBackendSession(config?: BackendConfig): BackendSession {
  return new BackendSession(config);
}
export function useBackendSession(controller: BackendSession): BackendSnapshot {
  return useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
}
