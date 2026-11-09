// Synthetic-only fixture; edits a temporary trial copy, never the workspace or provider keys.
const fs=require('node:fs');
const path=require('node:path');
const Module=require('node:module');
if(process.env.SCENDANCE_CHAT_TRIAL_MODE&&process.env.SCENDANCE_CHAT_TRIAL_MODE!=='synthetic')throw Error('仅允许模拟试用');
process.env.SCENDANCE_CHAT_TRIAL_MODE='synthetic';delete process.env.SCENDANCE_CHAT_TRIAL_KEY;delete process.env.SCENDANCE_CHAT_TRIAL_CONFIRM;
const original=path.join(__dirname,'local-chat-trial.cjs');let launcher=fs.readFileSync(original,'utf8');
const marker=' return dest;\n}';if(launcher.split(marker).length!==2)throw Error('fixture launcher shape changed');
const injection=String.raw`
 const synthetic=path.join(dest,'scripts/local-chat-trial-synthetic.ts');
 let source=fs.readFileSync(synthetic,'utf8');
 const start=source.indexOf("   if(receipts.length===0){name='get_scene'");
 const end=source.indexOf('   return Response.json({choices:',start);
 if(start<0||end<0)throw Error('fixture model shape changed');
 source=source.slice(0,start)+String.raw\`
   const initial=JSON.parse(body.messages[1]!.content) as {scene:{objects:Array<{id:string;assetId?:string}>};selectedIds:string[]};
   const target=initial.scene.objects.find(object=>object.id===initial.selectedIds[0]);
   if(!target?.assetId)throw Error('selected fixture asset missing');
   if(receipts.length===0){name='inspect_materials';args={resourceId:target.assetId};}
   else if(receipts.length===1){name='customize_material';args={resourceId:target.assetId,objectIds:[target.id],materialIndices:[0],changes:{baseColor:'#808080'}};}
   else{
    const resource=JSON.parse(receipts.at(-1)!.content) as {items?:Array<[string]>};
    const resourceId=resource.items?.[0]?.[0];if(!resourceId)throw Error('variant fixture missing');
    name='submit_candidates';args={candidates:[{title:'模拟材质候选',explanation:'选中物件的数字材质变化，尚未应用。',commands:[{op:'replace_resource',id:target.id,resourceId}]}]};
   }
 \`+source.slice(end);
 fs.writeFileSync(synthetic,source);
`;
launcher=launcher.replace(marker,injection.replaceAll('\\`','`')+'\n'+marker);
const loaded=new Module(original,module);loaded.filename=original;loaded.paths=module.paths;loaded._compile(launcher,original);
