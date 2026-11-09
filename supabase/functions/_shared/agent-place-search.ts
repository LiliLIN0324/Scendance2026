import { z } from 'zod';
import { ApiError } from './domain.ts';
import { fetchJson, type Env, type Fetcher } from './http.ts';

/** A model may provide a place name, never a URL or arbitrary endpoint. */
export const agentPlaceSearchSchema=z.strictObject({
  query:z.string().trim().min(2).max(80).refine(value=>!/[\u0000-\u001f\u007f]/.test(value)&&!/(?:https?:\/\/|www\.|\b[a-z][a-z0-9+.-]*:\/\/)/i.test(value)),
});
const envKey=(env:Env)=>env('AMAP_STATIC_KEY')||env('NEXT_PUBLIC_AMAP_STATIC_KEY')||env('AMAP_KEY')||env('NEXT_PUBLIC_AMAP_KEY')||'';
export function agentPlaceSearchEnabled(env:Env):boolean {return env('AGENT_PLACE_SEARCH_ENABLED')==='1'&&!!envKey(env).trim();}
function text(value:unknown,limit:number):string {
  return typeof value==='string'?value.replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,limit):'';
}
function position(value:unknown):{lng:number;lat:number}|null {
  if(typeof value!=='string'||!/^\-?\d{1,3}(?:\.\d+)?,\-?\d{1,2}(?:\.\d+)?$/.test(value))return null;
  const [lng,lat]=value.split(',').map(Number);
  return Number.isFinite(lng)&&Number.isFinite(lat)&&Math.abs(lng!)<=180&&Math.abs(lat!)<=90?{lng:lng!,lat:lat!}:null;
}

/** Fixed-host, bounded read only. A returned point is not venue availability or a verified plan. */
export async function searchAgentPlaces(env:Env,input:unknown,fetcher:Fetcher=fetch,now:()=>Date=()=>new Date()) {
  const {query}=agentPlaceSearchSchema.parse(input);
  if(!agentPlaceSearchEnabled(env))throw new ApiError('PLACE_SEARCH_UNAVAILABLE',503);
  const url=new URL('https://restapi.amap.com/v3/place/text');
  url.searchParams.set('keywords',query);url.searchParams.set('offset','5');url.searchParams.set('page','1');url.searchParams.set('key',envKey(env));
  let data:unknown;
  try { data=await fetchJson(url.href,{method:'GET'},fetcher,65_536,8_000); }
  catch { throw new ApiError('PLACE_SEARCH_FAILED',502); }
  const parsed=z.object({status:z.string(),pois:z.array(z.object({id:z.unknown().optional(),name:z.unknown().optional(),address:z.unknown().optional(),location:z.unknown().optional()})).max(100).optional()}).safeParse(data);
  if(!parsed.success||parsed.data.status!=='1')throw new ApiError('PLACE_SEARCH_FAILED',502);
  const places=(parsed.data.pois??[]).flatMap(poi=>{
    const coordinates=position(poi.location),name=text(poi.name,120);
    if(!coordinates||!name)return [];
    const address=Array.isArray(poi.address)?poi.address.map(part=>text(part,160)).join('').slice(0,160):text(poi.address,160);
    return [{id:text(poi.id,120)||`${coordinates.lng},${coordinates.lat}`,name,address,...coordinates}];
  }).slice(0,5);
  return {source:'高德地图地点搜索',retrievedAt:now().toISOString(),places,
    notice:'仅为地点检索结果，场馆是否存在、可租、可容纳、价格及档期均未核验；位置不是场地平面图。'};
}
