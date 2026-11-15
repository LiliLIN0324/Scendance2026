/**
 * 决策留痕：用户对 agent 提案说过「要」还是「不要」。
 *
 * 对标谷地工坊的「你拒绝了」——拒绝不是错误弹窗，而是对话里的一行事实：
 * 它留在时间线上，agent 带着这个否决继续想办法，用户回头也看得见自己否过什么。
 *
 * 只存内存，不写库：这些是运行期阅读用的，跨会话的正式台账仍走 review-ledger。
 */

export type AgentDecisionKind = 'approved' | 'rejected';

export interface AgentDecision {
  id: number;
  at: number;
  kind: AgentDecisionKind;
  /** 被决策的对象，如「分区提案」「流线提案」。 */
  label: string;
  /** 用户给的理由（口头改方案时的那句话），没有就不写。 */
  reason?: string;
}

/** 只留最近这么多条：留痕是给人回顾的，不是审计库。 */
const LIMIT = 20;

let seq = 0;
let decisions: AgentDecision[] = [];
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

export function recordAgentDecision(input: {
  kind: AgentDecisionKind;
  label: string;
  reason?: string | undefined;
}): AgentDecision {
  seq += 1;
  const entry: AgentDecision = {
    id: seq,
    at: Date.now(),
    kind: input.kind,
    label: input.label,
  };
  const reason = input.reason?.trim();
  if (reason) entry.reason = reason;
  decisions = [...decisions, entry].slice(-LIMIT);
  emit();
  return entry;
}

export function getAgentDecisions(): AgentDecision[] {
  return decisions;
}

export function clearAgentDecisions(): void {
  decisions = [];
  emit();
}

export function subscribeAgentDecisions(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
