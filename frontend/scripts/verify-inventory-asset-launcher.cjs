// Creates a synthetic-only trial copy with two isolated, generated assets.
// This never edits the source fixture or accesses a real account/database.
const fs=require('node:fs');
const path=require('node:path');
const original=path.join(__dirname,'local-chat-trial.cjs');
let launcher=fs.readFileSync(original,'utf8');
const needle=' return dest;\n}';
if(!launcher.includes(needle))throw Error('fixture launcher shape changed');
const injection=String.raw`
 const localServer=path.join(dest,'tests/local-server.ts');
 let serverSource=fs.readFileSync(localServer,'utf8');
 serverSource="import {createParametricAsset} from '../supabase/functions/_shared/parametric.ts';\nimport {studio} from './fixtures.ts';\n"+serverSource;
 const marker='  const env = (key: string) => ({';
 if(!serverSource.includes(marker))throw Error('fixture server shape changed');
 serverSource=serverSource.replace(marker,"  await createParametricAsset(backend,owner,studio,'90000000-0000-4000-8000-000000000001',{family:'chair',width:0.5,depth:0.5,height:0.85});\n  await createParametricAsset(backend,owner,studio,'90000000-0000-4000-8000-000000000002',{family:'chair',width:0.6,depth:0.5,height:0.85});\n"+marker);
 fs.writeFileSync(localServer,serverSource);
 const synthetic=path.join(dest,'scripts/local-chat-trial-synthetic.ts');
 let source=fs.readFileSync(synthetic,'utf8');
 source=source.replace('export const syntheticChatTransport','let candidateRun=0;\nexport const syntheticChatTransport');
 const start=source.indexOf("   if(receipts.length===0){name='get_scene'");
 const end=source.indexOf('   return Response.json({choices:',start);
 if(start<0||end<0)throw Error('fixture model shape changed');
 source=source.slice(0,start)+String.raw\`
   if(receipts.length===0){candidateRun++;name='search_resources';args={query:'参数模型'};}
   else if(receipts.length===1){name='find_free_areas';args={width:0.7,depth:0.7,clearance:0.3,limit:1};}
   else{
    const resources=JSON.parse(receipts[0]!.content) as {items:Array<[string,string,string,unknown]>};
    const rows=resources.items.filter(row=>row[0].startsWith('asset:')).sort((a,b)=>a[0].localeCompare(b[0]));
    if(rows.length!==2)throw Error('expected two generated assets');
    const result=JSON.parse(receipts.at(-1)!.content) as {sites?:Array<{x:number;z:number}>};const site=result.sites?.[0];
    name='submit_candidates';args={candidates:[site?{title:'测试资产候选',explanation:'虚构场景和参数模型，仅用于库存验证。',commands:[{op:'add_resource',resourceId:rows[candidateRun<=2?0:1]![0],position:{x:site.x,z:site.z},rotation:0,size:{width:0.5,depth:0.5,height:0.85}}]}:{title:'暂无空位',explanation:'虚构场景未找到空位。',commands:[]}]};
   }
 \`+source.slice(end);
 fs.writeFileSync(synthetic,source);
`;
launcher=launcher.replace(needle,injection.replaceAll('\\`','`')+'\n'+needle);
if((process.env.SCENDANCE_CHAT_TRIAL_MODE||'synthetic')!=='synthetic')throw Error('仅允许模拟试用');
// Compile in the original script location so its relative dependencies resolve unchanged.
const Module=require('node:module');const m=new Module(original,module);m.filename=original;m.paths=module.paths;m._compile(launcher,original);
