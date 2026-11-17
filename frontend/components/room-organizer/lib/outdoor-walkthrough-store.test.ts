import { describe, expect, it } from 'vitest';
import { emptyBook, markSeen } from './outdoor-walkthrough-book';
import {
  WALKTHROUGH_KEY,
  decodeBook,
  encodeBook,
  loadBook,
  saveBook,
  type BookStorage,
} from './outdoor-walkthrough-store';

/**
 * 记录本落盘（轮次 74）：存得准、读得稳、坏了就当没有、存储不可用也不炸。
 */

function fakeStorage(seed: Record<string, string> = {}): BookStorage & { data: Record<string, string> } {
  const data = { ...seed };
  return {
    data,
    getItem: (key) => (key in data ? data[key]! : null),
    setItem: (key, value) => {
      data[key] = value;
    },
  };
}

describe('走查记录本落盘', () => {
  it('存进去再读出来，内容一致（含日期）', () => {
    const book = markSeen(markSeen(emptyBook('2026-11-18 走查第三轮'), 2, 'pass'), 9, 'partial');
    const storage = fakeStorage();
    expect(saveBook(book, { storage })).toBe(true);
    expect(loadBook({ storage })).toEqual(book);
    expect(storage.data[WALKTHROUGH_KEY]).toBeTruthy();
  });

  it('坏 JSON / 空串 / null / 数组都当“没有记录”，不抛错', () => {
    for (const raw of ['{', '', null, undefined, '[1,2,3]', '"pass"', '42']) {
      const book = decodeBook(raw as string | null | undefined);
      expect(book.seen).toEqual({});
      expect('asOf' in book).toBe(false);
    }
  });

  it('非法编号与非法状态被丢掉，合法的留下', () => {
    const raw = JSON.stringify({
      v: 1,
      seen: { 1: 'pass', 12: 'pass', 0: 'pass', 3: 'bogus', 5: 'partial' },
    });
    expect(decodeBook(raw).seen).toEqual({ 1: 'pass', 5: 'partial' });
  });

  it('版本不对就不认（避免旧格式被当成新结果）', () => {
    expect(decodeBook(JSON.stringify({ v: 2, seen: { 1: 'pass' } })).seen).toEqual({});
    expect(decodeBook(JSON.stringify({ seen: { 1: 'pass' } })).seen).toEqual({});
  });

  it('日期空白不写进存储', () => {
    const raw = encodeBook({ asOf: '   ', seen: { 4: 'partial' } });
    expect(JSON.parse(raw).asOf).toBeUndefined();
    expect(decodeBook(raw)).toEqual({ seen: { 4: 'partial' } });
  });

  it('存储写入抛错时返回 false，绝不把异常丢给事件处理', () => {
    const storage: BookStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error('quota exceeded');
      },
    };
    expect(saveBook(emptyBook(), { storage })).toBe(false);
    const readThrows: BookStorage = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {},
    };
    expect(loadBook({ storage: readThrows }).seen).toEqual({});
  });

  it('没有可用存储（无 window / 被禁用）时，存返回 false、读返回空', () => {
    // Node 环境没有 window：默认存储拿不到。
    expect(saveBook(emptyBook())).toBe(false);
    expect(loadBook().seen).toEqual({});
  });

  it('存的是“看了哪几条”，不是结论：记录为空时读回来仍然 0 条', () => {
    const storage = fakeStorage();
    saveBook(emptyBook(), { storage });
    expect(Object.keys(loadBook({ storage }).seen)).toHaveLength(0);
  });
});
