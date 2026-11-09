import {createRequire} from 'node:module';
import {describe,expect,it} from 'vitest';

const require=createRequire(import.meta.url);
const {summarize,cases}=require('../frontend/scripts/evaluate-agent-baseline.cjs');

function reports(){
 const result:Record<string,{success:boolean;testResults:any[]}>={frontend:{success:true,testResults:[]},backend:{success:true,testResults:[]}};
 for(const test of cases)for(const check of test.checks){
  const entries=Array.from({length:check.min},(_,i)=>({title:`${check.title} ${i}`,status:'passed',duration:1}));
  result[check.group]!.testResults.push({name:`/fixture/${check.file}`,assertionResults:entries});
 }
 return result;
}

describe('offline agent baseline reporter',()=>{
 it('separates requirement, tool and outcome evidence and does not claim a real model',()=>{
  const result=summarize(reports(),42);
  expect(result).toMatchObject({mode:'offline-synthetic',status:'passed',passed:6,total:6,durationMs:42});
  expect(result.model).toBe('fixed-fixture-not-real-model');
  const shared=result.results.find((x:any)=>x.id==='shared_seating_and_shortage');
  expect(shared.toolExecution).toHaveLength(1);expect(shared.outcomeVerification).toHaveLength(2);
  expect(result.results.find((x:any)=>x.id==='attendance_30_ratio_2').toolExecution).toEqual([]);
 });
 it('never scores a missing or skipped assertion as passed',()=>{
  const data=reports();data.frontend.testResults[0].assertionResults[0].status='pending';
  const skipped=summarize(data,1);expect(skipped.status).toBe('incomplete');expect(skipped.passed).toBeLessThan(6);
  const missing=summarize({frontend:{success:true,testResults:[]},backend:data.backend},1);
  expect(missing.status).toBe('incomplete');expect(missing.results.some((x:any)=>x.status==='missing')).toBe(true);
 });
 it('reports an entire failing suite even when selected assertions passed',()=>{
  const result=summarize(reports(),1,{frontend:'failed',backend:'passed'});
  expect(result.passed).toBe(6);expect(result.status).toBe('incomplete');
 });
});
