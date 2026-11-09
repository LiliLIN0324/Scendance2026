// One fictional selected-asset preview against a fresh isolated trial.
// Creates only an isolated test asset; never applies a proposal, retries, or prints model text/credentials.
const {randomUUID}=require('node:crypto');
const {chromium}=require('playwright');
const {safeToolTrace,safeBusinessTrace}=require('./verify-live-agent-direct.cjs');
const {safeDiagnostic}=require('./local-trial-diagnostic.cjs');
const port=Number(process.argv[2]);
const mode=process.argv[3]==='--live'?'live':process.argv[3]==='--synthetic'?'synthetic':null;
const forbidden=new Set([4186,4196,4197,4198,4213,4215,4246,4248,4249,4250,4252,4254,4255,4256,4257,4258,4259,4260,4261]);
const uuid=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const sha256=/^[0-9a-f]{64}$/;
const runErrors=new Set(['AGENT_CONTEXT_LIMIT','AGENT_DEADLINE','AGENT_NO_VALID_CANDIDATE','AGENT_OUTPUT_TRUNCATED','AGENT_TOOL_CALL_CONFLICT','AGENT_FAILED','AGENT_INVALID_MODEL_RESPONSE','CANDIDATE_GEOMETRY_CONFLICT','INVALID_MATERIAL_TARGET','INVALID_SELECTION','INVALID_TOOL_INPUT','RESOURCE_NOT_FOUND','UNKNOWN_TOOL','VALIDATED_CANDIDATE_NOT_FOUND','MINIMAX_INVALID_TOOL_RESPONSE','MODEL_PROVIDER_INCOMPLETE','MODEL_PROVIDER_PROFILE_INVALID','MODEL_PROVIDER_UNSUPPORTED_WORKFLOW','MODEL_PROVIDER_URL_INVALID','PROVIDER_HTTP_ERROR','PROVIDER_INVALID_JSON','SERVICE_NOT_CONFIGURED','BILLING_NOT_CONFIGURED']);
if(!mode||!Number.isSafeInteger(port)||port<1024||port>65535||forbidden.has(port)){
 console.error('请指定新的隔离试用端口和 --live 或 --synthetic。');process.exit(2);
}
const origin=`http://127.0.0.1:${port}`;
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
async function main(){
 let browser,context,apiOrigin='',projectId='',auth='',lease=null,phase='preflight',agentPosts=0,runId='';
 const external=[];
 const status=async()=>{const response=await fetch(`${origin}/status`,{signal:AbortSignal.timeout(3000)});if(!response.ok)throw Error('trial_status_unavailable');return response.json();};
 try{
  const first=await status();if(first.mode!==mode||first.state!=='ready'||first.used!==0)throw Error('trial_not_ready');
  browser=await chromium.launch({headless:true,channel:'msedge'});context=await browser.newContext();
  await context.route('**/*',route=>{const url=new URL(route.request().url());if(url.hostname==='127.0.0.1'||url.protocol==='data:'||url.protocol==='blob:')return route.continue();external.push(url.origin);return route.abort();});
  context.on('request',request=>{const url=new URL(request.url()),match=url.pathname.match(/^\/functions\/v1\/scene-api\/projects\/([^/]+)\/lease\/acquire$/);if(match){apiOrigin=url.origin;projectId=match[1];auth=request.headers().authorization||'';}});
  const page=await context.newPage();phase='opening';await page.goto(origin);const frame=page.frameLocator('iframe[title="幕景工作台"]');
  await frame.getByLabel('告诉 Agent 要改的').waitFor({timeout:60000});
  await frame.getByRole('button',{name:'账户中心'}).click();await frame.getByLabel('邮箱').fill('owner@scendance.test');await frame.getByLabel('密码').fill('local-integration-only');await frame.getByRole('button',{name:'登录并进入工作台'}).click();await frame.getByText('已登录。').waitFor({timeout:10000});
  await frame.getByRole('button',{name:'新方案'}).click();await page.waitForTimeout(5000);if(!await frame.getByRole('button',{name:'关闭账户面板'}).count())await frame.getByRole('button',{name:'账户中心'}).click();
  const waiting=page.waitForResponse(response=>response.request().method()==='POST'&&/\/lease\/acquire$/.test(new URL(response.url()).pathname),{timeout:20000});
  await frame.getByRole('button',{name:/当前项目 .*双击进入/}).dblclick();const acquired=await waiting;
  if(acquired.status()!==200||!acquired.headers()['x-scendance-test-fixture']?.includes('PGlite'))throw Error('fixture_not_connected');lease=await acquired.json();
  if(!apiOrigin||new URL(apiOrigin).hostname!=='127.0.0.1'||!uuid.test(projectId)||!auth||!uuid.test(lease.sessionId)||!Number.isSafeInteger(lease.generation))throw Error('fixture_not_connected');
  const headers={authorization:auth,apikey:'sb_publishable_local_integration_only'};
  async function get(path){const response=await context.request.get(`${apiOrigin}/functions/v1/scene-api${path}`,{headers,timeout:10000});if(response.status()!==200||!response.headers()['x-scendance-test-fixture']?.includes('PGlite'))throw Error('fixture_read_failed');return response.json();}
  const before=await get(`/projects/${projectId}`);if(before.scene?.venue?.width!==10||before.scene?.venue?.depth!==8||!Number.isSafeInteger(before.revision))throw Error('unexpected_fixture');
  phase='asset_setup';
  const created=await context.request.post(`${apiOrigin}/functions/v1/scene-api/assets/parametric`,{headers,data:{requestId:randomUUID(),studioId:'20000000-0000-4000-8000-000000000001',parameters:{family:'table',width:1.2,depth:0.7,height:0.75}},timeout:20000,maxRetries:0});
  if(![200,201].includes(created.status())||!created.headers()['x-scendance-test-fixture']?.includes('PGlite'))throw Error('fixture_asset_failed');
  const asset=await created.json(),assetId=asset?.asset?.id;if(!uuid.test(assetId??''))throw Error('fixture_asset_failed');
  const original=await get(`/assets/${assetId}/materials`);if(!sha256.test(original.sha256??'')||!sha256.test(original.validation?.geometryUVSignature??'')||!Array.isArray(original.slots)||!original.slots.some(slot=>slot.index===0&&slot.primitiveCount>0))throw Error('fixture_asset_failed');
  const objectId=randomUUID(),draft=structuredClone(before.scene);draft.objects.push({id:objectId,materialId:'asset',assetId,position:{x:1.1,z:6.7},rotation:0,size:{width:1.2,depth:0.7,height:0.75},color:'#ffffff',locked:false,notes:''});
  const request={sessionId:lease.sessionId,generation:lease.generation,expectedRevision:before.revision,requestId:randomUUID(),localRevision:0,scene:draft,selectedIds:[objectId],instruction:'把选中的示意桌子材质改为中性灰色 #808080，先检查材质并创建变体，只提交预览，不要应用场景。',context:{brief:'虚构活动，数字模型不代表真实库存。',acceptedDecisions:[],recentMessages:[]},jevEnabled:false,executionMode:'preview'};
  const pre=await status();if(pre.mode!==mode||pre.state!=='ready'||pre.used!==0)throw Error('trial_not_ready');
  phase='agent_request';agentPosts++;
  const posted=await context.request.post(`${apiOrigin}/functions/v1/scene-api/projects/${projectId}/agent-runs`,{headers,data:request,timeout:15000,maxRetries:0});
  if(posted.status()!==202||!posted.headers()['x-scendance-test-fixture']?.includes('PGlite'))throw Error('agent_request_rejected');
  let run=await posted.json();if(!uuid.test(run.id??''))throw Error('invalid_run');runId=run.id;
  phase='poll';const deadline=Date.now()+105000;let stoppedAt=0;
  while(['queued','running'].includes(run.state)&&Date.now()<deadline){
   const trial=await status();if(trial.state==='failed'||trial.state==='awaiting_user'){if(!stoppedAt)stoppedAt=Date.now();if(Date.now()-stoppedAt>=10000)break;}
   await page.waitForTimeout(1000);run=await get(`/projects/${projectId}/agent-runs/${runId}`);
  }
  const after=await get(`/projects/${projectId}`),unchanged=after.revision===before.revision&&JSON.stringify(canonical(after.scene))===JSON.stringify(canonical(before.scene));
  let traceAvailable=false,toolTrace=[],businessTrace=[];
  try{const response=await context.request.get(`${apiOrigin}/__test-agent-trace/${projectId}/${runId}`,{headers,timeout:10000});if(response.status()===200&&response.headers()['x-scendance-test-fixture']?.includes('PGlite')){const data=await response.json();if(Array.isArray(data.tools)){traceAvailable=true;toolTrace=safeToolTrace(data.tools);businessTrace=safeBusinessTrace(data.business);}}}catch{/* explicitly unavailable */}
  const candidates=Array.isArray(run.candidates)?run.candidates:[];let variantVerified=false,otherObjectsUnchanged=false,baselineMatches=false,geometryPreserved=false,requestedColor=false,sourceUnchanged=false,unknownVisible=false;
  for(const item of candidates){
   const proposal=item?.proposal,target=proposal?.candidate?.objects?.find(o=>o.id===objectId);if(!target||!uuid.test(target.assetId??'')||target.assetId===assetId)continue;
   const variant=await get(`/assets/${target.assetId}/materials`),sourceAgain=await get(`/assets/${assetId}/materials`);
   const {assetId:beforeAsset,...beforeObject}=draft.objects.find(o=>o.id===objectId),{assetId:afterAsset,...afterObject}=target;void beforeAsset;void afterAsset;
   otherObjectsUnchanged=JSON.stringify(canonical(proposal.candidate.objects.filter(o=>o.id!==objectId)))===JSON.stringify(canonical(draft.objects.filter(o=>o.id!==objectId)))&&JSON.stringify(canonical(beforeObject))===JSON.stringify(canonical(afterObject));
   baselineMatches=JSON.stringify(canonical(proposal.base_scene))===JSON.stringify(canonical(draft));
   geometryPreserved=sha256.test(variant.validation?.geometryUVSignature??'')&&original.validation.geometryUVSignature===variant.validation.geometryUVSignature;
   requestedColor=variant.slots?.some(slot=>slot.index===0&&String(slot.baseColor).toLowerCase()==='#808080')===true;
   sourceUnchanged=sha256.test(sourceAgain.sha256??'')&&original.sha256===sourceAgain.sha256;
   unknownVisible=Array.isArray(proposal.warnings)&&proposal.warnings.some(w=>w?.code==='SAFETY_CHECKS_UNKNOWN');
   variantVerified=baselineMatches&&otherObjectsUnchanged&&geometryPreserved&&requestedColor&&sourceUnchanged&&unknownVisible;
   if(variantVerified)break;
  }
  const trial=await status();const success=run.state==='complete'&&variantVerified&&unchanged&&external.length===0&&traceAvailable&&toolTrace.some(t=>t.tool==='inspect_materials'&&t.outcome==='succeeded')&&toolTrace.some(t=>t.tool==='customize_material'&&t.outcome==='succeeded')&&businessTrace.some(t=>t.tool==='submit_candidates'&&t.accepted===1&&t.expected===1);
  console.log(JSON.stringify({mode,status:success?'verified_preview':'incomplete',runState:['queued','running','complete','failed','cancelled'].includes(run.state)?run.state:'unknown',errorCode:runErrors.has(run.errorCode)?run.errorCode:null,modelRequests:Number.isSafeInteger(trial.used)?trial.used:null,agentPosts,candidateCount:candidates.length,variantVerified,requestedColor,geometryPreserved,sourceUnchanged,otherObjectsUnchanged,baselineMatches,unknownVisible,sceneUnchanged:unchanged,traceAvailable,toolTrace,businessTrace,browserExternalRequests:external.length,limitations:['仅隔离测试资产；材质副本写入测试资源库，不等于场景已应用','浏览器外网请求计数不包括服务器到模型服务的请求','工具返回不等于真实库存、现场安全或用户已确认']}));
  if(!success)process.exitCode=1;
 }catch(error){
  let trial={state:'unavailable',used:null,diagnostic:null};try{const value=await status();trial={state:['starting','ready','running','awaiting_user','failed','stopped'].includes(value.state)?value.state:'unavailable',used:Number.isSafeInteger(value.used)?value.used:null,diagnostic:safeDiagnostic(value.diagnostic)};}catch{}
  const reasons=['trial_not_ready','fixture_not_connected','fixture_read_failed','unexpected_fixture','fixture_asset_failed','agent_request_rejected','invalid_run'];
  console.log(JSON.stringify({mode,status:'incomplete',phase,reason:reasons.includes(error.message)?error.message:'interaction_or_timeout',agentPosts,trial}));process.exitCode=1;
 }finally{await context?.close();await browser?.close();}
}
void main();
