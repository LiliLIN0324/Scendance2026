// End-to-end exercise of a fictional local activity. Synthetic-only; never
// contacts a real provider, applies cloud changes, or reads user credentials.
// Default fixture stops at an unhandled preservation request. For a separate
// cooperative-model control, launch with SCENDANCE_E2E_COOPERATIVE=1 and pass
// --cooperative. That control remains incomplete until preservation is bound
// and independently verifiable; an acknowledgement alone is not proof.
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const {chromium}=require('playwright');
const port=Number(process.argv[2]);
const cooperative=process.argv[3]==='--cooperative';
const verified=process.argv[3]==='--verified-preserve';
if(!Number.isSafeInteger(port)||port<1024||port>65535||[4186,4196,4197,4198,4213,4215,4246,4248,4249,4250,4252,4254,4255,4256,4257,4258,4259,4260,4261,4264].includes(port))throw Error('请选择独立模拟试用端口。');
const origin=`http://127.0.0.1:${port}`;
const items=layout=>layout.floors.flatMap(floor=>floor.items);
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const same=(a,b)=>JSON.stringify(canonical(a))===JSON.stringify(canonical(b));
async function main(){
 const status=await(await fetch(`${origin}/status`)).json();if(status.mode!=='synthetic'||status.used!==0)throw Error('需要全新的模拟试用。');
 const browser=await chromium.launch({headless:true,channel:'msedge'}),context=await browser.newContext();
 const report={mode:'synthetic',fixture:verified?'local-structured-preservation':cooperative?'cooperative-preserve-reply':'unhandled-preserve-reply',status:'incomplete',phase:'opening',sceneUnchangedBeforeConfirm:null,originalObjectsPreserved:null,candidateCounts:null,preserveRequest:'not_exercised',deleteOriginal:'not_exercised',revision:'not_exercised',applyReadback:'not_exercised',delivery:'not_exercised',toolLoop:'not_exercised',cloudWrites:0,externalRequests:0,limitations:['固定模拟模型，不代表真实模型或现场验收','云端工具循环未参与本机草案生成']};
 await context.addInitScript(()=>{window.__testObservedPreviews=[];window.__testObservedMemories=[];window.addEventListener('scendance:test-observed-preview',event=>window.__testObservedPreviews.push(event.detail));window.addEventListener('scendance:test-observed-memory',event=>window.__testObservedMemories.push(event.detail));});
 await context.route('**/*',route=>{const url=new URL(route.request().url());if(url.hostname==='127.0.0.1'||url.protocol==='data:'||url.protocol==='blob:')return route.continue();report.externalRequests++;return route.abort();});
 context.on('request',request=>{const url=new URL(request.url());if(request.method()!=='GET'&&/\/functions\/v1\/scene-api\/projects(?:\/|$)/.test(url.pathname))report.cloudWrites++;});
 let page,frame,child;
 try{
  page=await context.newPage();await page.goto(origin);frame=page.frameLocator('iframe[title="幕景工作台"]');
  await frame.getByLabel('告诉 Agent 要改的').waitFor({timeout:60000});
  child=page.frames().find(item=>item!==page.mainFrame()&&item.url().startsWith('http://127.0.0.1:'));if(!child)throw Error('fixture_unavailable');
  const stored=()=>child.evaluate(()=>{const raw=localStorage.getItem('scendance-editor-local-v1');return raw?JSON.parse(raw):null;});
  const latest=()=>child.evaluate(()=>window.__testObservedPreviews?.at(-1)??null);
  const send=async message=>{await frame.getByLabel('告诉 Agent 要改的').fill(message);await frame.getByRole('button',{name:'发送',exact:true}).click();};
  await page.waitForTimeout(8000);
  await send('把场地改成20×20米');await frame.getByText('场地改成 20 × 20 m。').waitFor({timeout:15000});
  await frame.getByRole('button',{name:'账户中心'}).click();await frame.getByLabel('邮箱').fill('owner@scendance.test');await frame.getByLabel('密码').fill('local-integration-only');await frame.getByRole('button',{name:'登录并进入工作台'}).click();await frame.getByText('已登录。').waitFor({timeout:10000});await frame.getByRole('button',{name:'关闭账户面板'}).click();
  await child.waitForFunction(()=>{try{const value=JSON.parse(localStorage.getItem('scendance-editor-local-v1')||'null');return value?.width===20&&value?.height===20;}catch{return false;}},null,{timeout:15000});
  const before=await stored(),base=items(before),baseIds=new Set(base.map(item=>item.id));assert.equal(baseIds.size,base.length);
  report.phase='preview';await send('30人，每2人一桌，采用课桌椅，生成本地草案');
  await frame.getByText(/本机草案：需求 30 人、15 桌；本次排了 30 人、15 桌、30 把椅子/).waitFor({timeout:25000});
  await child.waitForFunction(n=>{const v=window.__testObservedPreviews?.at(-1);return !!v&&v.floors.flatMap(f=>f.items).length===n;},base.length+45,{timeout:15000});
  let originalPreview=await latest();const previewItems=items(originalPreview),added=previewItems.filter(item=>!baseIds.has(item.id));
  report.candidateCounts={desks:added.filter(item=>item.type==='desk').length,chairs:added.filter(item=>item.type==='chair').length,objects:added.length};
  assert.deepEqual(report.candidateCounts,{desks:15,chairs:30,objects:45});assert.equal(new Set(added.map(item=>item.id)).size,45);
  report.originalObjectsPreserved=base.every(item=>same(previewItems.find(value=>value.id===item.id),item));assert.equal(report.originalObjectsPreserved,true);
  report.sceneUnchangedBeforeConfirm=same(await stored(),before);assert.equal(report.sceneUnchangedBeforeConfirm,true);
  report.phase='preserve_request';
  // The model fixture explicitly says this unrecognised instruction is
  // unhandled. Observation of preserved items alone is not proof that the
  // new requirement was understood or bound to the candidate.
  const replies=frame.locator('#agent-panel .ap-turn > p.ap-agent');const replyCount=await replies.count();
  await send('请保留原有物件');
  await child.waitForFunction(({prior})=>document.querySelectorAll('#agent-panel .ap-turn > p.ap-agent').length>prior&&!Array.from(document.querySelectorAll('button')).some(button=>button.textContent?.trim()==='停止等待'),{prior:replyCount},{timeout:20000});
  const reply=await replies.last().innerText();
  if(verified){
   if(!/已记录：保留当前原有物件，不删除/.test(reply))throw Error('preservation_response_not_classified');
   const memory=await child.evaluate(()=>window.__testObservedMemories?.at(-1)??null);const requirement=memory?.originalPreservation;
   assert.ok(requirement,'需求未记录到当前结构化状态');assert.equal(requirement.activityId,before.id);assert.equal(requirement.keepPositions,false);assert.equal(requirement.evidence,'请保留原有物件');
   assert.deepEqual(requirement.items.map(item=>item.id).sort(),[...baseIds].sort(),'保留范围必须是要求提出时的全部原物');
   report.preserveRequest='structured_original_ids';report.phase='delete_original';const plant=base.find(item=>item.name==='空间绿植');if(!plant)throw Error('target_missing');
   await send('删除空间绿植');
   await frame.getByText(/与保留原物要求冲突/).first().waitFor({timeout:20000});
   assert.equal(await frame.getByRole('button',{name:'确认布置',exact:true}).count(),0,'冲突预览不可显示确认');
   await send('确认布置');await frame.getByText(/与保留原物要求冲突/).last().waitFor({timeout:10000});
   assert.ok(same(await stored(),before),'冲突候选不得改动当前场景');report.deleteOriginal='conflict_blocked';
   const discard=frame.getByRole('button',{name:'撤回',exact:true});await discard.click();
   await send('生成本地草案');
   await child.waitForFunction(n=>{const v=window.__testObservedPreviews?.at(-1);return !!v&&v.floors.flatMap(f=>f.items).length===n;},base.length+45,{timeout:20000});
   originalPreview=await latest();
   assert.ok(base.every(item=>same(items(originalPreview).find(value=>value.id===item.id),item)),'重生成仍须保留原物');
  }else if(!cooperative){
   if(!/尚未执行|尚未理解|仍需核对|未能理解|本次没有/.test(reply))throw Error('preservation_response_not_classified');
   report.preserveRequest='unhandled';report.reason='preservation_requirement_unverified';
  }else{
   // A cooperative model's acknowledgement is a reply, not proof of a
   // persisted constraint. The subsequent preview and readback are checked
   // independently and the final report remains partial.
   if(!/保留原有物件/.test(reply)||/尚未执行|尚未理解|未能理解/.test(reply))throw Error('preservation_response_not_classified');
   report.preserveRequest='model_acknowledged_binding_unverified';
  }
  if(verified||cooperative){
   report.phase='revision';const plant=base.find(item=>item.name==='空间绿植');if(!plant)throw Error('target_missing');
   await send('把空间绿植换成灰色');
   await child.waitForFunction(id=>{const candidate=window.__testObservedPreviews?.at(-1);return !!candidate&&candidate.floors.flatMap(floor=>floor.items).some(item=>item.id===id&&item.color==='#9aa3ad');},plant.id,{timeout:20000});
   const revised=await latest(),revisedItems=items(revised),oldItems=items(originalPreview);
   assert.equal(revisedItems.length,oldItems.length);assert.deepEqual(revisedItems.map(item=>item.id).sort(),oldItems.map(item=>item.id).sort());
   for(const old of oldItems){const current=revisedItems.find(item=>item.id===old.id);assert.ok(current);if(old.id===plant.id)assert.deepEqual(current,{...old,color:'#9aa3ad'});else assert.deepEqual(current,old);}
   assert.ok(same(await stored(),before),'修改预览前不得写入场景');report.revision='one_explicit_object_recolored';
   report.phase='apply';await frame.getByRole('button',{name:'确认布置',exact:true}).click();
   await child.waitForFunction(n=>{try{return JSON.parse(localStorage.getItem('scendance-editor-local-v1')||'null')?.floors.flatMap(floor=>floor.items).length===n;}catch{return false;}},revisedItems.length,{timeout:20000});
   const applied=await stored();assert.ok(same(items(applied),revisedItems),'确认后物件必须与最终预览逐项一致');report.applyReadback='matched_preview_objects';
   report.phase='delivery';await frame.getByRole('button',{name:'导出与交接',exact:true}).click();await frame.getByText('内部资料',{exact:true}).click();await frame.getByRole('tab',{name:'导出',exact:true}).click();
   const download=page.waitForEvent('download',{timeout:15000});await frame.getByRole('button',{name:'导出本地待核验草案 JSON',exact:true}).click();
   const exported=JSON.parse(await fs.readFile(await(await download).path(),'utf8'));assert.equal(exported.state,'draft_unverified');assert.ok(same(items(exported.layout),items(applied)),'交付物件必须与实际场景一致');assert.ok(exported.checks.every(check=>check.status==='unknown'));
   report.delivery='matched_applied_objects_unknown_checks';report.reason=verified?'synthetic_local_only':'requirement_binding_unverified';
   if(verified){report.status='partial';report.localScenario='passed';}
  }
  assert.equal(report.cloudWrites,0);assert.equal(report.externalRequests,0);
  if(!cooperative&&!verified)assert.equal(same(await stored(),before),true);
 }catch(error){report.reason=report.reason||'interaction_or_assertion_failed';report.errorKind=error?.name==='TimeoutError'?'timeout':'other';}
 finally{await context.close();await browser.close();}
 console.log(JSON.stringify(report));if(report.status==='incomplete')process.exitCode=1;
}
main().catch(()=>{console.log(JSON.stringify({mode:'synthetic',status:'incomplete',reason:'fixture_unavailable'}));process.exitCode=1;});
