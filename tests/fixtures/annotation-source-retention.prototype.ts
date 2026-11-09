import {createHash,createHmac,timingSafeEqual} from 'node:crypto';
import {canonical,sceneHash,sceneSchema} from '../../supabase/functions/_shared/domain.ts';
import {agentRunRequestSchema} from '../../supabase/functions/_shared/agent-contract.ts';
import type {database} from '../fixtures.ts';

/** Local experiment only; the fixture key and privileged calls are not a product design. */
const key='fixture-source-retention-not-a-production-key',CODE='ANNOTATION_SOURCE_FIXTURE_V1';
type Database=Awaited<ReturnType<typeof database>>['db'];
type Origin='annotation'|'legacy';
type Binding={projectId:string;proposalId:string;actor:string;sessionId:string;generation:number;baseRevision:number;localRevision:number;baseHash:string;candidateHash:string;origin:Origin;observationDigest:string;inputDigest:string};
type Proposal={id:string;project_id:string;user_id:string;session_id:string;generation:number|string;base_revision:number|string;local_revision:number|string;base_hash:string;base_scene:unknown;candidate:unknown;warnings:unknown;applied_at:unknown};
const signature=(value:Binding)=>createHmac('sha256',key).update(canonical(value)).digest('hex');
const inputHash=(input:unknown)=>createHash('sha256').update(canonical(input)).digest('hex');
async function bindingOf(proposal:Proposal,origin:Origin,observationDigest:string,inputDigest:string):Promise<Binding>{
 const base=sceneSchema.parse(proposal.base_scene),candidate=sceneSchema.parse(proposal.candidate),baseHash=await sceneHash(base);
 if(baseHash!==proposal.base_hash)throw new Error('SOURCE_BINDING_INVALID');
 return {projectId:proposal.project_id,proposalId:proposal.id,actor:proposal.user_id,sessionId:proposal.session_id,generation:Number(proposal.generation),baseRevision:Number(proposal.base_revision),localRevision:Number(proposal.local_revision),baseHash,candidateHash:await sceneHash(candidate),origin,observationDigest,inputDigest};
}
const marker=(binding:Binding)=>({code:CODE,ids:[`origin:${binding.origin}`,`observation:${binding.observationDigest}`,`input:${binding.inputDigest}`,`proof:${signature(binding)}`]});
/** Simulates a future controlled checkpoint + stamp in ONE transaction. */
export async function checkpointWithSourcePrototype(db:Database,actor:string,data:{projectId:string;id:string;claim:string;steerTotal:number;candidates:unknown[]},fault?:{failBeforeCommit?:boolean}){
 return db.transaction(async tx=>{
  const rows=await tx.query<{input:unknown}>('select input from scene_private.agent_runs where id=$1 and project_id=$2 and owner_id=$3 for update',[data.id,data.projectId,actor]);
  const source=agentRunRequestSchema.safeParse(rows.rows[0]?.input);
  if(!source.success)throw new Error('SOURCE_UNKNOWN');
  const origin:Origin=Object.prototype.hasOwnProperty.call(source.data.context,'annotationObservation')?'annotation':'legacy';
  const observationDigest=origin==='annotation'?createHash('sha256').update(canonical(source.data.context.annotationObservation)).digest('hex'):'absent';
  const result=await tx.query<{result:{candidates:Array<{label:string;title:string;proposal:Proposal}>}}>('select public.agent_steering_guard_rpc($1,$2,$3::jsonb) as result',[actor,'finish',JSON.stringify(data)]);
  const run=result.rows[0]?.result;if(!run||!Array.isArray(run.candidates))throw new Error('SOURCE_UNKNOWN');
  for(const candidate of run.candidates){
   const proposal=candidate.proposal;if(!Array.isArray(proposal.warnings))throw new Error('SOURCE_UNKNOWN');
   const warnings=proposal.warnings.filter((w:unknown)=>!(w&&typeof w==='object'&&(w as {code?:unknown}).code===CODE));
   warnings.push(marker(await bindingOf(proposal,origin,observationDigest,inputHash(source.data))));
   await tx.query('update scene_private.proposals set warnings=$1::jsonb where id=$2',[JSON.stringify(warnings),proposal.id]);
   candidate.proposal.warnings=warnings;
  }
  // The run view contains an independent candidate JSON copy: update it in the
  // same fixture transaction instead of leaving a contradictory copy behind.
  await tx.query('update scene_private.agent_runs set candidates=$1::jsonb where id=$2',[JSON.stringify(run.candidates),data.id]);
  if(fault?.failBeforeCommit)throw new Error('FIXTURE_STAMP_FAILED');
  return run;
 });
}

/** Simulates a guarded shared entry for old and new callers; it is not installed. */
export async function applyWithRetainedSourcePrototype(db:Database,actor:string,body:Record<string,unknown>){
 return db.transaction(async tx=>{
  const linked=await tx.query<{input:unknown}>('select a.input from scene_private.agent_runs a join scene_private.agent_proposals l on l.run_id=a.id where l.proposal_id=$1 for update of a',[body.proposalId]);
  const projects=await tx.query('select id from scene_private.projects where id=$1 and deleted_at is null for update',[body.projectId]);
  if(projects.rows.length!==1)throw new Error('SOURCE_UNKNOWN');
  const rows=await tx.query<Proposal>('select id,project_id,user_id,session_id,generation,base_revision,local_revision,base_hash,base_scene,candidate,warnings,applied_at from scene_private.proposals where id=$1 for update',[body.proposalId]);
  const proposal=rows.rows[0];if(rows.rows.length!==1||!proposal||proposal.project_id!==body.projectId||proposal.user_id!==actor||!Array.isArray(proposal.warnings))throw new Error('SOURCE_UNKNOWN');
  const entries=proposal.warnings.filter((w:unknown)=>!!w&&typeof w==='object'&&(w as {code?:unknown}).code===CODE);
  if(entries.length!==1||Object.keys(entries[0] as object).sort().join(',')!=='code,ids')throw new Error('SOURCE_UNKNOWN');
  const ids=(entries[0] as {ids?:unknown}).ids;
  if(!Array.isArray(ids)||ids.length!==4||typeof ids[0]!=='string'||!['origin:annotation','origin:legacy'].includes(ids[0])||typeof ids[1]!=='string'||!/^observation:(?:absent|[0-9a-f]{64})$/.test(ids[1])||typeof ids[2]!=='string'||!/^input:[0-9a-f]{64}$/.test(ids[2])||typeof ids[3]!=='string'||!/^proof:[0-9a-f]{64}$/.test(ids[3]))throw new Error('SOURCE_UNKNOWN');
  const origin:Origin=ids[0]==='origin:annotation'?'annotation':'legacy',observationDigest=ids[1].slice('observation:'.length);
  if((origin==='legacy')!==(observationDigest==='absent'))throw new Error('SOURCE_UNKNOWN');
  const inputDigest=ids[2].slice(6),expected=signature(await bindingOf(proposal,origin,observationDigest,inputDigest));
  if(!timingSafeEqual(Buffer.from(ids[3].slice(6),'hex'),Buffer.from(expected,'hex')))throw new Error('SOURCE_UNKNOWN');
  if(linked.rows.length>1)throw new Error('SOURCE_UNKNOWN');
  if(linked.rows.length===1){const input=agentRunRequestSchema.safeParse(linked.rows[0]!.input);if(!input.success||inputHash(input.data)!==inputDigest)throw new Error('SOURCE_UNKNOWN');}
  if(origin==='annotation')throw new Error('ANNOTATION_PREVIEW_ONLY');
  const result=await tx.query<{result:unknown}>('select public.scene_rpc($1,$2,$3::jsonb) as result',[actor,'proposals.apply',JSON.stringify(body)]);
  return result.rows[0]?.result;
 });
}
