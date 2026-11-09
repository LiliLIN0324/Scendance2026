// Isolated browser exercise of the real AgentPanel with synthetic editor/model adapters.
// No real accounts, cloud services or existing trial are contacted.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const http=require('node:http');
const path=require('node:path');
const esbuild=require('esbuild');
const {chromium}=require('playwright');

async function main(){
 const root=path.resolve(__dirname,'..');
 const entry=`import React from 'react';import {createRoot} from 'react-dom/client';
 import {LayoutAgentProvider,AgentPanel} from './components/room-organizer/panels/agent-panel';
 import {layoutStore} from './components/room-organizer/hooks/use-layout-store';
 import {makeFloor,makeLayout,makeViewSettings} from './components/room-organizer/lib/__testfixtures__/fixtures';
 const layout=makeLayout({id:'chat-browser-fixture',width:12,height:9,floors:[makeFloor({id:'floor-a',items:[]})]});
 layoutStore.setState({layout,activeFloorIndex:0});
 window.probe={applied:0,preview:0,questions:[],briefs:[],conversations:[],memories:[],initial:JSON.stringify(layout),late:null};
 const controller={assistantChat:async(text,history,signal)=>{window.probe.questions.push({text,history});if(text==='活动的通道有什么作用？')return new Promise(resolve=>{window.probe.late=resolve;});return {status:'ok',answer:'签到有助于核对到场情况。'};},briefExtract:async(text)=>{window.probe.briefs.push(text);return {enabled:true,extraction:{event:'讲座',headcount:30,venueIO:'indoor',activityNeeds:[{kind:'checkin',decision:'unknown',evidence:'是否签到还没决定'}]}};},briefConversation:async(text,history,signal)=>{window.probe.conversations.push({text,history});if(text==='活动的通道有什么作用？')return new Promise(resolve=>{window.probe.late=resolve;});if(text==='签到有什么作用？')return {enabled:true,extraction:{},reply:'签到有助于核对到场情况。',unhandled:[],factEvidence:[]};return {enabled:true,extraction:{headcount:30},reply:'先按30人梳理活动需求。',unhandled:[{kind:'action',evidence:'给我物料清单'}],factEvidence:[{key:'headcount',evidence:'30人'}]};}};
 window.studioStub={controller,brief:{event:null,guests:null},setBrief(){},hasSavedBrief:false,preview:null,stale:false,expired:false,busy:false,recoverable:false,applyRecovery:null,connection:'离线引导',generate:async()=>{},discardPreview(){},applyPreview:async()=>{}};
 window.editorStub={layout,activeFloor:layout.floors[0],activeFloorIndex:0,actions:{applyLayout(){},addItems(){},setFloorPlan(){}},history:{commitNow(){}},view:makeViewSettings(),setView(){},collidingIds:new Set()};
 const callbacks={workbenchMode:'layout',onOpenMaterials(){},onSelectMode(){},onOpenReview(){},onOpenDelivery(){},onFit(){}};
 createRoot(document.getElementById('app')).render(React.createElement(LayoutAgentProvider,{callbacks,onBriefMemoryChange:memory=>{window.probe.memories.push(structuredClone(memory));},onPreview:()=>{window.probe.preview++;},onApply:()=>{window.probe.applied++;}},React.createElement(AgentPanel)));`;
 const compile=async unified=>esbuild.build({stdin:{contents:entry,resolveDir:root,sourcefile:'chat-browser-fixture.tsx',loader:'tsx'},bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',alias:{'@':root},loader:{'.css':'empty'},define:{'process.env':JSON.stringify({NODE_ENV:'test',NEXT_PUBLIC_AGENT_ENABLED:'1',NEXT_PUBLIC_CONVERSATIONAL_CHAT_ENABLED:'1',...(unified?{NEXT_PUBLIC_BRIEF_CONVERSATION_ENABLED:'1'}:{})})},plugins:[{name:'isolated-editor-adapters',setup(build){
  build.onResolve({filter:/^\.\.\/contexts$/},()=>({path:'editor',namespace:'fixture'}));
  build.onResolve({filter:/^\.\/creative-studio$/},args=>args.importer.endsWith('agent-panel.tsx')?{path:'studio',namespace:'fixture'}:null);
  build.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:args.path==='editor'?'export const useRoomEditor=()=>window.editorStub;export const useSelection=()=>({});':'export const useStudioAgent=()=>window.studioStub;export const useLocalProjectBackup=()=>null;',loader:'js'}));
 }}]});
 const built=await compile(false),unified=await compile(true);
 const server=http.createServer((_req,res)=>{res.writeHead(200,{'content-type':'text/html;charset=utf-8'});res.end('<!doctype html><meta charset="utf-8"><div id="app"></div>');});
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 const port=server.address().port,chrome=process.env.SCENDANCE_TEST_CHROME||'C:/Program Files/Google/Chrome/Application/chrome.exe';
 if(!fs.existsSync(chrome)){server.close();throw Error('未找到测试浏览器，请设置 SCENDANCE_TEST_CHROME。');}
 let browser,context;const external=[];
 try{
  browser=await chromium.launch({headless:true,executablePath:chrome});context=await browser.newContext();
  await context.route('**/*',route=>{const u=new URL(route.request().url());if(u.hostname==='127.0.0.1'&&u.port===String(port))return route.continue();external.push(u.origin);return route.abort();});
  const page=await context.newPage();await page.goto(`http://127.0.0.1:${port}/`);await page.addScriptTag({content:built.outputFiles[0].text});
  const input=page.getByLabel('告诉 Agent 要改的');await input.waitFor({timeout:15000});
  const send=async text=>{await input.fill(text);await page.getByRole('button',{name:'发送',exact:true}).click();};
  await send('你好');await page.getByText('你好，我可以帮你梳理活动需求、查看方案或准备布置。').waitFor();assert.equal(await page.evaluate(()=>window.probe.questions.length),0);
  await send('签到有什么作用？');await page.getByText('签到有助于核对到场情况。').waitFor();
  await send('为长者办一场室内讲座，预计30人，现有80把椅子；是否签到还没决定。');await page.getByText(/签到区暂时待定/).waitFor();
  const transcript=await page.locator('body').innerText();assert.match(transcript,/30 人/);assert.match(transcript,/暂未计入库存/);
  await send('活动的通道有什么作用？');await page.getByRole('button',{name:'停止等待'}).click();
  await page.evaluate(()=>window.probe.late({status:'ok',answer:'不应出现的迟到回复'}));await page.waitForTimeout(100);
  assert.equal(await page.getByText('不应出现的迟到回复').count(),0);
  const state=await page.evaluate(()=>({applied:window.probe.applied,preview:window.probe.preview,questions:window.probe.questions.length,briefs:window.probe.briefs.length,unchanged:window.probe.initial===JSON.stringify(window.editorStub.layout)}));
  assert.equal(state.applied,0);assert.equal(state.preview,0);assert.equal(state.unchanged,true);assert.equal(state.questions,2);assert.equal(state.briefs,1);assert.deepEqual(external,[]);
  const other=await browser.newContext();try{
   await other.route('**/*',route=>{const u=new URL(route.request().url());if(u.hostname==='127.0.0.1'&&u.port===String(port))return route.continue();external.push(u.origin);return route.abort();});
   const tab=await other.newPage();await tab.goto(`http://127.0.0.1:${port}/`);await tab.addScriptTag({content:unified.outputFiles[0].text});
   const field=tab.getByLabel('告诉 Agent 要改的');await field.waitFor({timeout:15000});const sendUnified=async text=>{await field.fill(text);await tab.getByRole('button',{name:'发送',exact:true}).click();};
   await sendUnified('签到有什么作用？');await tab.getByText('签到有助于核对到场情况。').waitFor();
   let counts=await tab.evaluate(()=>({n:window.probe.conversations.length,questions:window.probe.questions.length,briefs:window.probe.briefs.length,applied:window.probe.applied}));assert.deepEqual(counts,{n:1,questions:0,briefs:0,applied:0});
   await sendUnified('本场30人，给我物料清单');await tab.getByText(/以下内容尚未执行或仍需核对/).waitFor();
   assert.equal(await tab.getByText('本场30人，给我物料清单',{exact:true}).count(),1);assert.match(await tab.locator('body').innerText(),/先按30人梳理活动需求/);
   assert.equal(await tab.evaluate(()=>window.probe.memories.at(-1)?.headcount),30);assert.equal(await tab.evaluate(()=>window.probe.conversations.at(-1).text),'本场30人，给我物料清单');
   counts=await tab.evaluate(()=>({n:window.probe.conversations.length,questions:window.probe.questions.length,briefs:window.probe.briefs.length,applied:window.probe.applied}));assert.deepEqual(counts,{n:2,questions:0,briefs:0,applied:0});
   const memoryBefore=await tab.evaluate(()=>JSON.stringify(window.probe.memories.at(-1)));
   await sendUnified('活动的通道有什么作用？');await tab.getByRole('button',{name:'停止等待'}).click();await tab.evaluate(()=>window.probe.late({enabled:true,extraction:{headcount:99},reply:'不应出现的统一模式迟到回复',unhandled:[],factEvidence:[{key:'headcount',evidence:'99'}]}));await tab.waitForTimeout(100);
   assert.equal(await tab.getByText('不应出现的统一模式迟到回复').count(),0);assert.equal(await tab.evaluate(()=>JSON.stringify(window.probe.memories.at(-1))),memoryBefore);assert.equal(await tab.evaluate(()=>window.probe.applied),0);assert.deepEqual(external,[]);
  }finally{await other.close();}
  console.log(JSON.stringify({status:'passed',scope:'真实浏览器 AgentPanel；测试编辑器与模型适配器，非完整 RoomOrganizer',...state,unifiedQuestionCalls:1,unifiedMixedCalls:1,unifiedStopIgnoresLate:true,externalRequests:0}));
 }finally{if(context)await context.close();if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
}
main().catch(error=>{console.error('AGENT_CHAT_BROWSER_FAILED',error.message);process.exitCode=1;});
