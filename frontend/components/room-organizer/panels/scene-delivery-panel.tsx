'use client';

import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useBackendSession, type BackendSession } from '@/lib/backend-session';
import { handoffLimits, handoffSchema, type Handoff } from '../../../../supabase/functions/_shared/delivery-contract';
import { deliveryScene, deliveryMaterials, type DeliverySnapshot } from '../lib/scene-delivery';
import { blankHandoff, effectiveHandoffStatus, handoffBasis, HANDOFF_STATUS_LABELS } from '../lib/scene-handoff';
import { EventOperationsPanel } from './event-operations-panel';
import { LocalProjectBackupPanel } from './local-project-backup-panel';
import { ProductionPlanPanel } from './production-plan-panel';
import type { CreativeBriefState, LocalProjectBackupActions } from './creative-studio';
import type { EventOperations } from '../../../../supabase/functions/_shared/event-operations-contract';
import type { ProductionPlan } from '../../../../supabase/functions/_shared/production-plan-contract';
import type { FurnitureItem, RoomLayout } from '../lib/types';
import './scene-delivery-panel.css';

interface Props {
  layout: RoomLayout; controller: BackendSession;
  onUpdateItem?: ((id: string, patch: Partial<FurnitureItem>) => void) | undefined;
  onLocate?: ((id: string) => void) | undefined;
  onUpdateEventOperations?: ((value: EventOperations | undefined) => void) | undefined;
  onUpdateProductionPlan?: ((value: ProductionPlan | undefined) => void) | undefined;
  briefState?: CreativeBriefState | null | undefined;
  onOpenBrief?: (() => void) | undefined;
  backupActions?: LocalProjectBackupActions | null | undefined;
  onBackupRestored?: (() => void) | undefined;
}

function HandoffEditor({ layout, item, status, disabled, onUpdate }: {
  layout: RoomLayout; item: FurnitureItem; status: Handoff['status'] | 'needs_review' | 'checking'; disabled: boolean; onUpdate: NonNullable<Props['onUpdateItem']>;
}): JSX.Element {
  const [draft, setDraft] = useState<Handoff>(item.handoff ?? blankHandoff());
  const [links, setLinks] = useState(item.handoff?.evidenceUrls.join('\n') ?? '');
  const [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [saving, setSaving] = useState(false);
  const latest = useRef({ layout, item, disabled }); latest.current = { layout, item, disabled };
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    setDraft(item.handoff ?? blankHandoff()); setLinks(item.handoff?.evidenceUrls.join('\n') ?? ''); setError('');
  }, [item.id, item.handoff]);
  const needsReview = status === 'needs_review';
  async function save(reconfirm = false): Promise<void> {
    if (disabled || saving) return;
    const before = latest.current;
    setSaving(true);
    try {
    const next: Handoff = { ...draft, evidenceUrls: links.split(/\r?\n/).map(url => url.trim()).filter(Boolean) };
    if (next.status === 'review' || next.status === 'accepted') {
      next.reviewedBasis = reconfirm || next.status !== item.handoff?.status
        ? await handoffBasis(layout, item.id, next.acceptance) : item.handoff?.reviewedBasis;
    }
    const result = handoffSchema.safeParse(next);
    if (!result.success) {
      const issue = result.error.issues[0];
      const messages: Record<string, string> = {
        ownerName: `请填写负责人，最多 ${handoffLimits.ownerName} 字。`, dueDate: '请填写真实的期限日期。',
        acceptance: `请填写验收条件，最多 ${handoffLimits.acceptance} 字。`,
        evidenceUrls: `请填写完整的 HTTP 或 HTTPS 链接，每行一个，最多 ${handoffLimits.evidenceUrls} 个。`,
        evidenceNote: '请填写证据链接或验收说明。', status: '请选择工作单状态。', reviewedBasis: '请重新核对物件后确认验收。',
      };
      setError(issue.code === 'custom' ? issue.message : messages[String(issue.path[0])] ?? '请检查工作单内容。');
      setNotice(''); return;
    }
    if (!mounted.current) return;
    if (latest.current.disabled || latest.current.layout !== before.layout || latest.current.item.handoff !== before.item.handoff) {
      setError('场景或工作单已变化，请按当前内容重新保存。'); return;
    }
    onUpdate(item.id, { handoff: result.data }); setError(''); setNotice('工作单已更新，请留意本机保存状态。');
    } catch (caught) { if (mounted.current) setError(caught instanceof Error ? caught.message : '更新失败，请重试。'); }
    finally { if (mounted.current) setSaving(false); }
  }
  function submit(event: FormEvent): void { event.preventDefault(); void save(); }
  return <form className="sc-handoff-form" onSubmit={submit}>
    {needsReview && <p className="sc-handoff-review">规格、摆放或验收条件已变化，请重新核对。原证据已保留。</p>}
    <fieldset disabled={disabled || saving}>
      <div className="sc-handoff-pair">
        <label className="sc-field">负责人<input value={draft.ownerName} maxLength={handoffLimits.ownerName} onChange={event => setDraft({ ...draft, ownerName: event.target.value })}/></label>
        <label className="sc-field">期限<input type="date" value={draft.dueDate} onChange={event => setDraft({ ...draft, dueDate: event.target.value })}/></label>
      </div>
      <label className="sc-field">验收条件<textarea rows={3} maxLength={handoffLimits.acceptance} value={draft.acceptance} placeholder="写明完成后需要检查的尺寸、摆放或安装要求" onChange={event => setDraft({ ...draft, acceptance: event.target.value })}/></label>
      <label className="sc-field">状态<select value={draft.status} onChange={event => setDraft({ ...draft, status: event.target.value as Handoff['status'] })}>
        {(['todo', 'doing', 'review', 'accepted'] as const).map(status => <option key={status} value={status}>{HANDOFF_STATUS_LABELS[status]}</option>)}
      </select></label>
      <label className="sc-field">证据链接<textarea rows={2} maxLength={(handoffLimits.evidenceUrl + 1) * handoffLimits.evidenceUrls} value={links} placeholder="每行一个可供执行方访问的链接" onChange={event => setLinks(event.target.value)}/></label>
      <label className="sc-field">验收说明<textarea rows={2} maxLength={handoffLimits.evidenceNote} value={draft.evidenceNote} placeholder="填写实际检查结果，或补充证据说明" onChange={event => setDraft({ ...draft, evidenceNote: event.target.value })}/></label>
      <div className="sc-handoff-actions">
        <button className="sc-button" type="submit">{draft.status === 'accepted' && item.handoff?.status !== 'accepted' ? '确认验收' : '保存工作单'}</button>
        {needsReview && draft.status === item.handoff?.status && <button className="sc-button" type="button" onClick={() => void save(true)}>{draft.status === 'accepted' ? '重新确认验收' : '重新提交验收'}</button>}
        {item.handoff && <button className="sc-button" type="button" onClick={() => { onUpdate(item.id, { handoff: undefined }); setNotice('执行记录已移除，可通过撤销恢复。'); }}>移除执行记录</button>}
      </div>
    </fieldset>
    {error && <p className="sc-handoff-error" role="alert">{error}</p>}
    {notice && <p className="sc-note" role="status">{notice}</p>}
  </form>;
}

/** Delivery and local execution stay inside the existing Binggo entry point. */
export function SceneDeliveryPanel({ layout, controller, onUpdateItem, onLocate, onUpdateEventOperations, onUpdateProductionPlan, briefState, onOpenBrief, backupActions, onBackupRestored }: Props): JSX.Element {
  const cloud = useBackendSession(controller);
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState('');
  const operationsAvailable = !!onUpdateEventOperations || !!layout.eventOperations;
  const [view, setView] = useState<'operations' | 'materials' | 'production'>(operationsAvailable ? 'operations' : 'materials');
  const latest = useRef({ layout, userId: cloud.user?.id, projectId: cloud.project?.id });
  latest.current = { layout, userId: cloud.user?.id, projectId: cloud.project?.id };
  const mounted = useRef(true), pending = useRef(false);
  const exportSnapshot = useRef<{ layout: RoomLayout; userId: string | undefined; projectId: string | undefined; metadata: DeliverySnapshot } | null>(null);
  const preview = useMemo(() => {
    try {
      const scene = deliveryScene(layout);
      const ids = new Set(scene.objects.map(object => object.id));
      return { items: layout.floors.flatMap(floor => floor.items).filter(item => ids.has(item.id)), materials: deliveryMaterials(layout), error: '' };
    } catch (error) { return { items: [], materials: [], error: error instanceof Error ? error.message : '当前场景暂不能交付。' }; }
  }, [layout]);
  const requestedCloud = typeof window !== 'undefined' && new URL(window.location.href).searchParams.get('project') === layout.id;
  const cloudBound = !!layout.id && (cloud.project?.id === layout.id || requestedCloud);
  const editable = !cloudBound && !!onUpdateItem;
  useEffect(() => { setView(operationsAvailable ? 'operations' : 'materials'); }, [layout.id, operationsAvailable]);
  const [reviews, setReviews] = useState<{ layout: RoomLayout; statuses: Record<string, Handoff['status'] | 'needs_review'> } | null>(null);
  useEffect(() => {
    let cancelled = false;
    void Promise.all(preview.items.map(async item => [item.id, await effectiveHandoffStatus(layout, item.id)] as const))
      .then(entries => { if (!cancelled) setReviews({ layout, statuses: Object.fromEntries(entries) }); })
      .catch(() => { if (!cancelled) setNotice('核对工作单失败，请重新打开场景交付。'); });
    return () => { cancelled = true; };
  }, [layout, preview.items]);
  const checking = reviews?.layout !== layout && preview.items.some(item => item.handoff?.status === 'review' || item.handoff?.status === 'accepted');
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { setNotice(''); exportSnapshot.current = null; }, [layout.id, cloud.user?.id, cloud.project?.id]);
  async function download(kind: 'glb' | 'json' | 'csv' | 'execution' | 'operations' | 'production'): Promise<void> {
    if (pending.current) return;
    pending.current = true; setBusy(true); setNotice('');
    const before = latest.current;
    const stillCurrent = () => mounted.current && latest.current.layout === before.layout && latest.current.userId === before.userId && latest.current.projectId === before.projectId;
    const previous = exportSnapshot.current;
    const snapshot = previous && previous.layout === layout && previous.userId === before.userId && previous.projectId === before.projectId
      ? previous : { ...before, metadata: { id: crypto.randomUUID(), generatedAt: new Date().toISOString() } };
    exportSnapshot.current = snapshot;
    const metadata = snapshot.metadata;
    try {
      const { downloadSceneDelivery, exportDeliveryGlb, sceneDeliveryCsv, sceneDeliveryJson, sceneExecutionCsv, eventOperationsCsv } = await import('../lib/scene-delivery');
      if (!stillCurrent()) return;
      if (kind === 'production') {
        const { productionPlanHandoffHtml } = await import('@/lib/production-plan-export');
        if (!stillCurrent()) return;
        const html = await productionPlanHandoffHtml(layout, metadata);
        if (!stillCurrent()) return;
        downloadSceneDelivery(html, 'text/html;charset=utf-8', `${layout.name}_内部制作交接_${metadata.id}`, 'html');
        setNotice('内部制作交接单已导出，可在浏览器打开并打印。请核对未确定的人员、供应方和费用。');
      } else if (kind === 'glb') {
        const result = await exportDeliveryGlb(layout, controller);
        if (!stillCurrent()) throw new Error('场景或账号已变化，请按当前方案重新导出。');
        downloadSceneDelivery(result.buffer, 'model/gltf-binary', `${layout.name}_${metadata.id}`, 'glb');
        setNotice(`GLB 已重新加载复检，保留 ${result.objectCount} 个物件节点及场地结构。`);
      } else {
        const text = kind === 'json' ? await sceneDeliveryJson(layout, metadata) : kind === 'execution' ? await sceneExecutionCsv(layout, metadata) : kind === 'operations' ? await eventOperationsCsv(layout, metadata) : sceneDeliveryCsv(layout, metadata);
        if (!stillCurrent()) return;
        const label = kind === 'json' ? '场景' : kind === 'execution' ? '执行清单' : kind === 'operations' ? '活动安排' : '物料清单';
        downloadSceneDelivery(text, kind === 'json' ? 'application/json' : 'text/csv;charset=utf-8', `${layout.name}_${label}_${metadata.id}`, kind === 'json' ? 'json' : 'csv');
        setNotice(kind === 'json' ? '场景与执行记录已导出，私有模型重开时仍需授权。' : kind === 'execution' ? '执行清单已导出，请按验收条件核对。' : kind === 'operations' ? '活动安排已导出；计划与实际记录分别保留，请按条件核对。' : '物料清单已导出，尺寸与采购规格仍需确认。');
      }
    } catch (error) { if (mounted.current && latest.current.userId === before.userId && latest.current.projectId === before.projectId) setNotice(error instanceof Error ? error.message : '导出失败，请重试。'); }
    finally { pending.current = false; if (mounted.current) setBusy(false); }
  }
  return <section aria-label="场景交付" className="sc-generated-models sc-delivery-panel">
    <div className="sc-section-heading"><div><h2>执行与交付</h2><p>安排活动任务，核对物料并导出交接内容。</p></div></div>
    <div className="sc-execution-tabs" role="tablist" aria-label="执行内容">
      <button type="button" role="tab" id="delivery-operations-tab" aria-controls="delivery-operations" aria-selected={view === 'operations'} onClick={() => setView('operations')}>活动安排</button>
      <button type="button" role="tab" id="delivery-materials-tab" aria-controls="delivery-materials" aria-selected={view === 'materials'} onClick={() => setView('materials')}>物料工作单</button>
      <button type="button" role="tab" id="delivery-production-tab" aria-controls="delivery-production" aria-selected={view === 'production'} onClick={() => setView('production')}>制作计划</button>
    </div>
    <div role="tabpanel" id="delivery-operations" aria-labelledby="delivery-operations-tab" hidden={view !== 'operations'}>
      <p className="sc-note">{cloudBound ? '云项目可查看活动安排。本地执行资料尚未接入云端保存。' : '活动安排随当前场景保存在此浏览器。'}</p>
      <EventOperationsPanel layout={layout} disabled={cloudBound || busy || !onUpdateEventOperations} onUpdate={onUpdateEventOperations ?? (() => undefined)} onLocate={onLocate} briefState={briefState} onOpenBrief={onOpenBrief}/>
    </div>
    <div role="tabpanel" id="delivery-production" aria-labelledby="delivery-production-tab" hidden={view !== 'production'}>
      <ProductionPlanPanel layout={layout} disabled={cloudBound||busy||!onUpdateProductionPlan} onUpdate={onUpdateProductionPlan} exporting={busy} onExport={()=>void download('production')}/>
    </div>
    <div role="tabpanel" id="delivery-materials" aria-labelledby="delivery-materials-tab" hidden={view !== 'materials'}>
    {preview.error ? <p className="sc-handoff-error" role="alert">{preview.error}</p> : <>
      <h3>执行工作单</h3>
      <p className="sc-note">{cloudBound ? '云项目可查看与导出。本地执行工作单请在本地场景中填写。' : '执行资料随场景保存在此浏览器。填写后点击保存工作单，并留意本机保存状态。'}</p>
      {!preview.items.length && <p className="sc-note">先在场景中放入物料，再填写执行工作单。</p>}
      <div className="sc-handoff-list">{preview.items.map((item, index) => {
        const status = reviews?.layout === layout ? reviews.statuses[item.id] : item.handoff?.status === 'review' || item.handoff?.status === 'accepted' ? 'checking' : item.handoff?.status ?? 'todo';
        return <details key={item.id} className="sc-handoff-item">
        <summary><span>{item.name} · {index + 1}<small>{item.width} × {item.depth} × {item.height} m</small></span><span className={`sc-handoff-status ${status === 'needs_review' ? 'needs-review' : ''}`}>{!item.handoff ? '未分配' : status === 'checking' ? '正在核对…' : HANDOFF_STATUS_LABELS[status]}</span></summary>
        {onLocate && <button type="button" className="sc-button" onClick={() => onLocate(item.id)}>定位物件</button>}
        <HandoffEditor layout={layout} item={item} status={status} disabled={!editable || busy || status === 'checking'} onUpdate={onUpdateItem ?? (() => undefined)}/>
      </details>; })}</div>
      <details className="sc-procurement-summary"><summary>采购汇总 · {preview.materials.length} 类</summary><ul>{preview.materials.map(row => <li key={row.objectIds[0]}>{row.name} × {row.quantity}<small>{row.width} × {row.depth} × {row.height} m · {row.procurement}</small></li>)}</ul></details>
    </>}
    </div>
    <button className="sc-button sc-full" type="button" disabled={busy || !layout.eventOperations} onClick={() => void download('operations')}>导出活动安排 CSV</button>
    <button className="sc-button sc-full" type="button" disabled={busy || checking || !!preview.error} onClick={() => void download('glb')}>{busy ? '正在准备交付…' : '导出场景 GLB'}</button>
    <button className="sc-button sc-full" type="button" disabled={busy || checking || !!preview.error} onClick={() => void download('json')}>导出场景 JSON</button>
    <button className="sc-button sc-full" type="button" disabled={busy || checking || !!preview.error} onClick={() => void download('execution')}>导出执行清单 CSV</button>
    <button className="sc-button sc-full" type="button" disabled={busy || checking || !!preview.error} onClick={() => void download('csv')}>导出物料清单 CSV</button>
    <p className="sc-note">交付当前单层项目。完整场馆预设需保留原文件；环境光与后处理不会随 GLB 交付。采购规格需另行确认。</p>
    {preview.error && view === 'operations' && <p className="sc-note">当前场馆模型暂不能完整交付，文字活动安排仍可单独导出。</p>}
    {notice && <p className="sc-note" role="status">{notice}</p>}
    {backupActions && <LocalProjectBackupPanel layout={layout} actions={backupActions} briefState={briefState} onComplete={onBackupRestored}/>}
  </section>;
}
