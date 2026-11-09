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
      item.name, item.type,
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
    const key = JSON.stringify([entry.name, entry.type, entry.assetVersionId ?? entry.materialId, entry.source,
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

/** 物件的产生方式与场地结构分开；旧数据缺少记录时不推断。 */
export type ProvenanceBucket = 'ai' | 'human' | 'procedural' | 'structure' | 'unknown';

export function isVenueShellItem(item: Pick<FurnitureItem, 'structuralOpeningId' | 'structuralColumnId' | 'venueEntranceId' | 'wallId' | 'category' | 'type'>): boolean {
  if (isStructuralMarker(item)) return true;
  if (item.category === 'structure') return true;
  return item.type === 'wall' || item.type === 'column' || item.type === 'shell';
}

export function bucketProvenance(item: Pick<FurnitureItem, 'provenance' | 'structuralOpeningId' | 'structuralColumnId' | 'venueEntranceId' | 'wallId' | 'category' | 'type'>): ProvenanceBucket {
  if (isVenueShellItem(item)) return 'structure';
  const source = item.provenance?.source;
  if (source === 'ai' || source === 'human' || source === 'procedural') return source;
  return 'unknown';
}

export interface ProvenanceBreakdown {
  ai: number;
  human: number;
  /** 有记录的系统生成物件。 */
  procedural: number;
  /** 结构标记，不计入布置。 */
  structure: number;
  unknown: number;
  /** 全部布置件，包含来源未知的物件。 */
  deployable: number;
  aiPct: number;
}

export function provenanceBreakdown(items: readonly Pick<FurnitureItem, 'provenance' | 'structuralOpeningId' | 'structuralColumnId' | 'venueEntranceId' | 'wallId' | 'category' | 'type'>[]): ProvenanceBreakdown {
  const counts: Record<ProvenanceBucket, number> = { ai: 0, human: 0, procedural: 0, structure: 0, unknown: 0 };
  for (const item of items) counts[bucketProvenance(item)] += 1;
  const deployable = counts.ai + counts.human + counts.procedural + counts.unknown;
  const aiPct = deployable > 0 ? Math.round((counts.ai / deployable) * 100) : 0;
  return { ...counts, deployable, aiPct };
}

/** 便捷入口：整份布局的 provenance 分桶（跨楼层合并）。 */
export function layoutProvenanceBreakdown(layout: RoomLayout): ProvenanceBreakdown {
  return provenanceBreakdown(layout.floors.flatMap(floor => floor.items));
}
