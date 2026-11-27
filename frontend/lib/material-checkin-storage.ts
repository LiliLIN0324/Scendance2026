import { canonical } from '../../supabase/functions/_shared/domain';
import { materialCheckinLedgerSchema, mergeMaterialCheckinLedgers, type MaterialCheckinLedger } from '../../supabase/functions/_shared/material-checkin-contract';
import { readSourceRecord, updateSourceForm, listSourceRecords, type SourceFormKey } from './source-storage';
import { localWriteCapabilityGuard, type LocalWriteCapability } from './local-write-lease';

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
  await ensureCheckinsMigrated(projectId);
  const value = await readSourceRecord<unknown>(materialCheckinStorageKey(projectId));
  return checkedMaterialCheckins(projectId, value);
}

/** Append-only merge is computed against the native transaction's current value, including other tabs' writes. */
export async function mergeStoredMaterialCheckins(projectId: string, incoming: MaterialCheckinLedger, beforeWrite: () => void = () => {}, capability?: LocalWriteCapability): Promise<MaterialCheckinLedger> {
  const proposal = checkedMaterialCheckins(projectId, incoming);
  if (proposal === undefined) throw new Error('没有可保存的点验记录，原账册已保留。');
  const leaseGuard = capability ? localWriteCapabilityGuard(capability) : undefined;
  const transactionGuard = leaseGuard ? { signal: leaseGuard.signal, assertStillHeld() { leaseGuard.assertStillHeld(); beforeWrite(); } } : undefined;
  return updateSourceForm(materialCheckinStorageKey(projectId), value => {
    beforeWrite();
    const current = checkedMaterialCheckins(projectId, value);
    return current ? mergeMaterialCheckinLedgers(current, proposal) : proposal;
  }, transactionGuard);
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

// ---- 旧桶同 id 懒迁移（D9-2，IndexedDB forms 桶，不照搬 localStorage 口径）----
/** 迁移 marker 命名空间：记这份新键是从哪个旧槽搬来的，幂等防重放。 */
const MIGRATED_NAMESPACE = 'material-checkins-migrated';
/** 旧桶只读标记命名空间：同 id 复制成功后落，供跨 id 隔离路径判定。 */
const READONLY_NAMESPACE = 'material-checkins-readonly';

export type CheckinMigrationStatus =
  | 'migrated'          // 本次完成一次同 id 复制
  | 'already-migrated'  // marker 已在，幂等跳过
  | 'target-has-data'   // 新键已有数据，以新键为准，不覆盖
  | 'no-legacy'         // 旧槽无可用台账
  | 'different-id'      // 旧草稿属别的项目，隔离不并入
  | 'unavailable';      // 存储异常，不抛、不阻塞读取

export interface CheckinMigrationResult { status: CheckinMigrationStatus; copied: boolean; }

function migratedMarkerKey(projectId: string): SourceFormKey { return [MIGRATED_NAMESPACE, projectId]; }
function readonlyMarkerKey(legacyId: string): SourceFormKey { return [READONLY_NAMESPACE, legacyId]; }

async function readRaw(scope: SourceFormKey): Promise<unknown> {
  try { return await readSourceRecord<unknown>(scope); } catch { return undefined; }
}

/**
 * 同 id 懒迁移：新键为空时，把信封 `projectId` 与当前正源一致的旧桶台账整份复制到新键。
 * - 不同 id：旧草稿按原 id 只读保留，绝不并入当前项目；
 * - 新键已有数据：以新键为准，不覆盖、不合并；
 * - marker 幂等防重放；复制 + 回读校验通过后才落 marker 与旧桶只读标记，中途失败不留 marker，可安全重试。
 */
export async function ensureCheckinsMigrated(projectId: string): Promise<CheckinMigrationResult> {
  if (!projectId.trim()) return { status: 'unavailable', copied: false };
  try {
    const targetKey = materialCheckinStorageKey(projectId);

    // 幂等：已迁移过，不再复制。
    if (await readRaw(migratedMarkerKey(projectId)) !== undefined) {
      return { status: 'already-migrated', copied: false };
    }

    // 新键已有数据：以新键为准，不覆盖、不合并。损坏记录交由读取路径报错，迁移里不吞。
    if (await readRaw(targetKey) !== undefined) {
      return { status: 'target-has-data', copied: false };
    }

    const legacyRecords = await listSourceRecords<unknown>('material-checkins');
    let sameId: { legacyId: string; ledger: MaterialCheckinLedger } | null = null;
    let foreignId = false;
    for (const record of legacyRecords) {
      const legacyId = record.key[1];
      if (legacyId === projectId) continue; // 已是新键，不参与迁移
      try {
        const ledger = checkedMaterialCheckins(projectId, record.value);
        if (ledger) sameId = { legacyId, ledger };
      } catch {
        foreignId = true; // 解析失败或属别的项目：隔离保留，不并入
      }
    }
    if (!sameId) return foreignId ? { status: 'different-id', copied: false } : { status: 'no-legacy', copied: false };

    // 整份复制到新键；事务内再判空，并发下另一页已写入则不覆盖。
    await updateSourceForm(targetKey, current => current !== undefined ? current : sameId!.ledger);

    // 回读校验：半成品不落 marker，下次可重试。
    const verify = checkedMaterialCheckins(projectId, await readRaw(targetKey));
    if (!verify) return { status: 'unavailable', copied: false };

    await updateSourceForm(migratedMarkerKey(projectId), () => sameId!.legacyId);
    await updateSourceForm(readonlyMarkerKey(sameId!.legacyId), () => '1');
    return { status: 'migrated', copied: true };
  } catch {
    return { status: 'unavailable', copied: false };
  }
}

/** 旧槽台账是否已转只读；存储异常按未只读处理（保守放行读取）。 */
export async function isLegacyCheckinReadOnly(legacyId: string): Promise<boolean> {
  const id = legacyId.trim();
  if (!id) return false;
  try { return (await readSourceRecord<unknown>(readonlyMarkerKey(id))) === '1'; } catch { return false; }
}
