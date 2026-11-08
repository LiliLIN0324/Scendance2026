// Separate loopback trial. No key, user projects, or Next cache are written here.
const http=require('node:http');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {spawn,execFileSync}=require('node:child_process');
const {randomBytes}=require('node:crypto');
const esbuild=require('esbuild');
const sourceRoot=path.resolve(__dirname,'../..');
const mode=process.env.SCENDANCE_CHAT_TRIAL_MODE||'synthetic';
const bailian=process.env.SCENDANCE_CHAT_TRIAL_PROVIDER==='bailian-qwen';
const bailianModel=process.env.SCENDANCE_BAILIAN_MODEL||'';
if((process.env.SCENDANCE_CHAT_TRIAL_PROVIDER&&!bailian)||(bailian&&!/^qwen[a-z0-9.-]{1,80}$/i.test(bailianModel)))throw Error('百炼模型配置无效。');
const luxSynthetic=process.env.SCENDANCE_LUX3D_SYNTHETIC==='1';
if(luxSynthetic&&mode!=='synthetic')throw Error('模拟 Lux3D 只能在模拟试用中启用。');
const luxLive=process.env.SCENDANCE_LUX3D_ENABLED==='1';
if(luxLive&&(mode!=='live'||luxSynthetic))throw Error('真实 Lux3D 配置无效。');
const luxInput=luxLive?{key:process.env.SCENDANCE_LUX3D_KEY||'',termsUrl:process.env.SCENDANCE_LUX3D_TERMS_URL||'',reviewedAt:process.env.SCENDANCE_LUX3D_REVIEWED_AT||'',reservationCents:process.env.SCENDANCE_LUX3D_RESERVATION_CENTS||''}:null;
for(const name of ['SCENDANCE_LUX3D_KEY','SCENDANCE_LUX3D_TERMS_URL','SCENDANCE_LUX3D_REVIEWED_AT','SCENDANCE_LUX3D_RESERVATION_CENTS'])delete process.env[name];
const key=process.env.SCENDANCE_CHAT_TRIAL_KEY||'',confirm=process.env.SCENDANCE_CHAT_TRIAL_CONFIRM||'';
delete process.env.SCENDANCE_CHAT_TRIAL_KEY;
const port=Number(process.env.SCENDANCE_CHAT_TRIAL_PORT||'4196');
if(!['synthetic','live'].includes(mode)||!Number.isSafeInteger(port)||port<1024||port>65535||port===4186||mode==='live'&&(confirm!=='EXPLICIT_TRIAL'||!key||key.length>4096||/[^\x21-\x7e]/.test(key)))throw Error('试用配置无效。');
const inherited=Object.fromEntries(['PATH','Path','SystemRoot','WINDIR','TEMP','TMP','PATHEXT','COMSPEC','USERPROFILE'].filter(k=>process.env[k]!==undefined).map(k=>[k,process.env[k]]));
const stopToken=randomBytes(32).toString('hex');let backend,next,ui,closed=false,used=0,state='starting',nextOrigin='',diagnostic=null;
const {safeDiagnostic}=require('./local-trial-diagnostic.cjs');
const {startupDiagnostic}=require('./local-trial-startup-diagnostic.cjs');
function copyWorkspace(){
 const dest=fs.mkdtempSync(path.join(os.tmpdir(),'scendance-chat-trial-'));
 const files=execFileSync('git',['ls-files','-c','-o','--exclude-standard','-z'],{cwd:sourceRoot}).toString().split('\0').filter(Boolean);
 for(const relative of new Set(files)){
  const from=path.join(sourceRoot,relative);if(!fs.existsSync(from)||!fs.statSync(from).isFile())continue;
  const target=path.join(dest,relative);fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(from,target);
 }
 for(const relative of ['node_modules','frontend/node_modules'])fs.symlinkSync(fs.realpathSync(path.join(sourceRoot,relative)),path.join(dest,relative),process.platform==='win32'?'junction':'dir');
 return dest;
}
function listen(server,n=0){return new Promise((resolve,reject)=>{server.once('error',reject);server.listen(n,'127.0.0.1',()=>resolve(server.address().port));});}
async function freePort(){for(;;){const server=http.createServer(),n=await listen(server);await new Promise(resolve=>server.close(resolve));if(n!==4186&&n!==port)return n;}}
function finish(){if(closed)return;closed=true;state='stopped';if(backend&&!backend.killed)backend.kill();if(next&&!next.killed)next.kill();if(ui)ui.close();setTimeout(()=>process.exit(),500).unref();}
process.once('SIGINT',finish);process.once('SIGTERM',finish);
async function startBackend(root,origin){
 const built=await esbuild.build({entryPoints:[path.join(root,'scripts/local-chat-trial-server.ts')],bundle:true,platform:'node',format:'esm',packages:'external',write:false,logLevel:'silent'});
 return new Promise((resolve,reject)=>{
  backend=spawn(process.execPath,['--input-type=module','-'],{cwd:path.join(root,'tests'),windowsHide:true,stdio:['pipe','ignore','ignore','ipc'],env:{...inherited,SCENDANCE_CHAT_TRIAL_ORIGIN:origin,SCENDANCE_CHAT_TRIAL_MODE:mode,...(bailian?{SCENDANCE_CHAT_TRIAL_PROVIDER:'bailian-qwen',SCENDANCE_BAILIAN_MODEL:bailianModel}:{}),...(luxSynthetic?{SCENDANCE_LUX3D_SYNTHETIC:'1'}:{}),...(luxInput?{SCENDANCE_LUX3D_ENABLED:'1',SCENDANCE_LUX3D_KEY:luxInput.key,SCENDANCE_LUX3D_TERMS_URL:luxInput.termsUrl,SCENDANCE_LUX3D_REVIEWED_AT:luxInput.reviewedAt,SCENDANCE_LUX3D_RESERVATION_CENTS:luxInput.reservationCents}:{}),...(mode==='live'?{SCENDANCE_CHAT_TRIAL_KEY:key,SCENDANCE_CHAT_TRIAL_CONFIRM:confirm}:{})}});
  if(luxInput)luxInput.key='';
  const timer=setTimeout(()=>reject(Error('本机数据服务启动超时。')),30000);
  backend.on('message',message=>{if(message?.type==='usage'){used=message.used;state=message.state;diagnostic=safeDiagnostic(message.diagnostic);}if(message?.type==='ready'){clearTimeout(timer);resolve(message.url);}});
  backend.once('error',()=>{clearTimeout(timer);reject(Error('本机数据服务无法启动。'));});
  backend.once('exit',()=>{clearTimeout(timer);if(!closed){state='failed';reject(Error('本机数据服务提前退出。'));}});
  backend.stdin.end(built.outputFiles[0].text);
 });
}
async function waitNext(origin){for(let i=0;i<120;i++){if(!next||next.exitCode!==null)throw Error('本机工作台启动失败。');try{const response=await fetch(origin,{signal:AbortSignal.timeout(1000)});if(response.status<500)return;}catch{}await new Promise(resolve=>setTimeout(resolve,300));}throw Error('本机工作台启动超时。');}
function html(){const label=mode==='live'?(bailian?'真实阿里云百炼北京：文字会发送给百炼，按账户实际计费。':luxLive?'真实 MiniMax 与 Aholo 中国站：请求发送至对应服务，可能按账户计费；隔离账务仅为本机限制，不是账户余额或厂商报价。图生 3D 未开放。':'真实 MiniMax 中国站：文字会发送给模型；你已允许使用积分，套餐用尽后可能扣已购积分。'):luxSynthetic?'模拟模式：包含模拟 Lux3D，不调用真实模型或 Aholo。':'模拟模式：只返回固定演练结果，不调用真实模型。';
 return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>幕景独立对话试用</title><style>html,body{height:100%;margin:0;font:14px sans-serif;color:#202620;background:#f4f5f7}header{padding:10px 16px;display:flex;gap:16px;align-items:center;flex-wrap:wrap}iframe{border:0;width:100%;height:calc(100% - 70px)}button{padding:6px 12px}</style></head><body><header><strong>${label}</strong><span id="status">启动中…</span><button id="resume" hidden>继续试用</button><button id="stop">结束试用</button><span>隔离测试数据；模型回答未通过核对时，本次结果不会采用，后续不同请求可继续。网络错误或结果未知时停止；不会自动重试，新请求可能计费。</span></header><iframe title="幕景工作台" src="${nextOrigin}"></iframe><script>const labels={starting:'启动中',ready:'可使用',running:'正在处理',awaiting_user:'回答需核对，等待你决定是否继续',failed:'请求失败或结果未知，本轮已停用',stopped:'已结束'};const reasons={http_error:'模型服务返回错误',timeout:'模型服务响应超时',cancelled_or_upstream_timeout:'请求被取消或上游超时',network_error:'网络连接失败',response_too_large:'模型响应超出大小限制',response_empty:'模型响应为空',response_encoding:'模型响应编码无效',provider_non_json:'模型服务响应不是 JSON',provider_envelope_invalid:'模型服务响应格式无效',provider_reported_error:'模型服务报告错误',provider_incomplete:'模型输出未完成',provider_tool_call:'模型返回不支持的工具调用',model_non_json:'模型回答不是 JSON',model_schema_invalid:'模型回答字段格式不符',model_evidence_mismatch:'模型引用的原文无法核对',model_execution_claim:'模型回答包含未经确认的执行或通过结论',model_text_invalid:'模型回答内容无效',unknown_error:'原因无法确定'};async function update(){try{const r=await fetch('/status',{cache:'no-store'}),s=await r.json(),d=s.diagnostic;document.getElementById("resume").hidden=s.state!=="awaiting_user";document.getElementById('status').textContent=(labels[s.state]||'状态未知')+' · 本次已发 '+s.used+' 次'+(d?' · '+(reasons[d.code]||'原因无法确定')+(d.httpStatus?'（HTTP '+d.httpStatus+'）':''):'');}catch{document.getElementById('status').textContent='服务已停止';}}document.getElementById("resume").onclick=async()=>{const r=await fetch("/resume",{method:"POST",headers:{"x-local-stop":"${stopToken}"}});if(r.ok)await update();};setInterval(update,1000);update();document.getElementById('stop').onclick=async()=>{await fetch('/stop',{method:'POST',headers:{'x-local-stop':'${stopToken}'}});document.getElementById('status').textContent='已结束';};</script></body></html>`;
}
let startupStage='准备隔离副本';
async function main(){
 console.log('正在准备独立试用副本…');const root=copyWorkspace(),front=path.join(root,'frontend');
 startupStage='检查隔离配置';
 for(const name of ['.env','.env.local','.env.development','.env.development.local'])if(fs.existsSync(path.join(front,name)))throw Error('试用副本包含环境配置。');
 startupStage='分配本地端口';nextOrigin=`http://127.0.0.1:${await freePort()}`;
 startupStage='启动本地数据服务';const apiUrl=await startBackend(root,nextOrigin);
 startupStage='启动本地工作台';
 next=spawn(process.execPath,[path.join(front,'node_modules/next/dist/bin/next'),'dev','--hostname','127.0.0.1','--port',new URL(nextOrigin).port],{cwd:front,windowsHide:true,stdio:'ignore',env:{...inherited,NODE_ENV:'development',NEXT_PUBLIC_AGENT_ENABLED:'1',NEXT_PUBLIC_BRIEF_CONVERSATION_ENABLED:'1',NEXT_PUBLIC_CONVERSATIONAL_CHAT_ENABLED:'1',NEXT_PUBLIC_SCENDANCE_LOCAL_BRIEF_ONLY:'1',NEXT_PUBLIC_SUPABASE_URL:apiUrl,NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:'sb_publishable_local_integration_only'}});
 next.once('exit',()=>{if(!closed)state='failed';});await waitNext(nextOrigin);state='ready';
 ui=http.createServer((req,res)=>{
  const headers={'cache-control':'no-store','x-content-type-options':'nosniff'};
  if(req.method==='GET'&&req.url==='/status'){res.writeHead(200,{...headers,'content-type':'application/json'});res.end(JSON.stringify({mode,used,state,diagnostic,lux3d:luxLive?'live':luxSynthetic?'synthetic':'disabled'}));return;}
  if(req.method==='POST'&&req.url==='/resume'&&req.headers['x-local-stop']===stopToken&&req.headers.origin===`http://127.0.0.1:${port}`){if(state!=='awaiting_user'||!backend?.connected){res.writeHead(409,headers).end();return;}backend.send({type:'resume_trial'});res.writeHead(202,headers).end();return;}
  if(req.method==='POST'&&req.url==='/stop'&&req.headers['x-local-stop']===stopToken&&req.headers.origin===`http://127.0.0.1:${port}`){res.writeHead(200,headers);res.end('ok');finish();return;}
  if(req.method==='GET'&&req.url==='/'){res.writeHead(200,{...headers,'content-type':'text/html; charset=utf-8','content-security-policy':`default-src 'none'; frame-src ${nextOrigin}; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'`});res.end(html());return;}
  res.writeHead(404,headers);res.end();
 });
 startupStage='监听试用端口';await listen(ui,port);console.log(`LOCAL_CHAT_TRIAL ${mode} http://127.0.0.1:${port}`);
 console.log('请使用独立浏览器会话。隔离演练账号 owner@scendance.test / local-integration-only；页面的结束按钮可关闭试用。');
 if(mode==='live')console.log(bailian?'文字发送至阿里云百炼北京，按账户实际计费。取消不保证停止计费，调用次数仅统计本进程。':'文字发送至 MiniMax；套餐耗尽可能扣已购积分。取消不保证停止计费，调用次数仅统计本进程。');
}
main().catch(error=>{console.error(startupDiagnostic(startupStage,error));finish();process.exitCode=1;});
