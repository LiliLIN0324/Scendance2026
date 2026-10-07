import { z } from 'zod';
import { ApiError } from './domain.ts';

const toolCallSchema = z.object({
  id: z.string().refine(id => id.trim().length > 0, 'Tool call ID must be nonblank'),
  type: z.literal('function'),
  function: z.object({ name: z.string(), arguments: z.string() }),
});
const toolCallsSchema = z.array(toolCallSchema).max(12)
  .refine(calls => new Set(calls.map(call => call.id)).size === calls.length, 'Tool call IDs must be unique within a reply');
const replySchema = z.object({
  choices: z.array(z.object({
    finish_reason: z.string().nullable(),
    message: z.object({ content: z.string().nullable().optional(), tool_calls: toolCallsSchema.optional() }),
  })).min(1),
  usage: z.unknown().optional(),
});

export interface AgentModelReply {
  finishReason: string | null;
  content: string | null;
  toolCalls: z.infer<typeof toolCallsSchema>;
  usage: unknown;
}

/** Validate the entire batch before dispatch: ambiguous IDs must not cause partial tool effects. */
export function parseAgentModelReply(raw: unknown): AgentModelReply {
  const parsed = replySchema.safeParse(raw);
  if (!parsed.success) {
    throw new ApiError('AGENT_INVALID_MODEL_RESPONSE', 502, {
      issues: parsed.error.issues.map(issue => ({ path: issue.path, code: issue.code })),
    });
  }
  const choice = parsed.data.choices[0];
  return {
    finishReason: choice.finish_reason,
    content: choice.message.content ?? null,
    toolCalls: choice.message.tool_calls ?? [],
    usage: parsed.data.usage ?? {},
  };
}
