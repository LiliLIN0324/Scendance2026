// Isolated synthetic workbench only. No paid model requests or user projects.
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const port=Number(process.env.SCENDANCE_CHAT_TRIAL_TEST_PORT||'4231');
if(!Number.isSafeInteger(port)||port<1024||port>65535||[4186,4196,4197,4198,4213].includes(port))throw Error('仅允许独立的模拟试用端口。');
const origin=`http://127.0.0.1:${port}`;
async function main(){
 const initial=await(await fetch(`${origin}/status`)).json();assert.equal(initial.mode,'synthetic');assert.equal(initial.used,0);
 const browser=await chromium.launch({headless:true,channel:'msedge'}),context=await browser.newContext(),blocked=[];
 await context.route('**/*',route=>{const u=new URL(route.request().url());if(u.hostname==='127.0.0.1'||u.protocol==='data:'||u.protocol==='blob:')return route.continue();blocked.push(u.origin);return route.abort();});
 const page=await context.newPage();
 try{
  await page.goto(origin);const frame=page.frameLocator('iframe[title="幕景工作台"]');
  await frame.getByLabel('告诉 Agent 要改的').waitFor({timeout:60000});
  await frame.getByRole('button',{name:'账户中心'}).click();await frame.getByLabel('邮箱').fill('owner@scendance.test');await frame.getByLabel('密码').fill('local-integration-only');await frame.getByRole('button',{name:'登录并进入工作台'}).click();await frame.getByText('已登录。').waitFor({timeout:10000});
  await frame.getByRole('button',{name:'新方案'}).click();await page.waitForTimeout(4000);
  if(!await frame.getByRole('button',{name:'关闭账户面板'}).count())await frame.getByRole('button',{name:'账户中心'}).click();
  await frame.getByRole('button',{name:/当前项目 .*双击进入/}).dblclick();await page.waitForTimeout(2000);
  if(await frame.getByRole('button',{name:'空间',exact:true}).getAttribute('aria-expanded')!=='true')await frame.getByRole('button',{name:'空间',exact:true}).click();
  await frame.getByText('场地信息记录',{exact:true}).click();
  const scope=frame.locator('details').filter({has:frame.getByText('场地信息记录',{exact:true})});
  await scope.getByText(/仅保存在此浏览器/).waitFor();
  assert.match(await scope.innerText(),/仅记录一扇门/);assert.match(await scope.innerText(),/不等于现场确认或安全验收/);
  await scope.getByLabel('要记录的信息').selectOption('door_width');
  await scope.getByLabel('数值（米）').fill('1.2');await scope.getByLabel('资料来源').selectOption('site_measurement');
  await scope.getByLabel('来源说明').fill('虚构测量');await scope.getByLabel('记录人').fill('测试');
  await scope.getByRole('checkbox',{name:'我已核对这项信息'}).check();await scope.getByRole('button',{name:'保存这项信息'}).click();
  await scope.getByText(/门宽：1.2 米 · 用户已核对 · 用户标注为现场测量/).waitFor({timeout:10000});
  const child=page.frames().find(f=>f!==page.mainFrame()&&f.url().startsWith('http://127.0.0.1:'));assert.ok(child);
  const records=await child.evaluate(()=>Object.entries(localStorage).filter(([key])=>key.startsWith('scendance:venue-facts:v1:')).map(([,raw])=>{const item=JSON.parse(raw);return {scope:item.scope,revision:item.revision,door:item.facts.door_width};}));
  assert.equal(records.length,1);assert.equal(records[0].door.value,1.2);assert.equal(records[0].door.source,'site_measurement');assert.equal(records[0].door.status,'confirmed');
  assert.deepEqual(blocked,[]);const status=await(await fetch(`${origin}/status`)).json();assert.equal(status.used,0);
  console.log(JSON.stringify({status:'passed',mode:'synthetic',savedLocally:true,sourceVisible:true,oneDoorLimitationVisible:true,safetyLimitVisible:true,modelRequests:status.used,externalRequests:0,activitySwitch:'not-verified'}));
 }catch(error){const text=await page.frameLocator('iframe[title="幕景工作台"]').locator('body').innerText().catch(()=>'<unavailable>');console.error('模拟界面状态:',text.slice(-2200));throw error;}
 finally{await context.close();await browser.close();}
}
main().catch(error=>{console.error('VENUE_FACTS_BROWSER_FAILED',error.message);process.exitCode=1;});
