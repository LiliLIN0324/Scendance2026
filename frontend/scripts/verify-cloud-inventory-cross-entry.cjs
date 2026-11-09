// Independent synthetic workbench; never contacts a real provider or project.
const assert=require('node:assert/strict');const {chromium}=require('playwright');
const port=Number(process.argv[2]);if(!Number.isSafeInteger(port)||port<1024||port>65535||[4186,4196,4197,4198,4213,4215].includes(port))throw Error('请选择隔离模拟端口。');
const origin=`http://127.0.0.1:${port}`;
async function main(){
 const initial=await(await fetch(`${origin}/status`)).json();assert.equal(initial.mode,'synthetic');assert.equal(initial.used,0);
 const browser=await chromium.launch({headless:true,channel:'msedge'}),context=await browser.newContext(),blocked=[],writes=[];let apiOrigin='',projectId='',auth='';
 await context.route('**/*',route=>{const url=new URL(route.request().url());if(url.hostname==='127.0.0.1'||url.protocol==='data:'||url.protocol==='blob:')return route.continue();blocked.push(url.origin);return route.abort();});
 context.on('request',request=>{const u=new URL(request.url()),m=u.pathname.match(/^\/functions\/v1\/scene-api\/projects\/([^/]+)\/lease\/acquire$/);if(m){apiOrigin=u.origin;projectId=m[1];auth=request.headers().authorization||'';}if(request.method()!=='GET'&&/\/proposals\/apply$/.test(u.pathname))writes.push(u.pathname);});
 let frame;
 try{
  const page=await context.newPage();await page.goto(origin);frame=page.frameLocator('iframe[title="幕景工作台"]');await frame.getByLabel('告诉 Agent 要改的').waitFor({timeout:60000});
  await frame.getByRole('button',{name:'账户中心'}).click();await frame.getByLabel('邮箱').fill('owner@scendance.test');await frame.getByLabel('密码').fill('local-integration-only');await frame.getByRole('button',{name:'登录并进入工作台'}).click();await frame.getByText('已登录。').waitFor({timeout:10000});
  await frame.getByRole('button',{name:'新方案'}).click();await page.waitForTimeout(5000);if(!await frame.getByRole('button',{name:'关闭账户面板'}).count())await frame.getByRole('button',{name:'账户中心'}).click();
  await frame.getByRole('button',{name:/当前项目 .*双击进入/}).dblclick();await page.waitForTimeout(3000);assert.ok(apiOrigin&&projectId&&auth,'未建立隔离项目编辑租约');
  async function scene(){const response=await context.request.get(`${apiOrigin}/functions/v1/scene-api/projects/${projectId}`,{headers:{authorization:auth,apikey:'sb_publishable_local_integration_only'}});assert.equal(response.status(),200);return (await response.json()).scene;}
  const before=await scene(),send=async text=>{await frame.getByLabel('告诉 Agent 要改的').fill(text);await frame.getByRole('button',{name:'发送',exact:true}).click();};
  await send('为30人办室内讲座，场地长10米宽8米，采用课桌椅布局，椅宽0.5米，生成方案');await frame.getByText(/以下信息还需核对/).waitFor({timeout:20000});await send('确认');
  await frame.getByRole('button',{name:'确认布置'}).waitFor({timeout:45000});const card=frame.locator('#plan-proposal');
  assert.match(await card.innerText(),/未提供库存.*待核验/,'未填写物料数量应为未知');
  await card.getByText('核对这版物料数量',{exact:true}).click();const inputs=card.getByPlaceholder('可用总数，未知留空');assert.ok(await inputs.count()>0,'没有可明确填写的型号规格');
  const selected=await inputs.first().locator('..').innerText();await inputs.first().fill('0');
  await card.getByText(/已填写的物料数量不足/).waitFor({timeout:5000});assert.equal(await card.getByRole('button',{name:'确认布置'}).count(),0,'主卡不能提供缺货确认');
  await send('确认布置');await frame.locator('.ap-turn .ap-agent').filter({hasText:/按提供的库存核对.*缺\s*\d+\s*件/}).last().waitFor({timeout:10000});
  await page.waitForTimeout(1000);assert.deepEqual(await scene(),before,'文字确认不能修改项目');assert.deepEqual(writes,[]);assert.deepEqual(blocked,[]);
  await frame.getByRole('button',{name:'空间',exact:true}).click();await frame.getByRole('button',{name:'图纸与照片',exact:true}).click();await page.waitForTimeout(1000);
  const deep=frame.getByText('方案提案 · 尚未应用',{exact:true}),deepVisible=await deep.isVisible().catch(()=>false);let deepConfirmation='不可见';
  if(deepVisible){const proposal=frame.locator('.cr-proposal:visible'),confirm=proposal.getByRole('button',{name:'确认布置',exact:true});if(await confirm.count()&&await confirm.isEnabled()){await confirm.click();await page.waitForTimeout(1500);deepConfirmation='已尝试，检查项目未改变';}else deepConfirmation='入口可见但确认不可用';}
  assert.deepEqual(await scene(),before,'切换深层入口或尝试确认不能修改项目');assert.deepEqual(writes,[]);
  const buttons=await frame.locator('button:visible').evaluateAll(elements=>elements.map(element=>({label:element.getAttribute('aria-label'),text:element.innerText})).filter(value=>value.label||value.text));
  console.log(JSON.stringify({status:'main-checked',mode:'synthetic',unknownBeforeInput:true,selected,zeroBlockedMain:true,textConfirmationUnchanged:true,textConfirmationHandled:true,deepPreviewVisible:deepVisible,deepConfirmation,visibleButtons:buttons,cloudApplyWrites:writes.length,externalRequests:blocked.length}));
 }catch(error){if(frame){try{console.error('VISIBLE_WORKBENCH',(await frame.locator('body').innerText()).slice(-3500));}catch{}}throw error;}
 finally{await context.close();await browser.close();}
}
main().catch(error=>{console.error('INVENTORY_CROSS_ENTRY_FAILED',error.message);process.exitCode=1;});
