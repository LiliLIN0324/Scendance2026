'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { addAssetToLayout, assetError, assetPreviewScene, intentStorageKey, jobIsActive, jobLabels,
  readGenerationIntent, saveGenerationIntent, validAssetSize,
  type AssetSize, type AuthorizedAsset, type CloudAsset, type GenerationIntent } from '@/lib/assets-api';
import { type BackendSession, type GenerationJob, useBackendSession } from '@/lib/backend-session';
import { ensureGlbAsset } from '../room-organizer/three/glb-assets';
import { ScenePreview } from './scene-preview';
import type { RoomLayout } from '../room-organizer/lib/types';
import '@/app/assets.css';

interface Props { controller: BackendSession; layout: RoomLayout; onApplyLayout(layout: RoomLayout): void; bound: boolean; busy: boolean }
interface Preview { asset: AuthorizedAsset }
interface RequestContext { userId: string; projectId: string | undefined; generation: number | undefined; version: number }

export function AssetsPanel({ controller, layout, onApplyLayout, bound, busy }: Props): JSX.Element {
  const cloud = useBackendSession(controller);
  const generationEnabled = process.env.NEXT_PUBLIC_GENERATION_ENABLED === 'true';
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<'mine' | 'generate'>('mine');
  const [assets, setAssets] = useState<CloudAsset[]>([]);
  const [jobs, setJobs] = useState<GenerationJob[]>([]);
  const [prompt, setPrompt] = useState('');
  const [intent, setIntent] = useState<GenerationIntent | null>(null);
  const [storageError, setStorageError] = useState('');
  const [generationUnavailable, setGenerationUnavailable] = useState(false);
  const [notice, setNotice] = useState('');
  const [pending, setPending] = useState('');
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [size, setSize] = useState<AssetSize>({ width: 1, depth: 1, height: 1 });
  const layoutRef = useRef(layout); layoutRef.current = layout;
  const running = useRef<symbol | null>(null);
  const userId = cloud.user?.id;
  const key = userId ? intentStorageKey(controller.config.apiUrl, userId) : '';
  const scopeKey = `${key}:${cloud.project?.id ?? ''}:${cloud.lease?.generation ?? ''}`;
  const scopeRef = useRef({ key: scopeKey, version: 0 });
  if (scopeRef.current.key !== scopeKey) scopeRef.current = { key: scopeKey, version: scopeRef.current.version + 1 };
  const alive = useRef(true);
  const intentJob = jobs.find(job => job.id === intent?.jobId);
  const canStartNew = !!intentJob && !jobIsActive(intentJob);
  const activeJobs = jobs.some(jobIsActive);
  const canAdd = !busy && (!bound || !cloud.writeBlocked);
  const previewProps = useMemo(() => preview && validAssetSize(size) ? {
    scene: assetPreviewScene(preview.asset, size), assetUrls: { [preview.asset.id]: preview.asset.url }, assetNames: { [preview.asset.id]: preview.asset.name },
  } : null, [preview, size]);

  useEffect(() => {
    setAssets([]); setJobs([]); setPreview(null); setIntent(null); setPrompt(''); setNotice(''); setStorageError(''); setGenerationUnavailable(false);
    if (!key) return;
    try { const stored = readGenerationIntent(window.localStorage, key); setIntent(stored); setPrompt(stored?.prompt ?? ''); }
    catch (error) { setStorageError(assetError(error)); }
  }, [key]);
  useEffect(() => { setPreview(null); setPending(''); running.current = null; }, [scopeKey]);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  function current(context: RequestContext): boolean {
    const state = controller.getSnapshot();
    return alive.current && scopeRef.current.version === context.version && state.user?.id === context.userId &&
      state.project?.id === context.projectId && state.lease?.generation === context.generation;
  }

  useEffect(() => {
    if (!open || !userId) return;
    let cancelled = false;
    let refreshing = false;
    async function refresh(): Promise<void> {
      if (refreshing) return;
      refreshing = true; setLoading(true);
      const results = await Promise.allSettled([controller.businessRequest<CloudAsset[]>('/assets'), controller.listGenerationJobs()]);
      if (!cancelled) {
        if (results[0].status === 'fulfilled') setAssets(results[0].value);
        if (results[1].status === 'fulfilled') setJobs(results[1].value);
        const failed = results.find(result => result.status === 'rejected');
        if (failed?.status === 'rejected') setNotice(`列表刷新失败：${assetError(failed.reason)}`);
        setLoading(false);
      }
      refreshing = false;
    }
    void refresh();
    const timer = window.setInterval(() => { void refresh(); }, 10_000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [controller, userId, open]);

  async function run(label: string, action: (context: RequestContext) => Promise<void>): Promise<void> {
    if (running.current || busy || !userId) return;
    const context = { userId, projectId: cloud.project?.id, generation: cloud.lease?.generation, version: scopeRef.current.version };
    const request = Symbol(); running.current = request; setPending(label); setNotice('');
    try { await action(context); }
    catch (error) { if (current(context)) setNotice(assetError(error)); }
    finally { if (running.current === request) { running.current = null; if (alive.current) setPending(''); } }
  }
  async function refreshLists(context: RequestContext): Promise<void> {
    const [nextAssets, nextJobs] = await Promise.all([controller.businessRequest<CloudAsset[]>('/assets'), controller.listGenerationJobs()]);
    if (current(context)) { setAssets(nextAssets); setJobs(nextJobs); }
  }
  async function loadPreview(assetId: string, context: RequestContext): Promise<void> {
    const authorized = await controller.authorizeAsset(assetId);
    const metadata = assets.find(asset => asset.id === assetId);
    const asset = { ...authorized, source: metadata?.source ?? 'hunyuan' };
    await ensureGlbAsset(asset.id, asset.url);
    if (!current(context)) return;
    setSize(metadata?.metadata?.sourceSize && validAssetSize(metadata.metadata.sourceSize) ? metadata.metadata.sourceSize : { width: 1, depth: 1, height: 1 });
    setPreview({ asset });
  }
  async function submitGeneration(context: RequestContext): Promise<void> {
    if (!generationEnabled || generationUnavailable) return;
    // Lock the prompt and key before the first network call; every manual retry replays both.
    const nextIntent = intent ?? { requestId: crypto.randomUUID(), prompt: prompt.trim() };
    if (!nextIntent.prompt || nextIntent.prompt.length > 1024 || storageError) return;
    saveGenerationIntent(window.localStorage, key, nextIntent);
    setIntent(nextIntent);
    let timer: ReturnType<typeof setTimeout> | undefined;
    let job: GenerationJob;
    try {
      job = await Promise.race([
        controller.createGenerationJob(nextIntent.prompt, nextIntent.requestId),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('提交响应超时，结果尚未确认。请保留此请求编号，使用原请求重试恢复任务。')), 30_000); }),
      ]);
    } catch (error) {
      if (current(context) && error && typeof error === 'object' && 'code' in error && ['SERVICE_NOT_CONFIGURED', 'BILLING_NOT_CONFIGURED'].includes(String(error.code))) setGenerationUnavailable(true);
      throw error;
    } finally { if (timer) clearTimeout(timer); }
    if (!current(context)) return;
    const acknowledged = { ...nextIntent, jobId: job.id };
    // If storage becomes unavailable after submission, the earlier key remains safe to replay.
    setIntent(acknowledged);
    setJobs(current => [job, ...current.filter(item => item.id !== job.id)]);
    saveGenerationIntent(window.localStorage, key, acknowledged);
    setNotice('生成任务已记录。任务由服务器处理，刷新页面后可继续查看。');
  }
  function startNewIntent(): void {
    if (!canStartNew || !key) return;
    try { window.localStorage.removeItem(key); setIntent(null); setPrompt(''); setNotice(''); }
    catch { setStorageError('无法更新本地生成请求，请恢复本地存储后重试。'); }
  }
  async function addPreview(context: RequestContext): Promise<void> {
    if (!preview || !canAdd) return;
    const before = layoutRef.current;
    // Reauthorize at confirmation, including when a preview has stayed open past URL expiry.
    const authorized = await controller.authorizeAsset(preview.asset.id);
    if (!current(context)) return;
    if (before !== layoutRef.current) throw new Error('确认期间画布已变化，请检查后重新加入素材。');
    const next = addAssetToLayout(before, { ...preview.asset, ...authorized }, size);
    onApplyLayout(next); setPreview(null);
    setNotice('素材已加入当前画布，可撤销；尚未保存到云端。请使用“保存到云端”提交。');
  }
  async function markAdded(job: GenerationJob, context: RequestContext): Promise<void> {
    const project = controller.getSnapshot().project;
    if (!bound || !project || !job.asset_id) throw new Error('请先打开包含该素材的云项目并保存。');
    const saved = await controller.businessRequest<{ scene: { objects: { assetId?: string }[] } }>(`/projects/${project.id}`);
    if (!current(context)) return;
    if (!saved.scene.objects.some(object => object.assetId === job.asset_id)) throw new Error('云端已保存版本不含该素材。请先保存当前画布，再同步任务状态。');
    const result = await controller.markGenerationAdded(job.id, project.id);
    if (current(context)) { setJobs(current => current.map(item => item.id === job.id ? result : item)); setNotice('服务器已确认素材存在于保存的项目，任务状态已同步。'); }
  }

  return <section className="sc-assets" aria-label="素材与三维生成">
    <button type="button" className="sc-assets-toggle" aria-expanded={open} aria-controls="sc-assets-content" onClick={() => setOpen(value => !value)}>素材与三维生成 <span aria-hidden="true">{open ? '−' : '+'}</span></button>
    {open && <div id="sc-assets-content">
      {!userId ? <p>请先登录工作室，再查看素材与生成任务。</p> : <>
        <p className="sc-assets-intro">查看你的云素材和生成任务。公共模型继续在工作台物料库中挑选。</p>
        <div className="sc-assets-tabs" role="tablist" aria-label="素材来源">
          {([['mine', '个人素材'], ['generate', '生成任务']] as const).map(([value, label]) => <button key={value} id={`sc-assets-tab-${value}`} type="button" role="tab" aria-selected={tab === value} aria-controls="sc-assets-tabpanel" onClick={() => setTab(value)}>{label}</button>)}
        </div>
        <div role="tabpanel" id="sc-assets-tabpanel" aria-labelledby={`sc-assets-tab-${tab}`}>
          {tab === 'mine' && <>
            <div className="sc-assets-section-heading"><h4>本人云素材</h4><button type="button" disabled={!!pending || busy} onClick={() => void run('刷新素材', refreshLists)}>刷新素材</button></div>
            {loading && <p role="status">正在更新素材与任务…</p>}
            {!loading && !assets.length && <p>还没有个人云素材。公共模型位于工作台的“物料库”。</p>}
            <ul className="sc-assets-list">{assets.map(asset => <li key={asset.id}><div><strong>{asset.name}</strong><small>{asset.source === 'polyhaven' ? 'Poly Haven' : asset.source} · {asset.format.toUpperCase()} · {(asset.byte_size / 1024 / 1024).toFixed(1)} MB</small></div>
              {asset.format === 'glb' ? <button type="button" disabled={!!pending || busy} onClick={() => void run('加载模型预览', account => loadPreview(asset.id, account))}>预览 {asset.name}</button> : <span>场地底图</span>}
            </li>)}</ul>
          </>}
          {tab === 'generate' && <>
            <form onSubmit={event => { event.preventDefault(); void run('提交生成任务', submitGeneration); }}>
              <label htmlFor="sc-assets-prompt">描述需要的三维物件<textarea id="sc-assets-prompt" value={prompt} maxLength={1024} rows={3} disabled={!!intent || !!pending} onChange={event => setPrompt(event.target.value)} placeholder="描述单个物件的外形、颜色和材质"/></label>
              <p>{generationEnabled ? '生成可能消耗工作室预算。只有点击提交才创建任务；服务未配置时会显示具体错误。' : '付费三维生成暂未启用。此处保留接入口，已有任务与模型仍可查看。'}</p>
              <button type="submit" disabled={!generationEnabled || generationUnavailable || !!pending || busy || !prompt.trim() || !!storageError || !!intent?.jobId || (!intent && activeJobs)}>{intent ? '使用原请求编号重试' : '确认创建生成任务'}</button>
              {generationUnavailable && <small>服务器缺少生成配置或费用上限，提交与重试已暂停。管理员完成配置后刷新页面恢复。</small>}
              {intent && <small>请求编号：{intent.requestId}。内容与编号已保留，网络异常后重试不会更换编号。</small>}
              {canStartNew && <button type="button" disabled={!!pending || busy} onClick={startNewIntent}>开始新的生成需求</button>}
            </form>
            {storageError && <p role="alert">{storageError}</p>}
            {intent && !intent.jobId && <p className="sc-assets-message">此请求尚未确认结果。请重试原请求以恢复任务；不要另建重复需求。</p>}
            <div className="sc-assets-section-heading"><h4>我的生成任务</h4><button type="button" disabled={!!pending || busy} onClick={() => void run('刷新任务', refreshLists)}>刷新任务</button></div>
            {!jobs.length && !loading && <p>还没有生成任务。提交后可在此查看真实进度与结果。</p>}
            <ul className="sc-assets-jobs">{jobs.map(job => <li key={job.id}>
              <div className="sc-assets-section-heading"><strong>{jobLabels[job.state] ?? job.state}</strong><small>{new Date(job.created_at).toLocaleString()}</small></div>
              <p>{job.prompt}</p>
              {job.error_code && <p role="status">错误：{job.error_code}</p>}
              {job.state === 'submit_unknown' && <p className="sc-assets-message">提供商提交结果不确定，可能已经计费。任务已暂停自动提交，请联系管理员核对；本页面不会重新提交或另建任务。</p>}
              {(job.state === 'failed' || job.state === 'rejected') && <p>未获得可用模型，当前画布保持不变。核对失败原因后，可明确发起新需求。</p>}
              {job.asset_id && (job.state === 'ready' || job.state === 'added') && <div className="sc-assets-actions">
                <button type="button" disabled={!!pending || busy} onClick={() => void run('加载生成模型', account => loadPreview(job.asset_id!, account))}>预览生成结果</button>
                {job.state === 'ready' && <button type="button" disabled={!!pending || busy || !bound} onClick={() => void run('核对云项目', account => markAdded(job, account))}>已保存，核对并同步状态</button>}
              </div>}
            </li>)}</ul>
            <small>列表显示最近 100 个任务，每 10 秒更新；生成在服务器继续，不依赖此面板保持打开。</small>
          </>}
        </div>
        {preview && <section className="sc-assets-preview" aria-label="三维素材预览">
          <div className="sc-assets-section-heading"><h4>{preview.asset.name}</h4><button type="button" onClick={() => setPreview(null)}>关闭预览</button></div>
          {previewProps && <ScenePreview {...previewProps}/>}
          <p>保留模型原始材质。以下尺寸为加入场地后的实际尺寸，单位为米。</p>
          <div className="sc-assets-dimensions">{([['width', '宽'], ['depth', '深'], ['height', '高']] as const).map(([field, label]) => <label key={field}>{label}（米）<input aria-label={`模型${label}（米）`} type="number" min={field === 'height' ? .01 : .1} max={field === 'height' ? 30 : 50} step="0.01" value={Number.isNaN(size[field]) ? '' : size[field]} onChange={event => setSize(value => ({ ...value, [field]: event.target.value === '' ? NaN : Number(event.target.value) }))}/></label>)}</div>
          <div className="sc-assets-actions"><button type="button" className="sc-assets-primary" disabled={!validAssetSize(size) || !canAdd || !!pending} onClick={() => void run('加入模型', addPreview)}>确认加入当前画布</button><button type="button" disabled={!!pending || busy} onClick={() => void run('更新素材授权', account => loadPreview(preview.asset.id, account))}>重新授权</button></div>
          {!canAdd && <p>当前项目正在操作或尚无编辑权，请获取编辑权后加入。</p>}
          <small>加入位置为场地中央。可在画布移动、复制或撤销；加入后仍需保存到云端。</small>
        </section>}
      </>}
      {pending && <p role="status">正在{pending}…</p>}
      {notice && <p className="sc-assets-message" role="status">{notice}</p>}
    </div>}
  </section>;
}
