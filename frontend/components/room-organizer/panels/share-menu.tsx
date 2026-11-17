'use client';

/**
 * 画布工具轨右上角的「分享」。
 * 先按受众分栏（发给客户 / 送评审方 / 内部协作），每栏里是方案网页和 3D 漫游。
 * 左右方向键、Home、End 切换分栏；当前栏 aria-selected 为 true，其余为 false，只有当前栏进 Tab 序。
 * 评审在送评审方与内部协作；交接、资料、到场清单只在内部协作。
 * 导出勾选（PNG / CSV / GeoJSON）在发给客户和内部协作，按钮在卡片底部。
 * 发布后右侧出预览和二维码。状态行是方案网页 / 3D 漫游 / 评审。
 * 方案网页未发布、漫游未生成时，当前受众栏说明下一步，样式沿用说明文字。
 * 二维码算法用 qrcode（MIT），图标与卡片样式沿用现有 token。
 * 二维码只用已发布链接在本地绘制：绘制中是占位，画不出来时留下链接，可再画一次。
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
  /** 导出当前效果图 PNG（收编到分享面板；原独立导出钮退役）。 */
  onExportImage?(): Promise<boolean> | void;
  /** 导出物料清单 CSV（户外方案；室内无对应链路则不传）。 */
  onExportCsv?: (() => void) | undefined;
  /** 导出场地几何 GeoJSON（户外方案）。 */
  onExportGeoJson?: (() => void) | undefined;
  /** 导出 PDF 演示稿排版（户外方案）。 */
  onPrintDeck?: (() => void) | undefined;
}

export interface PlanOutline {
  size: string;
  floors: string[];
  itemCount: number;
  categories: { label: string; count: number }[];
  zones: string[];
  variants: { name: string; active: boolean }[];
}

type ShareAudience = 'client' | 'review' | 'internal';
type ShareExportId = 'png' | 'csv' | 'geojson';

/**
 * 分享卡「导出 N 项资料」接到哪条既有导出。
 * 2D 地图的 PNG 走规划快照（比例尺 / 指北 / 图例）；3D 仍抓当前画面。
 * CSV / GeoJSON / PDF 在 2D 出镜，或覆盖层保活且已有方案时都可下发。
 */
export function shareExportPlan(input: {
  outdoor2D: boolean;
  outdoor3d: boolean;
  hasPlan: boolean;
}): { png: 'plan' | 'frame3d' | 'indoor'; files: boolean } {
  const files = input.outdoor2D || input.hasPlan;
  if (input.outdoor3d && !input.outdoor2D) return { png: 'frame3d', files };
  if (input.outdoor2D) return { png: 'plan', files };
  return { png: 'indoor', files: input.hasPlan };
}

const SHARE_AUDIENCES: { id: ShareAudience; label: string; note: string; emptyWeb: string; emptyWalk: string }[] = [
  {
    id: 'client',
    label: '发给客户',
    note: '对外交付：对方只读查看，不改动本地方案',
    emptyWeb: '未发布。发布当前版本后，把方案网页发给客户，对方只能只读查看。',
    emptyWalk: '未生成漫游。生成漫游链接后，再把这一版漫游发给客户。',
  },
  {
    id: 'review',
    label: '送评审方',
    note: '送评审方：可在方案上落钉、完成评审，回执收进 Bingo',
    emptyWeb: '未发布。发布当前版本后，评审方看到的是这一版只读方案网页。',
    emptyWalk: '未生成漫游。生成漫游链接后，评审方看到的是这一版漫游。',
  },
  {
    id: 'internal',
    label: '内部协作',
    note: '内部协作：含工作资料与导出，仅团队内部使用',
    emptyWeb: '未发布。发布当前版本后，团队内部打开的是这一版只读方案网页。',
    emptyWalk: '未生成漫游。生成漫游链接后，只在团队内传这一版漫游。',
  },
];

/** 当前受众在方案网页未发布、漫游未生成时看到的下一步。已发布 / 已生成则不显示。 */
export function shareAudienceEmptyCopy(audience: ShareAudience): { web: string; walk: string } {
  const item = SHARE_AUDIENCES.find(entry => entry.id === audience) ?? SHARE_AUDIENCES[0]!;
  return { web: item.emptyWeb, walk: item.emptyWalk };
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
  const [qrReadyKey, setQrReadyKey] = useState('');
  const [qrFailedKey, setQrFailedKey] = useState('');
  const [qrAttempt, setQrAttempt] = useState(0);
  const [reviewUrl, setReviewUrl] = useState('');
  const reviewGuard=useRef<(()=>boolean)|null>(null);
  const reviewCurrent=()=>{try{return reviewGuard.current?.()===true;}catch{return false;}};
  const [viewerLink, setViewerLink] = useState<{ url: string; name: string; objects: number; droppedAssets: number } | null>(null);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState<null | 'publish' | 'review' | 'viewer'>(null);
  const [audience, setAudience] = useState<ShareAudience>('client');
  const audienceRef = useRef(audience);
  audienceRef.current = audience;
  const [exportChecked, setExportChecked] = useState<Record<ShareExportId, boolean>>({ png: true, csv: false, geojson: false });
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
    if (!published) {
      setQrSvg('');
      setQrReadyKey('');
      setQrFailedKey('');
      return undefined;
    }
    const key = publishedQrKey(published);
    const publishedNote = `版本 ${published.revision} 链接已生成。`;
    let live = true;
    setQrSvg('');
    setQrReadyKey('');
    setQrFailedKey('');
    const markFailed = () => {
      setQrSvg('');
      setQrReadyKey('');
      setQrFailedKey(key);
      setNotice(current => current.startsWith(publishedNote)
        ? `${publishedNote}二维码没有生成，可以复制或打开。`
        : current);
    };
    // 只拿这一次的链接在本地画，失败也不再请求发布接口。
    void QRCode.toString(published.url, { type: 'svg', margin: 1, width: 168, errorCorrectionLevel: 'M' })
      .then(svg => {
        if (!live) return;
        if (typeof svg !== 'string' || svg.trim() === '') {
          markFailed();
          return;
        }
        setQrSvg(svg);
        setQrReadyKey(key);
        setNotice(current => current.startsWith(publishedNote)
          ? `${publishedNote}手机扫码看到的就是这一版。`
          : current);
      })
      .catch(() => {
        if (!live) return;
        markFailed();
      });
    return () => { live = false; };
  }, [published, qrAttempt]);

  const publish = async () => {
    if (!actions || busy) {
      setNotice(actions ? '' : '分享还没接到工作台。');
      return;
    }
    setBusy('publish');
    setNotice('');
    try {
      const result = await actions.onPublish();
      setPublished(result);
      writePublishedLink(projectId, result);
      setNotice(`版本 ${result.revision} 链接已生成。手机扫码看到的就是这一版。`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '链接没有生成。');
    } finally {
      setBusy(null);
    }
  };

  const issue = async () => {
    if (!actions || busy) {
      setNotice(actions ? '' : '分享还没接到工作台。');
      return;
    }
    setBusy('review');
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
      setBusy(null);
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
    setBusy('viewer');
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
      setBusy(null);
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

  // 链路就绪汇总：方案网页 / 只读 3D / 评审三条各自是否已生成，供状态行总览。
  const webLive = !!published;
  const publishedKey = published ? publishedQrKey(published) : '';
  const qrPhase: 'pending' | 'ready' | 'failed' =
    published && qrReadyKey === publishedKey && qrSvg
      ? 'ready'
      : published && qrFailedKey === publishedKey
        ? 'failed'
        : 'pending';
  const viewerLive = !!viewerLink;
  const reviewLive = !!(reviewUrl && reviewCurrent());
  const audienceNote = SHARE_AUDIENCES.find(item => item.id === audience)?.note ?? '';
  const emptyCopy = shareAudienceEmptyCopy(audience);
  const showReview = audience === 'review' || audience === 'internal';
  const showExport = audience !== 'review';
  const exportChoices: { id: ShareExportId; label: string; run: () => void }[] = [];
  if (actions?.onExportImage) exportChoices.push({ id: 'png', label: 'PNG', run: () => { void actions.onExportImage?.(); } });
  if (actions?.onExportCsv) exportChoices.push({ id: 'csv', label: 'CSV', run: () => { actions.onExportCsv?.(); } });
  if (actions?.onExportGeoJson) exportChoices.push({ id: 'geojson', label: 'GeoJSON', run: () => { actions.onExportGeoJson?.(); } });
  const selectedExports = exportChoices.filter(item => exportChecked[item.id]);
  const exportSelected = () => {
    if (!selectedExports.length) return;
    for (const item of selectedExports) item.run();
    setOpen(false);
  };

  const onAudienceKeyDown = (event: { key: string; altKey: boolean; ctrlKey: boolean; metaKey: boolean; currentTarget: HTMLElement; preventDefault(): void; stopPropagation(): void }) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const count = SHARE_AUDIENCES.length;
    const index = SHARE_AUDIENCES.findIndex(item => item.id === audienceRef.current);
    const from = index < 0 ? 0 : index;
    const nextIndex = event.key === 'ArrowRight' ? (from + 1) % count
      : event.key === 'ArrowLeft' ? (from - 1 + count) % count
      : event.key === 'Home' ? 0
      : event.key === 'End' ? count - 1
      : -1;
    if (nextIndex < 0) return;
    event.preventDefault();
    event.stopPropagation();
    const next = SHARE_AUDIENCES[nextIndex]!;
    audienceRef.current = next.id;
    setAudience(next.id);
    event.currentTarget.querySelector<HTMLButtonElement>(`#share-audience-${next.id}`)?.focus();
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
    {open && <div id="tool-share-menu" className={`sc-tool-pop sc-publish-card${published ? ' is-published' : ''}`} role="dialog" aria-label="分享">
      <header className="sc-publish-head">
        <span className="sc-publish-name">{titleOf(layout)}</span>
        <span className={`sc-publish-chip${published ? ' is-live' : ''}`}>{published ? `已分享 v${published.revision}` : '未分享'}</span>
        <details className="sc-publish-tip">
          <summary aria-label="分享说明"><Info size={13} aria-hidden="true"/></summary>
          <p>分享不会通知对方，链接由你自己发。后续编辑不改已生成的版本；评审评论写在打开页面的浏览器里。</p>
        </details>
      </header>

      <div className="sc-publish-row" role="tablist" aria-label="交付对象" onKeyDown={onAudienceKeyDown}>
        {SHARE_AUDIENCES.map(item => {
          const selected = audience === item.id;
          return <button key={item.id} type="button" id={`share-audience-${item.id}`} role="tab" aria-selected={selected} tabIndex={selected ? 0 : -1} className={selected ? 'is-active' : ''} onClick={() => setAudience(item.id)}>
            {item.label}
          </button>;
        })}
      </div>
      <p className="sc-publish-note">{audienceNote}</p>

      <div className="sc-publish-split">
        <div className="sc-publish-main">
          <section aria-label="方案网页">
            <span className="sc-publish-kicker">方案网页</span>
            <div className="sc-publish-actions">
              <button type="button" className="sc-publish-primary" disabled={!!busy} onClick={() => { void publish(); }}>
                <Upload size={15} aria-hidden="true"/><span>{busy === 'publish' ? '正在生成…' : '发布当前版本'}</span>
              </button>
              <button type="button" aria-label="复制链接" data-tip="复制链接" disabled={!published} onClick={() => { void copyPublished(); }}><Copy size={15} aria-hidden="true"/><span>复制链接</span></button>
              {published
                ? <a href={published.url} target="_blank" rel="noopener noreferrer" aria-label="打开方案网页"><ExternalLink size={15} aria-hidden="true"/><span>打开</span></a>
                : <button type="button" aria-label="打开方案网页" disabled><ExternalLink size={15} aria-hidden="true"/><span>打开</span></button>}
            </div>
            {!webLive && <p className="sc-publish-note">{emptyCopy.web}</p>}
          </section>

          <section aria-label="3D 漫游">
            <span className="sc-publish-kicker">3D 漫游</span>
            <div className="sc-publish-actions" style={{ flexWrap: 'wrap' }}>
              <button type="button" disabled={!!busy} onClick={() => { void generateViewer(); }}><MaterialSymbol name="view_in_ar"/><span>{busy === 'viewer' && !viewerLink ? '正在生成…' : '生成漫游链接'}</span></button>
              <button type="button" aria-label="复制漫游链接" disabled={!viewerLink} onClick={() => { void copyViewer(); }}><Copy size={14} aria-hidden="true"/><span>复制</span></button>
              {viewerLink
                ? <a href={viewerLink.url} target="_blank" rel="noopener noreferrer" aria-label="打开漫游"><ExternalLink size={14} aria-hidden="true"/><span>打开</span></a>
                : <button type="button" aria-label="打开漫游" disabled><ExternalLink size={14} aria-hidden="true"/><span>打开</span></button>}
              <button type="button" aria-label="重新生成漫游链接" disabled={!viewerLink || !!busy} onClick={() => { void generateViewer(); }}><MaterialSymbol name="refresh"/><span>{busy === 'viewer' && viewerLink ? '正在生成…' : '重新生成'}</span></button>
            </div>
            {!viewerLive && <p className="sc-publish-note">{emptyCopy.walk}</p>}
          </section>

          {showReview && <section aria-label="送审">
            <span className="sc-publish-kicker">评审</span>
            <div className="sc-publish-row">
              <button type="button" disabled={!!busy} onClick={() => { void issue(); }}><Link2 size={15} aria-hidden="true"/><span>发评审链接</span></button>
            </div>
            {reviewUrl && reviewCurrent() && <>
              <label>可留言的方案页
                <input readOnly value={reviewUrl} aria-label="评审链接" onFocus={event => event.currentTarget.select()}/>
              </label>
              <div className="sc-publish-row">
                <button type="button" aria-label="复制评审链接" onClick={() => { void copyReview(); }}><Copy size={14} aria-hidden="true"/><span>复制</span></button>
                <a href={reviewUrl} target="_blank" rel="noopener noreferrer" onClick={event=>{if(!reviewCurrent()){event.preventDefault();setReviewUrl('');setNotice('活动、楼层或方案已变化，旧链接未打开。');}}}><ExternalLink size={14} aria-hidden="true"/><span>打开对方所见</span></a>
              </div>
            </>}
          </section>}

          {notice && <p className="sc-publish-note" role="status">{notice}</p>}

          {audience === 'internal' && <div className="sc-publish-more">
            <button type="button" onClick={() => { actions?.onExportHandoff(); setOpen(false); }}><FileDown size={15} aria-hidden="true"/><span>导出交接</span></button>
            <button type="button" onClick={() => { actions?.onOpenMaterials(); setOpen(false); }}><PackageOpen size={15} aria-hidden="true"/><span>打开资料</span></button>
            <button type="button" onClick={() => { actions?.onOpenChecklist(); setOpen(false); }}><ClipboardCheck size={15} aria-hidden="true"/><span>到场清单</span></button>
          </div>}
        </div>

        {published && <div className="sc-publish-aside">
          <section className="sc-publish-shot" aria-label="方案预览">
            {layout ? <PlanPreview layout={layout} ariaLabel={`${titleOf(layout)} 的平面预览`}/> : <p className="sc-publish-note">画布还没就绪。</p>}
            <span className="sc-publish-shot-kicker">方案预览</span>
            {outline && <span className="sc-publish-shot-meta">{outline.size} · {outline.itemCount} 件</span>}
          </section>
          <section className="sc-publish-qr" aria-label="手机看方案" aria-busy={qrPhase === 'pending'}>
            <span className="sc-publish-kicker">手机看方案</span>
            <div className="sc-publish-qr-body">
              {qrPhase === 'ready'
                ? <div className="sc-publish-qr-frame" role="img" aria-label="只读方案二维码" dangerouslySetInnerHTML={{ __html: qrSvg }}/>
                : <div className={`sc-publish-qr-frame${qrPhase === 'failed' ? ' is-failed' : ' is-pending'}`} aria-hidden="true"><QrCode size={26}/></div>}
              <div className="sc-publish-qr-side">
                <p className={qrPhase === 'failed' ? 'sc-publish-qr-fail' : undefined}>
                  {qrPhase === 'ready'
                    ? `版本 ${published.revision} · 只读，扫码即看`
                    : qrPhase === 'failed'
                      ? '二维码没有生成。链接可以复制或打开。'
                      : '正在生成二维码。'}
                </p>
              </div>
            </div>
            {qrPhase === 'failed' && <div className="sc-publish-actions">
              <button type="button" onClick={() => setQrAttempt(current => current + 1)}>再画一次</button>
            </div>}
          </section>
        </div>}
      </div>

      <section className="sc-publish-status" aria-label="分享链路状态">
        <span className={`sc-publish-status-item${webLive ? ' is-live' : ''}`}>
          <i className="sc-publish-status-dot" aria-hidden="true"/>
          <span className="sc-publish-status-name">方案网页</span>
          <span className="sc-publish-status-state">{webLive ? `已分享 v${published!.revision}` : '未发布'}</span>
        </span>
        <span className={`sc-publish-status-item${viewerLive ? ' is-live' : ''}`}>
          <i className="sc-publish-status-dot" aria-hidden="true"/>
          <span className="sc-publish-status-name">3D 漫游</span>
          <span className="sc-publish-status-state">{viewerLive ? `已生成 · ${viewerLink!.objects} 件物件` : '未生成漫游'}</span>
        </span>
        <span className={`sc-publish-status-item${reviewLive ? ' is-live' : ''}`}>
          <i className="sc-publish-status-dot" aria-hidden="true"/>
          <span className="sc-publish-status-name">评审</span>
          <span className="sc-publish-status-state">{reviewLive ? '已发评审' : '未送审'}</span>
        </span>
      </section>

      {outline && <details className="sc-publish-outline">
        <summary><span>项目大纲</span><small>{outline.size} · {outline.itemCount} 件</small></summary>
        <dl>
          <div><dt>楼层</dt><dd>{outline.floors.join(' / ') || '还没分楼层'}</dd></div>
          <div><dt>物料</dt><dd>{outline.categories.length ? outline.categories.map(entry => `${entry.label} ${entry.count}`).join(' / ') : '还没放物料'}</dd></div>
          <div><dt>分区</dt><dd>{outline.zones.length ? `${outline.zones.length} 个 · ${outline.zones.slice(0, 4).join(' / ')}` : '还没分区'}</dd></div>
          {outline.variants.length > 0 && <div><dt>设计簿</dt><dd>{outline.variants.map(variant => variant.active ? `${variant.name}（当前）` : variant.name).join(' / ')}</dd></div>}
        </dl>
      </details>}

      {showExport && (exportChoices.length > 0 || actions?.onPrintDeck) && <section aria-label="导出资料">
        <span className="sc-publish-kicker">导出资料</span>
        {exportChoices.length > 0 && <div role="group" aria-label="导出勾选" style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
          {exportChoices.map(item => (
            <label key={item.id} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--wk-ink)' }}>
              <input type="checkbox" checked={exportChecked[item.id]} onChange={() => setExportChecked(current => ({ ...current, [item.id]: !current[item.id] }))}/>
              {item.label}
            </label>
          ))}
        </div>}
        {exportChoices.length > 0 && <div className="sc-publish-actions">
          <button type="button" className="sc-publish-primary" disabled={selectedExports.length === 0} onClick={exportSelected}>
            <FileDown size={15} aria-hidden="true"/><span>{`导出 ${selectedExports.length} 项资料`}</span>
          </button>
        </div>}
        {actions?.onPrintDeck && <button type="button" onClick={() => { actions.onPrintDeck?.(); setOpen(false); }}><FileDown size={15} aria-hidden="true"/><span>导出演示稿 PDF</span></button>}
      </section>}
    </div>}
  </div>;
}

const LINK_KEY = 'scendance.publishedLink.v1.';

function publishedQrKey(link: PublishedLink): string {
  return `${link.revision}\n${link.url}`;
}

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
