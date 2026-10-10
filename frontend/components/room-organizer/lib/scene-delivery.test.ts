// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { act, cleanup, renderHook } from '@testing-library/react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { eventOperationsSchema } from '../../../../supabase/functions/_shared/event-operations-contract';
import { productionPlanSchema } from '../../../../supabase/functions/_shared/production-plan-contract';
import { useGlbAssets } from '../hooks/use-glb-assets';
import { clearGlbAssetCache, disposeOwnedModel, ensureGlbAsset, getGlbAssetState } from '../three/glb-assets';
import { backendSceneToLayout, createMeasuredRoomLayout } from './backend-adapter';
import { assembleDeliveryScene, deliveryMaterials, deliveryOperations, eventOperationsCsv, exportDeliveryGlb, prepareDeliveryAssets, sceneDeliveryCsv, sceneDeliveryJson, verifyDeliveryReload } from './scene-delivery';
import type { BackendSession, Scene } from '@/lib/backend-session';

const chairId='10000000-0000-4000-8000-000000000001';
const variantId='10000000-0000-4000-8000-000000000002';
const projectId='20000000-0000-4000-8000-000000000001';
const objectId=(i:number)=>`30000000-0000-4000-8000-${String(i).padStart(12,'0')}`;
const base:Scene={schemaVersion:1,venue:{width:8,depth:6,height:3,shape:'rectangle',entrances:[]},objects:[],camera:'overview',lighting:'neutral'};
function object(i:number,assetId=chairId):Scene['objects'][number] {
  return {id:objectId(i),assetId,materialId:'asset',position:{x:1+(i%4),z:1+Math.floor(i/4)},rotation:i===2?35:0,size:{width:.46,depth:.514,height:.887},color:'#ffffff',locked:false,notes:''};
}
function layout(objects:Scene['objects']=[]) { return backendSceneToLayout({...base,objects},{projectId,name:'展览方案',assetNames:{[chairId]:'原版椅子',[variantId]:'哑光椅子'},assetUrls:{[chairId]:'https://storage.example/chair.glb?token=private',[variantId]:'https://storage.example/variant.glb?token=private'}}); }
async function load(assetId=chairId) {
  vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response(new Uint8Array(readFileSync('../assets/models/chair.glb')).buffer));
  await ensureGlbAsset(assetId,'/assets/models/chair.glb');
}
afterEach(()=>{clearGlbAssetCache();vi.restoreAllMocks();});

describe('scene delivery',()=>{
  it('shares one public recovery between the rendered layout and delivery without changing the saved URL',async()=>{
    const publicId='6a4e04d0-57a7-528b-863c-41ee15c91fa7';
    const sha='eb631b23a79b71a6f20e779d7441b3ef19f5f29192ab25d168065324950af3f6';
    const origin='https://supabase.example.test';
    const expired=`${origin}/storage/v1/object/sign/scene-assets/11111111-1111-4111-8111-111111111111/${publicId}/${sha}.glb?token=expired-test`;
    const local='/showcase/assets/library/model/beach-surf-and-paddle-kit-folding-beach-chair-68794f97.glb';
    const current=backendSceneToLayout({...base,objects:[object(1,publicId)]},{assetUrls:{[publicId]:expired}});
    const before=JSON.stringify(current);
    const bytes=new Uint8Array(readFileSync('../assets/library/model/beach-surf-and-paddle-kit-folding-beach-chair-68794f97.glb')).buffer;
    const fetcher=vi.spyOn(globalThis,'fetch').mockImplementation(async url=>{
      if(url===expired)return new Response(null,{status:403});
      if(url===local)return new Response(bytes);
      throw new Error('Unexpected test request');
    });
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL',origin);
    try {
      renderHook(()=>useGlbAssets(current));
      await act(async()=>{await prepareDeliveryAssets(current);});
      expect(getGlbAssetState(publicId).status).toBe('ready');
      expect(fetcher.mock.calls.map(([url])=>url)).toEqual([expired,local]);
      expect(JSON.stringify(current)).toBe(before);
    } finally {cleanup();vi.unstubAllEnvs();}
  });

  it('propagates an authorization refusal before public recovery and does not request model bytes',async()=>{
    const publicId='6a4e04d0-57a7-528b-863c-41ee15c91fa7';
    const current=backendSceneToLayout({...base,objects:[object(1,publicId)]});
    const refusal=new Error('SESSION_CHANGED');
    const authorizeAsset=vi.fn().mockRejectedValue(refusal);
    const controller={getSnapshot:()=>({user:{id:'test-user'}}),authorizeAsset,
      config:{url:'https://supabase.example.test'}} as unknown as BackendSession;
    const fetcher=vi.spyOn(globalThis,'fetch');
    await expect(prepareDeliveryAssets(current,controller)).rejects.toBe(refusal);
    expect(authorizeAsset).toHaveBeenCalledWith(publicId);
    expect(fetcher).not.toHaveBeenCalled();
    expect(getGlbAssetState(publicId).status).toBe('idle');
  });

  it('recovers a confirmed expired public archive URL using the same shipped GLB before delivery',async()=>{
    const publicId='6a4e04d0-57a7-528b-863c-41ee15c91fa7';
    const sha='eb631b23a79b71a6f20e779d7441b3ef19f5f29192ab25d168065324950af3f6';
    const origin='https://supabase.example.test';
    const expired=`${origin}/storage/v1/object/sign/scene-assets/11111111-1111-4111-8111-111111111111/${publicId}/${sha}.glb?token=expired-test`;
    const local='/showcase/assets/library/model/beach-surf-and-paddle-kit-folding-beach-chair-68794f97.glb';
    const current=backendSceneToLayout({...base,objects:[object(1,publicId)]},{assetUrls:{[publicId]:expired}});
    const before=JSON.stringify(current);
    const bytes=new Uint8Array(readFileSync('../assets/library/model/beach-surf-and-paddle-kit-folding-beach-chair-68794f97.glb')).buffer;
    const fetcher=vi.spyOn(globalThis,'fetch').mockImplementation(async url=>{
      if(url===expired)return new Response(null,{status:403});
      if(url===local)return new Response(bytes);
      throw new Error('Unexpected test request');
    });
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL',origin);
    try {
      await prepareDeliveryAssets(current);
      expect(getGlbAssetState(publicId).status).toBe('ready');
      expect(fetcher.mock.calls.map(([url])=>url)).toEqual([expired,local]);
      expect(JSON.stringify(current)).toBe(before);
      const delivered=assembleDeliveryScene(current);
      expect(delivered.children.some(child=>child.userData.deliveryObjectId===objectId(1))).toBe(true);
      disposeOwnedModel(delivered);
    } finally {vi.unstubAllEnvs();}
  });

  it('keeps a known public ID with an unproven custom private URL failed instead of rolling it back',async()=>{
    const publicId='6a4e04d0-57a7-528b-863c-41ee15c91fa7';
    const custom='https://supabase.example.test/private/custom-version.glb?token=expired-test';
    const current=backendSceneToLayout({...base,objects:[object(1,publicId)]},{assetUrls:{[publicId]:custom}});
    const fetcher=vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response(null,{status:403}));
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL','https://supabase.example.test');
    try {
      await expect(prepareDeliveryAssets(current)).rejects.toThrow('HTTP 403');
      expect(getGlbAssetState(publicId).status).toBe('error');
      expect(fetcher.mock.calls.map(([url])=>url)).toEqual([custom]);
      expect(()=>assembleDeliveryScene(current)).toThrow('未导出占位物件');
    } finally {vi.unstubAllEnvs();}
  });

  it('carries missing production-linked object diagnostics into the task CSV and scene JSON without inventing direct references',async()=>{
    const current=layout(),taskId=objectId(200),missingId=objectId(201);
    current.eventOperations=eventOperationsSchema.parse({dataKind:'rehearsal',tasks:[{id:taskId,title:'演练：清点租赁椅',phase:'setup',evidenceNote:'演练短缺，尚待处理'}]});
    current.productionPlan=productionPlanSchema.parse({acquisitions:[{id:objectId(202),title:'演练租赁计划',taskIds:[taskId],objectIds:[missingId]}]});
    expect((await deliveryOperations(current))!.tasks[0]).toMatchObject({objectIds:[],missingObjectIds:[],missingProductionObjectIds:[missingId],effectiveStatus:'needs_review'});
    const exported=JSON.parse(await sceneDeliveryJson(current));
    expect(exported.operations.tasks[0].missingProductionObjectIds).toEqual([missingId]);
    const csv=await eventOperationsCsv(current);
    expect(csv).toContain('"制作计划缺失物件编号"');expect(csv).toContain(`"","${missingId}",""`);expect(csv).toContain('演练短缺，尚待处理');
    expect(current.eventOperations.tasks[0].objectIds).toEqual([]);
  });
  it('groups material quantities by immutable asset version, dimensions and visual color without inventing prices',()=>{
    const current=layout([...Array.from({length:10},(_,i)=>object(i)),object(10,variantId),object(11,variantId)]);
    current.floors[0].items[10].source='generated';current.floors[0].items[11].source='generated';
    const materials=deliveryMaterials(current);
    expect(materials.map(row=>row.quantity)).toEqual([10,2]);
    expect(materials[1]).toMatchObject({assetVersionId:variantId,procurement:'概念物料，采购待确认'});
    expect(materials.every(row=>!('price' in row))).toBe(true);
    const changed={...current,floors:[{...current.floors[0],items:current.floors[0].items.map((item,index)=>index===0?{...item,color:'#ffeedd'}:item)}]};
    expect(deliveryMaterials(changed).map(row=>row.quantity)).toEqual([1,9,2]);
  });
  it('exports a canonical scene with references but never embeds signed URLs or private layout history',async()=>{
    const current=layout([object(1)]);
    const json=await sceneDeliveryJson(current);
    expect(json).not.toContain('token=');expect(json).not.toContain('storage.example');expect(json).not.toContain('glbUrl');
    expect(JSON.parse(json).scene.objects[0]).toMatchObject({assetId:chairId,position:{x:2,z:1}});
    expect(JSON.parse(json).materials[0].assetVersionId).toBe(chairId);
  });
  it('escapes CSV names and neutralizes spreadsheet formulas',()=>{
    const current=layout([object(1)]);current.floors[0].items[0].name='=HYPERLINK("private")';
    expect(sceneDeliveryCsv(current)).toContain('"\'=HYPERLINK(""private"")"');
    expect(sceneDeliveryCsv(current)).not.toContain('token=');
  });
  it('fails closed on missing GLB models instead of exporting renderer placeholders',()=>{
    expect(()=>assembleDeliveryScene(layout([object(1)]))).toThrow('尚未就绪');
  });
  it('rejects glbNode presets and multiple floors rather than exporting a partial scene',async()=>{
    const current=layout([object(1)]);current.floors[0].items[0].glbNode='chair';
    expect(()=>assembleDeliveryScene(current)).toThrow('完整场景预设');
    await expect(sceneDeliveryJson({...layout(),floors:[...layout().floors,...layout().floors]})).rejects.toThrow('单层');
  });
  it('exports and actually reloads a 12-chair scene with stable IDs, materials, rotations and height',async()=>{
    await load();await load(variantId);
    const current=layout(Array.from({length:12},(_,i)=>object(i,i<2?variantId:chairId)));
    current.floors[0].items[2].elevation=.5;
    const output=await exportDeliveryGlb(current);
    expect(output.objectCount).toBe(12);
    const reopened=(await new GLTFLoader().parseAsync(output.buffer,'')).scene;
    const ids:string[]=[];reopened.traverse(node=>{if(node.userData.deliveryKind==='material')ids.push(node.userData.deliveryObjectId);});
    expect(ids.sort()).toEqual(current.floors[0].items.map(item=>item.id).sort());
    expect(new Uint8Array(output.buffer).slice(0,4)).toEqual(new Uint8Array([0x67,0x6c,0x54,0x46]));
    disposeOwnedModel(reopened);
  });
  it('preserves measured structure and material instances through export/reload',async()=>{
    await load();const current=createMeasuredRoomLayout(layout([object(1)]),{width:8,depth:6,height:3});
    const output=await exportDeliveryGlb(current);
    expect(output.objectCount).toBe(1);
    const reopened=(await new GLTFLoader().parseAsync(output.buffer,'')).scene;
    const shells:THREE.Object3D[]=[];reopened.traverse(node=>{if(node.userData.deliveryKind==='shell')shells.push(node);});
    expect(shells.length).toBeGreaterThanOrEqual(5);disposeOwnedModel(reopened);
  });
  it.each(['geometry','uv','material','placement','missing'] as const)('detects %s corruption on reload before download',async mutation=>{
    await load();const source=assembleDeliveryScene(layout([object(1)]));
    const changed=source.clone(true);let target:THREE.Object3D|undefined;
    changed.traverse(node=>{if(node.userData.deliveryObjectId===objectId(1))target=node;});
    if(mutation==='missing')target!.removeFromParent();
    else if(mutation==='placement')target!.position.x+=.02;
    else {
      let mesh:THREE.Mesh|undefined;target!.traverse(node=>{if(!mesh&&(node as THREE.Mesh).isMesh)mesh=node as THREE.Mesh;});
      if(mutation==='material'){mesh!.material=(mesh!.material as THREE.Material).clone();(mesh!.material as THREE.MeshStandardMaterial).roughness=.01;}
      else{mesh!.geometry=mesh!.geometry.clone();if(mutation==='geometry')mesh!.geometry.attributes.position.setX(0,2);else mesh!.geometry.setAttribute('uv',new THREE.Float32BufferAttribute(new Float32Array(mesh!.geometry.attributes.position.count*2),2));}
    }
    expect(()=>verifyDeliveryReload(source,changed)).toThrow('复检失败');disposeOwnedModel(source);
  });
});
