// One fictional 30-person preview through the real local workbench UI.
// A baseline request count is mandatory; never applies a proposal or retries.
const {chromium}=require('playwright');
const {safeToolTrace,safeBusinessTrace}=require('./verify-live-agent-direct.cjs');
const port=Number(process.argv[2]);
const mode=process.argv[3]==='--live'?'live':process.argv[3]==='--synthetic'?'synthetic':null;
const expectedUsed=Number(process.argv[4]);
if(require.main===module&&(!mode||!Number.isSafeInteger(port)||port<1024||port>65535||[4186,4196,4197,4198,4213,4215,4246].includes(port)||!/^\d+$/.test(process.argv[4]??'')||!Number.isSafeInteger(expectedUsed))){
 console.error('请指定独立试用端口、--live 或 --synthetic 和当前已调用次数。');process.exit(2);
}
const origin=`http://127.0.0.1:${port}`;
const sample='为30人办室内讲座，场地长10米宽8米，每2人一桌，采用课桌椅布局，生成方案';
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const uuid=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const semanticErrors=new Set(['model_non_json','model_schema_invalid','model_evidence_mismatch','model_execution_claim','model_text_invalid']);
/** Decide only from questions whose wording and every answer are fixed by this fictional sample.
 * Never print or retain the question: model output may contain private text. */
function classifyQuestion(value){
 const text=typeof value==='string'?value.trim():'';
 const confirm=text.match(/^以下信息还需核对：(.+)。这样对吗？回复「确认」或「不对」。$/u);
 if(confirm){
  const fields={'人数':'30','室内外':'室内','场地长（米）':'10','场地宽（米）':'8','布置方式':'课桌椅','活动':'讲座'};
  const seen=new Set();
  for(const part of confirm[1].split('、')){
   const match=part.match(/^(.+?)\s+(.+)$/u);if(!match||!Object.hasOwn(fields,match[1])||seen.has(match[1]))return {kind:'needs_clarification'};
   seen.add(match[1]);if(match[2]!==fields[match[1]])return {kind:'fact_mismatch'};
  }
  return seen.size?{kind:'reply',reply:'确认',key:`confirm:${[...seen].sort().join('|')}`}:{kind:'needs_clarification'};
 }
 const restate=text.match(/^刚才的(.+)无法确定，请重新说明；回复「确认」不能代替具体信息。$/u);
 if(restate){
  const values={'本场人数':'本场总人数30人','场地长宽（单位：米）':'场地长10米宽8米','室内外':'本场在室内','布置方式':'采用课桌椅布局，每2人一桌','活动':'本场是讲座'};
  const names=restate[1].split('、');if(!names.length||new Set(names).size!==names.length||names.some(name=>!Object.hasOwn(values,name)))return {kind:'needs_clarification'};
  return {kind:'reply',reply:names.map(name=>values[name]).join('，'),key:`restate:${names.slice().sort().join('|')}`};
 }
 if(text==='请先说明本场预计人数，再生成布置方案。'||/^(?:本场|这场活动)(?:预计)?人数是多少[？?]$/u.test(text))return {kind:'reply',reply:'本场总人数30人',key:'attendance'};
 if(/^(?:每桌|每张桌子)(?:坐|安排)?(?:多少|几)(?:人|位)[？?]$/u.test(text))return {kind:'reply',reply:'每2人一桌',key:'ratio'};
 if(/[？?]|(?:请(?:先|再)?(?:说明|确认|告诉|选择)|是否需要|要不要|需要.{0,16}吗)/u.test(text))return {kind:'needs_clarification'};
 return {kind:'none'};
}
async function main(){
 let browser,context,apiOrigin='',projectId='',authorization='',base,baseRevision=-1,runId='',requestId='',runState='',runError='',agentPosts=0,applyPosts=0,confirmations=0,sharedRequirement=false,phase='preflight';
 let candidates=[],externalRequests=0,traceAvailable=false,toolTrace=[],businessTrace=[];
 const pending=[];
 async function status(){const response=await fetch(`${origin}/status`,{signal:AbortSignal.timeout(3000)});if(!response.ok)throw Error('trial_status_unavailable');return response.json();}
 try{
  const initial=await status();if(initial.mode!==mode||initial.state!=='ready'||initial.used!==expectedUsed)throw Error('trial_not_ready');
  browser=await chromium.launch({headless:true,channel:'msedge'});context=await browser.newContext();
  await context.route('**/*',route=>{const u=new URL(route.request().url());if(u.hostname==='127.0.0.1'||u.protocol==='data:'||u.protocol==='blob:')return route.continue();externalRequests++;return route.abort();});
  context.on('request',request=>{const u=new URL(request.url());const lease=u.pathname.match(/^\/functions\/v1\/scene-api\/projects\/([^/]+)\/lease\/acquire$/);
   if(lease){apiOrigin=u.origin;projectId=lease[1];authorization=request.headers().authorization||'';}
   if(request.method()==='POST'&&/\/agent-runs$/.test(u.pathname)){
    agentPosts++;try{const body=request.postDataJSON();const allocation=body.context?.seatingAllocation;sharedRequirement=allocation?.status==='shared_desk'&&allocation?.peoplePerDesk===2;if(uuid.test(body.requestId??''))requestId=body.requestId;}catch{/* report false */}
   }
   if(request.method()==='POST'&&/\/proposals\/apply$/.test(u.pathname))applyPosts++;
  });
  context.on('response',response=>{const u=new URL(response.url());if(!u.pathname.includes('/agent-runs'))return;
   pending.push(response.json().then(value=>{if(uuid.test(value.id??''))runId=value.id;if(['complete','failed','cancelled'].includes(value.state)){runState=value.state;runError=typeof value.errorCode==='string'?value.errorCode:'';candidates=Array.isArray(value.candidates)?value.candidates:[];}}).catch(()=>{}));
  });
  const page=await context.newPage();phase='opening';await page.goto(origin);const frame=page.frameLocator('iframe[title="幕景工作台"]');
  await frame.getByLabel('告诉 Agent 要改的').waitFor({timeout:60000});
  await frame.getByRole('button',{name:'账户中心'}).click();await frame.getByLabel('邮箱').fill('owner@scendance.test');await frame.getByLabel('密码').fill('local-integration-only');await frame.getByRole('button',{name:'登录并进入工作台'}).click();await frame.getByText('已登录。').waitFor({timeout:10000});
  await frame.getByRole('button',{name:'新方案'}).click();await page.waitForTimeout(5000);if(!await frame.getByRole('button',{name:'关闭账户面板'}).count())await frame.getByRole('button',{name:'账户中心'}).click();
  const acquired=page.waitForResponse(response=>response.request().method()==='POST'&&/\/lease\/acquire$/.test(new URL(response.url()).pathname),{timeout:20000});
  await frame.getByRole('button',{name:/当前项目 .*双击进入/}).dblclick();const lease=await acquired;
  if(lease.status()!==200||!lease.headers()['x-scendance-test-fixture']?.includes('PGlite')||!uuid.test(projectId)||new URL(apiOrigin).hostname!=='127.0.0.1'||!authorization)throw Error('fixture_not_connected');
  const headers={authorization,apikey:'sb_publishable_local_integration_only'};
  async function project(){const response=await context.request.get(`${apiOrigin}/functions/v1/scene-api/projects/${projectId}`,{headers,timeout:10000});if(response.status()!==200||!response.headers()['x-scendance-test-fixture']?.includes('PGlite'))throw Error('scene_unavailable');return response.json();}
  const before=await project();base=before.scene;baseRevision=before.revision;
  if(base?.venue?.width!==10||base?.venue?.depth!==8||!Number.isSafeInteger(baseRevision))throw Error('unexpected_fixture');
  await page.waitForTimeout(3000);
  if((await status()).used!==expectedUsed)throw Error('trial_not_ready');
  const send=async text=>{phase='input';await frame.getByLabel('告诉 Agent 要改的').fill(text);phase='send';await frame.getByRole('button',{name:'发送',exact:true}).click();phase='awaiting';};
  const bubbles=frame.locator('.ap-turn > p.ap-agent');let seenBubbles=await bubbles.count();
  const handledQuestions=new Map();
  phase='conversation';await send(sample);const deadline=Date.now()+150000;let preview=false,unknownVisible=false,idleSince=0;
  while(Date.now()<deadline){
   const state=await status();if(state.state==='failed')throw Error('provider_stopped');if(state.state==='awaiting_user')throw Error('provider_needs_user');
   if(await frame.locator('#plan-proposal').count()){preview=true;unknownVisible=await frame.locator('#plan-proposal').getByText(/待核验|尚未确认|未知/).count()>0;break;}
   if(runState==='failed'||runState==='cancelled')break;
   // The send button is also disabled when the composer is empty. It cannot
   // signal whether understanding is in flight; use the actual stop control.
   const count=await bubbles.count();const understanding=await frame.getByRole('button',{name:'停止等待',exact:true}).count()>0;
   if(!agentPosts&&state.state==='ready'&&state.used>expectedUsed&&semanticErrors.has(state.diagnostic?.code)&&!understanding&&count>seenBubbles)throw Error('model_output_invalid');
   if(!agentPosts&&state.state==='ready'&&!understanding&&count>seenBubbles){
    seenBubbles=count;const decision=classifyQuestion(await bubbles.nth(count-1).innerText());
    if(decision.kind==='fact_mismatch')throw Error('fact_mismatch');
    if(decision.kind==='needs_clarification')throw Error('needs_clarification');
    if(decision.kind==='reply'){
     const n=handledQuestions.get(decision.key)??0;if(n>=1||confirmations>=3)throw Error('clarification_limit');
     handledQuestions.set(decision.key,n+1);await send(decision.reply);confirmations++;
     idleSince=0;
    }
   }
   // A completed response with an idle input and no active run needs a
   // person or a supported follow-up. Do not wait out the full run deadline.
   if(!agentPosts&&state.state==='ready'&&state.used>expectedUsed&&!understanding){
    if(!idleSince)idleSince=Date.now();else if(Date.now()-idleSince>=10000)throw Error('needs_clarification');
   }else idleSince=0;
   await page.waitForTimeout(1000);
  }
  await Promise.all(pending);const after=await project();const unchanged=JSON.stringify(canonical(base))===JSON.stringify(canonical(after.scene))&&baseRevision===after.revision;
  if(uuid.test(runId))try{const trace=await context.request.get(`${apiOrigin}/__test-agent-trace/${projectId}/${runId}`,{headers,timeout:10000});if(trace.status()===200&&trace.headers()['x-scendance-test-fixture']?.includes('PGlite')){const data=await trace.json();if(Array.isArray(data.tools)){traceAvailable=true;toolTrace=safeToolTrace(data.tools);businessTrace=safeBusinessTrace(data.business);}}}catch{/* unavailable trace is reported */}
  const baseIds=new Set(base.objects.map(object=>object.id));
  const candidateDetails=candidates.map(item=>{const proposal=item?.proposal;const objects=Array.isArray(proposal?.candidate?.objects)?proposal.candidate.objects:[];const added=objects.filter(o=>!baseIds.has(o.id));
   const warningCodes=Array.isArray(proposal?.warnings)?proposal.warnings.map(w=>w?.code).filter(code=>typeof code==='string'):[];
   const shortfall=warningCodes.map(code=>/^SHARED_SEATING_SHORTFALL:(\d+):(\d+):(\d+):(object_limit|no_placement|scan_limit|preset_unverified)$/.exec(code)).find(Boolean);
   return {addedTables:added.filter(o=>o.materialId==='table').length,addedChairs:added.filter(o=>o.materialId==='chair').length,baseMatches:JSON.stringify(canonical(proposal?.base_scene))===JSON.stringify(canonical(base)),safetyUnknown:warningCodes.includes('SAFETY_CHECKS_UNKNOWN'),shortfall:shortfall?{requested:Number(shortfall[1]),placed:Number(shortfall[2]),tables:Number(shortfall[3]),reason:shortfall[4]}:null};
  });
  const knownErrors=new Set(['AGENT_NO_VALID_CANDIDATE','AGENT_FAILED','AGENT_DEADLINE','AGENT_CONTEXT_LIMIT','AGENT_OUTPUT_TRUNCATED','AGENT_TOOL_CALL_CONFLICT','AGENT_INVALID_MODEL_RESPONSE','MODEL_PROVIDER_INCOMPLETE','PROVIDER_HTTP_ERROR','SERVICE_NOT_CONFIGURED']);
  const validPreview=preview&&runState==='complete'&&candidateDetails.length>0&&candidateDetails.every(item=>item.baseMatches&&item.safetyUnknown)&&sharedRequirement&&unchanged&&agentPosts===1&&applyPosts===0&&externalRequests===0;
  const final=await status();const result={mode,status:validPreview?'preview':'incomplete',preview,unknownVisible,runState:['complete','failed','cancelled'].includes(runState)?runState:'unknown',runError:knownErrors.has(runError)?runError:null,modelRequests:Number.isSafeInteger(final.used)?final.used-expectedUsed:null,agentPosts,applyPosts,confirmations,sharedRequirement,traceAvailable,toolTrace,businessTrace,candidateCount:candidates.length,candidateDetails,sceneUnchanged:unchanged,externalRequests};
  console.log(JSON.stringify(result));if(result.status!=='preview')process.exitCode=1;
 }catch(error){let trial;try{const s=await status();const d=s.diagnostic;trial={state:['starting','ready','running','awaiting_user','failed','stopped'].includes(s.state)?s.state:'unavailable',used:Number.isSafeInteger(s.used)&&s.used>=0?s.used:null,...(d&&(['timeout','cancelled_or_upstream_timeout'].includes(d.code)||semanticErrors.has(d.code))?{diagnostic:{code:d.code,...(['caller_timeout','caller_abort','unknown'].includes(d.abortSource)?{abortSource:d.abortSource}:{})}}:{})};}catch{trial={state:'unavailable'};}
  // Inspect only the already-created isolated run; never submit or retry in an error handler.
  await Promise.race([Promise.allSettled(pending),new Promise(resolve=>setTimeout(resolve,1500))]);
  if(context&&uuid.test(projectId)&&(uuid.test(runId)||uuid.test(requestId))&&authorization&&apiOrigin)try{
   const url=new URL(apiOrigin);if(url.hostname!=='127.0.0.1')throw Error('not_local');
   const headers={authorization,apikey:'sb_publishable_local_integration_only'};
   const reference=uuid.test(runId)?runId:`by-request/${requestId}`;
   const current=await context.request.get(`${apiOrigin}/functions/v1/scene-api/projects/${projectId}/agent-runs/${reference}`,{headers,timeout:5000});
   if(current.status()===200&&current.headers()['x-scendance-test-fixture']?.includes('PGlite')){const value=await current.json();if(uuid.test(value.id??''))runId=value.id;if(['queued','running','complete','failed','cancelled'].includes(value.state))runState=value.state;if(typeof value.errorCode==='string'&&/^[A-Z_]{1,80}$/.test(value.errorCode))runError=value.errorCode;}
   if(uuid.test(runId)){const trace=await context.request.get(`${apiOrigin}/__test-agent-trace/${projectId}/${runId}`,{headers,timeout:5000});
    if(trace.status()===200&&trace.headers()['x-scendance-test-fixture']?.includes('PGlite')){const data=await trace.json();if(Array.isArray(data.tools)){traceAvailable=true;toolTrace=safeToolTrace(data.tools);businessTrace=safeBusinessTrace(data.business);}}}
  }catch{/* Any unavailable observation remains explicitly unknown. */}
  const allowed=['trial_not_ready','fixture_not_connected','scene_unavailable','unexpected_fixture','provider_stopped','provider_needs_user','model_output_invalid','needs_clarification','fact_mismatch','clarification_limit'];console.log(JSON.stringify({mode,status:'incomplete',phase,reason:allowed.includes(error.message)?error.message:'interaction_or_timeout',errorKind:error?.name==='TimeoutError'?'timeout':'other',agentPosts,applyPosts,runState:runState||'unknown',runError:runError||null,traceAvailable,toolTrace,businessTrace,trial}));process.exitCode=1;
 }finally{await context?.close();await browser?.close();}
}
module.exports={classifyQuestion};
if(require.main===module)void main();
