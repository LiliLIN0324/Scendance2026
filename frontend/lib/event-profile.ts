import { z } from 'zod';
import { handoffLimits } from '../../supabase/functions/_shared/delivery-contract';
import { productionPlanLimits } from '../../supabase/functions/_shared/production-plan-contract';

/**
 * Activity-level metadata sidecar for the local layout.
 *
 * 为什么放在这里：它只收简报（CreativeBrief）没有的东西——日期、时间窗、行政地点、
 * 预算、预期到场、目标结果、分工。活动名/类型/人数仍以 layout.name、brief.event、
 * brief.guests 为唯一真值，本档案不存第二份。
 *
 * 与 venue-facts 同一条口径：未知就是 unknown，模型推断不能标 confirmed，
 * 每次写入留痕，读取层不得用默认值把"没填"渲染成"填了"。
 */

export const eventFactStatuses = ['confirmed', 'pending', 'inferred', 'unknown'] as const;
export const eventFactSources = [
  'user_statement', 'imported_file', 'preset', 'model_inference', 'unavailable',
] as const;
export type EventFactStatus = (typeof eventFactStatuses)[number];
export type EventFactSource = (typeof eventFactSources)[number];

const personLimit = handoffLimits.ownerName;
const noteLimit = productionPlanLimits.note;
const titleLimit = productionPlanLimits.title;
const recordLimit = 50;
const attendanceLimit = 100000;

const clock = z.string().max(5).regex(/^([01]\d|2[0-3]):[0-5]\d$/, '请使用 HH:mm 24 小时制');
const isoDate = z.iso.date().refine(value => !value.startsWith('0000-'), '日期年份须大于零');

/** IANA zone must exist; we never fall back to the system zone. */
export function isValidTimeZone(value: string): boolean {
  const text = value.trim();
  if (!text || text.length > 64) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: text });
    return true;
  } catch {
    return false;
  }
}

const timeWindowValue = z.strictObject({
  startTime: clock,
  endTime: clock,
  timeZone: z.string().max(64).refine(isValidTimeZone, '请使用有效的 IANA 时区，例如 Asia/Shanghai'),
  endsNextDay: z.boolean().default(false),
}).superRefine((value, ctx) => {
  // 不默认跨天：结束不晚于开始时必须由用户明确声明。
  if (value.endTime <= value.startTime && !value.endsNextDay) {
    ctx.addIssue({ code: 'custom', path: ['endsNextDay'], message: '结束时间不晚于开始时间时须明确跨天' });
  }
});

const venueValue = z.strictObject({
  city: z.string().max(60),
  venueName: z.string().max(120),
});

const moneyValue = z.strictObject({
  amountMinor: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).nullable(),
  currency: z.literal('CNY').nullable().default(null),
  basisNote: z.string().max(noteLimit).default(''),
}).superRefine((value, ctx) => {
  if (value.amountMinor === null) return;
  if (value.currency !== 'CNY') {
    ctx.addIssue({ code: 'custom', path: ['currency'], message: '已知金额须明确币种为 CNY，未知币种只保留原文' });
  }
  if (!value.basisNote.trim()) {
    ctx.addIssue({ code: 'custom', path: ['basisNote'], message: '已知金额须有依据说明' });
  }
});

const budgetValue = z.strictObject({
  estimate: moneyValue.nullable(),
  actual: moneyValue.nullable(),
});

const attendanceValue = z.number().int().min(0).max(attendanceLimit);

const goalValue = z.string().max(500);

const divisionValue = z.array(z.strictObject({
  roleName: z.string().min(1).max(titleLimit).refine(value => value.trim().length > 0, '角色名不能为空白'),
  ownerName: z.string().max(personLimit).default(''),
})).max(recordLimit);

/** 事实的最小形状；供共享校验使用，不参与类型导出。 */
interface FactShape {
  value: unknown;
  status: EventFactStatus;
  source: EventFactSource;
  note: string;
  revision: number;
  updatedBy: string;
  updatedAt: string;
}

type IssueSink = (message: string, path?: (string | number)[]) => void;
type IssueContext = { addIssue(issue: { code: 'custom'; path: (string | number)[]; message: string }): void };

function refineFact(fact: FactShape, add: IssueSink): void {
  if (fact.revision === 0) {
    if (fact.status !== 'unknown') add('未写入的事实只能是未知状态', ['status']);
    if (fact.value !== null) add('未知事实不能携带值', ['value']);
    if (fact.source !== 'unavailable') add('未知事实的来源只能是 unavailable', ['source']);
    if (fact.updatedBy || fact.updatedAt) add('未写入的事实不应带更新人', ['updatedBy']);
    return;
  }
  if (!fact.updatedBy.trim()) add('请记录修改人', ['updatedBy']);
  if (!Number.isFinite(Date.parse(fact.updatedAt))) add('请记录有效的修改时间', ['updatedAt']);
  if (fact.status === 'unknown') {
    if (fact.value !== null) add('未知事实不能携带值', ['value']);
    if (fact.source !== 'unavailable') add('未知事实的来源只能是 unavailable', ['source']);
    return;
  }
  if (fact.value === null) add('已记录的事实必须有值', ['value']);
  if (fact.source === 'unavailable') add('已记录的事实必须有来源', ['source']);
  if (fact.status === 'confirmed' && (fact.source === 'model_inference' || fact.source === 'preset')) {
    add('预填或模型推断不能直接标为已确认', ['source']);
  }
  if (fact.status === 'inferred' && fact.source !== 'model_inference') {
    add('推断状态的来源须为模型推断', ['source']);
  }
  if (fact.status === 'inferred' && !fact.note.trim()) add('推断的事实须写明依据', ['note']);
}

const factBase = {
  status: z.enum(eventFactStatuses),
  source: z.enum(eventFactSources),
  note: z.string().max(noteLimit).default(''),
  revision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0),
  updatedBy: z.string().max(personLimit).default(''),
  updatedAt: z.string().max(40).default(''),
};

const refine = (fact: FactShape, ctx: IssueContext): void =>
  refineFact(fact, (message, path = []) => ctx.addIssue({ code: 'custom', path: [...path], message }));

const dateFact = z.strictObject({ value: isoDate.nullable(), ...factBase }).superRefine(refine);
const timeWindowFact = z.strictObject({ value: timeWindowValue.nullable(), ...factBase }).superRefine(refine);
const venueFact = z.strictObject({ value: venueValue.nullable(), ...factBase }).superRefine(refine);
const budgetFact = z.strictObject({ value: budgetValue.nullable(), ...factBase }).superRefine(refine);
const attendanceFact = z.strictObject({ value: attendanceValue.nullable(), ...factBase }).superRefine(refine);
const goalFact = z.strictObject({ value: goalValue.nullable(), ...factBase }).superRefine(refine);
const divisionFact = z.strictObject({ value: divisionValue.nullable(), ...factBase }).superRefine(refine);

export const EVENT_FACT_KEYS = [
  'date', 'timeWindow', 'venue', 'budget', 'expectedAttendance', 'goal', 'division',
] as const;
export type EventFactKey = (typeof EVENT_FACT_KEYS)[number];

export const eventProfileSchema = z.strictObject({
  schemaVersion: z.literal(1).default(1),
  revision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0),
  updatedBy: z.string().max(personLimit).default(''),
  updatedAt: z.string().max(40).default(''),
  date: dateFact,
  timeWindow: timeWindowFact,
  venue: venueFact,
  budget: budgetFact,
  expectedAttendance: attendanceFact,
  goal: goalFact,
  division: divisionFact,
}).superRefine((profile, ctx) => {
  const add: IssueSink = (message, path = []) => ctx.addIssue({ code: 'custom', path: [...path], message });
  const facts = EVENT_FACT_KEYS.map(key => profile[key] as FactShape);
  if (profile.revision === 0) {
    if (facts.some(fact => fact.status !== 'unknown' || fact.revision !== 0)) {
      add('空档案不能携带已记录的事实', []);
    }
    if (profile.updatedBy || profile.updatedAt) add('空档案不应带更新人', ['updatedBy']);
    return;
  }
  if (!profile.updatedBy.trim()) add('请记录修改人', ['updatedBy']);
  if (!Number.isFinite(Date.parse(profile.updatedAt))) add('请记录有效的修改时间', ['updatedAt']);
  EVENT_FACT_KEYS.forEach(key => {
    if ((profile[key] as FactShape).revision > profile.revision) {
      add('事实版本不能超过档案版本', [key, 'revision']);
    }
  });
});

export type EventProfile = z.infer<typeof eventProfileSchema>;
export type EventFactValue<K extends EventFactKey> = NonNullable<EventProfile[K]['value']>;

export interface EventFactPatch<K extends EventFactKey> {
  value: EventFactValue<K> | null;
  status: EventFactStatus;
  source: EventFactSource;
  note?: string;
}
export type EventProfilePatch = { [K in EventFactKey]?: EventFactPatch<K> };

export function parseEventProfile(input: unknown): EventProfile {
  return eventProfileSchema.parse(input);
}

export function isEventProfile(input: unknown): input is EventProfile {
  return eventProfileSchema.safeParse(input).success;
}

function emptyFact(): FactShape {
  return { value: null, status: 'unknown', source: 'unavailable', note: '', revision: 0, updatedBy: '', updatedAt: '' };
}

/** 显式空档案：全部未知，revision 0；与"没有这个字段"是两回事。 */
export function emptyEventProfile(): EventProfile {
  return eventProfileSchema.parse({
    schemaVersion: 1, revision: 0, updatedBy: '', updatedAt: '',
    date: emptyFact(), timeWindow: emptyFact(), venue: emptyFact(), budget: emptyFact(),
    expectedAttendance: emptyFact(), goal: emptyFact(), division: emptyFact(),
  });
}

/**
 * 写入若干事实。集合版本严格 +1 作为 CAS；每条事实各自记录本次版本与更新人
 * （对应"一条一事"，为将来多端合并留路）。改回旧值同样升版本。
 */
export function updateEventProfile(
  profile: EventProfile,
  patch: EventProfilePatch,
  expectedRevision: number,
  meta: { updatedBy: string; updatedAt: string },
): EventProfile {
  const current = eventProfileSchema.parse(profile);
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision !== current.revision
    || current.revision >= Number.MAX_SAFE_INTEGER) {
    throw new Error('活动档案版本已变化，请重新核对。');
  }
  const keys = Object.keys(patch) as EventFactKey[];
  if (!keys.length) throw new Error('没有要写入的活动档案字段。');
  const updatedBy = meta.updatedBy.trim();
  if (!updatedBy) throw new Error('请记录修改人。');
  if (!Number.isFinite(Date.parse(meta.updatedAt))) throw new Error('请记录有效的修改时间。');
  const revision = current.revision + 1;
  const candidate: Record<string, unknown> = { ...current, revision, updatedBy, updatedAt: meta.updatedAt };
  for (const key of keys) {
    const change = patch[key];
    if (!change) continue;
    candidate[key] = {
      value: change.value === null ? null : structuredClone(change.value),
      status: change.status,
      source: change.source,
      note: (change.note ?? '').trim(),
      revision,
      updatedBy,
      updatedAt: meta.updatedAt,
    };
  }
  return eventProfileSchema.parse(candidate);
}

export type EventInstantReason = 'ok' | 'incomplete' | 'invalid-zone' | 'nonexistent' | 'ambiguous';

export interface EventInstants {
  startsAt: string | null;
  endsAt: string | null;
  timeZone: string | null;
  confirmed: boolean;
  reason: EventInstantReason;
}

const zoneFormatters = new Map<string, Intl.DateTimeFormat>();
function zoneFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = zoneFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    zoneFormatters.set(timeZone, formatter);
  }
  return formatter;
}

interface WallParts { year: number; month: number; day: number; hour: number; minute: number }

function zoneWall(ms: number, timeZone: string): WallParts & { second: number } {
  const parts = zoneFormatter(timeZone).formatToParts(new Date(ms));
  const pick = (type: string): number => Number(parts.find(part => part.type === type)?.value ?? '0');
  return {
    year: pick('year'), month: pick('month'), day: pick('day'),
    hour: pick('hour'), minute: pick('minute'), second: pick('second'),
  };
}

function offsetMsAt(ms: number, timeZone: string): number {
  const wall = zoneWall(ms, timeZone);
  return Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second) - ms;
}

function sameWall(ms: number, target: WallParts, timeZone: string): boolean {
  const wall = zoneWall(ms, timeZone);
  return wall.year === target.year && wall.month === target.month && wall.day === target.day
    && wall.hour === target.hour && wall.minute === target.minute;
}

const pad = (value: number, size = 2): string => String(value).padStart(size, '0');

function isoWithOffset(ms: number, offsetMinutes: number): string {
  const local = new Date(ms + offsetMinutes * 60000);
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const abs = Math.abs(offsetMinutes);
  return `${pad(local.getUTCFullYear(), 4)}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}`
    + `T${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}:00`
    + `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

function nextCalendarDay(date: string): string {
  const [year, month, day] = date.split('-').map(Number);
  const shifted = new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, (day ?? 1) + 1));
  return `${pad(shifted.getUTCFullYear(), 4)}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;
}

type WallResult = { ms: number; offsetMinutes: number } | 'nonexistent' | 'ambiguous';

/** 墙上时间 → 瞬间；夏令时不存在或有歧义时返回原因，绝不替用户选一个偏移。 */
function wallToInstant(date: string, time: string, timeZone: string): WallResult {
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  const target: WallParts = { year: year ?? 0, month: month ?? 1, day: day ?? 1, hour: hour ?? 0, minute: minute ?? 0 };
  const wallMs = Date.UTC(target.year, target.month - 1, target.day, target.hour, target.minute, 0, 0);
  // 采样前后各一天，覆盖常见 DST 位移（含 30 分钟与 2 小时偏移）。
  const offsets = new Set([
    offsetMsAt(wallMs - 86400000, timeZone),
    offsetMsAt(wallMs, timeZone),
    offsetMsAt(wallMs + 86400000, timeZone),
  ]);
  const candidates = new Set<number>();
  for (const offset of offsets) {
    const candidate = wallMs - offset;
    if (sameWall(candidate, target, timeZone)) candidates.add(candidate);
  }
  if (candidates.size === 0) return 'nonexistent';
  if (candidates.size > 1) return 'ambiguous';
  const ms = [...candidates][0] as number;
  return { ms, offsetMinutes: Math.round(offsetMsAt(ms, timeZone) / 60000) };
}

/**
 * 日期 + 时间窗 → 带偏移的起止瞬间。存的是墙上时间，瞬间只在读取时算，
 * 避免时区修正后旧数据带着错误偏移。
 */
export function eventInstants(profile: EventProfile): EventInstants {
  const timeZone = profile.timeWindow.value?.timeZone ?? null;
  const reasonBase: EventInstants = { startsAt: null, endsAt: null, timeZone, confirmed: false, reason: 'incomplete' };
  if (!profile.date.value || !profile.timeWindow.value) return reasonBase;
  if (!timeZone || !isValidTimeZone(timeZone)) return { ...reasonBase, reason: 'invalid-zone' };
  const window = profile.timeWindow.value;
  const start = wallToInstant(profile.date.value, window.startTime, timeZone);
  if (typeof start === 'string') return { ...reasonBase, reason: start };
  const endDate = window.endsNextDay ? nextCalendarDay(profile.date.value) : profile.date.value;
  const end = wallToInstant(endDate, window.endTime, timeZone);
  if (typeof end === 'string') return { ...reasonBase, reason: end };
  return {
    startsAt: isoWithOffset(start.ms, start.offsetMinutes),
    endsAt: isoWithOffset(end.ms, end.offsetMinutes),
    timeZone,
    confirmed: profile.date.status === 'confirmed' && profile.timeWindow.status === 'confirmed',
    reason: 'ok',
  };
}

export interface PublishableBrief {
  eventName: string;
  guests: number;
  guestsConfirmed: boolean;
}

/** 客户版白名单：默认不导出，逐字段放行；逐字段 pick，禁止整对象 spread 后 delete。 */
export const PUBLISHED_EVENT_VIEW_KEYS = [
  'eventName', 'date', 'startTime', 'endTime', 'timeZone',
  'city', 'venueName', 'guests', 'guestsPending', 'goal',
] as const;

export interface PublishedEventView {
  eventName: string;
  date: string | null;
  startTime: string | null;
  endTime: string | null;
  timeZone: string | null;
  city: string | null;
  venueName: string | null;
  guests: number | null;
  guestsPending: boolean;
  goal: string | null;
}

const confirmedValue = <K extends EventFactKey>(profile: EventProfile, key: K): EventFactValue<K> | null =>
  profile[key].status === 'confirmed' ? (profile[key].value as EventFactValue<K> | null) : null;

export function publishEventView(
  profile: EventProfile,
  brief: PublishableBrief,
): PublishedEventView {
  const parsed = eventProfileSchema.parse(profile);
  const window = confirmedValue(parsed, 'timeWindow');
  const venue = confirmedValue(parsed, 'venue');
  return {
    eventName: brief.eventName,
    date: confirmedValue(parsed, 'date'),
    startTime: window?.startTime ?? null,
    endTime: window?.endTime ?? null,
    timeZone: window?.timeZone ?? null,
    city: venue?.city ?? null,
    venueName: venue?.venueName ?? null,
    guests: brief.guestsConfirmed ? brief.guests : null,
    guestsPending: !brief.guestsConfirmed,
    goal: confirmedValue(parsed, 'goal'),
  };
}
