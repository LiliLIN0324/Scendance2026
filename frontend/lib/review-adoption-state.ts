import type { SidecarKind } from './sidecar-records';
import type { PlanVenueScan } from '../../supabase/functions/_shared/site-plan';

/**
 * 评审采纳变体业务状态投影（T6，D6-3 全 A + D6-4 4.2）。
 *
 * 背景：评审快照 `createProjectReviewSnapshot` 是同步、detached、白名单几何投影，
 * 业务事实（活动安排 / 制作计划 / 扫描副本）不进客户包。采纳变体的业务槽在冻结前由
 * 编排层经既有读路径（`resolveSidecarRef` / `useSidecarResolution`）解析成三态；
 * 本纯函数只消费已隔离的三态结果，做分类与待核标注，不再碰存储、不发网络、不把
 * 业务事实回灌进快照包。
 *
 * 三态口径（对齐读取层与历史面板）：
 * - `record`：ref 命中独立记录，业务已关联，不标待核；
 * - `fallback-legacy`：ref 为空 / 旧变体，回落内嵌副本只读，不标待核、不复制进新记录；
 * - `missing`：ref 在但记录找不到 / 属别的项目，留空待核，不顶替、不偷换 id；
 * - `pending`：解析尚未回，视同待核，不入清单直到读取落地。
 *
 * 待核（stale）与历史面板同口径：任一业务槽 missing/pending，或登记了扫描身份却
 * 缺资产 id，即标待核；旧变体无引用回落不据此判 stale。
 */

/** 评审投影消费的槽位状态；`pending` 与读取 hook 对齐，纯函数不触发解析。 */
export type ReviewAdoptionSlotStatus = 'record' | 'fallback-legacy' | 'missing' | 'pending';

export interface ReviewAdoptionSlotInput {
  status: ReviewAdoptionSlotStatus;
}

export interface ReviewAdoptionSlotState {
  status: ReviewAdoptionSlotStatus;
  /** 是否需要在评审侧标待核：missing / pending 为 true；record / legacy 为 false。 */
  pending: boolean;
}

export interface ReviewAdoptionBusinessState {
  operations: ReviewAdoptionSlotState;
  plan: ReviewAdoptionSlotState;
  /** 采纳变体是否带可识别的扫描身份；缺身份并入 stale。 */
  scanPresent: boolean;
  /** 待核业务槽位（operations / plan）；missing 与 pending 同列。 */
  pendingKinds: SidecarKind[];
  /** 业务槽待核或缺扫描身份；几何载入不因此阻断。 */
  stale: boolean;
}

const PENDING_STATUSES: ReadonlySet<ReviewAdoptionSlotStatus> = new Set(['missing', 'pending']);

function classify(slot: ReviewAdoptionSlotInput): ReviewAdoptionSlotState {
  return { status: slot.status, pending: PENDING_STATUSES.has(slot.status) };
}

/**
 * 把采纳变体的两槽三态 + 扫描身份投影成评审编排可用的待核状态。
 * 纯函数：不读取记录、不回写输入；业务资料本身不进入返回结构。
 */
export function reviewAdoptionBusinessState(input: {
  operations: ReviewAdoptionSlotInput;
  plan: ReviewAdoptionSlotInput;
  scan?: PlanVenueScan | undefined;
}): ReviewAdoptionBusinessState {
  const operations = classify(input.operations);
  const plan = classify(input.plan);
  const scanPresent = Boolean(input.scan?.assetId?.trim());
  const pendingKinds: SidecarKind[] = [];
  if (operations.pending) pendingKinds.push('operations');
  if (plan.pending) pendingKinds.push('plan');
  const stale = operations.pending || plan.pending || !scanPresent;
  return { operations, plan, scanPresent, pendingKinds, stale };
}
