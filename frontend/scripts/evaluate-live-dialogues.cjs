#!/usr/bin/env node
// Fixed fictional prompts only. Isolated local trial, no automatic retries or scene application.
const {spawnSync}=require('node:child_process');
const {chromium}=require('playwright');
const {safeToolTrace,safeBusinessTrace}=require('./verify-live-agent-direct.cjs');

const cases=[
 {id:'checkin_unknown',message:'30人，室内，签到尚未决定',check:x=>x.headcount===30&&x.venueIO==='indoor'&&Array.isArray(x.activityNeeds)&&x.activityNeeds.some(n=>n.kind==='checkin'&&n.decision==='unknown')&&x.mobilityAssistance!==true},
 {id:'inventory_reported',message:'我们有80把椅子',check:x=>x.headcount==null&&Array.isArray(x.inventoryMentions)&&x.inventoryMentions.length>0},
 {id:'missing_facts',message:'我想在养老社区办点活动，还没有场地和人数',check:x=>x.headcount==null&&x.venueIO==null&&x.mobilityAssistance!==true},
 {id:'venue_and_attendance',message:'为30人办室内讲座，场地长10米宽8米，采用课桌椅布局，生成方案',check:x=>x.headcount===30&&x.venueIO==='indoor'&&x.lengthM===10&&x.widthM===8&&x.layoutMode==='desk-chair'},
 {id:'desk_ratio',message:'30人，每2人一桌，采用课桌椅，生成本地草案',check:x=>x.headcount===30&&x.layoutMode==='desk-chair'},
];
const terminalDiagnostics=new Set(['http_error','timeout','cancelled_or_upstream_timeout','network_error','response_too_large','response_empty','response_encoding','provider_non_json','provider_envelope_invalid','provider_reported_error','provider_incomplete','provider_tool_call','model_non_json','model_schema_invalid','model_evidence_mismatch','model_execution_claim','model_text_invalid','unknown_error']);
const terminalReasons=new Set(['MODEL_INVALID_RESPONSE','MODEL_INVALID_JSON','MODEL_EVIDENCE_MISMATCH','MODEL_TIMEOUT','MODEL_INCOMPLETE_OUTPUT','PROVIDER_INVALID_JSON','MODEL_REQUEST_FAILED','SERVICE_NOT_CONFIGURED']);
const uuid=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const forbiddenPorts=new Set([4186,4196,4197,4198,4213,4215,4246,4248,4249,4250,4252,4254,4255,4256,4257,4258,4259]);

function parseOptions(argv){
 // Port, mode and budget are explicit; an existing trial also requires its observed count.
 const port=Number(argv[0]);const mode=argv[1]==='--live'?'live':argv[1]==='--synthetic'?'synthetic':null;
 const count=Number(argv[2]);const maxCalls=Number(argv[3]);const flags=argv.slice(4);const tool=flags.includes('--include-tool');
 const usedFlags=flags.filter(x=>/^--expected-used=\d+$/.test(x)),offsetFlags=flags.filter(x=>/^--offset=\d+$/.test(x));
 const expectedUsed=usedFlags.length?Number(usedFlags[0].split('=')[1]):0,offset=offsetFlags.length?Number(offsetFlags[0].split('=')[1]):0;
 if(argv.length<4||flags.some(x=>x!=='--include-tool'&&!/^--expected-used=\d+$/.test(x)&&!/^--offset=\d+$/.test(x))||flags.filter(x=>x==='--include-tool').length>1||usedFlags.length>1||offsetFlags.length>1||!mode||!/^\d+$/.test(argv[0]??'')||!Number.isSafeInteger(port)||port<1024||port>65535||forbiddenPorts.has(port)||!/^\d+$/.test(argv[2]??'')||!Number.isSafeInteger(count)||count<1||!Number.isSafeInteger(offset)||offset<0||offset+count>cases.length||!/^\d+$/.test(argv[3]??'')||!Number.isSafeInteger(maxCalls)||maxCalls<count+(tool?6:0)||maxCalls>12||!Number.isSafeInteger(expectedUsed)||expectedUsed<0||(tool&&expectedUsed!==0))throw Error('invalid_options');
 return {port,mode,count,maxCalls,tool,expectedUsed,offset};
}
function evaluateCase(spec,value){
 const ratio=spec.id==='desk_ratio'?{systemRatio:'not_exercised'}:{};
 if(!value||typeof value!=='object'||Array.isArray(value)||value.enabled!==true||!value.extraction||typeof value.extraction!=='object'||Array.isArray(value.extraction))return {status:'unavailable',reason:terminalReasons.has(value?.reason)?value.reason:'INVALID_OR_UNAVAILABLE',modelExtraction:'unavailable',...ratio};
 let good=false;try{good=spec.check(value.extraction)===true;}catch{/* malformed result is a failed assertion */}
 if(!good)return {status:'failed',reason:'EXPECTED_FACTS_NOT_MET',modelExtraction:'failed',...ratio};
 // The brief API exposes attendance and layout but not the deterministic per-desk allocation.
 // Passing those fields is not proof that "two per desk" survived the whole product pipeline.
 if(spec.id==='desk_ratio')return {status:'partial',reason:'SYSTEM_RATIO_NOT_EXERCISED',modelExtraction:'passed',systemRatio:'not_exercised'};
 return {status:'passed',reason:null,modelExtraction:'passed'};
}
function safeStatus(value){return {state:['starting','ready','running','awaiting_user','failed','stopped'].includes(value?.state)?value.state:'unavailable',used:Number.isSafeInteger(value?.used)&&value.used>=0?value.used:null,diagnostic:terminalDiagnostics.has(value?.diagnostic?.code)?value.diagnostic.code:null};}
function safeToolResult(value){
 if(!value||typeof value!=='object')return {status:'unavailable'};
 const max=n=>Number.isSafeInteger(n)&&n>=0&&n<=1000?n:null;
 return {status:value.status==='candidate'?'candidate':'incomplete',runState:['complete','failed','cancelled','running','queued'].includes(value.runState)?value.runState:'unknown',modelRequests:max(value.modelRequests),candidateCount:max(value.candidates),sceneUnchanged:value.sceneUnchanged===true,baselineMatches:value.baselineMatches===true,unknownWarnings:Array.isArray(value.unknownWarnings)?value.unknownWarnings.slice(0,3).map(v=>v===true):[],traceAvailable:value.traceAvailable===true,toolTrace:safeToolTrace(value.toolTrace),businessTrace:safeBusinessTrace(value.businessTrace)};
}

async function run(options){
 const origin=`http://127.0.0.1:${options.port}`,started=Date.now(),results=[];let browser,context,authorization='',apiOrigin='',projectId='',toolResult={status:'not_exercised'},externalRequests=0;
 const status=async()=>{const response=await fetch(`${origin}/status`,{signal:AbortSignal.timeout(3000)});if(!response.ok)throw Error('status_unavailable');return response.json();};
 let baseline=0,stopReason=null;
 try{
  const initial=await status();if(initial.mode!==options.mode||initial.state!=='ready'||initial.used!==options.expectedUsed)throw Error('trial_not_fresh');
  if(options.tool){
   const child=spawnSync(process.execPath,[require.resolve('./verify-live-agent-direct.cjs'),String(options.port),`--${options.mode}`],{cwd:__dirname,encoding:'utf8',timeout:150000,maxBuffer:512000,windowsHide:true});
   let parsed;try{parsed=JSON.parse(child.stdout);}catch{throw Error('tool_result_unavailable');}
   toolResult=safeToolResult(parsed);if(child.status!==0||toolResult.status!=='candidate'||!toolResult.sceneUnchanged||!toolResult.baselineMatches)throw Error('tool_case_incomplete');
  }
  let current=await status();baseline=current.used;if(current.mode!==options.mode||current.state!=='ready'||!Number.isSafeInteger(baseline)||baseline<options.expectedUsed||baseline-options.expectedUsed+options.count>options.maxCalls)throw Error('budget_or_state');
  browser=await chromium.launch({headless:true,channel:'msedge'});context=await browser.newContext();
  await context.route('**/*',route=>{const u=new URL(route.request().url());if(u.hostname==='127.0.0.1'||u.protocol==='data:'||u.protocol==='blob:')return route.continue();externalRequests++;return route.abort();});
  context.on('request',request=>{const u=new URL(request.url()),match=u.pathname.match(/^\/functions\/v1\/scene-api\/projects\/([^/]+)\/lease\/acquire$/);if(match){apiOrigin=u.origin;projectId=match[1];authorization=request.headers().authorization||'';}});
  const page=await context.newPage();await page.goto(origin);const frame=page.frameLocator('iframe[title="幕景工作台"]');
  await frame.getByLabel('告诉 Agent 要改的').waitFor({timeout:60000});
  await frame.getByRole('button',{name:'账户中心'}).click();await frame.getByLabel('邮箱').fill('owner@scendance.test');await frame.getByLabel('密码').fill('local-integration-only');await frame.getByRole('button',{name:'登录并进入工作台'}).click();await frame.getByText('已登录。').waitFor({timeout:10000});
  await frame.getByRole('button',{name:'新方案'}).click();await page.waitForTimeout(5000);if(!await frame.getByRole('button',{name:'关闭账户面板'}).count())await frame.getByRole('button',{name:'账户中心'}).click();
  const acquired=page.waitForResponse(response=>response.request().method()==='POST'&&/\/lease\/acquire$/.test(new URL(response.url()).pathname),{timeout:20000});
  await frame.getByRole('button',{name:/当前项目 .*双击进入/}).dblclick();const lease=await acquired;
  if(lease.status()!==200||!lease.headers()['x-scendance-test-fixture']?.includes('PGlite')||!uuid.test(projectId)||!authorization||new URL(apiOrigin).hostname!=='127.0.0.1')throw Error('fixture_not_connected');
  const headers={authorization,apikey:'sb_publishable_local_integration_only'};
  const project=async()=>{const response=await context.request.get(`${apiOrigin}/functions/v1/scene-api/projects/${projectId}`,{headers,timeout:10000});if(response.status()!==200||!response.headers()['x-scendance-test-fixture']?.includes('PGlite'))throw Error('scene_unavailable');return response.json();};
  const before=await project();if(before.scene?.venue?.width!==10||before.scene?.venue?.depth!==8||!Number.isSafeInteger(before.revision))throw Error('unexpected_fixture');
  const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
  for(const spec of cases.slice(options.offset,options.offset+options.count)){
   current=await status();if(current.state!=='ready'||!Number.isSafeInteger(current.used)||current.used<options.expectedUsed||current.used-options.expectedUsed>=options.maxCalls)throw Error('budget_or_state');
   const beforeUsed=current.used,t0=Date.now();let response,value;
   try{response=await context.request.post(`${apiOrigin}/functions/v1/scene-api/brief/extract`,{headers,data:{message:spec.message,responseMode:'conversation_v1',history:[]},timeout:125000,maxRetries:0});value=await response.json();}
   catch{results.push({id:spec.id,status:'incomplete',reason:'REQUEST_RESULT_UNKNOWN',durationMs:Date.now()-t0,modelRequests:null,toolExecution:'not_exercised',outcomeVerification:'not_exercised'});throw Error('request_result_unknown');}
   current=await status();const requests=Number.isSafeInteger(current.used)?current.used-beforeUsed:null;
   if(response.status()!==200||!response.headers()['x-scendance-test-fixture']?.includes('PGlite')||requests!==1){results.push({id:spec.id,status:'incomplete',reason:'INVALID_RESPONSE_OR_COUNT',durationMs:Date.now()-t0,modelRequests:requests,toolExecution:'not_exercised',outcomeVerification:'not_exercised'});throw Error('response_incomplete');}
   const scored=evaluateCase(spec,value);results.push({id:spec.id,...scored,durationMs:Date.now()-t0,modelRequests:requests,toolExecution:'not_exercised',outcomeVerification:'not_exercised'});
   if(scored.status!=='passed'&&scored.status!=='partial')throw Error(scored.status==='failed'?'fact_assertion_failed':'model_output_unavailable');
   if(current.state!=='ready'||current.diagnostic)throw Error('provider_stopped');
  }
  const after=await project();const same=before.revision===after.revision&&JSON.stringify(canonical(before.scene))===JSON.stringify(canonical(after.scene));
  if(!same||externalRequests!==0)throw Error('fixture_integrity');
  const totalUsed=(await status()).used;
  return {mode:options.mode,status:'complete',model:options.mode==='live'?'real-provider':'fixed-synthetic',durationMs:Date.now()-started,modelRequests:Number.isSafeInteger(totalUsed)?totalUsed-options.expectedUsed:null,trialTotalUsed:totalUsed,dialogues:results,toolExecution:toolResult,sceneUnchanged:same,externalRequests,limitations:['对话案例只校验固定字段；没有完成场地安全、真实库存或自然语言质量验收','未请求工具的案例不计作工具或方案成功','模型输出与工具参数未写入报告','最大调用数在每个案例前检查；已发出的模型请求不能撤回']};
 }catch(error){
  const allowed=new Set(['trial_not_fresh','tool_result_unavailable','tool_case_incomplete','budget_or_state','fixture_not_connected','scene_unavailable','unexpected_fixture','request_result_unknown','response_incomplete','fact_assertion_failed','model_output_unavailable','provider_stopped','fixture_integrity']);
  stopReason=allowed.has(error?.message)?error.message:'interaction_or_timeout';let final={state:'unavailable',used:null,diagnostic:null};try{final=safeStatus(await status());}catch{}
  return {mode:options.mode,status:'incomplete',reason:stopReason,durationMs:Date.now()-started,modelRequests:Number.isSafeInteger(final.used)?Math.max(0,final.used-options.expectedUsed):null,trialTotalUsed:final.used,dialogues:results,toolExecution:toolResult,trial:final,sceneUnchanged:'not_verified',externalRequests,limitations:['失败或结果不明时停止，没有自动重试','尚未完成真实场地、库存或安全验收']};
 }finally{await context?.close();await browser?.close();}
}
if(require.main===module){
 let options;try{options=parseOptions(process.argv.slice(2));}catch{console.error('用法：node evaluate-live-dialogues.cjs <隔离端口> <--synthetic|--live> <案例数1-5> <最多模型请求数> [--expected-used=N] [--offset=N] [--include-tool]');process.exit(2);}
 run(options).then(report=>{console.log(JSON.stringify(report));if(report.status!=='complete')process.exitCode=1;}).catch(()=>{console.error('评测未完成。');process.exitCode=2;});
}
module.exports={cases,parseOptions,evaluateCase,safeStatus,safeToolResult,run};
