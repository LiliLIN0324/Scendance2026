import {describe,expect,it,vi} from 'vitest';
import {agentPlaceSearchEnabled,agentPlaceSearchSchema,searchAgentPlaces} from '../supabase/functions/_shared/agent-place-search.ts';

const secret='test-only-map-key';
const config:Record<string,string>={AGENT_PLACE_SEARCH_ENABLED:'1',AMAP_KEY:secret};
const env=(key:string)=>config[key];

describe('agent place search',()=>{
 it('requires both an explicit opt-in and a configured key before any network call',async()=>{
  const fetcher=vi.fn<typeof fetch>();
  expect(agentPlaceSearchEnabled(()=>undefined)).toBe(false);
  await expect(searchAgentPlaces(key=>key==='AGENT_PLACE_SEARCH_ENABLED'?'1':undefined,{query:'杭州西湖'},fetcher)).rejects.toMatchObject({code:'PLACE_SEARCH_UNAVAILABLE'});
  await expect(searchAgentPlaces(key=>key==='AMAP_KEY'?secret:undefined,{query:'杭州西湖'},fetcher)).rejects.toMatchObject({code:'PLACE_SEARCH_UNAVAILABLE'});
  expect(fetcher).not.toHaveBeenCalled();
 });
 it('uses the fixed endpoint, drops invalid positions and labels its evidence limits',async()=>{
  const fetcher=vi.fn<typeof fetch>().mockResolvedValue(Response.json({status:'1',pois:[
   {id:'one',name:'社区活动中心',address:'杭州西湖区',location:'120.12,30.22'},
   {id:'bad',name:'错误坐标',location:',30'},{name:'越界',location:'181,30'},{name:'缺少坐标'},
  ]}));
  const result=await searchAgentPlaces(env,{query:'杭州活动中心'},fetcher,()=>new Date('2026-11-08T00:00:00.000Z'));
  expect(result).toMatchObject({source:'高德地图地点搜索',retrievedAt:'2026-11-08T00:00:00.000Z',places:[{id:'one',name:'社区活动中心',address:'杭州西湖区',lng:120.12,lat:30.22}]});
  expect(result.notice).toContain('可租');expect(result.notice).toContain('未核验');expect(JSON.stringify(result)).not.toContain(secret);
  const [target,init]=fetcher.mock.calls[0]!;const url=new URL(String(target));
  expect(url.origin+url.pathname).toBe('https://restapi.amap.com/v3/place/text');expect(url.searchParams.get('keywords')).toBe('杭州活动中心');expect(url.searchParams.get('key')).toBe(secret);expect(init?.redirect).toBe('error');
 });
 it('rejects URLs, forbidden extra arguments and provider failures without leaking error details',async()=>{
  const fetcher=vi.fn<typeof fetch>().mockResolvedValue(Response.json({status:'0',info:secret}));
  expect(agentPlaceSearchSchema.safeParse({query:'https://example.com'}).success).toBe(false);
  expect(agentPlaceSearchSchema.safeParse({query:'杭州',url:'https://example.com'}).success).toBe(false);
  await expect(searchAgentPlaces(env,{query:'https://example.com'},fetcher)).rejects.toThrow();expect(fetcher).not.toHaveBeenCalled();
  await expect(searchAgentPlaces(env,{query:'杭州场馆'},fetcher)).rejects.toMatchObject({code:'PLACE_SEARCH_FAILED'});
  const failed=vi.fn<typeof fetch>().mockRejectedValue(new Error(secret));
  try{await searchAgentPlaces(env,{query:'杭州场馆'},failed);throw Error('unexpected');}catch(error){expect(JSON.stringify(error)).not.toContain(secret);expect(error).toMatchObject({code:'PLACE_SEARCH_FAILED'});}
 });
 it('reports a successful empty search as an empty set rather than inventing a place',async()=>{
  const fetcher=vi.fn<typeof fetch>().mockResolvedValue(Response.json({status:'1',pois:[]}));
  expect((await searchAgentPlaces(env,{query:'杭州会场'},fetcher)).places).toEqual([]);
 });
});
