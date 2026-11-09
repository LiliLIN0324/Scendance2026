import { describe, expect, it } from 'vitest';
import { MAX_MINIMAX_RESPONSE_BYTES, miniMaxRoundTools, parseMiniMaxToolTurn, readBoundedMiniMaxJson } from '../supabase/functions/_shared/minimax-tool-adapter.ts';
import { chatRequest } from '../supabase/functions/_shared/providers.ts';

const tools = [
  { type: 'function' as const, function: { name: 'get_scene', parameters: { type: 'object' } } },
  { type: 'function' as const, function: { name: 'submit_candidates', parameters: { type: 'object' } } },
];
const call = (id: string, name = 'get_scene', args = '{}') => ({ id, type: 'function', function: { name, arguments: args } });
const response = (message: unknown, finish_reason = 'tool_calls') => ({ choices: [{ finish_reason, message }], base_resp: { status_code: 0 } });

describe('MiniMax simulated tool protocol (never dispatches)', () => {
  it('preserves the complete bounded assistant message and tool IDs in a two-turn exchange', () => {
    const first = { role: 'assistant', content: null, reasoning_content: 'private reasoning', name: 'MiniMax AI', audio_content: '', tool_calls: [call('a')] };
    const turn = parseMiniMaxToolTurn(response(first), tools.map(tool => tool.function.name), new Set());
    expect(turn.assistantMessage).toEqual(first);
    expect(turn.calls).toEqual([{ id: 'a', name: 'get_scene', arguments: {} }]);
    const conversation = [{ role: 'user', content: '规划场地' }, turn.assistantMessage, { role: 'tool', tool_call_id: 'a', content: '{"ok":true}' }];
    expect(conversation[1]).toEqual(first);
    expect(miniMaxRoundTools(tools, true).map(tool => tool.function.name)).toEqual(['submit_candidates']);
    const final = parseMiniMaxToolTurn(response({ role: 'assistant', content: null, tool_calls: [call('b', 'submit_candidates', '{"candidates":[]}')] }), ['submit_candidates'], new Set(['a']), true);
    expect(final.calls[0]).toEqual({ id: 'b', name: 'submit_candidates', arguments: { candidates: [] } });
  });

  it('allows responses with no thinking field', () => {
    const result = parseMiniMaxToolTurn(response({ role: 'assistant', content: '请补充尺寸' }, 'stop'), ['get_scene'], new Set());
    expect(result.assistantMessage).toEqual({ role: 'assistant', content: '请补充尺寸' });
    expect(result.calls).toEqual([]);
  });
  it('allows ordinary malformed arguments to be reported to the model only in recovery mode',()=>{
    const raw=response({role:'assistant',tool_calls:[call('a','get_scene','{"broken":') ]});
    expect(()=>parseMiniMaxToolTurn(raw,['get_scene'],new Set())).toThrow('MINIMAX_INVALID_TOOL_RESPONSE');
    expect(parseMiniMaxToolTurn(raw,['get_scene'],new Set(),false,true).calls).toEqual([{id:'a',name:'get_scene',arguments:null}]);
  });
  it.each(['{"__proto__":{}}','{"x":1,"x":2}','{"amount":1e400}','{"x":'+ '['.repeat(33)+'0'+']'.repeat(33)+'}'])('never recovers unsafe arguments: %s',args=>{
    const raw=response({role:'assistant',tool_calls:[call('a','get_scene',args)]});
    expect(()=>parseMiniMaxToolTurn(raw,['get_scene'],new Set(),false,true)).toThrow('MINIMAX_INVALID_TOOL_RESPONSE');
  });

  it.each([
    response({ role: 'assistant', content: '', reasoning_content: 'private' }, 'length'),
    response({ role: 'assistant', tool_calls: [call('a', 'get_scene', '{bad')] }),
    response({ role: 'assistant', tool_calls: [call('a'), call('a')] }),
    response({ role: 'assistant', tool_calls: [call('a', 'unknown')] }),
    response({ role: 'assistant', tool_calls: [call('a', 'get_scene', '[]')] }),
    response({ role: 'assistant', tool_calls: [call('a')], reasoning_content: 'x'.repeat(100_001) }),
    response({ role: 'assistant', tool_calls: [call('a')], undocumented: 'private' }),
    { choices: [], base_resp: { status_code: 1008 } },
  ])('fails closed without exposing provider payload', raw => {
    try { parseMiniMaxToolTurn(raw, ['get_scene'], new Set()); throw new Error('unexpected success'); }
    catch (error) {
      expect(error).toMatchObject({ code: 'MINIMAX_INVALID_TOOL_RESPONSE' });
      expect(JSON.stringify(error)).not.toContain('private');
    }
  });

  it('requires exactly one submit on the last turn and rejects unknown tool configuration', () => {
    expect(() => parseMiniMaxToolTurn(response({ role: 'assistant', tool_calls: [call('a')] }), ['get_scene'], new Set(), true)).toThrow('MINIMAX_INVALID_TOOL_RESPONSE');
    expect(() => parseMiniMaxToolTurn(response({ role: 'assistant', tool_calls: [call('a', 'submit_candidates'), call('b', 'submit_candidates')] }), ['submit_candidates'], new Set(), true)).toThrow('MINIMAX_INVALID_TOOL_RESPONSE');
    expect(() => miniMaxRoundTools([tools[0]!, tools[0]!], true)).toThrow('MINIMAX_INVALID_TOOL_RESPONSE');
    expect(() => parseMiniMaxToolTurn(response({ role: 'assistant', tool_calls: [call('a')] }), ['get_scene'], new Set(['a']))).toThrow('MINIMAX_INVALID_TOOL_RESPONSE');
  });

  it.each([
    '{"amount":1e400}',
    '{"amount":9007199254740993}',
    '{"amount":1e-999}',
    '{"x":1,"x":2}',
    '{"x":1,"\\u0078":2}',
    '{"a":{"x":1,"x":2}}',
    '{"__proto__":{"unsafe":true}}',
    '{"a":' + '['.repeat(33) + '0' + ']'.repeat(33) + '}',
    '{"x":01}',
  ])('rejects ambiguous, nonfinite or over-deep tool JSON', args => {
    const raw = response({ role: 'assistant', tool_calls: [call('a', 'get_scene', args)] });
    expect(() => parseMiniMaxToolTurn(raw, ['get_scene'], new Set())).toThrow('MINIMAX_INVALID_TOOL_RESPONSE');
  });
  it('requires the caller to supply the previous ID set before validating any batch', () => {
    const raw = response({ role: 'assistant', tool_calls: [call('a')] });
    expect(() => parseMiniMaxToolTurn(raw, ['get_scene'], undefined as never)).toThrow('MINIMAX_INVALID_TOOL_RESPONSE');
    expect(() => parseMiniMaxToolTurn(response({ role: 'assistant', tool_calls: [call('a'), call('b')] }), ['get_scene'], new Set(['b']))).toThrow('MINIMAX_INVALID_TOOL_RESPONSE');
  });
  it('bounds the raw stream before JSON parsing, including discarded top-level data', async () => {
    const valid = response({ role: 'assistant', content: 'ok' }, 'stop');
    expect(await readBoundedMiniMaxJson(new Response(JSON.stringify(valid)))).toEqual(valid);
    const oversized = { ...valid, usage: { extra: 'x'.repeat(MAX_MINIMAX_RESPONSE_BYTES) } };
    await expect(readBoundedMiniMaxJson(new Response(JSON.stringify(oversized)))).rejects.toThrow('MINIMAX_INVALID_TOOL_RESPONSE');
    await expect(readBoundedMiniMaxJson(new Response(new Uint8Array([0xff, 0xfe])))).rejects.toThrow('MINIMAX_INVALID_TOOL_RESPONSE');
  });

  it('keeps the real provider entry closed for tool workflows', () => {
    const env: Record<string, string> = { AGENT_CHAT_PROFILE: 'minimax', AGENT_CHAT_BASE_URL: 'https://api.minimax.cn/v1', AGENT_CHAT_KEY: 'fixture', AGENT_CHAT_MODEL: 'MiniMax-M3.1-Flash' };
    expect(() => chatRequest(key => env[key], { messages: [], tools })).toThrow('MODEL_PROVIDER_UNSUPPORTED_WORKFLOW');
  });
});
