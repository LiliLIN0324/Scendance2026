import { describe, expect, it } from 'vitest';
import assetIds from '../../../../assets/library/asset-ids.json';
import catalogue from '../../../../assets/library/online.json';
import { sceneSchema } from '../../../../supabase/functions/_shared/domain';
import { backendSceneToLayout, layoutToBackendScene } from './backend-adapter';
import { buildOnlineModelIndex, normalizeOnlineModels, onlineModelThumb } from './online-models';
import { parseStoredLayout } from './schema';

describe('full v0.4.1 catalogue cloud compatibility',()=>{
  it('keeps every model and its identity through save, reload and local serialization, including thin models',()=>{
    const models=normalizeOnlineModels(catalogue);
    expect(models).toHaveLength(234);
    expect(buildOnlineModelIndex(models).buckets).toHaveLength(13);
    expect(new Set(models.map(m=>m.assetId)).size).toBe(234);
    for(const model of models){
      expect(model.assetId).toBe((assetIds as Record<string,string>)[model.glb]);
      const doc=sceneSchema.parse({schemaVersion:1,venue:{shape:'rectangle',width:100,depth:100,height:6,entrances:[]},camera:'overview',lighting:'warm',
        objects:[{id:'10000000-0000-4000-8000-000000000001',materialId:'asset',assetId:model.assetId,
          position:{x:50,z:50},rotation:30,size:{width:model.width,depth:model.depth,height:model.height},color:'#ffffff',locked:true,notes:'Keep this note'}]});
      const layout=backendSceneToLayout(doc,{assetNames:{[model.assetId!]:model.name},assetUrls:{[model.assetId!]:'https://storage.example/model.glb?token=short'}});
      const reopened=parseStoredLayout(JSON.parse(JSON.stringify(layout)));
      expect(reopened).not.toBeNull();
      expect(reopened!.floors[0].items[0].source).toBe('public_library');
      const saved=layoutToBackendScene(reopened!);
      expect(saved.objects[0].rotation).toBeCloseTo(doc.objects[0].rotation, 10);
      expect(saved).toEqual({ ...doc, objects: [{ ...doc.objects[0], rotation: saved.objects[0].rotation }] });
      expect(JSON.stringify(saved)).not.toContain('token=');
      expect(onlineModelThumb('https://storage.example/model.glb?token=short',model.assetId)).toBe(model.thumb);
    }
  });
  it('upgrades an old local catalogue instance by its exact pinned URL without accepting arbitrary GLBs',()=>{
    const model=catalogue.models[0];
    const doc=sceneSchema.parse({schemaVersion:1,venue:{shape:'rectangle',width:10,depth:10,height:3,entrances:[]},camera:'overview',lighting:'warm',objects:[]});
    const layout=backendSceneToLayout(doc);
    layout.floors[0].items.push({id:'10000000-0000-4000-8000-000000000001',type:'glb-asset',materialId:'asset',name:model.name,
      width:model.width,depth:model.depth,height:model.height,position:{x:0,z:0},color:'#ffffff',icon:'◇',price:0,category:'decor',source:'public_library',glbUrl:model.glb});
    expect(layoutToBackendScene(layout).objects[0].assetId).toBe(model.assetId);
    layout.floors[0].items[0].glbUrl=model.glb+'?different=1';
    expect(()=>layoutToBackendScene(layout)).toThrow('尚未归档到云端');
  });
});
