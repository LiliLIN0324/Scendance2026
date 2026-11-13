'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import type { BackendSession } from '@/lib/backend-session';
import { submitMaterialGenerate, type MaterialCloudLane } from '../lib/material-generate';
import { attachFacilityGenerateTask, listFacilityGenerateLinks, findGeneratedFacilityModel, markFacilityGenerateTerminal, subscribeFacilityGenerateLinks, getFacilityGenerateLinksRevision } from '../lib/facility-generated-models';

interface Submission {
  requestId: string; projectId: string; facilityId: string; facilityName: string;
  state: 'submitting' | 'unknown' | 'submitted' | 'terminal'; submittedAt: number;
  terminal?: { status: string; message: string; checkedAt: number };
  taskid?: string; lane?: 'direct' | 'cloud';
}
function submissionKey(projectId: string, facilityId: string): string {
  return `scendance:facility-submit:${JSON.stringify([projectId, facilityId])}`;
}
function readSubmission(projectId: string, facilityId: string): Submission | null {
  try {
    const raw = localStorage.getItem(submissionKey(projectId, facilityId));
    if (raw) {
      const row = JSON.parse(raw) as Submission;
      const verifiedTerminal = row.state !== 'terminal' || (
        typeof row.taskid === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(row.taskid)
        && ['cloud', 'direct'].includes(row.lane ?? '') && row.terminal
        && ['failed', 'rejected', '4', '6', 'completed_without_glb', 'completed_unusable'].includes(row.terminal.status)
        && typeof row.terminal.message === 'string' && Number.isFinite(row.terminal.checkedAt)
      );
      if (row.projectId === projectId && row.facilityId === facilityId && row.requestId
        && ['submitting', 'unknown', 'submitted', 'terminal'].includes(row.state) && verifiedTerminal) return row;
      // Damaged durable state cannot prove no charge occurred. Fail closed.
      return { requestId: 'unreadable', projectId, facilityId, facilityName: '', state: 'unknown', submittedAt: 0 };
    }
    if (sessionStorage.getItem(`scendance:facility-submit-unknown:${facilityId}`) === '1') return { requestId: 'legacy-unknown', projectId, facilityId, facilityName: '', state: 'unknown', submittedAt: 0 };
  } catch { return { requestId: 'unreadable', projectId, facilityId, facilityName: '', state: 'unknown', submittedAt: 0 }; }
  return null;
}
function saveSubmission(row: Submission): void {
  const key = submissionKey(row.projectId, row.facilityId); const value = JSON.stringify(row);
  localStorage.setItem(key, value);
  if (localStorage.getItem(key) !== value) throw new Error('SUBMISSION_NOT_DURABLE');
}
function blocksSubmission(row: Submission | null): boolean {
  return !!row && !(row.state === 'submitted' && row.taskid && findGeneratedFacilityModel(`generated:${row.taskid}`));
}
function submissionNote(row: Submission): string {
  if (row.state === 'terminal') return `原任务 ${row.taskid} 已核对为终态：${row.terminal?.message ?? '未生成可用模型'}。失败不代表未收费，请核对费用；不会自动重发。`;
  return row.taskid ? `原任务 ${row.taskid} 已保留，正在核对/取回，不会重复创建收费任务。`
    : `此前提交结果未知（请求 ${row.requestId}）。当前接口不能按请求标识可靠找回任务；已锁定重复提交，请先核对生成任务记录与费用。`;
}
/** 户外设施原位表单。只有勾选额度并点击提交才可能创建收费任务；不会切走工作台。 */
export function OutdoorFacilityGenerate({ target, projectId, controller, onClose }: {
  target: { facilityId: string; facilityName: string; kind: 'text' | 'image' };
  projectId: string;
  controller?: BackendSession | undefined;
  onClose(): void;
}): JSX.Element {
  const [prompt, setPrompt] = useState(target.facilityName);
  const [image, setImage] = useState('');
  const [imageName, setImageName] = useState('');
  const [credit, setCredit] = useState(false);
  const [busy, setBusy] = useState(false);
  const [receipt, setReceipt] = useState(() => readSubmission(projectId, target.facilityId));
  const [submitted, setSubmitted] = useState(() => listFacilityGenerateLinks(target.facilityId).some(link => (!link.projectId || link.projectId === projectId) && !link.terminal && !findGeneratedFacilityModel(`generated:${link.taskid}`)));
  const unknown = blocksSubmission(receipt);
  const [note, setNote] = useState(() => receipt && unknown ? submissionNote(receipt) : submitted ? '此设施已有待取回任务，请先核对原任务，不重复创建收费任务。' : '只回填此设施的模型候选，不会自动选中或添加到另一张画布。');
  const lock = useRef(false);
  const imageReadSeq = useRef(0);
  const linksRevision = useSyncExternalStore(subscribeFacilityGenerateLinks, getFacilityGenerateLinksRevision, getFacilityGenerateLinksRevision);
  // Only the existing GET-by-job-ID is supported. Never infer a job from similar prompts,
  // never re-POST an unknown request, and do not promise direct-provider idempotency.
  useEffect(() => {
    if (!receipt?.taskid || receipt.state === 'terminal' || findGeneratedFacilityModel(`generated:${receipt.taskid}`)) return;
    const original = receipt;
    let active = true;
    function terminal(status: string, message: string) {
      if (!active) return;
      const next: Submission = { ...original, state: 'terminal', terminal: { status, message, checkedAt: Date.now() } };
      // Save before exposing the explicit retry action. Never infer a refund/no charge.
      saveSubmission(next);
      attachFacilityGenerateTask({ ...original, taskid: original.taskid!, name: original.facilityName });
      markFacilityGenerateTerminal(original.taskid!, status, message);
      setReceipt(next); setSubmitted(false); setCredit(false); setNote(submissionNote(next));
    }
    async function recover() {
      try {
        const known = listFacilityGenerateLinks(target.facilityId, projectId).find(link => link.taskid === original.taskid)?.terminal;
        if (known) { terminal(known.status, known.message); return; }
        if (original.lane === 'cloud') {
          if (!controller) return;
          const job = await controller.getGenerationJob(original.taskid!);
          if (job.id !== original.taskid) throw new Error('TASK_ID_MISMATCH');
          if (['failed', 'rejected'].includes(job.state)) { terminal(job.state, '云任务未成功'); return; }
        } else {
          const { fetchLux3dTask, glbOutputOf } = await import('../lib/lux3d-import');
          const job = await fetchLux3dTask(original.taskid!);
          if (job.status === 4 || job.status === 6) { terminal(String(job.status), job.statusLabel); return; }
          if (job.status === 3 && !glbOutputOf(job.outputs)) { terminal('completed_without_glb', '任务已完成，但没有 GLB 模型'); return; }
        }
        if (!active) return;
        attachFacilityGenerateTask({ ...original, taskid: original.taskid!, name: original.facilityName });
        setSubmitted(true);
        setNote(`已接回原任务 ${original.taskid}，留在户外规划等待候选回填；不会重复提交。`);
      } catch { if (active) setNote(`原任务 ${original.taskid} 暂时无法核对，仍保留任务与提交锁，请勿重复扣费。`); }
    }
    void recover();
    return () => { active = false; };
  }, [receipt?.taskid, receipt?.state, controller, linksRevision, projectId, target.facilityId]);
  function prepareNewRound() {
    const prior = readSubmission(projectId, target.facilityId);
    if (!prior || prior.state !== 'terminal' || !prior.taskid || prior.requestId !== receipt?.requestId) return;
    try {
      const key = submissionKey(projectId, target.facilityId);
      const historyKey = `${key}:history`;
      const history: unknown = JSON.parse(localStorage.getItem(historyKey) ?? '[]');
      if (!Array.isArray(history)) throw new Error('HISTORY_UNREADABLE');
      const value = JSON.stringify([...history.filter(row => row?.requestId !== prior.requestId), prior]);
      localStorage.setItem(historyKey, value);
      if (localStorage.getItem(historyKey) !== value) throw new Error('HISTORY_NOT_DURABLE');
      localStorage.removeItem(key);
      if (localStorage.getItem(key) !== null) throw new Error('RECEIPT_NOT_CLEARED');
      setReceipt(null); setSubmitted(false); setCredit(false);
      setNote(`原任务 ${prior.taskid} 与费用核对记录已留存。本操作尚未发请求；新一轮须重新勾选确认扣额度并点击提交。`);
    } catch { setNote('无法完整保存原任务历史，仍保留提交保护；未发出新请求。'); }
  }
  async function submit() {
    if (lock.current || submitted || unknown || !credit || (target.kind === 'image' ? !image : !prompt.trim())) return;
    // Recheck storage synchronously: a different mounted form may already have dispatched.
    const prior = readSubmission(projectId, target.facilityId);
    if (blocksSubmission(prior)) { setReceipt(prior); setNote(submissionNote(prior!)); return; }
    const record: Submission = { requestId: crypto.randomUUID(), projectId, facilityId: target.facilityId, facilityName: target.facilityName, state: 'submitting', submittedAt: Date.now() };
    try { saveSubmission(record); }
    catch { setNote('无法持久保存提交保护，本次没有发出生成请求。请恢复本地存储后再试。'); return; }
    lock.current = true; setBusy(true); setReceipt({ ...record }); setNote('提交已持久登记，正在等待服务端回执；刷新或关闭也不会自动重发。');
    const cloud: MaterialCloudLane | undefined = controller ? {
      createJob: async (text, options) => {
        const job = await controller.createGenerationJob(text, record.requestId, { ...options, provider: 'aholo' });
        // Persist the returned job before any component state/link publication.
        record.taskid = job.id; record.lane = 'cloud'; record.state = 'submitted'; saveSubmission(record);
        return job;
      },
      uploadReference: file => controller.uploadGenerationReference(file),
    } : undefined;
    try {
      const result = await submitMaterialGenerate(target.kind === 'image'
        ? { kind: 'image', imageDataUrl: image, prompt: prompt.trim() || imageName }
        : { kind: 'text', prompt: prompt.trim() }, cloud ? { cloud } : {});
      if (!result.ok) {
        setCredit(false);
        if (!result.stub || result.outcome === 'unknown' || record.taskid) {
          record.state = record.taskid ? 'submitted' : 'unknown'; saveSubmission(record); setReceipt({ ...record });
          setNote(`${result.message} ${submissionNote(record)}`);
        } else {
          // Only the helper's no-channel stub proves no generation dispatch occurred.
          localStorage.removeItem(submissionKey(projectId, target.facilityId)); setReceipt(null); setNote(result.message);
        }
        return;
      }
      record.taskid = result.taskid; record.lane = result.lane; record.state = 'submitted'; saveSubmission(record);
      attachFacilityGenerateTask({ ...record, taskid: result.taskid, name: prompt.trim() || imageName || target.facilityName });
      setReceipt({ ...record }); setSubmitted(true);
      setNote(`已提交 ${result.taskid}。留在户外规划，选中「${target.facilityName}」即可查看进度和回填候选。`);
    } catch {
      record.state = record.taskid ? 'submitted' : 'unknown';
      try { saveSubmission(record); } catch { /* original submitting record remains locked */ }
      setReceipt({ ...record }); setNote(submissionNote(record));
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
        {receipt?.state === 'terminal' && receipt.taskid && <button type="button" onClick={prepareNewRound}>准备新一轮（需重新确认额度）</button>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" disabled={busy} onClick={onClose}>{submitted ? '返回户外规划' : '取消'}</button>
          <button type="submit" disabled={!credit || busy || submitted || unknown || (target.kind === 'image' ? !image : !prompt.trim())}>{busy ? '提交中…' : '提交生成'}</button>
        </div>
      </form>
    </section>
  </div>, document.body);
}
