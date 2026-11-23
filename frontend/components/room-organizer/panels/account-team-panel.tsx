'use client';

import { KeyRound, RefreshCw, Trash2, UserPlus } from '@/components/solid-icons';
import { useState, type ReactNode } from 'react';
import { backendFailureText, type BackendSession } from '@/lib/backend-session';
import { notifyTeamChanged, useTeam } from '../lib/team-data';
import { avatarToneStyle, avatarTonesFor, useAvatarPresetsFor } from './account-avatars';
import { InfoTip } from './info-tip';

/**
 * 与消息面板同一份取数：面板改完成员，消息列表跟着换。
 * studioId：账户弹窗把左栏当前选中的团队传进来，名单跟着侧栏上下文走；
 * 不传（消息面板等）保持原推断——项目所属工作室优先，其次本机记住的。
 */
export function AccountTeamPanel({ controller, studioId, onStudioRenamed }: { controller: BackendSession; studioId?: string; /** 改名后把新名字交给上层（左栏 / 项目页标题同属同一份 studios 状态）。 */ onStudioRenamed?(studioId: string, name: string): void }): JSX.Element {
  const team = useTeam(controller, studioId);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [noticeError, setNoticeError] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [removing, setRemoving] = useState('');
  // 2026-11-18：团队名从“只能写死在上游”改成面板顶部可改。
  const [renaming, setRenaming] = useState(false);
  const [draftName, setDraftName] = useState('');

  const isOwner = team.members.some(member => member.userId === team.userId && member.role === 'owner');
  const tones = avatarTonesFor(team.members);
  const presets = useAvatarPresetsFor(team.members, team.userId);
  const studioPath = (suffix = '') => `/studios/${encodeURIComponent(team.studioId)}${suffix}`;

  function say(text: string, isError = false): void {
    setNoticeError(isError);
    setNotice(text);
  }
  async function run(action: () => Promise<void>, done: string): Promise<void> {
    setBusy(true); say('');
    try {
      await action();
      notifyTeamChanged();
      say(done);
    } catch (error) {
      const coded = error && typeof error === 'object' && 'code' in error && typeof (error as { code: unknown }).code === 'string';
      say(coded ? backendFailureText(error) : error instanceof Error ? error.message : '操作没成功，请重试。', true);
    } finally {
      setBusy(false);
    }
  }

  /**
   * 2026-11-18：顶部团队名点一下变输入框，回车走 PATCH /studios/:id（api.ts 只收 {name}，trim 后 1–120 字）。
   * 改完交给 onStudioRenamed，再喊一次 notifyTeamChanged()，左轨和这张名单读的是同一份。
   */
  async function commitRename(): Promise<void> {
    const name = draftName.trim();
    if (!name || name === team.teamName) { setRenaming(false); setDraftName(''); return; }
    const renamed = await controller.businessRequest<{ id: string; name: string }>(studioPath(), 'PATCH', { name });
    setRenaming(false); setDraftName('');
    onStudioRenamed?.(renamed.id, renamed.name);
  }

  if (!team.userId) return <TeamFrame notice="登录后才能看到团队成员。" busy={false}><p className="sc-account-empty">登录后这里会列出成员。</p></TeamFrame>;
  if (team.error) return <TeamFrame notice={team.error} alert busy={busy} onRefresh={team.refresh}><p className="sc-account-empty">{team.error}</p></TeamFrame>;
  if (team.loading && !team.members.length) return <TeamFrame notice="" busy><p className="sc-account-empty" role="status">正在加载成员…</p></TeamFrame>;
  if (!team.studioId) return <TeamFrame notice="" busy><p className="sc-account-empty">还没有团队。左栏「＋ 新建团队」建一个。</p></TeamFrame>;

  // 2026-11-22 用户拍板：邀请钮只给负责人——非负责人此前点了才报「只有负责人可以邀请成员」，不能用就不该渲染。
  return <TeamFrame title={!isOwner
    ? <h3>{team.teamName}</h3>
    : renaming
      ? <form className="sc-settings-rename" aria-label={`重命名团队${team.teamName}`} onSubmit={event => { event.preventDefault(); void run(commitRename, '团队名已更新。'); }}>
        <input aria-label="团队新名称" type="text" maxLength={120} value={draftName} autoFocus
          onChange={event => setDraftName(event.target.value)}
          onKeyDown={event => { if (event.key === 'Escape') { setRenaming(false); setDraftName(''); } }}/>
      </form>
      : <button type="button" className="sc-settings-title-name" aria-label={`重命名团队${team.teamName}`} onClick={() => { setDraftName(team.teamName); setRenaming(true); }}>{team.teamName}</button>}
    notice={notice} alert={noticeError} busy={busy} onRefresh={team.refresh} {...(isOwner ? { onInvite: () => setInviteOpen(open => !open) } : {})} inviteOpen={inviteOpen}>
    <div className="sc-settings-columns" aria-hidden="true"><span>成员</span><span>角色</span></div>
    {team.members.map(member => { const tone = tones.get(member.userId); const preset = presets.get(member.userId); return <div className="sc-settings-row" key={member.userId}>
      <span className={`sc-settings-avatar is-rail${preset ? ' is-image' : ''}`} data-tone={tone?.id} style={avatarToneStyle(tone)} aria-hidden="true">
        {preset ? <img src={preset.src} alt=""/> : member.displayName.slice(0, 1)}
      </span>
      <div className="sc-settings-row-main">
        <strong>{member.displayName}{member.userId === team.userId ? ' · 你' : ''}</strong>
        {member.email
          ? <small className="sc-settings-contact" title={member.email}>{member.email}</small>
          : null}
      </div>
      <div className="sc-settings-row-actions">
        {member.role === 'owner'
          ? <span className="sc-settings-owner-mark" title="负责人" aria-label="负责人"><KeyRound size={14} aria-hidden="true"/></span>
          : isOwner ? <>
            {removing !== member.userId
              ? <button className="sc-settings-icon-button" type="button" aria-label={`移除成员${member.displayName}`} title="移除" disabled={busy} onClick={() => setRemoving(member.userId)}><Trash2 size={15} aria-hidden="true"/></button>
              : <span className="sc-settings-invite-actions"><button type="button" disabled={busy} onClick={() => void run(async () => { await controller.businessRequest(`${studioPath()}/members/${encodeURIComponent(member.userId)}`, 'DELETE'); setRemoving(''); }, `已移除「${member.displayName}」。`)}>确认</button><button type="button" onClick={() => setRemoving('')}>取消</button></span>}
          </> : null}
      </div>
    </div>; })}
    {isOwner && inviteOpen && <form className="sc-settings-invite is-email" onSubmit={event => {
      event.preventDefault();
      const inviteEmail = email.trim().toLowerCase();
      if (!inviteEmail || !inviteEmail.includes('@')) { say('请填写对方注册用的邮箱。', true); return; }
      void run(async () => {
        await controller.businessRequest(`${studioPath()}/members`, 'POST', { email: inviteEmail });
        setEmail('');
      }, `已邀请 ${inviteEmail} 加入团队。`);
    }}>
      <span className="sc-settings-invite-icon" aria-hidden="true"><UserPlus size={16}/></span>
      <input type="email" aria-label="成员邮箱" required maxLength={254} autoComplete="email" placeholder="对方登录邮箱" value={email} onChange={event => setEmail(event.target.value)} />
      <button className="sc-cloud-primary sc-settings-add" type="submit" disabled={busy} aria-label="添加成员">添加</button>
    </form>}
  </TeamFrame>;
}

function TeamFrame({ title, notice, alert = false, busy, onRefresh, onInvite, inviteOpen, children }: {
  title?: ReactNode; notice: string; alert?: boolean; busy: boolean; onRefresh?(): void; onInvite?(): void; inviteOpen?: boolean; children: ReactNode;
}): JSX.Element {
  return <section className="sc-settings" aria-label="团队成员">
    <header className="sc-settings-head">
      <div className="sc-settings-title">{title ?? <h3>成员</h3>}<InfoTip key="team" label="团队说明"><strong>团队名点一下就能改</strong><span>用邮箱加人：填写对方已注册的登录邮箱即可，对方需先有账号。消息面板里的成员与这份名单同源。</span></InfoTip></div>
      <div className="sc-settings-tools">
        {onRefresh && <button className="sc-settings-icon-button" type="button" aria-label="刷新成员" title="刷新" disabled={busy} onClick={onRefresh}><RefreshCw size={15} aria-hidden="true"/></button>}
        {onInvite && <button className="sc-settings-outline" type="button" aria-expanded={inviteOpen} onClick={onInvite}>邀请</button>}
      </div>
    </header>
    <div className="sc-settings-group">{title ? <h4 className="sc-settings-group-title">成员</h4> : null}{children}</div>
    {notice && <p className={alert ? 'sc-account-error' : 'sc-account-footnote'} role={alert ? 'alert' : 'status'}>{notice}</p>}
  </section>;
}
