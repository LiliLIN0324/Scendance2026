'use client';

import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { BackendSession } from '@/lib/backend-session';
import { submitMaterialGenerate, type MaterialCloudLane } from '../lib/material-generate';
import { attachFacilityGenerateTask, listFacilityGenerateLinks, findGeneratedFacilityModel } from '../lib/facility-generated-models';

function hasUnknownOutcome(id: string): boolean {
  try { return sessionStorage.getItem(`scendance:facility-submit-unknown:${id}`) === '1'; } catch { return false; }
}
function recordUnknownOutcome(id: string): void {
  try { sessionStorage.setItem(`scendance:facility-submit-unknown:${id}`, '1'); } catch { /* still locked in mounted form */ }
}
/** 户外设施原位表单。只有勾选额度并点击提交才可能创建收费任务；不会切走工作台。 */
export function OutdoorFacilityGenerate({ target, controller, onClose }: {
  target: { facilityId: string; facilityName: string; kind: 'text' | 'image' };
  controller?: BackendSession | undefined;
  onClose(): void;
}): JSX.Element {
  const [prompt, setPrompt] = useState(target.facilityName);
  const [image, setImage] = useState('');
  const [imageName, setImageName] = useState('');
  const [credit, setCredit] = useState(false);
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState(() => listFacilityGenerateLinks(target.facilityId).some(link => !findGeneratedFacilityModel(`generated:${link.taskid}`)));
  const [unknown, setUnknown] = useState(() => hasUnknownOutcome(target.facilityId));
  const [note, setNote] = useState(() => hasUnknownOutcome(target.facilityId) ? '此前提交结果未知，已暂停重复提交。请先核对生成任务记录与费用。' : submitted ? '此设施已有待取回任务，请先核对原任务，不重复创建收费任务。' : '只回填此设施的模型候选，不会自动选中或添加到另一张画布。');
  const lock = useRef(false);
  const imageReadSeq = useRef(0);
  async function submit() {
    if (lock.current || submitted || unknown || !credit || (target.kind === 'image' ? !image : !prompt.trim())) return;
    lock.current = true; setBusy(true);
    const cloud: MaterialCloudLane | undefined = controller ? {
      createJob: (text, options) => controller.createGenerationJob(text, crypto.randomUUID(), { ...options, provider: 'aholo' }),
      uploadReference: file => controller.uploadGenerationReference(file),
    } : undefined;
    try {
      const result = await submitMaterialGenerate(target.kind === 'image'
        ? { kind: 'image', imageDataUrl: image, prompt: prompt.trim() || imageName }
        : { kind: 'text', prompt: prompt.trim() }, cloud ? { cloud } : {});
      if (!result.ok) {
        setNote(result.message); setCredit(false); setUnknown(result.outcome === 'unknown'); if (result.outcome === 'unknown') recordUnknownOutcome(target.facilityId);
        return;
      }
      attachFacilityGenerateTask({
        taskid: result.taskid, lane: result.lane,
        facilityId: target.facilityId, facilityName: target.facilityName,
        name: prompt.trim() || imageName || target.facilityName, submittedAt: Date.now(),
      });
      setSubmitted(true);
      setNote(`已提交 ${result.taskid}。留在户外规划，选中「${target.facilityName}」即可查看进度和回填候选。`);
    } catch {
      recordUnknownOutcome(target.facilityId); setUnknown(true); setNote('提交结果未知，请先核对任务记录，避免重复扣额度。');
    } finally { lock.current = false; setBusy(false); }
  }
  function pick(file: File | undefined) {
    const seq = ++imageReadSeq.current;
    setImage(''); setImageName('');
    if (!file) return;
    if (!['image/png', 'image/jpeg'].includes(file.type) || !file.size || file.size > 5 * 1024 * 1024) {
      setNote('请选择不超过 5 MB 的 PNG / JPEG。'); return;
    }
    const reader = new FileReader();
    reader.onload = () => { if (seq === imageReadSeq.current && typeof reader.result === 'string') { setImage(reader.result); setImageName(file.name); } };
    reader.onerror = () => { if (seq === imageReadSeq.current) setNote('图片读取失败，请重选。'); };
    reader.readAsDataURL(file);
  }
  return createPortal(<div data-testid="outdoor-facility-generate" style={{ position: 'fixed', inset: 0, zIndex: 250, display: 'grid', placeItems: 'center', background: '#0004' }}>
    <section role="dialog" aria-modal="true" aria-labelledby="outdoor-generate-title" style={{ width: 'min(380px, calc(100vw - 32px))', padding: 20, background: 'var(--wk-paper, #fff)', color: 'var(--wk-ink, #141416)', borderRadius: 12, display: 'grid', gap: 12 }}>
      <h2 id="outdoor-generate-title" style={{ margin: 0, fontSize: 16 }}>为「{target.facilityName}」{target.kind === 'image' ? '上传图片生成模型' : '生成模型'}</h2>
      <form onSubmit={event => { event.preventDefault(); void submit(); }} style={{ display: 'grid', gap: 12 }}>
        <label>模型描述<textarea autoFocus aria-label="户外模型描述" value={prompt} maxLength={200} disabled={busy || submitted || unknown} onChange={event => setPrompt(event.target.value)} style={{ display: 'block', width: '100%', boxSizing: 'border-box' }} /></label>
        {target.kind === 'image' && <label>参考图片<input aria-label="户外模型参考图片" type="file" accept="image/png,image/jpeg" disabled={busy || submitted || unknown} onChange={event => pick(event.target.files?.[0])} /></label>}
        <label><input type="checkbox" aria-label="确认扣额度后才会提交" checked={credit} disabled={busy || submitted || unknown} onChange={event => setCredit(event.target.checked)} />确认扣额度后才会提交</label>
        <p role="status" style={{ margin: 0, fontSize: 12 }}>{note}</p>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" disabled={busy} onClick={onClose}>{submitted ? '返回户外规划' : '取消'}</button>
          <button type="submit" disabled={!credit || busy || submitted || unknown || (target.kind === 'image' ? !image : !prompt.trim())}>{busy ? '提交中…' : '提交生成'}</button>
        </div>
      </form>
    </section>
  </div>, document.body);
}
