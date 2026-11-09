// One fictional scenario against an explicitly selected local trial. No retries or apply.
const {chromium}=require('playwright');
const {safeDiagnostic}=require('./local-trial-diagnostic.cjs');
const {safeToolTrace,safeBusinessTrace}=require('./verify-live-agent-direct.cjs');
const port=Number(process.argv[2]);
const mode=process.argv[3]==='--live'?'live':process.argv[3]==='--synthetic'?'synthetic':null;
const expectedUsed=Number(process.argv[4]);
const exerciseApply=process.argv[5]==='--exercise-apply';
const syntheticZero=process.argv[5]==='--synthetic-zero';
if(require.main===module&&(!mode||!Number.isSafeInteger(port)||port<1024||port>65535||[4186,4196,4197,4198].includes(port)||!/^\d+$/.test(process.argv[4]??'')||!Number.isSafeInteger(expectedUsed)||(process.argv.length>5&&!exerciseApply&&!syntheticZero)||process.argv.length>6||(syntheticZero&&mode!=='synthetic'))){
 console.error('请指定独立本机试用端口、--live 或 --synthetic、当前调用次数及可选的验收模式。');process.exit(2);
}
const origin=`http://127.0.0.1:${port}`;
// Distinct fictional exercise identifiers keep a later explicitly selected
// run from silently replaying the same prompt in the same trial process.
function sampleFor(used,trialMode){return trialMode==='synthetic'&&used===0?'为30人办室内讲座，场地长10米宽8米，采用课桌椅布局，生成方案':`这是第 ${used+1} 号虚构演练。为30人办室内讲座，场地长10米宽8米，采用课桌椅布局，生成方案`;}
const knownProgress=new Set(['正在读取当前场景','正在检索模型资源','正在读取局部平面','正在搜索可落点','正在读取模型材质','正在统计物料清单','正在检查方案','正在整理候选方案']);
// Only fixed sample facts may be confirmed. Unknown or malformed fields stop the test.
function classifyQuestion(value){
 const text=typeof value==='string'?value.trim():'';
 const confirm=text.match(/^以下信息还需核对：(.+)。这样对吗？回复「确认」或「不对」。$/u);
 if(confirm){const facts={'人数':'30','室内外':'室内','场地长（米）':'10','场地宽（米）':'8','布置方式':'课桌椅','活动':'讲座'},seen=new Set();
  for(const part of confirm[1].split('、')){const match=part.match(/^(.+?)\s+(.+)$/u);if(!match||!Object.hasOwn(facts,match[1])||seen.has(match[1]))return {kind:'needs_clarification'};seen.add(match[1]);if(match[2]!==facts[match[1]])return {kind:'fact_mismatch'};}
  return seen.size?{kind:'reply',reply:'确认',key:`confirm:${[...seen].sort().join('|')}`}:{kind:'needs_clarification'};
 }
 const restate=text.match(/^刚才的(.+)无法确定，请重新说明；回复「确认」不能代替具体信息。$/u);
 if(restate){const values={'本场人数':'本场总人数30人','场地长宽（单位：米）':'场地长10米宽8米','室内外':'本场在室内','布置方式':'采用课桌椅布局','活动':'本场是讲座'},names=restate[1].split('、');
  if(!names.length||new Set(names).size!==names.length||names.some(name=>!Object.hasOwn(values,name)))return {kind:'needs_clarification'};
  return {kind:'reply',reply:names.map(name=>values[name]).join('，'),key:`restate:${names.slice().sort().join('|')}`};
 }
 if(text==='请先说明本场预计人数，再生成布置方案。'||/^(?:本场|这场活动)(?:预计)?人数是多少[？?]$/u.test(text))return {kind:'reply',reply:'本场总人数30人',key:'attendance'};
 if(/^(?:已记录（待核对）：[^。？！?]{1,160}。)?关于活动需求，我理解为所有人都需要座位。这样对吗？回复「确认」或「不对」。$/u.test(text))return {kind:'reply',reply:'是否人人有座尚未决定，可以先按现有信息探索。',key:'defer_all_seated'};
 if(/[？?]|(?:请(?:先|再)?(?:说明|确认|告诉|选择)|是否需要|要不要|需要.{0,16}吗)/u.test(text))return {kind:'needs_clarification'};
 return {kind:'none'};
}
// Do not print raw model or page text: even a fictional prompt can receive
// echoed credentials or other unexpected data. Report only fixed summaries.
function summarizeUi(value){
 const text=typeof value==='string'?value.trim():'';const decision=classifyQuestion(text);
 if(decision.kind==='fact_mismatch')return '待确认信息与虚构样本不一致';
 if(decision.kind==='reply')return '等待核对已明确的虚构样本信息';
 if(decision.kind==='needs_clarification')return '有未能由虚构样本确定的追问';
 if(/正在理解活动需求/.test(text))return '正在理解活动需求';
 if(/正在整理|正在生成|正在读取/.test(text))return '正在处理方案';
 if(/没有找到|无法生成|生成失败|没有可用/.test(text))return '方案未能生成';
 if(/方案提案|画布上是预览|这一版先给你看/.test(text))return '方案预览已出现';
 return text?'其他对话内容（未输出原文）':null;
}
// This is an isolated fictional exercise. Drop any text mentioning secrets,
// strip addresses and non-Chinese tokens, and preserve only a short excerpt.
function safeUiExcerpt(value){
 const text=typeof value==='string'?value.trim():'';
 if(!text||/密码|密钥|秘钥|令牌|口令|凭证|验证码|授权|bearer|authorization|api[\s_-]*key|token|secret|(?:^|\s)sk[-_]/iu.test(text))return null;
 const cleaned=text.replace(/(?:https?:\/\/|www\.)[^\s，。！？；]+/giu,'〔地址已隐藏〕')
  .replace(/[\w.+-]+@[\w.-]+/gu,'〔地址已隐藏〕')
  .replace(/[A-Za-z][A-Za-z0-9_-]*/gu,'〔字母已隐藏〕')
  .replace(/\d{3,}/gu,'〔数字已隐藏〕')
  .replace(/[^\u4e00-\u9fff0-9\s，。！？、；：（）「」“”《》…—％×·〔〕-]/gu,' ')
  .replace(/\s+/gu,' ').trim();
 return /[\u4e00-\u9fff]/u.test(cleaned)?cleaned.slice(0,160):null;
}
// Only structural flags from the first response; never retain raw content.
function summarizeBriefExtract(value,status){
 const responseStatus=Number.isInteger(status)&&status>=100&&status<=599?status:null;
 if(!value||typeof value!=='object'||Array.isArray(value))return {responseStatus,validObject:false};
 const extraction=value.extraction&&typeof value.extraction==='object'&&!Array.isArray(value.extraction)?value.extraction:null;
 const keys=['headcount','lengthM','widthM','areaM2'];
 const fields=Object.fromEntries(keys.map(key=>[key,extraction?Object.hasOwn(extraction,key)&&extraction[key]!==null:null]));
 const unhandled=Array.isArray(value.unhandled)?value.unhandled.slice(0,12).map(item=>({kind:['action','question','other'].includes(item?.kind)?item.kind:'unknown',evidenceIsGenerate:item?.evidence==='生成方案'})):null;
 return {responseStatus,validObject:true,enabled:typeof value.enabled==='boolean'?value.enabled:null,fields,unhandled};
}
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
// Aggregate only; IDs, coordinates, material names and model explanations do
// not leave this isolated run. Warnings and trace are observations, not a new
// independent spatial check or a conclusion about the real venue.
function summarizeCandidate(base,item){
 const proposal=item?.proposal,candidate=proposal?.candidate;
 if(!Array.isArray(base?.objects)||!Array.isArray(candidate?.objects))return {status:'unavailable'};
 const toMap=objects=>{const map=new Map();for(const object of objects){if(typeof object?.id!=='string'||!object.id||map.has(object.id.toLowerCase()))return null;map.set(object.id.toLowerCase(),object);}return map;};
 const before=toMap(base.objects),after=toMap(candidate.objects);if(!before||!after)return {status:'unavailable'};
 const added=[...after].filter(([id])=>!before.has(id)).map(([,object])=>object);
 const removed=[...before.keys()].filter(id=>!after.has(id)).length;
 const changed=[...before].filter(([id,object])=>after.has(id)&&JSON.stringify(canonical(object))!==JSON.stringify(canonical(after.get(id)))).length;
 const types={chairs:0,tables:0,assets:0,other:0};
 for(const object of added){if(object.materialId==='chair')types.chairs++;else if(object.materialId==='table')types.tables++;else if(object.materialId==='asset')types.assets++;else types.other++;}
 const candidateTypes={builtinChairs:0,unknownAssets:0};
 for(const object of candidate.objects){if(object.materialId==='chair')candidateTypes.builtinChairs++;else if(object.materialId==='asset')candidateTypes.unknownAssets++;}
 const validGeometry=candidate.objects.every(object=>Number.isFinite(object?.position?.x)&&Number.isFinite(object?.position?.z)&&Number.isFinite(object?.rotation)&&['width','depth','height'].every(k=>Number.isFinite(object?.size?.[k])&&object.size[k]>0));
 const allowed=new Set(['OVERLAP','OUT_OF_BOUNDS','SAFETY_CHECKS_UNKNOWN','EXIT_UNKNOWN','EGRESS_UNKNOWN','DOOR_SWING_UNKNOWN','ACCESSIBILITY_UNKNOWN','FIRE_UNKNOWN','CAPACITY_UNKNOWN','SEATING_ALLOCATION_UNVERIFIED','SEATING_HEADCOUNT_UNVERIFIED','SEATING_SPECS_UNVERIFIED']);
 const warnings=Array.isArray(proposal?.warnings)?proposal.warnings.reduce((counts,warning)=>{let code=warning?.code;if(typeof code!=='string')return counts;if(/^SEATING_SHORTFALL:\d{1,3}:\d{1,3}:(object_limit|no_placement|scan_limit|preset_unverified)$/.test(code))code='SEATING_SHORTFALL';else if(/^SHARED_SEATING_SHORTFALL:\d{1,3}:\d{1,3}:\d{1,2}:(object_limit|no_placement|scan_limit|preset_unverified)$/.test(code))code='SHARED_SEATING_SHORTFALL';if(allowed.has(code)||code==='SEATING_SHORTFALL'||code==='SHARED_SEATING_SHORTFALL')counts[code]=(counts[code]??0)+1;return counts;},{}):null;
 return {status:'observed',baseMatches:JSON.stringify(canonical(proposal.base_scene))===JSON.stringify(canonical(base)),baseCount:before.size,candidateCount:after.size,added:added.length,removed,changed,addedTypes:types,candidateTypes,geometryFields:validGeometry?'present':'incomplete',reportedWarningCounts:warnings,independentGeometryCheck:'not_run'};
}
// Independent comparison uses the read-back wire objects and the downloaded
// HTML cells. This fixed mapping applies only to built-in fixture materials;
// unknown assets and renamed/unrecognized rows are inconclusive, never passed.
function verifyDeliveryRows(scene,rows){
 const names={chair:'椅子',table:'桌子',reception:'签到台',backdrop:'背景板',display:'展架',partition:'隔断',carpet:'地毯',decoration:'装饰道具'};
 if(!Array.isArray(scene?.objects)||!Array.isArray(rows))return {status:'unavailable'};
 const key=(name,width,depth,height)=>JSON.stringify([name,width,depth,height]);
 const expected=new Map(),actual=new Map();
 for(const object of scene.objects){const name=names[object?.materialId],size=object?.size;if(!name||!size||!['width','depth','height'].every(field=>Number.isFinite(size[field])&&size[field]>0))return {status:'unsupported'};const k=key(name,size.width,size.depth,size.height);expected.set(k,(expected.get(k)??0)+1);}
 for(const row of rows){if(!row||row.source!=='内置模型'||!Object.values(names).includes(row.name)||!Array.isArray(row.size)||row.size.length!==3||!row.size.every(value=>Number.isFinite(value)&&value>0)||!Number.isSafeInteger(row.quantity)||row.quantity<1)return {status:'unsupported'};const k=key(row.name,...row.size);actual.set(k,(actual.get(k)??0)+row.quantity);}
 const matches=expected.size===actual.size&&[...expected].every(([k,count])=>actual.get(k)===count);
 return {status:matches?'matched':'mismatch',expectedObjects:scene.objects.length,listedObjects:[...actual.values()].reduce((sum,count)=>sum+count,0),groupsCompared:expected.size,scope:'builtin_name_and_dimensions'};
}
async function main(){
 let browser,context,frame,phase='preflight',agentPosts=0,applyPosts=0,auth='',apiOrigin='',projectId='',base,run=null,runId='',confirmations=0,uiLast=null,uiExcerpt=null,waiting='none',toolTrace=[],businessTrace=[],traceAvailable=false,fixtureVerified=false,briefExtract=null,briefCaptured=false,candidateDetails=[],candidateScenes=[],readbackMatches=null;
 const observed=new Set(),pending=[],handled=new Set();
 async function readTrace(){if(!fixtureVerified||!context||!runId||!auth||!apiOrigin)return;try{const response=await context.request.get(`${apiOrigin}/__test-agent-trace/${projectId}/${runId}`,{headers:{authorization:auth,apikey:'sb_publishable_local_integration_only'},timeout:5000});if(response.status()===200&&response.headers()['x-scendance-test-fixture']?.includes('PGlite')){const data=await response.json();if(Array.isArray(data.tools)){traceAvailable=true;toolTrace=safeToolTrace(data.tools);businessTrace=safeBusinessTrace(data.business);}}}catch{/* observation unavailable, no retries */}}
 try{
  const initial=await(await fetch(`${origin}/status`,{signal:AbortSignal.timeout(3000)})).json();
  if(initial.mode!==mode||initial.state!=='ready'||initial.used!==expectedUsed)throw Error('trial_not_ready');
  browser=await chromium.launch({headless:true,channel:'msedge'});context=await browser.newContext();
  await context.route('**/*',route=>{const u=new URL(route.request().url());return u.hostname==='127.0.0.1'||u.protocol==='data:'||u.protocol==='blob:'?route.continue():route.abort();});
  context.on('request',request=>{const u=new URL(request.url()),m=u.pathname.match(/^\/functions\/v1\/scene-api\/projects\/([^/]+)\/lease\/acquire$/);if(m){apiOrigin=u.origin;projectId=m[1];auth=request.headers().authorization||'';}if(request.method()==='POST'&&/\/agent-runs$/.test(u.pathname))agentPosts++;if(request.method()==='POST'&&/\/proposals\/apply$/.test(u.pathname))applyPosts++;});
  context.on('response',response=>{const url=new URL(response.url());
   if(fixtureVerified&&!briefCaptured&&response.request().method()==='POST'&&url.origin===apiOrigin&&url.pathname==='/functions/v1/scene-api/brief/extract'){
    briefCaptured=true;const status=response.status();pending.push(response.json().then(value=>{briefExtract=summarizeBriefExtract(value,status);}).catch(()=>{briefExtract=summarizeBriefExtract(null,status);}));return;
   }
   if(!url.pathname.includes('/agent-runs'))return;pending.push(response.json().then(value=>{if(/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(value.id??''))runId=value.id;if(knownProgress.has(value.progress))observed.add(value.progress);if(['complete','failed','cancelled'].includes(value.state)){const candidates=Array.isArray(value.candidates)?value.candidates:[];run={state:value.state,candidates:candidates.length,callCount:Number.isInteger(value.callCount)?value.callCount:null};candidateDetails=candidates.slice(0,3).map(item=>summarizeCandidate(base,item));candidateScenes=candidates.slice(0,3).map(item=>item?.proposal?.candidate??null);}}).catch(()=>{}));});
  const page=await context.newPage();phase='opening';await page.goto(origin);frame=page.frameLocator('iframe[title="幕景工作台"]');
  await frame.getByLabel('告诉 Agent 要改的').waitFor({timeout:60000});
  await frame.getByRole('button',{name:'账户中心'}).click();await frame.getByLabel('邮箱').fill('owner@scendance.test');await frame.getByLabel('密码').fill('local-integration-only');await frame.getByRole('button',{name:'登录并进入工作台'}).click();await frame.getByText('已登录。').waitFor({timeout:10000});
  await frame.getByRole('button',{name:'新方案'}).click();await page.waitForTimeout(5000);if(!await frame.getByRole('button',{name:'关闭账户面板'}).count())await frame.getByRole('button',{name:'账户中心'}).click();
  const acquired=page.waitForResponse(response=>response.request().method()==='POST'&&/\/lease\/acquire$/.test(new URL(response.url()).pathname),{timeout:20000});
  await frame.getByRole('button',{name:/当前项目 .*双击进入/}).dblclick();const lease=await acquired;
  if(!apiOrigin||new URL(apiOrigin).hostname!=='127.0.0.1'||!projectId||!auth||lease.status()!==200||!lease.headers()['x-scendance-test-fixture']?.includes('PGlite'))throw Error('fixture_not_connected');
  fixtureVerified=true;
  async function scene(){const response=await context.request.get(`${apiOrigin}/functions/v1/scene-api/projects/${projectId}`,{headers:{authorization:auth,apikey:'sb_publishable_local_integration_only'}});if(response.status()!==200||!response.headers()['x-scendance-test-fixture']?.includes('PGlite'))throw Error('scene_unavailable');return (await response.json()).scene;}
  base=await scene();if(base.venue.width!==10||base.venue.depth!==8)throw Error('unexpected_fixture');
  const send=async text=>{await frame.getByLabel('告诉 Agent 要改的').fill(text);await frame.getByRole('button',{name:'发送',exact:true}).click();};
  if((await(await fetch(`${origin}/status`)).json()).used!==expectedUsed)throw Error('trial_not_ready');
  const bubbles=frame.locator('.ap-turn > p.ap-agent');let seen=await bubbles.count();
  phase='request';await send(syntheticZero?'这是零放置演练。为30人办室内讲座，场地长10米宽8米，采用课桌椅布局，生成方案':sampleFor(expectedUsed,mode));
  const deadline=Date.now()+125000;let preview=false,unknown=false,seatingWarningVisible=false,zeroVisible=false,zeroAlternativesVisible=false,idleSince=0,lastSendUsed=expectedUsed;
  while(Date.now()<deadline){
   const status=await(await fetch(`${origin}/status`)).json();if(status.state==='failed')throw Error('provider_stopped');if(status.state==='awaiting_user')throw Error('provider_needs_user');
   const count=await bubbles.count(),understanding=await frame.getByRole('button',{name:'停止等待',exact:true}).count()>0;
   if(count>seen){const text=await bubbles.nth(count-1).innerText();uiLast=summarizeUi(text);uiExcerpt=safeUiExcerpt(text);const decision=classifyQuestion(text);waiting=decision.kind;
    if(!agentPosts&&status.state==='ready'&&!understanding){
     seen=count;
     if(decision.kind==='fact_mismatch')throw Error('fact_mismatch');
     if(decision.kind==='needs_clarification')throw Error('needs_clarification');
     if(decision.kind==='reply'){if(handled.has(decision.key)||confirmations>=3)throw Error('clarification_limit');handled.add(decision.key);lastSendUsed=status.used;await send(decision.reply);confirmations++;idleSince=0;continue;}
    }
   }
   if(await frame.locator('#plan-proposal').count()) {preview=true;unknown=await frame.locator('#plan-proposal').getByText(/出口、疏散、门扇、无障碍、消防和核定人数仍需核验/).count()>0;seatingWarningVisible=await frame.locator('#plan-proposal').getByText(/座席.*(?:待核验|尚未核对)|(?:座位|座席|桌椅配比|人数来源).{0,30}(?:尚未核验|仍需核验|待核验|不足|尚缺|还差)/).count()>0;break;}
   if(syntheticZero&&await frame.getByText(/本次新增课桌椅组团 0 \/ 30 套/).count()){const message=await frame.getByText(/本次新增课桌椅组团 0 \/ 30 套/).last().innerText();zeroVisible=true;zeroAlternativesVisible=['其他区域','核对桌椅规格','你也可决定是否调整人数、共桌方式或场地','仍需重新试排'].every(fragment=>message.includes(fragment));break;}
   if(run&&run.state!=='complete')break;
   if(!agentPosts&&status.state==='ready'&&status.used>lastSendUsed&&!understanding){if(!idleSince)idleSince=Date.now();else if(Date.now()-idleSince>=10000)throw Error('needs_clarification');}else idleSince=0;
   await page.waitForTimeout(1000);
  }
  await Promise.all(pending);await readTrace();const unchanged=JSON.stringify(base)===JSON.stringify(await scene());const state=await(await fetch(`${origin}/status`)).json();
  const result={mode,status:preview&&unchanged&&agentPosts===1?'preview':'incomplete',modelRequestsStart:expectedUsed,modelRequests:Number.isSafeInteger(state.used)&&state.used>=expectedUsed?state.used-expectedUsed:null,agentPosts,applyPosts,run,candidateDetails,toolProgress:[...observed],traceAvailable,toolTrace,businessTrace,briefExtract,confirmations,uiLast,uiExcerpt,waiting,preview,unknownVisible:unknown,seatingWarningVisible,sceneUnchanged:unchanged};
  if(syntheticZero&&zeroVisible&&zeroAlternativesVisible&&unchanged&&agentPosts===1&&applyPosts===0&&run?.state==='complete'&&candidateDetails.length===1&&candidateDetails[0]?.reportedWarningCounts?.SEATING_SHORTFALL===1&&await frame.getByRole('button',{name:'确认布置',exact:true}).count()===0){Object.assign(result,{status:'zero_placement_observed',zeroVisible:true,zeroAlternativesVisible:true});}
  if(exerciseApply&&result.status==='preview'){
   phase='apply_preflight';if(candidateScenes.length!==1||!candidateScenes[0]||candidateDetails[0]?.baseMatches!==true||!unknown)throw Error('apply_not_reviewable');
   const confirm=frame.getByRole('button',{name:'确认布置',exact:true});if(await confirm.count()!==1||await confirm.isDisabled())throw Error('apply_not_reviewable');
   phase='apply';await confirm.click();await frame.getByText(/写进画布了/).waitFor({timeout:30000});
   const applied=await scene();readbackMatches=JSON.stringify(canonical(applied))===JSON.stringify(canonical(candidateScenes[0]));if(!readbackMatches||applyPosts!==1)throw Error('readback_mismatch');
   phase='canvas_readback';await frame.getByText(`当前物料 ${applied.objects.length} 件 · 场地容量待核验`,{exact:true}).waitFor({timeout:10000});
   phase='inventory_request';await send('物料清单');await frame.getByText(/物料清单 ·/).last().waitFor({timeout:15000});
   phase='delivery_request';await send('导出交接');await frame.getByText('导出执行资料草案').waitFor({timeout:15000});phase='delivery_choice';await frame.getByText(/云项目暂不支持此执行资料草案/).waitFor({timeout:10000});
   phase='delivery_download';
   const [download]=await Promise.all([page.waitForEvent('download',{timeout:20000}),frame.getByRole('button',{name:'导出当前场景物料清单草案'}).click()]);
   const stream=await download.createReadStream(),chunks=[];for await(const chunk of stream)chunks.push(chunk);const html=Buffer.concat(chunks).toString('utf8');
   const draftLabels=['本机快照，未冻结','数字模型不代表实物库存','未包含完整活动需求、点验记录与场地方确认','消防、无障碍'].every(label=>html.includes(label));
   if(!draftLabels)throw Error('delivery_labels_missing');
   const rows=await page.evaluate(markup=>{const doc=new DOMParser().parseFromString(markup,'text/html');return [...doc.querySelectorAll('tbody tr')].map(row=>{const cells=[...row.querySelectorAll('td')];if(cells.length!==5)return null;const match=cells[2].textContent?.trim().match(/^(\d+(?:\.\d+)?)\s*×\s*(\d+(?:\.\d+)?)\s*×\s*(\d+(?:\.\d+)?)\s*米$/u);const quantity=cells[3].textContent?.trim()??'';return match&&/^\d+$/u.test(quantity)?{name:cells[0].textContent?.trim(),source:cells[1].textContent?.trim(),size:match.slice(1).map(Number),quantity:Number(quantity)}:null;});},html);
   const deliveryComparison=verifyDeliveryRows(applied,rows);if(deliveryComparison.status!=='matched')throw Error('delivery_quantity_unverified');
   Object.assign(result,{status:'applied_and_draft_exported',applyPosts,readbackMatches,deliveryDraftDownloaded:true,deliveryWarningsPresent:true,deliveryComparison});
  }
  console.log(JSON.stringify(result));if(!['preview','applied_and_draft_exported','zero_placement_observed'].includes(result.status))process.exitCode=1;
 }catch(error){
  let state;try{const s=await(await fetch(`${origin}/status`,{signal:AbortSignal.timeout(2000)})).json();state={state:['starting','ready','running','awaiting_user','failed','stopped'].includes(s.state)?s.state:'unavailable',used:Number.isSafeInteger(s.used)&&s.used>=0?s.used:null,diagnostic:safeDiagnostic(s.diagnostic)};}catch{state={state:'unavailable'};}
  try{const bubbles=frame?.locator('.ap-turn > p.ap-agent');if(bubbles&&await bubbles.count()){const text=await bubbles.last().innerText({timeout:1000});uiLast=summarizeUi(text);uiExcerpt=safeUiExcerpt(text);}}catch{/* keep previously observed summary */}
  await Promise.race([Promise.allSettled(pending),new Promise(resolve=>setTimeout(resolve,1500))]);await readTrace();
  console.log(JSON.stringify({mode,status:'incomplete',phase,reason:['trial_not_ready','fixture_not_connected','scene_unavailable','unexpected_fixture','provider_stopped','provider_needs_user','fact_mismatch','needs_clarification','clarification_limit','apply_not_reviewable','readback_mismatch','delivery_labels_missing','delivery_quantity_unverified'].includes(error.message)?error.message:'interaction_or_timeout',modelRequestsStart:expectedUsed,modelRequests:Number.isSafeInteger(state.used)&&state.used>=expectedUsed?state.used-expectedUsed:null,agentPosts,applyPosts,readbackMatches,run,candidateDetails,toolProgress:[...observed],traceAvailable,toolTrace,businessTrace,briefExtract,confirmations,uiLast,uiExcerpt,waiting,trial:state}));process.exitCode=1;
 }finally{await context?.close();await browser?.close();}
}
module.exports={classifyQuestion,summarizeUi,safeUiExcerpt,summarizeBriefExtract,summarizeCandidate,verifyDeliveryRows,sampleFor};
if(require.main===module)void main();
