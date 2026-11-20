'use client';

/**
 * 左轨「消息」入口：原先竖排在 bot 形体下的成员头像列收进这里，
 * 整枚钮和空间 / 物料 / 创作 / 户外规划同一套轨钮规格；红点是私信未读 + 官方通知未读之和。
 * 未登录时点钮不伪造会话，去账户中心登录。
 */
import { RailMessage } from '@/components/solid-icons';
import { useOfficialUnread } from '../lib/official-notices';
import { useTeamUnread } from '../lib/team-messages';
import type { TeamSnapshot } from '../lib/team-data';
import type { BackendSession } from '@/lib/backend-session';

export function RailMessagesButton({ controller, team, open, onToggle, onOpenAccount }: {
  controller: BackendSession;
  team: TeamSnapshot;
  open: boolean;
  onToggle(): void;
  onOpenAccount(): void;
}): JSX.Element {
  const unread = useTeamUnread(controller, team.studioId, team.userId);
  const officialUnread = useOfficialUnread(controller, team.userId);
  const total = [...unread.values()].reduce((sum, count) => sum + count, 0) + officialUnread;
  const summary = !team.userId ? '登录后查看消息' : team.error ? team.error : '消息';
  return <button
    type="button"
    className={`sc-rail-tool sc-rail-disc sc-rail-messages${open ? ' is-active' : ''}`}
    aria-pressed={open}
    aria-expanded={open}
    aria-controls="messages-panel"
    aria-label={summary}
    data-tip={summary}
    onClick={() => {
      if (!team.userId) { onOpenAccount(); return; }
      onToggle();
    }}
  >
    <RailMessage size={28} active={open} aria-hidden="true" />
    {total > 0 && <span className="sc-rail-message-badge" aria-hidden="true">{total > 9 ? '9+' : total}</span>}
    <span className="sc-rail-label" aria-hidden="true">消息</span>
  </button>;
}
