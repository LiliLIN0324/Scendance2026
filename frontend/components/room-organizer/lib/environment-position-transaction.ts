import type { LocalWriteCapability } from '@/lib/local-write-lease';
import { sameRecoveryFormValue } from '@/lib/recovery-form-value';
import { environmentScopeKey, readEnvironmentsStrict, writeEnvironmentsStrict, type EnvironmentScope, type StoredEnvironment } from './environment-preference';
import { createPendingEnvironmentWrite, type PendingEnvironmentWrite } from './environment-write-reconciliation';

export type EnvironmentPositionResult =
  | { status: 'saved'; next: StoredEnvironment[]; raw: string }
  | { status: 'blocked' | 'uncertain'; reason: string; next?: StoredEnvironment[]; pending?: PendingEnvironmentWrite };

/**
 * One environment-only write. No React setter or scene operation is invoked here.
 * `assertCurrent` must validate the current scope and generation at each call.
 */
export function persistEnvironmentPosition(input: {
  scope: EnvironmentScope; generation: number; environments: readonly StoredEnvironment[]; assetId: string;
  position: Readonly<{x:number;y:number;z:number}>; capability: LocalWriteCapability; assertCurrent(): void;
}): EnvironmentPositionResult {
  const {scope,generation,environments,assetId,position,capability,assertCurrent}=input;
  if (!environmentScopeKey(scope) || !Number.isSafeInteger(generation) || generation < 0 || !assetId ||
      ![position.x,position.y,position.z].every(Number.isFinite)) return {status:'blocked',reason:'场地位置或范围无效。'};
  try { assertCurrent(); } catch { return {status:'blocked',reason:'活动已变化，未保存场地位置。'}; }
  const read=readEnvironmentsStrict(scope,capability);
  if (!read.ok) return {status:'blocked',reason:`场地记录无法核对：${read.reason}`};
  try { assertCurrent(); } catch { return {status:'blocked',reason:'活动已变化，未保存场地位置。'}; }
  const stored=read.snapshot.value;
  const persisted=Array.isArray(stored)?stored:stored?[stored]:[];
  try {
    if (!read.snapshot.present || !sameRecoveryFormValue(persisted,environments)) return {status:'blocked',reason:'场地记录已变化，请先核对。'};
  } catch { return {status:'blocked',reason:'场地草稿无法核对。'}; }
  if (environments.filter(entry=>entry.assetId===assetId).length !== 1) return {status:'blocked',reason:'场地编号缺失或重复，请先核对。'};
  const next=structuredClone(environments).map(entry=>entry.assetId===assetId ? {...entry,position:{...position}} : entry);
  let pending:PendingEnvironmentWrite;
  try { pending=createPendingEnvironmentWrite(scope,generation,read.snapshot,next); }
  catch { return {status:'blocked',reason:'场地草稿无法核对。'}; }
  try { assertCurrent(); } catch { return {status:'blocked',reason:'活动已变化，未保存场地位置。',next,pending}; }
  const layoutId=scope.kind==='draft'?undefined:scope.id;
  const result=writeEnvironmentsStrict(layoutId,next,capability,{expectedRaw:read.snapshot.raw});
  if (!result.ok) return {status:result.writeStatus==='unknown'?'uncertain':'blocked',reason:result.reason,next,pending};
  try { assertCurrent(); } catch { return {status:'uncertain',reason:'活动已变化，需核对保存结果。',next,pending}; }
  return {status:'saved',next,raw:result.json};
}
