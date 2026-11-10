import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createApi } from '../supabase/functions/_shared/api.ts';
import { z } from 'zod';
import { database, owner } from './fixtures.ts';

// 2026-11-11 用户拍板：brief 只走百炼大模型——所有 provider 用例统一用百炼环境。
const bailianSettings: Record<string, string> = {
  BAILIAN_PRODUCT_ENABLED: '1',
  BAILIAN_PRODUCT_BASE_URL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  BAILIAN_PRODUCT_KEY: 'test-key',
  BAILIAN_PRODUCT_MODEL: 'qwen3.8-max',
};
const bailianKeys = (key: string): string | undefined => bailianSettings[key];

describe('activity needs over the authenticated extraction API', () => {
  let fixture: Awaited<ReturnType<typeof database>>;
  beforeAll(async () => { fixture = await database(); }, 30000);
  afterAll(async () => { await fixture?.db.close(); });

  it('returns model evidence through the real API contract', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({
      event: '讲座', activityNeeds: [{ kind: 'checkin', decision: 'not_needed', evidence: '不用安排接待台' }],
    }) } }] }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    const api = createApi(fixture.backend, bailianKeys, fetcher);
    const response = await api(new Request('https://backend.example/brief/extract', {
      method: 'POST', headers: { Authorization: `Bearer ${owner}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: '讲座自行入场，不用安排接待台' }),
    }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ enabled: true, extraction: { activityNeeds: [
      { kind: 'checkin', decision: 'not_needed', evidence: '不用安排接待台' },
    ] } });
    const sent = JSON.parse(String(fetcher.mock.calls[0]![1]?.body));
    expect(sent.messages[0].content).toContain('activityNeeds');
    expect(sent.messages[1].content).toBe('讲座自行入场，不用安排接待台');
    expect(sent.messages).toHaveLength(2);
    expect(JSON.stringify(sent)).not.toContain(owner);
  });

  it('refuses fabricated evidence for the whole extraction without returning invented requirements', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({
      event: '讲座', activityNeeds: [{ kind: 'rest', decision: 'needed', evidence: '必须设休息区' }],
    }) } }] }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    const api = createApi(fixture.backend, bailianKeys, fetcher);
    const response = await api(new Request('https://backend.example/brief/extract', {
      method: 'POST', headers: { Authorization: `Bearer ${owner}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: '举行一场讲座' }),
    }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ enabled: true, extraction: null, reason: 'MODEL_EVIDENCE_MISMATCH' });
    expect(JSON.stringify(body)).not.toContain('必须设休息区');
  });

  it('preserves sourced unknowns and conflicting interpretations for the caller to clarify', async () => {
    const output = { activityNeeds: [
      { kind: 'checkin', decision: 'unknown', evidence: '签到还没定' },
      { kind: 'rest', decision: 'needed', evidence: '休息区' },
      { kind: 'rest', decision: 'not_needed', evidence: '休息区' },
    ] };
    const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(output) } }] }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    }));
    const api = createApi(fixture.backend, bailianKeys, fetcher);
    const response = await api(new Request('https://backend.example/brief/extract', {
      method: 'POST', headers: { Authorization: `Bearer ${owner}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: '签到还没定，休息区怎么安排' }),
    }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ enabled: true, extraction: output });
  });

  it('keeps legacy fields compatible when a provider sends null for the optional boolean', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({
      event: '讲座', mobilityAssistance: null,
      activityNeeds: [{ kind: 'stage', decision: 'needed', evidence: '有讲台' }],
    }) } }] }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    const api = createApi(fixture.backend, bailianKeys, fetcher);
    const response = await api(new Request('https://backend.example/brief/extract', {
      method: 'POST', headers: { Authorization: `Bearer ${owner}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: '讲座有讲台' }),
    }));
    const body = await response.json();
    const legacy = z.strictObject({ enabled: z.boolean(), extraction: z.object({
      event: z.string().nullish(), mobilityAssistance: z.boolean().optional(),
    }).nullable() });
    const parsed = legacy.parse(body);
    expect(parsed.extraction?.event).toBe('讲座');
    expect(parsed.extraction?.mobilityAssistance).toBeUndefined();
    expect(body.extraction.activityNeeds).toHaveLength(1);
  });

  it('百炼未启用时如实报未配置，不回退小模型/网关/DeepSeek', async () => {
    const fetcher = vi.fn<typeof fetch>();
    const settings: Record<string, string> = { AGENT_CHAT_BASE_URL: 'https://custom.example/v1', TOKENDANCE_API_KEY: 'other-provider-key' };
    const api = createApi(fixture.backend, key => settings[key], fetcher);
    const response = await api(new Request('https://backend.example/brief/extract', {
      method: 'POST', headers: { Authorization: `Bearer ${owner}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ message: '测试活动' }),
    }));
    expect(await response.json()).toEqual({ enabled: false, extraction: null });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('uses the configured compatible endpoint and model for extraction', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: '{"event":"讲座"}' } }] })));
    const settings: Record<string, string> = { ...bailianSettings };
    const api = createApi(fixture.backend, key => settings[key], fetcher);
    const response = await api(new Request('https://backend.example/brief/extract', {
      method: 'POST', headers: { Authorization: `Bearer ${owner}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ message: '讲座' }),
    }));
    expect(await response.json()).toMatchObject({ enabled: true, extraction: { event: '讲座' } });
    expect(fetcher.mock.calls[0]![0]).toBe('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions');
    expect(JSON.parse(String(fetcher.mock.calls[0]![1]?.body)).model).toBe('qwen3.8-max');
  });

  it('uses the bailian-qwen profile: non-thinking JSON-mode request, reasoning content never echoed', async () => {
    const settings: Record<string, string> = { ...bailianSettings };
    const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { reasoning_content: 'private reasoning', content: '{"event":"讲座"}' } }] })));
    const api = createApi(fixture.backend, key => settings[key], fetcher);
    const response = await api(new Request('https://backend.example/brief/extract', {
      method: 'POST', headers: { Authorization: `Bearer ${owner}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ message: '讲座' }),
    }));
    const body = await response.json();
    expect(body).toMatchObject({ enabled: true, extraction: { event: '讲座' } });
    expect(JSON.stringify(body)).not.toContain('private reasoning');
    expect(fetcher.mock.calls[0]![0]).toBe('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions');
    const sent = JSON.parse(String(fetcher.mock.calls[0]![1]?.body));
    expect(sent).toMatchObject({ model: 'qwen3.8-max', enable_thinking: false, max_tokens: 2048, temperature: 0, response_format: { type: 'json_object' } });
    expect(sent).not.toHaveProperty('thinking');
  });

  it.each([
    [{ finish_reason: 'length', message: { content: '{"event":"讲座"}' } }, 'MODEL_INCOMPLETE_OUTPUT'],
    [{ message: { content: '{"event":"讲座"}' } }, 'MODEL_INCOMPLETE_OUTPUT'],
    [{ finish_reason: 'stop', message: { content: '<think>private</think>{"event":"讲座"}' } }, 'MODEL_INVALID_RESPONSE'],
    [{ finish_reason: 'stop', message: { content: null, reasoning_content: 'private' } }, 'MODEL_INVALID_RESPONSE'],
  ])('does not accept incomplete or reasoning-tagged output', async (choice, reason) => {
    const settings: Record<string, string> = { ...bailianSettings };
    const fetcher = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ choices: [choice] })));
    const api = createApi(fixture.backend, key => settings[key], fetcher);
    const response = await api(new Request('https://backend.example/brief/extract', {
      method: 'POST', headers: { Authorization: `Bearer ${owner}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ message: '讲座' }),
    }));
    expect(await response.json()).toEqual({ enabled: true, extraction: null, reason });
  });

  it.each([undefined,null,'length','tool_calls'])('requires an explicit completed response for a compatible provider: %s', async finishReason=>{
    const settings:Record<string,string>={...bailianSettings};
    const fetcher=vi.fn<typeof fetch>(async()=>new Response(JSON.stringify({choices:[{finish_reason:finishReason,message:{content:'{"event":"讲座"}'}}]})));
    const api=createApi(fixture.backend,key=>settings[key],fetcher);
    const response=await api(new Request('https://backend.example/brief/extract',{method:'POST',headers:{Authorization:`Bearer ${owner}`,'Content-Type':'application/json'},body:JSON.stringify({message:'讲座'})}));
    expect(await response.json()).toEqual({enabled:true,extraction:null,reason:'MODEL_INCOMPLETE_OUTPUT'});expect(fetcher).toHaveBeenCalledOnce();
  });
  it('reports a provider body timeout without echoing private data',async()=>{
    const fetcher=vi.fn<typeof fetch>(async()=>new Response(new ReadableStream({start(controller){controller.error(new DOMException('private stream detail','TimeoutError'));}})));
    const api=createApi(fixture.backend,bailianKeys,fetcher);
    const response=await api(new Request('https://backend.example/brief/extract',{method:'POST',headers:{Authorization:`Bearer ${owner}`,'Content-Type':'application/json'},body:JSON.stringify({message:'讲座'})}));
    expect(await response.json()).toEqual({enabled:true,extraction:null,reason:'MODEL_TIMEOUT'});
  });

  it('propagates client cancellation to the provider without automatically retrying',async()=>{
    const controller=new AbortController();let upstream:AbortSignal|undefined;
    const fetcher=vi.fn<typeof fetch>(async(_url,init)=>new Promise((_resolve,reject)=>{
      upstream=init?.signal??undefined;
      upstream?.addEventListener('abort',()=>reject(new DOMException('private abort detail','AbortError')),{once:true});
    }));
    const api=createApi(fixture.backend,bailianKeys,fetcher);
    const pending=api(new Request('https://backend.example/brief/extract',{method:'POST',signal:controller.signal,headers:{Authorization:`Bearer ${owner}`,'Content-Type':'application/json'},body:JSON.stringify({message:'讲座'})}));
    await vi.waitFor(()=>expect(fetcher).toHaveBeenCalledOnce());controller.abort();
    const response=await pending;expect(upstream?.aborted).toBe(true);expect(await response.json()).toEqual({enabled:true,extraction:null,reason:'MODEL_TIMEOUT'});expect(fetcher).toHaveBeenCalledOnce();
  });

  it('rejects an unsafe provider URL without sending the key or request', async () => {
    const fetcher = vi.fn<typeof fetch>();
    const settings: Record<string, string> = { BAILIAN_PRODUCT_ENABLED: '1', BAILIAN_PRODUCT_BASE_URL: 'http://external.example/v1', BAILIAN_PRODUCT_KEY: 'secret', BAILIAN_PRODUCT_MODEL: 'fixture' };
    const api = createApi(fixture.backend, key => settings[key], fetcher);
    const response = await api(new Request('https://backend.example/brief/extract', {
      method: 'POST', headers: { Authorization: `Bearer ${owner}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ message: '测试活动' }),
    }));
    expect(await response.json()).toEqual({ enabled: true, extraction: null, reason: 'MODEL_PROVIDER_URL_INVALID' });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('reports provider status without returning response bodies or exception text', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response('private-provider-response', { status: 429 }));
    const api = createApi(fixture.backend, bailianKeys, fetcher);
    const request = () => new Request('https://backend.example/brief/extract', {
      method: 'POST', headers: { Authorization: `Bearer ${owner}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ message: '测试活动' }),
    });
    expect(await (await api(request())).json()).toEqual({ enabled: true, extraction: null, reason: 'PROVIDER_HTTP_ERROR:429' });
    fetcher.mockRejectedValueOnce(new Error('private-network-detail'));
    expect(await (await api(request())).json()).toEqual({ enabled: true, extraction: null, reason: 'MODEL_REQUEST_FAILED' });
    fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: 'private-invalid-json' } }] })));
    expect(await (await api(request())).json()).toEqual({ enabled: true, extraction: null, reason: 'MODEL_INVALID_JSON' });
  });
});
