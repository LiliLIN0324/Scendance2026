'use client';

import { ChevronDown, LayoutGrid, Loader2, Search, Sparkles, Star, Tag } from '@/components/solid-icons';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useHorizontalRail } from '../hooks/use-horizontal-rail';
import { listAholoAssets } from '../lib/aholo-assets';
import { loadStoredAholoCatalogItem } from '../lib/aholo-model-placement';
import { CATALOG_DRAG_MIME } from '../lib/catalog-drag';
import { captureCatalogPlacement, captureCatalogPlacementBatch, type CatalogPlacementBatchGuard, type CatalogPlacementGuard, type CatalogPlacementResult } from '../lib/catalog-placement-guard';
import { layoutStore } from '../hooks/use-layout-store';
import { CROWD_TYPES, crowdTypeModelSlugs } from '../lib/crowd-types';
import { planningIcon } from '../components/outdoor-plan-icons';
import { CROWD_GROUP_LABEL, MATERIAL_GROUP_LABELS, materialGroupLabel } from '../lib/material-taxonomy';
import { INFRA_CATEGORY_ORDER, INFRA_ROW_LABEL } from '../lib/oneplan-catalog';
import { libraryEntries, type LibraryEntry, type OneplanManifest } from '../lib/oneplan-library';
import { oneplanStickerSrc, oneplanStickerUsesChip, type OneplanStickerDescriptor } from '../lib/oneplan-stickers';
import { planStickerForModel } from '../lib/plan-icon-for-model';
import {
  addCustomTag, emptyMaterialLibraryMeta, loadMaterialLibraryMeta, saveMaterialLibraryMeta, toggleAssignment, toggleFavorite,
  type MaterialLibraryMeta,
} from '../lib/material-library-meta';
import { loadOnlineCatalogItem } from '../lib/online-model-placement';
import { usePendingMaterials } from '../lib/material-generate';
import { importLatestPendingMaterials, importPendingMaterial, LUX3D_TASK_POLL_MS } from '../lib/lux3d-import';
import { filterOnlineModels, loadOnlineModels } from '../lib/online-models';
import { listShippedAssets, shippedImageUrl } from '../lib/shipped-assets';
import { buildStyleBundleItems, findStyleBundle, loadStyleRuns, saveStyleRun, type StyleBundle, type StyleRun } from '../lib/style-bundles';
import { assetCloudLabel, useAssetCloudRecords } from '../lib/asset-cloud';
import { MaterialCreateCell } from './material-create-cell';
import { MaterialThumb } from './material-thumb';
import type { OnlineModel, OnlineModelIndex } from '../lib/online-models';
import type { CatalogItem, FurnitureItem, RoomLayout } from '../lib/types';
import type { BackendSession } from '@/lib/backend-session';

type GeneratedCard = { id: string; name: string; image?: string; shipped: boolean };

/**
 * 最近用过：纯本地 localStorage，不上后端、不进项目文件。
 * 真正"用了"= addOnline 成功落盘（点击或拖拽都会走 loadOnlineCatalogItem；
 * 拖拽落盘在 room-organizer 三道门内，这里只钩子点击成功这一路径）。
 */
const ONLINE_RECENT_KEY = 'scendance.online-model.recent';
const ONLINE_RECENT_MAX = 14;
function loadRecentSlugs(store: Storage): string[] {
  try {
    const raw = store.getItem(ONLINE_RECENT_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is string => typeof x === 'string').slice(0, ONLINE_RECENT_MAX);
  } catch {
    return [];
  }
}
function pushRecentSlug(store: Storage, slug: string): string[] {
  const next = [slug, ...loadRecentSlugs(store).filter(s => s !== slug)].slice(0, ONLINE_RECENT_MAX);
  try { store.setItem(ONLINE_RECENT_KEY, JSON.stringify(next)); } catch { /* 隐私模式下静默 */ }
  return next;
}
function clearRecentSlugs(store: Storage): string[] {
  try { store.removeItem(ONLINE_RECENT_KEY); } catch { /* 隐私模式下静默 */ }
  return [];
}

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

function PlanIconBadge({ sticker }: { sticker: OneplanStickerDescriptor }): JSX.Element {
  return (
    <span className={`sc-lib-plan-icon${oneplanStickerUsesChip(sticker) ? ' is-chip' : ''}`} aria-hidden="true">
      <img src={oneplanStickerSrc(sticker)} alt="" width={14} height={14} />
    </span>
  );
}

export interface OnlineModelLibraryProps {
  controller?: BackendSession;
  capturePlacement?: () => CatalogPlacementGuard;
  capturePlacementBatch?: () => CatalogPlacementBatchGuard;
  /** Layout rendered by the parent, used to avoid placing via an old React closure. */
  renderedLayout?: RoomLayout;
  /** True while the active floor is full, so tiles stop pretending to be clickable. */
  disabled?: boolean;
  limitMessage?: string;
  onAdd(item: CatalogItem): CatalogPlacementResult | void;
  /** 点一套风格：整组一次落进画布（位置与尺寸已算好，带 id/position/rotation）。 */
  onAddSet?(items: FurnitureItem[]): void;
  /**
   * 2026-11-12 统一放置流程（用户拍板）：提供了它，鼠标点物料就不再直接落正中，
   * 而是载入后进入「待放置」（同户外：点哪放哪， Esc/取消放置退出）；
   * 拖拽到画布仍是拖哪落哪。键盘 Enter 走 onAdd 的键盘放置会话，不受影响。
   */
  onArmCatalogItem?(item: CatalogItem): void;
  /** 画布场地尺寸：风格套按它缩放，小场地放不下就不放。 */
  roomSize?: { width: number; depth: number };
  /** 物料卡（三块并排）：我的生成 / 收藏 / 库。 */
  cardMode?: boolean;
  /** 本机 GLB 导入入口，跟着物料轨一起走，不另开一栏。 */
  importSlot?: ReactNode;
  walkRoleSlot?: ReactNode;
  /** 按人群类型分组的可走动模型；和库内低模可以同时出现。 */
  walkRoles?: readonly {
    id: string;
    name: string;
    image: string;
    walkable: boolean;
    note?: string;
    crowdType?: string;
    selected: boolean;
    onSelect(): void;
  }[];
  createSlot?: ReactNode;
}

export function OnlineModelLibrary({ disabled = false, limitMessage, onAdd, onAddSet, onArmCatalogItem, roomSize, controller, capturePlacement, capturePlacementBatch, renderedLayout, cardMode = false, importSlot, walkRoleSlot, walkRoles = [], createSlot }: OnlineModelLibraryProps): JSX.Element {
  const [index, setIndex] = useState<OnlineModelIndex | null>(null);
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [loadError, setLoadError] = useState('');
  const [placeError, setPlaceError] = useState('');
  const [query, setQuery] = useState('');
  // 物料卡四块的当前页：我的生成 / 收藏 / 库 / 不同人群。四块只是入口，结果都在下方同一块内容区。
  const [pane, setPane] = useState<'mine' | 'fav' | 'lib' | 'crowd'>('lib');
  const [libSection, setLibSection] = useState<'infra' | 'crowd' | 'recent' | null>('infra');
  const [libSubgroup, setLibSubgroup] = useState<string | null>(null);
  const [crowdSection, setCrowdSection] = useState<string | null>(null);
  const [planEntries, setPlanEntries] = useState<LibraryEntry[]>([]);
  // 一张卡两种高度：收起只露一行素材，展开看完整网格；收起把高度还给下面 chat。
  const [bucket, setBucket] = useState('');
  const [visible, setVisible] = useState(PAGE_SIZE);
  const [busy, setBusy] = useState<string | null>(null);
  const [bucketMore, setBucketMore] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [meta, setMeta] = useState<MaterialLibraryMeta>(emptyMaterialLibraryMeta);
  const [generated, setGenerated] = useState<GeneratedCard[]>([]);
  const pending = usePendingMaterials();
  const cloudRecords = useAssetCloudRecords();
  const [tagDraft, setTagDraft] = useState(false);
  const [tagName, setTagName] = useState('');
  const [tagError, setTagError] = useState('');
  const [styleRuns, setStyleRuns] = useState<StyleRun[]>([]);
  const [armedTag, setArmedTag] = useState('');
  const [recent, setRecent] = useState<string[]>([]);
  const bucketRail = useRef<HTMLDivElement>(null);
  const placementIdentity = useRef({ controller, apiUrl: controller?.config.apiUrl, epoch: 0 });
  if (placementIdentity.current.controller !== controller || placementIdentity.current.apiUrl !== controller?.config.apiUrl) {
    placementIdentity.current = { controller, apiUrl: controller?.config.apiUrl, epoch: placementIdentity.current.epoch + 1 };
  }
  const latest = useRef({ disabled, onAdd, onAddSet, onArmCatalogItem, roomSize, controller, capturePlacement, capturePlacementBatch, renderedLayout, busy });
  latest.current = { disabled, onAdd, onAddSet, onArmCatalogItem, roomSize, controller, capturePlacement, capturePlacementBatch, renderedLayout, busy };
  const placements = useRef(new Set<CatalogPlacementGuard>());
  const batchQueue = useRef<OnlineModel[]>([]);
  const batchGuard = useRef<CatalogPlacementBatchGuard | null>(null);
  const batchRunning = useRef(false);
  const [queuedCount,setQueuedCount] = useState(0);
  const renderWaiter = useRef<{target:RoomLayout;resolve:()=>void;reject:(error:Error)=>void;timer:number}|null>(null);
  const alive = useRef(true);
  /** 手动点「取回」和后台轮询不能同时下载同一个任务。 */
  const importing = useRef(false);
  useEffect(() => {
    setMeta(loadMaterialLibraryMeta(window.localStorage));
    setGenerated(generatedMaterialCards());
    setStyleRuns(loadStyleRuns(window.localStorage));
    setRecent(loadRecentSlugs(window.localStorage));
  }, []);
  useEffect(() => {
    let cancelled = false;
    fetch('/oneplan-icons/manifest.json')
      .then(response => (response.ok ? response.json() : Promise.reject()))
      .then((manifest: OneplanManifest) => {
        if (!cancelled) setPlanEntries(libraryEntries(manifest.assets ?? []));
      })
      .catch(() => { /* 类目默认贴纸仍然可用 */ });
    return () => { cancelled = true; };
  }, []);
  useEffect(() => { const activePlacements = placements.current; alive.current = true; return () => {
    alive.current = false;
    batchQueue.current=[];batchGuard.current?.dispose();batchGuard.current=null;
    if(renderWaiter.current){window.clearTimeout(renderWaiter.current.timer);renderWaiter.current.reject(new Error('物料库已关闭，剩余物料未添加。'));renderWaiter.current=null;}
    for (const guard of activePlacements) guard.dispose();
    activePlacements.clear();
  }; }, []);

  useEffect(()=>{
    const waiter=renderWaiter.current;if(!waiter)return;
    try{batchGuard.current?.assertCurrent();}catch(error){window.clearTimeout(waiter.timer);renderWaiter.current=null;waiter.reject(error instanceof Error?error:new Error('场景已变化，剩余物料未添加。'));return;}
    if(renderedLayout===waiter.target){window.clearTimeout(waiter.timer);renderWaiter.current=null;waiter.resolve();}
  },[renderedLayout]);

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

  // 旧生成任务没有活动归属：完成后先入库，由用户在当前活动中选择放置。
  useEffect(() => {
    if (!pending.length) return undefined;
    let stopped = false;
    let timer: number | undefined;
    const tick = async () => {
      if (importing.current) {
        if (!stopped) timer = window.setTimeout(() => void tick(), LUX3D_TASK_POLL_MS);
        return;
      }
      importing.current = true;
      try {
        const result = await importLatestPendingMaterials();
        // 入库会先清掉待取卡片；本 effect 随之卸载重启，这里不能因为 stopped 丢掉已经下载好的模型。
        if (result.state === 'imported') {
          if(!alive.current)return;
          setGenerated(generatedMaterialCards());
          setPlaceError('模型已存进「我的生成」，请选择后加入当前场景。');
        } else if (result.state === 'failed' && !result.retryable) {
          setGenerated(generatedMaterialCards());
          setPlaceError(result.message);
        }
      } catch {
        if(alive.current)setPlaceError('当前活动无法核对；生成模型会保留在「我的生成」供稍后查看。');
      } finally {
        importing.current = false;
      }
      if (!stopped) timer = window.setTimeout(() => void tick(), LUX3D_TASK_POLL_MS);
    };
    void tick();
    return () => { stopped = true; if (timer !== undefined) window.clearTimeout(timer); };
  }, [pending.length]);

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
  const reservedTags = MATERIAL_GROUP_LABELS as readonly string[];
  // 最近用过：把 slug 解析回 OnlineModel；库里已下架的条目直接丢。
  const recentModels = useMemo<OnlineModel[]>(() => {
    if (!index) return [];
    return recent
      .map(slug => index.models.find(model => model.slug === slug))
      .filter((model): model is OnlineModel => Boolean(model));
  }, [index, recent]);
  const writeMeta = (next: MaterialLibraryMeta) => {
    setMeta(next);
    saveMaterialLibraryMeta(window.localStorage, next);
  };
  const favoriteCount = meta.favorites.length;
  const generatedCount = generated.length + pending.length;

  const waitForRenderedLayout = (target:RoomLayout):Promise<void> => {
    if(latest.current.renderedLayout===target)return Promise.resolve();
    if(!latest.current.renderedLayout)return Promise.reject(new Error('场景尚未刷新，剩余物料未添加。'));
    return new Promise((resolve,reject)=>{
      const timer=window.setTimeout(()=>{renderWaiter.current=null;reject(new Error('场景刷新超时，剩余物料未添加。'));},5000);
      renderWaiter.current={target,resolve,reject,timer};
    });
  };

  /** Each click is serialised; every model uses the latest verified scene. */
  const drainOnline = async () => {
    if(batchRunning.current)return;
    batchRunning.current=true;
    try{
      while(batchQueue.current.length){
        const batch=batchGuard.current;if(!batch)throw new Error('放置状态不可用，剩余物料未添加。');
        batch.assertCurrent();
        if(latest.current.renderedLayout)await waitForRenderedLayout(layoutStore.getState().layout);
        batch.assertCurrent();
        const model=batchQueue.current.shift()!;setQueuedCount(batchQueue.current.length);
        if(latest.current.disabled)throw new Error('当前场景物料已满，剩余物料未添加。');
        latest.current.busy=model.slug;setBusy(model.slug);
        const current=latest.current;
        const guard=current.capturePlacement?.()??captureCatalogPlacement(current.controller,()=>placementIdentity.current.epoch);
        placements.current.add(guard);
        try{
          const item=await loadOnlineCatalogItem(model,current.controller);
          if(!alive.current)return;
          guard.assertCurrent();batch.assertCurrent();
          if(latest.current.disabled)throw new Error('当前场景物料已满，剩余物料未添加。');
          const result=batch.runOwnMutation(()=>latest.current.onAdd(item));
          if(!result)throw new Error('未能确认本次是否放置，请查看画布；剩余物料未添加。');
          if(result.status==='pending')throw new Error('请先在场地中选择位置；其余物料尚未添加。');
          if(result.status==='failed')throw new Error(result.message||'这件物料未放置，剩余物料未添加。');
          setRecent(pushRecentSlug(window.localStorage,model.slug));
        }finally{if(placements.current.delete(guard))guard.dispose();}
      }
    }catch(error){
      batchQueue.current=[];setQueuedCount(0);
      if(alive.current)setPlaceError(error instanceof Error?error.message:'物料未能添加，请核对后重试。');
    }finally{
      batchRunning.current=false;batchGuard.current?.dispose();batchGuard.current=null;
      if(alive.current){latest.current.busy=null;setBusy(null);}
    }
  };
  const addOnline = (model: OnlineModel) => {
    if(latest.current.disabled){setPlaceError('当前场景物料已满，请先腾出位置。');return;}
    if(latest.current.busy&&!batchRunning.current){setPlaceError('正在处理其他物料，请稍后再试。');return;}
    if(batchQueue.current.length+(batchRunning.current?1:0)>=20){setPlaceError('待添加物料较多，请等当前请求处理完成。');return;}
    try{
      if(!batchGuard.current)batchGuard.current=latest.current.capturePlacementBatch?.()??captureCatalogPlacementBatch(latest.current.controller,()=>placementIdentity.current.epoch);
      batchGuard.current.assertCurrent();batchQueue.current.push(model);setQueuedCount(batchQueue.current.length);setPlaceError('');void drainOnline();
    }catch(error){if(alive.current)setPlaceError(error instanceof Error?error.message:'场景状态已变化，请重新添加。');}
  };

  /**
   * 2026-11-12 统一放置流程：点物料 = 载入后进入「待放置」，点哪放哪（同户外）；
   * 不再直接落正中。键盘 Enter 路径仍走 addOnline（正中 + 方向键微调会话）。
   */
  const armOnline = (model: OnlineModel) => {
    if (latest.current.disabled) { setPlaceError('当前场景物料已满，请先腾出位置。'); return; }
    if (latest.current.busy) { setPlaceError('正在处理其他物料，请稍后再试。'); return; }
    latest.current.busy = model.slug; setBusy(model.slug); setPlaceError('');
    void loadOnlineCatalogItem(model, latest.current.controller).then(item => {
      if (!alive.current) return;
      setRecent(pushRecentSlug(window.localStorage, model.slug));
      latest.current.onArmCatalogItem?.(item);
    }).catch((error: unknown) => {
      if (alive.current) setPlaceError(error instanceof Error ? error.message : '该模型未能取回。');
    }).finally(() => { if (alive.current) { latest.current.busy = null; setBusy(null); } });
  };
  /** 「我的生成」点选：载入后进「待放置」（同上）。 */
  const armGenerated = (card: GeneratedCard) => {
    if (latest.current.disabled || latest.current.busy || importing.current) return;
    latest.current.busy = card.id; setBusy(card.id); setPlaceError('');
    void loadStoredAholoCatalogItem(card.id).then(item => {
      if (!alive.current) return;
      latest.current.onArmCatalogItem?.(item);
    }).catch((error: unknown) => {
      if (alive.current) setPlaceError(error instanceof Error ? error.message : '该模型未能取回。');
    }).finally(() => { if (alive.current) { latest.current.busy = null; setBusy(null); } });
  };
  /** 点物料：宿主支持「待放置」就走 arm，否则回落旧的直接放置。 */
  const clickModel = (model: OnlineModel) => (latest.current.onArmCatalogItem ? armOnline(model) : addOnline(model));
  const clickGenerated = (card: GeneratedCard) => (latest.current.onArmCatalogItem && !card.id.startsWith('pending:') ? armGenerated(card) : placeGenerated(card));

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
    if (latest.current.disabled || latest.current.busy || importing.current) return;
    const pending = card.id.startsWith('pending:');
    importing.current = true;
    latest.current.busy = card.id;
    setBusy(card.id);
    setPlaceError('');
    let guard:CatalogPlacementGuard;
    try {const current=latest.current;guard=current.capturePlacement?.()??captureCatalogPlacement(current.controller,()=>placementIdentity.current.epoch);placements.current.add(guard);}
    catch {importing.current=false;latest.current.busy=null;setBusy(null);setPlaceError('当前活动无法核对，请重新选择后放置。');return;}
    const load = pending
      ? importPendingMaterial(card.id)
      : loadStoredAholoCatalogItem(card.id).then(item => ({ state: 'imported' as const, item }));
    void load.then(result => {
      if (!alive.current) return;
      if (result.state === 'imported') {
        setGenerated(generatedMaterialCards());
        try{guard.assertCurrent();const placed=latest.current.onAdd(result.item);if(!placed||placed.status!=='placed')setPlaceError('模型已保存在「我的生成」；请核对画布或选择位置。');}
        catch{setPlaceError('模型已保存在「我的生成」；活动或场景已变化，请重新选择后放置。');}
      } else {
        setPlaceError(result.message);
      }
    }).catch((error: unknown) => {
      if (alive.current) setPlaceError(error instanceof Error ? error.message : '该模型未能取回。');
    }).finally(() => { if(placements.current.delete(guard))guard.dispose();importing.current = false; if (alive.current) { latest.current.busy = null; setBusy(null); } });
  };

  // 再放一套：入口已挪到 Bingo；「我的生成」里仍可点历史记录重放。
  const placeStyleBundle = (bundle: StyleBundle) => {
    if (latest.current.disabled || latest.current.busy) return;
    const built = buildStyleBundleItems(bundle, latest.current.roomSize);
    if (!built.ok) { setPlaceError(built.message); return; }
    const place = latest.current.onAddSet;
    if (!place) { setPlaceError('先在 Bingo 里配一套，或打开物料卡再重放。'); return; }
    setPlaceError('');
    place(built.items);
    setStyleRuns(saveStyleRun(bundle.key, window.localStorage));
  };

  // 物料卡三块并排：生成（去对话）/ 收藏 / 库。三块只是摘要入口，内容都在下面的结果区。
  if (cardMode) {
    const favoriteModels = index.models.filter(model => meta.favorites.includes(model.slug));
    const favoriteGenerated = [...generated, ...pending].filter(card => meta.favorites.includes(card.id));
    const favoriteRows = favoriteModels.length + favoriteGenerated.length;
    // 「库」只装公共素材：收藏过的留给「收藏」，自己的生成物留给「我的生成」，三栏互斥。
    const libraryModels = index.models.filter(model => !meta.favorites.includes(model.slug));
    // 「不同人群」页直接列素材库里的人物模型（可能一个设施对应多个模型，全部列出，不去重）。
    const peopleModels = index.models.filter(model => materialGroupLabel(model.bucket) === '不同人群');
    const libraryFiltered = (() => {
      if (!query.trim() && bucket === '__fav') return [];
      if (!query.trim() && bucket === '__generated') return [];
      if (!query.trim() && bucket.startsWith('tag:')) {
        const tag = bucket.slice(4);
        return libraryModels.filter(model => (meta.assignments[model.slug] ?? []).includes(tag));
      }
      return filterOnlineModels(libraryModels, query, catalogBucket);
    })();
    const libraryShown = libraryFiltered.slice(0, visible);
    const groups: { key: string; label: string; models: readonly OnlineModel[] }[] = [];
    if (query.trim() || bucket) {
      groups.push({ key: 'filtered', label: '', models: libraryShown });
    } else {
      // 最近用过：收藏过的留给「收藏」页，不在库里重复；下架的条目由 recentModels 自动丢。
      const recentInLib = recentModels.filter(model => !meta.favorites.includes(model.slug));
      if (recentInLib.length > 0) groups.push({ key: 'recent', label: '最近用过', models: recentInLib });
      // 按基础设施分类分组（物料库与户外规划同一套口径），类目内维持库里的顺序。
      const byGroup = new Map<string, OnlineModel[]>();
      for (const model of libraryShown) {
        const key = materialGroupLabel(model.bucket);
        const list = byGroup.get(key) ?? [];
        list.push(model); byGroup.set(key, list);
      }
      const order = new Map<string, number>(MATERIAL_GROUP_LABELS.map((label, index) => [label, index]));
      for (const [key, models] of [...byGroup.entries()].sort((a, b) => {
        const ai = order.get(a[0]) ?? Number.MAX_SAFE_INTEGER;
        const bi = order.get(b[0]) ?? Number.MAX_SAFE_INTEGER;
        return ai - bi;
      })) groups.push({ key, label: key, models });
    }
    const searching = Boolean(query.trim());
    const recentInLib = recentModels.filter(model => !meta.favorites.includes(model.slug));
    const infraGroups = (() => {
      const byGroup = new Map<string, OnlineModel[]>();
      for (const model of libraryModels) {
        const key = materialGroupLabel(model.bucket);
        if (key === CROWD_GROUP_LABEL) continue;
        const list = byGroup.get(key) ?? [];
        list.push(model);
        byGroup.set(key, list);
      }
      const ordered: { label: string; models: OnlineModel[] }[] = [];
      const seen = new Set<string>();
      for (const label of INFRA_CATEGORY_ORDER) {
        const models = byGroup.get(label);
        if (models?.length) { ordered.push({ label, models }); seen.add(label); }
      }
      for (const [label, models] of byGroup) {
        if (!seen.has(label) && models.length) ordered.push({ label, models });
      }
      return ordered;
    })();
    const crowdInLib = libraryModels.filter(model => materialGroupLabel(model.bucket) === CROWD_GROUP_LABEL);
    const infraCount = infraGroups.reduce((sum, group) => sum + group.models.length, 0);
    const openSubgroup = libSection === 'infra' ? (libSubgroup === '' ? '' : (libSubgroup ?? infraGroups[0]?.label ?? '')) : '';
    const TentIcon = planningIcon('tent');
    const UsersIcon = planningIcon('users');
    const treeRow = (opts: { level: 'section' | 'sub'; label: string; count: number; open: boolean; icon?: JSX.Element; hint?: string; onToggle: () => void }) => (
      <button type="button" className={`sc-lib-tree-row is-${opts.level}${opts.open ? ' is-open' : ''}`} aria-expanded={opts.open} aria-label={`${opts.label} ${opts.count}`} onClick={opts.onToggle}>
        <span className="sc-lib-tree-chevron" aria-hidden="true">{opts.open ? '▾' : '▸'}</span>
        {opts.icon}
        <span className="sc-lib-tree-name">{opts.label}</span>
        {opts.hint && <span className="sc-lib-tree-hint">{opts.hint}</span>}
        <span className="sc-lib-tree-count">{opts.count}</span>
      </button>
    );
    const tile = (model: OnlineModel, withFavorite = false) => {
      const name = onlineModelDisplayName(model);
      const favorited = meta.favorites.includes(model.slug);
      return <li className="sc-lib-tile" key={model.slug}>
        <button type="button" className="sc-lib-tile-btn" disabled={disabled || (busy !== null && !batchRunning.current)}
          draggable={!disabled && busy === null}
          onDragStart={event => {
            if (disabled || busy !== null) { event.preventDefault(); return; }
            event.dataTransfer.setData(CATALOG_DRAG_MIME, `online:${model.slug}`);
            event.dataTransfer.effectAllowed = 'copy';
          }}
          onClick={() => clickModel(model)} aria-label={`添加${name}`} title={`${model.name}\n拖到场地落下，或点一下再点场地选位`}>
          <span className="sc-lib-tile-thumb"><span className="sc-lib-tile-photo">{model.thumb ? <MaterialThumb src={model.thumb}/> : <span className="sc-material-thumb-empty">▦</span>}</span><PlanIconBadge sticker={planStickerForModel(model, planEntries)}/></span>
          <span className="sc-lib-tile-name">{name}</span>
          {busy === model.slug && <span className="sc-lib-tile-add" role="status">放入中…</span>}
        </button>
        {withFavorite && <button type="button" className={`sc-lib-star${favorited ? ' is-favorite' : ''}`} aria-label={`${favorited ? '取消收藏' : '收藏'}物料 ${name}`} aria-pressed={favorited} onClick={() => writeMeta(toggleFavorite(meta, model.slug))}><Star size={12} fill={favorited ? 'currentColor' : 'none'} aria-hidden="true"/></button>}
      </li>;
    };
    const generatedTile = (card: GeneratedCard, withFavorite = false) => {
      const pendingCard = card.id.startsWith('pending:');
      const favorited = meta.favorites.includes(card.id);
      // 本机生成的卡显示四态；云端队列产物（shipped）本来就有 asset_id，不重复标。
      const cloudRecord = !pendingCard && !card.shipped ? cloudRecords[card.id] : undefined;
      const cloudState = cloudRecord ? assetCloudLabel(cloudRecord.state, cloudRecord.progress) : '';
      return <li className="sc-lib-tile" key={card.id}>
        <button type="button" className="sc-lib-tile-btn" disabled={disabled || busy !== null}
          draggable={!disabled && busy !== null ? false : !pendingCard}
          onDragStart={event => {
            if (disabled || busy !== null || pendingCard) { event.preventDefault(); return; }
            event.dataTransfer.setData(CATALOG_DRAG_MIME, `generated:${card.id}`);
            event.dataTransfer.effectAllowed = 'copy';
          }}
          onClick={() => clickGenerated(card)} aria-label={`${pendingCard ? `取回${card.name}` : `添加${card.name}`}${cloudState ? `（${cloudState}）` : ''}`} title={pendingCard ? `${card.name}\n生成中，点一下立即取回` : `${card.name}\n拖到场地落下，或点一下再点场地选位${cloudState ? `\n云端状态：${cloudState}` : ''}`}>
          <span className="sc-lib-tile-thumb"><span className="sc-lib-tile-photo">{card.image ? <MaterialThumb src={card.image}/> : <span className="sc-material-thumb-empty">{pendingCard ? <Loader2 className="cr-spin" size={12}/> : '生'}</span>}</span><PlanIconBadge sticker={planStickerForModel({ name: card.name, slug: card.id }, planEntries)}/></span>
          <span className="sc-lib-tile-name">{card.name}{cloudState && <small> · {cloudState}</small>}</span>
        </button>
        {withFavorite && <button type="button" className={`sc-lib-star${favorited ? ' is-favorite' : ''}`} aria-label={`${favorited ? '取消收藏' : '收藏'}物料 ${card.name}`} aria-pressed={favorited} onClick={() => writeMeta(toggleFavorite(meta, card.id))}><Star size={12} fill={favorited ? 'currentColor' : 'none'} aria-hidden="true"/></button>}
      </li>;
    };
    const modelRow = (model: OnlineModel) => tile(model, true);
    // 风格套的缩略图就是一格小色板：不生成图片，靠四块颜色认出这一套。
    const styleThumb = (bundle: StyleBundle, small = false) => <span className={`sc-lib-style-thumb${small ? ' is-small' : ''}`} aria-hidden="true">
      {bundle.swatches.map(color => <span className="sc-lib-style-swatch" key={color} style={{ background: color }}/>)}
    </span>;
    // 点哪一块就切到哪一页并展开：tabs 与素材同属一张卡，切换即看到完整内容。
    return <div className="sc-lib-wrap sc-lib-shell is-browse">
      {createSlot}
      <nav className="sc-library-tabs-equal" aria-label="物料来源">
        <button type="button" aria-pressed={pane === 'lib'} onClick={() => setPane('lib')}>物料库</button>
        <button type="button" aria-pressed={pane === 'fav'} onClick={() => setPane('fav')}>收藏</button>
        <button type="button" aria-pressed={pane === 'mine'} onClick={() => setPane('mine')}>我的生成</button>
        <button type="button" aria-pressed={pane === 'crowd'} onClick={() => setPane('crowd')}>不同人群</button>
      </nav>
      <div className="sc-lib-results" aria-live="polite">
        {pane === 'crowd' ? <div className="sc-lib-tree" aria-label="不同人群">
          {CROWD_TYPES.map(type => {
            const models = crowdTypeModelSlugs(type.id).flatMap(slug => {
              const model = peopleModels.find(entry => entry.slug === slug);
              return model ? [model] : [];
            });
            const roles = walkRoles.filter(role => (role.crowdType ?? 'performer') === type.id);
            const count = models.length + roles.length;
            if (count === 0) return null;
            const open = crowdSection === type.id;
            return <div key={type.id} data-crowd-type={type.id}>
              {treeRow({
                level: 'section',
                label: type.name,
                count,
                open,
                icon: <UsersIcon size={14} strokeWidth={1.75} aria-hidden="true"/>,
                hint: type.note,
                onToggle: () => setCrowdSection(current => current === type.id ? null : type.id),
              })}
              {open && <ul className="sc-lib-grid sc-lib-tree-panel" aria-label={`${type.name}模型`}>
                {roles.map(role => <li className="sc-lib-tile" key={role.id}>
                  <button type="button" className={`sc-lib-tile-btn${role.selected ? ' is-selected' : ''}`}
                    aria-pressed={role.selected} disabled={!role.walkable}
                    aria-label={role.walkable ? `选用${role.name}漫游` : `${role.name}无法漫游`}
                    title={role.note ?? (role.selected ? '当前角色，右侧「进入漫游」用它' : `点一下换成${role.name}`)}
                    onClick={role.onSelect}>
                    <span className="sc-lib-tile-thumb">
                      <span className="sc-lib-tile-photo">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={role.image} alt={`${role.name}全身预览`} loading="lazy"/>
                      </span>
                      <span className="sc-lib-tile-badge">漫游</span>
                    </span>
                    <span className="sc-lib-tile-name">{role.name}</span>
                  </button>
                </li>)}
                {models.map(model => tile(model, true))}
              </ul>}
            </div>;
          })}
          {walkRoles.length === 0 && walkRoleSlot && <div className="sc-lib-tree-panel">{walkRoleSlot}</div>}
        </div> : pane === 'fav'
          ? (favoriteRows === 0
            ? <p className="sc-lib-empty"><Star size={14} aria-hidden="true"/><span>还没有收藏</span></p>
            : <ul className="sc-lib-grid">{favoriteModels.map(model => tile(model, true))}{favoriteGenerated.map(card => generatedTile(card, true))}</ul>)
          : pane === 'mine'
            ? <>
              {generatedShown.length === 0 && styleRuns.length === 0 && <p className="sc-lib-empty"><Sparkles size={14} aria-hidden="true"/><span>还没有生成过</span></p>}
              {generatedShown.length > 0 && <ul className="sc-lib-grid">{generatedShown.map(card => generatedTile(card, true))}</ul>}
              {/* Bingo 配过的整套记在这里：一行一套，点一下再放一次。 */}
              {styleRuns.length > 0 && <ul className="sc-lib-style-list" aria-label="配过的风格套">
                {styleRuns.map(run => {
                  const bundle = findStyleBundle(run.style, window.localStorage);
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
            {/* 库不再挂「按风格配一套」——入口在 Bingo。这里只按类目浏览单件。 */}
            {/* 搜索框常驻顶部，不再藏在折叠/筛选里；对齐 shelf 形态。 */}
            <label className="sc-search-mini sc-lib-search">
              <Search size={14} aria-hidden="true"/>
              <input aria-label="搜索全库线上模型" placeholder="搜索库内素材" value={query} onChange={event => setQuery(event.target.value)}/>
            </label>
            {searching ? <>
              <ul className="sc-lib-list">
                {groups.map(group => <li className="sc-lib-group" key={group.key}>
                  {group.label && <small><span>{group.label}</span></small>}
                  <ul className="sc-lib-grid">{group.models.map(modelRow)}</ul>
                </li>)}
              </ul>
              {libraryFiltered.length === 0 && <p className="sc-lib-empty"><LayoutGrid size={14} aria-hidden="true"/><span>没有匹配的模型</span></p>}
              {libraryFiltered.length > libraryShown.length && <button type="button" className="sc-lib-more" onClick={() => setVisible(current => current + PAGE_SIZE)}><span>加载更多</span><ChevronDown size={13} aria-hidden="true"/></button>}
            </> : libraryModels.length === 0 ? (
              <p className="sc-lib-empty"><LayoutGrid size={14} aria-hidden="true"/><span>库里没有可用的公共素材</span></p>
            ) : (
              <div className="sc-lib-tree">
                {recentInLib.length > 0 && <>
                  <div className="sc-lib-tree-recent">
                    {treeRow({ level: 'section', label: '最近用过', count: recentInLib.length, open: libSection === 'recent', onToggle: () => setLibSection(current => current === 'recent' ? 'infra' : 'recent') })}
                    <button type="button" className="sc-lib-tree-clear" aria-label="清空最近用过" onClick={() => { setRecent(clearRecentSlugs(window.localStorage)); setLibSection('infra'); }}>清空</button>
                  </div>
                  {libSection === 'recent' && <ul className="sc-lib-grid sc-lib-tree-panel" role="list" aria-label="最近用过">{recentInLib.map(modelRow)}</ul>}
                </>}
                {treeRow({
                  level: 'section',
                  label: INFRA_ROW_LABEL,
                  count: infraCount,
                  open: libSection === 'infra',
                  icon: <TentIcon size={14} strokeWidth={1.75} aria-hidden="true"/>,
                  onToggle: () => { setLibSection(current => current === 'infra' ? null : 'infra'); setLibSubgroup(null); },
                })}
                {libSection === 'infra' && infraGroups.map(group => <div key={group.label}>
                  {treeRow({
                    level: 'sub',
                    label: group.label,
                    count: group.models.length,
                    open: openSubgroup === group.label,
                    onToggle: () => setLibSubgroup(current => (current ?? infraGroups[0]?.label) === group.label ? '' : group.label),
                  })}
                  {openSubgroup === group.label && <ul className="sc-lib-grid sc-lib-tree-panel">{group.models.map(modelRow)}</ul>}
                </div>)}
                {treeRow({
                  level: 'section',
                  label: CROWD_GROUP_LABEL,
                  count: crowdInLib.length,
                  open: libSection === 'crowd',
                  icon: <UsersIcon size={14} strokeWidth={1.75} aria-hidden="true"/>,
                  onToggle: () => setLibSection(current => current === 'crowd' ? 'infra' : 'crowd'),
                })}
                {libSection === 'crowd' && (crowdInLib.length > 0
                  ? <ul className="sc-lib-grid sc-lib-tree-panel">{crowdInLib.map(modelRow)}</ul>
                  : <p className="sc-lib-empty"><span>这一类还没有模型</span></p>)}
              </div>
            )}
          </>}
        {placeError && <p className="sc-warning sc-material-note" role="alert">{placeError}</p>}
        {queuedCount>0 && <p className="sc-material-note" role="status">还有 {queuedCount} 件等待添加。</p>}
        {limitMessage && <p className="sc-warning sc-material-note" role="status">{limitMessage}</p>}
      </div>
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
      {/* 搜索框常驻：不再折叠成图标，也不依赖 focus 展开；对齐 shelf 形态。 */}
      <label className="sc-search-mini is-open">
        <Search size={16} aria-hidden="true"/>
        <input aria-label="搜索全库线上模型" placeholder="搜索" value={query} onChange={event => setQuery(event.target.value)}/>
      </label>
    </div>
    {tagError && <p className="sc-warning sc-material-note" role="alert">{tagError}</p>}
    {armedTag && <p className="sc-note sc-material-note" role="status">点物料角上的标签，把它挂到「{armedTag}」。<button type="button" className="sc-button" onClick={() => setArmedTag('')}>完成挂标签</button></p>}
    {placeError && <p className="sc-warning sc-material-note" role="alert">{placeError}</p>}
    {queuedCount>0 && <p className="sc-material-note" role="status">还有 {queuedCount} 件等待添加。</p>}
    {limitMessage && <p className="sc-warning sc-material-note" role="status">{limitMessage}</p>}
    {/* 最近用过：纯本地，浏览态才挂；搜索/选分类时让位给结果。 */}
    {recentModels.length > 0 && !query.trim() && !bucket && (
      <div className="sc-recent-strip" aria-label="最近用过">
        <span className="sc-recent-label">最近用过</span>
        <ul className="sc-recent-list">
          {recentModels.map(model => {
            const name = onlineModelDisplayName(model);
            return <li className="sc-recent-item" key={model.slug}>
              <button type="button" className="sc-recent-tile" disabled={disabled || (busy !== null && !batchRunning.current)} onClick={() => clickModel(model)} aria-label={`添加${name}`} title={`${model.name}\n拖到场地落下，或点一下再点场地选位`}>
                <span className="sc-recent-thumb">{model.thumb ? <MaterialThumb src={model.thumb}/> : <span className="sc-material-thumb-empty">▦</span>}</span>
                <span className="sc-recent-name">{name}</span>
              </button>
            </li>;
          })}
        </ul>
        <button type="button" className="sc-recent-clear" aria-label="清空最近用过" onClick={() => setRecent(clearRecentSlugs(window.localStorage))}>清空</button>
      </div>
    )}
    <div ref={cards.setRef} onKeyDown={cards.onKeyDown} className="sc-material-rail" role="group" aria-label="线上模型" tabIndex={0}>
      {importSlot}
      <MaterialCreateCell {...(controller ? { controller } : {})} disabled={disabled} variant="tile"/>
      {shown.length === 0 && generatedShown.length === 0 && <p className="sc-muted sc-material-empty">{bucket.startsWith('tag:') ? '还没有物料挂上这个标签。' : '没有匹配的模型。'}</p>}
      {shown.map(model => {
        const name = onlineModelDisplayName(model);
        const favorite = meta.favorites.includes(model.slug);
        const tagged = armedTag ? (meta.assignments[model.slug] ?? []).includes(armedTag) : false;
        return <div className="sc-material-tile" key={model.slug}>
          <button type="button" className="sc-material-card" disabled={disabled || (busy !== null && !batchRunning.current)}
            draggable={!disabled && busy === null} onDragStart={event => {
              if (disabled || busy !== null) { event.preventDefault(); return; }
              event.dataTransfer.setData(CATALOG_DRAG_MIME, `online:${model.slug}`);
              event.dataTransfer.effectAllowed = 'copy';
              const thumb = event.currentTarget.querySelector('.sc-lib-tile-photo img');
              if (thumb) event.dataTransfer.setDragImage(thumb, thumb.clientWidth / 2, thumb.clientHeight / 2);
            }}
            onClick={() => clickModel(model)} aria-label={`添加${name}`} title={`${model.name}\n拖到空间或直接点击添加`}>
            <span className="sc-material-preview">
              <span className="sc-lib-tile-photo">{model.thumb
                ? <MaterialThumb src={model.thumb}/>
                : <span className="sc-material-thumb-empty">暂无预览</span>}</span>
              <PlanIconBadge sticker={planStickerForModel(model, planEntries)}/>
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
        const cloudRecord = !pendingCard && !card.shipped ? cloudRecords[card.id] : undefined;
        const cloudState = cloudRecord ? assetCloudLabel(cloudRecord.state, cloudRecord.progress) : '';
        return <div className="sc-material-tile" key={card.id}>
          <button type="button" className="sc-material-card" disabled={disabled || busy !== null || pendingCard}
            draggable={!disabled && busy !== null ? false : !pendingCard}
            onDragStart={event => {
              if (disabled || busy !== null || pendingCard) { event.preventDefault(); return; }
              event.dataTransfer.setData(CATALOG_DRAG_MIME, `generated:${card.id}`);
              event.dataTransfer.effectAllowed = 'copy';
            }}
            onClick={() => clickGenerated(card)} aria-label={`${pendingCard ? `生成中 ${card.name}` : `添加${card.name}`}${cloudState ? `（${cloudState}）` : ''}`} title={`${card.name}\n拖到空间或直接点击添加${cloudState ? `\n云端状态：${cloudState}` : ''}`}>
            <span className="sc-material-preview">
              <span className="sc-lib-tile-photo">{card.image
                ? <MaterialThumb src={card.image}/>
                : <span className="sc-material-thumb-empty">{busy === card.id ? <Loader2 className="cr-spin" size={14}/> : '生成'}</span>}</span>
              <PlanIconBadge sticker={planStickerForModel({ name: card.name, slug: card.id }, planEntries)}/>
            </span>
            <span className="sc-material-name">{card.name}{cloudState && <small> · {cloudState}</small>}</span>
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
