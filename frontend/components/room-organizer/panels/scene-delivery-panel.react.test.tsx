// @vitest-environment jsdom
import { webcrypto } from 'node:crypto';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BackendSession, getBackendConfig } from '@/lib/backend-session';
import { executionTimetableHtml } from '@/lib/execution-timetable-export';
import { serializeLocalProjectBackup, serializeLocalProjectBackupV3 } from '@/lib/local-project-backup';
import { productionPlanHandoffHtml } from '@/lib/production-plan-export';
import { eventOperationsSchema } from '../../../../supabase/functions/_shared/event-operations-contract';
import { materialCheckinLedgerSchema, type MaterialCheckinLedger } from '../../../../supabase/functions/_shared/material-checkin-contract';
import { productionPlanSchema, type ProductionPlan } from '../../../../supabase/functions/_shared/production-plan-contract';
import { makeFloor, makeItem, makeLayout } from '../lib/__testfixtures__/fixtures';
import { createOperation } from '../lib/event-operations';
import { downloadSceneDelivery, exportDeliveryGlb, sceneDeliveryCsv, sceneDeliveryJson, sceneExecutionCsv, eventOperationsCsv } from '../lib/scene-delivery';
import { blankHandoff, effectiveHandoffStatus, handoffBasis } from '../lib/scene-handoff';
import { SceneDeliveryPanel } from './scene-delivery-panel';
import type { MaterialCheckinState } from '../hooks/use-material-checkins';
import type { FurnitureItem } from '../lib/types';
vi.mock('../lib/scene-delivery',async importOriginal=>({ ...await importOriginal<typeof import('../lib/scene-delivery')>(), downloadSceneDelivery:vi.fn(),exportDeliveryGlb:vi.fn(),sceneDeliveryCsv:vi.fn(),sceneDeliveryJson:vi.fn(),sceneExecutionCsv:vi.fn(),eventOperationsCsv:vi.fn() }));
vi.mock('@/lib/production-plan-export',async importOriginal=>{
  const original=await importOriginal<typeof import('@/lib/production-plan-export')>();
  return {...original,productionPlanHandoffHtml:vi.fn(original.productionPlanHandoffHtml)};
});
vi.mock('@/lib/execution-timetable-export',async importOriginal=>{
  const original=await importOriginal<typeof import('@/lib/execution-timetable-export')>();
  return {...original,executionTimetableHtml:vi.fn(original.executionTimetableHtml)};
});
let controller:BackendSession;
const layout=makeLayout({roof:{style:'none'}});
const itemId='30000000-0000-4000-8000-000000000001';
function workLayout() { return makeLayout({roof:{style:'none'},floors:[makeFloor({items:[makeItem({id:itemId,name:'签到椅',materialId:'chair'})]})]}); }
const checkinProject='20000000-0000-4000-8000-000000000001';
const checkinState=(ledger?:MaterialCheckinLedger):MaterialCheckinState=>({projectId:checkinProject,ledger,ready:true,loading:false,saving:false,error:null,onSave:vi.fn().mockResolvedValue(undefined),retry:vi.fn()});
function completeActivity() {
  const current={...workLayout(),id:checkinProject,eventOperations:eventOperationsSchema.parse({dataKind:'rehearsal',tasks:[{id:itemId,title:'未关联制作计划的主持任务',phase:'event'}]})};
  const brief={event:'演练开放日',guests:30,description:'保存的活动目标',mustHave:'保留通道',allowIdeas:false};
  const briefSnapshot={state:'ready' as const,scope:checkinProject,brief:{status:'present' as const,value:brief}};
  const text=serializeLocalProjectBackupV3(current,briefSnapshot,{state:'ready',scope:checkinProject,materialCheckins:{status:'absent'}});
  const backupActions={prepareBackup:vi.fn(async()=>text),restoreBackup:vi.fn(),undoRestore:vi.fn(),backupPending:false,canUndoRestore:false};
  return {current,brief,briefSnapshot,text,backupActions};
}
function timetableActivity() {
  const f=completeActivity();
  const acquisitionId='b1700000-0000-4000-8000-000000000001';
  const current={...f.current,name:'独立演练活动',productionPlan:productionPlanSchema.parse({dataKind:'rehearsal',acquisitions:[{
    id:acquisitionId,title:'演练椅租赁',method:'rental',taskIds:[itemId],objectIds:[itemId],
  }]}),eventOperations:eventOperationsSchema.parse({dataKind:'rehearsal',tasks:[
    {id:itemId,title:'仅文字的主持沟通 <核对>',phase:'event',ownerName:'演练负责人',acceptance:'确认串场说明'},
    {id:'b1700000-0000-4000-8000-000000000002',title:'核对椅摆放',phase:'setup',ownerName:'演练负责人',objectIds:[itemId],
      plannedStartAt:'2027-02-03T10:00:00+08:00',plannedEndAt:'2027-02-03T11:00:00+08:00'},
  ]})};
  const ledger=materialCheckinLedgerSchema.parse({projectId:checkinProject,dataKind:'rehearsal',sheets:[{
    id:'b1700000-0000-4000-8000-000000000003',acquisitionId,unit:'piece',acquisitionSnapshot:{title:'演练椅租赁'},
    agreements:[{id:'b1700000-0000-4000-8000-000000000004',agreedQuantity:20,basisNote:'独立演练约定',recordedAt:'2027-02-03T08:00:00+08:00',recordedBy:'演练记录人'}],
    events:[{id:'b1700000-0000-4000-8000-000000000005',kind:'receive',quantity:18,checkState:'checked',batchRef:'演练实收批次',fromPartyName:'演练交出方',toPartyName:'演练接收方',evidenceNote:'独立假设收取核对',occurredAt:'2027-02-03T09:00:00+08:00',recordedAt:'2027-02-03T09:05:00+08:00',recordedBy:'演练记录人'},
      {id:'b1700000-0000-4000-8000-000000000006',kind:'return',quantity:18,checkState:'checked',batchRef:'演练归还批次',fromPartyName:'演练接收方',toPartyName:'演练交出方',evidenceNote:'独立假设归还核对',occurredAt:'2027-02-03T17:00:00+08:00',recordedAt:'2027-02-03T17:05:00+08:00',recordedBy:'演练记录人'}],
  }]});
  const text=serializeLocalProjectBackupV3(current,f.briefSnapshot,{state:'ready',scope:checkinProject,materialCheckins:{status:'present',value:ledger}});
  f.backupActions.prepareBackup.mockResolvedValue(text);
  return {...f,current,ledger,text};
}
function deferred<T>() {
  let resolve!:(value:T)=>void;
  const promise=new Promise<T>(done=>{resolve=done;});
  return {promise,resolve};
}
beforeEach(()=>{vi.stubGlobal('crypto',webcrypto);window.history.replaceState({},'', '/');controller=new BackendSession(getBackendConfig({url:'',anonKey:''}));vi.mocked(exportDeliveryGlb).mockResolvedValue({buffer:new ArrayBuffer(8),objectCount:2});vi.mocked(sceneDeliveryCsv).mockReturnValue('csv');vi.mocked(sceneExecutionCsv).mockResolvedValue('execution');vi.mocked(eventOperationsCsv).mockResolvedValue('operations');vi.mocked(sceneDeliveryJson).mockResolvedValue('{}');});
afterEach(()=>{cleanup();controller.dispose();vi.clearAllMocks();vi.unstubAllGlobals();});
describe('Binggo scene delivery panel',()=>{
  it('exports full saved activity records without requiring a production plan or generating models',async()=>{
    const f=completeActivity();
    render(<SceneDeliveryPanel layout={f.current} controller={controller} backupActions={f.backupActions}/>);
    expect(f.backupActions.prepareBackup).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button',{name:'导出完整活动交接 HTML'}));
    await waitFor(()=>expect(downloadSceneDelivery).toHaveBeenCalledOnce());
    expect(f.backupActions.prepareBackup).toHaveBeenCalledOnce();
    expect(productionPlanHandoffHtml).toHaveBeenCalledWith(expect.objectContaining({id:checkinProject}),expect.anything(),undefined,{scope:'activity',brief:f.briefSnapshot.brief});
    const [html,mime,name,extension]=vi.mocked(downloadSceneDelivery).mock.calls[0];
    expect(html).toContain('未关联制作计划的主持任务');expect(html).toContain('保存的活动目标');
    expect(mime).toBe('text/html;charset=utf-8');expect(name).toContain('内部活动交接');expect(extension).toBe('html');
    expect(exportDeliveryGlb).not.toHaveBeenCalled();
  });
  it.each(['error','wrong-project','incomplete'] as const)('does not substitute partial activity data when preparation returns %s',async kind=>{
    const f=completeActivity();
    if(kind==='error')f.backupActions.prepareBackup.mockRejectedValue(new Error('活动资料读取失败'));
    else if(kind==='wrong-project')f.backupActions.prepareBackup.mockResolvedValue(f.text.replaceAll(checkinProject,'20000000-0000-4000-8000-000000000002'));
    else f.backupActions.prepareBackup.mockResolvedValue(serializeLocalProjectBackup(f.current,f.briefSnapshot));
    render(<SceneDeliveryPanel layout={f.current} controller={controller} backupActions={f.backupActions}/>);
    fireEvent.click(screen.getByRole('button',{name:'导出完整活动交接 HTML'}));
    await screen.findByText(kind==='error'?'活动资料读取失败':'活动资料未完整对应当前项目，请重新读取后导出。');
    expect(downloadSceneDelivery).not.toHaveBeenCalled();
  });
  it.each(['layout','brief'] as const)('discards prepared activity output when %s changes during preparation',async field=>{
    const f=completeActivity();let finish!:(value:string)=>void;
    f.backupActions.prepareBackup.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
    const briefState={brief:f.brief,ready:true,error:null,hasSavedBrief:true};
    const view=render(<SceneDeliveryPanel layout={f.current} controller={controller} backupActions={f.backupActions} briefState={briefState}/>);
    fireEvent.click(screen.getByRole('button',{name:'导出完整活动交接 HTML'}));
    await waitFor(()=>expect(f.backupActions.prepareBackup).toHaveBeenCalledOnce());
    view.rerender(<SceneDeliveryPanel layout={field==='layout'?{...f.current,name:'后续编辑'}:f.current} controller={controller} backupActions={f.backupActions} briefState={field==='brief'?{...briefState,brief:{...f.brief,description:'后续需求'}}:briefState}/>);
    await act(async()=>finish(f.text));expect(downloadSceneDelivery).not.toHaveBeenCalled();
  });
  it('keeps local checkins and production editing available when the scene service lease is blocked',async()=>{
    const projectId='91000000-0000-4000-8000-000000000001';
    const current={...workLayout(),id:checkinProject,productionPlan:productionPlanSchema.parse({})};
    const state={...controller.getSnapshot(),configured:true,user:{id:'user-a'},writeBlocked:true,
      project:{id:projectId,studio_id:'studio',name:'远端场景',revision:1,scene:{schemaVersion:1 as const,venue:{width:8,depth:6,height:3,shape:'rectangle' as const,entrances:[]},objects:[],camera:'overview' as const,lighting:'neutral' as const}},
      geometryBinding:{version:1 as const,localActivityId:checkinProject,cloudProjectId:projectId,userId:'user-a',apiUrl:controller.config.apiUrl}};
    vi.spyOn(controller,'getSnapshot').mockReturnValue(state);vi.spyOn(controller,'isGeometryBound').mockImplementation(id=>id===checkinProject);
    render(<SceneDeliveryPanel layout={current} controller={controller} checkins={checkinState(materialCheckinLedgerSchema.parse({projectId:checkinProject}))} onUpdateItem={vi.fn()} onUpdateProductionPlan={vi.fn()}/>);
    fireEvent.click(screen.getByRole('tab',{name:'数量点验'}));
    expect(screen.getByRole('button',{name:'新建点验单'}).hasAttribute('disabled')).toBe(false);
    fireEvent.click(screen.getByRole('tab',{name:'制作计划'}));
    expect(screen.getByRole('button',{name:'编辑制作计划'}).hasAttribute('disabled')).toBe(false);
  });
  it.each(['edit','project','unmount','checkins','checkin-loading'] as const)('does not download an outdated production handoff after %s during task review',async change=>{
    let finish!:(html:string)=>void;
    const pending=new Promise<string>(resolve=>{finish=resolve;});
    vi.mocked(productionPlanHandoffHtml).mockReturnValueOnce(pending);
    const current={...workLayout(),id:'20000000-0000-4000-8000-000000000001',productionPlan:productionPlanSchema.parse({})};
    const context=checkinState();
    const view=render(<SceneDeliveryPanel layout={current} controller={controller} checkins={context}/>);
    fireEvent.click(screen.getByRole('tab',{name:'制作计划'}));
    fireEvent.click(screen.getByRole('button',{name:'导出制作交接单 HTML'}));
    await waitFor(()=>expect(productionPlanHandoffHtml).toHaveBeenCalledOnce());
    if(change==='unmount')view.unmount();
    else if(change==='checkins'||change==='checkin-loading')view.rerender(<SceneDeliveryPanel layout={current} controller={controller} checkins={change==='checkins'?checkinState(materialCheckinLedgerSchema.parse({projectId:checkinProject})):{...context,ready:false,loading:true}}/>);
    else view.rerender(<SceneDeliveryPanel layout={change==='project'?{...current,id:'20000000-0000-4000-8000-000000000002'}:{...current,name:'已经调整的场景'}} controller={controller}/>);
    await act(async()=>{finish('<!doctype html><title>旧快照</title>');await pending;});
    expect(downloadSceneDelivery).not.toHaveBeenCalled();
  });
  it('exports a standalone saved ledger after the production plan is removed and blocks export while its form is edited',async()=>{
    const current={...workLayout(),id:checkinProject};
    const ledger=materialCheckinLedgerSchema.parse({projectId:checkinProject,dataKind:'rehearsal',sheets:[{
      id:'aa700000-0000-4000-8000-000000000001',acquisitionId:'aa700000-0000-4000-8000-000000000002',unit:'piece',
      acquisitionSnapshot:{title:'保留的演练点验单'},agreements:[{id:'aa700000-0000-4000-8000-000000000003',agreedQuantity:20,basisNote:'演练依据',recordedAt:'2026-10-09T00:00:00Z',recordedBy:'演练统筹'}],events:[]}]});
    render(<SceneDeliveryPanel layout={current} controller={controller} checkins={checkinState(ledger)}/>);
    fireEvent.click(screen.getByRole('tab',{name:'数量点验'}));
    fireEvent.click(screen.getByRole('button',{name:'记录实收'}));
    expect((screen.getByRole('button',{name:'导出点验交接单 HTML'}) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button',{name:'取消记录'}));
    fireEvent.click(screen.getByRole('button',{name:'导出点验交接单 HTML'}));
    await waitFor(()=>expect(downloadSceneDelivery).toHaveBeenCalledOnce());
    const html=vi.mocked(downloadSceneDelivery).mock.calls[0][0];
    expect(html).toContain('数量点验');expect(html).toContain('保留的演练点验单');expect(html).toContain('当前未记录');
    expect(productionPlanHandoffHtml).toHaveBeenCalledWith(current,expect.objectContaining({id:expect.any(String)}),ledger);
  });
  it('does not export task status when the local checkin context is unavailable',()=>{
    const current={...workLayout(),id:checkinProject,eventOperations:eventOperationsSchema.parse({tasks:[createOperation('演练任务','setup')]})};
    render(<SceneDeliveryPanel layout={current} controller={controller} checkins={{...checkinState(),ready:false,error:'点验读取失败'}}/>);
    expect((screen.getByRole('button',{name:'导出活动安排 CSV'}) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button',{name:'导出场景 JSON'}) as HTMLButtonElement).disabled).toBe(true);
    expect(downloadSceneDelivery).not.toHaveBeenCalled();
  });
  it('blocks production export while editing and exports applied records after cancellation independently of model delivery',async()=>{
    const productionPlan=productionPlanSchema.parse({staffing:[{id:'40000000-0000-4000-8000-000000000001',roleName:'演练布场',headcount:2}]});
    render(<SceneDeliveryPanel layout={{...workLayout(),scenePreset:'gym',productionPlan}} controller={controller} onUpdateProductionPlan={vi.fn()}/>);
    fireEvent.click(screen.getByRole('tab',{name:'制作计划'}));
    fireEvent.click(screen.getByRole('button',{name:'编辑制作计划'}));
    fireEvent.change(screen.getByLabelText('岗位名称'),{target:{value:'未保存的新岗位'}});
    expect((screen.getByRole('button',{name:'导出制作交接单 HTML'}) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button',{name:'取消编辑'}));
    fireEvent.click(screen.getByRole('button',{name:'导出制作交接单 HTML'}));
    await waitFor(()=>expect(downloadSceneDelivery).toHaveBeenCalledOnce());
    const [html,mime,name,extension]=vi.mocked(downloadSceneDelivery).mock.calls[0];
    expect(html).toContain('演练布场');expect(html).not.toContain('未保存的新岗位');
    expect(mime).toBe('text/html;charset=utf-8');expect(name).toContain('内部制作交接');expect(extension).toBe('html');
    expect(exportDeliveryGlb).not.toHaveBeenCalled();
  });
  it('does not offer a production handoff before a plan is saved',()=>{
    render(<SceneDeliveryPanel layout={workLayout()} controller={controller} onUpdateProductionPlan={vi.fn()}/>);
    fireEvent.click(screen.getByRole('tab',{name:'制作计划'}));
    expect((screen.getByRole('button',{name:'导出制作交接单 HTML'}) as HTMLButtonElement).disabled).toBe(true);
  });
  it('edits production records in the third page through the parent update callback without the model export gate',async()=>{
    const current={...workLayout(),scenePreset:'gym' as const},update=vi.fn();
    function Harness():JSX.Element{const [saved,setSaved]=useState(current);return <SceneDeliveryPanel layout={saved} controller={controller} onUpdateProductionPlan={(value:ProductionPlan|undefined)=>{update(value);const {productionPlan:_previous,...base}=saved;setSaved({...base,...(value?{productionPlan:value}:{})});}}/>;}
    render(<Harness/>);expect(update).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('tab',{name:'制作计划'}));expect(screen.getByRole('tab',{name:'制作计划'}).getAttribute('aria-selected')).toBe('true');
    fireEvent.click(screen.getByRole('button',{name:'创建制作计划'}));expect(update).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button',{name:'添加岗位'}));fireEvent.change(screen.getByLabelText('岗位名称'),{target:{value:'演练布场'}});
    fireEvent.click(screen.getByRole('button',{name:'保存制作计划'}));
    await waitFor(()=>expect(update).toHaveBeenCalledOnce());expect(update.mock.calls[0][0].staffing[0]).toMatchObject({roleName:'演练布场',headcount:null});
    expect(screen.getByRole('form',{name:'制作计划记录'})).toBeDefined();
    expect((screen.getByRole('button',{name:'导出场景 GLB'}) as HTMLButtonElement).disabled).toBe(true);expect(exportDeliveryGlb).not.toHaveBeenCalled();
  });
  it('keeps the production page read-only for a cloud-bound project or a missing parent callback',()=>{
    const current={...workLayout(),id:'20000000-0000-4000-8000-000000000001'},update=vi.fn();window.history.replaceState({},'',`/?project=${current.id}`);
    const view=render(<SceneDeliveryPanel layout={current} controller={controller} onUpdateProductionPlan={update}/>);fireEvent.click(screen.getByRole('tab',{name:'制作计划'}));
    expect((screen.getByRole('button',{name:'创建制作计划'}) as HTMLButtonElement).disabled).toBe(true);expect(update).not.toHaveBeenCalled();
    window.history.replaceState({},'', '/');view.rerender(<SceneDeliveryPanel layout={current} controller={controller}/>);
    expect((screen.getByRole('button',{name:'创建制作计划'}) as HTMLButtonElement).disabled).toBe(true);
  });
  it('keeps backup in the existing delivery area and permits a full template backup without the model export gate', async () => {
    const prepareBackup=vi.fn().mockResolvedValue('{"format":"scendance-local-project-backup"}');
    const backupActions={prepareBackup,restoreBackup:vi.fn(),undoRestore:vi.fn(),backupPending:false,canUndoRestore:false};
    const view=render(<SceneDeliveryPanel layout={{...layout,scenePreset:'gym'}} controller={controller} backupActions={backupActions}/>);
    const summary=screen.getByText('场景与活动备份');
    expect(summary.closest('details')!.open).toBe(false);
    fireEvent.click(summary);
    expect((screen.getByRole('button',{name:'导出场景 GLB'}) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button',{name:'下载场景与活动备份'}) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole('button',{name:'下载场景与活动备份'}));
    await waitFor(()=>expect(downloadSceneDelivery).toHaveBeenCalledOnce());
    expect(prepareBackup).toHaveBeenCalledOnce();
    expect(exportDeliveryGlb).not.toHaveBeenCalled();
    view.rerender(<SceneDeliveryPanel layout={layout} controller={controller}/>);
    expect(screen.queryByText('场景与活动备份')).toBeNull();
    expect((screen.getByRole('button',{name:'导出场景 JSON'}) as HTMLButtonElement).disabled).toBe(false);
  });
  it('preserves task and material drafts across explicit delivery navigation without reselecting a repeated request',async()=>{
    const f=completeActivity(),updateOperations=vi.fn(),updateItem=vi.fn();
    const props={layout:f.current,controller,backupActions:f.backupActions,onUpdateEventOperations:updateOperations,onUpdateItem:updateItem};
    const initialMaterialsRequest={serial:1,view:'materials' as const},operationsRequest={serial:2,view:'operations' as const},materialsRequest={serial:3,view:'materials' as const};
    const view=render(<SceneDeliveryPanel {...props} deliveryViewRequest={initialMaterialsRequest}/>);
    expect(screen.getByRole('tab',{name:'物料工作单'}).getAttribute('aria-selected')).toBe('true');
    view.rerender(<SceneDeliveryPanel {...props} deliveryViewRequest={operationsRequest}/>);
    const taskSummary=screen.getByText('未关联制作计划的主持任务');fireEvent.click(taskSummary);taskSummary.closest('details')!.open=true;
    const taskTitle=within(screen.getByRole('tabpanel',{name:'活动安排'})).getByLabelText('任务标题') as HTMLInputElement;
    fireEvent.change(taskTitle,{target:{value:'未保存的演练主持说明'}});
    view.rerender(<SceneDeliveryPanel {...props} deliveryViewRequest={materialsRequest}/>);
    expect(screen.getByRole('tab',{name:'物料工作单'}).getAttribute('aria-selected')).toBe('true');
    const itemSummary=within(screen.getByRole('tabpanel',{name:'物料工作单'})).getByText('签到椅 · 1');fireEvent.click(itemSummary);itemSummary.closest('details')!.open=true;
    const acceptance=within(screen.getByRole('tabpanel',{name:'物料工作单'})).getByLabelText('验收条件') as HTMLTextAreaElement;
    fireEvent.change(acceptance,{target:{value:'未保存的演练摆放要求'}});
    fireEvent.click(screen.getByRole('tab',{name:'活动安排'}));
    view.rerender(<SceneDeliveryPanel {...props} deliveryViewRequest={materialsRequest}/>);
    expect(screen.getByRole('tab',{name:'活动安排'}).getAttribute('aria-selected')).toBe('true');
    expect(within(screen.getByRole('tabpanel',{name:'活动安排'})).getByLabelText('任务标题')).toBe(taskTitle);expect(taskTitle.value).toBe('未保存的演练主持说明');
    view.rerender(<SceneDeliveryPanel {...props} deliveryViewRequest={{serial:4,view:'operations'}}/>);
    expect(within(screen.getByRole('tabpanel',{name:'活动安排'})).getByLabelText('任务标题')).toBe(taskTitle);expect(taskTitle.value).toBe('未保存的演练主持说明');
    view.rerender(<SceneDeliveryPanel {...props} deliveryViewRequest={{serial:5,view:'materials'}}/>);
    expect(within(screen.getByRole('tabpanel',{name:'物料工作单'})).getByLabelText('验收条件')).toBe(acceptance);expect(acceptance.value).toBe('未保存的演练摆放要求');
    expect(updateOperations).not.toHaveBeenCalled();expect(updateItem).not.toHaveBeenCalled();expect(f.backupActions.prepareBackup).not.toHaveBeenCalled();expect(downloadSceneDelivery).not.toHaveBeenCalled();
  });
  it('only prepares and downloads after an explicit click',async()=>{
    render(<SceneDeliveryPanel layout={layout} controller={controller}/>);
    expect(exportDeliveryGlb).not.toHaveBeenCalled();expect(downloadSceneDelivery).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button',{name:'导出场景 GLB'}));
    await waitFor(()=>expect(downloadSceneDelivery).toHaveBeenCalledOnce());
    expect(exportDeliveryGlb).toHaveBeenCalledWith(layout,controller);
    expect(screen.getByRole('status').textContent).toContain('复检');
  });
  it('keeps JSON and CSV as separate explicit downloads',async()=>{
    render(<SceneDeliveryPanel layout={layout} controller={controller}/>);
    fireEvent.click(screen.getByRole('button',{name:'导出场景 JSON'}));
    await waitFor(()=>expect(sceneDeliveryJson).toHaveBeenCalledWith(layout,expect.objectContaining({id:expect.any(String),generatedAt:expect.any(String)}),undefined));
    fireEvent.click(screen.getByRole('button',{name:'导出物料清单 CSV'}));
    await waitFor(()=>expect(sceneDeliveryCsv).toHaveBeenCalledWith(layout,vi.mocked(sceneDeliveryJson).mock.calls[0][1]));
    expect(exportDeliveryGlb).not.toHaveBeenCalled();
  });
  it('does not download a stale snapshot after scene editing during verification',async()=>{
    let done!:(value:{buffer:ArrayBuffer;objectCount:number})=>void;
    vi.mocked(exportDeliveryGlb).mockImplementationOnce(()=>new Promise(resolve=>{done=resolve;}));
    const view=render(<SceneDeliveryPanel layout={layout} controller={controller}/>);
    fireEvent.click(screen.getByRole('button',{name:'导出场景 GLB'}));
    await waitFor(()=>expect(exportDeliveryGlb).toHaveBeenCalledOnce());
    view.rerender(<SceneDeliveryPanel layout={{...layout,name:'Changed'}} controller={controller}/>);
    await act(async()=>{done({buffer:new ArrayBuffer(8),objectCount:2});});
    expect(downloadSceneDelivery).not.toHaveBeenCalled();
    expect(screen.getByRole('status').textContent).toContain('场景或账号已变化');
  });
  it('does not offer a file after geometry verification fails',async()=>{
    vi.mocked(exportDeliveryGlb).mockRejectedValueOnce(new Error('GLB 复检失败：物件数量不一致。'));
    render(<SceneDeliveryPanel layout={layout} controller={controller}/>);
    fireEvent.click(screen.getByRole('button',{name:'导出场景 GLB'}));
    await waitFor(()=>expect(screen.getByRole('status').textContent).toContain('复检失败'));
    expect(downloadSceneDelivery).not.toHaveBeenCalled();
  });
  it('validates, saves and locates an execution record with explicit acceptance evidence',async()=>{
    const current=workLayout(), update=vi.fn(), locate=vi.fn();
    render(<SceneDeliveryPanel layout={current} controller={controller} onUpdateItem={update} onLocate={locate}/>);
    fireEvent.click(screen.getByText('签到椅 · 1'));
    fireEvent.click(screen.getByRole('button',{name:'定位物件'})); expect(locate).toHaveBeenCalledWith(itemId);
    fireEvent.change(screen.getByLabelText('状态'),{target:{value:'accepted'}});
    fireEvent.click(screen.getByRole('button',{name:'确认验收'}));
    await waitFor(()=>expect(screen.getByRole('alert').textContent).toContain('负责人')); expect(update).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('负责人'),{target:{value:'执行甲'}});
    fireEvent.change(screen.getByLabelText('期限'),{target:{value:'2026-10-09'}});
    fireEvent.change(screen.getByLabelText('验收条件'),{target:{value:'按图摆放并检查尺寸'}});
    fireEvent.change(screen.getByLabelText('验收说明'),{target:{value:'已实测并现场核对'}});
    fireEvent.click(screen.getByRole('button',{name:'确认验收'}));
    await waitFor(()=>expect(update).toHaveBeenCalledWith(itemId,{handoff:expect.objectContaining({ownerName:'执行甲',status:'accepted',evidenceNote:'已实测并现场核对',reviewedBasis:expect.any(String)})}));
  });
  it.each([
    {label:'验收条件',value:'还需安装固定件'},
    {label:'负责人',value:'执行乙'},
    {label:'期限',value:'2026-10-12'},
  ])('keeps the previous basis when saving changed $label until an explicit reconfirmation',async({label,value})=>{
    const current=workLayout(), update=vi.fn(); const acceptance='按原图摆放';
    current.floors[0].items[0].handoff={...blankHandoff(),ownerName:'执行甲',dueDate:'2026-10-09',acceptance,status:'accepted',evidenceNote:'已核对',reviewedBasis:await handoffBasis(current,itemId,{ownerName:'执行甲',dueDate:'2026-10-09',acceptance})};
    const previousBasis=current.floors[0].items[0].handoff!.reviewedBasis;
    const view=render(<SceneDeliveryPanel layout={current} controller={controller} onUpdateItem={update}/>);
    fireEvent.click(screen.getByText('签到椅 · 1'));
    await waitFor(()=>expect(screen.queryByText('正在核对…')).toBeNull());
    fireEvent.change(screen.getByLabelText(label),{target:{value}});
    fireEvent.click(screen.getByRole('button',{name:'保存工作单'}));
    const patch=update.mock.calls[0][1] as Partial<FurnitureItem>;
    expect(patch.handoff!.reviewedBasis).toBe(previousBasis);
    const changed={...current,floors:[{...current.floors[0],items:[{...current.floors[0].items[0],...patch}]}]};
    expect(await effectiveHandoffStatus(changed,itemId)).toBe('needs_review');
    view.rerender(<SceneDeliveryPanel layout={changed} controller={controller} onUpdateItem={update}/>);
    await waitFor(()=>expect(screen.getByText('需复核')).toBeDefined());
    fireEvent.click(screen.getByRole('button',{name:'重新确认验收'}));
    const nextBasis=await handoffBasis(changed,itemId,patch.handoff!); await waitFor(()=>expect(update.mock.calls[1][1].handoff.reviewedBasis).toBe(nextBasis));
    const confirmed={...changed,floors:[{...changed.floors[0],items:[{...changed.floors[0].items[0],...update.mock.calls[1][1]}]}]};
    view.rerender(<SceneDeliveryPanel layout={confirmed} controller={controller} onUpdateItem={update}/>);
    await waitFor(()=>expect(screen.getByText('已验收')).toBeDefined());
    expect(screen.queryByRole('button',{name:'重新确认验收'})).toBeNull();
  });
  it('rejects clearing the last evidence from an accepted record',async()=>{
    const current=workLayout(), update=vi.fn(); const acceptance='核对尺寸';
    current.floors[0].items[0].handoff={...blankHandoff(),ownerName:'执行甲',dueDate:'2026-10-09',acceptance,status:'accepted',evidenceNote:'已核对',reviewedBasis:await handoffBasis(current,itemId,{ownerName:'执行甲',dueDate:'2026-10-09',acceptance})};
    render(<SceneDeliveryPanel layout={current} controller={controller} onUpdateItem={update}/>);
    fireEvent.click(screen.getByText('签到椅 · 1')); await waitFor(()=>expect(screen.queryByText('正在核对…')).toBeNull()); fireEvent.change(screen.getByLabelText('验收说明'),{target:{value:''}});
    fireEvent.click(screen.getByRole('button',{name:'保存工作单'}));
    expect(update).not.toHaveBeenCalled(); expect(screen.getByRole('alert').textContent).toContain('证据');
  });
  it('uses the same snapshot across export files and replaces it after editing execution fields',async()=>{
    const current=workLayout(); const view=render(<SceneDeliveryPanel layout={current} controller={controller}/>);
    fireEvent.click(screen.getByRole('button',{name:'导出场景 JSON'})); await waitFor(()=>expect(sceneDeliveryJson).toHaveBeenCalledOnce());
    const snapshot=vi.mocked(sceneDeliveryJson).mock.calls[0][1];
    fireEvent.click(screen.getByRole('button',{name:'导出执行清单 CSV'})); await waitFor(()=>expect(sceneExecutionCsv).toHaveBeenCalledWith(current,snapshot));
    const changed={...current,floors:[{...current.floors[0],items:[{...current.floors[0].items[0],handoff:{...blankHandoff(),ownerName:'执行乙'}}]}]};
    view.rerender(<SceneDeliveryPanel layout={changed} controller={controller}/>);
    fireEvent.click(screen.getByRole('button',{name:'导出场景 JSON'})); await waitFor(()=>expect(sceneDeliveryJson).toHaveBeenCalledTimes(2));
    expect(vi.mocked(sceneDeliveryJson).mock.calls[1][1]!.id).not.toBe(snapshot!.id);
  });
  it('disables execution editing for cloud projects and all exports for complete templates',()=>{
    const current={...workLayout(),id:'20000000-0000-4000-8000-000000000001'};
    window.history.replaceState({},'',`/?project=${current.id}`);
    const update=vi.fn();const view=render(<SceneDeliveryPanel layout={current} controller={controller} onUpdateItem={update}/>);
    fireEvent.click(screen.getByText('签到椅 · 1'));
    expect((screen.getByLabelText('负责人') as HTMLInputElement).closest('fieldset')!.disabled).toBe(true);
    fireEvent.submit(screen.getByLabelText('负责人').closest('form')!); expect(update).not.toHaveBeenCalled();
    view.rerender(<SceneDeliveryPanel layout={{...current,scenePreset:'gym'}} controller={controller} onUpdateItem={update}/>);
    expect(screen.getByRole('alert').textContent).toContain('完整场景预设');
    for(const name of ['导出场景 JSON','导出执行清单 CSV','导出物料清单 CSV','导出场景 GLB']) expect((screen.getByRole('button',{name}) as HTMLButtonElement).disabled).toBe(true);
  });
  it('reuses the same direct panel for activity tasks without requiring material and preserves the model export gate', async () => {
    const current={...layout,scenePreset:'gym' as const,eventOperations:eventOperationsSchema.parse({dataKind:'rehearsal',tasks:[createOperation('演练主持','event')]})};
    const update=vi.fn(), openBrief=vi.fn();
    render(<SceneDeliveryPanel layout={current} controller={controller} onUpdateEventOperations={update} onOpenBrief={openBrief}/>);
    expect(screen.getByRole('tab',{name:'活动安排'}).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('region',{name:'活动安排'})).toBeDefined();
    expect((screen.getByRole('button',{name:'导出场景 JSON'}) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button',{name:'打开活动需求表单'}));expect(openBrief).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button',{name:'导出活动安排 CSV'}));
    await waitFor(()=>expect(eventOperationsCsv).toHaveBeenCalledWith(current,expect.objectContaining({id:expect.any(String)}),undefined));
    expect(downloadSceneDelivery).toHaveBeenCalledOnce(); expect(exportDeliveryGlb).not.toHaveBeenCalled();
  });
  it('uses the same snapshot for activity and scene downloads, and discards in-flight activity output after editing', async () => {
    const current={...layout,eventOperations:eventOperationsSchema.parse({tasks:[createOperation('演练任务','preparation')]})};
    const view=render(<SceneDeliveryPanel layout={current} controller={controller}/>);
    fireEvent.click(screen.getByRole('button',{name:'导出场景 JSON'}));await waitFor(()=>expect(sceneDeliveryJson).toHaveBeenCalledOnce());
    const snapshot=vi.mocked(sceneDeliveryJson).mock.calls[0][1];
    fireEvent.click(screen.getByRole('button',{name:'导出活动安排 CSV'}));await waitFor(()=>expect(eventOperationsCsv).toHaveBeenCalledWith(current,snapshot,undefined));
    let done!:(value:string)=>void;vi.mocked(eventOperationsCsv).mockImplementationOnce(()=>new Promise(resolve=>{done=resolve;}));
    const before=vi.mocked(downloadSceneDelivery).mock.calls.length;
    fireEvent.click(screen.getByRole('button',{name:'导出活动安排 CSV'}));await waitFor(()=>expect(eventOperationsCsv).toHaveBeenCalledTimes(2));
    view.rerender(<SceneDeliveryPanel layout={{...current,eventOperations:{...current.eventOperations,tasks:[{...current.eventOperations.tasks[0],title:'新演练任务'}]}}} controller={controller}/>);
    await act(async()=>{done('old operations');});expect(downloadSceneDelivery).toHaveBeenCalledTimes(before);
  });
});

describe('saved execution timetable delivery',()=>{
  const exportButton=()=>screen.getByRole('button',{name:'导出执行时间表 HTML'}) as HTMLButtonElement;
  it('exports the actual saved V3 tasks, unknown dates, owner links and 20/18/18 ledger without model delivery',async()=>{
    const f=timetableActivity();
    const live={...f.current,name:'尚未保存的画面名称',eventOperations:eventOperationsSchema.parse({tasks:[{id:itemId,title:'画面中的其他任务',phase:'event'}]}),scenePreset:'gym' as const};
    render(<SceneDeliveryPanel layout={live} controller={controller} backupActions={f.backupActions} checkins={checkinState(f.ledger)}/>);
    expect(f.backupActions.prepareBackup).not.toHaveBeenCalled();expect(executionTimetableHtml).not.toHaveBeenCalled();
    expect(exportButton().disabled).toBe(false);
    fireEvent.click(exportButton());
    await waitFor(()=>expect(downloadSceneDelivery).toHaveBeenCalledOnce());
    expect(f.backupActions.prepareBackup).toHaveBeenCalledOnce();
    expect(executionTimetableHtml).toHaveBeenCalledWith(f.current,expect.objectContaining({id:expect.any(String),generatedAt:expect.any(String)}),f.ledger);
    const [html,mime,name,extension]=vi.mocked(downloadSceneDelivery).mock.calls[0];
    expect(typeof html).toBe('string');
    const document=new DOMParser().parseFromString(html as string,'text/html');
    expect([...document.querySelectorAll('#chronology article[data-task-id]')].map(row=>row.getAttribute('data-task-id')).sort()).toEqual(f.current.eventOperations.tasks.map(row=>row.id).sort());
    const textTask=document.querySelector(`#chronology [data-task-id="${itemId}"]`)!;
    expect(textTask.textContent).toContain('仅文字的主持沟通 <核对>');expect(textTask.textContent).toContain('无物件关联');
    expect(textTask.querySelector('time')!.textContent).toBe('待安排');expect(textTask.querySelector('time')!.hasAttribute('datetime')).toBe(false);
    expect(document.querySelector('[data-day="unknown"]')!.textContent).toContain('计划日期待安排');
    expect(document.querySelector('[data-day="2027-02-03"]')).not.toBeNull();
    for(const link of document.querySelectorAll<HTMLAnchorElement>('#owners a[data-task-ref]'))expect(document.querySelector(link.getAttribute('href')!)?.getAttribute('data-task-id')).toBe(link.dataset.taskRef);
    expect(document.querySelectorAll('#owners a[data-task-ref]')).toHaveLength(2);
    for(const [key,value] of [['agreedQuantity','20 件'],['receivedQuantity','18 件'],['returnedQuantity','18 件'],['notReceivedQuantity','2 件'],['notReturnedQuantity','0 件']])expect(document.querySelector(`[data-quantity="${key}"] dd`)!.textContent).toBe(value);
    expect(html).not.toContain('画面中的其他任务');expect(document.querySelector('script')).toBeNull();
    expect(mime).toBe('text/html;charset=utf-8');expect(name).toContain('独立演练活动_执行时间表_');expect(extension).toBe('html');
    expect(exportDeliveryGlb).not.toHaveBeenCalled();expect(productionPlanHandoffHtml).not.toHaveBeenCalled();
  });
  it('accepts explicitly absent brief and ledger, preserving unknown quantities without a production plan',async()=>{
    const f=completeActivity();
    f.backupActions.prepareBackup.mockResolvedValue(serializeLocalProjectBackupV3(f.current,{state:'ready',scope:checkinProject,brief:{status:'absent'}},{state:'ready',scope:checkinProject,materialCheckins:{status:'absent'}}));
    render(<SceneDeliveryPanel layout={f.current} controller={controller} backupActions={f.backupActions}/>);
    fireEvent.click(exportButton());await waitFor(()=>expect(downloadSceneDelivery).toHaveBeenCalledOnce());
    expect(executionTimetableHtml).toHaveBeenCalledWith(f.current,expect.anything(),undefined);
    const html=vi.mocked(downloadSceneDelivery).mock.calls[0][0];expect(html).toContain('未关联制作计划的主持任务');expect(html).toContain('本次未提供点验账册，收退数量与差额待确认。');
  });
  it.each(['legacy-scene','legacy-v2','wrong-project'] as const)('rejects %s instead of treating uncovered saved records as absent',async kind=>{
    const f=completeActivity();
    f.backupActions.prepareBackup.mockResolvedValue(kind==='legacy-scene'?JSON.stringify(f.current):kind==='legacy-v2'?serializeLocalProjectBackup(f.current,f.briefSnapshot):f.text.replaceAll(checkinProject,'20000000-0000-4000-8000-000000000002'));
    render(<SceneDeliveryPanel layout={f.current} controller={controller} backupActions={f.backupActions}/>);
    fireEvent.click(exportButton());await screen.findByText('活动资料未完整对应当前项目，请重新读取后导出。');
    expect(downloadSceneDelivery).not.toHaveBeenCalled();expect(executionTimetableHtml).not.toHaveBeenCalled();expect(exportButton().disabled).toBe(false);
  });
  it.each(['empty','no-callback','backup-pending','brief-loading','brief-error','checkin-unreadable'] as const)('does not offer an actionable timetable for %s',kind=>{
    const f=completeActivity();
    const briefState={brief:f.brief,ready:kind!=='brief-loading',error:kind==='brief-error'?'需求读取失败':null,hasSavedBrief:true};
    render(<SceneDeliveryPanel layout={kind==='empty'?{...f.current,eventOperations:eventOperationsSchema.parse({})}:f.current} controller={controller}
      backupActions={kind==='no-callback'?undefined:{...f.backupActions,backupPending:kind==='backup-pending'}} briefState={briefState}
      checkins={kind==='checkin-unreadable'?{...checkinState(),ready:false,error:'点验读取失败'}:checkinState()}/>);
    if(kind==='no-callback')expect(screen.queryByRole('button',{name:'导出执行时间表 HTML'})).toBeNull();
    else{expect(exportButton().disabled).toBe(true);fireEvent.click(exportButton());}
    if(kind==='empty')expect(screen.getByText('先在活动安排中保存任务，再导出执行时间表。')).toBeDefined();
    if(kind==='brief-loading'||kind==='brief-error')expect(screen.getByText('活动需求尚未准备好，请在活动需求中重试读取。')).toBeDefined();
    expect(f.backupActions.prepareBackup).not.toHaveBeenCalled();expect(downloadSceneDelivery).not.toHaveBeenCalled();expect(executionTimetableHtml).not.toHaveBeenCalled();
  });
  it.each(['未保存的评审说明须先保存或放弃','点验账册无法读取'] as const)('keeps a failed preparation retryable without downloading: %s',async message=>{
    const f=completeActivity();f.backupActions.prepareBackup.mockRejectedValueOnce(new Error(message));
    render(<SceneDeliveryPanel layout={f.current} controller={controller} backupActions={f.backupActions}/>);
    fireEvent.click(exportButton());await screen.findByText(message);
    expect(downloadSceneDelivery).not.toHaveBeenCalled();expect(executionTimetableHtml).not.toHaveBeenCalled();expect(exportButton().disabled).toBe(false);
    fireEvent.click(exportButton());await waitFor(()=>expect(downloadSceneDelivery).toHaveBeenCalledOnce());expect(f.backupActions.prepareBackup).toHaveBeenCalledTimes(2);
  });
  it('freezes each downloaded HTML and gives unchanged and subsequently saved exports independent file IDs',async()=>{
    const f=completeActivity();const view=render(<SceneDeliveryPanel layout={f.current} controller={controller} backupActions={f.backupActions}/>);
    fireEvent.click(exportButton());await waitFor(()=>expect(downloadSceneDelivery).toHaveBeenCalledTimes(1));
    const first=vi.mocked(downloadSceneDelivery).mock.calls[0],firstHtml=first[0];
    fireEvent.click(exportButton());await waitFor(()=>expect(downloadSceneDelivery).toHaveBeenCalledTimes(2));
    const metadata=vi.mocked(executionTimetableHtml).mock.calls.map(call=>call[1]);expect(metadata[0].id).not.toBe(metadata[1].id);expect(first[2]).not.toBe(vi.mocked(downloadSceneDelivery).mock.calls[1][2]);
    const changed={...f.current,eventOperations:eventOperationsSchema.parse({dataKind:'rehearsal',tasks:[{id:itemId,title:'后续保存的主持安排',phase:'event'}]})};
    f.backupActions.prepareBackup.mockResolvedValue(serializeLocalProjectBackupV3(changed,f.briefSnapshot,{state:'ready',scope:checkinProject,materialCheckins:{status:'absent'}}));
    view.rerender(<SceneDeliveryPanel layout={changed} controller={controller} backupActions={f.backupActions}/>);
    fireEvent.click(exportButton());await waitFor(()=>expect(downloadSceneDelivery).toHaveBeenCalledTimes(3));
    expect(vi.mocked(downloadSceneDelivery).mock.calls[2][0]).toContain('后续保存的主持安排');
    expect(first[0]).toBe(firstHtml);expect(firstHtml).toContain('未关联制作计划的主持任务');expect(firstHtml).not.toContain('后续保存的主持安排');
  });
  it.each(['layout','controller','account','unmount'] as const)('drops a late prepared timetable after %s changes',async change=>{
    const f=completeActivity(),held=deferred<string>();f.backupActions.prepareBackup.mockReturnValueOnce(held.promise);
    let snapshot=controller.getSnapshot();vi.spyOn(controller,'getSnapshot').mockImplementation(()=>snapshot);
    const props={layout:f.current,controller,backupActions:f.backupActions};const view=render(<SceneDeliveryPanel {...props}/>);
    fireEvent.click(exportButton());fireEvent.click(exportButton());await waitFor(()=>expect(f.backupActions.prepareBackup).toHaveBeenCalledOnce());
    let other:BackendSession|undefined;
    if(change==='unmount')view.unmount();
    else if(change==='layout')view.rerender(<SceneDeliveryPanel {...props} layout={{...f.current,name:'后续场景'}}/>);
    else if(change==='controller'){other=new BackendSession(getBackendConfig({url:'',anonKey:''}));view.rerender(<SceneDeliveryPanel {...props} controller={other}/>);}
    else{snapshot={...snapshot,user:{id:'后续账号'}};view.rerender(<SceneDeliveryPanel {...props}/>);}
    await act(async()=>held.resolve(f.text));expect(downloadSceneDelivery).not.toHaveBeenCalled();expect(executionTimetableHtml).not.toHaveBeenCalled();
    other?.dispose();
  });
  it.each(['layout','brief','brief-loading','ledger','checkin-loading','cloud-project','unmount'] as const)('drops a late generated timetable after %s changes',async change=>{
    const f=timetableActivity(),held=deferred<string>();vi.mocked(executionTimetableHtml).mockReturnValueOnce(held.promise);
    const project=(id:string)=>({id,studio_id:'studio',name:'演练场景服务',revision:1,scene:{schemaVersion:1 as const,venue:{width:8,depth:6,height:3,shape:'rectangle' as const,entrances:[]},objects:[],camera:'overview' as const,lighting:'neutral' as const}});
    let snapshot=controller.getSnapshot();
    if(change==='cloud-project'){
      snapshot={...snapshot,user:{id:'演练账号'},project:project('20000000-0000-4000-8000-000000000010'),geometryBinding:{version:1,localActivityId:checkinProject,cloudProjectId:'20000000-0000-4000-8000-000000000010',userId:'演练账号',apiUrl:controller.config.apiUrl}};
      vi.spyOn(controller,'isGeometryBound').mockImplementation(id=>id===checkinProject);
    }
    vi.spyOn(controller,'getSnapshot').mockImplementation(()=>snapshot);
    const briefState={brief:f.brief,ready:true,error:null,hasSavedBrief:true},checkins=checkinState(f.ledger);
    const props={layout:f.current,controller,backupActions:f.backupActions,briefState,checkins};const view=render(<SceneDeliveryPanel {...props}/>);
    fireEvent.click(exportButton());await waitFor(()=>expect(executionTimetableHtml).toHaveBeenCalledOnce());
    if(change==='unmount')view.unmount();
    else if(change==='layout')view.rerender(<SceneDeliveryPanel {...props} layout={{...f.current,name:'后续场景'}}/>);
    else if(change==='brief')view.rerender(<SceneDeliveryPanel {...props} briefState={{...briefState,brief:{...f.brief,description:'后续需求'}}}/>);
    else if(change==='brief-loading')view.rerender(<SceneDeliveryPanel {...props} briefState={{...briefState,ready:false}}/>);
    else if(change==='ledger')view.rerender(<SceneDeliveryPanel {...props} checkins={checkinState(materialCheckinLedgerSchema.parse({...f.ledger,sheets:[]}))}/>);
    else if(change==='checkin-loading')view.rerender(<SceneDeliveryPanel {...props} checkins={{...checkins,ready:false,loading:true}}/>);
    else{const remoteId='20000000-0000-4000-8000-000000000011';snapshot={...snapshot,project:project(remoteId),geometryBinding:{...snapshot.geometryBinding!,cloudProjectId:remoteId}};view.rerender(<SceneDeliveryPanel {...props}/>);expect(controller.isGeometryBound(checkinProject)).toBe(true);}
    await act(async()=>held.resolve('<html>原活动的迟到结果</html>'));expect(downloadSceneDelivery).not.toHaveBeenCalled();
    expect(screen.queryByText('执行时间表已导出，可离线打开与打印。计划与实际分别保留，未定时间和复核事项请执行团队确认。')).toBeNull();
  });
  it.each(['brief-readiness','activity-scope'] as const)('does not revive a pending timetable after %s leaves and returns to the original references',async change=>{
    const f=timetableActivity(),held=deferred<string>();vi.mocked(executionTimetableHtml).mockReturnValueOnce(held.promise);
    const briefState={brief:f.brief,ready:true,error:null,hasSavedBrief:true},checkins=checkinState(f.ledger);
    const props={layout:f.current,controller,backupActions:f.backupActions,briefState,checkins};const view=render(<SceneDeliveryPanel {...props}/>);
    fireEvent.click(exportButton());await waitFor(()=>expect(executionTimetableHtml).toHaveBeenCalledOnce());
    if(change==='brief-readiness')view.rerender(<SceneDeliveryPanel {...props} briefState={{...briefState,ready:false}}/>);
    else view.rerender(<SceneDeliveryPanel {...props} layout={{...f.current,id:'20000000-0000-4000-8000-000000000002',name:'另一演练活动'}}/>);
    // Commit both transitions; the final render deliberately reuses every original source reference.
    view.rerender(<SceneDeliveryPanel {...props}/>);
    await act(async()=>held.resolve('<html>往返切换前的时间表</html>'));
    expect(downloadSceneDelivery).not.toHaveBeenCalled();
    expect(screen.queryByText('执行时间表已导出，可离线打开与打印。计划与实际分别保留，未定时间和复核事项请执行团队确认。')).toBeNull();
    expect(exportButton().disabled).toBe(false);
  });
});
