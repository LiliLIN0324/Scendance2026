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
  it('keeps opaque library references case-sensitive',()=>{
    for(const resourceId of ['library:TENT','LIBRARY:tent'])expect(()=>buildProposal(scene(),'modify',{explanation:'add',commands:[add(resourceId)]},[tent])).toThrow('RESOURCE_NOT_FOUND');
  });
});

describe('material suggestions use asset identity without widening instance permission',()=>{
  const assetId='abcdef00-0000-4000-8000-000000000001';
  const instances=()=>[{...chair(),materialId:'asset' as const,assetId},{...chair('原说明'),materialId:'asset' as const,assetId:assetId.toUpperCase(),position:{x:7,z:6},color:'#abcdef'}];
  const suggestion=(objectIds:string[])=>({objectIds,name:'只建议原模型材质',reason:'同源模型待人工核对材质槽',scope:'choose_materials',changes:{roughness:0.2}});
  it('permits same-source UUID aliases and preserves original scene IDs, sizes, colors and positions',()=>{
    const objects=instances(),base={...scene(),objects},value=suggestion(objects.map(object=>object.id));
    const result=buildProposal(base,'modify',{explanation:'提出材质建议，不应用。',commands:[],materialSuggestions:[value]},[],value.objectIds);
    expect(result.scene).toEqual(base);expect(result.materialSuggestions).toEqual([{...value,sourceAssetId:assetId}]);expect(objects[1].assetId).toBe(assetId.toUpperCase());
  });
  it.each(['different-asset','locked','unselected','replaced-source'])('rejects a material suggestion with %s',boundary=>{
    const objects=instances();if(boundary==='different-asset')objects[1].assetId='abcdef00-0000-4000-8000-000000000002';if(boundary==='locked')objects[1].locked=true;
    const base={...scene(),objects},original=structuredClone(base),value=suggestion(objects.map(object=>object.id));
    const commands=boundary==='replaced-source'?[{op:'replace_resource',id:objects[0].id,resourceId:tent.resourceId}]:[];
    expect(()=>buildProposal(base,'modify',{explanation:'invalid',commands,materialSuggestions:[value]},[tent],boundary==='unselected'?[objects[0].id]:value.objectIds)).toThrow('INVALID_MATERIAL_TARGET');
    expect(base).toEqual(original);
  });
});

describe('shared proposal selection boundaries',()=>{
  function input() {
    const selected={...chair(),position:{x:3,z:3}},other={...chair(),position:{x:8,z:8}};
    return {selected,other,base:{...scene(),objects:[selected,other]}};
  }
  it.each([
    ['move',(id:string)=>({op:'move',id,position:{x:9,z:8}})],
    ['remove',(id:string)=>({op:'remove',id})],
    ['recolor',(id:string)=>({op:'recolor',id,color:'#ff0000'})],
    ['rotate',(id:string)=>({op:'rotate',id,rotation:45})],
    ['replace',(id:string)=>({op:'replace',id,materialId:'table'})],
    ['replace_resource',(id:string)=>({op:'replace_resource',id,resourceId:tent.resourceId})],
  ] as const)('rejects unselected %s through the shared builder without changing the input',(_op,command)=>{
    const {selected,other,base}=input(),original=structuredClone(base);
    expect(()=>buildProposal(base,'modify',{explanation:'只修改选中物件',commands:[command(other.id)]},[tent],[selected.id])).toThrow('INVALID_SELECTION');
    expect(base).toEqual(original);
  });
  it('rejects a whole batch containing a selected move followed by an unselected move',()=>{
    const {selected,other,base}=input(),original=structuredClone(base);
    expect(()=>buildProposal(base,'modify',{explanation:'混合范围命令',commands:[
      {op:'move',id:selected.id,position:{x:4,z:3}},
      {op:'move',id:other.id,position:{x:9,z:8}},
    ]},[],[selected.id])).toThrow('INVALID_SELECTION');
    expect(base).toEqual(original);
  });
  it('allows a selected existing object to move and preserves the other instance',()=>{
    const {selected,other,base}=input(),original=structuredClone(base);
    const result=buildProposal(base,'modify',{explanation:'移动选中物件',commands:[{op:'move',id:selected.id,position:{x:4,z:3}}]},[],[selected.id]);
    expect(result.scene.objects[0]).toEqual({...selected,position:{x:4,z:3}});
    expect(result.scene.objects[1]).toEqual(other);expect(base).toEqual(original);
  });
  it('allows ordinary existing-object modifications when the selection is empty',()=>{
    const {other,base}=input(),original=structuredClone(base);
    const result=buildProposal(base,'modify',{explanation:'未限制选中范围',commands:[{op:'move',id:other.id,position:{x:9,z:8}}]},[],[]);
    expect(result.scene.objects[1]).toEqual({...other,position:{x:9,z:8}});expect(base).toEqual(original);
  });
  it.each([
    {op:'add',materialId:'chair',position:{x:6,z:5},rotation:0,color:'#ffffff'},
    {op:'add_resource',resourceId:tent.resourceId,position:{x:6,z:5},rotation:0},
  ])('allows $op because it does not target an existing object ID',command=>{
    const {selected,base}=input(),original=structuredClone(base);
    const result=buildProposal(base,'modify',{explanation:'增加新物件',commands:[command]},[tent],[selected.id]);
    expect(result.scene.objects).toHaveLength(3);expect(result.scene.objects.slice(0,2)).toEqual(base.objects);
    expect(result.scene.objects[2].id).not.toBe(selected.id);expect(base).toEqual(original);
  });
});
