'use client';

import { ChevronDown, ChevronUp, LayoutGrid, Loader2, Palette, Search, Sparkles, Star, Tag } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useHorizontalRail } from '../hooks/use-horizontal-rail';
import { listAholoAssets } from '../lib/aholo-assets';
import { loadStoredAholoCatalogItem } from '../lib/aholo-model-placement';
import { CATALOG_DRAG_MIME } from '../lib/catalog-drag';
import { captureCatalogPlacement, type CatalogPlacementGuard } from '../lib/catalog-placement-guard';
import { CATALOG_GROUPS } from '../lib/catalog-taxonomy';
import {
  addCustomTag, emptyMaterialLibraryMeta, loadMaterialLibraryMeta, saveMaterialLibraryMeta, toggleAssignment, toggleFavorite,
  type MaterialLibraryMeta,
} from '../lib/material-library-meta';
import { loadOnlineCatalogItem } from '../lib/online-model-placement';
import { filterOnlineModels, loadOnlineModels, onlineBucketLabel } from '../lib/online-models';
import { buildFurnitureSet, FURNITURE_SETS } from '../lib/furniture-sets';
import { listShippedAssets, shippedImageUrl } from '../lib/shipped-assets';
import { loadStyleRuns, saveStyleRun, STYLE_BUNDLES, type StyleBundle, type StyleRun } from '../lib/style-bundles';
import { MaterialCreateCell } from './material-create-cell';
import { MaterialThumb } from './material-thumb';
import type { OnlineModel, OnlineModelIndex } from '../lib/online-models';
import type { CatalogItem, FurnitureItem } from '../lib/types';
import type { BackendSession } from '@/lib/backend-session';

type GeneratedCard = { id: string; name: string; image?: string; shipped: boolean };

function generatedMaterialCards(): GeneratedCard[] {
  const shipped = listShippedAssets('glb').map(asset => {
    const image = shippedImageUrl(asset);
    return { id: asset.assetId, name: asset.name, shipped: true, ...(image ? { image } : {}) };
  });
  const local = listAholoAssets().filter(asset => asset.kind === 'glb')
    .map(asset => ({ id: asset.assetId, name: asset.name, shipped: false }));
  return [...shipped, ...local];
}

function nameMatches(name: string, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return needle.split(/\s+/).every(word => name.toLowerCase().includes(word));
}

/**
 * The 线上模型 source inside the 物料库 panel: browse the shipped catalogue, then
 * place a piece from the registered cloud library (CDN for local previews).
 *
 * Drags carry only a catalogue slug; the viewport resolves the trusted catalogue.
 */

/** Tiles revealed per step; 234 thumbnails would otherwise all be requested at once. */
const PAGE_SIZE = 24;

/** The catalogue's names carry a trailing `(Collection)`; cards show the subject alone. */
export function onlineModelDisplayName(model: OnlineModel): string {
  const subject = model.name.replace(/\s*\([^()]*\)\s*$/, '').trim();
  return subject || model.name;
}

export interface OnlineModelLibraryProps {
  controller?: BackendSession;
  capturePlacement?: () => CatalogPlacementGuard;
  /** True while the active floor is full, so tiles stop pretending to be clickable. */
  disabled?: boolean;
  limitMessage?: string;
  onAdd(item: CatalogItem): void;
  /** 点一套风格：整组一次落进画布（位置与尺寸已算好，带 id/position/rotation）。 */
  onAddSet?(items: FurnitureItem[]): void;
  /** 画布场地尺寸：风格套按它缩放，小场地放不下就不放。 */
  roomSize?: { width: number; depth: number };
  /** 物料卡（三块并排）：我的生成 / 收藏 / 库。 */
  cardMode?: boolean;
}

export function OnlineModelLibrary({ disabled = false, limitMessage, onAdd, onAddSet, roomSize, controller, capturePlacement, cardMode = false }: OnlineModelLibraryProps): JSX.Element {
  const [index, setIndex] = useState<OnlineModelIndex | null>(null);
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [loadError, setLoadError] = useState('');
  const [placeError, setPlaceError] = useState('');
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  // 物料卡三块的当前页：我的生成 / 收藏 / 库。三块只是入口，结果都在下方同一块内容区。
  const [pane, setPane] = useState<'mine' | 'fav' | 'lib'>('lib');
  // 一张卡两种高度：收起只露一行素材，展开看完整网格；收起把高度还给下面 chat。
  const [expanded, setExpanded] = useState(false);
  const [bucket, setBucket] = useState('');
  const [visible, setVisible] = useState(PAGE_SIZE);
  const [busy, setBusy] = useState<string | null>(null);
  const [bucketMore, setBucketMore] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [meta, setMeta] = useState<MaterialLibraryMeta>(emptyMaterialLibraryMeta);
  const [generated, setGenerated] = useState<GeneratedCard[]>([]);
  const [pending, setPending] = useState<GeneratedCard[]>([]);
  const [tagDraft, setTagDraft] = useState(false);
  const [tagName, setTagName] = useState('');
  const [tagError, setTagError] = useState('');
  // 库这一层里的风格视图：不占第四个 tab，点一行入口在库位里切换。
  const [styleView, setStyleView] = useState(false);
  const [styleRuns, setStyleRuns] = useState<StyleRun[]>([]);
  const [armedTag, setArmedTag] = useState('');
  const bucketRail = useRef<HTMLDivElement>(null);
  const placementIdentity = useRef({ controller, apiUrl: controller?.config.apiUrl, epoch: 0 });
  if (placementIdentity.current.controller !== controller || placementIdentity.current.apiUrl !== controller?.config.apiUrl) {
    placementIdentity.current = { controller, apiUrl: controller?.config.apiUrl, epoch: placementIdentity.current.epoch + 1 };
  }
  const latest = useRef({ disabled, onAdd, onAddSet, roomSize, controller, capturePlacement, busy });
  latest.current = { disabled, onAdd, onAddSet, roomSize, controller, capturePlacement, busy };
  const placements = useRef(new Set<CatalogPlacementGuard>());
  const alive = useRef(true);
  useEffect(() => {
    setMeta(loadMaterialLibraryMeta(window.localStorage));
    setGenerated(generatedMaterialCards());
    setStyleRuns(loadStyleRuns(window.localStorage));
  }, []);
  useEffect(() => { const activePlacements = placements.current; alive.current = true; return () => {
    alive.current = false;
    for (const guard of activePlacements) guard.dispose();
    activePlacements.clear();
  }; }, []);

  useEffect(() => {
    let alive = true;
    setLoadState('loading');
    loadOnlineModels()
      .then(next => { if (!alive) return; setIndex(next); setLoadState('ready'); })
      .catch((error: unknown) => {
        if (!alive) return;
        setLoadError(error instanceof Error ? error.message : '线上模型库载入失败。');
        setLoadState('error');
      });
    return () => { alive = false; };
  }, [attempt]);

  // A new filter restarts the reveal window, so results never open mid-list.
  useEffect(() => { setVisible(PAGE_SIZE); }, [query, bucket]);

  useEffect(() => {
    const rail = bucketRail.current;
    if (!rail) return undefined;
    const sync = () => setBucketMore(rail.scrollLeft + rail.clientWidth < rail.scrollWidth - 4);
    sync();
    rail.addEventListener('scroll', sync, { passive: true });
    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey || Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return;
      const max = rail.scrollWidth - rail.clientWidth;
      if (max <= 0) return;
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? rail.clientWidth : 1;
      const next = Math.max(0, Math.min(max, rail.scrollLeft + event.deltaY * unit));
      if (next === rail.scrollLeft) return;
      // A non-passive listener prevents the surrounding list from scrolling too.
      event.preventDefault();
      rail.scrollLeft = next;
    };
    rail.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      rail.removeEventListener('scroll', sync);
      rail.removeEventListener('wheel', onWheel);
    };
  }, [loadState]);

  const catalogBucket = !query.trim() && bucket && bucket !== '__fav' && bucket !== '__generated' && !bucket.startsWith('tag:') ? bucket : '';
  const filtered = useMemo(() => {
    if (!index) return [];
    if (!query.trim() && bucket === '__generated') return [];
    if (!query.trim() && bucket === '__fav') return index.models.filter(model => meta.favorites.includes(model.slug));
    if (!query.trim() && bucket.startsWith('tag:')) {
      const tag = bucket.slice(4);
      return index.models.filter(model => (meta.assignments[model.slug] ?? []).includes(tag));
    }
    return filterOnlineModels(index.models, query, catalogBucket);
  }, [index, query, bucket, catalogBucket, meta.favorites, meta.assignments]);
  const shown = filtered.slice(0, visible);
  const generatedShown = useMemo(() => {
    const rows = [...generated, ...pending];
    return rows.filter(card => {
      if (!nameMatches(card.name, query)) return false;
      if (query.trim()) return true;
      if (bucket === '__fav') return meta.favorites.includes(card.id);
      if (bucket === '__generated' || bucket === '') return true;
      if (bucket.startsWith('tag:')) return (meta.assignments[card.id] ?? []).includes(bucket.slice(4));
      return false;
    });
  }, [generated, pending, query, bucket, meta.favorites, meta.assignments]);
  const cards = useHorizontalRail<HTMLDivElement>();
  const reservedTags = CATALOG_GROUPS.map(group => group.label);
  const writeMeta = (next: MaterialLibraryMeta) => {
    setMeta(next);
    saveMaterialLibraryMeta(window.localStorage, next);
  };
  const favoriteCount = meta.favorites.length;
  const generatedCount = generated.length + pending.length;

  const addOnline = async (model: OnlineModel) => {
    if (latest.current.disabled || latest.current.busy) return;
    latest.current.busy = model.slug;
    setBusy(model.slug);
    setPlaceError('');
    let guard: CatalogPlacementGuard | undefined;
    try {
      const current = latest.current;
      guard = current.capturePlacement?.() ?? captureCatalogPlacement(current.controller, () => placementIdentity.current.epoch);
      placements.current.add(guard);
      const item = await loadOnlineCatalogItem(model, current.controller);
      if (!alive.current) return;
      guard.assertCurrent();
      if (latest.current.disabled) throw new Error('当前场景物料已满，请腾出位置后重新添加。');
      latest.current.onAdd(item);
    } catch (error) {
      if (alive.current) {
        setPlaceError(error instanceof Error ? error.message : '该模型未能下载，请重试或换一个。');
      }
    } finally {
      if (guard && placements.current.delete(guard)) guard.dispose();
      if (alive.current) { latest.current.busy = null; setBusy(null); }
    }
  };

  if (loadState === 'loading') {
    return <p className="sc-note" role="status">正在载入线上模型库…</p>;
  }

  if (loadState === 'error' || !index) {
    return <div className="sc-warning sc-material-load-state" role="alert">
      <p>{loadError}</p>
      <button type="button" className="sc-button sc-full" onClick={() => setAttempt(current => current + 1)}>重新载入</button>
    </div>;
  }

  const chip = (key: string, label: string, count: number | string, Icon?: typeof Star, showCount = true) => {
    const active = !query.trim() && bucket === key;
    return <button key={key || 'all'} type="button" aria-label={showCount ? `${label} ${count}` : label} aria-pressed={active} className={`sc-bucket-chip${active ? ' is-active' : ''}`} onClick={() => { setQuery(''); setBucket(key); setArmedTag(''); }}>
      {Icon && <Icon size={13} aria-hidden="true"/>}<span>{label}</span>{showCount && <b>{` ${count}`}</b>}
    </button>;
  };
  const createTag = () => {
    const result = addCustomTag(meta, tagName, reservedTags);
    setTagError(result.error);
    if (!result.tag) return;
    writeMeta(result.meta);
    setTagName('');
    setTagDraft(false);
    setArmedTag(result.tag);
    setBucket('');
    setQuery('');
  };

  const placeGenerated = (card: GeneratedCard) => {
    if (card.id.startsWith('pending:') || latest.current.disabled || latest.current.busy) return;
    latest.current.busy = card.id;
    setBusy(card.id);
    setPlaceError('');
    void loadStoredAholoCatalogItem(card.id).then(item => {
      if (!alive.current) return;
      latest.current.onAdd(item);
    }).catch((error: unknown) => {
      if (alive.current) setPlaceError(error instanceof Error ? error.message : '该模型未能取回。');
    }).finally(() => { if (alive.current) { latest.current.busy = null; setBusy(null); } });
  };

  // 一句话配一整套：位置与缩放仍走家具套的放样逻辑，风格只负责换色与说明。
  const placeStyleBundle = (bundle: StyleBundle) => {
    if (latest.current.disabled || latest.current.busy) return;
    const set = FURNITURE_SETS.find(entry => entry.key === bundle.setKey);
    if (!set) return;
    const room = latest.current.roomSize;
    const built = buildFurnitureSet(set, room ? { roomWidth: room.width, roomDepth: room.depth } : {});
    if (built.length === 0) { setPlaceError('这个场地放不下这一套，先换大一点的场地。'); return; }
    const items = built.map(item => (bundle.colors[item.type] ? { ...item, color: bundle.colors[item.type]! } : item));
    const place = latest.current.onAddSet;
    if (!place) { setPlaceError('先在空间里打开物料库，再点这一套。'); return; }
    setPlaceError('');
    place(items);
    // 记录落在「我的生成」：同一套只留最新一条，不做第二份清单。
    setStyleRuns(saveStyleRun(bundle.key, window.localStorage));
  };

  // 物料卡三块并排：生成（去对话）/ 收藏 / 库。三块只是摘要入口，内容都在下面的结果区。
  if (cardMode) {
    const favoriteModels = index.models.filter(model => meta.favorites.includes(model.slug));
    const favoriteGenerated = [...generated, ...pending].filter(card => meta.favorites.includes(card.id));
    const favoriteRows = favoriteModels.length + favoriteGenerated.length;
    const groups: { key: string; label: string; models: readonly OnlineModel[] }[] = [];
    if (query.trim() || bucket) {
      groups.push({ key: 'filtered', label: '', models: shown });
    } else {
      const byBucket = new Map<string, OnlineModel[]>();
      for (const model of shown) {
        const list = byBucket.get(model.bucket) ?? [];
        list.push(model); byBucket.set(model.bucket, list);
      }
      for (const [key, models] of byBucket) groups.push({ key, label: onlineBucketLabel(key), models });
    }
    const tile = (model: OnlineModel, withFavorite = false) => {
      const name = onlineModelDisplayName(model);
      const favorited = meta.favorites.includes(model.slug);
      return <li className="sc-lib-tile" key={model.slug}>
        <button type="button" className="sc-lib-tile-btn" disabled={disabled || busy !== null} onClick={() => void addOnline(model)} aria-label={`添加${name}`} title={`${model.name}\n点击放入空间`}>
          <span className="sc-lib-tile-thumb">{model.thumb ? <MaterialThumb src={model.thumb}/> : <span className="sc-material-thumb-empty">▦</span>}</span>
          <span className="sc-lib-tile-name">{name}</span>
        </button>
        {withFavorite && <button type="button" className={`sc-lib-star${favorited ? ' is-favorite' : ''}`} aria-label={`${favorited ? '取消收藏' : '收藏'}物料 ${name}`} aria-pressed={favorited} onClick={() => writeMeta(toggleFavorite(meta, model.slug))}><Star size={12} fill={favorited ? 'currentColor' : 'none'} aria-hidden="true"/></button>}
      </li>;
    };
    const generatedTile = (card: GeneratedCard, withFavorite = false) => {
      const pendingCard = card.id.startsWith('pending:');
      const favorited = meta.favorites.includes(card.id);
      return <li className="sc-lib-tile" key={card.id}>
        <button type="button" className="sc-lib-tile-btn" disabled={disabled || busy !== null || pendingCard} onClick={() => placeGenerated(card)} aria-label={pendingCard ? `生成中 ${card.name}` : `添加${card.name}`} title={`${card.name}\n生成的物料`}>
          <span className="sc-lib-tile-thumb">{card.image ? <MaterialThumb src={card.image}/> : <span className="sc-material-thumb-empty">{pendingCard ? <Loader2 className="cr-spin" size={12}/> : '生'}</span>}</span>
          <span className="sc-lib-tile-name">{card.name}</span>
        </button>
        {withFavorite && <button type="button" className={`sc-lib-star${favorited ? ' is-favorite' : ''}`} aria-label={`${favorited ? '取消收藏' : '收藏'}物料 ${card.name}`} aria-pressed={favorited} onClick={() => writeMeta(toggleFavorite(meta, card.id))}><Star size={12} fill={favorited ? 'currentColor' : 'none'} aria-hidden="true"/></button>}
      </li>;
    };
    const modelRow = (model: OnlineModel) => tile(model, true);
    // 风格套的缩略图就是一格小色板：不生成图片，靠四块颜色认出这一套。
    const styleThumb = (bundle: StyleBundle, small = false) => <span className={`sc-lib-style-thumb${small ? ' is-small' : ''}`} aria-hidden="true">
      {bundle.swatches.map(color => <span className="sc-lib-style-swatch" key={color} style={{ background: color }}/>)}
    </span>;
    // 「我的生成」既放生成的单件，也放配过的整套：计数按两者之和。
    const mineCount = generatedShown.length + styleRuns.length;
    // 点哪一块就切到哪一页并展开：tabs 与素材同属一张卡，切换即看到完整内容。
    const pickPane = (next: 'mine' | 'fav' | 'lib') => { setPane(next); setExpanded(true); if (next !== 'lib') setStyleView(false); };
    return <div className={`sc-lib-wrap sc-lib-shell${expanded ? ' is-expanded' : ''}`}>
      <div className="sc-lib-triad" role="tablist" aria-label="物料">
        <button type="button" className={`sc-space-section sc-lib-card sc-lib-sum${pane === 'mine' ? ' is-active' : ''}`} aria-pressed={pane === 'mine'} onClick={() => pickPane('mine')}>
          <Sparkles size={15} aria-hidden="true"/><span>我的生成</span><small>{mineCount > 0 ? mineCount : '空'}</small>
        </button>
        <button type="button" className={`sc-space-section sc-lib-card sc-lib-sum${pane === 'fav' ? ' is-active' : ''}`} aria-pressed={pane === 'fav'} onClick={() => pickPane('fav')}>
          <Star size={15} aria-hidden="true"/><span>收藏</span><small>{favoriteRows > 0 ? favoriteRows : '空'}</small>
        </button>
        <button type="button" className={`sc-space-section sc-lib-card sc-lib-sum${pane === 'lib' ? ' is-active' : ''}`} aria-pressed={pane === 'lib'} onClick={() => pickPane('lib')}>
          <LayoutGrid size={15} aria-hidden="true"/><span>库</span><small>{index.models.length}</small>
        </button>
      </div>
      <div className="sc-lib-results" aria-live="polite">
        {pane === 'fav'
          ? (favoriteRows === 0
            ? <p className="sc-lib-empty"><Star size={14} aria-hidden="true"/><span>还没有收藏</span></p>
            : <ul className="sc-lib-grid">{favoriteModels.map(model => tile(model, true))}{favoriteGenerated.map(card => generatedTile(card, true))}</ul>)
          : pane === 'mine'
            ? <>
              {/* 生成入口落在物料这张卡里：Bingo 不再承担生成，这里保留同一份生成记录与入口。 */}
              <div className="sc-lib-create-row">
                <MaterialCreateCell disabled={disabled} onAccepted={item => setPending(current => current.some(card => card.id === item.id) ? current : [{ id: item.id, name: item.name, shipped: false }, ...current])}/>
                {generatedShown.length === 0 && styleRuns.length === 0 && <p className="sc-lib-empty"><Sparkles size={14} aria-hidden="true"/><span>还没有生成过</span></p>}
              </div>
              {generatedShown.length > 0 && <ul className="sc-lib-grid">{generatedShown.map(card => generatedTile(card, true))}</ul>}
              {/* 配过的整套也记在这里：一行一套，点一下再放一次。 */}
              {styleRuns.length > 0 && <ul className="sc-lib-style-list" aria-label="配过的风格套">
                {styleRuns.map(run => {
                  const bundle = STYLE_BUNDLES.find(entry => entry.key === run.style);
                  if (!bundle) return null;
                  return <li className="sc-lib-style-row" key={run.style}>
                    <button type="button" className="sc-lib-style-btn" disabled={disabled || busy !== null} onClick={() => placeStyleBundle(bundle)} aria-label={`再放一套${bundle.name}`} title={`${bundle.name}\n点一下再放一套`}>
                      {styleThumb(bundle, true)}
                      <span className="sc-lib-style-body"><strong>{bundle.name}</strong><small>整套 · {bundle.note}</small></span>
                    </button>
                  </li>;
                })}
              </ul>}
            </>

            : <>
            {/* 库页里的一行入口：风格不另起第四块，点开就在这一层换成成套建议。 */}
            <button type="button" className="sc-lib-style-entry" aria-pressed={styleView} onClick={() => setStyleView(current => !current)}>
              <Palette size={13} aria-hidden="true"/><span>按风格配一套</span><small>{STYLE_BUNDLES.length} 套</small>
              {styleView ? <ChevronUp size={13} aria-hidden="true"/> : <ChevronDown size={13} aria-hidden="true"/>}
            </button>
            {styleView
              ? <ul className="sc-lib-style-list" aria-label="风格套">
                {STYLE_BUNDLES.map(bundle => <li className="sc-lib-style-row" key={bundle.key}>
                  <button type="button" className="sc-lib-style-btn" disabled={disabled || busy !== null} onClick={() => placeStyleBundle(bundle)} aria-label={`按${bundle.name}配一套`} title={`${bundle.name}\n${bundle.note}`}>
                    {styleThumb(bundle)}
                    <span className="sc-lib-style-body"><strong>{bundle.name}</strong><small>{bundle.note}</small></span>
                  </button>
                </li>)}
              </ul>
              : <>
            {/* 库不再套「常用素材」这一层：直接按类目分组，加载更多只做一行轻提示。 */}
            {(query.trim() || bucket) && <div className="sc-lib-tools">
              <div className="sc-lib-chips" role="group" aria-label="物料分类">
                {chip('', '全部', 0, LayoutGrid, false)}
                {index.buckets.map(entry => chip(entry.key, entry.label, entry.count, undefined, false))}
              </div>
              <label className={`sc-search-mini${searchOpen ? ' is-open' : ''}`}>
                <button type="button" aria-label={searchOpen ? '收起搜索' : '搜索全库模型'} aria-pressed={searchOpen} onClick={() => { setSearchOpen(current => !current); if (searchOpen) setQuery(''); }}><Search size={15} aria-hidden="true"/></button>
                <input aria-label="搜索全库线上模型" placeholder="搜索" value={query} onChange={event => setQuery(event.target.value)} onFocus={() => setSearchOpen(true)}/>
              </label>
            </div>}
            <ul className="sc-lib-list">
              {!query.trim() && !bucket && generatedShown.length > 0 && <li className="sc-lib-group"><small>生成的</small><ul>{generatedShown.slice(0, 4).map(card => generatedTile(card, true))}</ul></li>}
              {groups.map(group => <li className="sc-lib-group" key={group.key}>
                {group.label && <small>{group.label}</small>}
                <ul>{group.models.map(modelRow)}</ul>
              </li>)}
            </ul>
            {groups.every(group => group.models.length === 0) && generatedShown.length === 0 && <p className="sc-lib-empty"><LayoutGrid size={14} aria-hidden="true"/><span>没有匹配的模型</span></p>}
            {filtered.length > shown.length && <button type="button" className="sc-lib-more" onClick={() => setVisible(current => current + PAGE_SIZE)}><span>加载更多</span><ChevronDown size={13} aria-hidden="true"/></button>}
              </>}
            {placeError && <p className="sc-warning sc-material-note" role="alert">{placeError}</p>}
            {limitMessage && <p className="sc-warning sc-material-note" role="status">{limitMessage}</p>}
          </>}
      </div>
      <button type="button" className="sc-lib-expand" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>
        <span>{expanded ? '收起' : '展开'}</span>
        {expanded ? <ChevronUp size={13} aria-hidden="true"/> : <ChevronDown size={13} aria-hidden="true"/>}
      </button>
    </div>;
  }

  return <>
    <div className="sc-material-toolbar">
      <div ref={bucketRail} className="sc-bucket-rail" role="group" aria-label="线上模型分类" data-overflow={bucketMore ? 'more' : undefined}>
        {chip('', '全部', index.models.length, LayoutGrid, false)}
        {tagDraft
          ? <form className="sc-bucket-add-form" onSubmit={event => { event.preventDefault(); createTag(); }}>
            <input aria-label="新标签名称" value={tagName} maxLength={16} placeholder="新标签" onChange={event => setTagName(event.target.value)}/>
            <button type="submit" aria-label="确认新标签">添加</button>
          </form>
          : <button type="button" className="sc-bucket-add" aria-label="标签" title="标签" onClick={() => { setTagDraft(true); setTagError(''); }}><Tag size={13} aria-hidden="true"/></button>}
        {chip('__fav', '收藏', favoriteCount, Star)}
        {chip('__generated', '生成', generatedCount, Sparkles)}
        {index.buckets.map(entry => chip(entry.key, entry.label, entry.count))}
        {meta.customTags.map(tag => chip(`tag:${tag}`, tag, Object.values(meta.assignments).filter(tags => tags.includes(tag)).length))}
      </div>
      <label className={`sc-search-mini${searchOpen ? ' is-open' : ''}`}>
        <button type="button" aria-label={searchOpen ? '收起搜索' : '搜索全库模型'} aria-pressed={searchOpen} onClick={() => { setSearchOpen(current => !current); if (searchOpen) setQuery(''); }}><Search size={16} aria-hidden="true"/></button>
        <input aria-label="搜索全库线上模型" placeholder="搜索全库模型" value={query} onChange={event => setQuery(event.target.value)} onFocus={() => setSearchOpen(true)}/>
      </label>
    </div>
    {tagError && <p className="sc-warning sc-material-note" role="alert">{tagError}</p>}
    {armedTag && <p className="sc-note sc-material-note" role="status">点物料角上的标签，把它挂到「{armedTag}」。<button type="button" className="sc-button" onClick={() => setArmedTag('')}>完成挂标签</button></p>}
    {placeError && <p className="sc-warning sc-material-note" role="alert">{placeError}</p>}
    {limitMessage && <p className="sc-warning sc-material-note" role="status">{limitMessage}</p>}
    <div ref={cards.setRef} onKeyDown={cards.onKeyDown} className="sc-material-rail" role="group" aria-label="线上模型" tabIndex={0}>
      <MaterialCreateCell disabled={disabled} onAccepted={item => setPending(current => current.some(card => card.id === item.id) ? current : [{ id: item.id, name: item.name, shipped: false }, ...current])}/>
      {shown.length === 0 && generatedShown.length === 0 && <p className="sc-muted sc-material-empty">{bucket.startsWith('tag:') ? '还没有物料挂上这个标签。' : '没有匹配的模型。'}</p>}
      {shown.map(model => {
        const name = onlineModelDisplayName(model);
        const favorite = meta.favorites.includes(model.slug);
        const tagged = armedTag ? (meta.assignments[model.slug] ?? []).includes(armedTag) : false;
        return <div className="sc-material-tile" key={model.slug}>
          <button type="button" className="sc-material-card" disabled={disabled || busy !== null}
            draggable={!disabled && busy === null} onDragStart={event => {
              if (disabled || busy !== null) { event.preventDefault(); return; }
              event.dataTransfer.setData(CATALOG_DRAG_MIME, `online:${model.slug}`);
              event.dataTransfer.effectAllowed = 'copy';
              const thumb = event.currentTarget.querySelector('img');
              if (thumb) event.dataTransfer.setDragImage(thumb, thumb.clientWidth / 2, thumb.clientHeight / 2);
            }}
            onClick={() => void addOnline(model)} aria-label={`添加${name}`} title={`${model.name}\n拖到空间或直接点击添加`}>
            <span className="sc-material-preview">
              {model.thumb
                ? <MaterialThumb src={model.thumb}/>
                : <span className="sc-material-thumb-empty">暂无预览</span>}
              {busy === model.slug && <span className="sc-material-add"><Loader2 className="cr-spin" size={12}/></span>}
            </span>
            <span className="sc-material-name">{name}</span>
          </button>
          <button type="button" className={`sc-material-star${favorite ? ' is-on' : ''}`} aria-pressed={favorite} aria-label={favorite ? `取消收藏物料 ${name}` : `收藏物料 ${name}`} onClick={() => writeMeta(toggleFavorite(meta, model.slug))}>
            <Star size={14} fill={favorite ? 'currentColor' : 'none'} aria-hidden="true"/>
          </button>
          {armedTag && <button type="button" className={`sc-material-tagpin${tagged ? ' is-on' : ''}`} aria-pressed={tagged} aria-label={tagged ? `从${armedTag}卸下${name}` : `把${name}挂上${armedTag}`} onClick={() => writeMeta(toggleAssignment(meta, model.slug, armedTag))}>{tagged ? '已挂' : '挂上'}</button>}
        </div>;
      })}
      {generatedShown.map(card => {
        const favorite = meta.favorites.includes(card.id);
        const tagged = armedTag ? (meta.assignments[card.id] ?? []).includes(armedTag) : false;
        const pendingCard = card.id.startsWith('pending:');
        return <div className="sc-material-tile" key={card.id}>
          <button type="button" className="sc-material-card" disabled={disabled || busy !== null || pendingCard}
            onClick={() => {
              if (pendingCard || latest.current.disabled || latest.current.busy) return;
              latest.current.busy = card.id;
              setBusy(card.id);
              setPlaceError('');
              void loadStoredAholoCatalogItem(card.id).then(item => {
                if (!alive.current) return;
                latest.current.onAdd(item);
              }).catch((error: unknown) => {
                if (alive.current) setPlaceError(error instanceof Error ? error.message : '该模型未能取回。');
              }).finally(() => { if (alive.current) { latest.current.busy = null; setBusy(null); } });
            }}
            aria-label={pendingCard ? `生成中 ${card.name}` : `添加${card.name}`} title={`${card.name}\n生成`}>
            <span className="sc-material-preview">
              {card.image
                ? <MaterialThumb src={card.image}/>
                : <span className="sc-material-thumb-empty">{busy === card.id ? <Loader2 className="cr-spin" size={14}/> : '生成'}</span>}
            </span>
            <span className="sc-material-name">{card.name}</span>
          </button>
          <button type="button" className={`sc-material-star${favorite ? ' is-on' : ''}`} aria-pressed={favorite} aria-label={favorite ? `取消收藏物料 ${card.name}` : `收藏物料 ${card.name}`} onClick={() => writeMeta(toggleFavorite(meta, card.id))}>
            <Star size={14} fill={favorite ? 'currentColor' : 'none'} aria-hidden="true"/>
          </button>
          {armedTag && !pendingCard && <button type="button" className={`sc-material-tagpin${tagged ? ' is-on' : ''}`} aria-pressed={tagged} aria-label={tagged ? `从${armedTag}卸下${card.name}` : `把${card.name}挂上${armedTag}`} onClick={() => writeMeta(toggleAssignment(meta, card.id, armedTag))}>{tagged ? '已挂' : '挂上'}</button>}
        </div>;
      })}
      {filtered.length > shown.length && <button type="button" className="sc-material-more" onClick={() => setVisible(current => current + PAGE_SIZE)}>
        再显示 {Math.min(PAGE_SIZE, filtered.length - shown.length)} 个
      </button>}
    </div>
  </>;
}
