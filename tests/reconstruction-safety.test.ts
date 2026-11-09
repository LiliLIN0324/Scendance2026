import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {reconstructionSafetyChecklist} from '../supabase/functions/_shared/reconstruction-safety.ts';
import {reconstructionJobSchema} from '../supabase/functions/_shared/reconstruction-contract.ts';
import {createApi} from '../supabase/functions/_shared/api.ts';
import {database,owner,studio,scene} from './fixtures.ts';

const ids=['entrances_exits','door_swing','scale','egress','fire','accessibility','occupancy'];
describe('reconstruction safety checklist',()=>{
 it('keeps absent and identified doors unknown and never claims deliverability',()=>{
  for(const candidate of [null,{venue:{entrances:[]},structure:{openings:[]}},{venue:{entrances:[]},structure:{openings:[{kind:'door'}]}}]){
   const result=reconstructionSafetyChecklist(candidate);
   expect(result.state).toBe('draft_unverified');expect(result.deliverable).toBe(false);
   expect(result.checks.map(c=>c.id)).toEqual(ids);expect(result.checks.every(c=>c.status==='unknown')).toBe(true);
  }
  expect(reconstructionSafetyChecklist({venue:{entrances:[]},structure:{openings:[]}}).checks[0]?.note).toContain('未记录门或入口');
  expect(reconstructionSafetyChecklist({venue:{entrances:[]},structure:{openings:[{kind:'door'}]}}).checks[0]?.note).toContain('未核验');
 });
 it('preserves compatibility of the existing passthrough reconstruction schema',()=>{
  const job={id:crypto.randomUUID(),state:'needs_review',candidate:null,issues:[],safetyChecklist:reconstructionSafetyChecklist(null)};
  expect(reconstructionJobSchema.parse(job)).toMatchObject(job);
 });
});

describe('reconstruction safety API',()=>{
 let f:Awaited<ReturnType<typeof database>>;
 beforeAll(async()=>{f=await database();},30000);afterAll(async()=>{await f?.db.close();});
 it('annotates an existing job without treating missing doors as not applicable',async()=>{
  const project=await f.rpc(owner,'projects.create',{studioId:studio,name:'重建检查',scene:scene()});const id=crypto.randomUUID();
  const candidate={...scene(),schemaVersion:2,structure:{walls:[],openings:[],columns:[]},sources:[],dimensions:[]};
  await f.db.query("insert into scene_private.reconstruction_jobs(id,project_id,owner_id,request_key,fingerprint,input,base_hash,state,candidate,issues,reserve_cents) values($1,$2,$3,$4,'test','{}','base','needs_review',$5::jsonb,'[]',200)",[id,project.id,owner,crypto.randomUUID(),JSON.stringify(candidate)]);
  const api=createApi(f.backend,()=>undefined);const response=await api(new Request(`https://backend.example/functions/v1/scene-api/projects/${project.id}/reconstructions/${id}`,{headers:{Authorization:`Bearer ${owner}`}}));
  expect(response.status).toBe(200);const body=await response.json();expect(body.safetyChecklist).toMatchObject({state:'draft_unverified',deliverable:false});
  expect(body.safetyChecklist.checks.map((item:{id:string})=>item.id)).toEqual(ids);expect(body.safetyChecklist.checks.every((item:{status:string})=>item.status==='unknown')).toBe(true);
  expect(reconstructionJobSchema.safeParse(body).success).toBe(true);
 });
});
