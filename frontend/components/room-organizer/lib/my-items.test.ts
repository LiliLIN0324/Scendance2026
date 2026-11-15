import { beforeEach, describe, expect, it, vi } from 'vitest';
import { addMyItem, listMyItems, resetMyItemsForTests, subscribeMyItems } from './my-items';
import type { CatalogItem } from './types';

/**
 * 「我的物品」只是本会话清单：导入的 GLB 能在这里被再放一次，刷新即失效。
 * 三条契约：同一条目只留一份、最新的排前面、快照引用只在变化时替换。
 */
const item = (name: string, glbUrl: string): CatalogItem => ({
  name, glbUrl, type: 'glb-asset', materialId: 'asset',
  width: 1, depth: 1, height: 1, price: 0, category: 'decoration', source: 'local_sample',
} as unknown as CatalogItem);

beforeEach(() => { resetMyItemsForTests(); });

describe('我的物品 · 本会话', () => {
  it('导入后能读回来，最新的排最前，同一条不重复', () => {
    addMyItem(item('藤椅', 'local:glb:1'));
    addMyItem(item('木桌', 'local:glb:2'));
    addMyItem(item('藤椅', 'local:glb:1'));
    expect(listMyItems().map(entry => entry.name)).toEqual(['藤椅', '木桌']);
  });

  it('只在真的变了才换快照引用，避免无谓重渲染', () => {
    const before = listMyItems();
    addMyItem(item('藤椅', 'local:glb:1'));
    const after = listMyItems();
    expect(after).not.toBe(before);
    expect(listMyItems()).toBe(after);
  });

  it('订阅者收到通知，退订后不再收到', () => {
    const listener = vi.fn();
    const off = subscribeMyItems(listener);
    addMyItem(item('藤椅', 'local:glb:1'));
    expect(listener).toHaveBeenCalledTimes(1);
    off();
    addMyItem(item('木桌', 'local:glb:2'));
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
