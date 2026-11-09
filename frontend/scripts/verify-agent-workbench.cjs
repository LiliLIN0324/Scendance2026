// Real browser against an isolated synthetic server: no real provider or user project.
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const port=Number(process.env.SCENDANCE_CHAT_TRIAL_TEST_PORT||'4198');
if(!Number.isSafeInteger(port)||port<1024||port>65535||[4186,4196,4197].includes(port))throw Error('仅允许独立的模拟试用端口。');
const origin=`http://127.0.0.1:${port}`;
const mismatch='为30人办室内讲座，场地长12米宽10米，采用课桌椅布局，生成方案';
const matching='为30人办室内讲座，场地长10米宽8米，采用课桌椅布局，椅宽0.5米，生成方案';
async function main(){
 const initial=await(await fetch(`${origin}/status`)).json();assert.equal(initial.mode,'synthetic');assert.equal(initial.used,0);
 const browser=await chromium.launch({headless:true,channel:'msedge'}),blocked=[],summary=[];
 async function runCase(message,expectPreview){
  const context=await browser.newContext(),calls=[],reads=[];let apiOrigin='',projectId='',authHeader='';
  await context.route('**/*',async route=>{const url=new URL(route.request().url());if(url.hostname==='127.0.0.1'||url.protocol==='data:'||url.protocol==='blob:')return route.continue();blocked.push(url.origin);return route.abort();});
  context.on('request',request=>{const url=new URL(request.url()),match=url.pathname.match(/^\/functions\/v1\/scene-api\/projects\/([^/]+)\/lease\/acquire$/);if(match){apiOrigin=url.origin;projectId=match[1];authHeader=request.headers().authorization||'';}if(url.pathname.includes('/agent-runs'))calls.push({method:request.method(),path:url.pathname});});
  context.on('response',response=>{if(new URL(response.url()).pathname.includes('/agent-runs'))reads.push(response.json().then(value=>({state:value.state,candidates:value.candidates?.length,objects:value.candidates?.map(item=>item.proposal?.candidate?.objects?.length),warnings:value.candidates?.map(item=>item.proposal?.warnings?.map(w=>w.code))})).catch(()=>null));});
  const page=await context.newPage();
  try{
   await page.goto(origin);const frame=page.frameLocator('iframe[title="幕景工作台"]');
   await frame.getByLabel('告诉 Agent 要改的').waitFor({timeout:60000});
   await frame.getByRole('button',{name:'账户中心'}).click();await frame.getByLabel('邮箱').fill('owner@scendance.test');await frame.getByLabel('密码').fill('local-integration-only');await frame.getByRole('button',{name:'登录并进入工作台'}).click();await frame.getByText('已登录。').waitFor({timeout:10000});
   await frame.getByRole('button',{name:'新方案'}).click();await page.waitForTimeout(5000);
   if(!await frame.getByRole('button',{name:'关闭账户面板'}).count())await frame.getByRole('button',{name:'账户中心'}).click();
   await frame.getByRole('button',{name:/当前项目 .*双击进入/}).dblclick();await page.waitForTimeout(3000);
   assert.ok(apiOrigin&&projectId&&authHeader,'未观察到隔离项目编辑租约');
   async function projectScene(){const response=await context.request.get(`${apiOrigin}/functions/v1/scene-api/projects/${projectId}`,{headers:{authorization:authHeader,apikey:'sb_publishable_local_integration_only'}});assert.equal(response.status(),200);return (await response.json()).scene;}
   const original=await projectScene();assert.equal(original.venue.width,10);assert.equal(original.venue.depth,8);
   async function send(text){await frame.getByLabel('告诉 Agent 要改的').fill(text);await frame.getByRole('button',{name:'发送',exact:true}).click();}
   await send(message);
   await frame.getByText(/以下信息还需核对/).waitFor({timeout:20000});await send('确认');
   if(expectPreview){
    await frame.getByRole('button',{name:'确认布置'}).waitFor({timeout:45000});
    const cardBeforeExpansion=await frame.locator('#plan-proposal').innerText();
    assert.match(cardBeforeExpansion,/当前仅识别到\s*\d+\s*把单人椅/,'未展开模型说明时应显示程序识别的座椅数');
    assert.match(cardBeforeExpansion,/是否满足.*30\s*人.*座席需求尚未核对/,'未展开模型说明时应显示座席需求待核对');
    assert.match(cardBeforeExpansion,/桌椅规格尚未核验.*实际物料/,'未展开模型说明时应显示规格待核验');
    assert.doesNotMatch(cardBeforeExpansion,/座位\s*\d+\s*\/\s*30\s*·\s*还差\s*\d+/,'不应仅凭单人椅数断言座位缺口');
    await frame.locator('#plan-proposal').getByText('查看模型原文（未经核验）').click();
    const visible=await frame.locator('body').innerText(),agentResults=await Promise.all(reads);
    assert.match(visible,/出口、疏散、门扇、无障碍、消防和核定人数仍需核验/);
    assert.match(visible,/尚未完成\s*30\s*人/,'候选说明应明确只摆了示意椅');
    const complete=agentResults.find(result=>result?.state==='complete');assert.equal(complete?.candidates,1);assert.equal(complete?.objects?.[0],original.objects.length+1);
    assert.deepEqual(await projectScene(),original,'确认前服务端场景不应改变');
    summary.push({case:'场地一致',preview:true,baseObjects:original.objects.length,candidateObjects:complete.objects[0],seatEvidenceVisible:true,seatSufficiencyUnknown:true,specificationUnknownVisible:true,unknownVisible:true,explanationVisible:true,sceneUnchanged:true});
   }else{
    await frame.getByText(/你要求按.*12.*10.*当前场地是.*10.*8.*本次没有提交生成/).waitFor({timeout:15000});
    await page.waitForTimeout(1000);
    assert.equal(calls.filter(call=>call.method==='POST'&&call.path.endsWith('/agent-runs')).length,0,'尺寸不一致不得提交任务');
    assert.equal(await frame.getByRole('button',{name:'确认布置'}).count(),0);
    assert.deepEqual(await projectScene(),original,'不一致时不能改动服务端场景');
    summary.push({case:'场地不一致',blockedBeforeAgent:true,sceneUnchanged:true});
   }
  }finally{await context.close();}
 }
 try{await runCase(mismatch,false);await runCase(matching,true);assert.deepEqual(blocked,[]);const final=await(await fetch(`${origin}/status`)).json();assert.notEqual(final.state,'failed');console.log(JSON.stringify({status:'passed',mode:'synthetic',cases:summary,modelRequests:final.used,externalRequests:0}));}
 finally{await browser.close();}
}
main().catch(error=>{console.error('LOCAL_AGENT_WORKBENCH_FAILED',error.message);process.exitCode=1;});
