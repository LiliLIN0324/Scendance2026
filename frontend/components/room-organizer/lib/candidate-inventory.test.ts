import {describe,expect,it} from 'vitest';
import {makeFloor,makeItem,makeLayout} from './__testfixtures__/fixtures';
import {checkCandidateInventory,type CandidateInventory} from './candidate-inventory';

const inventory:CandidateInventory={origin:'assumption',entries:[{
  name:'假设椅子',identity:{kind:'type',value:'chair'},dimensions:{width:.5,depth:.5,height:.8},available:55,
}]};
function chair(index:number){return makeItem({id:`synthetic-chair-${index}`,name:'假设椅子',type:'chair',source:'builtin',width:.5,depth:.5,height:.8,position:{x:-6+(index%10)*1.3,z:-5+Math.floor(index/10)*1.5}});}
const candidate=(count:number)=>makeLayout({id:'synthetic-only',width:15,height:12,floors:[makeFloor({items:Array.from({length:count},(_,index)=>chair(index))})]});
const row=inventory.entries[0]!;

describe('候选与已提供物料数量的核对',()=>{
  it('对 60 把候选椅与 55 把假设总数报告缺口，不改候选',()=>{
    const layout=candidate(60),before=structuredClone(layout),check=checkCandidateInventory(layout,inventory);
    expect(check.status).toBe('violated');
    expect(check.shortages).toMatchObject([{required:60,available:55,missing:5}]);
    expect(check.shortages[0]!.objectIds).toHaveLength(60);
    expect(check.message).toContain('缺 5 件假设椅子');expect(check.message).toContain('并非真实库存');
    expect(layout).toEqual(before);
  });
  it('数量足够仅表示所列信息内未超出，不代表实物可用',()=>{
    const check=checkCandidateInventory(candidate(55),inventory);
    expect(check.status).toBe('pass');expect(check.shortages).toEqual([]);
    expect(check.message).toContain('不代表实物可用或现场条件已核验');
  });
  it('无库存、身份不明或规格不同均为 unknown，不能按名称猜测',()=>{
    expect(checkCandidateInventory(candidate(1)).status).toBe('unknown');
    const layout=candidate(3);layout.floors[0]!.items[0]!.materialId='table';
    layout.floors[0]!.items[1]!.width=.51;layout.floors[0]!.items[2]!.glbUrl='/different-model.glb';
    const check=checkCandidateInventory(layout,inventory);
    expect(check.status).toBe('unknown');expect(check.unknownObjectIds).toHaveLength(3);expect(check.shortages).toEqual([]);
  });
  it('物料和资产分别按身份及完整规格核对，不将数字模型混作通用椅',()=>{
    const layout=candidate(1);layout.floors[0]!.items[0]!.materialId='chair';
    const byId:CandidateInventory={origin:'user_reported',entries:[{...row,identity:{kind:'material_id',value:'chair'},available:0}]};
    expect(checkCandidateInventory(layout,byId)).toMatchObject({status:'violated',shortages:[{missing:1,required:1,available:0}]});
    expect(checkCandidateInventory(layout,inventory).status).toBe('unknown');
    layout.floors[0]!.items[0]!.assetId='asset-version';
    expect(checkCandidateInventory(layout,byId).status).toBe('unknown');
    const exact:CandidateInventory={origin:'user_reported',entries:[{...row,identity:{kind:'asset_id',value:'asset-version'},available:1}]};
    expect(checkCandidateInventory(layout,exact).status).toBe('pass');
    expect(checkCandidateInventory(layout,{...exact,entries:[{...exact.entries[0]!,dimensions:{...row.dimensions,width:.51}}]}).status).toBe('unknown');
  });
  it('已确定缺口和未知物件同时存在时均保留',()=>{
    const layout=candidate(57);layout.floors[0]!.items[56]!.width=.51;
    const check=checkCandidateInventory(layout,inventory);
    expect(check).toMatchObject({status:'violated',shortages:[{required:56,available:55,missing:1}],unknownObjectIds:['synthetic-chair-56']});
    expect(check.message).toContain('1 件物料身份、位置或规格未能匹配');
  });
  it('重复库存或无效数量拒绝得出通过或缺口；无物料返回不适用',()=>{
    expect(checkCandidateInventory(candidate(1),{origin:'assumption',entries:[row,row]}).status).toBe('unknown');
    expect(checkCandidateInventory(candidate(1),{origin:'assumption',entries:[{...row,available:-1}]}).status).toBe('unknown');
    expect(checkCandidateInventory(candidate(0),inventory).status).toBe('not_applicable');
  });
  it('同规格总数计入所有楼层的已有及候选物件',()=>{
    const layout=makeLayout({floors:[makeFloor({items:[chair(0),chair(1)]}),makeFloor({id:'upper',items:[chair(2)]})]});
    expect(checkCandidateInventory(layout,{origin:'user_reported',entries:[{...row,available:2}]})).toMatchObject({status:'violated',shortages:[{required:3,available:2,missing:1}]});
  });
});
