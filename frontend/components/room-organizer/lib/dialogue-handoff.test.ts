import {describe,expect,it} from 'vitest';
import {initialBriefMemory,type BriefMemory} from './brief-agent';
import {projectDialogueHandoff,sameDialogueHandoff} from './dialogue-handoff';
import {captureOriginalPreservation} from './original-preservation';
import {makeFloor,makeItem,makeLayout} from './__testfixtures__/fixtures';

describe('对话交接的白名单投影',()=>{
 it('keeps structured dialogue values separate from conflicting saved form values',()=>{
  const memory:BriefMemory={...initialBriefMemory(),event:'讲座',headcount:30,headcountMode:'prefer',venueIO:'indoor',lengthM:12,widthM:9,layoutMode:'desk-chair',layoutModeConfirmed:true,
   zoneNeeds:{checkin:false,rest:null,stage:true},allGuestsSeated:true,mobilityRequirement:{decision:'needed',evidence:'private source'},
   localSeatingAllocation:{status:'shared_desk',peoplePerDesk:2,evidence:'private'},localSeatingSpecs:{desk:{width:{status:'reported',valueM:1.8,evidence:'private'}}}};
  const result=projectDialogueHandoff(memory,{event:'论坛',guests:80});
  expect(result).toMatchObject({version:1,source:'current_dialogue',availability:'available',fields:{event:{status:'recorded',value:'讲座'},headcount:{status:'recorded',value:30,strength:'prefer'},venueIO:{status:'recorded',value:'indoor'},lengthM:{status:'recorded',value:12},widthM:{status:'recorded',value:9},layoutMode:{status:'recorded',value:'desk-chair'},checkin:{status:'recorded',value:false},rest:{status:'unknown',value:null},stage:{status:'recorded',value:true},allSeated:{status:'recorded',value:true},mobility:{status:'recorded',value:'needed'},peoplePerDesk:{status:'recorded',value:2},seatingSpecs:{desk:{width:{status:'recorded',value:1.8},height:{status:'unknown',value:null}}}},comparison:{headcount:'conflict',event:'conflict'}});
  expect(JSON.stringify(result)).not.toContain('private');
 });
 it('requires both valid sides to classify comparison and never returns reference text',()=>{
  const memory={...initialBriefMemory(),event:'讲座',headcount:30};
  expect(projectDialogueHandoff(memory,{event:'讲座',guests:30}).comparison).toEqual({event:'match',headcount:'match'});
  const unknown=projectDialogueHandoff(memory,{event:'PRIVATE_CUSTOM_EVENT',guests:null});expect(unknown.comparison).toEqual({event:'unknown',headcount:'unknown'});expect(JSON.stringify(unknown)).not.toContain('PRIVATE_CUSTOM_EVENT');
  expect(projectDialogueHandoff(memory).comparison).toEqual({event:'unknown',headcount:'unknown'});
 });
 it('pending and disputed values take priority over prior recorded values',()=>{
  const memory:BriefMemory={...initialBriefMemory(),event:'讲座',headcount:30,venueIO:'indoor',lengthM:12,widthM:9,layoutMode:'dining',layoutModeConfirmed:true,
   zoneNeeds:{checkin:true,rest:false,stage:true},allGuestsSeated:true,mobilityRequirement:{decision:'needed',evidence:'private'},mobilityNeedsClarification:true,
   pendingBasicFacts:[{key:'headcount',value:40},{key:'lengthM',value:15},{key:'layoutMode',value:'desk-chair'}],pendingActivityNeeds:[{kind:'checkin',value:false,evidence:'private'},{kind:'stage',value:false,evidence:'private'}],unresolvedActivityNeeds:['stage','all_seated'],deferredActivityNeeds:['all_seated']};
  const result=projectDialogueHandoff(memory,{guests:30});
  expect(result.fields.headcount).toEqual({status:'pending',value:null,strength:null});expect(result.comparison.headcount).toBe('unknown');
  expect(result.fields.lengthM).toEqual({status:'pending',value:null});expect(result.fields.layoutMode).toEqual({status:'pending',value:null});
  expect(result.fields.checkin).toEqual({status:'pending',value:null});expect(result.fields.stage).toEqual({status:'conflict',value:null});expect(result.fields.allSeated).toEqual({status:'unknown',value:null});expect(result.fields.mobility).toEqual({status:'unknown',value:null});
 });
 it('keeps conflicting basic facts, stale scale and unconfirmed layout unknown',()=>{
  const memory:BriefMemory={...initialBriefMemory(),headcount:30,lengthM:12,widthM:9,areaM2:108,scaleNeedsReconfirmation:true,layoutMode:'dining',layoutModeConfirmed:true,layoutModeUnresolved:true,pendingBasicFacts:[{key:'headcount',value:20},{key:'headcount',value:40}]};
  const result=projectDialogueHandoff(memory);
  expect(result.fields.headcount).toEqual({status:'conflict',value:null,strength:null});
  expect(result.fields.lengthM.status).toBe('unknown');expect(result.fields.widthM.status).toBe('unknown');expect(result.fields.areaM2.status).toBe('unknown');expect(result.fields.layoutMode.status).toBe('conflict');
 });
 it('does not expose free-form event, inventory, evidence, tokens, source bindings or draft instructions',()=>{
  const secret='SENSITIVE_TEXT_9037';
  const memory:BriefMemory={...initialBriefMemory(),event:secret,reportedInventory:[{evidence:secret,status:'reported'}],venueScaleBasis:secret,venueSourceDigest:secret,localSeatingAllocation:{status:'unknown',peoplePerDesk:null,evidence:secret},pendingGeneration:{command:'first',instruction:secret}};
  const result=projectDialogueHandoff(memory,{event:secret});expect(result.fields.event).toEqual({status:'unclassified',value:null});expect(result.fields.peoplePerDesk).toEqual({status:'unknown',value:null});expect(result.fields.inventoryMention).toBe('present_unverified');expect(JSON.stringify(result)).not.toContain(secret);
 });
 it('only discloses whether unverified inventory was mentioned, including corrections',()=>{
  const empty=projectDialogueHandoff(initialBriefMemory());expect(empty.fields.inventoryMention).toBe('none_or_unknown');
  for(const status of ['reported','needs_review'] as const){const present=projectDialogueHandoff({...initialBriefMemory(),reportedInventory:[{evidence:'80把椅子 PRIVATE_TEXT',status}]});expect(present.fields.inventoryMention).toBe('present_unverified');expect(JSON.stringify(present)).not.toContain('80把');expect(JSON.stringify(present)).not.toContain('PRIVATE_TEXT');expect(sameDialogueHandoff(empty,present)).toBe(false);}
 });
 it('does not treat absent, invalid or unselected specifications as confirmed measurements',()=>{
  const memory:BriefMemory={...initialBriefMemory(),localSeatingSpecs:{chair:{width:{status:'unknown',valueM:null,evidence:'unknown'},depth:{status:'reported',valueM:Number.NaN,evidence:'invalid'}},unselected:{desk:{width:{status:'reported',valueM:2,evidence:'inventory'}}}}};
  const result=projectDialogueHandoff(memory);expect(result.fields.seatingSpecs.chair.width).toEqual({status:'unknown',value:null});expect(result.fields.seatingSpecs.chair.depth).toEqual({status:'unknown',value:null});expect(result.fields.seatingSpecs.desk.width).toEqual({status:'unknown',value:null});
 });
 it('projects original-preservation requirements only for the matching activity, without exporting identities or evidence',()=>{
  const layout=makeLayout({id:'activity-private',floors:[makeFloor({id:'floor-private',items:[makeItem({id:'secret-object',position:{x:1,z:1}})]})]});
  const requirement=captureOriginalPreservation(layout,'保留原有物件',false)!;
  const memory={...initialBriefMemory(),originalPreservation:requirement};
  const result=projectDialogueHandoff(memory,{layout});
  expect(result.fields.originalPreservation).toEqual({status:'recorded',count:1,keepPositions:false});
  expect(JSON.stringify(result)).not.toContain('secret-object');expect(JSON.stringify(result)).not.toContain('保留原有物件');expect(JSON.stringify(result)).not.toContain('activity-private');
  expect(projectDialogueHandoff(memory,{layout:{...layout,id:'activity-other'}}).fields.originalPreservation).toEqual({status:'unknown',count:null,keepPositions:null});
  expect(projectDialogueHandoff(memory).fields.originalPreservation.status).toBe('unknown');
  expect(projectDialogueHandoff(initialBriefMemory(),{layout}).fields.originalPreservation.status).toBe('not_requested');
  const empty=makeLayout({id:'empty-activity',floors:[makeFloor({id:'empty-floor',items:[]})]});
  const emptyMemory={...initialBriefMemory(),originalPreservation:captureOriginalPreservation(empty,'保留原有物件',false)!};
  expect(projectDialogueHandoff(emptyMemory,{layout:empty}).fields.originalPreservation).toEqual({status:'recorded',count:0,keepPositions:false});
  const removed=structuredClone(layout);removed.floors[0]!.items=[];
  expect(projectDialogueHandoff(memory,{layout:removed}).fields.originalPreservation).toEqual({status:'conflict',count:1,keepPositions:false});
  const fixed={...memory,originalPreservation:captureOriginalPreservation(layout,'保留原有物件，位置不变',true)!};
  const moved=structuredClone(layout);moved.floors[0]!.items[0]!.position={x:2,z:1};
  expect(projectDialogueHandoff(fixed,{layout}).fields.originalPreservation).toEqual({status:'recorded',count:1,keepPositions:true});
  expect(projectDialogueHandoff(fixed,{layout:moved}).fields.originalPreservation.status).toBe('conflict');
  expect(sameDialogueHandoff(result,projectDialogueHandoff(fixed,{layout}))).toBe(false);
  const alternate=structuredClone(layout);alternate.floors[0]!.items[0]!.id='another-object';
  const alternateMemory={...initialBriefMemory(),originalPreservation:captureOriginalPreservation(alternate,'保留原有物件',false)!};
  expect(sameDialogueHandoff(result,projectDialogueHandoff(alternateMemory,{layout:alternate}))).toBe(false);
 });
 it('marks absent or unreadable context unavailable and offers deterministic value comparison only',()=>{
  const missing=projectDialogueHandoff(null);expect(missing.availability).toBe('unavailable');expect(missing.fields.checkin).toEqual({status:'unknown',value:null});
  const malformed=projectDialogueHandoff({zoneNeeds:null} as unknown as BriefMemory);expect(malformed.availability).toBe('unavailable');
  const a=projectDialogueHandoff({...initialBriefMemory(),headcount:30}),b=projectDialogueHandoff({...initialBriefMemory(),headcount:30}),c=projectDialogueHandoff({...initialBriefMemory(),headcount:31});expect(sameDialogueHandoff(a,b)).toBe(true);expect(sameDialogueHandoff(a,c)).toBe(false);
  // Unrelated, untrusted fields must not enter the comparison or leave the projection.
  expect(sameDialogueHandoff(a,Object.assign({},b,{unexpected:'PRIVATE_EXTRA'}))).toBe(true);
 });
});
