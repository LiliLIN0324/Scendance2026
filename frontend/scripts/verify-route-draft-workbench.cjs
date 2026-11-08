// Exercises hand-drawn routes through the visible UI only; no saved user data or live model.
const assert=require('node:assert/strict');const fs=require('node:fs/promises');const path=require('node:path');const os=require('node:os');const {chromium}=require('playwright');
const port=Number(process.argv[2]),which=process.argv[3];
if(!Number.isSafeInteger(port)||port<1024||port>65535||[4186,4196,4197,4198,4213,4215].includes(port)||!['cross','clear','mutate'].includes(which))throw Error('请选择隔离模拟端口及 cross、clear 或 mutate。');
const origin=`http://127.0.0.1:${port}`;
async function main(){
 const status=await(await fetch(`${origin}/status`)).json();if(status.mode!=='synthetic'||status.used!==0)throw Error('需要全新的模拟试用。');
 const browser=await chromium.launch({headless:true,channel:'msedge'}),context=await browser.newContext(),blocked=[],cloudWrites=[];
 await context.route('**/*',route=>{const url=new URL(route.request().url());if(url.hostname==='127.0.0.1'||url.protocol==='data:'||url.protocol==='blob:')return route.continue();blocked.push(url.origin);return route.abort();});
 context.on('request',request=>{const url=new URL(request.url());if(request.method()!=='GET'&&/\/functions\/v1\/scene-api\/projects(?:\/|$)/.test(url.pathname))cloudWrites.push(request.method());});
 let page,frame,child;
 try{
  page=await context.newPage();await page.goto(origin);frame=page.frameLocator('iframe[title="幕景工作台"]');await frame.getByLabel('告诉 Agent 要改的').waitFor({timeout:60000});
  child=page.frames().find(item=>item!==page.mainFrame()&&item.url().startsWith('http://127.0.0.1:'));if(!child)throw Error('没有找到独立工作台。');
  const stored=()=>child.evaluate(()=>{const raw=localStorage.getItem('scendance-editor-local-v1');return raw?JSON.parse(raw):null;});
  const send=async text=>{await frame.getByLabel('告诉 Agent 要改的').fill(text);await frame.getByRole('button',{name:'发送',exact:true}).click();};
  await page.waitForTimeout(8000);await send('把场地改成20×20米');await frame.getByText('场地改成 20 × 20 m。').waitFor({timeout:15000});
  await frame.getByRole('button',{name:'账户中心'}).click();await frame.getByLabel('邮箱').fill('owner@scendance.test');await frame.getByLabel('密码').fill('local-integration-only');await frame.getByRole('button',{name:'登录并进入工作台'}).click();await frame.getByText('已登录。').waitFor({timeout:10000});await frame.getByText(/仅本机 · 未存为云端方案/).waitFor({timeout:10000});await frame.getByRole('button',{name:'关闭账户面板'}).click();
  await child.waitForFunction(()=>{try{const v=JSON.parse(localStorage.getItem('scendance-editor-local-v1')||'null');return v&&v.width===20&&v.height===20;}catch{return false;}},null,{timeout:15000});const before=await stored();
  async function drawRoute(points){
   const existing=await frame.locator('svg[aria-label="规划标注层"] polyline').count();
   await frame.getByRole('button',{name:'规划活动区域'}).click();await frame.getByRole('button',{name:'画路线',exact:true}).click();
   const canvas=frame.locator('canvas:visible').first();await canvas.waitFor();const box=await canvas.boundingBox();assert.ok(box&&box.width>160&&box.height>160,'平面画布尺寸不足');
   const scale=Math.min((box.width-120)/20,(box.height-120)/20),offsetX=(box.width-20*scale)/2,offsetY=(box.height-20*scale)/2;const iframe=await page.locator('iframe[title="幕景工作台"]').boundingBox();
   for(const [x,z] of points){const px=box.x+offsetX+(x+10)*scale,py=box.y+offsetY+(z+10)*scale;const hit=await child.evaluate(({x,y})=>{const e=document.elementFromPoint(x,y);const b=e?.getBoundingClientRect();return e?{tag:e.tagName,cls:e.className?.baseVal??e.className,text:e.textContent?.slice(0,80),rect:b&&{x:b.x,y:b.y,width:b.width,height:b.height}}:null;},{x:px-iframe.x,y:py-iframe.y});await page.mouse.click(px,py);await page.waitForTimeout(300);console.error('DRAW_STEP',JSON.stringify({x,z,box,px,py,hit,guide:await frame.getByText(/至少选择两点/).count(),lines:await frame.locator('svg[aria-label="规划标注层"] polyline').count()}));}
   await page.keyboard.press('Enter');await frame.locator('svg[aria-label="规划标注层"] polyline').nth(existing).waitFor({state:'attached',timeout:10000});await frame.getByText('宾客动线',{exact:true}).first().waitFor({timeout:10000});
   return existing+1;
  }
  let mutationOutcome=null;const route=which==='cross'?[[-9.4,-8.5],[-9.4,-7]]:[[-4,3],[4,3]];
  await drawRoute(route);
  await send('30人，按一人一套课桌椅生成本地草案');
  if(which==='cross'){
   await frame.getByText(/路线中心线与 .*模型包围占地新增或加重相交/).first().waitFor({timeout:20000});assert.equal(await frame.getByRole('button',{name:'确认布置'}).count(),0);assert.deepEqual(await stored(),before);
  }else{
   await frame.getByText(/本机草案：本次排了 30 \/ 30 套/).waitFor({timeout:20000});const card=frame.locator('#plan-proposal');
   assert.match(await card.innerText(),/仅核对手绘路线中心线与数字模型包围占地/);assert.match(await card.innerText(),/路线净宽、门、疏散、消防、无障碍和现场条件仍需核验/);assert.deepEqual(await stored(),before);
   if(which==='mutate'){
    await drawRoute([[-5,4],[5,4]]);
    const confirm=frame.getByRole('button',{name:'确认布置',exact:true});if(await confirm.count()&&await confirm.isVisible())await confirm.click();
    await page.waitForTimeout(1200);assert.deepEqual(await stored(),before,'路线修改后旧候选不能应用');
    const present=await frame.getByRole('button',{name:'确认布置',exact:true}).count();const text=await frame.locator('body').innerText();const notice=/路线、区域或门标注已变化|路线.*已变化|预览.*失效/.test(text);assert.ok(!present||notice,'应撤销旧确认或说明路线已变化');mutationOutcome={confirmStillPresent:!!present,changeNotice:notice};
   }
  }
  assert.deepEqual(cloudWrites,[]);assert.deepEqual(blocked,[]);const final=await(await fetch(`${origin}/status`)).json();console.log(JSON.stringify({status:'passed',mode:'synthetic',scenario:which,routeDrawnViaUI:true,sceneUnchanged:true,mutationOutcome,cloudWrites:0,externalRequests:0,modelRequests:final.used}));
 }catch(error){if(frame)try{console.error('VISIBLE_WORKBENCH',(await frame.locator('body').innerText()).slice(-3500));}catch{}if(page)try{const file=path.join(os.tmpdir(),`scendance-route-${port}-${which}.png`);await page.screenshot({path:file});console.error('SCREENSHOT',file);}catch{}throw error;}
 finally{await context.close();await browser.close();}
}
main().catch(error=>{console.error('ROUTE_DRAFT_CHECK_FAILED',error.message);process.exitCode=1;});
