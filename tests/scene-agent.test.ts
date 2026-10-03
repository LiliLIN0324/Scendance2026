import { describe,it,expect } from 'vitest';
import { buildProposal } from '../supabase/functions/_shared/ai.ts';
import { scene,chair } from './fixtures.ts';

const tent={resourceId:'library:tent',assetId:'40000000-0000-4000-8000-000000000001',name:'Base Camp Dome Tent',category:'帐篷',size:{width:3,depth:3,height:2}};
describe('scene agent resource execution',()=>{
  it('adds a real catalog resource with the trusted asset ID and dimensions',()=>{
    const base=scene();
    const result=buildProposal(base,'modify',{explanation:'在中央加入资源库帐篷。',commands:[{op:'add_resource',resourceId:tent.resourceId,position:{x:6,z:5},rotation:90}]},[tent]);
    expect(result.scene.objects).toEqual([expect.objectContaining({materialId:'asset',assetId:tent.assetId,size:tent.size,position:{x:6,z:5},rotation:90})]);
    expect(base.objects).toEqual([]);
  });
});

describe('resource constraints and model handoff',()=>{
  const add=(resourceId=tent.resourceId)=>({op:'add_resource',resourceId,position:{x:6,z:5},rotation:0});
  it('does not accept an invented resource, raw asset ID or model URL',()=>{
    for(const command of [add('made-up'),{...add(),assetId:tent.assetId},{...add(),url:'https://evil.test/model.glb'}]) {
      expect(()=>buildProposal(scene(),'modify',{explanation:'invalid',commands:[command]},[tent])).toThrow();
    }
  });
  it('requires dimensions for a personal model with no confirmed size',()=>{
    const {size,...unknown}=tent;
    expect(()=>buildProposal(scene(),'modify',{explanation:'add',commands:[add()]},[unknown])).toThrow('RESOURCE_SIZE_REQUIRED');
    expect(buildProposal(scene(),'modify',{explanation:'add',commands:[{...add(),size}]},[unknown]).scene.objects[0].size).toEqual(size);
  });
  it('rejects resource dimensions that the editor cannot represent',()=>{
    for(const size of [{width:0.01,depth:1,height:1},{width:51,depth:1,height:1},{width:1,depth:1,height:31}]) {
      expect(()=>buildProposal(scene(),'modify',{explanation:'add',commands:[{...add(),size}]},[tent])).toThrow();
    }
  });
  it('keeps locked objects and rejects resource footprints outside the venue',()=>{
    const original={...chair(),locked:true};const base={...scene(),objects:[original]};
    expect(()=>buildProposal(base,'modify',{explanation:'replace',commands:[{op:'replace_resource',id:original.id,resourceId:tent.resourceId}]},[tent])).toThrow('OBJECT_LOCKED');
    expect(()=>buildProposal(scene(),'modify',{explanation:'add',commands:[{...add(),position:{x:0,z:0}}]},[tent])).toThrow('STRUCTURAL_COLLISION');
    expect(base.objects).toEqual([original]);
  });
  it('replaces an instance with a library asset while preserving its identity and location',()=>{
    const original=chair();const base={...scene(),objects:[original]};
    const result=buildProposal(base,'modify',{explanation:'replace',commands:[{op:'replace_resource',id:original.id,resourceId:tent.resourceId}]},[tent]);
    expect(result.scene.objects[0]).toMatchObject({id:original.id,position:original.position,assetId:tent.assetId,size:tent.size});
  });
  it('returns model suggestions and an unchanged scene when a needed model is absent',()=>{
    const suggestion={name:'品牌花瓣座椅',reason:'目录中没有对应定制造型',prompt:'单件花瓣形座椅，圆润底座，白色外壳'};
    const base=scene();const result=buildProposal(base,'modify',{explanation:'需要补充定制物料。',commands:[],modelSuggestions:[suggestion]},[tent]);
    expect(result.scene).toEqual(base);expect(result.modelSuggestions).toEqual([suggestion]);
  });
  it('rejects false GLB recoloring instead of reporting an unrendered change',()=>{
    const original={...chair(),materialId:'asset' as const,assetId:tent.assetId};
    expect(()=>buildProposal({...scene(),objects:[original]},'modify',{explanation:'recolor',commands:[{op:'recolor',id:original.id,color:'#ff0000'}]})).toThrow('ASSET_MATERIAL_UNSUPPORTED');
  });
});
