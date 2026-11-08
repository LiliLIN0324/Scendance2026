import {describe,expect,it} from 'vitest';
import {makeFloor,makeItem,makeLayout} from './__testfixtures__/fixtures';
import {checkCandidateInventory,type CandidateInventory} from './candidate-inventory';
import {inventoryForSessionCandidate,rememberSessionCandidateInventory} from './session-candidate-inventory';

const row={name:'椅子',identity:{kind:'asset_id' as const,value:'synthetic-chair-model'},dimensions:{width:.5,depth:.5,height:.8},available:0};
const supplied:CandidateInventory={origin:'user_reported',entries:[row]};
function candidate(count:number,width=.5){return makeLayout({floors:[makeFloor({items:Array.from({length:count},(_,i)=>makeItem({id:`chair-${i}`,name:'椅子',type:'chair',assetId:'synthetic-chair-model',source:'generated',width,depth:.5,height:.8}))})]});}
describe('会话内明确物料数量',()=>{
 it('同身份同规格的新候选继承零库存并阻止超量',()=>{
  const memory=rememberSessionCandidateInventory(null,'actor/activity/session',candidate(1),supplied);
  const inherited=inventoryForSessionCandidate(memory,'actor/activity/session',candidate(2));
  expect(inherited?.entries[0]?.available).toBe(0);
  expect(checkCandidateInventory(candidate(2),inherited)).toMatchObject({status:'violated',shortages:[{required:2,available:0,missing:2}]});
 });
 it('规格不同或会话不同不猜测，旧规格仍可重新出现',()=>{
  const memory=rememberSessionCandidateInventory(null,'session-a',candidate(1),supplied);
  expect(inventoryForSessionCandidate(memory,'session-a',candidate(2,.6))).toBeUndefined();
  expect(inventoryForSessionCandidate(memory,'session-b',candidate(2))).toBeUndefined();
  expect(inventoryForSessionCandidate(memory,'session-a',candidate(2))?.entries[0]?.available).toBe(0);
 });
 it('清空当前行后为未知，原始对象不会被共享修改',()=>{
  const original=rememberSessionCandidateInventory(null,'session-a',candidate(1),supplied);
  const read=inventoryForSessionCandidate(original,'session-a',candidate(1))!;
  (read.entries[0] as typeof row).available=8;
  expect(inventoryForSessionCandidate(original,'session-a',candidate(1))?.entries[0]?.available).toBe(0);
  const cleared=rememberSessionCandidateInventory(original,'session-a',candidate(1),undefined);
  expect(inventoryForSessionCandidate(cleared,'session-a',candidate(1))).toBeUndefined();
  expect(inventoryForSessionCandidate(original,'session-a',candidate(1))?.entries[0]?.available).toBe(0);
 });
 it('不保存假设库存、无效数量或不在候选中的身份',()=>{
  expect(rememberSessionCandidateInventory(null,'s',candidate(1),{...supplied,origin:'assumption'})).toBeNull();
  expect(rememberSessionCandidateInventory(null,'s',candidate(1),{...supplied,entries:[{...row,available:-1}]})).toBeNull();
  expect(rememberSessionCandidateInventory(null,'s',candidate(1),{...supplied,entries:[{...row,identity:{kind:'asset_id',value:'other-model'}}]})).toBeNull();
 });
 it('候选暂时没有此物料时保留原数量，其他会话写入不会携带旧数量',()=>{
  const original=rememberSessionCandidateInventory(null,'a',candidate(1),supplied);
  const absent=rememberSessionCandidateInventory(original,'a',candidate(0),undefined);
  expect(inventoryForSessionCandidate(absent,'a',candidate(1))?.entries[0]?.available).toBe(0);
  const other=rememberSessionCandidateInventory(absent,'b',candidate(0),undefined);
  expect(inventoryForSessionCandidate(other,'b',candidate(1))).toBeUndefined();
 });
 it('来源不明的生成资产不能按同名或类型继承库存',()=>{
  const memory=rememberSessionCandidateInventory(null,'s',candidate(1),supplied);
  const generated=makeLayout({floors:[makeFloor({items:[makeItem({id:'generated',name:'椅子',type:'chair',source:'generated',width:.5,depth:.5,height:.8})]})]});
  expect(inventoryForSessionCandidate(memory,'s',generated)).toBeUndefined();
 });
 it('有资产编号时按资产编号而不是相同名称和类型匹配',()=>{
  const asset=(id:string)=>makeLayout({floors:[makeFloor({items:[makeItem({id:'object',name:'椅子',type:'chair',assetId:id,source:'generated',width:.5,depth:.5,height:.8})]})]});
  const assetRow={...row,identity:{kind:'asset_id' as const,value:'model-a'}};
  const memory=rememberSessionCandidateInventory(null,'s',asset('model-a'),{origin:'user_reported',entries:[assetRow]});
  expect(inventoryForSessionCandidate(memory,'s',asset('model-a'))?.entries[0]?.available).toBe(0);
  expect(inventoryForSessionCandidate(memory,'s',asset('model-b'))).toBeUndefined();
 });
 it('只有类型与尺寸的数量可检查本候选，但不能继承给后续候选',()=>{
  const typeOnly=makeLayout({floors:[makeFloor({items:[makeItem({id:'chair',name:'椅子',type:'chair',source:'builtin',width:.5,depth:.5,height:.8})]})]});
  const inventory:CandidateInventory={origin:'user_reported',entries:[{...row,identity:{kind:'type',value:'chair'}}]};
  expect(checkCandidateInventory(typeOnly,inventory).status).toBe('violated');
  const memory=rememberSessionCandidateInventory(null,'s',typeOnly,inventory);
  expect(inventoryForSessionCandidate(memory,'s',typeOnly)).toBeUndefined();
 });
 it('通用物料类别不是稳定型号，不能跨候选继承',()=>{
  const builtIn=makeLayout({floors:[makeFloor({items:[makeItem({id:'chair',name:'椅子',type:'chair',materialId:'chair',source:'builtin',width:.5,depth:.5,height:.8})]})]});
  const inventory:CandidateInventory={origin:'user_reported',entries:[{...row,identity:{kind:'material_id',value:'chair'}}]};
  expect(checkCandidateInventory(builtIn,inventory).status).toBe('violated');
  const memory=rememberSessionCandidateInventory(null,'s',builtIn,inventory);
  expect(inventoryForSessionCandidate(memory,'s',builtIn)).toBeUndefined();
 });
 it('用户清空一个规格不会清掉暂不在当前候选的另一规格',()=>{
  const wide={...row,dimensions:{...row.dimensions,width:.6},available:3};
  const first=rememberSessionCandidateInventory(null,'s',candidate(1),supplied);
  const both=rememberSessionCandidateInventory(first,'s',candidate(1,.6),{origin:'user_reported',entries:[wide]});
  const cleared=rememberSessionCandidateInventory(both,'s',candidate(1),undefined);
  expect(inventoryForSessionCandidate(cleared,'s',candidate(1))).toBeUndefined();
  expect(inventoryForSessionCandidate(cleared,'s',candidate(1,.6))?.entries[0]?.available).toBe(3);
 });
 it('一行输入无效时保留该行旧数量，另一行清空则立即忘记',()=>{
  const items=['model-a','model-b'].map((assetId,index)=>makeItem({id:`object-${index}`,name:'椅子',type:'chair',assetId,source:'generated',width:.5,depth:.5,height:.8}));
  const layout=makeLayout({floors:[makeFloor({items})]});
  const entries=['model-a','model-b'].map((value,index)=>({...row,identity:{kind:'asset_id' as const,value},available:index}));
  const before=rememberSessionCandidateInventory(null,'s',layout,{origin:'user_reported',entries});
  const invalidKey=JSON.stringify(['asset_id','model-b',.5,.5,.8]);
  const after=rememberSessionCandidateInventory(before,'s',layout,{origin:'user_reported',entries:[],invalidInputValues:{[invalidKey]:'?'}});
  expect(inventoryForSessionCandidate(after,'s',layout)?.entries).toEqual([entries[1]]);
  expect(inventoryForSessionCandidate(after,'s',layout)).toMatchObject({invalidInput:true,invalidInputValues:{[invalidKey]:'?'}});
  const corrected=rememberSessionCandidateInventory(after,'s',layout,{origin:'user_reported',entries:[entries[1]!]});
  expect(inventoryForSessionCandidate(corrected,'s',layout)?.invalidInput).toBeUndefined();
  expect(inventoryForSessionCandidate(before,'s',layout)?.entries).toEqual(entries);
 });
});
