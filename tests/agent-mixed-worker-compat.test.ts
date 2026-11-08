import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {agentRunRequestSchema} from '../supabase/functions/_shared/agent-contract.ts';
import {sceneHash} from '../supabase/functions/_shared/domain.ts';
import {chair,database,owner,session,scene,studio} from './fixtures.ts';

/**
 * Mixed old/new compatibility after the shared scene entry is guarded.
 * No external service or user data is involved.
 */
describe('mixed old/new agent worker compatibility',()=>{
 let fixture:Awaited<ReturnType<typeof database>>;
 beforeAll(async()=>{fixture=await database();},30000);
 afterAll(async()=>{await fixture.db.close();});

 async function setup(){
  const base={...scene(),objects:[chair()]};
  const project=await fixture.rpc(owner,'projects.create',{studioId:studio,name:'Mixed worker fixture',scene:base});
  const lease=await fixture.rpc(owner,'lease.acquire',{projectId:project.id,sessionId:session});
  const input=agentRunRequestSchema.parse({requestId:crypto.randomUUID(),sessionId:session,generation:lease.generation,
   expectedRevision:lease.revision,localRevision:0,scene:base,selectedIds:[],instruction:'虚构30人活动',executionMode:'preview'});
  const created=await fixture.backend.agent!(owner,'create',{projectId:project.id,input,fingerprint:'a'.repeat(64),baseHash:await sceneHash(base),executionMode:'preview'});
  const started=await fixture.backend.agent!(owner,'start',{projectId:project.id,id:created.id});
  return {base,project,input,id:created.id,claim:started.claim,baseHash:await sceneHash(base)};
 }
 const candidate=(base:ReturnType<typeof scene>)=>({label:'A',title:'旧候选',scene:{...base,objects:[]},explanation:'仅测试',warnings:[],commands:[]});
 async function oldWorker(action:string,data:Record<string,unknown>){
  const result=await fixture.db.transaction(async tx=>{
   await tx.exec('set local role service_role');
   return tx.query<{result:Record<string,unknown>}>('select public.agent_rpc($1,$2,$3::jsonb) as result',[owner,action,JSON.stringify(data)]);
  });
  return result.rows[0]!.result;
 }
 it('lets an unsteered legacy task checkpoint and finish normally',async()=>{
  const x=await setup(),key={projectId:x.project.id,id:x.id,claim:x.claim};
  expect((await oldWorker('checkpoint',{...key,candidates:[candidate(x.base)]})).state).toBe('running');
  expect((await oldWorker('finish',key)).state).toBe('complete');
 });
 it('allows legacy publish before steering, then blocks both legacy scene entries after a requirement',async()=>{
  const x=await setup(),key={projectId:x.project.id,id:x.id,claim:x.claim};
  const previous=await oldWorker('checkpoint',{...key,candidates:[candidate(x.base)]});
  expect(previous.state).toBe('running');
  const accepted=await fixture.backend.agent!(owner,'note',{projectId:x.project.id,id:x.id,note:'保留原物'});
  expect(accepted.accepted).toBe(true);expect(accepted.candidates).toEqual([]);
  await expect(fixture.backend.agent!(owner,'checkpoint',{...key,steerTotal:0,candidates:[candidate(x.base)]})).rejects.toMatchObject({code:'AGENT_STEERING_CHANGED'});
  await expect(oldWorker('checkpoint',{...key,candidates:[candidate(x.base)]})).rejects.toThrow('AGENT_STEERING_CHANGED');
  await expect(oldWorker('finish',key)).rejects.toThrow('AGENT_STEERING_CHANGED');
  await expect(fixture.db.transaction(async tx=>{await tx.exec('set local role service_role');return tx.query('select public.agent_rpc_before_activity_tasks($1,$2,$3::jsonb)',[owner,'finish',JSON.stringify(key)]);})).rejects.toThrow('AGENT_STEERING_CHANGED');
  const row=await fixture.db.query<{state:string;notes:number;candidates:number}>(
   "select state,jsonb_array_length(steer_notes) as notes,jsonb_array_length(candidates) as candidates from scene_private.agent_runs where id=$1",[x.id]);
  expect(row.rows[0]).toMatchObject({state:'running',notes:1,candidates:0});
  const proposal=(previous.candidates as Array<{proposal:{id:string}}>)[0]!.proposal;
  await expect(fixture.rpc(owner,'proposals.apply',{projectId:x.project.id,proposalId:proposal.id,sessionId:session,
   generation:x.input.generation,expectedRevision:x.input.expectedRevision,localRevision:0,baseHash:x.baseHash})).rejects.toMatchObject({code:'STALE_PROPOSAL'});
  const readback=await fixture.rpc(owner,'projects.get',{projectId:x.project.id});
  expect(readback.revision).toBe(0);expect(readback.scene).toEqual(x.base);
  expect(await oldWorker('take_notes',key)).toMatchObject({steerTotal:1});
  await expect(oldWorker('finish',key)).rejects.toThrow('AGENT_STEERING_CHANGED');
  await fixture.backend.agent!(owner,'cancel',{projectId:x.project.id,id:x.id});
 });
 it('serializes concurrent guarded note and legacy finish without accepting both',async()=>{
  const x=await setup(),key={projectId:x.project.id,id:x.id,claim:x.claim};
  await oldWorker('checkpoint',{...key,candidates:[candidate(x.base)]});
  const [note,finish]=await Promise.allSettled([
   fixture.backend.agent!(owner,'note',{projectId:x.project.id,id:x.id,note:'保留原物'}),
   oldWorker('finish',{...key,candidates:[candidate(x.base)]}),
  ]);
  if(note.status==='fulfilled'){
   expect(finish.status).toBe('rejected');
   expect((await fixture.backend.agent!(owner,'get',{projectId:x.project.id,id:x.id})).candidates).toEqual([]);
   await fixture.backend.agent!(owner,'cancel',{projectId:x.project.id,id:x.id});
  }else{
   expect(finish.status).toBe('fulfilled');
  }
 });
 it('rejects direct execution of the old unguarded body for service_role and wrappers for public roles',async()=>{
  const x=await setup(),key={projectId:x.project.id,id:x.id,claim:x.claim};
  for(const [role,fn] of [['service_role','agent_rpc_scene_unguarded_internal'],['anon','agent_rpc_before_activity_tasks'],['authenticated','agent_rpc_before_activity_tasks']] as const){
   await expect(fixture.db.transaction(async tx=>{await tx.exec(`set local role ${role}`);return tx.query(`select public.${fn}($1,$2,$3::jsonb)`,[owner,'finish',JSON.stringify(key)]);})).rejects.toThrow(/permission denied/i);
  }
  await fixture.backend.agent!(owner,'cancel',{projectId:x.project.id,id:x.id});
 });
 it('makes a legacy note invalidate the checkpoint and leaves updated workers able to continue',async()=>{
  const x=await setup(),key={projectId:x.project.id,id:x.id,claim:x.claim};
  await oldWorker('checkpoint',{...key,candidates:[candidate(x.base)]});
  const noted=await oldWorker('note',{projectId:x.project.id,id:x.id,note:'保留原物'});
  expect(noted.accepted).toBe(true);expect(noted.candidates).toEqual([]);expect(noted.steerTotal).toBe(1);
  expect(await fixture.backend.agent!(owner,'take_notes',key)).toMatchObject({notes:['保留原物'],steerTotal:1});
  await expect(oldWorker('checkpoint',{...key,candidates:[candidate(x.base)]})).rejects.toThrow('AGENT_STEERING_CHANGED');
  const latest=await fixture.backend.agent!(owner,'checkpoint',{...key,steerTotal:1,candidates:[candidate(x.base)]});expect(latest.candidates).toHaveLength(1);
  expect((await fixture.backend.agent!(owner,'finish',{...key,steerTotal:1})).state).toBe('complete');
 });
});
