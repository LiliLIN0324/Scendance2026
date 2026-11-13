export const LOCAL_RESTORE_PAUSED = '本机备份恢复暂不可用；请保留备份文件和当前活动，恢复保障完成后再使用。';
/**
 * 本机备份恢复（读任意备份文件回填当前工作区）仍然停着：备份面板的入口还是「恢复暂不可用」，
 * 那条链路一打开就会和面板写死的暂停文案打架，所以闸门保持关闭。
 */
export function localRestoreAvailable(): boolean { return false; }
/**
 * 2026-11-13（用户拍板 A）：活动之间来回切换是另一件事——新建活动之后旧归档卡此前一律 disabled，
 * 用户反馈「点不了」。切换走的是「读归档 → 校验 → 恢复 → 可撤销」这条已完整实现并有测试的通道，
 * 只是被全局恢复闸门一起锁掉了。这里单独放行活动切换，文件恢复保持暂停。
 */
export function localActivitySwitchAvailable(): boolean { return true; }
/**
 * 活动切换本身是一次受控的本机恢复：在这段调用栈里暂时放行被暂停的恢复提交。
 * 只有切换入口会开这个作用域，备份面板读用户挑的文件仍旧走不通。
 */
let activitySwitchDepth = 0;
export async function withActivitySwitch<T>(task: () => Promise<T>): Promise<T> {
  activitySwitchDepth += 1;
  try { return await task(); } finally { activitySwitchDepth -= 1; }
}
export function requireLocalRestoreAvailable(): void {
  if (!localRestoreAvailable() && activitySwitchDepth === 0) throw new Error(LOCAL_RESTORE_PAUSED);
}

import { STORAGE_KEY } from '../components/room-organizer/lib/constants';
import { withHouseId } from '../components/room-organizer/lib/ids';
import { backupStoredLayout, localStorageOrNull, parseLayoutJson, sameLayoutContent } from '../components/room-organizer/lib/persistence';
import { ACTIVITY_COVER_NAMESPACE } from './activity-cover';
import { LOCAL_ACTIVITIES_NAMESPACE } from './local-activities';
import { createLocalProjectBackup } from './local-project-backup';
import { readMaterialCheckins } from './material-checkin-storage';
import { readSourceRecord, readSourceRecordSnapshot, readSourceScopeSnapshot } from './source-storage';
import type { RoomLayout } from '../components/room-organizer/lib/types';

/** New activities minted by `crypto.randomUUID()`, not a legacy short house id. */
export const FRESH_ACTIVITY_ID = /^house-[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
export function isFreshActivityId(id: string | undefined): id is string {
  return typeof id === 'string' && FRESH_ACTIVITY_ID.test(id);
}

/** One-shot proof that the new scope had no archive, brief, check-ins, drawings or cover. */
export interface FreshActivityScopeClearance {
  readonly kind: 'fresh-activity-scope-clearance';
  readonly scope: string;
  readonly outgoingId: string;
}
const freshClearances = new WeakSet<FreshActivityScopeClearance>();

/** Read-only. Call while holding the outgoing and new source locks; a failed read never counts as empty. */
export async function proveFreshActivityScopeUnused(scope: string, outgoingId: string): Promise<FreshActivityScopeClearance> {
  if (!isFreshActivityId(scope) || !outgoingId.trim() || scope === outgoingId) {
    throw new Error('新活动编号无效或与当前活动重复，未切换。原活动已保留。');
  }
  try {
    if (await readSourceRecord([LOCAL_ACTIVITIES_NAMESPACE, scope]) !== undefined) throw new Error('新活动编号已被归档占用，未切换。原活动已保留。');
    if (await readSourceRecord([ACTIVITY_COVER_NAMESPACE, scope]) !== undefined) throw new Error('新活动编号已有封面记录，未切换。原活动已保留。');
    const brief = await readSourceRecordSnapshot(`${scope}:brief`);
    if (!brief || brief.present !== false) throw new Error('新活动编号已有需求记录，未切换。原活动已保留。');
    if (await readMaterialCheckins(scope) !== undefined) throw new Error('新活动编号已有点验记录，未切换。原活动已保留。');
    const drawings = await readSourceScopeSnapshot(scope);
    if (drawings.scope !== scope || drawings.sources.length > 0 || drawings.form !== undefined) {
      throw new Error('新活动编号已有图纸资料，未切换。原活动已保留。');
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes('未切换')) throw error;
    throw new Error(`新活动编号无法确认为空，未切换。原活动已保留。${error instanceof Error ? ` ${error.message}` : ''}`);
  }
  const clearance: FreshActivityScopeClearance = { kind: 'fresh-activity-scope-clearance', scope, outgoingId };
  freshClearances.add(clearance);
  return clearance;
}

/** File validation is separate from applying an AI suggestion or inheriting a design book. */
export function prepareLocalRestoreLayout(layout: RoomLayout): RoomLayout {
  // Reuse full V2 validation before assigning an identity or touching either storage domain.
  return withHouseId(createLocalProjectBackup(layout, {
    state: 'ready', scope: layout.id ?? 'local', brief: { status: 'absent' },
  }).layout);
}

function matches(left: RoomLayout | null, right: RoomLayout): boolean {
  return left !== null && left.id === right.id && sameLayoutContent(left, right);
}

type LayoutAccess = {
  current(): RoomLayout;
  apply(value: RoomLayout): void;
  beforeReplace?(): void;
};

/** Writes only the current layout key, then reads it back. Restores the previous bytes if the page rejects it. */
function commitLocalLayout(layout: RoomLayout, access: LayoutAccess, storage: Storage, kind: 'restore' | 'fresh'): string {
  const restoring = kind === 'restore';
  const candidate = createLocalProjectBackup(layout, {
    state: 'ready', scope: layout.id ?? 'local', brief: { status: 'absent' },
  }).layout;
  const previous = access.current();
  let oldRaw: string | null;
  try { oldRaw = storage.getItem(STORAGE_KEY); }
  catch { throw new Error(restoring ? '无法读取原本机布局，已停止恢复。' : '无法读取原本机布局，已停止新建。原活动已保留。'); }
  if (oldRaw !== null && parseLayoutJson(oldRaw) === null && !backupStoredLayout(storage)) {
    throw new Error(restoring ? '原本机布局无法读取且尚未保全，已停止替换。' : '原本机布局无法读取且尚未保全，已停止新建。原活动已保留。');
  }
  const json = JSON.stringify(candidate);
  try {
    // Do not evict older recovery copies to force this write into a full store.
    storage.setItem(STORAGE_KEY, json);
    if (!matches(parseLayoutJson(storage.getItem(STORAGE_KEY) ?? ''), candidate)) {
      throw new Error(restoring ? '布局保存后核对不一致，恢复未完成。' : '布局保存后核对不一致，新活动未完成。');
    }
    access.beforeReplace?.();
    access.apply(candidate);
    if (!matches(access.current(), candidate)) throw new Error(restoring ? '布局替换未被接受，恢复未完成。' : '布局替换未被接受，新活动未完成。');
    return json;
  } catch (caught) {
    const failures: string[] = [];
    if (!matches(access.current(), previous)) {
      try {
        access.apply(previous);
        if (!matches(access.current(), previous)) throw new Error();
      } catch { failures.push('原布局尚未回到当前页面'); }
    }
    try {
      const current = storage.getItem(STORAGE_KEY);
      if (current !== oldRaw) {
        if (current !== json) throw new Error(restoring ? '恢复期间本机保存已变化，未覆盖新的保存。' : '新建期间本机保存已变化，未覆盖新的保存。');
        if (oldRaw === null) storage.removeItem(STORAGE_KEY);
        else storage.setItem(STORAGE_KEY, oldRaw);
        if (storage.getItem(STORAGE_KEY) !== oldRaw) throw new Error();
      }
    } catch { failures.push('本机布局保存尚未完整回退'); }
    const reason = caught instanceof Error && /布局保存后核对不一致|布局替换未被接受/.test(caught.message)
      ? caught.message : (restoring ? '本机布局保存失败，恢复未完成。' : '本机布局保存失败，新活动未创建。');
    const kept = restoring ? '原布局与原保存已保留。' : '原活动与原保存已保留。';
    const retry = restoring ? '请保留本页与备份文件后重试。' : '请保留本页与原活动后重试。';
    throw new Error(failures.length ? `${reason} ${failures.join('；')}。${retry}` : `${reason} ${kept}`);
  }
}

/** The Provider commits Brief first; this synchronous step verifies and compensates the main layout domain. */
export function commitLocalRestoreLayout(layout: RoomLayout, access: LayoutAccess, storage: Storage | null = localStorageOrNull()): string {
  requireLocalRestoreAvailable();
  if (!storage) throw new Error('本机布局存储不可用，恢复未完成。');
  return commitLocalLayout(layout, access, storage, 'restore');
}

/**
 * Switches the current layout key to a brand-new activity.
 * Does not restore an old file and does not consult `localRestoreAvailable`.
 * The clearance is consumed even when the write fails, so a retry must prove the scope again.
 */
export function commitFreshLocalActivityLayout(layout: RoomLayout, access: LayoutAccess, clearance: FreshActivityScopeClearance, storage: Storage | null = localStorageOrNull()): string {
  if (!clearance || clearance.kind !== 'fresh-activity-scope-clearance' || !freshClearances.has(clearance)) {
    throw new Error('新活动范围尚未确认为空，未切换。原活动已保留。');
  }
  freshClearances.delete(clearance);
  const outgoing = access.current();
  if (!isFreshActivityId(layout.id) || layout.id !== clearance.scope || outgoing.id !== clearance.outgoingId || layout.id === outgoing.id) {
    throw new Error('新活动编号无效或与当前活动重复，未切换。原活动已保留。');
  }
  if (!storage) throw new Error('本机布局存储不可用，新活动未创建。原活动已保留。');
  let raw: string | null;
  try { raw = storage.getItem(STORAGE_KEY); }
  catch { throw new Error('无法读取原本机布局，已停止新建。原活动已保留。'); }
  if (raw !== null) {
    const parsed = parseLayoutJson(raw);
    if (parsed?.id === layout.id) throw new Error('新活动编号已是当前保存的活动，未覆盖。原活动已保留。');
    if (parsed && parsed.id !== outgoing.id) throw new Error('本机保存的活动与当前活动不一致，未新建。原活动已保留。');
  }
  return commitLocalLayout(layout, access, storage, 'fresh');
}
