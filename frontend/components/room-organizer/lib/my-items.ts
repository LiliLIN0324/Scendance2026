import type { CatalogItem } from './types';

/**
 * 「我的物品」：本会话导入的 GLB（2026-11-16 与用户对齐的方案 1）。
 *
 * 后端还没有「上传到我的物料库」的通道（`readOutdoorPersonalLibrary` 只读），
 * 所以先把导入的文件留在这一份会话内清单里：物料栏能看到、能反复放进场景。
 * 刷新即失效——这与卡里「仅本次编辑有效」的提示一致，不假装已经入库。
 */
let items: CatalogItem[] = [];
const listeners = new Set<() => void>();
const LIMIT = 40;

export function addMyItem(item: CatalogItem): void {
  items = [item, ...items.filter(existing => existing.glbUrl !== item.glbUrl)].slice(0, LIMIT);
  for (const listener of [...listeners]) listener();
}

/** 快照引用只在内容变化时替换，useSyncExternalStore 才不会无限重渲染。 */
export function listMyItems(): readonly CatalogItem[] {
  return items;
}

export function subscribeMyItems(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function resetMyItemsForTests(): void {
  items = [];
  listeners.clear();
}
