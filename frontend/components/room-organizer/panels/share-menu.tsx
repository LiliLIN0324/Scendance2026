'use client';

/**
 * 画布工具轨右上角的「发布」。
 * 一张卡片：方案预览、扫码看的只读链接、项目大纲，下面是带走资料的次要入口。
 * 二维码算法用 qrcode（MIT），图标与卡片样式是自写的。
 */
import QRCode from 'qrcode';
import { ClipboardCheck, FileDown, Link2, PackageOpen, QrCode, Share2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { catalogGroupLabel } from '../lib/catalog-taxonomy';
import { isStructuralMarker } from '../lib/structural-layout';
import type { RoomLayout } from '../lib/types';

export interface PublishedLink {
  /** 手机扫码即可打开的只读方案页。 */
  url: string;
  revision: number;
}

export interface ShareMenuActions {
  /** 生成一份可留言的方案页链接。 */
  onIssueReviewLink(): Promise<{ url: string }>;
  /** 把当前保存的版本发布成只读页，返回扫码链接。 */
  onPublish(): Promise<PublishedLink>;
  /** 打开既有的完整活动交接确认，不切执行模式。 */
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
export function planOutline(layout: RoomLayout): PlanOutline {
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
    size: `${meters(layout.width)} × ${meters(layout.height)} m`,
    floors: floors.map((floor, index) => floor.name?.trim() || `第 ${index + 1} 层`),
    itemCount: items.length,
    categories,
    zones,
    variants,
  };
}

export function ShareMenu({ actions, layout, openRequest = 0, closeSignal = 0 }: {
  actions?: ShareMenuActions;
  /** 画布当前方案，用来画预览和大纲。 */
  layout?: RoomLayout;
  /** 旧「评审」入口改道时递增，用来把菜单打开。 */
  openRequest?: number;
  /** 别的工具菜单打开时递增，用来把发布收起。 */
  closeSignal?: number;
}): JSX.Element {
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [published, setPublished] = useState<PublishedLink | null>(null);
  const [qrSvg, setQrSvg] = useState('');
  const [reviewUrl, setReviewUrl] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const seenOpen = useRef(openRequest);
  const seenClose = useRef(closeSignal);
  const projectId = layout?.id;
  const outline = useMemo(() => layout ? planOutline(layout) : null, [layout]);

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
      setReviewUrl(result.url);
      const copied = await copyText(result.url);
      setNotice(copied ? '链接已复制。对方打开即可看平面并留言。' : '链接已生成。请从框里手动复制。');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '评审链接没有生成。');
    } finally {
      setBusy(false);
    }
  };

  const copyPublished = async () => {
    if (!published) return;
    const copied = await copyText(published.url);
    setNotice(copied ? '链接已复制。' : '复制没成功，请从框里手动复制。');
  };

  const copyReview = async () => {
    if (!reviewUrl) return;
    const copied = await copyText(reviewUrl);
    setNotice(copied ? '链接已复制。' : '复制没成功，请从框里手动复制。');
  };

  return <div className="sc-tool-menu" ref={rootRef}>
    <button type="button" id="tool-share" data-tip="发布" aria-label="发布" aria-haspopup="dialog" aria-expanded={open} aria-controls="tool-share-menu" className={open ? 'is-active' : ''} onClick={() => setOpen(current => !current)}>
      <Share2 size={24} aria-hidden="true"/>
    </button>
    {open && <div id="tool-share-menu" className="sc-tool-pop sc-publish-card" role="dialog" aria-label="发布">
      <section className="sc-publish-preview" aria-label="方案预览">
        <span className="sc-publish-kicker">方案预览</span>
        {layout ? <PlanPreview layout={layout}/> : <p className="sc-publish-note">画布还没就绪。</p>}
        <strong>{titleOf(layout)}</strong>
        {outline && <small>{outline.size} · {outline.itemCount} 件物料 · {outline.floors.length} 层</small>}
      </section>

      <button type="button" className="sc-publish-primary" disabled={busy} onClick={() => { void publish(); }}>{busy ? '正在发布…' : published ? `重新发布版本 ${published.revision + 1}` : '发布当前版本'}</button>
      {notice && <p className="sc-publish-note" role="status">{notice}</p>}

      <section className="sc-publish-qr" aria-label="扫码看方案">
        <span className="sc-publish-kicker">手机看方案</span>
        {published
          ? <>
            {qrSvg
              ? <div className="sc-publish-qr-frame" role="img" aria-label="只读方案二维码" dangerouslySetInnerHTML={{ __html: qrSvg }}/>
              : <div className="sc-publish-qr-frame is-pending" aria-hidden="true"><QrCode size={26}/></div>}
            <p className="sc-publish-note">版本 {published.revision} · 只读，扫完即看</p>
            <div className="sc-publish-row">
              <button type="button" onClick={() => { void copyPublished(); }}>复制链接</button>
              <a href={published.url} target="_blank" rel="noopener noreferrer">打开只读页</a>
            </div>
          </>
          : <>
            <div className="sc-publish-qr-frame is-empty" aria-hidden="true"><QrCode size={26}/></div>
            <p className="sc-publish-note">发布后这里出二维码，手机扫码看到的就是同一版。</p>
          </>}
      </section>

      {outline && <section className="sc-publish-outline" aria-label="项目大纲">
        <span className="sc-publish-kicker">项目大纲</span>
        <dl>
          <div><dt>场地</dt><dd>{outline.size}</dd></div>
          <div><dt>楼层</dt><dd>{outline.floors.join(' / ') || '还没分楼层'}</dd></div>
          <div><dt>物料</dt><dd>{outline.itemCount} 件{outline.categories.length ? ` · ${outline.categories.map(entry => `${entry.label} ${entry.count}`).join(' / ')}` : ''}</dd></div>
          <div><dt>分区</dt><dd>{outline.zones.length ? `${outline.zones.length} 个 · ${outline.zones.slice(0, 4).join(' / ')}` : '还没分区'}</dd></div>
          {outline.variants.length > 0 && <div><dt>设计簿</dt><dd>{outline.variants.map(variant => variant.active ? `${variant.name}（当前）` : variant.name).join(' / ')}</dd></div>}
        </dl>
      </section>}

      {reviewUrl && <>
        <label>可留言的方案页
          <input readOnly value={reviewUrl} aria-label="评审链接" onFocus={event => event.currentTarget.select()}/>
        </label>
        <div className="sc-publish-row">
          <button type="button" onClick={() => { void copyReview(); }}>复制链接</button>
          <a href={reviewUrl} target="_blank" rel="noopener noreferrer">打开对方所见</a>
        </div>
      </>}

      <span className="sc-more-sep" aria-hidden="true"/>
      <div className="sc-publish-more">
        <button type="button" onClick={() => { void issue(); }}><Link2 size={15} aria-hidden="true"/><span>发评审链接</span></button>
        <button type="button" onClick={() => { actions?.onExportHandoff(); setOpen(false); }}><FileDown size={15} aria-hidden="true"/><span>导出交接</span></button>
        <button type="button" onClick={() => { actions?.onOpenMaterials(); setOpen(false); }}><PackageOpen size={15} aria-hidden="true"/><span>打开资料</span></button>
        <button type="button" onClick={() => { actions?.onOpenChecklist(); setOpen(false); }}><ClipboardCheck size={15} aria-hidden="true"/><span>到场清单</span></button>
      </div>
      <p className="sc-publish-note">发布不会通知对方，链接由你自己发。后续编辑不改已发布的版本；评审评论写在打开页面的浏览器里。</p>
    </div>}
  </div>;
}

/** 按米缩放的平面缩略图；结构标记不画，物料按自身颜色。 */
function PlanPreview({ layout }: { layout: RoomLayout }): JSX.Element {
  const width = Math.max(layout.width || 0, 0.1);
  const depth = Math.max(layout.height || 0, 0.1);
  const floor = layout.floors?.[0];
  const items = (floor?.items ?? []).filter(item => !isStructuralMarker(item));
  return <svg className="sc-publish-plan" viewBox={`0 0 ${width} ${depth}`} role="img" aria-label={`${titleOf(layout)} 的平面预览`} preserveAspectRatio="xMidYMid meet">
    <rect x={0} y={0} width={width} height={depth} className="sc-publish-plan-ground"/>
    {(floor?.zones ?? []).map(zone => <rect key={zone.id} x={zone.x + width / 2} y={zone.z + depth / 2} width={Math.max(zone.w, 0.02)} height={Math.max(zone.d, 0.02)} fill={zone.color} opacity={0.16}/>)}
    {items.map(item => {
      const itemWidth = Math.max(item.width || 0, 0.02);
      const itemDepth = Math.max(item.depth || 0, 0.02);
      const x = (item.position?.x ?? 0) + width / 2 - itemWidth / 2;
      const y = (item.position?.z ?? 0) + depth / 2 - itemDepth / 2;
      const turn = Number.isFinite(item.rotation) ? (item.rotation ?? 0) * 180 / Math.PI : 0;
      return <rect key={item.id} x={x} y={y} width={itemWidth} height={itemDepth} rx={Math.min(itemWidth, itemDepth) * 0.12}
        fill={item.color || '#9aa39c'} opacity={0.92} transform={turn ? `rotate(${turn} ${x + itemWidth / 2} ${y + itemDepth / 2})` : undefined}/>;
    })}
  </svg>;
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

async function copyText(value: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch { /* 选中输入框，让人自己复制 */ }
  return false;
}
