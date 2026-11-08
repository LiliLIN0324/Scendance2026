const {test}=require('node:test');
const assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const path=require('node:path');
const {runSmoke,permittedAsset}=require('./local-lux3d-smoke.cjs');

test('synthetic complete flow makes no network requests',async()=>{
 const original=global.fetch;let external=0;global.fetch=async()=>{external++;throw Error('unexpected network');};
 try{const result=await runSmoke({mode:'synthetic',key:'synthetic-fixture',wait:async()=>{},pollMs:0});
  assert.equal(result.status,'ready');assert.equal(result.createAttempts,1);assert.equal(result.polls,1);assert.match(result.sha256,/^[a-f0-9]{64}$/);assert.equal(external,0);
 }finally{global.fetch=original;}
});
test('does not retry an ambiguous create or reveal transport errors and credentials',async()=>{
 const fake='FAKE_SENSITIVE_KEY_579';let calls=0;
 const result=await runSmoke({mode:'live',key:fake,transport:async()=>{calls++;throw Error(fake);},wait:async()=>{}});
 assert.equal(calls,1);assert.equal(result.createAttempts,1);assert.equal(result.reason,'transport_or_timeout');assert.ok(!JSON.stringify(result).includes(fake));
});
test('pins the China API and never sends the credential to the asset host',async()=>{
 const fake='FAKE_CN_KEY_662';const calls=[],progress=[];
 const glb=Buffer.alloc(24);glb.write('glTF',0,'ascii');glb.writeUInt32LE(2,4);glb.writeUInt32LE(24,8);glb.writeUInt32LE(4,12);glb.write('JSON',16,'ascii');glb.write('{}  ',20,'ascii');
 const transport=async(url,init)=>{
  calls.push({url,method:init.method,authorization:new Headers(init.headers).get('Authorization'),redirect:init.redirect});
  if(calls.length===1)return Response.json({c:'0',d:42});
  if(calls.length===2)return Response.json({c:'0',d:{status:3,outputs:[{content:'https://model.kujiale.com/fixture.glb'}]}});
  return new Response(glb);
 };
 const result=await runSmoke({mode:'live',key:fake,transport,wait:async()=>{},onProgress:value=>progress.push(value)});
 assert.equal(result.status,'ready');assert.equal(calls.length,3);
 assert.equal(calls[0].url,'https://api.aholo3d.cn/lux3d/v1/generate/text-to-3d/task/create');assert.equal(calls[0].method,'POST');assert.equal(calls[0].authorization,fake);
 assert.equal(calls[1].url,'https://api.aholo3d.cn/lux3d/v1/generate/task/get?taskid=42');assert.equal(calls[1].authorization,fake);
 assert.equal(calls[2].authorization,null);assert.ok(calls.every(call=>call.redirect==='error'));
 assert.deepEqual(progress,[{phase:'submitting'},{phase:'polling',poll:1},{phase:'verifying_asset'}]);assert.ok(!JSON.stringify(progress).includes(fake));
 assert.ok(!JSON.stringify(result).includes(fake));assert.ok(!JSON.stringify(result).includes('kujiale.com'));
});
test('rejects unapproved asset hosts without making a download request',async()=>{
 let calls=0;const secret='FAKE_SECRET_URL_482';
 const transport=async(_url,init)=>{calls++;return init.method==='POST'?Response.json({c:'0',d:42}):Response.json({c:'0',d:{status:3,outputs:[{content:`https://attacker.invalid/${secret}.glb`}]}});};
 const result=await runSmoke({mode:'live',key:'synthetic-fixture',transport,wait:async()=>{}});
 assert.equal(calls,2);assert.equal(result.reason,'asset_url_invalid');assert.ok(!JSON.stringify(result).includes(secret));
 for(const url of ['http://model.kujiale.com/a.glb','https://kujiale.com.evil.invalid/a.glb','https://user:pass@model.kujiale.com/a.glb','https://model.kujiale.com:444/a.glb'])assert.equal(permittedAsset(url),false);
 assert.equal(permittedAsset('https://model.kujiale.com/a.glb?expires=123'),true);
});
test('PowerShell synthetic launch does not read user credentials or contact a provider',()=>{
 const env={...process.env,PSModulePath:'C:\\synthetic-invalid-modules'};for(const key of ['SCENDANCE_LUX3D_SMOKE_KEY','SCENDANCE_CHAT_TRIAL_KEY','LUX3D_API_KEY'])delete env[key];
 const script=path.resolve(__dirname,'start-local-lux3d-smoke.ps1');
 const child=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-File',script,'-Mode','synthetic'],{encoding:'utf8',windowsHide:true,env,timeout:30000});
 assert.equal(child.status,0,child.stderr);const result=JSON.parse(child.stdout.trim());assert.equal(result.mode,'synthetic');assert.equal(result.status,'ready');
 assert.ok(!child.stdout.includes('synthetic-only-lux3d'));
});
