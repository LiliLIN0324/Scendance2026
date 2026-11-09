const test=require('node:test');
const assert=require('node:assert/strict');
const {spawnSync}=require('node:child_process');
const {join}=require('node:path');
const {classifyQuestion,summarizeUi,safeUiExcerpt,summarizeBriefExtract,summarizeCandidate,verifyDeliveryRows}=require('./verify-live-agent-workbench.cjs');

test('confirms only facts explicitly stated by the fictional sample',()=>{
 assert.equal(classifyQuestion('以下信息还需核对：人数 30、室内外 室内、场地长（米） 10、场地宽（米） 8、布置方式 课桌椅。这样对吗？回复「确认」或「不对」。').reply,'确认');
 assert.equal(classifyQuestion('以下信息还需核对：人数 2。这样对吗？回复「确认」或「不对」。').kind,'fact_mismatch');
 assert.equal(classifyQuestion('以下信息还需核对：人数 30、每桌人数 2。这样对吗？回复「确认」或「不对」。').kind,'needs_clarification');
 assert.equal(classifyQuestion('以下信息还需核对：人数 30、人数 30。这样对吗？回复「确认」或「不对」。').kind,'needs_clarification');
 assert.equal(classifyQuestion('刚才的本场人数、场地长宽（单位：米）无法确定，请重新说明；回复「确认」不能代替具体信息。').reply,'本场总人数30人，场地长10米宽8米');
 assert.equal(classifyQuestion('每桌安排多少人？').kind,'needs_clarification');
 assert.equal(classifyQuestion('是否需要签到？').kind,'needs_clarification');
 const deferred=classifyQuestion('关于活动需求，我理解为所有人都需要座位。这样对吗？回复「确认」或「不对」。');
 assert.deepEqual(deferred,{kind:'reply',reply:'是否人人有座尚未决定，可以先按现有信息探索。',key:'defer_all_seated'});
 assert.deepEqual(classifyQuestion('已记录（待核对）：30人。关于活动需求，我理解为所有人都需要座位。这样对吗？回复「确认」或「不对」。'),deferred);
 for(const question of ['关于活动需求，我理解为所有人都需要座位、需要签到区。这样对吗？回复「确认」或「不对」。','关于活动需求，我理解为不要求所有人入座。这样对吗？回复「确认」或「不对」。','是否需要签到？'])assert.equal(classifyQuestion(question).kind,'needs_clarification');
});
test('fictional UI excerpt preserves useful Chinese while removing links, tokens and long numbers',()=>{
 assert.equal(safeUiExcerpt('请确认预计30人，场地长10米宽8米。'),'请确认预计30人，场地长10米宽8米。');
 for(const input of ['密钥sk-secret','令牌：123456789','密码：1234','Authorization: abc123','请用 API Key abc','请用 token abc'])assert.equal(safeUiExcerpt(input),null);
 const output=safeUiExcerpt('场地面积 80m²，请查看 https://example.com/abc 及 codeABC123，编号123456789。');
 assert.ok(output?.includes('场地面积'));for(const privateValue of ['https','example','abc','codeABC123','123456789'])assert.equal(output.includes(privateValue),false);
 assert.equal(safeUiExcerpt('短消息'+ '字'.repeat(200))?.length,160);
 assert.equal(safeUiExcerpt('含\u0000控制字符'),'含 控制字符');
});
test('extract diagnostics retain only whitelisted flags and exact generation-evidence match',()=>{
 const input={enabled:true,extraction:{headcount:30,lengthM:10,widthM:8,areaM2:null,secret:'never-print'},unhandled:[{kind:'action',evidence:'生成方案'},{kind:'other',evidence:'private'}, {kind:'secret',evidence:'private'}],reply:'never-print'};
 const result=summarizeBriefExtract(input,200);
 assert.deepEqual(result,{responseStatus:200,validObject:true,enabled:true,fields:{headcount:true,lengthM:true,widthM:true,areaM2:false},unhandled:[{kind:'action',evidenceIsGenerate:true},{kind:'other',evidenceIsGenerate:false},{kind:'unknown',evidenceIsGenerate:false}]});
 assert.equal(JSON.stringify(result).includes('private'),false);assert.equal(JSON.stringify(result).includes('never-print'),false);
 assert.deepEqual(summarizeBriefExtract(null,503),{responseStatus:503,validObject:false});
});
test('candidate observation is aggregate only and never claims independent geometry verification',()=>{
 const object=(id,materialId,x=0)=>({id,materialId,position:{x,z:1},rotation:0,size:{width:1,depth:1,height:1},notes:'private'});
 const base={objects:[object('existing-a','chair'),object('existing-b','table')]};
 const candidate={objects:[object('existing-a','chair',2),object('new-a','chair'),object('new-b','table'),object('new-c','asset')]};
 const value={proposal:{base_scene:structuredClone(base),candidate,warnings:[{code:'OVERLAP',ids:['private']},{code:'SAFETY_CHECKS_UNKNOWN',ids:[]},{code:'SEATING_HEADCOUNT_UNVERIFIED',ids:[]},{code:'SEATING_SHORTFALL:30:10:object_limit',ids:[]},{code:'secret',ids:[]}]}};
 const result=summarizeCandidate(base,value);
 assert.deepEqual(result,{status:'observed',baseMatches:true,baseCount:2,candidateCount:4,added:3,removed:1,changed:1,addedTypes:{chairs:1,tables:1,assets:1,other:0},candidateTypes:{builtinChairs:2,unknownAssets:1},geometryFields:'present',reportedWarningCounts:{OVERLAP:1,SAFETY_CHECKS_UNKNOWN:1,SEATING_HEADCOUNT_UNVERIFIED:1,SEATING_SHORTFALL:1},independentGeometryCheck:'not_run'});
 for(const hidden of ['existing-a','new-a','private','secret'])assert.equal(JSON.stringify(result).includes(hidden),false);
 assert.deepEqual(summarizeCandidate(base,{proposal:{candidate:{objects:[object('new-a','chair'),object('NEW-A','chair')]}}}),{status:'unavailable'});
});
test('downloaded rows independently match read-back built-in material, dimensions and count',()=>{
 const scene={objects:[{materialId:'chair',size:{width:.5,depth:.5,height:.85}},{materialId:'chair',size:{width:.5,depth:.5,height:.85}},{materialId:'table',size:{width:1.2,depth:.6,height:.75}}]};
 const rows=[{name:'椅子',source:'内置模型',size:[.5,.5,.85],quantity:2},{name:'桌子',source:'内置模型',size:[1.2,.6,.75],quantity:1}];
 assert.deepEqual(verifyDeliveryRows(scene,rows),{status:'matched',expectedObjects:3,listedObjects:3,groupsCompared:2,scope:'builtin_name_and_dimensions'});
 assert.equal(verifyDeliveryRows(scene,[{...rows[0],quantity:1},rows[1]]).status,'mismatch');
 assert.equal(verifyDeliveryRows(scene,[{...rows[0],size:[.6,.5,.85]},rows[1]]).status,'mismatch');
 assert.equal(verifyDeliveryRows(scene,[{...rows[0],name:'桌子'},rows[1]]).status,'mismatch');
 assert.equal(verifyDeliveryRows({objects:[{materialId:'asset',size:{width:1,depth:1,height:1}}]},rows).status,'unsupported');
 assert.equal(verifyDeliveryRows(scene,[...rows,{name:'未知',source:'内置模型',size:[1,1,1],quantity:1}]).status,'unsupported');
});
test('zero-placement fixture cannot be enabled in live mode',()=>{
 const result=spawnSync(process.execPath,[join(__dirname,'verify-live-agent-workbench.cjs'),'4269','--live','0','--synthetic-zero'],{encoding:'utf8',timeout:5000});
 assert.equal(result.status,2);assert.doesNotMatch(result.stdout,/preview|zero_placement_observed/);
});
test('UI summaries are fixed strings and never echo the model text',()=>{
 const secret='sk-example-secret-that-must-never-appear';
 for(const input of [secret,`是否需要签到？${secret}`,`正在理解活动需求 ${secret}`]){
  const result=summarizeUi(input);assert.equal(result.includes(secret),false);
 }
 assert.equal(summarizeUi('请先说明本场预计人数，再生成布置方案。'),'等待核对已明确的虚构样本信息');
});
