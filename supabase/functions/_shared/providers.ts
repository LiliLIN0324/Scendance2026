import { z } from 'zod';
import { SYSTEM_PROMPT, buildProposal } from './ai.ts';
import { ApiError, catalog, type ProposalRequest } from './domain.ts';
import { fetchJson, required, type Env, type Fetcher } from './http.ts';

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
export function hunyuan(env: Env, fetcher: Fetcher = fetch) {
  const mode=env('HUNYUAN_API_MODE')??'tokenhub';
  if(mode!=='tokenhub' && mode!=='legacy') throw new ApiError('SERVICE_NOT_CONFIGURED',503,{setting:'HUNYUAN_API_MODE'});
  const base=mode==='tokenhub'?'https://tokenhub.tencentmaas.com/v1/api/3d':'https://api.ai3d.cloud.tencent.com/v1/ai3d';
  const call = (path: string, body: unknown) => fetchJson(`${base}/${path}`, {
    method: 'POST', headers: { Authorization: `${mode==='tokenhub'?'Bearer ':''}${required(env, 'HUNYUAN_API_KEY')}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }, fetcher).then(unwrap);
  return {
    async submit(prompt: string) {
      if(mode==='legacy') return submitSchema.parse(await call('submit', { Prompt: prompt, Model: '3.0', GenerateType: 'LowPoly', PolygonType: 'triangle' }));
      const result=tokenhubSubmitSchema.parse(await call('submit',{model:'hy-3d-3.0',prompt,generate_type:'LowPoly',polygon_type:'triangle'}));
      return {JobId:result.id,RequestId:result.request_id};
    },
    async query(id: string):Promise<z.infer<typeof querySchema>> {
      if(mode==='legacy') return querySchema.parse(await call('query', { JobId: id }));
      const result=tokenhubQuerySchema.parse(await call('query',{model:'hy-3d-3.0',id}));
      return {
        Status:({queued:'WAIT',in_progress:'RUN',failed:'FAIL',completed:'DONE'} as const)[result.status],RequestId:result.request_id,
        ResultFile3Ds:result.data?.map(file=>({Type:file.type,Url:file.url,PreviewImageUrl:file.preview_image_url})),
      };
    },
  };
}
export async function generateProposal(input: ProposalRequest, env: Env, reserveCall: (attempt:number)=>Promise<unknown>, fetcher: Fetcher = fetch) {
  const messages: { role: string; content: string }[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: JSON.stringify({ mode: input.mode, instruction: input.instruction, scene: input.scene, selectedIds: input.selectedIds, catalog }) },
  ];
  const usage: unknown[] = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    // UTF-8 bytes conservatively bound input tokens; cap output and reserve peak-rate cost.
    // 65,536 bytes + framing at CNY 2/M input, plus 4,096 output at CNY 8/M < CNY 0.20.
    if(new TextEncoder().encode(JSON.stringify(messages)).length>65_536) throw new ApiError('AI_INPUT_TOO_LARGE',413);
    await reserveCall(attempt);
    const raw = await fetchJson('https://api.deepseek.com/chat/completions', {
      method: 'POST', headers: { Authorization: `Bearer ${required(env, 'DEEPSEEK_API_KEY')}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'deepseek-flash', messages, response_format: { type: 'json_object' }, max_tokens: 4096, thinking: { type: 'disabled' } }),
    }, fetcher);
    const response = z.object({ choices: z.array(z.object({ message: z.object({ content: z.string() }), finish_reason: z.string() })).min(1), usage: z.unknown().optional() }).parse(raw);
    usage.push(response.usage ?? null);
    const content = response.choices[0].message.content;
    try {
      if (response.choices[0].finish_reason !== 'stop') throw new ApiError('AI_INCOMPLETE_OUTPUT', 422);
      return { ...buildProposal(input.scene, input.mode, JSON.parse(content)), usage };
    } catch (error) {
      const details = error instanceof z.ZodError ? error.issues : error instanceof ApiError ? { code: error.code, details: error.details } : { code: 'INVALID_JSON' };
      if (attempt === 1) throw new ApiError('AI_INVALID_PROPOSAL', 422, { validation: details, usage });
      messages.push({ role: 'assistant', content }, { role: 'user', content: JSON.stringify({ repair: details, instruction: '只修复校验错误，再次输出符合系统约束的 JSON。' }) });
    }
  }
  throw new ApiError('AI_INVALID_PROPOSAL', 422);
}
