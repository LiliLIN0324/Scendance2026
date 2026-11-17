import type { EventProfile } from '../../lib/event-profile';
import { eventProfileContext } from '../../lib/event-profile-context';

/**
 * 活动顶栏（P1-3）：先给天数、待确认数与一项下一步，而不是空白画布。
 * 日期未确认就照实写"日期待确认"，不拿简报或今天顶替。
 */
export interface EventProfileTopBarProps {
  profile?: EventProfile | undefined;
  /** 便于测试注入固定时刻；缺省取当前时间。 */
  now?: string;
}

export function EventProfileTopBar({ profile, now = new Date().toISOString() }: EventProfileTopBarProps) {
  const facts = eventProfileContext(profile);
  const pending = facts.filter(fact => fact.state !== 'confirmed');
  const date = facts.find(fact => fact.key === 'date');
  const next = pending[0] ?? null;
  let head = '日期待确认';
  if (date?.state === 'confirmed' && date.valueText && /^\d{4}-\d{2}-\d{2}$/.test(date.valueText)) {
    const days = Math.ceil((Date.parse(`${date.valueText}T00:00:00Z`) - Date.parse(now)) / 86_400_000);
    head = days >= 0 ? `距活动 ${days} 天` : `活动已过 ${-days} 天`;
  }
  return (
    <div className="sc-event-top" role="group" aria-label="活动概览">
      <strong>{head}</strong>
      <span>{`待确认 ${pending.length} 项`}</span>
      <span>{`下一步：${next ? `确认${next.label}` : '无'}`}</span>
    </div>
  );
}
