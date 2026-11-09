import type {database} from '../fixtures.ts';
type Database=Awaited<ReturnType<typeof database>>['db'];

/** Local-only experiment, not an installed RPC or an authorization boundary. */
export async function applyWithPreviewGuardPrototype(db:Database,actor:string,body:Record<string,unknown>){
 return db.transaction(async tx=>{
  // Match the existing run→project→proposal order; the real RPC rechecks its
  // own lease and candidate validity before writing.
  const linked=await tx.query<{input:unknown;project_id:string;owner_id:string}>('select a.input,a.project_id,a.owner_id from scene_private.agent_runs a join scene_private.agent_proposals l on l.run_id=a.id where l.proposal_id=$1 for update of a',[body.proposalId]);
  if(linked.rows.length>1)throw new Error('UNKNOWN_PROPOSAL_SOURCE');
  const run=linked.rows[0];
  if(run){
   if(run.owner_id!==actor||run.project_id!==body.projectId||!run.input||typeof run.input!=='object')throw new Error('UNKNOWN_PROPOSAL_SOURCE');
   const context=(run.input as {context?:unknown}).context;
   if(!context||typeof context!=='object'||Array.isArray(context))throw new Error('UNKNOWN_PROPOSAL_SOURCE');
   if(Object.prototype.hasOwnProperty.call(context,'annotationObservation'))throw new Error('ANNOTATION_PREVIEW_ONLY');
  }
  const projects=await tx.query('select id from scene_private.projects where id=$1 and deleted_at is null for update',[body.projectId]);
  if(projects.rows.length!==1)throw new Error('UNKNOWN_PROPOSAL_SOURCE');
  const rows=await tx.query<{project_id:string;user_id:string;warnings:unknown}>('select project_id,user_id,warnings from scene_private.proposals where id=$1 for update',[body.proposalId]);
  const proposal=rows.rows[0];
  if(rows.rows.length!==1||proposal?.project_id!==body.projectId||proposal.user_id!==actor||!Array.isArray(proposal.warnings))throw new Error('UNKNOWN_PROPOSAL_SOURCE');
  if(proposal.warnings.some((warning:unknown)=>!!warning&&typeof warning==='object'&&(warning as {code?:unknown}).code==='ANNOTATION_PREVIEW_ONLY'))throw new Error('ANNOTATION_PREVIEW_ONLY');
  const response=await tx.query<{result:unknown}>('select public.scene_rpc($1,$2,$3::jsonb) as result',[actor,'proposals.apply',JSON.stringify(body)]);
  return response.rows[0]?.result;
 });
}
