// Synthetic, isolated real-browser check of shared-desk intent and explicit correction.
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const port=Number(process.argv[2]);
if(!Number.isSafeInteger(port)||port<1024||port>65535||[4186,4196,4197,4198,4213,4215].includes(port))throw Error('请选择隔离模拟端口。');
const origin=`http://127.0.0.1:${port}`;
async function main(){
 const status=await(await fetch(`${origin}/status`)).json();if(status.mode!=='synthetic'||status.used!==0)throw Error('需要全新的模拟试用。');
 const browser=await chromium.launch({headless:true,channel:'msedge'}),context=await browser.newContext(),blocked=[],cloudWrites=[];
 await context.route('**/*',route=>{const url=new URL(route.request().url());if(url.hostname==='127.0.0.1'||url.protocol==='data:'||url.protocol==='blob:')return route.continue();blocked.push(url.origin);return route.abort();});
 context.on('request',request=>{const url=new URL(request.url());if(request.method()!=='GET'&&/\/functions\/v1\/scene-api\/projects(?:\/|$)/.test(url.pathname))cloudWrites.push(`${request.method()} ${url.pathname.replace(/[0-9a-f-]{36}/ig,':id')}`);});
 let frame;
 try{
  const page=await context.newPage();await page.goto(origin);frame=page.frameLocator('iframe[title="幕景工作台"]');await frame.getByLabel('告诉 Agent 要改的').waitFor({timeout:60000});
  const child=page.frames().find(item=>item!==page.mainFrame()&&item.url().startsWith('http://127.0.0.1:'));if(!child)throw Error('没有找到独立工作台。');
  const stored=()=>child.evaluate(()=>{const raw=localStorage.getItem('scendance-editor-local-v1');return raw?JSON.parse(raw):null;});
  await page.waitForTimeout(8000);
  assert.equal(await frame.getByText(/会话未能保存在本机/).count(),0,'初始化不应显示错误的会话保存警告');
  const send=async text=>{await frame.getByLabel('告诉 Agent 要改的').fill(text);await frame.getByRole('button',{name:'发送',exact:true}).click();};
  await send('把场地改成20×20米');await frame.getByText('场地改成 20 × 20 m。').waitFor({timeout:15000});
  await frame.getByRole('button',{name:'账户中心'}).click();await frame.getByLabel('邮箱').fill('owner@scendance.test');await frame.getByLabel('密码').fill('local-integration-only');await frame.getByRole('button',{name:'登录并进入工作台'}).click();await frame.getByText('已登录。').waitFor({timeout:10000});
  await frame.getByText(/仅本机 · 未存为云端方案/).waitFor({timeout:10000});await frame.getByRole('button',{name:'关闭账户面板'}).click();
  await child.waitForFunction(()=>{try{const v=JSON.parse(localStorage.getItem('scendance-editor-local-v1')||'null');return v&&v.width===20&&v.height===20;}catch{return false;}},null,{timeout:15000});
  const before=await stored();
  await send('30人，每3人一桌，采用课桌椅，生成本地草案');
  await frame.getByText(/每桌\s*3\s*人.*暂不支持/).waitFor({timeout:20000});
  assert.equal(await frame.locator('#plan-proposal').count(),0,'三人共桌不能被悄悄改成其他配比');assert.equal(await frame.getByText(/会话未能保存在本机/).count(),0,'共桌拒绝时不应显示错误的会话保存警告');assert.deepEqual(await stored(),before);
  await send('改成每人一桌');await frame.getByText('改成每人一桌',{exact:true}).waitFor({timeout:10000});
  await page.waitForTimeout(2000);await send('生成本地草案');
  await frame.getByText(/本机草案：本次排了 30 \/ 30 套/).waitFor({timeout:20000});
  const card=await frame.locator('#plan-proposal').innerText();assert.match(card,/每人一桌：用户明确选择/);assert.match(card,/放进 60 件/);assert.deepEqual(await stored(),before,'确认预览前场景不能变化');
  assert.equal(await frame.getByText(/会话未能保存在本机/).count(),0,'更正后不应显示错误的会话保存警告');assert.deepEqual(cloudWrites,[]);assert.deepEqual(blocked,[]);const final=await(await fetch(`${origin}/status`)).json();
  console.log(JSON.stringify({status:'passed',mode:'synthetic',threePerDeskRejected:true,unchangedAfterRejection:true,explicitCorrectionPreview:true,unchangedBeforeConfirmation:true,cloudWrites:0,externalRequests:0,modelRequests:final.used}));
 }catch(error){if(frame){try{console.error('VISIBLE_WORKBENCH',(await frame.locator('body').innerText()).slice(-3000));}catch{}}throw error;}
 finally{await context.close();await browser.close();}
}
main().catch(error=>{console.error('SHARED_DESK_CHECK_FAILED',error.message);process.exitCode=1;});
