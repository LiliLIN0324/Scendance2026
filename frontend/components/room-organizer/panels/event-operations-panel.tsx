'use client';

import { useEffect, useRef, useState, type ChangeEvent, type FormEvent, type ReactNode } from 'react';
import { productionReferenceKey as objectKey } from '@/lib/production-plan';
import { registerSourceFlush } from '@/lib/source-storage';
import rehearsalExample from '../../../../docs/examples/30-person-rehearsal-operations.json';
import { handoffLimits } from '../../../../supabase/functions/_shared/delivery-contract';
import { canonical } from '../../../../supabase/functions/_shared/domain';
import { eventOperationPhases, eventOperationsLimits, eventOperationsSchema, eventOperationTaskSchema, type EventOperations, type EventOperationTask } from '../../../../supabase/functions/_shared/event-operations-contract';
import { copyRehearsalOperations, createOperation, fromShanghaiDateTimeInput, operationBasis, operationObjectReview, operationReview, OPERATION_PHASE_LABELS, OPERATION_STATUS_LABELS, toShanghaiDateTimeInput } from '../lib/event-operations';
import type { MaterialCheckinLedger } from '../../../../supabase/functions/_shared/material-checkin-contract';
import type { MaterialCheckinState } from '../hooks/use-material-checkins';
import type { CreativeBrief } from '../lib/creative-brief';
import type { RoomLayout } from '../lib/types';
import './scene-delivery-panel.css';
import './event-operations-panel.css';

interface Props {
  suggestionsPanel?: ReactNode;
  checkins?: MaterialCheckinState | undefined;
  layout: RoomLayout;
  disabled: boolean;
  onUpdate(value: EventOperations | undefined): void;
  onLocate?: ((id: string) => void) | undefined;
  briefState?: { brief: CreativeBrief; ready: boolean; error: string | null; hasSavedBrief: boolean } | null | undefined;
  onOpenBrief?: (() => void) | undefined;
}
type ReviewStatus = EventOperationTask['status'] | 'needs_review' | 'checking';
const emptyOperations: EventOperations = { schemaVersion: 1, dataKind: 'unspecified', tasks: [] };
const timeLabels = {
  plannedStartAt: '计划开始', plannedEndAt: '计划结束',
  actualStartedAt: '实际开始', actualFinishedAt: '实际结束',
} as const;
type TimeField = keyof typeof timeLabels;
function timeInputs(task: EventOperationTask): Record<TimeField, string> {
  return Object.fromEntries(Object.keys(timeLabels).map(key => [key, toShanghaiDateTimeInput(task[key as TimeField])])) as Record<TimeField, string>;
}
function inputError(field: string | undefined): string {
  const messages: Record<string, string> = {
    title: `请填写任务标题，最多 ${eventOperationsLimits.title} 字。`,
    ownerName: `请填写负责人，最多 ${eventOperationsLimits.ownerName} 字。`,
    contractorName: `承接团队最多 ${eventOperationsLimits.contractorName} 字。`,
    acceptance: `请填写完成条件，最多 ${eventOperationsLimits.acceptance} 字。`,
    evidenceNote: `已完成须填写现场核对说明，最多 ${eventOperationsLimits.evidenceNote} 字。`,
    evidenceUrls: `请填写完整的 HTTP 或 HTTPS 链接，每行一个，最多 ${handoffLimits.evidenceUrls} 个，链接不能重复。`,
    reviewedBasis: '请重新核对任务后确认完成。',
    plannedStartAt: '请填写真实的计划开始时间。', plannedEndAt: '计划结束不能早于计划开始，请检查时间。',
    actualStartedAt: '请填写真实的实际开始时间。', actualFinishedAt: '实际结束不能早于实际开始，请检查时间。',
    phase: '请选择任务阶段。', status: '请选择任务状态。',
    objectIds: '请检查关联物料。',
  };
  return messages[field ?? ''] ?? '请检查活动安排，填写内容已保留。';
}

function OperationEditor({ layout, task, status, reviewFailed, disabled, checkins, onSave, onDelete, onLocate }: {
  layout: RoomLayout; task: EventOperationTask; status: ReviewStatus; reviewFailed: boolean; disabled: boolean;
  onSave(task: EventOperationTask): boolean; onDelete(): void; onLocate: Props['onLocate'];
  checkins: MaterialCheckinLedger | undefined;
}): JSX.Element {
  const [draft, setDraft] = useState(task);
  const [times, setTimes] = useState(() => timeInputs(task));
  const [badTimeFields, setBadTimeFields] = useState<TimeField[]>([]);
  const [links, setLinks] = useState(task.evidenceUrls.join('\n'));
  const [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);
  const pending = useRef(false), mounted = useRef(true);
  const taskSnapshot = JSON.stringify(task);
  const scope = layout.id ?? 'local';
  const savedTask = useRef(task);
  const dirty = canonical(draft) !== canonical(savedTask.current) || canonical(times) !== canonical(timeInputs(savedTask.current)) || links !== savedTask.current.evidenceUrls.join('\n') || badTimeFields.length > 0;
  const latest = useRef({ layout, task, disabled, checkins, dirty }); latest.current = { layout, task, disabled, checkins, dirty };
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    const restored = eventOperationTaskSchema.parse(JSON.parse(taskSnapshot));
    savedTask.current = restored;
    setDraft(restored); setTimes(timeInputs(restored)); setBadTimeFields([]); setLinks(restored.evidenceUrls.join('\n')); setError('');
  }, [taskSnapshot, scope]);
  useEffect(() => registerSourceFlush(scope, async () => {
    if ((latest.current.layout.id ?? 'local') !== scope) return;
    const message = pending.current ? '任务正在保存，请稍后重试。' : latest.current.dirty ? '任务有未保存修改，请先保存任务或放弃修改。' : '';
    if (message) { setError(message); throw new Error(message); }
  }), [scope]);
  function discard(): void {
    const restored = savedTask.current;
    setDraft(restored); setTimes(timeInputs(restored)); setBadTimeFields([]); setLinks(restored.evidenceUrls.join('\n')); setError(''); setNotice('');
  }
  const objects = layout.floors.flatMap(floor => floor.items.map(item => ({ ...item, floorName: floor.name })));
  const objectReview=operationObjectReview(layout,draft),missing=objectReview.missingObjectIds,ambiguous=objectReview.ambiguousObjectIds;
  const productionMissing=objectReview.missingProductionObjectIds,productionAmbiguous=objectReview.ambiguousProductionObjectIds;
  const hasObjectProblems=missing.length+ambiguous.length+productionMissing.length+productionAmbiguous.length>0;
  const objectCounts=new Map<string,number>();objects.forEach(item=>objectCounts.set(objectKey(item.id),(objectCounts.get(objectKey(item.id))??0)+1));
  const toggleObject = (id: string, checked: boolean): void => setDraft(current => ({ ...current, objectIds: checked
    ? current.objectIds.some(value=>objectKey(value)===objectKey(id))?current.objectIds:[...current.objectIds,id]
    : current.objectIds.filter(value=>objectKey(value)!==objectKey(id)) }));
  function changeTime(field: TimeField, event: ChangeEvent<HTMLInputElement>): void {
    if (event.currentTarget.validity.badInput) {
      setBadTimeFields(current => current.includes(field) ? current : [...current, field]);
      setError(`请检查${timeLabels[field]}，原时间已保留。`); return;
    }
    setBadTimeFields(current => current.filter(value => value !== field));
    setTimes({ ...times, [field]: event.target.value });
  }
  async function save(reconfirm = false): Promise<void> {
    if (disabled || pending.current || status === 'checking') return;
    if (badTimeFields.length) { setError(`请检查${timeLabels[badTimeFields[0]]}，原时间已保留。`); return; }
    const before = latest.current;
    pending.current = true; setSaving(true); setNotice('');
    try {
      const next = { ...draft, evidenceUrls: links.split(/\r?\n/).map(url => url.trim()).filter(Boolean) };
      for (const field of Object.keys(timeLabels) as TimeField[]) {
        if (times[field] === toShanghaiDateTimeInput(task[field])) { next[field] = task[field]; continue; }
        const value = fromShanghaiDateTimeInput(times[field]);
        if (times[field] && value === null) { setError(`请检查${timeLabels[field]}，填写内容已保留。`); return; }
        next[field] = value;
      }
      const confirming = (next.status === 'accepted' || next.status === 'review') && (reconfirm || next.status !== task.status);
      if(next.status==='accepted'||next.status==='review'){
        const issues=operationObjectReview(before.layout,next);
        if(issues.missingObjectIds.length){setError('直接关联物料已移除，请重新选择或取消关联后核对任务。');return;}
        if(issues.ambiguousObjectIds.length){setError('直接关联物料不唯一，请取消该关联或核对场景中的原物件。');return;}
        if(issues.missingProductionObjectIds.length){setError('制作计划关联的物料已移除，请到“制作计划”页核对，原制作关联已保留。');return;}
        if(issues.ambiguousProductionObjectIds.length){setError('制作计划关联的物料不唯一，请到“制作计划”页核对，原制作关联已保留。');return;}
      }
      if (confirming) {
        next.reviewedBasis = await operationBasis(layout, next, checkins);
      } else if (task.reviewedBasis) next.reviewedBasis = task.reviewedBasis;
      const parsed = eventOperationTaskSchema.safeParse(next);
      if (!parsed.success) { setError(inputError(String(parsed.error.issues[0]?.path[0] ?? ''))); return; }
      if (!mounted.current) return;
      if (latest.current.disabled || latest.current.layout !== before.layout || latest.current.task !== before.task || canonical(latest.current.checkins??null)!==canonical(before.checkins??null)) {
        setError('场景或任务已变化，请按当前内容重新保存。'); return;
      }
      if (onSave(parsed.data)) {
        savedTask.current = parsed.data;
        setDraft(parsed.data); setTimes(timeInputs(parsed.data)); setBadTimeFields([]); setLinks(parsed.data.evidenceUrls.join('\n'));
        setError(''); setNotice('任务已更新，请留意本机保存状态。');
      }
    } catch { if (mounted.current) setError('任务核对失败，填写内容已保留，请重试。'); }
    finally { pending.current = false; if (mounted.current) setSaving(false); }
  }
  function submit(event: FormEvent): void { event.preventDefault(); void save(); }
  return <form className="sc-handoff-form sc-operation-form" onSubmit={submit}>
    {status === 'needs_review' && <p className="sc-handoff-review">任务条件、时间或关联场景已变化，请重新核对。原现场核对说明已保留。</p>}
    {reviewFailed && <p className="sc-handoff-error" role="alert">任务核对失败，请检查当前场景后重试。</p>}
    {(productionMissing.length>0||productionAmbiguous.length>0)&&<p className="sc-handoff-review">制作计划关联物料{productionMissing.length?`缺失 ${productionMissing.length} 件`:''}{productionMissing.length&&productionAmbiguous.length?'，':''}{productionAmbiguous.length?`不唯一 ${productionAmbiguous.length} 件`:''}，请到“制作计划”页核对。原制作关联保留，不会在此取消或重挂。</p>}
    <fieldset disabled={disabled || saving || status === 'checking'}>
      <label className="sc-field">任务标题<input value={draft.title} maxLength={eventOperationsLimits.title} onChange={event => setDraft({ ...draft, title: event.target.value })}/></label>
      <div className="sc-handoff-pair">
        <label className="sc-field">阶段<select value={draft.phase} onChange={event => setDraft({ ...draft, phase: event.target.value as EventOperationTask['phase'] })}>{eventOperationPhases.map(phase => <option key={phase} value={phase}>{OPERATION_PHASE_LABELS[phase]}</option>)}</select></label>
        <label className="sc-field">负责人<input value={draft.ownerName} maxLength={eventOperationsLimits.ownerName} placeholder="姓名或负责团队，可暂留空" onChange={event => setDraft({ ...draft, ownerName: event.target.value })}/></label>
      </div>
      <div className="sc-handoff-pair">{(['plannedStartAt', 'plannedEndAt'] as const).map(field => <label key={field} className="sc-field">{timeLabels[field]}<input type="datetime-local" step="0.001" value={times[field]} onChange={event => changeTime(field, event)}/></label>)}</div>
      <p className="sc-note sc-operation-time-note">时间按北京时间填写。未安排的时间可留空。</p>
      <label className="sc-field">完成条件<textarea rows={3} maxLength={eventOperationsLimits.acceptance} value={draft.acceptance} placeholder="写明完成后需要现场检查的结果" onChange={event => setDraft({ ...draft, acceptance: event.target.value })}/></label>
      <label className="sc-field">任务状态<select value={draft.status} onChange={event => setDraft({ ...draft, status: event.target.value as EventOperationTask['status'] })}>{(['todo', 'doing', 'review', 'accepted'] as const).map(value => <option key={value} value={value}>{OPERATION_STATUS_LABELS[value]}</option>)}</select></label>
      <details className="sc-operation-more">
        <summary>承接团队与实际时间</summary>
        <label className="sc-field">承接团队<input value={draft.contractorName} maxLength={eventOperationsLimits.contractorName} placeholder="可选，填写实际承接或外包团队" onChange={event => setDraft({ ...draft, contractorName: event.target.value })}/></label>
        <div className="sc-handoff-pair">{(['actualStartedAt', 'actualFinishedAt'] as const).map(field => <label key={field} className="sc-field">{timeLabels[field]}<input type="datetime-local" step="0.001" value={times[field]} onChange={event => changeTime(field, event)}/></label>)}</div>
        <p className="sc-note">只记录实际发生的时间，尚未记录时留空。</p>
      </details>
      <label className="sc-field">现场核对说明<textarea rows={2} maxLength={eventOperationsLimits.evidenceNote} value={draft.evidenceNote} placeholder="填写实际检查结果，确认完成时必填" onChange={event => setDraft({ ...draft, evidenceNote: event.target.value })}/></label>
      <details className="sc-operation-more"><summary>证据链接与关联物料 · {draft.objectIds.length} 件</summary>
        <label className="sc-field">证据链接<textarea rows={2} maxLength={(handoffLimits.evidenceUrl + 1) * handoffLimits.evidenceUrls} value={links} placeholder="每行一个可供执行方访问的链接" onChange={event => setLinks(event.target.value)}/></label>
        <p className="sc-note">签到、主持等任务可以不关联物料。</p>
        {!!missing.length && <p className="sc-handoff-review">已有 {missing.length} 件关联物料不在当前场景，请重新选择或取消关联。不会自动关联同名物料。</p>}
        {!!ambiguous.length&&<p className="sc-handoff-review">有 {ambiguous.length} 件直接关联物料不唯一，请取消关联或核对场景中的原物件。</p>}
        <div className="sc-operation-object-list">
          {missing.map((id, index) => <label key={id} className="sc-operation-object missing"><input type="checkbox" checked onChange={() => toggleObject(id, false)}/>已移除的关联物料 · {index + 1}</label>)}
          {ambiguous.map((id,index)=><label key={id} className="sc-operation-object missing"><input type="checkbox" checked onChange={()=>toggleObject(id,false)}/>关联不唯一的物料 · {index+1}</label>)}
          {objects.map((item, index) => <div key={`${item.id}:${index}`} className="sc-operation-object-row"><label className="sc-operation-object"><input type="checkbox" checked={draft.objectIds.some(id=>objectKey(id)===objectKey(item.id))} disabled={(objectCounts.get(objectKey(item.id))??0)>1} onChange={event => toggleObject(item.id, event.target.checked)}/>{item.name} · {index + 1}<small>{item.floorName}</small></label>{onLocate && <button className="sc-button" type="button" aria-label={`定位${item.name} · ${index + 1}`} onClick={() => onLocate(item.id)}>定位</button>}</div>)}
        </div>
        {!objects.length && !hasObjectProblems && <p className="sc-note">当前场景暂无物料，可直接保存任务。</p>}
      </details>
      <div className="sc-handoff-actions">
        <button className="sc-button" type="submit">{saving ? '正在保存…' : draft.status === 'accepted' && task.status !== 'accepted' ? '确认完成' : draft.status === 'review' && task.status !== 'review' ? '提交核对' : '保存任务'}</button>
        {status === 'needs_review' && draft.status === 'accepted' && task.status === 'accepted' && <button className="sc-button" type="button" disabled={hasObjectProblems} onClick={() => void save(true)}>重新确认完成</button>}
        {status === 'needs_review' && draft.status === 'review' && task.status === 'review' && <button className="sc-button" type="button" disabled={hasObjectProblems} onClick={() => void save(true)}>重新提交核对</button>}
        <button className="sc-button" type="button" onClick={onDelete}>删除任务</button>
      </div>
    </fieldset>
    <div className="sc-handoff-actions"><button className="sc-button" type="button" disabled={!dirty || saving} onClick={discard}>放弃修改</button></div>
    {error && <p className="sc-handoff-error" role="alert">{error}</p>}
    {notice && <p className="sc-note" role="status">{notice}</p>}
  </form>;
}

export function EventOperationsPanel({ layout, disabled, onUpdate, onLocate, briefState, onOpenBrief, checkins, suggestionsPanel }: Props): JSX.Element {
  const operations = layout.eventOperations ?? emptyOperations;
  const [title, setTitle] = useState(''), [phase, setPhase] = useState<EventOperationTask['phase']>('preparation');
  const [openedTask, setOpenedTask] = useState<string | null>(null), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [deleted, setDeleted] = useState<{ task: EventOperationTask; index: number } | null>(null);
  const [addOpen, setAddOpen] = useState(operations.tasks.length === 0);
  const pendingFocus = useRef<{ id: string; scope: string | undefined } | null>(null);
  const taskDetails = useRef(new Map<string, HTMLDetailsElement>());
  const [reviews, setReviews] = useState<{ layout: RoomLayout; checkins: MaterialCheckinLedger | undefined; statuses: Record<string, { status: ReviewStatus; failed: boolean }> } | null>(null);
  const checkinsUnavailable=!!checkins&&!checkins.ready;
  const latest = useRef({ layout, disabled, title }); latest.current = { layout, disabled, title };
  const scope = layout.id ?? 'local';
  useEffect(() => registerSourceFlush(scope, async () => {
    if ((latest.current.layout.id ?? 'local') !== scope || !latest.current.title) return;
    const message = '新任务尚未添加，请先添加任务或放弃新增任务。';
    setError(message); throw new Error(message);
  }), [scope]);
  useEffect(() => {
    if(checkinsUnavailable){setReviews(null);return;}
    let cancelled = false;
    void Promise.all(operations.tasks.map(async task => {
      try { return [task.id, { status: (await operationReview(layout, task, checkins?.ledger)).status, failed: false }] as const; }
      catch { return [task.id, { status: task.status === 'accepted' || task.status === 'review' ? 'needs_review' as const : task.status, failed: true }] as const; }
    })).then(entries => { if (!cancelled) setReviews({ layout, checkins: checkins?.ledger, statuses: Object.fromEntries(entries) }); });
    return () => { cancelled = true; };
  }, [layout, operations.tasks, checkins?.ledger, checkinsUnavailable]);
  useEffect(() => { setTitle(''); setPhase('preparation'); setDeleted(null); setError(''); setNotice(''); setOpenedTask(null); pendingFocus.current = null; setAddOpen(!latest.current.layout.eventOperations?.tasks.length); }, [layout.id]);
  useEffect(() => {
    const pending = pendingFocus.current;
    if (!pending) return;
    if (pending.scope !== layout.id) { pendingFocus.current = null; return; }
    const input = taskDetails.current.get(pending.id)?.querySelector<HTMLInputElement>('input');
    if (!input || input.disabled) return;
    pendingFocus.current = null;
    input.focus(); input.scrollIntoView?.({ block: 'nearest' });
  }, [layout, openedTask]);
  function update(next: EventOperations): boolean {
    if (latest.current.disabled) return false;
    const parsed = eventOperationsSchema.safeParse(next);
    if (!parsed.success) { setError('请检查活动安排，填写内容已保留。'); return false; }
    try { onUpdate(parsed.data); setError(''); return true; }
    catch (caught) { setError(caught instanceof Error ? caught.message : '活动安排未保存，原资料与填写内容已保留。'); return false; }
  }
  function add(event: FormEvent): void {
    event.preventDefault();
    if (disabled) return;
    try {
      const task = eventOperationTaskSchema.safeParse(createOperation(title, phase));
      if (!task.success) { setError(inputError('title')); return; }
      if (update({ ...operations, tasks: [...operations.tasks, task.data] })) {
        pendingFocus.current = { id: task.data.id, scope: layout.id };
        setTitle(''); setOpenedTask(task.data.id); setAddOpen(false); setNotice('任务已添加，人员和时间可稍后安排。');
      }
    } catch { setError(inputError('title')); }
  }
  function loadRehearsal(): void {
    if (disabled || operations.tasks.length) return;
    const example = eventOperationsSchema.safeParse(rehearsalExample);
    if (!example.success) { setError('演练安排暂不能读取，请稍后重试。'); return; }
    if (update(copyRehearsalOperations(example.data))) { setNotice('已载入6项30人共创示例任务，需求和场景保持原样。请按当前活动调整。'); setDeleted(null); }
  }
  const brief = briefState?.ready && !briefState.error && briefState.hasSavedBrief ? briefState.brief : null;
  const missingOwners = operations.tasks.filter(task => !task.ownerName.trim()).length;
  const missingPlans = operations.tasks.filter(task => !task.plannedStartAt || !task.plannedEndAt).length;
  const missingConditions = operations.tasks.filter(task => !task.acceptance.trim()).length;
  const missingSummary = [missingOwners && `负责人 ${missingOwners} 项`, missingPlans && `计划时间 ${missingPlans} 项`, missingConditions && `完成条件 ${missingConditions} 项`].filter(Boolean).join(' · ');
  const reviewsCurrent=reviews?.layout===layout&&reviews.checkins===checkins?.ledger&&!checkinsUnavailable;
  const currentReviews = reviewsCurrent ? operations.tasks.map(task => reviews.statuses[task.id]) : [];
  const needsReview = currentReviews.filter(review => review?.status === 'needs_review' && !review.failed).length;
  const failedReviews = currentReviews.filter(review => review?.failed).length;
  return <section className="sc-event-operations" aria-label="活动安排">
    {checkinsUnavailable&&<p className="sc-handoff-review">{checkins?.error??'点验资料尚未就绪，暂不能确认活动任务。'}<button className="sc-button" type="button" onClick={checkins?.retry}>重新读取点验</button></p>}
    <div className="sc-operation-brief">
      <div className="sc-operation-brief-heading"><div className="sc-operation-project"><small>当前项目</small><h3>{layout.name || '未命名项目'}</h3></div><button className="sc-button" type="button" disabled={!onOpenBrief} onClick={onOpenBrief}>{brief ? '查看活动需求' : '打开活动需求表单'}</button></div>
      {brief ? <><p className="sc-note">已保存需求草稿 · {brief.event} · 预计 {brief.guests} 人</p><details className="sc-operation-brief-details" open={operations.tasks.length ? undefined : true}><summary>需求详情</summary><p className="sc-operation-brief-text">{brief.description || '需求说明尚未填写。'}</p>{brief.mustHave && <p className="sc-note">必需项：{brief.mustHave}</p>}</details></> : <p className={briefState?.error ? 'sc-handoff-error' : 'sc-note'} role={briefState?.error ? 'alert' : undefined}>{briefState?.error ? '活动需求无法读取或尚未保存，请打开原表单核对。' : briefState && !briefState.ready ? '正在读取活动需求…' : '活动需求尚未填写或未保存。'}</p>}
    </div>
    <p className="sc-note sc-operation-guide">活动安排管理布场、签到、主持与撤场；物料工作单逐件核对规格与摆放。</p>
    {suggestionsPanel}
    <div className="sc-operation-toolbar"><strong className="sc-operation-kind-label">{operations.dataKind === 'rehearsal' ? '演练安排' : operations.dataKind === 'real' ? '真实活动安排' : '活动任务'} · {operations.tasks.length} 项</strong><label className="sc-field sc-operation-kind">资料类型<select disabled={disabled} value={operations.dataKind} onChange={event => { if (update({ ...operations, dataKind: event.target.value as EventOperations['dataKind'] })) setNotice('资料类型已更新，请留意本机保存状态。'); }}><option value="unspecified">未标注</option><option value="rehearsal">演练</option><option value="real">真实</option></select></label></div>
    {(missingSummary || needsReview > 0 || failedReviews > 0) && <div className="sc-operation-overview" role="group" aria-label="任务待补与复核">
      {missingSummary && <p className="sc-note">待补 · {missingSummary}</p>}
      {needsReview > 0 && <p className="sc-handoff-review">需复核 {needsReview} 项，请展开任务重新核对。</p>}
      {failedReviews > 0 && <p className="sc-handoff-error" role="alert">有 {failedReviews} 项任务核对失败，请展开任务检查后重试。</p>}
    </div>}
    {!!operations.tasks.length && eventOperationPhases.map(value => {
      const tasks = operations.tasks.filter(task => task.phase === value);
      return <div key={value} className="sc-operation-phase"><h3>{OPERATION_PHASE_LABELS[value]} <small>{tasks.length} 项</small></h3>
        <div className="sc-handoff-list">{tasks.map(task => {
          const review = reviewsCurrent ? reviews.statuses[task.id] : undefined;
          const status = review?.status ?? (task.status === 'accepted' || task.status === 'review' ? 'checking' : task.status);
          const objectIssues=operationObjectReview(layout,task),missingCount=objectIssues.missingObjectIds.length;
          const plannedTime = (time: string | null): string => time ? toShanghaiDateTimeInput(time).replace('T', ' ').replace(/:00$/, '') : '待安排';
          const plan = task.plannedStartAt || task.plannedEndAt ? `${plannedTime(task.plannedStartAt)} → ${plannedTime(task.plannedEndAt)} · 北京时间` : '计划时间待安排';
          const incomplete = [!task.acceptance && '完成条件待填写', task.status !== 'todo' && (!task.actualStartedAt || !task.actualFinishedAt) && '实际时间未完整记录'].filter(Boolean);
          return <details key={task.id} ref={element => { if (element) taskDetails.current.set(task.id, element); else taskDetails.current.delete(task.id); }} className="sc-handoff-item" open={openedTask === task.id ? true : undefined} onToggle={event => { if (!event.currentTarget.open && openedTask === task.id) setOpenedTask(null); }}>
            <summary><span>{task.title}<small className="sc-operation-task-plan">{task.ownerName ? `负责人 · ${task.ownerName}` : '负责人待安排'} · {plan}</small>{incomplete.length > 0 && <small>{incomplete.join(' · ')}</small>}{missingCount > 0 && <small className="sc-handoff-review">{missingCount} 件关联物料已移除</small>}{objectIssues.ambiguousObjectIds.length>0&&<small className="sc-handoff-review">{objectIssues.ambiguousObjectIds.length} 件直接关联物料不唯一</small>}{(objectIssues.missingProductionObjectIds.length>0||objectIssues.ambiguousProductionObjectIds.length>0)&&<small className="sc-handoff-review">制作计划物料关联待核对，请在制作计划页检查。</small>}</span><span className={`sc-handoff-status ${status === 'needs_review' ? 'needs-review' : ''}`}>{status === 'checking' ? '正在核对…' : OPERATION_STATUS_LABELS[status]}</span></summary>
            <OperationEditor layout={layout} task={task} status={status} reviewFailed={review?.failed ?? false} disabled={disabled||checkinsUnavailable} checkins={checkins?.ledger} onLocate={onLocate} onSave={next => update({ ...operations, tasks: operations.tasks.map(current => current.id === task.id ? next : current) })} onDelete={() => {
              if (update({ ...operations, tasks: operations.tasks.filter(current => current.id !== task.id) })) { setDeleted({ task, index: operations.tasks.indexOf(task) }); setNotice('任务已删除，可撤销删除。'); }
            }}/>
          </details>;
        })}</div>
      </div>;
    })}
    <details className="sc-operation-add-details" open={!operations.tasks.length || addOpen} onToggle={event => {
      const element = event.currentTarget;
      setAddOpen(element.open);
      if (!element.open && element.contains(document.activeElement)) element.querySelector('summary')?.focus();
    }}><summary>新增任务</summary>{!operations.tasks.length && <p className="sc-note">先写一项任务，再补负责人、计划时间和完成条件。可以不关联物料。</p>}<form className="sc-operation-add" onSubmit={add}>
      <fieldset disabled={disabled || operations.tasks.length >= eventOperationsLimits.tasks}>
        <label className="sc-field">新任务标题<input value={title} maxLength={eventOperationsLimits.title} placeholder="如签到、主持或撤场交接" onChange={event => setTitle(event.target.value)}/></label>
        <div className="sc-operation-add-actions"><label className="sc-field">新任务阶段<select value={phase} onChange={event => setPhase(event.target.value as EventOperationTask['phase'])}>{eventOperationPhases.map(value => <option key={value} value={value}>{OPERATION_PHASE_LABELS[value]}</option>)}</select></label><button className="sc-button" type="submit">添加任务</button></div>
      </fieldset>
      <div className="sc-handoff-actions"><button className="sc-button" type="button" disabled={!title} onClick={() => { setTitle(''); setPhase('preparation'); setError(''); setNotice(''); }}>放弃新增任务</button></div>
    </form></details>
    {!operations.tasks.length && <div className="sc-operation-example"><p className="sc-note">30人共创示例，共6项任务；载入后请按当前活动调整。需求和场景保持原样。</p><button type="button" className="sc-button" disabled={disabled} onClick={loadRehearsal}>载入演练任务示例</button></div>}
    {operations.tasks.length >= eventOperationsLimits.tasks && <p className="sc-note">已达到 {eventOperationsLimits.tasks} 项任务，请整理已有安排。</p>}
    {deleted && <button type="button" className="sc-button" disabled={disabled || operations.tasks.some(task => task.id === deleted.task.id)} onClick={() => {
      const tasks = [...operations.tasks]; tasks.splice(Math.min(deleted.index, tasks.length), 0, deleted.task);
      if (update({ ...operations, tasks })) { setDeleted(null); setNotice('任务已恢复。'); }
    }}>撤销删除任务</button>}
    <p className="sc-note">活动安排随场景保存在此浏览器。人员、时间和完成条件未定时可先保存草稿。</p>
    {error && <p className="sc-handoff-error" role="alert">{error}</p>}
    {notice && <p className="sc-note" role="status">{notice}</p>}
  </section>;
}
