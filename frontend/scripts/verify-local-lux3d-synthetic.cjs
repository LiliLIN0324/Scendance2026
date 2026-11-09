// Disposable local fixture only. No real Aholo, MiniMax or user data.
const {randomUUID}=require('node:crypto');
const {chromium}=require('playwright');
const port=Number(process.argv[2]);
if(!Number.isSafeInteger(port)||port<1024||port>65535||[4186,4196,4197,4198,4213,4215,4246,4248,4249].includes(port))throw Error('需要独立模拟端口。');
const origin=`http://127.0.0.1:${port}`;
async function main(){
 let browser,context,page,apiOrigin='',token='',external=0;
 try{
  const status=await(await fetch(`${origin}/status`)).json();
  if(status.mode!=='synthetic'||status.lux3d!=='synthetic'||status.state!=='ready'||status.used!==0)throw Error('fixture_not_ready');
  browser=await chromium.launch({headless:true,channel:'msedge'});context=await browser.newContext();
  await context.route('**/*',route=>{const url=new URL(route.request().url());if(url.hostname==='127.0.0.1'||url.protocol==='data:'||url.protocol==='blob:')return route.continue();external++;return route.abort();});
  context.on('response',async response=>{const url=new URL(response.url());if(url.hostname==='127.0.0.1'&&url.pathname==='/auth/v1/token'&&response.status()===200){try{const body=await response.json();if(typeof body.access_token==='string'){apiOrigin=url.origin;token=body.access_token;}}catch{}}});
  page=await context.newPage();await page.goto(origin);const frame=page.frameLocator('iframe[title="幕景工作台"]');
  await frame.getByLabel('告诉 Agent 要改的').waitFor({timeout:60000});
  await frame.getByRole('button',{name:'账户中心'}).click();await frame.getByLabel('邮箱').fill('owner@scendance.test');await frame.getByLabel('密码').fill('local-integration-only');await frame.getByRole('button',{name:'登录并进入工作台'}).click();
  for(let i=0;i<40&&!token;i++)await page.waitForTimeout(250);
  if(!token||!apiOrigin)throw Error('fixture_login_failed');
  const headers={authorization:`Bearer ${token}`,apikey:'sb_publishable_local_integration_only'};
  const capabilities=await context.request.get(`${apiOrigin}/functions/v1/scene-api/generation/capabilities`,{headers});
  if(capabilities.status()!==200||!capabilities.headers()['x-scendance-test-fixture']?.includes('PGlite')||!(await capabilities.json()).aholoTextToModel)throw Error('fixture_not_enabled');
  const response=await context.request.post(`${apiOrigin}/functions/v1/scene-api/jobs`,{headers,data:{requestId:randomUUID(),prompt:'虚构木讲台',kind:'text',provider:'aholo'}});
  if(response.status()!==202||!response.headers()['x-scendance-test-fixture']?.includes('PGlite'))throw Error('fixture_job_failed');
  const job=await response.json();if(typeof job.id!=='string')throw Error('fixture_job_invalid');
  let ready=null;const deadline=Date.now()+85000;
  while(Date.now()<deadline){const poll=await context.request.get(`${apiOrigin}/functions/v1/scene-api/jobs/${job.id}`,{headers});if(poll.status()!==200)throw Error('fixture_poll_failed');const value=await poll.json();if(value.state==='ready'){ready=value;break;}if(['failed','rejected','submit_unknown'].includes(value.state))throw Error('fixture_job_failed');await page.waitForTimeout(1000);}
  if(!ready||typeof ready.asset_id!=='string')throw Error('fixture_timeout');
  const signed=await context.request.post(`${apiOrigin}/functions/v1/scene-api/assets/${ready.asset_id}/url`,{headers});if(signed.status()!==200)throw Error('fixture_asset_failed');
  const asset=await signed.json();if(typeof asset.url!=='string'||!asset.url.startsWith(apiOrigin+'/test-storage/'))throw Error('fixture_asset_failed');
  const data=await context.request.get(asset.url);const bytes=await data.body();if(bytes.subarray(0,4).toString('ascii')!=='glTF')throw Error('fixture_asset_failed');
  const final=await(await fetch(`${origin}/status`)).json();if(final.used!==0||external!==0)throw Error('unexpected_external');
  console.log(JSON.stringify({status:'passed',mode:'synthetic',job:'ready',asset:'local-glb',modelCalls:final.used,externalRequests:external}));
 }finally{if(page)try{await page.getByRole('button',{name:'结束试用'}).click({timeout:3000});}catch{}await context?.close();await browser?.close();}
}
main().catch(()=>{console.error('SYNTHETIC_LUX3D_VERIFICATION_FAILED');process.exitCode=1;});
