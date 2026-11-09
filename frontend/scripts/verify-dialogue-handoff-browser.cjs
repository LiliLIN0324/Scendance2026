// Local activity, fictional inputs and fixed synthetic model only.
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const {chromium}=require('playwright');
const port=Number(process.argv[2]);
if(!Number.isSafeInteger(port)||port<1024||port>65535||[4186,4196,4197,4198,4213,4215].includes(port))throw Error('请选择隔离模拟端口。');
const origin=`http://127.0.0.1:${port}`;
async function main(){
 const status=await(await fetch(`${origin}/status`)).json();assert.equal(status.mode,'synthetic');assert.equal(status.used,0);
 const browser=await chromium.launch({headless:true,channel:'msedge'}),context=await browser.newContext(),blocked=[],cloudWrites=[],downloads=[];let frame,page;
 await context.route('**/*',route=>{const url=new URL(route.request().url());if(url.hostname==='127.0.0.1'||url.protocol==='data:'||url.protocol==='blob:')return route.continue();blocked.push(url.origin);return route.abort();});
 context.on('request',request=>{const url=new URL(request.url());if(request.method()!=='GET'&&/\/functions\/v1\/scene-api\/projects(?:\/|$)/.test(url.pathname))cloudWrites.push(request.method());});
 try{
  page=await context.newPage();page.on('download',file=>downloads.push(file));await page.goto(origin);frame=page.frameLocator('iframe[title="幕景工作台"]');await frame.getByLabel('告诉 Agent 要改的').waitFor({timeout:60000});
  await frame.getByLabel('告诉 Agent 要改的').fill('把场地改成20×20米');await frame.getByRole('button',{name:'发送',exact:true}).click();await frame.getByText('场地改成 20 × 20 m。').waitFor({timeout:15000});
  await frame.getByRole('button',{name:'账户中心'}).click();await frame.getByLabel('邮箱').fill('owner@scendance.test');await frame.getByLabel('密码').fill('local-integration-only');await frame.getByRole('button',{name:'登录并进入工作台'}).click();await frame.getByText('已登录。').waitFor({timeout:10000});
  await frame.getByText(/仅本机 · 未存为云端方案/).waitFor({timeout:10000});await frame.getByRole('button',{name:'关闭账户面板'}).click();
  const send=async text=>{await frame.getByLabel('告诉 Agent 要改的').fill(text);await frame.getByRole('button',{name:'发送',exact:true}).click();};
  await send('30人，按一人一套课桌椅生成本地草案');await frame.getByText(/本机草案：本次排了 30 \/ 30 套/).waitFor({timeout:20000});await frame.getByRole('button',{name:'确认布置'}).click();
  await send('30人，室内，签到尚未决定');await frame.getByText(/签到区暂时待定/).waitFor({timeout:20000});
  await frame.getByRole('button',{name:'导出与交接',exact:true}).click();await frame.getByText('内部资料',{exact:true}).click();await frame.getByRole('button',{name:'查看活动需求'}).click();
  await frame.getByLabel('预计人数').fill('40');await frame.getByLabel('活动类型').selectOption({label:'工作坊'});
  await frame.getByRole('button',{name:'暂不填写 · 先回画布'}).click();
  await frame.getByRole('button',{name:'导出与交接',exact:true}).click();const exportTab=frame.getByRole('tab',{name:'导出',exact:true});if(!await exportTab.isVisible())await frame.getByText('内部资料',{exact:true}).click();await exportTab.click();
  const exportHtml=async()=>{const waiting=page.waitForEvent('download',{timeout:20000});await frame.getByRole('button',{name:'导出活动执行资料草案 HTML',exact:true}).click();const path=await(await waiting).path();return {path,text:await fs.readFile(path,'utf8')};};
  const firstFile=await exportHtml(),html=firstFile.text,plain=s=>s.replace(/<[^>]*>/g,' ').replace(/\s+/g,' ');
  const first=plain(html);assert.match(first,/活动助手对话需求（待核验）/);assert.match(first,/人数 30 人/);assert.match(first,/签到 未知/);assert.match(first,/人数与已确认手工记录：不一致，请核对/);assert.match(first,/活动类型 工作坊 预计人数 40/);assert.match(first,/待核验草案/);
  await frame.getByRole('tab',{name:'活动安排',exact:true}).click();await frame.getByRole('button',{name:'查看活动需求'}).click();await frame.getByLabel('预计人数').fill('45');await frame.getByRole('button',{name:'暂不填写 · 先回画布'}).click();
  await frame.getByRole('button',{name:'导出与交接',exact:true}).click();const nextTab=frame.getByRole('tab',{name:'导出',exact:true});if(!await nextTab.isVisible())await frame.getByText('内部资料',{exact:true}).click();await nextTab.click();
  const second=plain((await exportHtml()).text);assert.match(second,/活动类型 工作坊 预计人数 45/);assert.match(second,/人数 30 人/);assert.match(second,/人数与已确认手工记录：不一致，请核对/);assert.equal(await fs.readFile(firstFile.path,'utf8'),html);assert.equal(downloads.length,2);assert.deepEqual(cloudWrites,[]);assert.deepEqual(blocked,[]);
  console.log(JSON.stringify({status:'passed',mode:'synthetic',dialogueHeadcount:30,manualFirst:40,manualSecond:45,checkinUnknown:true,conflictVisible:true,previousDownloadUnchanged:true,cloudWrites:0,externalRequests:0}));
 }catch(error){if(frame)try{console.error('VISIBLE',(await frame.locator('body').innerText()).slice(-4000));}catch{}throw error;}
 finally{try{await page.getByRole('button',{name:'结束试用'}).click({timeout:3000});}catch{}await context.close();await browser.close();}
}
main().catch(error=>{console.error('DIALOGUE_HANDOFF_FAILED',error.message);process.exitCode=1;});
