import {describe,expect,it} from 'vitest';
import {makeFloor,makeItem,makeLayout} from './__testfixtures__/fixtures';
import {captureOriginalPreservation,isStandalonePreservationInstruction,preservationIntent,reviewOriginalPreservation} from './original-preservation';

const base=()=>makeLayout({id:'activity-a',floors:[makeFloor({id:'floor-1',items:[
 makeItem({id:'desk',type:'desk',position:{x:1,z:2}}),makeItem({id:'plant',type:'plant',position:{x:3,z:4}}),
]})]});
describe('explicit original preservation',()=>{
 it('recognizes explicit all-object preservation without promoting ambiguous or specific targets',()=>{
  expect(preservationIntent('请保留原有物件')).toEqual({keepAll:true,keepPositions:false});
  expect(isStandalonePreservationInstruction('保留原有物件，位置不变')).toBe(true);
  expect(isStandalonePreservationInstruction('不需要保留原有物件')).toBe(true);
  expect(preservationIntent('不需要保留原有物件')).toEqual({keepAll:false,keepPositions:false});
  expect(isStandalonePreservationInstruction('保留原有物件，并增加两把椅子')).toBe(false);
  expect(preservationIntent('是否保留原有物件？')).toBeUndefined();
  expect(preservationIntent('保留舞台')).toBeUndefined();
  expect(preservationIntent('可能保留原有物件')).toBeUndefined();
  expect(preservationIntent('不保留原有物件')).toEqual({keepAll:false,keepPositions:false});
  expect(isStandalonePreservationInstruction('不保留原有物件')).toBe(true);
  expect(preservationIntent('不要保持原有物件')).toBeUndefined();
 });
 it('protects existence while allowing a user-requested recolor or move',()=>{
  const layout=base(),requirement=captureOriginalPreservation(layout,'保留原有物件',false)!;
  const candidate=structuredClone(layout);candidate.floors[0]!.items[0]!.position={x:2,z:2};candidate.floors[0]!.items[1]!.color='#808080';
  expect(reviewOriginalPreservation(requirement,candidate).status).toBe('pass');
  candidate.floors[0]!.items.splice(0,1);
  expect(reviewOriginalPreservation(requirement,candidate)).toMatchObject({status:'violated',message:expect.stringContaining('1 件原物被移除')});
 });
 it('protects floor, position and orientation only when explicitly requested',()=>{
  const layout=base(),requirement=captureOriginalPreservation(layout,'保留原有物件，位置不变',true)!;
  const candidate=structuredClone(layout);candidate.floors[0]!.items[0]!.rotation=0.5;
  expect(reviewOriginalPreservation(requirement,candidate).status).toBe('violated');
  candidate.floors[0]!.items[0]!.rotation=0;delete candidate.floors[0]!.items[0]!.position;
  expect(reviewOriginalPreservation(requirement,candidate).status).toBe('unknown');
 });
 it('names the original id when a locked item changes size, even if the count stays the same',()=>{
  const layout=base();
  layout.floors[0]!.items[0]!.locked=true;
  const requirement=captureOriginalPreservation(layout,'保留原有物件',false)!;
  const candidate=structuredClone(layout);
  candidate.floors[0]!.items[0]!.width=2;
  const review=reviewOriginalPreservation(requirement,candidate);
  expect(review.status).toBe('violated');
  expect(review.message).toContain('desk');
  expect(review.message).toContain('宽度');
 });
 it('does not reuse identities across activities or accept a duplicate ID',()=>{
  const layout=base(),requirement=captureOriginalPreservation(layout,'保留原有物件',false)!;
  expect(reviewOriginalPreservation(requirement,{...layout,id:'activity-b'}).status).toBe('unknown');
  const duplicate=structuredClone(layout);duplicate.floors[0]!.items.push(structuredClone(duplicate.floors[0]!.items[0]!));
  expect(captureOriginalPreservation(duplicate,'保留原有物件',false)).toBeNull();
  expect(reviewOriginalPreservation(requirement,duplicate).status).toBe('unknown');
 });
 it('freezes the baseline when the source object changes later',()=>{
  const layout=base(),requirement=captureOriginalPreservation(layout,'不要移动原有物件',true)!;
  layout.floors[0]!.items[0]!.position={x:5,z:5};
  expect(reviewOriginalPreservation(requirement,layout).status).toBe('violated');
 });
});
