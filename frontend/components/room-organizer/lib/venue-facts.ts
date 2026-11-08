/** Local evidence sidecar. It does not replace or alter the scene API schema. */
export type VenueFactStatus = 'confirmed' | 'pending' | 'inferred' | 'unknown';
export type VenueFactSource = 'venue_plan' | 'site_measurement' | 'user_statement' | 'model_inference' | 'unavailable';
export type VenueFactKey = 'venue_width' | 'venue_depth' | 'door_position' | 'door_width' | 'door_opening_direction' | 'approved_capacity';
export type VenueCheckId = 'dimensions' | 'door_geometry' | 'egress' | 'fire' | 'accessibility' | 'capacity' | 'layout';
export type DoorDirection = 'inward' | 'outward' | 'sliding' | 'other';
export interface VenueFactValues {
  venue_width: number;
  venue_depth: number;
  door_position: { x: number; z: number };
  door_width: number;
  door_opening_direction: DoorDirection;
  approved_capacity: number;
}
export type VenueFactUnit = 'm' | 'm_point' | 'people' | 'direction';
export interface VenueFact<K extends VenueFactKey = VenueFactKey> {
  key: K;
  value: VenueFactValues[K] | null;
  unit: VenueFactUnit;
  source: VenueFactSource;
  status: VenueFactStatus;
  /** Same unit as the value; null means no documented measurement uncertainty. */
  uncertainty: number | null;
  sourceRef: string | null;
  updatedBy: string;
  updatedAt: string;
  revision: number;
  affects: readonly VenueCheckId[];
}
export type VenueFacts = { [K in VenueFactKey]: VenueFact<K> };
export interface VenueFactSet { scope: string; revision: number; facts: VenueFacts }
export type VenueFactChange<K extends VenueFactKey> = Pick<VenueFact<K>, 'value' | 'source' | 'status' | 'uncertainty' | 'sourceRef' | 'updatedBy' | 'updatedAt'>;

const metadata: { [K in VenueFactKey]: { unit: VenueFactUnit; affects: readonly VenueCheckId[] } } = {
  venue_width: {unit:'m',affects:['dimensions','layout','egress','accessibility']},
  venue_depth: {unit:'m',affects:['dimensions','layout','egress','accessibility']},
  door_position: {unit:'m_point',affects:['door_geometry','layout','egress','fire','accessibility']},
  door_width: {unit:'m',affects:['door_geometry','egress','fire','accessibility']},
  door_opening_direction: {unit:'direction',affects:['door_geometry','egress','fire','accessibility']},
  approved_capacity: {unit:'people',affects:['capacity','egress','fire']},
};

/** Absence is explicit; never promote geometry or a confidence score to a verified fact. */
export function emptyVenueFacts(scope: string): VenueFactSet {
  if (!scope.trim()) throw new Error('场地事实需要明确的活动范围。');
  const facts = Object.fromEntries((Object.keys(metadata) as VenueFactKey[]).map(key => [key, {
    key,value:null,unit:metadata[key].unit,source:'unavailable',status:'unknown',uncertainty:null,
    sourceRef:null,updatedBy:'',updatedAt:'',revision:0,affects:[...metadata[key].affects],
  }])) as unknown as VenueFacts;
  return {scope,revision:0,facts};
}

function validValue<K extends VenueFactKey>(key: K, value: VenueFactValues[K]): boolean {
  if (key === 'door_position') {
    const p = value as VenueFactValues['door_position'];
    return !!p && typeof p === 'object' && Number.isFinite(p.x) && Number.isFinite(p.z);
  }
  if (key === 'door_opening_direction') return ['inward','outward','sliding','other'].includes(value as string);
  return typeof value === 'number' && Number.isFinite(value) && value > 0 && (key !== 'approved_capacity' || Number.isSafeInteger(value));
}

/** Validate a deserialized sidecar before using it; invalid records must not be silently reset. */
export function isVenueFactSet(input: unknown): input is VenueFactSet {
  if (!input || typeof input !== 'object') return false;
  const set = input as VenueFactSet;
  if (typeof set.scope !== 'string' || !set.scope.trim() || !Number.isSafeInteger(set.revision) || set.revision < 0 || !set.facts || typeof set.facts !== 'object') return false;
  const keys = Object.keys(metadata) as VenueFactKey[];
  if (Object.keys(set.facts).length !== keys.length) return false;
  return keys.every(key => {
    const fact = set.facts[key];
    if (!fact || fact.key !== key || fact.unit !== metadata[key].unit || !Number.isSafeInteger(fact.revision) || fact.revision < 0 || fact.revision > set.revision) return false;
    if (!Array.isArray(fact.affects) || JSON.stringify(fact.affects) !== JSON.stringify(metadata[key].affects)) return false;
    if (!['confirmed','pending','inferred','unknown'].includes(fact.status) || !['venue_plan','site_measurement','user_statement','model_inference','unavailable'].includes(fact.source)) return false;
    if (fact.sourceRef !== null && (typeof fact.sourceRef !== 'string' || !fact.sourceRef.trim())) return false;
    if (fact.uncertainty !== null && (!Number.isFinite(fact.uncertainty) || fact.uncertainty < 0 || !['m','m_point'].includes(fact.unit))) return false;
    if (typeof fact.updatedBy !== 'string' || typeof fact.updatedAt !== 'string') return false;
    if (fact.revision === 0 && (fact.updatedBy !== '' || fact.updatedAt !== '' || fact.status !== 'unknown')) return false;
    if (fact.revision > 0 && (!fact.updatedBy.trim() || !Number.isFinite(Date.parse(fact.updatedAt)))) return false;
    if (fact.status === 'unknown') return fact.value === null && fact.uncertainty === null && fact.source === 'unavailable';
    return fact.revision > 0 && fact.value !== null && validValue(key, fact.value) && fact.source !== 'unavailable'
      && !(fact.status === 'confirmed' && fact.source === 'model_inference')
      && !(fact.status === 'inferred' && fact.source === 'site_measurement');
  });
}

/** A successful change always advances the set revision, including changing back to an old value. */
export function updateVenueFact<K extends VenueFactKey>(set: VenueFactSet, key: K, change: VenueFactChange<K>, expectedRevision: number): VenueFactSet {
  if (!isVenueFactSet(set)) throw new Error('场地事实记录损坏，请保留原记录并核对。');
  if (expectedRevision !== set.revision || set.revision >= Number.MAX_SAFE_INTEGER) throw new Error('场地事实版本已变化，请重新核对。');
  if (!Object.hasOwn(metadata,key) || !set.scope.trim()) throw new Error('场地事实范围无效。');
  if (!['confirmed','pending','inferred','unknown'].includes(change.status) || !['venue_plan','site_measurement','user_statement','model_inference','unavailable'].includes(change.source)) throw new Error('场地事实来源或状态无效。');
  if (!change.updatedBy.trim() || !Number.isFinite(Date.parse(change.updatedAt))) throw new Error('请记录修改人和时间。');
  if (change.sourceRef !== null && (typeof change.sourceRef !== 'string' || !change.sourceRef.trim())) throw new Error('事实来源引用无效。');
  if (change.uncertainty !== null && (!Number.isFinite(change.uncertainty) || change.uncertainty < 0 || !['m','m_point'].includes(metadata[key].unit))) throw new Error('测量误差无效。');
  if (change.status === 'unknown') {
    if (change.value !== null || change.uncertainty !== null || change.source !== 'unavailable') throw new Error('未知事实不能携带确定值。');
  } else {
    if (change.value === null || !validValue(key, change.value) || change.source === 'unavailable') throw new Error('事实值或来源无效。');
    if (change.status === 'confirmed' && change.source === 'model_inference') throw new Error('模型推测不能直接标为已确认。');
    if (change.status === 'inferred' && change.source === 'site_measurement') throw new Error('现场测量应待人工核对或确认。');
  }
  const revision = set.revision + 1;
  const value = change.value === null ? null : structuredClone(change.value);
  const fact: VenueFact<K> = {key,value,unit:metadata[key].unit,source:change.source,status:change.status,uncertainty:change.uncertainty,
    sourceRef:change.sourceRef,updatedBy:change.updatedBy.trim(),updatedAt:change.updatedAt,revision,affects:[...metadata[key].affects]};
  return {scope:set.scope,revision,facts:{...set.facts,[key]:fact}};
}

/** Deliberately returns only checks affected by a recorded revision, not a safety verdict. */
export function affectedVenueChecks(set: VenueFactSet, afterRevision: number): VenueCheckId[] {
  if (!isVenueFactSet(set)) throw new Error('场地事实记录损坏，请保留原记录并核对。');
  if (!Number.isSafeInteger(afterRevision) || afterRevision < 0 || afterRevision > set.revision) throw new Error('检查版本无效。');
  return [...new Set(Object.values(set.facts).filter(fact => fact.revision > afterRevision).flatMap(fact => [...fact.affects]))];
}
