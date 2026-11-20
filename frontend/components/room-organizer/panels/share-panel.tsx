'use client';

import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { BingoStatusMark } from './bingo-status-mark';
import type { BingoPhase } from '../lib/bingo-status';

/**
 * 分享钮弹出的页签：分享 / 发布 / 案例 / 导出。
 * 版式按 2026-11-17 锁定稿：白底卡片、墨色选中页签、绿只留给未发布的主按钮。
 * 已发布只留链接行上的「复制」和二维码小键；二维码本体在小键点开后的浮层里。
 * 「案例」页签（2026-11-20，任务 C）只在宿主传入 controller 时出现，
 * 内容由 CaseAdminSection 提供（官方案例的草稿/发布/历史/下架）。
 *
 * P0-B / P1-B（2026-11-20 发布闭环）：发布页新增预检状态、阻塞清单、发布摘要、
 * 反馈拆分与发布记录管理。这些全部走可选 props，由宿主计算后传入；不传时
 * 发布页保持旧版渲染，普通发布与完整分享的历史行为不变。
 */
export type ShareTab = 'share' | 'publish' | 'export' | 'cases';
export type ShareExportIcon = 'image' | 'list' | 'site';

export interface ShareExportEntry {
  id: string;
  label: string;
  icon: ShareExportIcon;
  onSelect(): void;
}

/** P0-B 反馈拆分：发布与复制各自一条反馈，不再共用一条 notice。ok→status，warn/err→alert。 */
export interface PublishFeedback {
  tone: 'ok' | 'warn' | 'err';
  text: string;
}

/** 阻塞项的处理动作；由宿主接到真实入口（登录/保存/归档/冲突），缺省时只说明、不放必失败按钮。 */
export interface PublishBlockerAction {
  label: string;
  onSelect(): void;
}

export interface PublishBlocker {
  id: string;
  message: string;
  action?: PublishBlockerAction | undefined;
}

/** 本次发布内容摘要的一行；missing 表示这类内容缺失，如实标注。 */
export interface PublishSummaryItem {
  label: string;
  detail: string;
  missing?: boolean;
}

/**
 * P0-B：打开发布页即预检的状态数据。宿主（share-menu）负责计算与重查；
 * 面板只展示，不自行判断保存、归档、权限或版本冲突。
 */
export interface PublishPrecheckState {
  /** 预检还在进行：显示检查中文案，不提前判可发布。 */
  checking: boolean;
  /** 保存状态一句话，如「已保存到云端 · 版本 4」「有未保存的修改」。 */
  saveLine: string;
  /** 最近一次已发布版本；null 表示还没发布过。at 是服务端 createdAt（ISO 串）或本机记录的 epoch 毫秒，两种都能解析。 */
  lastPublished: { revision: number; at?: string | number } | null;
  /** 当前草稿相对最近发布有未发布修改；还没有发布过时忽略。 */
  dirty?: boolean;
  /** 阻塞清单；非空时不给发布主按钮，处理完由宿主重查后解锁。 */
  blockers: PublishBlocker[];
  /** 本次发布内容摘要，与客户页实际呈现对齐；缺失项用 missing 标注。 */
  summary?: PublishSummaryItem[];
  /** 对外可见范围一句话。 */
  visibilityLine?: string;
}

/** 发布记录行：形状与 mergeShareRows 的 ShareRow 对齐，宿主可直接传入。 */
export interface PublishRecordRow {
  key: string;
  kind: 'web' | 'viewer';
  revision: number | null;
  at: number;
  /** 完整地址只在生成那一次拿到；没有就是没有，不假装能恢复。 */
  url: string | null;
  shareId: string | null;
  revoked: boolean;
}

/** P1-B：具体版本的管理记录。复制/打开/完整地址在面板内完成；撤销是业务动作，走宿主回调。 */
export interface PublishRecordsState {
  rows: PublishRecordRow[];
  loading?: boolean | undefined;
  error?: string | undefined;
  onRevoke?: ((row: PublishRecordRow) => void) | undefined;
}

const OPEN_LINE = '打开即可查看场地、分区和尺度，页里可看 3D。';
const PUBLISH_LINE = '发布后即可查看场地、分区和尺度，页里可看 3D。';
/** 未发布且项目只读时的页脚。有这句就不再给可点的绿色发布按钮。 */
export const SHARE_READ_ONLY_LINE = '这个项目现在是只读，取回编辑权后再发布。';

export type ShareBingoStatus = '待发' | '送出中' | '待评' | '已回执';

/** 链接行里给人看的地址：去掉协议，超长截断。复制仍用完整 URL。 */
export function displayShareUrl(url: string, max = 32): string {
  let visible = url;
  try {
    const parsed = new URL(url);
    const path = `${parsed.pathname}${parsed.search}${parsed.hash}`;
    visible = `${parsed.host}${path === '/' ? '' : path}`;
  } catch { /* 不是绝对地址就按原文截 */ }
  return visible.length > max ? `${visible.slice(0, max)}…` : visible;
}

/** 记录与发布时间给人看的一行（MM-DD HH:mm）；解析失败返回空串，不编时间。 */
export function formatShareTime(value: string | number): string {
  const time = typeof value === 'number' ? value : Date.parse(value);
  if (!Number.isFinite(time) || time <= 0) return '';
  const date = new Date(time);
  const pad = (input: number): string => String(input).padStart(2, '0');
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function openShareUrl(url: string): void {
  window.open(url, '_blank', 'noopener,noreferrer');
}

async function copyShareText(value: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      // 显式 false 当失败（与宿主测试同一口径）；真实浏览器里失败走 reject，同样落到 catch。
      const outcome: unknown = await navigator.clipboard.writeText(value);
      return outcome !== false;
    }
  } catch { /* 剪贴板被拦住时走「完整地址」手动复制 */ }
  return false;
}

export function SharePanel({
  tab,
  onTab,
  title,
  published,
  busy,
  notice,
  bingoStatus,
  bingoCount = '',
  bingoLive = true,
  readOnly = false,
  qrOpen,
  qrSvg,
  exports,
  reviewLink = '',
  permits = { pins: true, levels: true, basemap: true },
  onPermit = () => undefined,
  onIssueAudience,
  onSendBingo,
  onCopyReview = () => undefined,
  onOpenReview = () => undefined,
  onRevokeReview,
  onPublish,
  onCopy,
  onRevoke,
  completeShare = null,
  onCreateCompleteShare,
  onCopyComplete = () => undefined,
  onRevokeCompleteShare,
  cases,
  onToggleQr,
  precheck = null,
  publishFeedback = null,
  copyFeedback = null,
  publishRecords = null,
}: {
  tab: ShareTab;
  onTab(tab: ShareTab): void;
  title: string;
  published: { url: string; revision: number; siteUrl?: string } | null;
  busy: boolean;
  notice: string;
  bingoStatus: ShareBingoStatus;
  /** 待评时环内的未回执份数。送出中和已回执不画这个数。 */
  bingoCount?: string;
  /** 本机记录读完之后才播放收口。首屏对上已有回执时直接停在满环。 */
  bingoLive?: boolean;
  /** 已登录但没有编辑权。未发布页只留只读说明，不放绿色发布按钮。 */
  readOnly?: boolean;
  qrOpen: boolean;
  qrSvg: string;
  exports: ShareExportEntry[];
  /** 当前评审链接；空串表示还没生成。 */
  reviewLink?: string;
  /** 发给客户时的三枚开关，默认全开。墨色，不用绿色。 */
  permits?: { pins: boolean; levels: boolean; basemap: boolean };
  onPermit?: (key: 'pins' | 'levels' | 'basemap', value: boolean) => void;
  onIssueAudience(): void;
  onSendBingo(): void;
  onCopyReview?: () => void;
  onOpenReview?: () => void;
  /** 作废当前评审短链；不传则不显示作废入口。 */
  onRevokeReview?: () => void;
  onPublish(): void;
  onCopy(): void;
  onRevoke?: (() => void) | undefined;
  /** 完整只读分享（2026-11-20 集成，C12/C13）：含户外规划与已归档资源的受控链接。不传就不出现这一块。 */
  completeShare?: { url: string; revision: number } | null;
  onCreateCompleteShare?: (() => void) | undefined;
  onCopyComplete?: () => void;
  onRevokeCompleteShare?: (() => void) | undefined;
  /** 「案例」页签内容（CaseAdminSection）。不传就不出现这一页。 */
  cases?: ReactNode;
  onToggleQr(): void;
  /** P0-B：发布页打开即预检的状态与阻塞清单；不传时发布页保持旧版渲染。 */
  precheck?: PublishPrecheckState | null;
  /** P0-B：发布动作自己的反馈（成功/失败/成功但复制失败），与复制反馈分开。 */
  publishFeedback?: PublishFeedback | null;
  /** P0-B：复制动作自己的反馈（成功/失败）。 */
  copyFeedback?: PublishFeedback | null;
  /** P1-B：具体版本的记录与管理；形状与 mergeShareRows 的 ShareRow 对齐。 */
  publishRecords?: PublishRecordsState | null;
}): JSX.Element {
  const rootRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const [recordCopyNote, setRecordCopyNote] = useState('');
  const tabOrder: ShareTab[] = cases != null ? ['share', 'publish', 'cases', 'export'] : ['share', 'publish', 'export'];
  const publishBlocked = !published && (readOnly || notice === SHARE_READ_ONLY_LINE);
  /** 交给客户的那条：有场地页就用场地页。 */
  const handedUrl = published?.url ?? '';
  /** 有已发布版本且当前草稿更新时，主按钮按「发布新版」说；首次发布仍是「发布并复制链接」。 */
  const newVersionLabel = Boolean(precheck?.lastPublished && precheck.dirty);
  // 焦点进入与返回（PUB-12）：打开时把焦点移进弹层，关闭时还给触发钮；用户已点到别处就不抢。
  useEffect(() => {
    const root = rootRef.current;
    openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    root?.focus({ preventScroll: true });
    return () => {
      const opener = openerRef.current;
      const active = document.activeElement;
      if (opener && (active === null || active === document.body || (root != null && root.contains(active)))) {
        opener.focus({ preventScroll: true });
      }
    };
  }, []);
  // 发布记录的复制反馈只属于发布页签；切走就清掉，不串到别的页签。
  useEffect(() => { setRecordCopyNote(''); }, [tab]);
  /** 页签方向键导航（PUB-12）：左右循环，Home/End 跳两端；焦点跟着选择走。 */
  const onTabKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const key = event.key;
    if (key !== 'ArrowRight' && key !== 'ArrowLeft' && key !== 'Home' && key !== 'End') return;
    event.preventDefault();
    const current = tabOrder.indexOf(tab);
    const next = key === 'ArrowRight' ? (current + 1) % tabOrder.length
      : key === 'ArrowLeft' ? (current - 1 + tabOrder.length) % tabOrder.length
      : key === 'Home' ? 0
      : tabOrder.length - 1;
    const target = tabOrder[next];
    if (target !== tab) onTab(target);
    rootRef.current?.querySelector<HTMLButtonElement>(`#share-tab-${target}`)?.focus();
  };
  const copyRecordRow = async (row: PublishRecordRow) => {
    if (!row.url) return;
    const copied = await copyShareText(row.url);
    setRecordCopyNote(copied ? `已复制版本 ${row.revision ?? '—'} 的链接。` : '复制没成功：请在「完整地址」里手动选择复制。');
  };
  return <div id="tool-share-menu" className="sc-tool-pop sc-share-panel" role="dialog" aria-label="分享、发布与导出" data-testid="share-panel" tabIndex={-1} ref={rootRef}>
    <div className="sc-share-tabs" role="tablist" aria-label="分享、发布、案例、导出" onKeyDown={onTabKeyDown}>
      <Tab id="share" selected={tab === 'share'} onSelect={onTab}>分享</Tab>
      <Tab id="publish" selected={tab === 'publish'} onSelect={onTab}>发布</Tab>
      {cases != null && <Tab id="cases" selected={tab === 'cases'} onSelect={onTab}>案例</Tab>}
      <Tab id="export" selected={tab === 'export'} onSelect={onTab}>导出</Tab>
    </div>

    {tab === 'share' && <section className="sc-share-body" role="tabpanel" aria-label="分享" id="share-panel-share">
      <ShareHeading icon={<MarkIcon />} title={title} />
      <p className="sc-share-desc">{OPEN_LINE}</p>
      <fieldset className="sc-share-permits">
        <legend>发给客户评审</legend>
        <PermitRow label="可落钉意见" pressed={permits.pins} onChange={value => onPermit('pins', value)} />
        <PermitRow label="可切换图层" pressed={permits.levels} onChange={value => onPermit('levels', value)} />
        <PermitRow label="可切换底图" pressed={permits.basemap} onChange={value => onPermit('basemap', value)} />
      </fieldset>
      {reviewLink ? <>
        <div className="sc-share-link" data-testid="review-link-row">
          <span className="sc-share-link-text" title={reviewLink}>{displayShareUrl(reviewLink)}</span>
          <button type="button" className="sc-share-key sc-share-copy" data-tone="paper" onClick={onCopyReview}>复制</button>
          <button type="button" className="sc-share-key" data-tone="paper" onClick={onOpenReview}>打开</button>
          {onRevokeReview && (
            <button
              type="button"
              className="sc-share-key sc-share-revoke"
              data-tone="paper"
              aria-label="作废这条评审链接"
              onClick={onRevokeReview}
            >
              作废
            </button>
          )}
          <button
            type="button"
            className="sc-share-key sc-share-qr"
            data-tone="paper"
            aria-label="评审二维码"
            aria-expanded={qrOpen}
            aria-controls="review-qr-pop"
            onClick={onToggleQr}
          >
            <QrKeyIcon />
          </button>
          {qrOpen && <div id="review-qr-pop" className="sc-share-qrpop" role="dialog" aria-label="评审二维码">
            {qrSvg
              ? <div className="sc-share-qrpop-code" role="img" aria-label="评审二维码" dangerouslySetInnerHTML={{ __html: qrSvg }} />
              : <p className="sc-share-desc">二维码还在生成。</p>}
          </div>}
        </div>
        <button type="button" className="sc-share-renew" disabled={busy} onClick={onIssueAudience}>
          {busy ? '正在刷新…' : '刷新为当前版本'}
        </button>
      </> : <button type="button" className="sc-share-cta" data-tone="green" disabled={busy} onClick={onIssueAudience}>
        {busy ? '正在生成…' : '生成并复制评审链接'}
      </button>}
      <ShareActionRow
        label="送到 Bingo"
        status={bingoStatus}
        icon={<BingoStatusMark phase={bingoPhaseOf(bingoStatus)} sending={bingoStatus === '送出中'} count={bingoStatus === '待评' ? bingoCount : ''} size={16} armed={bingoLive} />}
        ariaLabel={`送到 Bingo，${bingoStatus}`}
        disabled={busy}
        onClick={onSendBingo}
      />
    </section>}

    {tab === 'publish' && <section className="sc-share-body" role="tabpanel" aria-label="发布" id="share-panel-publish" data-published={published ? 'true' : 'false'} data-readonly={publishBlocked ? 'true' : 'false'} data-testid="publish-section">
      <ShareHeading icon={<GlobeIcon />} title="发布到网页" />
      {precheck && <PublishStatusBlock precheck={precheck} />}
      <p className="sc-share-desc">{published ? OPEN_LINE : PUBLISH_LINE}</p>
      {published && <p className="sc-share-desc">固定发布版本；后续编辑不会自动更新。撤销仅停止这条受控链接的新访问，无法收回已下载的内容。</p>}
      {published?.siteUrl && <p className="sc-share-desc"><a href={published.siteUrl} target="_blank" rel="noopener noreferrer">打开离线场地快照</a>：固定副本，不随项目更新，无法远程撤回。</p>}
      {precheck && <PublishBlockers precheck={precheck} busy={busy} />}
      {precheck && <PublishSummary precheck={precheck} />}
      {published ? <>
        <div className="sc-share-link" data-testid="share-link-row">
          <span className="sc-share-link-text" title={handedUrl}>{displayShareUrl(handedUrl)}</span>
          <button type="button" className="sc-share-key sc-share-copy" data-tone="paper" onClick={onCopy}>复制</button>
          <button type="button" className="sc-share-key" data-tone="paper" onClick={() => openShareUrl(handedUrl)}>打开</button>
          <button
            type="button"
            className="sc-share-key sc-share-qr"
            data-tone="paper"
            aria-label="二维码"
            aria-expanded={qrOpen}
            aria-controls="share-qr-pop"
            onClick={onToggleQr}
          >
            <QrKeyIcon />
          </button>
          {qrOpen && <div id="share-qr-pop" className="sc-share-qrpop" role="dialog" aria-label="方案二维码">
            {qrSvg
              ? <div className="sc-share-qrpop-code" role="img" aria-label="方案二维码" dangerouslySetInnerHTML={{ __html: qrSvg }} />
              : <p className="sc-share-desc">二维码还在生成。</p>}
          </div>}
        </div>
        {/* P1-B：完整地址手动取走的路径——剪贴板被拦住时仍能拿到整段链接。 */}
        <details className="sc-share-fullurl" data-testid="share-fullurl" style={{ ...FULL_URL_STYLE, display: 'grid', gap: 4 }}>
          <summary className="sc-share-desc" style={{ cursor: 'pointer', color: 'inherit' }}>完整地址</summary>
          <p className="sc-share-desc" style={{ overflowWrap: 'anywhere', userSelect: 'all' }}>{handedUrl}</p>
        </details>
      </> : publishBlocked ? <p className="sc-share-readonly" role="status" data-testid="share-readonly">{SHARE_READ_ONLY_LINE}</p>
        : precheck?.checking ? null
        : <button type="button" className="sc-share-cta" data-tone="green" disabled={busy} onClick={onPublish}>
          {busy
            ? (newVersionLabel ? '正在发布新版…' : '正在发布…')
            : (newVersionLabel ? '发布新版并复制链接' : '发布并复制链接')}
        </button>}
      {/* 预检阻塞不隐藏主按钮：闸门在发布链内强制执行（接口约定 §2/§3.1），清单只提供处理入口。 */}
      {precheck && !precheck.checking && published && !readOnly && precheck.dirty && <button type="button" className="sc-share-cta" data-tone="green" disabled={busy} onClick={onPublish}>
        {busy ? '正在发布新版…' : '发布新版并复制链接'}
      </button>}
      {precheck && publishFeedback && <FeedbackLine feedback={publishFeedback} testid="publish-feedback" />}
      {precheck && copyFeedback && <FeedbackLine feedback={copyFeedback} testid="copy-feedback" />}
      {precheck && publishRecords && <PublishRecords records={publishRecords} busy={busy} copyNote={recordCopyNote} onCopyRow={copyRecordRow} />}
    </section>}

    {tab === 'publish' && published && onRevoke && <button type="button" className="sc-share-renew" disabled={busy} onClick={onRevoke}>撤回这条受控链接</button>}

    {tab === 'publish' && onCreateCompleteShare != null && <section className="sc-share-body" data-testid="complete-share" aria-label="完整只读链接">
      <p className="sc-share-desc">完整只读链接：含户外规划与已归档资源的受控入口，可撤销。令牌只在生成时显示一次。</p>
      {completeShare?.url ? <>
        <div className="sc-share-link" data-testid="complete-share-link-row">
          <span className="sc-share-link-text" title={completeShare.url}>{displayShareUrl(completeShare.url)}</span>
          <button type="button" className="sc-share-key sc-share-copy" data-tone="paper" onClick={onCopyComplete}>复制</button>
          <button type="button" className="sc-share-key" data-tone="paper" onClick={() => { if (completeShare.url) openShareUrl(completeShare.url); }}>打开</button>
          {onRevokeCompleteShare && <button type="button" className="sc-share-key" data-tone="paper" disabled={busy} onClick={onRevokeCompleteShare}>撤销</button>}
        </div>
        <details className="sc-share-fullurl" data-testid="complete-share-fullurl" style={{ ...FULL_URL_STYLE, display: 'grid', gap: 4 }}>
          <summary className="sc-share-desc" style={{ cursor: 'pointer', color: 'inherit' }}>完整地址</summary>
          <p className="sc-share-desc" style={{ overflowWrap: 'anywhere', userSelect: 'all' }}>{completeShare.url}</p>
        </details>
      </> : <button type="button" className="sc-share-renew" disabled={busy} onClick={onCreateCompleteShare}>
        {busy ? '正在生成…' : '生成完整只读链接'}
      </button>}
    </section>}

    {tab === 'cases' && cases != null && <section className="sc-share-body" role="tabpanel" aria-label="案例" id="share-panel-cases">
      {cases}
    </section>}

    {tab === 'export' && <section className="sc-share-body" role="tabpanel" aria-label="导出" id="share-panel-export">
      {exports.length ? <ul className="sc-share-exports" data-align="start">
        {exports.map(entry => <li key={entry.id}>
          <button type="button" className="sc-share-export" data-align="start" onClick={entry.onSelect}>
            <ExportGlyph icon={entry.icon} />
            <span>{entry.label}</span>
          </button>
        </li>)}
      </ul> : <p className="sc-share-desc">当前方案没有可导出的文件。</p>}
    </section>}

    {notice && notice !== SHARE_READ_ONLY_LINE && <p className="sc-share-note" role="status">{notice}</p>}
  </div>;
}

/** 新区块的结构性样式（组件自带作用域，不新增 globals 规则；正式规则已列入交接单交 AI C）：
 *  - 详情折叠：与说明行同一档字体，展开后完整地址可选中复制，不断行溢出。
 *  - 记录列表：紧凑行距，行内文字收缩、按键定宽，不把行撑破。 */
const FULL_URL_STYLE = {
  margin: 0,
  padding: 0,
  fontSize: 12,
  lineHeight: '18px',
  color: 'var(--ink-soft, #55585F)',
} as const;
const RECORD_ROWS_STYLE = {
  listStyle: 'none',
  margin: 0,
  padding: 0,
  width: '100%',
  display: 'grid',
  gap: 6,
} as const;
const RECORD_NOTE_STYLE = {
  margin: '4px 0 0',
} as const;

/** P0-B：发布页打开即给状态——保存状态、最近发布版本、当前是否还有未发布修改。 */
function PublishStatusBlock({ precheck }: { precheck: PublishPrecheckState }): JSX.Element {
  const { saveLine, lastPublished, dirty } = precheck;
  const publishedAt = lastPublished?.at ? formatShareTime(lastPublished.at) : '';
  return <div role="group" aria-label="发布状态" data-testid="publish-status">
    <p className="sc-share-desc">保存状态：{saveLine}</p>
    <p className="sc-share-desc">{lastPublished
      ? `已发布：版本 ${lastPublished.revision}${publishedAt ? ` · ${publishedAt}` : ''}`
      : '还没有发布过。'}</p>
    {lastPublished && <p className="sc-share-desc">{dirty
      ? '当前修改：有未发布的修改，可发布为新版本。'
      : '当前修改：与已发布版本一致。'}</p>}
  </div>;
}

/** P0-B：预检阻塞清单。每项只在宿主给出真实动作时放按钮；没有动作就只说明，不放可点但必失败的按钮。 */
function PublishBlockers({ precheck, busy }: { precheck: PublishPrecheckState; busy: boolean }): JSX.Element {
  const { checking, blockers } = precheck;
  return <fieldset className="sc-share-permits" data-testid="publish-blockers">
    <legend>发布前检查</legend>
    {checking ? <p className="sc-share-desc" role="status">正在检查保存状态与资源归档…</p>
      : blockers.length === 0 ? <p className="sc-share-desc">检查通过，可以发布。</p>
      : <>
        <p className="sc-share-desc" role="alert">还有 {blockers.length} 项需要处理：</p>
        {blockers.map(blocker => <div key={blocker.id} data-testid={`publish-blocker-${blocker.id}`}>
          <p className="sc-share-desc">· {blocker.message}</p>
          {blocker.action && <button type="button" className="sc-share-renew" disabled={busy} onClick={blocker.action.onSelect}>{blocker.action.label}</button>}
        </div>)}
      </>}
  </fieldset>;
}

/** P0-B：本次发布内容与对外可见范围；缺失项如实标注，不冒充完整。 */
function PublishSummary({ precheck }: { precheck: PublishPrecheckState }): JSX.Element | null {
  const { summary, visibilityLine } = precheck;
  if (!summary?.length && !visibilityLine) return null;
  return <fieldset className="sc-share-permits" data-testid="publish-summary">
    <legend>本次发布内容</legend>
    {summary?.map(item => <p key={item.label} className="sc-share-desc">{item.label}：{item.detail}{item.missing ? '（缺失）' : ''}</p>)}
    {visibilityLine && <p className="sc-share-desc">{visibilityLine}</p>}
  </fieldset>;
}

/** P0-B：发布与复制分开反馈；ok 用 status，warn/err 用 alert 并落在语义色文字上。 */
function FeedbackLine({ feedback, testid }: { feedback: PublishFeedback; testid?: string }): JSX.Element {
  return <p
    className="sc-share-note"
    role={feedback.tone === 'ok' ? 'status' : 'alert'}
    data-tone={feedback.tone}
    {...(testid ? { 'data-testid': testid } : {})}
    style={feedback.tone === 'err' ? { color: 'var(--err)' } : feedback.tone === 'warn' ? { color: 'var(--warn)' } : undefined}
  >{feedback.text}</p>;
}

/** P1-B：具体版本的记录与管理。撤销是业务动作，走宿主回调；没有 shareId 就不给撤销按钮。 */
function PublishRecords({ records, busy, copyNote, onCopyRow }: {
  records: PublishRecordsState;
  busy: boolean;
  copyNote: string;
  onCopyRow(row: PublishRecordRow): void;
}): JSX.Element {
  return <fieldset className="sc-share-permits" data-testid="publish-records">
    <legend>发布记录</legend>
    {records.loading ? <p className="sc-share-desc" role="status">正在读取发布记录…</p>
      : records.error ? <p className="sc-share-desc" role="alert">{records.error}</p>
      : records.rows.length === 0 ? <p className="sc-share-desc">还没有发布记录。</p>
      : <ul className="sc-share-record-rows" style={RECORD_ROWS_STYLE}>
        {records.rows.map(row => <li key={row.key}>
          <div className="sc-share-link" data-testid={`publish-record-${row.key}`} data-revoked={row.revoked ? 'true' : undefined}>
            <span className="sc-share-link-text">
              {row.kind === 'viewer' ? '3D 快照 · ' : ''}版本 {row.revision ?? '—'} · {formatShareTime(row.at) || '时间未知'}{row.revoked ? ' · 已撤回' : ''}
            </span>
            {row.url && !row.revoked && <>
              <button type="button" className="sc-share-key sc-share-copy" data-tone="paper" onClick={() => onCopyRow(row)}>复制</button>
              <button type="button" className="sc-share-key sc-share-copy" data-tone="paper" onClick={() => { if (row.url) openShareUrl(row.url); }}>打开</button>
            </>}
            {row.shareId && !row.revoked && records.onRevoke && <button type="button" className="sc-share-key sc-share-copy" data-tone="paper" disabled={busy} onClick={() => records.onRevoke?.(row)}>撤销</button>}
          </div>
          {!row.url && <p className="sc-share-desc" style={RECORD_NOTE_STYLE}>{row.revoked
            ? '链接只在生成时显示一次，服务器不存完整地址。'
            : '链接只在生成时显示一次，没有留存完整地址；可撤销，或发布新版。'}</p>}
        </li>)}
      </ul>}
    {copyNote && <p className="sc-share-desc" role="status">{copyNote}</p>}
  </fieldset>;
}

function ShareHeading({ icon, title }: { icon: JSX.Element; title: string }): JSX.Element {
  return <div className="sc-share-heading" data-layout="grouped">
    <div className="sc-share-titlelock">
      {icon}
      <h2>{title}</h2>
    </div>
  </div>;
}

/** 分享页两行同一套：左图标贴标题，右侧状态。 */
function ShareActionRow({ label, status, icon, ariaLabel, disabled, onClick }: {
  label: string;
  status: string;
  icon: JSX.Element;
  ariaLabel: string;
  disabled: boolean;
  onClick(): void;
}): JSX.Element {
  return <button type="button" className="sc-share-row" data-align="start" aria-label={ariaLabel} disabled={disabled} onClick={onClick}>
    {icon}
    <span className="sc-share-row-label">{label}</span>
    <span className="sc-share-row-status">{status}</span>
  </button>;
}

function PermitRow({ label, pressed, onChange }: { label: string; pressed: boolean; onChange(value: boolean): void }): JSX.Element {
  return <label className="sc-share-permit">
    <span>{label}</span>
    <button
      type="button"
      className="sc-share-switch"
      role="switch"
      aria-checked={pressed}
      aria-label={label}
      onClick={() => onChange(!pressed)}
    >
      <i />
    </button>
  </label>;
}

function Tab({ id, selected, onSelect, children }: {
  id: ShareTab;
  selected: boolean;
  onSelect(tab: ShareTab): void;
  children: string;
}): JSX.Element {
  return <button
    type="button"
    role="tab"
    id={`share-tab-${id}`}
    className={`sc-share-tab${selected ? ' is-selected' : ''}`}
    aria-selected={selected}
    aria-controls={`share-panel-${id}`}
    data-tone={selected ? 'ink' : 'quiet'}
    tabIndex={selected ? 0 : -1}
    onClick={() => onSelect(id)}
  >{children}</button>;
}

function MarkIcon(): JSX.Element {
  return <svg className="sc-share-glyph" width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M2.4 6.2 8 3.2l5.6 3-5.6 3-5.6-3Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
    <path d="M4.2 8.1v2.6c1.1.9 2.4 1.4 3.8 1.4s2.7-.5 3.8-1.4V8.1" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
  </svg>;
}

function GlobeIcon(): JSX.Element {
  return <svg className="sc-share-glyph" width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <circle cx="8" cy="8" r="5.6" stroke="currentColor" strokeWidth="1.3" />
    <path d="M8 2.4c1.5 1.5 2.3 3.4 2.3 5.6S9.5 12.1 8 13.6C6.5 12.1 5.7 10.2 5.7 8S6.5 3.9 8 2.4Z" stroke="currentColor" strokeWidth="1.2" />
    <path d="M2.6 8h10.8" stroke="currentColor" strokeWidth="1.2" />
  </svg>;
}

function bingoPhaseOf(status: ShareBingoStatus): BingoPhase {
  if (status === '已回执') return 'returned';
  if (status === '待评') return 'awaiting';
  return 'to-send';
}

function QrKeyIcon(): JSX.Element {
  return <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
    <path d="M1.4 1.4h3.6v3.6H1.4zM9 1.4h3.6v3.6H9zM1.4 9h3.6v3.6H1.4z" stroke="currentColor" strokeWidth="1.15" />
    <path d="M9 9h1.5v1.5H9zM11.2 9H12.6v1.4h-1.4zM9 11.2h1.5V12.6H9zM11.4 11.4h1.2V12.6h-1.2z" fill="currentColor" />
  </svg>;
}

function ExportGlyph({ icon }: { icon: ShareExportIcon }): JSX.Element {
  if (icon === 'image') {
    return <svg className="sc-share-glyph" width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="2.2" y="3" width="11.6" height="10" rx="1.4" stroke="currentColor" strokeWidth="1.3" />
      <path d="M2.6 10.4 5.6 7.6l2.2 2 1.6-1.4 3.8 3.2" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
    </svg>;
  }
  if (icon === 'list') {
    return <svg className="sc-share-glyph" width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M3 4.2h10M3 8h10M3 11.8h6.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>;
  }
  return <svg className="sc-share-glyph" width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <circle cx="8" cy="8" r="5.2" stroke="currentColor" strokeWidth="1.3" />
    <circle cx="8" cy="8" r="1.3" fill="currentColor" />
  </svg>;
}
