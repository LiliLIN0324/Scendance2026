'use client';

import { Crown, RefreshCw, Trash2, UserPlus } from '@/components/solid-icons';
import { useState, type ReactNode } from 'react';
import type { BackendSession } from '@/lib/backend-session';
import { notifyTeamChanged, useTeam } from '../lib/team-data';
import { avatarToneStyle, avatarTonesFor, useAvatarPresetsFor } from './account-avatars';
import { InfoTip } from './info-tip';

/** 与左轨成员位同一份取数：面板改完成员，左轨跟着换。 */
export function AccountTeamPanel({ controller }: { controller: BackendSession }): JSX.Element {
  const team = useTeam(controller);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [removing, setRemoving] = useState('');

  const isOwner = team.members.some(member => member.userId === team.userId && member.role === 'owner');
  const tones = avatarTonesFor(team.members);
  const presets = useAvatarPresetsFor(team.members, team.userId);
  const studioPath = (suffix = '') => `/studios/${encodeURIComponent(team.studioId)}${suffix}`;

  async function run(action: () => Promise<void>, done: string): Promise<void> {
    setBusy(true); setNotice('');
    try {
      await action();
      notifyTeamChanged();
      setNotice(done);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '操作没成功，请重试。');
    } finally {
      setBusy(false);
    }
  }

  if (!team.userId) return <TeamFrame notice="登录后才能看到团队成员。" busy={false}><p className="sc-account-empty">在账户中心登录后，这里会显示你所在团队的成员。</p></TeamFrame>;
  if (team.error) return <TeamFrame notice={team.error} busy={busy} onRefresh={team.refresh}><p className="sc-account-empty">{team.error}</p></TeamFrame>;
  if (team.loading && !team.members.length) return <TeamFrame notice="" busy><p className="sc-account-empty" role="status">正在加载成员…</p></TeamFrame>;
  if (!team.studioId) return <TeamFrame notice="" busy><p className="sc-account-empty">你还没有团队。在「所有文件」里新建一个工作室，成员就会出现在这里和左轨上。</p></TeamFrame>;

  return <TeamFrame notice={notice} busy={busy} onRefresh={team.refresh}>
    <label className="sc-settings-row sc-settings-studio-row">
      <span className="sc-settings-row-main"><strong>团队名称</strong></span>
      {isOwner
        ? <span className="sc-settings-invite-actions"><input className="sc-settings-input" aria-label="团队名称" maxLength={120} defaultValue={team.teamName} onBlur={event => { const next = event.target.value.trim(); if (!next || next === team.teamName) { event.target.value = team.teamName; return; } void run(async () => { await controller.businessRequest(studioPath(), 'PATCH', { name: next }); }, '团队名称已更新。'); }} /></span>
        : <span className="sc-settings-muted">{team.teamName}</span>}
    </label>
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
          ? <span className="sc-settings-owner-mark" title="负责人" aria-label="负责人"><Crown size={14} aria-hidden="true"/></span>
          : isOwner ? <>
            {removing !== member.userId
              ? <button className="sc-settings-icon-button" type="button" aria-label={`移除成员${member.displayName}`} title="移除" disabled={busy} onClick={() => setRemoving(member.userId)}><Trash2 size={15} aria-hidden="true"/></button>
              : <span className="sc-settings-invite-actions"><button type="button" disabled={busy} onClick={() => void run(async () => { await controller.businessRequest(`${studioPath()}/members/${encodeURIComponent(member.userId)}`, 'DELETE'); setRemoving(''); }, `已移除「${member.displayName}」。`)}>确认</button><button type="button" onClick={() => setRemoving('')}>取消</button></span>}
          </> : null}
      </div>
    </div>; })}
    {isOwner && <form className="sc-settings-invite is-email" onSubmit={event => {
      event.preventDefault();
      const inviteEmail = email.trim().toLowerCase();
      if (!inviteEmail || !inviteEmail.includes('@')) { setNotice('请填写对方注册用的邮箱。'); return; }
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

function TeamFrame({ notice, busy, onRefresh, children }: {
  notice: string; busy: boolean; onRefresh?(): void; children: ReactNode;
}): JSX.Element {
  return <section className="sc-settings" aria-label="团队">
    <header className="sc-settings-head">
      <div className="sc-settings-title"><h3>成员</h3><InfoTip key="team" label="成员说明"><strong>用邮箱加人</strong><span>填写对方已注册的登录邮箱即可；对方需先有账号。左轨头像与这份名单同源。</span></InfoTip></div>
      <div className="sc-settings-tools">{onRefresh && <button className="sc-settings-icon-button" type="button" aria-label="刷新成员" title="刷新" disabled={busy} onClick={onRefresh}><RefreshCw size={15} aria-hidden="true"/></button>}</div>
    </header>
    <div className="sc-settings-group">{children}</div>
    {notice && <p className="sc-cloud-message" role="status">{notice}</p>}
  </section>;
}
