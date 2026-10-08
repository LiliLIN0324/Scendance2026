import {describe,expect,it} from 'vitest';
import {sceneSchema} from '../../supabase/functions/_shared/domain';
import {backendSceneToLayout,createMeasuredRoomLayout,layoutToBackendScene} from '../components/room-organizer/lib/backend-adapter';
import {imageRegistration,imageToWorldRegistration,openingLine,updateReviewedWall,mergeRecognizedDimensions} from './reconstruction-review';
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
 it('rejects non-finite inputs and maps all three rotated, skewed correspondences back to world meters',()=>{
  expect(imageRegistration([{x:NaN,z:0},{x:10,z:0},{x:0,z:10}],12,8)).toBeNull();
  expect(imageRegistration([{x:0,z:0},{x:10,z:0},{x:0,z:10}],Infinity,8)).toBeNull();
  expect(imageToWorldRegistration([{x:0,z:0},{x:Infinity,z:0},{x:0,z:10}],12,8)).toBeNull();
  expect(imageToWorldRegistration([{x:10,z:20},{x:610,z:20},{x:610,z:20.0001}],12,8)).toBeNull();
  expect(imageToWorldRegistration([{x:10,z:20},{x:610,z:20},{x:900,z:20.0001}],12,8)).toBeNull();
  const points=[{x:100,z:100},{x:700,z:220},{x:20,z:500}];
  const [a,b,c,d,e,f]=imageToWorldRegistration(points,12,8)!;
  points.forEach((point,index)=>{expect(a*point.x+c*point.z+e).toBeCloseTo([0,12,0][index]!);expect(b*point.x+d*point.z+f).toBeCloseTo([0,0,8][index]!);});
  expect(imageToWorldRegistration([{x:700,z:100},{x:100,z:100},{x:700,z:500}],12,8)).not.toBeNull();
 });
 it('locates a slanted opening along its host wall',()=>{
  const s=layoutToBackendScene(createMeasuredRoomLayout(base,{width:12,depth:8,height:3}));if(s.schemaVersion!==2)throw new Error('v2');
  const wall={...s.structure.walls[0]!,start:{x:0,z:0},end:{x:3,z:4}};s.structure.walls=[wall];
  expect(openingLine(s,{id:crypto.randomUUID(),wallId:wall.id,kind:'door',offset:1,width:2,height:2,sillHeight:0,status:'confirmed'})).toEqual({x1:.6,z1:.8,x2:1.7999999999999998,z2:2.4000000000000004});
 });
});
