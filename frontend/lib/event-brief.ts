import { eventInstants, type EventFactKey, type EventProfile } from './event-profile';
import { formatMoneyMinor } from './production-plan';

/**
 * 只读状态聚合。
 *
 * 为什么要有这一层：原文要求「回答任何状态问题前，先重读…这些文件才是记录，聊天记录不是」。
 * 所以这里只接当前记录（档案/简报/任务/名册/商务档案），不接对话历史、AI 摘要或缓存；
 * 输出带 asOf，让调用方知道这份判断基于哪一版记录。
 *
 * 输出纪律：无开场白、每项一行；缺数据整段省略，不出空表头；
 * 安静只在"无到期 + 无逾期 + 无变化"同时成立时出现，有逾期必出。
 */

export type EventBriefMode = 'countdown' | 'dayOf' | 'recap';

export const EVENT_BRIEF_SECTION_IDS = [
  'noEvent', 'countdown', 'due', 'overdue', 'unconfirmed', 'attendance', 'gaps',
  'schedule', 'vendors', 'transfer', 'pending', 'contingency',
  'metrics', 'spend', 'effective', 'followups', 'backfill',
] as const;
export type EventBriefSectionId = (typeof EVENT_BRIEF_SECTION_IDS)[number];

export type BriefGuestStatus = 'invited' | 'registered' | 'waitlisted' | 'declined' | 'attended' | 'no_show';

export interface BriefFacts {
  event: string;
  guests: number;
  guestsConfirmed: boolean;
}

export interface BriefTask {
  id: string;
  title: string;
  phase: 'preparation' | 'setup' | 'event' | 'teardown';
  plannedStartAt: string | null;
  plannedEndAt: string | null;
  ownerName: string;
  status: 'todo' | 'doing' | 'review' | 'accepted';
}

export interface BriefGuest {
  id: string;
  name: string;
  status: BriefGuestStatus;
  /** 退出是独立旗标，不是状态；保留前序状态。 */
  optedOut: boolean;
  plusOnes: number | null;
  needsTravel: boolean | null;
  dietary: string;
  accessibility: string;
}

export interface BriefRoster {
  guests: readonly BriefGuest[];
}

export interface BriefAgreement {
  id: string;
  direction: 'customer_commission' | 'supplier_engagement';
  versions: readonly { id: string }[];
}

export interface BriefDossier {
  agreements: readonly BriefAgreement[];
}

/** 人工声明的供应商状态；到达时间与电话只在这里，不写回商务档案契约。 */
export interface BriefSupplierState {
  agreementId: string;
  supplierName: string;
  state: string;
  contactName: string;
  contactPhone: string;
  arrivalAt: string | null;
  lastFollowUpAt: string | null;
}

export interface BriefFollowUp {
  guestId?: string;
  text: string;
}

export interface BriefRecapNotes {
  effective?: readonly string[];
  ineffective?: readonly string[];
  followUps?: readonly BriefFollowUp[];
}

export interface EventBriefInput {
  profile: EventProfile | null;
  brief: BriefFacts;
  tasks: readonly BriefTask[];
  roster: BriefRoster | null;
  dossier: BriefDossier | null;
  supplierStates?: readonly BriefSupplierState[];
  contingency?: readonly string[];
  recapNotes?: BriefRecapNotes;
  /** 上一次运行的签名；缺省表示没有可比对的基线。 */
  previousSignature?: string | null;
  /** 记录侧最新的更新时间；缺省时回落到 now。 */
  recordUpdatedAt?: string;
  now: string;
}

export interface EventBriefSection {
  id: EventBriefSectionId;
  items: string[];
}

export interface EventBrief {
  asOf: string;
  mode: EventBriefMode;
  quiet: boolean;
  changed: boolean;
  daysToEvent: number | null;
  signature: string;
  sections: EventBriefSection[];
}

const DAY_MS = 86400000;

function parseInstant(value: string): number | null {
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function localDateOf(iso: string, timeZone: string | null): string {
  const ms = parseInstant(iso);
  if (ms === null) return iso.slice(0, 10);
  if (!timeZone) return iso.slice(0, 10);
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(new Date(ms));
    const pick = (type: string): string => parts.find(part => part.type === type)?.value ?? '';
    const year = pick('year'), month = pick('month'), day = pick('day');
    if (year && month && day) return `${year}-${month}-${day}`;
  } catch {
    /* 时区不可用时回落到 ISO 自带日期，不猜另一个时区。 */
  }
  return iso.slice(0, 10);
}

function daysBetween(from: string, to: string): number | null {
  const [ay, am, ad] = from.split('-').map(Number);
  const [by, bm, bd] = to.split('-').map(Number);
  if (!ay || !am || !ad || !by || !bm || !bd) return null;
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / DAY_MS);
}

function clockOf(iso: string): string {
  const match = /T(\d{2}:\d{2})/.exec(iso);
  return match?.[1] ?? '';
}

function durationMinutes(start: string | null, end: string | null): number | null {
  if (!start || !end) return null;
  const startMs = parseInstant(start), endMs = parseInstant(end);
  if (startMs === null || endMs === null || endMs < startMs) return null;
  return Math.round((endMs - startMs) / 60000);
}

function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} 小时` : `${hours} 小时 ${rest} 分`;
}

const ownerOf = (task: BriefTask): string => task.ownerName.trim() || '未指派';

function activeGuests(roster: BriefRoster | null): BriefGuest[] {
  return roster ? roster.guests.filter(guest => !guest.optedOut) : [];
}

const isAttending = (guest: BriefGuest): boolean =>
  guest.status === 'registered' || guest.status === 'attended';

function line(items: string[]): string[] {
  return items.map(item => item.trim()).filter(Boolean);
}

function latestStamp(candidates: (string | undefined)[]): string | null {
  let best: { iso: string; ms: number } | null = null;
  for (const candidate of candidates) {
    if (!candidate) continue;
    const ms = parseInstant(candidate);
    if (ms === null) continue;
    if (!best || ms > best.ms) best = { iso: candidate, ms };
  }
  return best?.iso ?? null;
}

function countdownSections(input: EventBriefInput, today: string, timeZone: string | null, daysToEvent: number | null): EventBriefSection[] {
  const sections: EventBriefSection[] = [];

  const countdown = daysToEvent === null
    ? ['活动日期未确认，无法计算倒计时']
    : [daysToEvent === 0 ? '活动就是今天' : daysToEvent > 0 ? `距活动 ${daysToEvent} 天` : `活动已结束 ${Math.abs(daysToEvent)} 天`];
  sections.push({ id: 'countdown', items: countdown });

  const open = input.tasks.filter(task => task.status !== 'accepted' && task.plannedEndAt);
  const due = open.filter(task => localDateOf(task.plannedEndAt as string, timeZone) === today);
  sections.push({
    id: 'due',
    items: line(due.map(task => `今天到期：${task.title} · 负责人 ${ownerOf(task)}`)),
  });

  const overdue = open
    .filter(task => {
      const endDate = localDateOf(task.plannedEndAt as string, timeZone);
      return endDate < today;
    })
    .map(task => {
      const endMs = parseInstant(task.plannedEndAt as string) ?? 0;
      const days = Math.max(1, Math.floor((Date.parse(input.now) - endMs) / DAY_MS) + 1);
      return `已逾期 ${days} 天：${task.title} · 负责人 ${ownerOf(task)}`;
    });
  sections.push({ id: 'overdue', items: line(overdue) });

  const unconfirmed: string[] = [];
  for (const agreement of input.dossier?.agreements ?? []) {
    if (agreement.direction === 'supplier_engagement' && agreement.versions.length === 0) {
      unconfirmed.push(`供应约定 ${agreement.id.slice(0, 8)} 尚无固定版本`);
    }
  }
  for (const task of input.tasks) {
    if (task.status === 'review') unconfirmed.push(`待验收：${task.title} · 负责人 ${ownerOf(task)}`);
  }
  sections.push({ id: 'unconfirmed', items: line(unconfirmed) });

  const guests = activeGuests(input.roster);
  if (input.roster) {
    const registered = guests.filter(isAttending).length;
    const expected = input.profile?.expectedAttendance;
    const expectedText = expected && expected.value !== null
      ? `预期到场 ${expected.value} 人${expected.status === 'confirmed' ? '' : '（未确认）'}`
      : '预期到场待确认';
    sections.push({
      id: 'attendance',
      items: line([
        `已报名 ${registered} 人`,
        expectedText,
        `目标 ${input.brief.guests} 人${input.brief.guestsConfirmed ? '' : '（未确认）'}`,
      ]),
    });
  }

  const gaps: string[] = [];
  const attending = guests.filter(isAttending);
  const dietaryMissing = attending.filter(guest => !guest.dietary.trim()).length;
  if (dietaryMissing) gaps.push(`饮食未答复 ${dietaryMissing} 人`);
  const plusUnknown = attending.filter(guest => guest.plusOnes === null).length;
  if (plusUnknown) gaps.push(`携伴未问 ${plusUnknown} 人`);
  sections.push({ id: 'gaps', items: line(gaps) });

  return sections;
}

function scheduleSection(input: EventBriefInput): EventBriefSection | null {
  const rows = input.tasks
    .filter(task => task.phase === 'event' && task.plannedStartAt)
    .sort((left, right) => (parseInstant(left.plannedStartAt as string) ?? 0) - (parseInstant(right.plannedStartAt as string) ?? 0));
  const instants = input.profile ? eventInstants(input.profile) : null;
  const items: string[] = [];
  if (instants?.reason === 'ok' && instants.startsAt && instants.endsAt) {
    items.push(`活动时间 ${clockOf(instants.startsAt)}–${clockOf(instants.endsAt)}（${instants.timeZone}）`);
  }
  for (const task of rows) {
    const start = clockOf(task.plannedStartAt as string) || '待定';
    const end = task.plannedEndAt ? clockOf(task.plannedEndAt) || '待定' : '待定';
    const minutes = durationMinutes(task.plannedStartAt, task.plannedEndAt);
    const marks: string[] = [];
    if (!task.plannedEndAt) marks.push('缺结束时间');
    if (!task.ownerName.trim()) marks.push('缺具名负责人');
    items.push(line([
      `${start}–${end}`,
      minutes === null ? '时长待定' : formatDuration(minutes),
      task.title,
      ownerOf(task),
      marks.length ? `（${marks.join('、')}）` : '',
    ]).join(' · '));
  }
  return items.length ? { id: 'schedule', items } : null;
}

function dayOfSections(input: EventBriefInput): EventBriefSection[] {
  const sections: EventBriefSection[] = [];
  const schedule = scheduleSection(input);
  if (schedule) sections.push(schedule);

  const vendors = line((input.supplierStates ?? []).map(state => {
    const arrival = state.arrivalAt ? `${clockOf(state.arrivalAt) || '待定'} 到达` : '到达时间待确认';
    const contact = [state.contactName.trim() || '联系人待确认', state.contactPhone.trim() || '电话待确认'].join(' ');
    return `${state.supplierName} · ${arrival} · ${contact} · ${state.state}`;
  }));
  if (vendors.length) sections.push({ id: 'vendors', items: vendors });

  const guests = activeGuests(input.roster);
  if (input.roster) {
    const registered = guests.filter(isAttending).length;
    const attended = guests.filter(guest => guest.status === 'attended');
    const plus = attended.reduce((sum, guest) => sum + (guest.plusOnes ?? 0), 0);
    const expected = input.profile?.expectedAttendance;
    const dietary = guests.filter(guest => isAttending(guest) && guest.dietary.trim()).length;
    const access = guests.filter(guest => isAttending(guest) && guest.accessibility.trim()).length;
    sections.push({
      id: 'attendance',
      items: line([
        `已报名 ${registered} 人`,
        `已出席 ${attended.length + plus} 人${plus ? `（含未具名携伴 ${plus} 人）` : ''}`,
        expected && expected.value !== null ? `预期到场 ${expected.value} 人` : '预期到场待确认',
        `饮食需求 ${dietary} 人 · 无障碍需求 ${access} 人`,
      ]),
    });
  }

  const travellers = guests.filter(isAttending).filter(guest => guest.needsTravel === true).map(guest => guest.name);
  if (travellers.length) sections.push({ id: 'transfer', items: [`需接送 ${travellers.length} 人：${travellers.join('、')}`] });

  const pending: string[] = [];
  for (const task of input.tasks) {
    if (task.phase !== 'event') continue;
    if (!task.plannedStartAt) pending.push(`流程行缺时间：${task.title}`);
    else if (!task.plannedEndAt) pending.push(`流程行缺结束时间：${task.title}`);
    if (!task.ownerName.trim()) pending.push(`流程行缺具名负责人：${task.title}`);
  }
  const profile = input.profile;
  if (profile) {
    const labels: [EventFactKey, string][] = [
      ['date', '日期'], ['timeWindow', '时间窗'], ['venue', '场地'], ['budget', '预算'],
      ['expectedAttendance', '预期到场'], ['goal', '目标结果'], ['division', '分工'],
    ];
    for (const [key, label] of labels) {
      const fact = profile[key];
      if (fact.status === 'pending' || fact.status === 'inferred') pending.push(`待确认：${label}`);
    }
  }
  const attending = guests.filter(isAttending);
  const gaps: string[] = [];
  const dietaryMissing = attending.filter(guest => !guest.dietary.trim()).length;
  if (dietaryMissing) gaps.push(`饮食未答复 ${dietaryMissing} 人`);
  const plusUnknown = attending.filter(guest => guest.plusOnes === null).length;
  if (plusUnknown) gaps.push(`携伴未问 ${plusUnknown} 人`);
  const travelUnknown = attending.filter(guest => guest.needsTravel === null).length;
  if (travelUnknown) gaps.push(`出行未定 ${travelUnknown} 人`);
  pending.push(...gaps);
  if (pending.length) sections.push({ id: 'pending', items: line(pending) });

  const contingency = line([...(input.contingency ?? [])]);
  if (contingency.length) sections.push({ id: 'contingency', items: contingency });

  return sections;
}

function recapSections(input: EventBriefInput): EventBriefSection[] {
  const sections: EventBriefSection[] = [];
  const guests = activeGuests(input.roster);
  const registered = guests.filter(isAttending).length;
  const attended = guests.filter(guest => guest.status === 'attended').length;
  const plus = guests.filter(guest => guest.status === 'attended').reduce((sum, guest) => sum + (guest.plusOnes ?? 0), 0);
  const expected = input.profile?.expectedAttendance;
  const metrics = line([
    `目标 ${input.brief.guests} 人${input.brief.guestsConfirmed ? '' : '（未确认）'}`,
    input.roster ? `实际出席 ${attended + plus} 人（清点）` : '实际出席待回填',
    input.roster && registered ? `到场率 ${Math.round((attended / registered) * 100)}%（出席 ÷ 报名，不含携伴）` : '',
    expected && expected.value !== null ? `预期到场 ${expected.value} 人${expected.status === 'confirmed' ? '' : '（未确认）'}` : '',
  ]);
  if (metrics.length) sections.push({ id: 'metrics', items: metrics });

  const budget = input.profile?.budget;
  const spend: string[] = [];
  const money = (value: { amountMinor: number | null } | null | undefined, label: string): void => {
    if (!value || value.amountMinor === null) return;
    spend.push(`${label} ¥${formatMoneyMinor(value.amountMinor)}`);
  };
  if (budget?.value) {
    money(budget.value.estimate, '预算估算');
    money(budget.value.actual, '实际花费');
    if (budget.value.actual?.amountMinor === null || budget.value.actual === null) spend.push('实际花费待回填');
  } else {
    spend.push('预算未登记');
  }
  if (spend.length) sections.push({ id: 'spend', items: line(spend) });

  const notes = input.recapNotes;
  const effective = line([
    ...(notes?.effective ?? []).map(text => `有效：${text}`),
    ...(notes?.ineffective ?? []).map(text => `无效：${text}`),
  ]);
  if (effective.length) sections.push({ id: 'effective', items: effective });

  const optedOut = new Set((input.roster?.guests ?? []).filter(guest => guest.optedOut).map(guest => guest.id));
  const followups = line((notes?.followUps ?? [])
    .filter(item => !item.guestId || !optedOut.has(item.guestId))
    .map(item => `跟进：${item.text}`));
  if (followups.length) sections.push({ id: 'followups', items: followups });

  sections.push({
    id: 'backfill',
    items: ['待回填：实际出席人数', '待回填：表外花费', '待回填：现场感受'],
  });
  return sections;
}

export function eventBrief(input: EventBriefInput, mode: EventBriefMode): EventBrief {
  if (!Number.isFinite(Date.parse(input.now))) throw new Error('请提供有效的当前时间。');
  const timeZone = input.profile?.timeWindow.value?.timeZone ?? null;
  const today = localDateOf(input.now, timeZone);
  const daysToEvent = input.profile?.date.value ? daysBetween(today, input.profile.date.value) : null;
  const asOf = latestStamp([input.profile?.updatedAt, input.recordUpdatedAt]) ?? input.now;

  const active = input.profile !== null || input.tasks.length > 0 || input.roster !== null;
  if (!active) {
    return {
      asOf, mode, quiet: false, changed: true, daysToEvent: null,
      signature: 'no-event',
      sections: [{ id: 'noEvent', items: ['当前没有进行中的活动'] }],
    };
  }

  const sections = mode === 'countdown'
    ? countdownSections(input, today, timeZone, daysToEvent)
    : mode === 'dayOf'
      ? dayOfSections(input)
      : recapSections(input);

  // 倒计时每天都在变，不能算作"变化"，否则永远安静不下来。
  const signature = JSON.stringify({
    mode,
    sections: sections.filter(section => section.id !== 'countdown').map(section => [section.id, section.items]),
  });
  const changed = input.previousSignature === null || input.previousSignature === undefined
    ? true
    : input.previousSignature !== signature;
  const hasDue = sections.some(section => section.id === 'due' && section.items.length > 0);
  const hasOverdue = sections.some(section => section.id === 'overdue' && section.items.length > 0);
  const quiet = mode === 'countdown' ? !hasDue && !hasOverdue && !changed : false;

  return { asOf, mode, quiet, changed, daysToEvent, signature, sections };
}
