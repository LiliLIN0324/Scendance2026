// Synthetic-only launcher. Instrumentation is injected into its temporary copy
// and observes the real preview callback without changing production sources.
const fs=require('node:fs');
const path=require('node:path');
const Module=require('node:module');
if((process.env.SCENDANCE_CHAT_TRIAL_MODE||'synthetic')!=='synthetic')throw Error('仅允许隔离模拟试用。');
process.env.SCENDANCE_CHAT_TRIAL_MODE='synthetic';
const original=path.join(__dirname,'local-chat-trial.cjs');
let launcher=fs.readFileSync(original,'utf8');
const marker=' return dest;\n}';
if(launcher.split(marker).length!==2)throw Error('试用副本入口不匹配。');
const instrumentation=String.raw`
 const file=path.join(dest,'frontend/components/room-organizer/room-organizer.tsx');
 let source=fs.readFileSync(file,'utf8');
 const marker='  const onPreviewAi = useCallback((candidate: RoomLayout | null) => {';
 if(source.split(marker).length!==2)throw Error('预览观察入口不匹配。');
 source=source.replace(marker,marker+'\n    window.dispatchEvent(new CustomEvent("scendance:test-observed-preview",{detail:candidate ? structuredClone(candidate) : null}));');
 const memoryMarker='onBriefMemoryChange={(memory,sessionId) => {';
 if(source.split(memoryMarker).length!==2)throw Error('需求观察入口不匹配。');
 source=source.replace(memoryMarker,memoryMarker+'\n        window.dispatchEvent(new CustomEvent("scendance:test-observed-memory",{detail:structuredClone(memory)}));');
 fs.writeFileSync(file,source);
`;
const cooperative=String.raw`
 const fixture=path.join(dest,'scripts/local-chat-trial-synthetic.ts');
 let mock=fs.readFileSync(fixture,'utf8');
 const needle="  const output=message==='30人，每3人一桌，采用课桌椅，生成本地草案'?{";
 if(mock.split(needle).length!==2)throw Error('模拟模型入口不匹配。');
 mock=mock.replace(needle,"  const output=message==='请保留原有物件'?{extraction:{},reply:'我会保留原有物件。',unhandled:[],factEvidence:[]}:message==='30人，每3人一桌，采用课桌椅，生成本地草案'?{");
 fs.writeFileSync(fixture,mock);
`;
launcher=launcher.replace(marker,instrumentation+(process.env.SCENDANCE_E2E_COOPERATIVE==='1'?cooperative:'')+'\n'+marker);
const loaded=new Module(original,module);loaded.filename=original;loaded.paths=module.paths;loaded._compile(launcher,original);
