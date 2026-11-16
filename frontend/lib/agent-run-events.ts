import { z } from 'zod';
import { agentEventErrors, agentEventTools, agentThoughtMaxChars, agentThoughtMaxRound } from '../../supabase/functions/_shared/agent-events.ts';

/**
 * One ordered observation stream per run, two frame kinds.
 *
 * - tool frame: which whitelisted tool ran and its categorical outcome.
 * - thought frame: the model's bounded visible self-report for one round.
 *
 * Both kinds share `seq`, so a single cursor keeps them ordered. A thought is
 * never provider reasoning: the worker normalizes model-visible text before it
 * appends, and the raw `reasoning_content` never leaves the worker.
 */
const seq = z.number().int().min(1).max(128);
const toolFrameSchema = z.strictObject({
  seq,
  /** Older servers omit `kind`; only the tool kind may omit it. */
  kind: z.literal('tool').optional(),
  tool: z.enum(agentEventTools),
  stage: z.enum(['started', 'finished']),
  outcome: z.enum(['success', 'failed', 'unknown']).nullable(),
  errorCode: z.enum(agentEventErrors).nullable(),
  argsSummary: z.string().max(240).nullable().optional(),
  durationMs: z.number().int().min(0).max(300000).nullable().optional(),
  round: z.null().optional(),
  thought: z.null().optional(),
}).superRefine((event, ctx) => {
  if (event.stage === 'started' && (event.outcome !== null || event.errorCode !== null)) ctx.addIssue({ code: 'custom', message: 'invalid started event' });
  if (event.stage === 'finished' && event.outcome === null) ctx.addIssue({ code: 'custom', message: 'invalid finished event' });
  if (event.outcome !== 'failed' && event.errorCode !== null) ctx.addIssue({ code: 'custom', message: 'invalid event error' });
});

const thoughtFrameSchema = z.strictObject({
  seq,
  kind: z.literal('thought'),
  round: z.number().int().min(1).max(agentThoughtMaxRound),
  thought: z.string().min(1).max(agentThoughtMaxChars),
  tool: z.null().optional(),
  stage: z.null().optional(),
  outcome: z.null().optional(),
  errorCode: z.null().optional(),
  argsSummary: z.null().optional(),
  durationMs: z.null().optional(),
});

const frameSchema = z.union([toolFrameSchema, thoughtFrameSchema]);
const pageSchema = z.strictObject({
  events: z.array(frameSchema).max(50),
  nextCursor: z.number().int().min(0).max(128),
  mayBeIncomplete: z.literal(true),
});

export type AgentRunEvent = z.infer<typeof toolFrameSchema>;
export type AgentRunThought = z.infer<typeof thoughtFrameSchema>;
export interface AgentRunEventPage {
  /** Tool receipts only, in seq order. */
  events: AgentRunEvent[];
  /** Visible self-reports only, in seq order. */
  thoughts: AgentRunThought[];
  nextCursor: number;
  mayBeIncomplete: true;
}

/** Reject malformed/out-of-order pages and split frames by kind. Codes are deliberately not surfaced in UI. */
export function parseAgentRunEvents(value: unknown, after: number): AgentRunEventPage {
  const page = pageSchema.parse(value);
  const events: AgentRunEvent[] = [];
  const thoughts: AgentRunThought[] = [];
  let cursor = after;
  for (const frame of page.events) {
    if (frame.seq <= cursor) throw new Error('invalid event sequence');
    cursor = frame.seq;
    if (frame.kind === 'thought') thoughts.push(frame);
    else events.push(frame);
  }
  if (page.nextCursor !== cursor) throw new Error('invalid event cursor');
  return { events, thoughts, nextCursor: cursor, mayBeIncomplete: true };
}
