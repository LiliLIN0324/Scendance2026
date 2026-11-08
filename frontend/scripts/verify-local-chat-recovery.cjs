// Run against a separately started synthetic trial; no live provider or user data.
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const port=Number(process.env.SCENDANCE_CHAT_TRIAL_TEST_PORT||'4237');
if(!Number.isSafeInteger(port)||port<1024||port>65535||[4186,4196,4197,4198,4213,4215,4246,4248,4249].includes(port))throw Error('仅允许独立模拟试用端口。');
const origin=`http://127.0.0.1:${port}`;
async function main(){
 const initial=await(await fetch(`${origin}/status`)).json();assert.equal(initial.mode,'synthetic');assert.equal(initial.state,'ready');assert.equal(initial.used,0);
 const browser=await chromium.launch({headless:true,channel:'msedge'}),context=await browser.newContext(),blocked=[];
 await context.route('**/*',route=>{const u=new URL(route.request().url());if(u.hostname==='127.0.0.1'||u.protocol==='data:'||u.protocol==='blob:')return route.continue();blocked.push(u.origin);return route.abort();});
 const page=await context.newPage();
 try{
  await page.goto(origin);const frame=page.frameLocator('iframe[title="幕景工作台"]');await frame.getByLabel('告诉 Agent 要改的').waitFor({timeout:60000});
  await frame.getByRole('button',{name:'账户中心'}).click();await frame.getByLabel('邮箱').fill('owner@scendance.test');await frame.getByLabel('密码').fill('local-integration-only');await frame.getByRole('button',{name:'登录并进入工作台'}).click();await frame.getByRole('button',{name:'关闭账户面板'}).click();
  const send=async text=>{await frame.getByLabel('告诉 Agent 要改的').fill(text);await frame.getByRole('button',{name:'发送',exact:true}).click();};
  await send('合成格式故障示例，30人，室内10×8，课桌椅，生成方案');
  await page.getByText(/模型回答不是 JSON/).waitFor({timeout:30000});
  await page.waitForTimeout(2000);
  let status=await(await fetch(`${origin}/status`)).json();assert.equal(status.state,'ready');assert.equal(status.used,1);assert.equal(status.diagnostic.code,'model_non_json');
  const unauthorized=await fetch(`${origin}/resume`,{method:'POST'});assert.equal(unauthorized.status,404);
  assert.equal((await(await fetch(`${origin}/status`)).json()).state,'ready');
  assert.equal(await page.getByRole('button',{name:'继续试用'}).isVisible(),false);
  await page.waitForTimeout(1500);status=await(await fetch(`${origin}/status`)).json();assert.equal(status.used,1);
  await send('我们有80把椅子');
  await frame.getByText(/可先从物料库核对椅子/).waitFor({timeout:30000});
  status=await(await fetch(`${origin}/status`)).json();assert.equal(status.state,'ready');assert.equal(status.used,2);assert.deepEqual(blocked,[]);
  assert(!(await page.locator('body').innerText()).includes('这是模拟格式故障'));
  console.log(JSON.stringify({status:'passed',mode:'synthetic',invalidResponseRejected:true,automaticRetry:false,manualResume:false,newRequestCompleted:true,externalRequests:0}));
 }finally{try{await page.getByRole('button',{name:'结束试用'}).click({timeout:3000});}catch{}await context.close();await browser.close();}
}
main().catch(()=>{console.error('LOCAL_CHAT_RECOVERY_FAILED');process.exitCode=1;});
