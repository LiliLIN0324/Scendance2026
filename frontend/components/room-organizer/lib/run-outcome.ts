/**
 * 一次布置运行的结果账单：放进了几件、被拒了几件、没动几件、为什么是空结果。
 *
 * 以前这些数字散在卡片和气泡里，失败或空结果只剩一句「没出成」。这里把它们收成同一份
 * 结构，卡片和气泡都照这一份说，避免两处口径不一致。
 */
import type { PlanDiagnostic } from './diagnostics';
import type { PlanProposal } from './agent-proposal';

/** 账单吃的那几个数：本地候选与云端提案都能折算成它。 */
export interface OutcomeInput {
  added: number;
  removing: number;
  changed: number;
  keptLocked: number;
  dropped: number;
  diagnostics?: PlanDiagnostic[] | undefined;
  skipped?: string[] | undefined;
  blocked: string | null;
  guests?: number | null;
  seats?: number;
  seatPriority?: boolean;
  review?: boolean;
  /** 云端提案动了锁着的物料：按「被拒」记账，不装作没发生。 */
  lockedTouched?: number;
}

export interface OutcomeRefusal {
  code: PlanDiagnostic['code'] | 'LOCKED';
  count: number;
  message: string;
  /** 座位口径的缺口：这一条不是「物料被拒」，是「这块地给不起这么多人」。 */
  seats?: number;
  capacity?: number;
}

export interface RunOutcome {
  placed: number;
  moved: number;
  removed: number;
  kept: number;
  refused: OutcomeRefusal[];
  skipped: string[];
  /** 这一版没有可落地的改动时的原因；有改动就是 null。 */
  empty: string | null;
  blocked: string | null;
  guests: number | null;
  seats: number;
  seatPriority: boolean;
  review: boolean;
}

export function outcomeOfPlan(plan: PlanProposal): RunOutcome {
  return buildOutcome({
    added: plan.added, removing: plan.removing, changed: plan.moved ?? 0,
    keptLocked: plan.keptLocked, dropped: plan.dropped, diagnostics: plan.diagnostics,
    skipped: plan.skipped, blocked: plan.blocked, guests: plan.guests ?? null,
    seats: plan.seats ?? 0, seatPriority: !!plan.seatPriority, review: plan.kind === 'review',
  });
}

export function buildOutcome(input: OutcomeInput): RunOutcome {
  const refused: OutcomeRefusal[] = (input.diagnostics ?? []).map(diagnostic => ({
    code: diagnostic.code, count: diagnostic.count, message: diagnostic.message,
    ...(diagnostic.seats !== undefined ? { seats: diagnostic.seats } : {}),
    ...(diagnostic.capacity !== undefined ? { capacity: diagnostic.capacity } : {}),
  }));
  if (input.lockedTouched) refused.push({ code: 'LOCKED', count: input.lockedTouched, message: '改到了锁定的物料' });
  const placed = input.added, moved = input.changed, removed = input.removing;
  return {
    placed, moved, removed, kept: input.keptLocked,
    refused, skipped: [...(input.skipped ?? [])],
    empty: placed + moved + removed === 0
      ? '这一版没有可落地的改动：这条指令可能只是询问，或场地里没有可摆的位置。'
      : null,
    blocked: input.blocked,
    guests: input.guests ?? null,
    seats: input.seats ?? 0,
    seatPriority: !!input.seatPriority,
    review: !!input.review,
  };
}

/** 卡片里的结果行；成功、被拒、没动、空结果各一行，没有内容的不出现。 */
export function outcomeLines(outcome: RunOutcome): string[] {
  const lines: string[] = [];
  if (outcome.review) {
    if (outcome.moved) lines.push(`只挪位置，其他没动 · 挪了 ${outcome.moved} 件`);
  } else {
    const parts: string[] = [];
    if (outcome.placed) parts.push(`放进 ${outcome.placed} 件`);
    if (outcome.moved) parts.push(`挪动 ${outcome.moved} 件`);
    if (outcome.removed) parts.push(`撤掉 ${outcome.removed} 件`);
    if (parts.length) lines.push(parts.join(' · '));
  }
  // 座位缺口不按件说：卡片下面那行「座位 K / N」已经按座说过一次。把同一件事再换算成
  // 「没放进去 75 件」，读的人只会以为被拒的是物料，而不是这块地给不起这么多人。
  const material = outcome.refused.filter(refusal => refusal.count > 0);
  if (material.length) {
    const pieces = material.reduce((sum, refusal) => sum + refusal.count, 0);
    // 只有一条原因时数字不再重复一遍：「没放进去 75 件：超出场地容量 75 件」是我自己写出来的口吃。
    const reasons = material.map(refusal => (material.length === 1
      ? refusal.message
      : `${refusal.message} ${refusal.count} 件`));
    lines.push(`没放进去 ${pieces} 件：${reasons.join('、')}`);
  }
  if (outcome.kept) lines.push(`锁定 ${outcome.kept} 件我没动`);
  if (outcome.skipped.length) {
    const names = outcome.skipped.slice(0, 4).join('、');
    lines.push(`没动 ${outcome.skipped.length} 件：${names}${outcome.skipped.length > 4 ? ' 等' : ''}（锁着或没找到稳妥落点）`);
  }
  if (outcome.empty) lines.push(outcome.empty);
  return lines;
}
