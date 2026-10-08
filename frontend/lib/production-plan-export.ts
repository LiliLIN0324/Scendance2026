import { z } from 'zod';
import { uuid } from '../../supabase/functions/_shared/domain';
import { eventOperationTaskSchema, eventOperationsLimits, eventOperationsSchema, type EventOperationTask } from '../../supabase/functions/_shared/event-operations-contract';
import {
  productionEstimateSummary, productionPlanSchema, resolveProductionPlanReferences,
  type ProductionReferenceReview,
} from '../../supabase/functions/_shared/production-plan-contract';
import { OPERATION_PHASE_LABELS, toShanghaiDateTimeInput } from '../components/room-organizer/lib/event-operations';
import type { DeliverySnapshot } from '../components/room-organizer/lib/scene-delivery';
import type { RoomLayout } from '../components/room-organizer/lib/types';
import { formatMoneyMinor } from './production-plan';

const identity = (id: string) => uuid.safeParse(id).success ? id.toLowerCase() : id;
const kinds = { unspecified: '资料性质未标注', rehearsal: '假设演练', real: '真实资料标识（确认状态另行核对）' };
const staffSources = { unspecified: '待确认', internal: '内部安排', outsourced: '外部协作' };
const methods = { unspecified: '待确认', existing: '已有物料', rental: '租赁', purchase: '购买', fabrication: '制作' };
const unknown = (value: string) => value.trim() ? value : '待确认';
const money = (value: number | null) => value === null ? '待确认' : `¥${formatMoneyMinor(value)}`;
const time = (value: string | null) => value === null ? '待确认' : toShanghaiDateTimeInput(value).replace('T', ' ');
const escape = (value: unknown) => String(value ?? '').replace(/[&<>"']/g,
  char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
const para = (value: string, warning = false) => `<p class="text${warning ? ' warning' : ''}">${escape(value)}</p>`;
const table = (headers: string[], rows: unknown[][]) => `<div class="table-wrap"><table><thead><tr>${headers.map(value => `<th>${escape(value)}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${row.map(value => `<td>${escape(value)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;

/** Reject executable serializers/getters before reading the saved data; do not invoke input callbacks. */
function assertData(value: unknown, ancestors = new Set<object>(), depth = 0): void {
  if (depth > 128) throw new Error('交接资料嵌套过深，不能导出。');
  if (value === undefined || value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number' && Number.isFinite(value)) return;
  if (typeof value !== 'object' || !value) throw new Error('交接资料包含非普通数据，不能导出。');
  const array = Array.isArray(value), prototype = Object.getPrototypeOf(value);
  if ((array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) ||
      ancestors.has(value) || Object.getOwnPropertySymbols(value).length) throw new Error('交接资料包含非普通对象或循环引用。');
  ancestors.add(value);
  for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
    if (array && key === 'length') continue;
    if (!descriptor.enumerable || !('value' in descriptor)) throw new Error('交接资料不能包含取值器或隐藏字段。');
    assertData(descriptor.value, ancestors, depth + 1);
  }
  ancestors.delete(value);
}

function buckets<T extends { id: string }>(rows: T[]): Map<string, T[]> {
  const result = new Map<string, T[]>();
  for (const row of rows) { const key = identity(row.id); result.set(key, [...result.get(key) ?? [], row]); }
  return result;
}
const uniqueIds = (ids: string[]) => [...new Map(ids.map(id => [identity(id), id])).values()];
const duplicateIds = (ids: string[]) => uniqueIds(ids.filter((id, index) => ids.findIndex(value => identity(value) === identity(id)) !== index));

const objectSchema = z.strictObject({
  id: z.string().min(1).max(eventOperationsLimits.objectId).refine(value => value.trim().length > 0),
  name: z.string(), floorName: z.string(), width: z.number().positive(), depth: z.number().positive(), height: z.number().positive(),
});
type HandoffObject = z.infer<typeof objectSchema> & { label: string };

/** Current applied data only. This synchronously returns an internal file; it never reads/writes storage or loads assets. */
export function productionPlanHandoffHtml(layout: RoomLayout, snapshot: DeliverySnapshot): string {
  assertData(layout); assertData(snapshot);
  if (layout.productionPlan === undefined) throw new Error('当前项目尚未记录制作计划，请先填写并保存，再导出内部交接文件。');
  const parsed = productionPlanSchema.safeParse(layout.productionPlan);
  if (!parsed.success) throw new Error('制作计划字段无效，请核对并保存后再导出。');
  const plan = parsed.data;
  const metadata = z.strictObject({ id: z.string().min(1).max(200).refine(value => value.trim().length > 0),
    generatedAt: eventOperationTaskSchema.shape.plannedStartAt.refine(value => value !== null) }).safeParse(snapshot);
  if (!metadata.success || metadata.data.generatedAt === null) throw new Error('交接编号或冻结时间无效，未生成文件。');
  if (typeof layout.name !== 'string' || !Array.isArray(layout.floors)) throw new Error('项目资料无效，未生成交接文件。');

  let tasks: (EventOperationTask & { label: string })[] = [];
  let operationsKind: keyof typeof kinds | null = null;
  if (layout.eventOperations !== undefined) {
    const { tasks: rawTasks, ...meta } = layout.eventOperations;
    const taskMeta = eventOperationsSchema.omit({ tasks: true }).safeParse(meta);
    // Validate each shared task shape but retain duplicate source IDs as diagnostics, never as a successful association.
    const taskRows = z.array(eventOperationTaskSchema).max(eventOperationsLimits.tasks).safeParse(rawTasks ?? []);
    if (!taskMeta.success || !taskRows.success) throw new Error('活动任务资料无效，请核对原任务后再导出交接。');
    operationsKind = taskMeta.data.dataKind;
    tasks = taskRows.data.map((task, index) => ({ ...task, label: `任务${index + 1}` }));
  }
  let objects: HandoffObject[];
  try {
    objects = layout.floors.flatMap(floor => floor.items.map(item => objectSchema.parse({ id: item.id, name: item.name,
      floorName: floor.name, width: item.width, depth: item.depth, height: item.height })))
      .map((object, index) => ({ ...object, label: `物件${index + 1}` }));
  } catch { throw new Error('场景物件资料无效，请核对原物件后再导出交接。'); }
  const taskIndex = buckets(tasks), objectIndex = buckets(objects);
  const reviews = resolveProductionPlanReferences(plan, { taskIds: tasks.map(task => task.id), objectIds: objects.map(object => object.id) });
  const reviewIndex = new Map(reviews.map(review => [identity(review.id), review]));
  const linkedEstimateIds = new Set(plan.estimates.filter(row => row.taskIds.length || row.objectIds.length).map(row => identity(row.id)));
  const refs = <T extends { id: string; label: string }>(ids: string[], index: Map<string, T[]>, kind: string, title: (row: T) => string) =>
    ids.length ? uniqueIds(ids).map(id => {
      const found = index.get(identity(id));
      if (!found?.length) return `${kind}缺失，需核对（原编号见附录）`;
      if (found.length !== 1) return `${kind}编号歧义，需核对（原编号见附录）`;
      return `${found[0].label} · ${title(found[0])}`;
    }).join('\n') : '尚未关联，待确认';
  const taskRefs = (ids: string[]) => refs(ids, taskIndex, '任务', row => row.title);
  const objectRefs = (ids: string[]) => refs(ids, objectIndex, '物件', row => `${unknown(row.name)}（${unknown(row.floorName)}）`);
  const compactObjectRefs = (ids: string[]) => {
    const labels: string[] = []; let missing = 0, ambiguous = 0;
    for (const id of uniqueIds(ids)) {
      const found = objectIndex.get(identity(id));
      if (!found?.length) missing++;
      else if (found.length !== 1) ambiguous++;
      else labels.push(found[0].label);
    }
    return [labels.join('、'), missing ? `缺失物件 ${missing} 项，需核对（原编号见附录）` : '',
      ambiguous ? `物件编号歧义 ${ambiguous} 项，需核对（原编号见附录）` : ''].filter(Boolean).join('\n') || '尚未关联，待确认';
  };
  const reviewText = (review: ProductionReferenceReview | undefined) => {
    if (!review) return '关联核对待确认';
    if (review.kind === 'estimate' && !linkedEstimateIds.has(identity(review.id))) return '无关联引用（独立估算）';
    if (!review?.needsReview) return '编号关联唯一；实际内容仍需执行方核对';
    return '需核对：' + [review.unassigned ? '未明确关联' : '',
      review.missingTaskIds.length ? `缺失任务 ${review.missingTaskIds.length} 项` : '',
      review.missingObjectIds.length ? `缺失物件 ${review.missingObjectIds.length} 项` : '',
      review.ambiguousTaskIds.length ? `任务编号歧义 ${review.ambiguousTaskIds.length} 项` : '',
      review.ambiguousObjectIds.length ? `物件编号歧义 ${review.ambiguousObjectIds.length} 项` : '',
    ].filter(Boolean).join('；');
  };
  const linkedTaskIds = uniqueIds([...plan.staffing, ...plan.acquisitions, ...plan.estimates].flatMap(row => row.taskIds));
  const linkedTasks = linkedTaskIds.flatMap(id => {
    const found = taskIndex.get(identity(id)); return found?.length === 1 ? found : [];
  });
  const relatedObjectIds = uniqueIds([
    ...[...plan.acquisitions, ...plan.estimates].flatMap(row => row.objectIds), ...linkedTasks.flatMap(task => task.objectIds),
  ]);
  const relatedObjects = relatedObjectIds.flatMap(id => {
    const found = objectIndex.get(identity(id)); return found?.length === 1 ? found : [];
  });
  const summary = productionEstimateSummary(plan);
  const knownAmounts = plan.estimates.filter(row => row.amountMinor !== null).length;
  const sourceAmbiguities = duplicateIds(tasks.map(task => task.id)).length + duplicateIds(objects.map(object => object.id)).length;
  const taskObjectIssues = linkedTasks.filter(task => duplicateIds(task.objectIds).length || task.objectIds.some(id => objectIndex.get(identity(id))?.length !== 1));
  const staffing = plan.staffing.length ? table(['岗位／班次', '计划人数', '人员来源（内部记录）', '计划到场／离场', '关联任务与核对'], plan.staffing.map((row, index) => [
    `岗位${index + 1} · ${row.roleName}\n班次：${unknown(row.shiftLabel)}`,
    row.headcount === null ? '待确认' : `${row.headcount} 人（需求）`,
    `${staffSources[row.sourceType]}\n${unknown(row.sourceName)}`,
    `到场：${time(row.plannedArrivalAt)}\n离场：${time(row.plannedDepartureAt)}`,
    `${taskRefs(row.taskIds)}\n${reviewText(reviewIndex.get(identity(row.id)))}`,
  ])) : para('尚无岗位需求记录，人员安排待确认。');
  const acquisitions = plan.acquisitions.length ? plan.acquisitions.map((row, index) => `<article><h3>${escape(`取得${index + 1} · ${row.title}`)}</h3>${table(['交接项目', '原计划记录'], [
    ['计划取得方式／供应方', `${methods[row.method]}\n供应方：${unknown(row.supplierName)}`],
    ['实物规格说明', unknown(row.specificationNote)], ['真实来源与核对依据', unknown(row.sourceNote)],
    ['运输范围与依据', unknown(row.transportScope)], ['安装范围与依据', unknown(row.installationScope)],
    ['关联场景物件（用于定位）', objectRefs(row.objectIds)], ['关联活动任务', taskRefs(row.taskIds)],
    ['关联核对', reviewText(reviewIndex.get(identity(row.id)))],
  ])}</article>`).join('') : para('尚无物料取得记录，实物规格、数量、供应与运输安装待确认。');
  const estimates = plan.estimates.length ? table(['人工估算', '估算金额（CNY）', '估算依据', '关联任务／物件与核对'], plan.estimates.map((row, index) => [
    `估算${index + 1} · ${row.title}`, money(row.amountMinor), unknown(row.basisNote),
    `${taskRefs(row.taskIds)}\n${objectRefs(row.objectIds)}\n${reviewText(reviewIndex.get(identity(row.id)))}`,
  ])) : para('尚无人工估算记录，费用范围待确认，不视为零费用。');
  const taskDetails = linkedTasks.length ? table(['活动任务', '计划时间（北京时间）', '负责人／承接方', '完成条件', '关联场景物件'], linkedTasks.map(task => [
    `${task.label} · ${task.title}\n${OPERATION_PHASE_LABELS[task.phase]}`,
    `开始：${time(task.plannedStartAt)}\n结束：${time(task.plannedEndAt)}`,
    `负责人：${unknown(task.ownerName)}\n承接方：${unknown(task.contractorName)}`, unknown(task.acceptance),
    `${compactObjectRefs(task.objectIds)}${duplicateIds(task.objectIds).length ? '\n同一编号重复引用，需核对；不按多件计算' : ''}`,
  ])) : para('没有可唯一对应的明确关联任务。缺失或歧义编号须核对，不能按同名任务代替。');
  const appendixRows = [
    ...plan.staffing.map((row, index) => [`岗位${index + 1}`, row.id, row.taskIds.join('\n') || '未关联', '不适用', reviewText(reviewIndex.get(identity(row.id)))]),
    ...plan.acquisitions.map((row, index) => [`取得${index + 1}`, row.id, row.taskIds.join('\n') || '未关联', row.objectIds.join('\n') || '未关联', reviewText(reviewIndex.get(identity(row.id)))]),
    ...plan.estimates.map((row, index) => [`估算${index + 1}`, row.id, row.taskIds.join('\n') || '未关联', row.objectIds.join('\n') || '未关联', reviewText(reviewIndex.get(identity(row.id)))]),
  ];

  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'none'; base-uri 'none'; form-action 'none'; object-src 'none'"><title>${escape(unknown(layout.name))} · 内部制作交接</title><style>
body{margin:0;background:#f3f5f1;color:#20372d;font:14px/1.65 system-ui,"Microsoft YaHei",sans-serif}main{max-width:1050px;margin:24px auto;padding:30px;background:white}h1{font-size:27px;line-height:1.35}h2{font-size:20px;border-bottom:1px solid #a5b9a4;padding-bottom:7px;margin-top:28px}h3{font-size:16px;margin:16px 0 8px}.text,td{white-space:pre-wrap;overflow-wrap:anywhere}.notice{padding:10px 14px;background:#edf3e9}.warning{color:#835a16;border-left:3px solid #a98c42;padding-left:10px}.table-wrap{overflow:auto}table{border-collapse:collapse;width:100%;font-size:12px;margin:12px 0}th,td{border:1px solid #d5dfd2;padding:9px;text-align:left;vertical-align:top}th{background:#edf3e9}article table th:first-child{width:26%}details{border:1px solid #d5dfd2;margin-top:26px;padding:12px}summary{cursor:pointer;font-weight:600}summary:focus-visible{outline:2px solid #44684f;outline-offset:4px}footer{font-size:12px;color:#526654;margin-top:24px}@media(max-width:640px){main{margin:0;padding:20px 16px}h1{font-size:23px}}@page{size:A4;margin:14mm}@media print{body{background:white;font-size:10px}main{margin:0;padding:0;max-width:none}h1{font-size:22px}h2{font-size:16px}h3{font-size:12px}table{font-size:9px}.table-wrap{overflow:visible}thead{display:table-header-group}tr{break-inside:avoid}h2,h3{break-after:avoid}details:not([open]){display:none}details[open]{break-before:page}*{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
</style></head><body><main><header><p>幕景 · 内部制作交接</p><h1>${escape(unknown(layout.name))}</h1><div class="notice">${para(`制作计划：${kinds[plan.dataKind]}\n活动任务：${operationsKind === null ? '未记录' : kinds[operationsKind]}\n冻结时间：${time(metadata.data.generatedAt)}（北京时间）`)}${para('供执行团队内部交接，含内部来源与供应方记录。不要作为客户评审或公开分享文件。')}</div>
${operationsKind !== null && operationsKind !== plan.dataKind ? para('制作计划与活动任务的资料性质不同，需先核对；不自动改成真实或已确认。', true) : ''}
${sourceAmbiguities ? para('当前任务或物件源中存在重复编号。相关引用需核对，不能自动取第一条或按名称匹配，详见附录。', true) : ''}
${reviews.some(row => row.needsReview) || taskObjectIssues.length ? para('存在未关联、缺失、歧义或重复引用。执行前请核对对应原编号、负责人和完成条件。', true) : ''}</header>
<section><h2>岗位与计划到离场</h2>${para('人数是岗位需求，时间是计划；不表示人员已落实或已到场。岗位来源与任务负责人分别读取，不自动相互替代。')}${staffing}</section>
<section><h2>物料取得与运输安装</h2>${para('取得方式和来源是人工计划记录。场景模型不是库存、供应商产品或到货承诺；实物数量与规格以真实来源核对。')}${acquisitions}</section>
<section><h2>预算范围与人工估算</h2>${table(['项目', '原计划记录'], [['人工预算上限', money(plan.budget?.limitMinor ?? null)], ['预算覆盖范围', unknown(plan.budget?.scopeNote ?? '')], ['预算依据', unknown(plan.budget?.basisNote ?? '')]])}${estimates}
${para(`已知金额小计：${knownAmounts ? money(summary.knownTotalMinor) : '待确认（暂无已知金额）'}\n已录入估算合计：${money(summary.recordedTotalMinor)}\n未知估算金额：${summary.unknownEstimateIds.length} 项`)}
${summary.overLimit === true ? para('已知部分估算已超过人工预算上限，请核对范围、重复计入与未知费用。', true) : para(summary.overLimit === null ? '上限比较待确认。' : '这些已录入估算未超过该上限；不代表全项目费用范围完整。')}
${para('仅汇总已录入的人工估算，未知与零不同。估算不是供应商报价、已发生费用、付款或收款；漏项及重复计入仍须人工核对。')}</section>
<section><h2>明确关联的活动任务</h2>${para('仅列可唯一对应的明确关联任务。执行进展请查看活动安排。')}${taskDetails}</section>
<section><h2>关联场景实例</h2>${relatedObjects.length ? table(['实例（用于定位）', '示意尺寸（米）'], relatedObjects.map(object => [
  `${object.label} · ${unknown(object.name)}\n${unknown(object.floorName)}`, `${object.width} × ${object.depth} × ${object.height}\n非实物规格确认`,
])) : para('没有可唯一对应的关联场景实例；物件来源与规格待核对。')}</section>
${para('追溯附录默认折叠，需要完整打印时请先展开并核对打印预览。')}
<details><summary>追溯附录 · 原编号与时间</summary>${para(`本地项目编号：${layout.id ?? '未记录'}\n交接编号：${metadata.data.id}\n原冻结时间：${metadata.data.generatedAt}`)}
${table(['制作记录', '原记录编号', '原任务引用', '原物件引用', '核对状态'], appendixRows)}
${table(['任务源', '原任务编号', '原物件引用', '原计划开始／结束'], tasks.map(task => [
  `${task.label} · ${task.title}${taskIndex.get(identity(task.id))!.length !== 1 ? '\n编号歧义，禁止自动关联' : ''}`, task.id,
  task.objectIds.join('\n') || '未关联', `${task.plannedStartAt ?? '待确认'}\n${task.plannedEndAt ?? '待确认'}`,
]))}
${table(['物件源', '原物件编号', '核对状态'], objects.map(object => [`${object.label} · ${unknown(object.name)}\n${unknown(object.floorName)}`, object.id,
  objectIndex.get(identity(object.id))!.length === 1 ? '编号唯一' : '编号歧义，禁止自动关联']))}
${table(['岗位', '原计划到场', '原计划离场'], plan.staffing.map((row, index) => [`岗位${index + 1}`, row.plannedArrivalAt ?? '待确认', row.plannedDepartureAt ?? '待确认']))}</details>
<footer>${para(`交接编号：${metadata.data.id}\n这是冻结时的内部制作计划，不自动取得后续修改。场景与制作计划的保存/草稿状态由工作台导出入口核对，本文件不证明云端保存、客户批准或现场履约。`)}</footer></main></body></html>`;
}
