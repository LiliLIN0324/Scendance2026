import libraryAssetIds from '../../../../assets/library/asset-ids.json';
import { canonical } from '../../../../supabase/functions/_shared/domain';
import { eventOperationsSchema, eventOperationTaskSchema, type EventOperations, type EventOperationTask } from '../../../../supabase/functions/_shared/event-operations-contract';
import type { FurnitureItem, RoomLayout } from './types';

export const OPERATION_PHASE_LABELS: Record<EventOperationTask['phase'], string> = {
  preparation: '准备', setup: '布场', event: '活动', teardown: '撤场',
};
export const OPERATION_STATUS_LABELS: Record<EventOperationTask['status'] | 'needs_review', string> = {
  todo: '未开始', doing: '进行中', review: '待核对', accepted: '已完成', needs_review: '需复核',
};

function itemBasis(item: FurnitureItem) {
  const assetId = item.assetId ?? (libraryAssetIds as Record<string, string>)[item.glbUrl ?? ''] ?? null;
  return { id: item.id, type: item.type, materialId: item.materialId ?? null,
    assetId,
    // Without a stable asset identity, even a query change can select a different model.
    ...(!assetId && item.glbUrl ? { unarchivedModelUrl: item.glbUrl } : {}),
    glbNode: item.glbNode ?? null, size: [item.width, item.depth, item.height], color: item.color,
    position: item.position ?? null, rotation: item.rotation ?? 0, elevation: item.elevation ?? 0,
    wallId: item.wallId ?? null, sillHeight: item.sillHeight ?? null, mirrored: item.mirrored ?? false,
    sofaShape: item.sofaShape ?? 'standard', stairsShape: item.stairsShape ?? 'straight', stairsLeadIn: item.stairsLeadIn ?? 0,
    cameraBracket: item.cameraBracket ?? false, wallRotation: item.wallRotation ?? null };
}

/** Local physical references also work for text-only tasks and non-exportable venues. */
export async function operationBasis(layout: RoomLayout, task: EventOperationTask): Promise<string> {
  const all = layout.floors.flatMap(floor => floor.items.map(item => ({ floorId: floor.id, item })));
  const basis = canonical({
    layoutId: layout.id ?? null, dataKind: layout.eventOperations?.dataKind ?? 'unspecified',
    task: { id: task.id, title: task.title.trim(), phase: task.phase,
      plannedStartAt: task.plannedStartAt, plannedEndAt: task.plannedEndAt,
      ownerName: task.ownerName.trim(), contractorName: task.contractorName.trim(), acceptance: task.acceptance.trim(),
      objectIds: [...task.objectIds].sort() },
    venue: { width: layout.width, depth: layout.height, scenePreset: layout.scenePreset ?? null,
      backendVenue: layout.backendVenue ?? null, storedStructure: layout.backendSceneV2?.structure ?? null,
      entrance: layout.entrance ?? null, terrain: layout.terrain ?? null, roof: layout.roof ?? null,
      floors: layout.floors.map(floor => ({ id: floor.id, height: floor.height ?? 3,
        walls: floor.interiorWalls ?? [],
        fixtures: floor.items.filter(item => item.venueEntranceId || item.structuralOpeningId || item.structuralColumnId).map(itemBasis) })) },
    objects: [...task.objectIds].sort().map(id => {
      const found = all.find(entry => entry.item.id === id);
      return found ? { floorId: found.floorId, ...itemBasis(found.item) } : { id, missing: true };
    }),
  });
  if (!globalThis.crypto?.subtle) throw new Error('请使用安全连接或本机浏览器核对活动安排。');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(basis));
  return 'sha256:' + Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function operationReview(layout: RoomLayout, task: EventOperationTask): Promise<{
  status: EventOperationTask['status'] | 'needs_review'; missingObjectIds: string[];
}> {
  const ids = new Set(layout.floors.flatMap(floor => floor.items.map(item => item.id)));
  const missingObjectIds = task.objectIds.filter(id => !ids.has(id));
  const previousReview = task.status === 'accepted' || task.status === 'review' && !!task.reviewedBasis;
  const needsReview = !!missingObjectIds.length || previousReview && task.reviewedBasis !== await operationBasis(layout, task);
  return { status: needsReview ? 'needs_review' : task.status, missingObjectIds };
}

export function createOperation(title: string, phase: EventOperationTask['phase']): EventOperationTask {
  return eventOperationTaskSchema.parse({ id: crypto.randomUUID(), title, phase });
}

/** A template is a fresh rehearsal, never a copy of past results or guessed item assignments. */
export function copyRehearsalOperations(source: EventOperations): EventOperations {
  return eventOperationsSchema.parse({ schemaVersion: 1, dataKind: 'rehearsal',
    tasks: source.tasks.map(task => ({ id: crypto.randomUUID(), title: task.title, phase: task.phase, acceptance: task.acceptance })) });
}

/** Preserve timestamps in the model; only the input view uses the explicit Shanghai clock. */
export function toShanghaiDateTimeInput(value: string | null): string {
  if (value === null) return '';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit',
    day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(date);
  const part = (type: string) => parts.find(entry => entry.type === type)?.value ?? '';
  const milliseconds = date.getUTCMilliseconds();
  return `${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}:${part('second')}${milliseconds ? '.' + String(milliseconds).padStart(3, '0') : ''}`;
}

export function fromShanghaiDateTimeInput(value: string): string | null {
  if (!value) return null;
  // The shared schema validates calendars and ordering; invalid non-empty drafts remain invalid.
  return `${value.length === 16 ? value + ':00' : value}+08:00`;
}
