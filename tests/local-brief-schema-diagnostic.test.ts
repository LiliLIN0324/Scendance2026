import {createRequire} from 'node:module';
import {describe,expect,it} from 'vitest';
import {ZodError} from 'zod';
import {parseBriefConversation} from '../supabase/functions/_shared/brief-extract-contract.ts';
import {diagnoseBriefSchemaIssues,SCHEMA_ISSUE_CODES,SCHEMA_ISSUE_PATHS} from '../scripts/local-brief-schema-diagnostic.ts';

const {safeDiagnostic}=createRequire(import.meta.url)('../frontend/scripts/local-trial-diagnostic.cjs') as {safeDiagnostic:(value:unknown)=>unknown};
describe('isolated brief schema diagnostic',()=>{
 const secret='PRIVATE_FIXTURE_SCHEMA_VALUE_391';
 const base={extraction:{},reply:'先核对需求。',unhandled:[],factEvidence:[]};
 it.each([
  {value:{...base,extraction:{headcount:'30'}},path:'extraction.headcount',code:'invalid_type'},
  {value:{...base,extraction:{venueIO:'大厅'}},path:'extraction.venueIO',code:'invalid_value'},
  {value:{...base,factEvidence:[{key:'headcount',evidence:123}]},path:'factEvidence[].evidence',code:'invalid_type'},
  {value:{...base,extraction:{activityNeeds:[{kind:'stage',decision:'needed',evidence:123}]}},path:'extraction.activityNeeds[].evidence',code:'invalid_type'},
  {value:{...base,[secret]:secret},path:'$',code:'unrecognized_keys'},
 ])('classifies real parser failure at $path without values',({value,path,code})=>{
  let error:unknown;try{parseBriefConversation(value,'30人');}catch(cause){error=cause;}
  expect(error).toBeInstanceOf(ZodError);
  const schema=diagnoseBriefSchemaIssues((error as ZodError).issues);
  expect(schema?.issues).toContainEqual({code,path});
  const safe=safeDiagnostic({code:'model_schema_invalid',schema,raw:secret});
  expect(safe).toEqual({code:'model_schema_invalid',schema});
  expect(JSON.stringify(safe)).not.toContain(secret);
 });
 it('bounds output and turns untrusted paths or codes into fixed other',()=>{
  const issues=Array.from({length:130},()=>({code:secret,path:['extraction',secret],message:secret,input:secret}));
  const schema=diagnoseBriefSchemaIssues(issues);
  expect(schema).toEqual({total:99,issues:Array.from({length:5},()=>({code:'other',path:'other'}))});
  expect(JSON.stringify(schema)).not.toContain(secret);
  expect(diagnoseBriefSchemaIssues([{code:'invalid_type',path:[-1]}])?.issues).toEqual([{code:'invalid_type',path:'other'}]);
 });
 it('keeps every allowed category and path through the local IPC filter',()=>{
  for(const code of SCHEMA_ISSUE_CODES)for(const path of SCHEMA_ISSUE_PATHS){
   const schema={total:1,issues:[{code,path}]};expect(safeDiagnostic({code:'model_schema_invalid',schema})).toEqual({code:'model_schema_invalid',schema});
  }
 });
});
