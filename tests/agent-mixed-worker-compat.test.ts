import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {agentRunRequestSchema} from '../supabase/functions/_shared/agent-contract.ts';
import {sceneHash} from '../supabase/functions/_shared/domain.ts';
import {chair,database,owner,session,scene,studio} from './fixtures.ts';

/**
 * Compatibility characterization, NOT a safety approval: the old dispatcher
 * remains callable by a legacy worker even after the new guard is installed.
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
 it('demonstrates that a legacy checkpoint and finish can publish after a guarded new requirement',async()=>{
  const x=await setup(),key={projectId:x.project.id,id:x.id,claim:x.claim};
  const accepted=await fixture.backend.agent!(owner,'note',{projectId:x.project.id,id:x.id,note:'保留原物'});
  expect(accepted.accepted).toBe(true);
  await expect(fixture.backend.agent!(owner,'checkpoint',{...key,steerTotal:0,candidates:[candidate(x.base)]})).rejects.toMatchObject({code:'AGENT_STEERING_CHANGED'});
  const oldCheckpoint=await oldWorker('checkpoint',{...key,candidates:[candidate(x.base)]});
  expect(oldCheckpoint.state).toBe('running');
  const oldFinish=await oldWorker('finish',{...key});
  expect(oldFinish.state).toBe('complete');
  const row=await fixture.db.query<{state:string;notes:number;candidates:number}>(
   "select state,jsonb_array_length(steer_notes) as notes,jsonb_array_length(candidates) as candidates from scene_private.agent_runs where id=$1",[x.id]);
  expect(row.rows[0]).toMatchObject({state:'complete',notes:1,candidates:1});
  const proposal=(oldCheckpoint.candidates as Array<{proposal:{id:string}}>)[0]!.proposal;
  await fixture.rpc(owner,'proposals.apply',{projectId:x.project.id,proposalId:proposal.id,sessionId:session,
   generation:x.input.generation,expectedRevision:x.input.expectedRevision,localRevision:0,baseHash:x.baseHash});
  const readback=await fixture.rpc(owner,'projects.get',{projectId:x.project.id});
  expect(readback.revision).toBe(1);expect(readback.scene.objects).toHaveLength(0);
 });
 it('demonstrates that simultaneous guarded note and legacy finish can both be accepted',async()=>{
  const x=await setup(),key={projectId:x.project.id,id:x.id,claim:x.claim};
  await oldWorker('checkpoint',{...key,candidates:[candidate(x.base)]});
  const [note,finish]=await Promise.allSettled([
   fixture.backend.agent!(owner,'note',{projectId:x.project.id,id:x.id,note:'保留原物'}),
   oldWorker('finish',{...key,candidates:[candidate(x.base)]}),
  ]);
  // PGlite serializes this fixture's operations; this does not prove real-PG
  // timing, and an old worker bypass remains the behavior being characterized.
  if(note.status==='fulfilled'){
   expect(finish.status).toBe('fulfilled');
   expect((await fixture.backend.agent!(owner,'get',{projectId:x.project.id,id:x.id})).state).toBe('complete');
  }else{
   expect(finish.status).toBe('fulfilled');
  }
 });
});
