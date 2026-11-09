import type {BriefMemory,ActivityNeedKind} from './brief-agent';
import type {RoomLayout} from './types';
import {reviewOriginalPreservation} from './original-preservation';

/** A record of dialogue state, not a verified venue fact or safety check. */
export type DialogueFieldStatus='recorded'|'unknown'|'pending'|'conflict'|'unclassified';
export type DialogueField<T>={status:DialogueFieldStatus;value:T|null};
export type DialogueEvent='发布会'|'展览'|'沙龙'|'市集'|'讲座'|'教学'|'会议'|'培训'|'庆典'|'婚礼'|'论坛'|'交流会';
type DialogueComparison='match'|'conflict'|'unknown';
type SizeFields={width:DialogueField<number>;depth:DialogueField<number>;height:DialogueField<number>};
export type DialogueHandoffReference={event?:string|null;guests?:number|null;layout?:RoomLayout};
type PreservationProjection={status:'not_requested'|'recorded'|'conflict'|'unknown';count:number|null;keepPositions:boolean|null};
const preservationIdentity=Symbol('preservationIdentity');
export interface DialogueHandoffSnapshot {
 version:1;source:'current_dialogue';availability:'available'|'unavailable';
 fields:{event:DialogueField<DialogueEvent>;headcount:DialogueField<number>&{strength:'must'|'prefer'|null};venueIO:DialogueField<'indoor'|'outdoor'>;
  lengthM:DialogueField<number>;widthM:DialogueField<number>;areaM2:DialogueField<number>;layoutMode:DialogueField<'dining'|'desk-chair'>;
  checkin:DialogueField<boolean>;rest:DialogueField<boolean>;stage:DialogueField<boolean>;allSeated:DialogueField<boolean>;
  mobility:DialogueField<'needed'|'not_needed'>;peoplePerDesk:DialogueField<number>;seatingSpecs:{desk:SizeFields;chair:SizeFields};
  /** Only the existence of a dialogue mention, never its contents or stock availability. */
  inventoryMention:'present_unverified'|'none_or_unknown';originalPreservation:PreservationProjection};
 comparison:{headcount:DialogueComparison;event:DialogueComparison};
 /** Internal comparison only; never serialized into the exported document. */
 [preservationIdentity]?:string;
}
const events=new Set<string>(['发布会','展览','沙龙','市集','讲座','教学','会议','培训','庆典','婚礼','论坛','交流会']);
const field=<T>(status:DialogueFieldStatus,value:T|null=null):DialogueField<T>=>({status,value});
const sizeFields=():SizeFields=>({width:field('unknown'),depth:field('unknown'),height:field('unknown')});
function empty():DialogueHandoffSnapshot{return {version:1,source:'current_dialogue',availability:'unavailable',fields:{
 event:field('unknown'),headcount:{...field('unknown'),strength:null},venueIO:field('unknown'),lengthM:field('unknown'),widthM:field('unknown'),areaM2:field('unknown'),layoutMode:field('unknown'),
 checkin:field('unknown'),rest:field('unknown'),stage:field('unknown'),allSeated:field('unknown'),mobility:field('unknown'),peoplePerDesk:field('unknown'),seatingSpecs:{desk:sizeFields(),chair:sizeFields()},inventoryMention:'none_or_unknown',originalPreservation:{status:'unknown',count:null,keepPositions:null},
 },comparison:{headcount:'unknown',event:'unknown'}};}
const positive=(value:unknown,max:number):value is number=>typeof value==='number'&&Number.isFinite(value)&&value>0&&value<=max;
const validCount=(value:unknown):value is number=>positive(value,100000)&&Number.isSafeInteger(value);
function eventValue(value:unknown):DialogueEvent|null{return typeof value==='string'&&events.has(value.trim())?value.trim() as DialogueEvent:null;}

/**
 * Whitelist only structured values. Neither source utterances nor internal
 * bindings are returned. An unknown, pending or contradictory value never
 * inherits an older apparently resolved value.
 */
export function projectDialogueHandoff(memory:BriefMemory|null,reference?:DialogueHandoffReference):DialogueHandoffSnapshot {
 const result=empty();
 try{
  if(!memory||typeof memory!=='object'||!memory.zoneNeeds||typeof memory.zoneNeeds!=='object'||!Array.isArray(memory.pendingActivityNeeds)||!Array.isArray(memory.unresolvedActivityNeeds)||(memory.pendingBasicFacts!==undefined&&!Array.isArray(memory.pendingBasicFacts))||(memory.deferredActivityNeeds!==undefined&&!Array.isArray(memory.deferredActivityNeeds)))return result;
  result.availability='available';
  const pendingBasic=memory.pendingBasicFacts??[];
  const basicStatus=(key:string):'pending'|'conflict'|null=>{
   const rows=pendingBasic.filter(row=>row?.key===key);if(!rows.length)return null;
   return new Set(rows.map(row=>JSON.stringify(row.value))).size>1?'conflict':'pending';
  };
  const eventState=basicStatus('event');
  if(eventState)result.fields.event=field(eventState);
  else if(memory.event!==null&&memory.event!==undefined){const event=eventValue(memory.event);result.fields.event=event?field('recorded',event):field('unclassified');}
  const countState=basicStatus('headcount');
  result.fields.headcount=countState?{...field(countState),strength:null}:validCount(memory.headcount)?{...field('recorded',memory.headcount),strength:memory.headcountMode==='must'||memory.headcountMode==='prefer'?memory.headcountMode:null}:{...field('unknown'),strength:null};
  const ioState=basicStatus('venueIO');
  result.fields.venueIO=ioState?field(ioState):memory.venueIO==='indoor'||memory.venueIO==='outdoor'?field('recorded',memory.venueIO):field('unknown');
  for(const [key,max] of [['lengthM',500],['widthM',500],['areaM2',250000]] as const){
   const pending=basicStatus(key);const value=memory[key];
   result.fields[key]=pending?field(pending):memory.scaleNeedsReconfirmation===true?field('unknown'):positive(value,max)?field('recorded',value):field('unknown');
  }
  const layoutPending=basicStatus('layoutMode');
  result.fields.layoutMode=layoutPending?field(layoutPending):memory.layoutModeUnresolved===true&&memory.layoutModeConfirmed===true?field('conflict'):
   memory.layoutModeUnresolved===true||memory.layoutModeConfirmed!==true?field('unknown'):
   memory.layoutMode==='dining'||memory.layoutMode==='desk-chair'?field('recorded',memory.layoutMode):field('unknown');
  const activity=(kind:ActivityNeedKind,old:boolean|null|undefined):DialogueField<boolean>=>{
   const pending=memory.pendingActivityNeeds.filter(item=>item?.kind===kind),unresolved=memory.unresolvedActivityNeeds.includes(kind)||(memory.deferredActivityNeeds??[]).includes(kind);
   if(pending.length&&unresolved||new Set(pending.map(item=>item.value)).size>1)return field('conflict');
   if(pending.length)return field('pending');if(unresolved)return field('unknown');
   return typeof old==='boolean'?field('recorded',old):field('unknown');
  };
  result.fields.checkin=activity('checkin',memory.zoneNeeds.checkin);result.fields.rest=activity('rest',memory.zoneNeeds.rest);
  result.fields.stage=activity('stage',memory.zoneNeeds.stage);result.fields.allSeated=activity('all_seated',memory.allGuestsSeated);
  const mobility=memory.mobilityRequirement?.decision;
  result.fields.mobility=memory.mobilityNeedsClarification===true||mobility==='unknown'?field('unknown'):mobility==='needed'||mobility==='not_needed'?field('recorded',mobility):field('unknown');
  const allocation=memory.localSeatingAllocation;
  result.fields.peoplePerDesk=allocation?.status==='one_per_desk'&&allocation.peoplePerDesk===1?field('recorded',1):
   allocation?.status==='shared_desk'&&Number.isSafeInteger(allocation.peoplePerDesk)&&allocation.peoplePerDesk>1&&allocation.peoplePerDesk<=100?field('recorded',allocation.peoplePerDesk):field('unknown');
  for(const target of ['desk','chair'] as const)for(const axis of ['width','depth','height'] as const){
   const fact=memory.localSeatingSpecs?.[target]?.[axis];result.fields.seatingSpecs[target][axis]=fact?.status==='reported'&&positive(fact.valueM,500)?field('recorded',fact.valueM):field('unknown');
  }
  if(Array.isArray(memory.reportedInventory)&&memory.reportedInventory.some(item=>item&&(item.status==='reported'||item.status==='needs_review')))result.fields.inventoryMention='present_unverified';
  const preservation=memory.originalPreservation;
  if(!preservation)result.fields.originalPreservation={status:'not_requested',count:null,keepPositions:null};
  else {
   const check=reviewOriginalPreservation(preservation,reference?.layout);
   if(check.status==='pass'||check.status==='violated'){
    result.fields.originalPreservation={status:check.status==='violated'?'conflict':'recorded',count:preservation.items.length,keepPositions:preservation.keepPositions};
    // Track original identities and protected attributes without exposing them
    // in JSON or the document. The export still requires the monotonic fence.
    Object.defineProperty(result,preservationIdentity,{value:JSON.stringify([preservation.activityId,preservation.keepPositions,preservation.items]),enumerable:false});
   }
  }
  const refCount=reference?.guests,refEvent=eventValue(reference?.event);
  if(result.fields.headcount.status==='recorded'&&validCount(refCount))result.comparison.headcount=result.fields.headcount.value===refCount?'match':'conflict';
  if(result.fields.event.status==='recorded'&&refEvent)result.comparison.event=result.fields.event.value===refEvent?'match':'conflict';
  return result;
 }catch{return empty();}
}

/** Value comparison only; the caller must additionally use a monotonic revision fence. */
export function sameDialogueHandoff(a:DialogueHandoffSnapshot,b:DialogueHandoffSnapshot):boolean {
 const signature=(snapshot:DialogueHandoffSnapshot)=>{
  const fields=snapshot.fields,parts=(value:DialogueField<unknown>)=>[value.status,value.value];
  return JSON.stringify([snapshot.version,snapshot.source,snapshot.availability,
   parts(fields.event),parts(fields.headcount),fields.headcount.strength,parts(fields.venueIO),parts(fields.lengthM),parts(fields.widthM),parts(fields.areaM2),parts(fields.layoutMode),
   parts(fields.checkin),parts(fields.rest),parts(fields.stage),parts(fields.allSeated),parts(fields.mobility),parts(fields.peoplePerDesk),
   ...(['desk','chair'] as const).flatMap(target=>(['width','depth','height'] as const).map(axis=>parts(fields.seatingSpecs[target][axis]))),fields.inventoryMention,
   fields.originalPreservation.status,fields.originalPreservation.count,fields.originalPreservation.keepPositions,snapshot[preservationIdentity]??null,
   snapshot.comparison.headcount,snapshot.comparison.event]);
 };
 try{return signature(a)===signature(b);}catch{return false;}
}
