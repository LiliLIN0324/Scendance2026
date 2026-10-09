// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { materialCheckinLedgerSchema } from '../../supabase/functions/_shared/material-checkin-contract';
import { productionPlanSchema } from '../../supabase/functions/_shared/production-plan-contract';
import { makeLayout } from '../components/room-organizer/lib/__testfixtures__/fixtures';
import { STORAGE_KEY } from '../components/room-organizer/lib/constants';
import { parseLayoutJson } from '../components/room-organizer/lib/persistence';
import { parseLocalProjectBackupJson, serializeLocalProjectBackup, serializeLocalProjectBackupV3 } from './local-project-backup';
import { commitLocalRestoreLayout, prepareLocalRestoreLayout } from './local-project-restore';
import type { RoomLayout } from '../components/room-organizer/lib/types';

beforeEach(() => { localStorage.clear(); vi.restoreAllMocks(); });
afterEach(() => { vi.unstubAllGlobals(); });

describe('complete local layout restore domain', () => {
  const before = makeLayout({ id: 'activity-a', name: '演练原活动' });
  const next = makeLayout({ id: 'activity-b', name: '演练文件活动', designBook: { activeId: 'file-variant',
    variants: [{ id: 'file-variant', name: '文件方案', layout: makeLayout({ id: 'file-snapshot' }) }] } });
  function access() {
    let value = before;
    return { current: () => value, apply: vi.fn((layout: typeof before) => { value = layout; }), beforeReplace: vi.fn() };
  }
  it('keeps a provided identity and creates one only for a legacy layout without it', () => {
    expect(prepareLocalRestoreLayout(next).id).toBe(next.id);
    const legacy = { ...before }; delete legacy.id;
    const prepared = prepareLocalRestoreLayout(legacy);
    expect(prepared.id).toMatch(/^house-/);
    expect(legacy.id).toBeUndefined();
    expect(prepareLocalRestoreLayout(prepared).id).toBe(prepared.id);
  });
  it('persists and reads the complete candidate before applying without inheriting another design book', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(before));
    const target = access();
    const json = commitLocalRestoreLayout(next, target);
    expect(localStorage.getItem(STORAGE_KEY)).toBe(json);
    expect(parseLayoutJson(json)!.id).toBe(next.id);
    expect(target.current().designBook).toEqual(next.designBook);
    expect(target.beforeReplace).toHaveBeenCalledOnce();
  });
  it('does not apply or touch existing history when storage refuses the write', () => {
    const original = JSON.stringify(before); localStorage.setItem(STORAGE_KEY, original);
    localStorage.setItem('unrelated-history', 'keep');
    const store = { getItem: localStorage.getItem.bind(localStorage), setItem: vi.fn(() => { throw new DOMException('full', 'QuotaExceededError'); }),
      removeItem: localStorage.removeItem.bind(localStorage) } as unknown as Storage;
    const target = access();
    expect(() => commitLocalRestoreLayout(next, target, store)).toThrow(/保存失败/);
    expect(target.apply).not.toHaveBeenCalled(); expect(target.beforeReplace).not.toHaveBeenCalled();
    expect(localStorage.getItem(STORAGE_KEY)).toBe(original);
    expect(localStorage.getItem('unrelated-history')).toBe('keep');
  });
  it('compensates a successful write when the reducer silently refuses the full replacement', () => {
    const original = JSON.stringify(before); localStorage.setItem(STORAGE_KEY, original);
    const target = access(); target.apply.mockImplementation(() => {});
    expect(() => commitLocalRestoreLayout(next, target)).toThrow(/替换未被接受/);
    expect(target.current()).toBe(before); expect(localStorage.getItem(STORAGE_KEY)).toBe(original);
  });
  it('checks layout identity as well as geometry after applying', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(before));
    const target = access();
    target.apply.mockImplementation(layout => { Object.assign(target, { current: () => layout === before ? before : { ...layout, id: 'wrong-scope' } }); });
    expect(() => commitLocalRestoreLayout(next, target)).toThrow(/替换未被接受/);
    expect(target.current()).toBe(before);
    expect(parseLayoutJson(localStorage.getItem(STORAGE_KEY)!)!.id).toBe(before.id);
  });
  it('does not apply an unverified readback and restores the old persisted bytes', () => {
    const original = JSON.stringify(before); localStorage.setItem(STORAGE_KEY, original);
    let reads = 0;
    const store = { getItem: (key: string) => ++reads === 2 ? '{broken' : localStorage.getItem(key),
      setItem: localStorage.setItem.bind(localStorage), removeItem: localStorage.removeItem.bind(localStorage) } as unknown as Storage;
    const target = access();
    expect(() => commitLocalRestoreLayout(next, target, store)).toThrow(/核对不一致/);
    expect(target.apply).not.toHaveBeenCalled(); expect(localStorage.getItem(STORAGE_KEY)).toBe(original);
  });
  it('reports a compensation failure while keeping the previous in-memory layout', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(before));
    const set = localStorage.setItem.bind(localStorage); let writes = 0;
    const store = { getItem: localStorage.getItem.bind(localStorage), setItem: (key: string, value: string) => {
      if (++writes > 1) throw new Error('blocked'); set(key, value);
    }, removeItem: localStorage.removeItem.bind(localStorage) } as unknown as Storage;
    const target = access(); target.apply.mockImplementation(() => {});
    expect(() => commitLocalRestoreLayout(next, target, store)).toThrow(/尚未完整回退/);
    expect(target.current()).toBe(before);
  });
  it('refuses unavailable storage without changing the current layout', () => {
    const target = access();
    expect(() => commitLocalRestoreLayout(next, target, null)).toThrow(/存储不可用/);
    expect(target.apply).not.toHaveBeenCalled();
  });
});

describe('production-plan restore and compensation domain', () => {
  const planning = (amountMinor: number | null, id: string) => productionPlanSchema.parse({
    dataKind: 'rehearsal', budget: { limitMinor: null },
    estimates: [{ id, title: '演练人工估算', amountMinor, basisNote: amountMinor === null ? '' : '手动演练依据',
      taskIds: ['a1000000-0000-4000-8000-000000000001'], objectIds: ['missing-original'] }],
  });
  const before = makeLayout({ id: 'plan-a', productionPlan: planning(null, 'b1000000-0000-4000-8000-000000000001') });
  const next = makeLayout({ id: 'plan-b', productionPlan: planning(0, 'b1000000-0000-4000-8000-000000000002') });
  function trial() {
    const values = new Map<string, string>([[STORAGE_KEY, JSON.stringify(before)]]);
    const storage = { getItem: (key: string) => values.get(key) ?? null,
      setItem: vi.fn((key: string, value: string) => { values.set(key, value); }),
      removeItem: (key: string) => { values.delete(key); } } as unknown as Storage;
    let current: RoomLayout = before;
    const access = { current: () => current, apply: vi.fn((layout: RoomLayout) => { current = layout; }), beforeReplace: vi.fn() };
    return { values, storage, access };
  }
  it('restores and undoes only layout data from V3 without loading or rewriting the separate fact ledger', () => {
    const ledger = materialCheckinLedgerSchema.parse({ projectId: next.id, dataKind: 'rehearsal', sheets: [] });
    const text = serializeLocalProjectBackupV3(next,
      { state: 'ready', scope: next.id!, brief: { status: 'absent' } },
      { state: 'ready', scope: next.id!, materialCheckins: { status: 'present', value: ledger } });
    const candidate = parseLocalProjectBackupJson(text), originalFacts = JSON.stringify(candidate.materialCheckins);
    const sideEffect = vi.fn(() => { throw new Error('layout restore must not open fact storage'); });
    vi.stubGlobal('indexedDB', new Proxy({}, { get: sideEffect })); vi.stubGlobal('fetch', sideEffect);
    const { storage, access } = trial();
    commitLocalRestoreLayout(prepareLocalRestoreLayout(candidate.layout), access, storage);
    commitLocalRestoreLayout(prepareLocalRestoreLayout(before), access, storage);
    expect(access.current()).toEqual(before);
    expect(JSON.stringify(candidate.materialCheckins)).toBe(originalFacts);
    expect(parseLayoutJson(storage.getItem(STORAGE_KEY)!)).not.toHaveProperty('materialCheckins');
    expect(sideEffect).not.toHaveBeenCalled();
  });
  it('restores V2 root/variant plans and undoes by restoring the original plan and stable references', () => {
    const variant = { ...next, designBook: { activeId: 'v1', variants: [{ id: 'v1', name: '文件计划', layout: next }] } };
    const text = serializeLocalProjectBackup(variant, { state: 'ready', scope: next.id!, brief: { status: 'absent' } });
    const restored = prepareLocalRestoreLayout(parseLocalProjectBackupJson(text).layout);
    const { storage, access } = trial();
    commitLocalRestoreLayout(restored, access, storage);
    expect(access.current()).toEqual(variant);
    expect(parseLayoutJson(storage.getItem(STORAGE_KEY)!)!.productionPlan).toEqual(next.productionPlan);
    commitLocalRestoreLayout(prepareLocalRestoreLayout(before), access, storage);
    expect(access.current()).toEqual(before);
    expect(parseLayoutJson(storage.getItem(STORAGE_KEY)!)!.productionPlan!.estimates[0]!.amountMinor).toBeNull();
    expect(access.current().productionPlan!.estimates[0]!.objectIds).toEqual(['missing-original']);
  });
  it('restores an unrecorded plan without inheriting the active plan, then restores it on undo', () => {
    const { storage, access } = trial();
    commitLocalRestoreLayout(makeLayout({ id: 'no-plan' }), access, storage);
    expect(access.current()).not.toHaveProperty('productionPlan');
    expect(parseLayoutJson(storage.getItem(STORAGE_KEY)!)).not.toHaveProperty('productionPlan');
    commitLocalRestoreLayout(before, access, storage);
    expect(access.current().productionPlan).toEqual(before.productionPlan);
  });
  it('rejects illegal planning data before writes, applies or replacement history', () => {
    const { storage, access } = trial();
    const invalid = { ...next, productionPlan: { ...next.productionPlan!, actualPaidMinor: 0 } } as RoomLayout;
    expect(() => prepareLocalRestoreLayout(invalid)).toThrow('制作计划');
    expect(() => commitLocalRestoreLayout(invalid, access, storage)).toThrow('制作计划');
    expect(storage.setItem).not.toHaveBeenCalled(); expect(access.apply).not.toHaveBeenCalled();
    expect(access.beforeReplace).not.toHaveBeenCalled(); expect(access.current()).toBe(before);
    expect(storage.getItem(STORAGE_KEY)).toBe(JSON.stringify(before));
  });
  it('rejects a saved readback that drops only the production plan and preserves the old plan bytes', () => {
    const { storage, access } = trial(); let reads = 0;
    const { productionPlan: _plan, ...dropped } = next;
    const guarded = { ...storage, getItem: (key: string) => ++reads === 2 ? JSON.stringify(dropped) : storage.getItem(key) } as Storage;
    expect(() => commitLocalRestoreLayout(next, access, guarded)).toThrow('核对不一致');
    expect(access.apply).not.toHaveBeenCalled(); expect(access.current().productionPlan).toEqual(before.productionPlan);
    expect(storage.getItem(STORAGE_KEY)).toBe(JSON.stringify(before));
  });
  it('compensates a reducer that drops only the new plan, without losing the original plan or missing references', () => {
    const { storage, access } = trial(); const apply = access.apply.getMockImplementation()!;
    access.apply.mockImplementation(value => {
      if (value.id === next.id) { const { productionPlan: _plan, ...dropped } = value; apply(dropped); }
      else apply(value);
    });
    expect(() => commitLocalRestoreLayout(next, access, storage)).toThrow('替换未被接受');
    expect(access.current()).toEqual(before);
    expect(storage.getItem(STORAGE_KEY)).toBe(JSON.stringify(before));
  });
  it('returns both plan domains to the original after applying a plan and then throwing', () => {
    const { storage, access } = trial(); const apply = access.apply.getMockImplementation()!;
    access.apply.mockImplementation(value => { apply(value); if (value.id === next.id) throw new Error('应用后拒绝'); });
    expect(() => commitLocalRestoreLayout(next, access, storage)).toThrow('保存失败');
    expect(access.current().productionPlan).toEqual(before.productionPlan);
    expect(parseLayoutJson(storage.getItem(STORAGE_KEY)!)!.productionPlan).toEqual(before.productionPlan);
  });
  it('reports compensation storage refusal while preserving the original in-memory plan', () => {
    const { storage, access } = trial(); let writes = 0; const write = storage.setItem.bind(storage);
    const guarded = { ...storage, setItem: (key: string, value: string) => { if (++writes > 1) throw new Error('回退拒绝'); write(key, value); } } as Storage;
    access.apply.mockImplementation(() => {});
    expect(() => commitLocalRestoreLayout(next, access, guarded)).toThrow('尚未完整回退');
    expect(access.current()).toBe(before);
    expect(parseLayoutJson(storage.getItem(STORAGE_KEY)!)!.productionPlan).toEqual(next.productionPlan);
  });
  it('keeps a third-party new saved plan when an apply failure races with a changed save', () => {
    const { storage, access } = trial();
    const thirdParty = makeLayout({ id: 'other-project', productionPlan: planning(100, 'b1000000-0000-4000-8000-000000000003') });
    access.apply.mockImplementation(() => { storage.setItem(STORAGE_KEY, JSON.stringify(thirdParty)); throw new Error('并发变化'); });
    expect(() => commitLocalRestoreLayout(next, access, storage)).toThrow('尚未完整回退');
    expect(access.current()).toBe(before);
    expect(parseLayoutJson(storage.getItem(STORAGE_KEY)!)!.productionPlan).toEqual(thirdParty.productionPlan);
    expect(parseLayoutJson(storage.getItem(STORAGE_KEY)!)!.id).toBe(thirdParty.id);
  });
});
