/** Outdoor preview-only proposal contract. Unknown activities never get a generic rectangle template. */
import type { PlanFacility, PlanNode, PlanPoint, PlanZone, PlanRoute } from '../../../../supabase/functions/_shared/site-plan';
import { buildLogicalOutdoorEvent } from './outdoor-event-logic';
type Side = 'N' | 'S' | 'E' | 'W';

/** 「分区/排区域」类说法 → 生成指令；删除分区不劫持（含宾语前置「把分区删了」）。 */
export function matchZoneCommand(text: string): 'auto' | null {
  const trimmed = text.trim();
  if (trimmed.length < 3 || trimmed.length > 60) return null;
  if (/(?:删除|删了|删掉|清空|移除|去掉)/u.test(trimmed) && /分区|区域/u.test(trimmed)) return null;
  if (/分区|排(?:一下)?区域|自动分区|划分(?:一下)?区域|区域规划|布置区域/u.test(trimmed)) return 'auto';
  return null;
}

export interface ZoneEventProposal {
  zones: PlanZone[];
  facilities: PlanFacility[];
  routes?: PlanRoute[];
  nodes?: PlanNode[];
  summary: { zones: number; facilities: number; side: Side; warnings?: string[] };
}

export interface BuildZoneEventInput {
  boundary: PlanPoint[];
  nodes: PlanNode[];
  brief: { event: string | null; guests: number | null };
  existingFacilities?: readonly PlanFacility[];
  existingRoutes?: readonly PlanRoute[];
}

/** Activities must satisfy type/headcount/entry and geometric guards before a preview exists. */
export function buildZoneEventProposal(
  input: BuildZoneEventInput,
  idFactory: () => string = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `z-${Math.random().toString(36).slice(2)}`),
): ZoneEventProposal | null {
  return buildLogicalOutdoorEvent(input, idFactory);
}
