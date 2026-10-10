import { canonical } from '../../supabase/functions/_shared/domain';
import { materialCheckinLedgerSchema, mergeMaterialCheckinLedgers, type MaterialCheckinLedger } from '../../supabase/functions/_shared/material-checkin-contract';
import { readSourceRecord, updateSourceForm, type SourceFormKey } from './source-storage';

export function materialCheckinStorageKey(projectId: string): SourceFormKey {
  if (!projectId.trim() || projectId.length > 128) throw new Error('请先保存有明确编号的本地项目，再记录数量点验。');
  return ['material-checkins', projectId];
}
export function checkedMaterialCheckins(projectId: string, value: unknown): MaterialCheckinLedger | undefined {
  if (value === undefined) return undefined;
  const result = materialCheckinLedgerSchema.safeParse(value);
  if (!result.success) throw new Error('本机点验记录无法完整读取，原资料已保留，请先核对备份。');
  if (result.data.projectId !== projectId) throw new Error('点验记录属于另一个项目，未合并或覆盖。');
  return result.data;
}
export async function readMaterialCheckins(projectId: string): Promise<MaterialCheckinLedger | undefined> {
  const value = await readSourceRecord<unknown>(materialCheckinStorageKey(projectId));
  return checkedMaterialCheckins(projectId, value);
}

/** Append-only merge is computed against the native transaction's current value, including other tabs' writes. */
export async function mergeStoredMaterialCheckins(projectId: string, incoming: MaterialCheckinLedger, beforeWrite: () => void = () => {}): Promise<MaterialCheckinLedger> {
  const proposal = checkedMaterialCheckins(projectId, incoming);
  if (proposal === undefined) throw new Error('没有可保存的点验记录，原账册已保留。');
  return updateSourceForm(materialCheckinStorageKey(projectId), value => {
    beforeWrite();
    const current = checkedMaterialCheckins(projectId, value);
    return current ? mergeMaterialCheckinLedgers(current, proposal) : proposal;
  });
}

/** Compensation/explicit undo of an import only; ordinary scene edits never call this. */
export async function restoreMaterialCheckinsIfUnchanged(projectId: string, expected: MaterialCheckinLedger | undefined,
  next: MaterialCheckinLedger | undefined, beforeWrite: () => void = () => {}): Promise<MaterialCheckinLedger | undefined> {
  const expectedValue = checkedMaterialCheckins(projectId, expected), nextValue = checkedMaterialCheckins(projectId, next);
  return updateSourceForm(materialCheckinStorageKey(projectId), value => {
    beforeWrite();
    const current = checkedMaterialCheckins(projectId, value);
    if (canonical(current ?? null) !== canonical(expectedValue ?? null)) throw new Error('点验记录已有新变化，不能覆盖较新的记录。');
    return nextValue;
  });
}
