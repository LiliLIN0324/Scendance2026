import { useState } from 'react';
import {
  applyEventProfileProposal, eventProfileContext,
  type EventProfileContextFact, type EventProfileProposal,
} from '../../lib/event-profile-context';
import type { EventProfile } from '../../lib/event-profile';

/**
 * 活动档案卡片（只读事实 + 提案预览 + 人工确认）。
 * 组件本身不落盘：确认后把新档案交回调用方，由现有的本地布局写入链路保存。
 */
export interface EventProfileCardProps {
  profile?: EventProfile;
  proposal?: EventProfileProposal;
  /** 内部字段（预算、分工）默认不显示，避免被顺手贴进客户产物。 */
  showInternal?: boolean;
  onCommit?: (next: EventProfile) => void;
}

const stateLabels: Record<EventProfileContextFact['state'], string> = {
  confirmed: '已确认', pending: '待确认', inferred: '推断，需人工确认',
  unknown: '待确认（未填写，不得推测）', absent: '未记录',
};

function factText(fact: EventProfileContextFact): string {
  if (fact.state === 'unknown' || fact.state === 'absent' || !fact.valueText) return stateLabels[fact.state];
  return `${fact.valueText}（${stateLabels[fact.state]}）`;
}

export function EventProfileCard({ profile, proposal, showInternal = false, onCommit }: EventProfileCardProps) {
  const [confirmedBy, setConfirmedBy] = useState('');
  const [message, setMessage] = useState<{ kind: 'saved' | 'error'; text: string } | null>(null);
  const facts = eventProfileContext(profile).filter(fact => showInternal || !fact.internal);

  const commit = () => {
    if (!profile || !proposal) return;
    try {
      const next = applyEventProfileProposal(profile, proposal, {
        confirmedBy, confirmedAt: new Date().toISOString(),
      });
      setMessage({ kind: 'saved', text: `已按确认人「${confirmedBy.trim()}」记录，版本 v${next.revision}。` });
      onCommit?.(next);
    } catch (error) {
      setMessage({ kind: 'error', text: error instanceof Error ? error.message : '活动档案未写入，请重新核对。' });
    }
  };

  return (
    <section className="event-profile-card" aria-label="活动档案">
      <header>
        <h3>活动档案</h3>
        <span>{profile ? `v${profile.revision}` : '尚未创建'}</span>
      </header>
      <p>只读记录：未确认项不得当作事实，推断与预设不会被写成已确认。</p>
      <ul>
        {facts.map(fact => (
          <li key={fact.key} data-state={fact.state}>
            <span>{fact.label}</span>
            <strong>{factText(fact)}</strong>
            {fact.note ? <small>{`依据：${fact.note}`}</small> : null}
          </li>
        ))}
      </ul>
      {proposal ? (
        <fieldset>
          <legend>提议改动（待人工确认）</legend>
          <ul>
            {proposal.changedKeys.map(key => {
              const fact = proposal.preview[key];
              return <li key={key}>{`${key}：${fact.value === null ? '清空' : String(fact.value)}`}</li>;
            })}
          </ul>
          <label>
            确认人
            <input value={confirmedBy} onChange={event => setConfirmedBy(event.target.value)} />
          </label>
          <button type="button" disabled={!profile || !confirmedBy.trim()} onClick={commit}>确认写入</button>
        </fieldset>
      ) : null}
      {message ? <p role={message.kind === 'error' ? 'alert' : 'status'}>{message.text}</p> : null}
    </section>
  );
}
