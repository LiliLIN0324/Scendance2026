import type { EventOperations } from '../../../../supabase/functions/_shared/event-operations-contract';
import type { ProductionPlan } from '../../../../supabase/functions/_shared/production-plan-contract';
import type { RoomLayout } from './types';

/**
 * Business documents travel with the scene in one persisted tree, but they are
 * edited on their own timeline: confirming a production plan must not sit on
 * the same undo step as a sofa drag, and undoing a drag must not roll the
 * plan back. History therefore records them as a separate lane.
 */
export interface LayoutDocs {
  productionPlan: ProductionPlan | undefined;
  eventOperations: EventOperations | undefined;
  designBook: RoomLayout['designBook'];
}

/** One undo entry: only the lanes the change touched, holding their prior value. */
export interface LayoutLaneSnapshot {
  scene?: RoomLayout;
  docs?: LayoutDocs;
}

const DOC_KEYS = ['productionPlan', 'eventOperations', 'designBook'] as const;

export function layoutDocsOf(layout: RoomLayout): LayoutDocs {
  return {
    productionPlan: layout.productionPlan,
    eventOperations: layout.eventOperations,
    designBook: layout.designBook,
  };
}

/** Writes `docs` over `layout`; a missing document is removed, not kept. */
export function withLayoutDocs(layout: RoomLayout, docs: LayoutDocs): RoomLayout {
  const next: RoomLayout = { ...layout };
  for (const key of DOC_KEYS) {
    const value = docs[key];
    if (value === undefined) delete next[key];
    else (next as unknown as Record<string, unknown>)[key] = value;
  }
  return next;
}

/**
 * The scene a proposal or snapshot carries, with the store's current business
 * documents put back on top. AI and scene-only snapshots must never overwrite
 * work the user did in the production / operations panels.
 */
export function sceneWithCurrentDocs(scene: RoomLayout, current: RoomLayout): RoomLayout {
  return withLayoutDocs(scene, layoutDocsOf(current));
}

function field(layout: RoomLayout, key: string): unknown {
  return (layout as unknown as Record<string, unknown>)[key];
}

function sceneChanged(prev: RoomLayout, next: RoomLayout): boolean {
  if (prev === next) return false;
  const keys = new Set([...Object.keys(prev), ...Object.keys(next)]);
  for (const key of keys) {
    if ((DOC_KEYS as readonly string[]).includes(key)) continue;
    if (!Object.is(field(prev, key), field(next, key))) return true;
  }
  return false;
}

function docsChanged(prev: RoomLayout, next: RoomLayout): boolean {
  return DOC_KEYS.some((key) => !Object.is(prev[key], next[key]));
}

/**
 * The lanes that differ between two layouts, valued from `side`. A commit
 * records the prior side; an undo's redo counterpart records the next side.
 * Null when nothing differs.
 */
export function captureChangedLanes(prev: RoomLayout, next: RoomLayout, side: 'prev' | 'next'): LayoutLaneSnapshot | null {
  const source = side === 'prev' ? prev : next;
  const scene = sceneChanged(prev, next);
  const docs = docsChanged(prev, next);
  if (!scene && !docs) return null;
  return {
    ...(scene ? { scene: source } : {}),
    ...(docs ? { docs: layoutDocsOf(source) } : {}),
  };
}

/** Replays an entry over the current layout, touching only the lanes it carries. */
export function mergeLayoutLaneSnapshot(current: RoomLayout, snapshot: LayoutLaneSnapshot): RoomLayout {
  let next = current;
  if (snapshot.scene) next = sceneWithCurrentDocs(snapshot.scene, current);
  if (snapshot.docs) next = withLayoutDocs(next, snapshot.docs);
  return next;
}

/**
 * The entry that would walk `entry` back once it has been applied over
 * `current`: same lanes, the values they held before the walk.
 */
export function invertLaneSnapshot(entry: LayoutLaneSnapshot, current: RoomLayout): LayoutLaneSnapshot {
  return {
    ...(entry.scene ? { scene: current } : {}),
    ...(entry.docs ? { docs: layoutDocsOf(current) } : {}),
  };
}
