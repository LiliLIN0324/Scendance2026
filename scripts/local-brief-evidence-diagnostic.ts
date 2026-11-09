/** Isolated trial only. Emits field names and fixed categories, never source/model text or values. */
import {briefSlotSchema} from '../supabase/functions/_shared/brief-extract-contract.ts';

const fields=['event','headcount','venueIO','lengthM','widthM','areaM2','layoutMode','timeOfDay','mobilityAssistance','audienceTags'] as const;
export type EvidenceField=typeof fields[number]|'activityNeeds'|'inventoryMentions'|'unhandled'|'materialQueries'|'requirements';
export type EvidenceReason='evidence_not_in_message'|'duplicate_field'|'field_without_value'|'missing_evidence'|'requirement_mismatch';
export interface EvidenceDiagnostic {reason:EvidenceReason;field:EvidenceField;count:number}
const present=(value:unknown)=>value!==undefined&&value!==null&&(!Array.isArray(value)||value.length>0);
const record=(value:unknown):Record<string,unknown>|null=>value!==null&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:null;

/** Called only after the production parser reports MODEL_EVIDENCE_MISMATCH. */
export function diagnoseBriefEvidenceMismatch(input:unknown,message:string):EvidenceDiagnostic|null {
 try {
  const root=record(input);if(!root)return null;
  const raw=record(root.extraction);if(!raw)return null;
  // Match the production parser's legacy null mobility normalization.
  const slots=briefSlotSchema.parse(raw.mobilityAssistance===null?{...raw,mobilityAssistance:undefined}:raw);
  const missingActivity=slots.activityNeeds?.filter(item=>!message.includes(item.evidence)).length??0;
  if(missingActivity)return {reason:'evidence_not_in_message',field:'activityNeeds',count:Math.min(missingActivity,12)};
  const missingInventory=slots.inventoryMentions?.filter(item=>!message.includes(item.evidence)).length??0;
  if(missingInventory)return {reason:'evidence_not_in_message',field:'inventoryMentions',count:Math.min(missingInventory,12)};
  if(!Array.isArray(root.factEvidence)||!Array.isArray(root.unhandled))return null;
  const seen=new Set<string>();
  for(const entry of root.factEvidence){
   const row=record(entry);if(!row||typeof row.key!=='string'||!fields.includes(row.key as typeof fields[number])||typeof row.evidence!=='string')return null;
   const key=row.key as typeof fields[number];
   if(seen.has(key))return {reason:'duplicate_field',field:key,count:1};
   if(!message.includes(row.evidence.trim()))return {reason:'evidence_not_in_message',field:key,count:1};
   seen.add(key);if(!present(slots[key]))return {reason:'field_without_value',field:key,count:1};
  }
  for(const key of fields)if(present(slots[key])&&!seen.has(key))return {reason:'missing_evidence',field:key,count:1};
  const missingUnhandled=root.unhandled.filter(value=>{const row=record(value);return !row||typeof row.evidence!=='string'||!message.includes(row.evidence.trim());}).length;
  if(missingUnhandled)return {reason:'evidence_not_in_message',field:'unhandled',count:Math.min(missingUnhandled,12)};
  if(root.materialQueries!==undefined){
   if(!Array.isArray(root.materialQueries))return null;
   const missingQueries=root.materialQueries.filter(value=>{const row=record(value);return !row||typeof row.evidence!=='string'||!message.includes(row.evidence);}).length;
   if(missingQueries)return {reason:'evidence_not_in_message',field:'materialQueries',count:Math.min(missingQueries,12)};
  }
  const mismatches=slots.requirements?.filter(item=>!seen.has(item.key)||slots[item.key]!==item.value).length??0;
  if(mismatches)return {reason:'requirement_mismatch',field:'requirements',count:Math.min(mismatches,12)};
  return null;
 }catch{return null;}
}
