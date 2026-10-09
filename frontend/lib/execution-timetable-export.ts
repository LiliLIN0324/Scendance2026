import { z } from 'zod';
import { eventOperationTaskSchema, eventOperationsSchema } from '../../supabase/functions/_shared/event-operations-contract';
import {
  materialCheckinLedgerSchema, materialCheckinSummary, projectMaterialCheckinEvents,
  type MaterialCheckinIssueCode, type MaterialCheckinLedger,
} from '../../supabase/functions/_shared/material-checkin-contract';
import { productionPlanSchema } from '../../supabase/functions/_shared/production-plan-contract';
import { operationReview, OPERATION_PHASE_LABELS, OPERATION_STATUS_LABELS, toShanghaiDateTimeInput } from '../components/room-organizer/lib/event-operations';
import { isRoomLayout } from '../components/room-organizer/lib/schema';
import { productionReferenceKey } from './production-plan';
import type { DeliverySnapshot } from '../components/room-organizer/lib/scene-delivery';
import type { RoomLayout } from '../components/room-organizer/lib/types';

const kinds = { unspecified: '资料性质未标注', rehearsal: '假设演练', real: '真实资料标识（确认状态另行核对）' };
const units = { piece: '件', set: '套' };
const checkStates = { pending: '待核', checked: '数量已核', disputed: '争议待核' };
const issues: Record<MaterialCheckinIssueCode, string> = {
  'agreement-unknown': '约定数量待确认', 'quantity-unknown': '完整收退数量待确认', disputed: '存在争议批次',
  'missing-time': '实际交接时间缺失', 'time-after-recording': '交接发生时间晚于录入时间',
  'recording-time-conflict': '约定、更正或作废的录入顺序需核对', 'return-before-receipt': '收退时间与数量顺序需核对',
  'over-received': '收取数量超过当前约定', 'over-returned': '退回数量超过已收数量', 'quantity-overflow': '数量合计超出安全范围',
};
// Match production-plan-export's private five-character HTML escaping; no executable evidence links.
const escape = (value: unknown) => String(value ?? '').replace(/[&<>"']/g,
  char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
const present = (value: string) => value.trim() ? value : '未填写／待确认';
const time = (value: string | null, missing: string) => value === null ? missing : toShanghaiDateTimeInput(value).replace('T', ' ').replace(/:00$/, '');
const date = (value: string | null) => value === null ? 'unknown' : toShanghaiDateTimeInput(value).split('T')[0];
const timestamp = (value: string | null) => value === null ? Infinity : Date.parse(value);
const quantity = (value: number | null, unit: keyof typeof units) => value === null ? '待确认' : `${value} ${units[unit]}`;

/** Reject callbacks/getters before validating or cloning the caller's saved data. */
function assertData(value: unknown, ancestors = new Set<object>(), depth = 0): void {
  if (depth > 128) throw new Error('执行资料嵌套过深，不能导出。');
  if (value === undefined || value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number' && Number.isFinite(value)) return;
  if (typeof value !== 'object' || !value) throw new Error('执行资料包含非普通数据，不能导出。');
  const array = Array.isArray(value), prototype = Object.getPrototypeOf(value);
  if ((array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) ||
    ancestors.has(value) || Object.getOwnPropertySymbols(value).length) throw new Error('执行资料包含非普通对象或循环引用。');
  ancestors.add(value);
  for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
    if (array && key === 'length') continue;
    if (!descriptor.enumerable || !('value' in descriptor)) throw new Error('执行资料不能包含取值器或隐藏字段。');
    assertData(descriptor.value, ancestors, depth + 1);
  }
  ancestors.delete(value);
}

/** A frozen, standalone HTML view of every activity task; no storage, fetch, clock or generated IDs. */
export async function executionTimetableHtml(sourceLayout: RoomLayout, snapshot: DeliverySnapshot,
  sourceLedger?: MaterialCheckinLedger): Promise<string> {
  assertData(sourceLayout); assertData(snapshot); assertData(sourceLedger);
  // Freeze all inputs synchronously: operationReview may await a geometry/production/ledger hash.
  const layout = structuredClone(sourceLayout), metadataSource = structuredClone(snapshot);
  const ledgerSource = sourceLedger === undefined ? undefined : structuredClone(sourceLedger);
  const metadata = z.strictObject({ id: z.string().min(1).max(200).refine(value => value.trim().length > 0),
    generatedAt: eventOperationTaskSchema.shape.plannedStartAt.refine(value => value !== null) }).safeParse(metadataSource);
  if (!metadata.success || metadata.data.generatedAt === null) throw new Error('导出编号或冻结时间无效，未生成执行时间表。');
  const operations = eventOperationsSchema.safeParse(layout.eventOperations ?? {});
  if (!operations.success) throw new Error('活动任务资料无效，请核对并保存后再导出。');
  const production = productionPlanSchema.safeParse(layout.productionPlan ?? {});
  if (!production.success) throw new Error('制作计划资料无效，请核对并保存后再导出。');
  if (!isRoomLayout(layout)) throw new Error('项目资料无效，未生成执行时间表。');
  const parsedLedger = ledgerSource === undefined ? undefined : materialCheckinLedgerSchema.safeParse(ledgerSource);
  if (parsedLedger && !parsedLedger.success) throw new Error('点验账册资料无效，请核对原记录后再导出。');
  const ledger = parsedLedger?.success ? parsedLedger.data : undefined;
  if (ledger && (!layout.id || ledger.projectId !== layout.id)) throw new Error('点验账册与当前项目不一致，未生成执行时间表。');

  const tasks = operations.data.tasks.map((task, index) => ({ task, anchor: `task-${index + 1}`, index }));
  const duplicateIds = (ids: string[]) => new Set(ids.map(productionReferenceKey)).size !== ids.length;
  const sourceAmbiguity = duplicateIds(layout.floors.flatMap(floor => floor.items.map(item => item.id)));
  const reviews = await Promise.all(tasks.map(async ({ task }) => {
    if (sourceAmbiguity || duplicateIds(task.objectIds)) return { status: '需核对（关联编号不唯一）', warning: true,
      reason: '当前场景或任务关联编号不唯一，执行前需核对原编号。' };
    try {
      const review = await operationReview(layout, task, ledger);
      const reason = [
        review.missingObjectIds.length ? `直接关联物件缺失 ${review.missingObjectIds.length} 项` : '',
        review.ambiguousObjectIds?.length ? `直接关联物件编号歧义 ${review.ambiguousObjectIds.length} 项` : '',
        review.missingProductionObjectIds?.length ? `制作计划关联物件缺失 ${review.missingProductionObjectIds.length} 项` : '',
        review.ambiguousProductionObjectIds?.length ? `制作计划关联物件编号歧义 ${review.ambiguousProductionObjectIds.length} 项` : '',
      ].filter(Boolean).join('；');
      return { status: OPERATION_STATUS_LABELS[review.status], warning: review.status === 'needs_review',
        reason: reason || (review.status === 'needs_review' ? '当前场景、制作或点验依据已变化，执行前需重新复核。' : '') };
    } catch {
      return { status: '待核对（复核未完成）', warning: true, reason: '当前依据未完成核对，请在活动安排中重试。' };
    }
  }));
  const sorted = [...tasks].sort((a, b) => timestamp(a.task.plannedStartAt) - timestamp(b.task.plannedStartAt) || a.index - b.index);
  const days = new Map<string, typeof tasks>(), owners = new Map<string, typeof tasks>();
  for (const row of sorted) {
    const day = date(row.task.plannedStartAt), owner = present(row.task.ownerName);
    days.set(day, [...days.get(day) ?? [], row]); owners.set(owner, [...owners.get(owner) ?? [], row]);
  }
  const originalTime = (label: string, value: string | null) => `<p>${escape(label)}：${escape(value ?? '未记录')}</p>`;
  const renderTask = ({ task, anchor, index }: typeof tasks[number]) => {
    const review = reviews[index];
    return `<article class="task" id="${anchor}" data-task-id="${escape(task.id)}">
      <div class="planned"><span class="label">计划开始</span><time${task.plannedStartAt ? ` datetime="${escape(task.plannedStartAt)}"` : ''}>${escape(time(task.plannedStartAt, '待安排'))}</time>
        <span class="label">计划结束</span><time${task.plannedEndAt ? ` datetime="${escape(task.plannedEndAt)}"` : ''}>${escape(time(task.plannedEndAt, '待安排'))}</time><span class="phase">${OPERATION_PHASE_LABELS[task.phase]}</span></div>
      <div class="work"><span class="label">任务${index + 1}</span><h4>${escape(task.title)}</h4><span class="label">完成条件</span><p class="acceptance">${escape(present(task.acceptance))}</p>
        <p class="reference">${task.objectIds.length ? `物件引用 ${task.objectIds.length} 个 · 不代表到货或库存数量` : '无物件关联 · 安排与沟通任务照常保留'}</p>
        ${review.reason ? `<p class="warning">${escape(review.reason)}</p>` : ''}
        <details><summary>任务编号与原记录</summary><p>任务编号：${escape(task.id)}</p>
          ${originalTime('原计划开始', task.plannedStartAt)}${originalTime('原计划结束', task.plannedEndAt)}
          ${originalTime('原实际开始', task.actualStartedAt)}${originalTime('原实际结束', task.actualFinishedAt)}
          <p>物件原编号：${escape(task.objectIds.join('\n') || '未关联')}</p><p>现场核对说明：${escape(present(task.evidenceNote))}</p>
          <p>证据地址文本：${escape(task.evidenceUrls.join('\n') || '未记录')}</p></details></div>
      <div class="people"><span class="label">负责人</span><strong>${escape(present(task.ownerName))}</strong><span class="label">承接方</span><span>${escape(present(task.contractorName))}</span></div>
      <div class="record"><p class="status${review.warning ? ' warning' : ''}">有效状态 · ${escape(review.status)}</p><p class="raw-status">原记录 · ${OPERATION_STATUS_LABELS[task.status]}${operations.data.dataKind === 'rehearsal' ? '（演练记录）' : ''}</p>
        <div class="actual"><p>实际开始 · ${escape(time(task.actualStartedAt, '未记录'))}</p><p>实际结束 · ${escape(time(task.actualFinishedAt, '未记录'))}</p></div></div>
    </article>`;
  };
  const dayBlocks = [...days].map(([day, rows], index) => `<section class="day" id="day-${index + 1}" data-day="${day}"><div class="day-heading"><h3>${day === 'unknown' ? '计划日期待安排' : day}</h3><p>${rows.length} 项任务</p></div><div class="day-tasks">${rows.map(renderTask).join('')}</div></section>`).join('');
  const ownerBlocks = [...owners].map(([owner, rows]) => `<details class="owner" open><summary>${escape(owner)}<span>${rows.length} 项</span></summary><ol>${rows.map(({ task, anchor, index }) => `<li><a data-task-ref="${escape(task.id)}" href="#${anchor}"><span>${escape(time(task.plannedStartAt, '计划开始待安排'))}</span><strong>${escape(task.title)}</strong></a><p>${OPERATION_PHASE_LABELS[task.phase]} · 有效状态 ${escape(reviews[index].status)}</p></li>`).join('')}</ol></details>`).join('');
  const checkBlocks = ledger ? ledger.sheets.map(sheet => {
    const summary = materialCheckinSummary(sheet), projection = projectMaterialCheckinEvents(sheet);
    const matches = production.data.acquisitions.filter(row => productionReferenceKey(row.id) === productionReferenceKey(sheet.acquisitionId));
    const current = matches.length === 1 ? matches[0] : undefined;
    const changed = current && (current.title !== sheet.acquisitionSnapshot.title || current.supplierName !== sheet.acquisitionSnapshot.supplierName || current.specificationNote !== sheet.acquisitionSnapshot.specificationNote);
    const relation = !current ? '当前取得关联未找到或编号不唯一，需核对。' : changed ? '当前取得资料与原冻结来源不同，需核对。' : '当前取得编号对应；实物与履约仍需核对。';
    const checked = (kind: 'receive' | 'return') => projection.effectiveEvents.some(event => event.kind === kind && event.checkState === 'checked');
    const quantities: [string, string, string][] = [
      ['agreedQuantity', '当前约定数量', quantity(summary.agreedQuantity, sheet.unit)],
      ['receivedQuantity', '当前有效收取数量', quantity(summary.receivedQuantity, sheet.unit)],
      ['returnedQuantity', '当前有效退回数量', quantity(summary.returnedQuantity, sheet.unit)],
      ['notReceivedQuantity', '相对约定未收', quantity(summary.notReceivedQuantity, sheet.unit)],
      ['notReturnedQuantity', '相对已收未退', quantity(summary.notReturnedQuantity, sheet.unit)],
      ['knownReceivedQuantity', '已核部分收取', checked('receive') ? quantity(summary.knownReceivedQuantity, sheet.unit) : '待确认（尚无已核收取记录）'],
      ['knownReturnedQuantity', '已核部分退回', checked('return') ? quantity(summary.knownReturnedQuantity, sheet.unit) : '待确认（尚无已核退回记录）'],
      ['overReceivedQuantity', '超收差额', quantity(summary.overReceivedQuantity, sheet.unit)],
      ['overReturnedQuantity', '超退差额', quantity(summary.overReturnedQuantity, sheet.unit)],
    ];
    return `<article class="ledger" data-sheet-id="${escape(sheet.id)}"><h3>${escape(sheet.acquisitionSnapshot.title)}</h3><p>${escape(relation)}</p>
      <p>原供应方：${escape(present(sheet.acquisitionSnapshot.supplierName))}</p><p>原规格：${escape(present(sheet.acquisitionSnapshot.specificationNote))}</p>
      <dl class="quantities">${quantities.map(([key, label, value]) => `<div data-quantity="${key}"><dt>${label}</dt><dd>${escape(value)}</dd></div>`).join('')}</dl>
      <p>${summary.needsReview ? `需复核：${escape(summary.issues.map(issue => issues[issue.code]).join('；'))}` : '账册记录计算未发现需复核项；实物与履约仍需现场确认。'}</p>
      <details><summary>点验来源与有效收退记录</summary><p>点验单编号：${escape(sheet.id)}\n取得行编号：${escape(sheet.acquisitionId)}\n当前约定编号：${escape(projection.agreement.id)}</p>
        <p>当前约定依据：${escape(present(projection.agreement.basisNote))}\n约定记录人：${escape(projection.agreement.recordedBy)}</p><p>原记录 ${sheet.events.length} 条；更正替换原事件，作废移除有效事件，历史数量不重复累加。</p>
        ${projection.effectiveEvents.map(event => `<p>${event.kind === 'receive' ? '收取' : '退回'} · ${checkStates[event.checkState]} · ${escape(quantity(event.quantity, sheet.unit))}\n发生时间：${escape(time(event.occurredAt, '未记录'))}\n交接双方：${escape(present(event.fromPartyName))} → ${escape(present(event.toPartyName))}\n记录人：${escape(event.recordedBy)}\n现场说明：${escape(present(event.evidenceNote))}\n证据地址文本：${escape(event.evidenceUrls.join('\n') || '未记录')}</p>`).join('') || '<p>未记录有效收退批次，数量待确认。</p>'}</details>
      <details><summary>原约定与收退、更正、作废记录</summary><p>以下是追溯记录，历史数量不重复累计为当前数量。</p>
        ${sheet.agreements.map(agreement => `<p>约定编号：${escape(agreement.id)}\n替代约定编号：${escape(agreement.supersedesId ?? '无')}\n约定数量：${escape(quantity(agreement.agreedQuantity, sheet.unit))}\n原记录时间：${escape(agreement.recordedAt)}\n记录人：${escape(agreement.recordedBy)}\n约定依据：${escape(present(agreement.basisNote))}</p>`).join('')}
        ${sheet.events.map(event => {
          const label = { receive: '收取', return: '退回', correction: '更正', void: '作废' }[event.kind];
          const payload = event.kind === 'correction' ? event.replacement : event.kind === 'void' ? null : event;
          return `<p>${label}记录编号：${escape(event.id)}\n原记录时间：${escape(event.recordedAt)}\n记录人：${escape(event.recordedBy)}${'targetId' in event ? `\n目标编号：${escape(event.targetId)}\n原因：${escape(event.reason)}` : ''}${payload ? `\n批次：${escape(present(payload.batchRef))}\n数量：${escape(quantity(payload.quantity, sheet.unit))} · ${checkStates[payload.checkState]}\n原发生时间：${escape(payload.occurredAt ?? '未记录')}\n交接双方：${escape(present(payload.fromPartyName))} → ${escape(present(payload.toPartyName))}\n现场说明：${escape(present(payload.evidenceNote))}\n证据地址文本：${escape(payload.evidenceUrls.join('\n') || '未记录')}` : event.kind === 'void' ? `\n作废依据：${escape(present(event.evidenceNote))}\n证据地址文本：${escape(event.evidenceUrls.join('\n') || '未记录')}` : ''}</p>`;
        }).join('')}</details></article>`;
  }).join('') || '<p>账册未记录点验单，收退数量与差额待确认。</p>' : '<p>本次未提供点验账册，收退数量与差额待确认。</p>';
  const title = operations.data.dataKind === 'rehearsal' ? '演练执行时间表' : '执行时间表';
  const policy = "default-src 'none'; style-src 'unsafe-inline'; script-src 'none'; img-src 'none'; connect-src 'none'; base-uri 'none'; form-action 'none'; object-src 'none'";
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${escape(policy)}"><title>${title}｜${escape(layout.name)}</title><style>${css}</style></head><body><main>
    <header class="intro"><p class="eyebrow">内部执行资料</p><h1>${title}</h1><p class="subtitle">${escape(layout.name)}</p><div class="scope"><span>${tasks.length} 项任务</span><span>任务资料：${kinds[operations.data.dataKind]}</span><span>时间显示为北京时间</span></div>
      <p class="disclaimer">本文件冻结当前记录。有效状态相对这份场景、制作计划与已提供点验账册计算；计划与实际时间分别保留，缺失不会补填。${operations.data.dataKind === 'rehearsal' ? '任务资料明确标注为假设演练，原记录不能证明真实活动已完成。' : '资料性质与任务状态不能替代现场、客户或供应方确认。'}</p></header>
    <nav class="navigation" aria-label="时间表读法"><a href="#chronology">按日期与时间读</a><a href="#owners">按负责人读</a><a href="#checks">点验差额</a><a href="#provenance">来源与口径</a></nav>
    <section id="chronology"><h2>按日期与计划时间</h2><p class="section-intro">保留全部任务，含无物件关联的安排与沟通任务。日期按计划开始的北京时间归组；开始未填写的任务单独列出。</p><nav class="date-nav" aria-label="日期定位">${[...days.keys()].map((day, index) => `<a href="#day-${index + 1}">${day === 'unknown' ? '日期待安排' : day}</a>`).join('')}</nav>${dayBlocks || '<p>当前未记录活动任务，计划与分工待安排。</p>'}</section>
    <section id="owners"><h2>按负责人读</h2><p class="section-intro">同一批任务的索引；点击标题回到完整时间表。任务数量不表示岗位人数或完成比例。</p><div class="owner-grid">${ownerBlocks || '<p>当前未记录活动任务，负责人待安排。</p>'}</div></section>
    <section id="checks"><h2>点验差额另列</h2><p class="section-intro">${ledger ? `账册资料：${kinds[ledger.dataKind]}。` : ''}每单按自己的单位与记录链计算，件与套不混计。差额不等于遗失、损耗、可用库存或合同结清；点验时间不替代任务实际时间。</p>${checkBlocks}</section>
    <section id="provenance"><h2>来源与口径</h2><div class="provenance"><p>项目：${escape(layout.name)}\n项目原编号：${escape(layout.id ?? '未记录')}\n导出编号：${escape(metadata.data.id)}\n冻结时间：${escape(metadata.data.generatedAt)}（${escape(time(metadata.data.generatedAt, '未记录'))} 北京时间）</p>
      <p>制作计划：${layout.productionPlan === undefined ? '当前未记录' : kinds[production.data.dataKind]}\n点验账册：${ledger ? kinds[ledger.dataKind] : '本次未提供'}</p><p>没有回写任务、场景或账册。当前工作台变化后需重新导出；本文件不会自动更新，不是可编辑项目备份。</p></div></section>
  </main></body></html>`;
}

const css = `:root{--ink:#182533;--blue:#1d4a7a;--gold:#8b4c18;--paper:#f5f8fc;--line:#dbe4ed}*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:15px/1.65 "Microsoft YaHei UI","Segoe UI",sans-serif;overflow-wrap:anywhere}main{max-width:1240px;margin:auto;padding:40px 28px 60px}h1,h2,h3,h4,p{margin:0}h1{font-size:34px;line-height:1.3}h2{font-size:25px;margin-bottom:12px}h3,h4{font-size:16px}a{color:var(--blue);text-decoration:none}a:hover{text-decoration:underline}a:focus-visible,summary:focus-visible{outline:3px solid var(--blue);outline-offset:3px}.intro{background:white;border-top:5px solid var(--blue);padding:28px 30px}.eyebrow{font-size:12px;color:var(--blue);font-weight:700;letter-spacing:.12em;margin-bottom:12px}.subtitle{font-size:17px;margin-top:12px}.scope,.navigation,.date-nav{display:flex;gap:12px 20px;flex-wrap:wrap}.scope{font-size:13px;color:#48586c;margin-top:16px}.disclaimer{margin-top:18px;padding:13px 16px;border-left:3px solid var(--gold);background:#fcf5e9;font-size:14px}.navigation{padding:20px 0;font-weight:650}.date-nav{font-size:13px;margin-bottom:18px}.section-intro{color:#48586c;margin-bottom:18px}.day{display:grid;grid-template-columns:115px minmax(0,1fr);gap:16px;margin:22px 0 30px;scroll-margin-top:20px}.day-heading{padding-top:16px;border-top:2px solid var(--blue);color:var(--blue)}.day-heading p{font-size:12px;margin-top:8px}.day-tasks{background:white;min-width:0}.task{display:grid;grid-template-columns:145px minmax(0,1fr) 145px 170px;gap:16px;padding:20px;border-top:1px solid var(--line);scroll-margin-top:20px}.task:first-child{border-top:3px solid var(--line)}.planned,.work,.people,.record{min-width:0}.label{display:block;font-size:11px;color:#5d6c7c;margin:8px 0 3px}.planned time{display:block;color:var(--blue);font-size:14px;font-weight:650}.phase{display:inline-block;padding:2px 9px;background:#eaf1f8;color:var(--blue);font-size:12px;margin-top:9px}.acceptance{font-size:13px;white-space:pre-wrap}.reference{font-size:11px;color:#5d6c7c;margin-top:10px}.warning{color:var(--gold)}.work>.warning{font-size:12px;margin-top:9px}.people strong{display:block;font-size:14px}.people>span:last-child{font-size:13px}.status{padding:6px 8px;background:#eef3f8;color:var(--blue);font-size:12px}.status.warning{background:#fcf0dc;color:var(--gold);font-weight:700}.raw-status,.actual{font-size:11px;color:#5d6c7c;margin-top:9px}details{margin-top:12px;font-size:12px}summary{cursor:pointer;color:var(--blue);font-weight:650}details p,.provenance p{white-space:pre-wrap;margin-top:9px}#owners,#checks,#provenance{margin-top:48px;scroll-margin-top:20px}.owner-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:24px}.owner{margin:0;padding:20px 24px;background:white;border-top:3px solid var(--blue);min-width:0}.owner summary{font-size:18px}.owner summary span{float:right;font-size:12px;color:#5d6c7c}.owner ol{padding:0;list-style:none}.owner li{padding:11px 0;border-top:1px solid var(--line)}.owner a,.owner strong{display:block}.owner a span,.owner li p{font-size:11px;color:#5d6c7c}.owner strong{font-size:13px}.ledger{background:white;padding:24px;margin:16px 0;border-left:4px solid var(--gold)}.ledger p{font-size:13px;margin-top:9px}.quantities{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px}.quantities dt{font-size:12px;color:#5d6c7c}.quantities dd{margin:0;font-size:18px;font-weight:650}.provenance{background:white;padding:20px;font-size:12px;border-top:1px solid var(--line)}@media(max-width:1000px){.task{grid-template-columns:125px minmax(0,1fr) 150px}.record{grid-column:2/4;display:flex;flex-wrap:wrap;gap:12px;align-items:baseline}.actual,.raw-status{margin:0}}@media(max-width:680px){main{padding:18px 12px 32px}.intro{padding:20px}h1{font-size:28px}.day{display:block}.day-heading{display:flex;gap:12px;align-items:baseline;padding:8px 0}.day-heading p{margin:0}.task{grid-template-columns:1fr;padding:18px;gap:10px}.planned{display:grid;grid-template-columns:65px minmax(0,1fr);gap:3px}.planned .label{margin:0}.phase{justify-self:start}.record{grid-column:auto}.people{display:grid;grid-template-columns:60px minmax(0,1fr);gap:3px}.people .label{margin:0}.owner-grid{grid-template-columns:1fr}.quantities{grid-template-columns:repeat(2,minmax(0,1fr))}.ledger{padding:18px}}@media print{body{background:white;font-size:10pt}main{max-width:none;padding:0}.navigation,.date-nav{display:none}.intro{padding:12px}.task{grid-template-columns:100px minmax(0,1fr) 100px 110px;gap:10px;padding:12px 8px;break-inside:avoid}.record{grid-column:auto;display:block}.actual,.raw-status{margin-top:8px}.day{grid-template-columns:90px minmax(0,1fr);gap:10px}.task details{display:none}.owner,.ledger{break-inside:avoid}.owner-grid{grid-template-columns:repeat(2,minmax(0,1fr))}#owners,#checks{break-before:page}a{color:inherit}}`;
