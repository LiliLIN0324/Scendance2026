import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {database,owner,session,scene,studio} from './fixtures.ts';
import {agentRunRequestSchema} from '../supabase/functions/_shared/agent-contract.ts';
import {sceneHash} from '../supabase/functions/_shared/domain.ts';
import {applyWithPreviewGuardPrototype} from './fixtures/annotation-preview-guard.prototype.ts';

describe('local-only annotation apply guard prototype',()=>{
 let f:Awaited<ReturnType<typeof database>>;
 beforeAll(async()=>{f=await database(undefined,{excludeMigrations:['20261109160000_annotation_preview_guard.sql']});},30000);afterAll(async()=>{await f.db.close();});
 async function setup(annotated:boolean,warning=false){
  const base=scene(),project=await f.rpc(owner,'projects.create',{studioId:studio,name:'synthetic guard',scene:base});
  const lease=await f.rpc(owner,'lease.acquire',{projectId:project.id,sessionId:session});
  const context={brief:'',acceptedDecisions:[],recentMessages:[],...(annotated?{annotationObservation:{status:'unavailable' as const}}:{})};
  const input=agentRunRequestSchema.parse({requestId:crypto.randomUUID(),sessionId:session,generation:lease.generation,expectedRevision:0,localRevision:0,scene:base,selectedIds:[],instruction:'fixture',context,executionMode:'preview'});
  const hash=await sceneHash(base),created=await f.backend.agent!(owner,'create',{projectId:project.id,input,fingerprint:'a'.repeat(64),baseHash:hash,executionMode:'preview'});
  const started=await f.backend.agent!(owner,'start',{projectId:project.id,id:created.id});
  const finished=await f.backend.agent!(owner,'finish',{projectId:project.id,id:created.id,claim:started.claim,steerTotal:0,candidates:[{label:'A',title:'fixture',scene:base,explanation:'fixture',warnings:warning?[{code:'ANNOTATION_PREVIEW_ONLY',ids:[]}]:[],commands:[]}]});
  return {project,input,body:{projectId:project.id,proposalId:finished.candidates[0].proposal.id,sessionId:session,generation:lease.generation,expectedRevision:0,localRevision:0,baseHash:hash}};
 }
 it('blocks an annotated run even if its marker is absent',async()=>{
  const s=await setup(true);await expect(applyWithPreviewGuardPrototype(f.db,owner,s.body)).rejects.toThrow('ANNOTATION_PREVIEW_ONLY');
  expect((await f.rpc(owner,'projects.get',{projectId:s.project.id})).revision).toBe(0);
 });
 it('allows a linked old run with no observation and blocks an explicit marker',async()=>{
  const old=await setup(false);await expect(applyWithPreviewGuardPrototype(f.db,owner,old.body)).resolves.toMatchObject({revision:1});
  const marked=await setup(false,true);await expect(applyWithPreviewGuardPrototype(f.db,owner,marked.body)).rejects.toThrow('ANNOTATION_PREVIEW_ONLY');
 });
 it('demonstrates the old entry point still bypasses this uninstalled prototype',async()=>{
  const s=await setup(true);await expect(f.rpc(owner,'proposals.apply',s.body)).resolves.toMatchObject({revision:1});
 });
 it('demonstrates that a deleted run removes the evidence needed to distinguish an annotated proposal',async()=>{
  const s=await setup(true);
  // The current foreign key cascades from a deleted run to the association,
  // while the proposal itself remains. This models source evidence loss.
  await f.db.query('delete from scene_private.agent_runs where id=(select run_id from scene_private.agent_proposals where proposal_id=$1)',[s.body.proposalId]);
  await expect(applyWithPreviewGuardPrototype(f.db,owner,s.body)).resolves.toMatchObject({revision:1});
 });
});
