'use client';

import { useEffect, useRef, useState } from 'react';
import { Box, FileImage, Type } from '@/components/solid-icons';
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
// An ambiguous submission stays submit_unknown only until the backend grace window ends; the worker
// then turns it into failed (SUBMIT_RESULT_UNKNOWN_EXPIRED) and the member can generate again. While
// that window is open the status read repeats so the release becomes visible without a manual refresh;
// older rows are terminal and never read again. No state here resubmits a generation.
const ambiguousGraceMs = 11 * 60_000;
const awaitingRelease = (job: GenerationJob) => job.state === 'submit_unknown'
  && Date.now() - Date.parse(job.updated_at) < ambiguousGraceMs;
const message = assetError;
type GenerationMode = 'text' | 'image';
type GenerationEngine = 'hy3d' | 'aholo';
const engineLabel = (engine: GenerationEngine) => engine === 'aholo' ? 'Aholo Lux3D' : 'HY-3D';
/** 网络失败不把“Failed to fetch”原样甩给用户。 */
function plainFailure(failure: unknown): string {
  const raw = failure instanceof Error ? failure.message : '';
  if (/failed to fetch|networkerror|load failed|network request failed/i.test(raw)) return '连不上云端，请检查网络后再试。';
  return message(failure);
}
const engineSupports = (capabilities: GenerationCapabilities | null, engine: GenerationEngine, mode: GenerationMode): boolean => {
  if (!capabilities) return false;
  return engine === 'aholo'
    ? (mode === 'image' ? capabilities.aholoImageToModel : capabilities.aholoTextToModel)
    : (mode === 'image' ? capabilities.imageToModel : capabilities.textToModel);
};
const modeSupports = (capabilities: GenerationCapabilities | null, mode: GenerationMode): boolean =>
  engineSupports(capabilities, 'hy3d', mode) || engineSupports(capabilities, 'aholo', mode);
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
  const [capabilityState, setCapabilityState] = useState<'idle' | 'loading' | 'ready' | 'failed'>('idle');
  const [genPrompt, setGenPrompt] = useState('');
  const [genPending, setGenPending] = useState(false);
  const [genReference, setGenReference] = useState<{ id: string; name: string } | null>(null);
  const [mode, setMode] = useState<GenerationMode>('text');
  const [engine, setEngine] = useState<GenerationEngine>('hy3d');
  const lock = useRef(false);
  const latest = useRef({ userId, projectId, disabled, writeBlocked: cloud.writeBlocked, onAdd });
  latest.current = { userId, projectId, disabled, writeBlocked: cloud.writeBlocked, onAdd };
  const mounted = useRef(true), marked = useRef(new Set<string>());
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (!userId) { setCapabilities(null); setCapabilityState('idle'); return; }
    let alive = true;
    setCapabilityState('loading');
    controller.getGenerationCapabilities().then(value => {
      if (!alive) return;
      setCapabilities(value);
      setCapabilityState('ready');
    }).catch(() => {
      if (!alive) return;
      setCapabilities(null);
      setCapabilityState('failed');
    });
    return () => { alive = false; };
  }, [controller, userId]);
  const hy3dConfigured = Boolean(capabilities && (capabilities.textToModel || capabilities.imageToModel));
  const aholoConfigured = Boolean(capabilities && (capabilities.aholoTextToModel || capabilities.aholoImageToModel));
  useEffect(() => {
    if (!capabilities || engineSupports(capabilities, engine, mode)) return;
    const other: GenerationEngine = engine === 'hy3d' ? 'aholo' : 'hy3d';
    if (engineSupports(capabilities, other, mode)) setEngine(other);
  }, [capabilities, engine, mode]);
  useEffect(() => {
    if (capabilities && !modeSupports(capabilities, mode) && modeSupports(capabilities, 'text')) setMode('text');
  }, [capabilities, mode]);
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
        if (result.some(job => activeStates.has(job.state) || awaitingRelease(job))) timer = setTimeout(() => void read(), 30_000);
      } catch (failure) { if (alive) setError(plainFailure(failure)); }
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
    } catch (failure) { if (mounted.current && latest.current.userId === userId) setError(plainFailure(failure)); }
    finally { lock.current = false; if (mounted.current) setAdding(null); }
  }

  async function submitGeneration() {
    const prompt = genPrompt.trim();
    if (!userId || disabled || cloud.writeBlocked || genPending || !prompt || lock.current) return;
    if (mode === 'image' && !genReference) return;
    if (!engineSupports(capabilities, engine, mode)) return;
    lock.current = true; setGenPending(true); setError('');
    try {
      // HY-3D is the server's default lane, so its choice is sent as no provider; Aholo is declared.
      const provider = engine === 'aholo' ? { provider: 'aholo' as const } : {};
      await controller.createGenerationJob(prompt, crypto.randomUUID(), mode === 'image' && genReference
        ? { kind: 'image', referenceImageAssetId: genReference.id, ...provider }
        : { kind: 'text', ...provider });
      setGenPrompt(''); setGenReference(null); setRefresh(value => value + 1);
    } catch (failure) { if (mounted.current) setError(plainFailure(failure)); }
    finally { lock.current = false; if (mounted.current) setGenPending(false); }
  }

  function changeMode(next: GenerationMode) {
    if (!modeSupports(capabilities, next)) return;
    setMode(next);
    if (next === 'text') setGenReference(null);
    setError('');
  }

  async function pickReference(file: File | undefined) {
    if (!file) return;
    setError('');
    try {
      const uploaded = await controller.uploadGenerationReference(file);
      setGenReference({ id: uploaded.id, name: file.name });
    } catch (failure) { if (mounted.current) setError(plainFailure(failure instanceof Error && /5 MB/.test(failure.message) ? failure.message : failure)); }
  }

  const validSize = Object.values(dimensions).every(value => Number.isFinite(value) && value >= 0.1 && value <= 50);
  const engineSupportsMode = engineSupports(capabilities, engine, mode);
  const anyConfigured = hy3dConfigured || aholoConfigured;
  const generationBlocked = !userId
    ? '登录云项目后即可生成物件。'
    : capabilityState === 'loading' || capabilityState === 'idle'
      ? '正在读取可用的生成模型…'
      : capabilityState === 'failed'
        ? '暂时连不上云端，没读到可用的生成模型。'
        : !anyConfigured
          ? '当前账号还没有开通可用的生成模型。'
          : disabled
            ? '当前有其他操作在进行，暂时不能提交生成。'
            : cloud.writeBlocked
              ? '当前项目是只读状态。点左下角头像，在这个项目上按「开始编辑」拿到编辑权。'
              : '';
  const engineStatus = (key: GenerationEngine, enabled: boolean) => {
    if (!userId) return '登录后可用';
    if (capabilityState === 'loading' || capabilityState === 'idle') return '读取中…';
    if (capabilityState === 'failed') return '暂不可用';
    const configured = key === 'aholo' ? aholoConfigured : hy3dConfigured;
    if (!configured) return '未开通';
    return enabled ? (mode === 'image' ? '图片生成' : '文字生成') : '不支持此方式';
  };
  const modeStatus = (next: GenerationMode) => {
    if (!userId) return '登录后可用';
    if (capabilityState === 'loading' || capabilityState === 'idle') return '读取中…';
    if (capabilityState === 'failed' || !modeSupports(capabilities, next)) return '未开通';
    return next === 'image' ? '上传一张照片' : '写一句描述';
  };
  return <section className="sc-generated-models" aria-label="物料生成与历史模型">
    <div className="sc-generation-form" role="group" aria-label="物料生成">
      <p className="sc-generation-intro">先选生成方式，再选模型。文字写描述，图片上传一张参考照片。</p>
      {generationBlocked && <p className="sc-note" role="status">{generationBlocked}</p>}
      <p className="sc-generation-label">生成方式</p>
      <div className="sc-generation-modes" role="group" aria-label="生成方式">
        <button type="button" aria-pressed={mode === 'text'} disabled={genPending || Boolean(generationBlocked) || !modeSupports(capabilities, 'text')}
          onClick={() => changeMode('text')}><Type size={16} aria-hidden="true"/><strong>文字生成</strong><span>{modeStatus('text')}</span></button>
        <button type="button" aria-pressed={mode === 'image'} disabled={genPending || Boolean(generationBlocked) || !modeSupports(capabilities, 'image')}
          onClick={() => changeMode('image')}><FileImage size={16} aria-hidden="true"/><strong>图片生成</strong><span>{modeStatus('image')}</span></button>
      </div>
      <p className="sc-generation-label">模型</p>
      <div className="sc-generation-engines" role="radiogroup" aria-label="生成模型">
        {(['hy3d', 'aholo'] as const).map(key => {
          const enabled = engineSupports(capabilities, key, mode);
          return <button type="button" role="radio" aria-checked={engine === key} key={key}
            className={`sc-engine${engine === key ? ' is-on' : ''}`} disabled={genPending || Boolean(generationBlocked) || !enabled}
            onClick={() => setEngine(key)}>
            <strong>{engineLabel(key)}</strong>
            <span>{engineStatus(key, enabled)}</span>
          </button>;
        })}
      </div>
      {engine === 'aholo' && <AholoGuideCard surface="library" />}
      {capabilityState === 'ready' && !engineSupportsMode && <p className="sc-note">{engineLabel(engine)} 暂未开通{mode === 'image' ? '图片' : '文字'}生成。{modeSupports(capabilities, mode) ? '请换一个模型。' : ''}</p>}
      {mode === 'image' ? <>
        <label className="sc-field" htmlFor="generation-reference">参考图
          <input id="generation-reference" type="file" accept="image/png,image/jpeg" disabled={genPending || Boolean(generationBlocked)}
            onChange={event => { void pickReference(event.target.files?.[0]); event.target.value = ''; }} />
        </label>
        {genReference ? <p className="sc-note">已选参考图：{genReference.name}</p> : <p className="sc-note">需要一张主体清楚、背景干净的照片。</p>}
        <label className="sc-field" htmlFor="generation-prompt">补充描述
          <input id="generation-prompt" type="text" maxLength={200} value={genPrompt} disabled={genPending || Boolean(generationBlocked)}
            placeholder="例：按照片做同款，哑光白桌面"
            onChange={event => setGenPrompt(event.target.value)} />
        </label>
      </> : <label className="sc-field" htmlFor="generation-prompt">物件描述
        <input id="generation-prompt" type="text" maxLength={200} value={genPrompt} disabled={genPending || Boolean(generationBlocked)}
          placeholder="例：一张白色圆桌，极简风格"
          onChange={event => setGenPrompt(event.target.value)} />
      </label>}
      <button type="button" className="sc-button" disabled={genPending || Boolean(generationBlocked) || !genPrompt.trim() || (mode === 'image' && !genReference) || !engineSupportsMode}
        onClick={() => void submitGeneration()}>{genPending ? '已提交，生成中…' : '生成物件'}</button>
    </div>
    <div className="sc-section-heading"><div><h2>历史模型</h2><p>已有模型与材质版本仍可使用。</p></div></div>
    {!userId ? <p className="sc-note">登录云项目后可以查看历史模型。</p> : <>
      <button type="button" className="sc-button sc-full" onClick={() => { setError(''); setRefresh(value => value + 1); }}>刷新任务状态</button>
      {error && <p className="sc-warning" role="alert">{error}</p>}
      {jobs.length > 0 && <>
        <div className="sc-dimension-grid">{(['width', 'depth', 'height'] as const).map((key, index) =>
          <label className="sc-field" key={key}>{['宽度 / m', '进深 / m', '高度 / m'][index]}<input aria-label={`生成模型${['宽度', '进深', '高度'][index]}`} type="number" min={0.1} max={50} step={0.1}
            value={Number.isFinite(dimensions[key]) ? dimensions[key] : ''} onChange={event => setDimensions(current => ({ ...current, [key]: event.target.valueAsNumber }))}/></label>)}</div>
        <p className="sc-note">尺寸为你设定的场地摆放尺寸，请按实际物料核对。加入后使用云端保存。</p>
        <ul className="sc-generated-tasks">{jobs.map(job => <li className="sc-generated-card" key={job.id}>
          <span className="sc-generated-thumb" aria-hidden="true"><Box size={18}/></span>
          <span className="sc-generated-body"><strong>{job.prompt}</strong><span role="status">{labels[job.state]}</span></span>
          {['ready','added'].includes(job.state)&&job.kind==='texture'&&<button type="button" className="sc-button" disabled={!projectId||cloud.writeBlocked||!onVariantReady} onClick={()=>previewVariant(job)}>预览纹理版本</button>}
          {['ready', 'added'].includes(job.state) && job.kind!=='texture' && <button type="button" className="sc-button" disabled={!projectId || cloud.writeBlocked || disabled || adding !== null || !validSize}
            onClick={() => void add(job)}>{adding === job.id ? '正在加载…' : '加入场地预览'}</button>}
        </li>)}</ul>
      </>}
      {!jobs.length&&<p className="sc-note">暂无历史生成任务。</p>}
    </>}
  </section>;
}
