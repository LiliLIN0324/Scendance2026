// Isolated browser harness against npm run dev:agent (loopback fixture only).
// It mounts the actual Agent panel with test-only editor adapters; it does not
// claim to exercise the production RoomOrganizer, persistence, or a real model.
const assert=require('node:assert/strict');
const path=require('node:path');
const http=require('node:http');
const esbuild=require('esbuild');
const {chromium}=require('playwright');
async function main(){
 const root=path.resolve(__dirname,'..');
 const health=await fetch('http://127.0.0.1:54329/__fixture');
 if(!health.ok||health.headers.get('x-scendance-test-fixture')!=='PGlite; Auth and Storage are test doubles')throw Error('需要先启动隔离的 npm run dev:agent。');
 const identity=await health.json();if(identity.fixture!=='agent-model-stub'||identity.provider!=='local-deterministic'||identity.production!==false)throw Error('未确认本地模型桩，拒绝测试。');
 const entry=`import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
 import {BackendSession,getBackendConfig} from './lib/backend-session';
 import {LayoutAgentProvider,AgentPanel} from './components/room-organizer/panels/agent-panel';
 import {layoutStore} from './components/room-organizer/hooks/use-layout-store';
 import {createActivitySessionTracker} from './components/room-organizer/lib/activity-session-epoch';
 import {makeFloor,makeLayout,makeViewSettings} from './components/room-organizer/lib/__testfixtures__/fixtures';
 async function boot(){const layout=makeLayout({id:'fixture-activity',width:12,height:9,backendVenue:{shape:'rectangle',width:12,depth:9,height:3,entrances:[]},floors:[makeFloor({id:'floor-a',items:[]})]});
 window.probe={initial:structuredClone(layout),applied:null,preview:null,modelCalls:0,modelEvidence:[]};
 const controller=new BackendSession(getBackendConfig({url:'http://127.0.0.1:54329',anonKey:'sb_publishable_local_integration_only'}));
 await controller.signIn('owner@scendance.test','local-integration-only');
 const extract=controller.briefExtract.bind(controller);controller.briefExtract=async(...args)=>{window.probe.modelCalls++;const result=await extract(...args);window.probe.modelEvidence.push(result.extraction?.activityNeeds??[]);return result;};
 window.studioStub={controller,brief:{event:null,guests:null},setBrief(){},preview:null,stale:false,expired:false,busy:false,recoverable:false,applyRecovery:null,connection:'离线引导',generate:async()=>{},discardPreview(){},applyPreview:async()=>{},exportActivity:async()=>{}};
 layoutStore.setState({layout,activeFloorIndex:0});
 const tracker=createActivitySessionTracker(layoutStore);tracker.start();const sessionToken=tracker.capture();window.invalidate=()=>{layoutStore.setState({layout:{...layout,id:'fixture-other'}});layoutStore.setState({layout});};
 const callbacks={workbenchMode:'layout',onOpenMaterials(){},onSelectMode(){},onOpenReview(){},onOpenDelivery(){},onFit(){}};
 function App(){const [current,setCurrent]=useState(layout);window.editorStub={layout:current,activeFloor:current.floors[0],activeFloorIndex:0,actions:{applyLayout:setCurrent,addItems(){},setFloorPlan(){}},history:{commitNow(){}},view:makeViewSettings(),setView(){},collidingIds:new Set()};
 return React.createElement(LayoutAgentProvider,{sessionScope:'activity:fixture-activity',isSessionCurrent:()=>tracker.isCurrent(sessionToken),callbacks,onPreview:p=>{window.probe.preview=p;},onApply:(next,options)=>{if(!tracker.isCurrent(sessionToken)||JSON.stringify(layoutStore.getState().layout)!==JSON.stringify(options.expectedBase))throw Error('场景已变化');window.probe.applied=next;layoutStore.setState({layout:next});setCurrent(next);}},React.createElement(AgentPanel));}
 createRoot(document.getElementById('app')).render(React.createElement(App));window.probe.ready=true;}boot().catch(error=>{window.probeError=String(error);console.error(error);});`;
 const built=await esbuild.build({stdin:{contents:entry,resolveDir:root,sourcefile:'local-agent-probe.tsx',loader:'tsx'},bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',alias:{'@':root},loader:{'.css':'empty'},define:{'process.env':'{"NODE_ENV":"test","NEXT_PUBLIC_AGENT_ENABLED":"1"}'},plugins:[{name:'isolated-editor-adapters',setup(build){
  build.onResolve({filter:/^\.\.\/contexts$/},()=>({path:'editor-context',namespace:'probe'}));
  build.onResolve({filter:/^\.\/creative-studio$/},args=>args.importer.endsWith('agent-panel.tsx')?{path:'studio-context',namespace:'probe'}:null);
  build.onLoad({filter:/.*/,namespace:'probe'},args=>({contents:args.path==='editor-context'?'export const useRoomEditor=()=>window.editorStub;export const useSelection=()=>({});':'export const useStudioAgent=()=>window.studioStub;export const useLocalProjectBackup=()=>null;',loader:'js'}));
 }}]});
 const frontend=http.createServer((_request,response)=>{response.writeHead(200,{'content-type':'text/html;charset=utf-8'});response.end('<!doctype html><meta charset="utf-8"><div id="app"></div>');});
 await new Promise((resolve,reject)=>{frontend.once('error',reject);frontend.listen(3018,'127.0.0.1',resolve);});
 let browser;try{browser=await chromium.launch({headless:true,executablePath:process.env.SCENDANCE_TEST_CHROME||'C:/Program Files/Google/Chrome/Application/chrome.exe'});}catch(error){await new Promise(resolve=>frontend.close(resolve));throw error;}
 const context=await browser.newContext();
 try{
  const routeLocal=route=>{const url=new URL(route.request().url());if(url.hostname==='127.0.0.1'&&['3018','54329'].includes(url.port))return route.continue();return route.abort();};
  await context.route('**/*',routeLocal);
  const page=await context.newPage();page.on('pageerror',error=>console.error('browser error:',error.message));page.on('console',message=>{if(message.type()==='error')console.error('browser console:',message.text());});page.on('requestfailed',request=>console.error('local request failed:',new URL(request.url()).pathname,request.failure()?.errorText));
  await page.goto('http://127.0.0.1:3018/');await page.addScriptTag({content:built.outputFiles[0].text});await page.waitForFunction(()=>window.probe?.ready||window.probeError,{timeout:10000});
  const bootError=await page.evaluate(()=>window.probeError);if(bootError)throw Error(`fixture boot failed: ${bootError}`);
  async function send(text){await page.getByLabel('告诉 Agent 要改的').fill(text);await page.getByRole('button',{name:'发送'}).click();}
  await send('8人，室内12×9米，圆桌，宾客先在入口登记，台上要有供演讲者使用的高台');
  await page.getByText(/关于活动需求，我理解为需要签到区、需要舞台/).waitFor({timeout:10000});
  const first=await page.evaluate(()=>({applied:window.probe.applied,preview:window.probe.preview,evidence:window.probe.modelEvidence[0]}));
  assert.equal(first.applied,null);assert.equal(first.preview,null);assert.deepEqual(first.evidence.map(need=>need.evidence),['宾客先在入口登记','台上要有供演讲者使用的高台']);
  console.log('AFTER_INPUT',JSON.stringify((await page.locator('body').innerText()).slice(-1300)));
  await send('确认');await page.getByText(/记下了：需要签到区、需要舞台/).waitFor();console.log('AFTER_CONFIRM',JSON.stringify((await page.locator('body').innerText()).slice(-1300)));
  await send('出方案');await page.getByRole('button',{name:'确认布置'}).waitFor({timeout:25000});
  const before=await page.evaluate(()=>({initial:window.probe.initial,applied:window.probe.applied,preview:window.probe.preview,modelCalls:window.probe.modelCalls,modelEvidence:window.probe.modelEvidence}));
  assert.equal(before.applied,null);assert.ok(before.preview?.floors?.[0]?.items?.length>0);assert.equal(before.initial.floors[0].items.length,0);
  assert.deepEqual(before.modelEvidence[0].map(need=>need.evidence),['宾客先在入口登记','台上要有供演讲者使用的高台']);
  assert.ok(before.preview.floors[0].items.some(item=>item.materialId==='reception'));assert.ok(before.preview.floors[0].items.some(item=>item.name==='舞台平台（示意）'));
  await page.getByRole('button',{name:'确认布置'}).click();await page.waitForFunction(()=>!!window.probe.applied);
  const result=await page.evaluate(()=>({count:window.probe.applied.floors[0].items.length,modelCalls:window.probe.modelCalls}));
  assert.ok(result.count>0);
  const second=await browser.newContext();try{
   await second.route('**/*',routeLocal);const stale=await second.newPage();await stale.goto('http://127.0.0.1:3018/');await stale.addScriptTag({content:built.outputFiles[0].text});await stale.waitForFunction(()=>window.probe?.ready||window.probeError,{timeout:10000});
   if(await stale.evaluate(()=>window.probeError))throw Error('stale scenario fixture boot failed');
   const say=async text=>{await stale.getByLabel('告诉 Agent 要改的').fill(text);await stale.getByRole('button',{name:'发送'}).click();};
   await say('8人，室内12×9米，圆桌，宾客先在入口登记，台上要有供演讲者使用的高台');await stale.getByText(/关于活动需求，我理解为需要签到区、需要舞台/).waitFor();
   await say('确认');await stale.getByText(/记下了：需要签到区、需要舞台/).waitFor();await say('出方案');await stale.getByRole('button',{name:'确认布置'}).waitFor({timeout:25000});
   await stale.evaluate(()=>window.invalidate());await stale.getByRole('button',{name:'确认布置'}).click();
   assert.equal(await stale.evaluate(()=>window.probe.applied),null);console.log('STALE_SCOPE',JSON.stringify((await stale.locator('body').innerText()).slice(-600)));
  }finally{await second.close();}
  console.log('PASS real browser + loopback HTTP fixture, including stale A→B→A:',JSON.stringify(result));
 }finally{await context.close();await browser.close();await new Promise(resolve=>frontend.close(resolve));}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
