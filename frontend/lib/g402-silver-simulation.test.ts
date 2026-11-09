import {describe,expect,it} from 'vitest';
import {G402_OFFICIAL} from './fixtures/g402-official';
import {G402_SILVER_SIMULATION as fixture} from './fixtures/g402-silver-simulation';
import {planLocalSharedDeskDraft,type LocalSharedDeskInput} from '../components/room-organizer/lib/local-seating-draft';
import {checkCandidateInventory,type CandidateInventory} from '../components/room-organizer/lib/candidate-inventory';
import {makeLayout} from '../components/room-organizer/lib/__testfixtures__/fixtures';
import {affectedVenueChecks,emptyVenueFacts,updateVenueFact} from '../components/room-organizer/lib/venue-facts';

const scenario:LocalSharedDeskInput={
 floorIndex:0,mode:'two_people_per_desk',count:fixture.activity.headcount,
 desk:{width:fixture.furniture.desk.width,depth:fixture.furniture.desk.depth,height:fixture.furniture.desk.height},
 chair:{width:fixture.furniture.chair.width,depth:fixture.furniture.chair.depth,height:fixture.furniture.chair.height},
 deskChairGap:.1,chairGap:.1,columnGap:.3,rowGap:.5,edgeClearance:.3,
 assumptions:{count:'assumption',deskSize:'assumption',chairSize:'assumption',chairGap:'assumption',deskChairGap:'assumption',columnGap:'assumption',rowGap:'assumption',edgeClearance:'assumption'},
};
function syntheticInventory(chairs:number):CandidateInventory {
 return {origin:'assumption',entries:[
  {name:'课桌（示意）',identity:{kind:'type',value:'desk'},dimensions:scenario.desk,available:fixture.inventory.deskCount},
  {name:'座椅（示意）',identity:{kind:'type',value:'chair'},dimensions:scenario.chair,available:chairs},
 ]};
}
function draft(){
 let nextId=0;
 const room=fixture.venue.explorationRectangle;
 return planLocalSharedDeskDraft(makeLayout({id:fixture.id,width:room.widthM,height:room.depthM}),scenario,()=>`synthetic-${++nextId}`);
}

describe('G402-based fictional silver event fixture',()=>{
 it('preserves source boundaries and leaves doors, actual dimensions and confirmation unknown',()=>{
  expect(fixture.venue.areaM2).toBe(G402_OFFICIAL.areaM2);
  expect(fixture.venue.officialClassroomReferenceSeats).toBe(81);
  expect(fixture.activity).toMatchObject({headcount:30,checkin:'unknown',stage:'unknown',source:'simulation'});
  expect(fixture.venue).toMatchObject({approvedCapacity:null,confirmedByVenue:false,actualWidthM:null,actualDepthM:null,doorPosition:null,doorWidthM:null,doorSwing:null});
  expect(fixture.venue.explorationRectangle.source).toBe('simulation');
  expect(fixture.mockVenueReview).toMatchObject({status:'unknown',isRealConfirmation:false});
  expect(fixture.furniture.openModelReferences.every(item=>item.license==='CC0-1.0'&&item.use==='reference_only_not_imported')).toBe(true);
 });
 it('tests 30 people under explicit synthetic dimensions, without claiming venue safety',()=>{
  const result=draft();
  expect(result).toMatchObject({requested:30,placed:30,placedTables:15,shortfall:0});
  expect(result.layout.floors[0]!.items.filter(item=>item.type==='desk')).toHaveLength(15);
  expect(result.layout.floors[0]!.items.filter(item=>item.type==='chair')).toHaveLength(30);
  expect(result.unknown).toEqual(expect.arrayContaining(['出口位置与用途','消防规范','无障碍要求','场地核定人数','实物规格与可用库存']));
  const inventory=checkCandidateInventory(result.layout,syntheticInventory(fixture.inventory.chairCount));
  expect(inventory.status).toBe('pass');
  expect(inventory.message).toContain('不代表实物可用或现场条件已核验');
 });
 it('reports the simulated five-chair shortage without changing the candidate',()=>{
  const result=draft(),before=structuredClone(result.layout);
  const inventory=checkCandidateInventory(result.layout,syntheticInventory(fixture.inventory.shortChairCount));
  expect(inventory.status).toBe('violated');
  expect(inventory.shortages).toMatchObject([{required:30,available:25,missing:5}]);
  expect(result.layout).toEqual(before);
 });
 it('does not treat missing inventory or a missing actual room scale as verified',()=>{
  const result=draft();
  expect(checkCandidateInventory(result.layout).status).toBe('unknown');
  expect(fixture.venue.actualWidthM).toBeNull();expect(fixture.venue.actualDepthM).toBeNull();
  // With no geometry supplied, the planner must not silently generate into a zero-size room.
  const unknownRoom=makeLayout({id:'synthetic-no-scale',width:0,height:0});
  const noScale=planLocalSharedDeskDraft(unknownRoom,scenario,()=>`never-used`);
  expect(noScale).toMatchObject({placed:0,shortfall:30,limitReason:'incomplete_geometry'});
  expect(noScale.layout.floors[0]!.items).toHaveLength(0);
  // No actual scale may be passed off as confirmed merely because the exploration rectangle exists.
  expect(fixture.venue.explorationRectangle.note).toContain('非场地测量');
 });
 it('treats a simulated review as a user note and invalidates checks when it is withdrawn',()=>{
  const initial=emptyVenueFacts(`activity:${fixture.id}`);
  const mock=updateVenueFact(initial,'door_width',{
   value:fixture.mockVenueReview.syntheticDoorWidthM,source:'user_statement',status:'confirmed',uncertainty:null,
   sourceRef:'仅为合成测试',updatedBy:'模拟核对人员',updatedAt:'2026-11-08T00:00:00.000Z',
  },0);
  expect(fixture.mockVenueReview.isRealConfirmation).toBe(false);
  const withdrawn=updateVenueFact(mock,'door_width',{
   value:null,source:'unavailable',status:'unknown',uncertainty:null,sourceRef:null,
   updatedBy:'模拟核对人员',updatedAt:'2026-11-08T01:00:00.000Z',
  },1);
  expect(withdrawn.facts.door_width).toMatchObject({value:null,status:'unknown',revision:2});
  expect(affectedVenueChecks(withdrawn,1)).toEqual(expect.arrayContaining(['door_geometry','egress','fire','accessibility']));
 });
});
