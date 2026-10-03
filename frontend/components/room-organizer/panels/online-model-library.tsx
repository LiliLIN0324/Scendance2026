'use client';

import { Loader2, Plus, Search } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { filterOnlineModels, formatModelBytes, loadOnlineModels } from '../lib/online-models';
import { createGlbCatalogItem, ensureGlbAsset } from '../three/glb-assets';
import type { OnlineModel, OnlineModelIndex } from '../lib/online-models';
import type { CatalogItem } from '../lib/types';
import type { BackendSession } from '@/lib/backend-session';

/**
 * The 线上模型 source inside the 物料库 panel: browse the shipped catalogue, then
 * place a piece from the registered cloud library (CDN for local previews).
 *
 * Tiles are click-to-place only. The drag payload identifies a catalogue entry by name
 * (`lib/catalog-drag`), which only resolves against the static in-app catalogues, so
 * offering a drag here would drop nothing.
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
  /** True while the active floor is full, so tiles stop pretending to be clickable. */
  disabled?: boolean;
  onAdd(item: CatalogItem): void;
}

export function OnlineModelLibrary({ disabled = false, onAdd, controller }: OnlineModelLibraryProps): JSX.Element {
  const [index, setIndex] = useState<OnlineModelIndex | null>(null);
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [loadError, setLoadError] = useState('');
  const [placeError, setPlaceError] = useState('');
  const [query, setQuery] = useState('');
  const [bucket, setBucket] = useState('');
  const [visible, setVisible] = useState(PAGE_SIZE);
  const [busy, setBusy] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const bucketRail = useRef<HTMLDivElement>(null);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

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
    if (!rail) return;
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
    return () => rail.removeEventListener('wheel', onWheel);
  }, [loadState]);

  const filtered = useMemo(
    () => (index ? filterOnlineModels(index.models, query, bucket) : []),
    [index, query, bucket]
  );
  const shown = filtered.slice(0, visible);

  const addOnline = async (model: OnlineModel) => {
    if (disabled || busy) return;
    setBusy(model.slug);
    setPlaceError('');
    const scope = controller?.getSnapshot();
    try {
      // Fetch before placing: an unreachable asset should say so instead of
      // adding an invisible object to the scene.
      const userId = controller?.getSnapshot().user?.id;
      const url = userId && model.assetId && controller ? (await controller.authorizeAsset(model.assetId)).url : model.glb;
      await ensureGlbAsset(model.assetId ?? model.glb, url);
      if (!alive.current) return;
      if (controller?.getSnapshot().user?.id !== userId || controller?.getSnapshot().project?.id !== scope?.project?.id) throw new Error('项目或登录状态已变化，请重新添加模型。');
      onAdd(createGlbCatalogItem({
        name: model.name,
        url,
        ...(model.assetId ? { assetId: model.assetId } : {}),
        width: model.width,
        depth: model.depth,
        height: model.height,
        source: 'public_library',
      }));
    } catch (error) {
      if (alive.current) setPlaceError(error instanceof Error ? error.message : '该模型未能下载，请重试或换一个。');
    } finally {
      if (alive.current) setBusy(null);
    }
  };

  if (loadState === 'loading') {
    return <p className="sc-note" role="status">正在载入线上模型库…</p>;
  }

  if (loadState === 'error' || !index) {
    return <div className="sc-warning" role="alert">
      <p>{loadError}</p>
      <button type="button" className="sc-button sc-full" onClick={() => setAttempt(current => current + 1)}>重新载入</button>
    </div>;
  }

  return <>
    <div className="sc-material-toolbar">
      <div ref={bucketRail} className="sc-bucket-rail" role="group" aria-label="线上模型分类">
        <button type="button" aria-pressed={bucket === ''} className={bucket === '' ? 'is-active' : ''} onClick={() => setBucket('')}>全部 <b>{index.models.length}</b></button>
        {index.buckets.map(entry => <button key={entry.key} type="button" aria-pressed={bucket === entry.key} className={bucket === entry.key ? 'is-active' : ''} onClick={() => setBucket(entry.key)}>{entry.label} <b>{entry.count}</b></button>)}
      </div>
      <label className="sc-search-mini">
        <Search size={15}/>
        <input aria-label="搜索线上模型" placeholder="搜索" value={query} onChange={event => setQuery(event.target.value)}/>
      </label>
    </div>
    {placeError && <p className="sc-warning" role="alert">{placeError}</p>}
    <div className="sc-material-grid">
      {shown.map(model => <button type="button" key={model.slug} className="sc-material-card" disabled={disabled || busy !== null}
        onClick={() => void addOnline(model)} aria-label={`添加${onlineModelDisplayName(model)}`} title={model.name}>
        <span className="sc-material-preview">
          {model.thumb
            // A catalogue thumbnail straight from the CDN; next/image cannot optimise a remote URL here.
            // eslint-disable-next-line @next/next/no-img-element
            ? <img className="sc-material-thumb" src={model.thumb} alt="" loading="lazy" decoding="async"/>
            : <span className="sc-material-thumb-empty" aria-hidden="true">◇</span>}
          <span className="sc-material-add">{busy === model.slug ? <Loader2 className="cr-spin" size={12}/> : <Plus size={12}/>}</span>
        </span>
        <span className="sc-material-name">{onlineModelDisplayName(model)}</span>
        <span className="sc-material-size">{model.width} × {model.depth} × {model.height} m</span>
        {model.bytes > 0 && <span className="sc-material-size">{formatModelBytes(model.bytes)}</span>}
      </button>)}
    </div>
    {shown.length === 0 && <p className="sc-muted">没有匹配的线上模型，换个词或切回「全部」。</p>}
    {filtered.length > shown.length && <button type="button" className="sc-button sc-full sc-more" onClick={() => setVisible(current => current + PAGE_SIZE)}>
      再显示 {Math.min(PAGE_SIZE, filtered.length - shown.length)} 个（共 {filtered.length}）
    </button>}
    <p className="sc-note">模型需要联网加载。点击后先下载再放入场地。</p>
  </>;
}
