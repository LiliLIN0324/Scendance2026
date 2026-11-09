import {readFileSync} from 'node:fs';
import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {database,owner,outsider,scene,session,studio,chair} from './fixtures.ts';
import {sceneHash} from '../supabase/functions/_shared/domain.ts';
import {agentRunRequestSchema} from '../supabase/functions/_shared/agent-contract.ts';

const zone={id:'zone-1',name:'签到区',color:'#4A7C59',x:0,z:0,width:2,depth:1,zoneType:'checkin' as const,source:'unverified' as const};
const zones={version:1 as const,zones:[zone]};
describe('planning-zone database save guard',()=>{
 let f:Awaited<ReturnType<typeof database>>;
 beforeAll(async()=>{f=await database();},30000);afterAll(async()=>{await f.db.close();});
 async function setup(){
  const base=scene(),project=await f.rpc(owner,'projects.create',{studioId:studio,name:'fixture',scene:base});
  const lease=await f.rpc(owner,'lease.acquire',{projectId:project.id,sessionId:session});
  const at=(revision:number)=>({projectId:project.id,sessionId:session,generation:lease.generation,expectedRevision:revision});
  return {base,project,at};
 }
 it('requires an exact previous value for addition, change and removal',async()=>{
  const s=await setup();const withZones={...s.base,planningZones:zones};
  await expect(f.rpc(owner,'scene.save',{...s.at(0),scene:withZones})).rejects.toThrow('PLANNING_ZONES_EDIT_REQUIRED');
  const created=await f.rpc(owner,'scene.save',{...s.at(0),scene:withZones,planningZonesEdit:{version:1,previous:null}});expect(created.scene.planningZones).toEqual(zones);
  const unchanged=await f.rpc(owner,'scene.save',{...s.at(1),scene:withZones});expect(unchanged.revision).toBe(2);
  await expect(f.rpc(owner,'scene.save',{...s.at(2),scene:s.base})).rejects.toThrow('PLANNING_ZONES_EDIT_REQUIRED');
  await expect(f.rpc(owner,'scene.save',{...s.at(2),scene:s.base,planningZonesEdit:{version:1,previous:null}})).rejects.toThrow('PLANNING_ZONES_STALE');
  const removed=await f.rpc(owner,'scene.save',{...s.at(2),scene:s.base,planningZonesEdit:{version:1,previous:zones}});expect(removed.scene).not.toHaveProperty('planningZones');
 });
 it('rejects a second tab that reused the revision but kept an older previous value',async()=>{
  const s=await setup();const withZones={...s.base,planningZones:zones};
  await f.rpc(owner,'scene.save',{...s.at(0),scene:withZones,planningZonesEdit:{version:1,previous:null}});
  const renamed={...withZones,planningZones:{version:1,zones:[{...zone,name:'另一标签页'}]}};
  await expect(f.rpc(owner,'scene.save',{...s.at(1),scene:renamed,planningZonesEdit:{version:1,previous:null}})).rejects.toThrow('PLANNING_ZONES_STALE');
  const current=await f.rpc(owner,'projects.get',{projectId:s.project.id});
  expect(current.revision).toBe(1);expect(current.scene.planningZones).toEqual(zones);
 });
 it('rolls back a zone write when the surrounding transaction fails',async()=>{
  const s=await setup();const withZones={...s.base,planningZones:zones};
  const payload={...s.at(0),scene:withZones,planningZonesEdit:{version:1,previous:null}};
  await expect(f.db.transaction(async tx=>{await tx.exec('set local role service_role');await tx.query('select public.scene_rpc($1,$2,$3::jsonb)',[owner,'scene.save',JSON.stringify(payload)]);throw new Error('interrupt');})).rejects.toThrow('interrupt');
  expect((await f.rpc(owner,'projects.get',{projectId:s.project.id})).revision).toBe(0);
  expect((await f.rpc(owner,'projects.get',{projectId:s.project.id})).scene).not.toHaveProperty('planningZones');
 });
 it('rejects malformed geometry, overprecision and unexpected edit fields without changing the project',async()=>{
  const s=await setup();
  for(const replacement of [{...zone,x:11,width:2},...(['x','z','width','depth'] as const).map(field=>({...zone,[field]:0.0000000001})),{...zone,source:'confirmed'},{...zone,id:''}]){
   await expect(f.rpc(owner,'scene.save',{...s.at(0),scene:{...s.base,planningZones:{version:1,zones:[replacement]}},planningZonesEdit:{version:1,previous:null}})).rejects.toThrow('PLANNING_ZONES_INVALID');
  }
  await expect(f.rpc(owner,'scene.save',{...s.at(0),scene:{...s.base,planningZones:zones},planningZonesEdit:{version:1,previous:null,force:true}})).rejects.toThrow('PLANNING_ZONES_EDIT_INVALID');
  await expect(f.rpc(owner,'scene.save',{...s.at(0),scene:{...s.base,planningZones:{version:1,zones:[]}},planningZonesEdit:{version:1,previous:null}})).rejects.toThrow('PLANNING_ZONES_INVALID');
  expect((await f.rpc(owner,'projects.get',{projectId:s.project.id})).revision).toBe(0);
 });
 it('does not allow create-with-zones to bypass the explicit edit transition',async()=>{
  await expect(f.rpc(owner,'projects.create',{studioId:studio,name:'fixture',scene:{...scene(),planningZones:zones}})).rejects.toThrow('PLANNING_ZONES_CREATE_UNSUPPORTED');
 });
 it('does not silently publish unknown planning-zone labels through the old public projection',async()=>{
  const s=await setup(),withZones={...s.base,planningZones:zones};
  await f.rpc(owner,'scene.save',{...s.at(0),scene:withZones,planningZonesEdit:{version:1,previous:null}});
  await expect(f.rpc(owner,'publish',{projectId:s.project.id,expectedRevision:1,tokenHash:'a'.repeat(64)})).rejects.toThrow('PLANNING_ZONES_SHARING_UNSUPPORTED');
  expect((await f.db.query('select id from scene_private.publications where project_id=$1',[s.project.id])).rows).toHaveLength(0);
 });
 it('does not allow an old proposal or a forged proof to drop a saved area',async()=>{
  const s=await setup(),withZones={...s.base,planningZones:zones};
  await f.rpc(owner,'scene.save',{...s.at(0),scene:withZones,planningZonesEdit:{version:1,previous:null}});
  const id=crypto.randomUUID();await f.rpc(owner,'proposals.store',{...s.at(1),id,localRevision:0,baseHash:await sceneHash(withZones),scene:withZones,candidate:s.base,explanation:'fixture',warnings:[]});
  await expect(f.rpc(owner,'proposals.apply',{...s.at(1),proposalId:id,localRevision:0,baseHash:await sceneHash(withZones),planningZonesEdit:{version:1,previous:zones}})).rejects.toThrow('PLANNING_ZONES_WRITE_PROTECTED');
  const kept=crypto.randomUUID();await f.rpc(owner,'proposals.store',{...s.at(1),id:kept,localRevision:0,baseHash:await sceneHash(withZones),scene:withZones,candidate:{...withZones,lighting:'warm'},explanation:'fixture',warnings:[]});
  const applied=await f.rpc(owner,'proposals.apply',{...s.at(1),proposalId:kept,localRevision:0,baseHash:await sceneHash(withZones)});
  expect(applied.scene.planningZones).toEqual(zones);expect(applied.scene.lighting).toBe('warm');
 });
 it('restores zones from the explicit snapshot and rejects a forged restore body',async()=>{
  const s=await setup(),withZones={...s.base,planningZones:zones};
  const id=crypto.randomUUID(),baseHash=await sceneHash(s.base);
  await f.rpc(owner,'proposals.store',{...s.at(0),id,localRevision:0,baseHash,scene:s.base,candidate:s.base,explanation:'fixture',warnings:[]});
  await f.rpc(owner,'proposals.apply',{...s.at(0),proposalId:id,localRevision:0,baseHash});
  await f.db.query('update scene_private.proposals set base_scene=$2::jsonb where id=$1',[id,JSON.stringify(withZones)]);
  await expect(f.rpc(owner,'scene.save',{...s.at(1),scene:{...s.base,lighting:'cool',planningZones:zones},restoreFromProposal:id})).rejects.toThrow('PLANNING_ZONES_WRITE_PROTECTED');
  expect((await f.rpc(owner,'projects.get',{projectId:s.project.id})).revision).toBe(1);
  const restored=await f.rpc(owner,'history.restore',{...s.at(1),proposalId:id,currentScene:s.base});
  expect(restored.revision).toBe(2);expect(restored.scene.planningZones).toEqual(zones);
  await expect(f.rpc(owner,'history.restore',{...s.at(2),proposalId:id,currentScene:withZones})).rejects.toThrow('STALE_HISTORY_RESTORE');
  expect((await f.rpc(owner,'projects.get',{projectId:s.project.id})).scene.planningZones).toEqual(zones);
 });
 it('does not let original review redraw saved zones',async()=>{
  const s=await setup(),withZones={...s.base,planningZones:zones};
  await f.rpc(owner,'scene.save',{...s.at(0),scene:withZones,planningZonesEdit:{version:1,previous:null}});
  const review=f.backend.originalSceneReview!;
  const moved={...structuredClone(withZones),objects:[chair('保留区域')]},dropped=structuredClone(moved);
  delete (dropped as {planningZones?:unknown}).planningZones;
  const movedHash=await sceneHash(moved),droppedHash=await sceneHash(dropped),currentHash=await sceneHash(withZones);
  await review(owner,'create',{id:crypto.randomUUID(),projectId:s.project.id,sessionId:session,generation:s.at(1).generation,expectedRevision:1,baseScene:withZones,baseHash:currentHash,candidate:moved,candidateHash:movedHash});
  const harmful=crypto.randomUUID();
  await review(owner,'create',{id:harmful,projectId:s.project.id,sessionId:session,generation:s.at(1).generation,expectedRevision:1,baseScene:withZones,baseHash:currentHash,candidate:dropped,candidateHash:droppedHash});
  await expect(review(owner,'apply',{...s.at(1),id:harmful,baseHash:currentHash,candidateHash:droppedHash})).rejects.toThrow('PLANNING_ZONES_WRITE_PROTECTED');
  expect((await f.rpc(owner,'projects.get',{projectId:s.project.id})).scene.planningZones).toEqual(zones);
 });
 it('restricts readiness to a project member',async()=>{
  const s=await setup();expect(await f.rpc(owner,'planning_zones.readiness',{projectId:s.project.id})).toEqual({capability:'planning_zones',version:1});
  await expect(f.rpc(outsider,'planning_zones.readiness',{projectId:s.project.id})).rejects.toThrow();
 });
 it('retains the prior annotation readiness and preview-only guard',async()=>{
  const s=await setup();expect(await f.rpc(owner,'annotations.readiness',{projectId:s.project.id})).toEqual({capability:'annotation_preview_guard',version:1});
  const {projectId:_projectId,...lease}=s.at(0);
  const input=agentRunRequestSchema.parse({requestId:crypto.randomUUID(),...lease,localRevision:0,scene:s.base,selectedIds:[],instruction:'fixture',context:{brief:'',acceptedDecisions:[],recentMessages:[],annotationObservation:{status:'unavailable'}},executionMode:'preview'});
  const hash=await sceneHash(s.base),created=await f.backend.agent!(owner,'create',{projectId:s.project.id,input,fingerprint:'a'.repeat(64),baseHash:hash,executionMode:'preview'}),started=await f.backend.agent!(owner,'start',{projectId:s.project.id,id:created.id});
  const finished=await f.backend.agent!(owner,'finish',{projectId:s.project.id,id:created.id,claim:started.claim,steerTotal:0,candidates:[{label:'A',title:'fixture',scene:s.base,explanation:'fixture',warnings:[],commands:[]}]});
  await expect(f.rpc(owner,'proposals.apply',{...s.at(0),proposalId:finished.candidates[0].proposal.id,localRevision:0,baseHash:hash})).rejects.toThrow('ANNOTATION_PREVIEW_ONLY');
 });
 it('preserves the existing save_scene function identity when installed',async()=>{
  const other=await database(undefined,{excludeMigrations:['20261109170000_planning_zones_guard.sql']});
  try{
   const oid=async()=>String((await other.db.query<{id:string}>("select 'scene_private.save_scene(uuid,jsonb,jsonb)'::regprocedure::oid::text as id")).rows[0]!.id);
   const prior=await oid();await other.db.exec(readFileSync(new URL('../supabase/migrations/20261109170000_planning_zones_guard.sql',import.meta.url),'utf8'));expect(await oid()).toBe(prior);
  }finally{await other.db.close();}
 },30000);
});
