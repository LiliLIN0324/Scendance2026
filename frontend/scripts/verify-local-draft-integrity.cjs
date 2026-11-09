// Isolated synthetic browser verification only; never accesses a real project or model.
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const {createHash}=require('node:crypto');
const {chromium}=require('playwright');
const port=Number(process.argv[2]);
if(!Number.isSafeInteger(port)||port<1024||port>65535||[4186,4196,4197,4198,4213,4215].includes(port))throw Error('请选择隔离模拟端口。');
const origin=`http://127.0.0.1:${port}`;
async function main(){
 const initial=await(await fetch(`${origin}/status`)).json();if(initial.mode!=='synthetic'||initial.used!==0)throw Error('需要全新的模拟试用。');
 const browser=await chromium.launch({headless:true,channel:'msedge'}),context=await browser.newContext(),blocked=[],cloudWrites=[],downloads=[];
 await context.route('**/*',route=>{const url=new URL(route.request().url());if(url.hostname==='127.0.0.1'||url.protocol==='data:'||url.protocol==='blob:')return route.continue();blocked.push(url.origin);return route.abort();});
 context.on('request',request=>{const url=new URL(request.url());if(request.method()!=='GET'&&/\/functions\/v1\/scene-api\/projects(?:\/|$)/.test(url.pathname))cloudWrites.push(request.method());});
 const page=await context.newPage();page.on('download',item=>downloads.push(item));
 try{
  await page.goto(origin);const frame=page.frameLocator('iframe[title="幕景工作台"]');await frame.getByLabel('告诉 Agent 要改的').waitFor({timeout:60000});
  const child=page.frames().find(item=>item!==page.mainFrame()&&item.url().startsWith('http://127.0.0.1:'));if(!child)throw Error('没有找到独立工作台。');
  const stored=()=>child.evaluate(()=>{const raw=localStorage.getItem('scendance-editor-local-v1');return raw?JSON.parse(raw):null;});
  const items=layout=>layout.floors.flatMap(floor=>floor.items);
  await page.waitForTimeout(8000);
  await frame.getByLabel('告诉 Agent 要改的').fill('把场地改成20×20米');await frame.getByRole('button',{name:'发送',exact:true}).click();
  await frame.getByText('场地改成 20 × 20 m。').waitFor({timeout:15000});
  await frame.getByRole('button',{name:'账户中心'}).click();await frame.getByLabel('邮箱').fill('owner@scendance.test');await frame.getByLabel('密码').fill('local-integration-only');await frame.getByRole('button',{name:'登录并进入工作台'}).click();await frame.getByText('已登录。').waitFor({timeout:10000});
  await frame.getByText(/仅本机 · 未存为云端方案/).waitFor({timeout:10000});await frame.getByRole('button',{name:'关闭账户面板'}).click();
  await child.waitForFunction(()=>{try{const v=JSON.parse(localStorage.getItem('scendance-editor-local-v1')||'null');return v&&v.width===20&&v.height===20;}catch{return false;}},null,{timeout:15000});
  const before=await stored(),beforeItems=items(before),beforeIds=new Set(beforeItems.map(item=>item.id));
  await frame.getByLabel('告诉 Agent 要改的').fill('30人，按一人一套课桌椅生成本地草案');await frame.getByRole('button',{name:'发送',exact:true}).click();
  await frame.getByText(/本机草案：本次排了 30 \/ 30 套/).waitFor({timeout:20000});assert.deepEqual(await stored(),before);
  await frame.getByRole('button',{name:'确认布置'}).click();await child.waitForFunction(count=>{try{const v=JSON.parse(localStorage.getItem('scendance-editor-local-v1')||'null');return v?.floors.flatMap(f=>f.items).length===count;}catch{return false;}},beforeItems.length+60,{timeout:20000});
  const after=await stored(),added=items(after).filter(item=>!beforeIds.has(item.id));assert.equal(added.length,60);assert.equal(new Set(added.map(item=>item.id)).size,60);
  await frame.getByRole('button',{name:'导出与交接',exact:true}).click();await frame.getByText('内部资料',{exact:true}).click();await frame.getByRole('tab',{name:'导出',exact:true}).click();
  const event=page.waitForEvent('download',{timeout:15000});await frame.getByRole('button',{name:'导出可校验本机草案',exact:true}).click();
  const text=await fs.readFile(await(await event).path(),'utf8'),envelope=JSON.parse(text);
  assert.equal(envelope.algorithm,'SHA-256');assert.equal(envelope.canonicalization,'utf8-payload-v1');
  assert.equal(createHash('sha256').update(envelope.payload,'utf8').digest('hex'),envelope.digest);
  const payload=JSON.parse(envelope.payload);assert.equal(payload.state,'draft_unverified');assert.equal(items(payload.layout).filter(item=>!beforeIds.has(item.id)).length,60);assert.ok(payload.checks.every(item=>item.status==='unknown'));
  const input=frame.getByLabel('校验可校验草案文件');
  await input.setInputFiles({name:'草案.json',mimeType:'application/json',buffer:Buffer.from(text)});
  await frame.getByText(/文件内容与所附摘要一致/).waitFor({timeout:10000});
  const changed=JSON.stringify({...envelope,payload:envelope.payload.replace('课桌（示意）','改动物料')});
  assert.notEqual(changed,text);await input.setInputFiles({name:'已改草案.json',mimeType:'application/json',buffer:Buffer.from(changed)});
  await frame.getByText(/文件格式不符或内容与摘要不一致/).waitFor({timeout:10000});
  // Force a delayed digest, then exercise actual undo/redo before it resolves.
  await child.evaluate(()=>{const subtle=crypto.subtle,original=subtle.digest.bind(subtle);Object.defineProperty(subtle,'digest',{configurable:true,value:(...args)=>{window.__integrityDigestStarted=true;return new Promise((resolve,reject)=>setTimeout(()=>original(...args).then(resolve,reject),4000));}});});
  const priorDownloads=downloads.length;await frame.getByRole('button',{name:'导出可校验本机草案',exact:true}).click();
  await child.waitForFunction(()=>window.__integrityDigestStarted===true,null,{timeout:10000});
  const undo=frame.getByRole('button',{name:'撤销',exact:true}),redo=frame.getByRole('button',{name:'重做',exact:true});
  if(!await undo.isEnabled())throw Error('摘要期间撤销不可用，未能验证状态变化保护。');
  await undo.click();await redo.waitFor({state:'visible',timeout:10000});await redo.click();await page.waitForTimeout(5000);
  assert.equal(downloads.length,priorDownloads,'摘要期间场景先变再恢复，不得下载旧快照。');
  assert.deepEqual(cloudWrites,[]);assert.deepEqual(blocked,[]);
  console.log(JSON.stringify({status:'passed',mode:'synthetic',added:60,checksumVerified:true,tamperRejected:true,abaNoDownload:true,cloudWrites:0,externalRequests:0}));
 }finally{try{await page.getByRole('button',{name:'结束试用'}).click({timeout:3000});}catch{}await context.close();await browser.close();}
}
main().catch(error=>{console.error('LOCAL_DRAFT_INTEGRITY_FAILED',error.message);process.exitCode=1;});
