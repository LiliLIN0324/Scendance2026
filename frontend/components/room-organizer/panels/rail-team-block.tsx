'use client';

import { roleLabel, type TeamSnapshot } from '../lib/team-data';
import { useTeamUnread } from '../lib/team-messages';
import { avatarToneStyle, avatarTonesFor, useAvatarPresetsFor } from './account-avatars';
import type { BackendSession } from '@/lib/backend-session';

/**
 * 左轨 bot 形体下面的成员位：与「团队与权限」读同一份成员，头像用同一个样式类、同一套分色，
 * 所以两处的人、名字、圆片和颜色必然对得上；自己那颗跟着选过的头像走。
 * 窄轨不放名字，悬停或聚焦才出右侧黑胶囊。
 * 点谁的头就是给谁发消息（自己的那颗是留话），红数字只在真有未读时出现。
 */
export function RailTeamBlock({ controller, team, onOpenChat, onOpenTeam }: {
  controller: BackendSession;
  team: TeamSnapshot;
  onOpenChat(member: TeamSnapshot['members'][number]): void;
  onOpenTeam(): void;
}): JSX.Element {
  const tones = avatarTonesFor(team.members);
  const presets = useAvatarPresetsFor(team.members, team.userId);
  const unread = useTeamUnread(controller, team.studioId, team.userId);
  const summary = !team.userId ? '登录后查看团队成员'
    : team.error ? team.error
    : team.loading && team.members.length === 0 ? '正在加载团队…'
    : !team.teamName ? '团队加载中…'
    : `${team.teamName} · ${team.members.length} 位成员`;
  return <nav className="sc-rail-team" aria-label="团队成员">
    {team.members.map(member => { const tone = tones.get(member.userId); const preset = presets.get(member.userId); const pending = unread.get(member.userId) ?? 0;
      const isSelf = member.userId === team.userId;
      return <button
      key={member.userId}
      type="button"
      className="sc-rail-member"
      data-tip={`${member.displayName} · ${roleLabel(member.role)}${pending ? ` · ${pending} 条未读` : ''}`}
      aria-label={`${isSelf ? '给自己留话' : `给 ${member.displayName} 发消息`}${pending ? `，${pending} 条未读` : ''}`}
      onClick={() => onOpenChat(member)}
    >
      <span className={`sc-settings-avatar is-rail${preset ? ' is-image' : ''}`} data-tone={tone?.id} style={avatarToneStyle(tone)} aria-hidden="true">
        {preset ? <img src={preset.src} alt=""/> : member.displayName.slice(0, 1)}
      </span>
      {pending > 0 && <span className="sc-rail-member-badge" aria-hidden="true">{pending > 9 ? '9+' : pending}</span>}
    </button>; })}
    {team.members.length === 0 && <button
      type="button"
      className="sc-rail-member is-placeholder"
      data-tip={summary}
      aria-label={summary}
      onClick={onOpenTeam}
    >
      <span className="sc-settings-avatar is-rail" aria-hidden="true">{team.loading ? '…' : '·'}</span>
    </button>}
  </nav>;
}
