// Isolated synthetic workbench only; no real key, projects, or outside network.
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const port=Number(process.argv[2]);
if(!Number.isSafeInteger(port)||port<1024||port>65535||[4186,4196,4197,4198,4213,4215].includes(port))throw Error('请选择隔离模拟端口。');
const origin=`http://127.0.0.1:${port}`;
async function main(){
 const initial=await(await fetch(`${origin}/status`)).json();assert.equal(initial.mode,'synthetic');assert.equal(initial.used,0);
 const browser=await chromium.launch({headless:true,channel:'msedge'}),context=await browser.newContext(),blocked=[],cloudWrites=[],pageErrors=[];
 await context.route('**/*',route=>{const url=new URL(route.request().url());if(url.hostname==='127.0.0.1'||url.protocol==='data:'||url.protocol==='blob:')return route.continue();blocked.push(url.origin);return route.abort();});
 context.on('request',request=>{const url=new URL(request.url());if(request.method()!=='GET'&&/\/functions\/v1\/scene-api\/projects(?:\/|$)/.test(url.pathname))cloudWrites.push(`${request.method()} ${url.pathname.replace(/[0-9a-f-]{36}/ig,':id')}`);});
 const page=await context.newPage();page.on('pageerror',error=>pageErrors.push(error.message));
 try{
  await page.goto(origin);const frame=page.frameLocator('iframe[title="幕景工作台"]');await frame.getByLabel('告诉 Agent 要改的').waitFor({timeout:60000});
  const session=await frame.locator('h1.ap-session-title').innerText();
  await frame.getByRole('button',{name:'空间',exact:true}).click();
  const space=frame.getByLabel('空间输入框');await space.fill('切换传统空间');await space.press('Enter');
  await frame.getByRole('button',{name:/传统空间/}).waitFor();
  await frame.getByRole('button',{name:/传统空间/}).evaluate(button=>{if(button.getAttribute('aria-pressed')!=='true')throw Error('传统空间快捷动作未切换。');});
  assert.equal(await space.inputValue(),'');assert.equal((await(await fetch(`${origin}/status`)).json()).used,0);
  const first='我希望场地布置温馨';await space.fill(first);await space.press('Enter');
  await frame.getByLabel('告诉 Agent 要改的').waitFor({timeout:30000});await frame.getByText(first,{exact:true}).waitFor({timeout:30000});
  assert.equal(await frame.locator('h1.ap-session-title').innerText(),session);
  await frame.getByRole('button',{name:'物料',exact:true}).click();const material=frame.getByLabel('物料输入框');const second='我偏好浅色木椅';await material.fill(second);await material.press('Enter');
  await frame.getByLabel('告诉 Agent 要改的').waitFor({timeout:30000});await frame.getByText(second,{exact:true}).waitFor({timeout:30000});
  assert.equal(await frame.locator('h1.ap-session-title').innerText(),session);assert.equal(await frame.getByText(first,{exact:true}).count(),1);assert.equal(await frame.getByText(second,{exact:true}).count(),1);
  assert.deepEqual(cloudWrites,[]);assert.deepEqual(blocked,[]);assert.deepEqual(pageErrors,[]);
  const final=await(await fetch(`${origin}/status`)).json();console.log(JSON.stringify({status:'passed',mode:'synthetic',sameSession:true,spaceTextPreserved:true,materialTextPreserved:true,traditionalShortcut:true,cloudWrites:0,externalRequests:0,pageErrors:0,modelRequests:final.used}));
 }finally{await context.close();await browser.close();}
}
main().catch(error=>{console.error('FORWARD_CHECK_FAILED',error.message);process.exitCode=1;});
