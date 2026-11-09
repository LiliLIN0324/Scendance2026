import {describe,expect,it} from 'vitest';
import {referenceSourceStatus} from './reference-source-status';

describe('reference source status',()=>{
 it('does not infer a source exists or is absent before every relevant read completes',()=>{
  for(const localRead of ['pending','failed'] as const)
   expect(referenceSourceStatus({hasReference:false,localRead,remoteRead:'not_required'}).status).toBe('unknown');
  for(const remoteRead of ['pending','failed'] as const)
   expect(referenceSourceStatus({hasReference:false,localRead:'ready',remoteRead}).status).toBe('unknown');
 });
 it('distinguishes no observed reference from a reference whose original version is unverified',()=>{
  expect(referenceSourceStatus({hasReference:false,localRead:'ready',remoteRead:'not_required'}).status).toBe('not_applicable');
  expect(referenceSourceStatus({hasReference:false,localRead:'ready',remoteRead:'ready'}).message).toContain('其他位置');
  expect(referenceSourceStatus({hasReference:true,localRead:'ready',remoteRead:'ready'})).toMatchObject({status:'unknown',message:expect.stringContaining('原件版本尚未核验')});
 });
});
