import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { ApiError } from './domain.ts';
import { required, type Env } from './http.ts';
import { createR2Storage } from './r2-storage.ts';
import { publishUserSignal, type SignalEvent } from './realtime-signal.ts';
import type {AgentTrialDiagnostic} from './agent-trial-diagnostic.ts';

// RPC responses are PostgreSQL JSON; route-specific inputs are validated with Zod.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Rpc = (actor: string|null, action: string, data?: Record<string,unknown>) => Promise<any>;
export interface Backend {
  user(token:string):Promise<string>;
  scene: Rpc;
  /** 云存储/完整保存/官方案例能力（public.cloud_storage_rpc）。 */
  cloud: Rpc;
  jobs: Rpc;
  reconstruction: Rpc;
  originalSceneReview?: Rpc;
  agent?: Rpc;
  /** Read-only check that the versioned steering guard is deployed. */
  agentGuardReady?: Rpc;
  /** Optional bounded observations; absent/unavailable storage never blocks a run. */
  agentEvents?: Rpc;
  /** 全链路对话留痕（public.conversation_rpc）；不可用时不影响任何对话。 */
  conversation?: Rpc;
  /** Optional in-memory hook provided only by an explicitly isolated local trial. */
  agentTrialDiagnostic?(actor:string,projectId:string,runId:string,value:AgentTrialDiagnostic):void;
  /** Injectable monotonic clock for deadline-budget tests; defaults to Date.now in production. */
  agentClock?: ()=>number;
  upload(path:string,bytes:Uint8Array,mime:string):Promise<void>;
  sign(path:string,expiresIn?:number):Promise<string>;
  readSourceBytes?(path:string):Promise<Uint8Array>;
  /** 对象大小只读探测（归档直传完整性复核用）。 */
  stat?(path:string):Promise<{size:number}>;
  /** 浏览器直传签名地址（归档大文件不经过 Edge body）。 */
  createUploadUrl?(path:string):Promise<{url:string;token:string}>;
  /** 写完私信/已读后给相关用户推一条 Realtime 信号；失败只记日志，不影响主流程。 */
  notify?(userId:string,event:SignalEvent,payload:Record<string,unknown>):Promise<void>;
}
function rpc(client: SupabaseClient,name:string): Rpc {
  return async(actor,action,data={})=>{
    const { data:result,error }=await client.rpc(name,{p_actor:actor,p_action:action,p_data:data});
    if (error) {
      const code=error.message;
      if (/^[A-Z_]+$/.test(code)) {
        const status=code.endsWith('NOT_FOUND')?404:code==='UNAUTHENTICATED'?401:/FORBIDDEN/.test(code)||code==='PLATFORM_ADMIN_REQUIRED'?403:/BUDGET|BUSY/.test(code)?429:/LEASE|CONFLICT|STALE|CLAIM/.test(code)?409:422;
        // 2026-11-17 P1 可观测：BUSY 只记标识与动作，不记 prompt/请求体；
        // 每人 1 单上线后靠这条日志区分「闸门拒绝」与「供应商限流」。
        if (code==='GENERATION_BUSY') {
          console.warn(JSON.stringify({ event:'generation_busy', actor, action, status, at:new Date().toISOString() }));
        }
        throw new ApiError(code,status);
      }
      throw new ApiError('DATABASE_ERROR',500);
    }
    return result;
  };
}
export function createBackend(env:Env):Backend {
  // 存储后端只有这一个选择点：SCENE_STORAGE_DRIVER=r2 时整体替换五个存储方法，
  // 不设或设成 supabase 时原样返回，改回变量即可回滚。
  const files=createR2Storage(env);
  return files?Object.assign(buildBackend(env),files):buildBackend(env);
}
function buildBackend(env:Env):Backend {
  const url=required(env,'SUPABASE_URL'),serviceKey=required(env,'SUPABASE_SERVICE_ROLE_KEY');
  const client=createClient(url,serviceKey,{ auth:{persistSession:false,autoRefreshToken:false} });
  const scene=rpc(client,'scene_rpc'),studios=rpc(client,'studio_rpc'),agent=rpc(client,'agent_rpc'),guardedAgent=rpc(client,'agent_steering_guard_rpc');
  return {
    async user(token) { const {data,error}=await client.auth.getUser(token); if(error||!data.user) throw new ApiError('UNAUTHENTICATED',401); return data.user.id; },
    scene:(actor,action,data)=>(action.startsWith('studios.')?studios:scene)(actor,action,data),cloud:rpc(client,'cloud_storage_rpc'),jobs:rpc(client,'job_rpc'),reconstruction:rpc(client,'reconstruction_rpc'),originalSceneReview:rpc(client,'original_scene_review_rpc'),agent:(actor,action,data)=>(['note','take_notes','checkpoint','finish'].includes(action)?guardedAgent:agent)(actor,action,data),agentGuardReady:guardedAgent,agentEvents:rpc(client,'agent_run_events_rpc'),conversation:rpc(client,'conversation_rpc'),
    notify:(userId,event,payload)=>publishUserSignal(url,serviceKey,userId,event,payload),
    async upload(path,bytes,mime) {
      const {error}=await client.storage.from('scene-assets').upload(path,new Uint8Array(bytes),{contentType:mime,upsert:false});
      // Retry after a worker crash reuses a content-addressed immutable path.
      if(error && !('statusCode' in error && String(error.statusCode)==='409')) throw new ApiError('STORAGE_UPLOAD_FAILED',502);
    },
    async readSourceBytes(path) { const {data,error}=await client.storage.from('scene-assets').download(path);if(error||!data)throw new ApiError('STORAGE_DOWNLOAD_FAILED',502);return new Uint8Array(await data.arrayBuffer()); },
    async sign(path,expiresIn=300) { const {data,error}=await client.storage.from('scene-assets').createSignedUrl(path,expiresIn); if(error||!data) throw new ApiError('STORAGE_SIGN_FAILED',502); return data.signedUrl; },
    async stat(path) {
      const directory=path.split('/').slice(0,-1).join('/'),name=path.split('/').pop()??'';
      const {data,error}=await client.storage.from('scene-assets').list(directory,{search:name,limit:1});
      if(error) throw new ApiError('STORAGE_STAT_FAILED',502);
      const hit=(data??[]).find(item=>item.name===name);
      if(!hit||!hit.metadata) throw new ApiError('OBJECT_NOT_FOUND',404);
      return {size:hit.metadata.size};
    },
    async createUploadUrl(path) {
      const {data,error}=await client.storage.from('scene-assets').createSignedUploadUrl(path);
      if(error||!data) throw new ApiError('STORAGE_SIGN_FAILED',502);
      return {url:data.signedUrl,token:data.token};
    },
  };
}
