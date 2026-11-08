import {describe,expect,it} from 'vitest';
import {G402_OFFICIAL} from './fixtures/g402-official';
import {generateScoredPlans} from './plan-scoring';
describe('G402 official reference without fabricated geometry',()=>{
 it('retains only published capacity and measurements, with unresolved chair and door geometry',()=>{
  expect(G402_OFFICIAL.areaM2).toBe(142);expect(G402_OFFICIAL.classroomReferenceSeats).toBe(81);
  expect(G402_OFFICIAL.classroomSeatsPerTable).toBe(3);expect(G402_OFFICIAL.tableM).toEqual({width:1.8,depth:.6,height:.7});
  expect(G402_OFFICIAL.room.widthM).toBeNull();expect(G402_OFFICIAL.room.depthM).toBeNull();
  expect(G402_OFFICIAL.doors.widthM).toBeNull();expect(G402_OFFICIAL.doors.positionM).toBeNull();
  expect(G402_OFFICIAL.chairM).toBeNull();expect(G402_OFFICIAL.chairPublishedAlternatives.japanese[0]).not.toEqual(G402_OFFICIAL.chairPublishedAlternatives.english[0]);
 });
 it('does not turn absent room dimensions or door positions into a safety pass',()=>{
  const plans=generateScoredPlans([],{targetCapacity:G402_OFFICIAL.classroomReferenceSeats});
  expect(plans.length).toBeGreaterThan(0);
  for(const plan of plans){
   expect(plan.feasibilityStatus).toBe('INSUFFICIENT_INPUT');expect(plan.assurance).toBe('draft_unverified');
   expect(plan.violations).toEqual(expect.arrayContaining([expect.objectContaining({code:'ROOM_SIZE_UNKNOWN',status:'unknown'}),expect.objectContaining({code:'DOOR_UNKNOWN',status:'unknown'})]));
  }
 });
});
