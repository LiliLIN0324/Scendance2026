import { readMaterialCheckins } from '../../../lib/material-checkin-storage';
import type { SitePlanData } from '../../../../supabase/functions/_shared/site-plan';
import type { DesignVariant, RoomLayout } from './types';

export const LOCAL_HANDOFF_CLOUD_MESSAGE = '当前草稿包含本地执行信息或制作计划，暂不能作为完整云项目打开或保存。请先保留项目备份。助手的场景连接不会迁移这些资料，当前草稿已保留。';
export const LOCAL_CHECKIN_CLOUD_MESSAGE = '当前项目有本机数量点验账册，暂不能作为完整云项目打开或保存。请先保留项目备份。原账册和场景已保留，点验记录不会迁移或发送给模型。';
export const LOCAL_RECORDS_READ_MESSAGE = '本机点验记录未能完整读取，暂时不能确认云转换不会丢失资料。请先核对本机记录或备份，原场景和资料已保留。';

/**
 * D6-4-5（拍板 4.4）过渡期口径：当前仍扫内嵌 `productionPlan/eventOperations/handoff`
 * 拦转云，判定行为本片不改。e 片剥离内嵌业务副本后，守卫须改认「有未上云的 ref
 * 或本机点验账册」为判定——记录已随云走则不拦；届时再切，不在本片落地。
 */
export function hasLocalHandoff(layout: RoomLayout): boolean {
  const layouts = [layout], visited = new Set<RoomLayout>();
  while (layouts.length) {
    const value = layouts.pop()!;
    if (visited.has(value)) continue;
    visited.add(value);
    if (value.productionPlan !== undefined || value.eventOperations !== undefined || value.floors.some(floor => floor.items.some(item => item.handoff !== undefined))) return true;
    layouts.push(...(value.designBook?.variants.map(variant => variant.layout) ?? []));
  }
  return false;
}

export function assertNoLocalHandoffCloudTransition(layout: RoomLayout): void {
  if (hasLocalHandoff(layout)) throw new Error(LOCAL_HANDOFF_CLOUD_MESSAGE);
}

/** Independent facts are outside RoomLayout and must be read at each asynchronous cloud boundary. */
export async function assertNoLocalRecordsCloudTransition(
  layout: RoomLayout,
  projectId?: string,
  refs?: CloudGuardRefsInput,
): Promise<void> {
  assertNoLocalHandoffCloudTransition(layout);
  const anchorId = projectId?.trim() || layout.id;
  const guardRefs = refs ?? {};
  if (!anchorId) {
    if (classifyCloudGuard(guardRefs, false).shouldBlock) throw new Error(LOCAL_HANDOFF_CLOUD_MESSAGE);
    return;
  }
  let ledger: unknown;
  try { ledger = await readMaterialCheckins(anchorId); }
  catch { throw new Error(LOCAL_RECORDS_READ_MESSAGE); }
  const classification = classifyCloudGuard(guardRefs, ledger !== undefined);
  if (!classification.shouldBlock) return;
  if (ledger !== undefined) throw new Error(LOCAL_CHECKIN_CLOUD_MESSAGE);
  throw new Error(LOCAL_HANDOFF_CLOUD_MESSAGE);
}

/** 未随云走的业务引用槽位。 */
export type PendingRefKind = 'operations' | 'plan' | 'scan';

export interface CloudGuardRefsInput {
  operationsRef?: string;
  planRef?: string;
  scan?: { assetId?: string; name?: string | undefined };
}

export interface CloudGuardClassification {
  /** 非空、待确认是否随云走的引用（本 helper 只按非空分类，可达性由上游判定）。 */
  pendingRefs: PendingRefKind[];
  /** 本机点验账册存在（布尔直传，或传账册数组按非空判定）。 */
  hasLocalLedger: boolean;
  /** 任一未上云引用或本机账册在 → 拦转云。 */
  shouldBlock: boolean;
}

/**
 * 云守卫分类纯 helper（T1 E5）：e 片写侧剥离内嵌副本后，守卫改认「有未上云的 ref
 * 或本机点验账册」为拦。本轮只导出、不被现役调用；**切换点在 S1 读侧贯通之后**，
 * 现役 `hasLocalHandoff` 过渡期双扫内嵌副本的行为不改。
 *
 * 口径：空 / 空白 ref 不算未上云；账册在即判未上云；两者都无放行。
 */
export function classifyCloudGuard(
  refs: CloudGuardRefsInput,
  localLedger: boolean | readonly unknown[],
): CloudGuardClassification {
  const pendingRefs: PendingRefKind[] = [];
  if (refs.operationsRef?.trim()) pendingRefs.push('operations');
  if (refs.planRef?.trim()) pendingRefs.push('plan');
  if (refs.scan?.assetId?.trim()) pendingRefs.push('scan');
  const hasLocalLedger = typeof localLedger === 'boolean' ? localLedger : localLedger.length > 0;
  return { pendingRefs, hasLocalLedger, shouldBlock: pendingRefs.length > 0 || hasLocalLedger };
}

/** 守卫归集来源：顶层 plan 正源 + 当前画布变体条目。 */
export interface GuardRefSource {
  plan?: Pick<SitePlanData, 'operationsRef' | 'planRef' | 'scan'> | null | undefined;
  variants?: Partial<DesignVariant>[] | null | undefined;
}

/**
 * 归集未上云业务引用（纯同步、不碰存储/网络）：顶层 plan 优先，变体条目按槽位补充；
 * 空白剔除、同槽去重，不把外发剥离后的 share 快照当来源。归集结果只作「是否有待核引用」
 * 分类；记录是否已随云走的可达性由上游云边界判定，本函数不查。
 */
export function collectCloudGuardRefs(source: GuardRefSource): CloudGuardRefsInput {
  const refs: CloudGuardRefsInput = {};
  const plan = source.plan;
  if (plan?.operationsRef?.trim()) refs.operationsRef = plan.operationsRef.trim();
  if (plan?.planRef?.trim()) refs.planRef = plan.planRef.trim();
  const planScan = plan?.scan;
  const planScanAsset = planScan?.assetId?.trim();
  if (planScanAsset) refs.scan = { assetId: planScanAsset, name: planScan!.name?.trim() || undefined };
  for (const variant of source.variants ?? []) {
    if (!refs.operationsRef && variant.operationsRef?.trim()) refs.operationsRef = variant.operationsRef.trim();
    if (!refs.planRef && variant.planRef?.trim()) refs.planRef = variant.planRef.trim();
    if (!refs.scan?.assetId && variant.scan?.assetId?.trim()) {
      refs.scan = { assetId: variant.scan!.assetId!.trim(), name: variant.scan!.name?.trim() || undefined };
    }
  }
  return refs;
}

