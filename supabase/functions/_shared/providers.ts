import { z } from 'zod';
import { SYSTEM_PROMPT, buildProposal } from './ai.ts';
import { ApiError, catalog, type ProposalRequest } from './domain.ts';
import { fetchJson, required, type Env, type Fetcher } from './http.ts';
import type { GenerationProvider } from './generation-contract.ts';
import { resourceIndex, sceneResourceRefs, type SceneResource } from './scene-resources.ts';

const submitSchema = z.object({ JobId: z.string().min(1), RequestId: z.string().optional() });
export const querySchema = z.object({
  Status: z.enum(['WAIT','RUN','FAIL','DONE']), ErrorCode: z.string().optional(),
  ResultFile3Ds: z.array(z.object({ Type: z.string(), Url: z.url(), PreviewImageUrl: z.string().optional() })).optional(),
  ResultCreditConsumed: z.number().optional(), ResultCreditDetails: z.string().optional(), RequestId: z.string().optional(),
});
const tokenhubSubmitSchema = z.object({ id: z.string().min(1), request_id: z.string().optional() });
const tokenhubQuerySchema = z.object({
  status: z.enum(['queued','in_progress','failed','completed']), request_id: z.string().optional(),
  data: z.array(z.object({ type: z.string(), url: z.url(), preview_image_url: z.string().optional() })).optional(),
});
function unwrap(value: unknown) {
  const outer = z.record(z.string(), z.unknown()).parse(value);
  const body = outer.Response ?? outer;
  if (body && typeof body === 'object' && 'Error' in body) throw new ApiError('PROVIDER_REJECTED', 502);
  return body;
}
export function hunyuan(env: Env, fetcher: Fetcher = fetch, pinned?:GenerationProvider) {
  const mode=pinned?.providerMode??env('HUNYUAN_API_MODE')??'tokenhub';
  const model=pinned?.providerModel??'hy-3d-3.0';
  if(mode!=='tokenhub' && mode!=='legacy') throw new ApiError('SERVICE_NOT_CONFIGURED',503,{setting:'HUNYUAN_API_MODE'});
  if(!['hy-3d-3.0','hy-3d-3.1','hy-3d-texture'].includes(model)||(mode==='legacy'&&model!=='hy-3d-3.0'))throw new ApiError('SERVICE_NOT_CONFIGURED',503);
  const base=mode==='tokenhub'?'https://tokenhub.tencentmaas.com/v1/api/3d':'https://api.ai3d.cloud.tencent.com/v1/ai3d';
  const call = (path: string, body: unknown) => fetchJson(`${base}/${path}`, {
    method: 'POST', headers: { Authorization: `${mode==='tokenhub'?'Bearer ':''}${required(env, 'HUNYUAN_API_KEY')}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }, fetcher).then(unwrap);
  return {
    async submit(prompt: string, assets?:{imageUrl?:string;sourceUrl?:string}) {
      if(mode==='legacy') return submitSchema.parse(await call('submit', { Prompt: prompt, Model: '3.0', GenerateType: 'LowPoly', PolygonType: 'triangle' }));
      if(model==='hy-3d-texture'&&(!assets?.imageUrl||!assets.sourceUrl))throw new ApiError('INVALID_GENERATION_INPUT',422);
      const body=model==='hy-3d-texture'
        ?{model,file_3d:{url:assets!.sourceUrl},image:{url:assets!.imageUrl},enable_pbr:true,enable_keep_uv:true,texture_size:1024}
        :{model,...(assets?.imageUrl?{image_url:assets.imageUrl}:{prompt}),...(model==='hy-3d-3.1'?{generate_type:'Normal',face_count:20000,enable_pbr:true}:{generate_type:'LowPoly',polygon_type:'triangle'})};
      const result=tokenhubSubmitSchema.parse(await call('submit',body));
      return {JobId:result.id,RequestId:result.request_id};
    },
    async query(id: string):Promise<z.infer<typeof querySchema>> {
      if(mode==='legacy') return querySchema.parse(await call('query', { JobId: id }));
      const result=tokenhubQuerySchema.parse(await call('query',{model,id}));
      return {
        Status:({queued:'WAIT',in_progress:'RUN',failed:'FAIL',completed:'DONE'} as const)[result.status],RequestId:result.request_id,
        ResultFile3Ds:result.data?.map(file=>({Type:file.type,Url:file.url,PreviewImageUrl:file.preview_image_url})),
      };
    },
  };
}
/**
 * Aholo Lux3D (docs/15-Aholo集成规划.md M1). Same submit/query shape as `hunyuan` so the
 * worker can consume either through the pinned job fields. Text/image only — Lux3D has no
 * re-texture lane in scope. Result URLs expire in ~2h, so the worker must archive immediately.
 */
const lux3dShell=z.object({c:z.string().nullable(),d:z.unknown(),m:z.string().nullable().optional(),f:z.unknown().optional()});
const lux3dQuerySchema=z.object({status:z.number(),outputs:z.array(z.object({content:z.string().nullable()}).nullable()).optional()});
export function aholoLux3d(env: Env, fetcher: Fetcher = fetch) {
  const base=(env('LUX3D_BASE_URL')??'https://api.aholo.ai/global').replace(/\/+$/,'');
  const call = (path: string, init: RequestInit) => fetchJson(`${base}${path}`, {
    ...init, headers: { Authorization: `${required(env, 'LUX3D_API_KEY')}`, 'Content-Type': 'application/json' },
  }, fetcher).then(value=>{
    const body=lux3dShell.parse(value);
    if(body.c!=='0') throw new ApiError('PROVIDER_REJECTED',502,{code:body.c,message:body.m});
    return body.d;
  });
  return {
    async submit(prompt: string, assets?:{imageUrl?:string;sourceUrl?:string}) {
      if(assets?.imageUrl){
        const d=await call('/lux3d/v1/generate/img-to-3d/task/create',{method:'POST',body:JSON.stringify({img:assets.imageUrl,version:'G1',faceCount:30000,outputFormat:['zip','glb']})});
        return {JobId:String(z.number().parse(d)),RequestId:undefined};
      }
      const d=await call('/lux3d/v1/generate/text-to-3d/task/create',{method:'POST',body:JSON.stringify({prompt,version:'G1',faceCount:30000,outputFormat:['zip','glb']})});
      return {JobId:String(z.number().parse(d)),RequestId:undefined};
    },
    async query(id: string):Promise<z.infer<typeof querySchema>> {
      const d=lux3dQuerySchema.parse(await call(`/lux3d/v1/generate/task/get?taskid=${encodeURIComponent(id)}`,{method:'GET'}));
      const Status=({0:'WAIT',1:'RUN',3:'DONE',4:'FAIL',6:'FAIL'} as const)[d.status]??'FAIL';
      return {
        Status,ErrorCode:d.status===6?'PROVIDER_TASK_CANCELLED':d.status===4?'PROVIDER_FAILED':undefined,
        ResultFile3Ds:(d.outputs??[]).flatMap(o=>{
          if(!o?.content||!o.content.startsWith('https://'))return [];
          const type=o.content.split('?')[0].split('.').pop()?.toLowerCase()??'';
          return ['glb','zip','ply'].includes(type)?[{Type:type,Url:o.content}]:[];
        }),
      };
    },
  };
}
/** Shared chat provider for the Binggo tool loop and single-shot proposals. */
export const CHAT_API_KEY_ENV = 'TOKENDANCE_API_KEY';
const CHAT_URL = 'https://tokendance.space/gateway/v1/chat/completions';
const CHAT_MODEL = 'deepseek-v4.1-flash';
/** Gateway not configured: fall back to the DeepSeek official endpoint, shared with reconstruction. */
const OFFICIAL_CHAT_URL = 'https://api.deepseek.com/chat/completions';
const OFFICIAL_CHAT_MODEL = 'deepseek-flash';
/** Usage labels are fixed categories; never persist the configured endpoint or model. */
export function chatUsageProvider(env: Env): 'minimax' | 'custom' | 'deepseek' {
  if (env('AGENT_CHAT_PROFILE') === 'minimax') return 'minimax';
  return env('AGENT_CHAT_BASE_URL') ? 'custom' : 'deepseek';
}
/**
 * OpenAI-compatible chat request. Priority: any OpenAI-compatible provider
 * (`AGENT_CHAT_BASE_URL` + `AGENT_CHAT_KEY` + `AGENT_CHAT_MODEL`) → Tokendance gateway →
 * DeepSeek official endpoint (`DEEPSEEK_API_KEY`, same key as reconstruction). Keeping endpoints,
 * models and keys in one place stops the call sites from drifting. Switching
 * providers is a `supabase secrets set` away and takes effect immediately, no redeploy.
 */
export function chatRequest(env: Env, body: Record<string, unknown>, options?: { purpose?: 'brief' | 'agent' }): { url: string; init: RequestInit } {
  const customBase = env('AGENT_CHAT_BASE_URL'), customKey = env('AGENT_CHAT_KEY'), customModel = env('AGENT_CHAT_MODEL');
  const profile = env('AGENT_CHAT_PROFILE');
  if (profile && !['minimax', 'bailian-qwen'].includes(profile)) throw new ApiError('MODEL_PROVIDER_PROFILE_INVALID', 503);
  const minimaxAgent = profile === 'minimax' && options?.purpose === 'agent' && env('MINIMAX_AGENT_TOOLS_ENABLED') === '1';
  if (profile === 'minimax' && options?.purpose !== 'brief' && !minimaxAgent) throw new ApiError('MODEL_PROVIDER_UNSUPPORTED_WORKFLOW', 503);
  if (profile && (!customBase?.trim() || !customKey?.trim() || !customModel?.trim())) throw new ApiError('MODEL_PROVIDER_INCOMPLETE', 503);
  if (customBase || customKey || customModel) {
    if (!customBase?.trim() || !customKey?.trim() || !customModel?.trim()) throw new ApiError('MODEL_PROVIDER_INCOMPLETE', 503);
    let parsed: URL;
    try { parsed = new URL(customBase); } catch { throw new ApiError('MODEL_PROVIDER_URL_INVALID', 503); }
    const localHttp = parsed.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname);
    if ((!localHttp && parsed.protocol !== 'https:') || parsed.username || parsed.password || parsed.search || parsed.hash) throw new ApiError('MODEL_PROVIDER_URL_INVALID', 503);
    // This product-backend adapter is deliberately limited to Qwen models that
    // support non-thinking Chat Completions. Coding/Token Plan endpoints are for
    // interactive coding tools, not product backends (Model Studio Base URL docs).
    if (profile === 'bailian-qwen') {
      const host = parsed.hostname.toLowerCase();
      const standardHost = ['dashscope.aliyuncs.com', 'dashscope-intl.aliyuncs.com', 'dashscope-us.aliyuncs.com', 'cn-hongkong.dashscope.aliyuncs.com'].includes(host)
        || /^[a-z0-9-]+\.(cn-beijing|ap-southeast-1|ap-northeast-1|eu-central-1|us-east-1|cn-hongkong)\.maas\.aliyuncs\.com$/.test(host);
      if ((!localHttp && (!standardHost || host.startsWith('token-plan.'))) || parsed.pathname.replace(/\/+$/, '') !== '/compatible-mode/v1') throw new ApiError('MODEL_PROVIDER_URL_INVALID', 503);
    }
    const requestBody = profile === 'minimax' ? (() => {
      const { thinking: _thinking, temperature: _temperature, response_format: _format, ...rest } = body;
      if (!minimaxAgent && ('tools' in rest || 'tool_choice' in rest)) throw new ApiError('MODEL_PROVIDER_UNSUPPORTED_WORKFLOW', 503);
      const effort = env('AGENT_CHAT_REASONING_EFFORT');
      if (effort && !['low', 'medium', 'high', 'xhigh', 'max'].includes(effort)) throw new ApiError('MODEL_PROVIDER_INCOMPLETE', 503);
      return { model: customModel, ...rest, reasoning_split: true, ...(effort ? { reasoning_effort: effort } : {}) };
    })() : profile === 'bailian-qwen' ? (() => {
      const { thinking: _thinking, enable_thinking: _enableThinking, ...rest } = body;
      // Non-thinking is explicit: the current runtime doesn't replay thinking
      // content and several Qwen models require streaming when thinking.
      // Preserve a forced submission without unsupported named tool_choice.
      const choice = rest.tool_choice;
      if (choice && typeof choice === 'object' && 'function' in choice) {
        const name = (choice as {function?:{name?:string}}).function?.name;
        const tools = Array.isArray(rest.tools) ? rest.tools.filter((tool: {function?:{name?:string}}) => tool.function?.name === name) : [];
        if (!name || tools.length !== 1) throw new ApiError('MODEL_PROVIDER_UNSUPPORTED_WORKFLOW', 503);
        return { ...rest, model: customModel, enable_thinking: false, tools, tool_choice: 'auto' };
      }
      return { ...rest, model: customModel, enable_thinking: false };
    })() : { model: customModel, thinking: { type: 'disabled' }, ...body };
    return { url: `${customBase.replace(/\/+$/, '')}/chat/completions`, init: {
    method: 'POST', headers: { Authorization: `Bearer ${customKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody),
    } };
  }
  const gatewayKey = env(CHAT_API_KEY_ENV);
  if (gatewayKey) return { url: CHAT_URL, init: {
    method: 'POST', headers: { Authorization: `Bearer ${gatewayKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: CHAT_MODEL, thinking: { type: 'disabled' }, ...body }),
  } };
  return { url: OFFICIAL_CHAT_URL, init: {
    method: 'POST', headers: { Authorization: `Bearer ${required(env, 'DEEPSEEK_API_KEY')}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: OFFICIAL_CHAT_MODEL, thinking: { type: 'disabled' }, ...body }),
  } };
}
export async function generateProposal(input: ProposalRequest, env: Env, reserveCall: (attempt:number)=>Promise<unknown>, fetcher: Fetcher = fetch, resources: readonly SceneResource[] = []) {
  const messages: { role: string; content: string }[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: JSON.stringify({ mode: input.mode, instruction: input.instruction, scene: input.scene, selectedIds: input.selectedIds, catalog, resources:resourceIndex(resources), sceneResourceRefs:sceneResourceRefs(input.scene,resources) }) },
  ];
  const usage: unknown[] = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    // UTF-8 bytes conservatively bound input tokens; cap output and reserve peak-rate cost.
    // 65,536 bytes + framing at CNY 2/M input, plus 4,096 output at CNY 8/M < CNY 0.20.
    if(new TextEncoder().encode(JSON.stringify(messages)).length>65_536) throw new ApiError('AI_INPUT_TOO_LARGE',413);
    await reserveCall(attempt);
    const { url, init } = chatRequest(env, { messages, response_format: { type: 'json_object' }, max_tokens: 4096 });
    const raw = await fetchJson(url, init, fetcher);
    const response = z.object({ choices: z.array(z.object({ message: z.object({ content: z.string() }), finish_reason: z.string() })).min(1), usage: z.unknown().optional() }).parse(raw);
    usage.push(response.usage ?? null);
    const content = response.choices[0].message.content;
    try {
      if (response.choices[0].finish_reason !== 'stop') throw new ApiError('AI_INCOMPLETE_OUTPUT', 422);
      return { ...buildProposal(input.scene, input.mode, JSON.parse(content),resources,input.selectedIds), usage };
    } catch (error) {
      const details = error instanceof z.ZodError ? error.issues : error instanceof ApiError ? { code: error.code, details: error.details } : { code: 'INVALID_JSON' };
      if (attempt === 1) throw new ApiError('AI_INVALID_PROPOSAL', 422, { validation: details, usage });
      messages.push({ role: 'assistant', content }, { role: 'user', content: JSON.stringify({ repair: details, instruction: '只修复校验错误，再次输出符合系统约束的 JSON。' }) });
    }
  }
  throw new ApiError('AI_INVALID_PROPOSAL', 422);
}
