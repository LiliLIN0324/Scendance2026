// @vitest-environment jsdom
import { webcrypto } from 'node:crypto';
import { beforeEach, expect, it, vi } from 'vitest';
import { materialCheckinLedgerSchema } from '../../supabase/functions/_shared/material-checkin-contract';
import { makeLayout } from '../components/room-organizer/lib/__testfixtures__/fixtures';
import { STORAGE_KEY } from '../components/room-organizer/lib/constants';
import { parseLayoutJson } from '../components/room-organizer/lib/persistence';
import { archiveLocalActivity, createLocalActivityBackup, readLocalActivity } from './local-activities';
import { serializeLocalProjectBackupV3 } from './local-project-backup';
import {
  commitFreshLocalActivityLayout, commitLocalRestoreLayout, localRestoreAvailable, proveFreshActivityScopeUnused,
  type FreshActivityScopeClearance,
} from './local-project-restore';
import { readSourceRecord, readSourceRecordSnapshot, readSourceScopeSnapshot, updateSourceForm, type SourceRecordSnapshot, type SourceScopeSnapshot } from './source-storage';
import type { RoomLayout } from '../components/room-organizer/lib/types';

const records = new Map<string, unknown>();
const drawings = new Map<string, { sources: unknown[]; form?: unknown }>();
function address(key: unknown): string {
  return typeof key === 'string' ? `s:${key}` : JSON.stringify(key);
}
vi.mock('./source-storage', () => ({
  readSourceRecord: vi.fn(async (key: unknown) => {
    const value = records.get(address(key));
    return value === undefined ? undefined : structuredClone(value);
  }),
  updateSourceForm: vi.fn(async (key: unknown, update: (current: unknown) => unknown) => {
    const storageKey = address(key);
    const next = update(records.has(storageKey) ? structuredClone(records.get(storageKey)) : undefined);
    if (next === undefined) records.delete(storageKey);
    else records.set(storageKey, structuredClone(next));
    return structuredClone(next);
  }),
  readSourceRecordSnapshot: vi.fn(async (key: string) => {
    const storageKey = address(key);
    if (!records.has(storageKey)) return { present: false };
    return { present: true, value: structuredClone(records.get(storageKey)) };
  }),
  readSourceScopeSnapshot: vi.fn(async (scope: string) => {
    const drawing = drawings.get(scope);
    return { scope, sources: structuredClone(drawing?.sources ?? []), form: drawing && 'form' in drawing ? structuredClone(drawing.form) : undefined };
  }),
  listSourceRecords: vi.fn(async () => []),
}));

const originalId = 'activity-original';
const brief = { event: '演练', guests: 0, description: '原活动需求', mustHave: '', allowIdeas: false };
function originalLayout(): RoomLayout {
  return makeLayout({ id: originalId, name: '演练原活动' });
}
function backupText(layout: RoomLayout = originalLayout()): string {
  const ledger = materialCheckinLedgerSchema.parse({ projectId: layout.id, dataKind: 'rehearsal', sheets: [] });
  return serializeLocalProjectBackupV3(layout,
    { state: 'ready', scope: layout.id!, brief: { status: 'present', value: brief } },
    { state: 'ready', scope: layout.id!, materialCheckins: { status: 'present', value: ledger } },
    '2026-10-09T03:00:00Z');
}
function access(layout: RoomLayout) {
  let current = layout;
  return {
    current: () => current,
    apply: (value: RoomLayout) => { current = value; },
    get value() { return current; },
  };
}

beforeEach(() => {
  records.clear(); drawings.clear(); localStorage.clear();
  vi.stubGlobal('crypto', webcrypto);
  vi.mocked(updateSourceForm).mockReset().mockImplementation(async (key: unknown, update: (current: unknown) => unknown) => {
    const storageKey = address(key);
    const next = update(records.has(storageKey) ? structuredClone(records.get(storageKey)) : undefined);
    if (next === undefined) records.delete(storageKey);
    else records.set(storageKey, structuredClone(next));
    return structuredClone(next);
  });
  vi.mocked(readSourceRecord).mockReset().mockImplementation(async (key: unknown) => {
    const value = records.get(address(key));
    return value === undefined ? undefined : structuredClone(value);
  });
  vi.mocked(readSourceRecordSnapshot).mockReset().mockImplementation(async (key): Promise<SourceRecordSnapshot> => {
    const storageKey = address(key);
    if (!records.has(storageKey)) return { present: false };
    return { present: true, value: structuredClone(records.get(storageKey)) };
  });
  vi.mocked(readSourceScopeSnapshot).mockReset().mockImplementation(async (scope): Promise<SourceScopeSnapshot> => {
    const drawing = drawings.get(scope);
    return {
      scope,
      sources: structuredClone(drawing?.sources ?? []) as SourceScopeSnapshot['sources'],
      form: drawing && 'form' in drawing ? structuredClone(drawing.form) : undefined,
    };
  });
});

it('archives the original activity, writes a fresh empty one, and reads both back without enabling file restore', async () => {
  expect(localRestoreAvailable()).toBe(false);
  const original = originalLayout();
  const text = backupText(original);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(original));
  const archived = await archiveLocalActivity(text, originalId);
  expect(archived.layout.id).toBe(originalId);
  expect(archived.layout.name).toBe('演练原活动');
  expect((await readLocalActivity(originalId)).brief).toMatchObject({ status: 'present', value: brief });
  const created = createLocalActivityBackup(original, '空白新活动', 'empty');
  expect(created.layout.id).toMatch(/^house-[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i);
  expect(created.layout.floors.flatMap(floor => floor.items)).toHaveLength(0);
  const holder = access(original);
  const clearance = await proveFreshActivityScopeUnused(created.layout.id!, originalId);
  const json = commitFreshLocalActivityLayout(created.layout, holder, clearance);
  const refreshed = parseLayoutJson(localStorage.getItem(STORAGE_KEY)!);
  expect(json).toBe(localStorage.getItem(STORAGE_KEY));
  expect(refreshed?.id).toBe(created.layout.id);
  expect(refreshed?.name).toBe('空白新活动');
  expect(refreshed?.floors.flatMap(floor => floor.items)).toHaveLength(0);
  expect(holder.value.id).toBe(created.layout.id);
  expect((await readLocalActivity(originalId)).layout.name).toBe('演练原活动');
  expect((await readLocalActivity(originalId)).materialCheckins).toMatchObject({ status: 'present' });
  const probe = { getItem: vi.fn(), setItem: vi.fn(), removeItem: vi.fn() } as unknown as Storage;
  expect(() => commitLocalRestoreLayout(created.layout, holder, probe)).toThrow('备份恢复暂不可用');
  expect(probe.getItem).not.toHaveBeenCalled();
  expect(probe.setItem).not.toHaveBeenCalled();
  expect(localStorage.getItem(STORAGE_KEY)).toBe(json);
});

it('keeps the original activity when the archive write fails, storage is full, or the new scope is occupied', async () => {
  const original = originalLayout();
  const stored = JSON.stringify(original);
  localStorage.setItem(STORAGE_KEY, stored);
  vi.mocked(updateSourceForm).mockRejectedValueOnce(new Error('空间不足'));
  await expect(archiveLocalActivity(backupText(original), originalId)).rejects.toThrow('空间不足');
  expect(localStorage.getItem(STORAGE_KEY)).toBe(stored);
  expect(records.has(address(['local-activity', originalId]))).toBe(false);
  const created = createLocalActivityBackup(original, '空白新活动', 'empty');
  const full = {
    getItem: (key: string) => key === STORAGE_KEY ? stored : null,
    setItem: vi.fn(() => { throw new DOMException('full', 'QuotaExceededError'); }),
    removeItem: vi.fn(),
  } as unknown as Storage;
  const holder = access(original);
  const clearance = await proveFreshActivityScopeUnused(created.layout.id!, originalId);
  expect(() => commitFreshLocalActivityLayout(created.layout, holder, clearance, full)).toThrow(/新活动未创建|保存失败/);
  expect(holder.value).toBe(original);
  expect(full.setItem).toHaveBeenCalled();
  expect(localStorage.getItem(STORAGE_KEY)).toBe(stored);
  records.set(address(['local-activity', created.layout.id!]), { occupied: true });
  await expect(proveFreshActivityScopeUnused(created.layout.id!, originalId)).rejects.toThrow('已被归档占用');
  expect(records.get(address(['local-activity', created.layout.id!]))).toEqual({ occupied: true });
  const other = makeLayout({ id: 'someone-else', name: '其他活动' });
  const otherRaw = JSON.stringify(other);
  localStorage.setItem(STORAGE_KEY, otherRaw);
  const third = access(original);
  const fresh = createLocalActivityBackup(original, '另一张空白', 'empty');
  const matched = await proveFreshActivityScopeUnused(fresh.layout.id!, originalId);
  expect(() => commitFreshLocalActivityLayout(fresh.layout, third, matched)).toThrow('不一致');
  expect(localStorage.getItem(STORAGE_KEY)).toBe(otherRaw);
  expect(third.value).toBe(original);
});

it('refuses a forged or reused clearance and a scope that already has records, without writing', async () => {
  const original = originalLayout();
  const created = createLocalActivityBackup(original, '空白新活动', 'empty');
  const holder = access(original);
  const stored = JSON.stringify(original);
  localStorage.setItem(STORAGE_KEY, stored);
  const forged = { kind: 'fresh-activity-scope-clearance', scope: created.layout.id!, outgoingId: originalId } as FreshActivityScopeClearance;
  const probe = { getItem: vi.fn(), setItem: vi.fn(), removeItem: vi.fn() } as unknown as Storage;
  expect(() => commitFreshLocalActivityLayout(created.layout, holder, forged, probe)).toThrow('尚未确认为空');
  expect(probe.getItem).not.toHaveBeenCalled();
  expect(probe.setItem).not.toHaveBeenCalled();
  const clearance = await proveFreshActivityScopeUnused(created.layout.id!, originalId);
  commitFreshLocalActivityLayout(created.layout, holder, clearance);
  expect(() => commitFreshLocalActivityLayout(created.layout, holder, clearance)).toThrow('尚未确认为空');
  const again = createLocalActivityBackup(original, '再一张', 'empty');
  localStorage.setItem(STORAGE_KEY, JSON.stringify(again.layout));
  const memory = access(original);
  const againClearance = await proveFreshActivityScopeUnused(again.layout.id!, originalId);
  expect(() => commitFreshLocalActivityLayout(again.layout, memory, againClearance)).toThrow('已是当前保存的活动');
  expect(memory.value).toBe(original);
  expect(parseLayoutJson(localStorage.getItem(STORAGE_KEY)!)?.id).toBe(again.layout.id);
  records.set(address(`${created.layout.id}:brief`), { description: '已有需求' });
  await expect(proveFreshActivityScopeUnused(created.layout.id!, originalId)).rejects.toThrow('已有需求记录');
  records.delete(address(`${created.layout.id}:brief`));
  const withDrawing = createLocalActivityBackup(original, '有图纸编号', 'empty');
  drawings.set(withDrawing.layout.id!, { sources: [{ id: 'img' }] });
  await expect(proveFreshActivityScopeUnused(withDrawing.layout.id!, originalId)).rejects.toThrow('已有图纸资料');
  vi.mocked(readSourceRecord).mockRejectedValueOnce(new Error('读取失败'));
  const unread = createLocalActivityBackup(original, '读失败', 'empty');
  await expect(proveFreshActivityScopeUnused(unread.layout.id!, originalId)).rejects.toThrow('无法确认为空');
  expect(localRestoreAvailable()).toBe(false);
});
