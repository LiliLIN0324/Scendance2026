import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {database,owner,session,scene,studio} from './fixtures.ts';
import {agentRunRequestSchema} from '../supabase/functions/_shared/agent-contract.ts';
import {sceneHash} from '../supabase/functions/_shared/domain.ts';
import {createHash} from 'node:crypto';
import {canonical} from '../supabase/functions/_shared/domain.ts';
import {applyWithRetainedSourcePrototype,checkpointWithSourcePrototype} from './fixtures/annotation-source-retention.prototype.ts';

describe('local-only retained-source guard prototype',()=>{
 let f:Awaited<ReturnType<typeof database>>;
 beforeAll(async()=>{f=await database(undefined,{excludeMigrations:['20261109160000_annotation_preview_guard.sql']});},30000);afterAll(async()=>{await f.db.close();});
 async function begin(annotated:boolean){
  const base=scene(),project=await f.rpc(owner,'projects.create',{studioId:studio,name:'synthetic source retention',scene:base});
  const lease=await f.rpc(owner,'lease.acquire',{projectId:project.id,sessionId:session});
  const context={brief:'',acceptedDecisions:[],recentMessages:[],...(annotated?{annotationObservation:{status:'unavailable' as const}}:{})};
  const input=agentRunRequestSchema.parse({requestId:crypto.randomUUID(),sessionId:session,generation:lease.generation,expectedRevision:0,localRevision:0,scene:base,selectedIds:[],instruction:'fixture',context,executionMode:'preview'});
  const hash=await sceneHash(base),created=await f.backend.agent!(owner,'create',{projectId:project.id,input,fingerprint:'b'.repeat(64),baseHash:hash,executionMode:'preview'});
  const started=await f.backend.agent!(owner,'start',{projectId:project.id,id:created.id});
  return {base,project,lease,hash,runId:created.id,checkpoint:{projectId:project.id,id:created.id,claim:started.claim,steerTotal:0,candidates:[{label:'A',title:'fixture',scene:base,explanation:'fixture',warnings:[] as Array<{code:string;ids:string[]}>,commands:[]}]}};
 }
 async function finish(value:Awaited<ReturnType<typeof begin>>){
  const result=await checkpointWithSourcePrototype(f.db,owner,value.checkpoint),proposalId=result.candidates[0]!.proposal.id;
  return {...value,proposalId,body:{projectId:value.project.id,proposalId,sessionId:session,generation:value.lease.generation,expectedRevision:0,localRevision:0,baseHash:value.hash}};
 }
 it('preserves annotated provenance after deleting the run and its cascading link',async()=>{
  const value=await finish(await begin(true));
  const warnings=(await f.db.query<{warnings:Array<{ids:string[]}>}>('select warnings from scene_private.proposals where id=$1',[value.proposalId])).rows[0]!.warnings;
  const digest=createHash('sha256').update(canonical({status:'unavailable'})).digest('hex');expect(warnings[0]?.ids).toContain(`observation:${digest}`);
  expect(JSON.stringify(warnings)).not.toContain('unavailable');
  await f.db.query('delete from scene_private.agent_runs where id=$1',[value.runId]);
  expect((await f.db.query('select * from scene_private.agent_proposals where proposal_id=$1',[value.proposalId])).rows).toHaveLength(0);
  expect((await f.db.query('select * from scene_private.proposals where id=$1',[value.proposalId])).rows).toHaveLength(1);
  await expect(applyWithRetainedSourcePrototype(f.db,owner,value.body)).rejects.toThrow('ANNOTATION_PREVIEW_ONLY');
  expect((await f.rpc(owner,'projects.get',{projectId:value.project.id})).revision).toBe(0);
 });
 it('keeps a verifiably legacy candidate usable after its run is removed',async()=>{
  const value=await finish(await begin(false));await f.db.query('delete from scene_private.agent_runs where id=$1',[value.runId]);
  await expect(applyWithRetainedSourcePrototype(f.db,owner,value.body)).resolves.toMatchObject({revision:1});
  await expect(applyWithRetainedSourcePrototype(f.db,owner,value.body)).rejects.toBeTruthy();
 });
 it('does not infer that an unmarked proposal or a tampered source is legacy',async()=>{
  const value=await finish(await begin(true));
  await f.db.query("update scene_private.proposals set warnings='[]'::jsonb where id=$1",[value.proposalId]);
  await f.db.query('delete from scene_private.agent_runs where id=$1',[value.runId]);
  await expect(applyWithRetainedSourcePrototype(f.db,owner,value.body)).rejects.toThrow('SOURCE_UNKNOWN');
  const old=await begin(false),proposalId=crypto.randomUUID();
  await f.rpc(owner,'proposals.store',{projectId:old.project.id,sessionId:session,generation:old.lease.generation,expectedRevision:0,localRevision:0,id:proposalId,baseHash:old.hash,scene:old.base,candidate:old.base,explanation:'old',warnings:[]});
  await expect(applyWithRetainedSourcePrototype(f.db,owner,{projectId:old.project.id,proposalId,sessionId:session,generation:old.lease.generation,expectedRevision:0,localRevision:0,baseHash:old.hash})).rejects.toThrow('SOURCE_UNKNOWN');
  await f.backend.agent!(owner,'cancel',{projectId:old.project.id,id:old.runId});
 });
 it('rejects a marker whose annotation origin is relabeled as legacy',async()=>{
  const value=await finish(await begin(true));
  const row=(await f.db.query<{warnings:Array<{code:string;ids:string[]}>}>('select warnings from scene_private.proposals where id=$1',[value.proposalId])).rows[0]!;
  const changed=structuredClone(row.warnings);changed[0]!.ids[0]='origin:legacy';
  await f.db.query('update scene_private.proposals set warnings=$1::jsonb where id=$2',[JSON.stringify(changed),value.proposalId]);
  await f.db.query('delete from scene_private.agent_runs where id=$1',[value.runId]);
  await expect(applyWithRetainedSourcePrototype(f.db,owner,value.body)).rejects.toThrow('SOURCE_UNKNOWN');
 });
 it('rejects a legacy signature copied from a different proposal',async()=>{
  const marked=await finish(await begin(true)),other=await finish(await begin(false));
  const otherWarnings=(await f.db.query<{warnings:unknown}>('select warnings from scene_private.proposals where id=$1',[other.proposalId])).rows[0]!.warnings;
  await f.db.query('update scene_private.proposals set warnings=$1::jsonb where id=$2',[JSON.stringify(otherWarnings),marked.proposalId]);
  await f.db.query('delete from scene_private.agent_runs where id=$1',[marked.runId]);
  await expect(applyWithRetainedSourcePrototype(f.db,owner,marked.body)).rejects.toThrow('SOURCE_UNKNOWN');
  expect((await f.rpc(owner,'projects.get',{projectId:marked.project.id})).revision).toBe(0);
 });
 it('rejects an existing run whose requirements changed after the source was stamped',async()=>{
  const value=await finish(await begin(false));
  await f.db.query("update scene_private.agent_runs set input=jsonb_set(input,'{instruction}',to_jsonb('保留原来的桌子'::text)) where id=$1",[value.runId]);
  await expect(applyWithRetainedSourcePrototype(f.db,owner,value.body)).rejects.toThrow('SOURCE_UNKNOWN');
  expect((await f.rpc(owner,'projects.get',{projectId:value.project.id})).revision).toBe(0);
 });
 it('overwrites an injected same-code warning with the fixture producer source',async()=>{
  const value=await begin(true);
  value.checkpoint.candidates[0]!.warnings=[{code:'ANNOTATION_SOURCE_FIXTURE_V1',ids:['origin:legacy',`proof:${'0'.repeat(64)}`]}];
  const finished=await finish(value);await f.db.query('delete from scene_private.agent_runs where id=$1',[finished.runId]);
  await expect(applyWithRetainedSourcePrototype(f.db,owner,finished.body)).rejects.toThrow('ANNOTATION_PREVIEW_ONLY');
 });
 it('keeps the annotation guard closed when run deletion and application race',async()=>{
  const value=await finish(await begin(true));
  const results=await Promise.allSettled([applyWithRetainedSourcePrototype(f.db,owner,value.body),f.db.query('delete from scene_private.agent_runs where id=$1',[value.runId])]);
  expect(results[0]?.status).toBe('rejected');expect((await f.rpc(owner,'projects.get',{projectId:value.project.id})).revision).toBe(0);
 });
 it('rolls back checkpoint and candidate creation if trusted source stamping fails',async()=>{
  const value=await begin(true);
  await expect(checkpointWithSourcePrototype(f.db,owner,value.checkpoint,{failBeforeCommit:true})).rejects.toThrow('FIXTURE_STAMP_FAILED');
  const run=(await f.db.query<{state:string;candidates:unknown[]}>('select state,candidates from scene_private.agent_runs where id=$1',[value.runId])).rows[0]!;
  expect(run.state).toBe('running');expect(run.candidates).toEqual([]);
  expect((await f.db.query('select id from scene_private.proposals where project_id=$1',[value.project.id])).rows).toHaveLength(0);
  await f.backend.agent!(owner,'cancel',{projectId:value.project.id,id:value.runId});
 });
 it('documents that the existing unmodified old entry bypasses the uninstalled prototype',async()=>{
  const value=await finish(await begin(true));await f.db.query('delete from scene_private.agent_runs where id=$1',[value.runId]);
  await expect(f.rpc(owner,'proposals.apply',value.body)).resolves.toMatchObject({revision:1});
 });
});
