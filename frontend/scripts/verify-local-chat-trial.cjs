// Runs only against the caller's synthetic trial; refuses live mode.
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const port=Number(process.env.SCENDANCE_CHAT_TRIAL_TEST_PORT||'4197');
if(!Number.isSafeInteger(port)||port<1024||port>65535||port===4186||port===4196)throw Error('仅允许独立的模拟试用端口。');
const origin=`http://127.0.0.1:${port}`;
async function main(){
 const state=await (await fetch(`${origin}/status`)).json();assert.equal(state.mode,'synthetic');assert.equal(state.used,0);
 const browser=await chromium.launch({headless:true,channel:'msedge'}),context=await browser.newContext();const blocked=[];
 await context.route('**/*',async route=>{const url=new URL(route.request().url());if(url.hostname==='127.0.0.1'||url.protocol==='data:'||url.protocol==='blob:')return route.continue();blocked.push(url.origin);return route.abort();});
 let page;
 try{
  page=await context.newPage();await page.goto(origin);await page.getByText(/模拟模式/).waitFor();const frame=page.frameLocator('iframe[title="幕景工作台"]');
  await frame.getByLabel('告诉 Agent 要改的').waitFor({timeout:60000});
  await frame.getByRole('button',{name:'账户中心'}).click();await frame.getByLabel('邮箱').fill('owner@scendance.test');await frame.getByLabel('密码').fill('local-integration-only');await frame.getByRole('button',{name:'登录并进入工作台'}).click();await frame.getByRole('button',{name:'关闭账户面板'}).click();
  async function send(text){await frame.getByLabel('告诉 Agent 要改的').fill(text);await frame.getByRole('button',{name:'发送',exact:true}).click();}
  await send('你好');await frame.getByText(/你好，我可以帮你梳理活动需求/).waitFor();assert.equal((await (await fetch(`${origin}/status`)).json()).used,0);
  await send('想与杭州养老社区共同探索活动，人数场地未知');await frame.getByText(/合作尚未落实，人数与场地仍待确认/).waitFor({timeout:30000});
  assert.equal((await (await fetch(`${origin}/status`)).json()).used,1);
  await send('先按30人，我有80把椅子');await frame.getByText(/先按30人讨论/).waitFor({timeout:30000});
  await frame.getByRole('button',{name:'查看物料库'}).waitFor({timeout:10000});
  const child=page.frames().find(item=>item!==page.mainFrame()&&item.url().startsWith('http://127.0.0.1:'));if(!child)throw Error('未找到隔离工作台');
  await child.waitForFunction(()=>Object.keys(localStorage).filter(key=>key.startsWith('scendance.assistant-brief-memory.v1')).some(key=>{
   try{const store=JSON.parse(localStorage.getItem(key)||'{}');return Object.values(store.byId||{}).some(memory=>memory&&memory.headcount===30&&memory.layoutModeConfirmed!==true&&Array.isArray(memory.reportedInventory)&&memory.reportedInventory.some(item=>item.evidence.includes('80把椅子')));}catch{return false;}
  }),null,{timeout:10000});
  await send('这些椅子怎么用？');await frame.getByText(/可以从物料库挑选相近椅子/).waitFor({timeout:30000});
  const candidates=frame.getByRole('region',{name:'物料候选'});await candidates.getByRole('button',{name:'打开物料库'}).waitFor({timeout:10000});
  await candidates.getByText(/找到 \d+ 个模型/).waitFor({timeout:15000});assert.match(await candidates.innerText(),/实物规格、库存和价格还需核实/);
  await send('如果没有现成椅子还有什么办法？');try{await frame.getByText(/可以查看物料库、导入已有 GLB/).waitFor({timeout:30000});}catch{const status=await (await fetch(`${origin}/status`)).json();const visible=(await frame.locator('body').innerText()).slice(-2500);throw Error(`第四轮未出现预期回答：${JSON.stringify(status)}；界面：${visible}`);}
  const final=await (await fetch(`${origin}/status`)).json();assert.equal(final.used,4);assert.notEqual(final.state,'failed');assert.deepEqual(blocked,[]);
  console.log(JSON.stringify({status:'passed',scope:'隔离真实工作台，固定合成 provider',greetingRequests:0,modelRequests:final.used,historyFixturePassed:true,headcountAndInventorySeparate:true,legacyLibraryEntryVisible:true,catalogueCandidatesVisible:true,externalRequests:0}));
 }finally{if(page){try{await page.getByRole('button',{name:'结束试用'}).click({timeout:3000});}catch{}}await context.close();await browser.close();}
}
main().catch(error=>{console.error('LOCAL_CHAT_TRIAL_FAILED',error.message);process.exitCode=1;});
