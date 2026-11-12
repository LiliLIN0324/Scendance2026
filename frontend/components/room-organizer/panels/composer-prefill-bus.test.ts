import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  requestComposerPrefill,
  resetComposerPrefillBusForTests,
  subscribeComposerPrefill,
} from './composer-prefill-bus';

afterEach(() => {
  resetComposerPrefillBusForTests();
});

describe('composer prefill bus', () => {
  it('delivers a trimmed prefill text to every active subscriber', () => {
    const first = vi.fn();
    const second = vi.fn();
    subscribeComposerPrefill(first);
    subscribeComposerPrefill(second);

    requestComposerPrefill('  针对选中的 1 件物料：椅子。把它挪开重叠  ');

    expect(first).toHaveBeenCalledExactlyOnceWith('针对选中的 1 件物料：椅子。把它挪开重叠');
    expect(second).toHaveBeenCalledExactlyOnceWith('针对选中的 1 件物料：椅子。把它挪开重叠');
  });

  it('ignores empty or whitespace-only prefill requests', () => {
    const listener = vi.fn();
    subscribeComposerPrefill(listener);

    requestComposerPrefill('');
    requestComposerPrefill('   ');

    expect(listener).not.toHaveBeenCalled();
  });

  it('stops delivering after the subscriber unsubscribes', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeComposerPrefill(listener);

    requestComposerPrefill('第一条');
    unsubscribe();
    requestComposerPrefill('第二条');

    expect(listener).toHaveBeenCalledExactlyOnceWith('第一条');
  });

  it('does not leak listeners across subscribers', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeComposerPrefill(listener);
    unsubscribe();

    requestComposerPrefill('孤立推送');
    expect(listener).not.toHaveBeenCalled();
  });
});
