// Isolated fictional run with four real tool executions; never contacts a model provider.
const fs=require('node:fs');
const path=require('node:path');
const Module=require('node:module');
const original=path.join(__dirname,'verify-30-shared-synthetic-launcher.cjs');
let source=fs.readFileSync(original,'utf8');
const first="   if(receipts.length===0){name='prepare_shared_seating_candidate';args={layout:'two_people_per_desk',count:30,deskSize:{width:1.2,depth:0.5,height:0.75},chairSize:{width:0.45,depth:0.5,height:0.85},deskChairGap:0.1,chairGap:0.1,columnGap:0.2,rowGap:0.2,edgeClearance:0.2};}";
const replacement=`   if(receipts.length===0){name='get_scene';args={};}
   else if(receipts.length===1){name='validate_candidate';args={title:'测试无效位置',explanation:'仅验证错误回执',commands:[{op:'add',materialId:'chair',position:{x:100,z:100},rotation:0,color:'#ffffff'}]};}
   else if(receipts.length===2){name='prepare_shared_seating_candidate';args={layout:'two_people_per_desk',count:30,deskSize:{width:1.2,depth:0.5,height:0.75},chairSize:{width:0.45,depth:0.5,height:0.85},deskChairGap:0.1,chairGap:0.1,columnGap:0.2,rowGap:0.2,edgeClearance:0.2};}`;
if(source.split(first).length!==2)throw Error('fixture model shape changed');
source=source.replace(first,replacement);
if((process.env.SCENDANCE_CHAT_TRIAL_MODE||'synthetic')!=='synthetic')throw Error('仅允许模拟试用');
const loaded=new Module(original,module);loaded.filename=original;loaded.paths=module.paths;loaded._compile(source,original);
