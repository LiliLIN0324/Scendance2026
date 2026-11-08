import {describe,expect,it} from 'vitest';
import {planLocalDeskChairDraft,planLocalSharedDeskDraft,type LocalDeskChairInput,type LocalSharedDeskInput} from './local-seating-draft';
import {reviewLocalSeatingWitness,type LocalSeatingWitness} from './local-seating-witness';
import {revisePlan} from './agent-proposal';
import {makeFloor,makeItem,makeLayout} from './__testfixtures__/fixtures';

const one:LocalDeskChairInput={floorIndex:0,mode:'one_desk_one_chair',count:3,desk:{width:1.2,depth:.6,height:.75},chair:{width:.49,depth:.57,height:.85},deskChairGap:.1,columnGap:.3,rowGap:.5,edgeClearance:.3,assumptions:{count:'user',deskSize:'assumption',chairSize:'assumption',deskChairGap:'assumption',columnGap:'assumption',rowGap:'assumption',edgeClearance:'assumption'}};
const shared:LocalSharedDeskInput={...one,mode:'two_people_per_desk',count:30,chairGap:.1,assumptions:{...one.assumptions,chairGap:'assumption'}};
function ids(){let n=0;return()=>`new-${++n}`;}
function draft(count=30){return planLocalSharedDeskDraft(makeLayout({id:'activity-a',width:20,height:20}),{...shared,count},ids());}
function clone<T>(value:T):T{return structuredClone(value);}

describe('local seating association witness',()=>{
 it('records the exact generated 15 desks and 30 independent chairs without changing the input',()=>{
  const original=makeLayout({id:'activity-a',width:20,height:20,floors:[makeFloor({items:[makeItem({id:'original',position:{x:8,z:8}})]})]});
  const before=clone(original),result=planLocalSharedDeskDraft(original,shared,ids()),witness=result.seatingWitness;
  expect(original).toEqual(before);expect(witness?.groups).toHaveLength(15);
  expect(witness?.groups.every(group=>group.chairs.length===2)).toBe(true);
  expect(new Set(witness?.groups.flatMap(group=>[group.desk.id,...group.chairs.map(chair=>chair.id)])).size).toBe(45);
  expect(reviewLocalSeatingWitness(witness,result.layout)).toMatchObject({status:'intact',intactChairs:30,brokenGroups:0,unknownGroups:0});
 });
 it('reports a removed original desk as a broken original association without assuming overall capacity',()=>{
  const result=draft(),witness=result.seatingWitness!,changed=clone(result.layout),removed=witness.groups[0]!;
  changed.floors[0]!.items=changed.floors[0]!.items.filter(item=>item.id!==removed.desk.id);
  const review=reviewLocalSeatingWitness(witness,changed);
  expect(review).toMatchObject({status:'broken',intactChairs:28,brokenGroups:1,unknownGroups:0});
  expect(review.groups[0]).toMatchObject({deskId:removed.desk.id,chairIds:removed.chairs.map(c=>c.id),status:'broken',reason:'missing_member'});
  // An unrelated replacement desk cannot be silently assigned to the two chairs.
  changed.floors[0]!.items.push(makeItem({id:'replacement',type:'desk',position:{...removed.desk.position},width:removed.desk.width,depth:removed.desk.depth,height:removed.desk.height}));
  expect(reviewLocalSeatingWitness(witness,changed)).toMatchObject({status:'broken',intactChairs:28});
 });
 it('makes a moved or rotated chair and a resized desk unknown, and rechecks exact restoration',()=>{
  const result=draft(),witness=result.seatingWitness!,original=clone(result.layout),changed=clone(original);
  const chair=changed.floors[0]!.items.find(item=>item.id===witness.groups[0]!.chairs[0]!.id)!;chair.position={x:chair.position!.x+.0001,z:chair.position!.z};
  expect(reviewLocalSeatingWitness(witness,changed)).toMatchObject({status:'unknown',intactChairs:28,unknownGroups:1});
  chair.position={x:witness.groups[0]!.chairs[0]!.position.x,z:chair.position!.z};chair.rotation=(chair.rotation??0)+.1;
  expect(reviewLocalSeatingWitness(witness,changed).groups[0]).toMatchObject({status:'unknown',reason:'changed_member'});
  const resized=clone(original);resized.floors[0]!.items.find(item=>item.id===witness.groups[1]!.desk.id)!.width+=.01;
  expect(reviewLocalSeatingWitness(witness,resized)).toMatchObject({status:'unknown',intactChairs:28,unknownGroups:1});
  expect(reviewLocalSeatingWitness(witness,original)).toMatchObject({status:'intact',intactChairs:30});
  const capturedX=witness.groups[0]!.chairs[0]!.position.x;
  const generatedChair=result.layout.floors[0]!.items.find(item=>item.id===witness.groups[0]!.chairs[0]!.id)!;
  generatedChair.position={x:capturedX+1,z:generatedChair.position!.z};
  expect(witness.groups[0]!.chairs[0]!.position.x).toBe(capturedX);
  expect(reviewLocalSeatingWitness(witness,result.layout).status).toBe('unknown');
 });
 it('distinguishes an object moved to another floor from an object removed',()=>{
  const result=draft(2),witness=result.seatingWitness!,changed=clone(result.layout),chairId=witness.groups[0]!.chairs[0]!.id;
  const chair=changed.floors[0]!.items.find(item=>item.id===chairId)!;
  changed.floors[0]!.items=changed.floors[0]!.items.filter(item=>item.id!==chairId);changed.floors.push(makeFloor({id:'upper',items:[chair]}));
  expect(reviewLocalSeatingWitness(witness,changed)).toMatchObject({status:'unknown',unknownGroups:1,brokenGroups:0});
  expect(reviewLocalSeatingWitness(witness,changed).groups[0]?.reason).toBe('wrong_floor');
 });
 it('preserves the final single chair in an odd-sized shared group',()=>{
  const result=draft(31),witness=result.seatingWitness!;
  expect(witness.groups).toHaveLength(16);expect(witness.groups.at(-1)?.chairs).toHaveLength(1);
  expect(reviewLocalSeatingWitness(witness,result.layout)).toMatchObject({status:'intact',intactChairs:31});
 });
 it('records one-per-desk associations too',()=>{
  const result=planLocalDeskChairDraft(makeLayout({id:'activity-a',width:20,height:20}),one,ids());
  expect(result.seatingWitness?.groups).toHaveLength(3);
  expect(reviewLocalSeatingWitness(result.seatingWitness,result.layout)).toMatchObject({status:'intact',intactChairs:3});
 });
 it('fails closed on missing witness, mismatched activity/floor, duplicate IDs or missing positions',()=>{
  const result=draft(2),witness=result.seatingWitness!,other=clone(result.layout);other.id='activity-b';
  expect(reviewLocalSeatingWitness(null,result.layout).status).toBe('unknown');expect(reviewLocalSeatingWitness(witness,other).status).toBe('unknown');
  const otherFloor=clone(result.layout);otherFloor.floors[0]!.id='new-floor';expect(reviewLocalSeatingWitness(witness,otherFloor).status).toBe('unknown');
  const duplicateFloor=clone(result.layout);duplicateFloor.floors.push(makeFloor({id:duplicateFloor.floors[0]!.id,items:[]}));expect(reviewLocalSeatingWitness(witness,duplicateFloor).status).toBe('unknown');
  const duplicate=clone(result.layout);duplicate.floors[0]!.items.push(clone(duplicate.floors[0]!.items[0]!));expect(reviewLocalSeatingWitness(witness,duplicate).status).toBe('unknown');
  const unplaced=clone(result.layout);delete unplaced.floors[0]!.items[0]!.position;expect(reviewLocalSeatingWitness(witness,unplaced).status).toBe('unknown');
  const invalid=clone(witness);invalid.groups[0]!.chairs.push(clone(invalid.groups[0]!.chairs[0]!));expect(reviewLocalSeatingWitness(invalid,result.layout).status).toBe('unknown');
  expect(planLocalSharedDeskDraft(makeLayout({width:20,height:20}),{...shared,count:2},ids()).seatingWitness).toBeNull();
 });
 it('does not infer new pairing, object availability, collision clearance or safety from the witness',()=>{
  const result=draft(2),witness=result.seatingWitness!,changed=clone(result.layout),chair=witness.groups[0]!.chairs[0]!;
  changed.floors[0]!.items.push(makeItem({id:'later-obstacle',position:{...chair.position},width:1,depth:1,height:1}));
  // Other safety/geometry checks must independently reject this collision.
  expect(reviewLocalSeatingWitness(witness,changed)).toMatchObject({status:'intact',intactChairs:2});
  expect(result.unknown).toContain('消防规范');expect(result.unknown).toContain('实物规格与可用库存');
 });
 it('rejects malformed or reused witness members rather than guessing associations',()=>{
  const result=draft(4),witness=clone(result.seatingWitness!) as LocalSeatingWitness;
  witness.groups[1]!.chairs[0]=clone(witness.groups[0]!.chairs[0]!);
  expect(reviewLocalSeatingWitness(witness,result.layout).status).toBe('unknown');
 });
 it('passes generated associations through actual revision and recomputes against the final candidate',()=>{
  const result=draft(),witness=result.seatingWitness!,removedId=witness.groups[0]!.desk.id;
  const revised=revisePlan({base:result.layout,floorIndex:0,ops:[{kind:'remove',itemId:removedId}],seatingWitness:witness});
  expect(revised.applied).toBe(1);expect(revised.seatingWitness).toEqual(witness);expect(revised.seatingWitness).not.toBe(witness);
  expect(revised.seatingReview).toMatchObject({status:'broken',brokenGroups:1,intactChairs:28});
  expect(result.layout.floors[0]!.items.some(item=>item.id===removedId)).toBe(true);
  expect(revised.layouts.at(-1)!.floors[0]!.items.some(item=>item.id===removedId)).toBe(false);
  const restored=reviewLocalSeatingWitness(revised.seatingWitness,result.layout);
  expect(restored).toMatchObject({status:'intact',intactChairs:30});
 });
 it('does not derive a witness for an ordinary or unproven revision',()=>{
  const result=draft(2),chairId=result.seatingWitness!.groups[0]!.chairs[0]!.id;
  const without=revisePlan({base:result.layout,floorIndex:0,ops:[{kind:'remove',itemId:chairId}],seatingWitness:null});
  expect(without.seatingWitness).toBeNull();expect(without.seatingReview?.status).toBe('unknown');
  const legacy=revisePlan({base:result.layout,floorIndex:0,ops:[{kind:'remove',itemId:chairId}]});
  expect(legacy.seatingWitness).toBeUndefined();expect(legacy.seatingReview).toBeUndefined();
 });
});
