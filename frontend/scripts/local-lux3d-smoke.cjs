// One explicitly started local smoke task. Never print credentials, raw provider
// replies, task IDs or result URLs. No automatic retry of the paid create call.
const {createHash}=require('node:crypto');
const BASE='https://api.aholo3d.cn';
const CREATE='/lux3d/v1/generate/text-to-3d/task/create';
const QUERY='/lux3d/v1/generate/task/get';
const PROMPT='用于隔离测试的一把简洁木椅，单个物体，纯色背景';
const MAX_JSON=256*1024,MAX_GLB=50*1024*1024;
class SmokeFailure extends Error{constructor(code){super(code);this.code=code;}}
function fail(code){throw new SmokeFailure(code);}
function permittedAsset(raw){
 try{const url=new URL(raw),hosts=['.kujiale.com','.myqcloud.com','.tencentcos.cn','.tencentcos.com'];
  return url.protocol==='https:'&&!url.username&&!url.password&&(!url.port||url.port==='443')&&hosts.some(suffix=>url.hostname.endsWith(suffix)&&url.hostname.length>suffix.length);
 }catch{return false;}
}
async function bytes(response,limit){
 if(Number(response.headers.get('content-length'))>limit)fail('response_too_large');
 const reader=response.body?.getReader();if(!reader)fail('response_empty');let size=0;const chunks=[];
 try{for(;;){const item=await reader.read();if(item.done)break;size+=item.value.length;if(size>limit){void reader.cancel();fail('response_too_large');}chunks.push(item.value);}}
 finally{reader.releaseLock();}
 if(!size)fail('response_empty');return Buffer.concat(chunks.map(chunk=>Buffer.from(chunk)),size);
}
async function json(response){
 const data=await bytes(response,MAX_JSON);try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(data));}catch{fail('invalid_response');}
}
function testGlb(){
 const data=Buffer.from('{"asset":{"version":"2.0"}}');const len=(data.length+3)&~3;
 const out=Buffer.alloc(20+len,0x20);out.write('glTF',0,'ascii');out.writeUInt32LE(2,4);out.writeUInt32LE(out.length,8);out.writeUInt32LE(len,12);out.write('JSON',16,'ascii');data.copy(out,20);return out;
}
function syntheticTransport(){
 let creates=0;
 return async(input,init={})=>{
  const url=new URL(String(input));const method=init.method||'GET';
  if(url.origin===BASE&&url.pathname===CREATE&&method==='POST'&&!url.search){creates++;if(creates!==1)throw Error('duplicate synthetic create');return Response.json({c:'0',d:12345});}
  if(url.origin===BASE&&url.pathname===QUERY&&method==='GET'&&url.searchParams.get('taskid')==='12345')return Response.json({c:'0',d:{status:3,outputs:[{content:'https://model.kujiale.com/synthetic-only.glb'}]}});
  if(url.href==='https://model.kujiale.com/synthetic-only.glb'&&method==='GET')return new Response(testGlb());
  throw Error('synthetic route denied');
 };
}
async function runSmoke({mode,key,transport,wait=ms=>new Promise(resolve=>setTimeout(resolve,ms)),maxPolls=40,pollMs=15000,onProgress=()=>{}}){
 if(!['synthetic','live'].includes(mode)||typeof key!=='string'||!key||key.length>4096||/[^\x21-\x7e]/.test(key))fail('configuration_invalid');
 const send=transport??(mode==='synthetic'?syntheticTransport():fetch);
 let submitted=false,polls=0;
 const progress=value=>{try{onProgress(value);}catch{/* progress never changes the request */}};
 try{
  progress({phase:'submitting'});
  submitted=true;
  const create=await send(BASE+CREATE,{method:'POST',headers:{Authorization:key,'Content-Type':'application/json'},body:JSON.stringify({prompt:PROMPT,style:'photorealistic',version:'G1',faceCount:30000,outputFormat:['glb']}),redirect:'error',signal:AbortSignal.timeout(30000)});
  if(!create.ok)fail('create_http_error');
  const created=await json(create);if(!created||created.c!=='0'||!Number.isSafeInteger(created.d)||created.d<=0)fail('create_response_invalid');
  let resultUrl='';
  for(let i=0;i<maxPolls;i++){
   if(i)await wait(pollMs);polls++;
   progress({phase:'polling',poll:polls});
   const query=await send(`${BASE}${QUERY}?taskid=${encodeURIComponent(created.d)}`,{method:'GET',headers:{Authorization:key},redirect:'error',signal:AbortSignal.timeout(30000)});
   if(!query.ok)fail('query_http_error');
   const result=await json(query);if(!result||result.c!=='0'||!result.d||!Number.isInteger(result.d.status))fail('query_response_invalid');
   const state=result.d.status;
   if(state===4||state===6)fail('provider_task_failed');
   if(state===3){const outputs=Array.isArray(result.d.outputs)?result.d.outputs:[];const file=outputs.find(item=>typeof item?.content==='string'&&/\.glb(?:\?|$)/i.test(item.content));
    if(!file||!permittedAsset(file.content))fail('asset_url_invalid');resultUrl=file.content;break;}
   if(state!==0&&state!==1)fail('provider_status_unknown');
  }
  if(!resultUrl)fail('poll_timeout');
  progress({phase:'verifying_asset'});
  const response=await send(resultUrl,{method:'GET',redirect:'error',signal:AbortSignal.timeout(30000)});if(!response.ok)fail('asset_http_error');
  const data=await bytes(response,MAX_GLB);
  if(data.length<20||data.toString('ascii',0,4)!=='glTF'||data.readUInt32LE(4)!==2||data.readUInt32LE(8)!==data.length)fail('asset_invalid');
  return {status:'ready',mode,createAttempts:1,polls,glbBytes:data.length,sha256:createHash('sha256').update(data).digest('hex'),notice:'仅核对 GLB 基本头部，不代表模型质量、尺寸或权利已确认。'};
 }catch(error){
  const known=error instanceof SmokeFailure?error.code:'transport_or_timeout';
  return {status:'failed',mode,createAttempts:submitted?1:0,polls,reason:known,notice:'未自动重试；已发出的创建请求可能已计费或已创建，请先到供应商控制台核对。'};
 }
}
async function main(){
 const mode=process.env.SCENDANCE_LUX3D_SMOKE_MODE||'synthetic';
 const key=mode==='synthetic'?'synthetic-only-lux3d':process.env.SCENDANCE_LUX3D_SMOKE_KEY||'';
 const confirmed=process.env.SCENDANCE_LUX3D_SMOKE_CONFIRM;
 delete process.env.SCENDANCE_LUX3D_SMOKE_KEY;delete process.env.SCENDANCE_LUX3D_SMOKE_CONFIRM;
 if(mode==='live'&&confirmed!=='explicit-local-smoke'){console.log(JSON.stringify({status:'failed',reason:'configuration_invalid'}));process.exitCode=1;return;}
 try{const result=await runSmoke({mode,key,...(mode==='live'?{onProgress:value=>console.log(JSON.stringify(value))}:{})});console.log(JSON.stringify(result));if(result.status!=='ready')process.exitCode=1;}
 catch{console.log(JSON.stringify({status:'failed',reason:'configuration_invalid'}));process.exitCode=1;}
}
module.exports={runSmoke,permittedAsset};
if(require.main===module)void main();
