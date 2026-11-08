// Isolated synthetic browser verification. Never uses a real account or model.
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
 try{const page=await context.newPage();await page.goto(origin);const frame=page.frameLocator('iframe[title="幕景工作台"]');await frame.getByLabel('告诉 Agent 要改的').waitFor({timeout:60000});
  const child=page.frames().find(item=>item!==page.mainFrame()&&item.url().startsWith('http://127.0.0.1:'));if(!child)throw Error('没有找到独立工作台。');
  const stored=()=>child.evaluate(()=>{const raw=localStorage.getItem('scendance-editor-local-v1');return raw?JSON.parse(raw):null;});
  const items=layout=>layout.floors.flatMap(floor=>floor.items);
  await page.waitForTimeout(8000);
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
  const workspaceUrl=child.url();await child.goto(workspaceUrl,{waitUntil:'domcontentloaded'});
  await frame.getByLabel('告诉 Agent 要改的').waitFor({timeout:60000});
  await frame.getByText(/当前物料\s*65\s*件/).waitFor({timeout:30000});
  const reopened=await stored(),reopenedItems=items(reopened);assert.deepEqual(reopenedItems,afterItems,'刷新后本地物件应与确认后的读回一致');
  const reopenedIds=new Set(reopenedItems.map(item=>item.id));assert.ok([...beforeIds].every(id=>reopenedIds.has(id)));assert.ok(added.every(item=>reopenedIds.has(item.id)));
  const undo=frame.getByRole('button',{name:'撤销',exact:true}),undoAvailable=await undo.isEnabled();let undoResult='不可用';
  if(undoAvailable){await undo.click();await page.waitForTimeout(2000);const afterUndo=await stored(),remaining=items(afterUndo).filter(item=>added.some(value=>value.id===item.id)).length;undoResult=`触发后保留 ${remaining} 个新增物件`;}
  assert.deepEqual(cloudWrites,[]);assert.deepEqual(blocked,[]);
  const final=await(await fetch(`${origin}/status`)).json();console.log(JSON.stringify({status:'passed',mode:'synthetic',localOnly:true,baseItems:beforeItems.length,addedObjects:added.length,desks:30,chairs:30,previewPreservedStorage:true,confirmedReadback:true,refreshedCanvasMaterialCount:65,allBaseAndAddedIdsPreserved:true,undoAvailable,undoResult,cloudWrites:0,externalRequests:0,modelRequests:final.used}));
 }finally{await context.close();await browser.close();}
}
main().catch(error=>{console.error('LOCAL_DRAFT_CHECK_FAILED',error.message);process.exitCode=1;});
