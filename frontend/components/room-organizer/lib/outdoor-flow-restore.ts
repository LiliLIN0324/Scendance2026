/**
 * 刷新后恢复户外流程状态（M5 切片，2026-11-16）。
 *
 * 原来的 `readState` 只有一条铁律：字段不全就整份丢掉。实际后果是两头的坑——
 *  · **旧草稿被整份丢掉**：早一点的草稿没有 `brief.people`，一份还算有效的进度被清成空白；
 *  · **过期的登录等待被原样恢复**：`pendingLogin` 里记的是当时那份方案的版本号，
 *    方案已经变了还照样把输入框禁掉，用户看到的是「登录后继续」，可那件事早就不是这件事。
 *
 * 这里的口径是：能证明还一致的才恢复，恢复不了的降级而不是连坐。
 *  - 阶段不认识 → 退回 `place`，其余字段照旧保留（旧枚举不应该抹掉整个草稿）；
 *  - `brief` 三个列表缺哪个补空数组，不因为少一个字段把分区、物料一起丢；
 *  - `pendingLogin` 的方案版本与当前不一致 → 丢掉这条等待（不自动继续，也不禁输入框）；
 *  - `pendingBoundary` 缺字段或基准版本不一致 → 丢掉这份未确认的边界；
 *  - `completed` 只保留认识的阶段，去重。
 *
 * 纯函数，不读 localStorage、不碰 DOM，可以在 node 里直接测。
 */

import type { OutdoorFlowState } from './outdoor-agent-contract';
import { emptyOutdoorFlow } from './outdoor-agent-contract';

export interface RestoreInput {
  /** 解析后的 localStorage 原文；解析失败传 null。 */
  raw: unknown;
  scope: string;
  /** 当前认识的阶段列表。 */
  stages: readonly string[];
  /** 当前方案版本；有值时用来判定登录等待/未确认边界是否过期。 */
  planVersion?: string | null;
}

export interface RestoreResult {
  state: OutdoorFlowState;
  /** 这次恢复做了什么取舍，便于诊断与测试。 */
  notes: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

/** 事实列表原样保留（条目结构由契约决定，这里不做二次建模）。 */
function factList<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

export function restoreOutdoorFlow(input: RestoreInput): RestoreResult {
  const notes: string[] = [];
  const empty = emptyOutdoorFlow(input.scope);
  const raw = input.raw;
  if (!isRecord(raw)) {
    return { state: empty, notes: ['no_draft'] };
  }
  if (raw.scope !== input.scope) {
    return { state: empty, notes: ['other_scope'] };
  }

  const stage = typeof raw.stage === 'string' && input.stages.includes(raw.stage) ? raw.stage : null;
  if (!stage) {
    notes.push('stage_downgraded');
  }

  const briefRaw = isRecord(raw.brief) ? raw.brief : {};
  const brief = {
    zones: factList<OutdoorFlowState['brief']['zones'][number]>(briefRaw.zones),
    items: factList<OutdoorFlowState['brief']['items'][number]>(briefRaw.items),
    people: factList<OutdoorFlowState['brief']['people'][number]>(briefRaw.people),
  };
  if (!Array.isArray(briefRaw.zones) || !Array.isArray(briefRaw.items) || !Array.isArray(briefRaw.people)) {
    notes.push('brief_filled');
  }

  const completedRaw = stringList(raw.completed);
  const completed = input.stages.filter(s => completedRaw.includes(s)) as OutdoorFlowState['completed'];
  if (completed.length !== completedRaw.length) notes.push('completed_filtered');

  const confirmedBoundary = typeof raw.confirmedBoundary === 'string' ? raw.confirmedBoundary : null;

  const current = input.planVersion ?? null;
  let pendingLogin: OutdoorFlowState['pendingLogin'];
  const loginRaw = isRecord(raw.pendingLogin) ? raw.pendingLogin : null;
  if (loginRaw && typeof loginRaw.message === 'string' && typeof loginRaw.planVersion === 'string') {
    if (current && loginRaw.planVersion !== current) notes.push('stale_login_dropped');
    else pendingLogin = {
      message: loginRaw.message,
      planVersion: loginRaw.planVersion,
      ...(typeof loginRaw.ownerId === 'string' ? { ownerId: loginRaw.ownerId } : {}),
    };
  } else if (loginRaw) {
    notes.push('login_incomplete_dropped');
  }

  let pendingBoundary: OutdoorFlowState['pendingBoundary'];
  const boundaryRaw = isRecord(raw.pendingBoundary) ? raw.pendingBoundary : null;
  if (boundaryRaw) {
    const base = boundaryRaw.base;
    const usable = isRecord(boundaryRaw.anchor)
      && Array.isArray(boundaryRaw.boundary)
      && typeof boundaryRaw.name === 'string'
      && typeof base === 'string';
    if (!usable) notes.push('boundary_incomplete_dropped');
    // 基准版本不同也保留：它是「未确认」，刷新后应重新预览、仍需显式确认，而不是直接丢掉。
    else pendingBoundary = boundaryRaw as NonNullable<OutdoorFlowState['pendingBoundary']>;
  }
  // 已确认范围的场地名（2026-11-28 图注用）：缺字段/不是串就当没有，不连坐整份草稿。
  const boundaryName = typeof raw.boundaryName === 'string' && raw.boundaryName ? raw.boundaryName : undefined;

  const state: OutdoorFlowState = {
    ...empty,
    stage: (stage ?? 'place') as OutdoorFlowState['stage'],
    brief,
    confirmedBoundary,
    completed,
    boundaryName,
    ...(pendingLogin ? { pendingLogin } : {}),
    ...(pendingBoundary ? { pendingBoundary } : {}),
  };
  return { state, notes };
}
