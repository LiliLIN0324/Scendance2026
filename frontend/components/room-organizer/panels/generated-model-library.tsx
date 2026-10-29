'use client';

import { useEffect, useRef, useState } from 'react';
import { assetError } from '@/lib/assets-api';
import { useBackendSession, type BackendSession, type GenerationCapabilities, type GenerationJob } from '@/lib/backend-session';
import { AholoGuideCard } from './aholo-guide-card';
import { createGlbCatalogItem, ensureGlbAsset } from '../three/glb-assets';
import type { CatalogItem } from '../lib/types';

const labels: Record<GenerationJob['state'], string> = {
  queued: '等待生成', submitting: '正在提交', submitted: '已提交', processing: '正在生成',
  archiving: '正在保存模型', ready: '模型已就绪', added: '已保存到场地', failed: '生成失败',
  rejected: '模型未通过检查', submit_unknown: '提交结果待核对，请联系管理员',
};
const activeStates = new Set(['queued','submitting','submitted','processing','archiving']);
const message = assetError;
export interface TextureVariantReady { sourceAssetId:string;variantAssetId:string;objectIds?:string[] }
export interface GenerationTarget { sourceAssetId?:string;sourceObjectIds?:string[];onVariantReady?(variant:TextureVariantReady):void }
export function GeneratedModelLibrary({ controller, disabled = false, onAdd, ...target }: {
  controller?: BackendSession; disabled?: boolean; onAdd(item: CatalogItem): void;
} & GenerationTarget): JSX.Element {
  return controller ? <ScopedGeneration controller={controller} disabled={disabled} onAdd={onAdd} {...target}/>
    : <p className="sc-note">登录后可查看历史模型。</p>;
}
interface ConnectedProps extends GenerationTarget { controller: BackendSession; disabled: boolean; onAdd(item: CatalogItem): void }
function ScopedGeneration(props: ConnectedProps): JSX.Element {
  const cloud=useBackendSession(props.controller);
  return <ConnectedGeneration key={`${props.controller.config.apiUrl}:${cloud.user?.id}:${cloud.project?.id}`} {...props}/>;
}
function ConnectedGeneration({ controller, disabled, onAdd, sourceAssetId, sourceObjectIds, onVariantReady }: ConnectedProps): JSX.Element {
  const cloud = useBackendSession(controller);
  const userId = cloud.user?.id, projectId = cloud.project?.id;
  const [jobs, setJobs] = useState<GenerationJob[]>([]);
  const [error, setError] = useState('');
  const [adding, setAdding] = useState<string | null>(null);
  const [dimensions, setDimensions] = useState({ width: 1, depth: 1, height: 1 });
  const [refresh, setRefresh] = useState(0);
  const [capabilities, setCapabilities] = useState<GenerationCapabilities | null>(null);
  const [luxPrompt, setLuxPrompt] = useState('');
  const [luxPending, setLuxPending] = useState(false);
  const [luxReference, setLuxReference] = useState<{ id: string; name: string } | null>(null);
  const lock = useRef(false);
  const latest = useRef({ userId, projectId, disabled, writeBlocked: cloud.writeBlocked, onAdd });
  latest.current = { userId, projectId, disabled, writeBlocked: cloud.writeBlocked, onAdd };
  const mounted = useRef(true), marked = useRef(new Set<string>());
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (!userId) { setCapabilities(null); return; }
    let alive = true;
    controller.getGenerationCapabilities().then(value => { if (alive) setCapabilities(value); }).catch(() => { if (alive) setCapabilities(null); });
    return () => { alive = false; };
  }, [controller, userId]);
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

  function previewVariant(job:GenerationJob){
    if(!job.asset_id||!job.source_asset_id||!onVariantReady||cloud.writeBlocked)return;
    onVariantReady({sourceAssetId:job.source_asset_id,variantAssetId:job.asset_id,...(sourceAssetId===job.source_asset_id&&sourceObjectIds?{objectIds:[...sourceObjectIds]}:{})});
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

  async function submitLux3d() {
    const prompt = luxPrompt.trim();
    if (!userId || disabled || cloud.writeBlocked || luxPending || !prompt || lock.current) return;
    lock.current = true; setLuxPending(true); setError('');
    try {
      const reference = luxReference;
      await controller.createGenerationJob(prompt, crypto.randomUUID(), reference
        ? { kind: 'image', referenceImageAssetId: reference.id, provider: 'aholo' }
        : { provider: 'aholo' });
      setLuxPrompt(''); setLuxReference(null); setRefresh(value => value + 1);
    } catch (failure) { if (mounted.current) setError(message(failure)); }
    finally { lock.current = false; if (mounted.current) setLuxPending(false); }
  }

  async function pickLuxReference(file: File | undefined) {
    if (!file) return;
    setError('');
    try {
      const uploaded = await controller.uploadGenerationReference(file);
      setLuxReference({ id: uploaded.id, name: file.name });
    } catch (failure) { if (mounted.current) setError(message(failure instanceof Error && /5 MB/.test(failure.message) ? failure.message : failure)); }
  }

  const validSize = Object.values(dimensions).every(value => Number.isFinite(value) && value >= 0.1 && value <= 50);
  const luxReady = Boolean(capabilities?.aholoTextToModel) && !disabled && !cloud.writeBlocked;
  return <section className="sc-generated-models" aria-label="历史 3D 模型">
    {luxReady && <div className="sc-section-heading" aria-label="生成物件">
      <div><h2>生成物件</h2><p>一句话或一张照片生成全新物件，完成后出现在下方任务列表。</p></div>
      <div>
        <AholoGuideCard surface="library" />
        <label className="sc-field" htmlFor="lux3d-prompt">物件描述</label>
        <input id="lux3d-prompt" type="text" maxLength={200} value={luxPrompt} disabled={luxPending}
          placeholder="例：一张白色圆桌，极简风格"
          onChange={event => setLuxPrompt(event.target.value)} />
        <label className="sc-field" htmlFor="lux3d-reference">参考图（可选）</label>
        <input id="lux3d-reference" type="file" accept="image/png,image/jpeg" disabled={luxPending}
          onChange={event => { void pickLuxReference(event.target.files?.[0]); event.target.value = ''; }} />
        {luxReference && <p className="sc-note">已选参考图：{luxReference.name}（提交后按照片建模，描述作为补充说明）</p>}
        <button type="button" className="sc-button" disabled={luxPending || !luxPrompt.trim()}
          onClick={() => void submitLux3d()}>{luxPending ? '已提交，生成中…' : '生成物件'}</button>
      </div>
    </div>}
    <div className="sc-section-heading"><div><h2>历史模型</h2><p>已有模型与材质版本仍可使用。</p></div></div>
    {!userId ? <p className="sc-note">请先登录云项目。</p> : <>
      <button type="button" className="sc-button sc-full" onClick={() => { setError(''); setRefresh(value => value + 1); }}>刷新任务状态</button>
      {error && <p className="sc-warning" role="alert">{error}</p>}
      {jobs.length > 0 && <>
        <div className="sc-dimension-grid">{(['width', 'depth', 'height'] as const).map((key, index) =>
          <label className="sc-field" key={key}>{['宽度 / m', '进深 / m', '高度 / m'][index]}<input aria-label={`生成模型${['宽度', '进深', '高度'][index]}`} type="number" min={0.1} max={50} step={0.1}
            value={Number.isFinite(dimensions[key]) ? dimensions[key] : ''} onChange={event => setDimensions(current => ({ ...current, [key]: event.target.valueAsNumber }))}/></label>)}</div>
        <p className="sc-note">尺寸为你设定的场地摆放尺寸，请按实际物料核对。加入后使用云端保存。</p>
        <ul className="sc-generated-tasks">{jobs.map(job => <li key={job.id}>
          <strong>{job.prompt}</strong><span role="status">{labels[job.state]}</span>
          {['ready','added'].includes(job.state)&&job.kind==='texture'&&<button type="button" className="sc-button" disabled={!projectId||cloud.writeBlocked||!onVariantReady} onClick={()=>previewVariant(job)}>预览纹理版本</button>}
          {['ready', 'added'].includes(job.state) && job.kind!=='texture' && <button type="button" className="sc-button" disabled={!projectId || cloud.writeBlocked || disabled || adding !== null || !validSize}
            onClick={() => void add(job)}>{adding === job.id ? '正在加载…' : '加入场地预览'}</button>}
        </li>)}</ul>
      </>}
      {!jobs.length&&<p className="sc-note">暂无历史生成任务。</p>}
    </>}
  </section>;
}
