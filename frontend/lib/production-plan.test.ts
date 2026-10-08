import { describe, expect, it } from 'vitest';
import { productionPlanSchema, resolveProductionPlanReferences, type ProductionPlan } from '../../supabase/functions/_shared/production-plan-contract';
import { createLayoutStore } from '../components/room-organizer/hooks/use-layout-store';
import { makeFloor, makeItem, makeLayout } from '../components/room-organizer/lib/__testfixtures__/fixtures';
import { mergeProposalPresentation } from '../components/room-organizer/lib/creative-brief';
import { createOperation, operationBasis, operationReview } from '../components/room-organizer/lib/event-operations';
import { assertNoLocalHandoffCloudTransition, hasLocalHandoff } from '../components/room-organizer/lib/handoff-cloud-guard';
import { handoffBasis, effectiveHandoffStatus } from '../components/room-organizer/lib/scene-handoff';
import { addDesign, switchDesign } from '../components/room-organizer/lib/scene-layers';
import { formatMoneyMinor, parseMoneyMinor, preserveCurrentActivity, productionObjectBasis, productionTaskBasis } from './production-plan';
import type { RoomLayout } from '../components/room-organizer/lib/types';

const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
function venue():RoomLayout {return makeLayout({id:id(1),roof:{style:'none'},floors:[makeFloor({height:3,items:[makeItem({id:id(2),materialId:'chair',position:{x:0,z:0}})]})]});}
function plan():ProductionPlan {return productionPlanSchema.parse({dataKind:'rehearsal',staffing:[{id:id(3),roleName:'演练签到岗位',taskIds:[id(5)],headcount:2}],acquisitions:[{id:id(4),title:'演练椅子取得',objectIds:[id(2)],method:'rental',sourceNote:'演练假设，待核实'}]});}
async function reviewed(base:RoomLayout,taskId=id(5),objectIds:string[]=[]){
  const task={...createOperation('演练任务','event'),id:taskId,ownerName:'演练岗位',acceptance:'核对演练条件',status:'accepted' as const,evidenceNote:'演练证据',evidenceUrls:['https://example.test/evidence'],actualStartedAt:'2026-10-08T08:00:00+08:00',actualFinishedAt:'2026-10-08T09:00:00+08:00',objectIds};
  return {...task,reviewedBasis:await operationBasis(base,task)};
}

describe('exact manual estimate inputs',()=>{
 it.each([['',null],['  ',null],['0',0],['0.00',0],['12.3',1230],['12.34',1234],['00001.01',101]])('parses %s without guessing unknown amounts',(text,expected)=>{expect(parseMoneyMinor(text as string)).toBe(expected);});
 it.each(['-1','+1','1.234','1e3','1,000','NaN','Infinity','.01','1.'])('rejects ambiguous or over-precise money %s',text=>{expect(()=>parseMoneyMinor(text)).toThrow();});
 it('roundtrips the largest safe minor amount exactly and rejects the next cent',()=>{
  expect(formatMoneyMinor(Number.MAX_SAFE_INTEGER)).toBe('90071992547409.91');
  expect(parseMoneyMinor(formatMoneyMinor(Number.MAX_SAFE_INTEGER))).toBe(Number.MAX_SAFE_INTEGER);
  expect(()=>parseMoneyMinor('90071992547409.92')).toThrow('安全');expect(formatMoneyMinor(null)).toBe('');expect(formatMoneyMinor(0)).toBe('0.00');
 });
});

describe('production changes and local activity facts',()=>{
 it('updates the sole layout action and preserves absence instead of creating an empty block',()=>{
  const store=createLayoutStore({layout:venue(),activeFloorIndex:0});expect(store.getState().layout).not.toHaveProperty('productionPlan');
  store.getState().actions.setProductionPlan(plan());expect(store.getState().layout.productionPlan).toEqual(plan());
  const current=store.getState().layout;expect(()=>store.getState().actions.setProductionPlan({...plan(),currency:'USD'} as never)).toThrow();expect(store.getState().layout).toBe(current);
  store.getState().actions.setProductionPlan(undefined);expect(store.getState().layout).not.toHaveProperty('productionPlan');
 });
 it('preserves the old task basis for absent, unrelated or financial-only planning',async()=>{
  const base=venue(),task=await reviewed(base,id(6));const original=await operationBasis(base,task);
  expect(await operationBasis({...base,productionPlan:plan()},task)).toBe(original);
  const financial=productionPlanSchema.parse({budget:{limitMinor:0,scopeNote:'演练范围',basisNote:'人工假设'},estimates:[{id:id(7),title:'人工估算',taskIds:[id(6)],amountMinor:0,basisNote:'假设零费'}]});
  expect(await operationBasis({...base,productionPlan:financial},task)).toBe(original);
 });
 it('invalidates only the affected task when staffing changes and preserves accepted facts',async()=>{
  const base={...venue(),productionPlan:plan()},task=await reviewed(base),unrelated=await reviewed(base,id(6));
  const changed={...base,productionPlan:{...plan(),staffing:[{...plan().staffing[0],headcount:3}]}};
  expect((await operationReview(changed,task)).status).toBe('needs_review');expect((await operationReview(changed,unrelated)).status).toBe('accepted');
  expect(task).toMatchObject({status:'accepted',actualStartedAt:'2026-10-08T08:00:00+08:00',actualFinishedAt:'2026-10-08T09:00:00+08:00',evidenceNote:'演练证据'});
 });
 it('invalidates related material checks after acquisition changes, while money edits leave them intact',async()=>{
  const base={...venue(),productionPlan:plan()};const handoff={ownerName:'演练岗位',dueDate:'',acceptance:'核对演练规格',status:'accepted' as const,evidenceNote:'演练说明',evidenceUrls:[],reviewedBasis:await handoffBasis(base,id(2),'核对演练规格')};
  base.floors[0].items[0].handoff=handoff;
  const changed={...base,productionPlan:{...plan(),acquisitions:[{...plan().acquisitions[0],transportScope:'人工演练运输范围'}]}};
  expect(await effectiveHandoffStatus(changed,id(2))).toBe('needs_review');expect(handoff.status).toBe('accepted');expect(handoff.evidenceNote).toBe('演练说明');
  expect(await effectiveHandoffStatus({...base,productionPlan:{...plan(),estimates:[{id:id(7),title:'演练估算',taskIds:[],objectIds:[id(2)],amountMinor:100,basisNote:'人工假设'}]}},id(2))).toBe('accepted');
 });
 it('keeps UUID aliases connected, legacy spelling distinct, and ignores row display ordering',()=>{
  const value=plan();value.staffing[0].taskIds=[id(5).toUpperCase()];expect(productionTaskBasis(value,id(5),[])).not.toBeNull();
  value.acquisitions[0].objectIds=['legacy-X'];expect(productionObjectBasis(value,'legacy-x')).toBeNull();expect(productionObjectBasis(value,'legacy-X')).not.toBeNull();
 });
 it('protects root and nested plans against a lossy cloud transition',()=>{
  const base=venue();expect(hasLocalHandoff(base)).toBe(false);
  expect(()=>assertNoLocalHandoffCloudTransition({...base,productionPlan:productionPlanSchema.parse({})})).toThrow('制作计划');
  const nested={...base,designBook:{activeId:'a',variants:[{id:'a',name:'演练方案',layout:{...base,productionPlan:plan()}}]}};
  expect(hasLocalHandoff(nested)).toBe(true);expect(()=>assertNoLocalHandoffCloudTransition(nested)).toThrow('当前草稿已保留');
 });
 it('keeps current tasks and production during design adoption/switch instead of importing or rewinding another activity',async()=>{
  const base=venue(),task=await reviewed(base);base.eventOperations={schemaVersion:1,dataKind:'rehearsal',tasks:[task]};base.productionPlan=plan();
  base.floors[0].items[0].handoff={ownerName:'演练岗位',dueDate:'',acceptance:'核对',status:'todo',evidenceNote:'原说明',evidenceUrls:[]};
  const foreign={...venue(),productionPlan:productionPlanSchema.parse({dataKind:'real',staffing:[{id:id(20),roleName:'另一活动岗位'}]}),eventOperations:{schemaVersion:1 as const,dataKind:'real' as const,tasks:[]}};
  const added=addDesign(base,foreign);expect(added.productionPlan).toEqual(base.productionPlan);expect(added.eventOperations).toEqual(base.eventOperations);
  const later={...added,eventOperations:{...base.eventOperations,tasks:[{...task,evidenceNote:'后来现场证据'}]},productionPlan:{...plan(),staffing:[{...plan().staffing[0],headcount:4}]}};
  later.floors[0].items[0].handoff={...base.floors[0].items[0].handoff!,evidenceNote:'后续物料证据'};
  const switched=switchDesign(later,'original');expect(switched.productionPlan).toEqual(later.productionPlan);expect(switched.eventOperations).toEqual(later.eventOperations);
  expect(switched.floors[0].items[0].handoff?.evidenceNote).toBe('后续物料证据');
  const noRecords=switchDesign({...later,productionPlan:undefined,eventOperations:undefined},'original');expect(noRecords.productionPlan).toBeUndefined();expect(noRecords.eventOperations).toBeUndefined();
 });
 it('preserves current activity records and matched material evidence when a wire proposal omits local data',()=>{
  const base=venue();base.productionPlan=plan();base.eventOperations={schemaVersion:1,dataKind:'rehearsal',tasks:[createOperation('演练任务','setup')]};
  base.floors[0].items[0].handoff={ownerName:'演练岗位',dueDate:'',acceptance:'核对',status:'todo',evidenceNote:'已有说明',evidenceUrls:[]};
  const candidate=venue();candidate.productionPlan=productionPlanSchema.parse({dataKind:'real'});
  candidate.floors[0].items[0].type='table';
  const merged=mergeProposalPresentation(base,candidate);expect(merged.productionPlan).toEqual(base.productionPlan);expect(merged.eventOperations).toEqual(base.eventOperations);expect(merged.floors[0].items[0].handoff).toEqual(base.floors[0].items[0].handoff);
 });
 it('duplicates physical objects without stealing or cloning the original planning assignments',()=>{
  const base=venue();base.productionPlan=plan();const task=createOperation('原演练任务','setup');task.objectIds=[id(2)];base.eventOperations={schemaVersion:1,dataKind:'rehearsal',tasks:[task]};
  base.floors[0].items[0].handoff={ownerName:'演练岗位',dueDate:'',acceptance:'原条件',status:'todo',evidenceNote:'原说明',evidenceUrls:[]};
  const store=createLayoutStore({layout:base,activeFloorIndex:0}),copyId=store.getState().actions.duplicateItem(id(2)),next=store.getState().layout;
  expect(next.productionPlan).toEqual(base.productionPlan);expect(next.eventOperations).toEqual(base.eventOperations);expect(next.floors[0].items.find(item=>item.id===copyId)?.handoff).toBeUndefined();expect(next.floors[0].items.find(item=>item.id===id(2))?.handoff?.evidenceNote).toBe('原说明');
 });
 it('keeps missing planning references after task and object deletion instead of relinking equal names',()=>{
  const base=venue();base.productionPlan=plan();const task={...createOperation('演练签到岗位','event'),id:id(5)};base.eventOperations={schemaVersion:1,dataKind:'rehearsal',tasks:[task]};
  const store=createLayoutStore({layout:base,activeFloorIndex:0});
  store.getState().actions.setEventOperations({...base.eventOperations,tasks:[{...task,id:id(8)}]});store.getState().actions.removeItem(id(2));
  const next=store.getState().layout;expect(next.productionPlan).toEqual(base.productionPlan);
  const refs=resolveProductionPlanReferences(next.productionPlan!,{taskIds:next.eventOperations!.tasks.map(value=>value.id),objectIds:next.floors.flatMap(floor=>floor.items.map(item=>item.id))});
  expect(refs.find(value=>value.kind==='staffing')!.missingTaskIds).toEqual([id(5)]);expect(refs.find(value=>value.kind==='acquisition')!.missingObjectIds).toEqual([id(2)]);
 });
 it('protects newer activity data when an older geometry-only draft is finally applied',()=>{
  const original=venue();original.productionPlan=plan();const task=createOperation('演练任务','event');original.eventOperations={schemaVersion:1,dataKind:'rehearsal',tasks:[task]};
  const oldDraft={...original,width:12};
  const current={...original,productionPlan:{...plan(),staffing:[{...plan().staffing[0],headcount:7}]},eventOperations:{...original.eventOperations,tasks:[{...task,evidenceNote:'后续演练说明',actualStartedAt:'2026-10-08T10:00:00+08:00'}]}};
  const adopted=preserveCurrentActivity(current,oldDraft);
  expect(adopted.width).toBe(12);expect(adopted.productionPlan).toEqual(current.productionPlan);expect(adopted.eventOperations).toEqual(current.eventOperations);expect(original.productionPlan.staffing[0].headcount).toBe(2);
 });
});
