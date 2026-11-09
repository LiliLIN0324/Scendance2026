import {createRequire} from 'node:module';
import {describe,expect,it} from 'vitest';

const require=createRequire(import.meta.url);
const {cases,parseOptions,evaluateCase,safeStatus,safeToolResult}=require('../frontend/scripts/evaluate-live-dialogues.cjs');

describe('isolated live dialogue batch guardrails',()=>{
 it('requires an explicit fresh isolated port, bounded case count and reserved tool budget',()=>{
  expect(parseOptions(['4301','--synthetic','5','5'])).toMatchObject({port:4301,mode:'synthetic',count:5,maxCalls:5,tool:false});
  expect(parseOptions(['4301','--live','5','11','--include-tool']).tool).toBe(true);
  expect(parseOptions(['4301','--synthetic','2','2','--expected-used=2','--offset=2'])).toMatchObject({expectedUsed:2,offset:2,count:2});
  for(const args of [['4256','--live','1','1'],['4301','--live','6','6'],['4301','--live','5','5','--include-tool'],['4301','--live','5','13'],['4301','--live','-1','1'],['4301','--live','1','1','--other'],['4301','--live','2','2','--offset=4'],['4301','--live','1','7','--include-tool','--expected-used=2']])expect(()=>parseOptions(args)).toThrow();
 });
 it('validates known fictional facts without exposing reply or evidence',()=>{
  const value={enabled:true,extraction:{headcount:30,venueIO:'indoor',activityNeeds:[{kind:'checkin',decision:'unknown',evidence:'SECRET-EVIDENCE'}]},reply:'SECRET-REPLY'};
  expect(evaluateCase(cases[0],value)).toEqual({status:'passed',reason:null,modelExtraction:'passed'});
  expect(evaluateCase(cases[0],{...value,extraction:{...value.extraction,headcount:2}})).toMatchObject({status:'failed'});
  expect(evaluateCase(cases[0],{enabled:true,extraction:null,reason:'MODEL_INVALID_RESPONSE'})).toEqual({status:'unavailable',reason:'MODEL_INVALID_RESPONSE',modelExtraction:'unavailable'});
  expect(JSON.stringify(evaluateCase(cases[0],value))).not.toContain('SECRET');
 });
 it('marks the desk ratio as not exercised even when headcount and layout fields pass',()=>{
  const output=evaluateCase(cases[4],{enabled:true,extraction:{headcount:30,layoutMode:'desk-chair'}});
  expect(output).toEqual({status:'partial',reason:'SYSTEM_RATIO_NOT_EXERCISED',modelExtraction:'passed',systemRatio:'not_exercised'});
  expect(evaluateCase(cases[4],{enabled:true,extraction:{headcount:2,layoutMode:'desk-chair'}})).toMatchObject({status:'failed',modelExtraction:'failed',systemRatio:'not_exercised'});
 });
 it('filters provider and tool reports to fixed fields and safe codes',()=>{
  expect(safeStatus({state:'ready',used:2,diagnostic:{code:'model_schema_invalid',raw:'SECRET'}})).toEqual({state:'ready',used:2,diagnostic:'model_schema_invalid'});
  const value=safeToolResult({status:'candidate',runState:'complete',modelRequests:2,candidates:1,sceneUnchanged:true,baselineMatches:true,unknownWarnings:[true],traceAvailable:true,
   toolTrace:[{tool:'get_scene',outcome:'succeeded',arguments:'SECRET'},{tool:'SECRET',outcome:'succeeded'}],businessTrace:[{tool:'validate_candidate',valid:false,errorCode:'SECRET',raw:'SECRET'}],raw:'SECRET'});
  expect(value.toolTrace).toEqual([{tool:'get_scene',outcome:'succeeded'}]);expect(value.businessTrace).toEqual([{tool:'validate_candidate',valid:false}]);
  expect(JSON.stringify(value)).not.toContain('SECRET');
 });
});
