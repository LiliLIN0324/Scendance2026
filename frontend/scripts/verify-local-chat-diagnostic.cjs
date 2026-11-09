// Requires the separately started synthetic trial on 4197; never contacts a provider.
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const origin='http://127.0.0.1:4197';
async function main(){
 const initial=await (await fetch(`${origin}/status`)).json();assert.equal(initial.mode,'synthetic');assert.equal(initial.used,0);
 const browser=await chromium.launch({headless:true,channel:'msedge'}),context=await browser.newContext();const blocked=[];
 await context.route('**/*',async route=>{const url=new URL(route.request().url());if(url.hostname==='127.0.0.1'||url.protocol==='data:'||url.protocol==='blob:')return route.continue();blocked.push(url.origin);return route.abort();});
 let page;
 try{
  page=await context.newPage();await page.goto(origin);await page.getByText(/模拟模式/).waitFor();const frame=page.frameLocator('iframe[title="幕景工作台"]');
  await frame.getByLabel('告诉 Agent 要改的').waitFor({timeout:60000});
  await frame.getByRole('button',{name:'账户中心'}).click();await frame.getByLabel('邮箱').fill('owner@scendance.test');await frame.getByLabel('密码').fill('local-integration-only');await frame.getByRole('button',{name:'登录并进入工作台'}).click();await frame.getByRole('button',{name:'关闭账户面板'}).click();
  await frame.getByLabel('告诉 Agent 要改的').fill('合成诊断故障示例');await frame.getByRole('button',{name:'发送',exact:true}).click();
  await page.getByText(/模型服务返回错误（HTTP 429）/).waitFor({timeout:30000});
  const status=await (await fetch(`${origin}/status`)).json();assert.equal(status.state,'failed');assert.equal(status.used,1);assert.deepEqual(status.diagnostic,{code:'http_error',httpStatus:429});
  const visible=(await page.locator('body').innerText())+' '+(await frame.locator('body').innerText());
  assert(!visible.includes('PRIVATE_SYNTHETIC_RESPONSE_DO_NOT_DISPLAY'));assert(!JSON.stringify(status).includes('PRIVATE_SYNTHETIC_RESPONSE_DO_NOT_DISPLAY'));assert.deepEqual(blocked,[]);
  console.log(JSON.stringify({status:'passed',scope:'隔离真实工作台，合成 HTTP 429',diagnostic:'http_error',httpStatus:429,calls:1,rawProviderTextVisible:false,externalRequests:0}));
 }finally{if(page){try{await page.getByRole('button',{name:'结束试用'}).click({timeout:3000});}catch{}}await context.close();await browser.close();}
}
main().catch(error=>{console.error('LOCAL_CHAT_DIAGNOSTIC_FAILED',error.message);process.exitCode=1;});
