import { sameRecoveryFormValue } from '@/lib/recovery-form-value';
import { environmentScopeKey, isEnvironmentList, type StoredEnvironment, type EnvironmentReadSnapshot, type EnvironmentScope, type EnvironmentStrictReadResult } from './environment-preference';

export interface PendingEnvironmentWrite {
  scope: EnvironmentScope; generation: number; before: EnvironmentReadSnapshot; intended: StoredEnvironment[] | null;
}
export type EnvironmentWriteReconciliation =
  | { status: 'confirmed' }
  | { status: 'retryable' }
  | { status: 'conflict' }
  | { status: 'stale' }
  | { status: 'unresolved'; reason: EnvironmentStrictReadResult extends { ok: false; reason: infer R } ? R : string };

function sameScope(left: EnvironmentScope, right: EnvironmentScope): boolean {
  const a=environmentScopeKey(left),b=environmentScopeKey(right);
  return a !== null && b !== null && a === b && left.kind === right.kind;
}

/** Snapshot the user's still-unsaved intent so later changes cannot alter its review. */
export function createPendingEnvironmentWrite(scope: EnvironmentScope, generation: number, before: EnvironmentReadSnapshot, intended: StoredEnvironment[] | null): PendingEnvironmentWrite {
  const key=environmentScopeKey(scope);
  if (!key || !Number.isSafeInteger(generation) || generation < 0 || !sameScope(scope,before.scope) || before.key !== key) throw new Error('场地草稿范围已变化，不能核对。');
  try {
    if (!sameRecoveryFormValue(intended,intended) || (intended !== null && !isEnvironmentList(intended)) || !sameRecoveryFormValue(intended,JSON.parse(JSON.stringify(intended)))) throw new Error();
  } catch { throw new Error('场地草稿无法核对。'); }
  return structuredClone({scope,generation,before,intended});
}

/** Does not write or infer prior storage from an uncertain write outcome. */
export function reconcilePendingEnvironmentWrite(pending: PendingEnvironmentWrite, activeScope: EnvironmentScope, generation: number,
  current: EnvironmentStrictReadResult): EnvironmentWriteReconciliation {
  if (generation !== pending.generation || !sameScope(pending.scope,activeScope)) return {status:'stale'};
  if (!current.ok) return {status:'unresolved',reason:current.reason};
  if (!sameScope(pending.scope,current.snapshot.scope) || current.snapshot.key !== pending.before.key) return {status:'stale'};
  try {
    if (current.snapshot.present && sameRecoveryFormValue(current.snapshot.value,pending.intended)) return {status:'confirmed'};
    if (current.snapshot.raw === pending.before.raw && current.snapshot.present === pending.before.present && sameRecoveryFormValue(current.snapshot.value,pending.before.value)) return {status:'retryable'};
    return {status:'conflict'};
  } catch { return {status:'unresolved',reason:'invalid-data'}; }
}
