'use client';


import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useBackendSession, type BackendSession } from '@/lib/backend-session';
import { isLocalActivityWorkspace } from '@/lib/geometry-workbench';
import { handoffLimits, handoffSchema, type Handoff } from '../../../../supabase/functions/_shared/delivery-contract';
import { deliveryScene, deliveryMaterials, type DeliverySnapshot } from '../lib/scene-delivery';
import { localDraftAvailable, localDraftDeliveryJson, localDraftMaterialsCsv } from '../lib/local-draft-delivery';
import {sealLocalDraft,verifyLocalDraft} from '../lib/local-draft-integrity';
import {withUnlinkedVenueNotes} from '../lib/unlinked-venue-export';
import { layoutProvenanceBreakdown } from '../lib/deliverable-inventory';
import {validMobilityWidth,type MobilityWidth} from '../lib/mobility-export';
import type {DialogueField,DialogueHandoffReference,DialogueHandoffSnapshot} from '../lib/dialogue-handoff';
import { downloadTextFile } from '../lib/plan-export/download';
import { layoutToDxf } from '../lib/plan-export/dxf';
import { planExportUnsupportedReason, unplacedPlanItems } from '../lib/plan-export/plan-geometry';
import { openPlanPrintWindow } from '../lib/plan-export/print';
import { blankHandoff, effectiveHandoffStatus, handoffBasis, HANDOFF_STATUS_LABELS } from '../lib/scene-handoff';
import {
  confirmDeliveryVersion,
  deliveryVersionLabel,
  deliveryVersionState,
  type DeliveryVersionState,
} from '../lib/delivery-version';
import { isRetryableDeliveryCode, type DeliveryArtifactKind, type DeliveryFailureCode } from '../lib/delivery-package-spec';
import type { DeliveryCapture, DeliveryPackageResult } from '../lib/delivery-package';
import { EventOperationsPanel } from './event-operations-panel';
import { LocalProjectBackupPanel } from './local-project-backup-panel';
import { MaterialCheckinPanel } from './material-checkin-panel';
import { ProductionPlanPanel } from './production-plan-panel';
import type { CreativeBriefState, LocalProjectBackupActions } from './creative-studio';
import type { EventOperations } from '../../../../supabase/functions/_shared/event-operations-contract';
import type { ProductionPlan } from '../../../../supabase/functions/_shared/production-plan-contract';
import type { MaterialCheckinState } from '../hooks/use-material-checkins';
import type { FurnitureItem, RoomLayout } from '../lib/types';
import type {PendingCandidateCapture} from '../lib/pending-candidate-registry';
import './scene-delivery-panel.css';

interface Props {
  activityTaskPanel?: ReactNode;
  checkins?: MaterialCheckinState | undefined;
  layout: RoomLayout; controller: BackendSession;
  /** 打效果图用的渲染取图（three 只在工作台里，交付面板不碰渲染器）。 */
  captureImage?: DeliveryCapture | undefined;
  onUpdateItem?: ((id: string, patch: Partial<FurnitureItem>) => void) | undefined;
  onLocate?: ((id: string) => void) | undefined;
  onUpdateEventOperations?: ((value: EventOperations | undefined) => void) | undefined;
  onUpdateProductionPlan?: ((value: ProductionPlan | undefined) => void) | undefined;
  briefState?: CreativeBriefState | null | undefined;
  onOpenBrief?: (() => void) | undefined;
  backupActions?: LocalProjectBackupActions | null | undefined;
  onBackupRestored?: (() => void) | undefined;
  deliveryViewRequest?: { serial: number; view: 'operations' | 'materials' | 'backup' } | undefined;
  captureMobility?: (()=>MobilityExportCapture)|undefined;
  captureDialogue?: (()=>DialogueExportCapture|null)|undefined;
  /** Captures current activity/floor/session and a synchronous snapshot fence. */
  captureLocalDraftExport?: (()=>{isCurrent():boolean;release():void}|null)|undefined;
  capturePendingCandidates?: (()=>PendingCandidateCapture|null)|undefined;
}

/** Only a current-session decision is exported; source text is never included. */
export interface MobilityExportCapture {decision:'needed'|'not_needed'|null;width?:MobilityWidth|null|undefined;isCurrent():boolean}
export interface DialogueExportCapture {project(reference?:DialogueHandoffReference):DialogueHandoffSnapshot;isCurrent():boolean;release():void}
const htmlEscape=(value:unknown):string=>String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]!));
function dialogueSection(snapshot:DialogueHandoffSnapshot|null):string {
 if(!snapshot||snapshot.availability!=='available')return '<section class="warning" aria-label="资料范围提示"><h2>交接资料范围与待核对事项</h2><p>本文件的活动需求来自执行页已保存的手工需求记录，未完整包含活动助手对话中的人数、签到、舞台及其他需求，也未比较二者是否冲突。请对照当前对话逐项核对，并补充或更正后再交付执行团队。</p><p>行动辅助需求如另有列出，仅表示导出时捕获的该项对话信息，不能替代完整需求核对。</p></section>';
 const labels={unknown:'未知',pending:'待确认',conflict:'存在冲突，待核对',unclassified:'无法归类，待核对'} as const;
 const value=(f:DialogueField<unknown>,unit='')=>f.status!=='recorded'?labels[f.status]:f.value===true?'需要':f.value===false?'不需要':`${htmlEscape(f.value)}${unit}`;
 const translated=(f:DialogueField<string>,values:Record<string,string>)=>f.status==='recorded'&&f.value&&Object.hasOwn(values,f.value)?htmlEscape(values[f.value]):value(f);
 const f=snapshot.fields;
 const headcount=`${value(f.headcount,' 人')}${f.headcount.status==='recorded'?(f.headcount.strength==='must'?'（必须满足）':f.headcount.strength==='prefer'?'（期望）':'（要求强度未说明）'):''}`;
 const rows:[string,string][]=[['活动类型',value(f.event)],['人数',headcount],['室内外',translated(f.venueIO,{indoor:'室内',outdoor:'室外'})],['长度',value(f.lengthM,' 米')],['宽度',value(f.widthM,' 米')],['面积',value(f.areaM2,' 平方米')],['布置方式',translated(f.layoutMode,{dining:'圆桌', 'desk-chair':'课桌椅'})],['签到',value(f.checkin)],['休息区',value(f.rest)],['舞台',value(f.stage)],['全部入座',value(f.allSeated)],['行动辅助',translated(f.mobility,{needed:'需要',not_needed:'不需要'})],['每桌人数',value(f.peoplePerDesk,' 人')]];
 const preservation=f.originalPreservation;
 const preservationText=preservation.status==='not_requested'?'当前对话未记录原物保留要求，仍需核对。':preservation.status==='unknown'?'原物保留要求或名单暂无法核对，请对照当前活动确认。':
   `对话要求保留 ${preservation.count} 件原物${preservation.keepPositions?'，要求保持原位、方向和高度':'，未要求保持原位'}。${preservation.status==='conflict'?'当前场景与该要求存在冲突，请先处理。':''}${preservation.count===0?'记录名单为空，请确认是否有需保留的原物。':'具体名单及现场执行情况仍需核对。'}`;
 rows.push(['原物保留',htmlEscape(preservationText)]);
 for(const [key,label] of [['desk','桌'],['chair','椅']] as const)for(const [axis,axisLabel] of [['width','宽'],['depth','深'],['height','高']] as const)rows.push([`${label}${axisLabel}`,value(f.seatingSpecs[key][axis],' 米')]);
 const comparison=(state:'match'|'conflict'|'unknown')=>state==='match'?'一致（仅数值或分类一致）':state==='conflict'?'不一致，请核对':'无法比较，待核对';
 const inventory=f.inventoryMention==='present_unverified'?'对话曾提到物料；数量与规格须回对话核验，尚未计入库存。':'未取得可用的物料口述记录，库存仍需核对。';
 return `<section class="warning" aria-label="对话需求核对"><h2>活动助手对话需求（待核验）</h2><p>以下为导出时当前对话的部分结构化记录，仅涵盖已处理的需求；刚发送或尚未处理的消息可能未包含。它不等于现场事实或安全验收；未包含原始对话或自由文字。执行页手工需求另列，可能与对话不一致。</p><table><thead><tr><th>需求</th><th>对话记录</th></tr></thead><tbody>${rows.map(([key,text])=>`<tr><th>${htmlEscape(key)}</th><td>${text}</td></tr>`).join('')}</tbody></table><p>${inventory}</p><p>人数与已确认手工记录：${comparison(snapshot.comparison.headcount)}；活动类型与已确认手工记录：${comparison(snapshot.comparison.event)}。其他项目未自动比较，均需人工核对。</p></section>`;
}
function mobilitySection(mobility:MobilityExportCapture):string {
  const text=mobility.decision==='needed'?'主办方已提出行动辅助或轮椅通行需求。':mobility.decision==='not_needed'?'主办方说明本场不需要所述行动辅助需求。':'当前会话没有已确认的行动辅助需求记录，不能据此推断无需无障碍。';
  const width=mobility.decision==='needed'&&validMobilityWidth(mobility.width)?mobility.width:null;
  const unit=width?.unit==='m'?'米':width?.unit==='cm'?'厘米':'毫米';
  const measurement=width?`<dl><dt>用户提出的通道${width.explicitClearWidth?'净宽':'宽度'}</dt><dd><data value="${width.meters}" data-unit="m" data-source="user_statement">${width.bound==='at_least'?'至少 ':''}${width.value} ${unit}</data>（换算 ${width.meters} 米；来源：用户陈述${width.explicitClearWidth?'':'；是否为净宽仍需确认'}）</dd></dl>`:'<p>具体通道尺寸未随包提供，请向主办方确认。</p>';
  return `<section><h2>行动辅助需求</h2><p>${text}仅记录本次需求，实际通行、场地条件和法规符合性均未核验。</p>${measurement}</section>`;
}

const PACKAGE_KIND_LABELS: Record<DeliveryArtifactKind, string> = {
  hero: '效果图', floor: '平面图', materials: '物料清单', share: '分享链接', manifest: '清单', readme: '说明',
};

const PACKAGE_FAILURE_LABELS: Record<DeliveryFailureCode, string> = {
  network: '网络失败', 'asset-fetch': '资产未取到', timeout: '超时', memory: '内存不足',
  'no-floor': '没有楼层', 'preset-unsupported': '场景预设不支持', 'entrance-unsupported': '入口类型不支持',
  'share-over-budget': '分享链接超预算', 'render-failed': '渲染失败',
};

/**
 * 对话与执行页共用的本机活动资料导出；会话需求尚未完整接入。
 * 调用方负责给出「还是不是当前活动」的判断，导出前后各核对一次。
 */
export async function exportActivityHandoff({ layout, prepareBackup, stillCurrent = () => true,mobility,captureDialogue }: {
  layout: RoomLayout;
  prepareBackup(): Promise<string>;
  stillCurrent?: () => boolean;
  mobility?:MobilityExportCapture|undefined;
  captureDialogue?: (()=>DialogueExportCapture|null)|undefined;
}): Promise<string> {
  const dialogue=captureDialogue?.()??null;
  if(captureDialogue&&!dialogue)throw new Error('当前对话或活动无法核对，未生成交接文件。');
  try {
  const check=()=>{if(!stillCurrent()||(mobility&&!mobility.isCurrent())||(dialogue&&!dialogue.isCurrent()))throw new Error('活动或资料已变化，未生成交接文件。');};
  const metadata = { id: crypto.randomUUID(), generatedAt: new Date().toISOString() };
  const { parseLocalProjectBackupJson } = await import('@/lib/local-project-backup');
  check();
  const saved = parseLocalProjectBackupJson(await prepareBackup());
  check();
  if (saved.layout.id !== layout.id || saved.brief.status === 'not-in-file' || saved.materialCheckins.status === 'not-in-file') {
    throw new Error('活动资料未完整对应当前项目，请重新读取后导出。');
  }
  const ledger = saved.materialCheckins.status === 'present' ? saved.materialCheckins.value : undefined;
  const reference:DialogueHandoffReference={layout:saved.layout,...(saved.brief.status==='present'?{event:saved.brief.value.eventConfirmed===true?saved.brief.value.event:null,guests:saved.brief.value.guestsConfirmed===true?saved.brief.value.guests:null}:{})};
  check();const dialogueSnapshot=dialogue?.project(reference)??null;check();
  const { productionPlanHandoffHtml } = await import('@/lib/production-plan-export');
  check();
  let html = await productionPlanHandoffHtml(saved.layout, metadata, ledger, { scope: 'activity', brief: saved.brief });
  check();
  if(!html.includes('<main>'))throw new Error('交接文件无法核对，未导出。');
  html=html.replace('<main>', `<main>${dialogueSection(dialogueSnapshot)}`);
  if(mobility){
    if(!html.includes('</body>'))throw new Error('交接文件无法核对，未导出。');
    // A separate capture cannot override an unavailable, unresolved or differing dialogue snapshot.
    const field=dialogueSnapshot?.availability==='available'?dialogueSnapshot.fields.mobility:null;
    const matches=!!field&&field.status==='recorded'&&field.value===mobility.decision;
    html=html.replace('</body>',`${mobilitySection(matches?mobility:{decision:null,isCurrent:mobility.isCurrent})}</body>`);
  }
  const { downloadSceneDelivery } = await import('../lib/scene-delivery');
  check();
  downloadSceneDelivery(html, 'text/html;charset=utf-8', `${saved.layout.name}_内部活动交接_${metadata.id}`, 'html');
  return dialogueSnapshot?.availability==='available'?'活动执行资料草案已导出。请核对手工记录、对话需求及待确认项后交付。':'活动执行资料草案已导出。对话需求未完整包含，请核对手工记录与当前对话后交付。';
  } finally {dialogue?.release();}
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
        ? await handoffBasis(layout, item.id, next) : item.handoff?.reviewedBasis;
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
    onUpdate(item.id, { handoff: result.data }); setError(''); setNotice('工作单记录已更新；场地来源与本版验收状态仍需复核，请留意本机保存状态。');
    } catch (caught) { if (mounted.current) setError(caught instanceof Error ? caught.message : '更新失败，请重试。'); }
    finally { if (mounted.current) setSaving(false); }
  }
  function submit(event: FormEvent): void { event.preventDefault(); void save(); }
  return <form className="sc-handoff-form" onSubmit={submit}>
    {needsReview && <p className="sc-handoff-review">场地来源或本版核对依据尚未确认，原验收记录与证据已保留；不能视为当前已验收。</p>}
    <fieldset disabled={disabled || saving}>
      <div className="sc-handoff-pair">
        <label className="sc-field">负责人<input value={draft.ownerName} maxLength={handoffLimits.ownerName} onChange={event => setDraft({ ...draft, ownerName: event.target.value })}/></label>
        <label className="sc-field">期限<input type="date" value={draft.dueDate} onChange={event => setDraft({ ...draft, dueDate: event.target.value })}/></label>
      </div>
      <label className="sc-field">验收条件<textarea rows={3} maxLength={handoffLimits.acceptance} value={draft.acceptance} placeholder="写明完成后需要检查的尺寸、摆放或安装要求" onChange={event => setDraft({ ...draft, acceptance: event.target.value })}/></label>
      <label className="sc-field">记录状态（不代表当前已验收）<select aria-label="状态" value={draft.status} onChange={event => setDraft({ ...draft, status: event.target.value as Handoff['status'] })}>
        {(['todo', 'doing', 'review', 'accepted'] as const).map(status => <option key={status} value={status}>{HANDOFF_STATUS_LABELS[status]}</option>)}
      </select></label>
      <label className="sc-field">证据链接<textarea rows={2} maxLength={(handoffLimits.evidenceUrl + 1) * handoffLimits.evidenceUrls} value={links} placeholder="每行一个可供执行方访问的链接" onChange={event => setLinks(event.target.value)}/></label>
      <label className="sc-field">验收说明<textarea rows={2} maxLength={handoffLimits.evidenceNote} value={draft.evidenceNote} placeholder="填写实际检查结果，或补充证据说明" onChange={event => setDraft({ ...draft, evidenceNote: event.target.value })}/></label>
      <div className="sc-handoff-actions">
        <button className="sc-button" type="submit">{draft.status === 'accepted' && item.handoff?.status !== 'accepted' ? '确认验收' : '保存工作单'}</button>
        {needsReview && draft.status === item.handoff?.status && <button className="sc-button" type="button" onClick={() => void save(true)}>{draft.status === 'accepted' ? '重新记录验收' : '重新记录核对'}</button>}
        {item.handoff && <button className="sc-button" type="button" onClick={() => { onUpdate(item.id, { handoff: undefined }); setNotice('执行记录已移除，可通过撤销恢复。'); }}>移除执行记录</button>}
      </div>
    </fieldset>
    {error && <p className="sc-handoff-error" role="alert">{error}</p>}
    {notice && <p className="sc-note" role="status">{notice}</p>}
  </form>;
}

/** Delivery and local execution stay inside the existing Bingo Agent entry point. */
export function SceneDeliveryPanel({ layout, controller, captureImage, onUpdateItem, onLocate, onUpdateEventOperations, onUpdateProductionPlan, briefState, onOpenBrief, backupActions, onBackupRestored, checkins, deliveryViewRequest, activityTaskPanel, captureMobility, captureDialogue, captureLocalDraftExport, capturePendingCandidates }: Props): JSX.Element {
  const cloud = useBackendSession(controller);
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState('');
  const [includeVenueNotes, setIncludeVenueNotes] = useState(false);
  const [packageResult, setPackageResult] = useState<DeliveryPackageResult | null>(null);
  const [packageStage, setPackageStage] = useState(''), [packageNotice, setPackageNotice] = useState('');
  const [version, setVersion] = useState<DeliveryVersionState | null>(null);
  const [versionBusy, setVersionBusy] = useState(false), [versionNotice, setVersionNotice] = useState('');
  const versionLatest = useRef<DeliveryVersionState | null>(null);
  versionLatest.current = version;
  useEffect(() => {
    let cancelled = false;
    setVersion(null); setVersionNotice('');
    void deliveryVersionState({ layout, storage: panelStorage() })
      .then(state => { if (!cancelled) setVersion(state); })
      .catch(() => { if (!cancelled) setVersionNotice('版本身份没核对出来；导出仍按当前内容走。'); });
    return () => { cancelled = true; };
  }, [layout]);
  // 换了确认版（或退回草案）之后，上一包的结果与续跑依据都作废，不能拿旧快照的缺件去重试。
  useEffect(() => {
    if (!packageResult || !version) return;
    if (version.status !== 'confirmed' || packageResult.manifest.snapshotId !== version.snapshotId) setPackageResult(null);
  }, [version, packageResult]);
  async function confirmVersion(): Promise<void> {
    if (versionBusy) return;
    setVersionBusy(true); setVersionNotice('');
    try {
      const result = await confirmDeliveryVersion({ layout, storage: panelStorage() });
      setVersion(result.state);
      setVersionNotice(`${result.record.deliveryVersion} 已确认：快照 ${result.record.snapshotId}。导出与分享链接都用这个号。`);
    } catch (error) {
      setVersionNotice(error instanceof Error ? error.message : '确认失败，请重试。');
    } finally {
      setVersionBusy(false);
    }
  }
  const operationsAvailable = !!onUpdateEventOperations || !!layout.eventOperations;
  const [view, setView] = useState<'operations' | 'materials' | 'production' | 'checkins' | 'export' | 'backup'>(deliveryViewRequest?.view ?? (operationsAvailable ? 'operations' : 'materials'));
  useEffect(() => { setView(deliveryViewRequest?.view ?? (operationsAvailable ? 'operations' : 'materials')); }, [deliveryViewRequest, layout.id, operationsAvailable]);
  // 「从本机备份恢复」是外部递进来的目标页，折叠壳得替她掀开，否则落点在一扇关着的门后面。
  const [toolsOpen, setToolsOpen] = useState(deliveryViewRequest?.view === 'backup');
  useEffect(() => { if (deliveryViewRequest?.view === 'backup') setToolsOpen(true); }, [deliveryViewRequest]);
  const checkinLocal=isLocalActivityWorkspace(controller);
  const localCheckins=checkinLocal?checkins:undefined;
  const checkinsUnavailable=!!localCheckins&&!localCheckins.ready;
  const briefUnavailable=!!briefState&&(!briefState.ready||!!briefState.error);
  const source = { layout, controller, userId: cloud.user?.id, projectId: cloud.project?.id, checkins:localCheckins?.ledger, checkinsReady:!checkinsUnavailable, brief:briefState?.brief, briefReady:!briefUnavailable };
  const latest = useRef({ ...source, epoch: 0 });
  const sourceChanged = Object.entries(source).some(([key, value]) => latest.current[key as keyof typeof source] !== value);
  latest.current = { ...source, epoch: latest.current.epoch + (sourceChanged ? 1 : 0) };
  const mounted = useRef(true), pending = useRef(false);
  const [integrityNotice,setIntegrityNotice]=useState('');
  const [integrityBusy,setIntegrityBusy]=useState(false);
  const integritySequence=useRef(0);
  const exportSnapshot = useRef<typeof latest.current & { metadata: DeliverySnapshot } | null>(null);
  const preview = useMemo(() => {
    try {
      const scene = deliveryScene(layout);
      const ids = new Set(scene.objects.map(object => object.id));
      return { items: layout.floors.flatMap(floor => floor.items).filter(item => ids.has(item.id)), materials: deliveryMaterials(layout), error: '' };
    } catch (error) { return { items: [], materials: [], error: error instanceof Error ? error.message : '当前场景暂不能交付。' }; }
  }, [layout]);
  const requestedCloud = typeof window !== 'undefined' && new URL(window.location.href).searchParams.get('project') === layout.id;
  const cloudBound = !checkinLocal && !!layout.id && (cloud.project?.id === layout.id || requestedCloud);
  const editable = !cloudBound && !!onUpdateItem;
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
  useEffect(() => { setNotice(''); exportSnapshot.current = null; setPackageResult(null); setPackageNotice(''); }, [layout.id, cloud.user?.id, cloud.project?.id]);
  useEffect(() => { setIncludeVenueNotes(false); return controller.subscribe(() => setIncludeVenueNotes(false)); }, [controller, layout.id]);
  async function download(kind: 'glb' | 'json' | 'csv' | 'execution' | 'operations' | 'production' | 'activity' | 'timetable' | 'print' | 'dxf' | 'manifest' | 'local-json' | 'local-csv' | 'local-verified'): Promise<void> {
    if (pending.current) return;
    let candidateFence:PendingCandidateCapture|null=null;
    try{candidateFence=capturePendingCandidates?.()??null;}catch{setNotice('当前方案状态无法核对，未导出资料。');return;}
    if(capturePendingCandidates&&(!candidateFence||candidateFence.hasPending)) {setNotice('当前有尚未应用的方案预览，请先确认布置或撤回预览，再导出。');return;}
    pending.current = true; setBusy(true); setNotice('');
    const before = latest.current;
    let integrityFence:ReturnType<NonNullable<Props['captureLocalDraftExport']>>=null;
    const stillCurrent = () => {if(candidateFence&&!candidateFence.isCurrent())throw new Error('方案预览或活动已变化，未导出资料，请重新核对。');return mounted.current && latest.current.epoch === before.epoch && latest.current.layout === before.layout && latest.current.controller === before.controller && latest.current.userId === before.userId && latest.current.projectId === before.projectId&&latest.current.checkins===before.checkins&&latest.current.checkinsReady===before.checkinsReady&&latest.current.brief===before.brief&&latest.current.briefReady===before.briefReady;};
    if(kind==='local-verified'&&(!globalThis.crypto?.subtle||!globalThis.crypto?.randomUUID)){pending.current=false;setBusy(false);setNotice('当前环境不支持文件摘要，未导出可校验草案。');return;}
    const previous = exportSnapshot.current;
    // 确认过的版本用快照号做文件号，同一版重复导出会复现同一个号；草案才退回导出批次号。
    const confirmedSnapshot = versionLatest.current?.status === 'confirmed' ? versionLatest.current.snapshotId : null;
    const reusePrevious = !!previous && (confirmedSnapshot === null || previous.metadata.id === confirmedSnapshot);
    const snapshot = kind !== 'activity' && kind !== 'timetable' && previous && reusePrevious && previous.epoch === before.epoch && previous.layout === layout && previous.controller === before.controller && previous.userId === before.userId && previous.projectId === before.projectId&&previous.checkins===before.checkins&&previous.brief===before.brief&&previous.briefReady===before.briefReady
      ? previous : { ...before, metadata: { id: confirmedSnapshot ?? crypto.randomUUID(), generatedAt: new Date().toISOString() } };
    exportSnapshot.current = snapshot;
    // The optional sidecar changes the payload: do not reuse another export's ID.
    const metadata = kind==='local-verified'&&includeVenueNotes ? {id:crypto.randomUUID(),generatedAt:new Date().toISOString()} : snapshot.metadata;
    try {
      let integrityLayout:RoomLayout|null=null;
      if(kind==='local-verified'){
        integrityFence=captureLocalDraftExport?.()??null;
        if(!integrityFence?.isCurrent())throw new Error('当前活动、楼层或场景状态无法完整核对，未导出草案。');
        integrityLayout=structuredClone(before.layout);
        if(!integrityFence.isCurrent())throw new Error('活动或场景已变化，未导出草案。');
      }
      const mobility=kind==='activity'?captureMobility?.():undefined;
      if((kind==='operations'||kind==='json'||kind==='production'||kind==='activity'||kind==='timetable')&&!before.checkinsReady)throw new Error('点验资料尚未读取完成，请重新读取后导出。');
      const { downloadSceneDelivery, exportDeliveryGlb, sceneDeliveryCsv, sceneDeliveryJson, sceneExecutionCsv, eventOperationsCsv, deliveryManifestCsv } = await import('../lib/scene-delivery');
      if (!stillCurrent()) {if(kind==='local-verified')throw new Error('活动或场景已变化，未导出草案。');return;}
      if(kind==='local-verified'){
        if(!integrityLayout||!integrityFence?.isCurrent()||!isLocalActivityWorkspace(before.controller))throw new Error('活动或场景已变化，未导出草案。');
        const valid=()=>stillCurrent()&&!!integrityFence?.isCurrent()&&isLocalActivityWorkspace(before.controller);
        const downloadSnapshot=async(notes?:unknown,assertNotes:()=>void=()=>{})=>{
          if(!valid())throw new Error('活动或场景已变化，未导出草案。');
          const original=localDraftDeliveryJson(integrityLayout!,metadata);
          const payload=notes===undefined?original:JSON.stringify({...JSON.parse(original),unlinkedVenueNotes:notes},null,2);
          const text=await sealLocalDraft(payload);
          assertNotes();if(!valid())throw new Error('活动或场景已变化，未导出草案。');
          downloadSceneDelivery(text,'application/json;charset=utf-8',`本机可校验草案_${metadata.id}`,'json');
        };
        if(includeVenueNotes){
          if(!integrityLayout.id)throw new Error('当前活动没有可核对的标识；未导出含场地记录的草案。');
          await withUnlinkedVenueNotes(`activity:${integrityLayout.id}`,valid,(notes,check)=>downloadSnapshot(notes,check));
        }else await downloadSnapshot();
        setNotice('可校验本机草案已导出；文件摘要仅用于核对内容一致，不代表签名、现场确认或可恢复备份。');
      } else if (kind === 'local-json' || kind === 'local-csv') {
        if (!isLocalActivityWorkspace(before.controller)) throw new Error('请在本地活动中导出本地草案，云端场景格式保持不变。');
        const text = kind === 'local-json' ? localDraftDeliveryJson(before.layout, metadata) : localDraftMaterialsCsv(before.layout, metadata);
        if (!stillCurrent()) return;
        downloadSceneDelivery(text, kind === 'local-json' ? 'application/json' : 'text/csv;charset=utf-8',
          `${kind === 'local-json' ? '本地待核验草案' : '本地物料草案'}_${metadata.id}`, kind === 'local-json' ? 'json' : 'csv');
        setNotice('本地草案已导出。它不是云端场景或可恢复备份；尺寸、出入口及现场条件仍需核验。');
      } else if (kind === 'activity' || kind === 'timetable') {
        if (!backupActions) throw new Error('当前工作台尚未准备完整活动资料，未生成交接文件。');
        if (kind === 'activity') {
          setNotice(await exportActivityHandoff({ layout: before.layout, prepareBackup: () => backupActions.prepareBackup(), stillCurrent,...(mobility?{mobility}:{}),...(captureDialogue?{captureDialogue}:{}) }));
        } else {
          const { parseLocalProjectBackupJson } = await import('@/lib/local-project-backup');
          if (!stillCurrent()) return;
          const saved = parseLocalProjectBackupJson(await backupActions.prepareBackup());
          if (!stillCurrent()) return;
          if (saved.layout.id !== before.layout.id || saved.brief.status === 'not-in-file' || saved.materialCheckins.status === 'not-in-file') {
            throw new Error('活动资料未完整对应当前项目，请重新读取后导出。');
          }
          const ledger = saved.materialCheckins.status === 'present' ? saved.materialCheckins.value : undefined;
          const { executionTimetableHtml } = await import('@/lib/execution-timetable-export');
          if (!stillCurrent()) return;
          const html = await executionTimetableHtml(saved.layout, metadata, ledger);
          if (!stillCurrent()) return;
          downloadSceneDelivery(html, 'text/html;charset=utf-8', `${saved.layout.name}_执行时间表_${metadata.id}`, 'html');
          setNotice('执行时间表已导出，可离线打开与打印。计划与实际分别保留，未定时间和复核事项请执行团队确认。');
        }
      } else if (kind === 'production') {
        const { productionPlanHandoffHtml } = await import('@/lib/production-plan-export');
        if (!stillCurrent()) return;
        const html = await productionPlanHandoffHtml(layout, metadata, before.checkins);
        if (!stillCurrent()) return;
        downloadSceneDelivery(html, 'text/html;charset=utf-8', `${layout.name}_内部制作交接_${metadata.id}`, 'html');
        setNotice('内部制作交接单已导出，可在浏览器打开并打印。请核对未确定的人员、供应方和费用。');
      } else if (kind === 'print' || kind === 'dxf' || kind === 'manifest') {
        const floor = layout.floors[0];
        if (!floor) throw new Error('当前没有楼层，无法导出图纸。');
        const part = (value: string, fallback: string) => (value || fallback).replace(/[\\/:*?"<>|\s]+/g, '_');
        const base = part(layout.name, 'Scendance');
        if (kind === 'print') {
          if (!stillCurrent()) return;
          openPlanPrintWindow(layout, floor);
          setNotice(`已打开“${floor.name}”的打印窗口；${layout.floors.length > 1 ? '其他楼层未包含。' : ''}在打印对话框选择「另存为 PDF」。`);
        } else if (kind === 'dxf') {
          const text = layoutToDxf(layout, floor);
          if (!stillCurrent()) return;
          downloadTextFile(`${base}_平面_${part(floor.name, '1F')}.dxf`, 'application/dxf;charset=utf-8', text);
          setNotice(`“${floor.name}”平面 DXF 已导出。${layout.floors.length > 1 ? '其他楼层未包含。' : ''}`);
        } else {
          const text = await deliveryManifestCsv(layout, metadata);
          if (!stillCurrent()) return;
          downloadSceneDelivery(text, 'text/csv;charset=utf-8', `${layout.name}_交付清单_${metadata.id}`, 'csv');
          setNotice('交付清单已导出，逐行列出了可带走文件、件数与缺失原因。');
        }
      } else if (kind === 'glb') {
        const result = await exportDeliveryGlb(layout, controller);
        if (!stillCurrent()) throw new Error('场景或账号已变化，请按当前方案重新导出。');
        downloadSceneDelivery(result.buffer, 'model/gltf-binary', `${layout.name}_${metadata.id}`, 'glb');
        setNotice(`GLB 已重新加载复检，保留 ${result.objectCount} 个物件节点及场地结构。`);
      } else {
        const text = kind === 'json' ? await sceneDeliveryJson(layout, metadata, before.checkins) : kind === 'execution' ? await sceneExecutionCsv(layout, metadata) : kind === 'operations' ? await eventOperationsCsv(layout, metadata, before.checkins) : sceneDeliveryCsv(layout, metadata);
        if (!stillCurrent()) return;
        const label = kind === 'json' ? '场景' : kind === 'execution' ? '执行清单' : kind === 'operations' ? '活动安排' : '物料清单';
        downloadSceneDelivery(text, kind === 'json' ? 'application/json' : 'text/csv;charset=utf-8', `${layout.name}_${label}_${metadata.id}`, kind === 'json' ? 'json' : 'csv');
        setNotice(kind === 'json' ? '场景与执行记录已导出，私有模型重开时仍需授权。' : kind === 'execution' ? '执行清单已导出，请按验收条件核对。' : kind === 'operations' ? '活动安排已导出；计划与实际记录分别保留，请按条件核对。' : '物料清单已导出，尺寸与采购规格仍需确认。');
      }
    } catch (error) { if(kind==='local-verified'&&exportSnapshot.current===snapshot)exportSnapshot.current=null;if (mounted.current && latest.current.userId === before.userId && latest.current.projectId === before.projectId && (kind !== 'timetable' || stillCurrent())) setNotice(error instanceof Error ? error.message : '导出失败，请重试。'); }
    finally { integrityFence?.release();pending.current = false; if (mounted.current) setBusy(false); }
  }
  async function checkIntegrityFile(file:File|undefined):Promise<void> {
    const sequence=++integritySequence.current;setIntegrityNotice('');
    if(!file){setIntegrityBusy(false);return;}
    if(file.size>16*1024*1024){setIntegrityNotice('文件超出校验大小，请选择不超过 16 MB 的草案文件。');setIntegrityBusy(false);return;}
    setIntegrityBusy(true);
    try{
      const bytes=await file.arrayBuffer();
      const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
      const result=await verifyLocalDraft(text);
      if(!mounted.current||sequence!==integritySequence.current)return;
      setIntegrityNotice(result.status==='consistent'?`文件内容与所附摘要一致。${result.notice}`:result.status==='unavailable'?'当前环境不能计算摘要，未能核对文件。':'文件格式不符或内容与摘要不一致，请保留原文件并重新核对。');
    }catch{if(mounted.current&&sequence===integritySequence.current)setIntegrityNotice('文件无法读取或不是有效 UTF-8，未能核对。');}
    finally{if(mounted.current&&sequence===integritySequence.current)setIntegrityBusy(false);}
  }
  // MP-DEL 一键交付包（B2）：只打确认版；失败按 §6 归码，缺件下仍出「不完整」包，可单独续跑。
  async function buildPackage(mode: 'fresh' | 'retry'): Promise<void> {
    if (pending.current || versionBusy) return;
    const state = versionLatest.current;
    const confirmed = state?.confirmed;
    if (!state || state.status !== 'confirmed' || !confirmed) {
      setPackageNotice('先确认这一版，交付包才能绑定固定的版本号与快照号。');
      return;
    }
    pending.current = true; setBusy(true); setPackageStage(mode === 'retry' ? '准备重试缺件…' : '准备打包…'); setPackageNotice('');
    const before = latest.current;
    const stillCurrent = () => mounted.current && latest.current.epoch === before.epoch && latest.current.layout === before.layout && latest.current.controller === before.controller && latest.current.userId === before.userId && latest.current.projectId === before.projectId && latest.current.checkins === before.checkins && latest.current.brief === before.brief;
    const reuse = mode === 'retry' && packageResult && packageResult.manifest.snapshotId === confirmed.snapshotId
      ? new Map(packageResult.files.map(file => [file.path, { sha256: file.sha256, bytes: file.bytes }] as const))
      : undefined;
    try {
      const { buildDeliveryPackage } = await import('../lib/delivery-package');
      if (!stillCurrent()) return;
      const result = await buildDeliveryPackage({
        layout: before.layout,
        identity: {
          deliveryVersion: confirmed.deliveryVersion,
          snapshotId: confirmed.snapshotId,
          contentFingerprint: confirmed.contentFingerprint,
          status: 'confirmed',
        },
        generatedAt: new Date().toISOString(),
        confirmedAt: confirmed.confirmedAt,
        shareOrigin: window.location.origin,
        ...(captureImage ? { captureImage } : {}),
        ...(reuse ? { reuse } : {}),
        onProgress: stage => { if (mounted.current) setPackageStage(stage); },
      });
      if (!stillCurrent()) return;
      setPackageResult(result);
      const { downloadSceneDelivery } = await import('../lib/scene-delivery');
      downloadSceneDelivery(result.zip, 'application/zip', result.root, 'zip');
    } catch (error) {
      if (mounted.current) setPackageNotice(error instanceof Error ? error.message : '打包失败，请重试。');
    } finally {
      pending.current = false;
      if (mounted.current) { setBusy(false); setPackageStage(''); }
    }
  }
  return <section aria-label="场景交付" className="sc-generated-models sc-delivery-panel">
    <div className="sc-section-heading"><div><h2>执行资料</h2></div></div>
    {/* 版本身份（SC-06）：确认一次分配一个号，导出与分享链接共用。 */}
    <div className="dl-version" data-delivery-version={version?.deliveryVersion ?? ''} data-snapshot-id={version?.snapshotId ?? ''} data-delivery-version-status={version?.status ?? 'checking'}>
      <div className="dl-version-main">
        <p className="dl-version-label">交付版本</p>
        <p className="dl-version-line">
          <b>{version?.deliveryVersion ?? '—'}</b>
          <span>{deliveryVersionLabel(version)}</span>
          {version && <small>快照 {version.snapshotId} · 内容指纹 {version.contentFingerprint.slice(0, 8)}…</small>}
        </p>
      </div>
      <button type="button" className="sc-button" disabled={versionBusy || !version || version.status === 'confirmed'} onClick={() => void confirmVersion()}>
        {version?.status === 'confirmed' ? '这一版已确认' : versionBusy ? '正在确认…' : '确认这一版'}
      </button>
    </div>
    <p className="sc-note">确认后导出文件名和分享链接都用这个快照号；再改草案会排到下一版，旧链接仍打开原来那一版。</p>
    {versionNotice && <p className="sc-note" role="status">{versionNotice}</p>}
    {/* B2 一键交付包：只打确认版，缺件也出包但明确标「不完整」，可以只重试缺的几件。 */}
    <div className="dl-package">
      <button type="button" className="sc-button" disabled={busy || versionBusy || version?.status !== 'confirmed'} onClick={() => void buildPackage(packageResult?.missing.length ? 'retry' : 'fresh')}>
        {busy ? '正在打包…' : packageResult ? (packageResult.missing.length ? '重试缺件' : '重新打包') : '导出交付包'}
      </button>
      {version && version.status !== 'confirmed' && <p className="sc-note">确认这一版后，才能打成带版本号的 zip 交付包（效果图 ×3、平面 DXF、物料清单、分享链接）。</p>}
      {busy && packageStage && <p className="dl-package-stage" role="status">{packageStage}</p>}
      {packageNotice && <p className="sc-note" role="status">{packageNotice}</p>}
    </div>
    {packageResult && <div className="dl-package-result" data-delivery-package-status={packageResult.manifest.status} data-delivery-package-root={packageResult.root}>
      <p className="sc-note">{packageResult.manifest.status === 'complete'
        ? `交付包已导出：${packageResult.fileName} · ${packageResult.files.length} 个文件 · 版本 ${packageResult.manifest.deliveryVersion} · 快照 ${packageResult.manifest.snapshotId}。`
        : `交付包已导出但缺 ${packageResult.missing.length} 项，已标「不完整」，没有把缺件藏起来。`}</p>
      {packageResult.missing.length > 0 && <ul className="dl-package-missing" aria-label="交付包缺件">
        {packageResult.missing.map(item => <li key={`${item.kind}-${item.code}`} data-delivery-missing-code={item.code}>
          {PACKAGE_KIND_LABELS[item.kind]} · {PACKAGE_FAILURE_LABELS[item.code]}：{item.detail || '没有更多说明'}（{isRetryableDeliveryCode(item.code) ? '可重试' : '需先处理'}）
        </li>)}
      </ul>}
    </div>}
    {/* 六页执行台留在折叠里，不当默认门面。 */}
    <details className="dl-tools" open={toolsOpen} onToggle={event => setToolsOpen(event.currentTarget.open)}>
      <summary>内部资料</summary>
      <div className="sc-execution-tabs" role="tablist" aria-label="执行内容">
      <button type="button" role="tab" id="delivery-operations-tab" aria-controls="delivery-operations" aria-selected={view === 'operations'} onClick={() => setView('operations')}>活动安排</button>
      <button type="button" role="tab" id="delivery-materials-tab" aria-controls="delivery-materials" aria-selected={view === 'materials'} onClick={() => setView('materials')}>物料工作单</button>
      <button type="button" role="tab" id="delivery-production-tab" aria-controls="delivery-production" aria-selected={view === 'production'} onClick={() => setView('production')}>制作计划</button>
      <button type="button" role="tab" id="delivery-checkins-tab" aria-controls="delivery-checkins" aria-selected={view === 'checkins'} onClick={() => setView('checkins')}>数量点验</button>
      <button type="button" role="tab" id="delivery-export-tab" aria-controls="delivery-export" aria-selected={view === 'export'} onClick={() => setView('export')}>导出</button>
      {backupActions && <button type="button" role="tab" id="delivery-backup-tab" aria-controls="delivery-backup" aria-selected={view === 'backup'} onClick={() => setView('backup')}>本机备份</button>}
      </div>
    </details>
    <div role="tabpanel" id="delivery-operations" aria-labelledby="delivery-operations-tab" hidden={view !== 'operations'}>
      <p className="sc-note">{cloudBound ? '云项目可查看活动安排。本地执行资料尚未接入云端保存。' : '活动安排随当前场景保存在此浏览器。'}</p>
      <EventOperationsPanel suggestionsPanel={activityTaskPanel} layout={layout} disabled={cloudBound || busy || !onUpdateEventOperations} onUpdate={onUpdateEventOperations ?? (() => undefined)} onLocate={onLocate} briefState={briefState} onOpenBrief={onOpenBrief} checkins={localCheckins}/>
    </div>
    <div role="tabpanel" id="delivery-production" aria-labelledby="delivery-production-tab" hidden={view !== 'production'}>
      <ProductionPlanPanel layout={layout} disabled={cloudBound||busy||!onUpdateProductionPlan} onUpdate={onUpdateProductionPlan} exporting={busy||checkinsUnavailable} onExport={()=>void download('production')}/>
    </div>
    <div role="tabpanel" id="delivery-checkins" aria-labelledby="delivery-checkins-tab" hidden={view!=='checkins'}>
      {localCheckins&&layout.id?<>
        <MaterialCheckinPanel layout={layout} projectId={layout.id} ledger={localCheckins.ledger} loading={localCheckins.loading} error={localCheckins.error} disabled={busy||backupActions?.backupPending||!localCheckins.ready} onSave={localCheckins.onSave} exporting={busy} onExport={()=>void download('production')}/>
        {localCheckins.error&&<button className="sc-button" type="button" onClick={localCheckins.retry}>重新读取点验</button>}
      </>:<p className="sc-note">请在有明确编号的本地项目中记录数量点验。云项目暂不支持此项记录。</p>}
    </div>
    <div role="tabpanel" id="delivery-materials" aria-labelledby="delivery-materials-tab" hidden={view !== 'materials'}>
      {(() => { const p = layoutProvenanceBreakdown(layout); return (
        <details className="sc-procurement-summary" data-testid="provenance-summary"><summary>物件来源 · AI 占布置件 {p.aiPct}%</summary>
          <ul>
            <li>AI 生成 {p.ai} 件</li>
            <li>手动放置 {p.human} 件</li>
            <li>系统生成 {p.procedural} 件</li>
            <li>结构标记 {p.structure} 件（不计入布置）</li>
            {p.unknown > 0 && <li>来源未知 {p.unknown} 件</li>}
          </ul>
        </details> ); })()}
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
    <div role="tabpanel" id="delivery-export" aria-labelledby="delivery-export-tab" hidden={view !== 'export'}>
      {backupActions && <>
        <button className="sc-button sc-full" type="button" disabled={busy || checkinsUnavailable || briefUnavailable || backupActions.backupPending} onClick={() => void download('activity')}>导出活动执行资料草案 HTML</button>
        <p className="sc-note">包含执行页已保存的手工需求、活动任务、物件工作单、制作计划和点验。{captureDialogue?'可附当前对话已处理的部分结构化需求，并标示人数、活动类型与已确认手工记录的差异；刚发送或尚未处理的消息可能未包含，其他内容需人工核对。':'活动助手对话需求未完整包含，尚未比较差异。'}请先核对并保存各表单；照片和模型文件需另行提供。</p>
        <button className="sc-button sc-full" type="button" disabled={busy || checkinsUnavailable || briefUnavailable || backupActions.backupPending || !layout.eventOperations?.tasks.length} onClick={() => void download('timetable')}>导出执行时间表 HTML</button>
        <p className="sc-note">{layout.eventOperations?.tasks.length ? '保留每项任务的计划与实际时间、负责人及复核信息。未定项保持待确认，文件冻结在本次生成时。' : '先在活动安排中保存任务，再导出执行时间表。'}</p>
        {briefUnavailable && <p className="sc-note">活动需求尚未准备好，请在活动需求中重试读取。</p>}
      </>}
      <button className="sc-button sc-full" type="button" disabled={busy || checkinsUnavailable || !layout.eventOperations} onClick={() => void download('operations')}>导出活动安排 CSV</button>
      <h3>图纸与交付清单</h3>
      {layout.floors.length > 1 && <p className="sc-note">平面打印和 DXF 仅包含首层“{layout.floors[0]?.name}”，其他 {layout.floors.length - 1} 层未包含，请另行提供。</p>}
      {planExportUnsupportedReason(layout) && <p className="sc-note" role="alert">{planExportUnsupportedReason(layout)}</p>}
      {layout.floors[0] && unplacedPlanItems(layout.floors[0]).length > 0 && <p className="sc-note">部分物件位置待确认，打印图会列明，DXF 暂不可导出。</p>}
      <button className="sc-button sc-full" type="button" disabled={busy || !!planExportUnsupportedReason(layout)} onClick={() => void download('print')}>打开按比例打印（另存 PDF）</button>
      <button className="sc-button sc-full" type="button" disabled={busy || !!planExportUnsupportedReason(layout) || !!(layout.floors[0] && unplacedPlanItems(layout.floors[0]).length)} onClick={() => void download('dxf')}>导出平面 DXF</button>
      <button className="sc-button sc-full" type="button" disabled={busy} onClick={() => void download('manifest')}>导出交付清单 CSV</button>
      <p className="sc-note">图纸按当前第一层生成；交付清单说明本页能带走哪些文件、各有多少件、缺什么。不支持的类型会写明原因，不隐藏。</p>
      {checkinLocal && <>
        <button className="sc-button sc-full" type="button" disabled={busy || !localDraftAvailable(layout)} onClick={() => void download('local-json')}>导出本地待核验草案 JSON</button>
        <button className="sc-button sc-full" type="button" disabled={busy || !localDraftAvailable(layout)} onClick={() => void download('local-csv')}>导出本地物料草案 CSV</button>
        <label><input type="checkbox" checked={includeVenueNotes} disabled={busy} onChange={event=>setIncludeVenueNotes(event.target.checked)}/>在可校验草案中附上本机场地记录</label>
        <p className="sc-note">这些记录尚未与当前画布或图纸版本关联，门仅记录一扇；记录人的姓名和来源说明不会包含在内。用户核对不等于场地方确认或安全验收。</p>
        <button className="sc-button sc-full" type="button" disabled={busy || !captureLocalDraftExport || !localDraftAvailable(layout)} onClick={() => void download('local-verified')}>导出可校验本机草案</button>
        <p className="sc-note">本地草案保留区域、物件及尺寸记录，不含模型文件、图片与私密链接；它不是云端场景或可恢复备份，现场条件和采购库存均待核验。</p>
        <p className="sc-note">可校验草案将经本机过滤的 JSON 文本及摘要放在单独文件中；过滤不能保证移除全部隐私。文件未冻结、未签名，不能证明现场或场地方确认。</p>
      </>}
      <label className="sc-field">校验可校验草案文件<input type="file" accept=".json,application/json" disabled={integrityBusy} onChange={event=>{const file=event.currentTarget.files?.[0];event.currentTarget.value='';void checkIntegrityFile(file);}}/></label>
      <p className="sc-note">仅在本机读取文件，不上传，也不修改当前场景。</p>
      {integrityBusy&&<p role="status">正在核对文件…</p>}
      {integrityNotice&&<p role="status">{integrityNotice}</p>}
      <button className="sc-button sc-full" type="button" disabled={busy || checking || !!preview.error} onClick={() => void download('glb')}>{busy ? '正在准备交付…' : '导出场景 GLB'}</button>
      <button className="sc-button sc-full" type="button" disabled={busy || checking || checkinsUnavailable || !!preview.error} onClick={() => void download('json')}>导出场景 JSON</button>
      <button className="sc-button sc-full" type="button" disabled={busy || checking || !!preview.error} onClick={() => void download('execution')}>导出执行清单 CSV</button>
      <button className="sc-button sc-full" type="button" disabled={busy || checking || !!preview.error} onClick={() => void download('csv')}>导出物料清单 CSV</button>
      <p className="sc-note">交付当前单层项目。完整场馆预设需保留原文件；环境光与后处理不会随 GLB 交付。采购规格需另行确认。</p>
    </div>
    {backupActions && <div role="tabpanel" id="delivery-backup" aria-labelledby="delivery-backup-tab" hidden={view !== 'backup'}>
      <LocalProjectBackupPanel layout={layout} actions={backupActions} briefState={briefState} onComplete={onBackupRestored}/>
    </div>}
    {preview.error && view === 'operations' && <p className="sc-note">当前场馆模型暂不能完整交付，文字活动安排仍可单独导出。</p>}
    {notice && <p className="sc-note" role="status">{notice}</p>}
  </section>;
}

function panelStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}
