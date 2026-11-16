'use client';

/**
 * 画布工具轨右上角的「分享」。
 * 2026-11-17 重排（用户拍板 A+B）：一张卡只回答两个问题——这一版发了吗、发出去的在哪。
 *  - 主区两态：未分享 = 预览 + 唯一绿色主动作；已分享 = 二维码 + 链接 + 复制/打开，
 *    再生成退为次级整行。删掉原三条状态行、虚线空二维码框和项目大纲折叠（大纲压成预览下一行元信息）。
 *  - 「分享记录」走 GET /projects/:id/shares（版本/时间/撤回以服务端为准，URL 只在本机有），
 *    没接 actions 时退化为本机日志；旧键 scendance.publishedLink.v1.* 读时迁移。撤回走 DELETE。
 *  - 3D 漫游 / 发评审链接 / 交付物（导出·资料·清单）全部降级为次级入口。
 * 二维码算法用 qrcode（MIT），图标与卡片样式是自写的。
 */
import QRCode from 'qrcode';
import { ClipboardCheck, Copy, ExternalLink, FileDown, Info, Link2, PackageOpen, QrCode, Upload } from '@/components/solid-icons';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { describeUnshareableAssets } from '../../../lib/share-snapshot';
import { catalogGroupLabel } from '../lib/catalog-taxonomy';
import { appendShareRecord, mergeShareRows, readShareRecords, type ServerShare, type ShareRow } from '../lib/share-records';
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
  /** 导出当前效果图 PNG（收编到分享面板；原独立导出钮退役）。 */
  onExportImage?(): Promise<boolean> | void;
  /** 导出物料清单 CSV（户外方案；室内无对应链路则不传）。 */
  onExportCsv?: (() => void) | undefined;
  /** 导出场地几何 GeoJSON（户外方案）。 */
  onExportGeoJson?: (() => void) | undefined;
  /** 导出 PDF 演示稿排版（户外方案）。 */
  onPrintDeck?: (() => void) | undefined;
  /** 拉取服务端分享清单（版本/时间/撤回，权威）；没接时卡片只显示本机记录。 */
  onListShares?(): Promise<ServerShare[]>;
  /** 撤回一条已生成的分享链接；服务端作废 token，只读页立即失效。 */
  onRevokeShare?(shareId: string): Promise<void>;
  /** 抓当前画布真实一帧当预览（户外 2D/3D、室内各走各的抓帧句柄）；抓不到时卡片退回示意图。 */
  onCapturePreview?(): Promise<string | null>;
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
  const [rows, setRows] = useState<ShareRow[]>([]);
  const [recordsOpen, setRecordsOpen] = useState(false);
  const [deliverOpen, setDeliverOpen] = useState(false);
  const [confirmRevoking, setConfirmRevoking] = useState<string | null>(null);
  const [shot, setShot] = useState<string | null>(null);
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
    setRows(mergeShareRows(readShareRecords(projectId), null));
    setRecordsOpen(false);
    setDeliverOpen(false);
    setConfirmRevoking(null);
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

  // 预览：打开卡片时抓当前画布真实一帧（旧方案是拿布局数据重画的示意图，户外方案画出来是空网格）。
  // 只在 open/published 变化时抓一次；动作对象每次渲染都重建，经 ref 取，避免反复抓帧。
  const capturePreviewRef = useRef(actions?.onCapturePreview);
  capturePreviewRef.current = actions?.onCapturePreview;
  useEffect(() => {
    if (!open) { setShot(null); setRecordsOpen(false); setDeliverOpen(false); setConfirmRevoking(null); return undefined; }
    if (published) return undefined;
    const capture = capturePreviewRef.current;
    if (!capture) return undefined;
    let live = true;
    void capture().then(data => { if (live && data) setShot(data); }).catch(() => { /* 抓不到就保留示意图 */ });
    return () => { live = false; };
  }, [open, published]);

  /** 分享记录：本机日志打底，接了服务端清单就以服务端为准；拉取失败静默退回本机。 */
  const refreshRows = useCallback(async () => {
    const local = readShareRecords(projectId);
    if (!actions?.onListShares) { setRows(mergeShareRows(local, null)); return; }
    try {
      setRows(mergeShareRows(local, await actions.onListShares()));
    } catch {
      setRows(mergeShareRows(local, null));
    }
  }, [actions, projectId]);

  const toggleRecords = () => {
    const next = !recordsOpen;
    setRecordsOpen(next);
    setConfirmRevoking(null);
    if (next) void refreshRows();
  };

  const publish = async () => {
    if (!actions || busy) {
      setNotice(actions ? '' : '分享还没接到工作台。');
      return;
    }
    setBusy(true);
    setNotice('');
    try {
      const result = await actions.onPublish();
      setPublished(result);
      writePublishedLink(projectId, result);
      appendShareRecord(projectId, { kind: 'web', url: result.url, revision: result.revision, at: Date.now() });
      await refreshRows();
      setNotice(`已生成 v${result.revision} · 手机扫码打开同一版。`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '链接没有生成。');
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
      appendShareRecord(projectId, { kind: 'viewer', url: result.url, revision: null, at: Date.now() });
      void refreshRows();
      setNotice(`${result.name} · ${result.objects} 件 · 只读 3D 链接已复制，打开即可转角度查看。`);
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

  const copyRow = async (row: ShareRow) => {
    if (!row.url) return;
    const copied = await copyText(row.url);
    setNotice(copied ? '链接已复制。' : '复制没成功，请从地址栏手动复制。');
  };

  /** 两段式撤回：第一下变「确认撤回」，再点才真正作废；刷新记录以服务端状态为准。 */
  const revokeRow = async (row: ShareRow) => {
    if (!actions?.onRevokeShare || !row.shareId) return;
    if (confirmRevoking !== row.key) { setConfirmRevoking(row.key); return; }
    setConfirmRevoking(null);
    try {
      await actions.onRevokeShare(row.shareId);
      setNotice('链接已撤回，对方打开会提示失效。');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '撤回没有成功，请稍后再试。');
    }
    await refreshRows();
  };

  return <div className="sc-tool-menu" ref={rootRef}>
    {variant === 'canvas' ? (
      <button
        type="button"
        id="tool-outdoor-publish"
        data-testid="outdoor-publish"
        data-tour="publish"
        data-tip="分享这版方案"
        aria-label="分享这版方案"
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
        分享
      </button>
    ) : (
      <button type="button" id="tool-share" data-tour="publish" data-tip="分享" aria-label="分享" aria-haspopup="dialog" aria-expanded={open} aria-controls="tool-share-menu" className={open ? 'is-active' : ''} onClick={() => setOpen(current => !current)}>
        <MaterialSymbol name="upload" size={15} />
      </button>
    )}
    {open && <div id="tool-share-menu" className="sc-tool-pop sc-publish-card" role="dialog" aria-label="分享">
      <header className="sc-publish-head">
        <span className="sc-publish-name">{titleOf(layout)}</span>
        <span className={`sc-publish-chip${published ? ' is-live' : ''}`}>{published ? `已分享 v${published.revision}` : '未分享'}</span>
        <details className="sc-publish-tip">
          <summary aria-label="分享说明"><Info size={13} aria-hidden="true"/></summary>
          <p>分享不会通知对方，链接由你自己发。后续编辑不改已生成的版本；评审评论写在打开页面的浏览器里。</p>
        </details>
      </header>

      {published ? <section className="sc-publish-live" aria-label="手机看方案">
        {qrSvg
          ? <div className="sc-publish-qr-frame" role="img" aria-label="只读方案二维码" dangerouslySetInnerHTML={{ __html: qrSvg }}/>
          : <div className="sc-publish-qr-frame is-pending" aria-hidden="true"><QrCode size={26}/></div>}
        <div className="sc-publish-live-side">
          <strong className="sc-publish-live-title">版本 {published.revision} · 只读</strong>
          <p>手机扫码打开同一版；之后的编辑不影响这一版。</p>
          <div className="sc-publish-live-actions">
            <button type="button" aria-label="复制链接" data-tip="复制链接" onClick={() => { void copyPublished(); }}><Copy size={15} aria-hidden="true"/></button>
            <a href={published.url} target="_blank" rel="noopener noreferrer" aria-label="打开只读页" data-tip="打开只读页"><ExternalLink size={15} aria-hidden="true"/></a>
          </div>
        </div>
      </section> : <section className="sc-publish-shot" aria-label="方案预览">
        {shot
          ? <img className="sc-publish-shot-img" src={shot} alt={`${titleOf(layout)} 的当前画布截图`}/>
          : layout ? <PlanPreview layout={layout} ariaLabel={`${titleOf(layout)} 的平面预览`}/> : <p className="sc-publish-note">画布还没就绪。</p>}
        <span className="sc-publish-shot-kicker">方案预览</span>
      </section>}

      {outline && !published && <p className="sc-publish-meta">
        {outline.size} · {outline.itemCount} 件
        {outline.floors.length ? ` · ${outline.floors.join('、')}` : ''}
        {outline.categories.length ? ` · ${outline.categories.map(entry => `${entry.label} ${entry.count}`).join('、')}` : ''}
      </p>}

      {published
        ? <div className="sc-publish-regen">
          <button type="button" disabled={busy} onClick={() => { void publish(); }}>
            {busy ? '正在生成…' : `再生成一个 v${published.revision + 1} 链接`}
          </button>
        </div>
        : <div className="sc-publish-actions">
          <button type="button" className="sc-publish-primary" disabled={busy} onClick={() => { void publish(); }}>
            <Upload size={15} aria-hidden="true"/><span>{busy ? '正在生成…' : '生成分享链接'}</span>
          </button>
        </div>}
      {notice && <p className="sc-publish-note" role="status">{notice}</p>}

      <section className="sc-publish-records" aria-label="分享记录">
        <button type="button" className="sc-publish-disclosure" aria-expanded={recordsOpen} onClick={toggleRecords}>
          <span>分享记录</span><small>{rows.length ? `${rows.length} 条` : '还没有'}</small>
        </button>
        {recordsOpen && (rows.length
          ? <ul className="sc-publish-record-list">
            {rows.map(row => <li key={row.key} className={`sc-publish-record${row.revoked ? ' is-dead' : ''}`}>
              <span className="sc-publish-record-label">{row.kind === 'viewer' ? '3D' : row.revision != null ? `v${row.revision}` : '网页'}</span>
              <span className="sc-publish-record-time">{stampOf(row.at)}</span>
              <span className="sc-publish-record-actions">
                {row.revoked ? <span className="sc-publish-record-dead">已失效</span> : <>
                  {row.url && <button type="button" aria-label="复制" data-tip="复制这条链接" onClick={() => { void copyRow(row); }}><Copy size={12} aria-hidden="true"/></button>}
                  {row.url && <a href={row.url} target="_blank" rel="noopener noreferrer" aria-label="打开" data-tip="打开这条链接"><ExternalLink size={12} aria-hidden="true"/></a>}
                  {row.shareId && actions?.onRevokeShare && <button
                    type="button"
                    className={confirmRevoking === row.key ? 'is-confirm' : ''}
                    disabled={busy}
                    onClick={() => { void revokeRow(row); }}
                  >{confirmRevoking === row.key ? '确认撤回' : '撤回'}</button>}
                  {!row.url && <span className="sc-publish-record-hint">链接只在生成设备上</span>}
                </>}
              </span>
            </li>)}
          </ul>
          : <p className="sc-publish-records-empty">这个项目还没有生成过链接。</p>)}
      </section>

      <section className="sc-publish-alt" aria-label="其他分享方式">
        {viewerLink ? <div className="sc-publish-alt-active" role="group" aria-label="3D 漫游链接">
          <span className="sc-publish-alt-title">3D 漫游</span>
          <div className="sc-publish-row">
            <button type="button" aria-label="复制 3D 链接" onClick={() => { void copyViewer(); }}><Copy size={14} aria-hidden="true"/><span>复制</span></button>
            <a href={viewerLink.url} target="_blank" rel="noopener noreferrer" aria-label="打开只读 3D 方案"><ExternalLink size={14} aria-hidden="true"/><span>打开</span></a>
            <button type="button" aria-label="重新生成 3D 链接" disabled={busy} onClick={() => { void generateViewer(); }}><MaterialSymbol name="refresh"/><span>重新生成</span></button>
          </div>
        </div> : <button type="button" className="sc-publish-alt-entry" aria-label="3D 漫游" disabled={busy} onClick={() => { void generateViewer(); }}>
          <MaterialSymbol name="view_in_ar"/><span>{busy ? '正在生成…' : '3D 漫游'}</span><small>可转视角的只读链接</small>
        </button>}
        <button type="button" className="sc-publish-alt-entry" aria-label="发评审链接" disabled={busy} onClick={() => { void issue(); }}>
          <Link2 size={15} aria-hidden="true"/><span>发评审链接</span><small>对方能在网页上留言</small>
        </button>
        {reviewUrl && reviewCurrent() && <section className="sc-publish-review">
          <label>可留言的方案页
            <input readOnly value={reviewUrl} aria-label="评审链接" onFocus={event => event.currentTarget.select()}/>
          </label>
          <div className="sc-publish-row">
            <button type="button" aria-label="复制评审链接" onClick={() => { void copyReview(); }}><Copy size={14} aria-hidden="true"/><span>复制</span></button>
            <a href={reviewUrl} target="_blank" rel="noopener noreferrer" onClick={event=>{if(!reviewCurrent()){event.preventDefault();setReviewUrl('');setNotice('活动、楼层或方案已变化，旧链接未打开。');}}}><ExternalLink size={14} aria-hidden="true"/><span>打开对方所见</span></a>
          </div>
        </section>}
      </section>

      <section className="sc-publish-deliver" aria-label="交付物">
        <button type="button" className="sc-publish-disclosure" aria-expanded={deliverOpen} onClick={() => setDeliverOpen(current => !current)}>
          <span>交付物</span><small>导出与资料</small>
        </button>
        {deliverOpen && <div className="sc-publish-more">
          {actions?.onExportImage && <button type="button" onClick={() => { void actions.onExportImage?.(); setOpen(false); }}><MaterialSymbol name="image" size={15} /><span>导出效果图</span></button>}
          {actions?.onExportCsv && <button type="button" onClick={() => { actions?.onExportCsv?.(); setOpen(false); }}><FileDown size={15} aria-hidden="true"/><span>导出物料清单 CSV</span></button>}
          {actions?.onExportGeoJson && <button type="button" onClick={() => { actions?.onExportGeoJson?.(); setOpen(false); }}><FileDown size={15} aria-hidden="true"/><span>导出场地几何 GeoJSON</span></button>}
          {actions?.onPrintDeck && <button type="button" onClick={() => { actions?.onPrintDeck?.(); setOpen(false); }}><FileDown size={15} aria-hidden="true"/><span>导出演示稿 PDF</span></button>}
          <button type="button" onClick={() => { actions?.onExportHandoff(); setOpen(false); }}><FileDown size={15} aria-hidden="true"/><span>导出交接</span></button>
          <button type="button" onClick={() => { actions?.onOpenMaterials(); setOpen(false); }}><PackageOpen size={15} aria-hidden="true"/><span>打开资料</span></button>
          <button type="button" onClick={() => { actions?.onOpenChecklist(); setOpen(false); }}><ClipboardCheck size={15} aria-hidden="true"/><span>到场清单</span></button>
        </div>}
      </section>
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

/** 记录时间：今天只给时分，跨天给「月-日 时:分」，未知给「—」。 */
function stampOf(at: number): string {
  if (!at || !Number.isFinite(at)) return '—';
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return '—';
  const pad = (value: number) => String(value).padStart(2, '0');
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  if (date.toDateString() === new Date().toDateString()) return time;
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${time}`;
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
