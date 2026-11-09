// Isolated synthetic browser verification. Never uses a real account or model.
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const {chromium}=require('playwright');
const port=Number(process.argv[2]);
if(!Number.isSafeInteger(port)||port<1024||port>65535||[4186,4196,4197,4198,4213,4215].includes(port))throw Error('请选择隔离模拟端口。');
const origin=`http://127.0.0.1:${port}`;
function readCsv(text){
 const rows=[];let row=[],cell='',quoted=false;
 for(let i=text.charCodeAt(0)===0xfeff?1:0;i<text.length;i++){
  const char=text[i];if(quoted){if(char==='"'&&text[i+1]==='"'){cell+='"';i++;}else if(char==='"')quoted=false;else cell+=char;}
  else if(char==='"')quoted=true;else if(char===','){row.push(cell);cell='';}else if(char==='\n'){row.push(cell);rows.push(row);row=[];cell='';}else if(char!=='\r')cell+=char;
 }
 if(cell||row.length){row.push(cell);rows.push(row);}if(quoted)throw Error('CSV 引号未闭合。');return rows;
}
async function main(){
 const status=await(await fetch(`${origin}/status`)).json();if(status.mode!=='synthetic'||status.used!==0)throw Error('需要全新的模拟试用。');
 const browser=await chromium.launch({headless:true,channel:'msedge'}),context=await browser.newContext(),blocked=[],cloudWrites=[];
 await context.route('**/*',route=>{const url=new URL(route.request().url());if(url.hostname==='127.0.0.1'||url.protocol==='data:'||url.protocol==='blob:')return route.continue();blocked.push(url.origin);return route.abort();});
 context.on('request',request=>{const url=new URL(request.url());if(request.method()!=='GET'&&/\/functions\/v1\/scene-api\/projects(?:\/|$)/.test(url.pathname))cloudWrites.push(`${request.method()} ${url.pathname.replace(/[0-9a-f-]{36}/ig,':id')}`);});
 let frame,page,child;
 try{page=await context.newPage();await page.goto(origin);frame=page.frameLocator('iframe[title="幕景工作台"]');await frame.getByLabel('告诉 Agent 要改的').waitFor({timeout:60000});
  child=page.frames().find(item=>item!==page.mainFrame()&&item.url().startsWith('http://127.0.0.1:'));if(!child)throw Error('没有找到独立工作台。');
  const stored=()=>child.evaluate(()=>{const raw=localStorage.getItem('scendance-editor-local-v1');return raw?JSON.parse(raw):null;});
  const items=layout=>layout.floors.flatMap(floor=>floor.items);
  await page.waitForTimeout(8000);
  assert.equal(await frame.getByText(/会话未能保存在本机/).count(),0,'初始化不应显示错误的会话保存警告');
  await frame.getByLabel('告诉 Agent 要改的').fill('把场地改成20×20米');await frame.getByRole('button',{name:'发送',exact:true}).click();
  await frame.getByText('场地改成 20 × 20 m。').waitFor({timeout:15000});
  await frame.getByRole('button',{name:'账户中心'}).click();await frame.getByLabel('邮箱').fill('owner@scendance.test');await frame.getByLabel('密码').fill('local-integration-only');await frame.getByRole('button',{name:'登录并进入工作台'}).click();await frame.getByText('已登录。').waitFor({timeout:10000});
  await frame.getByText(/仅本机 · 未存为云端方案/).waitFor({timeout:10000});await frame.getByRole('button',{name:'关闭账户面板'}).click();
  await child.waitForFunction(()=>{try{const v=JSON.parse(localStorage.getItem('scendance-editor-local-v1')||'null');return v&&v.width===20&&v.height===20;}catch{return false;}},null,{timeout:15000});
  const before=await stored(),beforeItems=items(before),beforeIds=new Set(beforeItems.map(item=>item.id));assert.equal(before.width,20);assert.equal(before.height,20);
  await frame.getByLabel('告诉 Agent 要改的').fill('30人，按一人一套课桌椅生成本地草案');await frame.getByRole('button',{name:'发送',exact:true}).click();
  await frame.getByText(/本机草案：本次排了 30 \/ 30 套/).waitFor({timeout:20000});
  const visible=await frame.locator('#plan-proposal').innerText();assert.match(visible,/放进 60 件/);assert.match(visible,/未同步云端，也未确认本机持久化/);assert.match(visible,/出口位置与用途/);
  assert.deepEqual(await stored(),before,'确认前本地持久化场景不能改变。');
  await frame.getByRole('button',{name:'确认布置'}).click();
  await child.waitForFunction(count=>{try{const v=JSON.parse(localStorage.getItem('scendance-editor-local-v1')||'null');return v?.floors.flatMap(f=>f.items).length===count;}catch{return false;}},beforeItems.length+60,{timeout:20000});
  const after=await stored(),afterItems=items(after),added=afterItems.filter(item=>!beforeIds.has(item.id));assert.equal(added.length,60);assert.equal(new Set(added.map(item=>item.id)).size,60);assert.equal(added.filter(item=>item.type==='desk').length,30);assert.equal(added.filter(item=>item.type==='chair').length,30);
  // Only enter the export using controls a user can actually see.
  const entry=frame.getByRole('button',{name:'导出与交接',exact:true});
  if(!await entry.isVisible())throw Error('未找到可见的“导出与交接”入口，无法继续从界面导出。');
  await entry.click();await frame.getByText('内部资料',{exact:true}).click();await frame.getByRole('tab',{name:'导出',exact:true}).click();
  const getFile=async name=>{const waiting=page.waitForEvent('download',{timeout:15000});await frame.getByRole('button',{name,exact:true}).click();return fs.readFile(await(await waiting).path(),'utf8');};
  const json=JSON.parse(await getFile('导出本地待核验草案 JSON'));
  assert.equal(json.state,'draft_unverified');assert.equal(json.layout.width,20);assert.equal(json.layout.height,20);
  const exported=items(json.layout),exportedAdded=exported.filter(item=>!beforeIds.has(item.id));assert.equal(exportedAdded.length,60);assert.equal(exportedAdded.filter(item=>item.type==='desk').length,30);assert.equal(exportedAdded.filter(item=>item.type==='chair').length,30);
  for(const item of exportedAdded){const expected=item.type==='desk'?{width:.6,depth:.45,height:.75}:{width:.49,depth:.57,height:.9};for(const key of Object.keys(expected))assert.equal(item[key],expected[key]);}
  assert.ok(json.checks.every(check=>check.status==='unknown'));assert.equal(json.confirmations.venue,'unknown');assert.match(json.scope.notice,/待核验/);
  const csv=await getFile('导出本地物料草案 CSV');assert.match(csv,/待核验/);
  const rows=readCsv(csv),header=rows.shift();assert.ok(header);const at=name=>{const index=header.indexOf(name);assert.ok(index>=0,`缺失 ${name} 列`);return index;};
  for(const [name,width,depth,height] of [['课桌（示意）',.6,.45,.75],['座椅（示意）',.49,.57,.9]]){
   const matching=rows.filter(row=>row[at('名称')]===name&&Number(row[at('宽/m')])===width&&Number(row[at('深/m')])===depth&&Number(row[at('高/m')])===height);
   assert.equal(matching.reduce((sum,row)=>sum+Number(row[at('数量')]),0),30,`${name} 的数量和尺寸应与草案一致`);
  }
  assert.equal(await frame.getByText(/会话未能保存在本机/).count(),0,'完成交付时不应显示错误的会话保存警告');assert.deepEqual(cloudWrites,[]);assert.deepEqual(blocked,[]);
  const final=await(await fetch(`${origin}/status`)).json();console.log(JSON.stringify({status:'passed',mode:'synthetic',localOnly:true,baseItems:beforeItems.length,addedObjects:added.length,previewPreservedStorage:true,confirmedReadback:true,jsonSeats:30,jsonDesks:30,csvDimensions:true,checksUnknown:true,cloudWrites:0,externalRequests:0,modelRequests:final.used}));
 }catch(error){if(frame){try{console.error('VISIBLE_WORKBENCH', (await frame.locator('body').innerText()).slice(-4500));console.error('VISIBLE_BUTTONS',JSON.stringify(await frame.locator('button:visible').evaluateAll(buttons=>buttons.map(button=>button.getAttribute('aria-label')||button.innerText).filter(Boolean))));}catch{}}if(child){try{console.error('LOCAL_GEOMETRY',JSON.stringify(await child.evaluate(()=>{const v=JSON.parse(localStorage.getItem('scendance-editor-local-v1')||'null');return v?{width:v.width,height:v.height,items:v.floors?.flatMap(f=>f.items||[]).length,zones:v.floors?.flatMap(f=>f.zones||[]).length,entrances:v.backendSceneV2?.venue?.entrances?.length,openings:v.backendSceneV2?.structure?.openings?.length}:null;})));}catch{}}console.error('NETWORK_COUNTS',JSON.stringify({cloudWrites:cloudWrites.length,blockedExternal:blocked.length}));if(page){try{const evidence=path.join(os.tmpdir(),`scendance-local-draft-${port}.png`);await page.screenshot({path:evidence});console.error('SCREENSHOT',evidence);}catch{}}throw error;}
 finally{await context.close();await browser.close();}
}
main().catch(error=>{console.error('LOCAL_DRAFT_CHECK_FAILED',error.message);process.exitCode=1;});
