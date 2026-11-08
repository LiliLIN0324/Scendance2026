/** Original values from older saved records, with no inference about their authorship. */
export interface LegacyBriefRecord { event?: string | undefined; guests?: number | undefined; allowIdeas?: boolean | undefined }

/** Call on the raw stored object, before merging UI defaults. Missing confirmation is not consent. */
export function captureLegacyBriefRecord(value: unknown): LegacyBriefRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const source=value as Record<string,unknown>;
  const existing=source.legacyBriefRecord;
  const record:LegacyBriefRecord = {};
  if(existing && typeof existing==='object' && !Array.isArray(existing)){
    const old=existing as Record<string,unknown>;
    if(typeof old.event==='string')record.event=old.event;
    if(typeof old.guests==='number'&&Number.isFinite(old.guests))record.guests=old.guests;
    if(typeof old.allowIdeas==='boolean')record.allowIdeas=old.allowIdeas;
  }
  if (source.eventConfirmed === undefined && record.event === undefined && typeof source.event === 'string') record.event=source.event;
  if (source.guestsConfirmed === undefined && record.guests === undefined && typeof source.guests === 'number' && Number.isFinite(source.guests)) record.guests=source.guests;
  if (source.ideasConfirmed === undefined && record.allowIdeas === undefined && typeof source.allowIdeas === 'boolean') record.allowIdeas=source.allowIdeas;
  return Object.keys(record).length ? record : null;
}

/** Explicit false may be a user entry or an old default; record it without guessing which. */
export function captureUnconfirmedSavedBrief(value: unknown): LegacyBriefRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const source=value as Record<string,unknown>, existing=source.unconfirmedSavedBrief;
  const legacy=source.legacyBriefRecord && typeof source.legacyBriefRecord==='object' && !Array.isArray(source.legacyBriefRecord) ? source.legacyBriefRecord as Record<string,unknown> : {};
  const record:LegacyBriefRecord={};
  if(existing && typeof existing==='object' && !Array.isArray(existing)){
    const old=existing as Record<string,unknown>;
    if(typeof old.event==='string')record.event=old.event;
    if(typeof old.guests==='number'&&Number.isFinite(old.guests))record.guests=old.guests;
    if(typeof old.allowIdeas==='boolean')record.allowIdeas=old.allowIdeas;
  }
  if(source.eventConfirmed===false && record.event===undefined && typeof source.event==='string' && !Object.is(legacy.event,source.event))record.event=source.event;
  if(source.guestsConfirmed===false && record.guests===undefined && typeof source.guests==='number' && Number.isFinite(source.guests) && !Object.is(legacy.guests,source.guests))record.guests=source.guests;
  if(source.ideasConfirmed===false && record.allowIdeas===undefined && typeof source.allowIdeas==='boolean' && !Object.is(legacy.allowIdeas,source.allowIdeas))record.allowIdeas=source.allowIdeas;
  return Object.keys(record).length ? record : null;
}

/** Pure preparation only: caller must persist and read back under its transactional guard before editing. */
export function prepareLegacyBriefPreservation<T extends object>(stored:T): T & { legacyBriefRecord?: LegacyBriefRecord; unconfirmedSavedBrief?: LegacyBriefRecord } {
  const record=captureLegacyBriefRecord(stored),unconfirmed=captureUnconfirmedSavedBrief(stored);
  return {...stored,...(record?{legacyBriefRecord:record}:{}),...(unconfirmed?{unconfirmedSavedBrief:unconfirmed}:{})};
}

/** Fail closed unless every original value has actually been read back unchanged. */
export function hasPreservedLegacyBrief(original:unknown, readback:unknown): boolean {
  const records = [['legacyBriefRecord',captureLegacyBriefRecord(original)],['unconfirmedSavedBrief',captureUnconfirmedSavedBrief(original)]] as const;
  if (!records.some(([,record])=>record)) return true;
  if (!readback || typeof readback!=='object' || Array.isArray(readback)) return false;
  return records.every(([name,wanted])=>{
    if(!wanted)return true;
    const actual=(readback as Record<string,unknown>)[name];
    return !!actual && typeof actual==='object' && !Array.isArray(actual) &&
      Object.entries(wanted).every(([key,value])=>Object.is((actual as Record<string,unknown>)[key],value));
  });
}
