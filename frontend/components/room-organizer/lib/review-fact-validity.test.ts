import {expect,it} from 'vitest';
import {eventOperationTaskSchema} from '../../../../supabase/functions/_shared/event-operations-contract';
import {handoffSchema} from '../../../../supabase/functions/_shared/delivery-contract';
import {makeFloor,makeItem,makeLayout} from './__testfixtures__/fixtures';
import {blankHandoff,effectiveHandoffStatus,handoffBasis} from './scene-handoff';
import {operationBasis,operationReview} from './event-operations';
import {deliveryExecution,deliveryOperations,sceneExecutionCsv,eventOperationsCsv} from './scene-delivery';
it('preserves recorded evidence but does not revive accepted status across venue changes and undo',async()=>{
 const id='30000000-0000-4000-8000-000000000001',layout=makeLayout({id:'activity',roof:{style:'none'},venueScan:{assetId:'a',name:'A'},floors:[makeFloor({items:[makeItem({id,type:'chair',materialId:'chair'})]})]});
 const handoff=handoffSchema.parse({...blankHandoff(),status:'accepted',ownerName:'统筹',dueDate:'2026-11-01',acceptance:'核对位置',evidenceNote:'已有现场记录',reviewedBasis:await handoffBasis(layout,id,{ownerName:'统筹',dueDate:'2026-11-01',acceptance:'核对位置'})});
 layout.floors[0]!.items[0]!.handoff=handoff;
 const task=eventOperationTaskSchema.parse({id:'40000000-0000-4000-8000-000000000001',title:'布场',phase:'setup',ownerName:'统筹',acceptance:'现场核验',status:'accepted',evidenceNote:'现场记录',reviewedBasis:'sha256:'+ '0'.repeat(64)});
 layout.eventOperations={schemaVersion:1,dataKind:'real',tasks:[task]};task.reviewedBasis=await operationBasis(layout,task);
 const changed={...layout,venueScan:{assetId:'b',name:'B'}};
 expect(await handoffBasis(changed,id,handoff)).not.toBe(handoff.reviewedBasis);
 expect(await operationBasis(changed,task)).not.toBe(task.reviewedBasis);
 for(const value of [layout,changed,structuredClone(layout)]){
  expect(await effectiveHandoffStatus(value,id)).toBe('needs_review');expect((await operationReview(value,task)).status).toBe('needs_review');
  expect((await deliveryExecution(value))[0]).toMatchObject({status:'accepted',effectiveStatus:'needs_review',evidenceNote:'已有现场记录'});
  expect((await deliveryOperations(value))!.tasks[0]).toMatchObject({status:'accepted',effectiveStatus:'needs_review',evidenceNote:'现场记录'});
  expect(await sceneExecutionCsv(value)).toContain('需复核');expect(await eventOperationsCsv(value)).toContain('需复核');
 }
});
