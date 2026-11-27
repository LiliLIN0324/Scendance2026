import { readMaterialCheckins } from '../../../lib/material-checkin-storage';
import type { RoomLayout } from './types';

export const LOCAL_HANDOFF_CLOUD_MESSAGE = '当前草稿包含本地执行信息或制作计划，暂不能作为完整云项目打开或保存。请先保留项目备份。助手的场景连接不会迁移这些资料，当前草稿已保留。';
export const LOCAL_CHECKIN_CLOUD_MESSAGE = '当前项目有本机数量点验账册，暂不能作为完整云项目打开或保存。请先保留项目备份。原账册和场景已保留，点验记录不会迁移或发送给模型。';
export const LOCAL_RECORDS_READ_MESSAGE = '本机点验记录未能完整读取，暂时不能确认云转换不会丢失资料。请先核对本机记录或备份，原场景和资料已保留。';

/**
 * D6-4-5（拍板 4.4）过渡期口径：当前仍扫内嵌 `productionPlan/eventOperations/handoff`
 * 拦转云，判定行为本片不改。e 片剥离内嵌业务副本后，守卫须改认「有未上云的 ref
 * 或本机点验账册」为判定——记录已随云走则不拦；届时再切，不在本片落地。
 */
export function hasLocalHandoff(layout: RoomLayout): boolean {
  const layouts = [layout], visited = new Set<RoomLayout>();
  while (layouts.length) {
    const value = layouts.pop()!;
    if (visited.has(value)) continue;
    visited.add(value);
    if (value.productionPlan !== undefined || value.eventOperations !== undefined || value.floors.some(floor => floor.items.some(item => item.handoff !== undefined))) return true;
    layouts.push(...(value.designBook?.variants.map(variant => variant.layout) ?? []));
  }
  return false;
}

export function assertNoLocalHandoffCloudTransition(layout: RoomLayout): void {
  if (hasLocalHandoff(layout)) throw new Error(LOCAL_HANDOFF_CLOUD_MESSAGE);
}

/** Independent facts are outside RoomLayout and must be read at each asynchronous cloud boundary. */
export async function assertNoLocalRecordsCloudTransition(layout: RoomLayout, projectId?: string): Promise<void> {
  assertNoLocalHandoffCloudTransition(layout);
  const anchorId = projectId?.trim() || layout.id;
  if (!anchorId) return;
  let ledger;
  try { ledger = await readMaterialCheckins(anchorId); }
  catch { throw new Error(LOCAL_RECORDS_READ_MESSAGE); }
  if (ledger !== undefined) throw new Error(LOCAL_CHECKIN_CLOUD_MESSAGE);
}
