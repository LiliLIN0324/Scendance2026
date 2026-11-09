import {describe,it,expect} from 'vitest';
import {checkReservedAnnotations} from '../supabase/functions/_shared/agent-annotation-check.ts';
import {scene,chair} from './fixtures.ts';
import {evaluateKeepOut} from '../frontend/lib/flow-constraints.ts';
const marks=()=>({status:'ready',binding:{activityScope:'activity:test',activityEpoch:0,sceneRevision:0,floorId:'floor-1',annotationRevision:1},annotations:[{id:'private-local-id',kind:'zone',geometry:{kind:'rect',x:-5,z:-3,width:2,depth:2},zoneType:'reserved',source:'unverified'}],notice:'标注是待核验的规划草稿；读取不代表已用于排布或完成安全检查。'});
describe('reserved planning area feedback',()=>{
 it.each([[3.25,false],[3.24,false],[3.23,false],[3.22,true]] as const)('uses the 2 cm core inset at x=%s',async(x,conflict)=>{
  const base=scene(),item={...chair(),position:{x,z:3}};
  const checked=checkReservedAnnotations(base,{...base,objects:[item]},marks());
  expect(checked.violations.length>0).toBe(conflict);
  const frontend=evaluateKeepOut([{spec:{type:'chair',name:'chair',category:'',width:.5,depth:.5,height:.85,color:'#ffffff',icon:''},x:x-base.venue.width/2,z:3-base.venue.depth/2,rotation:0,zoneId:'',zoneType:'reserved'}],[{id:'test',kind:'zone',label:'预留区',stageNo:1,zoneType:'reserved',geometry:{kind:'rect',x:-5,z:-3,width:2,depth:2}}]);
  expect(frontend.some(result=>result.severity==='hard')).toBe(conflict);
 });
 it('converts centered planning coordinates and catches rotated footprints',()=>{
  for(const rotation of [0,45,90]){const base=scene(),item={...chair(),rotation,position:{x:2,z:3}};const result=checkReservedAnnotations(base,{...base,objects:[item]},marks());expect(result.violations).toEqual([{code:'RESERVED_AREA_OCCUPIED',ids:['annotation-1',item.id]}]);expect(JSON.stringify(result)).not.toContain('private-local-id');}
 });
 it('keeps existing occupancy unknown and allows its removal',()=>{
  const item={...chair(),position:{x:2,z:3}},base={...scene(),objects:[item]};
  expect(checkReservedAnnotations(base,base,marks())).toMatchObject({violations:[],unknown:expect.arrayContaining([{code:'EXISTING_OR_CHANGED_RESERVED_OCCUPANCY',ids:['annotation-1',item.id]}])});
  expect(checkReservedAnnotations(base,{...base,objects:[]},marks()).violations).toEqual([]);
 });
 it('does not claim a physical check for elevated objects',()=>{
  const base=scene(),item={...chair(),position:{x:2,z:3},elevation:1};
  expect(checkReservedAnnotations(base,{...base,objects:[item]},marks())).toMatchObject({violations:[],unknown:expect.arrayContaining([{code:'ANNOTATION_HEIGHT_UNKNOWN',ids:['annotation-1',item.id]}])});
 });
 it('keeps unavailable, nonreserved and outside marks unknown',()=>{
  const base=scene(),candidate={...base,objects:[{...chair(),position:{x:2,z:3}}]};
  for(const observation of [{status:'unavailable'},null,{...marks(),annotations:[{...marks().annotations[0],zoneType:'checkin'}]},{...marks(),annotations:[{...marks().annotations[0],geometry:{kind:'rect',x:200,z:200,width:2,depth:2}}]}]){
   const result=checkReservedAnnotations(base,candidate,observation);expect(result.violations).toEqual([]);expect(result.unknown.length).toBeGreaterThan(1);
  }
 });
});
