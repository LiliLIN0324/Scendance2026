import {describe,expect,it} from 'vitest';
import {reviewAgentCandidate} from '../supabase/functions/_shared/agent-candidate-review.ts';
import {chair,scene} from './fixtures.ts';
import {sceneSchema} from '../supabase/functions/_shared/domain.ts';

describe('independent complete-candidate geometry review',()=>{
 it('rejects new overlap and increased overlap, but leaves existing conflict unknown',()=>{
  const a={...chair(),position:{x:3,z:3}},b={...chair(),position:{x:3.4,z:3}};
  const existing={...scene(),objects:[a,b]},same=structuredClone(existing);
  expect(reviewAgentCandidate(existing,same,[],true)).toMatchObject({status:'unknown',violations:[],unknown:expect.arrayContaining([expect.objectContaining({code:'EXISTING_OVERLAP'})])});
  const worse=structuredClone(existing);worse.objects[1]!.position.x=3.2;
  expect(reviewAgentCandidate(existing,worse,[],true)).toMatchObject({status:'violated',violations:expect.arrayContaining([expect.objectContaining({code:'WORSENED_OVERLAP'})])});
  const base={...scene(),objects:[a]},added={...base,objects:[a,{...chair(),position:{x:3,z:3}}]};
  expect(reviewAgentCandidate(base,added,[],true)).toMatchObject({status:'violated',violations:expect.arrayContaining([expect.objectContaining({code:'NEW_OVERLAP'})])});
 });
 it('does not treat a carpet under an item as a new hard overlap',()=>{
  const base=scene(),item={...chair(),position:{x:3,z:3}},carpet={...chair(),materialId:'carpet' as const,position:{x:3,z:3}};
  expect(reviewAgentCandidate(base,{...base,objects:[item,carpet]},[],true)).toMatchObject({status:'unknown',violations:[]});
 });
 it('does not assert an existing overlap worsened when one axis improves and another worsens',()=>{
  const a={...chair(),position:{x:3,z:3},elevation:0},b={...chair(),position:{x:3.1,z:3},elevation:0.75};
  const base={...scene(),objects:[a,b]},candidate=structuredClone(base);candidate.objects[1]!.position.x=3.3;candidate.objects[1]!.elevation=0.45;
  expect(reviewAgentCandidate(base,candidate,[],true)).toMatchObject({status:'unknown',violations:[],unknown:expect.arrayContaining([expect.objectContaining({code:'EXISTING_OVERLAP'})])});
 });
 it('rejects boundary changes, lock violations, unselected edits and hidden empty-action edits',()=>{
  const a={...chair(),locked:true},b={...chair(),position:{x:6,z:6}},base={...scene(),objects:[a,b]};
  const locked=structuredClone(base);locked.objects[0]!.position.x=4;
  expect(reviewAgentCandidate(base,locked,[],true).violations).toContainEqual({code:'LOCKED_CHANGED',ids:[a.id]});
  const unselected=structuredClone(base);unselected.objects[1]!.position.x=7;
  expect(reviewAgentCandidate(base,unselected,[a.id],true).violations).toContainEqual({code:'UNSELECTED_CHANGED',ids:[b.id]});
  expect(reviewAgentCandidate(base,unselected,[],false).violations).toContainEqual({code:'UNDECLARED_CHANGE',ids:[]});
  const other=structuredClone(base);other.venue.width=13;
  expect(reviewAgentCandidate(base,other,[],true).violations).toContainEqual({code:'BASE_CHANGED',ids:[]});
 });
 it('permits an empty explanatory response without clearing existing problems',()=>{
  const a=chair(),b={...chair(),position:{...a.position}},base={...scene(),objects:[a,b]};
  expect(reviewAgentCandidate(base,structuredClone(base),[],false)).toMatchObject({status:'unknown',violations:[],unknown:expect.arrayContaining([expect.objectContaining({code:'EXIT_UNKNOWN'}),expect.objectContaining({code:'EGRESS_UNKNOWN'})])});
 });
 it('independently rejects an addition outside the modeled venue',()=>{
  const base=scene(),candidate={...base,objects:[{...chair(),position:{x:20,z:20}}]};
  expect(reviewAgentCandidate(base,candidate,[],true)).toMatchObject({status:'violated',violations:expect.arrayContaining([expect.objectContaining({code:'NEW_OR_WORSENED_OUT_OF_BOUNDS'})])});
 });
 it('enforces explicit retention, without inferring that retaining forbids every movement',()=>{
  const item=chair(),base={...scene(),objects:[item]};
  const removed={...base,objects:[]};
  expect(reviewAgentCandidate(base,removed,[],true,{keepAll:true,keepPositions:false}).violations).toContainEqual({code:'USER_REQUESTED_EXISTING_ITEM_PRESERVED',ids:[item.id]});
  const moved=structuredClone(base);moved.objects[0]!.position.x+=1;
  expect(reviewAgentCandidate(base,moved,[],true,{keepAll:true,keepPositions:false}).violations).toEqual([]);
  expect(reviewAgentCandidate(base,moved,[],true,{keepAll:true,keepPositions:true}).violations).toContainEqual({code:'USER_REQUESTED_EXISTING_POSITION_PRESERVED',ids:[item.id]});
 });
 it('rejects a newly blocked confirmed doorway while keeping egress unknown',()=>{
  const wallId=crypto.randomUUID(),doorId=crypto.randomUUID();
  const base=sceneSchema.parse({...scene(),schemaVersion:2,structure:{walls:[{id:wallId,start:{x:0,z:4},end:{x:12,z:4},thickness:0.2,height:3,kind:'interior',status:'confirmed'}],openings:[{id:doorId,wallId,kind:'door',offset:0,width:1.2,height:2.1,sillHeight:0,status:'confirmed'}],columns:[]},sources:[],dimensions:[]});
  const object={...chair(),position:{x:0.6,z:4}};
  const review=reviewAgentCandidate(base,{...base,objects:[object]},[],true);
  expect(review.violations).toContainEqual({code:'NEW_OR_WORSENED_DOORWAY_OBSTRUCTION',ids:[object.id,doorId]});
  expect(review.unknown).toEqual(expect.arrayContaining([expect.objectContaining({code:'EGRESS_UNKNOWN'})]));
  const existing={...base,objects:[object]};
  expect(reviewAgentCandidate(existing,structuredClone(existing),[],true).unknown).toEqual(expect.arrayContaining([expect.objectContaining({code:'EXISTING_DOORWAY_OBSTRUCTION'})]));
 });
});
