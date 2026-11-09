// Synthetic-only launcher: modifies the conversation fixture in its isolated copy.
const fs=require('node:fs');
const path=require('node:path');
const original=path.join(__dirname,'local-chat-trial.cjs');
let launcher=fs.readFileSync(original,'utf8');
const needle=' return dest;\n}';
if(!launcher.includes(needle))throw Error('fixture launcher shape changed');
const injection=String.raw`
 const file=path.join(dest,'scripts/local-chat-trial-synthetic.ts');let source=fs.readFileSync(file,'utf8');
 const old="}:message==='为30人办室内讲座，场地长10米宽8米，采用课桌椅布局，生成方案'||";
 const next="}:message==='为30人办室内讲座，场地长10米宽8米，采用课桌椅布局'||message==='为30人办室内讲座，场地长10米宽8米，采用课桌椅布局，生成方案'||";
 if(!source.includes(old))throw Error('conversation fixture shape changed');
 fs.writeFileSync(file,source.replace(old,next));
`;
launcher=launcher.replace(needle,injection+'\n'+needle);
if((process.env.SCENDANCE_CHAT_TRIAL_MODE||'synthetic')!=='synthetic')throw Error('仅允许模拟试用');
const Module=require('node:module');const m=new Module(original,module);m.filename=original;m.paths=module.paths;m._compile(launcher,original);
