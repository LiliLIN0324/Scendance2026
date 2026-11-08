#!/usr/bin/env node
// Offline baseline over existing tests. No provider, credentials, or user projects.
// A passing assertion is evidence for that assertion only, not an Agent success rate.
const {spawnSync}=require('node:child_process');
const {randomUUID}=require('node:crypto');
const {readFileSync,unlinkSync}=require('node:fs');
const {tmpdir}=require('node:os');
const path=require('node:path');

const root=path.resolve(__dirname,'../..');
const groups=[
 {id:'frontend',cwd:path.join(root,'frontend'),files:[
  'lib/agent-resolver.test.ts',
  'components/room-organizer/lib/brief-agent.test.ts',
  'components/room-organizer/lib/brief-agent-intelligence.test.ts',
  'components/room-organizer/lib/candidate-inventory.test.ts',
  'lib/g402-silver-simulation.test.ts',
 ]},
 {id:'backend',cwd:root,files:['tests/agent-shared-seating-cloud-e2e.test.ts','tests/agent-candidate-review.test.ts']},
];

// Select human-labelled assertions, never classify an absent, skipped or failed assertion as a pass.
const cases=[
 {id:'attendance_30_ratio_2',title:'30 人与每桌 2 人不混淆',checks:[
  {kind:'requirements',group:'frontend',file:'agent-resolver.test.ts',title:'accepts the actual attendance count with desk ratio:',min:2},
  {kind:'requirements',group:'frontend',file:'agent-resolver.test.ts',title:'does not take the per-desk count as total attendance:',min:3},
 ]},
 {id:'deferred_checkin',title:'签到待定可继续探索但仍为未知',checks:[
  {kind:'requirements',group:'frontend',file:'brief-agent-intelligence.test.ts',title:'明确延期后继续收集需求并允许探索，决定仍保持未知',min:1},
 ]},
 {id:'reported_inventory',title:'口述椅子数量不自动成为已核验库存',checks:[
  {kind:'requirements',group:'frontend',file:'brief-agent.test.ts',title:'carries an earlier 80-chair user statement as an unverified, unselected clue',min:1},
  {kind:'outcome',group:'frontend',file:'candidate-inventory.test.ts',title:'无库存、身份不明或规格不同均为 unknown，不能按名称猜测',min:1},
 ]},
 {id:'missing_and_conflicting_facts',title:'人数冲突和场地/库存缺失保持待核对',checks:[
  {kind:'requirements',group:'frontend',file:'agent-resolver.test.ts',title:'asks again when a single clause contains different attendance counts:',min:5},
  {kind:'outcome',group:'frontend',file:'g402-silver-simulation.test.ts',title:'does not treat missing inventory or a missing actual room scale as verified',min:1},
 ]},
 {id:'shared_seating_and_shortage',title:'双人桌候选、数量缺口和原场景回读',checks:[
  {kind:'tool',group:'backend',file:'agent-shared-seating-cloud-e2e.test.ts',title:'preserves 5 existing objects and reports the actual object limit',min:1},
  {kind:'outcome',group:'backend',file:'agent-shared-seating-cloud-e2e.test.ts',title:'preserves 6 existing objects and reports the actual object limit',min:1},
  {kind:'outcome',group:'frontend',file:'g402-silver-simulation.test.ts',title:'reports the simulated five-chair shortage without changing the candidate',min:1},
 ]},
 {id:'locked_and_original_scene',title:'锁定物件、原场景和几何冲突独立复核',checks:[
  {kind:'outcome',group:'backend',file:'agent-candidate-review.test.ts',title:'rejects boundary changes, lock violations, unselected edits and hidden empty-action edits',min:1},
  {kind:'outcome',group:'backend',file:'agent-candidate-review.test.ts',title:'rejects new overlap and increased overlap, but leaves existing conflict unknown',min:1},
 ]},
];

function summarize(reports,elapsedMs,executions={}){
 const all=[];
 for(const [group,report] of Object.entries(reports))for(const file of report?.testResults??[]){
  const name=String(file.name??'').replaceAll('\\','/');
  for(const test of file.assertionResults??[])all.push({group,file:name,title:String(test.title??''),status:test.status,durationMs:Number.isFinite(test.duration)?Math.max(0,Math.round(test.duration)):null});
 }
 const results=cases.map(test=>{
  const evidence=test.checks.map(check=>{
   const matches=all.filter(x=>x.group===check.group&&x.file.endsWith('/'+check.file)&&x.title.includes(check.title));
   const state=matches.length<check.min?'missing':matches.every(x=>x.status==='passed')?'passed':'failed';
   return {kind:check.kind,source:`${check.group}/${check.file}`,matched:matches.length,expectedAtLeast:check.min,status:state,durationMs:matches.reduce((sum,x)=>sum+(x.durationMs??0),0)};
  });
  return {id:test.id,title:test.title,status:evidence.every(x=>x.status==='passed')?'passed':evidence.some(x=>x.status==='failed')?'failed':'missing',
   requirements:evidence.filter(x=>x.kind==='requirements'),toolExecution:evidence.filter(x=>x.kind==='tool'),outcomeVerification:evidence.filter(x=>x.kind==='outcome')};
 });
 const suites=groups.map(group=>({id:group.id,status:executions[group.id]??(reports[group.id]?.success===true?'passed':'unknown')}));
 const passed=results.filter(x=>x.status==='passed').length;
 return {mode:'offline-synthetic',model:'fixed-fixture-not-real-model',externalRequests:'not-performed-by-selected-fixtures',durationMs:elapsedMs,
  limitations:['组件与隔离数据库测试，不代表真实模型或现场成功率','未对真实库存、消防、无障碍和场地方确认做验收','工具调用与最终结果分开列示，空数组表示本案例未测该层'],
  status:passed===results.length&&suites.every(x=>x.status==='passed')?'passed':'incomplete',suites,passed,total:results.length,results};
}

function run(){
 const started=Date.now(),reports={},executions={};
 for(const group of groups){
  const target=path.join(tmpdir(),`scendance-agent-eval-${randomUUID()}.json`);
  try{
   const vitest=path.join(group.cwd,'node_modules','vitest','vitest.mjs');
   const nodeOptions=[process.env.NODE_OPTIONS,Number(process.versions.node.split('.')[0])>=26?'--no-webstorage':null].filter(Boolean).join(' ');
   const options={cwd:group.cwd,encoding:'utf8',maxBuffer:16*1024*1024,env:{...process.env,NODE_OPTIONS:nodeOptions}};
   const child=spawnSync(process.execPath,[vitest,'run',...group.files,'--reporter=json',`--outputFile.json=${target}`],options);
   if(child.error)throw child.error;
   try{reports[group.id]=JSON.parse(readFileSync(target,'utf8'));}catch{reports[group.id]={testResults:[]};}
   executions[group.id]=child.status===0&&reports[group.id].success===true?'passed':'failed';
  }finally{try{unlinkSync(target);}catch{/* No report was created. */}}
 }
 const report=summarize(reports,Date.now()-started,executions);
 process.stdout.write(JSON.stringify(report,null,2)+'\n');
 if(report.status!=='passed')process.exitCode=1;
}
if(require.main===module)run();
module.exports={summarize,cases};
