import { DEFAULT_PLAN_TIME_ZONE } from '../../supabase/functions/_shared/plan-editor';
import type { RoomLayout } from '../components/room-organizer/lib/types';
import { taskTiming } from './event-day';
import { isValidTimeZone } from './event-profile';
import { eventProfileContext } from './event-profile-context';
import { rosterSummary, type Roster } from './event-roster';
import { latestDeclaration, type SupplierLedger } from './supplier-declarations';

/**
 * 当天执行包（P1-4）：纯 HTML/CSS，不联网、不带脚本、不落第二份数字。
 * 缺数据的段整段省略；每个数字注明来自哪份记录。
 */
const escape = (value: string): string => value.replace(/[&<>"']/g, char =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);

const SHANGHAI = DEFAULT_PLAN_TIME_ZONE;

/** 方案时区优先，其次活动档案里已经确认过的时区，都没有或非法时用上海。 */
export function planTimeZone(layout: Pick<RoomLayout, 'planSettings' | 'eventProfile'>): string {
  const fromPlan = layout.planSettings?.timeZone;
  if (fromPlan && isValidTimeZone(fromPlan)) return fromPlan;
  const fromProfile = layout.eventProfile?.timeWindow.value?.timeZone;
  if (fromProfile && isValidTimeZone(fromProfile)) return fromProfile;
  return SHANGHAI;
}

function zoneParts(iso: string, timeZone: string, withClock: boolean): Intl.DateTimeFormatPart[] {
  const zone = isValidTimeZone(timeZone) ? timeZone : SHANGHAI;
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit',
    ...(withClock ? { hour: '2-digit' as const, minute: '2-digit' as const, hourCycle: 'h23' as const } : {}),
  }).formatToParts(new Date(iso));
}

function zonePart(parts: Intl.DateTimeFormatPart[], type: string): string {
  return parts.find(part => part.type === type)?.value ?? '';
}

/** 日历日按指定时区，不用 UTC 的日期前缀。跨日界线的凌晨仍属于当地的下一天。 */
export function zoneCalendarDate(iso: string, timeZone: string): string {
  const parts = zoneParts(iso, timeZone, false);
  return `${zonePart(parts, 'year')}-${zonePart(parts, 'month')}-${zonePart(parts, 'day')}`;
}

export function zoneGeneratedAt(iso: string, timeZone: string): string {
  const zone = isValidTimeZone(timeZone) ? timeZone : SHANGHAI;
  const parts = zoneParts(iso, zone, true);
  const hour = zonePart(parts, 'hour') === '24' ? '00' : zonePart(parts, 'hour');
  return `${zoneCalendarDate(iso, zone)} ${hour}:${zonePart(parts, 'minute')}（${zone}）`;
}

/** 日历日按北京时间，不用 UTC 的日期前缀。凌晨仍属于上海的下一天。 */
export function shanghaiCalendarDate(iso: string): string {
  return zoneCalendarDate(iso, SHANGHAI);
}

const clock = (iso: string | null): string => iso === null ? '待安排'
  : new Date(iso).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'] as const;
const CALENDAR_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** 执行单头部的日期写法：2026-12-20（周日）。用 UTC 反算星期，不跟运行环境时区漂。 */
export function daySheetDateLabel(day: string): string {
  const [year, month, date] = day.split('-').map(Number);
  const weekday = WEEKDAYS[new Date(Date.UTC(year!, month! - 1, date!)).getUTCDay()]!;
  return `${day}（${weekday}）`;
}

/** 交付版本身份：执行单要能说清「这一张纸基于哪一版」。 */
export interface DaySheetDeliveryIdentity {
  /** 当前内容对应的交付号；从没确认过时是待分配的号。 */
  version: string;
  status: 'none' | 'confirmed' | 'draft';
  /** draft 时上一次定稿的号，用来说明是在哪一版之后又改过。 */
  confirmedVersion?: string | null;
}

function deliveryIdentityLabel(delivery: DaySheetDeliveryIdentity | null | undefined): string | null {
  if (!delivery) return null;
  if (delivery.status === 'confirmed') return `定稿 ${delivery.version}`;
  if (delivery.status === 'draft') return `未定稿（已定稿的是 ${delivery.confirmedVersion ?? '—'}）`;
  return '未定稿';
}

export interface DaySheetInput {
  layout: RoomLayout;
  roster?: Roster | undefined;
  suppliers?: SupplierLedger | undefined;
  generatedAt: string;
  /** 只出这一天的流程（方案时区的日历日 YYYY-MM-DD）；不传 = 列出全部任务。 */
  day?: string | undefined;
  /** 交付版本身份；不传 = 旧调用，不标版本。 */
  delivery?: DaySheetDeliveryIdentity | null | undefined;
}

export function renderDaySheet(input: DaySheetInput): string {
  if (!Number.isFinite(Date.parse(input.generatedAt))) throw new Error('请记录有效的生成时间。');
  if (input.day !== undefined && !CALENDAR_DAY.test(input.day)) throw new Error('请选择有效的执行日期（YYYY-MM-DD）。');
  const { layout } = input;
  const timeZone = planTimeZone(layout);
  const operations = layout.eventOperations;
  const kind = operations?.dataKind === 'rehearsal' ? '演练执行包' : operations?.dataKind === 'real' ? '当天执行包' : '当天执行包（资料性质未定）';
  const facts = eventProfileContext(layout.eventProfile);
  const sections: string[] = [];

  const tasks = [...(operations?.tasks ?? [])].sort((a, b) =>
    (a.plannedStartAt ?? '9999').localeCompare(b.plannedStartAt ?? '9999') || a.title.localeCompare(b.title));
  const onDay = (iso: string | null | undefined): boolean =>
    input.day !== undefined && !!iso && zoneCalendarDate(iso, timeZone) === input.day;
  const dayTasks = input.day === undefined ? tasks : tasks.filter(task => onDay(task.plannedStartAt));
  const unscheduled = input.day === undefined ? [] : tasks.filter(task => !task.plannedStartAt);
  const sheetTasks = [...dayTasks, ...unscheduled];
  if (dayTasks.length) {
    sections.push('<h2>流程</h2><table><thead><tr><th>时间</th><th>事项</th><th>负责人</th><th>时长</th></tr></thead><tbody>'
      + dayTasks.map(task => {
        const timing = taskTiming(task);
        return `<tr><td>${clock(task.plannedStartAt)}–${clock(task.plannedEndAt)}</td><td>${escape(task.title)}</td>`
          + `<td>${task.ownerName.trim() ? escape(task.ownerName) : '待指定'}</td>`
          + `<td>${timing.durationMinutes === null ? '不完整' : `${timing.durationMinutes} 分钟`}</td></tr>`;
      }).join('') + '</tbody></table>');
  }

  // 没有计划时间的任务不属于任何一天，但正是现场最容易漏的事：单独列出，不藏。
  if (unscheduled.length) {
    sections.push('<h2>未排时间</h2><ul>' + unscheduled.map(task =>
      `<li>${escape(task.title)} · ${task.ownerName.trim() ? escape(task.ownerName) : '负责人待指定'}</li>`).join('') + '</ul>');
  }

  if (input.suppliers) {
    const names = [...new Set(input.suppliers.declarations.map(row => row.supplierName))];
    const arrivals = names.flatMap(name => {
      const row = latestDeclaration(input.suppliers!, name);
      return row?.arrivalAt && (input.day === undefined || onDay(row.arrivalAt)) ? [{ name, row }] : [];
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

  const unfinished = sheetTasks.filter(task => task.status !== 'accepted');
  const unknownFacts = facts.filter(fact => fact.state === 'unknown' || fact.state === 'absent');
  if (unfinished.length || unknownFacts.length) {
    const items = [...unfinished.map(task => `未完成：${task.title}`),
      ...unknownFacts.map(fact => `未确认：${fact.label}`)].map(escape);
    sections.push('<h2>未确认与未完成</h2><ul>' + items.map(item => `<li>${item}</li>`).join('') + '</ul>');
  }

  const meta = [layout.name || '未命名活动'];
  if (input.day) meta.push(daySheetDateLabel(input.day));
  const identity = deliveryIdentityLabel(input.delivery);
  if (identity) meta.push(identity);
  meta.push(`生成于 ${zoneGeneratedAt(input.generatedAt, timeZone)}`);

  return ['<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">',
    `<meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(kind)}</title>`,
    '<style>body{font-family:system-ui,sans-serif;margin:24px;line-height:1.6;color:#222}',
    'h1{font-size:20px}h2{font-size:16px;margin-top:24px;border-bottom:1px solid #ddd;padding-bottom:4px}',
    'table{border-collapse:collapse;width:100%;font-size:14px}th,td{border:1px solid #ddd;padding:6px;text-align:left}',
    'ul{padding-left:20px}.sheet-foot{margin-top:28px;color:#666;font-size:12px}',
    '@page{margin:12mm}@media print{body{margin:0}thead{display:table-header-group}h2{break-after:avoid}tr{break-inside:avoid}}',
    '</style></head><body>',
    `<h1>${escape(kind)}</h1><p>${meta.map(escape).join(' · ')}</p>`,
    ...sections,
    '<p class="sheet-foot">内部执行资料 · 含联系方式与个人需求，请勿外发。</p>',
    '</body></html>'].join('');
}
