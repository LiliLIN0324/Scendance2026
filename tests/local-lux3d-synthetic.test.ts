import {afterAll,beforeAll,describe,expect,it,vi} from 'vitest';
import {processGeneration} from '../supabase/functions/_shared/worker.ts';
import {startLocalServer,testPublicKey} from './local-server.ts';
import {SYNTHETIC_LUX3D_CONFIG,startSyntheticLux3dWorker,syntheticLux3dFetch} from '../scripts/local-lux3d-synthetic.ts';

describe('isolated synthetic Lux3D pipeline',()=>{
 let server:Awaited<ReturnType<typeof startLocalServer>>,token:string;
 beforeAll(async()=>{
  server=await startLocalServer(0,undefined,{env:key=>SYNTHETIC_LUX3D_CONFIG[key],lux3dTextOnly:true});
  const login=await fetch(`${server.url}/auth/v1/token?grant_type=password`,{method:'POST',headers:{apikey:testPublicKey,'content-type':'application/json'},body:JSON.stringify({email:'owner@scendance.test',password:'local-integration-only'})});
  expect(login.status).toBe(200);token=(await login.json() as {access_token:string}).access_token;
 },30000);
 afterAll(async()=>{await server?.close();});
 it('rejects all unrecognized destinations and real-looking credentials without network',async()=>{
  const network=vi.spyOn(globalThis,'fetch');
  await expect(syntheticLux3dFetch('https://api.aholo3d.cn/lux3d/v1/generate/text-to-3d/task/create',{method:'POST',headers:{Authorization:'NOT_THE_FIXTURE'},body:'{}'})).rejects.toThrow();
  await expect(syntheticLux3dFetch('https://not-aholo.example/anything')).rejects.toThrow();
  expect(network).not.toHaveBeenCalled();network.mockRestore();
 });
 it('creates, claims, polls and archives a disposable synthetic GLB through the real API and worker',async()=>{
  const api=`${server.url}/functions/v1/scene-api`,headers={authorization:`Bearer ${token}`,apikey:testPublicKey,'content-type':'application/json'};
  const capabilities=await fetch(`${api}/generation/capabilities`,{headers});expect(await capabilities.json()).toMatchObject({aholoTextToModel:true,aholoImageToModel:false});
  const image=await fetch(`${api}/jobs`,{method:'POST',headers,body:JSON.stringify({requestId:crypto.randomUUID(),prompt:'fixture',kind:'image',provider:'aholo',referenceImageAssetId:crypto.randomUUID()})});
  expect(image.status).toBe(400);expect(await image.json()).toMatchObject({error:{code:'LOCAL_LUX3D_IMAGE_UNAVAILABLE'}});
  const unauthenticated=await fetch(`${api}/jobs`,{method:'POST',headers:{apikey:testPublicKey,'content-type':'application/json'},body:JSON.stringify({requestId:crypto.randomUUID(),prompt:'fixture',kind:'image',provider:'aholo'})});expect(unauthenticated.status).toBe(401);
  const input={requestId:crypto.randomUUID(),prompt:'虚构木讲台',kind:'text',provider:'aholo'};
  const created=await fetch(`${api}/jobs`,{method:'POST',headers,body:JSON.stringify(input)});expect(created.status).toBe(202);
  const first=await created.json() as {id:string;state:string};expect(first.state).toBe('queued');
  const replay=await fetch(`${api}/jobs`,{method:'POST',headers,body:JSON.stringify(input)});expect(replay.status).toBe(200);
  expect((await replay.json() as {id:string}).id).toBe(first.id);
  expect(await processGeneration(server.backend,server.env,syntheticLux3dFetch)).toEqual({processed:1});
  await server.db.query('update scene_private.generation_jobs set next_poll_at=now() where id=$1',[first.id]);
  expect(await processGeneration(server.backend,server.env,syntheticLux3dFetch)).toEqual({processed:1});
  const response=await fetch(`${api}/jobs/${first.id}`,{headers});expect(response.status).toBe(200);
  const job=await response.json() as {state:string;asset_id:string};expect(job.state).toBe('ready');expect(job.asset_id).toMatch(/^[0-9a-f-]{36}$/);
  const assetResponse=await fetch(`${api}/assets/${job.asset_id}/url`,{method:'POST',headers});expect(assetResponse.status).toBe(200);
  const asset=await assetResponse.json() as {url:string;source:string};expect(asset.source).toBe('aholo');expect(asset.url.startsWith(server.url+'/test-storage/')).toBe(true);
  const bytes=new Uint8Array(await (await fetch(asset.url)).arrayBuffer());expect(Array.from(bytes.slice(0,4))).toEqual([0x67,0x6c,0x54,0x46]);
 },30000);
 it('runs and stops its isolated worker without overlapping polls',async()=>{
  const api=`${server.url}/functions/v1/scene-api`,headers={authorization:`Bearer ${token}`,apikey:testPublicKey,'content-type':'application/json'};
  const input={requestId:crypto.randomUUID(),prompt:'虚构签到台',kind:'text',provider:'aholo'};
  const created=await fetch(`${api}/jobs`,{method:'POST',headers,body:JSON.stringify(input)});expect(created.status).toBe(202);
  const job=await created.json() as {id:string};const worker=startSyntheticLux3dWorker(server.backend,server.env,30);
  try{
   await vi.waitFor(async()=>{const response=await fetch(`${api}/jobs/${job.id}`,{headers});expect((await response.json() as {state:string}).state).toBe('submitted');},{timeout:10000,interval:50});
   await server.db.query('update scene_private.generation_jobs set next_poll_at=now() where id=$1',[job.id]);
   await vi.waitFor(async()=>{const response=await fetch(`${api}/jobs/${job.id}`,{headers});expect((await response.json() as {state:string}).state).toBe('ready');},{timeout:10000,interval:50});
  }finally{await worker.stop();}
 },30000);
});
