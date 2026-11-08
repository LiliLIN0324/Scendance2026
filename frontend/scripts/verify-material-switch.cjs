// Synthetic local workbench. Delay a shipped GLB request to exercise a real floor switch.
const assert=require('node:assert/strict');const {chromium}=require('playwright');
const port=Number(process.argv[2]);if(!Number.isSafeInteger(port)||port<1024||port>65535||[4186,4196,4197,4198,4213,4215].includes(port))throw Error('请选择隔离模拟端口。');
const origin=`http://127.0.0.1:${port}`,asset='/showcase/assets/library/model/beach-surf-and-paddle-kit-folding-beach-chair-68794f97.glb';
async function main(){
 const state=await(await fetch(`${origin}/status`)).json();if(state.mode!=='synthetic'||state.used!==0)throw Error('需要全新的模拟试用。');
 const browser=await chromium.launch({headless:true,channel:'msedge'}),context=await browser.newContext(),external=[],writes=[];
 let release,signal,intercepted=false;const gate=new Promise(resolve=>{release=resolve;}),started=new Promise(resolve=>{signal=resolve;});
 await context.route('**/*',async route=>{const url=new URL(route.request().url());if(url.hostname!=='127.0.0.1'&&url.protocol!=='data:'&&url.protocol!=='blob:'){external.push(url.origin);return route.abort();}if(url.pathname===asset&&!intercepted){intercepted=true;signal();await gate;}return route.continue();});
 context.on('request',request=>{const url=new URL(request.url());if(request.method()!=='GET'&&/\/functions\/v1\/scene-api\/projects(?:\/|$)/.test(url.pathname))writes.push(request.method());});
 const page=await context.newPage();let frame,child;
 try{
  await page.goto(origin);frame=page.frameLocator('iframe[title="幕景工作台"]');await frame.getByLabel('告诉 Agent 要改的').waitFor({timeout:60000});
  child=page.frames().find(value=>value!==page.mainFrame()&&value.url().startsWith('http://127.0.0.1:'));if(!child)throw Error('未找到隔离工作台。');
  const stored=()=>child.evaluate(()=>{const raw=localStorage.getItem('scendance-editor-local-v1');return raw?JSON.parse(raw):null;});
  await page.waitForTimeout(7000);const before=await stored();assert.ok(before);const beforeIds=new Set(before.floors.flatMap(f=>f.items.map(i=>i.id)));
  await frame.getByRole('button',{name:'物料',exact:true}).click();await frame.getByRole('button',{name:'添加沙滩折叠椅',exact:true}).click();
  await Promise.race([started,new Promise((_,reject)=>setTimeout(()=>reject(Error('未观察到模型请求。')),15000))]);
  await frame.getByRole('button',{name:'新建并切换到第 2 层'}).click();await frame.getByRole('button',{name:'切换到第 1 层'}).click();release();
  await frame.getByText(/场景、楼层或登录状态已变化|场景已变化|剩余物料未添加/).first().waitFor({timeout:15000});
  await page.waitForTimeout(1200);const after=await stored(),newItems=after.floors.flatMap(f=>f.items).filter(i=>!beforeIds.has(i.id));
  assert.equal(newItems.length,0,'楼层 A→B→A 后旧请求不应放入任何物料。');assert.deepEqual(external,[]);assert.deepEqual(writes,[]);
  console.log(JSON.stringify({status:'passed',mode:'synthetic',floorABA:true,delayedAsset:true,newItems:0,cloudWrites:0,externalRequests:0,modelRequests:(await(await fetch(`${origin}/status`)).json()).used}));
 }catch(error){if(frame)try{console.error('VISIBLE',(await frame.locator('body').innerText()).slice(-2000));}catch{}throw error;}
 finally{release();await context.close();await browser.close();}
}
main().catch(error=>{console.error('MATERIAL_SWITCH_FAILED',error.message);process.exitCode=1;});
