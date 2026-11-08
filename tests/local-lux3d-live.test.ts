import {afterAll,beforeAll,describe,expect,it,vi} from 'vitest';
import {processGeneration} from '../supabase/functions/_shared/worker.ts';
import {localLux3dChinaFetch,localLux3dLiveConfig} from '../scripts/local-lux3d-live.ts';
import {SYNTHETIC_LUX3D_CONFIG,syntheticLux3dFetch} from '../scripts/local-lux3d-synthetic.ts';
import {startLocalServer,testPublicKey} from './local-server.ts';

const fakeKey='synthetic-lux3d-key';
// These are test-only fixtures, not a representation of provider terms or prices.
const input={key:fakeKey,termsUrl:'https://labs.aholo3d.cn/agreement/test-only',reviewedAt:'2000-01-01',reservationCents:'100'};

describe('local Lux3D China routing and worker',()=>{
 it('requires explicit terms review and internal reservation without inventing them',()=>{
  expect(localLux3dLiveConfig(input)).toMatchObject({LUX3D_BASE_URL:'https://api.aholo3d.cn',GENERATION_MAX_TASK_CENTS:'100'});
  for(const patch of [{key:''},{termsUrl:''},{termsUrl:'https://example.invalid/terms'},{termsUrl:'https://api.aholo3d.cn.evil.invalid/terms'},{reviewedAt:''},{reviewedAt:'9999-01-01'},{reviewedAt:'2026-02-30'},{reservationCents:''},{reservationCents:'0'},{reservationCents:'100.5'}])
   expect(()=>localLux3dLiveConfig({...input,...patch})).toThrow();
 });
 it('pins China API routes and strips credentials from allowed asset downloads',async()=>{
  const transport=vi.fn(async(_url:RequestInfo|URL,_init?:RequestInit)=>new Response('fixture'));const safe=localLux3dChinaFetch(fakeKey,transport);
  await safe('https://api.aholo3d.cn/lux3d/v1/generate/text-to-3d/task/create',{method:'POST',headers:{Authorization:fakeKey,'Content-Type':'application/json'},body:'{}'});
  await safe('https://api.aholo3d.cn/lux3d/v1/generate/task/get?taskid=123',{headers:{Authorization:fakeKey}});
  await safe('https://model.kujiale.com/fixture.glb?token=fixture');
  expect(transport).toHaveBeenCalledTimes(3);
  for(const call of transport.mock.calls)expect(call[1]?.redirect).toBe('error');
  expect(new Headers(transport.mock.calls[2]![1]?.headers).has('authorization')).toBe(false);
  for(const [url,init] of [
   ['https://api.aholo.ai/global/lux3d/v1/generate/text-to-3d/task/create',{method:'POST',headers:{Authorization:fakeKey}}],
   ['https://api.aholo3d.cn/lux3d/v1/generate/img-to-3d/task/create',{method:'POST',headers:{Authorization:fakeKey}}],
   ['https://api.aholo3d.cn/lux3d/v1/generate/task/get?taskid=123&extra=1',{headers:{Authorization:fakeKey}}],
   ['https://api.aholo3d.cn/lux3d/v1/generate/text-to-3d/task/create',{method:'POST',headers:{Authorization:'wrong'}}],
   ['https://model.kujiale.com.evil.invalid/a.glb',{}],
   ['https://model.kujiale.com/a.glb',{headers:{Authorization:fakeKey}}],
  ] as const)await expect(safe(url,init)).rejects.toThrow();
  expect(transport).toHaveBeenCalledTimes(3);
 });
});

describe('local real-mode wiring against a fake vendor only',()=>{
 let server:Awaited<ReturnType<typeof startLocalServer>>,token:string;
 beforeAll(async()=>{
  const config=localLux3dLiveConfig(input);server=await startLocalServer(0,undefined,{env:key=>config[key],lux3dTextOnly:true});
  const login=await fetch(`${server.url}/auth/v1/token?grant_type=password`,{method:'POST',headers:{apikey:testPublicKey,'content-type':'application/json'},body:JSON.stringify({email:'owner@scendance.test',password:'local-integration-only'})});token=(await login.json() as {access_token:string}).access_token;
 },30000);
 afterAll(async()=>{await server?.close();});
 it('uses existing job checks and routes the worker only to the injected fake service',async()=>{
  const api=`${server.url}/functions/v1/scene-api`,headers={authorization:`Bearer ${token}`,apikey:testPublicKey,'content-type':'application/json'};
  expect(await(await fetch(`${api}/generation/capabilities`,{headers})).json()).toMatchObject({aholoTextToModel:true,aholoImageToModel:false});
  const create=await fetch(`${api}/jobs`,{method:'POST',headers,body:JSON.stringify({requestId:crypto.randomUUID(),prompt:'虚构展台',kind:'text',provider:'aholo'})});expect(create.status).toBe(202);
  const job=await create.json() as {id:string};const mock=vi.fn(syntheticLux3dFetch),safe=localLux3dChinaFetch(fakeKey,mock);
  await processGeneration(server.backend,server.env,safe);
  await server.db.query('update scene_private.generation_jobs set next_poll_at=now() where id=$1',[job.id]);
  await processGeneration(server.backend,server.env,safe);
  const result=await(await fetch(`${api}/jobs/${job.id}`,{headers})).json();expect(result).toMatchObject({state:'ready'});expect(mock).toHaveBeenCalledTimes(3);
  expect(SYNTHETIC_LUX3D_CONFIG.LUX3D_BASE_URL).toBe('https://api.aholo3d.cn');
 },30000);
 it('does not resubmit a task after an ambiguous provider create failure',async()=>{
  const api=`${server.url}/functions/v1/scene-api`,headers={authorization:`Bearer ${token}`,apikey:testPublicKey,'content-type':'application/json'};
  const create=await fetch(`${api}/jobs`,{method:'POST',headers,body:JSON.stringify({requestId:crypto.randomUUID(),prompt:'虚构吊牌',kind:'text',provider:'aholo'})});expect(create.status).toBe(202);
  const job=await create.json() as {id:string};const secret='FAKE_PRIVATE_PROVIDER_ERROR';
  const mock=vi.fn(async()=>{throw Error(secret);}),safe=localLux3dChinaFetch(fakeKey,mock);
  expect(await processGeneration(server.backend,server.env,safe)).toEqual({processed:1});
  expect(await processGeneration(server.backend,server.env,safe)).toEqual({processed:0});
  const result=await(await fetch(`${api}/jobs/${job.id}`,{headers})).json();
  expect(result).toMatchObject({state:'submit_unknown'});expect(mock).toHaveBeenCalledTimes(1);expect(JSON.stringify(result)).not.toContain(secret);
 },30000);
});
