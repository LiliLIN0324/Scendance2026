import {describe,expect,it} from 'vitest';
import {sceneSchema} from '../../supabase/functions/_shared/domain';
import {backendSceneToLayout,createMeasuredRoomLayout,layoutToBackendScene} from '../components/room-organizer/lib/backend-adapter';
import {imageRegistration,openingLine,updateReviewedWall,mergeRecognizedDimensions} from './reconstruction-review';
const base=backendSceneToLayout({schemaVersion:1,venue:{width:12,depth:8,height:3,shape:'rectangle',entrances:[]},objects:[],camera:'overview',lighting:'neutral'});
describe('structure review',()=>{
 it('retains detected calibration associations without replacing measured user values',()=>{
   const original={id:crypto.randomUUID(),kind:'distance' as const,label:'图纸两点',valueMeters:8,status:'confirmed' as const,sourceAssetId:crypto.randomUUID(),start:{x:.1,z:.2},end:{x:.8,z:.2}};
   const target=crypto.randomUUID();const detected={...original,valueMeters:7,status:'detected' as const,targetId:target,measure:'length' as const};
   expect(mergeRecognizedDimensions([original],[detected])).toEqual([{...original,targetId:target,measure:'length'}]);
   const userTarget=crypto.randomUUID();expect(mergeRecognizedDimensions([{...original,targetId:userTarget}],[detected])[0]!.targetId).toBe(userTarget);
 });

 it('moves shared endpoints and venue vertices together',()=>{
  const s=layoutToBackendScene(createMeasuredRoomLayout(base,{width:12,depth:8,height:3}));if(s.schemaVersion!==2)throw new Error('v2');
  const wall=s.structure.walls[0]!;const old=wall.end;const point={x:old.x-.4,z:old.z+.5};const next=updateReviewedWall(s,wall.id,{end:point});
  expect(next.structure.walls.filter(w=>w.start.x===point.x&&w.start.z===point.z||w.end.x===point.x&&w.end.z===point.z)).toHaveLength(2);
  expect(next.venue.polygon).toContainEqual(point);expect(sceneSchema.safeParse(next).success).toBe(true);
 });
 it('requires non-collinear correspondences to overlay an image',()=>{
  expect(imageRegistration([{x:0,z:0},{x:10,z:10},{x:20,z:20}],12,8)).toBeNull();
  expect(imageRegistration([{x:10,z:20},{x:610,z:20},{x:10,z:420}],12,8)).toBe('matrix(50 0 0 50 10 20)');
 });
 it('locates a slanted opening along its host wall',()=>{
  const s=layoutToBackendScene(createMeasuredRoomLayout(base,{width:12,depth:8,height:3}));if(s.schemaVersion!==2)throw new Error('v2');
  const wall={...s.structure.walls[0]!,start:{x:0,z:0},end:{x:3,z:4}};s.structure.walls=[wall];
  expect(openingLine(s,{id:crypto.randomUUID(),wallId:wall.id,kind:'door',offset:1,width:2,height:2,sillHeight:0,status:'confirmed'})).toEqual({x1:.6,z1:.8,x2:1.7999999999999998,z2:2.4000000000000004});
 });
});
