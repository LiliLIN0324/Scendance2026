'use client';

import { useEffect, useRef, useState } from 'react';
import { generationIntentFingerprint, assetError, intentStorageKey, readGenerationIntent, saveGenerationIntent, type GenerationIntent } from '@/lib/assets-api';
import { useBackendSession, type BackendSession, type GenerationJob } from '@/lib/backend-session';
import { createGlbCatalogItem, ensureGlbAsset } from '../three/glb-assets';
import type { GenerationRequest, generationCapabilities } from '../../../../supabase/functions/_shared/generation-contract';
import type { CatalogItem } from '../lib/types';

const labels: Record<GenerationJob['state'], string> = {
  queued: '等待生成', submitting: '正在提交', submitted: '已提交', processing: '正在生成',
  archiving: '正在保存模型', ready: '模型已就绪', added: '已保存到场地', failed: '生成失败',
  rejected: '模型未通过检查', submit_unknown: '提交结果待核对，请联系管理员',
};
const activeStates = new Set<GenerationJob['state']>(['queued', 'submitting', 'submitted', 'processing', 'archiving']);
export interface ModelGenerationSeed { id: string; scope: string; userId: string; projectId: string; apiUrl: string; name: string; prompt: string }
type Intent = GenerationIntent & { storage: 'local' | 'session' };
function persistedIntent(value:Intent):GenerationIntent {
  return {requestId:value.requestId,prompt:value.prompt,...(value.kind?{kind:value.kind}:{}),...(value.referenceImageAssetId?{referenceImageAssetId:value.referenceImageAssetId}:{}),...(value.sourceAssetId?{sourceAssetId:value.sourceAssetId}:{})};
}
const storageKey = (user: string) => `scendance:3d-intent:${user}`;
function message(error: unknown): string {
  const code = error instanceof Error && 'code' in error ? error.code : '';
  if (code === 'SERVICE_NOT_CONFIGURED' || code === 'BILLING_NOT_CONFIGURED') return '3D 生成服务尚未开通，请联系管理员。';
  if (code === 'BUDGET_EXCEEDED') return '3D 生成累计额度已用完，请联系管理员。';
  return assetError(error);
}

export interface TextureVariantReady { sourceAssetId:string;variantAssetId:string;objectIds?:string[] }
export interface GenerationTarget { sourceAssetId?:string;sourceObjectIds?:string[];onVariantReady?(variant:TextureVariantReady):void }
export function GeneratedModelLibrary({ controller, disabled = false, onAdd, seed, ...target }: {
  controller?: BackendSession; disabled?: boolean; onAdd(item: CatalogItem): void; seed?: ModelGenerationSeed | undefined;
} & GenerationTarget): JSX.Element {
  return controller ? <ScopedGeneration controller={controller} disabled={disabled} onAdd={onAdd} seed={seed} {...target}/>
    : <p className="sc-note">连接云项目后可生成单件 3D 模型。</p>;
}

interface ConnectedProps extends GenerationTarget { controller: BackendSession; disabled: boolean; onAdd(item: CatalogItem): void; seed?: ModelGenerationSeed | undefined }
function ScopedGeneration(props: ConnectedProps): JSX.Element {
  const cloud=useBackendSession(props.controller);
  return <ConnectedGeneration key={`${props.controller.config.apiUrl}:${cloud.user?.id}:${cloud.project?.id}`} {...props}/>;
}
function ConnectedGeneration({ controller, disabled, onAdd, seed, sourceAssetId, sourceObjectIds, onVariantReady }: ConnectedProps): JSX.Element {
  const cloud = useBackendSession(controller);
  const userId = cloud.user?.id;
  const projectId = cloud.project?.id;
  const apiUrl = controller.config.apiUrl;
  const key = userId ? intentStorageKey(apiUrl, userId) : '';
  const [prompt, setPrompt] = useState('');
  const [kind,setKind]=useState<GenerationRequest['kind']>('text');
  const [reference,setReference]=useState<{id:string;name:string}>();
  const [uploading,setUploading]=useState(false);
  const [capabilities,setCapabilities]=useState<ReturnType<typeof generationCapabilities>>();
  const [storageReady, setStorageReady] = useState(false);
  const [pendingSeed, setPendingSeed] = useState<ModelGenerationSeed>();
  const handledSeed = useRef<string>();
  const [intents, setIntents] = useState<Intent[]>([]);
  const intent = intents[0] ?? null;
  const [storageError, setStorageError] = useState('');
  const [recovery, setRecovery] = useState(0);
  const [jobs, setJobs] = useState<GenerationJob[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [rejectedInput,setRejectedInput]=useState<string>();
  const [adding, setAdding] = useState<string | null>(null);
  const [dimensions, setDimensions] = useState({ width: 1, depth: 1, height: 1 });
  const [refresh, setRefresh] = useState(0);
  const lock = useRef(false);
  const latest = useRef({ userId, projectId, apiUrl, disabled, writeBlocked: cloud.writeBlocked, onAdd, onVariantReady, sourceAssetId, sourceObjectIds });
  latest.current = { userId, projectId, apiUrl, disabled, writeBlocked: cloud.writeBlocked, onAdd, onVariantReady, sourceAssetId, sourceObjectIds };
  const mounted = useRef(true);
  const marked = useRef(new Set<string>());
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  useEffect(()=>{
    if(!userId)return;let alive=true;
    controller.getGenerationCapabilities().then(value=>{if(alive)setCapabilities(value);}).catch(failure=>{if(alive)setError(message(failure));});
    return()=>{alive=false;};
  },[controller,userId,refresh]);

  useEffect(() => {
    setJobs([]); setError('');
    marked.current.clear();
  }, [userId, apiUrl]);

  useEffect(() => {
    setIntents([]); setPrompt(''); setStorageError(''); setStorageReady(false);
    if (!userId) return;
    try {
      const local = readGenerationIntent(localStorage, key);
      const session = readGenerationIntent(sessionStorage, storageKey(userId));
      if (local && session && local.requestId === session.requestId && generationIntentFingerprint(local) !== generationIntentFingerprint(session)) throw new Error('两个已保存请求的编号相同但内容不一致。请联系管理员核对后恢复存储，暂不能提交生成。');
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
    finally { setStorageReady(true); }
  }, [userId, key, recovery]);

  useEffect(() => {
    if (!seed || !storageReady || handledSeed.current === seed.id || seed.userId !== userId || seed.projectId !== projectId || seed.apiUrl !== apiUrl) return;
    handledSeed.current = seed.id;
    if (!prompt.trim() && kind==='text' && !reference && !intent && !storageError && !busy) setPrompt(seed.prompt);
    else setPendingSeed(seed);
  }, [seed, storageReady, userId, projectId, apiUrl, prompt, kind, reference, intent, storageError, busy]);

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

  async function upload(file:File|undefined){
    if(!file||uploading||intent||busy)return;
    setUploading(true);setError('');
    try {
      if(!['image/png','image/jpeg'].includes(file.type)||file.size>5*1024*1024)throw new Error('请上传不超过 5 MB 的 PNG 或 JPEG 参考图。');
      const result=await controller.uploadGenerationReference(file);
      if(mounted.current&&latest.current.userId===userId&&latest.current.projectId===projectId)setReference({id:result.id,name:file.name});
    } catch(failure){if(mounted.current)setError(message(failure));}
    finally {if(mounted.current)setUploading(false);}
  }
  const mode=intent?(intent.kind??'text'):kind;
  const available=mode==='text'?capabilities?.textToModel:mode==='image'?capabilities?.imageToModel:capabilities?.texture;
  const ready=!!available&&(mode==='text'||!!(intent?.referenceImageAssetId??reference?.id))&&(mode!=='texture'||!!(intent?.sourceAssetId??sourceAssetId));

  async function generate() {
    if (!userId || uploading || (!intent&&!ready) || lock.current || storageError || (!intent && !prompt.trim())) return;
    lock.current = true; setBusy(true); setError('');
    const next: Intent = intent ?? { requestId: crypto.randomUUID(), prompt: prompt.trim(), ...(kind==='text'?{}:{kind,referenceImageAssetId:reference!.id,...(kind==='texture'?{sourceAssetId}:{})}), storage: 'local' };
    try {
      // Persist before dispatch; after an uncertain response, explicit retry keeps the same ID.
      try { saveGenerationIntent(next.storage === 'local' ? localStorage : sessionStorage, next.storage === 'local' ? key : storageKey(userId), persistedIntent(next)); }
      catch (failure) { setStorageError(message(failure)); return; }
      if (!intent) setIntents([next]);
      const job = await (next.kind&&next.kind!=='text'?controller.createGenerationJob(next.prompt,next.requestId,{kind:next.kind,referenceImageAssetId:next.referenceImageAssetId,sourceAssetId:next.sourceAssetId}):controller.createGenerationJob(next.prompt, next.requestId));
      let storageFailure = '';
      try {
        for (const completed of (intent ? intents : [next]).filter(value => value.requestId === next.requestId)) {
          const storage = completed.storage === 'local' ? localStorage : sessionStorage;
          const completedKey = completed.storage === 'local' ? key : storageKey(userId);
          // Record the acknowledged job before cleanup so a failed removal cannot resubmit it.
          saveGenerationIntent(storage, completedKey, { ...persistedIntent(completed), jobId: job.id });
          storage.removeItem(completedKey);
        }
      } catch (failure) { storageFailure = message(failure); }
      if (!mounted.current || latest.current.userId !== userId || latest.current.apiUrl !== apiUrl) return;
      setStorageError(storageFailure);
      setIntents(current => current.filter(value => value.requestId !== next.requestId));
      setPrompt(''); setReference(undefined); setJobs(current => [job, ...current.filter(item => item.id !== job.id)]);
      setRefresh(value => value + 1);
    } catch (failure) {
      if (mounted.current && latest.current.userId === userId && latest.current.apiUrl === apiUrl) {
        const code=failure&&typeof failure==='object'&&'code' in failure?String(failure.code):'';
        const rejected=!intent&&['INVALID_REFERENCE_IMAGE','SOURCE_UV_REQUIRED','INVALID_SOURCE_MODEL','REFERENCE_IMAGE_FORBIDDEN','VALIDATION_ERROR'].includes(code);
        if(rejected)setRejectedInput(next.requestId);
        setError(`${message(failure)} ${rejected?'输入未通过检查，尚未创建生成任务。':'如需重试，将继续核对同一项请求。'}`);
      }
    } finally { lock.current = false; if (mounted.current) setBusy(false); }
  }

  function editRejectedInput(){
    if(!intent||intent.requestId!==rejectedInput||busy)return;
    try {
      localStorage.removeItem(key);
      if(localStorage.getItem(key)!==null)throw new Error('无法清除未提交请求，请检查本地存储。');
      setIntents([]);setRejectedInput(undefined);setError('');
    } catch(failure){setStorageError(message(failure));}
  }

  function previewVariant(job:GenerationJob){
    if(!job.asset_id||!job.source_asset_id||!onVariantReady||disabled||cloud.writeBlocked)return;
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

  const validSize = Object.values(dimensions).every(value => Number.isFinite(value) && value >= 0.1 && value <= 50);
  return <section className="sc-generated-models" aria-label="生成 3D 模型">
    <div className="sc-section-heading"><div><h2>生成单件 3D 模型</h2><p>由腾讯 {capabilities?.model==='hy-3d-3.1'?'HY-3D-3.1':'HY-3D-3.0'} 生成单件物料，完成后可预览或保存为独立版本。</p></div></div>
    {!userId ? <p className="sc-note">请先登录云项目。</p> : <>
      {pendingSeed && <aside className="cr-model-suggestion" aria-label="Binggo 生成建议"><strong>{pendingSeed.name}</strong><p>{pendingSeed.prompt}</p><p>{intent ? '请先核对已有请求；建议不会替换待确认的生成任务。' : '当前生成草稿已保留，请确认是否改用这条建议。'}</p><button type="button" className="sc-button" disabled={busy || !!intent || !!storageError} onClick={() => { setKind('text'); setReference(undefined); setPrompt(pendingSeed.prompt); setPendingSeed(undefined); }}>{prompt.trim() ? '用此建议替换草稿' : '使用此生成描述'}</button><button type="button" className="sc-button" onClick={() => setPendingSeed(undefined)}>保留原草稿</button></aside>}
      <label className="sc-field">生成方式<select aria-label="生成方式" value={mode} disabled={busy||uploading||!!intent||!!storageError} onChange={event=>{setKind(event.target.value as GenerationRequest['kind']);setReference(undefined);}}>
        <option value="text" disabled={!capabilities?.textToModel}>文字生成</option><option value="image" disabled={!capabilities?.imageToModel}>参考图生成</option><option value="texture" disabled={!capabilities?.texture}>现有模型纹理</option>
      </select></label>
      {mode!=='text'&&<><label className="sc-field">参考图<input aria-label="模型参考图" type="file" accept="image/png,image/jpeg" disabled={busy||uploading||!!intent||!!storageError} onChange={event=>void upload(event.target.files?.[0])}/></label><p className="sc-note">{uploading?'正在上传参考图…':intent?.referenceImageAssetId?'已保留原请求参考图':reference?.name??'请上传完整显示主体的 PNG / JPEG；纹理模式使用材质参考图。'}</p></>}
      {mode==='texture'&&<p className="sc-note">{(intent?.sourceAssetId??sourceAssetId)?'将为选定模型创建独立纹理版本，验收后再预览应用。':'请先在场景中选择一个资源库模型。'}</p>}
      {!capabilities?.texture&&capabilities&&<p className="sc-note">纹理生成尚未开通；可先在场景策划中调整选中模型的材质参数。</p>}
      {mode!=='text'&&<p className="sc-note">下方描述用于识别任务；模型生成依据上传的参考图。</p>}
      <label className="sc-field">物料描述<textarea aria-label="物料描述" maxLength={1024} rows={3} value={intent?.prompt ?? prompt}
        disabled={busy || intent !== null || !!storageError} onChange={event => setPrompt(event.target.value)} placeholder="例如：一把绿色藤编休闲椅，独立物件，无背景"/></label>
      <p className="sc-note">每次生成会使用账号额度。失败或结果待核对时，额度可能仍被消耗。</p>
      <button type="button" className="sc-button sc-full" disabled={busy || uploading || adding !== null || !!storageError || (!intent && (!prompt.trim()||!ready))}
        onClick={() => void generate()}>{busy ? '正在提交…' : intent ? '核对并继续同一请求' : '生成 3D 模型'}</button>
      {intents.length > 1 && <p className="sc-note">有 {intents.length} 项未确认请求，将逐项核对原请求，完成前不能新建需求。</p>}
      {storageError && <><p className="sc-warning" role="alert">{storageError} 请核对云端任务并恢复浏览器存储，再重新读取生成请求。</p><button type="button" className="sc-button sc-full" disabled={busy || adding !== null} onClick={() => setRecovery(value => value + 1)}>重新读取生成请求</button></>}
      <button type="button" className="sc-button sc-full" onClick={() => { setError(''); setRefresh(value => value + 1); }}>刷新任务状态</button>
      {error && <p className="sc-warning" role="alert">{error}</p>}
      {rejectedInput===intent?.requestId&&rejectedInput&&<button type="button" className="sc-button" disabled={busy} onClick={editRejectedInput}>修改未通过检查的输入</button>}
      {jobs.length > 0 && <>
        <div className="sc-dimension-grid">{(['width', 'depth', 'height'] as const).map((key, index) =>
          <label className="sc-field" key={key}>{['宽度 / m', '进深 / m', '高度 / m'][index]}<input aria-label={`生成模型${['宽度', '进深', '高度'][index]}`} type="number" min={0.1} max={50} step={0.1}
            value={Number.isFinite(dimensions[key]) ? dimensions[key] : ''} onChange={event => setDimensions(current => ({ ...current, [key]: event.target.valueAsNumber }))}/></label>)}</div>
        <p className="sc-note">尺寸为你设定的场地摆放尺寸，请按实际物料核对。加入后使用云端保存。</p>
        <ul className="sc-generated-tasks">{jobs.map(job => <li key={job.id}>
          <strong>{job.prompt}</strong><span role="status">{labels[job.state]}</span>
          {['ready','added'].includes(job.state)&&job.kind==='texture'&&<button type="button" className="sc-button" disabled={!projectId||cloud.writeBlocked||disabled||!onVariantReady} onClick={()=>previewVariant(job)}>预览纹理版本</button>}
          {['ready', 'added'].includes(job.state) && job.kind!=='texture' && <button type="button" className="sc-button" disabled={!projectId || cloud.writeBlocked || disabled || busy || adding !== null || !validSize}
            onClick={() => void add(job)}>{adding === job.id ? '正在加载…' : '加入场地预览'}</button>}
        </li>)}</ul>
      </>}
    </>}
  </section>;
}
