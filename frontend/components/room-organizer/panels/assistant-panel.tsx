'use client';

import { Sparkles, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { type AssistantProposal, type BackendSession, useBackendSession } from '@/lib/backend-session';
import { catalog, canonical, type Scene } from '../../../../supabase/functions/_shared/domain';
import { backendSceneToLayout, layoutToBackendScene } from '../lib/backend-adapter';
import type { RoomLayout } from '../lib/types';

interface Props {
  controller: BackendSession; layout: RoomLayout; selectedIds: string[]; bound: boolean; busy: boolean;
  onConnect(): void; onSaved(scene: Scene): void; onApplied(layout: RoomLayout): void;
}

export function AssistantPanel({ controller, layout, selectedIds, bound, busy, onConnect, onSaved, onApplied }: Props): JSX.Element {
  const cloud = useBackendSession(controller);
  const [open, setOpen] = useState(false);
  const [instruction, setInstruction] = useState('');
  const [proposal, setProposal] = useState<AssistantProposal | null>(null);
  const [pending, setPending] = useState<'generate' | 'apply' | null>(null);
  const [notice, setNotice] = useState('');
  const [now, setNow] = useState(Date.now);
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  const proposalLayout = useRef<RoomLayout | null>(null);
  const panel = useRef<HTMLElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const running = useRef(false);
  let conversionError = '';
  try { layoutToBackendScene(layout); }
  catch (error) { conversionError = error instanceof Error ? error.message : '场景暂不能用于 AI。'; }
  const ready = bound && !cloud.writeBlocked && !conversionError;
  const stale = !!proposal && (proposalLayout.current !== layout || proposal.project_id !== cloud.project?.id ||
    proposal.base_revision !== cloud.revision || proposal.local_revision !== cloud.localRevision ||
    proposal.generation !== cloud.lease?.generation || Date.parse(proposal.expires_at) <= now || !ready);

  useEffect(() => {
    if (!open) return;
    panel.current?.focus();
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [open]);
  function close(): void { setOpen(false); trigger.current?.focus(); }

  async function generate(): Promise<void> {
    if (!ready || running.current || busy) return;
    running.current = true; setPending('generate'); setNotice(''); setProposal(null);
    const before = layoutRef.current;
    try {
      const scene = layoutToBackendScene(before);
      // Synchronize the actual event-time canvas before capturing the request revision.
      if (canonical(scene) !== canonical(controller.getSnapshot().draft)) controller.setDraft(scene);
      const ids = selectedIds.filter(id => scene.objects.some(object => object.id === id));
      const result = await controller.generateProposal(instruction, ids);
      if (before !== layoutRef.current) throw new Error('生成期间场景已有修改，请根据当前场景重新生成。');
      backendSceneToLayout(result.candidate);
      proposalLayout.current = before;
      setProposal(result); setNow(Date.now());
    } catch (error) {
      setNotice(controller.getSnapshot().error?.message ?? (error instanceof Error && error.message === 'STALE_PROPOSAL' ? '场景已变化，请重新生成提案。' : error instanceof Error ? error.message : '生成失败，请重试。'));
    } finally { running.current = false; setPending(null); }
  }
  async function apply(): Promise<void> {
    if (!proposal || stale || running.current || busy) return;
    running.current = true; setPending('apply'); setNotice('');
    const before = layoutRef.current;
    try {
      // Reuse already authorized assets; the AI cannot introduce new asset IDs.
      const items = before.floors.flatMap(floor => floor.items);
      const options = { projectId: proposal.project_id, name: before.name,
        assetUrls: Object.fromEntries(items.flatMap(item => item.assetId && item.glbUrl ? [[item.assetId, item.glbUrl]] : [])),
        assetNames: Object.fromEntries(items.flatMap(item => item.assetId ? [[item.assetId, item.name]] : [])) };
      backendSceneToLayout(proposal.candidate, options);
      const result = await controller.applyProposal(proposal);
      onSaved(result.scene);
      setProposal(null);
      if (before !== layoutRef.current) {
        setNotice(`提案已保存为云端版本 ${result.revision}，提交期间的新改动仍保留在本地，请核对后保存。`);
        return;
      }
      const next = backendSceneToLayout(result.scene, options);
      // Preserve editor-only styling and metadata instead of resetting them on every AI edit.
      onApplied({ ...before, backendVenue: result.scene.venue, backendCamera: result.scene.camera, backendLighting: result.scene.lighting,
        floors: [{ ...before.floors[0]!, items: next.floors[0]!.items }] });
      setNotice(`已应用并保存为云端版本 ${result.revision}。可在画布撤销；撤销后需再次保存到云端。`);
    } catch (error) {
      setNotice(controller.getSnapshot().error?.message ?? (error instanceof Error && error.message === 'STALE_PROPOSAL' ? '提案已过期，请重新生成。' : error instanceof Error ? error.message : '应用失败，草稿已保留。'));
    } finally { running.current = false; setPending(null); }
  }
  const changes = proposal ? proposal.candidate.objects.filter(object => canonical(object) !== canonical(cloud.draft?.objects.find(old => old.id === object.id))) : [];
  const removed = proposal ? cloud.draft?.objects.filter(object => !proposal.candidate.objects.some(next => next.id === object.id)) ?? [] : [];
  return <>
    <button ref={trigger} type="button" className="sc-cloud-trigger" aria-expanded={open} aria-controls="sc-assistant" onClick={() => setOpen(value => !value)}><Sparkles size={14}/>AI 助理</button>
    {open && <aside ref={panel} id="sc-assistant" className="sc-assistant" tabIndex={-1} aria-label="AI 场景助理" onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); close(); } }}>
      <div className="sc-ai-heading"><div><span className="sc-cloud-eyebrow">DEEPSEEK / 场景提案</span><h2>把想法变成布置</h2></div><button type="button" aria-label="关闭 AI 助理" onClick={close}><X size={18}/></button></div>
      <p>描述活动、人数和风格，或告诉我如何调整当前物件。提案经你确认后才会应用。</p>
      {!ready && <div className="sc-cloud-message">{conversionError || (cloud.user ? '请先打开云项目并获取编辑权。' : '请先登录工作室，打开或创建云项目。')}<button type="button" onClick={onConnect}>打开云项目</button></div>}
      <form onSubmit={event => { event.preventDefault(); void generate(); }}>
        <label htmlFor="sc-ai-instruction">{cloud.draft?.objects.length ? '你想怎样调整场景？' : '你想举办什么活动？'}</label>
        <textarea id="sc-ai-instruction" value={instruction} maxLength={3000} rows={4} placeholder="例如：为 12 人读书沙龙安排坐席、背景板和签到台，使用暖色调。" onChange={event => setInstruction(event.target.value)} disabled={!!pending}/>
        <div className="sc-ai-context"><span>{selectedIds.length ? `已选 ${selectedIds.length} 个对象，随需求一并发送` : '根据当前完整场景规划'}</span><span>{instruction.length}/3000</span></div>
        <button className="sc-ai-primary" type="submit" disabled={!ready || busy || !!pending || !instruction.trim()}>{pending === 'generate' ? '正在生成提案…' : proposal ? '重新生成提案' : '生成提案'}</button>
      </form>
      {pending === 'generate' && <p role="status">正在规划和校验场景。你可以继续编辑；新改动会使本次提案失效。</p>}
      {proposal && <section className="sc-ai-proposal" aria-label="提案预览">
        <div className="sc-ai-context"><strong>提案预览</strong><span>尚未应用</span></div>
        <p>{proposal.explanation}</p>
        <svg role="img" aria-label="提案俯视预览" viewBox={`-0.5 -0.5 ${proposal.candidate.venue.width + 1} ${proposal.candidate.venue.depth + 1}`}>
          <rect width={proposal.candidate.venue.width} height={proposal.candidate.venue.depth} fill="#f0eee9" stroke="#a6adae" strokeWidth=".04"/>
          {proposal.candidate.objects.map(object => <rect key={object.id} x={object.position.x - object.size.width / 2} y={object.position.z - object.size.depth / 2} width={object.size.width} height={object.size.depth} transform={`rotate(${object.rotation} ${object.position.x} ${object.position.z})`} fill={object.color} stroke="#59656c" strokeWidth=".04"><title>{catalog.find(item => item.id === object.materialId)?.name ?? '三维资产'}</title></rect>)}
        </svg>
        <p>{changes.length} 件新增或调整 · {removed.length} 件移除 · 共 {proposal.candidate.objects.length} 件</p>
        <ul className="sc-ai-changes">{changes.map(object => <li key={object.id}>{cloud.draft?.objects.some(old => old.id === object.id) ? '调整' : '新增'}{catalog.find(item => item.id === object.materialId)?.name ?? '三维资产'} · ({object.position.x.toFixed(1)}, {object.position.z.toFixed(1)}) m</li>)}{removed.map(object => <li key={object.id}>移除{catalog.find(item => item.id === object.materialId)?.name ?? '三维资产'}</li>)}</ul>
        {proposal.warnings.length > 0 && <p className="sc-cloud-message">存在 {proposal.warnings.length} 处空间提示（如重叠、出入口或越界），请仔细核对布置。</p>}
        {stale && <p role="status" className="sc-cloud-message">场景、版本或编辑权已变化，或提案已过期。请重新生成。</p>}
        <div className="sc-ai-actions"><button className="sc-ai-primary" type="button" disabled={stale || busy || !!pending} onClick={() => void apply()}>{pending === 'apply' ? '正在保存…' : '确认应用并保存'}</button><button type="button" disabled={!!pending} onClick={() => setProposal(null)}>放弃提案</button></div>
      </section>}
      {notice && <p role="status" className="sc-cloud-message">{notice}</p>}
      <small className="sc-ai-footnote">AI 可使用 8 类内置物料，不会修改已锁定物件。预算不足或服务异常时会明确提示。</small>
    </aside>}
  </>;
}
