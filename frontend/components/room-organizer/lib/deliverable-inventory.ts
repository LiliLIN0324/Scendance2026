/**
 * The single source of truth for deliverable material lists.
 *
 * Every customer-facing or execution-facing list (review packet, delivery CSV,
 * on-site checklist, agent reply) reads rows produced here. Counting happens
 * once; an outlet may only choose which fields it shows.
 */
import assetIds from '../../../../assets/library/asset-ids.json';
import catalogue from '../../../../assets/library/catalogue.json';
import type { FloorLayout, FurnitureItem, RoomLayout } from './types';
import { isStructuralMarker } from './structural-layout';
export type InventoryProcurement = '概念物料，采购待确认' | '规格与采购待确认';

/** One normalised line input. Floor review snapshots can map into this too. */
export interface InventorySourceItem {
  id: string;
  floorId: string;
  floorName: string;
  name: string;
  type: string;
  materialId: string;
  assetVersionId: string | null;
  source: string;
  width: number;
  depth: number;
  height: number;
  color: string;
  zoneId: string | null;
  zoneName: string | null;
  locked: boolean;
  /** Extra spec that must not be merged away (sofa shape, mirror, stair lead-in…). */
  variant?: string;
  /** Display-only note (shape text, spec caveat); never part of the grouping key. */
  note?: string;
  sourceUrl?: string | null;
  license?: string | null;
  sha256?: string | null;
}

/** A counted row: same spec on the same floor+zone. */
export interface InventoryEntry extends InventorySourceItem {
  quantity: number;
  lockedCount: number;
  objectIds: string[];
  procurement: InventoryProcurement;
}

/** Customer view: one row per spec, floors/zones folded into a hint. */
export interface CustomerInventoryRow {
  name: string;
  type: string;
  materialId: string;
  assetVersionId: string | null;
  source: string;
  width: number;
  depth: number;
  height: number;
  color: string;
  variant: string;
  note: string;
  quantity: number;
  floors: string[];
  zones: string[];
  objectIds: string[];
  sourceUrl: string | null;
  license: string | null;
  sha256: string | null;
}

/** Execution view: floor + zone are needed on site, so they stay in the key. */
export type ExecutionInventoryRow = InventoryEntry;

export interface InventorySummaryRow {
  name: string;
  quantity: number;
  lockedCount: number;
}

const publicModels = new Map(
  catalogue.models.map(model => [(assetIds as Record<string, string>)[model.cdnUrl], model]),
);
const license = catalogue.license;

function zoneOf(floor: FloorLayout, item: FurnitureItem) {
  if (!item.position) return { zoneId: null, zoneName: null };
  const zone = (floor.zones ?? []).find(z =>
    item.position!.x >= z.x && item.position!.x <= z.x + z.w &&
    item.position!.z >= z.z && item.position!.z <= z.z + z.d);
  return zone ? { zoneId: zone.id, zoneName: zone.name } : { zoneId: null, zoneName: null };
}

/** Normalise one editable item without counting it. Structural markers never count. */
export function inventoryItemOf(floor: FloorLayout, item: FurnitureItem, variant = ''): InventorySourceItem | null {
  if (isStructuralMarker(item)) return null;
  const assetVersionId = item.assetId ?? (assetIds as Record<string, string>)[item.glbUrl ?? ''] ?? null;
  const publicModel = assetVersionId ? publicModels.get(assetVersionId) : undefined;
  const source = publicModel ? 'public_library' : item.source ?? (assetVersionId ? 'cloud_asset' : 'builtin');
  const { zoneId, zoneName } = zoneOf(floor, item);
  return {
    id: item.id, floorId: floor.id, floorName: floor.name,
    name: item.name, type: item.type, materialId: item.materialId ?? item.type,
    assetVersionId, source, width: item.width, depth: item.depth, height: item.height,
    color: item.color, zoneId, zoneName, locked: item.locked ?? false, variant,
    sourceUrl: publicModel?.pageUrl ?? null, license: publicModel ? license : null,
    sha256: publicModel?.sha256 ?? null,
  };
}

/** Count rows. Insertion order is the canvas order, so exports stay stable. */
export function groupInventory(
  items: readonly InventorySourceItem[],
  options: { acrossFloors?: boolean } = {},
): InventoryEntry[] {
  const groups = new Map<string, InventoryEntry>();
  for (const item of items) {
    const key = JSON.stringify([
      options.acrossFloors ? null : item.floorId,
      item.zoneId,
      item.type,
      item.assetVersionId ?? item.materialId,
      item.source,
      item.width, item.depth, item.height, item.color,
      item.variant ?? '',
    ]);
    const prior = groups.get(key);
    if (prior) {
      prior.quantity += 1;
      prior.objectIds.push(item.id);
      if (item.locked) prior.lockedCount += 1;
      continue;
    }
    groups.set(key, {
      ...item,
      quantity: 1,
      lockedCount: item.locked ? 1 : 0,
      objectIds: [item.id],
      procurement: item.source === 'generated' ? '概念物料，采购待确认' : '规格与采购待确认',
    });
  }
  return [...groups.values()];
}

/** One floor, the shape the on-site checklist and the agent reply need. */
export function floorInventory(floor: FloorLayout): InventoryEntry[] {
  return groupInventory(floor.items.map(item => inventoryItemOf(floor, item)).filter((item): item is InventorySourceItem => item !== null));
}

/** All floors, the execution/customer source list. */
export function deliverableInventory(layout: RoomLayout, options: { floorId?: string } = {}): InventoryEntry[] {
  const floors = options.floorId ? layout.floors.filter(floor => floor.id === options.floorId) : layout.floors;
  return floors.flatMap(floorInventory);
}

/** Customer projection: folds floors/zones together, keeps provenance, drops procurement. */
export function customerInventory(entries: readonly InventoryEntry[]): CustomerInventoryRow[] {
  const rows = new Map<string, CustomerInventoryRow>();
  for (const entry of entries) {
    const key = JSON.stringify([entry.type, entry.assetVersionId ?? entry.materialId, entry.source,
      entry.width, entry.depth, entry.height, entry.color, entry.variant ?? '']);
    const prior = rows.get(key);
    if (prior) {
      prior.quantity += entry.quantity;
      prior.objectIds.push(...entry.objectIds);
      if (!prior.floors.includes(entry.floorName)) prior.floors.push(entry.floorName);
      if (entry.zoneName && !prior.zones.includes(entry.zoneName)) prior.zones.push(entry.zoneName);
      continue;
    }
    rows.set(key, {
      name: entry.name, type: entry.type, materialId: entry.materialId,
      assetVersionId: entry.assetVersionId, source: entry.source,
      width: entry.width, depth: entry.depth, height: entry.height, color: entry.color,
      variant: entry.variant ?? '', note: entry.note ?? '', quantity: entry.quantity,
      floors: [entry.floorName], zones: entry.zoneName ? [entry.zoneName] : [], objectIds: [...entry.objectIds],
      sourceUrl: entry.sourceUrl ?? null, license: entry.license ?? null, sha256: entry.sha256 ?? null,
    });
  }
  return [...rows.values()];
}

/** Name-only summary for the checklist / agent; still counted by the same model. */
export function summarizeInventory(entries: readonly InventoryEntry[]): InventorySummaryRow[] {
  const rows = new Map<string, InventorySummaryRow>();
  for (const entry of entries) {
    const prior = rows.get(entry.name);
    if (prior) {
      prior.quantity += entry.quantity;
      prior.lockedCount += entry.lockedCount;
      continue;
    }
    rows.set(entry.name, { name: entry.name, quantity: entry.quantity, lockedCount: entry.lockedCount });
  }
  return [...rows.values()];
}

export function inventoryTotal(entries: readonly InventoryEntry[]): number {
  return entries.reduce((sum, entry) => sum + entry.quantity, 0);
}

/**
 * 第9批 UI：按 provenance.source 把一件家具归到「AI / 手动 / 场地自带 / 无法识别」四类之一。
 *
 * 归类优先级（从上到下，命中即停）：
 *  1. provenance.source === 'ai'                              → AI 生成件
 *  2. 壳体/结构件（structural marker、墙挂载、structure 类）   → 场地自带（不计入布置）
 *  3. provenance.source === 'procedural'                       → 场地自带
 *  4. provenance.source === 'human'                            → 手动放置
 *  5. 无 provenance 且非壳体                                   → 手动放置（旧布局默认值）
 *  6. provenance.source 出现未识别值                            → 无法识别（兜底，单列末尾）
 *
 * 注意：opId 是技术标识符，不进任何面向用户的计数标签。
 */
export type ProvenanceBucket = 'ai' | 'human' | 'procedural' | 'unknown';

export function isVenueShellItem(item: Pick<FurnitureItem, 'structuralOpeningId' | 'structuralColumnId' | 'venueEntranceId' | 'wallId' | 'category' | 'type'>): boolean {
  if (isStructuralMarker(item)) return true;
  if (item.wallId) return true;
  if (item.category === 'structure') return true;
  return item.type === 'wall' || item.type === 'column' || item.type === 'shell';
}

export function bucketProvenance(item: Pick<FurnitureItem, 'provenance' | 'structuralOpeningId' | 'structuralColumnId' | 'venueEntranceId' | 'wallId' | 'category' | 'type'>): ProvenanceBucket {
  const source = item.provenance?.source;
  if (source === 'ai') return 'ai';
  if (isVenueShellItem(item)) return 'procedural';
  if (source === 'procedural') return 'procedural';
  if (source === 'human') return 'human';
  if (source === undefined || source === null) return 'human'; // 旧布局默认：用户拖放
  return 'unknown'; // provenance 字段存在但 source 未识别（前向兼容兜底）
}

export interface ProvenanceBreakdown {
  /** AI 生成件数。 */
  ai: number;
  /** 手动放置件数（含旧布局无 provenance 的普通家具）。 */
  human: number;
  /** 场地自带/壳体件数（不计入布置）。 */
  procedural: number;
  /** 无法识别件数（单列末尾，需复核）。 */
  unknown: number;
  /** 布置件总数 = ai + human + unknown（不含场地自带）。 */
  deployable: number;
  /** AI 占比 = round(ai / deployable * 100)；deployable 为 0 时为 0。 */
  aiPct: number;
}

/**
 * 对一整层或整份布局的全部家具按 provenance 分桶计数。
 * structural marker（门窗洞口、结构柱、出入口）本身已在 inventoryItemOf 里被过滤，
 * 这里仍按 bucketProvenance 兜底一次，保证调用方直接传 floors[].items 也安全。
 */
export function provenanceBreakdown(items: readonly Pick<FurnitureItem, 'provenance' | 'structuralOpeningId' | 'structuralColumnId' | 'venueEntranceId' | 'wallId' | 'category' | 'type'>[]): ProvenanceBreakdown {
  const counts: Record<ProvenanceBucket, number> = { ai: 0, human: 0, procedural: 0, unknown: 0 };
  for (const item of items) counts[bucketProvenance(item)] += 1;
  const deployable = counts.ai + counts.human + counts.unknown;
  const aiPct = deployable > 0 ? Math.round((counts.ai / deployable) * 100) : 0;
  return { ai: counts.ai, human: counts.human, procedural: counts.procedural, unknown: counts.unknown, deployable, aiPct };
}

/** 便捷入口：整份布局的 provenance 分桶（跨楼层合并）。 */
export function layoutProvenanceBreakdown(layout: RoomLayout): ProvenanceBreakdown {
  return provenanceBreakdown(layout.floors.flatMap(floor => floor.items));
}
