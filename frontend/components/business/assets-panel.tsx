'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { addAssetToLayout, assetError, assetPreviewScene, validAssetSize,
  type AssetSize, type AuthorizedAsset, type CloudAsset } from '@/lib/assets-api';
import { type BackendSession, useBackendSession } from '@/lib/backend-session';
import { ensureGlbAsset } from '../room-organizer/three/glb-assets';
import { ScenePreview } from './scene-preview';
import type { RoomLayout } from '../room-organizer/lib/types';
import '@/app/assets.css';

interface Props { controller: BackendSession; layout: RoomLayout; onApplyLayout(layout: RoomLayout): void; bound: boolean; busy: boolean }
interface Preview { asset: AuthorizedAsset }
interface RequestContext { userId: string; projectId: string | undefined; generation: number | undefined; version: number }

export function AssetsPanel({ controller, layout, onApplyLayout, bound, busy }: Props): JSX.Element {
  const cloud = useBackendSession(controller);
  const [open, setOpen] = useState(false);
  const [assets, setAssets] = useState<CloudAsset[]>([]);
  const [notice, setNotice] = useState('');
  const [pending, setPending] = useState('');
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [size, setSize] = useState<AssetSize>({ width: 1, depth: 1, height: 1 });
  const layoutRef = useRef(layout); layoutRef.current = layout;
  const running = useRef<symbol | null>(null);
  const userId = cloud.user?.id;
  const key = `${controller.config.apiUrl}:${userId ?? ''}`;
  const scopeKey = `${key}:${cloud.project?.id ?? ''}:${cloud.lease?.generation ?? ''}`;
  const scopeRef = useRef({ key: scopeKey, version: 0 });
  if (scopeRef.current.key !== scopeKey) scopeRef.current = { key: scopeKey, version: scopeRef.current.version + 1 };
  const alive = useRef(true);
  const canAdd = !busy && (!bound || !cloud.writeBlocked);
  const previewProps = useMemo(() => preview && validAssetSize(size) ? {
    scene: assetPreviewScene(preview.asset, size), assetUrls: { [preview.asset.id]: preview.asset.url }, assetNames: { [preview.asset.id]: preview.asset.name },
  } : null, [preview, size]);

  useEffect(() => {
    setAssets([]); setPreview(null); setNotice('');
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
    async function refresh(): Promise<void> {
      setLoading(true);
      try {
        const nextAssets = await controller.businessRequest<CloudAsset[]>('/assets');
        if (!cancelled) setAssets(nextAssets);
      } catch (error) { if (!cancelled) setNotice(`列表刷新失败：${assetError(error)}`); }
      finally { if (!cancelled) setLoading(false); }
    }
    void refresh();
    return () => { cancelled = true; };
  }, [controller, userId, open]);

  async function run(label: string, action: (context: RequestContext) => Promise<void>): Promise<void> {
    if (running.current || busy || !userId) return;
    const context = { userId, projectId: cloud.project?.id, generation: cloud.lease?.generation, version: scopeRef.current.version };
    const request = Symbol(); running.current = request; setPending(label); setNotice('');
    try { await action(context); }
    catch (error) { if (current(context)) setNotice(assetError(error)); }
    finally { if (running.current === request) { running.current = null; if (alive.current) setPending(''); } }
  }
  async function refreshAssets(context: RequestContext): Promise<void> {
    const nextAssets = await controller.businessRequest<CloudAsset[]>('/assets');
    if (current(context)) setAssets(nextAssets);
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

  return <section className="sc-assets" aria-label="个人云素材">
    <button type="button" className="sc-assets-toggle" aria-expanded={open} aria-controls="sc-assets-content" onClick={() => setOpen(value => !value)}>个人云素材 <span aria-hidden="true">{open ? '−' : '+'}</span></button>
    {open && <div id="sc-assets-content">
      {!userId ? <p>请先登录工作室，再查看个人云素材。</p> : <>
        <p className="sc-assets-intro">查看你的云素材。公共模型继续在工作台物料库中挑选。</p>
        <div className="sc-assets-section-heading"><h4>本人云素材</h4><button type="button" disabled={!!pending || busy} onClick={() => void run('刷新素材', refreshAssets)}>刷新素材</button></div>
        {loading && <p role="status">正在更新素材…</p>}
        {!loading && !assets.length && <p>还没有个人云素材。公共模型位于工作台的“物料库”。</p>}
        <ul className="sc-assets-list">{assets.map(asset => <li key={asset.id}><div><strong>{asset.name}</strong><small>{asset.source === 'polyhaven' ? 'Poly Haven' : asset.source} · {asset.format.toUpperCase()} · {(asset.byte_size / 1024 / 1024).toFixed(1)} MB</small></div>
          {asset.format === 'glb' ? <button type="button" disabled={!!pending || busy} onClick={() => void run('加载模型预览', account => loadPreview(asset.id, account))}>预览 {asset.name}</button> : <span>场地底图</span>}
        </li>)}</ul>
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
