import { beforeAll,afterAll,describe,it,expect,vi } from 'vitest';
import { database,owner,editor,studio,session,scene,chair } from './fixtures.ts';
import { createApi } from '../supabase/functions/_shared/api.ts';
import { generateProposal } from '../supabase/functions/_shared/providers.ts';
import { libraryResources,readSceneResources,resourceIndex,sceneResourceRefs } from '../supabase/functions/_shared/scene-resources.ts';
import type { Env } from '../supabase/functions/_shared/http.ts';
import type { Scene } from '../supabase/functions/_shared/domain.ts';

const env:Env=key=>({DEEPSEEK_API_KEY:'fixture-key',AI_MAX_REQUEST_CENTS:'40'}[key]);
const resource=libraryResources.find(item=>item.name==='抱臂站立人物')!;
const suggestion={name:'定制花朵装置',reason:'现有资源中没有客户所需造型',prompt:'单件白色花朵装置，独立底座，不含场景'};
const completion=(value:unknown)=>new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify(value)}}],usage:{total_tokens:100}}));

describe('scene Agent -> real authorization -> proposal -> database application',()=>{
  let f:Awaited<ReturnType<typeof database>>;
  beforeAll(async()=>{
    f=await database();
    const record={id:resource.assetId,name:resource.name,source:'upload',sourceId:'agent-fixture',sourceUrl:'https://3dassets.dev/assets/agent-fixture',format:'glb',byteSize:100,sha256:'a'.repeat(64),storagePath:`${owner}/${resource.assetId}/${'a'.repeat(64)}.glb`,license:{id:'CC0-1.0'},metadata:{catalog:'scendance-v041'}};
    await f.db.transaction(async tx=>{await tx.exec('set local role service_role');await tx.query('select public.register_library_asset($1,$2,$3::jsonb)',[owner,'agent-fixture',JSON.stringify(record)]);});
  },30000);
  afterAll(async()=>{await f?.db.close();});
  async function project(actor=editor,base:Scene=scene()) {
    const p=await f.rpc(actor,'projects.create',{studioId:studio,name:'Agent fixture',scene:base});
    const lease=await f.rpc(actor,'lease.acquire',{projectId:p.id,sessionId:session});
    return {projectId:p.id,requestId:crypto.randomUUID(),sessionId:session,generation:lease.generation,expectedRevision:0,localRevision:0,scene:base,instruction:'从资源库加入抱臂站立人物，缺少定制花朵时提示 HY3。',mode:'modify' as const,selectedIds:[]};
  }
  function request(api:ReturnType<typeof createApi>,input:Awaited<ReturnType<typeof project>>,actor=editor) {
    const {projectId,...body}=input;
    return api(new Request(`https://api.test/projects/${projectId}/proposals`,{method:'POST',headers:{authorization:`Bearer ${actor}`,'content-type':'application/json'},body:JSON.stringify(body)}));
  }
  it('reads the exact current scene and all public resources, then persists an authorized library model',async()=>{
    const existing={...chair(),materialId:'asset' as const,assetId:resource.assetId,size:resource.size!};
    const input=await project(editor,{...scene(),objects:[existing]});let context:Record<string,any>={};
    const fetcher=vi.fn(async(_url:unknown,init?:RequestInit)=>{
      context=JSON.parse(JSON.parse(init!.body as string).messages[1].content);
      return completion({explanation:'已规划人物；花朵需另行生成。',commands:[{op:'move',id:existing.id,position:{x:3,z:3}},{op:'add_resource',resourceId:resource.resourceId,position:{x:6,z:5},rotation:0}],modelSuggestions:[suggestion]});
    });
    const api=createApi(f.backend,env,fetcher);
    const response=await request(api,input);expect(response.status).toBe(201);const result=await response.json();
    expect(context.scene).toEqual(input.scene);expect(context.selectedIds).toEqual([]);
    expect(context.sceneResourceRefs).toEqual({[existing.id]:resource.resourceId});
    expect(context.resources.items).toHaveLength(528);
    expect(context.resources.items).toContainEqual([resource.resourceId,resource.name,resource.category,[resource.size!.width,resource.size!.depth,resource.size!.height]]);
    expect(JSON.stringify(context)).not.toContain('storage_path');expect(JSON.stringify(context)).not.toContain('https://');
    expect(result.modelSuggestions).toEqual([suggestion]);
    const again=await request(api,input);expect(again.status).toBe(200);expect(await again.json()).toEqual(result);expect(fetcher).toHaveBeenCalledOnce();
    const apply=await api(new Request(`https://api.test/projects/${input.projectId}/proposals/apply`,{method:'POST',headers:{authorization:`Bearer ${editor}`,'content-type':'application/json'},body:JSON.stringify({sessionId:session,generation:input.generation,expectedRevision:0,localRevision:0,proposalId:result.id,currentScene:input.scene})}));
    expect(apply.status).toBe(200);const applied=await apply.json();expect(applied.scene.objects[0]).toMatchObject({id:existing.id,position:{x:3,z:3}});expect(applied.scene.objects[1]).toMatchObject({materialId:'asset',assetId:resource.assetId,size:resource.size});
    expect((await f.rpc(editor,'projects.get',{projectId:input.projectId})).scene).toEqual(applied.scene);
  });
  it('never exposes or adds another owner’s private model',async()=>{
    const privateId=crypto.randomUUID();
    await f.rpc(owner,'assets.register',{id:privateId,name:'Private model',source:'upload',format:'glb',byteSize:100,sha256:'b'.repeat(64),storagePath:'private.glb',license:{},metadata:{}});
    const input=await project();const resources=await readSceneResources(f.backend,editor,input.scene);
    expect(resources.some(item=>item.assetId===privateId)).toBe(false);
    const fetcher=vi.fn(async()=>completion({explanation:'bad',commands:[{op:'add_resource',resourceId:`asset:${privateId}`,position:{x:6,z:5},rotation:0,size:{width:1,depth:1,height:1}}]}));
    const response=await request(createApi(f.backend,env,fetcher),input);
    expect(response.status).toBe(422);expect((await response.json()).error.code).toBe('AI_INVALID_PROPOSAL');expect(fetcher).toHaveBeenCalledTimes(2);
    expect((await f.rpc(editor,'projects.get',{projectId:input.projectId})).scene.objects).toEqual([]);
    const own=await readSceneResources(f.backend,owner,input.scene);expect(own.find(item=>item.assetId===privateId)).toMatchObject({name:'Private model'});expect(own.find(item=>item.assetId===privateId)?.size).toBeUndefined();
  });
  it('uses one catalog/own resource identity for UUID casing aliases and never borrows a private alias',async()=>{
    const catalogScene={...scene(),objects:[{...chair(),materialId:'asset' as const,assetId:resource.assetId.toUpperCase(),size:resource.size!}]};
    const catalogResources=await readSceneResources(f.backend,owner,catalogScene);
    const catalogAliases=catalogResources.filter(item=>item.assetId.toLowerCase()===resource.assetId.toLowerCase());
    expect(catalogAliases).toHaveLength(1);expect(catalogAliases[0]).toMatchObject({assetId:resource.assetId,resourceId:resource.resourceId,name:resource.name});
    expect(sceneResourceRefs(catalogScene,catalogResources)).toEqual({[catalogScene.objects[0].id]:resource.resourceId});
    const privateId='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    await f.rpc(owner,'assets.register',{id:privateId,name:'私有物料',source:'upload',format:'glb',byteSize:100,sha256:'c'.repeat(64),storagePath:'private-case.glb',license:{},metadata:{}});
    const privateScene={...scene(),objects:[{...chair(),materialId:'asset' as const,assetId:privateId.toUpperCase()}]};
    const publicResources=await readSceneResources(f.backend,editor,scene());
    expect(publicResources.some(item=>item.assetId.toLowerCase()===privateId)).toBe(false);
    expect(sceneResourceRefs(privateScene,publicResources)).toEqual({});
    const ownResources=await readSceneResources(f.backend,owner,privateScene);
    const ownAliases=ownResources.filter(item=>item.assetId.toLowerCase()===privateId);
    expect(ownAliases).toHaveLength(1);expect(ownAliases[0]).toMatchObject({assetId:privateId,resourceId:`asset:${privateId}`,name:'私有物料'});
    expect(sceneResourceRefs(privateScene,ownResources)).toEqual({[privateScene.objects[0].id]:`asset:${privateId}`});
  });
  it('rechecks real registration even for an ID appearing in the shipped catalogue',async()=>{
    const other=libraryResources.find(item=>item.assetId!==resource.assetId)!;
    const input=await project();const fetcher=vi.fn(async()=>completion({explanation:'add',commands:[{op:'add_resource',resourceId:other.resourceId,position:{x:6,z:5},rotation:0}]}));
    const response=await request(createApi(f.backend,env,fetcher),input);expect(response.status).toBe(403);
    expect((await f.rpc(editor,'projects.get',{projectId:input.projectId})).scene.objects).toEqual([]);
  });
  it('keeps the full public index compact through the bounded repair call',async()=>{
    expect(new TextEncoder().encode(JSON.stringify(resourceIndex(libraryResources))).length).toBeLessThan(40000);
    const input=await project();let attempts=0;
    const fetcher=vi.fn(async(_url:unknown,init?:RequestInit)=>{
      expect(new TextEncoder().encode(init!.body as string).length).toBeLessThan(65536);
      return ++attempts===1?completion({explanation:'bad',commands:[{op:'add_resource',resourceId:'invented',position:{x:2,z:2},rotation:0}]}):completion({explanation:'需要补充模型。',commands:[],modelSuggestions:[suggestion]});
    });
    const result=await generateProposal(input,env,async()=>{},fetcher,libraryResources);
    expect(result.modelSuggestions).toEqual([suggestion]);expect(result.scene).toEqual(input.scene);expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
