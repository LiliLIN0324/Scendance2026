/**
 * The one grouping rule for a bill of materials. The SQL function
 * `scene_private.bill_of_materials` implements the same key over stored scenes;
 * the agent runner and the delivery export both use this module so a draft and a
 * saved scene cannot report different quantities.
 *
 * Group key: materialId, assetId (normalized), presetNode, size, color, notes and
 * material source. Rows keep first-occurrence order; callers own presentation.
 */
export interface BomSize {
  width: number;
  depth: number;
  height: number;
}

export interface BomObject {
  id: string;
  materialId?: string | null | undefined;
  assetId?: string | null | undefined;
  presetNode?: number | null | undefined;
  size: BomSize;
  color: string;
  notes?: string | null | undefined;
}

export interface BomLookup<T extends BomObject> {
  name(object: T): string;
  /** Resolved material source; absent sources are grouped together as null. */
  source?(object: T): string | null | undefined;
  /** Normalizes asset references (UUID casing) before grouping. */
  assetKey?(assetId: string): string;
}

export interface BomRow<T extends BomObject> {
  materialId: string | null;
  assetId: string | null;
  assetKey: string | null;
  presetNode: number | null;
  name: string;
  size: BomSize;
  color: string;
  notes: string;
  source: string | null;
  quantity: number;
  objects: T[];
  objectIds: string[];
}

export function groupBillOfMaterials<T extends BomObject>(objects: readonly T[], lookup: BomLookup<T>): BomRow<T>[] {
  const rows = new Map<string, BomRow<T>>();
  for (const object of objects) {
    const assetId = object.assetId ?? null;
    const assetKey = assetId ? (lookup.assetKey?.(assetId) ?? assetId) : null;
    const materialId = object.materialId ?? null;
    const presetNode = object.presetNode ?? null;
    const notes = object.notes ?? '';
    const source = lookup.source?.(object) ?? null;
    const key = JSON.stringify([
      materialId, assetKey, presetNode,
      object.size.width, object.size.depth, object.size.height,
      object.color, notes, source,
    ]);
    const prior = rows.get(key);
    if (prior) {
      prior.quantity++;
      prior.objects.push(object);
      prior.objectIds.push(object.id);
      continue;
    }
    rows.set(key, {
      materialId, assetId, assetKey, presetNode, name: lookup.name(object),
      size: object.size, color: object.color, notes, source,
      quantity: 1, objects: [object], objectIds: [object.id],
    });
  }
  return [...rows.values()];
}
