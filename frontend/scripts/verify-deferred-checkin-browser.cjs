// Isolated synthetic model and database only; no production account or external traffic.
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const port=Number(process.argv[2]);
if(!Number.isSafeInteger(port)||port<1024||port>65535||[4186,4196,4197,4198,4213,4215].includes(port))throw Error('请选择隔离模拟端口。');
const origin=`http://127.0.0.1:${port}`;
async function main(){
 const status=await(await fetch(`${origin}/status`)).json();assert.equal(status.mode,'synthetic');assert.equal(status.used,0);
 const browser=await chromium.launch({headless:true,channel:'msedge'}),context=await browser.newContext(),blocked=[],writes=[];let frame;
 await context.route('**/*',route=>{const url=new URL(route.request().url());if(url.hostname==='127.0.0.1'||url.protocol==='data:'||url.protocol==='blob:')return route.continue();blocked.push(url.origin);return route.abort();});
 context.on('request',req=>{if(req.method()!=='GET'&&/\/proposals\/apply$/.test(new URL(req.url()).pathname))writes.push('apply');});
 try{
  const page=await context.newPage();await page.goto(origin);frame=page.frameLocator('iframe[title="幕景工作台"]');await frame.getByLabel('告诉 Agent 要改的').waitFor({timeout:60000});
  await frame.getByRole('button',{name:'账户中心'}).click();await frame.getByLabel('邮箱').fill('owner@scendance.test');await frame.getByLabel('密码').fill('local-integration-only');await frame.getByRole('button',{name:'登录并进入工作台'}).click();await frame.getByText('已登录。').waitFor({timeout:10000});
  await frame.getByRole('button',{name:'新方案'}).click();await page.waitForTimeout(5000);if(!await frame.getByRole('button',{name:'关闭账户面板'}).count())await frame.getByRole('button',{name:'账户中心'}).click();
  await frame.getByRole('button',{name:/当前项目 .*双击进入/}).dblclick();await page.waitForTimeout(3000);
  const send=async text=>{await frame.getByLabel('告诉 Agent 要改的').fill(text);await frame.getByRole('button',{name:'发送',exact:true}).click();};
  await send('30人，室内，签到尚未决定');await frame.getByText(/签到.*(?:待定|尚未决定|未确定)/).first().waitFor({timeout:20000});
  await send('为30人办室内讲座，场地长10米宽8米，采用课桌椅布局');
  await frame.getByText(/以下信息还需核对/).waitFor({timeout:20000});await send('确认');
  await send('先探索');
  await frame.locator('#plan-proposal').waitFor({timeout:45000});const card=frame.locator('#plan-proposal');
  await card.getByText(/签到.*(?:待定|未确认|尚未决定|未确定)/).first().waitFor({timeout:5000});
  assert.equal(await card.getByRole('button',{name:'确认布置'}).count(),0);
  await send('确认布置');await frame.getByText(/还有需求待确认，请先核对后再确认布置/).waitFor({timeout:10000});assert.deepEqual(writes,[]);assert.deepEqual(blocked,[]);
  console.log(JSON.stringify({status:'passed',mode:'synthetic',deferredCheckinVisible:true,formalConfirmationBlocked:true,externalRequests:blocked.length,cloudApplyWrites:writes.length}));
 }catch(error){if(frame){try{console.error('VISIBLE',(await frame.locator('body').innerText()).slice(-3000));}catch{}}throw error;}
 finally{await context.close();await browser.close();}
}
main().catch(error=>{console.error('DEFERRED_CHECKIN_FAILED',error.message);process.exitCode=1;});
