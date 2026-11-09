import { z } from 'zod';
import { ApiError } from './domain.ts';
import { readBounded } from './http.ts';

/** Pure, opt-in protocol boundary. It does not dispatch requests or persist model messages. */
const callSchema = z.strictObject({
  id: z.string().min(1).max(256).refine(value => value.trim().length > 0),
  type: z.literal('function'),
  index: z.number().int().nonnegative().optional(),
  function: z.strictObject({ name: z.string().min(1).max(128), arguments: z.string().max(32_768) }),
});
const messageSchema = z.strictObject({
  role: z.literal('assistant'),
  content: z.string().max(32_768).nullable().optional(),
  reasoning_content: z.string().max(100_000).optional(),
  name: z.string().max(128).optional(),
  audio_content: z.string().max(1024).optional(),
  tool_calls: z.array(callSchema).max(12).optional(),
});
const responseSchema = z.object({
  choices: z.array(z.object({ finish_reason: z.string(), message: messageSchema })).length(1),
  base_resp: z.object({ status_code: z.number().int() }).optional(),
});
type AssistantMessage = z.infer<typeof messageSchema>;
export type MiniMaxToolDefinition = { type: 'function'; function: { name: string; [key: string]: unknown } };

function invalid(): never { throw new ApiError('MINIMAX_INVALID_TOOL_RESPONSE', 502); }
class UnsafeToolArguments extends Error {}
function unsafe(): never { throw new UnsafeToolArguments(); }
export const MAX_MINIMAX_RESPONSE_BYTES = 150_000;

/** Limit the network stream before decoding or JSON parsing; parseMiniMaxToolTurn alone cannot do this. */
export async function readBoundedMiniMaxJson(response: Response): Promise<unknown> {
  try {
    const bytes = await readBounded(response, MAX_MINIMAX_RESPONSE_BYTES);
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown;
  } catch { return invalid(); }
}

/** JSON parser guard: reject duplicate decoded keys, nonfinite numbers and excessive depth. */
function safeToolArguments(text: string): Record<string, unknown> {
  let i = 0;
  const ws = () => { while (i < text.length && /[\x20\t\r\n]/.test(text[i]!)) i++; };
  const string = (): string => {
    const start = i;
    if (text[i++] !== '"') return invalid();
    while (i < text.length) {
      const ch = text[i++]!;
      if (ch === '\\') { if (i >= text.length) return invalid(); i++; continue; }
      if (ch === '"') {
        try { return JSON.parse(text.slice(start, i)) as string; } catch { return invalid(); }
      }
    }
    return invalid();
  };
  const value = (depth: number): void => {
    if (depth > 32) return unsafe();
    ws();
    if (text[i] === '"') { string(); return; }
    if (text[i] === '{') {
      i++; ws(); const keys = new Set<string>();
      if (text[i] === '}') { i++; return; }
      while (true) {
        ws(); const key = string();
        if (keys.has(key) || ['__proto__', 'prototype', 'constructor'].includes(key)) return unsafe();
        keys.add(key); ws(); if (text[i++] !== ':') return invalid();
        value(depth + 1); ws();
        if (text[i] === '}') { i++; return; }
        if (text[i++] !== ',') return invalid();
      }
    }
    if (text[i] === '[') {
      i++; ws(); if (text[i] === ']') { i++; return; }
      while (true) {
        value(depth + 1); ws();
        if (text[i] === ']') { i++; return; }
        if (text[i++] !== ',') return invalid();
      }
    }
    const literal = text.slice(i).match(/^(?:true|false|null)/);
    if (literal) { i += literal[0].length; return; }
    const number = text.slice(i).match(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/);
    if (!number) return invalid();
    if (!Number.isFinite(Number(number[0]))) return unsafe();
    const numeric = Number(number[0]);
    if ((Number.isInteger(numeric) && !Number.isSafeInteger(numeric)) || (numeric === 0 && /[1-9]/.test(number[0].split(/[eE]/)[0]!))) return unsafe();
    i += number[0].length;
  };
  ws(); if (text[i] !== '{') return invalid();
  value(0); ws(); if (i !== text.length) return invalid();
  try { return JSON.parse(text) as Record<string, unknown>; } catch { return invalid(); }
}

/** Final round has no other advertised actions; duplicate submit tools are configuration errors. */
export function miniMaxRoundTools<T extends MiniMaxToolDefinition>(tools: readonly T[], final: boolean): T[] {
  const names = tools.map(tool => tool.function.name);
  if (names.some(name => !name.trim()) || new Set(names).size !== names.length) return invalid();
  if (!final) return [...tools];
  const submit = tools.find(tool => tool.function.name === 'submit_candidates');
  if (!submit) return invalid();
  return [submit];
}

/** Complete assistant turn for the next model request; reasoning is never an application result. */
type ParsedCall={id:string;name:string;arguments:Record<string,unknown>};
type RecoverableCall={id:string;name:string;arguments:Record<string,unknown>|null};
export function parseMiniMaxToolTurn(raw: unknown, allowedNames: readonly string[], priorCallIds: ReadonlySet<string>, final?: boolean): {assistantMessage:AssistantMessage;calls:ParsedCall[]};
export function parseMiniMaxToolTurn(raw: unknown, allowedNames: readonly string[], priorCallIds: ReadonlySet<string>, final: boolean, recoverMalformedArguments: true): {assistantMessage:AssistantMessage;calls:RecoverableCall[]};
export function parseMiniMaxToolTurn(raw: unknown, allowedNames: readonly string[], priorCallIds: ReadonlySet<string>, final = false, recoverMalformedArguments = false): { assistantMessage: AssistantMessage; calls: RecoverableCall[] } {
  if (!priorCallIds || typeof priorCallIds.has !== 'function') return invalid();
  const parsed = responseSchema.safeParse(raw);
  if (!parsed.success || (parsed.data.base_resp && parsed.data.base_resp.status_code !== 0)) return invalid();
  const { finish_reason: finish, message } = parsed.data.choices[0];
  if (new TextEncoder().encode(JSON.stringify(message)).length > 150_000) return invalid();
  if (finish !== 'stop' && finish !== 'tool_calls') return invalid();
  const calls = message.tool_calls ?? [];
  if ((finish === 'tool_calls') !== (calls.length > 0)) return invalid();
  if (new Set(calls.map(call => call.id)).size !== calls.length) return invalid();
  if (calls.some(call => priorCallIds.has(call.id))) return invalid();
  if (new Set(allowedNames).size !== allowedNames.length) return invalid();
  if (final && (calls.length !== 1 || calls[0]?.function.name !== 'submit_candidates')) return invalid();
  const normalized = calls.map(call => {
    if (!allowedNames.includes(call.function.name)) return invalid();
    try { return { id: call.id, name: call.function.name, arguments: safeToolArguments(call.function.arguments) }; }
    catch(error) {
      // Unsafe JSON never reaches a tool, even in recoverable mode.
      if(error instanceof UnsafeToolArguments || !recoverMalformedArguments)return invalid();
      return { id: call.id, name: call.function.name, arguments: null };
    }
  });
  return { assistantMessage: message, calls: normalized };
}
