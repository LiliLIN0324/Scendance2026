import {
  EVENT_FACT_KEYS, eventProfileSchema, updateEventProfile,
  type EventFactKey, type EventProfile, type EventProfilePatch,
} from './event-profile';

/**
 * 活动档案的只读消费层（M6）。
 *
 * 三条硬规则：
 * 1. 只陈述记录：状态、来源、依据、版本原样带出；未确认项不得写成事实。
 * 2. 缺失就是缺失：没有档案 = absent，不合成空档案；unknown = 待确认，不给默认值。
 * 3. 写回必须过门：模型只能产提案，落盘要人工确认人 + 当前版本；CAS 不匹配即拒绝。
 */

export const EVENT_FACT_LABELS: Record<EventFactKey, string> = {
  date: '日期',
  timeWindow: '时间窗',
  venue: '城市与场地',
  budget: '预算',
  expectedAttendance: '预期到场',
  goal: '目标结果',
  division: '分工',
};

export type EventProfileContextState = 'confirmed' | 'pending' | 'inferred' | 'unknown' | 'absent';

export interface EventProfileContextFact {
  key: EventFactKey;
  label: string;
  state: EventProfileContextState;
  /** 只有 unknown/absent 恒为 null；inferred 也照实给值，但状态不得被读成已确认。 */
  valueText: string | null;
  source: string | null;
  note: string;
  revision: number;
  /** 预算与分工不进客户产物，这里标成内部可见，避免被顺手贴给客户。 */
  internal: boolean;
  updatedBy: string;
  updatedAt: string;
}

export const EVENT_PROFILE_CONTEXT_NOTICE =
  '活动档案（只读）：以下均为记录值，未确认项不得当作事实；不得把推断、预设或模型推测写成已确认。';

const internalKeys: ReadonlySet<EventFactKey> = new Set(['budget', 'division']);

function moneyText(value: { amountMinor: number | null; currency: 'CNY' | null } | null): string {
  if (!value || value.amountMinor === null) return '待确认';
  const sign = value.currency === 'CNY' ? '¥' : '';
  return `${sign}${(value.amountMinor / 100).toFixed(2)}`;
}

function valueText(key: EventFactKey, profile: EventProfile): string | null {
  switch (key) {
    case 'date':
      return profile.date.value;
    case 'timeWindow': {
      const value = profile.timeWindow.value;
      if (!value) return null;
      return `${value.startTime}–${value.endTime}${value.endsNextDay ? '（次日）' : ''} ${value.timeZone}`;
    }
    case 'venue': {
      const value = profile.venue.value;
      if (!value) return null;
      return [value.city.trim(), value.venueName.trim()].filter(Boolean).join(' · ') || null;
    }
    case 'budget': {
      const value = profile.budget.value;
      if (!value) return null;
      return `估算 ${moneyText(value.estimate)}｜实际 ${moneyText(value.actual)}`;
    }
    case 'expectedAttendance': {
      const value = profile.expectedAttendance.value;
      return value === null ? null : `${value} 人`;
    }
    case 'goal':
      return profile.goal.value;
    case 'division': {
      const value = profile.division.value;
      if (!value) return null;
      return value.map(row => `${row.roleName}${row.ownerName.trim() ? `（${row.ownerName.trim()}）` : '（未指定）'}`).join('、');
    }
  }
}

/** 只读视图：返回纯字符串字段，调用方无法通过它改到档案。 */
export function eventProfileContext(profile: EventProfile | undefined): EventProfileContextFact[] {
  if (profile === undefined) {
    return EVENT_FACT_KEYS.map(key => ({
      key, label: EVENT_FACT_LABELS[key], state: 'absent' as const, valueText: null,
      source: null, note: '', revision: 0, internal: internalKeys.has(key), updatedBy: '', updatedAt: '',
    }));
  }
  const parsed = eventProfileSchema.parse(profile);
  return EVENT_FACT_KEYS.map(key => {
    const fact = parsed[key];
    return {
      key,
      label: EVENT_FACT_LABELS[key],
      state: fact.status,
      valueText: fact.status === 'unknown' ? null : valueText(key, parsed),
      source: fact.source,
      note: fact.note,
      revision: fact.revision,
      internal: internalKeys.has(key),
      updatedBy: fact.updatedBy,
      updatedAt: fact.updatedAt,
    };
  });
}

function describe(fact: EventProfileContextFact): string {
  if (fact.state === 'unknown') return '待确认（未填写，不得推测）';
  const value = fact.valueText ?? '待确认';
  const tagged = fact.state === 'confirmed' ? `${value}（已确认）`
    : fact.state === 'inferred' ? `${value}（推断，需人工确认）`
      : `${value}（待确认）`;
  return fact.note ? `${tagged}｜依据：${fact.note}` : tagged;
}

/** 给模型/面板的固定文本；同一档案重复调用结果一致，不含系统时钟。 */
export function formatEventProfileContext(profile: EventProfile | undefined): string {
  if (profile === undefined) {
    return [EVENT_PROFILE_CONTEXT_NOTICE,
      '- 尚未创建活动档案：日期、时间窗、城市与场地、预算、预期到场、目标结果、分工均未知，不得用简报或场地容量推算。'].join('\n');
  }
  const facts = eventProfileContext(profile);
  const lines = [EVENT_PROFILE_CONTEXT_NOTICE];
  for (const fact of facts) lines.push(`- ${fact.label}${fact.internal ? '（内部可见）' : ''}：${describe(fact)}`);
  const parsed = eventProfileSchema.parse(profile);
  lines.push(`- 档案版本：v${parsed.revision}｜更新人：${parsed.updatedBy}｜更新时间：${parsed.updatedAt}`);
  return lines.join('\n');
}

export interface EventProfileProposal {
  baseRevision: number;
  preview: EventProfile;
  changedKeys: EventFactKey[];
  requiresHumanConfirmation: true;
}

export interface EventProfileConfirmation {
  confirmedBy: string;
  confirmedAt: string;
}

/**
 * 模型/导入只能产提案：先按当前版本试算，不落盘。
 * 试算同样走 `updateEventProfile` 的契约校验，所以 `model_inference + confirmed` 在这里就被拒。
 */
export function proposeEventProfileChange(
  profile: EventProfile,
  patch: EventProfilePatch,
  meta: { updatedBy: string; updatedAt: string },
): EventProfileProposal {
  const parsed = eventProfileSchema.parse(profile);
  const changedKeys = (Object.keys(patch) as EventFactKey[]).filter(key => patch[key] !== undefined);
  if (!changedKeys.length) throw new Error('没有要提议的活动档案字段。');
  const preview = updateEventProfile(parsed, patch, parsed.revision, meta);
  return { baseRevision: parsed.revision, preview, changedKeys, requiresHumanConfirmation: true };
}

/**
 * 人工确认后落盘：只接受本次被确认的预览值，并用确认人作为更新人。
 * 版本不一致（档案已被人改过）即拒绝，绝不覆盖新内容。
 */
export function applyEventProfileProposal(
  current: EventProfile,
  proposal: EventProfileProposal,
  confirmation: EventProfileConfirmation,
): EventProfile {
  if (!proposal || proposal.requiresHumanConfirmation !== true) {
    throw new Error('活动档案改动必须经人工确认后才能落盘。');
  }
  const confirmedBy = confirmation.confirmedBy.trim();
  if (!confirmedBy) throw new Error('请记录确认人；AI 或预设不能代替人工确认。');
  if (!Number.isFinite(Date.parse(confirmation.confirmedAt))) throw new Error('请记录有效的确认时间。');
  const parsed = eventProfileSchema.parse(current);
  if (parsed.revision !== proposal.baseRevision) throw new Error('活动档案版本已变化，请重新核对。');
  const preview = eventProfileSchema.parse(proposal.preview);
  if (preview.revision !== proposal.baseRevision + 1) throw new Error('提案版本不连续，请重新生成提案。');
  const patch = Object.fromEntries(proposal.changedKeys.map(key => {
    const fact = preview[key];
    return [key, { value: fact.value, status: fact.status, source: fact.source, note: fact.note }];
  })) as EventProfilePatch;
  return updateEventProfile(parsed, patch, parsed.revision, {
    updatedBy: confirmedBy, updatedAt: confirmation.confirmedAt,
  });
}
