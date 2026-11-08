// Synthetic workbench only. Uses shipped local GLBs, never a real provider or user project.
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const port=Number(process.argv[2]);
if(!Number.isSafeInteger(port)||port<1024||port>65535||[4186,4196,4197,4198,4213,4215].includes(port))throw Error('请选择隔离模拟端口。');
const origin=`http://127.0.0.1:${port}`;
const itemList=layout=>layout.floors.flatMap(floor=>floor.items);
function overlap(a,b){
 const corners=item=>{const angle=item.rotation||0,c=Math.cos(angle),s=Math.sin(angle);return [[-1,-1],[-1,1],[1,1],[1,-1]].map(([x,z])=>({x:item.position.x+x*item.width/2*c-z*item.depth/2*s,z:item.position.z+x*item.width/2*s+z*item.depth/2*c}));};
 const p=corners(a),q=corners(b);
 return [p,q].every(poly=>poly.every((point,i)=>{const next=poly[(i+1)%poly.length],axis={x:-(next.z-point.z),z:next.x-point.x};const project=points=>points.map(v=>v.x*axis.x+v.z*axis.z);const x=project(p),y=project(q);return Math.min(Math.max(...x),Math.max(...y))-Math.max(Math.min(...x),Math.min(...y))>1e-7;}));
}
async function main(){
 const status=await(await fetch(`${origin}/status`)).json();if(status.mode!=='synthetic'||status.used!==0)throw Error('需要全新的模拟试用。');
 const browser=await chromium.launch({headless:true,channel:'msedge'}),context=await browser.newContext(),external=[],writes=[];
 await context.route('**/*',route=>{const url=new URL(route.request().url());if(url.hostname==='127.0.0.1'||url.protocol==='data:'||url.protocol==='blob:')return route.continue();external.push(url.origin);return route.abort();});
 context.on('request',request=>{const url=new URL(request.url());if(request.method()!=='GET'&&/\/functions\/v1\/scene-api\/projects(?:\/|$)/.test(url.pathname))writes.push(request.method());});
 const page=await context.newPage();let frame,child;
 try{
  await page.goto(origin);frame=page.frameLocator('iframe[title="幕景工作台"]');await frame.getByLabel('告诉 Agent 要改的').waitFor({timeout:60000});
  child=page.frames().find(value=>value!==page.mainFrame()&&value.url().startsWith('http://127.0.0.1:'));if(!child)throw Error('未找到隔离工作台。');
  const stored=()=>child.evaluate(()=>{const raw=localStorage.getItem('scendance-editor-local-v1');return raw?JSON.parse(raw):null;});
  await page.waitForTimeout(7000);const before=await stored();if(!before)throw Error('本机初始场景未保存。');
  const baseline=itemList(before),beforeIds=new Set(baseline.map(item=>item.id));
  await frame.getByRole('button',{name:'物料',exact:true}).click();
  // After the first success the same item also appears in “最近用过”.
  const tile=frame.getByRole('button',{name:'添加沙滩折叠椅',exact:true}).last();await tile.waitFor({timeout:30000});
  await tile.click();
  await child.waitForFunction(count=>{try{return JSON.parse(localStorage.getItem('scendance-editor-local-v1')||'null')?.floors.flatMap(f=>f.items).length===count;}catch{return false;}},baseline.length+1,{timeout:45000});
  const first=itemList(await stored()).find(item=>!beforeIds.has(item.id));assert.ok(first?.position,'第一件模型尚未保存位置。');
  assert.ok(Math.abs(first.position.x)<1e-7&&Math.abs(first.position.z)<1e-7,'第一件模型未占据场地中心，无法验证中心被占情形。');
  await tile.click();await tile.click();
  await child.waitForFunction(count=>{try{const value=JSON.parse(localStorage.getItem('scendance-editor-local-v1')||'null');return value?.floors.flatMap(floor=>floor.items).length>=count;}catch{return false;}},baseline.length+3,{timeout:45000});
  const after=await stored(),added=itemList(after).filter(item=>!beforeIds.has(item.id));assert.equal(added.length,3);assert.equal(new Set(added.map(item=>item.id)).size,3);
  for(let i=0;i<added.length;i++)for(let j=i+1;j<added.length;j++)assert.ok(!overlap(added[i],added[j]),'新增模型的旋转包围占地不可重叠。');
  await frame.getByRole('button',{name:'撤销',exact:true}).click();await child.waitForFunction(count=>{try{return JSON.parse(localStorage.getItem('scendance-editor-local-v1')||'null')?.floors.flatMap(f=>f.items).length===count;}catch{return false;}},baseline.length+2,{timeout:15000});
  await frame.getByRole('button',{name:'撤销',exact:true}).click();await child.waitForFunction(count=>{try{return JSON.parse(localStorage.getItem('scendance-editor-local-v1')||'null')?.floors.flatMap(f=>f.items).length===count;}catch{return false;}},baseline.length+1,{timeout:15000});
  await frame.getByRole('button',{name:'撤销',exact:true}).click();await child.waitForFunction(count=>{try{return JSON.parse(localStorage.getItem('scendance-editor-local-v1')||'null')?.floors.flatMap(f=>f.items).length===count;}catch{return false;}},baseline.length,{timeout:15000});
  assert.deepEqual(itemList(await stored()),baseline);assert.deepEqual(external,[]);assert.deepEqual(writes,[]);
  console.log(JSON.stringify({status:'passed',mode:'synthetic',material:'沙滩折叠椅',centerOccupiedBeforeRapidClicks:true,rapidAdds:2,added:3,distinctIds:true,modelFootprintsDisjoint:true,undoRestored:true,cloudWrites:0,externalRequests:0,modelRequests:(await(await fetch(`${origin}/status`)).json()).used}));
 }catch(error){if(frame)try{console.error('VISIBLE', (await frame.locator('body').innerText()).slice(-2200));}catch{}throw error;}
 finally{await context.close();await browser.close();}
}
main().catch(error=>{console.error('MATERIAL_SEQUENCE_FAILED',error.message);process.exitCode=1;});
