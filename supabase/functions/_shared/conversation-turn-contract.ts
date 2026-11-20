import { z } from 'zod';

/**
 * 一轮对话的服务端留痕契约。
 * 不管这轮是否调用了模型，都写入同一条形状：
 * 本地命令、模型问答、Agent 运行只差 surface 与 outcome。
 */
export const conversationSurfaceSchema = z.enum(['brief', 'assistant', 'agent', 'activity', 'local_command']);
export const conversationOutcomeSchema = z.enum(['answered', 'preview', 'applied', 'failed', 'local_only', 'queued']);

/** 前端随对话请求一起带的轮次标识；缺省时服务端按请求键补。 */
export const conversationTraceSchema = z.strictObject({
  turnKey: z.string().uuid(),
  sessionId: z.string().trim().min(1).max(120),
  turnIndex: z.number().int().min(0).max(100000),
});

export const conversationToolSummarySchema = z.strictObject({
  tool: z.string().trim().min(1).max(64),
  outcome: z.enum(['success', 'failed', 'unknown']).optional(),
});

export const conversationTurnSchema = z.strictObject({
  turnKey: z.string().uuid(),
  sessionId: z.string().trim().min(1).max(120),
  turnIndex: z.number().int().min(0).max(100000),
  surface: conversationSurfaceSchema,
  userText: z.string().trim().min(1).max(8000),
  assistantText: z.string().max(40000).optional(),
  provider: z.string().trim().min(1).max(64).optional(),
  model: z.string().trim().min(1).max(120).optional(),
  toolSummary: z.array(conversationToolSummarySchema).max(128).optional(),
  outcome: conversationOutcomeSchema,
  errorCode: z.string().trim().min(1).max(64).optional(),
  latencyMs: z.number().int().min(0).max(600000).optional(),
  agentRunId: z.string().uuid().optional(),
  projectId: z.string().uuid().optional(),
});
export type ConversationTurn = z.infer<typeof conversationTurnSchema>;

/** 本机命令没有后端请求可挂，由前端批量补记；一轮也不丢。 */
export const conversationTurnBatchSchema = z.strictObject({
  turns: z.array(conversationTurnSchema).min(1).max(20),
});

/** 仅服务端内部使用：给 RPC 补 projectId，前端不直接调 RPC。 */
export function conversationTurnPayload(turn: ConversationTurn, projectId?: string) {
  return {
    turnKey: turn.turnKey,
    sessionId: turn.sessionId,
    turnIndex: turn.turnIndex,
    surface: turn.surface,
    userText: turn.userText,
    ...(turn.assistantText ? { assistantText: turn.assistantText } : {}),
    ...(turn.provider ? { provider: turn.provider } : {}),
    ...(turn.model ? { model: turn.model } : {}),
    ...(turn.toolSummary?.length ? { toolSummary: turn.toolSummary } : {}),
    outcome: turn.outcome,
    ...(turn.errorCode ? { errorCode: turn.errorCode } : {}),
    ...(turn.latencyMs !== undefined ? { latencyMs: turn.latencyMs } : {}),
    ...(turn.agentRunId ? { agentRunId: turn.agentRunId } : {}),
    ...(projectId ?? turn.projectId ? { projectId: projectId ?? turn.projectId } : {}),
  };
}
