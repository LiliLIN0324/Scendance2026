// Fictional, local-only browser test. It never uses a real model or account.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const port=Number(process.argv[2]);
if(!Number.isSafeInteger(port)||port<1024||[4186,4213,4215,4246,4248,4249,4250,4252,4254,4255,4256,4257].includes(port))throw Error('必须指定独立模拟端口。');
const origin=`http://127.0.0.1:${port}`;
async function main(){
 let phase='status';
 const status=await(await fetch(`${origin}/status`)).json();assert.equal(status.mode,'synthetic');assert.equal(status.used,0);
 const browser=await chromium.launch({headless:true,channel:'msedge'}),context=await browser.newContext();
 const blocked=[],writes=[];
 await context.route('**/*',route=>{const u=new URL(route.request().url());if(u.hostname==='127.0.0.1'||u.protocol==='data:'||u.protocol==='blob:')return route.continue();blocked.push(u.origin);return route.abort();});
 context.on('request',request=>{if(request.method()!=='GET'&&/\/projects\//.test(new URL(request.url()).pathname))writes.push('project-write');});
 const page=await context.newPage();
 try{
  phase='wrapper';await page.goto(origin);
  await page.getByText(/G402 公开参考/).waitFor();
  const frameEl=page.locator('iframe[title="幕景工作台"]'),sandbox=await frameEl.getAttribute('sandbox');
  assert(!sandbox.includes('allow-downloads'));assert(!sandbox.includes('allow-popups'));
  const source=await frameEl.getAttribute('src');assert.match(source,/^http:\/\/127\.0\.0\.1:\d+$/);
  phase='csp';const response=await context.request.get(`${source}/`),csp=response.headers()['content-security-policy'];
  assert.match(csp,/sandbox/);assert(!csp.includes('allow-downloads'));assert(!csp.includes('allow-popups'));
  phase='banner';const frame=page.frameLocator('iframe[title="幕景工作台"]');
  await frame.getByTestId('g402-simulation-banner').waitFor({timeout:60000});
  const label=await frame.getByTestId('g402-simulation-banner').innerText();
  for(const part of ['虚构矩形','桌椅为示意规格','库存未接入','场地方未确认','应用内下载受限'])assert(label.includes(part));
  phase='resize';await frame.getByLabel('告诉 Agent 要改的').waitFor({timeout:60000});
  // Wait until the local editor has completed hydration before issuing a geometry command.
  await page.waitForTimeout(8000);
  await frame.getByLabel('告诉 Agent 要改的').fill('把场地改成14.2×10米');
  await frame.getByRole('button',{name:'发送',exact:true}).click();
  await frame.getByText(/场地改成\s*14\.2\s*×\s*10\s*m/).waitFor({timeout:20000});
  await frame.getByRole('button',{name:'账户中心'}).click();
  await frame.getByLabel('邮箱').fill('owner@scendance.test');await frame.getByLabel('密码').fill('local-integration-only');
  await frame.getByRole('button',{name:'登录并进入工作台'}).click();await frame.getByText('已登录。').waitFor({timeout:10000});
  if(await frame.getByRole('button',{name:'关闭账户面板'}).count())await frame.getByRole('button',{name:'关闭账户面板'}).click();
  phase='preview';await frame.getByLabel('告诉 Agent 要改的').fill('30人，每2人一桌，采用课桌椅，生成本地草案');
  await frame.getByRole('button',{name:'发送',exact:true}).click();
  await frame.getByText(/本机草案：需求 30 人、15 桌；本次排了 30 人、15 桌、30 把椅子/).waitFor({timeout:30000});
  const confirmation=await frame.getByRole('button',{name:'确认布置'}).count();assert.equal(confirmation,1);
  assert.equal(writes.length,0);assert.equal(blocked.length,0);
  const screenshot=path.join(os.tmpdir(),`scendance-g402-synthetic-${port}.png`);await page.screenshot({path:screenshot});
  // Test a direct workbench navigation as well as its iframe: sandboxed download must fail in both.
  async function assertDownloadBlocked(target,eventTarget){
   let download=false;eventTarget.on('download',()=>{download=true;});
   await target.evaluate(()=>{const a=document.createElement('a');a.href='data:text/plain,simulation';a.download='simulation.txt';document.body.append(a);a.click();a.remove();});
   await page.waitForTimeout(1200);assert.equal(download,false);
  }
  phase='downloads';const direct=await context.newPage();await direct.goto(source);await direct.getByTestId('g402-simulation-banner').waitFor({timeout:60000});
  await assertDownloadBlocked(direct,direct);
  const child=page.frames().find(item=>item!==page.mainFrame()&&item.url().startsWith('http://127.0.0.1:'));assert(child);
  await assertDownloadBlocked(child,page);
  console.log(JSON.stringify({status:'passed',mode:'synthetic',banner:true,rectangle:'simulated',inventory:'not-connected',venueConfirmed:false,seats:30,desks:15,previewOnly:true,downloadsBlocked:true,projectWrites:0,externalRequests:0,screenshot}));
 }catch(error){
  if(phase==='preview'||phase==='resize')try{const f=page.frameLocator('iframe[title="幕景工作台"]');const text=await f.locator('body').innerText({timeout:2000});console.error('模拟页面末尾:',text.slice(-1600));console.error('模拟输入状态:',await f.getByLabel('告诉 Agent 要改的').inputValue(),await f.getByRole('button',{name:'发送',exact:true}).isDisabled());}catch{}
  console.error(JSON.stringify({phase,error:error?.name??'unknown'}));throw error;
 }
 finally{await context.close();await browser.close();}
}
main().catch(()=>{console.error('隔离模拟浏览器核验未通过。');process.exitCode=1;});
