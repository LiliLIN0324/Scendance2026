// Isolated synthetic workbench only: verifies apply, undo, and handoff behavior.
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const port=Number(process.env.SCENDANCE_CHAT_TRIAL_TEST_PORT||'4236');
if(!Number.isSafeInteger(port)||port<1024||port>65535||[4186,4196,4197,4213].includes(port))throw Error('仅允许独立模拟试用端口。');
const origin=`http://127.0.0.1:${port}`;
async function main(){
 const state=await(await fetch(`${origin}/status`)).json();assert.equal(state.mode,'synthetic');assert.equal(state.used,0);
 const browser=await chromium.launch({headless:true,channel:'msedge'}),context=await browser.newContext(),blocked=[];let api='',projectId='',auth='',phase='opening';
 await context.route('**/*',route=>{const url=new URL(route.request().url());if(url.hostname==='127.0.0.1'||['data:','blob:'].includes(url.protocol))return route.continue();blocked.push(url.origin);return route.abort();});
 context.on('request',request=>{const u=new URL(request.url()),m=u.pathname.match(/^\/functions\/v1\/scene-api\/projects\/([^/]+)\/lease\/acquire$/);if(m){api=u.origin;projectId=m[1];auth=request.headers().authorization||'';}});
 const page=await context.newPage();
 try{
  await page.goto(origin);const frame=page.frameLocator('iframe[title="幕景工作台"]');
  await frame.getByLabel('告诉 Agent 要改的').waitFor({timeout:60000});
  await frame.getByRole('button',{name:'账户中心'}).click();await frame.getByLabel('邮箱').fill('owner@scendance.test');await frame.getByLabel('密码').fill('local-integration-only');await frame.getByRole('button',{name:'登录并进入工作台'}).click();await frame.getByText('已登录。').waitFor({timeout:10000});
  await frame.getByRole('button',{name:'新方案'}).click();await page.waitForTimeout(5000);
  if(!await frame.getByRole('button',{name:'关闭账户面板'}).count())await frame.getByRole('button',{name:'账户中心'}).click();
  await frame.getByRole('button',{name:/当前项目 .*双击进入/}).dblclick();await page.waitForTimeout(3000);assert.ok(api&&projectId&&auth);
  async function scene(){const response=await context.request.get(`${api}/functions/v1/scene-api/projects/${projectId}`,{headers:{authorization:auth,apikey:'sb_publishable_local_integration_only'}});assert.equal(response.status(),200);return (await response.json()).scene;}
  async function send(text){await frame.getByLabel('告诉 Agent 要改的').fill(text);await frame.getByRole('button',{name:'发送',exact:true}).click();}
  const before=await scene();const label=frame.getByText(/^当前物料 \d+ 件 · 场地容量待核验$/).first();const initialLabel=await label.innerText();const count=Number(initialLabel.match(/\d+/)[0]);phase='preview';await send('为30人办室内讲座，场地长10米宽8米，采用课桌椅布局，生成方案');await frame.getByText(/以下信息还需核对/).waitFor({timeout:20000});await send('确认');
  const confirm=frame.getByRole('button',{name:'确认布置'});await confirm.waitFor({timeout:90000});await frame.locator('#plan-proposal').getByText('查看模型原文（未经核验）').click();assert.match(await frame.locator('#plan-proposal').innerText(),/尚未完成\s*30\s*人/);assert.deepEqual(await scene(),before);
  phase='apply';await confirm.click();await frame.getByText(/写进画布了/).waitFor({timeout:30000});await frame.getByText(`当前物料 ${count+1} 件 · 场地容量待核验`,{exact:true}).waitFor({timeout:10000});const after=await scene();assert.equal(after.objects.length,before.objects.length+1);
  phase='list';await send('物料清单');await frame.getByText(/物料清单 ·/).last().waitFor({timeout:15000});const list=await frame.getByText(/物料清单 ·/).last().innerText();assert.match(list,new RegExp(`${count+1} 件`));
  phase='export';await send('导出交接');await frame.getByText('导出完整活动交接').waitFor({timeout:15000});await frame.getByText(/云项目暂不支持完整活动交接/).waitFor({timeout:10000});assert.equal(await frame.getByRole('button',{name:'确认导出',exact:true}).count(),0);
  const [download]=await Promise.all([page.waitForEvent('download',{timeout:20000}),frame.getByRole('button',{name:'导出当前场景物料清单草案'}).click()]);
  const stream=await download.createReadStream(),chunks=[];for await(const chunk of stream)chunks.push(chunk);const html=Buffer.concat(chunks).toString('utf8');
  assert.match(html,/本机快照，未冻结/);assert.match(html,/数字模型不代表实物库存/);assert.match(html,/未包含完整活动需求、点验记录与场地方确认/);assert.match(html,/消防、无障碍/);
  assert.match(html,/工作台状态显示：本次读取时无未保存更改|工作台状态显示：本次包含尚未保存到云端的更改/);
  const saveState=html.includes('工作台状态显示：本次包含尚未保存到云端的更改')?'含未保存更改':'读取时无未保存更改';
  assert.match(html,/<td>内置模型<\/td>/);assert.doesNotMatch(html,/<td>builtin<\/td>/);
  const exportBlocked=true;
  phase='undo';const undo=frame.getByRole('button',{name:'撤销',exact:true});await undo.waitFor({timeout:10000});if(await undo.isDisabled())throw Error('undo_disabled');await undo.click();
  await frame.getByText(initialLabel,{exact:true}).waitFor({timeout:15000});await page.waitForTimeout(3000);const afterUndo=await scene();assert.deepEqual(afterUndo,before,'撤销后云端场景应完整恢复原场景');assert.deepEqual(blocked,[]);
  console.log(JSON.stringify({status:'observed',preview:true,baseObjects:before.objects.length,appliedObjects:after.objects.length,materialListCount:count+1,cloudDraftDownloaded:true,saveState,canvasCountAfterUndo:count,serverSceneRestored:true,exportBlocked,externalRequests:0}));
 }catch(error){console.error('SYNTHETIC_APPLY_DELIVERY_FAILED',phase,error.message);process.exitCode=1;}
 finally{try{await page.getByRole('button',{name:'结束试用'}).click({timeout:3000});}catch{}await context.close();await browser.close();}
}
void main();
