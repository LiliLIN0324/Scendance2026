// Synthetic-only, isolated activity switching; no model calls or user data.
const {chromium}=require('playwright');
const port=Number(process.argv[2]);
if(!Number.isSafeInteger(port)||port<1024||port>65535||[4213,4215,4246,4248,4249,4250,4252,4254,4255,4256].includes(port))throw Error('请选择独立模拟端口');
const origin=`http://127.0.0.1:${port}`;
async function main(){
 let browser,context,page,phase='preflight',external=0,apiOrigin='',projectId='',authorization='';
 try{
  const initial=await(await fetch(origin+'/status')).json();if(initial.mode!=='synthetic'||initial.state!=='ready'||initial.used!==0)throw Error('not_synthetic');
  browser=await chromium.launch({headless:true,channel:'msedge'});context=await browser.newContext();
  await context.route('**/*',route=>{const url=new URL(route.request().url());if(url.hostname==='127.0.0.1'||url.protocol==='data:'||url.protocol==='blob:')return route.continue();external++;return route.abort();});
  context.on('request',request=>{const u=new URL(request.url()),match=u.pathname.match(/^\/functions\/v1\/scene-api\/projects\/([^/]+)\/lease\/acquire$/);if(match){apiOrigin=u.origin;projectId=match[1];authorization=request.headers().authorization||'';}});
  page=await context.newPage();page.setDefaultTimeout(12000);
  await page.addInitScript(()=>{
   const original=HTMLCanvasElement.prototype.getContext,contexts=new WeakMap(),ids=new WeakMap(),nodes=new Map(),listeners=new WeakMap(),observers=new Map();let seq=0;
   HTMLCanvasElement.prototype.getContext=function(type,...args){const result=original.call(this,type,...args);if((type==='webgl'||type==='webgl2')&&result)contexts.set(this,result);return result;};
   const add=EventTarget.prototype.addEventListener,remove=EventTarget.prototype.removeEventListener;
   EventTarget.prototype.addEventListener=function(type,fn,options){if(this instanceof HTMLCanvasElement){let map=listeners.get(this);if(!map)listeners.set(this,map=new Map());let set=map.get(type);if(!set)map.set(type,set=new Set());set.add(fn);}return add.call(this,type,fn,options);};
   EventTarget.prototype.removeEventListener=function(type,fn,options){if(this instanceof HTMLCanvasElement)listeners.get(this)?.get(type)?.delete(fn);return remove.call(this,type,fn,options);};
   const Native=window.ResizeObserver;window.ResizeObserver=class extends Native{constructor(fn){super(fn);observers.set(this,new Set());}observe(target,options){observers.get(this).add(target);return super.observe(target,options);}unobserve(target){observers.get(this).delete(target);return super.unobserve(target);}disconnect(){observers.get(this).clear();return super.disconnect();}};
   window.__canvasAudit=element=>{if(!element)return null;let id=ids.get(element);if(!id){id=++seq;ids.set(element,id);nodes.set(id,element);}const gl=contexts.get(element);return {id,connected:element.isConnected,webgl:!!gl,lost:gl?gl.isContextLost():null,pointerDown:listeners.get(element)?.get('pointerdown')?.size??0,observers:[...observers.values()].filter(set=>set.has(element)).length,width:element.width,height:element.height};};
   window.__oldCanvasAudit=id=>window.__canvasAudit(nodes.get(id));
  });
  phase='open';await page.goto(origin);const frame=page.frameLocator('iframe[title="幕景工作台"]');
  await frame.getByLabel('告诉 Agent 要改的').waitFor({timeout:60000});
  phase='login';await frame.getByRole('button',{name:'账户中心'}).click();await frame.getByLabel('邮箱').fill('owner@scendance.test');await frame.getByLabel('密码').fill('local-integration-only');await frame.getByRole('button',{name:'登录并进入工作台'}).click();await frame.getByText('已登录。').waitFor();
  phase='create_a';await frame.getByRole('button',{name:'新方案'}).click();await page.waitForTimeout(5000);if(!await frame.getByRole('button',{name:'关闭账户面板'}).count())await frame.getByRole('button',{name:'账户中心'}).click();
  const acquired=page.waitForResponse(response=>response.request().method()==='POST'&&/\/lease\/acquire$/.test(new URL(response.url()).pathname),{timeout:20000});
  await frame.getByRole('button',{name:/当前项目 .*双击进入/}).dblclick();const lease=await acquired;if(lease.status()!==200||!lease.headers()['x-scendance-test-fixture']?.includes('PGlite')||!authorization)throw Error('fixture_invalid');
  const headers={authorization,apikey:'sb_publishable_local_integration_only'};
  const projectResponse=await context.request.get(`${apiOrigin}/functions/v1/scene-api/projects/${projectId}`,{headers});if(projectResponse.status()!==200||!projectResponse.headers()['x-scendance-test-fixture']?.includes('PGlite'))throw Error('fixture_invalid');
  const first=await projectResponse.json(),scene=structuredClone(first.scene);if(!first.studio_id||!first.name||!scene?.venue)throw Error('fixture_invalid');
  scene.venue.width=14;
  phase='create_b';const create=await context.request.post(`${apiOrigin}/functions/v1/scene-api/projects`,{headers,data:{studioId:first.studio_id,name:'CanvasSwitchFixtureB',scene}});
  if(create.status()!==201||!create.headers()['x-scendance-test-fixture']?.includes('PGlite'))throw Error('fixture_create_failed');
  const audit=()=>frame.locator('#sc-viewport-3d').evaluate(el=>({three:window.__canvasAudit(el),two:window.__canvasAudit(el.previousElementSibling)}));
  const waitFor=async predicate=>{for(let i=0;i<80;i++){const result=await audit();if(predicate(result))return result;await page.waitForTimeout(250);}throw Error('canvas_binding_timeout');};
  async function selectChair(target){
   const chair=target.objects.find(object=>object.materialId==='chair'&&!object.locked);if(!chair)throw Error('fixture_invalid');
   const canvas=frame.locator('canvas:has(+ #sc-viewport-3d)'),size=await canvas.evaluate(el=>({width:el.clientWidth,height:el.clientHeight}));
   const scale=Math.min((size.width-120)/target.venue.width,(size.height-120)/target.venue.depth);
   // Backend objects use a venue-corner origin; editor conversion subtracts
   // half the venue, so the 2D rendered coordinate is the backend coordinate.
   const x=chair.position.x*scale+(size.width-target.venue.width*scale)/2;
   const y=chair.position.z*scale+(size.height-target.venue.depth*scale)/2;
   const tip=frame.getByRole('button',{name:'知道了',exact:true});if(await tip.isVisible().catch(()=>false))await tip.click();
   await canvas.dblclick({position:{x,y}});await frame.locator('aside.sc-properties').waitFor({state:'visible',timeout:5000});
   await frame.getByRole('button',{name:'关闭物料属性',exact:true}).click();
  }
  phase='a_3d';const a3=await waitFor(value=>value.three.webgl&&!value.three.lost&&value.three.width>300);
  phase='a_2d';await frame.getByRole('button',{name:'2D / 3D'}).click();const a=await waitFor(value=>value.two.pointerDown>0&&value.two.observers>0);
  async function openAccount(){const close=frame.getByRole('button',{name:'关闭账户面板'});if(!await close.isVisible().catch(()=>false))await frame.getByRole('button',{name:'账户中心'}).click();}
  phase='open_b_account';await openAccount();phase='open_b_refresh';await frame.getByRole('button',{name:'刷新',exact:true}).click();phase='open_b_project';
  const projects=await context.request.get(`${apiOrigin}/functions/v1/scene-api/projects`,{headers});const projectList=await projects.json();
  await page.waitForTimeout(2000);
  console.log(JSON.stringify({fixtureBListedByApi:Array.isArray(projectList)&&projectList.some(item=>item.name==='CanvasSwitchFixtureB'),accountVisible:await frame.getByRole('button',{name:'关闭账户面板'}).isVisible().catch(()=>false)}));
  console.log(JSON.stringify({projectButtons:await frame.locator('button[aria-label$="双击进入"]').evaluateAll(nodes=>nodes.map(node=>({fixtureB:node.getAttribute('aria-label')?.includes('CanvasSwitchFixtureB')??false,disabled:node.disabled,visible:!!node.getClientRects().length})))}));
  phase='release_a';await frame.getByLabel(`${first.name} 更多操作`,{exact:true}).click();await frame.getByRole('button',{name:'释放编辑权',exact:true}).click();
  await frame.getByRole('button',{name:'打开 CanvasSwitchFixtureB，双击进入',exact:true}).waitFor({state:'visible'});
  phase='open_b_project';
  const bLease=page.waitForResponse(response=>response.request().method()==='POST'&&/\/lease\/acquire$/.test(new URL(response.url()).pathname),{timeout:20000});
  await frame.getByRole('button',{name:'打开 CanvasSwitchFixtureB，双击进入',exact:true}).dblclick();
  if((await bLease).status()!==200)throw Error('fixture_invalid');
  await frame.getByRole('button',{name:'关闭账户面板'}).waitFor({state:'hidden',timeout:10000});
  phase='b_2d';const b=await waitFor(value=>value.two.id!==a.two.id&&value.two.pointerDown>0&&value.two.observers>0);
  const oldA=await frame.locator('#sc-viewport-3d').evaluate((el,id)=>window.__oldCanvasAudit(id),a.two.id);
  phase='b_2d_click';await selectChair(scene);
  phase='open_a_account';await openAccount();phase='release_b';await frame.getByLabel('CanvasSwitchFixtureB 更多操作',{exact:true}).click();await frame.getByRole('button',{name:'释放编辑权',exact:true}).click();phase='open_a_refresh';await frame.getByRole('button',{name:'刷新',exact:true}).click();phase='open_a_project';await frame.getByRole('button',{name:`打开 ${first.name}，双击进入`,exact:true}).dblclick();
  phase='a_again_2d';const a2=await waitFor(value=>value.two.id!==b.two.id&&value.two.pointerDown>0&&value.two.observers>0);
  const oldB=await frame.locator('#sc-viewport-3d').evaluate((el,id)=>window.__oldCanvasAudit(id),b.two.id);
  if(oldA.connected||oldA.pointerDown||oldA.observers||oldB.connected||oldB.pointerDown||oldB.observers)throw Error('old_2d_not_detached');
  phase='a_again_2d_click';await selectChair(first.scene);
  phase='a_again_3d';await frame.getByRole('button',{name:'2D / 3D'}).click();const final=await waitFor(value=>value.three.webgl&&!value.three.lost&&value.three.width>300);
  if(final.three.id===a3.three.id||external!==0)throw Error('canvas_invalid');
  console.log(JSON.stringify({status:'passed',a3d:true,b2dBound:true,b2dClick:true,aAgain2dBound:true,aAgain2dClick:true,old2dDetached:true,aAgain3d:true,externalRequests:external}));
 }catch(error){let screenshot;try{if(page&&phase.endsWith('_2d_click')){screenshot=require('node:path').join(require('node:os').tmpdir(),`scendance-canvas-switch-${process.pid}.png`);await page.screenshot({path:screenshot});}}catch{/* No screenshot is not a pass. */}console.log(JSON.stringify({status:'incomplete',phase,reason:error?.name==='TimeoutError'?'timeout':error?.message?.match(/^(?:not_synthetic|fixture_invalid|fixture_create_failed|canvas_binding_timeout|old_2d_not_detached|canvas_invalid)$/)?.[0]??'interaction_error',externalRequests:external,...(screenshot?{screenshot}:{})}));process.exitCode=1;}
 finally{await context?.close();await browser?.close();}
}
void main();
