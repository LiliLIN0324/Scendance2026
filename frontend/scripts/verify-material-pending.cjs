// Synthetic workbench with packaged, project-owned catalogue assets only.
const assert=require('node:assert/strict');const {chromium}=require('playwright');
const port=Number(process.argv[2]);if(!Number.isSafeInteger(port)||port<1024||port>65535||[4186,4196,4197,4198,4213,4215].includes(port))throw Error('请选择隔离模拟端口。');
const origin=`http://127.0.0.1:${port}`;
async function main(){
 const state=await(await fetch(`${origin}/status`)).json();if(state.mode!=='synthetic'||state.used!==0)throw Error('需要全新的模拟试用。');
 const browser=await chromium.launch({headless:true,channel:'msedge'}),context=await browser.newContext(),external=[],writes=[];
 await context.route('**/*',route=>{const url=new URL(route.request().url());if(url.hostname==='127.0.0.1'||url.protocol==='data:'||url.protocol==='blob:')return route.continue();external.push(url.origin);return route.abort();});
 context.on('request',request=>{const url=new URL(request.url());if(request.method()!=='GET'&&/\/functions\/v1\/scene-api\/projects(?:\/|$)/.test(url.pathname))writes.push(request.method());});
 const page=await context.newPage();let frame,child;
 try{
  await page.goto(origin);frame=page.frameLocator('iframe[title="幕景工作台"]');await frame.getByLabel('告诉 Agent 要改的').waitFor({timeout:60000});
  child=page.frames().find(value=>value!==page.mainFrame()&&value.url().startsWith('http://127.0.0.1:'));if(!child)throw Error('未找到隔离工作台。');
  const stored=()=>child.evaluate(()=>{const raw=localStorage.getItem('scendance-editor-local-v1');return raw?JSON.parse(raw):null;});
  await page.waitForTimeout(7000);const before=await stored();assert.ok(before);
  await frame.getByRole('button',{name:'物料',exact:true}).click();await frame.getByRole('button',{name:'添加棒球场观众看台',exact:true}).last().click();
  await frame.getByText(/附近没有找到可用位置|待放置|点击场地.*位置/).first().waitFor({timeout:30000});
  const visible=await frame.locator('body').innerText();assert.doesNotMatch(visible,/整个场地已满|场地没有任何位置/);assert.deepEqual(await stored(),before);
  await frame.getByRole('button',{name:'添加沙滩折叠椅',exact:true}).last().click();
  await frame.getByText(/请先放置或取消当前待放置物料/).first().waitFor({timeout:30000});assert.deepEqual(await stored(),before);
  await frame.getByRole('button',{name:'2D / 3D'}).click();
  const canvas=frame.locator('canvas:visible').last(),rect=await canvas.boundingBox();assert.ok(rect&&rect.width>100&&rect.height>100,'未找到可操作的平面画布。');
  await canvas.click({position:{x:rect.width/2,y:rect.height/2}});
  await frame.getByText(/待放置：棒球场观众看台/).waitFor({timeout:5000});assert.deepEqual(await stored(),before,'无效的用户指定位置不能改变画布。');
  assert.deepEqual(external,[]);assert.deepEqual(writes,[]);
  console.log(JSON.stringify({status:'passed',mode:'synthetic',unplacedPreserved:true,secondDidNotOverwrite:true,explicitInvalidPositionStillPending:true,sceneUnchanged:true,cloudWrites:0,externalRequests:0,modelRequests:(await(await fetch(`${origin}/status`)).json()).used}));
 }catch(error){if(frame)try{console.error('VISIBLE',(await frame.locator('body').innerText()).slice(-2500));}catch{}throw error;}
 finally{await context.close();await browser.close();}
}
main().catch(error=>{console.error('MATERIAL_PENDING_FAILED',error.message);process.exitCode=1;});
