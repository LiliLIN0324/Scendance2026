import {describe,expect,it,vi} from 'vitest';
import {fetchJson,isUpstreamQuotaExhausted} from '../supabase/functions/_shared/http.ts';
import {ApiError} from '../supabase/functions/_shared/domain.ts';

describe('upstream quota/balance classification',()=>{
 it.each([
  [402,'any upstream body',true],
  [400,'insufficient_quota',true],
  [400,'INSUFFICIENT_CREDITS',true],
  [402,'{\"error\":\"balance insufficient\"}',true],
  [400,'账户余额不足，请充值',true],
  [400,'该模型额度不足',true],
  [400,'out of credits',true],
 ])('treats status %s / body %j as quota exhausted',(status,body,expected)=>{
  expect(isUpstreamQuotaExhausted(status,body)).toBe(expected);
 });
 it.each([
  [429,'too many requests, rate limit'],
  [503,'upstream temporarily unavailable'],
  [400,'invalid request body, malformed payload'],
 ])('keeps transient/rate-limit/%s body generic',(status,body)=>{
  expect(isUpstreamQuotaExhausted(status,body)).toBe(false);
 });

 it('raises a dedicated quota code on 402 without forwarding the upstream body',async()=>{
  const secret='PRIVATE_QUOTA_BODY_MARKER';
  const fetcher=vi.fn<typeof fetch>().mockResolvedValue(new Response(secret,{status:402}));
  await expect(fetchJson('https://model.example/v1/chat',{method:'POST',headers:{},body:'{}'},fetcher)).rejects.toMatchObject({code:'PROVIDER_QUOTA_EXHAUSTED',status:402});
  try{await fetchJson('https://model.example/v1/chat',{method:'POST',headers:{},body:'{}'},fetcher);}
  catch(e){expect(e).toBeInstanceOf(ApiError);expect(JSON.stringify((e as ApiError).details)).not.toContain(secret);}
 });
 it('keeps a 429 on the generic HTTP error code',async()=>{
  const fetcher=vi.fn<typeof fetch>().mockResolvedValue(new Response('rate limit',{status:429}));
  await expect(fetchJson('https://model.example/v1/chat',{method:'POST',headers:{},body:'{}'},fetcher)).rejects.toMatchObject({code:'PROVIDER_HTTP_ERROR',status:502,details:{status:429}});
 });
 it('passes a 2xx JSON body through',async()=>{
  const fetcher=vi.fn<typeof fetch>().mockResolvedValue(Response.json({ok:true}));
  await expect(fetchJson('https://model.example/v1/chat',{method:'POST',headers:{},body:'{}'},fetcher)).resolves.toEqual({ok:true});
 });
});
