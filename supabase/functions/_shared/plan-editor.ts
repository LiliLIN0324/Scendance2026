import { z } from 'zod';

/**
 * 个人读数精度、本方案编辑量、团队默认共用的取值。
 * 内部尺寸仍是米。缺字段表示「没有这一层的覆盖」，读取方再回退。
 */
export const CURRENCIES = ['CNY', 'USD', 'EUR', 'GBP', 'JPY'] as const;
export type CurrencyCode = (typeof CURRENCIES)[number];

export const LENGTH_PRECISIONS_M = [0.01, 0.1, 1] as const;
export type LengthPrecisionM = (typeof LENGTH_PRECISIONS_M)[number];

export const DEFAULT_PLAN_TIME_ZONE = 'Asia/Shanghai';
export const DEFAULT_GRID_SIZE_M = 0.5;
export const DEFAULT_LENGTH_SNAP_M = 0.5;
export const DEFAULT_ANGLE_SNAP_DEG = 15;
export const DEFAULT_NUDGE_STEP_M = 0.1;
export const NUDGE_SHIFT_FACTOR = 10;
export const DEFAULT_AISLE_CLEAR_M = 2.4;
export const DEFAULT_BOOTH_SPACING_M = 0.6;

const CURRENCY_SYMBOLS: Record<CurrencyCode, string> = {
  CNY: '¥',
  USD: '$',
  EUR: '€',
  GBP: '£',
  JPY: '¥',
};

export function currencySymbol(currency: CurrencyCode): string {
  return CURRENCY_SYMBOLS[currency];
}

export function formatMoney(amount: number, currency: CurrencyCode = 'CNY'): string {
  if (!Number.isFinite(amount)) return '—';
  const digits = currency === 'JPY' ? 0 : 2;
  return `${CURRENCY_SYMBOLS[currency]}${amount.toFixed(digits)}`;
}

export function parseLengthPrecisionM(value: unknown): LengthPrecisionM | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  for (const step of LENGTH_PRECISIONS_M) {
    if (Math.abs(value - step) < 1e-9) return step;
  }
  return undefined;
}

function inRange(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/** 报价抬头里的 logo：本机 data URL 或 https 地址，限制长度，不接任意 HTML。 */
export function isLogoUrl(value: string): boolean {
  if (value.length === 0 || value.length > 80_000) return false;
  if (/^data:image\/(png|jpeg|webp);base64,[a-z0-9+/=\s]+$/i.test(value)) return true;
  return /^https:\/\/[^\s]{1,480}$/.test(value);
}

export const planEditorQuoteSchema = z.strictObject({
  companyName: z.string().min(1).max(120).optional(),
  contact: z.string().min(1).max(120).optional(),
  currency: z.enum(CURRENCIES).optional(),
  logoUrl: z.string().min(1).max(80_000).refine(isLogoUrl, 'logo').optional(),
});
export type PlanEditorQuote = z.infer<typeof planEditorQuoteSchema>;

export const planEditorSchema = z.strictObject({
  displayUnit: z.enum(['m', 'ft']).optional(),
  gridSizeM: z.number().finite().min(0.05).max(5).optional(),
  lengthSnapM: z.number().finite().min(0.01).max(5).optional(),
  angleSnapDeg: z.number().finite().min(1).max(90).optional(),
  nudgeStepM: z.number().finite().min(0.001).max(1).optional(),
  timeZone: z.string().trim().min(1).max(64).optional(),
  aisleClearM: z.number().finite().min(0.6).max(12).optional(),
  boothSpacingM: z.number().finite().min(0).max(5).optional(),
  quote: planEditorQuoteSchema.optional(),
  /** 设置页改过报价抬头之后，公司名 / 货币 / logo 以这里为准，空着就是跟随团队。 */
  quoteTouched: z.literal(true).optional(),
});
export type PlanEditorSettings = z.infer<typeof planEditorSchema>;

function quoteFrom(value: unknown): PlanEditorQuote | undefined {
  if (!isRecord(value)) return undefined;
  const next: PlanEditorQuote = {};
  if (typeof value.companyName === 'string' && value.companyName.trim()) next.companyName = value.companyName.trim().slice(0, 120);
  if (typeof value.contact === 'string' && value.contact.trim()) next.contact = value.contact.trim().slice(0, 120);
  if (typeof value.currency === 'string' && (CURRENCIES as readonly string[]).includes(value.currency)) {
    next.currency = value.currency as CurrencyCode;
  }
  if (typeof value.logoUrl === 'string' && isLogoUrl(value.logoUrl)) next.logoUrl = value.logoUrl;
  return Object.keys(next).length ? next : undefined;
}

/** 坏字段丢掉，剩下的留下。整份房子不会因为一个越界网格间距打不开。 */
export function sanitizePlanEditor(value: unknown): PlanEditorSettings | undefined {
  if (!isRecord(value)) return undefined;
  const next: PlanEditorSettings = {};
  if (value.displayUnit === 'm' || value.displayUnit === 'ft') next.displayUnit = value.displayUnit;
  if (inRange(value.gridSizeM, 0.05, 5)) next.gridSizeM = value.gridSizeM;
  if (inRange(value.lengthSnapM, 0.01, 5)) next.lengthSnapM = value.lengthSnapM;
  if (inRange(value.angleSnapDeg, 1, 90)) next.angleSnapDeg = value.angleSnapDeg;
  if (inRange(value.nudgeStepM, 0.001, 1)) next.nudgeStepM = value.nudgeStepM;
  if (typeof value.timeZone === 'string' && value.timeZone.trim().length > 0 && value.timeZone.trim().length <= 64) {
    next.timeZone = value.timeZone.trim();
  }
  if (inRange(value.aisleClearM, 0.6, 12)) next.aisleClearM = value.aisleClearM;
  if (inRange(value.boothSpacingM, 0, 5)) next.boothSpacingM = value.boothSpacingM;
  if (value.quoteTouched === true) next.quoteTouched = true;
  const quote = quoteFrom(value.quote);
  if (quote) next.quote = quote;
  return Object.keys(next).length ? next : undefined;
}

export const preferencePatchSchema = z.strictObject({
  unit: z.enum(['m', 'ft']).optional(),
  showMeasurements: z.boolean().optional(),
  lengthPrecisionM: z.union([z.literal(0.01), z.literal(0.1), z.literal(1)]).optional(),
  snapToGrid: z.boolean().optional(),
  snapToWall: z.boolean().optional(),
  snapToItems: z.boolean().optional(),
});
export type PreferencePatch = z.infer<typeof preferencePatchSchema>;

const nullableText = z.string().max(120).nullable().optional();
export const studioSettingsPatchSchema = z.strictObject({
  companyName: nullableText,
  quoteContact: nullableText,
  logoUrl: z.string().max(80_000).refine(value => value === '' || isLogoUrl(value), 'logo').nullable().optional(),
  currency: z.enum(CURRENCIES).nullable().optional(),
  defaultUnit: z.enum(['m', 'ft']).nullable().optional(),
  defaultAisleClearM: z.number().finite().min(0.6).max(12).nullable().optional(),
  defaultBoothSpacingM: z.number().finite().min(0).max(5).nullable().optional(),
});
export type StudioSettingsPatch = z.infer<typeof studioSettingsPatchSchema>;

export const studioSettingsSchema = z.strictObject({
  companyName: z.string().min(1).max(120).optional(),
  quoteContact: z.string().min(1).max(120).optional(),
  logoUrl: z.string().min(1).max(80_000).refine(isLogoUrl, 'logo').optional(),
  currency: z.enum(CURRENCIES).optional(),
  defaultUnit: z.enum(['m', 'ft']).optional(),
  defaultAisleClearM: z.number().finite().min(0.6).max(12).optional(),
  defaultBoothSpacingM: z.number().finite().min(0).max(5).optional(),
});
export type StudioSettings = z.infer<typeof studioSettingsSchema>;

export function sanitizeStudioSettings(value: unknown): StudioSettings {
  if (!isRecord(value)) return {};
  const next: StudioSettings = {};
  if (typeof value.companyName === 'string' && value.companyName.trim()) next.companyName = value.companyName.trim().slice(0, 120);
  if (typeof value.quoteContact === 'string' && value.quoteContact.trim()) next.quoteContact = value.quoteContact.trim().slice(0, 120);
  if (typeof value.logoUrl === 'string' && isLogoUrl(value.logoUrl)) next.logoUrl = value.logoUrl;
  if (typeof value.currency === 'string' && (CURRENCIES as readonly string[]).includes(value.currency)) {
    next.currency = value.currency as CurrencyCode;
  }
  if (value.defaultUnit === 'm' || value.defaultUnit === 'ft') next.defaultUnit = value.defaultUnit;
  if (inRange(value.defaultAisleClearM, 0.6, 12)) next.defaultAisleClearM = value.defaultAisleClearM;
  if (inRange(value.defaultBoothSpacingM, 0, 5)) next.defaultBoothSpacingM = value.defaultBoothSpacingM;
  return next;
}

/** 团队几何默认只在新建时复制进方案。报价抬头不在这里快照，打开时再继承。 */
export function seedPlanEditor(team: StudioSettings | null | undefined): PlanEditorSettings | undefined {
  if (!team) return undefined;
  const next: PlanEditorSettings = {};
  if (team.defaultUnit) next.displayUnit = team.defaultUnit;
  if (team.defaultAisleClearM !== undefined) next.aisleClearM = team.defaultAisleClearM;
  if (team.defaultBoothSpacingM !== undefined) next.boothSpacingM = team.defaultBoothSpacingM;
  return Object.keys(next).length ? next : undefined;
}

export type SettingSource = 'plan' | 'personal' | 'team' | 'builtin';

export interface ResolvedSetting<T> {
  value: T;
  source: SettingSource;
}

function present<T>(value: T | null | undefined): value is T {
  if (value === null || value === undefined) return false;
  if (typeof value === 'number' && !Number.isFinite(value)) return false;
  if (typeof value === 'string' && value.trim() === '') return false;
  return true;
}

/**
 * 方案覆盖优先，其次是调用方给的回退（个人或团队），最后是内置默认。
 * `false` 和 `0` 都是有效值。
 */
export function resolveSetting<T>(
  planValue: T | null | undefined,
  fallbackValue: T | null | undefined,
  builtin: T,
  fallbackSource: Exclude<SettingSource, 'plan' | 'builtin'>,
): ResolvedSetting<T> {
  if (present(planValue)) return { value: planValue, source: 'plan' };
  if (present(fallbackValue)) return { value: fallbackValue, source: fallbackSource };
  return { value: builtin, source: 'builtin' };
}
