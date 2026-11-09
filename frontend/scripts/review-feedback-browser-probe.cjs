// Two isolated browser contexts exercise the real React reviewer and creator UI.
// No external service is contacted; the share page and workspace use test routes.
const assert=require('node:assert/strict');
const path=require('node:path');
const esbuild=require('esbuild');
const {chromium}=require('playwright');

async function main(){
 const root=path.resolve(__dirname,'..');
 const entry=`import React from 'react';import {createRoot} from 'react-dom/client';
 import {ReviewSharePage} from './components/review-share-page/review-share-page';
 import {BingoAuditCard} from './components/room-organizer/panels/bingo-audit-card';
 import {encodeShareUrl} from './components/room-organizer/lib/share';
 import {rememberReviewLinkMark} from './components/room-organizer/lib/review-share';
 import {reviewShareHref} from './components/review-share-page/load-plan';
 import {reviewVersionForHash} from './components/review-share-page/review-feedback-receipt';
 import {createLayoutStore} from './components/room-organizer/hooks/use-layout-store';
 import {createActivitySessionTracker} from './components/room-organizer/lib/activity-session-epoch';
 import {makeItem,makeFloor,makeLayout} from './components/room-organizer/lib/__testfixtures__/fixtures';
 window.makeShare=async()=>{const layout=makeLayout({id:'activity-a',name:'真实评审流程',floors:[makeFloor({id:'floor-a',name:'一层',items:Array.from({length:24},(_,i)=>makeItem({id:'chair-'+crypto.randomUUID(),name:'椅子 '+crypto.randomUUID(),position:{x:(i%4)-1.5,z:Math.floor(i/4)-1}}))})]});
 window.testLayout=layout;
 const encoded=await encodeShareUrl(layout,window.location.origin),url=reviewShareHref(window.location.origin,new URL(encoded.url).hash);
 await rememberReviewLinkMark({projectKey:'activity-a',shareId:'activity-a',title:layout.name,clientUrl:url,reviewPlanKey:'legacy'});return url;};
 window.otherVersion=async()=>{const next=await encodeShareUrl({...window.testLayout,name:'另一版'},window.location.origin);return reviewVersionForHash(new URL(next.url).hash);};
 window.mountReview=()=>createRoot(document.getElementById('app')).render(React.createElement(ReviewSharePage));
 window.mountAudit=()=>{const store=createLayoutStore({layout:window.testLayout,activeFloorIndex:0}),tracker=createActivitySessionTracker(store);tracker.start();const token=tracker.capture();window.invalidate=()=>{store.setState({layout:{...window.testLayout,id:'activity-b'}});store.setState({layout:window.testLayout});};createRoot(document.getElementById('app')).render(React.createElement(BingoAuditCard,{scopeKey:'activity:activity-a',isCurrent:()=>tracker.isCurrent(token)}));};`;
 const built=await esbuild.build({stdin:{contents:entry,resolveDir:root,sourcefile:'feedback-probe.tsx',loader:'tsx'},bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',alias:{'@':root},loader:{'.css':'empty'},define:{'process.env.NODE_ENV':'"test"'}});
 const browser=await chromium.launch({headless:true,executablePath:process.env.SCENDANCE_TEST_CHROME||'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 let otherBrowser;try{otherBrowser=await chromium.launch({headless:true,executablePath:process.env.SCENDANCE_TEST_EDGE||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});}catch(error){await browser.close();throw error;}
 const creator=await browser.newContext({acceptDownloads:true}),reviewer=await otherBrowser.newContext({acceptDownloads:true});
 const html='<!doctype html><meta charset="utf-8"><style>.rsp-plan-stage{width:800px;height:600px;position:relative}.sc-review-pins{position:absolute;inset:0;pointer-events:none}.sc-review-composer{position:absolute;pointer-events:auto}</style><div id="app"></div>';
 for(const context of [creator,reviewer])await context.route('https://feedback-probe.invalid/**',route=>route.fulfill({status:200,contentType:'text/html',body:html}));
 try{
  const owner=await creator.newPage();await owner.goto('https://feedback-probe.invalid/workspace');await owner.addScriptTag({content:built.outputFiles[0].text});
  const url=await owner.evaluate(()=>window.makeShare());assert.ok(url.length>512,'share link must exercise long-link storage');
  const guest=await reviewer.newPage();await guest.goto(url);await guest.addScriptTag({content:built.outputFiles[0].text});await guest.evaluate(()=>window.mountReview());
  await guest.getByRole('img',{name:/平面预览/}).waitFor();await guest.locator('canvas').click({position:{x:400,y:300}});
  await guest.getByRole('textbox',{name:'议题'}).fill('签到区需要复核');await guest.getByRole('button',{name:'钉上'}).click();
  await guest.getByRole('button',{name:'完成评审'}).click();
  const downloadPromise=guest.waitForEvent('download');await guest.getByRole('button',{name:'导出评审反馈'}).click();
  const download=await downloadPromise,bytes=await require('node:fs/promises').readFile(await download.path());
  const receipt=JSON.parse(bytes.toString('utf8'));assert.equal(receipt.completed,true);assert.equal(receipt.pins.length,1);
  assert.equal(await owner.evaluate(()=>localStorage.getItem('scendance-review-share-pins-v2')),null,'feedback must not magically cross browser contexts');
  await owner.evaluate(()=>window.mountAudit());const input=owner.getByLabel('选择反馈 JSON');await input.setInputFiles({name:'反馈.json',mimeType:'application/json',buffer:bytes});
  await owner.getByRole('region',{name:'待导入反馈预览'}).waitFor();assert.match(await owner.locator('body').innerText(),/来源和身份|来源和身份仍需核对|来源和身份/);
  await owner.getByRole('button',{name:'确认导入反馈'}).click();await owner.getByRole('region',{name:'已导入反馈'}).waitFor();
  assert.match(await owner.getByRole('region',{name:'已导入反馈'}).innerText(),/签到区需要复核/);
  assert.match(await owner.getByRole('region',{name:'已导入反馈'}).innerText(),/文件声明：已完成；来源和身份仍需核对/);
  await input.setInputFiles({name:'反馈.json',mimeType:'application/json',buffer:bytes});await owner.getByText(/已有 1 条相同意见/).waitFor();
  await owner.getByRole('button',{name:'确认导入反馈'}).click();await owner.getByText(/已导入 0 条，1 条已存在/).waitFor();
  const before=await owner.evaluate(()=>localStorage.getItem('scendance-review-share-pins-v2'));
  const wrong=Buffer.from(JSON.stringify({...receipt,planVersion:await owner.evaluate(()=>window.otherVersion())}));
  await input.setInputFiles({name:'错误版本.json',mimeType:'application/json',buffer:wrong});await owner.getByText(/其他分享版本/).waitFor();
  await input.setInputFiles({name:'损坏.json',mimeType:'application/json',buffer:Buffer.from('{')});await owner.getByText(/有效 JSON/).waitFor();
  assert.equal(await owner.evaluate(()=>localStorage.getItem('scendance-review-share-pins-v2')),before);
  await input.setInputFiles({name:'反馈.json',mimeType:'application/json',buffer:bytes});await owner.getByRole('region',{name:'待导入反馈预览'}).waitFor();
  await owner.evaluate(()=>window.invalidate());await owner.getByRole('button',{name:'确认导入反馈'}).click();
  assert.equal(await owner.evaluate(()=>localStorage.getItem('scendance-review-share-pins-v2')),before);
  console.log('PASS: long link, isolated Chrome/Edge stores, real pin/export/import, duplicate, wrong version, corrupt file and stale activity');
 }finally{await creator.close();await reviewer.close();await otherBrowser.close();await browser.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
