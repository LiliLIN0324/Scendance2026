// Isolated synthetic data only; browser traffic outside localhost is blocked.
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const port=Number(process.argv[2]);
if(!Number.isSafeInteger(port)||port<1024||port>65535||[4186,4196,4197,4198,4213,4215].includes(port))throw Error('请选择隔离模拟端口。');
const origin=`http://127.0.0.1:${port}`;
async function main(){
 const status=await(await fetch(`${origin}/status`)).json();assert.equal(status.mode,'synthetic');assert.equal(status.used,0);
 const browser=await chromium.launch({headless:true,channel:'msedge'}),context=await browser.newContext(),blocked=[],writes=[],candidates=[];let frame;
 await context.route('**/*',route=>{const url=new URL(route.request().url());if(url.hostname==='127.0.0.1'||url.protocol==='data:'||url.protocol==='blob:')return route.continue();blocked.push(url.origin);return route.abort();});
 context.on('request',req=>{if(req.method()!=='GET'&&/\/proposals\/apply$/.test(new URL(req.url()).pathname))writes.push('apply');});
 context.on('response',async response=>{if(!response.url().includes('/agent-runs'))return;try{const body=await response.json();for(const item of body.candidates??[]){const scene=item.proposal?.candidate;if(scene&&!candidates.some(c=>c.id===item.proposal.id))candidates.push({id:item.proposal.id,assets:scene.objects.map(o=>o.assetId).filter(Boolean)});}}catch{}});
 try{
  const page=await context.newPage();await page.goto(origin);frame=page.frameLocator('iframe[title="幕景工作台"]');await frame.getByLabel('告诉 Agent 要改的').waitFor({timeout:60000});
  await frame.getByRole('button',{name:'账户中心'}).click();await frame.getByLabel('邮箱').fill('owner@scendance.test');await frame.getByLabel('密码').fill('local-integration-only');await frame.getByRole('button',{name:'登录并进入工作台'}).click();await frame.getByText('已登录。').waitFor({timeout:10000});
  await frame.getByRole('button',{name:'新方案'}).click();await page.waitForTimeout(5000);if(!await frame.getByRole('button',{name:'关闭账户面板'}).count())await frame.getByRole('button',{name:'账户中心'}).click();
  await frame.getByRole('button',{name:/当前项目 .*双击进入/}).dblclick();await page.waitForTimeout(3000);
  const send=async text=>{await frame.getByLabel('告诉 Agent 要改的').fill(text);await frame.getByRole('button',{name:'发送',exact:true}).click();};
  await send('为30人办室内讲座，场地长10米宽8米，采用课桌椅布局，椅宽0.5米，生成方案');await frame.getByText(/以下信息还需核对/).waitFor({timeout:20000});await send('确认');
  await frame.getByRole('button',{name:'确认布置'}).waitFor({timeout:45000});const card=frame.locator('#plan-proposal');await card.getByText('核对这版物料数量',{exact:true}).click();
  const input=card.getByLabel(/椅凳 · 参数模型/);await input.fill('0');await card.getByText(/已填写的物料数量不足/).waitFor();assert.equal(await card.getByRole('button',{name:'确认布置'}).count(),0);
  assert.equal(candidates.length,1);assert.equal(candidates[0].assets.length,1);
  const waitCandidate=async count=>{await page.waitForFunction(n=>window.__inventoryCandidateCount>=n,count,{timeout:45000});};
  // Candidate changes are observed through actual run responses; no page data is invented.
  await page.exposeFunction('__recordInventoryCount',()=>candidates.length);
  await page.evaluate(()=>{window.__inventoryCandidateCount=0;setInterval(async()=>window.__inventoryCandidateCount=await window.__recordInventoryCount(),100);});
  await card.getByRole('button',{name:'换一版'}).click();await waitCandidate(2);await frame.getByText(/云端给了一版/).nth(1).waitFor({timeout:45000});
  await card.getByText('核对这版物料数量',{exact:true}).waitFor();await card.getByText('核对这版物料数量',{exact:true}).click();
  const same=card.getByLabel(/椅凳 · 参数模型/);await same.waitFor();
  assert.equal(candidates[0].assets[0],candidates[1].assets[0]);assert.notEqual(candidates[0].id,candidates[1].id);
  assert.equal(await same.inputValue(),'0');await card.getByText(/已填写的物料数量不足/).waitFor();assert.equal(await card.getByRole('button',{name:'确认布置'}).count(),0);
  await send('确认布置');await page.waitForTimeout(500);assert.deepEqual(writes,[]);
  await card.getByRole('button',{name:'换一版'}).click();await waitCandidate(3);await frame.getByText(/云端给了一版/).nth(2).waitFor({timeout:45000});
  await card.getByText('核对这版物料数量',{exact:true}).waitFor();await card.getByText('核对这版物料数量',{exact:true}).click();
  const different=card.getByLabel(/椅凳 · 参数模型/);await different.waitFor();
  assert.notEqual(candidates[1].assets[0],candidates[2].assets[0]);assert.equal(await different.inputValue(),'');assert.deepEqual(writes,[]);assert.deepEqual(blocked,[]);
  console.log(JSON.stringify({status:'passed',mode:'synthetic',sameAssetRetainsZero:true,differentAssetUnknown:true,distinctProposals:true,externalRequests:blocked.length,cloudApplyWrites:writes.length}));
 }catch(error){if(frame){try{console.error('VISIBLE',(await frame.locator('body').innerText()).slice(-3000));console.error('BUTTONS',JSON.stringify(await frame.locator('button:visible').evaluateAll(es=>es.map(e=>({label:e.getAttribute('aria-label'),title:e.getAttribute('title'),text:e.innerText})) )));}catch{}}throw error;}
 finally{await context.close();await browser.close();}
}
main().catch(error=>{console.error('INVENTORY_REMOUNT_FAILED',error.message);process.exitCode=1;});
