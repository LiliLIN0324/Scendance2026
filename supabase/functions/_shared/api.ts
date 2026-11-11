import { z } from 'zod';
import { agentDispatchRequestSchema } from './agent-contract.ts';
import { agentExecutionMode, executeAgentRun } from './agent-runner.ts';
import { executeActivityTaskRun } from './activity-task-runner.ts';
import { parametricAssetRequestSchema } from './parametric-contract.ts';
import { createParametricAsset } from './parametric.ts';
import { canApplyConfirmedDoorwayChange, canApplyStructuralChange, structuralViolations, dimensionConflicts } from './structural-geometry.ts';
import { reconstructionRequestSchema, sameReviewedGeometry } from './reconstruction-contract.ts';
import {markUnverifiedRequirements} from './reconstruction.ts';
import {reconstructionSafetyChecklist} from './reconstruction-safety.ts';
import {redactPrivateModelReview} from './unverified-claims.ts';
import {projectUnverifiedScene} from './scene-text-projection.ts';
import {prepareOriginalSceneReview} from './original-scene-review.ts';
import { ImageUtils } from '@gltf-transform/core';
import { ApiError, canonical, catalog, leaseSchema, proposalRequestSchema, randomToken, sceneHash, sceneSchema, sceneWarnings, sha256, uuid } from './domain.ts';
import { assetRecord, importPublicModel, normalizedAssetDimensions, recommendations } from './assets.ts';
import { MAX_GLB_BYTES, repairGlb, validateModel } from './models.ts';
import { chatModelName, chatProfile, chatRequest, generateProposal } from './providers.ts';
import { briefExtractRequestSchema, briefConversationRequestSchema, parseBriefConversation, parseModelBrief, BRIEF_CONVERSATION_PROMPT, BRIEF_EXTRACT_PROMPT, BRIEF_PROVIDER_TIMEOUT_MS } from './brief-extract-contract.ts';
import { parseBriefModelJson } from './brief-model-json.ts';
import { assistantChatRequestSchema } from './assistant-chat-contract.ts';
import { answerAssistantChat } from './assistant-chat.ts';
import { readSceneResources } from './scene-resources.ts';
import { prepareGenerationRequest } from './generation-input.ts';
import { generationCapabilities } from './generation-contract.ts';
import { createMaterialVariant, prepareMaterialVariant, readAssetMaterials } from './material-variants.ts';
import { fetchJson, readBounded, required, reserveCost, type Env, type Fetcher } from './http.ts';
import type { Backend } from './backend.ts';

const name=z.string().trim().min(1).max(120);
const displayName=z.string().trim().min(1).max(80);
const messageBody=z.string().trim().min(1).max(2000);
const projectBody=(body:unknown,id:string)=>({...z.record(z.string(),z.unknown()).parse(body),projectId:uuid.parse(id)});
const savedScene=z.strictObject({...leaseSchema.shape,scene:sceneSchema});
// 数据库行是 snake_case，上传口对客户端固定成 camelCase；storage_path 永不出网。
const uploadedAssetView=(row:Record<string,unknown>)=>{
  const {storage_path,...rest}=row;
  return {
    id:rest.id,
    name:rest.name,
    source:rest.source,
    ...(rest.source_id?{sourceId:rest.source_id}:{}),
    ownerId:rest.owner_id,
    byteSize:rest.byte_size,
    sha256:rest.sha256,
    createdAt:rest.created_at,
    metadata:rest.metadata,
  };
};
const MODEL_TEXT_NOTICE={status:'unverified',scope:'design_and_issues',note:'原始模型或无来源文字仅供核对，不代表消防、疏散、无障碍或容量验收。'} as const;
const AGENT_TEXT_NOTICE={status:'unverified',scope:'model_generated_text',note:'模型生成文字未经独立核验，不代表消防、疏散、无障碍或容量验收。'} as const;
const withAgentTextNotice=(value:unknown)=>value&&typeof value==='object'&&!Array.isArray(value)?{...value,modelText:AGENT_TEXT_NOTICE}:value;
function publicMaterials(value:unknown):unknown[]{
  if(!Array.isArray(value))return [];
  const grouped=new Map<string,Record<string,unknown>>();
  for(const item of value){if(!item||typeof item!=='object'||Array.isArray(item))throw new ApiError('INVALID_RESPONSE',502);
    const {notes:_unverifiedNotes,quantity,...spec}=item as Record<string,unknown>;
    if(typeof quantity!=='number'||!Number.isSafeInteger(quantity)||quantity<0)throw new ApiError('INVALID_RESPONSE',502);
    const key=canonical(spec),previous=grouped.get(key);if(previous)previous.quantity=Number(previous.quantity)+quantity;else grouped.set(key,{...spec,quantity});
  }
  return [...grouped.values()];
}
function projectSceneResponse(value:Record<string,unknown>):Record<string,unknown>{
  const projection=projectUnverifiedScene(value.scene as z.infer<typeof sceneSchema>);
  return {...value,...(value.materials!==undefined?{materials:publicMaterials(value.materials)}:{}),...projection};
}
function requireOriginalSceneWritable(value:unknown):void {
  if(projectUnverifiedScene(value as z.infer<typeof sceneSchema>).projection.requiresOriginalSceneForWrite)throw new ApiError('ORIGINAL_SCENE_REVIEW_REQUIRED',409);
}
function checkedOriginalReview(base:unknown,candidate:unknown){
  try{return prepareOriginalSceneReview(base,candidate);}
  catch(error){if(error instanceof Error&&/^ORIGINAL_REVIEW_[A-Z_]+$/.test(error.message))throw new ApiError(error.message,422);throw error;}
}
async function publicOriginalReview(row:Record<string,unknown>):Promise<Record<string,unknown>>{
  const baseHash=await sha256(canonical(row.base_scene)),candidateHash=await sha256(canonical(row.candidate));
  if(row.base_hash!==baseHash||row.candidate_hash!==candidateHash)throw new ApiError('ORIGINAL_REVIEW_CORRUPT',409);
  const prepared=checkedOriginalReview(row.base_scene,row.candidate);
  return {id:row.id,projectId:row.project_id,baseRevision:row.base_revision,baseHash,candidateHash,
    expiresAt:row.expires_at,appliedAt:row.applied_at,appliedRevision:row.applied_revision,
    changes:prepared.changes,modelText:MODEL_TEXT_NOTICE,
    notice:'差异仅供核对；未显示的原始备注和来源记录已保留，不代表安全验收。'};
}
/** Legacy candidates must not be applied after cleaning would alter the stored cloud proposal. */
function publicReconstructionJob(input:Record<string,unknown>):Record<string,unknown>{
  const cleanScene=(value:unknown)=>{const result=sceneSchema.safeParse(value);if(!result.success)return null;const scene=structuredClone(result.data);if(scene.schemaVersion===2){markUnverifiedRequirements(scene);for(const object of scene.objects)object.notes='';scene.dimensions=scene.dimensions.map((dimension,index)=>({...dimension,label:/^(?:总宽|总深|总长|层高|净高|图纸标尺|模型识别尺寸 [1-9][0-9]{0,2}（待核验）)$/.test(dimension.label)?dimension.label:`尺寸记录 ${index+1}（来源待核验）`}));}return scene;};
  const candidate=input.candidate?cleanScene(input.candidate):null;
  const proposal=input.proposal&&typeof input.proposal==='object'&&!Array.isArray(input.proposal)?input.proposal as Record<string,unknown>:null;
  const proposed=proposal?cleanScene(proposal.candidate):null;
  const safeProposal=proposal&&proposed&&canonical(proposal.candidate)===canonical(proposed)&&proposal.explanation==='模型设计说明待人工核验。'?proposal:null;
  const candidateChanged=!!input.candidate&&(!candidate||canonical(input.candidate)!==canonical(candidate));
  const blocked=candidateChanged||!!proposal&&!safeProposal;
  const scene=candidate??proposed;const counts:Record<string,number>={};
  for(const item of scene?.objects??[])counts[item.materialId]=(counts[item.materialId]??0)+1;
  const safeReviewCodes=new Set(['SCALED_STRUCTURE_REVIEW_REQUIRED','SCALE_REQUIRED','HEIGHT_REQUIRED','DIMENSION_REVIEW_REQUIRED','STRUCTURE_REVIEW_REQUIRED','DIMENSION_CONFLICT','STRUCTURE_OUT_OF_BOUNDS','OBJECT_OVERLAP']);
  const issues=Array.isArray(input.issues)?input.issues.filter((issue:unknown)=>!!issue&&typeof issue==='object'&&(issue as {code?:unknown}).code!=='MODEL_RAW_NOTE').map((issue:unknown)=>({code:safeReviewCodes.has(String((issue as {code?:unknown}).code))?String((issue as {code:unknown}).code):'REVIEW_REQUIRED',message:'需要人工核验的事项。',...((issue as {targetId?:unknown}).targetId?{targetId:(issue as {targetId:unknown}).targetId}:{})})):[];
  return {...input,...(input.candidate!==undefined?{candidate:blocked?null:candidate}:{}),issues,...(proposal?{proposal:blocked?null:safeProposal}:{}),...(blocked?{state:'failed',error_code:'MODEL_TEXT_REVIEW_REQUIRED'}:{}),modelText:MODEL_TEXT_NOTICE,projection:{status:'read_only',changed:blocked,requiresOriginalSceneForWrite:blocked},sceneObjectCounts:counts,sceneObjectCountsScope:'candidate_objects_only',safetyChecklist:reconstructionSafetyChecklist(blocked?null:scene)};
}
/** Exact env entries, the production site, and this project's Pages preview hosts. */
function originPermitted(origin:string,allowed:string[]):boolean {
  if(allowed.includes(origin)||origin==='https://scendance.lilicoding.space')return true;
  let url:URL;
  try { url=new URL(origin); } catch { return false; }
  if(url.protocol!=='https:'||url.username||url.password||url.port||url.pathname!=='/'||url.search||url.hash)return false;
  const host=url.hostname.toLowerCase();
  return host==='scendance-scene-planner-ewz.pages.dev'||/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.scendance-scene-planner-ewz\.pages\.dev$/.test(host);
}
export function createApi(backend:Backend,env:Env,fetcher:Fetcher=fetch,waitUntil?:(task:Promise<unknown>)=>void) {
  return async(request:Request):Promise<Response>=>{
    const origin=request.headers.get('origin');
    const allowed=(env('ALLOWED_ORIGINS')??'http://localhost:3000,http://localhost:3210,http://localhost:3211,http://127.0.0.1:3210,http://127.0.0.1:3211').split(',').map(s=>s.trim());
    const headers=new Headers({'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Vary':'Origin','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'});
    const permitted=!!origin&&originPermitted(origin,allowed);
    if(permitted&&origin) headers.set('Access-Control-Allow-Origin',origin);
    const respond=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers});
    try {
      if(origin && !permitted) throw new ApiError('ORIGIN_FORBIDDEN',403);
      if(request.method==='OPTIONS') {
        headers.set('Access-Control-Allow-Methods','GET,POST,PUT,PATCH,DELETE,OPTIONS');
        headers.set('Access-Control-Allow-Headers','authorization,apikey,content-type,x-client-info');
        return new Response(null,{status:204,headers});
      }
      const url=new URL(request.url);
      const path=url.pathname.replace(/^\/functions\/v1\/scene-api/,'').replace(/^\/scene-api/,'').replace(/\/$/,'')||'/';
      const method=request.method;
      const json=async()=>{
        if(!request.headers.get('content-type')?.startsWith('application/json')) throw new ApiError('JSON_REQUIRED',415);
        try {return JSON.parse(new TextDecoder().decode(await readBounded(request,256_000))) as unknown;}
        catch(e) {if(e instanceof ApiError) throw e; throw new ApiError('INVALID_JSON');}
      };
      if(path==='/health' && method==='GET') return respond({ok:true,schemaVersion:1,supportedSchemaVersions:[1,2]});
      if(path==='/share/read' && method==='POST') {
        const input=z.strictObject({token:z.string().regex(/^[a-f0-9]{64}$/)}).parse(await json());
        const tokenHash=await sha256(input.token);
        const shared=await backend.scene(null,'share.read',{tokenHash});
        shared.assets=await Promise.all(shared.assets.map(async(asset:{storagePath:string;[key:string]:unknown})=>{
          const {storagePath,...metadata}=asset; return {...metadata,url:await backend.sign(storagePath),expiresIn:300};
        }));
        // Recheck after signing, so revocation during a slow storage request also blocks the response.
        await backend.scene(null,'share.read',{tokenHash});
        return respond(projectSceneResponse(shared));
      }
      const token=request.headers.get('authorization')?.match(/^Bearer (\S+)$/i)?.[1];
      if(!token) throw new ApiError('UNAUTHENTICATED',401);
      const actor=await backend.user(token);
      if(path==='/assistant/chat' && method==='POST') {
        // The existing guard is a draft: preserve its fail-closed configuration
        // rather than creating another unguarded route while it is enforced.
        const guardMode=env('BRIEF_REQUEST_GUARD');
        if(guardMode!==undefined && guardMode!=='' && guardMode!=='off')throw new ApiError('BRIEF_GUARD_NOT_READY',503);
        if(env('ASSISTANT_CHAT_ENABLED')!=='1')return respond({status:'disabled',answer:null});
        const input=assistantChatRequestSchema.safeParse(await json());
        if(!input.success)return respond({status:'invalid',answer:null});
        return respond(await answerAssistantChat({...input.data,enabled:true,env,fetcher,signal:request.signal}));
      }
      if(path==='/brief/extract' && method==='POST') {
        // Guarded dispatch is deliberately unavailable until the real provider
        // identity/credential binding and durable client request IDs are wired.
        // Any configured guard mode fails closed; it must never fall back to the
        // legacy billable path for old or new clients.
        const guardMode=env('BRIEF_REQUEST_GUARD');
        if(guardMode!==undefined && guardMode!=='' && guardMode!=='off')throw new ApiError('BRIEF_GUARD_NOT_READY',503);
        const raw=await json();
        const isConversation=!!raw && typeof raw==='object' && !Array.isArray(raw) && (raw as Record<string,unknown>).responseMode==='conversation_v1';
        const input=isConversation?briefConversationRequestSchema.parse(raw):briefExtractRequestSchema.parse(raw);
        const conversation='responseMode' in input;
        const emptyConversation={reply:null,unhandled:[],factEvidence:[]} as const;
        if(conversation && env('BRIEF_CONVERSATION_ENABLED')!=='1')return respond({enabled:false,extraction:null,...emptyConversation});
        // 2026-11-11 用户拍板（三十三轮修订）：可插拔多云端大模型 + 兜底链——
        // 尝试顺序：百炼(启用时) → 自定义兼容端点(AGENT_CHAT_*) → Tokendance 网关 → DeepSeek 官方。
        // 前一级失败（欠费/限流/超时/输出坏/证据不匹配）自动切下一级；客户端主动取消不重试；
        // 全部失败如实报「首选供应商的失败原因」，绝不静默无模型。
        const briefViews: Array<Record<string,string>> = [];
        if(env('BAILIAN_PRODUCT_ENABLED')==='1')briefViews.push({BAILIAN_PRODUCT_ENABLED:'1'});
        briefViews.push({BAILIAN_PRODUCT_ENABLED:'0'});
        // 自定义端点也失败（如弱模型证据不匹配）时，显式落到 Tokendance 网关：
        // chatRequest 只在 AGENT_CHAT_* 全空时才走网关，这里用视图级覆盖强制腾开。
        if(env('TOKENDANCE_API_KEY'))briefViews.push({
          BAILIAN_PRODUCT_ENABLED:'0',AGENT_CHAT_BASE_URL:'',AGENT_CHAT_KEY:'',AGENT_CHAT_MODEL:'',
        });
        // 最后一级：DeepSeek 官方端点（同时清空网关 key 才会走到）。
        if(env('DEEPSEEK_API_KEY'))briefViews.push({
          BAILIAN_PRODUCT_ENABLED:'0',AGENT_CHAT_BASE_URL:'',AGENT_CHAT_KEY:'',AGENT_CHAT_MODEL:'',TOKENDANCE_API_KEY:'',
        });
        const briefReasons:string[]=[];
        let briefReply:Response|null=null;
        const briefFailure=(error:unknown):string=>{
          if(error instanceof ApiError){
            const details=error.details;
            const status=details&&typeof details==='object'&&'status' in details?details.status:undefined;
            if(error.code==='PROVIDER_HTTP_ERROR'&&typeof status==='number'&&Number.isInteger(status)&&status>=100&&status<=599)return `PROVIDER_HTTP_ERROR:${status}`;
            if(['MODEL_PROVIDER_INCOMPLETE','MODEL_PROVIDER_URL_INVALID','MODEL_PROVIDER_PROFILE_INVALID','MODEL_PROVIDER_UNSUPPORTED_WORKFLOW','MODEL_INCOMPLETE_OUTPUT','MODEL_INVALID_RESPONSE','SERVICE_NOT_CONFIGURED','PROVIDER_INVALID_JSON','FILE_TOO_LARGE','EMPTY_BODY'].includes(error.code))return error.code;
            return 'MODEL_REQUEST_FAILED';
          }
          if(error instanceof SyntaxError)return 'MODEL_INVALID_JSON';
          if(error instanceof z.ZodError)return 'MODEL_INVALID_RESPONSE';
          if(error instanceof Error&&error.message==='MODEL_EVIDENCE_MISMATCH')return 'MODEL_EVIDENCE_MISMATCH';
          if(error instanceof Error&&error.message==='MODEL_INVALID_RESPONSE')return 'MODEL_INVALID_RESPONSE';
          if(error instanceof Error&&['TimeoutError','AbortError'].includes(error.name))return 'MODEL_TIMEOUT';
          return 'MODEL_REQUEST_FAILED';
        };
        for(const [viewIndex,view] of briefViews.entries()){
          const viewEnv=(key:Parameters<typeof env>[0]):string|undefined=>{
            const override=(view as Record<string,unknown>)[key];
            return override===undefined?env(key):override as string;
          };
          try{
            const userContent='history' in input?JSON.stringify({message:input.message,history:input.history}):input.message;
            // The existing MiniMax profile forwards token fields unchanged. Keep
            // legacy payloads byte-compatible while bounding the new mode.
            const tokenLimit=conversation&&chatProfile(viewEnv,'brief')==='minimax'?{max_completion_tokens:2048}:{max_tokens:2048};
            // 把该次尝试实际运行的模型名注入系统提示，模型被问「你是什么模型」时能自报准确型号。
            const selfModel=chatModelName(viewEnv,{purpose:'brief'});
            const systemPrompt=(conversation?BRIEF_CONVERSATION_PROMPT:BRIEF_EXTRACT_PROMPT)+`
你当前实际运行的模型是「${selfModel}」。用户问你是什么模型、什么版本、什么供应商时，必须逐字报告这个完整模型 id（例如「${selfModel}」），禁止笼统回答「我是 Qwen」「我是通义千问」「我是 DeepSeek」或其他家族名；一句话即可，不要展开。`;
            const { url, init } = chatRequest(viewEnv, { messages: [
              { role:'system', content: systemPrompt },
              { role:'user', content: userContent },
            ], temperature: 0, ...tokenLimit, response_format: { type: 'json_object' } }, { purpose: 'brief' });
            // 首选供应商可能是推理模型，给 110s；兜底级别统一压到 45s，
            // 避免某一级挂死时用户要连等多个 110s 才看到失败。
            const providerTimeout=viewIndex===0?BRIEF_PROVIDER_TIMEOUT_MS:45_000;
            const providerResponse=await fetchJson(url,{...init,signal:request.signal},fetcher,100_000,providerTimeout);
            if(conversation){
              const checked=z.object({base_resp:z.object({status_code:z.number().int()}).passthrough().optional(),choices:z.array(z.object({message:z.object({tool_calls:z.unknown().optional(),function_call:z.unknown().optional()})})).length(1)}).parse(providerResponse);
              // qwen3.8-max compatible responses set these to null when no tool ran.
              // Null is not a tool call; an array or object still is.
              const invoked=(value:unknown)=>value!==undefined&&value!==null;
              if((checked.base_resp&&checked.base_resp.status_code!==0)||invoked(checked.choices[0]!.message.tool_calls)||invoked(checked.choices[0]!.message.function_call))throw new ApiError('MODEL_INVALID_RESPONSE',502);
            }
            const reply=z.object({choices:z.array(z.object({finish_reason:z.string().nullish(),message:z.object({content:z.string().nullish()})})).min(1)}).parse(providerResponse);
            const choice = reply.choices[0];
            if (choice.finish_reason !== 'stop') throw new ApiError('MODEL_INCOMPLETE_OUTPUT', 502);
            const content = choice.message.content;
            if (!content || /<\/?think>/i.test(content)) throw new ApiError('MODEL_INVALID_RESPONSE', 502);
            const model=parseBriefModelJson(content);
            briefReply=respond({enabled:true,...(conversation?parseBriefConversation(model,input.message):{extraction:parseModelBrief(model,input.message)})});
            break;
          }catch(error){
            briefReasons.push(briefFailure(error));
            // 客户端主动取消：换供应商没有意义，立即返回。
            if(request.signal&&request.signal.aborted)break;
            continue;
          }
        }
        if(briefReply)return briefReply;
        return respond({enabled:true,extraction:null,...(conversation?emptyConversation:{}),reason:briefReasons[0]??'MODEL_REQUEST_FAILED'});
      }
      if(['/assets/import','/assets/floorplan','/assets/glb','/assets/sources','/catalog/recommendations'].includes(path) && !(await backend.scene(actor,'studios')).length) throw new ApiError('FORBIDDEN',403);
      if(path==='/studios' && method==='GET') return respond(await backend.scene(actor,'studios'));
      if(path==='/studios' && method==='POST') {
        const input=z.strictObject({requestId:uuid,name,displayName}).parse(await json());
        return respond(await backend.scene(actor,'studios.create',input),201);
      }
      const studio=path.match(/^\/studios\/([^/]+)(\/projects)?$/);
      if(studio) {
        const studioId=uuid.parse(studio[1]);
        if(studio[2] && method==='GET') return respond(await backend.scene(actor,'studios.projects.list',{studioId}));
        if(!studio[2] && method==='PATCH') {
          const input=z.strictObject({name}).parse(await json());
          return respond(await backend.scene(actor,'studios.rename',{...input,studioId}));
        }
        if(!studio[2] && method==='DELETE') return respond(await backend.scene(actor,'studios.delete',{studioId}));
      }
      const members=path.match(/^\/studios\/([^/]+)\/members(?:\/([^/]+))?$/);
      if(members) {
        const studioId=uuid.parse(members[1]);
        if(!members[2] && method==='GET') return respond(await backend.scene(actor,'studios.members.list',{studioId}));
        // 按已注册邮箱加人：POST /studios/:id/members { email, displayName? }
        if(!members[2] && method==='POST') {
          const input=z.strictObject({
            email:z.string().trim().email().max(254),
            displayName:displayName.optional(),
          }).parse(await json());
          const email=input.email.toLowerCase();
          const label=(input.displayName?.trim() || email.split('@')[0] || '成员').slice(0,80);
          return respond(await backend.scene(actor,'studios.members.put',{studioId,email,displayName:label}),201);
        }
        if(members[2]) {
          const userId=uuid.parse(members[2]);
          if(method==='PUT') {
            const input=z.strictObject({displayName}).parse(await json());
            return respond(await backend.scene(actor,'studios.members.put',{...input,studioId,userId}));
          }
          if(method==='DELETE') return respond(await backend.scene(actor,'studios.members.remove',{studioId,userId}));
        }
      }
      const messages=path.match(/^\/studios\/([^/]+)\/messages(\/(unread|read))?$/);
      if(messages) {
        const studioId=uuid.parse(messages[1]);
        if(messages[2]==='/unread' && method==='GET') return respond(await backend.scene(actor,'studios.messages.unread',{studioId}));
        if(messages[2]==='/read' && method==='POST') {
          const input=z.strictObject({peerId:uuid}).parse(await json());
          return respond(await backend.scene(actor,'studios.messages.read',{...input,studioId}));
        }
        if(!messages[2] && method==='GET') {
          const peerId=uuid.parse(url.searchParams.get('peerId'));
          return respond(await backend.scene(actor,'studios.messages.list',{peerId,studioId}));
        }
        if(!messages[2] && method==='POST') {
          const input=z.strictObject({requestId:uuid,peerId:uuid,body:messageBody}).parse(await json());
          return respond(await backend.scene(actor,'studios.messages.send',{...input,studioId}),201);
        }
      }
      if(path==='/catalog' && method==='GET') return respond(catalog);
      if(path==='/projects' && method==='GET') return respond(await backend.scene(actor,'projects.list'));
      if(path==='/projects' && method==='POST') {
        const input=z.strictObject({studioId:uuid,name,scene:sceneSchema}).parse(await json());
        requireOriginalSceneWritable(input.scene);
        if(dimensionConflicts(input.scene).length)throw new ApiError('DIMENSION_CONFLICT',422,dimensionConflicts(input.scene));
        if(input.scene.schemaVersion===2&&structuralViolations(input.scene).length)throw new ApiError('STRUCTURAL_COLLISION',422,structuralViolations(input.scene));
        return respond(projectSceneResponse(await backend.scene(actor,'projects.create',input)),201);
      }
      const project=path.match(/^\/projects\/([^/]+)(.*)$/);
      if(project) {
        const projectId=uuid.parse(project[1]), tail=project[2];
        if(tail==='/agent-runs'&&method==='POST') {
          if(!backend.agent)throw new ApiError('SERVICE_NOT_CONFIGURED',503);
          const input=agentDispatchRequestSchema.parse(await json()),activity='kind' in input;
          // Reject before storing a run or contacting a provider. An older
          // worker or legacy workflow must not silently ignore planning marks.
          if(!activity&&input.context.annotationObservation!==undefined&&
            (env('AGENT_ANNOTATION_OBSERVATION_ENABLED')!=='1'||env('DEEPSEEK_AGENT_MODE')==='legacy'))throw new ApiError('AGENT_ANNOTATION_UNAVAILABLE',503);
          if(!activity&&input.selectedIds.some(id=>!input.scene.objects.some(object=>object.id===id)))throw new ApiError('INVALID_SELECTION',422);
          if(!activity)requireOriginalSceneWritable((await backend.scene(actor,'projects.get',{projectId})).scene);
          if(!activity&&input.context.annotationObservation!==undefined){
            let annotationGuard:unknown;
            try{annotationGuard=await backend.scene(actor,'annotations.readiness',{projectId});}
            catch(error){
              if(error instanceof ApiError&&['PROJECT_NOT_FOUND','FORBIDDEN','UNAUTHENTICATED'].includes(error.code))throw error;
              throw new ApiError('AGENT_ANNOTATION_GUARD_UNAVAILABLE',503);
            }
            if(!z.strictObject({capability:z.literal('annotation_preview_guard'),version:z.literal(1)}).safeParse(annotationGuard).success)
              throw new ApiError('AGENT_ANNOTATION_GUARD_UNAVAILABLE',503);
          }
          const miniMaxPreview=!activity&&chatProfile(env)==='minimax'&&env('MINIMAX_AGENT_TOOLS_ENABLED')==='1'&&env('DEEPSEEK_AGENT_MODE')!=='legacy';
          // Check the configured provider itself before reserving a run. Custom
          // providers and the official fallback do not require a gateway key.
          chatRequest(env,{messages:[]},miniMaxPreview?{purpose:'agent'}:undefined);
          // A run without the atomic steering guard cannot safely publish a
          // candidate. Probe its version before creating or billing anything.
          if(!backend.agentGuardReady)throw new ApiError('AGENT_STEERING_GUARD_UNAVAILABLE',503);
          let guard:unknown;
          try { guard=await backend.agentGuardReady(actor,'readiness',{projectId}); }
          catch(error){
            if(error instanceof ApiError && (error.code==='PROJECT_NOT_FOUND'||error.code==='FORBIDDEN'||error.code==='UNAUTHENTICATED'))throw error;
            throw new ApiError('AGENT_STEERING_GUARD_UNAVAILABLE',503);
          }
          if(!z.strictObject({capability:z.literal('agent_steering_guard'),version:z.literal(1)}).safeParse(guard).success)
            throw new ApiError('AGENT_STEERING_GUARD_UNAVAILABLE',503);
          const stored=await backend.agent(actor,'create',{projectId,input,fingerprint:await sha256(canonical(input)),
            baseHash:activity?await sha256(canonical(input.activityContext)):await sceneHash(input.scene),
            executionMode:activity||miniMaxPreview||env('DEEPSEEK_AGENT_MODE')==='legacy'?'preview':agentExecutionMode(input)});
          if(!stored.reused){
            const task=(activity?executeActivityTaskRun(backend,actor,projectId,stored.id,env,fetcher):executeAgentRun(backend,actor,projectId,stored.id,env,fetcher)).catch(()=>{});
            if(waitUntil)waitUntil(task);else await task;
          }
          return respond(withAgentTextNotice(waitUntil?stored:await backend.agent(actor,'get',{projectId,id:stored.id})),stored.reused?200:202);
        }
        const agentEvents=tail.match(/^\/agent-runs\/([^/]+)\/events$/);
        if(agentEvents&&method==='GET') {
          if(!backend.agentEvents)throw new ApiError('SERVICE_NOT_CONFIGURED',503);
          const all=url.searchParams.getAll('after');
          if(all.length>1||! /^(?:0|[1-9]\d{0,2})$/.test(all[0]??'0')||Number(all[0]??'0')>128)throw new ApiError('INVALID_AGENT_EVENT',422);
          return respond(await backend.agentEvents(actor,'list',{projectId,id:uuid.parse(agentEvents[1]),after:Number(all[0]??'0')}));
        }
        // 运行中改道：用户在这趟跑着的时候追加一句要求，工作线程在下一轮模型调用前取走。
        // 任务已结束时这里回 AGENT_RUN_STOPPED（409）——备注没有执行机会，不能假装收到。
        const agentNote=tail.match(/^\/agent-runs\/([^/]+)\/notes$/);
        if(agentNote&&method==='POST'&&backend.agent) {
          const input=z.strictObject({note:z.string().trim().min(1).max(500)}).parse(await json());
          return respond(withAgentTextNotice(await backend.agent(actor,'note',{projectId,id:uuid.parse(agentNote[1]),note:input.note})),202);
        }
        const agentRun=tail.match(/^\/agent-runs\/(by-request\/)?([^/]+)(\/cancel)?$/);
        if(agentRun&&backend.agent) {
          if(agentRun[1]&&method==='GET'&&!agentRun[3])return respond(withAgentTextNotice(await backend.agent(actor,'by_request',{projectId,requestId:uuid.parse(agentRun[2])})));
          if(!agentRun[1]&&((method==='GET'&&!agentRun[3])||(method==='POST'&&agentRun[3])))return respond(withAgentTextNotice(await backend.agent(actor,agentRun[3]?'cancel':'get',{projectId,id:uuid.parse(agentRun[2])})));
        }
        if(tail==='/material-variants' && method==='POST') {
          const {reused,...proposal}=await prepareMaterialVariant(backend,actor,projectId,await json());
          return respond(proposal,reused?200:201);
        }
        if(!tail && method==='GET') return respond(projectSceneResponse(await backend.scene(actor,'projects.get',{projectId})));
        if(tail==='/original-scene' && method==='GET') {
          const project=await backend.scene(actor,'projects.get',{projectId});sceneSchema.parse(project.scene);
          return respond({projectId,scene:project.scene,revision:project.revision,originalSceneHash:await sha256(canonical(project.scene)),modelText:AGENT_TEXT_NOTICE,notice:'授权原始记录仅供核对，可能含敏感内容；当前不支持将只读投影写回。'});
        }
        if(tail==='/original-scene/lease'&&method==='POST'){
          if(!backend.originalSceneReview)throw new ApiError('SERVICE_NOT_CONFIGURED',503);
          const input=z.strictObject({sessionId:uuid,originalRevision:z.number().int().nonnegative(),originalSceneHash:z.string().regex(/^[a-f0-9]{64}$/)}).parse(await json());
          const project=await backend.scene(actor,'projects.get',{projectId});
          if(project.revision!==input.originalRevision||await sha256(canonical(project.scene))!==input.originalSceneHash)throw new ApiError('ORIGINAL_SCENE_CHANGED',409);
          const lease=await backend.scene(actor,'lease.acquire',{projectId,sessionId:input.sessionId});
          if(lease.revision!==input.originalRevision||await sha256(canonical(lease.scene))!==input.originalSceneHash){await backend.scene(actor,'lease.release',{projectId,sessionId:lease.sessionId,generation:lease.generation}).catch(()=>{});throw new ApiError('ORIGINAL_SCENE_CHANGED',409);}
          return respond({sessionId:lease.sessionId,generation:lease.generation,revision:lease.revision,expiresAt:lease.expiresAt,originalSceneHash:input.originalSceneHash,
            notice:'这是原始场景核对用编辑权；普通投影不能直接写回。'});
        }
        if(tail==='/original-scene/reviews'&&method==='POST'){
          if(!backend.originalSceneReview)throw new ApiError('SERVICE_NOT_CONFIGURED',503);
          const input=z.strictObject({...leaseSchema.shape,reviewId:uuid,originalSceneHash:z.string().regex(/^[a-f0-9]{64}$/),candidate:z.unknown()}).parse(await json());
          const project=await backend.scene(actor,'projects.get',{projectId});const hash=await sha256(canonical(project.scene));
          if(hash!==input.originalSceneHash)throw new ApiError('ORIGINAL_SCENE_CHANGED',409);
          const prepared=checkedOriginalReview(project.scene,input.candidate);if(!prepared.changes.length)throw new ApiError('ORIGINAL_REVIEW_NO_CHANGES',422);
          const candidateHash=await sha256(canonical(prepared.candidate));
          const row=await backend.originalSceneReview(actor,'create',{projectId,id:input.reviewId,sessionId:input.sessionId,generation:input.generation,expectedRevision:input.expectedRevision,baseScene:project.scene,baseHash:hash,candidate:prepared.candidate,candidateHash});
          return respond(await publicOriginalReview(row),row.reused?200:201);
        }
        const originalReview=tail.match(/^\/original-scene\/reviews\/([^/]+)(\/apply)?$/);
        if(originalReview&&backend.originalSceneReview){
          const id=uuid.parse(originalReview[1]);
          if(method==='GET'&&!originalReview[2])return respond(await publicOriginalReview(await backend.originalSceneReview(actor,'get',{projectId,id})));
          if(method==='POST'&&originalReview[2]){
            const input=z.strictObject({...leaseSchema.shape,originalSceneHash:z.string().regex(/^[a-f0-9]{64}$/),candidateHash:z.string().regex(/^[a-f0-9]{64}$/),acknowledged:z.literal(true)}).parse(await json());
            const row=await backend.originalSceneReview(actor,'get',{projectId,id});const review=await publicOriginalReview(row);
            if(review.baseHash!==input.originalSceneHash||review.candidateHash!==input.candidateHash)throw new ApiError('ORIGINAL_REVIEW_STALE',409);
            const result=await backend.originalSceneReview(actor,'apply',{projectId,id,sessionId:input.sessionId,generation:input.generation,expectedRevision:input.expectedRevision,baseHash:input.originalSceneHash,candidateHash:input.candidateHash});
            return respond({...projectSceneResponse(result),notice:'已按核对的差异保存；模型文字仍未经安全验收。'});
          }
        }
        if(!tail && method==='DELETE') {
          const input=z.strictObject({expectedRevision:z.number().int().nonnegative()}).parse(await json());
          return respond(await backend.scene(actor,'projects.delete',{...input,projectId}));
        }
        if(!tail && method==='PATCH') {
          const input=z.strictObject({...leaseSchema.shape,name}).parse(await json());
          return respond(projectSceneResponse(await backend.scene(actor,'projects.rename',{...input,projectId})));
        }
        const source=tail.match(/^\/sources\/([^/]+)$/);
        if(source&&method==='DELETE')return respond(await backend.scene(actor,'sources.unlink',{projectId,assetId:uuid.parse(source[1])}));
        if(tail==='/sources'&&method==='GET')return respond(await backend.scene(actor,'sources.list',{projectId}));
        if(tail==='/reconstructions'&&method==='POST'){
          const input=reconstructionRequestSchema.parse(await json());
          if(input.sources.some((s,i)=>input.sources.findIndex(x=>x.assetId===s.assetId)!==i))throw new ApiError('DUPLICATE_SOURCE',422);
          if(input.selectedIds.some(id=>!input.scene.objects.some(o=>o.id===id)))throw new ApiError('INVALID_SELECTION',422);
          required(env,'DEEPSEEK_API_KEY');
          const reserveCents=reserveCost(env,'RECONSTRUCTION_MAX_REQUEST_CENTS');
          if(reserveCents<200)throw new ApiError('BILLING_NOT_CONFIGURED',503,{setting:'RECONSTRUCTION_MAX_REQUEST_CENTS',minimum:200});
          const currentProject=await backend.scene(actor,'lease.check',{...input,projectId});requireOriginalSceneWritable(currentProject.scene);
          if(input.reviewedJobId){
            await backend.reconstruction(actor,'review.check',{input:{...input,projectId},baseHash:await sceneHash(input.scene)});
            const prior=await backend.reconstruction(actor,'get',{projectId,id:input.reviewedJobId});
            if(!prior?.candidate||!input.reviewedScene||!sameReviewedGeometry(prior.candidate,input.reviewedScene))throw new ApiError('RECONSTRUCTION_REVIEW_CHANGED',422);
          }else if(input.reviewedScene){
            const project=await backend.scene(actor,'projects.get',{projectId});
            if(input.scene.schemaVersion!==2||canonical(input.scene)!==canonical(input.reviewedScene)||canonical(project.scene)!==canonical(input.scene))throw new ApiError('RECONSTRUCTION_REVIEW_REQUIRED',422);
          }
          const stored=await backend.reconstruction(actor,'create',{input:{...input,projectId},fingerprint:await sha256(canonical({...input,projectId})),baseHash:await sceneHash(input.scene),reserveCents});
          return respond(publicReconstructionJob(stored),stored.reused?200:202);
        }
        const rawReconstruction=tail.match(/^\/reconstructions\/([^/]+)\/raw-model-notes$/);
        if(rawReconstruction&&method==='GET'){
          const job=await backend.reconstruction(actor,'get',{projectId,id:uuid.parse(rawReconstruction[1])});
          const notes=Array.isArray(job.issues)?job.issues.filter((item:{code?:unknown;raw?:unknown})=>item?.code==='MODEL_RAW_NOTE'&&item.raw&&typeof item.raw==='object').map((item:{raw?:unknown})=>item.raw):[];
          // Older jobs predate structured notes; expose their existing candidate only through
          // this explicitly requested, project-authorized and redacted review path.
          if(!notes.length&&job.candidate){const legacy=sceneSchema.safeParse(job.candidate);if(legacy.success&&legacy.data.schemaVersion===2)notes.push({stage:'legacy_record',design:legacy.data.design??null,issues:job.issues??[],objectNotes:legacy.data.objects.filter(object=>object.notes).map(object=>({id:object.id,notes:object.notes})),dimensionLabels:legacy.data.dimensions.map(dimension=>({id:dimension.id,label:dimension.label}))});}
          return respond({modelText:MODEL_TEXT_NOTICE,state:job.state,notes:redactPrivateModelReview(notes),privacy:'常见私密链接与凭据会被隐藏；原文仍可能含敏感内容，转发前请检查。原任务记录不变。'});
        }
        const reconstruction=tail.match(/^\/reconstructions\/([^/]+)$/);
        if(reconstruction&&method==='GET')return respond(publicReconstructionJob(await backend.reconstruction(actor,'get',{projectId,id:uuid.parse(reconstruction[1])})));
        if(tail==='/materials' && method==='GET') return respond(publicMaterials((await backend.scene(actor,'projects.get',{projectId})).materials));
        if(tail==='/lease/acquire' && method==='POST') {
          const input=z.strictObject({sessionId:uuid}).parse(await json());
          requireOriginalSceneWritable((await backend.scene(actor,'projects.get',{projectId})).scene);
          const result=await backend.scene(actor,'lease.acquire',{...input,projectId});
          try{requireOriginalSceneWritable(result.scene);}catch(error){await backend.scene(actor,'lease.release',{projectId,sessionId:result.sessionId,generation:result.generation}).catch(()=>{});throw error;}
          return respond(result);
        }
        if(['/lease/renew','/lease/release'].includes(tail) && method==='POST') {
          const input=leaseSchema.omit({expectedRevision:true}).parse(await json());
          return respond(await backend.scene(actor,tail==='/lease/renew'?'lease.renew':'lease.release',{...input,projectId}));
        }
        if(tail==='/scene' && method==='PUT') {
          const input=savedScene.parse(await json());
          requireOriginalSceneWritable(input.scene);
          if(dimensionConflicts(input.scene).length)throw new ApiError('DIMENSION_CONFLICT',422,dimensionConflicts(input.scene));
          const previous=await backend.scene(actor,'lease.check',{...input,projectId});
          requireOriginalSceneWritable(previous.scene);
          if(!canApplyStructuralChange(sceneSchema.parse(previous.scene),input.scene))throw new ApiError('STRUCTURAL_COLLISION',422,structuralViolations(input.scene));
          return respond({...projectSceneResponse(await backend.scene(actor,'scene.save',{...input,projectId})),warnings:sceneWarnings(input.scene)});
        }
        if(tail==='/proposals' && method==='POST') {
          const input=proposalRequestSchema.parse(projectBody(await json(),projectId));
          if(input.selectedIds.some(id=>!input.scene.objects.some(o=>o.id===id))) throw new ApiError('INVALID_SELECTION',422);
          const previous=await backend.scene(actor,'lease.check',input);requireOriginalSceneWritable(previous.scene);
          chatRequest(env,{messages:[]});
          const reserveCents=reserveCost(env,'AI_MAX_REQUEST_CENTS');
          if(reserveCents<40) throw new ApiError('BILLING_NOT_CONFIGURED',503);
          const reservation=await backend.jobs(actor,'reserve',{requestId:input.requestId,fingerprint:await sha256(canonical(input)),reserveCents});
          if(reservation.reused) {
            if(reservation.state==='complete') return respond(withAgentTextNotice(reservation.result));
            throw new ApiError(reservation.state==='reserved'?'AI_IN_PROGRESS':'AI_PREVIOUS_REQUEST_FAILED',409,{requestId:input.requestId});
          }
          try {
            const resources=await readSceneResources(backend,actor,input.scene);
            const proposal=await generateProposal(input,env,attempt=>backend.jobs(actor,'text.reserve_call',{id:reservation.id,attempt}),fetcher,resources);
            const stored=await backend.scene(actor,'proposals.store',{
              ...input,id:reservation.id,baseHash:await sceneHash(input.scene),candidate:proposal.scene,explanation:proposal.explanation,warnings:proposal.warnings,
            });
            const result={...stored,modelSuggestions:proposal.modelSuggestions,materialSuggestions:proposal.materialSuggestions};
            await backend.jobs(actor,'requests.finish',{id:reservation.id,state:'complete',result,usage:proposal.usage});
            return respond(withAgentTextNotice(result),201);
          } catch(error) {
            await backend.jobs(actor,'requests.finish',{id:reservation.id,state:'failed',result:null,usage:error instanceof ApiError?error.details??{}:{}}).catch(()=>{});
            throw error;
          }
        }
        if(tail==='/proposals/apply' && method==='POST') {
          const input=z.strictObject({...leaseSchema.shape,proposalId:uuid,localRevision:z.number().int().nonnegative(),currentScene:sceneSchema}).parse(await json());
          const proposal=await backend.scene(actor,'proposals.get',{projectId,proposalId:input.proposalId});
          // Read the stored server-produced proposal, never a client flag.
          if(Array.isArray(proposal.warnings)&&proposal.warnings.some((warning:unknown)=>!!warning&&typeof warning==='object'&&(warning as {code?:unknown}).code==='ANNOTATION_PREVIEW_ONLY'))throw new ApiError('ANNOTATION_PREVIEW_ONLY',409);
          requireOriginalSceneWritable((await backend.scene(actor,'lease.check',{...input,scene:input.currentScene,projectId})).scene);
          let reconstructionJob:Record<string,unknown>|null=null;
          try{reconstructionJob=await backend.reconstruction(actor,'get',{projectId,id:input.proposalId});}
          catch(error){if(!(error instanceof ApiError&&error.code==='RECONSTRUCTION_NOT_FOUND'))throw error;}
          if(reconstructionJob){
            const safe=publicReconstructionJob(reconstructionJob);
            if(safe.state!=='ready'||!safe.proposal||typeof safe.proposal!=='object'||canonical((safe.proposal as {candidate?:unknown}).candidate)!==canonical(proposal.candidate))throw new ApiError('MODEL_TEXT_REVIEW_REQUIRED',422);
          }
          requireOriginalSceneWritable(proposal.candidate);
          if(dimensionConflicts(proposal.candidate).length)throw new ApiError('DIMENSION_CONFLICT',422,dimensionConflicts(proposal.candidate));
          if(!canApplyStructuralChange(input.currentScene,sceneSchema.parse(proposal.candidate)))throw new ApiError('STRUCTURAL_COLLISION',422,structuralViolations(proposal.candidate));
          if(!canApplyConfirmedDoorwayChange(input.currentScene,sceneSchema.parse(proposal.candidate)))throw new ApiError('DOORWAY_BLOCKED',422);
          const applied=await backend.scene(actor,'proposals.apply',{...input,projectId,baseHash:await sceneHash(input.currentScene)});
          const previous=projectUnverifiedScene(sceneSchema.parse(applied.previousScene));return respond({...projectSceneResponse(applied),previousScene:previous.scene,previousProjection:previous.projection});
        }
        if(tail==='/history/restore'&&method==='POST'){
          const input=z.strictObject({...leaseSchema.shape,proposalId:uuid,currentScene:sceneSchema}).parse(await json());
          const previous=await backend.scene(actor,'proposals.get',{projectId,proposalId:input.proposalId});
          if(await sceneHash(input.currentScene)!==await sceneHash(previous.candidate))throw new ApiError('STALE_HISTORY_RESTORE',409);
          // The database restore compares the actual current scene to this exact
          // candidate. It too may contain hidden original text that the old
          // client did not review and must not be discarded by restoring base.
          requireOriginalSceneWritable(previous.candidate);
          requireOriginalSceneWritable(previous.base_scene);
          const restored=await backend.scene(actor,'history.restore',{...input,projectId});
          const projected=projectSceneResponse(restored);const previousScene=projectUnverifiedScene(restored.previousScene as z.infer<typeof sceneSchema>);
          return respond({...projected,previousScene:previousScene.scene,previousProjection:previousScene.projection,warnings:sceneWarnings(sceneSchema.parse(restored.scene))});
        }
        if(tail==='/publish' && method==='POST') {
          const input=z.strictObject({expectedRevision:z.number().int().nonnegative()}).parse(await json());
          const base=required(env,'PUBLIC_APP_URL');
          const shareToken=randomToken();
          const result=await backend.scene(actor,'publish',{...input,projectId,tokenHash:await sha256(shareToken)});
          return respond({...result,url:`${base.replace(/\/$/,'')}/view/#${shareToken}`,token:shareToken},201);
        }
        if(tail==='/shares' && method==='GET') return respond(await backend.scene(actor,'shares.list',{projectId}));
        const share=tail.match(/^\/shares\/([^/]+)$/);
        if(share && method==='DELETE') return respond(await backend.scene(actor,'shares.revoke',{projectId,shareId:uuid.parse(share[1])}));
      }
      if(path==='/assets/parametric'&&method==='POST') {
        const input=parametricAssetRequestSchema.parse(await json());
        const result=await createParametricAsset(backend,actor,input.studioId,input.requestId,input.parameters);
        return respond(result,result.reused?200:201);
      }
      if(path==='/assets' && method==='GET') return respond(await backend.scene(actor,'assets.list'));
      const materialAsset=path.match(/^\/assets\/([^/]+)\/(materials|customize)$/);
      if(materialAsset) {
        const assetId=uuid.parse(materialAsset[1]);
        if(materialAsset[2]==='materials' && method==='GET')return respond(await readAssetMaterials(backend,actor,assetId));
        if(materialAsset[2]==='customize' && method==='POST') {
          const result=await createMaterialVariant(backend,actor,assetId,await json());
          return respond(result.asset,result.reused?200:201);
        }
      }
      const asset=path.match(/^\/assets\/([^/]+)\/url$/);
      if(asset && method==='POST') {
        const a=await backend.scene(actor,'assets.get',{assetId:uuid.parse(asset[1])});
        const {storage_path,...metadata}=a;
        return respond({...metadata,url:await backend.sign(storage_path),expiresIn:300});
      }
      if(path==='/catalog/recommendations' && method==='POST') {
        const input=z.strictObject({theme:z.string().max(500),scene:sceneSchema}).parse(await json());
        return respond(await recommendations(input.theme,input.scene,fetcher));
      }
      if(path==='/assets/import' && method==='POST') {
        const {modelId}=z.strictObject({modelId:z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/)}).parse(await json());
        const {bytes,...properties}=await importPublicModel(modelId,fetcher);
        const record=await assetRecord(actor,bytes,properties);
        await backend.upload(record.storagePath,bytes,'model/gltf-binary');
        return respond(await backend.scene(actor,'assets.register',record),201);
      }
      if(path==='/assets/sources'&&method==='POST'){
        if(!request.headers.get('content-type')?.startsWith('multipart/form-data'))throw new ApiError('MULTIPART_REQUIRED',415);
        const bytes=await readBounded(request,5*1024*1024+65536);
        const form=await new Request(request.url,{method:'POST',headers:{'content-type':request.headers.get('content-type')!},body:new Uint8Array(bytes)}).formData();
        const projectId=uuid.parse(form.get('projectId')),kind=z.enum(['floorplan','photo']).parse(form.get('kind')),file=form.get('file');
        const existing=await backend.scene(actor,'sources.list',{projectId});
        if(!(file instanceof File)||!['image/png','image/jpeg','image/webp'].includes(file.type))throw new ApiError('UNSUPPORTED_IMAGE',415);
        if(file.size>5*1024*1024)throw new ApiError('FILE_TOO_LARGE',413);
        const image=new Uint8Array(await file.arrayBuffer());let size:ReturnType<typeof ImageUtils.getSize>;
        try{if(ImageUtils.getMimeType(image)!==file.type)throw new ApiError('INVALID_IMAGE',422);size=ImageUtils.getSize(image,file.type);}catch{throw new ApiError('INVALID_IMAGE',422);}
        if(!size||size.some(n=>n<=0||n>4096))throw new ApiError('INVALID_IMAGE',422);
        const record=await assetRecord(actor,image,{name:file.name.slice(0,120)||'来源图片',source:'upload',format:file.type.slice(6),metadata:{width:size[0],height:size[1],kind},license:{type:'user-upload'}});
        const duplicate=await backend.scene(actor,'sources.find',{projectId,kind,sha256:record.sha256});
        if(duplicate)return respond(duplicate);
        if(existing.length>=12)throw new ApiError('SOURCE_LIMIT_EXCEEDED',422);
        await backend.upload(record.storagePath,image,file.type);
        return respond(await backend.scene(actor,'sources.register',{projectId,kind,asset:record}),201);
      }
      if(path==='/assets/floorplan' && method==='POST') {
        const mime=request.headers.get('content-type');
        if(mime!=='image/png' && mime!=='image/jpeg') throw new ApiError('UNSUPPORTED_IMAGE',415);
        const bytes=await readBounded(request,5*1024*1024);
        const size=ImageUtils.getSize(bytes,mime);
        if(!size || size.some(n=>n<=0||n>4096)) throw new ApiError('INVALID_IMAGE',422);
        const record=await assetRecord(actor,bytes,{name:'场地平面图',source:'upload',format:mime==='image/png'?'png':'jpeg',metadata:{width:size[0],height:size[1]},license:{type:'user-upload'}});
        await backend.upload(record.storagePath,bytes,mime);
        return respond(await backend.scene(actor,'assets.register',record),201);
      }
      if(path==='/assets/glb' && method==='POST') {
        const mime=request.headers.get('content-type')?.split(';')[0].trim();
        if(mime!=='model/gltf-binary' && mime!=='application/octet-stream') throw new ApiError('UNSUPPORTED_MODEL',415);
        const query=z.strictObject({
          name:name.default('本地生成模型'),
          source:z.enum(['aholo','upload']).default('upload'),
          sourceId:z.string().trim().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/).optional(),
        }).parse({
          name:url.searchParams.get('name') ?? undefined,
          source:url.searchParams.get('source') ?? undefined,
          sourceId:url.searchParams.get('sourceId') ?? undefined,
        });
        if(query.source==='aholo' && !query.sourceId) throw new ApiError('SOURCE_ID_REQUIRED',422);
        const raw=await readBounded(request,MAX_GLB_BYTES);
        if(raw.length<28) throw new ApiError('INVALID_GLB_SIZE',422);
        // 去重键用上传原文件哈希；同一个账号同一份文件永远落同一个 asset_id（跨设备/重试都能命中），
        // 不依赖 assets 表的额外唯一索引，也不用迁移。
        const sourceSha256=await sha256(raw);
        const digest=await sha256(`${actor}:${sourceSha256}`);
        const assetId=`${digest.slice(0,8)}-${digest.slice(8,12)}-5${digest.slice(13,16)}-a${digest.slice(17,20)}-${digest.slice(20,32)}` as `${string}-${string}-${string}-${string}-${string}`;
        try {
          const existing=await backend.scene(actor,'assets.get',{assetId});
          return respond({...uploadedAssetView(existing),reused:true});
        } catch(error) {
          if(!(error instanceof ApiError) || error.code!=='ASSET_NOT_FOUND') throw error;
        }
        let bytes=raw, validated;
        try { validated=await validateModel(bytes); }
        catch(error) {
          // Lux3D 直连产物带 Khronos 校验级瑕疵，云端通道会先 repairGlb；这里保持同一条修复路径。
          if(query.source!=='aholo' || !(error instanceof ApiError) || error.code!=='GLTF_VALIDATION_FAILED') throw error;
          bytes=repairGlb(raw);
          validated=await validateModel(bytes);
        }
        const normalization=normalizedAssetDimensions(validated.sourceSize);
        const record=await assetRecord(actor,bytes,{
          name:query.name,
          source:query.source,
          ...(query.sourceId?{sourceId:query.sourceId}:{}),
          metadata:{
            ...validated,
            origin:query.source==='aholo'?'local-generation':'upload',
            sourceSha256,
            sourceByteSize:raw.length,
            dimensions:normalization.dimensions,
            normalization:{unit:normalization.unit,upAxis:normalization.upAxis,sourceSize:normalization.sourceSize},
          },
          license:{type:'user-upload'},
        },assetId);
        await backend.upload(record.storagePath,bytes,'model/gltf-binary');
        try { return respond(uploadedAssetView(await backend.scene(actor,'assets.register',record)),201); }
        catch(error) {
          // 两个并发请求撞同一个确定性 id：先到的那条已经注册，回读它，绝不再插一条。
          const existing=await backend.scene(actor,'assets.get',{assetId});
          return respond({...uploadedAssetView(existing),reused:true});
        }
      }
      if(path==='/generation/capabilities' && method==='GET') return respond(generationCapabilities(env));
      if(path==='/jobs' && method==='POST') {
        const input=await prepareGenerationRequest(backend,actor,await json(),env);
        const result=await backend.jobs(actor,'jobs.create',{...input,reserveCents:reserveCost(env,'GENERATION_MAX_TASK_CENTS')});
        const {worker_token,worker_until,...safe}=result;
        return respond(safe,result.reused?200:202);
      }
      if(path==='/jobs' && method==='GET') return respond(await backend.jobs(actor,'jobs.list'));
      const job=path.match(/^\/jobs\/([^/]+)(\/added)?$/);
      if(job && !job[2] && method==='GET') return respond(await backend.jobs(actor,'jobs.get',{id:uuid.parse(job[1])}));
      if(job && job[2] && method==='POST') {
        const input=z.strictObject({projectId:uuid}).parse(await json());
        return respond(await backend.jobs(actor,'jobs.added',{...input,id:uuid.parse(job[1])}));
      }
      throw new ApiError('ROUTE_NOT_FOUND',404);
    } catch(error) {
      if(error instanceof z.ZodError) return respond({error:{code:'VALIDATION_ERROR',details:error.issues.map(i=>({path:i.path,message:i.message}))}},400);
      if(error instanceof ApiError) return respond({error:{code:error.code,details:error.details}},error.status);
      // Do not return SDK exceptions, signed URLs, prompts, tokens, or upstream response bodies.
      return respond({error:{code:'INTERNAL_ERROR'}},500);
    }
  };
}
