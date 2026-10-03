import {describe,it,expect} from 'vitest';
import {buildProposal} from '../supabase/functions/_shared/ai.ts';
import {scene,chair} from './fixtures.ts';
const assetId='40000000-0000-4000-8000-000000000001';
const a={...chair(),materialId:'asset' as const,assetId};
const b={...a,id:'20000000-0000-4000-8000-000000000099'};
const suggestion={objectIds:[a.id],name:'白色哑光椅',reason:'只修改选中椅子的材质',scope:'all_materials',changes:{baseColor:'#ffffff',metallic:0,roughness:0.8}};
describe('Agent material personalization handoff',()=>{
  it('prepares a selected-instance material suggestion without changing the scene or another instance',()=>{
    const base={...scene(),objects:[a,b]};
    const result=buildProposal(base,'modify',{explanation:'先核对材质预览。',commands:[],materialSuggestions:[suggestion]},[],[a.id]);
    expect(result.scene).toEqual(base);
    expect(result.materialSuggestions).toEqual([{...suggestion,sourceAssetId:assetId}]);
  });
  it('rejects suggestions outside the selection, locked objects, nonexistent objects and unrelated assets',()=>{
    for(const [objects,ids] of [[[a,b],[b.id]],[[{...a,locked:true},b],[a.id]],[[a,b],['20000000-0000-4000-8000-000000000098']],[[a,{...b,assetId:'40000000-0000-4000-8000-000000000002'}],[a.id,b.id]]] as const) {
      expect(()=>buildProposal({...scene(),objects:[...objects]},'modify',{explanation:'invalid',commands:[],materialSuggestions:[{...suggestion,objectIds:[...ids]}]},[],[a.id])).toThrow();
    }
  });
  it('does not suggest material changes to an instance removed or replaced by the same plan',()=>{
    expect(()=>buildProposal({...scene(),objects:[a]},'modify',{explanation:'invalid',commands:[{op:'remove',id:a.id}],materialSuggestions:[suggestion]})).toThrow();
  });
  it('does not accept guessed material slots, links, invalid values or empty changes',()=>{
    for(const changes of [{},{metallic:2},{baseColor:'#fff'},{materialIndices:[4]},{url:'https://example.com/model.glb'}]) {
      expect(()=>buildProposal({...scene(),objects:[a]},'modify',{explanation:'invalid',commands:[],materialSuggestions:[{...suggestion,changes}]})).toThrow();
    }
  });
});
