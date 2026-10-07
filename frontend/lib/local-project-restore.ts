import { STORAGE_KEY } from '../components/room-organizer/lib/constants';
import { withHouseId } from '../components/room-organizer/lib/ids';
import { backupStoredLayout, localStorageOrNull, parseLayoutJson, sameLayoutContent } from '../components/room-organizer/lib/persistence';
import { parseStoredLayout } from '../components/room-organizer/lib/schema';
import type { RoomLayout } from '../components/room-organizer/lib/types';

/** File validation is separate from applying an AI suggestion or inheriting a design book. */
export function prepareLocalRestoreLayout(layout: RoomLayout): RoomLayout {
  const parsed = parseStoredLayout(layout);
  if (!parsed) throw new Error('备份布局无法完整读取，当前项目未改变。');
  return withHouseId(parsed);
}

function matches(left: RoomLayout | null, right: RoomLayout): boolean {
  return left !== null && left.id === right.id && sameLayoutContent(left, right);
}

/** The Provider commits Brief first; this synchronous step verifies and compensates the main layout domain. */
export function commitLocalRestoreLayout(layout: RoomLayout, access: {
  current(): RoomLayout;
  apply(value: RoomLayout): void;
  beforeReplace?(): void;
}, storage: Storage | null = localStorageOrNull()): string {
  if (!storage) throw new Error('本机布局存储不可用，恢复未完成。');
  const previous = access.current();
  let oldRaw: string | null;
  try { oldRaw = storage.getItem(STORAGE_KEY); }
  catch { throw new Error('无法读取原本机布局，已停止恢复。'); }
  if (oldRaw !== null && parseLayoutJson(oldRaw) === null && !backupStoredLayout(storage)) {
    throw new Error('原本机布局无法读取且尚未保全，已停止替换。');
  }
  const json = JSON.stringify(layout);
  try {
    // Do not evict older recovery copies to force a file restore into a full store.
    storage.setItem(STORAGE_KEY, json);
    if (!matches(parseLayoutJson(storage.getItem(STORAGE_KEY) ?? ''), layout)) {
      throw new Error('布局保存后核对不一致，恢复未完成。');
    }
    access.beforeReplace?.();
    access.apply(layout);
    if (!matches(access.current(), layout)) throw new Error('布局替换未被接受，恢复未完成。');
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
        if (current !== json) throw new Error('恢复期间本机保存已变化，未覆盖新的保存。');
        if (oldRaw === null) storage.removeItem(STORAGE_KEY);
        else storage.setItem(STORAGE_KEY, oldRaw);
        if (storage.getItem(STORAGE_KEY) !== oldRaw) throw new Error();
      }
    } catch { failures.push('本机布局保存尚未完整回退'); }
    const reason = caught instanceof Error && /布局保存后核对不一致|布局替换未被接受/.test(caught.message)
      ? caught.message : '本机布局保存失败，恢复未完成。';
    throw new Error(failures.length ? `${reason} ${failures.join('；')}。请保留本页与备份文件后重试。` : `${reason} 原布局与原保存已保留。`);
  }
}
