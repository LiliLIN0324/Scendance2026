import { describe, expect, it, vi } from 'vitest';
import { completeRehearsalReceipt, prepareMiniMaxToolBatch, type RehearsalLedger } from '../supabase/functions/_shared/minimax-tool-rehearsal.ts';
import { chatRequest } from '../supabase/functions/_shared/providers.ts';

const tools = [
  { type: 'function' as const, function: { name: 'get_scene' } },
  { type: 'function' as const, function: { name: 'submit_candidates' } },
];
const validators = {
  get_scene: (input: Record<string, unknown>) => { if (input.invalid) throw new Error('sensitive'); return input; },
  submit_candidates: (input: Record<string, unknown>) => { if (!Array.isArray(input.candidates)) throw new Error('sensitive'); return input; },
};
const call = (id: string, name: string, args: string) => ({ id, type: 'function', function: { name, arguments: args } });
const raw = (calls: unknown[]) => ({ choices: [{ finish_reason: 'tool_calls', message: { role: 'assistant', reasoning_content: 'private-thought', content: null, tool_calls: calls } }] });

describe('MiniMax tool batch in-memory rehearsal', () => {
  it('claims a whole valid batch in a new ledger without executing tools or mutating the original', () => {
    const ledger: RehearsalLedger = new Map();
    const result = prepareMiniMaxToolBatch({ raw: raw([call('a', 'get_scene', '{}'), call('b', 'submit_candidates', '{"candidates":[]}' )]), tools, validators, ledger, final: false });
    expect(ledger.size).toBe(0);
    expect(result.nextLedger.size).toBe(2);
    expect(result.actions.map(action => action.action)).toEqual(['execute', 'execute']);
    expect(result.assistantMessage.reasoning_content).toBe('private-thought');
  });
  it('rejects the whole batch if a later tool is invalid and never mutates the source ledger', () => {
    const ledger = new Map();
    expect(() => prepareMiniMaxToolBatch({ raw: raw([call('a', 'get_scene', '{}'), call('b', 'get_scene', '{"invalid":true}')]), tools, validators, ledger, final: false })).toThrow('MINIMAX_TOOL_BATCH_REJECTED');
    expect(ledger.size).toBe(0);
  });
  it('replays an identical completed ID without execution and rejects changed or unfinished calls', () => {
    const initial = prepareMiniMaxToolBatch({ raw: raw([call('a', 'get_scene', '{"x":1,"y":2}')]), tools, validators, ledger: new Map(), final: false });
    const complete = completeRehearsalReceipt(initial.nextLedger, 'a', '{"ok":true}');
    const replay = prepareMiniMaxToolBatch({ raw: raw([call('a', 'get_scene', '{"y":2,"x":1}')]), tools, validators, ledger: complete, final: false });
    expect(replay.actions).toMatchObject([{ id: 'a', action: 'replay', result: '{"ok":true}' }]);
    expect(() => prepareMiniMaxToolBatch({ raw: raw([call('a', 'get_scene', '{"x":9}')]), tools, validators, ledger: complete, final: false })).toThrow('MINIMAX_TOOL_BATCH_REJECTED');
    expect(() => prepareMiniMaxToolBatch({ raw: raw([call('a', 'get_scene', '{"x":1,"y":2}')]), tools, validators, ledger: initial.nextLedger, final: false })).toThrow('MINIMAX_TOOL_BATCH_REJECTED');
    const unknown = new Map(initial.nextLedger);
    unknown.set('a', { ...unknown.get('a')!, state: 'unknown' });
    expect(() => prepareMiniMaxToolBatch({ raw: raw([call('a', 'get_scene', '{"x":1,"y":2}')]), tools, validators, ledger: unknown, final: false })).toThrow('MINIMAX_TOOL_BATCH_REJECTED');
    expect(() => completeRehearsalReceipt(complete, 'a', '{}')).toThrow('MINIMAX_TOOL_BATCH_REJECTED');
  });
  it('prevents non-submit tools or invalid submit arguments on the last round', () => {
    expect(() => prepareMiniMaxToolBatch({ raw: raw([call('a', 'get_scene', '{}')]), tools, validators, ledger: new Map(), final: true })).toThrow();
    expect(() => prepareMiniMaxToolBatch({ raw: raw([call('b', 'submit_candidates', '{}')]), tools, validators, ledger: new Map(), final: true })).toThrow('MINIMAX_TOOL_BATCH_REJECTED');
  });
  it('returns stable errors without returning private reasoning or validator text', () => {
    try { prepareMiniMaxToolBatch({ raw: raw([call('x', 'get_scene', '{"invalid":true}')]), tools, validators, ledger: new Map(), final: false }); }
    catch (error) { expect(JSON.stringify(error)).not.toMatch(/private-thought|sensitive/); }
  });
  it('does not dispatch or enable the production MiniMax tool path', () => {
    const fetcher = vi.fn();
    const env: Record<string, string> = { AGENT_CHAT_PROFILE: 'minimax', AGENT_CHAT_BASE_URL: 'https://api.minimax.cn/v1', AGENT_CHAT_KEY: 'fixture', AGENT_CHAT_MODEL: 'MiniMax-M3.1-Flash' };
    expect(() => chatRequest(key => env[key], { messages: [], tools })).toThrow('MODEL_PROVIDER_UNSUPPORTED_WORKFLOW');
    expect(fetcher).not.toHaveBeenCalled();
  });
});
