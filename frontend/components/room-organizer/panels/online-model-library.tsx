'use client';

import { Loader2, Search, Star } from 'lucide-react';
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
import { filterOnlineModels, loadOnlineModels } from '../lib/online-models';
import { listShippedAssets, shippedImageUrl } from '../lib/shipped-assets';
import { MaterialCreateCell } from './material-create-cell';
import type { OnlineModel, OnlineModelIndex } from '../lib/online-models';
import type { CatalogItem } from '../lib/types';
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
}

export function OnlineModelLibrary({ disabled = false, limitMessage, onAdd, controller, capturePlacement }: OnlineModelLibraryProps): JSX.Element {
  const [index, setIndex] = useState<OnlineModelIndex | null>(null);
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [loadError, setLoadError] = useState('');
  const [placeError, setPlaceError] = useState('');
  const [query, setQuery] = useState('');
  const [bucket, setBucket] = useState('');
  const [visible, setVisible] = useState(PAGE_SIZE);
  const [busy, setBusy] = useState<string | null>(null);
  const [bucketMore, setBucketMore] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [failedThumbnails, setFailedThumbnails] = useState<ReadonlySet<string>>(new Set());
  const [meta, setMeta] = useState<MaterialLibraryMeta>(emptyMaterialLibraryMeta);
  const [generated, setGenerated] = useState<GeneratedCard[]>([]);
  const [pending, setPending] = useState<GeneratedCard[]>([]);
  const [tagDraft, setTagDraft] = useState(false);
  const [tagName, setTagName] = useState('');
  const [tagError, setTagError] = useState('');
  const [armedTag, setArmedTag] = useState('');
  const bucketRail = useRef<HTMLDivElement>(null);
  const placementIdentity = useRef({ controller, apiUrl: controller?.config.apiUrl, epoch: 0 });
  if (placementIdentity.current.controller !== controller || placementIdentity.current.apiUrl !== controller?.config.apiUrl) {
    placementIdentity.current = { controller, apiUrl: controller?.config.apiUrl, epoch: placementIdentity.current.epoch + 1 };
  }
  const latest = useRef({ disabled, onAdd, controller, capturePlacement, busy });
  latest.current = { disabled, onAdd, controller, capturePlacement, busy };
  const placements = useRef(new Set<CatalogPlacementGuard>());
  const alive = useRef(true);
  useEffect(() => {
    setMeta(loadMaterialLibraryMeta(window.localStorage));
    setGenerated(generatedMaterialCards());
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

  const chip = (key: string, label: string, count: number | string) => {
    const active = !query.trim() && bucket === key;
    return <button key={key || 'all'} type="button" aria-pressed={active} className={active ? 'is-active' : ''} onClick={() => { setQuery(''); setBucket(key); setArmedTag(''); }}>{label} <b>{count}</b></button>;
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

  return <>
    <div className="sc-material-toolbar">
      <div ref={bucketRail} className="sc-bucket-rail" role="group" aria-label="线上模型分类" data-overflow={bucketMore ? 'more' : undefined}>
        {chip('', '全部', index.models.length)}
        {chip('__fav', '收藏', favoriteCount)}
        {chip('__generated', '生成', generatedCount)}
        {index.buckets.map(entry => chip(entry.key, entry.label, entry.count))}
        {meta.customTags.map(tag => chip(`tag:${tag}`, tag, Object.values(meta.assignments).filter(tags => tags.includes(tag)).length))}
        {tagDraft
          ? <form className="sc-bucket-add-form" onSubmit={event => { event.preventDefault(); createTag(); }}>
            <input aria-label="新标签名称" value={tagName} maxLength={16} placeholder="新标签" onChange={event => setTagName(event.target.value)}/>
            <button type="submit" aria-label="确认新标签">添加</button>
          </form>
          : <button type="button" className="sc-bucket-add" aria-label="新建标签" title="新建标签" onClick={() => { setTagDraft(true); setTagError(''); }}>+</button>}
      </div>
      <label className="sc-search-mini">
        <Search size={20}/>
        <input aria-label="搜索全库线上模型" placeholder="搜索全库模型" value={query} onChange={event => setQuery(event.target.value)}/>
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
              {model.thumb && !failedThumbnails.has(model.slug)
                // eslint-disable-next-line @next/next/no-img-element
                ? <img className="sc-material-thumb" src={model.thumb} alt="" draggable={false} loading="lazy" decoding="async" onError={() => setFailedThumbnails(current => new Set(current).add(model.slug))}/>
                : <span className="sc-material-thumb-empty">{model.thumb ? '预览未载入' : '暂无预览'}</span>}
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
                // eslint-disable-next-line @next/next/no-img-element
                ? <img className="sc-material-thumb" src={card.image} alt="" draggable={false} loading="lazy" decoding="async"/>
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
