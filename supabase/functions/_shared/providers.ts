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
function unwrap(value: unknown) {
  const outer = z.record(z.string(), z.unknown()).parse(value);
  const body = outer.Response ?? outer;
  if (body && typeof body === 'object' && 'Error' in body) throw new ApiError('PROVIDER_REJECTED', 502);
  return body;
}
export function hunyuan(env: Env, fetcher: Fetcher = fetch) {
  const call = (path: string, body: unknown) => fetchJson(`https://api.ai3d.cloud.tencent.com/v1/ai3d/${path}`, {
    method: 'POST', headers: { Authorization: required(env, 'HUNYUAN_API_KEY'), 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }, fetcher).then(unwrap);
  return {
    async submit(prompt: string) { return submitSchema.parse(await call('submit', { Prompt: prompt, Model: '3.0', GenerateType: 'LowPoly', PolygonType: 'triangle' })); },
    async query(id: string) { return querySchema.parse(await call('query', { JobId: id })); },
  };
}
export async function generateProposal(input: ProposalRequest, env: Env, fetcher: Fetcher = fetch) {
  const messages: { role: string; content: string }[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: JSON.stringify({ mode: input.mode, instruction: input.instruction, scene: input.scene, selectedIds: input.selectedIds, catalog }) },
  ];
  const usage: unknown[] = [];
  for (let attempt = 0; attempt < 2; attempt++) {
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
