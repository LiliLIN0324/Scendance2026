import type { RoomLayout } from '../components/room-organizer/lib/types';
import { taskTiming } from './event-day';
import { eventProfileContext } from './event-profile-context';
import { rosterSummary, type Roster } from './event-roster';
import { latestDeclaration, type SupplierLedger } from './supplier-declarations';

/**
 * 当天执行包（P1-4）：纯 HTML/CSS，不联网、不带脚本、不落第二份数字。
 * 缺数据的段整段省略；每个数字注明来自哪份记录。
 */
const escape = (value: string): string => value.replace(/[&<>"']/g, char =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);

const SHANGHAI = 'Asia/Shanghai';

function shanghaiParts(iso: string, withClock: boolean): Intl.DateTimeFormatPart[] {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: SHANGHAI, year: 'numeric', month: '2-digit', day: '2-digit',
    ...(withClock ? { hour: '2-digit' as const, minute: '2-digit' as const, hourCycle: 'h23' as const } : {}),
  }).formatToParts(new Date(iso));
}

function shanghaiPart(parts: Intl.DateTimeFormatPart[], type: string): string {
  return parts.find(part => part.type === type)?.value ?? '';
}

/** 日历日按北京时间，不用 UTC 的日期前缀。凌晨仍属于上海的下一天。 */
export function shanghaiCalendarDate(iso: string): string {
  const parts = shanghaiParts(iso, false);
  return `${shanghaiPart(parts, 'year')}-${shanghaiPart(parts, 'month')}-${shanghaiPart(parts, 'day')}`;
}

function shanghaiGeneratedAt(iso: string): string {
  const parts = shanghaiParts(iso, true);
  const hour = shanghaiPart(parts, 'hour') === '24' ? '00' : shanghaiPart(parts, 'hour');
  return `${shanghaiCalendarDate(iso)} ${hour}:${shanghaiPart(parts, 'minute')}（Asia/Shanghai）`;
}

const clock = (iso: string | null): string => iso === null ? '待安排'
  : new Date(iso).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });

export interface DaySheetInput {
  layout: RoomLayout;
  roster?: Roster | undefined;
  suppliers?: SupplierLedger | undefined;
  generatedAt: string;
}

export function renderDaySheet(input: DaySheetInput): string {
  if (!Number.isFinite(Date.parse(input.generatedAt))) throw new Error('请记录有效的生成时间。');
  const { layout } = input;
  const operations = layout.eventOperations;
  const kind = operations?.dataKind === 'rehearsal' ? '演练执行包' : operations?.dataKind === 'real' ? '当天执行包' : '当天执行包（资料性质未定）';
  const facts = eventProfileContext(layout.eventProfile);
  const sections: string[] = [];

  const tasks = [...(operations?.tasks ?? [])].sort((a, b) =>
    (a.plannedStartAt ?? '9999').localeCompare(b.plannedStartAt ?? '9999') || a.title.localeCompare(b.title));
  if (tasks.length) {
    sections.push('<h2>流程</h2><table><thead><tr><th>时间</th><th>事项</th><th>负责人</th><th>时长</th></tr></thead><tbody>'
      + tasks.map(task => {
        const timing = taskTiming(task);
        return `<tr><td>${clock(task.plannedStartAt)}–${clock(task.plannedEndAt)}</td><td>${escape(task.title)}</td>`
          + `<td>${task.ownerName.trim() ? escape(task.ownerName) : '待指定'}</td>`
          + `<td>${timing.durationMinutes === null ? '不完整' : `${timing.durationMinutes} 分钟`}</td></tr>`;
      }).join('') + '</tbody></table>');
  }

  if (input.suppliers) {
    const names = [...new Set(input.suppliers.declarations.map(row => row.supplierName))];
    const arrivals = names.flatMap(name => {
      const row = latestDeclaration(input.suppliers!, name);
      return row?.arrivalAt ? [{ name, row }] : [];
    });
    if (arrivals.length) {
      sections.push('<h2>供应商到达</h2><ul>' + arrivals.map(({ name, row }) =>
        `<li>${escape(name)} · ${clock(row.arrivalAt)} 到达${row.contactPhone ? ` · ${escape(row.contactPhone)}` : ' · 电话未记录'}</li>`).join('') + '</ul>');
    }
  }

  if (input.roster) {
    const summary = rosterSummary(input.roster);
    const expected = facts.find(fact => fact.key === 'expectedAttendance');
    const stateTag = expected ? ({ confirmed: '已确认', pending: '待确认', inferred: '推断，需人工确认',
      unknown: '待确认', absent: '未记录' } as const)[expected.state] : '待确认';
    const parts = [`报名 ${summary.byStatus.registered} 人`,
      `预期到场 ${expected?.valueText ?? '待确认'}（${stateTag} · 活动档案）`];
    if (summary.attended) parts.push(`已出席 ${summary.attendedWithPlusOnes} 人（含携伴）`);
    if (summary.plusOnesUnknown) parts.push(`携伴未确认 ${summary.plusOnesUnknown} 位`);
    if (summary.dietaryGuestIds.length) parts.push(`饮食要求 ${summary.dietaryGuestIds.length} 位`);
    if (summary.accessibilityGuestIds.length) parts.push(`无障碍需求 ${summary.accessibilityGuestIds.length} 位`);
    sections.push('<h2>人数与需求</h2><p>' + parts.map(escape).join(' · ') + '</p>');

    const travellers = input.roster.guests.filter(guest => !guest.optedOut && guest.needsTravel === true);
    const pickups = input.roster.guests.filter(guest => !guest.optedOut && guest.needsTravel === true && guest.note.trim());
    if (travellers.length) {
      sections.push('<h2>外地抵达</h2><ul>' + travellers.map(guest =>
        `<li>${escape(guest.name)}${pickups.includes(guest) ? ` · ${escape(guest.note)}` : ' · 接站人未记录'}</li>`).join('') + '</ul>');
    }
  }

  const unfinished = tasks.filter(task => task.status !== 'accepted');
  const unknownFacts = facts.filter(fact => fact.state === 'unknown' || fact.state === 'absent');
  if (unfinished.length || unknownFacts.length) {
    const items = [...unfinished.map(task => `未完成：${task.title}`),
      ...unknownFacts.map(fact => `未确认：${fact.label}`)].map(escape);
    sections.push('<h2>未确认与未完成</h2><ul>' + items.map(item => `<li>${item}</li>`).join('') + '</ul>');
  }

  return ['<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">',
    `<meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(kind)}</title>`,
    '<style>body{font-family:system-ui,sans-serif;margin:24px;line-height:1.6;color:#222}',
    'h1{font-size:20px}h2{font-size:16px;margin-top:24px;border-bottom:1px solid #ddd;padding-bottom:4px}',
    'table{border-collapse:collapse;width:100%;font-size:14px}th,td{border:1px solid #ddd;padding:6px;text-align:left}',
    'ul{padding-left:20px}@media print{body{margin:0}}</style></head><body>',
    `<h1>${escape(kind)}</h1><p>${escape(layout.name || '未命名活动')} · 生成于 ${escape(shanghaiGeneratedAt(input.generatedAt))}</p>`,
    ...sections, '</body></html>'].join('');
}
