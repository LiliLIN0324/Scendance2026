import type { RoomLayout } from './types';

export const LOCAL_HANDOFF_CLOUD_MESSAGE = '当前草稿包含本地执行信息，暂时不能连接或保存到云项目。请在“场景交付”导出交付包，并使用不含执行信息的草稿连接云端。当前草稿已保留。';

export function hasLocalHandoff(layout: RoomLayout): boolean {
  const layouts = [layout], visited = new Set<RoomLayout>();
  while (layouts.length) {
    const value = layouts.pop()!;
    if (visited.has(value)) continue;
    visited.add(value);
    if (value.eventOperations !== undefined || value.floors.some(floor => floor.items.some(item => item.handoff !== undefined))) return true;
    layouts.push(...(value.designBook?.variants.map(variant => variant.layout) ?? []));
  }
  return false;
}

export function assertNoLocalHandoffCloudTransition(layout: RoomLayout): void {
  if (hasLocalHandoff(layout)) throw new Error(LOCAL_HANDOFF_CLOUD_MESSAGE);
}
