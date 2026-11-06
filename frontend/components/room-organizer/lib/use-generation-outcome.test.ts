// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { __resetGenerationOutcome, setGenerationOutcome, useGenerationOutcome } from './use-generation-outcome';

beforeEach(() => {
  __resetGenerationOutcome();
});
afterEach(() => {
  __resetGenerationOutcome();
});

describe('useGenerationOutcome', () => {
  it('初始没有账本时返回 null 与空摘要', () => {
    const { result } = renderHook(() => useGenerationOutcome());
    expect(result.current.outcome).toBeNull();
    expect(result.current.summary).toBe('');
  });

  it('挂载前写入的账本，挂载时就能读到', () => {
    setGenerationOutcome({ placed: [{ id: 'a' }], refused: [], skipped: [] });
    const { result } = renderHook(() => useGenerationOutcome());
    expect(result.current.outcome?.placed).toHaveLength(1);
    expect(result.current.summary).toContain('放了 1 件');
  });

  it('挂载后写入的账本会让已挂载的 hook 刷新（此前 useMemo([]) 的真缺陷）', () => {
    const { result } = renderHook(() => useGenerationOutcome());
    expect(result.current.outcome).toBeNull();

    act(() => {
      setGenerationOutcome({
        placed: [{ id: 'a' }, { id: 'b' }],
        refused: [{ item: { id: 'c' }, reason: '压通道', code: 'MAIN_AISLE_BLOCKED' }],
        skipped: [],
      });
    });

    expect(result.current.outcome?.placed).toHaveLength(2);
    expect(result.current.summary).toContain('放了 2 件');
    expect(result.current.summary).toContain('被拒 1 件');
  });

  it('重置后回到 null', () => {
    setGenerationOutcome({ placed: [{ id: 'a' }], refused: [], skipped: [] });
    const { result } = renderHook(() => useGenerationOutcome());
    expect(result.current.outcome).not.toBeNull();

    act(() => {
      __resetGenerationOutcome();
    });
    expect(result.current.outcome).toBeNull();
    expect(result.current.summary).toBe('');
  });

  it('两个 hook 同时挂着时都会被通知', () => {
    const first = renderHook(() => useGenerationOutcome());
    const second = renderHook(() => useGenerationOutcome());

    act(() => {
      setGenerationOutcome({ placed: [{ id: 'a' }], refused: [], skipped: [] });
    });

    expect(first.result.current.outcome?.placed).toHaveLength(1);
    expect(second.result.current.outcome?.placed).toHaveLength(1);
  });
});
