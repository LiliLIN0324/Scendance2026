// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BackendSession, getBackendConfig, type BackendSnapshot, type Scene, type SceneProposal } from '@/lib/backend-session';
import { backendSceneToLayout, layoutToBackendScene } from '../lib/backend-adapter';
import { ensureGlbAsset } from '../three/glb-assets';
import { MaterialCustomization, type MaterialCustomizationSeed } from './material-customization';
import type { RoomLayout } from '../lib/types';

let selection=new Set<string>();
vi.mock('../contexts',()=>({useSelection:()=>({allSelectedIds:selection})}));
vi.mock('../three/glb-assets',()=>({ensureGlbAsset:vi.fn().mockResolvedValue(undefined)}));
vi.mock('../../business/scene-preview',()=>({ScenePreview:({scene}:{scene:Scene})=><div data-testid="scene-preview">{scene.objects.map(object=>`${object.id}:${object.assetId}:${object.color}`).join('|')}</div>}));
const source='10000000-0000-4000-8000-000000000001',variant='10000000-0000-4000-8000-000000000002';
const project='20000000-0000-4000-8000-000000000001',user='30000000-0000-4000-8000-000000000001',sessionId='40000000-0000-4000-8000-000000000001';
const first='50000000-0000-4000-8000-000000000001',second='50000000-0000-4000-8000-000000000002';
const sha='a'.repeat(64);
const base:Scene={schemaVersion:1,venue:{width:8,depth:6,height:3,shape:'rectangle',entrances:[]},camera:'overview',lighting:'warm',objects:[first,second].map((id,index)=>({id,materialId:'asset',assetId:source,position:{x:2+index,z:3},rotation:0,size:{width:.5,depth:.5,height:1},color:index===0?'#eeddcc':'#ffffff',locked:false,notes:''}))};
let controller:BackendSession,snapshot:BackendSnapshot,current:RoomLayout;
let inspection:Record<string,unknown>;
const onApply=vi.fn();
const slot=(index:number,count=1)=>({index,name:index?'椅腿':'座面',baseColor:'#ffffff',baseColorFactor:[1,1,1,1],metallic:0,roughness:.5,hasBaseColorTexture:index===0,hasMetallicRoughnessTexture:false,primitiveCount:count});
function seed(extra:Partial<MaterialCustomizationSeed>={}):MaterialCustomizationSeed{return {id:'seed',scope:`${controller.config.apiUrl}:${user}:${project}`,apiUrl:controller.config.apiUrl,userId:user,projectId:project,sourceAssetId:source,objectIds:[first],name:'浅色哑光椅子',reason:'仅修改这把椅子的材质',materialScope:'all_materials',changes:{baseColor:'#eeeeee',roughness:.8},...extra};}
function proposal(scene:Scene,ids=[first],to=variant):SceneProposal{return {id:'60000000-0000-4000-8000-000000000001',project_id:project,user_id:user,session_id:sessionId,generation:1,base_revision:1,local_revision:0,base_hash:sha,base_scene:scene,candidate:{...scene,objects:scene.objects.map(object=>ids.includes(object.id)?{...object,assetId:to}:object)},explanation:'只替换选定物件的材质版本。',warnings:[],expires_at:new Date(Date.now()+600_000).toISOString(),applied_at:null};}
function ui(extra:{seed?:MaterialCustomizationSeed;active?:boolean}={}){return <MaterialCustomization controller={controller} layout={current} onApply={onApply} {...extra}/>;}
async function preview(){fireEvent.click(await screen.findByRole('button',{name:'制作并预览材质版本'}));await screen.findByRole('button',{name:'确认应用到选定物件'});}
beforeEach(()=>{
  selection=new Set([first]);onApply.mockReset();vi.mocked(ensureGlbAsset).mockClear();
  controller=new BackendSession(getBackendConfig({url:'https://example.supabase.co',anonKey:'sb_publishable_test'}));
  current=backendSceneToLayout(base,{projectId:project,name:'客户场景',assetNames:{[source]:'木椅'}});
  snapshot={...controller.getSnapshot(),configured:true,user:{id:user},project:{id:project,name:'客户场景',studio_id:user,revision:1,scene:base},revision:1,localRevision:0,sessionId,writeBlocked:false,status:'editing',lease:{projectId:project,sessionId,generation:1,revision:1,expiresAt:new Date(Date.now()+90_000).toISOString()}};
  vi.spyOn(controller,'getSnapshot').mockImplementation(()=>snapshot);
  inspection={id:source,name:'木椅',sha256:sha,slots:[slot(0),slot(1),slot(2,0)],validation:{hasUV:true,geometryUVSignature:sha,validationWarnings:0}};
  vi.spyOn(controller,'businessRequest').mockImplementation(async(path)=>path.endsWith('/materials')?inspection:{id:variant,name:'材质变体',source:'derived',format:'glb',sha256:'b'.repeat(64),byte_size:1234,metadata:{parentAssetId:source,sourceSha256:sha,changeMode:'material',materialVariant:{materialIndices:[0,1],changes:{baseColor:'#eeeeee',roughness:.8},validation:{geometryUVPreserved:true,geometryUVSignature:sha},procurementStatus:'needs_confirmation'}}});
  vi.spyOn(controller,'prepareMaterialVariantProposal').mockImplementation(async input=>proposal(input.scene,input.objectIds,input.variantAssetId));
  vi.spyOn(controller,'authorizeAssets').mockResolvedValue({assetUrls:{[source]:'https://storage.example/old.glb',[variant]:'https://storage.example/new.glb'},assetNames:{[source]:'木椅',[variant]:'材质变体'}});
  vi.spyOn(controller,'applySceneProposal').mockImplementation(async selected=>({id:project,revision:2,scene:selected.candidate,previousScene:selected.base_scene,updatedAt:new Date().toISOString(),undoGroup:selected.id,acceptedLocally:true}));
});
afterEach(()=>{cleanup();controller.dispose();vi.restoreAllMocks();vi.useRealTimers();});

describe('selected material version workflow',()=>{
  it('previews without saving, then applies the derived version to exactly one of two chairs',async()=>{
    render(ui({seed:seed()}));await screen.findByText('木椅 · 含 UV');
    expect(controller.prepareMaterialVariantProposal).not.toHaveBeenCalled();expect(controller.applySceneProposal).not.toHaveBeenCalled();
    expect(screen.getByText(/已有实例颜色/)).toBeTruthy();await preview();
    expect(controller.applySceneProposal).not.toHaveBeenCalled();expect(onApply).not.toHaveBeenCalled();
    expect(controller.businessRequest).toHaveBeenCalledWith(`/assets/${source}/customize`,'POST',expect.objectContaining({sourceSha256:sha,materialIndices:[0,1],baseColor:'#eeeeee',roughness:.8}));
    expect(ensureGlbAsset).toHaveBeenCalledWith(variant,'https://storage.example/new.glb');
    expect(screen.getAllByTestId('scene-preview')).toHaveLength(1);
    expect(screen.getByTestId('scene-preview').textContent).toContain(`${first}:${variant}`);
    fireEvent.click(screen.getByRole('button',{name:'原版本'}));expect(screen.getByTestId('scene-preview').textContent).toContain(`${first}:${source}`);
    fireEvent.click(screen.getByRole('button',{name:'确认应用到选定物件'}));await waitFor(()=>expect(onApply).toHaveBeenCalledOnce());
    const next=layoutToBackendScene(onApply.mock.calls[0][0]);expect(next.objects[0]).toMatchObject({assetId:variant,color:'#eeddcc'});expect(next.objects[1]).toEqual(base.objects[1]);
    expect(onApply.mock.calls[0][0].designBook).toBeUndefined();
  });
  it('requires selecting actual slots when DeepSeek asks the user to choose materials',async()=>{
    render(ui({seed:seed({materialScope:'choose_materials'})}));
    fireEvent.click(await screen.findByRole('button',{name:'制作并预览材质版本'}));await screen.findByText('请勾选实际使用的材质槽。');
    expect(controller.businessRequest).not.toHaveBeenCalledWith(expect.stringContaining('/customize'),expect.anything(),expect.anything());
    fireEvent.click(screen.getByRole('checkbox',{name:/座面/}));
    fireEvent.click(screen.getByRole('checkbox',{name:'移除选中材质的原颜色贴图'}));
    await preview();
    expect(controller.businessRequest).toHaveBeenCalledWith(`/assets/${source}/customize`,'POST',expect.objectContaining({materialIndices:[0],removeBaseColorTexture:true}));
  });
  it('only previews an existing texture variant on an explicit click without creating a new variant',async()=>{
    render(ui({seed:seed({changes:undefined,variantAssetId:variant})}));
    await screen.findByRole('button',{name:'预览候选版本'});expect(controller.prepareMaterialVariantProposal).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button',{name:'预览候选版本'}));await screen.findByRole('button',{name:'确认应用到选定物件'});
    expect(vi.mocked(controller.businessRequest).mock.calls.every(([,method])=>method!=='POST')).toBe(true);expect(onApply).not.toHaveBeenCalled();
  });
  it('previews restoration to the verified parent version before confirmation',async()=>{
    current=backendSceneToLayout({...base,objects:base.objects.map((object,index)=>index?object:{...object,assetId:variant})},{projectId:project,name:'场景'});
    inspection={...inspection,id:variant,parentAssetId:source};
    render(ui());fireEvent.click(await screen.findByRole('button',{name:'预览恢复父版本'}));
    await screen.findByRole('button',{name:'确认应用到选定物件'});
    expect(controller.prepareMaterialVariantProposal).toHaveBeenCalledWith(expect.objectContaining({sourceAssetId:variant,variantAssetId:source,objectIds:[first]}));
    expect(controller.applySceneProposal).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button',{name:'确认应用到选定物件'}));await waitFor(()=>expect(onApply).toHaveBeenCalledOnce());
    expect(layoutToBackendScene(onApply.mock.calls[0][0]).objects[0].assetId).toBe(source);
  });
  it.each(['locked','mixed','missing'] as const)('rejects %s targets without silently falling back',async kind=>{
    if(kind==='locked')current={...current,floors:[{...current.floors[0],items:current.floors[0].items.map((item,index)=>index?item:{...item,locked:true})}]};
    if(kind==='mixed'){selection=new Set([first,second]);current={...current,floors:[{...current.floors[0],items:current.floors[0].items.map((item,index)=>index?{...item,assetId:variant}:item)}]};}
    if(kind==='missing')selection=new Set(['70000000-0000-4000-8000-000000000001']);
    render(ui());expect(screen.getByRole('status').textContent).toMatch(/锁定|同一个来源|已不存在/);
    expect(controller.businessRequest).not.toHaveBeenCalled();expect(controller.prepareMaterialVariantProposal).not.toHaveBeenCalled();
  });
  it('keeps the same creation request ID after an uncertain response',async()=>{
    const original=vi.mocked(controller.businessRequest).getMockImplementation()!;
    let failed=false;vi.mocked(controller.businessRequest).mockImplementation(async(...args)=>{if(args[1]==='POST'&&!failed){failed=true;throw new Error('connection lost');}return original(...args);});
    render(ui({seed:seed()}));fireEvent.click(await screen.findByRole('button',{name:'制作并预览材质版本'}));await screen.findByText('connection lost');
    await preview();const posts=vi.mocked(controller.businessRequest).mock.calls.filter(([,method])=>method==='POST');
    expect(posts).toHaveLength(2);expect(posts[0][2]).toEqual(posts[1][2]);
  });
  it('discards a late customization response after the local scene changes',async()=>{
    let finish!:(value:unknown)=>void;const original=vi.mocked(controller.businessRequest).getMockImplementation()!;
    vi.mocked(controller.businessRequest).mockImplementation(async(...args)=>args[1]==='POST'?new Promise(resolve=>{finish=resolve;}):original(...args));
    const selectedSeed=seed();const view=render(ui({seed:selectedSeed}));fireEvent.click(await screen.findByRole('button',{name:'制作并预览材质版本'}));
    await waitFor(()=>expect(finish).toBeTypeOf('function'));current={...current,name:'用户新修改'};view.rerender(ui({seed:selectedSeed}));
    await act(async()=>{finish(await original(`/assets/${source}/customize`,'POST',{}));});
    expect(controller.prepareMaterialVariantProposal).not.toHaveBeenCalled();expect(onApply).not.toHaveBeenCalled();expect(screen.queryByRole('button',{name:'确认应用到选定物件'})).toBeNull();
  });
  it('does not mount WebGL while its Agent subpanel is inactive',async()=>{
    const selectedSeed=seed(),view=render(ui({seed:selectedSeed}));await preview();expect(screen.getByTestId('scene-preview')).toBeTruthy();
    view.rerender(ui({seed:selectedSeed,active:false}));expect(screen.queryByTestId('scene-preview')).toBeNull();
  });
  it('keeps a changed local draft when cloud apply was not accepted locally',async()=>{
    vi.mocked(controller.applySceneProposal).mockImplementationOnce(async selected=>({id:project,revision:2,scene:selected.candidate,previousScene:selected.base_scene,updatedAt:new Date().toISOString(),undoGroup:selected.id,acceptedLocally:false}));
    render(ui({seed:seed()}));await preview();fireEvent.click(screen.getByRole('button',{name:'确认应用到选定物件'}));
    await screen.findByText(/已保留本地草稿/);expect(onApply).not.toHaveBeenCalled();
  });
  it('retains the same proposal request ID after an unknown response without recreating the variant',async()=>{
    vi.mocked(controller.prepareMaterialVariantProposal).mockRejectedValueOnce(new Error('proposal response lost'));
    render(ui({seed:seed()}));fireEvent.click(await screen.findByRole('button',{name:'制作并预览材质版本'}));await screen.findByText('proposal response lost');
    await preview();const calls=vi.mocked(controller.prepareMaterialVariantProposal).mock.calls;
    expect(calls).toHaveLength(2);expect(calls[0][0]).toEqual(calls[1][0]);
    expect(vi.mocked(controller.businessRequest).mock.calls.filter(([,method])=>method==='POST')).toHaveLength(1);
  });
  it('renews an expired proposal ID while reusing its immutable asset',async()=>{
    vi.mocked(controller.prepareMaterialVariantProposal).mockImplementationOnce(async input=>({...proposal(input.scene,input.objectIds,input.variantAssetId),expires_at:new Date(Date.now()+1_000).toISOString()}));
    const selectedSeed=seed(),view=render(ui({seed:selectedSeed}));await preview();
    const now=Date.now();vi.spyOn(Date,'now').mockReturnValue(now+2_000);view.rerender(ui({seed:selectedSeed}));
    expect((screen.getByRole('button',{name:'确认应用到选定物件'}) as HTMLButtonElement).disabled).toBe(true);
    await preview();const calls=vi.mocked(controller.prepareMaterialVariantProposal).mock.calls;
    expect(calls).toHaveLength(2);expect(calls[0][0].requestId).not.toEqual(calls[1][0].requestId);
    expect(vi.mocked(controller.businessRequest).mock.calls.filter(([,method])=>method==='POST')).toHaveLength(1);
  });
  it('renews proposal identity for a new local revision without duplicating the material asset',async()=>{
    const selectedSeed=seed(),view=render(ui({seed:selectedSeed}));await preview();
    snapshot={...snapshot,localRevision:1};current={...current,name:'已编辑'};
    vi.mocked(controller.prepareMaterialVariantProposal).mockImplementation(async input=>({...proposal(input.scene,input.objectIds,input.variantAssetId),local_revision:1}));
    view.rerender(ui({seed:selectedSeed}));await preview();const calls=vi.mocked(controller.prepareMaterialVariantProposal).mock.calls;
    expect(calls[0][0].requestId).not.toEqual(calls[1][0].requestId);
    expect(vi.mocked(controller.businessRequest).mock.calls.filter(([,method])=>method==='POST')).toHaveLength(1);
  });
  it('discards a late proposal after switching accounts and never uses the new selection as fallback',async()=>{
    let finish!:(value:SceneProposal)=>void;
    vi.mocked(controller.prepareMaterialVariantProposal).mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
    const selectedSeed=seed(),view=render(ui({seed:selectedSeed}));fireEvent.click(await screen.findByRole('button',{name:'制作并预览材质版本'}));
    await waitFor(()=>expect(finish).toBeTypeOf('function'));snapshot={...snapshot,user:{id:'30000000-0000-4000-8000-000000000002'}};selection=new Set([second]);view.rerender(ui({seed:selectedSeed}));
    await act(async()=>finish(proposal(base)));expect(screen.getByRole('status').textContent).toMatch(/其他账号或项目/);
    expect(controller.authorizeAssets).not.toHaveBeenCalled();expect(onApply).not.toHaveBeenCalled();
  });
  it('keeps selected slots when closing and reopening the Agent subpanel',async()=>{
    const selectedSeed=seed({materialScope:'choose_materials'}),view=render(ui({seed:selectedSeed}));await screen.findByText('木椅 · 含 UV');
    fireEvent.click(screen.getByRole('checkbox',{name:/座面/}));await preview();
    view.rerender(ui({seed:selectedSeed,active:false}));view.rerender(ui({seed:selectedSeed,active:true}));
    expect((screen.getByRole('checkbox',{name:/座面/}) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole('checkbox',{name:/椅腿1 个/}) as HTMLInputElement).checked).toBe(false);
    expect(screen.getByTestId('scene-preview')).toBeTruthy();expect(vi.mocked(controller.businessRequest).mock.calls.filter(([path])=>path.endsWith('/materials'))).toHaveLength(1);
  });

});
