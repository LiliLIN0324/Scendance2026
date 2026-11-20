import { operationObjectReview } from './event-operations';
import { resolveProductionPlanReferences, productionEstimateSummary, type ProductionPlan } from '../../../../supabase/functions/_shared/production-plan-contract';
import type { RoomLayout, FurnitureItem } from './types';
import type { EventOperationTask } from '../../../../supabase/functions/_shared/event-operations-contract';
import type { MaterialCheckinLedger, MaterialCheckinIssueCode } from '../../../../supabase/functions/_shared/material-checkin-contract';
import { materialCheckinSummary } from '../../../../supabase/functions/_shared/material-checkin-contract';

/**
 * 核对段（只读）：把活动任务、物件工作单、制作计划、数量点验里尚未闭环的缺口聚合成一屏。
 * 只扫描既有本机台账，不产生新记录、不写状态；缺口提示供人回到对应表单补全。
 */

export type DeliveryGapGroup = 'operations' | 'workorders' | 'plan' | 'checkins';

export interface DeliveryGap {
  id: string;
  group: DeliveryGapGroup;
  title: string;
  details: string[];
  /** 任务 / 物件 / 计划行 / 点验单编号，供定位与跳转。 */
  refId?: string;
  /** 画布物件编号；仅物件类缺口可直接定位。 */
  objectId?: string;
}

export interface DeliveryReviewSummary {
  gaps: DeliveryGap[];
  counts: Record<DeliveryGapGroup, number>;
  total: number;
}

const CHECKIN_ISSUE_LABELS: Record<MaterialCheckinIssueCode, string> = {
  'agreement-unknown': '约定数量尚未记录',
  'quantity-unknown': '存在数量待核或未知的收发记录',
  disputed: '存在争议的点验记录',
  'missing-time': '已核记录缺发生时间',
  'time-after-recording': '发生时间晚于记录时间',
  'recording-time-conflict': '记录时间顺序存在冲突',
  'return-before-receipt': '归还早于对应收货',
  'over-received': '收货数量超过约定',
  'over-returned': '归还数量超过收货',
  'quantity-overflow': '数量合计超出安全范围',
};

const blank = (value: string | null | undefined): boolean => !value || !value.trim();

function pushGap(gaps: DeliveryGap[], group: DeliveryGapGroup, title: string, details: string[], refId?: string, objectId?: string): void {
  const clean = [...new Set(details.filter(Boolean))];
  if (!clean.length) return;
  gaps.push({ id: `${group}:${refId ?? gaps.length}`, group, title: title.trim() || '未命名记录', details: clean, ...(refId ? { refId } : {}), ...(objectId ? { objectId } : {}) });
}

function reviewTask(layout: RoomLayout, task: EventOperationTask): string[] {
  const details: string[] = [];
  if (blank(task.ownerName)) details.push('缺负责人');
  if (blank(task.acceptance)) details.push('缺完成条件');
  if (task.plannedStartAt === null || task.plannedEndAt === null) details.push('缺计划时间');
  if (task.status === 'accepted' && blank(task.evidenceNote)) details.push('已完成但缺现场核对说明');
  if (task.status === 'accepted' && blank(task.reviewedBasis)) details.push('已完成但缺核对依据');
  const objects = operationObjectReview(layout, task);
  if (objects.missingObjectIds.length > 0) details.push(`关联物料缺失 ${objects.missingObjectIds.length} 件`);
  if (objects.ambiguousObjectIds.length > 0) details.push(`关联物料有 ${objects.ambiguousObjectIds.length} 件重复，需明确`);
  if (objects.missingProductionObjectIds.length > 0) details.push(`计划引用物料缺失 ${objects.missingProductionObjectIds.length} 件`);
  if (objects.ambiguousProductionObjectIds.length > 0) details.push(`计划引用物料有 ${objects.ambiguousProductionObjectIds.length} 件重复，需明确`);
  return details;
}

function reviewWorkorder(item: FurnitureItem): string[] {
  const handoff = item.handoff;
  if (!handoff) return [];
  const details: string[] = [];
  if (blank(handoff.ownerName)) details.push('缺负责人');
  if (blank(handoff.dueDate)) details.push('缺期限');
  if (blank(handoff.acceptance)) details.push('缺验收条件');
  if ((handoff.status === 'review' || handoff.status === 'accepted') && handoff.evidenceUrls.length === 0 && blank(handoff.evidenceNote)) details.push('缺证据链接或验收说明');
  if (handoff.status === 'accepted' && blank(handoff.reviewedBasis)) details.push('缺核对依据');
  return details;
}

interface PlanKnownRefs { taskIds: readonly string[]; objectIds: readonly string[] }

function reviewPlan(plan: ProductionPlan, known: PlanKnownRefs, gaps: DeliveryGap[]): void {
  const refs = resolveProductionPlanReferences(plan, known);
  for (const row of refs) {
    const details: string[] = [];
    if (row.unassigned) details.push(row.kind === 'staffing' ? '人员未关联任务' : '来源未关联任务或物件');
    if (row.missingTaskIds.length > 0) details.push(`任务引用缺失 ${row.missingTaskIds.length} 项`);
    if (row.ambiguousTaskIds.length > 0) details.push(`任务引用有 ${row.ambiguousTaskIds.length} 项重复，需明确`);
    if (row.missingObjectIds.length > 0) details.push(`物件引用缺失 ${row.missingObjectIds.length} 项`);
    if (row.ambiguousObjectIds.length > 0) details.push(`物件引用有 ${row.ambiguousObjectIds.length} 项重复，需明确`);
    const source = [...plan.staffing, ...plan.acquisitions, ...plan.estimates].find(entry => entry.id === row.id);
    const title = source && 'roleName' in source ? source.roleName : source?.title ?? '计划行';
    if (row.kind === 'staffing') {
      const staffing = plan.staffing.find(entry => entry.id === row.id);
      if (staffing?.headcount === null) details.push('人数待核');
      if (staffing?.sourceType === 'unspecified') details.push('用工来源未定');
    }
    if (row.kind === 'acquisition') {
      const acquisition = plan.acquisitions.find(entry => entry.id === row.id);
      if (acquisition?.method === 'unspecified' && blank(acquisition.supplierName)) details.push('取得方式未定');
    }
    if (row.kind === 'estimate') {
      const estimate = plan.estimates.find(entry => entry.id === row.id);
      if (estimate && estimate.amountMinor !== null && blank(estimate.basisNote)) details.push('估算金额缺依据');
    }
    pushGap(gaps, 'plan', title, details, row.id);
  }
  const summary = productionEstimateSummary(plan);
  if (summary.overLimit === true) pushGap(gaps, 'plan', '预算', ['已录入估算合计超过预算上限'], 'budget');
}

function reviewCheckins(ledger: MaterialCheckinLedger, gaps: DeliveryGap[]): void {
  for (const sheet of ledger.sheets) {
    const summary = materialCheckinSummary(sheet);
    const details = summary.issues.map(issue => CHECKIN_ISSUE_LABELS[issue.code]);
    if (sheet.agreements.some(agreement => agreement.agreedQuantity !== null && blank(agreement.basisNote))) details.push('约定数量缺依据');
    pushGap(gaps, 'checkins', sheet.acquisitionSnapshot.title, details, sheet.id);
  }
}

export function summarizeDeliveryGaps(input: { layout: RoomLayout; checkins?: MaterialCheckinLedger | undefined }): DeliveryReviewSummary {
  const { layout, checkins } = input;
  const gaps: DeliveryGap[] = [];
  const counts: Record<DeliveryGapGroup, number> = { operations: 0, workorders: 0, plan: 0, checkins: 0 };

  const tasks = layout.eventOperations?.tasks ?? [];
  for (const task of tasks) pushGap(gaps, 'operations', task.title, reviewTask(layout, task), task.id);

  const items = layout.floors.flatMap(floor => floor.items);
  for (const item of items) pushGap(gaps, 'workorders', item.name, reviewWorkorder(item), item.id, item.id);

  if (layout.productionPlan) {
    reviewPlan(layout.productionPlan, { taskIds: tasks.map(task => task.id), objectIds: items.map(item => item.id) }, gaps);
  }

  if (checkins) reviewCheckins(checkins, gaps);

  for (const gap of gaps) counts[gap.group] += 1;
  return { gaps, counts, total: gaps.length };
}
