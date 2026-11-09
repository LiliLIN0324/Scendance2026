import {afterAll,beforeAll,describe,expect,it,vi} from 'vitest';
import {createApi} from '../supabase/functions/_shared/api.ts';
import {agentRunRequestSchema,agentRunSchema} from '../supabase/functions/_shared/agent-contract.ts';
import {createParametricAsset} from '../supabase/functions/_shared/parametric.ts';
import {database,owner,scene,session,studio,chair} from './fixtures.ts';

const settings:Record<string,string>={AGENT_CHAT_PROFILE:'minimax',MINIMAX_AGENT_TOOLS_ENABLED:'1',AGENT_CHAT_BASE_URL:'https://api.minimax.cn/v1',AGENT_CHAT_KEY:'fixture',AGENT_CHAT_MODEL:'MiniMax-M3.1-Flash'};
const call=(id:string,name:string,args:unknown,index=0)=>({id,type:'function',index,function:{name,arguments:JSON.stringify(args)}});
const reply=(calls:ReturnType<typeof call>[])=>new Response(JSON.stringify({base_resp:{status_code:0},choices:[{finish_reason:'tool_calls',message:{role:'assistant',content:null,reasoning_content:'private reasoning',tool_calls:calls}}],usage:{total_tokens:10}}));
const empty={title:'待审阅',explanation:'请先核对。',commands:[]};

describe('MiniMax receives the configured Agent tool surface',()=>{
 let f:Awaited<ReturnType<typeof database>>;
 const files=new Map<string,Uint8Array>();
 beforeAll(async()=>{f=await database();f.backend.upload=async(path,bytes)=>{files.set(path,bytes.slice());};f.backend.readSourceBytes=async path=>files.get(path)!;},30000);
 afterAll(async()=>{await f.db.close();});
 async function setup(draft=scene(),extra:Record<string,unknown>={}){
  const project=await f.rpc(owner,'projects.create',{studioId:studio,name:'Tool parity',scene:draft});
  const lease=await f.rpc(owner,'lease.acquire',{projectId:project.id,sessionId:session});
  return {projectId:project.id,...agentRunRequestSchema.parse({requestId:crypto.randomUUID(),sessionId:session,generation:lease.generation,expectedRevision:0,localRevision:0,scene:draft,selectedIds:[],instruction:'为活动准备数字物料并展示预览',executionMode:'preview',...extra})};
 }
 async function run(i:Awaited<ReturnType<typeof setup>>,fetcher:typeof fetch,over:Record<string,string>={}){
  const {projectId,...body}=i,config={...settings,...over};
  const response=await createApi(f.backend,key=>config[key],fetcher)(new Request(`https://api.test/projects/${projectId}/agent-runs`,{method:'POST',headers:{authorization:`Bearer ${owner}`,'content-type':'application/json'},body:JSON.stringify(body)}));
  expect(response.status).toBe(202);return agentRunSchema.parse(await response.json());
 }
 it('creates a parametric resource and previews it without changing the scene',async()=>{
  const i=await setup();let createdId='';
  const fetcher=vi.fn(async(_url:RequestInfo|URL,init?:RequestInit)=>{
   const body=JSON.parse(String(init?.body));
   expect(body.tools.map((t:{function:{name:string}})=>t.function.name)).toEqual(expect.arrayContaining(['create_parametric_model','customize_material']));
   expect(body.tools.map((t:{function:{name:string}})=>t.function.name)).not.toContain('start_lux3d_model');
   if(fetcher.mock.calls.length===1)return reply([call('create','create_parametric_model',{parameters:{family:'table',width:1.2,depth:0.7,height:0.75}})]);
   const result=JSON.parse(body.messages.filter((m:{role:string})=>m.role==='tool').at(-1).content);
   createdId=result.items[0][0];
   return reply([call('submit','submit_candidates',{candidates:[{title:'数字桌子',explanation:'模型尺寸待核验。',commands:[{op:'add_resource',resourceId:createdId,position:{x:3,z:3},rotation:0}]}]})]);
  });
  const result=await run(i,fetcher);
  expect(createdId).toBeTruthy();expect(result.state).toBe('complete');expect(result.candidates[0]?.proposal.candidate.objects).toHaveLength(1);
  expect((await f.rpc(owner,'projects.get',{projectId:i.projectId})).scene).toEqual(i.scene);
 });
 it('creates a material variant only for the selected object and keeps the scene as preview',async()=>{
  const original=await createParametricAsset(f.backend,owner,studio,crypto.randomUUID(),{family:'table',width:1.2,depth:0.7,height:0.75});
  const object={...chair(),materialId:'asset' as const,assetId:original.asset.id,size:{width:1.2,depth:0.7,height:0.75},position:{x:3,z:3}};
  const draft={...scene(),objects:[object]},i=await setup(draft,{selectedIds:[object.id]});let variant='';
  const fetcher=vi.fn(async(_url:RequestInfo|URL,init?:RequestInit)=>{
   const body=JSON.parse(String(init?.body));
   if(fetcher.mock.calls.length===1)return reply([call('inspect','inspect_materials',{resourceId:original.asset.id})]);
   if(fetcher.mock.calls.length===2)return reply([call('variant','customize_material',{resourceId:original.asset.id,objectIds:[object.id],materialIndices:[0],changes:{baseColor:'#808080'}})]);
   const result=JSON.parse(body.messages.filter((m:{role:string})=>m.role==='tool').at(-1).content);variant=result.items[0][0];
   return reply([call('submit','submit_candidates',{candidates:[{title:'材质草案',explanation:'只调整选中对象。',commands:[{op:'replace_resource',id:object.id,resourceId:variant}]}]})]);
  });
  const result=await run(i,fetcher);
  expect(result.state).toBe('complete');expect(variant).toBeTruthy();
  expect(result.candidates[0]?.proposal.candidate.objects[0]?.assetId).not.toBe(original.asset.id);
  expect((await f.rpc(owner,'projects.get',{projectId:i.projectId})).scene).toEqual(draft);
 });
 it('offers configured Aholo generation and queues a job without applying it',async()=>{
  const i=await setup(),over={GENERATION_MAX_TASK_CENTS:'100',LUX3D_API_KEY:'fixture-lux',LUX3D_TERMS_URL:'https://example.test/terms',LUX3D_TERMS_REVIEWED_AT:'2026-10-28'};let toolResult:Record<string,unknown>={};
  const fetcher=vi.fn(async(_url:RequestInfo|URL,init?:RequestInit)=>{
   const body=JSON.parse(String(init?.body));expect(body.tools.map((t:{function:{name:string}})=>t.function.name)).toContain('start_lux3d_model');
   if(fetcher.mock.calls.length===1)return reply([call('lux','start_lux3d_model',{prompt:'雕花木质讲台'})]);
   toolResult=JSON.parse(body.messages.filter((m:{role:string})=>m.role==='tool').at(-1).content);
   return reply([call('submit','submit_candidates',{candidates:[empty]})]);
  });
  const result=await run(i,fetcher,over);expect(toolResult).toMatchObject({submitted:true,jobId:expect.any(String)});
  expect(result.state).toBe('complete');expect((await f.rpc(owner,'projects.get',{projectId:i.projectId})).scene).toEqual(i.scene);
  const jobs=await f.db.query<{n:number}>('select count(*)::int as n from scene_private.generation_jobs where id=$1',[toolResult.jobId]);expect(jobs.rows[0]?.n).toBe(1);
 });
 it.each(['','0','1.5'])('does not offer Aholo when the task budget is invalid (%s)',async budget=>{
  const i=await setup(),over={GENERATION_MAX_TASK_CENTS:budget,LUX3D_API_KEY:'fixture-lux',LUX3D_TERMS_URL:'https://example.test/terms',LUX3D_TERMS_REVIEWED_AT:'2026-10-28'};
  const fetcher=vi.fn(async(_url:RequestInfo|URL,init?:RequestInit)=>{
   const body=JSON.parse(String(init?.body));
   expect(body.tools.map((t:{function:{name:string}})=>t.function.name)).not.toContain('start_lux3d_model');
   return reply([call('submit','submit_candidates',{candidates:[empty]})]);
  });
  const before=await f.db.query<{n:number}>('select count(*)::int as n from scene_private.generation_jobs');
  const result=await run(i,fetcher,over);
  const after=await f.db.query<{n:number}>('select count(*)::int as n from scene_private.generation_jobs');
  expect(result.state).toBe('complete');expect(after.rows[0]?.n).toBe(before.rows[0]?.n);
  expect((await f.rpc(owner,'projects.get',{projectId:i.projectId})).scene).toEqual(i.scene);
 });
 it('rejects an unoffered Aholo call without creating a job',async()=>{
  const i=await setup(),over={LUX3D_API_KEY:'fixture-lux',LUX3D_TERMS_URL:'https://example.test/terms',LUX3D_TERMS_REVIEWED_AT:'2026-10-28'};
  const before=await f.db.query<{n:number}>('select count(*)::int as n from scene_private.generation_jobs');
  const result=await run(i,vi.fn(async()=>reply([call('lux-unoffered','start_lux3d_model',{prompt:'虚构讲台'})])),over);
  const after=await f.db.query<{n:number}>('select count(*)::int as n from scene_private.generation_jobs');
  expect(result.state).toBe('failed');expect(after.rows[0]?.n).toBe(before.rows[0]?.n);
  expect((await f.rpc(owner,'projects.get',{projectId:i.projectId})).scene).toEqual(i.scene);
 });
 it('stops the rest of an old side-effect batch when a new user instruction arrives',async()=>{
  const i=await setup();const previous=f.backend.upload;let injected=false;const before=(await f.rpc(owner,'assets.list')).length;
  f.backend.upload=async(path,bytes)=>{files.set(path,bytes.slice());if(!injected){injected=true;const current=await f.backend.agent!(owner,'by_request',{projectId:i.projectId,requestId:i.requestId});await f.backend.agent!(owner,'note',{projectId:i.projectId,id:current.id,note:'不要再创建其他物料'});}};
  let messages:Array<{role:string;content?:string|null;reasoning_content?:string;tool_call_id?:string;tool_calls?:Array<{id:string}>}>=[];
  const fetcher=vi.fn(async(_url:RequestInfo|URL,init?:RequestInit)=>{
   if(fetcher.mock.calls.length===1)return reply([call('first','create_parametric_model',{parameters:{family:'table',width:1,depth:0.7,height:0.75}},0),call('second','create_parametric_model',{parameters:{family:'table',width:2,depth:0.7,height:0.75}},1)]);
   messages=JSON.parse(String(init?.body)).messages;
   return reply([call('finish','submit_candidates',{candidates:[empty]})]);
  });
  try{
   const result=await run(i,fetcher);expect(result.state).toBe('complete');expect(injected).toBe(true);
   expect((await f.rpc(owner,'assets.list')).length).toBe(before+1);
   const first=messages.findIndex(m=>m.role==='tool'&&m.tool_call_id==='first'),second=messages.findIndex(m=>m.role==='tool'&&m.tool_call_id==='second');
   const note=messages.findIndex(m=>m.role==='user'&&m.content?.includes('不要再创建其他物料'));
   const assistant=messages.find(m=>m.role==='assistant'&&m.tool_calls?.some(c=>c.id==='first'));
   expect(assistant?.reasoning_content).toBe('private reasoning');expect(assistant?.tool_calls?.map(c=>c.id)).toEqual(['first','second']);
   expect(first).toBeGreaterThan(-1);expect(second).toBe(first+1);expect(JSON.parse(messages[second]!.content!)).toEqual({stopped:true});expect(note).toBeGreaterThan(second);
   expect((await f.rpc(owner,'projects.get',{projectId:i.projectId})).scene).toEqual(i.scene);
  }finally{f.backend.upload=previous;}
 });
});
