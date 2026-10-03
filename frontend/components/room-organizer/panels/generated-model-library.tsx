'use client';

import { useEffect, useRef, useState } from 'react';
import { intentStorageKey, readGenerationIntent, saveGenerationIntent, type GenerationIntent } from '@/lib/assets-api';
import { useBackendSession, type BackendSession, type GenerationJob } from '@/lib/backend-session';
import { createGlbCatalogItem, ensureGlbAsset } from '../three/glb-assets';
import type { CatalogItem } from '../lib/types';

const labels: Record<GenerationJob['state'], string> = {
  queued: '等待生成', submitting: '正在提交', submitted: '已提交', processing: '正在生成',
  archiving: '正在保存模型', ready: '模型已就绪', added: '已保存到场地', failed: '生成失败',
  rejected: '模型未通过检查', submit_unknown: '提交结果待核对，请联系管理员',
};
const activeStates = new Set<GenerationJob['state']>(['queued', 'submitting', 'submitted', 'processing', 'archiving']);
type Intent = GenerationIntent & { storage: 'local' | 'session' };
const storageKey = (user: string) => `scendance:3d-intent:${user}`;
function message(error: unknown): string {
  const code = error instanceof Error && 'code' in error ? error.code : '';
  if (code === 'SERVICE_NOT_CONFIGURED' || code === 'BILLING_NOT_CONFIGURED') return '3D 生成服务尚未开通，请联系管理员。';
  if (code === 'BUDGET_EXCEEDED') return '3D 生成累计额度已用完，请联系管理员。';
  return error instanceof Error ? error.message : '操作失败，请手动刷新状态。';
}

export function GeneratedModelLibrary({ controller, disabled = false, onAdd }: {
  controller?: BackendSession; disabled?: boolean; onAdd(item: CatalogItem): void;
}): JSX.Element {
  return controller ? <ConnectedGeneration controller={controller} disabled={disabled} onAdd={onAdd}/>
    : <p className="sc-note">连接云项目后可生成单件 3D 模型。</p>;
}

function ConnectedGeneration({ controller, disabled, onAdd }: {
  controller: BackendSession; disabled: boolean; onAdd(item: CatalogItem): void;
}): JSX.Element {
  const cloud = useBackendSession(controller);
  const userId = cloud.user?.id;
  const projectId = cloud.project?.id;
  const apiUrl = controller.config.apiUrl;
  const key = userId ? intentStorageKey(apiUrl, userId) : '';
  const [prompt, setPrompt] = useState('');
  const [intents, setIntents] = useState<Intent[]>([]);
  const intent = intents[0] ?? null;
  const [storageError, setStorageError] = useState('');
  const [recovery, setRecovery] = useState(0);
  const [jobs, setJobs] = useState<GenerationJob[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState<string | null>(null);
  const [dimensions, setDimensions] = useState({ width: 1, depth: 1, height: 1 });
  const [refresh, setRefresh] = useState(0);
  const lock = useRef(false);
  const latest = useRef({ userId, projectId, apiUrl, disabled, writeBlocked: cloud.writeBlocked, onAdd });
  latest.current = { userId, projectId, apiUrl, disabled, writeBlocked: cloud.writeBlocked, onAdd };
  const mounted = useRef(true);
  const marked = useRef(new Set<string>());
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  useEffect(() => {
    setJobs([]); setError('');
    marked.current.clear();
  }, [userId, apiUrl]);

  useEffect(() => {
    setIntents([]); setPrompt(''); setStorageError('');
    if (!userId) return;
    try {
      const local = readGenerationIntent(localStorage, key);
      const session = readGenerationIntent(sessionStorage, storageKey(userId));
      if (local && session && local.requestId === session.requestId && local.prompt !== session.prompt) throw new Error('两个已保存请求的编号相同但内容不一致。请联系管理员核对后恢复存储，暂不能提交生成。');
      const saved: Intent[] = [
        ...(local ? [{ ...local, storage: 'local' as const }] : []),
        ...(session ? [{ ...session, storage: 'session' as const }] : []),
      ];
      const acknowledged = new Set(saved.filter(value => value.jobId).map(value => value.requestId));
      for (const value of saved.filter(value => !value.jobId && acknowledged.has(value.requestId))) {
        (value.storage === 'local' ? localStorage : sessionStorage).removeItem(value.storage === 'local' ? key : storageKey(userId));
      }
      setIntents(saved.filter(value => !acknowledged.has(value.requestId)));
    } catch (failure) { setStorageError(message(failure)); }
  }, [userId, key, recovery]);

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

  async function generate() {
    if (!userId || lock.current || storageError || (!intent && !prompt.trim())) return;
    lock.current = true; setBusy(true); setError('');
    const next: Intent = intent ?? { requestId: crypto.randomUUID(), prompt: prompt.trim(), storage: 'local' };
    try {
      // Persist before dispatch; after an uncertain response, explicit retry keeps the same ID.
      try { saveGenerationIntent(next.storage === 'local' ? localStorage : sessionStorage, next.storage === 'local' ? key : storageKey(userId), { requestId: next.requestId, prompt: next.prompt }); }
      catch (failure) { setStorageError(message(failure)); return; }
      if (!intent) setIntents([next]);
      const job = await controller.createGenerationJob(next.prompt, next.requestId);
      let storageFailure = '';
      try {
        for (const completed of (intent ? intents : [next]).filter(value => value.requestId === next.requestId)) {
          const storage = completed.storage === 'local' ? localStorage : sessionStorage;
          const completedKey = completed.storage === 'local' ? key : storageKey(userId);
          // Record the acknowledged job before cleanup so a failed removal cannot resubmit it.
          saveGenerationIntent(storage, completedKey, { requestId: completed.requestId, prompt: completed.prompt, jobId: job.id });
          storage.removeItem(completedKey);
        }
      } catch (failure) { storageFailure = message(failure); }
      if (!mounted.current || latest.current.userId !== userId || latest.current.apiUrl !== apiUrl) return;
      setStorageError(storageFailure);
      setIntents(current => current.filter(value => value.requestId !== next.requestId));
      setPrompt(''); setJobs(current => [job, ...current.filter(item => item.id !== job.id)]);
      setRefresh(value => value + 1);
    } catch (failure) {
      if (mounted.current && latest.current.userId === userId && latest.current.apiUrl === apiUrl) setError(`${message(failure)} 如需重试，将继续核对同一项请求。`);
    } finally { lock.current = false; if (mounted.current) setBusy(false); }
  }

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
    <div className="sc-section-heading"><div><h2>生成单件 3D 模型</h2><p>由腾讯 HY-3D-3.0 生成单件物料，完成后可加入场地预览。</p></div></div>
    {!userId ? <p className="sc-note">请先登录云项目。</p> : <>
      <label className="sc-field">物料描述<textarea aria-label="物料描述" maxLength={1024} rows={3} value={intent?.prompt ?? prompt}
        disabled={busy || intent !== null || !!storageError} onChange={event => setPrompt(event.target.value)} placeholder="例如：一把绿色藤编休闲椅，独立物件，无背景"/></label>
      <p className="sc-note">每次生成会使用账号额度。失败或结果待核对时，额度可能仍被消耗。</p>
      <button type="button" className="sc-button sc-full" disabled={busy || adding !== null || !!storageError || (!intent && !prompt.trim())}
        onClick={() => void generate()}>{busy ? '正在提交…' : intent ? '核对并继续同一请求' : '生成 3D 模型'}</button>
      {intents.length > 1 && <p className="sc-note">有 {intents.length} 项未确认请求，将逐项核对原请求，完成前不能新建需求。</p>}
      {storageError && <><p className="sc-warning" role="alert">{storageError} 请核对云端任务并恢复浏览器存储，再重新读取生成请求。</p><button type="button" className="sc-button sc-full" disabled={busy || adding !== null} onClick={() => setRecovery(value => value + 1)}>重新读取生成请求</button></>}
      <button type="button" className="sc-button sc-full" onClick={() => { setError(''); setRefresh(value => value + 1); }}>刷新任务状态</button>
      {error && <p className="sc-warning" role="alert">{error}</p>}
      {jobs.length > 0 && <>
        <div className="sc-dimension-grid">{(['width', 'depth', 'height'] as const).map((key, index) =>
          <label className="sc-field" key={key}>{['宽度 / m', '进深 / m', '高度 / m'][index]}<input aria-label={`生成模型${['宽度', '进深', '高度'][index]}`} type="number" min={0.1} max={50} step={0.1}
            value={Number.isFinite(dimensions[key]) ? dimensions[key] : ''} onChange={event => setDimensions(current => ({ ...current, [key]: event.target.valueAsNumber }))}/></label>)}</div>
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
