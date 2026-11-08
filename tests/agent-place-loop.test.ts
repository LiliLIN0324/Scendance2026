import {afterAll,beforeAll,describe,expect,it,vi} from 'vitest';
import {createApi} from '../supabase/functions/_shared/api.ts';
import {agentRunRequestSchema,agentRunSchema} from '../supabase/functions/_shared/agent-contract.ts';
import {database,owner,scene,session,studio} from './fixtures.ts';

const settings:Record<string,string>={AGENT_CHAT_PROFILE:'minimax',MINIMAX_AGENT_TOOLS_ENABLED:'1',AGENT_CHAT_BASE_URL:'https://api.minimax.cn/v1',AGENT_CHAT_KEY:'fixture',AGENT_CHAT_MODEL:'MiniMax-M3.1-Flash',AGENT_PLACE_SEARCH_ENABLED:'1',AMAP_KEY:'fixture-map-only'};
const reply=(id:string,name:string,args:unknown)=>Response.json({base_resp:{status_code:0},choices:[{finish_reason:'tool_calls',message:{role:'assistant',content:null,tool_calls:[{id,type:'function',function:{name,arguments:JSON.stringify(args)}}]}}]});
const submit=()=>reply('done','submit_candidates',{candidates:[{title:'地点参考',explanation:'仅为地点信息，场地条件需进一步确认。',commands:[]}]});
describe('opt-in place lookup within the agent loop',()=>{
 let f:Awaited<ReturnType<typeof database>>;
 beforeAll(async()=>{f=await database();},30000);afterAll(async()=>{await f.db.close();});
 async function run(fetcher:typeof fetch,overrides:Record<string,string|undefined>={}){
  const base=scene(),project=await f.rpc(owner,'projects.create',{studioId:studio,name:'地点测试',scene:base});
  const lease=await f.rpc(owner,'lease.acquire',{projectId:project.id,sessionId:session});
  const input=agentRunRequestSchema.parse({requestId:crypto.randomUUID(),sessionId:session,generation:lease.generation,expectedRevision:0,localRevision:0,scene:base,selectedIds:[],instruction:'查找杭州的活动地点',executionMode:'preview'});
  const response=await createApi(f.backend,key=>Object.hasOwn(overrides,key)?overrides[key]:settings[key],fetcher)(new Request(`https://api.test/projects/${project.id}/agent-runs`,{method:'POST',headers:{authorization:`Bearer ${owner}`,'content-type':'application/json'},body:JSON.stringify(input)}));
  expect(response.status).toBe(202);return agentRunSchema.parse(await response.json());
 }
 it('returns the location result to the model with source and unknown conditions',async()=>{
  let modelCalls=0,mapCalls=0,observation:unknown;
  const fetcher=vi.fn<typeof fetch>().mockImplementation(async(input,init)=>{
   const url=new URL(String(input));
   if(url.hostname==='restapi.amap.com'){mapCalls++;expect(url.pathname).toBe('/v3/place/text');return Response.json({status:'1',pois:[{id:'1',name:'活动中心',address:'杭州',location:'120.12,30.22'}]});}
   expect(url.hostname).toBe('api.minimax.cn');const body=JSON.parse(String(init?.body));modelCalls++;
   expect(body.tools.map((tool:{function:{name:string}})=>tool.function.name)).toContain('search_places');
   if(modelCalls===1)return reply('place-1','search_places',{query:'杭州活动中心'});
   observation=JSON.parse(body.messages.find((message:{role:string})=>message.role==='tool').content);return submit();
  });
  const result=await run(fetcher);expect(result.state).toBe('complete');expect(modelCalls).toBe(2);expect(mapCalls).toBe(1);
  expect(observation).toMatchObject({source:'高德地图地点搜索',places:[{name:'活动中心',lng:120.12,lat:30.22}]});
  expect(JSON.stringify(observation)).toContain('未核验');expect(JSON.stringify(result)).not.toContain('fixture-map-only');
 },30000);
 it('does not advertise the tool or access the map provider without configuration',async()=>{
  const fetcher=vi.fn<typeof fetch>().mockImplementation(async(input,init)=>{
   expect(new URL(String(input)).hostname).toBe('api.minimax.cn');
   const body=JSON.parse(String(init?.body));expect(body.tools.map((tool:{function:{name:string}})=>tool.function.name)).not.toContain('search_places');
   return reply('bad','search_places',{query:'杭州'});
  });
  const result=await run(fetcher,{AGENT_PLACE_SEARCH_ENABLED:undefined});expect(result.state).toBe('failed');expect(fetcher).toHaveBeenCalledOnce();
 },30000);
 it('rejects a URL-shaped query before contacting the map provider',async()=>{
  let calls=0,observation:unknown;
  const fetcher=vi.fn<typeof fetch>().mockImplementation(async(input,init)=>{
   expect(new URL(String(input)).hostname).toBe('api.minimax.cn');calls++;
   if(calls===1)return reply('bad','search_places',{query:'https://evil.example/'});
   observation=JSON.parse(JSON.parse(String(init?.body)).messages.find((message:{role:string})=>message.role==='tool').content);
   return submit();
  });
  const result=await run(fetcher);expect(result.state).toBe('complete');expect(calls).toBe(2);
  expect(observation).toMatchObject({code:'INVALID_TOOL_INPUT'});
 },30000);
 it('returns a generic tool failure when the external provider fails',async()=>{
  let modelCalls=0,mapCalls=0,observation:unknown;
  const fetcher=vi.fn<typeof fetch>().mockImplementation(async(input,init)=>{
   if(new URL(String(input)).hostname==='restapi.amap.com'){mapCalls++;return new Response('private provider text',{status:502});}
   modelCalls++;if(modelCalls===1)return reply('place-1','search_places',{query:'杭州活动中心'});
   observation=JSON.parse(JSON.parse(String(init?.body)).messages.find((message:{role:string})=>message.role==='tool').content);return submit();
  });
  const result=await run(fetcher);expect(result.state).toBe('complete');expect(modelCalls).toBe(2);expect(mapCalls).toBe(1);
  expect(observation).toMatchObject({code:'PLACE_SEARCH_FAILED'});expect(JSON.stringify(observation)).not.toContain('private provider text');
 },30000);
});
