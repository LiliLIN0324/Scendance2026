// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BackendSession, getBackendConfig, type BackendSnapshot, type Scene, type SceneProposal } from '@/lib/backend-session';
import { readSourceRecord } from '@/lib/source-storage';
import { canonical, sceneSchema } from '../../../../supabase/functions/_shared/domain';
import { eventOperationsSchema } from '../../../../supabase/functions/_shared/event-operations-contract';
import { materialCheckinLedgerSchema, materialCheckinSummary } from '../../../../supabase/functions/_shared/material-checkin-contract';
import { productionPlanSchema } from '../../../../supabase/functions/_shared/production-plan-contract';
import { ScenePreview } from '../../business/scene-preview';
import { backendSceneToLayout, layoutToBackendScene } from '../lib/backend-adapter';
import { ensureGlbAsset } from '../three/glb-assets';
import { MaterialCustomization, type MaterialCustomizationSeed } from './material-customization';
import type { RoomLayout } from '../lib/types';

let selection=new Set<string>();
vi.mock('@/lib/source-storage', async original => ({ ...(await original<typeof import('@/lib/source-storage')>()), readSourceForm: vi.fn(), readSourceRecord: vi.fn() }));
vi.mock('../contexts',()=>({useSelection:()=>({allSelectedIds:selection})}));
vi.mock('../three/glb-assets',()=>({ensureGlbAsset:vi.fn().mockResolvedValue(undefined)}));
vi.mock('../../business/scene-preview',()=>({ScenePreview:vi.fn(({scene}:{scene:Scene})=><div data-testid="scene-preview">{scene.objects.map(object=>`${object.id}:${object.assetId}:${object.color}`).join('|')}</div>)}));
const source='10000000-0000-4000-8000-000000000001',variant='10000000-0000-4000-8000-000000000002';
const project='20000000-0000-4000-8000-000000000001',user='30000000-0000-4000-8000-000000000001',sessionId='40000000-0000-4000-8000-000000000001';
const first='50000000-0000-4000-8000-000000000001',second='50000000-0000-4000-8000-000000000002';
const localId='house-material-local-activity';
const acquisitionId='70000000-0000-4000-8000-000000000001';
const sha='a'.repeat(64);
const base:Scene={schemaVersion:1,venue:{width:8,depth:6,height:3,shape:'rectangle',entrances:[]},camera:'overview',lighting:'warm',objects:[first,second].map((id,index)=>({id,materialId:'asset',assetId:source,position:{x:2+index,z:3},rotation:0,size:{width:.5,depth:.5,height:1},color:index===0?'#eeddcc':'#ffffff',locked:false,notes:''}))};
let controller:BackendSession,snapshot:BackendSnapshot,current:RoomLayout;
let inspection:Record<string,unknown>;
const onApply=vi.fn();
const slot=(index:number,count=1)=>({index,name:index?'椅腿':'座面',baseColor:'#ffffff',baseColorFactor:[1,1,1,1],metallic:0,roughness:.5,hasBaseColorTexture:index===0,hasMetallicRoughnessTexture:false,primitiveCount:count});
function seed(extra:Partial<MaterialCustomizationSeed>={}):MaterialCustomizationSeed{return {id:'seed',scope:`${controller.config.apiUrl}:${user}:${current.id}`,apiUrl:controller.config.apiUrl,userId:user,projectId:project,sourceAssetId:source,objectIds:[first],name:'浅色哑光椅子',reason:'仅修改这把椅子的材质',materialScope:'all_materials',changes:{baseColor:'#eeeeee',roughness:.8},...extra};}
function proposal(scene:Scene,ids=[first],to=variant):SceneProposal{return {id:'60000000-0000-4000-8000-000000000001',project_id:project,user_id:user,session_id:sessionId,generation:1,base_revision:1,local_revision:snapshot.localRevision,base_hash:sha,base_scene:scene,candidate:{...scene,objects:scene.objects.map(object=>ids.includes(object.id)?{...object,assetId:to}:object)},explanation:'只替换选定物件的材质版本。',warnings:[],expires_at:new Date(Date.now()+600_000).toISOString(),applied_at:null};}
function checkinLedger(){return materialCheckinLedgerSchema.parse({projectId:project,dataKind:'rehearsal',sheets:[]});}
function localLedger(){return materialCheckinLedgerSchema.parse({projectId:localId,dataKind:'rehearsal',sheets:[{
  id:'80000000-0000-4000-8000-000000000001',acquisitionId,acquisitionSnapshot:{title:'私密-取得计划',supplierName:'私密-供应方',specificationNote:'演练椅规格'},unit:'piece',
  agreements:[{id:'80000000-0000-4000-8000-000000000002',agreedQuantity:20,basisNote:'私密-约定依据',recordedAt:'2026-10-08T01:00:00Z',recordedBy:'演练记录人'}],
  events:(['receive','return'] as const).map((kind,index)=>({id:`80000000-0000-4000-8000-00000000000${index+3}`,kind,batchRef:`演练批次${index}`,quantity:18,checkState:'checked',occurredAt:`2026-10-08T0${index+2}:00:00Z`,fromPartyName:'演练交出方',toPartyName:'演练接收方',evidenceNote:'私密-点验现场说明',evidenceUrls:[],recordedAt:'2026-10-08T05:00:00Z',recordedBy:'演练记录人'})),
}]});}
function bindLocal():void {snapshot={...snapshot,geometryBinding:{version:1,localActivityId:localId,cloudProjectId:project,userId:user,apiUrl:controller.config.apiUrl}};}
function localActivity(bound=true):void {
  current={...current,id:localId,name:'独立演练本地活动',
    floors:current.floors.map(floor=>({...floor,items:floor.items.map(item=>({...item,notes:'私密-物件备注',handoff:{ownerName:'私密-工单负责人',dueDate:'',acceptance:'',status:'todo' as const,evidenceNote:'',evidenceUrls:[]}}))})),
    eventOperations:eventOperationsSchema.parse({dataKind:'rehearsal',tasks:[{id:'90000000-0000-4000-8000-000000000001',title:'私密-执行任务',phase:'event',objectIds:[first],ownerName:'私密-活动负责人'}]}),
    productionPlan:productionPlanSchema.parse({dataKind:'rehearsal',acquisitions:[{id:acquisitionId,title:'私密-取得计划',supplierName:'私密-供应方',objectIds:[first,second]}]}),
  };
  if(bound)bindLocal();else snapshot={...snapshot,project:null,geometryBinding:null,lease:null,writeBlocked:true,status:'ready'};
  vi.mocked(readSourceRecord).mockResolvedValue(localLedger());
}
function ui(extra:{seed?:MaterialCustomizationSeed;active?:boolean}={}){return <MaterialCustomization controller={controller} layout={current} onApply={onApply} {...extra}/>;}
async function preview(){fireEvent.click(await screen.findByRole('button',{name:'制作并预览材质版本'}));await screen.findByRole('button',{name:'确认应用到选定物件'});}
beforeEach(()=>{
  window.history.replaceState({},'', '/');
  vi.mocked(readSourceRecord).mockReset().mockResolvedValue(undefined);
  selection=new Set([first]);onApply.mockReset();vi.mocked(ScenePreview).mockClear();vi.mocked(ensureGlbAsset).mockReset().mockResolvedValue(undefined);
  controller=new BackendSession(getBackendConfig({url:'https://example.supabase.co',anonKey:'sb_publishable_test'}));
  current=backendSceneToLayout(base,{projectId:project,name:'客户场景',assetNames:{[source]:'木椅'}});
  snapshot={...controller.getSnapshot(),configured:true,user:{id:user},project:{id:project,name:'客户场景',studio_id:user,revision:1,scene:base},revision:1,localRevision:0,sessionId,writeBlocked:false,status:'editing',lease:{projectId:project,sessionId,generation:1,revision:1,expiresAt:new Date(Date.now()+90_000).toISOString()}};
  vi.spyOn(controller,'getSnapshot').mockImplementation(()=>snapshot);
  vi.spyOn(controller,'isGeometryBound').mockImplementation(id=>{
    const binding=snapshot.geometryBinding;
    return !!binding&&binding.localActivityId===id&&binding.userId===snapshot.user?.id&&binding.apiUrl===controller.config.apiUrl&&binding.cloudProjectId===snapshot.project?.id;
  });
  vi.spyOn(controller,'ensureGeometryWorkbenchReady').mockImplementation(async()=>{
    snapshot={...snapshot,project:{id:project,name:'活动场景服务',studio_id:user,revision:1,scene:base},lease:{projectId:project,sessionId,generation:1,revision:1,expiresAt:new Date(Date.now()+90_000).toISOString()},writeBlocked:false,status:'editing'};bindLocal();return snapshot.project!;
  });
  vi.spyOn(controller,'disconnectGeometryWorkbench').mockResolvedValue(undefined);
  vi.spyOn(controller,'setDraft').mockImplementation(scene=>{snapshot={...snapshot,draft:scene,dirty:true,localRevision:snapshot.localRevision+1};});
  inspection={id:source,name:'木椅',sha256:sha,slots:[slot(0),slot(1),slot(2,0)],validation:{hasUV:true,geometryUVSignature:sha,validationWarnings:0}};
  vi.spyOn(controller,'businessRequest').mockImplementation(async(path)=>path.endsWith('/materials')?inspection:{id:variant,name:'材质变体',source:'derived',format:'glb',sha256:'b'.repeat(64),byte_size:1234,metadata:{parentAssetId:source,sourceSha256:sha,changeMode:'material',materialVariant:{materialIndices:[0,1],changes:{baseColor:'#eeeeee',roughness:.8},validation:{geometryUVPreserved:true,geometryUVSignature:sha},procurementStatus:'needs_confirmation'}}});
  vi.spyOn(controller,'prepareMaterialVariantProposal').mockImplementation(async input=>proposal(input.scene,input.objectIds,input.variantAssetId));
  vi.spyOn(controller,'authorizeAssets').mockResolvedValue({assetUrls:{[source]:'https://storage.example/old.glb',[variant]:'https://storage.example/new.glb'},assetNames:{[source]:'木椅',[variant]:'材质变体'}});
  vi.spyOn(controller,'applySceneProposal').mockImplementation(async selected=>({id:project,revision:2,scene:selected.candidate,previousScene:selected.base_scene,updatedAt:new Date().toISOString(),undoGroup:selected.id,acceptedLocally:true}));
});

describe('local activity geometry binding for material versions',()=>{
  it('synchronizes a private chat or reconstruction draft once on explicit preview before proposalState-style revision capture',async()=>{
    localActivity();const before=structuredClone(current),listeners=new Set<()=>void>();let notifications=0,automaticSyncs=0,preparedRevision=-1;
    vi.spyOn(controller,'subscribe').mockImplementation(listener=>{listeners.add(listener);return()=>{listeners.delete(listener);};});
    vi.mocked(controller.setDraft).mockImplementation(scene=>{
      snapshot={...snapshot,draft:sceneSchema.parse(scene),dirty:true,localRevision:snapshot.localRevision+1};
      for(const listener of listeners){notifications++;listener();}
    });
    // Mirror BackendSession.proposalState: synchronize only unequal wire scenes, then read the actual revision.
    function proposalStateScene(scene:Scene):Scene {
      const parsed=sceneSchema.parse(scene);
      if(canonical(snapshot.draft)!==canonical(parsed)){automaticSyncs++;controller.setDraft(parsed);}
      return parsed;
    }
    vi.mocked(controller.prepareMaterialVariantProposal).mockImplementationOnce(async input=>{
      const parsed=proposalStateScene(input.scene);preparedRevision=snapshot.localRevision;
      return {...proposal(parsed,input.objectIds,input.variantAssetId),local_revision:preparedRevision};
    });
    const apply=vi.mocked(controller.applySceneProposal).getMockImplementation()!;
    vi.mocked(controller.applySceneProposal).mockImplementationOnce(async(selected,scene)=>{
      const parsed=proposalStateScene(scene);expect(snapshot.localRevision).toBe(selected.local_revision);return apply(selected,parsed);
    });
    const rawScene=layoutToBackendScene(current);expect(rawScene.objects.some(object=>object.notes==='私密-物件备注')).toBe(true);
    snapshot={...snapshot,localRevision:6};controller.setDraft(rawScene);const rawRevision=snapshot.localRevision;
    expect(rawRevision).toBe(7);vi.mocked(controller.setDraft).mockClear();
    render(ui({seed:seed()}));await screen.findByText('木椅 · 含 UV');
    expect(listeners.size).toBeGreaterThan(0);expect(controller.setDraft).not.toHaveBeenCalled();expect(snapshot.localRevision).toBe(rawRevision);
    await preview();
    expect(controller.setDraft).toHaveBeenCalledOnce();expect(notifications).toBe(1);expect(automaticSyncs).toBe(0);
    expect(preparedRevision).toBe(rawRevision+1);expect(snapshot.localRevision).toBe(rawRevision+1);
    const wire=vi.mocked(controller.prepareMaterialVariantProposal).mock.calls[0]![0].scene;
    expect(wire.objects.every(object=>object.notes==='')).toBe(true);expect(JSON.stringify(wire)).not.toContain('私密-');
    fireEvent.click(screen.getByRole('button',{name:'确认应用到选定物件'}));await waitFor(()=>expect(onApply).toHaveBeenCalledOnce());
    expect(automaticSyncs).toBe(0);expect(controller.setDraft).toHaveBeenCalledOnce();expect(snapshot.localRevision).toBe(rawRevision+1);
    const next=onApply.mock.calls[0]![0] as RoomLayout;
    expect(next.id).toBe(localId);expect(next.eventOperations).toEqual(before.eventOperations);expect(next.productionPlan).toEqual(before.productionPlan);
    expect(next.floors[0]!.items[0]!.notes).toBe('私密-物件备注');expect(next.floors[0]!.items[0]!.handoff).toEqual(before.floors[0]!.items[0]!.handoff);
    expect(JSON.stringify(vi.mocked(controller.applySceneProposal).mock.calls)).not.toContain('私密-');
  });

  it('uses the remote proposal ID while preserving local activity records and withholding private notes from every scene payload',async()=>{
    localActivity();let ledger=localLedger();vi.mocked(readSourceRecord).mockImplementation(async()=>ledger);
    Object.assign(current.floors[0]!.items[0]!,{name:'联调签到椅',icon:'席',groupId:'local-seating-group'});
    const before=structuredClone(current);render(ui({seed:seed()}));await preview();
    expect(controller.setDraft).toHaveBeenCalledOnce();expect(snapshot.localRevision).toBe(1);
    expect(vi.mocked(controller.prepareMaterialVariantProposal).mock.calls[0]![0].scene.objects.every(object=>object.notes==='')).toBe(true);
    ledger=materialCheckinLedgerSchema.parse({...ledger,sheets:[{...ledger.sheets[0]!,events:[...ledger.sheets[0]!.events,{
      id:'80000000-0000-4000-8000-000000000005',kind:'receive',batchRef:'演练后补核零',quantity:0,checkState:'checked',occurredAt:'2026-10-08T04:00:00Z',
      fromPartyName:'演练交出方',toPartyName:'演练接收方',evidenceNote:'私密-最新点验说明',evidenceUrls:[],recordedAt:'2026-10-08T05:00:00Z',recordedBy:'演练记录人',
    }]}]});
    fireEvent.click(screen.getByRole('button',{name:'确认应用到选定物件'}));await waitFor(()=>expect(onApply).toHaveBeenCalledOnce());
    const next=onApply.mock.calls[0]![0] as RoomLayout;
    expect(next.id).toBe(localId);expect(next.eventOperations).toEqual(before.eventOperations);expect(next.productionPlan).toEqual(before.productionPlan);
    expect(next.floors[0]!.items[0]!.handoff).toEqual(before.floors[0]!.items[0]!.handoff);expect(next.floors[0]!.items[0]!.notes).toBe('私密-物件备注');
    expect(next.floors[0]!.items[0]).toMatchObject({name:'联调签到椅',icon:'席',groupId:'local-seating-group'});
    expect(next.floors[0]!.items[0]!.assetId).toBe(variant);expect(next.floors[0]!.items[1]!.assetId).toBe(source);
    expect(vi.mocked(controller.applySceneProposal).mock.calls[0]![0].project_id).toBe(project);
    expect(JSON.stringify([vi.mocked(controller.prepareMaterialVariantProposal).mock.calls,vi.mocked(controller.authorizeAssets).mock.calls,vi.mocked(controller.applySceneProposal).mock.calls,vi.mocked(controller.businessRequest).mock.calls])).not.toContain('私密-');
    expect(readSourceRecord).toHaveBeenCalledWith(['material-checkins',localId]);
    expect(ledger.sheets[0]!.events).toHaveLength(3);expect(materialCheckinSummary(ledger.sheets[0]!)).toMatchObject({agreedQuantity:20,receivedQuantity:18,returnedQuantity:18,notReceivedQuantity:2,notReturnedQuantity:0});
  });

  it('rejects a proposal belonging to another remote project even when the local activity identity stays unchanged',async()=>{
    localActivity();vi.mocked(controller.prepareMaterialVariantProposal).mockImplementationOnce(async input=>({...proposal(input.scene,input.objectIds,input.variantAssetId),project_id:'20000000-0000-4000-8000-000000000002'}));
    render(ui({seed:seed()}));fireEvent.click(await screen.findByRole('button',{name:'制作并预览材质版本'}));
    await screen.findByText(/候选版本或编辑权不匹配/);expect(controller.authorizeAssets).not.toHaveBeenCalled();expect(onApply).not.toHaveBeenCalled();
  });

  it.each(['inspection','connection','paid preview','apply'] as const)('blocks %s when the local activity ledger is unreadable',async stage=>{
    localActivity(stage!=='connection');
    if(stage==='inspection')vi.mocked(readSourceRecord).mockRejectedValue(new Error('独立点验记录读取失败'));
    render(ui(stage==='connection'?{}:{seed:seed()}));
    if(stage!=='inspection')await screen.findByText('木椅 · 含 UV');
    if(stage==='apply')await preview();
    vi.mocked(readSourceRecord).mockRejectedValue(new Error('独立点验记录读取失败'));
    if(stage!=='inspection')fireEvent.click(screen.getByRole('button',{name:stage==='connection'?'准备当前活动的场景服务':stage==='apply'?'确认应用到选定物件':'制作并预览材质版本'}));
    await screen.findByText(/点验.*读取失败|点验.*无法|点验.*读取/);
    expect(controller.applySceneProposal).not.toHaveBeenCalled();expect(controller.ensureGeometryWorkbenchReady).not.toHaveBeenCalled();expect(onApply).not.toHaveBeenCalled();
    if(stage==='inspection')expect(controller.businessRequest).not.toHaveBeenCalled();
    if(stage!=='apply'){
      expect(controller.prepareMaterialVariantProposal).not.toHaveBeenCalled();
      expect(vi.mocked(controller.businessRequest).mock.calls.every(([,method])=>method!=='POST')).toBe(true);
    }
  });

  it.each(['account','API mapping','remote project','binding ABA'] as const)('ignores a pending local proposal after an %s change',async change=>{
    localActivity();let finish!:(value:SceneProposal)=>void;
    vi.mocked(controller.prepareMaterialVariantProposal).mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
    const chosen=seed(),view=render(ui({seed:chosen}));fireEvent.click(await screen.findByRole('button',{name:'制作并预览材质版本'}));
    await waitFor(()=>expect(finish).toBeTypeOf('function'));
    const scene=vi.mocked(controller.prepareMaterialVariantProposal).mock.calls[0]![0].scene,response=proposal(scene);
    const savedBinding=snapshot.geometryBinding!;
    if(change==='account')snapshot={...snapshot,user:{id:'30000000-0000-4000-8000-000000000002'}};
    else if(change==='API mapping')snapshot={...snapshot,geometryBinding:{...savedBinding,apiUrl:'https://changed.example/scene-api'}};
    else if(change==='remote project')snapshot={...snapshot,project:{...snapshot.project!,id:'20000000-0000-4000-8000-000000000002'}};
    else {snapshot={...snapshot,geometryBinding:{...savedBinding,localActivityId:'house-other-local'}};view.rerender(ui({seed:chosen}));snapshot={...snapshot,geometryBinding:savedBinding};}
    view.rerender(ui({seed:chosen}));await act(async()=>finish(response));
    expect(controller.authorizeAssets).not.toHaveBeenCalled();expect(onApply).not.toHaveBeenCalled();expect(screen.queryByRole('button',{name:'确认应用到选定物件'})).toBeNull();
  });

  it('prepares an unconnected local activity explicitly without paid requests and retains edits after preparation failure',async()=>{
    localActivity(false);vi.mocked(controller.ensureGeometryWorkbenchReady).mockRejectedValueOnce(new Error('演练场景连接失败'));
    render(ui());await screen.findByText('木椅 · 含 UV');
    fireEvent.click(screen.getByRole('checkbox',{name:'修改基础色'}));fireEvent.change(screen.getByLabelText('基础色'),{target:{value:'#aabbcc'}});
    fireEvent.click(screen.getByRole('button',{name:'准备当前活动的场景服务'}));await screen.findByText('演练场景连接失败');
    expect((screen.getByLabelText('基础色') as HTMLInputElement).value).toBe('#aabbcc');
    fireEvent.click(screen.getByRole('button',{name:'准备当前活动的场景服务'}));
    await screen.findByText(/当前活动的场景服务已准备/);
    expect(controller.ensureGeometryWorkbenchReady).toHaveBeenCalledTimes(2);
    expect(controller.ensureGeometryWorkbenchReady).toHaveBeenCalledWith(expect.objectContaining({objects:expect.any(Array)}),current.name,localId);
    expect(JSON.stringify(vi.mocked(controller.ensureGeometryWorkbenchReady).mock.calls)).not.toContain('私密-');
    expect(controller.prepareMaterialVariantProposal).not.toHaveBeenCalled();expect(vi.mocked(controller.businessRequest).mock.calls.every(([,method])=>method!=='POST')).toBe(true);expect(onApply).not.toHaveBeenCalled();
    expect((screen.getByLabelText('基础色') as HTMLInputElement).value).toBe('#aabbcc');
  });

  it.each(['layout','account','mapping'] as const)('does not report an old connector ready after its %s changed while preparing',async change=>{
    localActivity(false);let finish!:(value:NonNullable<BackendSnapshot['project']>)=>void;
    let finishRead!:(value:ReturnType<typeof localLedger>)=>void,postRead=false;
    const ensure=vi.mocked(controller.ensureGeometryWorkbenchReady).getMockImplementation()!;
    if(change==='mapping'){
      const held=new Promise<ReturnType<typeof localLedger>>(resolve=>{finishRead=resolve;});
      let preparationReturned=false;
      vi.mocked(readSourceRecord).mockImplementation(async()=>{if(preparationReturned){postRead=true;return held;}return localLedger();});
      vi.mocked(controller.ensureGeometryWorkbenchReady).mockImplementationOnce(async(...args)=>{const result=await ensure(...args);preparationReturned=true;return result;});
    }else vi.mocked(controller.ensureGeometryWorkbenchReady).mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
    const view=render(ui());await screen.findByText('木椅 · 含 UV');
    fireEvent.click(screen.getByRole('button',{name:'准备当前活动的场景服务'}));
    if(change==='mapping')await waitFor(()=>expect(postRead).toBe(true));else await waitFor(()=>expect(finish).toBeTypeOf('function'));
    if(change==='layout')current={...current,name:'演练准备期间的新修改'};
    else if(change==='account')snapshot={...snapshot,user:{id:'30000000-0000-4000-8000-000000000002'}};
    else {
      const nextRemote='20000000-0000-4000-8000-000000000002';
      snapshot={...snapshot,project:{...snapshot.project!,id:nextRemote},geometryBinding:{...snapshot.geometryBinding!,cloudProjectId:nextRemote},lease:{...snapshot.lease!,projectId:nextRemote}};
      expect(controller.isGeometryBound(localId)).toBe(true);
    }
    view.rerender(ui());await act(async()=>{if(change==='mapping')finishRead(localLedger());else finish({id:project,name:'迟到场景服务',studio_id:user,revision:1,scene:base});});
    expect(screen.queryByText(/当前活动的场景服务已准备/)).toBeNull();expect(controller.prepareMaterialVariantProposal).not.toHaveBeenCalled();expect(onApply).not.toHaveBeenCalled();
    expect(vi.mocked(controller.businessRequest).mock.calls.every(([,method])=>method!=='POST')).toBe(true);
  });

  it('does not start a paid preview merely because a local geometry binding exists without an editing lease',async()=>{
    localActivity();snapshot={...snapshot,lease:null,writeBlocked:true};render(ui({seed:seed()}));await screen.findByText('木椅 · 含 UV');
    const button=screen.getByRole('button',{name:'制作并预览材质版本'});expect(button.hasAttribute('disabled')).toBe(true);fireEvent.click(button);
    expect(controller.prepareMaterialVariantProposal).not.toHaveBeenCalled();expect(controller.ensureGeometryWorkbenchReady).not.toHaveBeenCalled();expect(onApply).not.toHaveBeenCalled();
    expect(vi.mocked(controller.businessRequest).mock.calls.every(([,method])=>method!=='POST')).toBe(true);
  });
});
afterEach(()=>{cleanup();controller.dispose();vi.restoreAllMocks();vi.useRealTimers();});

describe('selected material version workflow',()=>{
  it('explains an asset without usable material slots and does not offer an impossible version request',async()=>{
    inspection={...inspection,slots:[]};render(ui());
    await screen.findByText('这个模型没有可调整的材质槽，暂不能创建材质版本。原模型保持不变。');
    const create=screen.getByRole('button',{name:'制作并预览材质版本'});expect(create.hasAttribute('disabled')).toBe(true);fireEvent.click(create);
    expect(controller.prepareMaterialVariantProposal).not.toHaveBeenCalled();expect(vi.mocked(controller.businessRequest).mock.calls.some(([,method])=>method==='POST')).toBe(false);
  });
  it('blocks customization and proposal preparation for an independent ledger without any layout business block',async()=>{
    vi.mocked(readSourceRecord).mockResolvedValue(checkinLedger());
    render(ui({seed:seed()}));
    await screen.findByText(/点验|本地执行信息/);
    expect(current.productionPlan).toBeUndefined();expect(current.eventOperations).toBeUndefined();
    expect(controller.prepareMaterialVariantProposal).not.toHaveBeenCalled();expect(controller.authorizeAssets).not.toHaveBeenCalled();
    expect(controller.businessRequest).not.toHaveBeenCalled();
    expect(vi.mocked(controller.businessRequest).mock.calls.every(([,method])=>method!=='POST')).toBe(true);
    expect(readSourceRecord).toHaveBeenCalledWith(['material-checkins',project]);expect(onApply).not.toHaveBeenCalled();
  });
  it('blocks applying a prepared material variant when an independent ledger was added',async()=>{
    render(ui({seed:seed()}));await preview();vi.mocked(readSourceRecord).mockResolvedValue(checkinLedger());
    fireEvent.click(screen.getByRole('button',{name:'确认应用到选定物件'}));await screen.findByText(/点验|本地执行信息/);
    expect(controller.applySceneProposal).not.toHaveBeenCalled();expect(onApply).not.toHaveBeenCalled();
    expect(layoutToBackendScene(current).objects[0].assetId).toBe(source);
  });
  it.each(['prepare','apply'] as const)('refuses %s when the independent ledger cannot be read',async stage=>{
    render(ui({seed:seed()}));
    await screen.findByText('木椅 · 含 UV');
    if(stage==='apply')await preview();
    vi.mocked(readSourceRecord).mockRejectedValue(new Error('独立点验记录读取失败'));
    fireEvent.click(await screen.findByRole('button',{name:stage==='apply'?'确认应用到选定物件':'制作并预览材质版本'}));
    await screen.findByText(/点验.*读取失败|点验.*无法|点验.*读取/);
    expect(controller.applySceneProposal).not.toHaveBeenCalled();expect(onApply).not.toHaveBeenCalled();
    if(stage==='prepare')expect(controller.prepareMaterialVariantProposal).not.toHaveBeenCalled();
  });
  it.each(['customize','proposal','authorize','glb'] as const)('rejects a ledger added while %s is pending before accepting the preview',async stage=>{
    let release!:()=>void,started=false;const held=new Promise<void>(resolve=>{release=resolve;});
    const request=vi.mocked(controller.businessRequest).getMockImplementation()!;
    const prepare=vi.mocked(controller.prepareMaterialVariantProposal).getMockImplementation()!;
    const authorize=vi.mocked(controller.authorizeAssets).getMockImplementation()!;
    vi.mocked(controller.businessRequest).mockImplementation(async(...args)=>{if(stage==='customize'&&args[1]==='POST'){started=true;await held;}return request(...args);});
    vi.mocked(controller.prepareMaterialVariantProposal).mockImplementation(async(...args)=>{if(stage==='proposal'){started=true;await held;}return prepare(...args);});
    vi.mocked(controller.authorizeAssets).mockImplementation(async(...args)=>{if(stage==='authorize'){started=true;await held;}return authorize(...args);});
    vi.mocked(ensureGlbAsset).mockImplementation(async()=>{if(stage==='glb'){started=true;await held;}});
    const before=structuredClone(current);
    render(ui({seed:seed()}));fireEvent.click(await screen.findByRole('button',{name:'制作并预览材质版本'}));
    await waitFor(()=>expect(started).toBe(true));vi.mocked(readSourceRecord).mockResolvedValue(checkinLedger());
    await act(async()=>release());await screen.findByText(/点验|本地执行信息/);
    expect(screen.queryByRole('button',{name:'确认应用到选定物件'})).toBeNull();expect(onApply).not.toHaveBeenCalled();expect(current).toEqual(before);
    if(stage==='customize')expect(controller.prepareMaterialVariantProposal).not.toHaveBeenCalled();
    if(stage==='customize'||stage==='proposal')expect(controller.authorizeAssets).not.toHaveBeenCalled();
    if(stage==='authorize')expect(ensureGlbAsset).not.toHaveBeenCalled();
  });
  it('keeps the local scene when an independent ledger is added while cloud apply is pending',async()=>{
    let release!:()=>void,started=false;const held=new Promise<void>(resolve=>{release=resolve;});
    const apply=vi.mocked(controller.applySceneProposal).getMockImplementation()!;
    vi.mocked(controller.applySceneProposal).mockImplementation(async(...args)=>{started=true;await held;return apply(...args);});
    const before=structuredClone(current);render(ui({seed:seed()}));await preview();
    fireEvent.click(screen.getByRole('button',{name:'确认应用到选定物件'}));await waitFor(()=>expect(started).toBe(true));
    vi.mocked(readSourceRecord).mockResolvedValue(checkinLedger());await act(async()=>release());await screen.findByText(/点验|本地执行信息/);
    expect(controller.applySceneProposal).toHaveBeenCalledOnce();expect(onApply).not.toHaveBeenCalled();expect(current).toEqual(before);
  });
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
    const create=await screen.findByRole('button',{name:'制作并预览材质版本'});expect(create.hasAttribute('disabled')).toBe(true);fireEvent.click(create);
    expect(controller.businessRequest).not.toHaveBeenCalledWith(expect.stringContaining('/customize'),expect.anything(),expect.anything());
    fireEvent.click(screen.getByRole('checkbox',{name:/座面/}));
    expect(create.hasAttribute('disabled')).toBe(false);
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

  it('renders only the first target at real size and tint in a compact independent preview',async()=>{
    const sourceScene={...base,objects:base.objects.map((object,index)=>index?object:{...object,rotation:45,elevation:1})};
    current=backendSceneToLayout(sourceScene,{projectId:project,name:'大场景'});
    render(ui({seed:seed({objectIds:[first,second]})}));await preview();
    expect(screen.getByText(/预览首个目标；将应用到 2 件/)).toBeTruthy();
    const rendered=()=>vi.mocked(ScenePreview).mock.calls.at(-1)![0].scene;
    const candidate=rendered();expect(candidate.objects).toHaveLength(1);
    expect(candidate.objects[0]).toMatchObject({id:first,assetId:variant,size:sourceScene.objects[0].size,color:'#eeddcc',rotation:45,elevation:0});
    expect(candidate.objects[0].position).toEqual({x:candidate.venue.width/2,z:candidate.venue.depth/2});
    expect(candidate.venue.width).toBeLessThan(sourceScene.venue.width);expect(candidate.venue.depth).toBeLessThan(sourceScene.venue.depth);
    fireEvent.click(screen.getByRole('button',{name:'原版本'}));const original=rendered();
    expect(original.objects[0]).toEqual({...candidate.objects[0],assetId:source});expect(original.venue).toEqual(candidate.venue);
    fireEvent.click(screen.getByRole('button',{name:'候选版本'}));expect(rendered()).toBe(candidate);
    fireEvent.click(screen.getByRole('button',{name:'确认应用到选定物件'}));await waitFor(()=>expect(onApply).toHaveBeenCalledOnce());
    const applied=vi.mocked(controller.applySceneProposal).mock.calls[0][0].candidate;
    expect(applied.objects).toHaveLength(2);expect(applied.objects[0].position).toEqual(sourceScene.objects[0].position);expect(applied.objects[0].elevation).toBe(1);expect(applied.venue).toEqual(sourceScene.venue);
  });

});
