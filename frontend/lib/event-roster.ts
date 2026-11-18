import { z } from 'zod';

/**
 * 嘉宾名册（P2-1）：六态 + 独立退出旗标。
 * 退出不改前序状态；`plusOnes: null` = 未问，`0` = 明确无；任何计数都排除退出者。
 */
export const rosterStatuses = ['invited', 'registered', 'waitlisted', 'declined', 'attended', 'noShow'] as const;
export const rosterStatusLabels: Record<(typeof rosterStatuses)[number], string> = {
  invited: '已邀请', registered: '已报名', waitlisted: '候补',
  declined: '已拒绝', attended: '已出席', noShow: '未到场',
};

const nameSchema = z.string().trim().min(1).max(80);
export const rosterGuestSchema = z.strictObject({
  id: z.uuid(),
  name: nameSchema,
  role: z.string().trim().max(80).default(''),
  status: z.enum(rosterStatuses).default('invited'),
  statusChangedAt: z.iso.datetime({ offset: true }).max(32).nullable().default(null),
  optedOut: z.boolean().default(false),
  optedOutDeclaredBy: z.string().trim().max(80).default(''),
  optedOutAt: z.iso.datetime({ offset: true }).max(32).nullable().default(null),
  plusOnes: z.number().int().min(0).max(20).nullable().default(null),
  needsTravel: z.boolean().nullable().default(null),
  dietary: z.string().trim().max(200).default(''),
  accessibility: z.string().trim().max(200).default(''),
  note: z.string().trim().max(500).default(''),
}).superRefine((guest, ctx) => {
  if (guest.optedOut && (!guest.optedOutDeclaredBy || guest.optedOutAt === null)) {
    ctx.addIssue({ code: 'custom', path: ['optedOut'], message: '退出须记录声明人与时间' });
  }
});

export const rosterSchema = z.strictObject({
  schemaVersion: z.literal(1).default(1),
  dataKind: z.enum(['unspecified', 'rehearsal', 'real']).default('unspecified'),
  guests: z.array(rosterGuestSchema).max(2000)
    .refine(guests => new Set(guests.map(guest => guest.name)).size === guests.length, '同名嘉宾不能重复').default([]),
});
export type Roster = z.infer<typeof rosterSchema>;
export type RosterGuest = z.infer<typeof rosterGuestSchema>;

export interface RosterSummary {
  total: number;
  byStatus: Record<(typeof rosterStatuses)[number], number>;
  /** 到场登记人数（不含携伴）。 */
  attended: number;
  /** 到场 + 已确认携伴；携伴未问的单列，不并入。 */
  attendedWithPlusOnes: number;
  plusOnesUnknown: number;
  optedOut: number;
  followUpGuestIds: string[];
  travelGuestIds: string[];
  dietaryGuestIds: string[];
  accessibilityGuestIds: string[];
}

export function rosterSummary(roster: Roster): RosterSummary {
  const parsed = rosterSchema.parse(roster);
  const active = parsed.guests.filter(guest => !guest.optedOut);
  const byStatus = Object.fromEntries(rosterStatuses.map(status => [status, 0])) as RosterSummary['byStatus'];
  for (const guest of active) byStatus[guest.status] += 1;
  const attendedGuests = active.filter(guest => guest.status === 'attended');
  return {
    total: active.length, byStatus,
    attended: attendedGuests.length,
    attendedWithPlusOnes: attendedGuests.reduce((sum, guest) => sum + 1 + (guest.plusOnes ?? 0), 0),
    plusOnesUnknown: active.filter(guest => guest.status === 'attended' && guest.plusOnes === null).length,
    optedOut: parsed.guests.length - active.length,
    followUpGuestIds: active.filter(guest => guest.plusOnes === null || guest.needsTravel === null).map(guest => guest.id),
    travelGuestIds: active.filter(guest => guest.needsTravel === true).map(guest => guest.id),
    dietaryGuestIds: active.filter(guest => guest.dietary.trim().length > 0).map(guest => guest.id),
    accessibilityGuestIds: active.filter(guest => guest.accessibility.trim().length > 0).map(guest => guest.id),
  };
}

/** 退出是永久旗标：只增不减，保留前序状态供回看。 */
export function markGuestOptedOut(roster: Roster, guestId: string, declared: { by: string; at: string }): Roster {
  const parsed = rosterSchema.parse(roster);
  const by = declared.by.trim();
  if (!by) throw new Error('请记录退出声明人。');
  if (!Number.isFinite(Date.parse(declared.at))) throw new Error('请记录有效的退出时间。');
  if (!parsed.guests.some(guest => guest.id === guestId)) throw new Error('名册中没有这位嘉宾。');
  return rosterSchema.parse({ ...parsed, guests: parsed.guests.map(guest => guest.id === guestId
    ? { ...guest, optedOut: true, optedOutDeclaredBy: by, optedOutAt: declared.at } : guest) });
}
