'use client';

import { ArrowUp, Maximize2, RailBingo, RailCrate, RailSpace } from '@/components/solid-icons';
import { AGENT_META, useAgent, type AgentId } from './agent-panel';
import { RailAvatar } from './rail-avatar';
import './mobile-shell.css';

/**
 * 对话条左侧只保留一张门厅脸；Bingo / 空间 / 物料改用与左轨一致的线性图标，
 * 不再各自带一张实体头像（ball / cube / pyramid 已于 2026-11-21 删除）。
 */
function AgentGlyph({ agentId, size }: { agentId: AgentId; size: number }): JSX.Element {
  if (agentId === 'door') return <RailAvatar size={size} />;
  if (agentId === 'bingo') return <RailBingo size={size} />;
  if (agentId === 'space') return <RailSpace size={size} />;
  return <RailCrate size={size} />;
}

/**
 * 手机端对话收起条：一条最新消息 + 一行输入。
 * 点任意位置展开底部抽屉（真正的对话仍由 AgentPanel 承载），
 * 桌面端由 CSS 隐藏，不参与布局。
 */
export function MobileAgentDock({ agentId, onOpen }: { agentId: AgentId; onOpen(): void }): JSX.Element {
  const agent = useAgent();
  const meta = AGENT_META[agentId];
  const latest = [...agent.bubbles].reverse().find(bubble => (bubble.text ?? '').trim());
  const line = (latest?.text ?? '').replace(/\s+/g, ' ').trim() || `${meta.name} · 说一句就能开始`;
  return (
    <button
      type="button"
      className="sc-mobile-dock"
      data-agent={agentId}
      aria-label={`展开 ${meta.name} 对话`}
      onClick={onOpen}
    >
      <span className="sc-mobile-dock-msg">
        <span className="sc-mobile-dock-glyph" style={{ display: 'inline-flex', alignItems: 'center', flex: 'none' }}>
          <AgentGlyph agentId={agentId} size={22} />
        </span>
        <span>{line}</span>
        <Maximize2 size={16} aria-hidden="true" />
      </span>
      <span className="sc-mobile-dock-field">
        <span>说一句就好…</span>
        <span className="sc-mobile-dock-send" aria-hidden="true"><ArrowUp size={16} /></span>
      </span>
    </button>
  );
}
