import {describe,expect,it,vi} from 'vitest';
import {handleAmapGeocode} from '../../../../functions/api/amap-geocode';
import {handleAmapPlace} from '../../../../functions/api/amap-place';

const request=(path:string)=>new Request(`https://example.test/api/${path}?keywords=杭州`);
const fake=(pois:unknown[])=>vi.fn<typeof fetch>().mockResolvedValue(Response.json({pois}));
const env={AMAP_KEY:'fixture-key'};

describe('map results require real coordinates',()=>{
 it.each([undefined,'',',','120,',' ,30','not-a-number,30','181,30','120,91','120,30,1'])('geocode rejects an invalid location %s',async location=>{
  const response=await handleAmapGeocode(request('amap-geocode'),env,fake([{location}]));
  expect(response.status).toBe(404);
 });
 it('preserves a valid coordinate including zeros and keeps the key out of the result',async()=>{
  const response=await handleAmapGeocode(request('amap-geocode'),env,fake([{location:'0,0'}]));
  expect(response.status).toBe(200);
  const body=await response.text();expect(JSON.parse(body)).toEqual({lng:0,lat:0});expect(body).not.toContain(env.AMAP_KEY);
 });
 it('filters invalid places without dropping valid results',async()=>{
  const response=await handleAmapPlace(request('amap-place'),env,fake([
   {id:'empty',location:','},{id:'missing',location:'120,'},{id:'range',location:'181,30'},
   {id:'name',location:'abc,30'},{id:'ok',name:'西湖',location:'120.15,30.25',address:'杭州'},
  ]));
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({places:[{id:'ok',name:'西湖',address:'杭州',lng:120.15,lat:30.25}]});
 });
 it('reports no result when every place has invalid coordinates',async()=>{
  const response=await handleAmapPlace(request('amap-place'),env,fake([{location:','},{location:'120,91'}]));
  expect(response.status).toBe(404);
 });
});
