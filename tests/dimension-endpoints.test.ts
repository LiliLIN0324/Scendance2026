import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {sceneSchema,sceneV2Schema,type DimensionConstraint,type SceneV2} from '../supabase/functions/_shared/domain.ts';
import {dimensionConflicts,measurement,structuralViolations} from '../supabase/functions/_shared/structural-geometry.ts';
import {solveDimensions} from '../supabase/functions/_shared/reconstruction.ts';
import {createApi} from '../supabase/functions/_shared/api.ts';
import {database,owner,scene,session,studio} from './fixtures.ts';

function measuredScene():SceneV2 {
 const wallId=crypto.randomUUID();
 return sceneV2Schema.parse({...scene(),schemaVersion:2,structure:{
  walls:[{id:wallId,start:{x:0,z:0},end:{x:12,z:0},thickness:0.2,height:3,kind:'exterior',status:'confirmed'}],
  openings:[{id:crypto.randomUUID(),wallId,kind:'door',offset:4,width:2,height:2,sillHeight:0,status:'confirmed'}],
  columns:[2,6].map(x=>({id:crypto.randomUUID(),position:{x,z:2},size:{width:1,depth:0.8,height:3},rotation:0,status:'confirmed'})),
 },sources:[],dimensions:[]});
}
function brokenDistance(s:SceneV2):DimensionConstraint {
 return {id:crypto.randomUUID(),kind:'distance',valueMeters:1,status:'confirmed',label:'Synthetic two-column distance',targetId:s.structure.columns[0].id,targetEndId:crypto.randomUUID(),measure:'width'};
}

describe('explicit dimension endpoint identities',()=>{
 it.each(['width','depth','height'] as const)('does not treat a missing second endpoint as the first column %s',measure=>{
  const s=measuredScene(),d={...brokenDistance(s),measure,valueMeters:s.structure.columns[0].size[measure]};
  s.dimensions=[d];const before=structuredClone(s);
  expect(sceneSchema.parse(s)).toEqual(before);
  expect(structuralViolations(s)).toEqual([]);
  expect(measurement(s,d)).toBeUndefined();
  expect(dimensionConflicts(s)).toEqual([expect.objectContaining({code:'DIMENSION_TARGET_REQUIRED',dimensionId:d.id})]);
  expect(s).toEqual(before);
 });
 it.each(['first','second','both','wrong-kind'] as const)('does not substitute absolute points for a %s endpoint reference',missing=>{
  const s=measuredScene(),d={...brokenDistance(s),measure:undefined,valueMeters:4,start:{x:2,z:2},end:{x:6,z:2}};
  if(missing==='first'||missing==='both')d.targetId=crypto.randomUUID();
  if(missing==='first')d.targetEndId=s.structure.columns[1].id;
  if(missing==='wrong-kind')d.targetEndId=s.structure.walls[0].id;
  expect(measurement(s,d)).toBeUndefined();
  expect(dimensionConflicts({...s,dimensions:[d]})).toContainEqual(expect.objectContaining({code:'DIMENSION_TARGET_REQUIRED'}));
 });
 it('keeps a broken confirmed reference unresolved without using a column width to rescale the scene',()=>{
  const s=measuredScene(),d={...brokenDistance(s),valueMeters:2},before=structuredClone(s);
  const solved=solveDimensions(s,[d]);
  expect(solved.issues).toEqual([expect.objectContaining({code:'DIMENSION_TARGET_REQUIRED',targetId:d.id})]);
  expect(solved.scene).toEqual({...before,dimensions:[d]});
  expect(s).toEqual(before);
 });
 it('uses both real column centers before member dimensions and preserves the original calibration record',()=>{
  const s=measuredScene(),d={...brokenDistance(s),targetEndId:s.structure.columns[1].id,valueMeters:2};
  expect(measurement(s,d)).toBe(4);
  const solved=solveDimensions(s,[d]);
  expect(solved.issues).toEqual([]);
  expect(solved.scene.venue.width).toBe(6);
  expect(solved.scene.venue.depth).toBe(5);
  expect(measurement(solved.scene,d)).toBe(2);
  expect(solved.scene.dimensions).toEqual([d]);
  expect(solved.scene.structure.columns[0].size).toEqual(s.structure.columns[0].size);
 });
 it('does not resize a real opening from an unresolved endpoint pair',()=>{
  const s=measuredScene(),d={...brokenDistance(s),targetId:s.structure.openings[0].id},before=structuredClone(s);
  const solved=solveDimensions(s,[d]);
  expect(solved.issues).toEqual([expect.objectContaining({code:'DIMENSION_TARGET_REQUIRED',targetId:d.id})]);
  expect(solved.scene).toEqual({...before,dimensions:[d]});
  expect(s).toEqual(before);
 });
 it('preserves existing no-endpoint wall, opening, column-size and absolute-point measurements',()=>{
  const s=measuredScene(),{targetEndId,...d}=brokenDistance(s);void targetEndId;
  expect(measurement(s,d)).toBe(1);
  expect(measurement(s,{...d,targetId:s.structure.walls[0].id,measure:'height'})).toBe(3);
  expect(measurement(s,{...d,targetId:s.structure.openings[0].id,measure:'width'})).toBe(2);
  expect(measurement(s,{...d,targetId:undefined,measure:undefined,start:{x:2,z:2},end:{x:6,z:2}})).toBe(4);
 });
 it.each(['detected','inferred'] as const)('retains unresolved %s records without presenting a measured distance',status=>{
  const s=measuredScene(),d={...brokenDistance(s),status};s.dimensions=[d];
  const before=structuredClone(s);
  expect(measurement(s,d)).toBeUndefined();
  expect(dimensionConflicts(s)).toEqual([]);
  expect(sceneSchema.parse(s)).toEqual(before);
 });

 let f:Awaited<ReturnType<typeof database>>;
 beforeAll(async()=>{f=await database();},30000);
 afterAll(async()=>{await f.db.close();});
 const request=(path:string,method:string,body?:unknown)=>createApi(f.backend,()=>undefined)(new Request(`https://api.test${path}`,{
  method,headers:{authorization:`Bearer ${owner}`,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),
 }));
 it('rejects a broken confirmed distance before creating a project',async()=>{
  const s=measuredScene();s.dimensions=[brokenDistance(s)];
  const before=(await f.rpc(owner,'projects.list')).length;
  const response=await request('/projects','POST',{studioId:studio,name:'Synthetic broken distance',scene:s});
  expect(response.status).toBe(422);
  expect((await f.rpc(owner,'projects.list')).length).toBe(before);
 });
 it('rejects a broken saved distance without advancing revision, then accepts the repaired pair',async()=>{
  const s=measuredScene(),project=await f.rpc(owner,'projects.create',{studioId:studio,name:'Synthetic distance save',scene:s});
  const lease=await (await request(`/projects/${project.id}/lease/acquire`,'POST',{sessionId:session})).json();
  const d=brokenDistance(s),body={sessionId:session,generation:lease.generation,expectedRevision:0,scene:{...s,dimensions:[d]}};
  const failed=await request(`/projects/${project.id}/scene`,'PUT',body);
  expect(failed.status).toBe(422);
  const reopened=await (await request(`/projects/${project.id}`,'GET')).json();
  expect(reopened.revision).toBe(0);expect(reopened.scene).toEqual(s);
  const repaired={...s,dimensions:[{...d,targetEndId:s.structure.columns[1].id,valueMeters:4}]};
  expect((await request(`/projects/${project.id}/scene`,'PUT',{...body,scene:repaired})).status).toBe(200);
  const saved=await (await request(`/projects/${project.id}`,'GET')).json();
  expect(saved.revision).toBe(1);expect(saved.scene).toEqual(repaired);
 });
});
