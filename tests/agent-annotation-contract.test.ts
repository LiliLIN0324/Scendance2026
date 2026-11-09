import {describe,expect,it} from 'vitest';
import {agentAnnotationObservationSchema,agentRunRequestSchema} from '../supabase/functions/_shared/agent-contract.ts';
import {scene,session} from './fixtures.ts';
const ready={status:'ready',binding:{activityScope:'activity:fixture',activityEpoch:1,sceneRevision:2,floorId:'floor-1',annotationRevision:3},annotations:[{id:'ann-1',kind:'zone',geometry:{kind:'rect',x:-2,z:-1,width:2,depth:1},zoneType:'checkin',source:'unverified'}],notice:'标注是待核验的规划草稿；读取不代表已用于排布或完成安全检查。'};
describe('bounded annotation observation contract',()=>{
 it('does not add new fields to old requests',()=>{
  const result=agentRunRequestSchema.parse({requestId:crypto.randomUUID(),sessionId:session,generation:1,expectedRevision:0,localRevision:0,scene:scene(),selectedIds:[],instruction:'排布'});
  expect(result.context).not.toHaveProperty('annotationObservation');
 });
 it('accepts explicit unavailable, and rejects untrusted extras, duplicates and out-of-budget geometry',()=>{
  expect(agentAnnotationObservationSchema.safeParse(ready).success).toBe(true);
  expect(agentAnnotationObservationSchema.safeParse({status:'unavailable'}).success).toBe(true);
  expect(agentAnnotationObservationSchema.safeParse({...ready,annotations:[{...ready.annotations[0],label:'PRIVATE LABEL'}]}).success).toBe(false);
  expect(agentAnnotationObservationSchema.safeParse({...ready,annotations:[ready.annotations[0],ready.annotations[0]]}).success).toBe(false);
  expect(agentAnnotationObservationSchema.safeParse({...ready,annotations:Array(101).fill(ready.annotations[0])}).success).toBe(false);
  expect(agentAnnotationObservationSchema.safeParse({...ready,annotations:[{...ready.annotations[0],geometry:{kind:'rect',x:999,z:0,width:10,depth:1}}]}).success).toBe(false);
  expect(agentAnnotationObservationSchema.safeParse({status:'unavailable',annotations:[]}).success).toBe(false);
 });
});
