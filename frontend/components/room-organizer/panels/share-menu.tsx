'use client';

/**
 * 画布工具轨右上角的「发布」。
 * 一张卡片：方案预览、扫码看的只读链接、项目大纲，下面是带走资料的次要入口。
 * 二维码算法用 qrcode（MIT），图标与卡片样式是自写的。
 */
import QRCode from 'qrcode';
import { ClipboardCheck, Copy, ExternalLink, FileDown, Info, Link2, PackageOpen, QrCode, Upload } from '@/components/solid-icons';
import { useEffect, useMemo, useRef, useState } from 'react';
import { describeUnshareableAssets } from '../../../lib/share-snapshot';
import { catalogGroupLabel } from '../lib/catalog-taxonomy';
import { PlanPreview } from './plan-preview';
import { isStructuralMarker } from '../lib/structural-layout';
import type { DisplayUnit, RoomLayout } from '../lib/types';
import { convertMetres } from '../lib/display-units';
import { MaterialSymbol } from './material-symbol';

export interface PublishedLink {
  /** 手机扫码即可打开的只读方案页。 */
  url: string;
  revision: number;
}

export interface ShareMenuActions {
  /** 生成一份可留言的方案页链接。 */
  onIssueReviewLink(): Promise<{ url: string; isCurrent:()=>boolean }>;
  /** 把当前保存的版本发布成只读页，返回扫码链接。 */
  onPublish(): Promise<PublishedLink>;
  /** 打开既有的完整活动交接确认，不切执行模式。 */
  /** 生成自带快照的只读 3D 查看链接（/view#s1=...），并复制到剪贴板。 */
  onGenerateShareLink?(): Promise<{ url: string; name: string; objects: number; droppedAssets: number } | null>;
  onExportHandoff(): void;
  /** 打开既有的云项目 / 素材库，不新开路由。 */
  onOpenMaterials(): void;
  /** 到场清单抽屉。调用方不得因此把 workbenchMode 设成 delivery。 */
  onOpenChecklist(): void;
}

export interface PlanOutline {
  size: string;
  floors: string[];
  itemCount: number;
  categories: { label: string; count: number }[];
  zones: string[];
  variants: { name: string; active: boolean }[];
}

/** 项目大纲：场地、楼层、物料分类、分区、设计簿。只读摘要，不改画布。 */
export function planOutline(layout: RoomLayout, unit: DisplayUnit = 'm'): PlanOutline {
  const floors = layout.floors ?? [];
  const items = floors.flatMap(floor => floor.items.filter(item => !isStructuralMarker(item)));
  const counted = new Map<string, number>();
  for (const item of items) {
    const label = catalogGroupLabel(item.category ?? '');
    counted.set(label, (counted.get(label) ?? 0) + 1);
  }
  const categories = [...counted].map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count).slice(0, 3);
  const zones = floors.flatMap(floor => (floor.zones ?? []).map(zone => zone.name?.trim())).filter((name): name is string => !!name);
  const variants = (layout.designBook?.variants ?? []).map(variant => ({ name: variant.name, active: variant.id === layout.designBook?.activeId }));
  return {
    size: unit === 'ft'
      ? `${feet(layout.width)} × ${feet(layout.height)} ft`
      : `${meters(layout.width)} × ${meters(layout.height)} m`,
    floors: floors.map((floor, index) => floor.name?.trim() || `第 ${index + 1} 层`),
    itemCount: items.length,
    categories,
    zones,
    variants,
  };
}

export function ShareMenu({ actions, layout, lengthUnit = 'm', openRequest = 0, closeSignal = 0, variant = 'rail' }: {
  actions?: ShareMenuActions;
  /** 画布当前方案，用来画预览和大纲。 */
  layout?: RoomLayout;
  /** 大纲尺寸读数跟随的显示单位；底稿仍存米。 */
  lengthUnit?: DisplayUnit;
  /** 旧「评审」入口改道时递增，用来把菜单打开。 */
  openRequest?: number;
  /** 别的工具菜单打开时递增，用来把发布收起。 */
  closeSignal?: number;
  /**
   * P4-c：同一份发布卡片在两种位置复用——工具轨（图标钮）与户外画布右上交付簇（文字胶囊）。
   * 只改触发钮外观与 id，卡片本体与动作完全一致。
   */
  variant?: 'rail' | 'canvas';
}): JSX.Element {
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [published, setPublished] = useState<PublishedLink | null>(null);
  const [qrSvg, setQrSvg] = useState('');
  const [reviewUrl, setReviewUrl] = useState('');
  const reviewGuard=useRef<(()=>boolean)|null>(null);
  const reviewCurrent=()=>{try{return reviewGuard.current?.()===true;}catch{return false;}};
  const [viewerLink, setViewerLink] = useState<{ url: string; name: string; objects: number; droppedAssets: number } | null>(null);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const seenOpen = useRef(openRequest);
  const seenClose = useRef(closeSignal);
  const projectId = layout?.id;
  const outline = useMemo(() => layout ? planOutline(layout, lengthUnit) : null, [layout, lengthUnit]);

  useEffect(() => {
    if (openRequest === seenOpen.current) return;
    seenOpen.current = openRequest;
    if (openRequest > 0) setOpen(true);
  }, [openRequest]);

  useEffect(() => {
    if (closeSignal === seenClose.current) return;
    seenClose.current = closeSignal;
    setOpen(false);
  }, [closeSignal]);

  useEffect(() => {
    setPublished(readPublishedLink(projectId));
    setReviewUrl('');
    reviewGuard.current=null;
  }, [projectId]);

  useEffect(() => {
    if (!open) return undefined;
    const onPointer = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, projectId]);

  useEffect(() => {
    if (!published) { setQrSvg(''); return undefined; }
    let live = true;
    void QRCode.toString(published.url, { type: 'svg', margin: 1, width: 168, errorCorrectionLevel: 'M' })
      .then(svg => { if (live) setQrSvg(svg); })
      .catch(() => { if (live) setQrSvg(''); });
    return () => { live = false; };
  }, [published]);

  const publish = async () => {
    if (!actions || busy) {
      setNotice(actions ? '' : '发布还没接到工作台。');
      return;
    }
    setBusy(true);
    setNotice('');
    try {
      const result = await actions.onPublish();
      setPublished(result);
      writePublishedLink(projectId, result);
      setNotice(`版本 ${result.revision} 已发布。手机扫码看到的就是这一版。`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '发布没有完成。');
    } finally {
      setBusy(false);
    }
  };

  const issue = async () => {
    if (!actions || busy) {
      setNotice(actions ? '' : '分享还没接到工作台。');
      return;
    }
    setBusy(true);
    setNotice('');
    try {
      const result = await actions.onIssueReviewLink();
      if(!result.isCurrent())throw new Error('活动、楼层或方案已变化，旧链接未复制。');
      reviewGuard.current=result.isCurrent;
      setReviewUrl(result.url);
      setNotice('评审链接已生成；请确认当前活动和方案后复制。');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '评审链接没有生成。');
    } finally {
      setBusy(false);
    }
  };

  const generateViewer = async () => {
    if (!actions?.onGenerateShareLink || busy) {
      setNotice('3D 分享还没接到工作台。');
      return;
    }
    const blocked = layout ? describeUnshareableAssets(layout) : null;
    if (blocked && blocked.count > 0) {
      setNotice(blocked.message);
      return;
    }
    setBusy(true);
    setNotice('');
    try {
      const result = await actions.onGenerateShareLink();
      if (!result) return;
      if (result.droppedAssets > 0) {
        setNotice(`有 ${result.droppedAssets} 件资产没有随链接带走，这次链接未采用。请替换为公开素材后再生成。`);
        return;
      }
      setViewerLink(result);
      setNotice(`${result.name} · ${result.objects} 件物件。只读 3D 链接已复制，打开即可转角度查看。`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '只读 3D 链接没有生成。');
    } finally {
      setBusy(false);
    }
  };

  const copyViewer = async () => {
    if (!viewerLink) return;
    const copied = await copyText(viewerLink.url);
    setNotice(copied ? '3D 链接已复制。' : '复制没成功，请从地址栏手动复制。');
  };

  const copyPublished = async () => {
    if (!published) return;
    const copied = await copyText(published.url);
    setNotice(copied ? '链接已复制。' : '复制没成功，请从框里手动复制。');
  };

  const copyReview = async () => {
    if (!reviewUrl) return;
    if(!reviewCurrent()){setReviewUrl('');setNotice('活动、楼层或方案已变化，旧链接未复制。');return;}
    const copied = await copyText(reviewUrl);
    setNotice(copied ? '链接已复制。' : '复制没成功，请从框里手动复制。');
  };

  return <div className="sc-tool-menu" ref={rootRef}>
    {variant === 'canvas' ? (
      <button
        type="button"
        id="tool-outdoor-publish"
        data-testid="outdoor-publish"
        data-tour="publish"
        data-tip="发布这版方案"
        aria-label="发布这版方案"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls="tool-share-menu"
        className={open ? 'is-active' : ''}
        onClick={() => setOpen(current => !current)}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          height: 34,
          padding: '0 16px',
          borderRadius: 999,
          border: '1px solid rgba(20, 20, 22, 0.16)',
          background: '#ffffff',
          color: '#141416',
          fontSize: 12,
          fontWeight: 600,
          cursor: 'pointer',
          fontFamily: 'inherit',
        }}
      >
        发布
      </button>
    ) : (
      <button type="button" id="tool-share" data-tour="publish" data-tip="发布" aria-label="发布" aria-haspopup="dialog" aria-expanded={open} aria-controls="tool-share-menu" className={open ? 'is-active' : ''} onClick={() => setOpen(current => !current)}>
        <MaterialSymbol name="ios_share" />
      </button>
    )}
    {open && <div id="tool-share-menu" className="sc-tool-pop sc-publish-card" role="dialog" aria-label="发布">
      <header className="sc-publish-head">
        <span className="sc-publish-name">{titleOf(layout)}</span>
        <span className={`sc-publish-chip${published ? ' is-live' : ''}`}>{published ? `已发布 v${published.revision}` : '未发布'}</span>
        <details className="sc-publish-tip">
          <summary aria-label="分享说明"><Info size={13} aria-hidden="true"/></summary>
          <p>发布不会通知对方，链接由你自己发。后续编辑不改已发布的版本；评审评论写在打开页面的浏览器里。</p>
        </details>
      </header>

      <section className="sc-publish-shot" aria-label="方案预览">
        {layout ? <PlanPreview layout={layout} ariaLabel={`${titleOf(layout)} 的平面预览`}/> : <p className="sc-publish-note">画布还没就绪。</p>}
        <span className="sc-publish-shot-kicker">方案预览</span>
        {outline && <span className="sc-publish-shot-meta">{outline.size} · {outline.itemCount} 件</span>}
      </section>

      <div className="sc-publish-actions">
        <button type="button" className="sc-publish-primary" disabled={busy} onClick={() => { void publish(); }}>
          <Upload size={15} aria-hidden="true"/><span>{busy ? '正在发布…' : published ? `重新发布版本 ${published.revision + 1}` : '发布当前版本'}</span>
        </button>
        {published && <>
          <button type="button" aria-label="复制链接" data-tip="复制链接" onClick={() => { void copyPublished(); }}><Copy size={15} aria-hidden="true"/></button>
          <a href={published.url} target="_blank" rel="noopener noreferrer" aria-label="打开只读页" data-tip="打开只读页"><ExternalLink size={15} aria-hidden="true"/></a>
        </>}
      </div>
      {notice && <p className="sc-publish-note" role="status">{notice}</p>}

      <section className="sc-publish-row" aria-label="只读 3D 分享方案">
        {viewerLink ? <>
          <button type="button" aria-label="复制 3D 链接" onClick={() => { void copyViewer(); }}><Copy size={14} aria-hidden="true"/><span>复制</span></button>
          <a href={viewerLink.url} target="_blank" rel="noopener noreferrer" aria-label="打开只读 3D 方案"><ExternalLink size={14} aria-hidden="true"/><span>打开</span></a>
          <button type="button" aria-label="重新生成 3D 链接" disabled={busy} onClick={() => { void generateViewer(); }}><MaterialSymbol name="refresh"/><span>重新生成</span></button>
        </> : <button type="button" disabled={busy} onClick={() => { void generateViewer(); }}>
          <MaterialSymbol name="view_in_ar"/><span>{busy ? '正在生成…' : '生成只读 3D 分享方案'}</span>
        </button>}
      </section>

      <section className="sc-publish-qr" aria-label="手机看方案">
        <span className="sc-publish-kicker">手机看方案</span>
        <div className="sc-publish-qr-body">
          {published
            ? (qrSvg
              ? <div className="sc-publish-qr-frame" role="img" aria-label="只读方案二维码" dangerouslySetInnerHTML={{ __html: qrSvg }}/>
              : <div className="sc-publish-qr-frame is-pending" aria-hidden="true"><QrCode size={26}/></div>)
            : <div className="sc-publish-qr-frame is-empty" aria-hidden="true"><QrCode size={26}/></div>}
          <div className="sc-publish-qr-side">
            <p>{published ? `版本 ${published.revision} · 只读，扫码即看` : '发布后这里出二维码，手机扫码看到的就是同一版。'}</p>
          </div>
        </div>
      </section>

      {reviewUrl && reviewCurrent() && <section className="sc-publish-review">
        <label>可留言的方案页
          <input readOnly value={reviewUrl} aria-label="评审链接" onFocus={event => event.currentTarget.select()}/>
        </label>
        <div className="sc-publish-row">
          <button type="button" aria-label="复制评审链接" onClick={() => { void copyReview(); }}><Copy size={14} aria-hidden="true"/><span>复制</span></button>
          <a href={reviewUrl} target="_blank" rel="noopener noreferrer" onClick={event=>{if(!reviewCurrent()){event.preventDefault();setReviewUrl('');setNotice('活动、楼层或方案已变化，旧链接未打开。');}}}><ExternalLink size={14} aria-hidden="true"/><span>打开对方所见</span></a>
        </div>
      </section>}

      {outline && <details className="sc-publish-outline">
        <summary><span>项目大纲</span><small>{outline.size} · {outline.itemCount} 件</small></summary>
        <dl>
          <div><dt>楼层</dt><dd>{outline.floors.join(' / ') || '还没分楼层'}</dd></div>
          <div><dt>物料</dt><dd>{outline.categories.length ? outline.categories.map(entry => `${entry.label} ${entry.count}`).join(' / ') : '还没放物料'}</dd></div>
          <div><dt>分区</dt><dd>{outline.zones.length ? `${outline.zones.length} 个 · ${outline.zones.slice(0, 4).join(' / ')}` : '还没分区'}</dd></div>
          {outline.variants.length > 0 && <div><dt>设计簿</dt><dd>{outline.variants.map(variant => variant.active ? `${variant.name}（当前）` : variant.name).join(' / ')}</dd></div>}
        </dl>
      </details>}

      <div className="sc-publish-more">
        <button type="button" onClick={() => { void issue(); }}><Link2 size={15} aria-hidden="true"/><span>发评审链接</span></button>
        <button type="button" onClick={() => { actions?.onExportHandoff(); setOpen(false); }}><FileDown size={15} aria-hidden="true"/><span>导出交接</span></button>
        <button type="button" onClick={() => { actions?.onOpenMaterials(); setOpen(false); }}><PackageOpen size={15} aria-hidden="true"/><span>打开资料</span></button>
        <button type="button" onClick={() => { actions?.onOpenChecklist(); setOpen(false); }}><ClipboardCheck size={15} aria-hidden="true"/><span>到场清单</span></button>
      </div>
    </div>}
  </div>;
}

const LINK_KEY = 'scendance.publishedLink.v1.';

function readPublishedLink(projectId?: string): PublishedLink | null {
  if (!projectId) return null;
  try {
    const raw = localStorage.getItem(LINK_KEY + projectId);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PublishedLink>;
    return typeof parsed.url === 'string' && parsed.url && typeof parsed.revision === 'number'
      ? { url: parsed.url, revision: parsed.revision }
      : null;
  } catch { return null; }
}

/** 发布链接只在发布时返回一次，记下这一次的链接，重开卡片还能看到二维码。 */
function writePublishedLink(projectId: string | undefined, link: PublishedLink): void {
  if (!projectId) return;
  try { localStorage.setItem(LINK_KEY + projectId, JSON.stringify(link)); } catch { /* 存不下就只保证这一次可复制 */ }
}

function titleOf(layout?: RoomLayout): string {
  return layout?.name?.trim() || '未命名活动';
}

function meters(value: number): string {
  return Number.isFinite(value) && value > 0 ? String(Number(value.toFixed(2))) : '—';
}

function feet(metres: number): string {
  return Number.isFinite(metres) && metres > 0 ? convertMetres(metres, 'ft').toFixed(1) : '—';
}

async function copyText(value: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch { /* 选中输入框，让人自己复制 */ }
  return false;
}
