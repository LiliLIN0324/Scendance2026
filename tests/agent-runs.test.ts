import {afterAll,beforeAll,describe,expect,it,vi} from 'vitest';
import {database,owner,editor,outsider,studio,session,scene,chair} from './fixtures.ts';
import {createApi} from '../supabase/functions/_shared/api.ts';
import {agentRunRequestSchema,agentRunSchema} from '../supabase/functions/_shared/agent-contract.ts';
import {agentExecutionMode} from '../supabase/functions/_shared/agent-runner.ts';
import {evaluateCandidates} from '../supabase/functions/_shared/jev.ts';
import {ApiError,canonical,sceneHash,sha256} from '../supabase/functions/_shared/domain.ts';
import {generationCapabilities} from '../supabase/functions/_shared/generation-contract.ts';
import {prepareGenerationRequest} from '../supabase/functions/_shared/generation-input.ts';
const env=(key:string)=>({DEEPSEEK_API_KEY:'fixture',TOKENDANCE_API_KEY:'fixture',HY3_RETIRED:'true'}[key]);
const plan=(x=2)=>({title:`布局 ${x}`,explanation:'已规划桌子，待程序应用。',commands:[{op:'add',materialId:'table',position:{x,z:3},rotation:0,color:'#ffffff'}]});
const tool=(name:string,args:unknown,id:string=crypto.randomUUID())=>({id,type:'function',function:{name,arguments:JSON.stringify(args)}});
const completion=(calls:ReturnType<typeof tool>[])=>new Response(JSON.stringify({choices:[{finish_reason:'tool_calls',message:{content:null,tool_calls:calls}}],usage:{total_tokens:10}}));

describe('durable bounded DeepSeek Agent',()=>{
 let f:Awaited<ReturnType<typeof database>>;
 beforeAll(async()=>{f=await database();},30000);afterAll(async()=>{await f.db.close();});
 async function input(extra:Record<string,unknown>={}) {const base=scene(),p=await f.rpc(owner,'projects.create',{studioId:studio,name:'Agent test',scene:base});const lease=await f.rpc(owner,'lease.acquire',{projectId:p.id,sessionId:session});return {projectId:p.id,...agentRunRequestSchema.parse({requestId:crypto.randomUUID(),sessionId:session,generation:lease.generation,expectedRevision:0,localRevision:0,scene:base,selectedIds:[],instruction:'直接添加桌子',executionMode:'direct',...extra})};}
 function send(api:ReturnType<typeof createApi>,i:Awaited<ReturnType<typeof input>>) {const {projectId,...body}=i;return api(new Request(`https://api.test/projects/${projectId}/agent-runs`,{method:'POST',headers:{authorization:`Bearer ${owner}`,'content-type':'application/json'},body:JSON.stringify(body)}));}
 it('runs read tool then submit, stores original draft, replays without calling again, applies one undo group',async()=>{
  const i=await input(),fetcher=vi.fn(async()=>fetcher.mock.calls.length===1?completion([tool('get_scene',{})]):completion([tool('submit_candidates',{candidates:[plan()]})]));
  const api=createApi(f.backend,env,fetcher),res=await send(api,i);expect(res.status).toBe(202);const run=agentRunSchema.parse(await res.json());expect(run).toMatchObject({state:'complete',callCount:2,executionMode:'direct'});expect(run.candidates).toHaveLength(1);
  const replay=await send(api,i);expect(replay.status).toBe(200);expect((await replay.json()).id).toBe(run.id);expect(fetcher).toHaveBeenCalledTimes(2);
  const p=run.candidates[0].proposal;expect(p.base_scene).toEqual(i.scene);
  const applied=await f.rpc(owner,'proposals.apply',{...i,proposalId:p.id,baseHash:await sceneHash(i.scene)});expect(applied.scene.objects).toHaveLength(1);expect(applied.previousScene).toEqual(i.scene);expect(applied.undoGroup).toBe(p.id);
 });
 it.each([
  {colors:['#ff0000','#0000ff'],groups:2},
  {colors:['#ff0000','#ff0000'],groups:1},
 ])('reports draft BOM colors without merging different specifications: $colors',async({colors,groups})=>{
  const draft={...scene(),objects:colors.map((color,index)=>({...chair(),color,position:{x:2+index*3,z:2}}))};
  const i=await input({scene:draft,instruction:'仅统计当前草稿物料，不修改场景',executionMode:'preview'});
  const cloudBefore=(await f.rpc(owner,'projects.get',{projectId:i.projectId})).scene;
  let bom:{items:{color:string;quantity:number;size:unknown}[];pricing:string}={items:[],pricing:''};
  const fetcher=vi.fn(async(_url,init)=>{
   if(fetcher.mock.calls.length===1)return completion([tool('get_bom',{})]);
   const receipt=JSON.parse(String(init?.body)).messages.find((message:{role:string})=>message.role==='tool');
   bom=JSON.parse(receipt.content);
   return completion([tool('submit_candidates',{candidates:[{title:'物料统计',explanation:'按草稿统计，价格和库存待核实。',commands:[]}]})]);
  });
  const run=agentRunSchema.parse(await (await send(createApi(f.backend,env,fetcher),i)).json());
  expect(run).toMatchObject({state:'complete',callCount:2,executionMode:'preview'});
  expect(bom.items).toHaveLength(groups);
  expect(bom.items.map(({color,quantity})=>({color,quantity}))).toEqual(groups===1
   ?[{color:colors[0],quantity:2}]:colors.map(color=>({color,quantity:1})));
  expect(bom.items.every(item=>canonical(item.size)===canonical(draft.objects[0].size))).toBe(true);
  expect(bom.pricing).toMatch(/未提供.*价格.*库存/);
  expect(run.candidates[0].proposal.base_scene).toEqual(draft);
  expect((await f.rpc(owner,'projects.get',{projectId:i.projectId})).scene).toEqual(cloudBefore);
 });
 it('holds 3 independent candidates for JEV and never direct-applies them',async()=>{
  const i=await input({jevEnabled:true}),fetcher=vi.fn(async(url)=>String(url).includes('systemone')?new Response(JSON.stringify({answers:{recommended_plan:{type:'choice',choice:'B',probabilities:{A:0.2,B:0.6,C:0.1,NONE:0.1},confidence:0.7}}})):completion([tool('submit_candidates',{candidates:[plan(2),plan(5),plan(8)]})]));
  const res=await send(createApi(f.backend,env,fetcher),i),run=agentRunSchema.parse(await res.json());expect(run.executionMode).toBe('preview');expect(run.candidates).toHaveLength(3);expect(run.evaluation?.choice).toBe('B');expect(run.candidates.every(c=>c.proposal.base_hash===run.candidates[0].proposal.base_hash)).toBe(true);expect((await f.rpc(owner,'projects.get',{projectId:i.projectId})).scene.objects).toHaveLength(0);
 });
 it.each([false,true])('requires submission on turn 6 after reading and validating, JEV=%s',async(jevEnabled)=>{
  const i=await input({jevEnabled}),candidates=jevEnabled?[plan(2),plan(5),plan(8)]:[plan()];
  const requests:{tool_choice:unknown;thinking:unknown}[]=[];
  const fetcher=vi.fn(async(url,init)=>{
   if(String(url).includes('systemone'))return new Response(JSON.stringify({answers:{recommended_plan:{type:'choice',choice:'B',probabilities:{A:0.2,B:0.6,C:0.1,NONE:0.1},confidence:0.7}}}));
   const request=JSON.parse(String(init?.body));requests.push(request);
   if(requests.length<=4)return completion([tool(requests.length%2?'get_scene':'get_bom',{})]);
   if(requests.length===6&&request.tool_choice?.function?.name==='submit_candidates')return completion([tool('submit_candidates',{candidates})]);
   return completion(candidates.map(candidate=>tool('validate_candidate',candidate)));
  });
  const run=agentRunSchema.parse(await (await send(createApi(f.backend,env,fetcher),i)).json());
  expect(run).toMatchObject({state:'complete',callCount:6,executionMode:jevEnabled?'preview':'direct'});
  expect(requests).toHaveLength(6);expect(requests.slice(0,5).every(request=>request.tool_choice==='auto')).toBe(true);
  expect(requests[5]).toMatchObject({tool_choice:{type:'function',function:{name:'submit_candidates'}},thinking:{type:'disabled'}});
  expect(run.candidates).toHaveLength(candidates.length);expect(run.evaluation?.choice??null).toBe(jevEnabled?'B':null);
  expect(run.candidates.every(candidate=>canonical(candidate.proposal.base_scene)===canonical(i.scene))).toBe(true);
  expect((await f.rpc(owner,'projects.get',{projectId:i.projectId})).scene).toEqual(i.scene);
 });
 it('preserves valid partial candidates when the repair call fails',async()=>{
  const i=await input({jevEnabled:true});let n=0;
  const fetcher=vi.fn(async()=>++n===1?completion([tool('submit_candidates',{candidates:[plan(2),plan(5),{bad:true}]})]):new Response('{}',{status:503}));
  const run=agentRunSchema.parse(await (await send(createApi(f.backend,env,fetcher),i)).json());expect(run.state).toBe('complete');expect(run.candidates).toHaveLength(2);expect(run.evaluation?.status).toBe('partial');expect(run.evaluation?.probabilities).toBeUndefined();
 });
 it('does not erase valid candidates if repair produces only invalid candidates',async()=>{
  const i=await input({jevEnabled:true});let n=0;const fetcher=vi.fn(async()=>completion([tool('submit_candidates',{candidates:++n===1?[plan(2),plan(5),{}]:[{}]})]));
  const run=agentRunSchema.parse(await (await send(createApi(f.backend,env,fetcher),i)).json());expect(run.candidates).toHaveLength(2);expect(run.evaluation?.status).toBe('partial');
 });
 it('forces only one candidate with JEV off even when model repeats three',async()=>{
  const i=await input();const fetcher=vi.fn(async()=>completion([tool('submit_candidates',{candidates:[plan(2),plan(5),plan(8)]})]));
  const run=agentRunSchema.parse(await (await send(createApi(f.backend,env,fetcher),i)).json());expect(run.candidates).toHaveLength(1);expect(run.evaluation).toBeNull();expect(fetcher).toHaveBeenCalledTimes(2);
 });
 it('supports a server feature flag back to the prior proposal flow without re-enabling HY3',async()=>{
  const i=await input({jevEnabled:true});const fetcher=vi.fn(async()=>new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify({explanation:'兼容方案',commands:plan().commands})}}],usage:{total_tokens:10}})));
  const run=agentRunSchema.parse(await (await send(createApi(f.backend,key=>key==='DEEPSEEK_AGENT_MODE'?'legacy':env(key),fetcher),i)).json());expect(run.state).toBe('complete');expect(run.executionMode).toBe('preview');expect(run.candidates).toHaveLength(1);expect(run.evaluation?.status).toBe('partial');expect(fetcher).toHaveBeenCalledOnce();
 });
 it('stops after 6 calls and replays a terminal failed request without rerunning',async()=>{
  const i=await input(),fetcher=vi.fn(async()=>completion([tool('validate_candidate',plan())]));const api=createApi(f.backend,env,fetcher);
  const run=agentRunSchema.parse(await (await send(api,i)).json());expect(run).toMatchObject({state:'failed',callCount:6,errorCode:'AGENT_NO_VALID_CANDIDATE',candidates:[]});await send(api,i);expect(fetcher).toHaveBeenCalledTimes(6);
 });
 it('cancellation during model call prevents tool effects and further calls',async()=>{
  const i=await input();const fetcher=vi.fn(async()=>{const run=await f.backend.agent!(owner,'by_request',{projectId:i.projectId,requestId:i.requestId});await f.backend.agent!(owner,'cancel',{projectId:i.projectId,id:run.id});return completion([tool('create_parametric_model',{parameters:{family:'table',width:1,depth:1,height:1}}),tool('submit_candidates',{candidates:[plan()]})]);});
  const run=agentRunSchema.parse(await (await send(createApi(f.backend,env,fetcher),i)).json());expect(run.state).toBe('cancelled');expect(run.candidates).toEqual([]);expect(fetcher).toHaveBeenCalledOnce();
 });
 it('rejects duplicated model tool IDs before creating any asset or applying a scene',async()=>{
  const i=await input();
  const before=await f.db.query<{count:number}>('select count(*)::integer as count from scene_private.assets');
  const create=tool('create_parametric_model',{parameters:{family:'table',width:1,depth:1,height:1}});
  const duplicate={...tool('create_parametric_model',{parameters:{family:'table',width:2,depth:1,height:1}}),id:create.id};
  const fetcher=vi.fn(async()=>completion([create,duplicate,tool('submit_candidates',{candidates:[plan()]})]));
  const api=createApi(f.backend,env,fetcher);
  const run=agentRunSchema.parse(await (await send(api,i)).json());
  expect(run).toMatchObject({state:'failed',errorCode:'AGENT_INVALID_MODEL_RESPONSE',candidates:[]});
  expect((await f.db.query<{count:number}>('select count(*)::integer as count from scene_private.assets')).rows[0].count).toBe(before.rows[0].count);
  expect((await f.rpc(owner,'projects.get',{projectId:i.projectId})).scene).toEqual(i.scene);
  await send(api,i);expect(fetcher).toHaveBeenCalledOnce();
 });
 it('rejects an empty tool ID without executing even a valid candidate submission',async()=>{
  const i=await input(),submit={...tool('submit_candidates',{candidates:[plan()]}),id:'   '};
  const fetcher=vi.fn(async()=>completion([submit]));
  const run=agentRunSchema.parse(await (await send(createApi(f.backend,env,fetcher),i)).json());
  expect(run).toMatchObject({state:'failed',errorCode:'AGENT_INVALID_MODEL_RESPONSE',candidates:[]});
  expect((await f.rpc(owner,'projects.get',{projectId:i.projectId})).scene).toEqual(i.scene);
  expect(fetcher).toHaveBeenCalledOnce();
 });
 it('replays a tool across rounds with normalized parameters without creating another asset',async()=>{
  const i=await input(),before=(await f.rpc(owner,'assets.list')).length,id='model/create/1';
  const create=tool('create_parametric_model',{parameters:{family:'table',width:1,depth:1,height:1}},id);
  let receipts:{content:string}[]=[];
  const fetcher=vi.fn(async(_url,init)=>{
   if(fetcher.mock.calls.length===1)return completion([create]);
   if(fetcher.mock.calls.length===2)return completion([tool('create_parametric_model',{parameters:{height:1,depth:1,width:1,family:'table',color:'#cbb68e',variant:'rectangle',topThickness:0.04,legs:'four',legThickness:0.05}},id)]);
   receipts=JSON.parse(String(init?.body)).messages.filter((m:{role:string;tool_call_id:string})=>m.role==='tool'&&m.tool_call_id===id);
   const resourceId=JSON.parse(receipts[0].content).items[0][0];
   return completion([tool('submit_candidates',{candidates:[{title:'单件桌子',explanation:'待应用',commands:[{op:'add_resource',resourceId,position:{x:3,z:3},rotation:0}]}]})]);
  });
  const run=agentRunSchema.parse(await (await send(createApi(f.backend,env,fetcher),i)).json());
  expect(run).toMatchObject({state:'complete',callCount:3});expect(run.candidates[0].proposal.candidate.objects).toHaveLength(1);
  expect((await f.rpc(owner,'assets.list')).length).toBe(before+1);
  expect(receipts).toHaveLength(2);expect(receipts[1].content).toBe(receipts[0].content);
  expect((await f.rpc(owner,'projects.get',{projectId:i.projectId})).scene).toEqual(i.scene);
 });
 it.each(['parameters','tool'])('rejects a reused tool ID with changed %s while retaining its original receipt',async change=>{
  const i=await input(),before=(await f.rpc(owner,'assets.list')).length,id='model/conflict/1';
  const create=tool('create_parametric_model',{parameters:{family:'table',width:1,depth:1,height:1}},id);
  const changed=change==='parameters'?tool('create_parametric_model',{parameters:{family:'table',width:2,depth:1,height:1}},id):tool('get_scene',{},id);
  let receipts:{content:string}[]=[];
  const fetcher=vi.fn(async(_url,init)=>{
   if(fetcher.mock.calls.length===1)return completion([create]);
   if(fetcher.mock.calls.length===2)return completion([changed]);
   if(fetcher.mock.calls.length===3)return completion([create]);
   receipts=JSON.parse(String(init?.body)).messages.filter((m:{role:string;tool_call_id:string})=>m.role==='tool'&&m.tool_call_id===id);
   return completion([tool('submit_candidates',{candidates:[plan()]})]);
  });
  const run=agentRunSchema.parse(await (await send(createApi(f.backend,env,fetcher),i)).json());
  expect(run).toMatchObject({state:'complete',callCount:4});expect((await f.rpc(owner,'assets.list')).length).toBe(before+1);
  expect(receipts).toHaveLength(3);expect(JSON.parse(receipts[1].content)).toEqual({code:'AGENT_TOOL_CALL_CONFLICT'});
  expect(receipts[2].content).toBe(receipts[0].content);
 });
 it('lets the model correct schema-invalid arguments under the same tool ID before any execution',async()=>{
  const i=await input(),before=(await f.rpc(owner,'assets.list')).length,id='model/repair/1';
  const fetcher=vi.fn(async(_url,init)=>{
   if(fetcher.mock.calls.length===1)return completion([tool('create_parametric_model',{parameters:{family:'table',width:0,depth:1,height:1}},id)]);
   if(fetcher.mock.calls.length===2)return completion([tool('create_parametric_model',{parameters:{family:'table',width:1,depth:1,height:1}},id)]);
   const receipts=JSON.parse(String(init?.body)).messages.filter((m:{role:string;tool_call_id:string})=>m.role==='tool'&&m.tool_call_id===id);
   expect(JSON.parse(receipts[0].content).code).toBe('INVALID_TOOL_INPUT');expect(JSON.parse(receipts[1].content).items).toHaveLength(1);
   return completion([tool('submit_candidates',{candidates:[plan()]})]);
  });
  const run=agentRunSchema.parse(await (await send(createApi(f.backend,env,fetcher),i)).json());
  expect(run).toMatchObject({state:'complete',callCount:3});expect((await f.rpc(owner,'assets.list')).length).toBe(before+1);
 });
 it('replays a partial submission without writing another checkpoint or consuming the remaining repair',async()=>{
  const i=await input({jevEnabled:true}),id='submission/1',submit=tool('submit_candidates',{candidates:[plan(2),plan(5),{}]},id);
  const agentRpc=vi.fn(f.backend.agent!);let modelCalls=0,receipts:{content:string}[]=[];
  const fetcher=vi.fn(async(url,init)=>{
   if(String(url).includes('systemone'))return new Response(JSON.stringify({answers:{recommended_plan:{type:'choice',choice:'B',probabilities:{A:0.2,B:0.6,C:0.1,NONE:0.1},confidence:0.7}}}));
   if(++modelCalls<=2)return completion([submit]);
   receipts=JSON.parse(String(init?.body)).messages.filter((m:{role:string;tool_call_id:string})=>m.role==='tool'&&m.tool_call_id===id);
   return completion([tool('submit_candidates',{candidates:[plan(2),plan(5),plan(8)]})]);
  });
  const run=agentRunSchema.parse(await (await send(createApi({...f.backend,agent:agentRpc},env,fetcher),i)).json());
  expect(run).toMatchObject({state:'complete',callCount:3});expect(run.candidates).toHaveLength(3);expect(run.evaluation?.choice).toBe('B');
  expect(agentRpc.mock.calls.filter(([,action])=>action==='checkpoint')).toHaveLength(2);
  expect(receipts).toHaveLength(2);expect(receipts[1].content).toBe(receipts[0].content);
 });
 it.each(['before-commit','after-commit'])('does not report an unconfirmed checkpoint as ready when its response fails %s',async failure=>{
  const i=await input(),submit=tool('submit_candidates',{candidates:[plan()]},'submission/unknown');let checkpointCalls=0;
  const agentRpc=vi.fn(async(actor,action,data)=>{
   if(action==='checkpoint'&&++checkpointCalls===1){
    if(failure==='after-commit')await f.backend.agent!(actor,action,data);
    throw new ApiError('DATABASE_ERROR',500);
   }
   return f.backend.agent!(actor,action,data);
  });
  const fetcher=vi.fn(async()=>completion([submit])),api=createApi({...f.backend,agent:agentRpc},env,fetcher);
  const run=agentRunSchema.parse(await (await send(api,i)).json());
  expect(run).toMatchObject({state:failure==='before-commit'?'failed':'complete',errorCode:'DATABASE_ERROR',callCount:6});
  expect(run.candidates).toHaveLength(failure==='before-commit'?0:1);expect(run.progress).not.toBe('方案已准备好');
  expect(checkpointCalls).toBe(1);expect(agentRpc.mock.calls.some(([,action])=>action==='finish')).toBe(false);
  expect((await f.rpc(owner,'projects.get',{projectId:i.projectId})).scene).toEqual(i.scene);
  await send(api,i);expect(fetcher).toHaveBeenCalledTimes(6);
 });
 it('does not repeat a tool whose asset was committed before its response was lost',async()=>{
  const i=await input(),before=(await f.rpc(owner,'assets.list')).length,id='model/unknown/1';
  const sceneRpc=vi.fn(async(actor,action,data)=>{const result=await f.backend.scene(actor,action,data);if(action==='parametric.complete')throw new Error('fixture response lost');return result;});
  const create=tool('create_parametric_model',{parameters:{family:'table',width:1,depth:1,height:1}},id);
  const fetcher=vi.fn(async(_url,init)=>{
   if(fetcher.mock.calls.length<=2)return completion([create]);
   const receipts=JSON.parse(String(init?.body)).messages.filter((m:{role:string;tool_call_id:string})=>m.role==='tool'&&m.tool_call_id===id);
   expect(receipts).toHaveLength(2);expect(receipts.every((m:{content:string})=>JSON.parse(m.content).code==='AGENT_TOOL_FAILED')).toBe(true);
   return completion([tool('submit_candidates',{candidates:[plan()]})]);
  });
  const run=agentRunSchema.parse(await (await send(createApi({...f.backend,scene:sceneRpc},env,fetcher),i)).json());
  expect(run).toMatchObject({state:'complete',callCount:3});expect(sceneRpc.mock.calls.filter(([,action])=>action==='parametric.complete')).toHaveLength(1);
  expect((await f.rpc(owner,'assets.list')).length).toBe(before+1);
 });
 it.each(['cancel','lease'])('checks %s before serving a previously executed tool receipt',async guard=>{
  const i=await input(),before=(await f.rpc(owner,'assets.list')).length;
  const create=tool('create_parametric_model',{parameters:{family:'table',width:1,depth:1,height:1}},'model/guard/1');
  const fetcher=vi.fn(async()=>{
   if(fetcher.mock.calls.length===2){
    if(guard==='cancel'){const run=await f.backend.agent!(owner,'by_request',{projectId:i.projectId,requestId:i.requestId});await f.backend.agent!(owner,'cancel',{projectId:i.projectId,id:run.id});}
    else await f.rpc(owner,'lease.release',i);
   }
   return completion([create]);
  });
  const run=agentRunSchema.parse(await (await send(createApi(f.backend,env,fetcher),i)).json());
  expect(run.state).toBe(guard==='cancel'?'cancelled':'failed');if(guard==='lease')expect(run.errorCode).toBe('LEASE_LOST');
  expect(run.candidates).toEqual([]);expect(fetcher).toHaveBeenCalledTimes(2);expect((await f.rpc(owner,'assets.list')).length).toBe(before+1);
 });
 it('cancel after complete fences application, and other users cannot retrieve the run',async()=>{
  const i=await input(),api=createApi(f.backend,env,async()=>completion([tool('submit_candidates',{candidates:[plan()]})]));const run=agentRunSchema.parse(await (await send(api,i)).json());
  await expect(f.backend.agent!(editor,'get',{projectId:i.projectId,id:run.id})).rejects.toThrow('AGENT_RUN_NOT_FOUND');await expect(f.backend.agent!(outsider,'get',{projectId:i.projectId,id:run.id})).rejects.toThrow();
  await f.backend.agent!(owner,'cancel',{projectId:i.projectId,id:run.id});await expect(f.rpc(owner,'proposals.apply',{...i,proposalId:run.candidates[0].proposal.id,baseHash:await sceneHash(i.scene)})).rejects.toThrow('STALE_PROPOSAL');
 });
 it('records the true lease failure without leaving the run active',async()=>{
  const i=await input();const fetcher=vi.fn(async()=>{await f.rpc(owner,'lease.release',i);return completion([tool('submit_candidates',{candidates:[plan()]})]);});
  const run=agentRunSchema.parse(await (await send(createApi(f.backend,env,fetcher),i)).json());expect(run).toMatchObject({state:'failed',errorCode:'LEASE_LOST'});
 });
 it('rejects unauthorized selection changes and locked objects',async()=>{
  for(const locked of [false,true]){const a={...chair(),locked},b=chair();const i=await input({scene:{...scene(),objects:[a,b]},selectedIds:[a.id]});const target=locked?a:b;const fetcher=vi.fn(async()=>completion([tool('submit_candidates',{candidates:[{title:'x',explanation:'x',commands:[{op:'remove',id:target.id}]}]})]));const run=agentRunSchema.parse(await (await send(createApi(f.backend,env,fetcher),i)).json());expect(run.candidates).toEqual([]);expect(run.state).toBe('failed');}
 });
 it('does not count IDs or color as meaningful candidate differences',async()=>{
  const i=await input({jevEnabled:true});const a=plan(),b=plan();b.commands[0].color='#ff0000';const fetcher=vi.fn(async()=>completion([tool('submit_candidates',{candidates:[a,b]})]));const run=agentRunSchema.parse(await (await send(createApi(f.backend,env,fetcher),i)).json());expect(run.candidates).toHaveLength(1);expect(run.evaluation?.status).toBe('partial');
 });
 it('returns queued immediately for Edge background execution and supports request-key recovery',async()=>{
  const i=await input();const tasks:Promise<unknown>[]=[];const api=createApi(f.backend,env,async()=>completion([tool('submit_candidates',{candidates:[plan()]})]),task=>tasks.push(task));const run=agentRunSchema.parse(await (await send(api,i)).json());expect(run.state).toBe('queued');await Promise.all(tasks);expect((await f.backend.agent!(owner,'by_request',{projectId:i.projectId,requestId:i.requestId})).state).toBe('complete');
 });
 it('unknown expired run becomes terminal and cannot be restarted',async()=>{
  const i=await input();const r=await f.backend.agent!(owner,'create',{projectId:i.projectId,input:i,fingerprint:await sha256(canonical(i)),baseHash:await sceneHash(i.scene),executionMode:'preview'});await f.db.query("update scene_private.agent_runs set deadline=clock_timestamp()-interval '1 second' where id=$1",[r.id]);expect((await f.backend.agent!(owner,'get',{projectId:i.projectId,id:r.id})).state).toBe('failed');expect(await f.backend.agent!(owner,'start',{projectId:i.projectId,id:r.id})).toEqual({claimed:false});
 });
 it('retirement rejects every new HY3 input before assets or provider calls',async()=>{
  expect(generationCapabilities(env)).toMatchObject({textToModel:false,imageToModel:false,texture:false});
  for(const kind of ['text','image','texture'])await expect(prepareGenerationRequest(f.backend,owner,{requestId:crypto.randomUUID(),prompt:'x',kind},env)).rejects.toMatchObject({code:'HY3_RETIRED',status:410});
 });
});
it.each(['不要直接删除桌子','暂时不要直接改','直接说明原因','先给我看一个方案','能否直接添加椅子？'])('does not auto-apply ambiguous or negative intent: %s',instruction=>{expect(agentExecutionMode(agentRunRequestSchema.parse({requestId:crypto.randomUUID(),sessionId:session,generation:1,expectedRevision:0,localRevision:0,scene:scene(),selectedIds:[],instruction,executionMode:'direct'}))).toBe('preview');});
it('validates JEV output instead of inventing probabilities',async()=>{
 const candidates=[2,5,8].map((x,i)=>({label:['A','B','C'][i],title:'x',scene:scene(),explanation:'x',warnings:[]}));
 for(const body of [{answers:{recommended_plan:{type:'choice',choice:'A',probabilities:{A:0.9,B:0.9,C:0.9,NONE:0},confidence:0.9}}},{choices:[]}])expect((await evaluateCandidates(candidates,'test',env,5000,async()=>new Response(JSON.stringify(body)))).status).toBe('unavailable');
});
