import { ApiError } from './domain.ts';
import { miniMaxRoundTools, parseMiniMaxToolTurn, type MiniMaxToolDefinition } from './minimax-tool-adapter.ts';

/** In-memory rehearsal only. This is not a durable or cross-worker execution lock. */
export type RehearsalReceipt = { fingerprint: string; state: 'reserved' | 'complete' | 'unknown'; result?: string };
export type RehearsalLedger = ReadonlyMap<string, RehearsalReceipt>;
export type ToolValidator = (input: Record<string, unknown>) => Record<string, unknown>;

function fail(): never { throw new ApiError('MINIMAX_TOOL_BATCH_REJECTED', 502); }
function stable(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map(key => `${JSON.stringify(key)}:${stable(object[key])}`).join(',')}}`;
}

/**
 * Validates every tool and its arguments before returning any actions. Caller-supplied
 * validators must be synchronous and pure. The returned ledger is a new in-memory map;
 * production needs a durable atomic claim before any external effect, and remains disabled.
 * assistantMessage contains private reasoning and is only for the next provider request.
 */
export function prepareMiniMaxToolBatch<T extends MiniMaxToolDefinition>(input: {
  raw: unknown;
  tools: readonly T[];
  validators: Readonly<Record<string, ToolValidator>>;
  ledger: RehearsalLedger;
  final: boolean;
}): {
  assistantMessage: ReturnType<typeof parseMiniMaxToolTurn>['assistantMessage'];
  nextLedger: Map<string, RehearsalReceipt>;
  actions: Array<{ id: string; name: string; arguments: Record<string, unknown>; action: 'execute' | 'replay'; result?: string }>;
} {
  if (!input.ledger || typeof input.ledger.get !== 'function' || typeof input.ledger.entries !== 'function') return fail();
  const offered = miniMaxRoundTools(input.tools, input.final);
  const allowed = offered.map(tool => tool.function.name);
  // The adapter checks duplicates inside the whole message. Prior IDs are compared with
  // fingerprints below so a completed identical call can be replayed without executing it.
  const turn = parseMiniMaxToolTurn(input.raw, allowed, new Set(), input.final);
  const nextLedger = new Map(input.ledger);
  const actions: Array<{ id: string; name: string; arguments: Record<string, unknown>; action: 'execute' | 'replay'; result?: string }> = [];
  for (const call of turn.calls) {
    const validate = Object.hasOwn(input.validators, call.name) ? input.validators[call.name] : undefined;
    if (typeof validate !== 'function') return fail();
    let args: Record<string, unknown>;
    try { args = validate(call.arguments); } catch { return fail(); }
    if (!args || typeof args !== 'object' || Array.isArray(args)) return fail();
    const fingerprint = stable({ name: call.name, arguments: call.arguments });
    const previous = input.ledger.get(call.id);
    if (previous) {
      if (previous.fingerprint !== fingerprint || previous.state !== 'complete' || typeof previous.result !== 'string' || new TextEncoder().encode(previous.result).length > 32_768) return fail();
      actions.push({ id: call.id, name: call.name, arguments: args, action: 'replay', result: previous.result });
    } else {
      nextLedger.set(call.id, { fingerprint, state: 'reserved' });
      actions.push({ id: call.id, name: call.name, arguments: args, action: 'execute' });
    }
  }
  return { assistantMessage: turn.assistantMessage, nextLedger, actions };
}

/** Complete only a reserved in-memory action after the caller has obtained its result. */
export function completeRehearsalReceipt(ledger: RehearsalLedger, id: string, result: string): Map<string, RehearsalReceipt> {
  const receipt = ledger.get(id);
  if (!receipt || receipt.state !== 'reserved' || typeof result !== 'string' || new TextEncoder().encode(result).length > 32_768) return fail();
  const next = new Map(ledger);
  next.set(id, { fingerprint: receipt.fingerprint, state: 'complete', result });
  return next;
}
