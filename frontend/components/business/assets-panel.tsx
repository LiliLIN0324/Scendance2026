'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Star } from '@/components/solid-icons';
import { addAssetToLayout, assetBytesLabel, assetError, assetLicenseLabel, assetPreviewScene, assetPrompt, assetSourceLabel, validAssetSize,
  type AssetSize, type AuthorizedAsset, type CloudAsset } from '@/lib/assets-api';
import { type BackendSession, useBackendSession } from '@/lib/backend-session';
import { generatedAssetName } from '../room-organizer/lib/generated-material-cards';
import { ensureGlbAsset } from '../room-organizer/three/glb-assets';
import { ScenePreview } from './scene-preview';
import type { RoomLayout } from '../room-organizer/lib/types';
import '@/app/assets.css';

interface Props { controller: BackendSession; layout: RoomLayout; onApplyLayout(layout: RoomLayout): void; bound: boolean; busy: boolean }
interface Preview { asset: AuthorizedAsset; cloud?: CloudAsset }
interface RequestContext { userId: string; projectId: string | undefined; generation: number | undefined; version: number }
type AssetPane = 'mine' | 'saved' | 'library';

/** 只用物料自己带的预览地址。没有就留空，不画通用椅子，也不请求不存在的缩略图路由。 */
function storedPreview(asset: CloudAsset): string | undefined {
  const meta = asset.metadata;
  if (!meta) return undefined;
  for (const value of [meta.previewUrl, meta.preview_url, meta.thumbnail, meta.thumbnail_url, meta.preview_image_url]) {
    if (typeof value === 'string' && /^https?:\/\//.test(value)) return value;
  }
  return undefined;
}

function assetMeta(asset: CloudAsset): string {
  return `${assetSourceLabel(asset.source)} · ${asset.format.toUpperCase()} · ${assetBytesLabel(asset.byte_size)}`;
}

function createdLabel(value: string | undefined): string {
  if (!value) return '未记录';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN', { hour12: false });
}

/** 物料护照：来源、文件、时间、授权，以及生成时到底写了什么。 */
function AssetFacts({ asset }: { asset: CloudAsset }): JSX.Element {
  const description = assetPrompt(asset);
  const displayName = generatedAssetName(asset).trim();
  return <div className="sc-assets-facts">
    <dl>
      <div><dt>来源</dt><dd>{assetSourceLabel(asset.source)}</dd></div>
      <div><dt>文件</dt><dd>{asset.format.toUpperCase()} · {assetBytesLabel(asset.byte_size)}</dd></div>
      <div><dt>创建</dt><dd>{createdLabel(asset.created_at)}</dd></div>
      <div><dt>授权</dt><dd>{assetLicenseLabel(asset)}</dd></div>
    </dl>
    {description && description !== displayName && <div className="sc-assets-prompt">
      <strong>生成描述</strong>
      <p>{description}</p>
    </div>}
  </div>;
}

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
  // 「库」页签按可见性分三段：公共目录（已发布，注册用户可取用）、团队物料（同室已审核）、我的物料（私有/项目引用）。
  const publicAssets = useMemo(() => assets.filter(asset => Boolean(asset.published_at)), [assets]);
  const teamAssets = useMemo(() => assets.filter(asset => !asset.published_at && Boolean(asset.team_studio_id)), [assets]);
  const privateAssets = useMemo(() => assets.filter(asset => !asset.published_at && !asset.team_studio_id), [assets]);
  function renderAsset(asset: CloudAsset): JSX.Element {
    const row = { asset, favorite: favorites.includes(asset.id), pending: !!pending || busy, onToggleFavorite: () => toggleFavorite(asset.id) };
    // 只有物主能决定公开与否；别人看不到它也就无从发布。
    const canPublish = asset.format === 'glb' && asset.owner_id === userId;
    const studioId = cloud.project?.studio_id;
    // 物主可以把自己的 3D 物料提交进当前所在工作室的团队库，等待负责人审核。
    const canSubmitTeam = asset.format === 'glb' && asset.owner_id === userId &&
      !asset.published_at && !asset.team_studio_id && Boolean(studioId);
    const publishRow = { ...row, published: Boolean(asset.published_at), canPublish,
      onTogglePublish: () => { void run('更新公开状态', account => togglePublish(asset, account)); },
      canSubmitTeam, onSubmitTeam: () => { void run('提交团队库', account => submitToTeam(asset, account)); } };
    return asset.format === 'glb'
      ? <AssetRow key={asset.id} {...publishRow} onPreview={() => { void run('加载模型预览', account => loadPreview(asset.id, account)); }} />
      : <AssetRow key={asset.id} {...publishRow} />;
  }

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
  /** 公开物料：放进公共目录后，任何注册用户都能在物料库看到并取用。撤下同理。 */
  async function togglePublish(asset: CloudAsset, context: RequestContext): Promise<void> {
    const published = Boolean(asset.published_at);
    await controller.businessRequest(`/assets/${encodeURIComponent(asset.id)}/publish`, published ? 'DELETE' : 'POST');
    await refreshAssets(context);
    if (current(context)) {
      setNotice(published ? '已从公共物料库撤下，其他人看不到了。' : '已放进公共物料库，任何注册用户都能看到并取用。');
    }
  }
  /** 提交到当前工作室的团队库：待审状态只有物主自己能在团队列表看到，审核通过后同室可取用。 */
  async function submitToTeam(asset: CloudAsset, context: RequestContext): Promise<void> {
    const studioId = cloud.project?.studio_id;
    if (!studioId) return;
    await controller.businessRequest(`/assets/${encodeURIComponent(asset.id)}/team`, 'POST', { studioId });
    await refreshAssets(context);
    if (current(context)) setNotice('已提交到团队库，等待负责人审核通过后同室成员才能取用。');
  }
  async function loadPreview(assetId: string, context: RequestContext): Promise<void> {
    const authorized = await controller.authorizeAsset(assetId);
    const metadata = assets.find(asset => asset.id === assetId);
    const asset = { ...authorized, source: metadata?.source ?? 'hunyuan' };
    await ensureGlbAsset(asset.id, asset.url);
    if (!current(context)) return;
    setSize(metadata?.metadata?.sourceSize && validAssetSize(metadata.metadata.sourceSize) ? metadata.metadata.sourceSize : { width: 1, depth: 1, height: 1 });
    setPreview({ asset, ...(metadata ? { cloud: metadata } : {}) });
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
          <button type="button" role="tab" className="sc-assets-pane" aria-selected={pane === 'mine'} onClick={() => setPane('mine')}><span>我的生成</span><small>{mineCount || '空'}</small></button>
          <button type="button" role="tab" className="sc-assets-pane" aria-selected={pane === 'saved'} onClick={() => setPane('saved')}><span>收藏</span><small>{savedCount || '空'}</small></button>
          <button type="button" role="tab" className="sc-assets-pane" aria-selected={pane === 'library'} onClick={() => setPane('library')}><span>库</span><small>{assets.length || '空'}</small></button>
        </div>
        <div className="sc-assets-section-heading"><h4>{paneCopy}</h4><button type="button" disabled={!!pending || busy} onClick={() => void run('刷新物料', refreshAssets)}>刷新</button></div>
        {loading && <p role="status">正在更新物料…</p>}
        {!loading && !visibleAssets.length && <p>{pane === 'saved' ? '还没有收藏。点条目右侧的星标收藏。' : pane === 'mine' ? '还没有生成物料。' : '还没有物料。项目里引用的物料，打开对应项目时可见。'}</p>}
        {pane === 'library' ? (
          <>
            {publicAssets.length > 0 && <section className="sc-assets-group">
              <div className="sc-assets-section-heading"><h4>公共目录</h4></div>
              <ul className="sc-assets-list">{publicAssets.map(renderAsset)}</ul>
            </section>}
            {teamAssets.length > 0 && <section className="sc-assets-group">
              <div className="sc-assets-section-heading"><h4>团队物料</h4></div>
              <ul className="sc-assets-list">{teamAssets.map(renderAsset)}</ul>
            </section>}
            {privateAssets.length > 0 && <section className="sc-assets-group">
              <div className="sc-assets-section-heading"><h4>我的物料</h4></div>
              <ul className="sc-assets-list">{privateAssets.map(renderAsset)}</ul>
            </section>}
          </>
        ) : (
          <ul className="sc-assets-list">{visibleAssets.map(renderAsset)}</ul>
        )}
        {preview && <section className="sc-assets-preview" aria-label="三维素材预览">
          <div className="sc-assets-section-heading"><h4>{generatedAssetName(preview.cloud ?? preview.asset)}</h4><button type="button" onClick={() => setPreview(null)}>关闭预览</button></div>
          {previewProps && <ScenePreview {...previewProps}/>}
          {preview.cloud && <AssetFacts asset={preview.cloud}/>}
          <p>保留模型原始材质。以下尺寸为加入场地后的实际尺寸，单位为米。</p>
          <div className="sc-assets-dimensions">{([['width', '宽'], ['depth', '深'], ['height', '高']] as const).map(([field, label]) => <label key={field}>{label}（米）<input aria-label={`模型${label}（米）`} type="number" min={field === 'height' ? .01 : .1} max={field === 'height' ? 30 : 50} step="0.01" value={Number.isNaN(size[field]) ? '' : size[field]} onChange={event => setSize(value => ({ ...value, [field]: event.target.value === '' ? NaN : Number(event.target.value) }))}/></label>)}</div>
          <div className="sc-assets-actions"><button type="button" className="sc-assets-primary" disabled={!validAssetSize(size) || !canAdd || !!pending} onClick={() => void run('加入模型', addPreview)}>确认加入当前画布</button><button type="button" disabled={!!pending || busy} onClick={() => void run('更新素材授权', account => loadPreview(preview.asset.id, account))}>重新授权</button></div>
          {!canAdd && <p>当前项目正在操作或尚无编辑权，请获取编辑权后加入。</p>}
          <small>加入位置为场地中央。可在画布移动、复制或撤销；{bound?'加入后仍需保存。':'加入后请核对保存状态，模型保留原引用。'}</small>
        </section>}
      </>}
      {pending && <p role="status">正在{pending}…</p>}
      {notice && <p className="sc-assets-message" role="alert">{notice}</p>}
    </div>
  </section>;
}

function AssetRow({ asset, favorite, pending, onToggleFavorite, onPreview, published, canPublish, onTogglePublish, canSubmitTeam, onSubmitTeam }: {
  asset: CloudAsset;
  favorite: boolean;
  pending: boolean;
  onToggleFavorite(): void;
  onPreview?: () => void;
  published: boolean;
  canPublish: boolean;
  onTogglePublish(): void;
  canSubmitTeam: boolean;
  onSubmitTeam(): void;
}): JSX.Element {
  const [broken, setBroken] = useState(false);
  const name = generatedAssetName(asset);
  const preview = broken ? undefined : storedPreview(asset);
  const thumb = preview
    ? (
      // 预览地址来自物料记录，可能是签名外链，不走 next/image。
      // eslint-disable-next-line @next/next/no-img-element
      <img src={preview} alt="" onError={() => setBroken(true)} />
    )
    : <span className="sc-assets-thumb-empty" aria-hidden="true" />;
  return <li>
    {onPreview
      ? <button type="button" className="sc-assets-thumb" aria-label={`预览 ${name}`} disabled={pending} onClick={onPreview}>{thumb}</button>
      : <span className="sc-assets-thumb" aria-hidden="true">{thumb}</span>}
    <div className="sc-assets-copy"><strong>{name}</strong><small>{assetMeta(asset)}</small>
      <div className="sc-assets-foot">
        {published && <em className="sc-assets-public">公共物料</em>}
        {!published && asset.team_studio_id && <em className="sc-assets-public">团队物料</em>}
        {canPublish && <button type="button" className="sc-assets-publish" aria-pressed={published} disabled={pending}
          title={published ? '从公共物料库撤下' : '放进公共物料库，任何注册用户都能看到并取用'}
          onClick={onTogglePublish}>{published ? '撤下' : '公开'}</button>}
        {canSubmitTeam && <button type="button" className="sc-assets-publish" disabled={pending}
          title="提交到当前工作室团队库，负责人审核通过后同室成员可取用"
          onClick={onSubmitTeam}>提交团队</button>}
      </div></div>
    <button type="button" className="sc-assets-star" aria-label={`${favorite ? '取消收藏' : '收藏'} ${name}`} aria-pressed={favorite} title={favorite ? '取消收藏' : '收藏'} onClick={onToggleFavorite}><Star size={14} fill={favorite ? 'currentColor' : 'none'} aria-hidden="true"/></button>
  </li>;
}
