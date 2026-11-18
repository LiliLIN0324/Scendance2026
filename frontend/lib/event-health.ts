import type { RoomLayout } from '../components/room-organizer/lib/types';
import { eventProfileContext } from './event-profile-context';
import { rosterSummary, type Roster } from './event-roster';
import { latestDeclaration, supplierStatusView, type SupplierLedger } from './supplier-declarations';

/** 筹备体检（P2-4）：只报当前记录能证明的缺口；同输入重复调用结果一致。 */
export type HealthSeverity = 'overdue' | 'missing' | 'unconfirmed';

export interface HealthIssue {
  id: string;
  severity: HealthSeverity;
  source: 'task' | 'profile' | 'roster' | 'supplier';
  text: string;
}

export interface EventHealth {
  asOf: string;
  issues: HealthIssue[];
  /** 无逾期、无缺口、无待确认时为 true。 */
  quiet: boolean;
}

export function eventHealth(input: {
  layout: RoomLayout;
  roster?: Roster | undefined;
  suppliers?: SupplierLedger | undefined;
  now: string;
}): EventHealth {
  if (!Number.isFinite(Date.parse(input.now))) throw new Error('请提供有效的当前时间。');
  const issues: HealthIssue[] = [];
  const { layout } = input;

  for (const task of layout.eventOperations?.tasks ?? []) {
    if (task.status !== 'accepted' && task.plannedEndAt !== null && Date.parse(task.plannedEndAt) < Date.parse(input.now)) {
      issues.push({ id: `task-overdue:${task.id}`, severity: 'overdue', source: 'task',
        text: `逾期未完成：${task.title}` });
    }
    const missing = [!task.ownerName.trim() && '负责人', task.plannedStartAt === null && '开始时间',
      task.plannedEndAt === null && '结束时间', !task.acceptance.trim() && '完成条件'].filter(Boolean);
    if (missing.length) {
      issues.push({ id: `task-missing:${task.id}`, severity: 'missing', source: 'task',
        text: `${task.title} 缺少${missing.join('、')}` });
    }
  }

  for (const fact of eventProfileContext(layout.eventProfile)) {
    if (fact.state === 'unknown' || fact.state === 'absent') {
      issues.push({ id: `profile:${fact.key}`, severity: 'missing', source: 'profile',
        text: `活动档案未记录：${fact.label}` });
    }
  }

  if (input.roster) {
    const summary = rosterSummary(input.roster);
    if (summary.plusOnesUnknown > 0) {
      issues.push({ id: 'roster-plus-ones', severity: 'unconfirmed', source: 'roster',
        text: `${summary.plusOnesUnknown} 位已到场嘉宾的携伴人数未确认` });
    }
    const travelUndecided = input.roster.guests.filter(guest => !guest.optedOut && guest.needsTravel === null).length;
    if (travelUndecided > 0) {
      issues.push({ id: 'roster-travel', severity: 'unconfirmed', source: 'roster',
        text: `${travelUndecided} 位嘉宾是否需要出行接送未确认` });
    }
  }

  if (input.suppliers) {
    for (const name of [...new Set(input.suppliers.declarations.map(row => row.supplierName))].sort()) {
      const view = supplierStatusView(input.suppliers, name, input.now);
      if (view.needsFollowUp) {
        issues.push({ id: `supplier:${name}`, severity: 'unconfirmed', source: 'supplier',
          text: `供应商「${name}」${view.lastFollowUpAt ? `已 ${view.daysSinceFollowUp} 天未跟进` : '尚未跟进'}，当前${view.statusText}` });
      }
    }
  }

  const ordered = issues.sort((a, b) => (a.severity === 'overdue' ? 0 : a.severity === 'missing' ? 1 : 2)
    - (b.severity === 'overdue' ? 0 : b.severity === 'missing' ? 1 : 2) || a.id.localeCompare(b.id));
  return { asOf: input.now, issues: ordered, quiet: ordered.length === 0 };
}

/** 供应商晚到/未声明只按声明记录陈述，不猜测。 */
export function supplierArrivalGap(ledger: SupplierLedger, now: string): { declaredLate: string[]; undeclared: string[] } {
  const names = [...new Set(ledger.declarations.map(row => row.supplierName))];
  const declaredLate = names.filter(name => {
    const row = latestDeclaration(ledger, name);
    return row?.arrivalAt !== null && row?.arrivalAt !== undefined && Date.parse(row.arrivalAt) < Date.parse(now);
  });
  return { declaredLate, undeclared: [] };
}
