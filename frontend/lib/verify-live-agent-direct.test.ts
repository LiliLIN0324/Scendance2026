import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {describe,expect,it} from 'vitest';

const script=resolve('scripts/verify-live-agent-direct.cjs');
const {safeToolTrace,safeProgress,safeBusinessTrace}=createRequire(import.meta.url)(script) as {
 safeToolTrace:(tools:unknown)=>unknown[];
 safeProgress:(value:unknown)=>string|null;
 safeBusinessTrace:(value:unknown)=>unknown[];
};
function run(args:string[]):Promise<{code:number|null;output:string}>{
 return new Promise((resolveRun,reject)=>{
  const child=spawn(process.execPath,[script,...args],{stdio:['ignore','pipe','pipe']});let output='';
  child.stdout.on('data',chunk=>{output+=String(chunk);});child.stderr.on('data',chunk=>{output+=String(chunk);});
  child.on('error',reject);child.on('exit',code=>resolveRun({code,output}));
 });
}
describe('direct local agent probe preflight',()=>{
 it('reports rejected candidate results without exposing arbitrary text or fields',()=>{
  const secret='FAKE_PRIVATE_TOOL_CONTENT_123';
  const result=safeBusinessTrace([
   {tool:'validate_candidate',valid:false,errorCode:'CANDIDATE_GEOMETRY_CONFLICT',arguments:secret},
   {tool:'submit_candidates',accepted:0,expected:1,errorCodes:['INVALID_TOOL_INPUT','VALIDATED_CANDIDATE_NOT_FOUND',secret],result:secret},
   {tool:'submit_candidates',accepted:500,expected:1,errorCodes:[]},
   {tool:'model_round',turn:2,phase:'failed',remainingMs:0,elapsedMs:39000,arguments:secret},
   {tool:'model_round',turn:999,phase:'start',remainingMs:0},
   {tool:secret,valid:true},
  ]);
  expect(result).toEqual([{tool:'validate_candidate',valid:false,errorCode:'CANDIDATE_GEOMETRY_CONFLICT'},
   {tool:'submit_candidates',accepted:0,expected:1,errorCodes:['INVALID_TOOL_INPUT','VALIDATED_CANDIDATE_NOT_FOUND']},
   {tool:'model_round',turn:2,phase:'failed',remainingMs:0,elapsedMs:39000}]);
  expect(JSON.stringify(result)).not.toContain(secret);
 });
 it('retains shared seating outcomes and progress without exposing tool arguments or unknown text',()=>{
  const secret='FAKE_PRIVATE_TOOL_ARGUMENT_3194';
  const result=safeToolTrace([
   {tool:'prepare_shared_seating_candidate',outcome:'succeeded',arguments:secret},
   {tool:'prepare_shared_seating_candidate',outcome:'failed',errorCode:'SEATING_SPEC_CONFLICT',arguments:secret},
   {tool:'prepare_shared_seating_candidate',outcome:'unknown',errorCode:secret},
   {tool:secret,outcome:'succeeded'},
  ]);
  expect(result).toEqual([
   {tool:'prepare_shared_seating_candidate',outcome:'succeeded'},
   {tool:'prepare_shared_seating_candidate',outcome:'failed',errorCode:'SEATING_SPEC_CONFLICT'},
   {tool:'prepare_shared_seating_candidate',outcome:'unknown'},
  ]);
  expect(JSON.stringify(result)).not.toContain(secret);
  expect(safeProgress('正在试排双人课桌椅')).toBe('正在试排双人课桌椅');
  expect(safeProgress(secret)).toBeNull();
 });
 it('rejects unspecified and reserved ports before running a browser',async()=>{
  for(const args of [[],['4196','--live'],['4215'],['abc','--synthetic']]){
   const result=await run(args);expect(result.code).toBe(2);expect(result.output).toContain('独立本机试用端口');
  }
 });
 it('refuses the wrong mode and never prints untrusted status details',async()=>{
  let calls=0;const secret='FAKE_PRIVATE_STATUS_3194';
  const server=createServer((_request,response)=>{calls++;response.setHeader('content-type','application/json');response.end(JSON.stringify({mode:'synthetic',state:secret,used:0,diagnostic:{code:secret,httpStatus:secret}}));});
  await new Promise<void>(resolveListen=>server.listen(0,'127.0.0.1',resolveListen));
  try{
   const address=server.address();if(!address||typeof address==='string')throw Error('missing address');
   const result=await run([String(address.port),'--live']);
   expect(result.code).toBe(1);expect(result.output).toContain('trial_not_ready');expect(result.output).not.toContain(secret);
   expect(calls).toBeLessThanOrEqual(2);
  }finally{await new Promise<void>((resolveClose,reject)=>server.close(error=>error?reject(error):resolveClose()));}
 });
});
