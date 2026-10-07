// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeLayout } from '../components/room-organizer/lib/__testfixtures__/fixtures';
import { STORAGE_KEY } from '../components/room-organizer/lib/constants';
import { parseLayoutJson } from '../components/room-organizer/lib/persistence';
import { commitLocalRestoreLayout, prepareLocalRestoreLayout } from './local-project-restore';

beforeEach(() => { localStorage.clear(); vi.restoreAllMocks(); });

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
