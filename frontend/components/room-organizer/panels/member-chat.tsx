'use client';

/**
 * 左栏里的那场私信：点左轨谁的头，整栏就换成和那个人的对话，和四格 agent 用的是同一套气泡与输入条。
 * 关掉就回到刚才那一格，画布不受影响。给自己发不算对话，只算留话，所以标题写「给自己留话」。
 */
import { useEffect, useRef, useState } from 'react';
import { ArrowUp, X } from '@/components/solid-icons';
import { roleLabel } from '../lib/team-data';
import { useTeamThread } from '../lib/team-messages';
import { avatarToneStyle, avatarTonesFor, useAvatarPresetsFor } from './account-avatars';
import type { TeamSnapshot } from '../lib/team-data';
import type { BackendSession } from '@/lib/backend-session';
import type { CSSProperties, FormEvent, KeyboardEvent, PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import './agent-panel.css';
import './member-chat.css';

function stamp(createdAt: string): string {
  const date = new Date(createdAt);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export function MemberChat({ controller, team, peerId, onClose, className, style, onHeaderPointerDown, floatBar, floatFooter }: {
  controller: BackendSession;
  team: TeamSnapshot;
  peerId: string;
  onClose(): void;
  /** 2026-11-12 左栏半卡片堆栈：外部传入的类/样式/头部抓取手势与独立小窗装饰。 */
  className?: string;
  style?: CSSProperties;
  onHeaderPointerDown?: (event: ReactPointerEvent<HTMLElement>) => void;
  floatBar?: ReactNode;
  floatFooter?: ReactNode;
}): JSX.Element {
  const selfId = team.userId;
  const peer = team.members.find(member => member.userId === peerId);
  const tones = avatarTonesFor(team.members);
  const presets = useAvatarPresetsFor(team.members, selfId);
  const tone = tones.get(peerId);
  const preset = presets.get(peerId);
  const isSelf = peerId === selfId;
  const name = peer?.displayName ?? '团队成员';
  const thread = useTeamThread(controller, team.studioId, peerId, selfId);
  const [draft, setDraft] = useState('');
  const feed = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const box = feed.current;
    if (box) box.scrollTop = box.scrollHeight;
    input.current?.focus();
  }, [thread.messages.length]);

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (await thread.send(draft)) setDraft('');
  };

  const onKeydown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  };

  return <aside className={`sc-person-chat${className ? ` ${className}` : ''}`} style={style} aria-label={isSelf ? '给自己留话' : `和 ${name} 的对话`} tabIndex={-1}
    onKeyDown={event => { if (event.key === 'Escape') onClose(); }}>
    {floatBar}
    <header className="sc-person-chat-head" onPointerDown={onHeaderPointerDown}
      style={onHeaderPointerDown ? { cursor: 'grab', touchAction: 'none' } : undefined}>
      <span className={`sc-settings-avatar is-rail${preset ? ' is-image' : ''}`} data-tone={tone?.id} style={avatarToneStyle(tone)} aria-hidden="true">
        {preset ? <img src={preset.src} alt=""/> : name.slice(0, 1)}
      </span>
      <h2>{isSelf ? '给自己留话' : `${name} · `}{!isSelf && peer ? <span className="sc-person-chat-role">{roleLabel(peer.role)}</span> : null}</h2>
      <button type="button" className="sc-person-chat-close" aria-label="关闭对话" onClick={onClose}><X size={18}/></button>
    </header>
    <div className="ap-feed sc-person-chat-feed" ref={feed} aria-live="polite">
      {thread.messages.map(message => message.fromUserId === selfId
        ? <div key={message.id} className="ap-user"><div><strong title={stamp(message.createdAt)}>{message.body}</strong></div></div>
        : <div key={message.id} className="ap-turn"><p className="ap-agent" title={stamp(message.createdAt)}>{message.body}</p></div>)}
      {thread.messages.length === 0 && <p className="sc-person-chat-hint">{thread.loading ? '正在取消息…' : isSelf ? '还没有留过话。' : '还没有说过话。'}</p>}
    </div>
    {thread.error && <p className="sc-person-chat-status" role="status">{thread.error}<button type="button" onClick={thread.refresh}>重试</button></p>}
    <form className="ap-composer" onSubmit={event => void submit(event)}>
      <label className="sr-only" htmlFor="sc-person-input">{isSelf ? '写给自己的消息' : `发给 ${name} 的消息`}</label>
      <div className="ap-composer-field">
        <textarea
          id="sc-person-input"
          ref={input}
          rows={1}
          value={draft}
          maxLength={2000}
          placeholder={isSelf ? '留一句话给自己' : `发一条给 ${name}`}
          onChange={event => setDraft(event.target.value)}
          onKeyDown={onKeydown}
        />
      </div>
      <div className="ap-composer-bar">
        <span className="sc-person-chat-note">{isSelf ? '只有你自己看得到' : `只有你和 ${name} 看得到`}</span>
        <button type="submit" className="ap-send" aria-label={thread.sending ? '发送中' : '发送'} disabled={!draft.trim() || thread.sending}><ArrowUp size={18}/></button>
      </div>
    </form>
    {floatFooter}
  </aside>;
}
