import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {agentRunRequestSchema} from '../supabase/functions/_shared/agent-contract.ts';
import {sceneHash} from '../supabase/functions/_shared/domain.ts';
import {database,owner,editor,outsider,studio,session,scene} from './fixtures.ts';

describe('atomic steering publication guard',()=>{
 let f:Awaited<ReturnType<typeof database>>;
 beforeAll(async()=>{f=await database();},30000);afterAll(async()=>{await f.db.close();});
 async function setup(){
  const base=scene(),project=await f.rpc(owner,'projects.create',{studioId:studio,name:'Atomic steering',scene:base});
  const lease=await f.rpc(owner,'lease.acquire',{projectId:project.id,sessionId:session});
  const input=agentRunRequestSchema.parse({requestId:crypto.randomUUID(),sessionId:session,generation:lease.generation,expectedRevision:0,localRevision:0,scene:base,selectedIds:[],instruction:'30人活动',executionMode:'preview'});
  const created=await f.backend.agent!(owner,'create',{projectId:project.id,input,fingerprint:'a'.repeat(64),baseHash:await sceneHash(base),executionMode:'preview'});
  const started=await f.backend.agent!(owner,'start',{projectId:project.id,id:created.id});
  return {base,project,input,id:created.id,claim:started.claim,baseHash:await sceneHash(base)};
 }
 const candidate=(base:ReturnType<typeof scene>)=>({label:'A',title:'预览',scene:base,explanation:'待核对',warnings:[],commands:[]});
 it('accepted note clears checkpoint, blocks stale publish and stale proposal after revised finish',async()=>{
  const x=await setup(),key={projectId:x.project.id,id:x.id,claim:x.claim};
  expect(await f.backend.agent!(owner,'take_notes',key)).toMatchObject({notes:[],steerTotal:0});
  const first=await f.backend.agent!(owner,'checkpoint',{...key,steerTotal:0,candidates:[candidate(x.base)]});
  const oldId=first.candidates[0].proposal.id;
  const noted=await f.backend.agent!(owner,'note',{projectId:x.project.id,id:x.id,note:'改为40人'});
  expect(noted.accepted).toBe(true);expect(noted.candidates).toEqual([]);
  await expect(f.backend.agent!(owner,'checkpoint',{...key,steerTotal:0,candidates:[candidate(x.base)]})).rejects.toMatchObject({code:'AGENT_STEERING_CHANGED'});
  await expect(f.backend.agent!(owner,'finish',{...key,steerTotal:0})).rejects.toMatchObject({code:'AGENT_STEERING_CHANGED'});
  expect(await f.backend.agent!(owner,'take_notes',key)).toMatchObject({notes:['改为40人'],steerTotal:1});
  await f.backend.agent!(owner,'checkpoint',{...key,steerTotal:1,candidates:[candidate(x.base)]});
  const finished=await f.backend.agent!(owner,'finish',{...key,steerTotal:1});expect(finished.state).toBe('complete');
  await expect(f.rpc(owner,'proposals.apply',{projectId:x.project.id,proposalId:oldId,sessionId:session,generation:x.input.generation,expectedRevision:0,baseHash:x.baseHash})).rejects.toMatchObject({code:'STALE_PROPOSAL'});
  expect((await f.rpc(owner,'projects.get',{projectId:x.project.id})).revision).toBe(0);
 });
 it('rejects other actors, bad claims, and stale versions without consuming notes',async()=>{
  const x=await setup(),key={projectId:x.project.id,id:x.id,claim:x.claim};
  await expect(f.backend.agent!(outsider,'note',{projectId:x.project.id,id:x.id,note:'改为40人'})).rejects.toThrow();
  await expect(f.backend.agent!(editor,'note',{projectId:x.project.id,id:x.id,note:'改为40人'})).rejects.toThrow();
  await f.backend.agent!(owner,'note',{projectId:x.project.id,id:x.id,note:'改为40人'});
  await expect(f.backend.agent!(owner,'take_notes',{...key,claim:crypto.randomUUID()})).rejects.toThrow();
  await expect(f.backend.agent!(owner,'finish',{...key,steerTotal:1})).rejects.toMatchObject({code:'AGENT_STEERING_CHANGED'});
  expect(await f.backend.agent!(owner,'take_notes',key)).toMatchObject({notes:['改为40人'],steerTotal:1});
  await expect(f.backend.agent!(owner,'finish',{...key,steerTotal:0})).rejects.toMatchObject({code:'AGENT_STEERING_CHANGED'});
  await f.backend.agent!(owner,'cancel',{projectId:x.project.id,id:x.id});
 });
 it('serializes a simultaneous accepted note and finish so neither can silently supersede the other',async()=>{
  const x=await setup(),key={projectId:x.project.id,id:x.id,claim:x.claim};
  await f.backend.agent!(owner,'take_notes',key);
  await f.backend.agent!(owner,'checkpoint',{...key,steerTotal:0,candidates:[candidate(x.base)]});
  const [noted,finished]=await Promise.allSettled([
   f.backend.agent!(owner,'note',{projectId:x.project.id,id:x.id,note:'改为40人'}),
   f.backend.agent!(owner,'finish',{...key,steerTotal:0}),
  ]);
  const run=await f.backend.agent!(owner,'get',{projectId:x.project.id,id:x.id});
  if(noted.status==='fulfilled'){
   expect(finished.status).toBe('rejected');expect(run.state).not.toBe('complete');expect(run.candidates).toEqual([]);
   await f.backend.agent!(owner,'cancel',{projectId:x.project.id,id:x.id});
  }else{
   expect(finished.status).toBe('fulfilled');expect(run.state).toBe('complete');expect(run.steerTotal).toBe(0);
  }
 });
 it('rejects a full steering queue without dropping an acknowledged request',async()=>{
  const x=await setup(),key={projectId:x.project.id,id:x.id,claim:x.claim};
  for(let index=1;index<=8;index++)await f.backend.agent!(owner,'note',{projectId:x.project.id,id:x.id,note:`要求${index}`});
  await expect(f.backend.agent!(owner,'note',{projectId:x.project.id,id:x.id,note:'要求9'})).rejects.toMatchObject({code:'AGENT_STEERING_QUEUE_FULL'});
  const pending=await f.backend.agent!(owner,'take_notes',key);
  expect(pending.steerTotal).toBe(8);expect(pending.notes).toEqual(Array.from({length:8},(_,index)=>`要求${index+1}`));
  await f.backend.agent!(owner,'cancel',{projectId:x.project.id,id:x.id});
 });
});
