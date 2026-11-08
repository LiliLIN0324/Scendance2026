import {afterAll,beforeAll,describe,expect,it,vi} from 'vitest';
import {database,owner,studio,session,scene} from './fixtures.ts';
import {createApi} from '../supabase/functions/_shared/api.ts';

const env=(key:string)=>({DEEPSEEK_API_KEY:'fixture',TOKENDANCE_API_KEY:'fixture',AI_MAX_REQUEST_CENTS:'40',HY3_RETIRED:'true'}[key]);
const notice={status:'unverified',scope:'model_generated_text'};
const completion=(content:unknown)=>new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify(content)}}],usage:{total_tokens:10}}));
const toolCompletion=()=>new Response(JSON.stringify({choices:[{finish_reason:'tool_calls',message:{content:null,tool_calls:[{id:crypto.randomUUID(),type:'function',function:{name:'submit_candidates',arguments:JSON.stringify({candidates:[{title:'安全无忧',explanation:'消防部门已验收',commands:[{op:'add',materialId:'table',position:{x:2,z:3},rotation:0,color:'#ffffff'}]}]})}}]}}],usage:{total_tokens:10}}));

describe('model text provenance on actual API responses',()=>{
 let f:Awaited<ReturnType<typeof database>>;
 beforeAll(async()=>{f=await database();},30000);afterAll(async()=>{await f?.db.close();});
 async function project(){const base=scene(),p=await f.rpc(owner,'projects.create',{studioId:studio,name:'模型文字测试',scene:base});const lease=await f.rpc(owner,'lease.acquire',{projectId:p.id,sessionId:session});return {id:p.id,base,generation:lease.generation};}
 function request(api:ReturnType<typeof createApi>,path:string,method='GET',body?:unknown){return api(new Request(`https://api.test${path}`,{method,headers:{authorization:`Bearer ${owner}`,'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})}));}
 it('labels new, idempotent and previously stored agent runs as unverified',async()=>{
  const p=await project(),fetcher=vi.fn(async()=>toolCompletion()),api=createApi(f.backend,env,fetcher);
  const body={requestId:crypto.randomUUID(),sessionId:session,generation:p.generation,expectedRevision:0,localRevision:0,scene:p.base,selectedIds:[],instruction:'给我一个方案',executionMode:'preview'};
  const path=`/projects/${p.id}/agent-runs`,created=await request(api,path,'POST',body);expect(created.status).toBe(202);const value=await created.json();
  expect(value.modelText).toMatchObject(notice);expect(value.candidates[0].proposal.explanation).toBe('消防部门已验收');
  const replay=await request(api,path,'POST',body);expect(replay.status).toBe(200);expect((await replay.json()).modelText).toMatchObject(notice);expect(fetcher).toHaveBeenCalledOnce();
  const rawStored=await f.backend.agent!(owner,'get',{projectId:p.id,id:value.id});expect(rawStored).not.toHaveProperty('modelText');
  const byId=await request(api,`${path}/${value.id}`),byRequest=await request(api,`${path}/by-request/${body.requestId}`);
  expect(byId.status).toBe(200);expect((await byId.json()).modelText).toMatchObject(notice);expect((await byRequest.json()).modelText).toMatchObject(notice);
 });
 it('labels both the first proposal and its stored idempotent replay',async()=>{
  const p=await project(),fetcher=vi.fn(async()=>completion({explanation:'疏散条件完全没问题',commands:[]})),api=createApi(f.backend,env,fetcher);
  const body={requestId:crypto.randomUUID(),sessionId:session,generation:p.generation,expectedRevision:0,localRevision:0,scene:p.base,selectedIds:[],instruction:'检查场景',mode:'modify'};
  const path=`/projects/${p.id}/proposals`,first=await request(api,path,'POST',body);expect(first.status).toBe(201);const value=await first.json();
  expect(value.modelText).toMatchObject(notice);expect(value.explanation).toBe('疏散条件完全没问题');
  const replay=await request(api,path,'POST',body);expect(replay.status).toBe(200);expect((await replay.json()).modelText).toMatchObject(notice);expect(fetcher).toHaveBeenCalledOnce();
 });
});
