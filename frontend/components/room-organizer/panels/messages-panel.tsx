'use client';

/**
 * 左栏「消息」面板：会话列表 → 单场对话；置顶「官方通知」→ 通知列表 → 通知详情。
 * 列表段下面是团队成员私信；点头像进那场对话，顶栏返回键回到列表。
 * 通知只读：客户端不写通知，打开详情时只回写一条已读回执。
 * 线程视图直接复用 MemberChat 作为堆栈根节点，列表/通知视图用本组件自己的根节点，
 * 两类根都吃同一套 .sc-person-chat 堆栈类与浮窗装饰。
 */
import { useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { ArrowLeft, Inbox, X } from '@/components/solid-icons';
import { useOfficialNotices } from '../lib/official-notices';
import { roleLabel, type TeamSnapshot } from '../lib/team-data';
import { useTeamUnread } from '../lib/team-messages';
import { avatarToneStyle, avatarTonesFor, useAvatarPresetsFor } from './account-avatars';
import { MemberChat } from './member-chat';
import type { BackendSession } from '@/lib/backend-session';
import { safeOfficialLink, type OfficialNotice, type OfficialNoticeKind } from '@/lib/workspace-api';
import './member-chat.css';
import './messages-panel.css';

type MessagesView =
  | { kind: 'list' }
  | { kind: 'thread'; peerId: string }
  | { kind: 'official' }
  | { kind: 'notice'; noticeId: string };

const NOTICE_KIND_LABEL: Record<OfficialNoticeKind, string> = {
  announcement: '公告',
  version: '版本更新',
  event: '活动',
  system: '系统通知',
};

function stamp(createdAt: string): string {
  const date = new Date(createdAt);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export function MessagesPanel({ controller, team, onClose, className, style, onHeaderPointerDown, floatBar, floatFooter }: {
  controller: BackendSession;
  team: TeamSnapshot;
  onClose(): void;
  /** 左栏半卡片堆栈：外部传入的类/样式/头部抓取手势与独立小窗装饰。 */
  className?: string;
  style?: CSSProperties;
  onHeaderPointerDown?: (event: ReactPointerEvent<HTMLElement>) => void;
  floatBar?: ReactNode;
  floatFooter?: ReactNode;
}): JSX.Element {
  const [view, setView] = useState<MessagesView>({ kind: 'list' });
  const unread = useTeamUnread(controller, team.studioId, team.userId);
  const official = useOfficialNotices(controller, team.userId);
  const tones = avatarTonesFor(team.members);
  const presets = useAvatarPresetsFor(team.members, team.userId);

  const closeHeader = (
    <button type="button" className="sc-person-chat-close" aria-label="关闭消息面板" onClick={onClose}><X size={18}/></button>
  );
  const headerGrab = onHeaderPointerDown
    ? { onPointerDown: onHeaderPointerDown, style: { cursor: 'grab', touchAction: 'none' } }
    : {};

  const openNotice = (notice: OfficialNotice): void => {
    official.read(notice.id);
    setView({ kind: 'notice', noticeId: notice.id });
  };

  const listBody = (
    <>
      <header className="sc-person-chat-head" {...headerGrab}>
        <h2>消息</h2>
        {closeHeader}
      </header>
      <div className="sc-messages-list" role="list" aria-label="消息会话">
        <button type="button" className="sc-message-row" aria-label={official.unread > 0 ? `官方通知，${official.unread} 条未读` : '官方通知'}
          onClick={() => setView({ kind: 'official' })}>
          <span className="sc-message-row-icon" aria-hidden="true"><Inbox size={20}/></span>
          <span className="sc-message-row-body">
            <strong>官方通知</strong>
            <span className="sc-message-row-sub">
              {team.userId ? (official.notices[0]?.title ?? '系统公告与活动提醒') : '系统公告与活动提醒'}
            </span>
          </span>
          {official.unread > 0 && <span className="sc-message-row-badge" aria-hidden="true">{official.unread > 9 ? '9+' : official.unread}</span>}
        </button>
        <p className="sc-messages-section" aria-hidden="true">团队私信</p>
        {!team.userId && <p className="sc-messages-hint">登录后查看团队消息。在账户中心登录后，这里会显示与团队成员的对话。</p>}
        {team.userId && team.error && <p className="sc-messages-hint" role="status">{team.error}</p>}
        {team.userId && !team.error && team.loading && <p className="sc-messages-hint">正在加载团队…</p>}
        {team.userId && !team.error && !team.loading && team.members.length === 0 && (
          <p className="sc-messages-hint">还没有团队成员。</p>
        )}
        {team.members.map(member => {
          const tone = tones.get(member.userId);
          const preset = presets.get(member.userId);
          const pending = unread.get(member.userId) ?? 0;
          const isSelf = member.userId === team.userId;
          return <button
            key={member.userId}
            type="button"
            className="sc-message-row"
            aria-label={`${isSelf ? '给自己留话' : `和 ${member.displayName} 的对话`}${pending ? `，${pending} 条未读` : ''}`}
            onClick={() => setView({ kind: 'thread', peerId: member.userId })}
          >
            <span className={`sc-settings-avatar is-rail${preset ? ' is-image' : ''}`} data-tone={tone?.id} style={avatarToneStyle(tone)} aria-hidden="true">
              {preset ? <img src={preset.src} alt=""/> : member.displayName.slice(0, 1)}
            </span>
            <span className="sc-message-row-body">
              <strong>{member.displayName}</strong>
              <span className="sc-message-row-sub">{isSelf ? '给自己留话' : roleLabel(member.role)}</span>
            </span>
            {pending > 0 && <span className="sc-message-row-badge" aria-hidden="true">{pending > 9 ? '9+' : pending}</span>}
          </button>;
        })}
      </div>
    </>
  );

  const officialListBody = (
    <>
      <header className="sc-person-chat-head" {...headerGrab}>
        <button type="button" className="sc-person-chat-close" aria-label="返回消息列表" onClick={() => setView({ kind: 'list' })}><ArrowLeft size={18}/></button>
        <h2>官方通知</h2>
        {closeHeader}
      </header>
      <div className="sc-messages-list" role="list" aria-label="官方通知列表">
        {!team.userId && <p className="sc-messages-hint">登录后查看官方通知。</p>}
        {team.userId && official.error && <p className="sc-messages-hint" role="status">{official.error}</p>}
        {team.userId && !official.error && official.loading && <p className="sc-messages-hint">正在加载通知…</p>}
        {team.userId && !official.error && !official.loading && official.notices.length === 0 && (
          <p className="sc-messages-hint">暂无通知。</p>
        )}
        {official.notices.map(notice => {
          const pending = !notice.readAt;
          return <button
            key={notice.id}
            type="button"
            className="sc-message-row"
            aria-label={`${notice.title}${pending ? '，未读' : ''}`}
            onClick={() => openNotice(notice)}
          >
            <span className="sc-message-row-icon" aria-hidden="true"><Inbox size={20}/></span>
            <span className="sc-message-row-body">
              <strong>{notice.title}</strong>
              <span className="sc-message-row-sub">{NOTICE_KIND_LABEL[notice.kind]} · {stamp(notice.createdAt)}</span>
            </span>
            {pending && <span className="sc-message-row-badge" aria-hidden="true">未读</span>}
          </button>;
        })}
      </div>
    </>
  );

  const selectedNotice = view.kind === 'notice'
    ? official.notices.find(item => item.id === view.noticeId)
    : undefined;
  const safeNoticeLink = selectedNotice ? safeOfficialLink(selectedNotice.link) : null;

  const noticeDetailBody = (
    <>
      <header className="sc-person-chat-head" {...headerGrab}>
        <button type="button" className="sc-person-chat-close" aria-label="返回通知列表" onClick={() => setView({ kind: 'official' })}><ArrowLeft size={18}/></button>
        <h2>通知详情</h2>
        {closeHeader}
      </header>
      <div className="ap-feed sc-person-chat-feed sc-notice-detail">
        {!selectedNotice && <p className="sc-messages-hint">这条通知已经不在了。</p>}
        {selectedNotice && (
          <>
            <h3 className="sc-notice-title">{selectedNotice.title}</h3>
            <p className="sc-notice-meta">{NOTICE_KIND_LABEL[selectedNotice.kind]} · {stamp(selectedNotice.createdAt)}</p>
            <p className="sc-notice-body">{selectedNotice.body}</p>
            {safeNoticeLink && (
              <a className="sc-notice-link" href={safeNoticeLink} target="_blank" rel="noopener noreferrer">
                查看相关内容
              </a>
            )}
          </>
        )}
      </div>
    </>
  );

  if (view.kind === 'thread') {
    return <MemberChat
      controller={controller}
      team={team}
      peerId={view.peerId}
      onClose={onClose}
      onBack={() => setView({ kind: 'list' })}
      {...(className !== undefined ? { className } : {})}
      {...(style !== undefined ? { style } : {})}
      {...(onHeaderPointerDown !== undefined ? { onHeaderPointerDown } : {})}
      {...(floatBar !== undefined ? { floatBar } : {})}
      {...(floatFooter !== undefined ? { floatFooter } : {})}
    />;
  }

  return <aside className={`sc-person-chat sc-messages-panel${className ? ` ${className}` : ''}`} style={style}
    id="messages-panel" aria-label="消息面板" tabIndex={-1}
    onKeyDown={event => { if (event.key === 'Escape') onClose(); }}>
    {floatBar}
    {view.kind === 'list' ? listBody : view.kind === 'official' ? officialListBody : noticeDetailBody}
    {floatFooter}
  </aside>;
}
