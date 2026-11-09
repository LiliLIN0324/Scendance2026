import {beforeAll,afterAll,describe,it,expect} from 'vitest';
import {database,owner,outsider,studio,session,scene} from './fixtures.ts';
import {createApi} from '../supabase/functions/_shared/api.ts';
import {agentRunRequestSchema} from '../supabase/functions/_shared/agent-contract.ts';
import {sceneHash,sceneV2Schema} from '../supabase/functions/_shared/domain.ts';

describe('planning zones HTTP rollout',()=>{
 let f:Awaited<ReturnType<typeof database>>;
 beforeAll(async()=>{f=await database();},30000);afterAll(async()=>{await f.db.close();});
 const zones={version:1 as const,zones:[{id:'local-zone',name:'预留区',color:'#4A7C59',x:1,z:1,width:2,depth:2,zoneType:'reserved' as const,source:'unverified' as const}]};
 function req(path:string,method='GET',body?:unknown,enabled=true,actor=owner){
  return createApi(f.backend,key=>key==='PLANNING_ZONES_ENABLED'&&enabled?'1':undefined)(new Request(`https://api.test${path}`,{method,headers:{authorization:`Bearer ${actor}`,'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)}));
 }
 async function setup(){const project=await f.rpc(owner,'projects.create',{studioId:studio,name:'zone HTTP fixture',scene:scene()});const lease=await f.rpc(owner,'lease.acquire',{projectId:project.id,sessionId:session});return {project,key:{sessionId:session,generation:lease.generation,expectedRevision:0}};}
 it('requires project access and explicit opt-in for capability discovery',async()=>{
  const {project}=await setup();
  expect(await (await req(`/projects/${project.id}/planning-zones/capabilities`,'GET',undefined,false)).json()).toEqual({supported:false});
  expect(await (await req(`/projects/${project.id}/planning-zones/capabilities`)).json()).toEqual({supported:true,version:1});
  expect((await req(`/projects/${project.id}/planning-zones/capabilities`,'GET',undefined,true,outsider)).status).not.toBe(200);
 });
 it('does not permit region-bearing initial create to bypass the explicit editing path',async()=>{
  const response=await req('/projects','POST',{studioId:studio,name:'invalid initial zones',scene:{...scene(),planningZones:zones}});
  expect(response.status).toBe(422);expect(await response.json()).toMatchObject({error:{code:'PLANNING_ZONES_CREATE_REQUIRES_EDIT'}});
 });
 it('keeps ordinary save available but rejects disabled region edits without changing the scene',async()=>{
  const {project,key}=await setup();
  const denied=await req(`/projects/${project.id}/scene`,'PUT',{...key,scene:{...scene(),planningZones:zones},planningZonesEdit:{version:1,previous:null}},false);
  expect(denied.status).toBe(503);expect((await f.rpc(owner,'projects.get',{projectId:project.id})).revision).toBe(0);
  expect((await req(`/projects/${project.id}/scene`,'PUT',{...key,scene:scene()},false)).status).toBe(200);
 });
 it('roundtrips explicit zones and refuses old omission or stale previous data',async()=>{
  const {project,key}=await setup();const value={...scene(),planningZones:zones};
  const saved=await req(`/projects/${project.id}/scene`,'PUT',{...key,scene:value,planningZonesEdit:{version:1,previous:null}});
  expect(saved.status).toBe(200);expect((await f.rpc(owner,'projects.get',{projectId:project.id})).scene.planningZones).toEqual(zones);
  const returned=await saved.json();expect(returned.scene.planningZones).toEqual(zones);
  const key1={...key,expectedRevision:1};
  expect((await req(`/projects/${project.id}/scene`,'PUT',{...key1,scene:scene()})).status).not.toBe(200);
  expect((await req(`/projects/${project.id}/scene`,'PUT',{...key1,scene:scene(),planningZonesEdit:{version:1,previous:null}})).status).not.toBe(200);
  expect((await f.rpc(owner,'projects.get',{projectId:project.id})).revision).toBe(1);
  const cleared=await req(`/projects/${project.id}/scene`,'PUT',{...key1,scene:scene(),planningZonesEdit:{version:1,previous:zones}});
  expect(cleared.status).toBe(200);
  expect((await f.rpc(owner,'projects.get',{projectId:project.id})).scene).not.toHaveProperty('planningZones');
 });
 it('refuses generation, reconstruction and sharing while saved zones stay unchanged',async()=>{
  const {project,key}=await setup();const value={...scene(),planningZones:zones};
  expect((await req(`/projects/${project.id}/scene`,'PUT',{...key,scene:value,planningZonesEdit:{version:1,previous:null}})).status).toBe(200);
  const agent=agentRunRequestSchema.parse({requestId:crypto.randomUUID(),...key,expectedRevision:1,localRevision:0,scene:scene(),selectedIds:[],instruction:'不要改区域',executionMode:'preview'});
  expect((await req(`/projects/${project.id}/agent-runs`,'POST',agent)).status).toBe(503);
  const v2=sceneV2Schema.parse({...value,schemaVersion:2,structure:{walls:[],openings:[],columns:[]},sources:[],dimensions:[]});
  const reconstruction={...key,expectedRevision:1,requestId:crypto.randomUUID(),localRevision:0,scene:v2,sources:[],dimensions:[],mode:'redesign',instruction:'不要改区域',selectedIds:[],reviewedScene:v2};
  expect((await req(`/projects/${project.id}/reconstructions`,'POST',reconstruction)).status).toBe(503);
  const shared=await req(`/projects/${project.id}/publish`,'POST',{expectedRevision:1});
  expect(shared.status).toBe(422);expect(await shared.json()).toMatchObject({error:{code:'PLANNING_ZONES_SHARING_UNSUPPORTED'}});
  expect((await f.rpc(owner,'projects.get',{projectId:project.id})).scene.planningZones).toEqual(zones);
  expect((await f.db.query('select id from scene_private.publications where project_id=$1',[project.id])).rows).toHaveLength(0);
 });
 it('restores an explicit snapshot that carries user zones',async()=>{
  const {project,key}=await setup();
  const id=crypto.randomUUID(),base=scene(),baseHash=await sceneHash(base);
  await f.rpc(owner,'proposals.store',{...key,projectId:project.id,id,localRevision:0,baseHash,scene:base,candidate:base,explanation:'fixture',warnings:[]});
  await f.rpc(owner,'proposals.apply',{...key,projectId:project.id,proposalId:id,localRevision:0,baseHash});
  await f.db.query('update scene_private.proposals set base_scene=$2::jsonb where id=$1',[id,JSON.stringify({...base,planningZones:zones})]);
  const restored=await req(`/projects/${project.id}/history/restore`,'POST',{...key,expectedRevision:1,proposalId:id,currentScene:base});
  expect(restored.status).toBe(200);
  expect((await restored.json()).scene.planningZones).toEqual(zones);
  expect((await f.rpc(owner,'projects.get',{projectId:project.id})).scene.planningZones).toEqual(zones);
 });
});
