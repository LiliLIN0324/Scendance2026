'use client';

import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import rehearsalExample from '../../../../docs/examples/30-person-rehearsal-operations.json';
import { handoffLimits } from '../../../../supabase/functions/_shared/delivery-contract';
import { eventOperationPhases, eventOperationsLimits, eventOperationsSchema, eventOperationTaskSchema, type EventOperations, type EventOperationTask } from '../../../../supabase/functions/_shared/event-operations-contract';
import { copyRehearsalOperations, createOperation, fromShanghaiDateTimeInput, operationBasis, operationReview, OPERATION_PHASE_LABELS, OPERATION_STATUS_LABELS, toShanghaiDateTimeInput } from '../lib/event-operations';
import type { CreativeBrief } from '../lib/creative-brief';
import type { RoomLayout } from '../lib/types';
import './scene-delivery-panel.css';
import './event-operations-panel.css';

interface Props {
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

function OperationEditor({ layout, task, status, reviewFailed, disabled, onSave, onDelete, onLocate }: {
  layout: RoomLayout; task: EventOperationTask; status: ReviewStatus; reviewFailed: boolean; disabled: boolean;
  onSave(task: EventOperationTask): boolean; onDelete(): void; onLocate: Props['onLocate'];
}): JSX.Element {
  const [draft, setDraft] = useState(task);
  const [times, setTimes] = useState(() => timeInputs(task));
  const [badTimeFields, setBadTimeFields] = useState<TimeField[]>([]);
  const [links, setLinks] = useState(task.evidenceUrls.join('\n'));
  const [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);
  const pending = useRef(false), mounted = useRef(true);
  const taskSnapshot = JSON.stringify(task);
  const latest = useRef({ layout, task, disabled }); latest.current = { layout, task, disabled };
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    const restored = eventOperationTaskSchema.parse(JSON.parse(taskSnapshot));
    setDraft(restored); setTimes(timeInputs(restored)); setBadTimeFields([]); setLinks(restored.evidenceUrls.join('\n')); setError('');
  }, [taskSnapshot]);
  const objects = layout.floors.flatMap(floor => floor.items.map(item => ({ ...item, floorName: floor.name })));
  const missing = draft.objectIds.filter(id => !objects.some(item => item.id === id));
  const toggleObject = (id: string, checked: boolean): void => setDraft(current => ({ ...current, objectIds: checked ? [...current.objectIds, id] : current.objectIds.filter(value => value !== id) }));
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
      if (confirming) {
        if (missing.length) { setError('关联物料已移除，请重新选择或取消关联后核对任务。'); return; }
        next.reviewedBasis = await operationBasis(layout, next);
      } else if (task.reviewedBasis) next.reviewedBasis = task.reviewedBasis;
      const parsed = eventOperationTaskSchema.safeParse(next);
      if (!parsed.success) { setError(inputError(String(parsed.error.issues[0]?.path[0] ?? ''))); return; }
      if (!mounted.current) return;
      if (latest.current.disabled || latest.current.layout !== before.layout || latest.current.task !== before.task) {
        setError('场景或任务已变化，请按当前内容重新保存。'); return;
      }
      if (onSave(parsed.data)) { setError(''); setNotice('任务已更新，请留意本机保存状态。'); }
    } catch { if (mounted.current) setError('任务核对失败，填写内容已保留，请重试。'); }
    finally { pending.current = false; if (mounted.current) setSaving(false); }
  }
  function submit(event: FormEvent): void { event.preventDefault(); void save(); }
  return <form className="sc-handoff-form sc-operation-form" onSubmit={submit}>
    {status === 'needs_review' && <p className="sc-handoff-review">任务条件、时间或关联场景已变化，请重新核对。原现场核对说明已保留。</p>}
    {reviewFailed && <p className="sc-handoff-error" role="alert">任务核对失败，请检查当前场景后重试。</p>}
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
        <div className="sc-operation-object-list">
          {missing.map((id, index) => <label key={id} className="sc-operation-object missing"><input type="checkbox" checked onChange={() => toggleObject(id, false)}/>已移除的关联物料 · {index + 1}</label>)}
          {objects.map((item, index) => <div key={`${item.id}:${index}`} className="sc-operation-object-row"><label className="sc-operation-object"><input type="checkbox" checked={draft.objectIds.includes(item.id)} onChange={event => toggleObject(item.id, event.target.checked)}/>{item.name} · {index + 1}<small>{item.floorName}</small></label>{onLocate && <button className="sc-button" type="button" aria-label={`定位${item.name} · ${index + 1}`} onClick={() => onLocate(item.id)}>定位</button>}</div>)}
        </div>
        {!objects.length && !missing.length && <p className="sc-note">当前场景暂无物料，可直接保存任务。</p>}
      </details>
      <div className="sc-handoff-actions">
        <button className="sc-button" type="submit">{saving ? '正在保存…' : draft.status === 'accepted' && task.status !== 'accepted' ? '确认完成' : draft.status === 'review' && task.status !== 'review' ? '提交核对' : '保存任务'}</button>
        {status === 'needs_review' && draft.status === 'accepted' && task.status === 'accepted' && <button className="sc-button" type="button" disabled={missing.length > 0} onClick={() => void save(true)}>重新确认完成</button>}
        {status === 'needs_review' && draft.status === 'review' && task.status === 'review' && <button className="sc-button" type="button" disabled={missing.length > 0} onClick={() => void save(true)}>重新提交核对</button>}
        <button className="sc-button" type="button" onClick={onDelete}>删除任务</button>
      </div>
    </fieldset>
    {error && <p className="sc-handoff-error" role="alert">{error}</p>}
    {notice && <p className="sc-note" role="status">{notice}</p>}
  </form>;
}

export function EventOperationsPanel({ layout, disabled, onUpdate, onLocate, briefState, onOpenBrief }: Props): JSX.Element {
  const operations = layout.eventOperations ?? emptyOperations;
  const [title, setTitle] = useState(''), [phase, setPhase] = useState<EventOperationTask['phase']>('preparation');
  const [openedTask, setOpenedTask] = useState<string | null>(null), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [deleted, setDeleted] = useState<{ task: EventOperationTask; index: number } | null>(null);
  const [addOpen, setAddOpen] = useState(operations.tasks.length === 0);
  const pendingFocus = useRef<{ id: string; scope: string | undefined } | null>(null);
  const taskDetails = useRef(new Map<string, HTMLDetailsElement>());
  const [reviews, setReviews] = useState<{ layout: RoomLayout; statuses: Record<string, { status: ReviewStatus; failed: boolean }> } | null>(null);
  const latest = useRef({ layout, disabled }); latest.current = { layout, disabled };
  useEffect(() => {
    let cancelled = false;
    void Promise.all(operations.tasks.map(async task => {
      try { return [task.id, { status: (await operationReview(layout, task)).status, failed: false }] as const; }
      catch { return [task.id, { status: task.status === 'accepted' || task.status === 'review' ? 'needs_review' as const : task.status, failed: true }] as const; }
    })).then(entries => { if (!cancelled) setReviews({ layout, statuses: Object.fromEntries(entries) }); });
    return () => { cancelled = true; };
  }, [layout, operations.tasks]);
  useEffect(() => { setDeleted(null); setError(''); setNotice(''); setOpenedTask(null); pendingFocus.current = null; setAddOpen(!latest.current.layout.eventOperations?.tasks.length); }, [layout.id]);
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
    if (update(copyRehearsalOperations(example.data))) { setNotice('已载入30人演练安排，请按当前场景补充人员、时间与关联物料。'); setDeleted(null); }
  }
  const brief = briefState?.ready && !briefState.error && briefState.hasSavedBrief ? briefState.brief : null;
  return <section className="sc-event-operations" aria-label="活动安排">
    <div className="sc-operation-brief">
      <div className="sc-operation-brief-heading"><h3>活动需求</h3><button className="sc-button" type="button" disabled={!onOpenBrief} onClick={onOpenBrief}>{brief ? '查看活动需求' : '打开活动需求表单'}</button></div>
      {brief ? <><p className="sc-note">已保存需求草稿 · {brief.event} · 预计 {brief.guests} 人</p><details className="sc-operation-brief-details" open={operations.tasks.length ? undefined : true}><summary>需求详情</summary><p className="sc-operation-brief-text">{brief.description || '需求说明尚未填写。'}</p>{brief.mustHave && <p className="sc-note">必需项：{brief.mustHave}</p>}</details></> : <p className={briefState?.error ? 'sc-handoff-error' : 'sc-note'} role={briefState?.error ? 'alert' : undefined}>{briefState?.error ? '活动需求无法读取或尚未保存，请打开原表单核对。' : briefState && !briefState.ready ? '正在读取活动需求…' : '活动需求尚未填写或未保存。'}</p>}
    </div>
    <div className="sc-operation-toolbar"><strong className="sc-operation-kind-label">{operations.dataKind === 'rehearsal' ? '演练安排' : operations.dataKind === 'real' ? '真实活动安排' : '活动任务'} · {operations.tasks.length} 项</strong><label className="sc-field sc-operation-kind">资料类型<select disabled={disabled} value={operations.dataKind} onChange={event => { if (update({ ...operations, dataKind: event.target.value as EventOperations['dataKind'] })) setNotice('资料类型已更新，请留意本机保存状态。'); }}><option value="unspecified">未标注</option><option value="rehearsal">演练</option><option value="real">真实</option></select></label></div>
    {!operations.tasks.length && <><p className="sc-note">先添加一项活动任务，可以不关联物料。</p><button type="button" className="sc-button" disabled={disabled} onClick={loadRehearsal}>载入30人演练安排</button></>}
    {!!operations.tasks.length && eventOperationPhases.map(value => {
      const tasks = operations.tasks.filter(task => task.phase === value);
      return <div key={value} className="sc-operation-phase"><h3>{OPERATION_PHASE_LABELS[value]} <small>{tasks.length} 项</small></h3>
        <div className="sc-handoff-list">{tasks.map(task => {
          const review = reviews?.layout === layout ? reviews.statuses[task.id] : undefined;
          const status = review?.status ?? (task.status === 'accepted' || task.status === 'review' ? 'checking' : task.status);
          const missingCount = task.objectIds.filter(id => !layout.floors.some(floor => floor.items.some(item => item.id === id))).length;
          const plannedTime = (time: string | null): string => time ? toShanghaiDateTimeInput(time).replace('T', ' ').replace(/:00$/, '') : '待安排';
          const plan = task.plannedStartAt || task.plannedEndAt ? `${plannedTime(task.plannedStartAt)} → ${plannedTime(task.plannedEndAt)} · 北京时间` : '计划时间待安排';
          const incomplete = [!task.acceptance && '完成条件待填写', task.status !== 'todo' && (!task.actualStartedAt || !task.actualFinishedAt) && '实际时间未完整记录'].filter(Boolean);
          return <details key={task.id} ref={element => { if (element) taskDetails.current.set(task.id, element); else taskDetails.current.delete(task.id); }} className="sc-handoff-item" open={openedTask === task.id ? true : undefined} onToggle={event => { if (!event.currentTarget.open && openedTask === task.id) setOpenedTask(null); }}>
            <summary><span>{task.title}<small className="sc-operation-task-plan">{task.ownerName ? `负责人 · ${task.ownerName}` : '负责人待安排'} · {plan}</small>{incomplete.length > 0 && <small>{incomplete.join(' · ')}</small>}{missingCount > 0 && <small className="sc-handoff-review">{missingCount} 件关联物料已移除</small>}</span><span className={`sc-handoff-status ${status === 'needs_review' ? 'needs-review' : ''}`}>{status === 'checking' ? '正在核对…' : OPERATION_STATUS_LABELS[status]}</span></summary>
            <OperationEditor layout={layout} task={task} status={status} reviewFailed={review?.failed ?? false} disabled={disabled} onLocate={onLocate} onSave={next => update({ ...operations, tasks: operations.tasks.map(current => current.id === task.id ? next : current) })} onDelete={() => {
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
    }}><summary>新增任务</summary><form className="sc-operation-add" onSubmit={add}>
      <fieldset disabled={disabled || operations.tasks.length >= eventOperationsLimits.tasks}>
        <label className="sc-field">新任务标题<input value={title} maxLength={eventOperationsLimits.title} placeholder="如签到、主持或撤场交接" onChange={event => setTitle(event.target.value)}/></label>
        <div className="sc-operation-add-actions"><label className="sc-field">新任务阶段<select value={phase} onChange={event => setPhase(event.target.value as EventOperationTask['phase'])}>{eventOperationPhases.map(value => <option key={value} value={value}>{OPERATION_PHASE_LABELS[value]}</option>)}</select></label><button className="sc-button" type="submit">添加任务</button></div>
      </fieldset>
    </form></details>
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
