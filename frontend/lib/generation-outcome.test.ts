import { describe, expect, it } from 'vitest';

import {
  combineOutcomes,
  countByCode,
  emptyOutcome,
  hasOutcomeChanges,
  outcomeSummary,
} from './generation-outcome';
import type { GenerationOutcome, OutcomeEntry } from './generation-outcome';

// 用一种轻量占位 item，避免绑死任何房间组织类型。
interface FakeItem {
  id: string;
}

const item = (id: string): FakeItem => ({ id });

function makeEntry(id: string, code: string, reason: string): OutcomeEntry<FakeItem> {
  return { item: item(id), code, reason };
}

describe('emptyOutcome', () => {
  it('returns an empty ledger carrying the given scope reason', () => {
    const out = emptyOutcome<FakeItem>('NO_SPOT');
    expect(out.placed).toEqual([]);
    expect(out.refused).toEqual([]);
    expect(out.skipped).toEqual([]);
    expect(out.scopeEmpty).toBe('NO_SPOT');
  });
});

describe('outcomeSummary', () => {
  it('lists placed / refused / skipped counts when something was placed', () => {
    const out: GenerationOutcome<FakeItem> = {
      placed: [item('a'), item('b'), item('c')],
      refused: [makeEntry('x', 'OUT_OF_BOUNDS', '越界了')],
      skipped: [makeEntry('y', 'LOCKED', '被锁了')],
    };

    const text = outcomeSummary(out);
    expect(text).toContain('放了 3 件');
    expect(text).toContain('被拒 1 件');
    expect(text).toContain('跳过 1 件');
  });

  it('does not hide removals when a combined outcome also carries an empty reason',()=>{
    const out={placed:[],removed:[item('old')],refused:[],skipped:[],scopeEmpty:'NO_SPOT' as const};
    expect(outcomeSummary(out)).toContain('移除 1 件');
  });

  it('renders a Chinese "nothing placed" line for an empty ledger', () => {
    const out = emptyOutcome<FakeItem>('NO_SPOT');
    expect(outcomeSummary(out)).toBe('本次没放成：全场地找不到合法落点');
  });

  it('does not append refused / skipped suffixes when those buckets are empty', () => {
    const out: GenerationOutcome<FakeItem> = {
      placed: [item('a')],
      refused: [],
      skipped: [],
    };
    expect(outcomeSummary(out)).toBe('放了 1 件');
  });
});

describe('countByCode', () => {
  it('groups entries by their machine code', () => {
    const entries: OutcomeEntry<FakeItem>[] = [
      makeEntry('a', 'OUT_OF_BOUNDS', '越界'),
      makeEntry('b', 'BBOX_OVERLAP', '重叠'),
      makeEntry('c', 'OUT_OF_BOUNDS', '又越界'),
      makeEntry('d', 'LOCKED', '锁定'),
      makeEntry('e', 'OUT_OF_BOUNDS', '再三越界'),
    ];

    expect(countByCode(entries)).toEqual({
      OUT_OF_BOUNDS: 3,
      BBOX_OVERLAP: 1,
      LOCKED: 1,
    });
  });

  it('returns an empty map for no entries', () => {
    expect(countByCode([])).toEqual({});
  });
});

describe('combineOutcomes', () => {
  it('concatenates placed arrays from two non-empty ledgers', () => {
    const a: GenerationOutcome<FakeItem> = {
      placed: [item('a1'), item('a2')],
      refused: [makeEntry('ar', 'OUT_OF_BOUNDS', 'r')],
      skipped: [],
    };
    const b: GenerationOutcome<FakeItem> = {
      placed: [item('b1'), item('b2'), item('b3')],
      refused: [],
      skipped: [makeEntry('bs', 'LOCKED', 's')],
    };

    const merged = combineOutcomes(a, b);
    expect(merged.placed.map((p) => p.id)).toEqual(['a1', 'a2', 'b1', 'b2', 'b3']);
    expect(merged.refused).toHaveLength(1);
    expect(merged.skipped).toHaveLength(1);
    expect(merged.scopeEmpty).toBeUndefined();
  });

  it('drops scopeEmpty once any branch actually placed something', () => {
    const empty = emptyOutcome<FakeItem>('NO_SPOT');
    const nonEmpty: GenerationOutcome<FakeItem> = {
      placed: [item('p')],
      refused: [],
      skipped: [],
    };

    const merged = combineOutcomes(empty, nonEmpty);
    expect(merged.placed).toHaveLength(1);
    expect(merged.scopeEmpty).toBeUndefined();
  });

  it('keeps the latter empty reason when every branch is empty', () => {
    const first = emptyOutcome<FakeItem>('NO_FLOOR');
    const second = emptyOutcome<FakeItem>('NO_SPOT');

    const merged = combineOutcomes(first, second);
    expect(merged.placed).toEqual([]);
    expect(merged.refused).toEqual([]);
    expect(merged.skipped).toEqual([]);
    expect(merged.scopeEmpty).toBe('NO_SPOT');
  });
});

describe('hasOutcomeChanges', () => {
  it('is false for an empty ledger (场地壳体 resize 那条路不该写「本次结果」)', () => {
    expect(hasOutcomeChanges<FakeItem>({ placed: [], refused: [], skipped: [] })).toBe(false);
  });

  it('is true when anything was placed, refused or skipped', () => {
    expect(hasOutcomeChanges<FakeItem>({ placed: [item('a')], refused: [], skipped: [] })).toBe(true);
    expect(hasOutcomeChanges<FakeItem>({ placed: [], refused: [makeEntry('x', 'OUT_OF_BOUNDS', '越界')], skipped: [] })).toBe(true);
    expect(hasOutcomeChanges<FakeItem>({ placed: [], refused: [], skipped: [makeEntry('y', 'LOCKED', '锁着')] })).toBe(true);
  });

  it('只看三个桶，不看 report —— 报告本身不算「动了东西」', () => {
    expect(hasOutcomeChanges<FakeItem>({
      placed: [],
      refused: [],
      skipped: [],
      report: { durationMs: 120 },
    })).toBe(false);
  });
});
