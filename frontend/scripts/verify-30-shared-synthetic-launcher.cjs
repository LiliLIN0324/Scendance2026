// Isolated fixed-model fixture for verify-30-shared-workbench.cjs. No network.
const fs=require('node:fs');
const path=require('node:path');
const original=path.join(__dirname,'local-chat-trial.cjs');
let launcher=fs.readFileSync(original,'utf8');
const needle=' return dest;\n}';
if(!launcher.includes(needle))throw Error('fixture launcher shape changed');
const injection=String.raw`
 const file=path.join(dest,'scripts/local-chat-trial-synthetic.ts');let source=fs.readFileSync(file,'utf8');
 const start=source.indexOf("   if(receipts.length===0){name='get_scene'");
 const end=source.indexOf('   return Response.json({choices:',start);
 if(start<0||end<0)throw Error('fixture model shape changed');
 source=source.slice(0,start)+String.raw\`
   if(receipts.length===0){name='prepare_shared_seating_candidate';args={layout:'two_people_per_desk',count:30,deskSize:{width:1.2,depth:0.5,height:0.75},chairSize:{width:0.45,depth:0.5,height:0.85},deskChairGap:0.1,chairGap:0.1,columnGap:0.2,rowGap:0.2,edgeClearance:0.2};}
   else{const result=JSON.parse(receipts.at(-1)!.content) as {preparedId?:string};name='submit_candidates';args={candidates:[result.preparedId?{preparedId:result.preparedId}:{title:'没有候选',explanation:'本次场地未找到可试排位置，请调整条件。',commands:[]}]};}
 \`+source.slice(end);
 const old="}:message==='为30人办室内讲座，场地长10米宽8米，采用课桌椅布局，生成方案'||";
 const replacement="}:message==='为30人办室内讲座，场地长10米宽8米，每2人一桌，采用课桌椅布局，生成方案'||message==='为30人办室内讲座，场地长10米宽8米，采用课桌椅布局，生成方案'||";
 if(!source.includes(old))throw Error('conversation fixture shape changed');
 fs.writeFileSync(file,source.replace(old,replacement));
`;
launcher=launcher.replace(needle,injection.replaceAll('\\`','`')+'\n'+needle);
if((process.env.SCENDANCE_CHAT_TRIAL_MODE||'synthetic')!=='synthetic')throw Error('仅允许模拟试用');
const Module=require('node:module');const m=new Module(original,module);m.filename=original;m.paths=module.paths;m._compile(launcher,original);
