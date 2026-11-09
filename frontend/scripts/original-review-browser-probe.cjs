// Isolated protocol probe. The bundle enables the disabled gate ONLY in memory;
// cloud responses are simulated and no production service is contacted.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const esbuild=require('esbuild');
const {chromium}=require('playwright');

async function main(){
 const root=path.resolve(__dirname,'..');
 const entry=`import {BackendSession,getBackendConfig} from './lib/backend-session';
 import {createLocalWriteLeaseManager} from './lib/local-write-lease';
 import {canonical,sha256} from '../supabase/functions/_shared/domain';
 const project='22222222-2222-4222-8222-222222222222',reviewId='33333333-3333-4333-8333-333333333333';
 const base={schemaVersion:1,venue:{width:12,depth:10,height:3,shape:'rectangle',entrances:[]},objects:[],camera:'overview',lighting:'neutral'};
 const candidate={...base,lighting:'warm'};
 window.makeSession=async()=>{const controller=new BackendSession(getBackendConfig({url:'https://backend.invalid',anonKey:'sb_publishable_test'}));await controller.signIn('user@example.test','test');const lease=await createLocalWriteLeaseManager({getLocks:()=>navigator.locks,getStorage:()=>localStorage}).acquire();
 const receipt={version:1,projectId:project,reviewId,baseHash:await sha256(canonical(base)),candidateHash:await sha256(canonical(candidate)),baseRevision:0};
 return {controller,lease,receipt,request:{sessionId:controller.getSnapshot().sessionId,generation:1,revision:0,originalSceneHash:receipt.baseHash},base,candidate,thirdHash:await sha256(canonical({...base,lighting:'cool'}))};};`;
 const built=await esbuild.build({stdin:{contents:entry,resolveDir:root,sourcefile:'original-review-probe.ts',loader:'ts'},bundle:true,write:false,platform:'browser',format:'iife',define:{'process.env.NODE_ENV':'"test"'},plugins:[{name:'test-only-gate',setup(build){build.onLoad({filter:/backend-session\.ts$/},args=>{
  const source=fs.readFileSync(args.path,'utf8'),changed=source.replace('const ORIGINAL_REVIEW_COMPLETION_ENABLED:boolean=false;','const ORIGINAL_REVIEW_COMPLETION_ENABLED:boolean=true;');
  if(changed===source)throw Error('The test-only gate was not found.');return {contents:changed,loader:'ts',resolveDir:path.dirname(args.path)};
 });}}]});
 const executablePath=process.env.SCENDANCE_TEST_CHROME||'C:/Program Files/Google/Chrome/Application/chrome.exe';
 const profile=fs.mkdtempSync(path.join(os.tmpdir(),'scendance-original-review-probe-'));let context;let applied=false,applyCalls=0,baseHash='',candidateHash='',thirdHash='',thirdValue=false,holdOriginal=false,releaseRead,readStarted;
 let account='11111111-1111-4111-8111-111111111111';
 const headers={'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'GET,POST,OPTIONS','content-type':'application/json'};
 const scene={schemaVersion:1,venue:{width:12,depth:10,height:3,shape:'rectangle',entrances:[]},objects:[],camera:'overview',lighting:'neutral'},candidate={...scene,lighting:'warm'};
 async function createContext(){
  const instance=await chromium.launchPersistentContext(profile,{headless:true,executablePath});
  await instance.route('https://probe.invalid/**',route=>route.fulfill({status:200,contentType:'text/html',body:'<!doctype html><title>Isolated review probe</title>'}));
  await instance.route('https://backend.invalid/**',async route=>{
  const request=route.request(),url=new URL(request.url());if(request.method()==='OPTIONS')return route.fulfill({status:204,headers});
  if(url.pathname.includes('/auth/v1/token'))return route.fulfill({status:200,headers,body:JSON.stringify({access_token:'test-token',refresh_token:'test-refresh',expires_in:3600,user:{id:account,email:'user@example.test'}})});
  if(url.pathname.endsWith('/apply')){applyCalls++;applied=true;return route.abort('connectionreset');}
  if(url.pathname.includes('/original-scene/reviews/'))return route.fulfill({status:200,headers,body:JSON.stringify({id:'33333333-3333-4333-8333-333333333333',projectId:'22222222-2222-4222-8222-222222222222',baseRevision:0,baseHash,candidateHash,expiresAt:'2099-01-01T00:00:00Z',appliedAt:applied?'2026-11-07T00:00:00Z':null,appliedRevision:applied?1:null,changes:[]})});
  if(url.pathname.endsWith('/original-scene')){
   if(holdOriginal){readStarted();await new Promise(resolve=>{releaseRead=resolve;});}
   return route.fulfill({status:200,headers,body:JSON.stringify({projectId:'22222222-2222-4222-8222-222222222222',scene:thirdValue?{...scene,lighting:'cool'}:applied?candidate:scene,revision:thirdValue?2:applied?1:0,originalSceneHash:thirdValue?thirdHash:applied?candidateHash:baseHash})});
  }
  if(url.pathname.endsWith('/projects/55555555-5555-4555-8555-555555555555'))return route.fulfill({status:200,headers,body:JSON.stringify({id:'55555555-5555-4555-8555-555555555555',studio_id:'66666666-6666-4666-8666-666666666666',name:'另一个项目',revision:0,scene})});
  throw Error('Unexpected test request: '+request.url());
  });return instance;
 }
 context=await createContext();let page=await context.newPage();
 try{
  async function open(){await page.goto('https://probe.invalid/');await page.addScriptTag({content:built.outputFiles[0].text});return page.evaluate(async()=>{window.ctx=await window.makeSession();return {receipt:window.ctx.receipt,thirdHash:window.ctx.thirdHash};});}
  const opened=await open();baseHash=opened.receipt.baseHash;candidateHash=opened.receipt.candidateHash;thirdHash=opened.thirdHash;
  const first=await page.evaluate(async()=>window.ctx.controller.commitAuthorizedOriginalReview(window.ctx.receipt,window.ctx.request,window.ctx.lease.capability,()=>true));
  assert.equal(first,'unknown');assert.equal(applyCalls,1);
  const repeat=await page.evaluate(async()=>window.ctx.controller.commitAuthorizedOriginalReview(window.ctx.receipt,window.ctx.request,window.ctx.lease.capability,()=>true));
  assert.equal(repeat,'blocked');assert.equal(applyCalls,1);
  await page.evaluate(async()=>window.ctx.lease.release());
  await context.close();context=await createContext();page=await context.newPage();
  await open();
  const started=new Promise(resolve=>{readStarted=resolve;});holdOriginal=true;
  const pending=page.evaluate(async()=>window.ctx.controller.reconcileOriginalReview(window.ctx.receipt.projectId,window.ctx.lease.capability));
  await started;account='44444444-4444-4444-8444-444444444444';await page.evaluate(async()=>window.ctx.controller.signIn('other@example.test','test'));
  holdOriginal=false;releaseRead();assert.equal(await pending,'blocked');
  assert.equal(await page.evaluate(async()=>window.ctx.controller.reconcileOriginalReview(window.ctx.receipt.projectId,window.ctx.lease.capability)),'blocked');
  account='11111111-1111-4111-8111-111111111111';await page.evaluate(async()=>window.ctx.controller.signIn('user@example.test','test'));
  const scopeStarted=new Promise(resolve=>{readStarted=resolve;});holdOriginal=true;
  const staleScope=page.evaluate(async()=>window.ctx.controller.reconcileOriginalReview(window.ctx.receipt.projectId,window.ctx.lease.capability));
  await scopeStarted;await page.evaluate(async()=>window.ctx.controller.getProject('55555555-5555-4555-8555-555555555555'));
  holdOriginal=false;releaseRead();assert.equal(await staleScope,'blocked');
  await page.evaluate(()=>{
   const r=window.ctx.receipt,c=window.ctx.controller;
   c.readOriginalReviewEvidence=async()=>({projectId:r.projectId,reviewId:r.reviewId,baseHash:r.baseHash,candidateHash:r.candidateHash,baseRevision:r.baseRevision,appliedRevision:1,currentRevision:1,currentSceneHash:r.candidateHash});
   c.readOriginalScene=async()=>({scene:window.ctx.candidate,revision:1,originalSceneHash:r.candidateHash});
   c.readOriginalReview=async()=>({id:r.reviewId,projectId:r.projectId,baseHash:r.baseHash,candidateHash:r.candidateHash,baseRevision:r.baseRevision,appliedRevision:1,appliedAt:'2026-11-07T00:00:00Z',expiresAt:'2099-01-01T00:00:00Z',changes:[]});
  });
  thirdValue=true;assert.equal(await page.evaluate(async()=>window.ctx.controller.reconcileOriginalReview(window.ctx.receipt.projectId,window.ctx.lease.capability)),'blocked');thirdValue=false;
  const outcome=await page.evaluate(async()=>window.ctx.controller.reconcileOriginalReview(window.ctx.receipt.projectId,window.ctx.lease.capability));
  assert.equal(outcome,'cleared');assert.equal(applyCalls,1);
  const afterClear=await page.evaluate(async()=>window.ctx.controller.commitAuthorizedOriginalReview(window.ctx.receipt,window.ctx.request,window.ctx.lease.capability,()=>true));
  assert.equal(afterClear,'unknown');assert.equal(applyCalls,1);
  assert.equal(await page.evaluate(async()=>window.ctx.controller.reconcileOriginalReview(window.ctx.receipt.projectId,window.ctx.lease.capability)),'cleared');
  await page.evaluate(async()=>window.ctx.lease.release());
  console.log('PASS: lost response, duplicate rejection, browser restart, account/project switch, forged public reads, third value and original-record reconciliation');
 }finally{
  await context.close();
  if(path.resolve(profile)===profile&&path.dirname(profile)===path.resolve(os.tmpdir())&&path.basename(profile).startsWith('scendance-original-review-probe-'))fs.rmSync(profile,{recursive:true,force:true});
 }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
