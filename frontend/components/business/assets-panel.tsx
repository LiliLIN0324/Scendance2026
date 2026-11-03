'use client';

import { Boxes, Sparkles, Star } from '@/components/solid-icons';
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
type AssetPane = 'mine' | 'saved' | 'library';

export function AssetsPanel({ controller, layout, onApplyLayout, bound, busy }: Props): JSX.Element {
  const cloud = useBackendSession(controller);
  const [pane, setPane] = useState<AssetPane>('library');
  const [favorites, setFavorites] = useState<string[]>([]);
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
  const visibleAssets = useMemo(() => pane === 'mine'
    ? assets.filter(asset => asset.source !== 'polyhaven')
    : pane === 'saved' ? assets.filter(asset => favorites.includes(asset.id)) : assets, [assets, favorites, pane]);

  useEffect(() => {
    setAssets([]); setPreview(null); setNotice(''); setPane('library');
  }, [key]);
  useEffect(() => {
    setPreview(null); setPending(''); running.current = null;
  }, [scopeKey]);
  useEffect(() => {
    setFavorites([]);
    if (!userId) return;
    try {
      const stored = window.localStorage.getItem(`scendance.asset-favorites.v1:${userId}`);
      const parsed = stored ? JSON.parse(stored) : [];
      if (Array.isArray(parsed)) setFavorites(parsed.filter((item): item is string => typeof item === 'string'));
    } catch { /* 收藏不可读时按空收藏处理，不影响物料列表。 */ }
  }, [userId]);
  function toggleFavorite(assetId: string): void {
    setFavorites(current => {
      const next = current.includes(assetId) ? current.filter(id => id !== assetId) : [...current, assetId];
      try { if (userId) window.localStorage.setItem(`scendance.asset-favorites.v1:${userId}`, JSON.stringify(next)); } catch { /* 本地存储不可用时仅当次生效。 */ }
      return next;
    });
  }
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  function current(context: RequestContext): boolean {
    const state = controller.getSnapshot();
    return alive.current && scopeRef.current.version === context.version && state.user?.id === context.userId &&
      state.project?.id === context.projectId && state.lease?.generation === context.generation;
  }

  useEffect(() => {
    if (!userId) return;
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
  }, [controller, userId]);

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
    setNotice(bound?'素材已加入当前画布，可撤销；尚未保存。请使用“保存”提交。':'素材已加入当前画布，可撤销。请留意保存状态。');
  }

  const mineCount = assets.filter(asset => asset.source !== 'polyhaven').length;
  const savedCount = assets.filter(asset => favorites.includes(asset.id)).length;
  const paneCopy = pane === 'mine' ? '我的生成' : pane === 'saved' ? '收藏' : '库';
  return <section className="sc-assets" aria-label="物料">
    <div>
      {!userId ? <p>登录后查看物料。</p> : <>
        <div className="sc-assets-panes" role="tablist" aria-label="物料分类">
          <button type="button" role="tab" className="sc-assets-pane" aria-selected={pane === 'mine'} onClick={() => setPane('mine')}><Sparkles size={15} aria-hidden="true"/><span>我的生成</span><small>{mineCount || '空'}</small></button>
          <button type="button" role="tab" className="sc-assets-pane" aria-selected={pane === 'saved'} onClick={() => setPane('saved')}><Star size={15} aria-hidden="true"/><span>收藏</span><small>{savedCount || '空'}</small></button>
          <button type="button" role="tab" className="sc-assets-pane" aria-selected={pane === 'library'} onClick={() => setPane('library')}><Boxes size={15} aria-hidden="true"/><span>库</span><small>{assets.length || '空'}</small></button>
        </div>
        <div className="sc-assets-section-heading"><h4>{paneCopy}</h4><button type="button" disabled={!!pending || busy} onClick={() => void run('刷新物料', refreshAssets)}>刷新</button></div>
        {loading && <p role="status">正在更新物料…</p>}
        {!loading && !visibleAssets.length && <p>{pane === 'saved' ? '还没有收藏。点条目右侧的星标收藏。' : pane === 'mine' ? '还没有生成物料。' : '还没有物料。'}</p>}
        <ul className="sc-assets-list">{visibleAssets.map(asset => <li key={asset.id}>
          <div><strong>{asset.name}</strong><small>{asset.source === 'polyhaven' ? 'Poly Haven' : asset.source} · {asset.format.toUpperCase()} · {(asset.byte_size / 1024 / 1024).toFixed(1)} MB</small></div>
          <div className="sc-assets-row-actions">
            <button type="button" className="sc-assets-star" aria-label={`${favorites.includes(asset.id) ? '取消收藏' : '收藏'} ${asset.name}`} aria-pressed={favorites.includes(asset.id)} title={favorites.includes(asset.id) ? '取消收藏' : '收藏'} onClick={() => toggleFavorite(asset.id)}><Star size={14} fill={favorites.includes(asset.id) ? 'currentColor' : 'none'} aria-hidden="true"/></button>
            {asset.format === 'glb' ? <button type="button" disabled={!!pending || busy} onClick={() => void run('加载模型预览', account => loadPreview(asset.id, account))}>预览 {asset.name}</button> : <span>场地底图</span>}
          </div>
        </li>)}</ul>
        {preview && <section className="sc-assets-preview" aria-label="三维素材预览">
          <div className="sc-assets-section-heading"><h4>{preview.asset.name}</h4><button type="button" onClick={() => setPreview(null)}>关闭预览</button></div>
          {previewProps && <ScenePreview {...previewProps}/>}
          <p>保留模型原始材质。以下尺寸为加入场地后的实际尺寸，单位为米。</p>
          <div className="sc-assets-dimensions">{([['width', '宽'], ['depth', '深'], ['height', '高']] as const).map(([field, label]) => <label key={field}>{label}（米）<input aria-label={`模型${label}（米）`} type="number" min={field === 'height' ? .01 : .1} max={field === 'height' ? 30 : 50} step="0.01" value={Number.isNaN(size[field]) ? '' : size[field]} onChange={event => setSize(value => ({ ...value, [field]: event.target.value === '' ? NaN : Number(event.target.value) }))}/></label>)}</div>
          <div className="sc-assets-actions"><button type="button" className="sc-assets-primary" disabled={!validAssetSize(size) || !canAdd || !!pending} onClick={() => void run('加入模型', addPreview)}>确认加入当前画布</button><button type="button" disabled={!!pending || busy} onClick={() => void run('更新素材授权', account => loadPreview(preview.asset.id, account))}>重新授权</button></div>
          {!canAdd && <p>当前项目正在操作或尚无编辑权，请获取编辑权后加入。</p>}
          <small>加入位置为场地中央。可在画布移动、复制或撤销；{bound?'加入后仍需保存。':'加入后请核对保存状态，模型保留原引用。'}</small>
        </section>}
      </>}
      {pending && <p role="status">正在{pending}…</p>}
      {notice && <p className="sc-assets-message" role="status">{notice}</p>}
    </div>
  </section>;
}
