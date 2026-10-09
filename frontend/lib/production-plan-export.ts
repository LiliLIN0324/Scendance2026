import { z } from 'zod';
import { handoffSchema, type Handoff } from '../../supabase/functions/_shared/delivery-contract';
import { uuid } from '../../supabase/functions/_shared/domain';
import { eventOperationTaskSchema, eventOperationsLimits, eventOperationsSchema, type EventOperationTask } from '../../supabase/functions/_shared/event-operations-contract';
import {
  materialCheckinLedgerSchema, materialCheckinSummary, projectMaterialCheckinEvents,
  type MaterialCheckinLedger, type MaterialCheckinIssueCode,
} from '../../supabase/functions/_shared/material-checkin-contract';
import {
  productionEstimateSummary, productionPlanSchema, resolveProductionPlanReferences,
  type ProductionReferenceReview,
} from '../../supabase/functions/_shared/production-plan-contract';
import { operationReview, OPERATION_PHASE_LABELS, OPERATION_STATUS_LABELS, toShanghaiDateTimeInput } from '../components/room-organizer/lib/event-operations';
import { DEFAULT_SVG_MARGIN, DEFAULT_SVG_PX_PER_METRE, layoutToSvg } from '../components/room-organizer/lib/plan-export/svg';
import { effectiveHandoffStatus, HANDOFF_STATUS_LABELS } from '../components/room-organizer/lib/scene-handoff';
import { isRoomLayout } from '../components/room-organizer/lib/schema';
import { createLocalProjectBackup, type BackupBrief } from './local-project-backup';
import { formatMoneyMinor } from './production-plan';
import type { DeliverySnapshot } from '../components/room-organizer/lib/scene-delivery';
import type { RoomLayout } from '../components/room-organizer/lib/types';

const identity = (id: string) => uuid.safeParse(id).success ? id.toLowerCase() : id;
const kinds = { unspecified: '资料性质未标注', rehearsal: '假设演练', real: '真实资料标识（确认状态另行核对）' };
const staffSources = { unspecified: '待确认', internal: '内部安排', outsourced: '外部协作' };
const methods = { unspecified: '待确认', existing: '已有物料', rental: '租赁', purchase: '购买', fabrication: '制作' };
const checkinUnits = { piece: '件', set: '套' };
const checkinStates = { pending: '待核', checked: '数量已核', disputed: '争议待核' };
const checkinKinds = { receive: '收取', return: '退回', correction: '更正', void: '作废' };
const checkinIssues: Record<MaterialCheckinIssueCode, string> = {
  'agreement-unknown': '约定数量待确认', 'quantity-unknown': '完整收退数量待确认', disputed: '存在争议批次',
  'missing-time': '实际交接时间缺失', 'time-after-recording': '交接发生时间晚于录入时间',
  'recording-time-conflict': '约定更替、更正或作废的录入时间顺序需核对', 'return-before-receipt': '收退时间与数量顺序需核对',
  'over-received': '收取数量超过当前约定', 'over-returned': '退回数量超过已收数量', 'quantity-overflow': '数量合计超出安全范围',
};
const unknown = (value: string) => value.trim() ? value : '待确认';
const money = (value: number | null) => value === null ? '待确认' : `¥${formatMoneyMinor(value)}`;
const time = (value: string | null) => value === null ? '待确认' : toShanghaiDateTimeInput(value).replace('T', ' ');
const number = (value: number) => String(Number(value.toFixed(2)));
const safeColor = (value: string | undefined) => /^#[\da-f]{6}$/i.test(value ?? '') ? value! : '#e9e5db';
const escape = (value: unknown) => String(value ?? '').replace(/[&<>"']/g,
  char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
const para = (value: string, warning = false) => `<p class="text${warning ? ' warning' : ''}">${escape(value)}</p>`;
const table = (headers: string[], rows: unknown[][], className = '') => `<div class="table-wrap"><table${className ? ` class="${escape(className)}"` : ''}><thead><tr>${headers.map(value => `<th>${escape(value)}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${row.map(value => `<td>${escape(value)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;

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
  position: z.strictObject({ x: z.number(), z: z.number() }).optional(), rotation: z.number().optional(), elevation: z.number().optional(),
});
type HandoffObject = z.infer<typeof objectSchema> & { label: string; handoff?: Handoff };

/** Freeze current applied data before asynchronous task review; no storage writes or resource loading. */
export async function productionPlanHandoffHtml(sourceLayout: RoomLayout, snapshot: DeliverySnapshot,
  sourceLedger?: MaterialCheckinLedger, options?: { scope: 'activity'; brief?: BackupBrief }): Promise<string> {
  assertData(options);
  const activityScope = options?.scope === 'activity';
  const title = activityScope ? '内部活动交接' : '内部制作交接';
  assertData(sourceLayout); assertData(snapshot);
  const layout = structuredClone(sourceLayout);
  const parsedLedger = sourceLedger === undefined ? undefined : materialCheckinLedgerSchema.safeParse(sourceLedger);
  if (parsedLedger && !parsedLedger.success) throw new Error('点验账册资料无效，请核对原记录后再导出。');
  const ledger = parsedLedger?.success ? parsedLedger.data : undefined;
  if (ledger && (!layout.id || ledger.projectId !== layout.id)) throw new Error('点验账册与当前项目不一致，未生成交接文件。');
  const hasPlan = layout.productionPlan !== undefined;
  if (!activityScope && !hasPlan && !ledger) throw new Error('当前项目尚未记录制作计划或点验账册，请先填写并保存，再导出内部交接文件。');
  const parsed = productionPlanSchema.safeParse(hasPlan ? layout.productionPlan : {});
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
      floorName: floor.name, width: item.width, depth: item.depth, height: item.height,
      ...(item.position ? { position: item.position } : {}), ...(item.rotation !== undefined ? { rotation: item.rotation } : {}),
      ...(item.elevation !== undefined ? { elevation: item.elevation } : {}) })))
      .map((object, index) => ({ ...object, label: `物件${index + 1}` }));
  } catch { throw new Error('场景物件资料无效，请核对原物件后再导出交接。'); }
  if (activityScope) {
    layout.floors.flatMap(floor => floor.items).forEach((item, index) => {
      if (item.handoff === undefined) return;
      const parsedHandoff = handoffSchema.safeParse(item.handoff);
      if (!parsedHandoff.success) throw new Error(`${objects[index].label}工作单资料无效，请核对原记录后再导出。`);
      objects[index].handoff = parsedHandoff.data;
    });
  }
  const brief = activityScope && options?.brief !== undefined ? createLocalProjectBackup(layout,
    { state: 'ready', scope: layout.id ?? 'local', brief: options.brief }, metadata.data.generatedAt).brief : undefined;
  const briefDetails = activityScope ? `<section id="handoff-brief"><h2>活动需求与现场条件</h2>${brief?.status === 'present' ? table(['需求项目', '已保存记录'], [
    ['活动类型', unknown(brief.value.event)], ['预计人数', brief.value.guests], ['活动描述', unknown(brief.value.description)],
    ['必须包含', unknown(brief.value.mustHave)], ['现场条件', unknown(brief.value.venueConditions ?? '')],
    ['风格', unknown(brief.value.style ?? '')], ['色彩', unknown(brief.value.palette ?? '')], ['氛围', unknown(brief.value.atmosphere ?? '')],
  ], 'handoff-brief') : para(brief?.status === 'absent' ? '当前未记录活动需求，活动目的、人数与现场条件待确认。' : '本次未提供活动需求快照，活动目的、人数与现场条件待确认。')}${para('本文件仅含文字记录与可生成的摆位示意；照片、原图纸附件和模型文件需另行提供。')}</section>` : '';
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
  const exportTasks = activityScope ? tasks : linkedTasks;
  const relatedObjectIds = uniqueIds([
    ...[...plan.acquisitions, ...plan.estimates].flatMap(row => row.objectIds), ...linkedTasks.flatMap(task => task.objectIds),
  ]);
  const relatedObjects = relatedObjectIds.flatMap(id => {
    const found = objectIndex.get(identity(id)); return found?.length === 1 ? found : [];
  });
  const exportObjects = activityScope ? objects : relatedObjects;
  const summary = productionEstimateSummary(plan);
  const knownAmounts = plan.estimates.filter(row => row.amountMinor !== null).length;
  const sourceAmbiguities = duplicateIds(tasks.map(task => task.id)).length + duplicateIds(objects.map(object => object.id)).length;
  const taskObjectIssues = exportTasks.filter(task => duplicateIds(task.objectIds).length || task.objectIds.some(id => objectIndex.get(identity(id))?.length !== 1));
  const effectiveStatuses = new Map<string, string>();
  const taskDiagnostics = new Map<string, { checked: boolean; reason: string; directMissing: string[]; directAmbiguous: string[];
    productionMissing: string[]; productionAmbiguous: string[] }>();
  await Promise.all(exportTasks.map(async task => {
    let status: string;
    try {
      const result = await operationReview(layout, task, ledger);
      status = OPERATION_STATUS_LABELS[result.status];
      if (sourceAmbiguities || duplicateIds(task.objectIds).length) status = '需核对（关联编号不唯一）';
      const directMissing = result.missingObjectIds;
      const directAmbiguous = result.ambiguousObjectIds ?? [];
      const productionMissing = result.missingProductionObjectIds ?? [];
      const productionAmbiguous = result.ambiguousProductionObjectIds ?? [];
      const reason = [directMissing.length ? `直接关联物件缺失 ${directMissing.length} 项` : '',
        directAmbiguous.length ? `直接关联物件编号歧义 ${directAmbiguous.length} 项` : '',
        productionMissing.length ? `制作计划间接关联物件缺失 ${productionMissing.length} 项` : '',
        productionAmbiguous.length ? `制作计划间接关联物件编号歧义 ${productionAmbiguous.length} 项` : '',
        sourceAmbiguities || duplicateIds(task.objectIds).length ? '当前关联源编号需核对' : '',
      ].filter(Boolean).join('；');
      taskDiagnostics.set(identity(task.id), { checked: true, reason: reason || (result.status === 'needs_review' ? '当前记录与场景或制作依据已变化' : ''),
        directMissing, directAmbiguous, productionMissing, productionAmbiguous });
    } catch {
      status = '待核对（复核未完成）';
      taskDiagnostics.set(identity(task.id), { checked: false, reason: '当前依据未完成核对，请在活动安排中重试',
        directMissing: [], directAmbiguous: [], productionMissing: [], productionAmbiguous: [] });
    }
    effectiveStatuses.set(identity(task.id), status);
  }));
  const objectStatuses = new Map<string, string>();
  if (activityScope) await Promise.all(objects.filter(object => object.handoff).map(async object => {
    let status = '待核对（复核未完成）';
    try {
      status = objectIndex.get(identity(object.id))?.length === 1
        ? HANDOFF_STATUS_LABELS[await effectiveHandoffStatus(layout, object.id)] : '待核对（物件编号不唯一）';
    } catch { /* Preserve the recorded evidence while leaving effective acceptance unconfirmed. */ }
    objectStatuses.set(object.label, status);
  }));
  const filledHandoffs = objects.filter(({ handoff }) => handoff && (handoff.ownerName || handoff.dueDate || handoff.acceptance ||
    handoff.status !== 'todo' || handoff.evidenceNote || handoff.evidenceUrls.length)).length;
  const objectWorkSheets = activityScope ? `<section id="handoff-workorders"><h2>逐件物料工作单</h2>${para('物件编号与同快照摆位示意一致。记录状态保留原填写内容，执行前以有效状态和完成条件核对；未填工作单不表示已完成。')}${objects.length ? table(
    ['物件／位置', '负责人／期限', '完成条件', '记录状态／有效状态', '现场核对说明／证据文本'], objects.map(object => {
      const handoff = object.handoff;
      return [`${object.label} · ${unknown(object.name)}\n${unknown(object.floorName)}`,
        `负责人：${unknown(handoff?.ownerName ?? '')}\n期限：${unknown(handoff?.dueDate ?? '')}`,
        unknown(handoff?.acceptance ?? ''),
        handoff ? `记录状态：${HANDOFF_STATUS_LABELS[handoff.status]}\n有效状态：${objectStatuses.get(object.label)}` : '尚未填写工作单；分工与进展待确认',
        `现场核对说明：${handoff?.evidenceNote || '未记录'}\n证据文本：${handoff?.evidenceUrls.join('\n') || '未记录'}`];
    }), 'handoff-objects') : para('当前没有场景物件，逐件分工与摆位待确认。')}</section>` : '';

  const simplePlan = !sourceAmbiguities && isRoomLayout(layout) && !layout.scenePreset && !layout.backendSceneV2?.structure &&
    (layout.backendVenue?.shape ?? 'rectangle') === 'rectangle' && !layout.entrance &&
    (!layout.roof || layout.roof.style === 'none') && (!layout.terrain || layout.terrain.frontY === 0 && layout.terrain.backY === 0) &&
    !layout.floors.some(floor => floor.items.some(item => !!item.glbNode || item.mirrored && (item.type === 'door' || item.type === 'window')));
  const safeFloors = simplePlan ? layout.floors.map(floor => ({
    id: floor.id, name: floor.name, floorColor: safeColor(floor.floorColor),
    ...(floor.height !== undefined ? { height: floor.height } : {}),
    ...(floor.hiddenWalls ? { hiddenWalls: [...floor.hiddenWalls] } : {}),
    ...(floor.interiorWalls ? { interiorWalls: floor.interiorWalls.map(wall => ({ id: wall.id,
      x1: wall.x1, z1: wall.z1, x2: wall.x2, z2: wall.z2,
      ...(wall.height !== undefined ? { height: wall.height } : {}),
      ...(wall.thickness !== undefined ? { thickness: wall.thickness } : {}), color: safeColor(wall.color) })) } : {}),
    ...(floor.zones ? { zones: floor.zones.map(zone => ({ ...zone, color: safeColor(zone.color) })) } : {}),
    items: floor.items.map(item => ({ id: item.id, type: item.type, name: '', icon: '',
      width: item.width, depth: item.depth, height: item.height, color: safeColor(item.color),
      ...(item.position ? { position: { x: item.position.x, z: item.position.z } } : {}),
      ...(item.rotation !== undefined ? { rotation: item.rotation } : {}),
      ...(item.elevation !== undefined ? { elevation: item.elevation } : {}),
      ...(item.wallId !== undefined ? { wallId: item.wallId } : {}),
      ...(item.wallRotation !== undefined ? { wallRotation: item.wallRotation } : {}),
      ...(item.sillHeight !== undefined ? { sillHeight: item.sillHeight } : {}),
      ...(item.mirrored !== undefined ? { mirrored: item.mirrored } : {}),
      ...(item.sofaShape !== undefined ? { sofaShape: item.sofaShape } : {}),
      ...(item.stairsShape !== undefined ? { stairsShape: item.stairsShape } : {}),
      ...(item.stairsLeadIn !== undefined ? { stairsLeadIn: item.stairsLeadIn } : {}),
    })),
  })) : [];
  const planLayout: RoomLayout = { name: layout.name, width: layout.width, height: layout.height, floors: safeFloors };
  const plans = simplePlan ? safeFloors.map(floor => {
    const scale = DEFAULT_SVG_PX_PER_METRE, margin = DEFAULT_SVG_MARGIN;
    const labels = floor.items.filter(item => item.position).map(item => {
      const object = objectIndex.get(identity(item.id))![0];
      const x = margin + (item.position!.x + layout.width / 2) * scale;
      const y = margin + (item.position!.z + layout.height / 2) * scale;
      return `<text class="instance-number" aria-label="${escape(object.label)}" x="${x}" y="${y}" dy="0.35em" font-size="13" text-anchor="middle" fill="#20372d" stroke="white" stroke-width="2" paint-order="stroke">${escape(object.label.slice(2))}</text>`;
    }).join('');
    // Add upright numbers inside the shared emitter's translated plan group; its geometry and bounds remain authoritative.
    const svg = layoutToSvg(planLayout, floor).replace('</g>\n<text class="plan-title"', `${labels}</g>\n<text class="plan-title"`);
    return `<figure class="handoff-plan">${svg}<figcaption>${escape(floor.name)} · 同快照编辑平面占位示意，非实测或施工图。家具表示占位包络，不表达L/U形等实物细部；图中数字对应正文物件编号，例如 1 = 物件1；薄型物件也按中心标注。</figcaption></figure>`;
  }).join('') : para('当前结构、场馆或关联源不适合普通矩形示意，需附当前图纸；以下原坐标与朝向可供定位核对。', true);
  const unplacedCount = objects.filter(object => !object.position).length;
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
  const taskDetails = exportTasks.length ? table(['活动任务／状态', '计划／实际时间（北京时间）', '负责人／承接方', '完成条件／现场核对', '关联场景物件'], exportTasks.map(task => [
    `${task.label} · ${task.title}\n${OPERATION_PHASE_LABELS[task.phase]}\n记录状态：${OPERATION_STATUS_LABELS[task.status]}\n有效状态：${effectiveStatuses.get(identity(task.id))}${taskDiagnostics.get(identity(task.id))?.reason ? `\n复核事项：${taskDiagnostics.get(identity(task.id))!.reason}（原编号见附录）` : ''}`,
    `计划开始：${time(task.plannedStartAt)}\n计划结束：${time(task.plannedEndAt)}\n实际开始：${time(task.actualStartedAt)}\n实际结束：${time(task.actualFinishedAt)}`,
    `负责人：${unknown(task.ownerName)}\n承接方：${unknown(task.contractorName)}`,
    `完成条件：${unknown(task.acceptance)}\n现场核对说明：${task.evidenceNote.trim() ? task.evidenceNote : '未记录'}\n证据文本：${task.evidenceUrls.length ? task.evidenceUrls.join('\n') : '未记录'}`,
    `${compactObjectRefs(task.objectIds)}${duplicateIds(task.objectIds).length ? '\n同一编号重复引用，需核对；不按多件计算' : ''}`,
  ]), 'handoff-tasks') : para(activityScope ? '当前未记录活动任务，执行安排、负责人和时间待确认。' : '没有可唯一对应的明确关联任务。缺失或歧义编号须核对，不能按同名任务代替。');
  const appendixRows = [
    ...plan.staffing.map((row, index) => [`岗位${index + 1}`, row.id, row.taskIds.join('\n') || '未关联', '不适用', reviewText(reviewIndex.get(identity(row.id)))]),
    ...plan.acquisitions.map((row, index) => [`取得${index + 1}`, row.id, row.taskIds.join('\n') || '未关联', row.objectIds.join('\n') || '未关联', reviewText(reviewIndex.get(identity(row.id)))]),
    ...plan.estimates.map((row, index) => [`估算${index + 1}`, row.id, row.taskIds.join('\n') || '未关联', row.objectIds.join('\n') || '未关联', reviewText(reviewIndex.get(identity(row.id)))]),
  ];
  const quantityText = (value: number | null, unit: keyof typeof checkinUnits) => value === null ? '待确认' : `${value} ${checkinUnits[unit]}`;
  const acquisitionIndex = new Map(plan.acquisitions.map(row => [identity(row.id), row]));
  const sheetData = ledger?.sheets.map(sheet => ({ sheet, projection: projectMaterialCheckinEvents(sheet), summary: materialCheckinSummary(sheet) })) ?? [];
  const checkinDetails = ledger ? `<section id="handoff-checkins"><h2>数量点验</h2>${para(`账册资料：${kinds[ledger.dataKind]}。每单按自己的单位与记录链计算，不混计件/套。差额原因待核，不据此判断遗失、可用库存或任务完成。`)}
${!hasPlan ? para('当前制作计划未记录；历史点验仍保留，取得关联需核对，不能按名称重挂。', true) : ''}
${sheetData.length ? sheetData.map(({ sheet, projection, summary }, index) => {
  const current = acquisitionIndex.get(identity(sheet.acquisitionId));
  const changed = current && (current.title !== sheet.acquisitionSnapshot.title || current.supplierName !== sheet.acquisitionSnapshot.supplierName ||
    current.specificationNote !== sheet.acquisitionSnapshot.specificationNote);
  const relation = !current ? '当前取得关联未找到，需核对' : changed ? '当前取得资料与原冻结来源不同，需核对' : '当前取得编号对应；实物与履约仍需核对';
  const checkedReceived = projection.effectiveEvents.some(event => event.kind === 'receive' && event.checkState === 'checked');
  const checkedReturned = projection.effectiveEvents.some(event => event.kind === 'return' && event.checkState === 'checked');
  return `<article><h3>${escape(`点验${index + 1} · ${sheet.acquisitionSnapshot.title}`)}</h3>${para(relation, !current || !!changed)}${table(['点验项目', '当前记录'], [
    ['原取得来源／供应方', `${sheet.acquisitionSnapshot.title}\n${unknown(sheet.acquisitionSnapshot.supplierName)}`],
    ['原规格说明', unknown(sheet.acquisitionSnapshot.specificationNote)],
    ['当前约定数量／依据', `${quantityText(projection.agreement.agreedQuantity, sheet.unit)}\n${unknown(projection.agreement.basisNote)}`],
    ['当前有效收取数量', quantityText(summary.receivedQuantity, sheet.unit)],
    ['当前有效退回数量', quantityText(summary.returnedQuantity, sheet.unit)],
    ['已核部分收取／退回', `收取：${checkedReceived ? quantityText(summary.knownReceivedQuantity, sheet.unit) : '待确认（尚无已核收取记录）'}\n退回：${checkedReturned ? quantityText(summary.knownReturnedQuantity, sheet.unit) : '待确认（尚无已核退回记录）'}`],
    ['未收／未退差额', `相对约定未收：${quantityText(summary.notReceivedQuantity, sheet.unit)}\n相对已收未退：${quantityText(summary.notReturnedQuantity, sheet.unit)}`],
    ['超收／超退差额', `超收：${quantityText(summary.overReceivedQuantity, sheet.unit)}\n超退：${quantityText(summary.overReturnedQuantity, sheet.unit)}`],
    ['异常与待核', summary.issues.length ? summary.issues.map(issue => checkinIssues[issue.code]).join('\n') : '未发现契约列出的数量异常；不等于已获施工或客户批准'],
  ])}<h4>当前有效批次记录（含待核与争议）</h4>${projection.effectiveEvents.length ? table(['批次／类型', '数量／核对标记', '实际发生／录入时间', '交接双方／记录人', '说明与证据文本'], projection.effectiveEvents.map(event => [
    `${unknown(event.batchRef)}\n${checkinKinds[event.kind]}`, `${quantityText(event.quantity, sheet.unit)}\n${checkinStates[event.checkState]}`,
    `发生：${time(event.occurredAt)}\n录入：${time(event.recordedAt)}`,
    `交出：${unknown(event.fromPartyName)}\n接收：${unknown(event.toPartyName)}\n记录人：${event.recordedBy}`,
    `${event.evidenceNote.trim() ? event.evidenceNote : '未记录说明'}\n${event.evidenceUrls.join('\n') || '未记录证据链接'}`,
  ])) : para('尚无有效收退批次；未记录不表示数量为零。')}${para(`更正按原收退链替换计算；已作废 ${projection.voidedRootIds.length} 条原收退记录，原文保留在附录，不重复计量。`)}</article>`;
}).join('') : para('账册已记录，尚未建立点验单；当前数量待确认。')}</section>` : '';
  const checkinHistory = ledger ? `<section><h3>数量点验追溯 · 原记录、更正与作废</h3>${para(`账册项目编号：${ledger.projectId}\n资料性质：${kinds[ledger.dataKind]}`)}${sheetData.map(({ sheet, projection, summary }, index) => {
    const effectiveIds = new Set(projection.effectiveEvents.map(event => identity(event.effectiveEventId)));
    const voidedIds = new Set(projection.voidedRootIds.map(identity));
    return `<h4>${escape(`点验${index + 1} · ${sheet.acquisitionSnapshot.title}`)}</h4>${para(`点验单原编号：${sheet.id}\n原取得编号：${sheet.acquisitionId}\n计量单位：${checkinUnits[sheet.unit]}`)}
${table(['约定原编号／替代关系', '原约定数量／依据', '原录入时间／记录人', '当前状态'], sheet.agreements.map(agreement => [
  `${agreement.id}\n替代：${agreement.supersedesId ?? '根约定'}`, `${quantityText(agreement.agreedQuantity, sheet.unit)}\n${unknown(agreement.basisNote)}`,
  `${agreement.recordedAt}\n${agreement.recordedBy}`, identity(agreement.id) === identity(projection.agreement.id) ? '当前约定' : '历史约定，不重复计量',
]))}
${table(['原记录／关系', '原类型／载荷', '原录入时间／记录人', '原说明／更正作废依据', '投影状态'], sheet.events.map(event => {
  const payload = event.kind === 'correction' ? event.replacement : event.kind === 'void' ? null : event;
  return [`${event.id}\n目标：${'targetId' in event ? event.targetId : '原收退记录'}`,
    `${checkinKinds[event.kind]}${payload ? `\n批次：${unknown(payload.batchRef)}\n数量：${quantityText(payload.quantity, sheet.unit)}\n标记：${checkinStates[payload.checkState]}\n发生：${payload.occurredAt ?? '待确认'}\n双方：${unknown(payload.fromPartyName)} → ${unknown(payload.toPartyName)}` : ''}`,
    `${event.recordedAt}\n${event.recordedBy}`,
    `${'reason' in event ? event.reason + '\n' : ''}${payload ? payload.evidenceNote + '\n' + payload.evidenceUrls.join('\n') : event.kind === 'void' ? event.evidenceNote + '\n' + event.evidenceUrls.join('\n') : ''}`,
    event.kind === 'void' ? '作废依据，原链不计量' : voidedIds.has(identity(event.id)) ? '已作废的原收退记录，不计量' : effectiveIds.has(identity(event.id)) ? '当前有效记录（核对标记另列）' : '原始或已被替代记录，不重复计量'];
}))}${table(['有效根原编号', '当前有效原编号', '原收退类型'], projection.effectiveEvents.map(event => [event.rootEventId, event.effectiveEventId, checkinKinds[event.kind]]))}
${table(['异常类型', '关联原记录编号'], summary.issues.map(issue => [checkinIssues[issue.code], issue.eventIds.join('、') || '整单或当前约定']))}
${para(`已作废的原收退编号：${projection.voidedRootIds.join('、') || '无'}`)}`;
  }).join('')}</section>` : '';

  const contents = activityScope ? `<nav class="handoff-toc" aria-label="交接目录"><a href="#handoff-brief">活动需求</a><a href="#handoff-tasks">活动任务</a><a href="#handoff-workorders">物件工作单</a>${hasPlan ? '<a href="#handoff-staffing">岗位计划</a>' : ''}${ledger ? '<a href="#handoff-checkins">数量点验</a>' : ''}<a href="#handoff-plan">摆位示意</a></nav>` : '';
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'none'; base-uri 'none'; form-action 'none'; object-src 'none'"><title>${escape(unknown(layout.name))} · ${title}</title><style>
.handoff-brief{table-layout:fixed}.handoff-brief th:first-child{width:18%}.handoff-toc{display:flex;flex-wrap:wrap;gap:8px;margin:18px 0}.handoff-toc a{color:#264e3b;border:1px solid #a5b9a4;padding:6px 12px;text-decoration:none;border-radius:5px}.handoff-toc a:hover,.handoff-toc a:focus-visible{background:#edf3e9}section{scroll-margin-top:20px}@media print{.handoff-toc{display:none}}
body{margin:0;background:#f3f5f1;color:#20372d;font:14px/1.65 system-ui,"Microsoft YaHei",sans-serif}main{max-width:1050px;margin:24px auto;padding:30px;background:white}h1{font-size:27px;line-height:1.35}h2{font-size:20px;border-bottom:1px solid #a5b9a4;padding-bottom:7px;margin-top:28px}h3{font-size:16px;margin:16px 0 8px}.text,td{white-space:pre-wrap;overflow-wrap:anywhere}.notice{padding:10px 14px;background:#edf3e9}.warning{color:#835a16;border-left:3px solid #a98c42;padding-left:10px}.table-wrap{overflow:auto}table{border-collapse:collapse;width:100%;font-size:12px;margin:12px 0}th,td{border:1px solid #d5dfd2;padding:9px;text-align:left;vertical-align:top}th{background:#edf3e9}article table th:first-child{width:26%}.handoff-tasks{table-layout:fixed}.handoff-tasks th:nth-child(1){width:15%}.handoff-tasks th:nth-child(2){width:18%}.handoff-tasks th:nth-child(3){width:14%}.handoff-tasks th:nth-child(4){width:35%}.handoff-tasks th:nth-child(5){width:18%}.handoff-plan{margin:16px 0;padding:10px;border:1px solid #d5dfd2}.handoff-plan svg{display:block;max-width:100%;height:auto;margin:0 auto}.handoff-plan figcaption{font-size:11px;color:#526654;overflow-wrap:anywhere}details{border:1px solid #d5dfd2;margin-top:26px;padding:12px}summary{cursor:pointer;font-weight:600}summary:focus-visible{outline:2px solid #44684f;outline-offset:4px}footer{font-size:12px;color:#526654;margin-top:24px}@media(max-width:640px){main{margin:0;padding:20px 16px}h1{font-size:23px}}@page{size:A4;margin:14mm}@media print{body{background:white;font-size:10px}main{margin:0;padding:0;max-width:none}h1{font-size:22px}h2{font-size:16px}h3{font-size:12px}table{font-size:9px}.table-wrap{overflow:visible}thead{display:table-header-group}tr,figure{break-inside:avoid}.handoff-plan svg{max-height:110mm;max-width:100%;width:auto;height:auto}h2,h3{break-after:avoid}details:not([open]){display:none}details[open]{break-before:page}*{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
</style></head><body><main><header><p>幕景 · ${title}</p><h1>${escape(unknown(layout.name))}</h1><div class="notice">${para(`制作计划：${hasPlan ? kinds[plan.dataKind] : '当前未记录'}\n活动任务：${operationsKind === null ? '未记录' : kinds[operationsKind]}${ledger ? `\n数量点验：${kinds[ledger.dataKind]}` : ''}\n冻结时间：${time(metadata.data.generatedAt)}（北京时间）`)}${para('供执行团队内部交接，含内部来源与供应方记录。不要作为客户评审或公开分享文件。')}</div>
${activityScope ? para(`范围：全部活动任务与逐件物料工作单，含未关联制作计划的安排。\n任务：${tasks.length} 项；物件：${objects.length} 项；已填工作单：${filledHandoffs} / ${objects.length} 项。\n已下载文件是冻结版本，不会随工作台后续修改更新。`) : ''}
${hasPlan && operationsKind !== null && operationsKind !== plan.dataKind ? para('制作计划与活动任务的资料性质不同，需先核对；不自动改成真实或已确认。', true) : ''}
${ledger && (hasPlan && ledger.dataKind !== plan.dataKind || operationsKind !== null && ledger.dataKind !== operationsKind) ? para('点验账册与当前计划或任务的资料性质不同，需核对，不自动统一。', true) : ''}
${sourceAmbiguities ? para('当前任务或物件源中存在重复编号。相关引用需核对，不能自动取第一条或按名称匹配，详见附录。', true) : ''}
${reviews.some(row => row.needsReview) || taskObjectIssues.length ? para('存在未关联、缺失、歧义或重复引用。执行前请核对对应原编号、负责人和完成条件。', true) : ''}</header>
${contents}${briefDetails}
${hasPlan ? `<section id="handoff-staffing"><h2>岗位与计划到离场</h2>${para('人数是岗位需求，时间是计划；不表示人员已落实或已到场。岗位来源与任务负责人分别读取，不自动相互替代。')}${staffing}</section>` : ''}
${hasPlan ? `<section><h2>物料取得与运输安装</h2>${para('取得方式和来源是人工计划记录。场景模型不是库存、供应商产品或到货承诺；实物数量与规格以真实来源核对。')}${acquisitions}</section>` : ''}
${checkinDetails}
${hasPlan ? `<section><h2>预算范围与人工估算</h2>${table(['项目', '原计划记录'], [['人工预算上限', money(plan.budget?.limitMinor ?? null)], ['预算覆盖范围', unknown(plan.budget?.scopeNote ?? '')], ['预算依据', unknown(plan.budget?.basisNote ?? '')]])}${estimates}
${para(`已知金额小计：${knownAmounts ? money(summary.knownTotalMinor) : '待确认（暂无已知金额）'}\n已录入估算合计：${money(summary.recordedTotalMinor)}\n未知估算金额：${summary.unknownEstimateIds.length} 项`)}
${summary.overLimit === true ? para('已知部分估算已超过人工预算上限，请核对范围、重复计入与未知费用。', true) : para(summary.overLimit === null ? '上限比较待确认。' : '这些已录入估算未超过该上限；不代表全项目费用范围完整。')}
${para('仅汇总已录入的人工估算，未知与零不同。估算不是供应商报价、已发生费用、付款或收款；漏项及重复计入仍须人工核对。')}</section>` : ''}
${activityScope || hasPlan ? `<section id="handoff-tasks"><h2>${activityScope ? '全部活动任务' : '明确关联的活动任务'}</h2>${para(activityScope ? '按活动安排原顺序列出全部阶段任务，包含未关联制作计划的安排。缺失负责人、时间和完成条件须执行前补齐。' : '仅列可唯一对应的明确关联任务。执行进展请查看活动安排。')}${taskDetails}</section>` : ''}
${objectWorkSheets}
<section id="handoff-plan"><h2>同快照摆位示意</h2>${plans}${unplacedCount ? para(`${unplacedCount} 个物件未记录位置，未画入平面；需核对其摆位。`, true) : ''}</section>
<section><h2>${activityScope ? '全部场景实例' : '关联场景实例'}</h2>${para('横纵坐标以场地中心为原点，横向向右、纵向向下为正；朝向由原编辑弧度换算为度。')}${exportObjects.length ? table(['实例（用于定位）', '示意尺寸（米）', '原编辑位置／朝向'], exportObjects.map(object => [
  `${object.label} · ${unknown(object.name)}\n${unknown(object.floorName)}`, `${object.width} × ${object.depth} × ${object.height}\n非实物规格确认`,
  object.position ? `横向 ${number(object.position.x)} 米 / 纵向 ${number(object.position.z)} 米\n朝向 ${number((object.rotation ?? 0) * 180 / Math.PI)}°\n离地 ${number(object.elevation ?? 0)} 米` : '位置待确认',
])) : para(activityScope ? '当前没有场景物件；实物安排与规格待确认。' : '没有可唯一对应的关联场景实例；物件来源与规格待核对。')}</section>
${para('追溯附录默认折叠，需要完整打印时请先展开并核对打印预览。')}
<details><summary>追溯附录 · 原编号与时间</summary>${para(`本地项目编号：${layout.id ?? '未记录'}\n交接编号：${metadata.data.id}\n原冻结时间：${metadata.data.generatedAt}`)}
${table(['制作记录', '原记录编号', '原任务引用', '原物件引用', '核对状态'], appendixRows)}
${table(['任务源', '原任务编号', '原物件引用', '原计划开始／结束'], tasks.map(task => [
  `${task.label} · ${task.title}${taskIndex.get(identity(task.id))!.length !== 1 ? '\n编号歧义，禁止自动关联' : ''}`, task.id,
  task.objectIds.join('\n') || '未关联', `${task.plannedStartAt ?? '待确认'}\n${task.plannedEndAt ?? '待确认'}`,
]))}
${table(['任务复核', '直接缺失／歧义原编号', '制作间接缺失／歧义原编号'], exportTasks.map(task => {
  const review = taskDiagnostics.get(identity(task.id))!;
  return [task.label, review.checked ? `缺失：${review.directMissing.join('、') || '无'}\n歧义：${review.directAmbiguous.join('、') || '无'}` : '复核未完成，未判定',
    review.checked ? `缺失：${review.productionMissing.join('、') || '无'}\n歧义：${review.productionAmbiguous.join('、') || '无'}` : '复核未完成，未判定'];
}))}
${table(['物件源', '原物件编号', '原坐标／朝向', '核对状态'], objects.map(object => [`${object.label} · ${unknown(object.name)}\n${unknown(object.floorName)}`, object.id,
  object.position ? `${object.position.x}, ${object.position.z}\n旋转 ${object.rotation ?? 0} 弧度\n离地 ${object.elevation ?? 0} 米` : '未记录位置',
  objectIndex.get(identity(object.id))!.length === 1 ? '编号唯一' : '编号歧义，禁止自动关联']))}
${table(['岗位', '原计划到场', '原计划离场'], plan.staffing.map((row, index) => [`岗位${index + 1}`, row.plannedArrivalAt ?? '待确认', row.plannedDepartureAt ?? '待确认']))}${checkinHistory}</details>
<footer>${para(`交接编号：${metadata.data.id}\n${activityScope ? '这是冻结时的内部活动、物件工作单与点验资料' : '这是冻结时的内部制作与点验资料'}，不自动取得后续修改。场景、制作计划及独立点验资料的保存状态由工作台导出入口核对，本文件不证明云端保存、客户批准或现场履约。`)}</footer></main></body></html>`;
}
