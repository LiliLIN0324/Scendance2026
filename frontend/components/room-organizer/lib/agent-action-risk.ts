import type { SitePlanData } from '../../../../supabase/functions/_shared/site-plan';
import type { RoomLayout } from './types';
import type { AgentActionKind } from './agent-supervision';
import { canonical } from '../../../../supabase/functions/_shared/domain';

export interface AgentActionRisk { kind: AgentActionKind; affectedCount: number; label: string }
const changed = (a: unknown, b: unknown) => JSON.stringify(a) !== JSON.stringify(b);

function entities<T extends { id: string }>(before: readonly T[], after: readonly T[]) {
  const original = new Map(before.map(item => [item.id, item]));
  const next = new Map(after.map(item => [item.id, item]));
  const removed = before.filter(item => !next.has(item.id));
  return { removed, edits: after.filter(item => original.has(item.id) && changed(original.get(item.id), item)),
    count: removed.length + after.filter(item => changed(original.get(item.id), item)).length };
}

/** Risk is derived from the real candidate, not a model-supplied action name or claimed count. */
export function outdoorActionRisk(base: SitePlanData, next: SitePlanData, label = '这版规划'): AgentActionRisk {
  let affectedCount = 0, destructive = false;
  for (const key of ['facilities','zones','routes','nodes','workers','vehicles','annotations','measurements','buildings','levels'] as const) {
    const before = (base[key] ?? []) as readonly { id: string }[];
    const after = (next[key] ?? []) as readonly { id: string }[];
    const diff = entities(before, after);
    affectedCount += diff.count;
    destructive ||= diff.removed.length > 0;
    if ((key === 'buildings' || key === 'levels') && diff.edits.length) destructive = true;
  }
  destructive ||= base.facilities.some(item => {
    const replacement = next.facilities.find(other => other.id === item.id);
    return !!replacement && (item.templateId !== replacement.templateId || item.sourceAssetId !== replacement.sourceAssetId || item.modelOverride !== replacement.modelOverride);
  });
  destructive ||= base.zones.some(item => {
    const replacement = next.zones.find(other => other.id === item.id);
    return !!replacement && changed(item.polygon, replacement.polygon);
  });
  if (changed(base.boundary, next.boundary) || changed(base.anchor, next.anchor)) {
    affectedCount++;
    destructive ||= base.facilities.length + base.zones.length + base.routes.length > 0;
  }
  return { kind: destructive ? 'destructive' : 'write', affectedCount, label };
}

export function layoutActionRisk(base: RoomLayout, next: RoomLayout, label = '这版方案'): AgentActionRisk {
  let affectedCount = 0, destructive = false;
  const floors = entities(base.floors, next.floors);
  destructive ||= floors.removed.length > 0;
  for (const floor of next.floors) {
    const old = base.floors.find(item => item.id === floor.id);
    const items = entities(old?.items ?? [], floor.items);
    const zones = entities(old?.zones ?? [], floor.zones ?? []);
    affectedCount += items.count + zones.count;
    destructive ||= items.removed.length > 0 || zones.removed.length > 0 || zones.edits.length > 0;
    destructive ||= items.edits.some(item => {
      const before = old!.items.find(other => other.id === item.id)!;
      return before.type !== item.type || before.assetId !== item.assetId || before.materialId !== item.materialId || before.glbNode !== item.glbNode;
    });
    if (old && changed(old.interiorWalls, floor.interiorWalls)) { affectedCount++; destructive = true; }
  }
  if (base.width !== next.width || base.height !== next.height) { affectedCount++; destructive = true; }
  if (floors.removed.length) affectedCount += floors.removed.reduce((count, floor) => count + floor.items.length + (floor.zones?.length ?? 0), 0);
  return { kind: destructive ? 'destructive' : 'write', affectedCount, label };
}

/** A supervision preference never grants authority to modify a locked object. */
export function lockedLayoutChange(base: RoomLayout, next: RoomLayout): string | null {
  const fields = ['type','assetId','materialId','glbNode','width','depth','height','position','rotation','elevation','locked','color'] as const;
  for (const floor of base.floors) for (const item of floor.items.filter(item => item.locked)) {
    const replacement = next.floors.find(after => after.id === floor.id)?.items.find(after => after.id === item.id);
    if (!replacement || fields.some(field => canonical(item[field] ?? null) !== canonical(replacement[field] ?? null)))
      return `「${item.name}」已锁定，不能由 Agent 删除、替换或修改；请先手动解除锁定。`;
  }
  return null;
}
