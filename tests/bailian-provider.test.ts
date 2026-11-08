import { describe, expect, it } from 'vitest';
import { chatRequest } from '../supabase/functions/_shared/providers.ts';

const config: Record<string, string> = {
  AGENT_CHAT_PROFILE: 'bailian-qwen',
  AGENT_CHAT_BASE_URL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  AGENT_CHAT_KEY: 'fixture-not-a-real-key',
  AGENT_CHAT_MODEL: 'qwen-example',
};
const request = (values: Record<string, string>, body: Record<string, unknown>) =>
  chatRequest(key => values[key], body);

describe('Bailian Qwen product-backend adapter', () => {
  it('uses the configured compatible endpoint and Qwen parameters for chat and JSON', () => {
    const result = request(config, { messages: [], response_format: { type: 'json_object' }, max_tokens: 200 });
    expect(result.url).toBe('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions');
    expect(JSON.parse(result.init.body as string)).toEqual({ messages: [], response_format: { type: 'json_object' }, max_tokens: 200, model: 'qwen-example', enable_thinking: false });
  });

  it('retains tool messages and preserves forced submission through a single offered tool', () => {
    const tools = [{ type: 'function', function: { name: 'get_scene' } }, { type: 'function', function: { name: 'submit_candidates' } }];
    const messages = [{ role: 'assistant', tool_calls: [{ id: 'a', type: 'function', function: { name: 'get_scene', arguments: '{}' } }] }, { role: 'tool', tool_call_id: 'a', content: '{"objects":[]}' }];
    const result = request(config, { messages, tools, tool_choice: { type: 'function', function: { name: 'submit_candidates' } } });
    expect(JSON.parse(result.init.body as string)).toMatchObject({ messages, tools: [tools[1]], tool_choice: 'auto', enable_thinking: false });
  });

  it('fails closed on incomplete configuration, incompatible plans, or invalid forced tool', () => {
    const { AGENT_CHAT_KEY: _key, ...missing } = config;
    expect(() => request({ ...missing, DEEPSEEK_API_KEY: 'other-fixture' }, { messages: [] })).toThrow('MODEL_PROVIDER_INCOMPLETE');
    for (const base of ['https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1', 'https://coding.dashscope.aliyuncs.com/v1', 'https://example.com/compatible-mode/v1']) {
      expect(() => request({ ...config, AGENT_CHAT_BASE_URL: base }, { messages: [] })).toThrow('MODEL_PROVIDER_URL_INVALID');
    }
    expect(() => request(config, { tools: [], tool_choice: { type: 'function', function: { name: 'missing' } } })).toThrow('MODEL_PROVIDER_UNSUPPORTED_WORKFLOW');
  });

  it('accepts an explicit regional workspace endpoint', () => {
    expect(request({ ...config, AGENT_CHAT_BASE_URL: 'https://ws-example.cn-beijing.maas.aliyuncs.com/compatible-mode/v1' }, { messages: [] }).url)
      .toBe('https://ws-example.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/chat/completions');
  });
});
