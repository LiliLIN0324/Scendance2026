'use client';

import { useEffect, useRef, useState } from 'react';
import { useBackendSession, type BackendSession, type GenerationJob } from '@/lib/backend-session';
import { createGlbCatalogItem, ensureGlbAsset } from '../three/glb-assets';
import type { CatalogItem } from '../lib/types';

const labels: Record<GenerationJob['state'], string> = {
  queued: '等待生成', submitting: '正在提交', submitted: '已提交', processing: '正在生成',
  archiving: '正在保存模型', ready: '模型已就绪', added: '已保存到场地', failed: '生成失败',
  rejected: '模型未通过检查', submit_unknown: '提交结果待核对，请联系管理员',
};
const activeStates = new Set<GenerationJob['state']>(['queued', 'submitting', 'submitted', 'processing', 'archiving']);
type Intent = { requestId: string; prompt: string };
export type AssistantModelRequest = Intent & { userId: string; projectId: string | undefined };
type GenerationProps = {
  controller?: BackendSession; disabled?: boolean; onAdd(item: CatalogItem): void;
  assistantRequest?: AssistantModelRequest | null;
  onAssistantResult?(requestId: string, message: string): void;
  presentation?: 'library' | 'assistant';
};
const storageKey = (user: string) => `scendance:3d-intent:${user}`;
function loadIntent(user: string): Intent | null {
  try {
    const raw = sessionStorage.getItem(storageKey(user));
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    if (value && typeof value === 'object' && 'requestId' in value && 'prompt' in value &&
      typeof value.requestId === 'string' && /^[0-9a-f-]{36}$/i.test(value.requestId) &&
      typeof value.prompt === 'string' && value.prompt.trim() && value.prompt.length <= 1024) return value as Intent;
  } catch { /* Fail closed when an earlier submission cannot be recovered. */ }
  throw new Error('无法读取上一次模型请求，请先核对云任务记录并恢复本地存储，再提交新生成。');
}
function message(error: unknown): string {
  const code = error instanceof Error && 'code' in error ? error.code : '';
  if (code === 'SERVICE_NOT_CONFIGURED' || code === 'BILLING_NOT_CONFIGURED') return '3D 生成服务尚未开通，请联系管理员。';
  if (code === 'BUDGET_EXCEEDED') return '3D 生成累计额度已用完，请联系管理员。';
  return error instanceof Error ? error.message : '操作失败，请手动刷新状态。';
}

export function GeneratedModelLibrary({ controller, disabled = false, onAdd, assistantRequest, onAssistantResult, presentation = 'library' }: GenerationProps): JSX.Element {
  return controller ? <ConnectedGeneration controller={controller} disabled={disabled} onAdd={onAdd}
    {...(assistantRequest ? { assistantRequest } : {})} {...(onAssistantResult ? { onAssistantResult } : {})} presentation={presentation}/>
    : <p className="sc-note">连接云项目后可生成单件 3D 模型。</p>;
}

function ConnectedGeneration({ controller, disabled = false, onAdd, assistantRequest, onAssistantResult, presentation = 'library' }:
  GenerationProps & { controller: BackendSession }): JSX.Element {
  const cloud = useBackendSession(controller);
  const userId = cloud.user?.id;
  const projectId = cloud.project?.id;
  const [prompt, setPrompt] = useState('');
  const [intent, setIntent] = useState<Intent | null>(null);
  const [jobs, setJobs] = useState<GenerationJob[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState<string | null>(null);
  const [dimensions, setDimensions] = useState({ width: 1, depth: 1, height: 1 });
  const [refresh, setRefresh] = useState(0);
  const lock = useRef(false);
  const latest = useRef({ userId, projectId, disabled, writeBlocked: cloud.writeBlocked, onAdd });
  latest.current = { userId, projectId, disabled, writeBlocked: cloud.writeBlocked, onAdd };
  const mounted = useRef(true);
  const marked = useRef(new Set<string>());
  const handledRequests = useRef(new Set<string>());
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  useEffect(() => {
    setJobs([]); setError('');
    marked.current.clear();
    try {
      const saved = userId ? loadIntent(userId) : null;
      setIntent(saved); setPrompt(saved?.prompt ?? '');
    } catch (failure) { setIntent(null); setPrompt(''); setError(message(failure)); }
  }, [userId]);

  useEffect(() => {
    if (!userId) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function read() {
      try {
        const result = await controller.listGenerationJobs();
        if (!alive) return;
        setJobs(result);
        // Only status reads repeat. A submit_unknown task never resubmits here.
        if (result.some(job => activeStates.has(job.state))) timer = setTimeout(() => void read(), 30_000);
      } catch (failure) { if (alive) setError(message(failure)); }
    }
    void read();
    return () => { alive = false; if (timer) clearTimeout(timer); };
  }, [controller, userId, projectId, refresh]);

  useEffect(() => {
    if (!userId || !projectId || cloud.dirty) return;
    const savedIds = new Set(cloud.project?.scene?.objects.map(object => object.assetId).filter(Boolean));
    for (const job of jobs) {
      const key = `${projectId}:${cloud.project?.revision}:${job.id}`;
      if (job.state !== 'ready' || !job.asset_id || !savedIds.has(job.asset_id) || marked.current.has(key)) continue;
      marked.current.add(key);
      void controller.markGenerationAdded(job.id, projectId).then(updated => {
        if (mounted.current && latest.current.userId === userId && latest.current.projectId === projectId) setJobs(current => current.map(value => value.id === updated.id ? updated : value));
      }).catch(failure => {
        if (mounted.current && latest.current.userId === userId && latest.current.projectId === projectId) setError(`场景已保存，但任务状态更新失败：${message(failure)}`);
      });
    }
  }, [controller, userId, projectId, cloud.dirty, cloud.project, jobs]);

  async function generate(request?: AssistantModelRequest) {
    if (!userId || lock.current || (!request && !intent && !prompt.trim())) return;
    lock.current = true; setBusy(true); setError('');
    let resultMessage = '';
    try {
      const saved = loadIntent(userId);
      const next = request ?? saved ?? intent ?? { requestId: crypto.randomUUID(), prompt: prompt.trim() };
      if (request && (request.userId !== userId || request.projectId !== projectId)) throw new Error('账号或项目已变化，请重新发送模型要求。');
      if (request && saved && saved.requestId !== request.requestId) {
        setIntent(saved);
        throw new Error('上一次模型提交结果尚未确认，请先继续核对原请求。');
      }
      if (!next.prompt.trim() || next.prompt.length > 1024) throw new Error('单件模型描述须为 1–1024 个字符，请精简后发送。');
      // Persist before dispatch; after an uncertain response, explicit retry keeps the same ID.
      sessionStorage.setItem(storageKey(userId), JSON.stringify(next));
      setIntent(next);
      const job = await controller.createGenerationJob(next.prompt, next.requestId);
      sessionStorage.removeItem(storageKey(userId));
      if (!mounted.current || latest.current.userId !== userId) return;
      setIntent(null); setPrompt(''); setJobs(current => [job, ...current.filter(item => item.id !== job.id)]);
      setRefresh(value => value + 1);
      resultMessage = '混元模型任务已提交，进度会在这里更新。完成后设定尺寸，再加入场地。';
    } catch (failure) {
      resultMessage = `${message(failure)} 如需重试，将继续核对同一项请求。`;
      if (mounted.current && latest.current.userId === userId) setError(resultMessage);
    } finally {
      lock.current = false;
      if (mounted.current) setBusy(false);
      if (request) onAssistantResult?.(request.requestId, resultMessage);
    }
  }

  useEffect(() => {
    if (!assistantRequest || !userId || handledRequests.current.has(assistantRequest.requestId) || lock.current) return;
    handledRequests.current.add(assistantRequest.requestId);
    void generate(assistantRequest);
    // Only a request explicitly created by sending a chat message can submit here.
    // Status refreshes and component rerenders never create new request IDs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assistantRequest?.requestId, userId, busy, adding]);

  async function add(job: GenerationJob) {
    if (!userId || !projectId || disabled || cloud.writeBlocked || !job.asset_id || lock.current) return;
    lock.current = true; setAdding(job.id); setError('');
    const size = { ...dimensions };
    try {
      const asset = await controller.authorizeAsset(job.asset_id);
      await ensureGlbAsset(job.asset_id, asset.url);
      if (!mounted.current) return;
      if (latest.current.userId !== userId || latest.current.projectId !== projectId || latest.current.writeBlocked || latest.current.disabled) throw new Error('项目或编辑状态已变化，请重新添加模型。');
      latest.current.onAdd(createGlbCatalogItem({ name: asset.name, url: asset.url, assetId: job.asset_id, ...size, source: 'generated' }));
    } catch (failure) { if (mounted.current && latest.current.userId === userId) setError(message(failure)); }
    finally { lock.current = false; if (mounted.current) setAdding(null); }
  }

  const validSize = Object.values(dimensions).every(value => Number.isFinite(value) && value >= 0.1 && value <= 50);
  return <section className="sc-generated-models" aria-label="生成 3D 模型">
    <div className="sc-section-heading"><div><h2>{presentation === 'assistant' ? '混元模型任务' : '生成单件 3D 模型'}</h2>{presentation === 'library' && <p>描述一件物料，生成后加入场地预览。</p>}</div></div>
    {!userId ? <p className="sc-note">请先登录云项目。</p> : <>
      {presentation === 'library' && <label className="sc-field">物料描述<textarea aria-label="物料描述" maxLength={1024} rows={3} value={intent?.prompt ?? prompt}
        disabled={busy || intent !== null} onChange={event => setPrompt(event.target.value)} placeholder="例如：一把绿色藤编休闲椅，独立物件，无背景"/></label>}
      <p className="sc-note">每次生成会使用账号额度。失败或结果待核对时，额度可能仍被消耗。</p>
      {(presentation === 'library' || intent) && <button type="button" className="sc-button sc-full" disabled={busy || adding !== null || (!intent && !prompt.trim())}
        onClick={() => void generate()}>{busy ? '正在提交…' : intent ? '核对并继续同一请求' : '生成 3D 模型'}</button>}
      <button type="button" className="sc-button sc-full" onClick={() => { setError(''); setRefresh(value => value + 1); }}>刷新任务状态</button>
      {error && <p className="sc-warning" role="alert">{error}</p>}
      {jobs.length > 0 && <>
        <div className="sc-dimension-grid">{(['width', 'depth', 'height'] as const).map((key, index) =>
          <label className="sc-field" key={key}>{['宽度 / m', '进深 / m', '高度 / m'][index]}<input aria-label={`生成模型${['宽度', '进深', '高度'][index]}`} type="number" min={0.1} max={50} step={0.1}
            value={dimensions[key]} onChange={event => setDimensions(current => ({ ...current, [key]: event.target.valueAsNumber }))}/></label>)}</div>
        <p className="sc-note">尺寸为你设定的场地摆放尺寸，请按实际物料核对。加入后使用云端保存。</p>
        <ul className="sc-generated-tasks">{jobs.map(job => <li key={job.id}>
          <strong>{job.prompt}</strong><span role="status">{labels[job.state]}</span>
          {['ready', 'added'].includes(job.state) && <button type="button" className="sc-button" disabled={!projectId || cloud.writeBlocked || disabled || busy || adding !== null || !validSize}
            onClick={() => void add(job)}>{adding === job.id ? '正在加载…' : '加入场地预览'}</button>}
        </li>)}</ul>
      </>}
    </>}
  </section>;
}
