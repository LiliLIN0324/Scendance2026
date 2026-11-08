// One fictional preview against an explicitly selected isolated local trial.
// Does not apply a candidate, retry a model request, or print credentials/model text.
const {randomUUID}=require('node:crypto');
const {chromium}=require('playwright');
const {safeDiagnostic}=require('./local-trial-diagnostic.cjs');
const port=Number(process.argv[2]);
const mode=process.argv[3]==='--live'?'live':process.argv[3]==='--synthetic'?'synthetic':null;
const uuid=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
if(require.main===module&&(!mode||!Number.isSafeInteger(port)||port<1024||port>65535||[4186,4196,4197,4198].includes(port))){
 console.error('请明确指定独立本机试用端口和 --live 或 --synthetic。');process.exit(2);
}
const origin=`http://127.0.0.1:${port}`;
const progressLabels=new Set(['正在读取当前场景','正在检索模型资源','正在读取局部平面','正在搜索可落点','正在试排课桌椅','正在试排双人课桌椅','正在读取模型材质','正在统计物料清单','正在检查方案','正在整理候选方案']);
const trialStates=new Set(['starting','ready','running','awaiting_user','failed','stopped']);
const runErrorCodes=new Set(['AGENT_CONTEXT_LIMIT','AGENT_DEADLINE','AGENT_NO_VALID_CANDIDATE','AGENT_OUTPUT_TRUNCATED','AGENT_TOOL_CALL_CONFLICT','AGENT_FAILED','AGENT_INVALID_MODEL_RESPONSE','CANDIDATE_GEOMETRY_CONFLICT','CANDIDATES_NOT_DISTINCT','DIMENSION_CONFLICT','INVALID_MATERIAL_TARGET','INVALID_SELECTION','INVALID_TOOL_INPUT','PREPARED_CANDIDATE_NOT_FOUND','RESOURCE_NOT_FOUND','SEATING_ALLOCATION_CONFLICT','SEATING_ALLOCATION_UNCONFIRMED','SEATING_SPEC_CONFLICT','SEATING_SPEC_UNCONFIRMED','SEATING_ATTEMPTS_EXHAUSTED','SEATING_RESULT_INVALID','UNKNOWN_TOOL','VALIDATED_CANDIDATE_NOT_FOUND','MINIMAX_INVALID_TOOL_RESPONSE','MODEL_PROVIDER_INCOMPLETE','MODEL_PROVIDER_PROFILE_INVALID','MODEL_PROVIDER_UNSUPPORTED_WORKFLOW','MODEL_PROVIDER_URL_INVALID','PROVIDER_HTTP_ERROR','PROVIDER_INVALID_JSON','SERVICE_NOT_CONFIGURED','BILLING_NOT_CONFIGURED']);
const traceTools=new Set(['get_scene','search_resources','search_places','inspect_zone','find_free_areas','prepare_seating_candidate','prepare_shared_seating_candidate','inspect_materials','get_bom','validate_candidate','submit_candidates','create_parametric_model','customize_material','start_lux3d_model']);
const traceErrors=new Set(['AGENT_TOOL_CALL_CONFLICT','CANDIDATE_GEOMETRY_CONFLICT','DIMENSION_CONFLICT','INVALID_MATERIAL_TARGET','INVALID_SELECTION','INVALID_TOOL_INPUT','PLACE_SEARCH_FAILED','PLACE_SEARCH_UNAVAILABLE','PREPARED_CANDIDATE_NOT_FOUND','RESOURCE_NOT_FOUND','SEATING_ALLOCATION_CONFLICT','SEATING_ALLOCATION_UNCONFIRMED','SEATING_SPEC_CONFLICT','SEATING_SPEC_UNCONFIRMED','SEATING_ATTEMPTS_EXHAUSTED','SEATING_RESULT_INVALID','UNKNOWN_TOOL','VALIDATED_CANDIDATE_NOT_FOUND']);
const businessErrors=new Set([...traceErrors,'AGENT_TOOL_FAILED','ASSET_MATERIAL_UNSUPPORTED','CANDIDATES_NOT_DISTINCT','DIMENSION_TARGET_REQUIRED','LAYOUT_DOES_NOT_FIT','LAYOUT_REQUIRES_EMPTY_SCENE','OBJECT_LOCKED','OBJECT_NOT_FOUND','OUT_OF_BOUNDS','RESOURCE_SIZE_REQUIRED','STRUCTURAL_COLLISION','VALIDATED_CANDIDATE_NOT_FOUND']);
function safeBusinessTrace(items){
 if(!Array.isArray(items))return [];
 return items.slice(0,64).flatMap(item=>{
  if(!item||typeof item!=='object')return [];
  if(item.tool==='validate_candidate'&&typeof item.valid==='boolean')return [{tool:item.tool,valid:item.valid,...(businessErrors.has(item.errorCode)?{errorCode:item.errorCode}:{})}];
  if(item.tool==='submit_candidates'&&Number.isSafeInteger(item.accepted)&&item.accepted>=0&&item.accepted<=3&&Number.isSafeInteger(item.expected)&&item.expected>=1&&item.expected<=3&&Array.isArray(item.errorCodes))
   return [{tool:item.tool,accepted:item.accepted,expected:item.expected,errorCodes:[...new Set(item.errorCodes.filter(value=>businessErrors.has(value)))].slice(0,3)}];
  if(item.tool==='model_round'&&Number.isSafeInteger(item.turn)&&item.turn>=1&&item.turn<=6&&['start','response','failed'].includes(item.phase)&&Number.isSafeInteger(item.remainingMs)&&item.remainingMs>=0&&item.remainingMs<=900000&&((item.phase==='start'&&item.elapsedMs===undefined)||(item.phase!=='start'&&Number.isSafeInteger(item.elapsedMs)&&item.elapsedMs>=0&&item.elapsedMs<=900000)))
   return [{tool:item.tool,turn:item.turn,phase:item.phase,remainingMs:item.remainingMs,...(item.elapsedMs===undefined?{}:{elapsedMs:item.elapsedMs})}];
  return [];
 });
}
function safeToolTrace(tools){
 if(!Array.isArray(tools))return [];
 return tools.slice(0,100).flatMap(item=>{
  if(!item||typeof item!=='object'||!traceTools.has(item.tool)||!['succeeded','failed','unknown'].includes(item.outcome))return [];
  return [{tool:item.tool,outcome:item.outcome,...(traceErrors.has(item.errorCode)?{errorCode:item.errorCode}:{})}];
 });
}
function safeProgress(value){return progressLabels.has(value)?value:null;}
function safeTrial(value){
 const diagnostic=safeDiagnostic(value?.diagnostic);
 return {state:trialStates.has(value?.state)?value.state:'unavailable',used:Number.isSafeInteger(value?.used)&&value.used>=0?value.used:null,diagnostic};
}
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
async function main(){
 let browser,context,phase='preflight',apiOrigin='',projectId='',authorization='',lease=null,base=null,agentPosts=0;
 const observed=new Set(),externalRequests=[];
 async function status(){const response=await fetch(`${origin}/status`,{signal:AbortSignal.timeout(3000)});if(!response.ok)throw Error('trial_status_unavailable');return response.json();}
 try{
  const initial=await status();if(initial.mode!==mode||initial.state!=='ready'||initial.used!==0)throw Error('trial_not_ready');
  browser=await chromium.launch({headless:true,channel:'msedge'});context=await browser.newContext();
  await context.route('**/*',route=>{const url=new URL(route.request().url());if(url.hostname==='127.0.0.1'||url.protocol==='data:'||url.protocol==='blob:')return route.continue();externalRequests.push(url.origin);return route.abort();});
  context.on('request',request=>{const url=new URL(request.url()),match=url.pathname.match(/^\/functions\/v1\/scene-api\/projects\/([^/]+)\/lease\/acquire$/);if(match){apiOrigin=url.origin;projectId=match[1];authorization=request.headers().authorization||'';}});
  const page=await context.newPage();phase='opening';await page.goto(origin);const frame=page.frameLocator('iframe[title="幕景工作台"]');
  await frame.getByLabel('告诉 Agent 要改的').waitFor({timeout:60000});
  await frame.getByRole('button',{name:'账户中心'}).click();await frame.getByLabel('邮箱').fill('owner@scendance.test');await frame.getByLabel('密码').fill('local-integration-only');await frame.getByRole('button',{name:'登录并进入工作台'}).click();await frame.getByText('已登录。').waitFor({timeout:10000});
  await frame.getByRole('button',{name:'新方案'}).click();await page.waitForTimeout(5000);if(!await frame.getByRole('button',{name:'关闭账户面板'}).count())await frame.getByRole('button',{name:'账户中心'}).click();
  const leaseResponse=page.waitForResponse(response=>response.request().method()==='POST'&&/\/lease\/acquire$/.test(new URL(response.url()).pathname),{timeout:20000});
  await frame.getByRole('button',{name:/当前项目 .*双击进入/}).dblclick();
  const acquired=await leaseResponse;if(acquired.status()!==200||!acquired.headers()['x-scendance-test-fixture']?.includes('PGlite'))throw Error('fixture_not_connected');lease=await acquired.json();
  if(!apiOrigin||new URL(apiOrigin).hostname!=='127.0.0.1'||!uuid.test(projectId)||!authorization||!uuid.test(lease.sessionId)||!Number.isSafeInteger(lease.generation))throw Error('fixture_not_connected');
  const headers={authorization,apikey:'sb_publishable_local_integration_only'};
  async function project(){const response=await context.request.get(`${apiOrigin}/functions/v1/scene-api/projects/${projectId}`,{headers,timeout:10000});if(response.status()!==200||!response.headers()['x-scendance-test-fixture']?.includes('PGlite'))throw Error('scene_unavailable');return response.json();}
  const before=await project();base=before.scene;if(base?.venue?.width!==10||base?.venue?.depth!==8||!Number.isSafeInteger(before.revision))throw Error('unexpected_fixture');
  const request={sessionId:lease.sessionId,generation:lease.generation,expectedRevision:before.revision,requestId:randomUUID(),localRevision:0,scene:base,selectedIds:[],instruction:'在这个虚构场景中读取现有场地，寻找合适位置，提出一把示意椅的待确认方案。不要声称30人布置已经完成或现场安全。',context:{brief:'虚构的室内活动；真实场地与库存未确认。',acceptedDecisions:[],recentMessages:[]},jevEnabled:false,executionMode:'preview'};
  const beforeDispatch=await status();if(beforeDispatch.mode!==mode||beforeDispatch.state!=='ready'||beforeDispatch.used!==0)throw Error('trial_not_ready');
  phase='agent_request';agentPosts++;
  const response=await context.request.post(`${apiOrigin}/functions/v1/scene-api/projects/${projectId}/agent-runs`,{headers,data:request,timeout:15000,maxRetries:0});
  if(response.status()!==202||!response.headers()['x-scendance-test-fixture']?.includes('PGlite'))throw Error('agent_request_rejected');
  let run=await response.json();if(typeof run.id!=='string'||!uuid.test(run.id))throw Error('invalid_run');
  phase='poll';const deadline=Date.now()+105000;let providerStoppedAt=0;
  while(['queued','running'].includes(run.state)&&Date.now()<deadline){
   const trial=await status();
   if(trial.state==='failed'||trial.state==='awaiting_user'){
    if(!providerStoppedAt)providerStoppedAt=Date.now();
    // Read the existing run briefly so a failed attempt can still report its
    // sanitized tool outcomes; this never sends another model request.
    if(Date.now()-providerStoppedAt>=10000)break;
   }
   if(safeProgress(run.progress))observed.add(run.progress);
   await page.waitForTimeout(1000);
   const result=await context.request.get(`${apiOrigin}/functions/v1/scene-api/projects/${projectId}/agent-runs/${run.id}`,{headers,timeout:10000});
   if(result.status()!==200||!result.headers()['x-scendance-test-fixture']?.includes('PGlite'))throw Error('run_unavailable');run=await result.json();
  }
  if(safeProgress(run.progress))observed.add(run.progress);
  const after=await project(),unchanged=JSON.stringify(canonical(base))===JSON.stringify(canonical(after.scene))&&after.revision===before.revision;
  const candidates=Array.isArray(run.candidates)?run.candidates:[];
  const notices=candidates.map(item=>Array.isArray(item?.proposal?.warnings)&&item.proposal.warnings.some(w=>w?.code==='SAFETY_CHECKS_UNKNOWN'));
  const baselineMatches=candidates.every(item=>JSON.stringify(canonical(item?.proposal?.base_scene))===JSON.stringify(canonical(base)));
  const counts=candidates.map(item=>Array.isArray(item?.proposal?.candidate?.objects)?item.proposal.candidate.objects.length:null);
  let traceAvailable=false,toolTrace=[],businessTrace=[];
  try{
   const trace=await context.request.get(`${apiOrigin}/__test-agent-trace/${projectId}/${run.id}`,{headers,timeout:10000});
   if(trace.status()===200&&trace.headers()['x-scendance-test-fixture']?.includes('PGlite')){
    const data=await trace.json();
    if(Array.isArray(data.tools)){
     traceAvailable=true;toolTrace=safeToolTrace(data.tools);businessTrace=safeBusinessTrace(data.business);
    }
   }
  }catch{/* Earlier isolated trials do not expose the optional trace. */}
  const final=await status();
  const result={mode,status:run.state==='complete'&&candidates.length>0&&unchanged&&baselineMatches&&externalRequests.length===0?'candidate':'incomplete',runState:['queued','running','complete','failed','cancelled'].includes(run.state)?run.state:'unknown',errorCode:runErrorCodes.has(run.errorCode)?run.errorCode:null,trial:safeTrial(final),modelRequests:safeTrial(final).used,agentPosts,callCount:Number.isSafeInteger(run.callCount)?run.callCount:null,toolProgress:[...observed],traceAvailable,toolTrace,businessTrace,candidates:candidates.length,candidateObjectCounts:counts,baselineObjectCount:base.objects.length,baselineMatches,unknownWarnings:notices,sceneUnchanged:unchanged,externalRequests:externalRequests.length};
  console.log(JSON.stringify(result));if(result.status!=='candidate')process.exitCode=1;
 }catch(error){
  let trial;try{trial=safeTrial(await status());}catch{trial={state:'unavailable'};}
  const safeReasons=['trial_not_ready','fixture_not_connected','scene_unavailable','unexpected_fixture','agent_request_rejected','invalid_run','run_unavailable','provider_stopped','provider_needs_user'];
  console.log(JSON.stringify({mode,status:'incomplete',phase,reason:safeReasons.includes(error.message)?error.message:'interaction_or_timeout',agentPosts,toolProgress:[...observed],trial}));process.exitCode=1;
 }finally{await context?.close();await browser?.close();}
}
module.exports={safeToolTrace,safeProgress,safeBusinessTrace};
if(require.main===module)void main();
