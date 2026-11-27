import type { EventOperations } from '../../../../supabase/functions/_shared/event-operations-contract';
import type { ProductionPlan } from '../../../../supabase/functions/_shared/production-plan-contract';
import type { PlanVenueScan } from '../../../../supabase/functions/_shared/site-plan';
import type { SidecarKind } from '../../../lib/sidecar-records';
import type { SidecarResolution } from '../hooks/use-sidecar-resolution';
import type { DesignVariant, RoomLayout, VariantSummary } from './types';
import { stripVariantBusinessKeys } from './variant-business-keys';

/**
 * E3 逐变体「另存为新场地」纯层（D6-3 全 A + D6-4 4.3-C，2026-11-28）。
 *
 * 口径：
 * - 几何物料走变体快照；新草稿不沿用旧条目 id、不内嵌业务副本三键。
 * - 业务事实不复制整包记录：只有 `record` 态的资料进入待落清单，由壳编排到新项目侧
 *   重新落独立侧车记录、生成新 recordId 再挂 ref；旧 recordId 不沿用、不偷换。
 * - `fallback-legacy`（旧变体内嵌副本只读）/ `missing`（找不到或属别项目）/ `pending`
 *   （解析未回）：业务槽标待核，不把内嵌副本写进新记录，不拿当前最新记录顶替。
 * - 冻结摘要与扫描身份随另存保留；摘要缺失留空待核，不从几何快照现场粗算。
 * - 纯函数：不碰存储、不 async、不回写入参。异 projectId 隔离由读取层
 *   （`useSidecarResolution` / `resolveSidecarRef`）保证，本层只消费已隔离的三态结果。
 */

/** 待在新项目侧重新落盘的独立侧车记录；新记录 id 由壳保存时生成，此处只带资料与槽位。 */
export interface VariantSaveAsSidecarEntry {
  kind: SidecarKind;
  data: EventOperations | ProductionPlan;
}

/** 另存产出：新草稿几何 + 待落记录清单 + 待挂 ref 槽位 + 待核业务槽 + 保留摘要 / 扫描身份。 */
export interface VariantSaveAsDraft {
  draft: RoomLayout;
  sidecarEntries: readonly VariantSaveAsSidecarEntry[];
  pendingRefs: { operations: boolean; plan: boolean };
  /** 业务槽待核：legacy 内嵌回落 / missing 找不到 / pending 未回。 */
  missingKinds: readonly SidecarKind[];
  /** 是否有槽位回落自旧整包内嵌副本（只读，未复制进新记录）。 */
  legacyUsed: boolean;
  summary?: VariantSummary | undefined;
  scan?: PlanVenueScan | undefined;
}

export interface VariantSaveAsInput {
  /** 变体所属项目（隔离上下文；异项目判定在读取层完成）。 */
  sourceProjectId: string;
  variant: DesignVariant;
  operations?: SidecarResolution<EventOperations>;
  plan?: SidecarResolution<ProductionPlan>;
}

type SlotReason = 'record' | 'legacy' | 'missing' | 'pending' | 'absent';

interface SlotDecision {
  entry?: VariantSaveAsSidecarEntry;
  pending: boolean;
  reason: SlotReason;
}

function decideSlot(
  kind: SidecarKind,
  slot: SidecarResolution<EventOperations | ProductionPlan> | undefined,
): SlotDecision {
  if (!slot) return { pending: false, reason: 'absent' };
  switch (slot.status) {
    case 'record':
      return slot.data
        ? { entry: { kind, data: slot.data }, pending: true, reason: 'record' }
        : { pending: false, reason: 'missing' };
    case 'fallback-legacy':
      return { pending: false, reason: 'legacy' };
    case 'missing':
      return { pending: false, reason: 'missing' };
    case 'pending':
      return { pending: false, reason: 'pending' };
  }
}

/**
 * 把变体几何 + 冻结 meta/ref + 已解析的业务三态，落成「可交给壳编排另存」的形状。
 * 异步解析、建项目、落记录、挂 ref 归壳或面板编排层；本函数只产出静态计划。
 */
export function prepareVariantSaveAs(input: VariantSaveAsInput): VariantSaveAsDraft {
  const { variant, operations, plan } = input;

  const operationsDecision = decideSlot('operations', operations);
  const planDecision = decideSlot('plan', plan);

  const sidecarEntries: VariantSaveAsSidecarEntry[] = [];
  const missingKinds: SidecarKind[] = [];
  let legacyUsed = false;

  const collect = (decision: SlotDecision, kind: SidecarKind): void => {
    if (decision.entry) sidecarEntries.push(decision.entry);
    if (decision.reason === 'legacy') legacyUsed = true;
    if (decision.reason === 'legacy' || decision.reason === 'missing' || decision.reason === 'pending') {
      missingKinds.push(kind);
    }
  };
  collect(operationsDecision, 'operations');
  collect(planDecision, 'plan');

  const stripped = stripVariantBusinessKeys(variant.layout);
  const draft: RoomLayout = { ...stripped, name: variant.name?.trim() || stripped.name };
  // 另存为新场地：旧条目 id 不沿用；新草稿 id 与新记录 id 由壳编排生成。
  delete draft.id;

  return {
    draft,
    sidecarEntries,
    pendingRefs: { operations: operationsDecision.pending, plan: planDecision.pending },
    missingKinds,
    legacyUsed,
    summary: variant.summary,
    scan: variant.scan,
  };
}
