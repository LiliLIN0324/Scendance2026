'use client';

import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { readLocalProjectBackupFile, type LocalProjectRestoreCandidate } from '@/lib/local-project-backup';
import type { RoomLayout } from '../lib/types';
import type { CreativeBriefState, LocalProjectBackupActions } from './creative-studio';
import './local-project-backup-panel.css';

interface Props {
  layout: RoomLayout;
  actions: LocalProjectBackupActions;
  briefState?: CreativeBriefState | null | undefined;
  onComplete?: (() => void) | undefined;
}

function hasExternalModel(layout: RoomLayout): boolean {
  return layout.floors.some(floor => floor.items.some(item => !!item.glbUrl && !item.assetId)) ||
    !!layout.designBook?.variants.some(variant => hasExternalModel(variant.layout));
}

/** The file is only inspected here; the provider owns the complete restore transaction. */
export function LocalProjectBackupPanel({ layout, actions, briefState, onComplete }: Props): JSX.Element {
  const [candidate, setCandidate] = useState<LocalProjectRestoreCandidate | null>(null);
  const [candidateFileName, setCandidateFileName] = useState('');
  const [includeSourceDocuments, setIncludeSourceDocuments] = useState(false);
  const [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [working, setWorking] = useState<'read' | 'download' | 'restore' | 'undo' | null>(null);
  const mounted = useRef(true);
  const operation = useRef({ id: 0, kind: null as typeof working });
  const baseline = useRef({ layout, scope: layout.id ?? 'local', brief: briefState?.brief, epoch: 0 });
  if (baseline.current.layout !== layout || baseline.current.scope !== (layout.id ?? 'local') || baseline.current.brief !== briefState?.brief) {
    baseline.current = { layout, scope: layout.id ?? 'local', brief: briefState?.brief, epoch: baseline.current.epoch + 1 };
  }
  const epoch = baseline.current.epoch;
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; operation.current.id++; };
  }, []);
  useEffect(() => { setIncludeSourceDocuments(false); }, [layout.id]);
  useEffect(() => {
    // A successful restore changes this baseline itself. Its provider promise verifies that change.
    if (operation.current.kind === 'restore' || operation.current.kind === 'undo') return;
    operation.current = { id: operation.current.id + 1, kind: null };
    setWorking(null); setCandidate(null); setError(''); setNotice('');
  }, [epoch]);

  function begin(kind: NonNullable<typeof working>): { id: number; epoch: number; scope: string } {
    const next = { id: operation.current.id + 1, kind };
    operation.current = next; setWorking(kind); setError(''); setNotice('');
    return { id: next.id, epoch: baseline.current.epoch, scope: baseline.current.scope };
  }
  function current(token: { id: number; epoch: number }, checkBaseline = true): boolean {
    return mounted.current && operation.current.id === token.id && (!checkBaseline || baseline.current.epoch === token.epoch);
  }
  function finish(token: { id: number; epoch: number }): void {
    if (current(token, false)) { operation.current.kind = null; setWorking(null); }
  }
  function locked(): boolean {
    return actions.backupPending || (operation.current.kind !== null && operation.current.kind !== 'read');
  }
  async function choose(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || locked()) return;
    const token = begin('read');
    try {
      const next = await readLocalProjectBackupFile(file, { allowSourceDocuments: true });
      if (current(token)) { setCandidate(next); setCandidateFileName(file.name); }
    } catch (caught) {
      if (current(token)) {
        const message = caught instanceof Error ? caught.message : '读取文件失败，请重新选择。当前项目未改变。';
        setError(candidate ? `${message} 新文件未读入，当前仍是上一份「${candidate.layout.name}」。` : message);
      }
    } finally { finish(token); }
  }
  async function download(): Promise<void> {
    if (locked() || operation.current.kind === 'read') return;
    const token = begin('download');
    try {
      const text = includeSourceDocuments
        ? await actions.prepareBackup({ includeSourceDocuments: true })
        : await actions.prepareBackup();
      if (!current(token)) return;
      const { downloadSceneDelivery } = await import('../lib/scene-delivery');
      if (!current(token)) return;
      downloadSceneDelivery(text, 'application/json', `${layout.name}_场景与活动备份_${new Date().toISOString()}`, 'json');
      setNotice('已发起场景与活动备份下载，请确认文件已保存。');
    } catch (caught) {
      if (current(token)) setError(caught instanceof Error ? caught.message : '下载未发起，请重试。当前资料已保留。');
    } finally { finish(token); }
  }
  async function restore(): Promise<void> {
    if (!candidate || locked() || operation.current.kind === 'read') return;
    const token = begin('restore');
    try {
      await actions.restoreBackup(candidate);
      if (current(token, false)) {
        setCandidate(null);
        setNotice(candidate.sourceDocuments?.status === 'present'
          ? '场景与活动备份已恢复，布局、活动需求与本机图纸资料已保存并核实。模型资源仍需另行加载。'
          : '场景与活动备份已恢复，布局与活动需求已保存并核实。模型资源仍需另行加载。');
        onComplete?.();
      }
    } catch (caught) {
      if (current(token, false)) {
        if (baseline.current.scope === token.scope) setError(caught instanceof Error ? caught.message : '恢复未完成，请重试。');
        else { setCandidate(null); setError(''); setNotice(''); }
      }
    } finally { finish(token); }
  }
  async function undo(): Promise<void> {
    if (!actions.canUndoRestore || locked() || operation.current.kind === 'read') return;
    const token = begin('undo');
    try {
      await actions.undoRestore();
      if (current(token, false)) { setCandidate(null); setNotice('本次恢复已撤销，原布局与活动需求已保存并核实。'); onComplete?.(); }
    } catch (caught) {
      if (current(token, false)) {
        if (baseline.current.scope === token.scope) setError(caught instanceof Error ? caught.message : '撤销未完成，请重试。');
        else { setCandidate(null); setError(''); setNotice(''); }
      }
    } finally { finish(token); }
  }
  function cancel(): void {
    if (locked()) return;
    operation.current = { id: operation.current.id + 1, kind: null };
    setWorking(null); setCandidate(null); setError(''); setNotice('');
  }
  const busy = actions.backupPending || !!working;
  const blocking = actions.backupPending || (!!working && working !== 'read');
  const sourceDocuments = candidate?.sourceDocuments;
  return <details className="sc-project-backup">
    <summary>场景与活动备份</summary>
    <p className="sc-note">保存可编辑布局、方案快照、活动需求、活动任务、物料工作单、制作计划、已提交的数量点验及核对依据。</p>
    <p className="sc-note">普通备份不包含图纸、照片或对应点，文件上限 8 MiB。</p>
    <label className="sc-note"><input type="checkbox" checked={includeSourceDocuments} disabled={busy} onChange={event => setIncludeSourceDocuments(event.target.checked)}/>包含图纸、照片与对应点</label>
    <p className="sc-note">勾选后会将当前项目保存在本机的图纸、照片与图纸表单（含对应点）写入备份，文件上限 96 MiB。图片可能包含现场或客户资料，请只交给可信任的人。</p>
    <p className="sc-note">不会下载云端图片。备份不包含模型文件、聊天或后台识别任务；模型只保留引用，换设备或授权失效后可能无法加载。</p>
    {hasExternalModel(layout) && <p className="sc-project-backup-warning">当前场景或方案快照含未归档模型引用，请保留原模型文件及可用地址。</p>}
    <div className="sc-project-backup-actions">
      <button type="button" className="sc-button" disabled={busy} onClick={() => void download()}>{working === 'download' ? '正在准备备份…' : '下载场景与活动备份'}</button>
      <label className="sc-project-backup-file">选择备份文件<input type="file" accept=".json,application/json" disabled={blocking} onChange={event => void choose(event)}/></label>
    </div>
    {working === 'read' && <p className="sc-note" role="status">正在读取并检查文件…</p>}
    {candidate && <div className="sc-project-backup-preview" aria-label="备份预检">
      <strong>已预检 · {candidate.layout.name}</strong>
      <dl>
        <div><dt>文件</dt><dd>{candidateFileName}</dd></div>
        <div><dt>格式</dt><dd>{candidate.source==='legacy-layout'?'旧布局文件':candidate.backupVersion?`完整项目备份 V${candidate.backupVersion}`:'完整项目备份'}</dd></div>
        <div><dt>项目</dt><dd>{candidate.layout.name}</dd></div>
        <div><dt>生成时间</dt><dd>{candidate.createdAt ? new Date(candidate.createdAt).toLocaleString() : '旧布局文件未记录'}</dd></div>
        <div><dt>内容</dt><dd>{candidate.layout.eventOperations?.tasks.length ?? 0} 个活动任务 · {candidate.layout.floors.reduce((count, floor) => count + floor.items.length, 0)} 个物件</dd></div>
        <div><dt>活动需求</dt><dd>{candidate.brief.status === 'present' ? '已包含' : candidate.brief.status === 'absent' ? '备份明确无已保存需求' : '旧文件未包含活动需求'}</dd></div>
        <div><dt>当前方案制作计划</dt><dd>{candidate.layout.productionPlan?`${candidate.layout.productionPlan.staffing.length} 项岗位需求 · ${candidate.layout.productionPlan.acquisitions.length} 项物料取得 · ${candidate.layout.productionPlan.estimates.length} 项人工估算`:'当前方案未记录制作计划'}</dd></div>
        <div><dt>数量点验</dt><dd>{candidate.materialCheckins?.status==='present'?`${candidate.materialCheckins.value.sheets.length} 张点验单 · ${candidate.materialCheckins.value.sheets.reduce((count,sheet)=>count+sheet.agreements.length+sheet.events.length,0)} 条原始记录`:'文件未含点验记录，保留本机已有账册'}</dd></div>
        <div><dt>图纸与照片</dt><dd>{sourceDocuments?.status === 'present'
          ? `${sourceDocuments.sources.length} 张图片 · ${sourceDocuments.form === undefined ? '未包含图纸表单' : '已包含图纸表单'}`
          : '文件未含图纸资料，保留目标项目已有图纸与对应点'}</dd></div>
      </dl>
      {candidate.layoutWasRepaired && <p className="sc-project-backup-warning">旧布局经兼容修复，请核对后再替换。</p>}
      {hasExternalModel(candidate.layout) && <p className="sc-project-backup-warning">文件或方案快照含未归档模型引用，模型文件未打包，可能无法跨设备使用。预检没有加载模型。</p>}
      <p className="sc-note">确认后会替换当前场景、活动安排、物料工作单和制作计划，并覆盖目标项目的活动需求。{candidate.brief.status !== 'present' ? '目标项目原有需求将清除。' : ''}</p>
      <p className="sc-note">点验记录按原编号合并；旧文件不会清除本机记录。出现内容冲突时保留双方资料并停止恢复。合并后若又新增点验记录，不能直接撤回此前合并。</p>
      {sourceDocuments?.status === 'present' && <p className="sc-project-backup-warning">确认后会用这份文件的图纸、照片与对应点替换目标项目的原资料。{sourceDocuments.form === undefined ? '文件未含图纸表单，目标项目原表单及对应点将清除。' : ''}</p>}
      {layout.productionPlan&&!candidate.layout.productionPlan&&<p className="sc-project-backup-warning">待恢复的当前方案未记录制作计划，恢复后当前制作计划将清除。需要时可使用“撤销本次恢复”回退。</p>}
      <div className="sc-project-backup-actions">
        <button type="button" className="sc-button" disabled={busy} onClick={() => void restore()}>{working === 'restore' ? '正在恢复并核实保存…' : candidate.materialCheckins?.status==='present'?'确认恢复并合并点验':'确认替换布局与活动需求'}</button>
        <button type="button" className="sc-button" disabled={blocking} onClick={cancel}>取消恢复</button>
      </div>
    </div>}
    {actions.canUndoRestore && <button type="button" className="sc-button" disabled={busy} onClick={() => void undo()}>{working === 'undo' ? '正在撤销并核实保存…' : '撤销本次恢复'}</button>}
    {error && <p className="sc-handoff-error" role="alert">{error}</p>}
    {notice && <p className="sc-note" role="status">{notice}</p>}
  </details>;
}
