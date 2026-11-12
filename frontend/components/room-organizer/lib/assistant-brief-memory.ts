import {isWorkspaceWriteFenceRequired} from '@/lib/workspace-write-fence';
import { z } from 'zod';
import { safeGetItem, safeSetItem } from './safe-storage';
import type { BriefMemory } from './brief-agent';

const KEY = 'scendance.assistant-brief-memory.v1';
const positive = z.number().finite().positive();
const seatingSizeFact=z.object({status:z.enum(['reported','unknown']),valueM:positive.max(50).nullable(),evidence:z.string().min(1).max(200)}).refine(value=>value.status==='reported'?value.valueM!==null:value.valueM===null);
const seatingItem=z.object({width:seatingSizeFact.optional(),depth:seatingSizeFact.optional(),height:seatingSizeFact.optional()});
const memorySchema = z.object({
  originalPreservation:z.object({activityId:z.string().min(1).max(512),evidence:z.string().min(1).max(2000),keepPositions:z.boolean(),items:z.array(z.object({id:z.string().min(1).max(512),floorId:z.string().min(1).max(512),position:z.object({x:z.number().finite(),z:z.number().finite()}).nullable(),rotation:z.number().finite().nullable(),elevation:z.number().finite().nullable()})).max(1000)}).optional(),
  localSeatingAllocation:z.discriminatedUnion('status',[
    z.object({status:z.literal('one_per_desk'),peoplePerDesk:z.literal(1),evidence:z.string().min(1).max(200)}),
    z.object({status:z.literal('shared_desk'),peoplePerDesk:z.number().int().min(2).max(100),evidence:z.string().min(1).max(200)}),
    z.object({status:z.literal('unknown'),peoplePerDesk:z.null(),evidence:z.string().min(1).max(200)}),
  ]).optional(),
  localSeatingSpecs:z.object({desk:seatingItem.optional(),chair:seatingItem.optional(),unselected:z.object({desk:seatingItem.optional(),chair:seatingItem.optional()}).optional(),defaults:z.object({desk:z.string().min(1).max(200).optional(),chair:z.string().min(1).max(200).optional()}).optional(),focus:z.object({targets:z.array(z.enum(['desk','chair'])).min(1).max(2),axes:z.array(z.enum(['width','depth','height'])).min(1).max(3),source:z.enum(['requirement','inventory']).optional()}).optional()}).optional(),
  reportedInventory:z.array(z.object({evidence:z.string().min(1).max(200),status:z.enum(['reported','needs_review'])})).max(50).optional(),
  event: z.string().max(80).nullable(), headcount: z.number().int().positive().max(100000).nullable(),
  headcountMode: z.enum(['must', 'prefer']).nullable(), allGuestsSeated: z.boolean().nullable(),
  mobilityRequirement:z.object({decision:z.enum(['needed','not_needed','unknown']),evidence:z.string().min(1).max(2000)}).optional(), mobilityNeedsClarification:z.boolean().optional(),
  venueIO: z.enum(['indoor', 'outdoor']).nullable(), lengthM: positive.nullable(), widthM: positive.nullable(),
  areaM2: positive.nullable(), venueScaleBasis: z.string().optional(), venueFactToken: z.object({generation:z.string().min(1).max(200),epoch:z.number().int().nonnegative()}).optional(), venueSourceScope: z.string().max(512).optional(), venueSourceDigest: z.string().regex(/^[0-9a-f]{64}$/i).optional(), scaleNeedsReconfirmation: z.boolean().optional(), previousVenueScale: z.object({lengthM:positive.nullable(),widthM:positive.nullable(),areaM2:positive.nullable()}).optional(), layoutMode: z.enum(['dining', 'desk-chair']), seatingShape: z.enum(['ring', 'grid']).optional(), banquetTable: z.object({ shape: z.enum(['round', 'rect']).optional(), width: positive.max(6).optional(), depth: positive.max(6).optional(), peoplePerTable: z.number().int().min(1).max(16).optional(), evidence: z.string().min(1).max(200) }).optional(), layoutModeConfirmed: z.boolean().optional(), layoutModeUnresolved: z.boolean().optional(), eventIntent: z.object({ occasion: z.string().min(1).max(40), awaiting: z.enum(['headcount']).optional() }).optional(), furnishing: z.object({ source: z.literal('select_furnishing'), shape: z.enum(['round', 'rect', 'long']), width: positive.max(6), depth: positive.max(6), material: z.object({ rim: z.literal('wood'), top: z.enum(['linen', 'bare']) }), assetName: z.string().min(1).max(40), chairName: z.string().min(1).max(40), color: z.string().regex(/^#[0-9A-Fa-f]{6}$/), reason: z.string().min(1).max(200) }).optional(), agentVenue: z.object({ lengthM: positive.max(500), widthM: positive.max(500) }).optional(), askedScale: z.boolean(),
  zoneNeeds: z.object({ checkin: z.boolean().nullable(), rest: z.boolean().nullable(), stage: z.boolean().nullable().default(null) }),
  pendingActivityNeeds: z.array(z.object({ kind: z.enum(['checkin', 'rest', 'stage', 'all_seated']), value: z.boolean(), evidence: z.string().min(1).max(200) })).max(4).default([]),
  pendingBasicFacts: z.array(z.object({ key: z.enum(['event', 'headcount', 'venueIO', 'lengthM', 'widthM', 'areaM2', 'timeOfDay', 'layoutMode']), value: z.union([z.string().max(80), z.number().finite()]), requiresRestatement: z.boolean().optional() })).max(8).optional(),
  unresolvedActivityNeeds: z.array(z.enum(['checkin', 'rest', 'stage', 'all_seated'])).max(4).default([]),
  deferredActivityNeeds: z.array(z.enum(['checkin', 'rest', 'stage', 'all_seated'])).max(4).optional(),
});
const storeSchema = z.object({ version: z.literal(1), byId: z.record(z.string(), memorySchema) });
type MemoryStore = z.infer<typeof storeSchema>;

function read(storage?: Storage): MemoryStore | null {
  const raw = safeGetItem(KEY, storage);
  if (raw !== null) {
    try { const result = storeSchema.safeParse(JSON.parse(raw)); return result.success ? result.data : null; }
    catch { return null; }
  }
  return { version: 1, byId: {} };
}

/** Strict readback for an explicitly-created session. A storage error or a
 * malformed store is not evidence that the session has no prior memory. */
export function hasNoStoredBriefForNewSession(id:string,storage?:Storage):boolean {
  try {
    const target=storage??(typeof window==='undefined'?undefined:window.localStorage);
    if(!target)return false;
    const raw=target.getItem(KEY);
    if(raw===null)return true;
    const parsed=storeSchema.safeParse(JSON.parse(raw));
    return parsed.success&&!Object.hasOwn(parsed.data.byId,id);
  } catch { return false; }
}

export function readBriefMemory(id: string, storage?: Storage): BriefMemory | null {
  const memory = read(storage)?.byId[id];
  if (!memory) return null;
  // Legacy candidates lack provenance: require a fresh statement before accepting them.
  return memory.pendingBasicFacts ? { ...memory, pendingBasicFacts: memory.pendingBasicFacts.map(fact => ({ ...fact, requiresRestatement: fact.requiresRestatement ?? true })) } : memory;
}

export function writeBriefMemory(id: string, memory: BriefMemory, storage?: Storage, assertWrite?: () => void): boolean {
  if(isWorkspaceWriteFenceRequired())return false;
  if (!id.trim() || !memorySchema.safeParse(memory).success) return false;
  const store = read(storage);
  if (!store) return false;
  try { assertWrite?.(); } catch { return false; }
  // Keep the exact image-bearing basis only in memory. Persisting the original image here
  // duplicates private data and can exceed the browser quota; a reload requires restatement.
  const basis = memory.venueScaleBasis;
  const omitBasis = typeof basis === 'string' && (basis.length > 16384 || /\"floorPlanImage\"\s*:\s*\"(?:data:|blob:)/i.test(basis));
  const {pendingGeneration:_pendingGeneration,...durableMemory}=memory;
  const persisted = omitBasis ? { ...durableMemory, venueScaleBasis: undefined, scaleNeedsReconfirmation: true } : durableMemory;
  return safeSetItem(KEY, JSON.stringify({ version: 1, byId: { ...store.byId, [id]: persisted } }), storage);
}

/** 与聊天索引同步裁剪，删除聊天后不保留其需求。 */
export function pruneBriefMemories(ids: ReadonlySet<string>, storage?: Storage, assertWrite?: () => void): boolean {
  if(isWorkspaceWriteFenceRequired())return false;
  const store = read(storage);
  if (!store) return false;
  const entries = Object.entries(store.byId).filter(([id]) => ids.has(id));
  if (entries.length === Object.keys(store.byId).length) return true;
  try { assertWrite?.(); } catch { return false; }
  return safeSetItem(KEY, JSON.stringify({ version: 1, byId: Object.fromEntries(entries) }), storage);
}
