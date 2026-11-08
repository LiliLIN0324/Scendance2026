// Exercise only the isolated synthetic fixture. The wrapped driver verifies
// base scene and version, no application writes and no external requests.
const fs=require('node:fs');
const path=require('node:path');
const Module=require('node:module');
const original=path.join(__dirname,'verify-30-shared-workbench.cjs');
const port=Number(process.argv[2]);
if(!Number.isSafeInteger(port)||port<1024||port>65535||[4186,4196,4197,4198,4213,4215,4246,4254,4255].includes(port))throw Error('请指定独立模拟试用端口');
process.argv=[process.argv[0],original,String(port),'--synthetic','0'];
let source=fs.readFileSync(original,'utf8');
const pendingNeedle=' const pending=[];';
if(source.split(pendingNeedle).length!==2)throw Error('fixture driver shape changed');
source=source.replace(pendingNeedle,' let eventResponses=0; const pending=[];');
const routeNeedle="  await context.route('**/*',route=>";
if(source.split(routeNeedle).length!==2)throw Error('fixture driver shape changed');
source=source.replace(routeNeedle,"  context.on('response',response=>{const u=new URL(response.url());if(/\\/agent-runs\\/[^/]+\\/events$/.test(u.pathname)&&response.status()===200)eventResponses++;});\n"+routeNeedle);
const verification=String.raw`
  if(!preview)throw Error('event_no_preview');
  await frame.getByText(/根据收到的工具回执整理，可能遗漏步骤/).waitFor({timeout:20000});
  const more=frame.getByRole('button',{name:/共观察到 \d+ 条，展开全部/});
  if(await more.count())await more.click();
  const list=frame.getByRole('list',{name:'执行过程'});
  const required=[['venue','读取场景'],['check','检查候选'],['position','试排双人桌椅'],['candidate','提交候选']];
  const signatures=[];
  for(const [category,label] of required){
   const row=list.locator('li').filter({hasText:label});
   await row.first().waitFor({timeout:10000});
   if(await row.first().getAttribute('data-tool-category')!==category)throw Error('event_category_mismatch');
   if(await row.filter({hasText:'已发起'}).count()===0||await row.filter({hasText:category==='check'?'未完成':'已返回结果'}).count()===0)throw Error('event_status_missing');
   const icon=row.first().locator('.sc-material-symbol');if(await icon.count()!==1)throw Error('event_icon_missing');
   signatures.push(await icon.evaluate(node=>node.innerHTML));
  }
  if(new Set(signatures).size!==required.length)throw Error('event_icons_not_distinct');
  if(eventResponses<1)throw Error('event_api_unobserved');
  const toggle=frame.getByRole('button',{name:'收起执行过程'});await toggle.focus();await page.keyboard.press('Enter');
  if(await frame.getByRole('list',{name:'执行过程'}).count()!==0)throw Error('event_collapse_failed');
  const reopen=frame.getByRole('button',{name:'查看执行过程'});await reopen.focus();await page.keyboard.press('Enter');
  if(await frame.getByRole('list',{name:'执行过程'}).count()!==1)throw Error('event_expand_failed');
  console.log(JSON.stringify({eventUI:'passed',distinctCategories:required.length,keyboardToggle:true,eventApiObserved:true}));
`;
const checkNeedle='  await Promise.all(pending);const after=await project();';
if(source.split(checkNeedle).length!==2)throw Error('fixture driver shape changed');
source=source.replace(checkNeedle,verification+'\n'+checkNeedle);
source=source.replace("'clarification_limit'];console.log", "'clarification_limit','event_no_preview','event_category_mismatch','event_icon_missing','event_icons_not_distinct','event_api_unobserved','event_status_missing','event_collapse_failed','event_expand_failed'];console.log");
// The source file has a main guard; preserve the guard and module-relative requires.
source=source.replace('if(require.main===module)void main();','void main();');
const loaded=new Module(original,module);loaded.filename=original;loaded.paths=module.paths;loaded._compile(source,original);
