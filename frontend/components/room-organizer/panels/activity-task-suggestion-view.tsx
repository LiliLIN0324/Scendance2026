'use client';

import { catalog } from '../../../../supabase/functions/_shared/domain';
import { OPERATION_PHASE_LABELS, OPERATION_STATUS_LABELS, toShanghaiDateTimeInput } from '../lib/event-operations';
import type { ActivityTaskContext, ActivityTaskSelection, ActivityTaskSuggestionProposal } from '../../../lib/activity-task-suggestions';
import type { RoomLayout } from '../lib/types';
import './activity-task-suggestion-view.css';

export interface ActivityTaskSuggestionViewProps {
  layout: RoomLayout;
  selection: ActivityTaskSelection;
  availableBriefText?: string;
  instruction: string;
  onSelection(selection: ActivityTaskSelection): void;
  onInstruction(instruction: string): void;
  context: ActivityTaskContext | null;
  proposal: ActivityTaskSuggestionProposal | null;
  selectedSuggestionIds: readonly string[];
  onSelectedSuggestionIds(ids: string[]): void;
  approvedDisclosure: boolean;
  onApprovedDisclosure(approved: boolean): void;
  busy: boolean;
  availabilityReason: string | null;
  stale: boolean;
  phase: 'selection' | 'requested' | 'prepared' | 'saving' | 'closed' | 'cancelled' | 'failed';
  error: string | null;
  notice: string | null;
  onPreview(): void;
  onSend(): void;
  onRecover(): void;
  onCancel(): void;
  onAccept(): void;
  onNewRequest(): void;
  onVerifySave(): void;
  onRetrySave?(): void;
}

function toggled(ids: readonly string[], id: string, checked: boolean): string[] {
  return checked ? [...ids.filter(value => value !== id), id] : ids.filter(value => value !== id);
}

const displayNumber = (value: number): string => String(Number(value.toFixed(2)));

function positionLabel(position: { x: number; z: number } | null | undefined): string {
  return position ? `位置 X ${displayNumber(position.x)} m / Z ${displayNumber(position.z)} m` : '位置未记录';
}

function plannedTimeLabel(value: string | null): string {
  return value ? `${toShanghaiDateTimeInput(value).replace('T', ' ').replace(/:00$/, '')} · 北京时间` : '未填写';
}

export function ActivityTaskSuggestionView(props: ActivityTaskSuggestionViewProps): JSX.Element {
  const { layout, selection, context, proposal, phase, busy, stale, availabilityReason } = props;
  const availableBriefText = props.availableBriefText;
  const tasks = layout.eventOperations?.tasks ?? [];
  const objects = layout.floors.flatMap(floor => floor.items.map(item => ({ floor, item })));
  const editable = phase === 'selection' && !busy;
  const chosen = proposal?.tasks.filter(task => props.selectedSuggestionIds.includes(task.id)) ?? [];
  const readyToSend = phase === 'selection' && context !== null && props.approvedDisclosure && !busy && !stale && !availabilityReason;
  const readyToAccept = phase === 'prepared' && chosen.length > 0 && chosen.length === props.selectedSuggestionIds.length && !busy && !stale && !availabilityReason;
  const objectNames = (ids: readonly string[]) => ids.map(id => {
    const disclosed = context?.summary.objects.find(item => item.id === id);
    return disclosed ? `${disclosed.name} · ${disclosed.floorName}` : '关联物件需核对';
  }).join('、') || '无关联物件';
  function changeSelection(next: ActivityTaskSelection): void {
    props.onApprovedDisclosure(false);
    props.onSelection(next);
  }

  return <details className="ats-view" open={context !== null || phase !== 'selection' || !!props.error}>
    <summary><strong>任务建议</strong><span>选资料 → 核对摘要 → 勾选保存</span></summary>
    <div className="ats-body">
      {availabilityReason && <p className="ats-note">{availabilityReason}</p>}
      {stale && <p className="ats-warning" role="status">活动资料已变化，本次摘要和建议不能继续确认。请重新选择资料。</p>}
      {props.error && <p className="ats-error" role="alert">{props.error}</p>}
      {props.notice && <p className="ats-note" role="status">{props.notice}</p>}

      {phase === 'selection' && <div className="ats-selection">
        <label className="ats-field">选定需求<textarea value={selection.briefText} disabled={!editable} rows={3}
          placeholder="只填写希望本次建议参考的需求"
          onChange={event => changeSelection({ ...selection, briefText: event.target.value })}/></label>
        {availableBriefText?.trim() && <button type="button" className="sc-button" disabled={!editable}
          onClick={() => changeSelection({ ...selection, briefText: availableBriefText })}>使用已保存需求</button>}
        <fieldset disabled={!editable} className="ats-picks"><legend>参考哪些原任务</legend>
          <div className="ats-choice-list">{tasks.length === 0 ? <p className="ats-note">当前没有活动任务，可以只选需求或物件。</p> : tasks.map(task => <label className="ats-pick" key={task.id}>
            <input type="checkbox" checked={selection.taskIds.includes(task.id)}
              onChange={event => changeSelection({ ...selection, taskIds: toggled(selection.taskIds, task.id, event.target.checked) })}/>
            <span>{task.title}<small>{OPERATION_PHASE_LABELS[task.phase]}</small></span>
          </label>)}</div>
        </fieldset>
        <fieldset disabled={!editable} className="ats-picks"><legend>参考哪些场景物件</legend>
          <div className="ats-choice-list">{objects.length === 0 ? <p className="ats-note">当前没有场景物件，可以只选需求或任务。</p> : objects.map(({ floor, item }) => <label className="ats-pick" key={`${floor.id}:${item.id}`}>
            <input type="checkbox" checked={selection.objectIds.includes(item.id)}
              onChange={event => changeSelection({ ...selection, objectIds: toggled(selection.objectIds, item.id, event.target.checked) })}/>
            <span>{item.name}<small>{floor.name} · {positionLabel(item.position)}</small></span>
          </label>)}</div>
        </fieldset>
        <label className="ats-field">希望整理什么任务<textarea value={props.instruction} disabled={!editable} rows={2}
          placeholder="说明本次需要整理的任务"
          onChange={event => { props.onApprovedDisclosure(false); props.onInstruction(event.target.value); }}/></label>
        <button type="button" className="sc-button" disabled={!editable} onClick={props.onPreview}>查看待发送摘要</button>
      </div>}

      {context && <section className="ats-disclosure" aria-label="待发送摘要">
        <h3>待发送摘要</h3>
        <p className="ats-note">只发送下面的选定资料和本次要求，并保留当前活动及选定记录的编号以保持关联。文字不会自动脱敏，请核对后再发送。合同原件、照片、负责人、费用和证据字段不在本次摘要中。</p>
        <dl className="ats-facts">
          <dt>资料性质</dt><dd>{context.summary.dataKind === 'rehearsal' ? '演练' : context.summary.dataKind === 'real' ? '真实活动' : '未标注'}</dd>
          <dt>本次要求</dt><dd>{props.instruction || '未填写'}</dd>
          <dt>选定需求</dt><dd>{context.summary.briefText || '未选择需求文本'}</dd>
        </dl>
        <h4>原任务 · {context.summary.tasks.length} 项</h4>
        {context.summary.tasks.length === 0 ? <p className="ats-note">未选择原任务</p> : <ul className="ats-records">{context.summary.tasks.map(task => <li key={task.id}>
          <strong>{task.title}</strong><span className="ats-meta">{OPERATION_PHASE_LABELS[task.phase]} · {OPERATION_STATUS_LABELS[task.status]}</span>
          <dl className="ats-facts"><dt>完成条件</dt><dd>{task.acceptance || '未填写'}</dd>
            <dt>计划开始</dt><dd>{plannedTimeLabel(task.plannedStartAt)}</dd><dt>计划结束</dt><dd>{plannedTimeLabel(task.plannedEndAt)}</dd>
            <dt>关联物件</dt><dd>{objectNames(task.objectIds)}</dd></dl>
        </li>)}</ul>}
        <h4>场景物件 · {context.summary.objects.length} 件</h4>
        {context.summary.objects.length === 0 ? <p className="ats-note">未选择场景物件</p> : <ul className="ats-records">{context.summary.objects.map(item => <li key={item.id}>
          <strong>{item.name}</strong><span className="ats-meta">{item.floorName}</span>
          <dl className="ats-facts"><dt>类型</dt><dd>{catalog.find(entry => entry.id === item.type)?.name ?? (item.type === 'glb-asset' ? '模型物料' : item.type)}</dd>
            <dt>宽 × 深 × 高</dt><dd>{displayNumber(item.size.width)} × {displayNumber(item.size.depth)} × {displayNumber(item.size.height)} m</dd>
            <dt>位置</dt><dd>{positionLabel(item.position)}</dd><dt>朝向</dt><dd>{item.rotation === null ? '未记录' : `${displayNumber(item.rotation * 180 / Math.PI)}°`}</dd>
            <dt>离地高度</dt><dd>{item.elevation === null ? '未记录' : `${displayNumber(item.elevation)} m`}</dd><dt>颜色</dt><dd>{item.color}</dd></dl>
        </li>)}</ul>}
        {phase === 'selection' && <div className="ats-actions">
          <label className="ats-approval"><input type="checkbox" checked={props.approvedDisclosure} disabled={busy || stale}
            onChange={event => props.onApprovedDisclosure(event.target.checked)}/>我已核对，确认发送以上内容</label>
          <button type="button" className="sc-button ats-primary" disabled={!readyToSend} onClick={props.onSend}>确认发送</button>
        </div>}
      </section>}

      {proposal && <section className="ats-proposal" aria-label="本次任务建议">
        <h3>本次任务建议 · {proposal.tasks.length} 项</h3>
        <p className="ats-note">建议仅包含任务标题、阶段、完成条件和关联物件。负责人、时间与现场记录由你在活动安排中补充。</p>
        <ul className="ats-records">{proposal.tasks.map(task => <li key={task.id}>
          <label className="ats-pick"><input type="checkbox" checked={props.selectedSuggestionIds.includes(task.id)} disabled={phase !== 'prepared' || busy || stale}
            onChange={event => props.onSelectedSuggestionIds(toggled(props.selectedSuggestionIds, task.id, event.target.checked))}/>
            <span><strong>{task.title}</strong><small>{OPERATION_PHASE_LABELS[task.phase]}</small></span></label>
          <dl className="ats-facts"><dt>完成条件</dt><dd>{task.acceptance}</dd><dt>关联物件</dt><dd>{objectNames(task.objectIds)}</dd></dl>
        </li>)}</ul>
        {phase === 'prepared' && <div className="ats-actions">
          <p className="ats-note">已勾选 {chosen.length} 项。勾选任务保存后，本批建议结束。</p>
          <button type="button" className="sc-button ats-primary" disabled={!readyToAccept} onClick={props.onAccept}>保存勾选任务</button>
        </div>}
      </section>}

      <div className="ats-actions ats-result-actions">
        {(phase === 'requested' || phase === 'failed') && <>
          <p className="ats-note">查询同一次请求，不会再次生成。查询结果仍需你勾选保存。</p>
          <button type="button" className="sc-button" disabled={busy} onClick={props.onRecover}>查询原请求</button>
        </>}
        {phase === 'saving' && <>
          <p className="ats-note" role="status">保存结果尚待核对，请核对原保存结果。</p>
          <button type="button" className="sc-button" disabled={busy} onClick={props.onVerifySave}>核对原保存结果</button>
          {props.onRetrySave && <button type="button" className="sc-button" disabled={busy} onClick={props.onRetrySave}>重试原任务保存</button>}
        </>}
        {phase === 'closed' && <p className="ats-note" role="status">勾选任务已保存，可在活动安排中继续编辑。</p>}
        {phase === 'cancelled' && <p className="ats-note" role="status">本次建议已取消。</p>}
        {(phase === 'requested' || phase === 'prepared') && <button type="button" className="sc-button" disabled={phase === 'prepared' && busy} onClick={props.onCancel}>取消本次建议</button>}
        {(phase === 'closed' || phase === 'cancelled' || phase === 'failed' || (phase === 'selection' && stale)) && <button type="button" className="sc-button" disabled={busy} onClick={props.onNewRequest}>重新选择资料</button>}
      </div>
    </div>
  </details>;
}
