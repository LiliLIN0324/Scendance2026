'use client';

import { Loader2, Search } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { formatLengthMetres } from '../../../../supabase/functions/_shared/units';
import { useHorizontalRail } from '../hooks/use-horizontal-rail';
import { CATALOG_DRAG_MIME } from '../lib/catalog-drag';
import { captureCatalogPlacement, type CatalogPlacementGuard } from '../lib/catalog-placement-guard';
import { loadOnlineCatalogItem } from '../lib/online-model-placement';
import { filterOnlineModels, loadOnlineModels } from '../lib/online-models';
import type { OnlineModel, OnlineModelIndex } from '../lib/online-models';
import type { CatalogItem } from '../lib/types';
import type { BackendSession } from '@/lib/backend-session';

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
  const bucketRail = useRef<HTMLDivElement>(null);
  const placementIdentity = useRef({ controller, apiUrl: controller?.config.apiUrl, epoch: 0 });
  if (placementIdentity.current.controller !== controller || placementIdentity.current.apiUrl !== controller?.config.apiUrl) {
    placementIdentity.current = { controller, apiUrl: controller?.config.apiUrl, epoch: placementIdentity.current.epoch + 1 };
  }
  const latest = useRef({ disabled, onAdd, controller, capturePlacement, busy });
  latest.current = { disabled, onAdd, controller, capturePlacement, busy };
  const placements = useRef(new Set<CatalogPlacementGuard>());
  const alive = useRef(true);
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

  const filtered = useMemo(
    () => (index ? filterOnlineModels(index.models, query, query.trim() ? '' : bucket) : []),
    [index, query, bucket]
  );
  const shown = filtered.slice(0, visible);
  const cards = useHorizontalRail<HTMLDivElement>();

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

  return <>
    <div className="sc-material-toolbar">
      <div ref={bucketRail} className="sc-bucket-rail" role="group" aria-label="线上模型分类" data-overflow={bucketMore ? 'more' : undefined}>
        <button type="button" aria-pressed={!query.trim() && bucket === ''} className={!query.trim() && bucket === '' ? 'is-active' : ''} onClick={() => { setQuery(''); setBucket(''); }}>全部 <b>{index.models.length}</b></button>
        {index.buckets.map(entry => <button key={entry.key} type="button" aria-pressed={!query.trim() && bucket === entry.key} className={!query.trim() && bucket === entry.key ? 'is-active' : ''} onClick={() => { setQuery(''); setBucket(entry.key); }}>{entry.label} <b>{entry.count}</b></button>)}
      </div>
      <label className="sc-search-mini">
        <Search size={20}/>
        <input aria-label="搜索全库线上模型" placeholder="搜索全库模型" value={query} onChange={event => setQuery(event.target.value)}/>
      </label>
    </div>
    {placeError && <p className="sc-warning sc-material-note" role="alert">{placeError}</p>}
    {limitMessage && <p className="sc-warning sc-material-note" role="status">{limitMessage}</p>}
    <div ref={cards.setRef} onKeyDown={cards.onKeyDown} className="sc-material-rail" role="group" aria-label="线上模型" tabIndex={0}>
      {shown.length === 0 && <p className="sc-muted sc-material-empty">没有匹配的模型。</p>}
      {shown.map(model => <button type="button" key={model.slug} className="sc-material-card" disabled={disabled || busy !== null}
        draggable={!disabled && busy === null} onDragStart={event => {
          if (disabled || busy !== null) { event.preventDefault(); return; }
          event.dataTransfer.setData(CATALOG_DRAG_MIME, `online:${model.slug}`);
          event.dataTransfer.effectAllowed = 'copy';
          // 拖拽时跟随鼠标的是物料缩略图，而不是整张卡片。
          const thumb = event.currentTarget.querySelector('img');
          if (thumb) event.dataTransfer.setDragImage(thumb, thumb.clientWidth / 2, thumb.clientHeight / 2);
        }}
        onClick={() => void addOnline(model)} aria-label={`添加${onlineModelDisplayName(model)}`} title={`${model.name}\n拖到场地或直接点击添加`}>
        <span className="sc-material-preview">
          {model.thumb && !failedThumbnails.has(model.slug)
            // A catalogue thumbnail straight from the CDN; next/image cannot optimise a remote URL here.
            // eslint-disable-next-line @next/next/no-img-element
            ? <img className="sc-material-thumb" src={model.thumb} alt="" draggable={false} loading="lazy" decoding="async" onError={() => setFailedThumbnails(current => new Set(current).add(model.slug))}/>
            : <span className="sc-material-thumb-empty">{model.thumb ? '预览未载入' : '暂无预览'}</span>}
          {busy === model.slug && <span className="sc-material-add"><Loader2 className="cr-spin" size={12}/></span>}
        </span>
        <span className="sc-material-name">{onlineModelDisplayName(model)}</span>
        <span className="sc-material-size">{formatLengthMetres(model.width)} × {formatLengthMetres(model.depth)} × {formatLengthMetres(model.height)}</span>
      </button>)}
      {filtered.length > shown.length && <button type="button" className="sc-material-more" onClick={() => setVisible(current => current + PAGE_SIZE)}>
        再显示 {Math.min(PAGE_SIZE, filtered.length - shown.length)} 个
      </button>}
    </div>
  </>;
}
