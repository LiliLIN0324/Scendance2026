import { describe, expect, it } from 'vitest';
import { parseAgentModelReply } from '../supabase/functions/_shared/agent-model-reply.ts';
import { ApiError } from '../supabase/functions/_shared/domain.ts';

const tool = (id = 'call-1') => ({ id, type: 'function', function: { name: 'get_scene', arguments: '{}' } });
const reply = (calls: unknown[], content: string | null = null) => ({
  choices: [{ finish_reason: 'tool_calls', message: { content, tool_calls: calls } }], usage: { total_tokens: 10 },
});

describe('bounded Agent model reply boundary', () => {
  it('normalizes a tool reply without changing IDs or argument text', () => {
    const call = { ...tool(' opaque-ID '), function: { name: 'submit_candidates', arguments: '{ "candidates": [] }' } };
    expect(parseAgentModelReply(reply([call], 'candidate explanation'))).toEqual({
      finishReason: 'tool_calls', content: 'candidate explanation', toolCalls: [call], usage: { total_tokens: 10 },
    });
  });

  it('keeps ordinary or empty answers as text without inventing tools or usage', () => {
    expect(parseAgentModelReply({ choices: [{ finish_reason: 'stop', message: { content: '请补充场地尺寸' } }] })).toEqual({
      finishReason: 'stop', content: '请补充场地尺寸', toolCalls: [], usage: {},
    });
    expect(parseAgentModelReply({ choices: [{ finish_reason: null, message: {} }] })).toEqual({
      finishReason: null, content: null, toolCalls: [], usage: {},
    });
  });

  it.each(['', ' \t\n '])('rejects blank call ID %s before dispatch', id => {
    expect(() => parseAgentModelReply(reply([tool(id)]))).toThrow('AGENT_INVALID_MODEL_RESPONSE');
  });

  it('rejects the entire mixed batch when two calls have the same ID', () => {
    const first = tool('duplicate');
    const second = { ...tool('duplicate'), function: { name: 'create_parametric_model', arguments: '{"parameters":{}}' } };
    expect(() => parseAgentModelReply(reply([first, second]))).toThrow('AGENT_INVALID_MODEL_RESPONSE');
    expect(parseAgentModelReply(reply([tool('A'), tool('a')])).toolCalls).toHaveLength(2);
  });

  it('keeps the existing twelve-call limit', () => {
    expect(parseAgentModelReply(reply(Array.from({ length: 12 }, (_, i) => tool(String(i))))).toolCalls).toHaveLength(12);
    expect(() => parseAgentModelReply(reply(Array.from({ length: 13 }, (_, i) => tool(String(i)))))).toThrow('AGENT_INVALID_MODEL_RESPONSE');
  });

  it('rejects malformed model structures with a stable error code', () => {
    for (const raw of [
      null, {}, { choices: [] }, { choices: [{ finish_reason: 'stop', message: { content: {} } }] },
      reply([{ ...tool(), type: 'shell' }]), reply([{ ...tool(), function: { name: 'get_scene', arguments: {} } }]),
    ]) expect(() => parseAgentModelReply(raw)).toThrow('AGENT_INVALID_MODEL_RESPONSE');
  });

  it('leaves tool permissions and argument validation to the domain dispatcher', () => {
    const call = { ...tool(), function: { name: 'not_registered', arguments: 'not-json' } };
    expect(parseAgentModelReply(reply([call])).toolCalls[0]).toEqual(call);
  });

  it('does not echo model text, arguments or usage into errors', () => {
    const marker = 'fake-sensitive-model-payload';
    try {
      parseAgentModelReply({
        choices: [{ finish_reason: 'tool_calls', message: { content: marker, tool_calls: [{ ...tool(''), function: { name: marker, arguments: marker } }] } }],
        usage: { private: marker },
      });
      expect.fail('invalid call ID must not be accepted');
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect(error).toMatchObject({ code: 'AGENT_INVALID_MODEL_RESPONSE', status: 502 });
      expect(JSON.stringify((error as ApiError).details)).not.toContain(marker);
      expect((error as Error).message).not.toContain(marker);
    }
  });
});
