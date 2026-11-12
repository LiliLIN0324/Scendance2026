/**
 * 提案卡分组清单的纯聚合层：把 `proposalDifferences` 产出的带 id 条目，
 * 折成「新增 placed / 挪动 moved / 撤掉 removed」三组可读条目，外加一行工作量摘要。
 *
 * 这里只做数据归组与口径判断，不碰选区、相机与按钮；区域数与耗时在派生不出来时
 * 一律返回 null，由卡片省略，不估编。文案与既有 existingChanges 分工：这里给物件名，
 * 楼层/坐标前后对照仍走 describeExistingChanges。
 */
import type { ProposalDifference } from '../three/proposal-preview';
import { zoneContains } from './zones';
import type { FurnitureItem, RoomLayout } from './types';

/** 与卡片三组一一对应：added=新增，moved=挪动/调整，removed=撤掉。 */
export type ProposalChangeKind = 'added' | 'moved' | 'removed';

export interface ProposalChangeItem {
  id: string;
  kind: ProposalChangeKind;
  /** 物件名；无名兜底「未命名物料」。 */
  label: string;
}

export interface ProposalChangeCounts {
  added: number;
  moved: number;
  removed: number;
}

export interface ProposalChangeSummary {
  /** placed + moved + removed 的改动总数。 */
  total: number;
  /** 涉及的区域数；无 zone 归属数据或没有条目落进任何区域时为 null（省略 M）。 */
  zoneCount: number | null;
  /** 可读的耗时毫秒；提案/会话上没有耗时字段时为 null（省略用时，不造计时器）。 */
  elapsedMs: number | null;
}

/** 无名物料的兜底名，与 proposal-existing-changes 保持同一句。 */
export const UNNAMED_MATERIAL = '未命名物料';

function labelOf(item: FurnitureItem | undefined): string {
  const name = item?.name?.trim();
  return name && name.length > 0 ? name : UNNAMED_MATERIAL;
}

/** ProposalDifference 的 kind 归组：added→added，removed→removed，changed→moved（与 outcome.moved 同口径）。 */
export function proposalChangeItems(differences: readonly ProposalDifference[]): ProposalChangeItem[] {
  return differences.map(change => {
    if (change.kind === 'added') {
      return { id: change.id, kind: 'added' as const, label: labelOf(change.after?.item) };
    }
    if (change.kind === 'removed') {
      return { id: change.id, kind: 'removed' as const, label: labelOf(change.before?.item) };
    }
    const located = change.after ?? change.before;
    return { id: change.id, kind: 'moved' as const, label: labelOf(located?.item) };
  });
}

/** 三组计数；空组为 0，卡片据此决定不渲染该组。 */
export function changeGroupCounts(items: readonly ProposalChangeItem[]): ProposalChangeCounts {
  const counts: ProposalChangeCounts = { added: 0, moved: 0, removed: 0 };
  for (const item of items) counts[item.kind] += 1;
  return counts;
}

/** 按「新增 / 挪动 / 撤掉」拆成三组；顺序固定，空组保留空数组供渲染判断。 */
export function groupChangeItems(items: readonly ProposalChangeItem[]): Record<ProposalChangeKind, ProposalChangeItem[]> {
  const groups: Record<ProposalChangeKind, ProposalChangeItem[]> = { added: [], moved: [], removed: [] };
  for (const item of items) groups[item.kind].push(item);
  return groups;
}

function zoneIdOf(located: ProposalDifference['before'], layout: RoomLayout): string | null {
  if (!located) return null;
  const floor = layout.floors[located.floorIndex];
  const position = located.item.position;
  if (!floor || !position) return null;
  const hit = (floor.zones ?? []).find(zone => zoneContains(zone, position.x, position.z));
  return hit?.id ?? null;
}

/**
 * 改动条目落到的不同区域数。
 * - 基线与候选都没有任何 zone 标注 → null（归属数据缺失，省略 M）；
 * - 有 zone 标注但没有任何条目落进其中 → null（不把「无归属」说成 0 个区域）；
 * - 条目按中心点几何归属（zoneContains），撤掉的条目查基线，新增/调整查候选。
 */
export function proposalZoneCount(
  differences: readonly ProposalDifference[],
  base: RoomLayout,
  candidate: RoomLayout,
): number | null {
  const hasAnyZone = [...base.floors, ...candidate.floors].some(floor => (floor.zones ?? []).length > 0);
  if (!hasAnyZone) return null;
  const matched = new Set<string>();
  for (const change of differences) {
    const zoneId = change.after ? zoneIdOf(change.after, candidate) : zoneIdOf(change.before, base);
    if (zoneId) matched.add(zoneId);
  }
  return matched.size > 0 ? matched.size : null;
}

/** 耗时归一：只接受有限正数；其余（0 / NaN / Infinity / null / undefined）一律 null。 */
function normalizeElapsed(value?: number | null): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.round(value) : null;
}

/**
 * 一行摘要的完整口径：改动 N 处 = 三组计数之和；区域数与耗时按上面的省略条件给 null。
 * `elapsedMs` 由调用方从既有可读字段（run 事件 durationMs 等）传入；读不到就不传。
 */
export function proposalChangeSummary(
  items: readonly ProposalChangeItem[],
  zoneCount: number | null,
  elapsedMs?: number | null,
): ProposalChangeSummary {
  const counts = changeGroupCounts(items);
  return {
    total: counts.added + counts.moved + counts.removed,
    zoneCount,
    elapsedMs: normalizeElapsed(elapsedMs),
  };
}
