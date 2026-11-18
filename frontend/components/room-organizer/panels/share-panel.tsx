'use client';

/**
 * 分享钮弹出的三页：分享 / 发布 / 导出。
 * 版式按 2026-11-17 锁定稿：白底卡片、墨色选中页签、绿只留给未发布的主按钮。
 * 已发布只留链接行上的「复制」和二维码小键；二维码本体在小键点开后的浮层里。
 */
export type ShareTab = 'share' | 'publish' | 'export';
export type ShareExportIcon = 'image' | 'list' | 'site';

export interface ShareExportEntry {
  id: string;
  label: string;
  icon: ShareExportIcon;
  onSelect(): void;
}

const OPEN_LINE = '打开即可查看场地、分区和尺度，页里可看 3D。';
const PUBLISH_LINE = '发布后即可查看场地、分区和尺度，页里可看 3D。';
/** 未发布且项目只读时的页脚。有这句就不再给可点的绿色发布按钮。 */
export const SHARE_READ_ONLY_LINE = '这个项目现在是只读，取回编辑权后再发布。';

export type ShareBingoStatus = '待发' | '待评' | '已回执';

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

export function SharePanel({
  tab,
  onTab,
  title,
  published,
  busy,
  notice,
  bingoStatus,
  readOnly = false,
  qrOpen,
  qrSvg,
  exports,
  reviewLink = '',
  onIssueAudience,
  onSendBingo,
  onCopyReview = () => undefined,
  onOpenReview = () => undefined,
  onPublish,
  onCopy,
  onToggleQr,
}: {
  tab: ShareTab;
  onTab(tab: ShareTab): void;
  title: string;
  published: { url: string; revision: number } | null;
  busy: boolean;
  notice: string;
  bingoStatus: ShareBingoStatus;
  /** 已登录但没有编辑权。未发布页只留只读说明，不放绿色发布按钮。 */
  readOnly?: boolean;
  qrOpen: boolean;
  qrSvg: string;
  exports: ShareExportEntry[];
  /** 当前评审链接；空串表示还没生成。 */
  reviewLink?: string;
  onIssueAudience(): void;
  onSendBingo(): void;
  onCopyReview?: () => void;
  onOpenReview?: () => void;
  onPublish(): void;
  onCopy(): void;
  onToggleQr(): void;
}): JSX.Element {
  const publishBlocked = !published && (readOnly || notice === SHARE_READ_ONLY_LINE);
  return <div id="tool-share-menu" className="sc-tool-pop sc-share-panel" role="dialog" aria-label="分享、发布与导出" data-testid="share-panel">
    <div className="sc-share-tabs" role="tablist" aria-label="分享、发布、导出">
      <Tab id="share" selected={tab === 'share'} onSelect={onTab}>分享</Tab>
      <Tab id="publish" selected={tab === 'publish'} onSelect={onTab}>发布</Tab>
      <Tab id="export" selected={tab === 'export'} onSelect={onTab}>导出</Tab>
    </div>

    {tab === 'share' && <section className="sc-share-body" role="tabpanel" aria-label="分享" id="share-panel-share">
      <ShareHeading icon={<MarkIcon />} title={title} />
      <p className="sc-share-desc">{OPEN_LINE}</p>
      {reviewLink ? <>
        <div className="sc-share-link" data-testid="review-link-row">
          <span className="sc-share-link-text" title={reviewLink}>{displayShareUrl(reviewLink)}</span>
          <button type="button" className="sc-share-key sc-share-copy" data-tone="paper" onClick={onCopyReview}>复制</button>
          <button type="button" className="sc-share-key" data-tone="paper" onClick={onOpenReview}>打开</button>
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
      <ShareActionRow label="送到 Bingo" status={bingoStatus} icon={<RingIcon />} ariaLabel={`送到 Bingo，${bingoStatus}`} disabled={busy} onClick={onSendBingo} />
    </section>}

    {tab === 'publish' && <section className="sc-share-body" role="tabpanel" aria-label="发布" id="share-panel-publish" data-published={published ? 'true' : 'false'} data-readonly={publishBlocked ? 'true' : 'false'}>
      <ShareHeading icon={<GlobeIcon />} title="发布到网页" />
      <p className="sc-share-desc">{published ? OPEN_LINE : PUBLISH_LINE}</p>
      {published ? <div className="sc-share-link" data-testid="share-link-row">
        <span className="sc-share-link-text" title={published.url}>{displayShareUrl(published.url)}</span>
        <button type="button" className="sc-share-key sc-share-copy" data-tone="paper" onClick={onCopy}>复制</button>
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
      </div> : publishBlocked ? <p className="sc-share-readonly" role="status" data-testid="share-readonly">{SHARE_READ_ONLY_LINE}</p>
        : <button type="button" className="sc-share-cta" data-tone="green" disabled={busy} onClick={onPublish}>
          {busy ? '正在发布…' : '发布并复制链接'}
        </button>}
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

/** 图标和标题收成一组靠左，避免被分享页的 space-between 拆到卡片两端。 */
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

function RingIcon(): JSX.Element {
  return <svg className="sc-share-glyph" width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <circle cx="8" cy="8" r="4.2" stroke="currentColor" strokeWidth="1.3" />
  </svg>;
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
