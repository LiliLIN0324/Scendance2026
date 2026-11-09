import { checkedMaterialCheckins } from './material-checkin-storage';
import { briefSchema } from './local-project-backup';
import { sameRecoveryFormValue } from './recovery-form-value';
import { parseStoredLayout, storedEntryCount } from '../components/room-organizer/lib/schema';
import type { RestoreJournal } from './restore-journal';

function plainRecord(value: unknown): Record<string,unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) throw new Error('恢复快照格式无效。');
  return value as Record<string,unknown>;
}
function formSnapshot(value: unknown, domain: string, scope: string, isTarget: boolean): void {
  const object=plainRecord(value),keys=Object.keys(object);
  if (object.present === false && keys.length === 1) return;
  if (object.present !== true || keys.length !== 2 || !Object.hasOwn(object,'value')) throw new Error('恢复表单存在状态无效。');
  // This rejects unsupported data without discarding undefined, holes or unknown keys.
  sameRecoveryFormValue(object.value, object.value);
  if (domain === 'material-checkins' && checkedMaterialCheckins(scope, object.value) === undefined) throw new Error('点验记录无法完整读取。');
  if (domain === 'activity-brief' && isTarget && !briefSchema.safeParse(object.value).success) throw new Error('目标活动需求格式无效，不能自动恢复。');
}
function layoutSnapshot(value: unknown): string {
  const object=plainRecord(value),keys=Object.keys(object);
  if (object.present === false && keys.length === 1) return 'local';
  if (object.present !== true || keys.length !== 2 || typeof object.raw !== 'string') throw new Error('恢复主布局快照无效。');
  try {
    const raw: unknown = JSON.parse(object.raw); const parsed = parseStoredLayout(raw);
    if (!parsed || storedEntryCount(raw) !== storedEntryCount(parsed) || !sameRecoveryFormValue(raw, parsed)) throw new Error();
    if (!parsed.id || parsed.id === 'local') throw new Error('主布局身份不明确。');
    return parsed.id;
  } catch { throw new Error('恢复主布局无法完整读取，不能自动应用或回滚。'); }
}
function sourceSnapshot(value: unknown, scope: string): void {
  const object=plainRecord(value);
  if (object.version !== 2 || object.scope !== scope || !Array.isArray(object.sources) || Object.keys(object).sort().join(',')!=='form,scope,sources,version') throw new Error('图纸快照缺少明确的 V2 存在状态，不能自动恢复。');
  if(!object.form||typeof object.form!=='object'||Array.isArray(object.form))throw new Error('图纸表单缺少存在性信息，不能自动恢复。');
  const form=plainRecord(object.form),keys=Object.keys(form);
  if (!(form.present===false&&keys.length===1) && !(form.present===true&&keys.length===2&&Object.hasOwn(form,'value'))) throw new Error('图纸表单缺少存在性信息，不能自动恢复。');
  const ids=new Set<string>();
  for (const raw of object.sources) {
    const source=plainRecord(raw);
    if (typeof source.id !== 'string' || !source.id.trim() || ids.has(source.id) || source.scope !== scope
      || typeof source.name !== 'string' || !['floorplan','photo'].includes(String(source.kind))
      || typeof source.width !== 'number' || !Number.isFinite(source.width) || source.width <= 0
      || typeof source.height !== 'number' || !Number.isFinite(source.height) || source.height <= 0
      || (source.blob !== undefined && !(source.blob instanceof Blob))) throw new Error('恢复图纸快照无效。');
    ids.add(source.id);
  }
}
/** Validate every entry before the first data-domain read or write. */
export function validateRecoveryPlan(journal: RestoreJournal, direction: 'apply' | 'rollback'): void {
  const binding=journal.scopeBinding;
  if (!binding || typeof binding.source !== 'string' || !binding.source.trim() || binding.source.length > 128 || typeof binding.target !== 'string' || !binding.target.trim() || binding.target.length > 128 || Object.keys(binding).length !== 2) throw new Error('恢复日志缺少明确的原活动与目标活动范围。');
  const entries=journal.entries;
  if (!entries.length || entries[entries.length-1]?.domain !== 'layout' || entries[entries.length-1]?.key !== 'main'
    || entries.filter(entry=>entry.domain === 'layout').length !== 1) throw new Error('恢复计划必须以唯一主布局结尾。');
  const sourceKeys=new Set<string>(),briefKeys=new Set<string>();
  const allowedScope = (domain: string, scope: string): boolean => {
    if (journal.operation === 'restore') return scope === binding.target;
    if (domain === 'activity-brief') return scope === binding.source || scope === binding.target;
    return scope === binding.source;
  };
  for (const entry of entries) {
    if (!entry.key || entry.key.length > 128) throw new Error('恢复资料范围无效。');
    if (entry.domain === 'layout') {
      if(entry.key !== 'main')throw new Error('恢复主布局范围无效。');
      if (layoutSnapshot(entry.before) !== binding.source || layoutSnapshot(entry.attempted) !== binding.target) throw new Error('恢复活动范围与主布局不一致。');
    }
    else if (entry.domain === 'source-scope') { if (!allowedScope(entry.domain,entry.key)) throw new Error('恢复日志包含未授权活动范围。');sourceKeys.add(entry.key);sourceSnapshot(entry.before,entry.key);sourceSnapshot(entry.attempted,entry.key); }
    else if (entry.domain === 'activity-brief' || entry.domain === 'material-checkins') {
      if (!allowedScope(entry.domain,entry.key)) throw new Error('恢复日志包含未授权活动范围。');
      if(entry.domain === 'activity-brief')briefKeys.add(`${entry.key}:brief`);
      formSnapshot(entry.before,entry.domain,entry.key,direction === 'rollback');formSnapshot(entry.attempted,entry.domain,entry.key,direction === 'apply');
    } else throw new Error('恢复计划包含不支持的资料类型。');
  }
  for(const key of sourceKeys)if(briefKeys.has(key))throw new Error('恢复计划的图纸与需求存储范围冲突。');
}

/** Check cross-scope target IDs before any data-domain write. */
export async function preflightRecoverySourceIds(journal: RestoreJournal, direction: 'apply' | 'rollback',
  read: (id: string) => Promise<{scope:string} | undefined>, recheck: () => Promise<void>): Promise<void> {
  const owners=new Map<string,string>();
  for (const entry of journal.entries) if (entry.domain === 'source-scope') {
    const target = (direction === 'apply' ? entry.attempted : entry.before) as {sources:{id:string}[]};
    for (const source of target.sources) {
      const owner=owners.get(source.id);
      if (owner !== undefined && owner !== entry.key) throw new Error('恢复计划将同一图纸编号分配给多个活动。');
      owners.set(source.id,entry.key);
      const existing=await read(source.id);await recheck();
      if(existing && existing.scope !== entry.key) throw new Error('图纸编号已被其他活动使用，未修改任何资料。');
    }
  }
}
