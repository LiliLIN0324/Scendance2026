// @vitest-environment jsdom
import { webcrypto } from 'node:crypto';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import rehearsalExample from '../../../../docs/examples/30-person-rehearsal-operations.json';
import { eventOperationsSchema, type EventOperations, type EventOperationTask } from '../../../../supabase/functions/_shared/event-operations-contract';
import { productionPlanSchema } from '../../../../supabase/functions/_shared/production-plan-contract';
import { makeFloor, makeItem, makeLayout } from '../lib/__testfixtures__/fixtures';
import { INITIAL_BRIEF } from '../lib/creative-brief';
import { createOperation, operationBasis } from '../lib/event-operations';
import { parseLayoutEventOperations } from '../lib/schema';
import { EventOperationsPanel } from './event-operations-panel';
import type { RoomLayout } from '../lib/types';

beforeEach(() => vi.stubGlobal('crypto', webcrypto));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const itemId = '30000000-0000-4000-8000-000000000001';
function taskLayout(task: EventOperationTask, withItem = false): RoomLayout {
  return makeLayout({ floors: [makeFloor({ items: withItem ? [makeItem({ id: itemId, name: '签到椅' })] : [] })], eventOperations: eventOperationsSchema.parse({ tasks: [task] }) });
}
function livePanel(initial: RoomLayout, briefState?: Parameters<typeof EventOperationsPanel>[0]['briefState']) {
  let current = initial;
  const updates = vi.fn<(value: EventOperations | undefined) => void>();
  const locate = vi.fn();
  let view: ReturnType<typeof render>;
  function update(value: EventOperations | undefined): void {
    updates(value);
    if (value) current = { ...current, eventOperations: value };
    else { const { eventOperations: _removed, ...rest } = current; current = rest; }
    view.rerender(element());
  }
  const element = () => <EventOperationsPanel layout={current} disabled={false} onUpdate={update} onLocate={locate} briefState={briefState}/>;
  view = render(element());
  return { updates, locate, get layout() { return current; }, replace(next: RoomLayout) { current = next; view.rerender(element()); } };
}
function openTask(title: string): void {
  const summary = screen.getByText(title);
  fireEvent.click(summary);
  summary.closest('details')!.open = true;
}
async function settled(): Promise<void> { await waitFor(() => expect(screen.queryByText('正在核对…')).toBeNull()); }
function openAdd(): HTMLDetailsElement {
  const summary = screen.getByText('新增任务'); fireEvent.click(summary);
  const details = summary.closest('details')!; details.open = true;
  fireEvent(details, new Event('toggle')); return details;
}

describe('activity operations in the delivery panel', () => {
  it.each([
    ['accepted','missing',false],['review','ambiguous',false],['accepted','missing',true],['review','ambiguous',true],
  ] as const)('blocks %s confirmation for %s production-only objects (reconfirm=%s)', async (target, problem, reconfirm) => {
    const task={...createOperation('制作物料核对','setup'),ownerName:'现场组',acceptance:'核对租赁椅到场',evidenceNote:'原核对说明',actualStartedAt:'2026-10-09T01:00:00.123Z',actualFinishedAt:'2026-10-09T10:00:00.456+09:00',
      ...(reconfirm?{status:target,reviewedBasis:`sha256:${'0'.repeat(64)}`}:{})};
    const layout=taskLayout(task);
    layout.productionPlan=productionPlanSchema.parse({acquisitions:[{id:crypto.randomUUID(),title:'租赁签到椅',taskIds:[task.id],objectIds:[itemId],method:'rental'}]});
    if(problem==='ambiguous')layout.floors=[makeFloor({items:[makeItem({id:itemId,name:'签到椅'}),makeItem({id:itemId,name:'另一把椅'})]})];
    const ui=livePanel(layout);openTask('制作物料核对');await settled();
    if(!reconfirm)fireEvent.change(screen.getByLabelText('任务状态'),{target:{value:target}});
    const action=reconfirm?(target==='accepted'?'重新确认完成':'重新提交核对'):(target==='accepted'?'确认完成':'提交核对');
    const button=screen.getByRole('button',{name:action});
    if(!(button as HTMLButtonElement).disabled)fireEvent.click(button);
    await waitFor(()=>expect((button as HTMLButtonElement).disabled||screen.queryByRole('alert')!==null||ui.updates.mock.calls.length>0).toBe(true));
    expect(ui.updates).not.toHaveBeenCalled();
    expect(ui.layout.eventOperations!.tasks[0]).toMatchObject({id:task.id,objectIds:[],evidenceNote:task.evidenceNote,actualStartedAt:task.actualStartedAt,actualFinishedAt:task.actualFinishedAt});
    expect(screen.getAllByText(/制作计划.*核对/).length).toBeGreaterThan(0);
    expect(screen.queryByLabelText(/已移除的关联物料/)).toBeNull();
  });
  it('reviews production-only physical changes, preserves the old basis on ordinary save, and blocks unchanged accepted save after removal',async()=>{
    const task={...createOperation('租椅现场核对','setup'),status:'accepted' as const,reviewedBasis:`sha256:${'0'.repeat(64)}`,ownerName:'现场组',acceptance:'核对椅子摆放',evidenceNote:'原现场说明',actualStartedAt:'2026-10-09T01:00:00.123Z',actualFinishedAt:'2026-10-09T11:00:00.456+09:00'};
    const layout=taskLayout(task,true);layout.productionPlan=productionPlanSchema.parse({acquisitions:[{id:crypto.randomUUID(),title:'租赁椅',taskIds:[task.id.toUpperCase()],objectIds:[itemId]}]});
    layout.eventOperations!.tasks[0].reviewedBasis=await operationBasis(layout,task);const oldBasis=layout.eventOperations!.tasks[0].reviewedBasis;
    const ui=livePanel(layout);openTask(task.title);await settled();
    ui.replace({...ui.layout,floors:[makeFloor({items:[makeItem({id:itemId,name:'签到椅',position:{x:1,z:0}})]})]});await settled();
    expect(screen.getByText('需复核')).toBeDefined();fireEvent.click(screen.getByRole('button',{name:'保存任务'}));
    await waitFor(()=>expect(ui.updates).toHaveBeenCalledOnce());expect(ui.layout.eventOperations!.tasks[0].reviewedBasis).toBe(oldBasis);
    fireEvent.click(await screen.findByRole('button',{name:'重新确认完成'}));await waitFor(()=>expect(ui.updates).toHaveBeenCalledTimes(2));
    expect(ui.layout.eventOperations!.tasks[0].reviewedBasis).not.toBe(oldBasis);
    ui.replace({...ui.layout,floors:[makeFloor({items:[makeItem({id:'replacement-chair',name:'签到椅'})]})]});await settled();
    ui.updates.mockClear();fireEvent.click(screen.getByRole('button',{name:'保存任务'}));await screen.findByRole('alert');
    expect(ui.updates).not.toHaveBeenCalled();expect(screen.getByRole('alert').textContent).toContain('制作计划');
    expect(ui.layout.eventOperations!.tasks[0]).toMatchObject({id:task.id,objectIds:[],evidenceNote:task.evidenceNote,actualStartedAt:task.actualStartedAt,actualFinishedAt:task.actualFinishedAt});
    expect(ui.layout.productionPlan!.acquisitions[0].objectIds).toEqual([itemId]);
  });
  it.each([
    ['uuid','ab000000-0000-4000-8000-000000000001','AB000000-0000-4000-8000-000000000001',true],
    ['opaque','Chair-Case','CHAIR-CASE',false],
  ] as const)('matches direct %s identities without rewriting their original spelling',async(_kind,physicalId,referenceId,matches)=>{
    const task={...createOperation('直接物料核对','setup'),objectIds:[referenceId]};
    const ui=livePanel(makeLayout({floors:[makeFloor({items:[makeItem({id:physicalId,name:'核对椅'})]})],eventOperations:eventOperationsSchema.parse({tasks:[task]})}));openTask(task.title);await settled();
    expect((screen.getByLabelText(/核对椅 · 1/,{selector:'input'}) as HTMLInputElement).checked).toBe(matches);
    if(matches){
      expect(screen.queryByLabelText('已移除的关联物料 · 1')).toBeNull();fireEvent.click(screen.getByRole('button',{name:'保存任务'}));
      await waitFor(()=>expect(ui.updates).toHaveBeenCalledOnce());expect(ui.layout.eventOperations!.tasks[0].objectIds).toEqual([referenceId]);ui.updates.mockClear();
      fireEvent.click(screen.getByLabelText(/核对椅 · 1/,{selector:'input'}));
    }
    else fireEvent.click(screen.getByLabelText('已移除的关联物料 · 1'));
    fireEvent.click(screen.getByRole('button',{name:'保存任务'}));await waitFor(()=>expect(ui.updates).toHaveBeenCalledOnce());
    expect(ui.layout.eventOperations!.tasks[0].objectIds).toEqual([]);
  });
  it('saves planning status with unresolved production refs and canceling the same direct object still cannot confirm completion',async()=>{
    const task={...createOperation('待安排运输','preparation'),objectIds:[itemId],ownerName:'运输组',acceptance:'核对椅子到场',evidenceNote:'原记录',actualStartedAt:'2026-10-09T01:00:00.123Z'};
    const layout=taskLayout(task);layout.productionPlan=productionPlanSchema.parse({acquisitions:[{id:crypto.randomUUID(),title:'运输计划',taskIds:[task.id],objectIds:[itemId]}]});const plan=layout.productionPlan;
    const ui=livePanel(layout);openTask(task.title);await settled();fireEvent.click(screen.getByLabelText('已移除的关联物料 · 1'));
    expect(screen.queryByLabelText(/已移除的关联物料/)).toBeNull();fireEvent.click(screen.getByRole('button',{name:'保存任务'}));
    await waitFor(()=>expect(ui.updates).toHaveBeenCalledOnce());expect(ui.layout.eventOperations!.tasks[0]).toMatchObject({id:task.id,status:'todo',objectIds:[],evidenceNote:task.evidenceNote,actualStartedAt:task.actualStartedAt});
    expect(ui.layout.productionPlan).toBe(plan);expect(ui.layout.productionPlan!.acquisitions[0].objectIds).toEqual([itemId]);
    ui.updates.mockClear();fireEvent.change(screen.getByLabelText('任务状态'),{target:{value:'accepted'}});fireEvent.click(screen.getByRole('button',{name:'确认完成'}));
    await screen.findByRole('alert');expect(ui.updates).not.toHaveBeenCalled();expect(screen.getByRole('alert').textContent).toContain('制作计划');
    expect(ui.layout.productionPlan).toBe(plan);expect(ui.layout.productionPlan!.acquisitions[0].objectIds).toEqual([itemId]);
  });
  it('puts all six rehearsal task summaries before the folded creation form and requirement details', async () => {
    const layout = makeLayout({ eventOperations: eventOperationsSchema.parse(rehearsalExample) });
    render(<EventOperationsPanel layout={layout} disabled={false} onUpdate={vi.fn()} onOpenBrief={vi.fn()} briefState={{ brief: { ...INITIAL_BRIEF, description: '已保存的完整需求说明' }, ready: true, error: null, hasSavedBrief: true }}/>);
    expect(screen.getByText('演练安排 · 6 项')).toBeDefined();
    const add = screen.getByText('新增任务').closest('details')!;
    expect(add.open).toBe(false);
    expect(screen.getByRole('button', { name: '添加任务' }).closest('details')).toBe(add);
    expect(screen.getByText('需求详情').closest('details')!.open).toBe(false);
    for (const task of layout.eventOperations!.tasks) {
      const summary = screen.getByText(task.title).closest('summary')!;
      expect(summary.closest('details')!.open).toBe(false);
      expect(summary.compareDocumentPosition(add) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(summary.textContent).toContain('负责人待安排');
      expect(summary.textContent).toContain('计划时间待安排');
      expect(summary.textContent).not.toContain('实际时间未完整记录');
    }
    await settled();
  });

  it('focuses a newly created task once, preserves folded creation drafts and moves focus out when closing', async () => {
    const ui = livePanel(taskLayout(createOperation('已有准备', 'preparation')));
    const add = openAdd();
    fireEvent.change(screen.getByLabelText('新任务标题'), { target: { value: '新签到' } });
    fireEvent.change(screen.getByLabelText('新任务阶段'), { target: { value: 'event' } });
    fireEvent.click(screen.getByRole('button', { name: '添加任务' }));
    const added = screen.getByText('新签到').closest('details')!;
    const taskTitle = added.querySelector('input')!;
    await waitFor(() => expect(document.activeElement).toBe(taskTitle));
    expect(add.open).toBe(false);
    const owner = within(added).getByRole('textbox', { name: '负责人' }); owner.focus();
    fireEvent.change(owner, { target: { value: '现场组' } });
    fireEvent.click(within(added).getByRole('button', { name: '保存任务' }));
    await waitFor(() => expect(ui.updates).toHaveBeenCalledTimes(2));
    expect(document.activeElement).toBe(owner);
    openAdd();
    const newTitle = screen.getByLabelText('新任务标题');
    fireEvent.change(newTitle, { target: { value: '未保存的下一任务' } }); newTitle.focus();
    add.open = false; fireEvent(add, new Event('toggle'));
    expect(document.activeElement).toBe(add.querySelector('summary'));
    openAdd();
    expect((newTitle as HTMLInputElement).value).toBe('未保存的下一任务');
    expect((screen.getByLabelText('新任务阶段') as HTMLSelectElement).value).toBe('event');
  });

  it('shows requirement read or save errors outside folded sections when tasks already exist', () => {
    render(<EventOperationsPanel layout={makeLayout({ eventOperations: eventOperationsSchema.parse(rehearsalExample) })} disabled={false} onUpdate={vi.fn()} briefState={{ brief: INITIAL_BRIEF, ready: true, error: 'internal failure', hasSavedBrief: true }}/>);
    const error = screen.getByRole('alert');
    expect(error.textContent).toBe('活动需求无法读取或尚未保存，请打开原表单核对。');
    expect(error.closest('details')).toBeNull();
    expect(screen.getByText('新增任务').closest('details')!.open).toBe(false);
    expect(screen.queryByText('internal failure')).toBeNull();
  });

  it('displays the assignee and cross-midnight plan in Beijing time without changing original timestamps', async () => {
    const task = { ...createOperation('夜间交接', 'teardown'), ownerName: '交接组', plannedStartAt: '2026-10-08T15:30:00Z', plannedEndAt: '2026-10-09T01:30:00+09:00', actualStartedAt: '2026-10-08T15:31:00.123Z', status: 'doing' as const };
    const ui = livePanel(taskLayout(task));
    const summary = screen.getByText('夜间交接').closest('summary')!;
    expect(summary.textContent).toContain('负责人 · 交接组');
    expect(summary.textContent).toContain('2026-10-08 23:30 → 2026-10-09 00:30 · 北京时间');
    expect(summary.textContent).toContain('实际时间未完整记录');
    expect(ui.updates).not.toHaveBeenCalled();
    expect(ui.layout.eventOperations!.tasks[0]).toEqual(task);
    await settled();
  });
  it('reports rejected merged-layout association writes and retains the unsaved selection', async () => {
    const task = createOperation('演练关联', 'setup');
    const current = makeLayout({ floors: [makeFloor({items:[makeItem({id:itemId,name:'重复演练椅'})]}),makeFloor({id:'upper',name:'楼上',items:[makeItem({id:itemId,name:'重复演练椅'})]})], eventOperations:eventOperationsSchema.parse({tasks:[task]}) });
    const saved=vi.fn();
    const update=(value:EventOperations|undefined)=>{
      if(!parseLayoutEventOperations({...current,eventOperations:value}))throw new Error('活动安排未保存，请核对关联物料是否有重复编号。');
      saved(value);
    };
    render(<EventOperationsPanel layout={current} disabled={false} onUpdate={update}/>);
    openTask('演练关联');await settled();
    const more=screen.getByText(/证据链接与关联物料/);fireEvent.click(more);more.closest('details')!.open=true;
    const selection=screen.getAllByRole('checkbox')[0];fireEvent.click(selection);
    fireEvent.click(screen.getByRole('button',{name:'保存任务'}));
    await waitFor(()=>expect(screen.getByRole('alert').textContent).toContain('未保存'));
    expect(saved).not.toHaveBeenCalled();expect((selection as HTMLInputElement).checked).toBe(true);
    expect(current.eventOperations!.tasks[0].objectIds).toEqual([]);
    expect(screen.queryByText('任务已更新，请留意本机保存状态。')).toBeNull();
  });
  it('adds a task without material, people or dates and keeps the source brief unconfirmed', async () => {
    const ui = livePanel(makeLayout());
    expect(screen.getByText('活动需求尚未填写或未保存。')).toBeDefined();
    expect(screen.getByText('新增任务').closest('details')!.open).toBe(true);
    expect(screen.getByText('先写一项任务，再补负责人、计划时间和完成条件。可以不关联物料。')).toBeDefined();
    expect(screen.queryByRole('group', { name: '任务待补与复核' })).toBeNull();
    expect(screen.getByRole('button', { name: '添加任务' }).compareDocumentPosition(screen.getByRole('button', { name: '载入演练任务示例' })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(ui.updates).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '添加任务' }));
    expect(screen.getByRole('alert').textContent).toContain('请填写任务标题');
    expect(ui.updates).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('新任务标题'), { target: { value: '主持开场' } });
    fireEvent.change(screen.getByLabelText('新任务阶段'), { target: { value: 'event' } });
    fireEvent.click(screen.getByRole('button', { name: '添加任务' }));
    expect(ui.layout.eventOperations!.tasks[0]).toEqual(expect.objectContaining({ title: '主持开场', phase: 'event', status: 'todo', objectIds: [], ownerName: '', contractorName: '', plannedStartAt: null, plannedEndAt: null, actualStartedAt: null, actualFinishedAt: null }));
    expect(ui.layout.eventOperations!.dataKind).toBe('unspecified');
    expect(screen.getByText(/负责人待安排/)).toBeDefined();
    fireEvent.change(screen.getByLabelText('资料类型'), { target: { value: 'real' } });
    expect(ui.layout.eventOperations!.dataKind).toBe('real');
    await settled();
  });

  it('shows only a saved source brief and opens the original form', () => {
    const open = vi.fn();
    const view = render(<EventOperationsPanel layout={makeLayout()} disabled={false} onUpdate={vi.fn()} onOpenBrief={open} briefState={{ brief: INITIAL_BRIEF, ready: true, error: null, hasSavedBrief: false }}/>);
    expect(screen.queryByText(/品牌快闪/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '打开活动需求表单' })); expect(open).toHaveBeenCalledOnce();
    view.rerender(<EventOperationsPanel layout={makeLayout()} disabled={false} onUpdate={vi.fn()} onOpenBrief={open} briefState={{ brief: { ...INITIAL_BRIEF, event: '空间共创', guests: 30, description: '交流并共同制作' }, ready: true, error: null, hasSavedBrief: true }}/>);
    expect(screen.getByText('已保存需求草稿 · 空间共创 · 预计 30 人')).toBeDefined();
    expect(screen.getByText('交流并共同制作')).toBeDefined();
    view.rerender(<EventOperationsPanel layout={makeLayout()} disabled={false} onUpdate={vi.fn()} onOpenBrief={open} briefState={{ brief: INITIAL_BRIEF, ready: true, error: 'internal storage failure', hasSavedBrief: true }}/>);
    expect(screen.getByText('活动需求无法读取或尚未保存，请打开原表单核对。')).toBeDefined();
    expect(screen.queryByText(/internal storage failure/)).toBeNull();
  });

  it('loads six labelled example tasks while retaining the current project, scene and saved 24-person requirement', async () => {
    const initial = makeLayout({ name: '周末品牌活动' });
    const brief = { ...INITIAL_BRIEF, description: '24人客户交流活动', mustHave: '签到与合影' };
    const originalBrief = { ...brief };
    const ui = livePanel(initial, { brief, ready: true, error: null, hasSavedBrief: true });
    expect(screen.getByRole('heading', { name: '周末品牌活动' })).toBeDefined();
    expect(screen.getByText('30人共创示例，共6项任务；载入后请按当前活动调整。需求和场景保持原样。')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: '载入演练任务示例' }));
    expect(ui.layout.eventOperations!.tasks).toHaveLength(6);
    expect(ui.layout.eventOperations!.dataKind).toBe('rehearsal');
    expect(ui.layout.name).toBe(initial.name);
    expect(ui.layout.floors).toBe(initial.floors);
    expect(brief).toEqual(originalBrief);
    expect(screen.getByText('已保存需求草稿 · 品牌快闪 · 预计 24 人')).toBeDefined();
    expect(screen.getByRole('status').textContent).toBe('已载入6项30人共创示例任务，需求和场景保持原样。请按当前活动调整。');
    expect(screen.getByText('需求详情').closest('details')!.open).toBe(false);
    await settled();
  });

  it('counts missing task fields and exposes review failures outside folded tasks without double-counting', async () => {
    const incomplete = { ...createOperation('签到安排', 'event'), plannedStartAt: '2026-10-08T01:00:00Z' };
    const reviewed = { ...createOperation('布场核对', 'setup'), ownerName: '现场组', plannedStartAt: '2026-10-08T00:00:00Z', plannedEndAt: '2026-10-08T00:30:00Z', acceptance: '确认布置与通道', status: 'accepted' as const, evidenceNote: '现场已检查', reviewedBasis: `sha256:${'0'.repeat(64)}` };
    const ui = livePanel(makeLayout({ eventOperations: eventOperationsSchema.parse({ tasks: [incomplete, reviewed] }) }));
    const overview = screen.getByRole('group', { name: '任务待补与复核' });
    expect(overview.textContent).toContain('待补 · 负责人 1 项 · 计划时间 1 项 · 完成条件 1 项');
    expect(within(overview).queryByText(/需复核/)).toBeNull();
    await settled();
    expect(overview.textContent).toContain('需复核 1 项，请展开任务重新核对。');
    vi.stubGlobal('crypto', { randomUUID: webcrypto.randomUUID.bind(webcrypto) });
    ui.replace({ ...ui.layout });
    await waitFor(() => expect(screen.getByText('有 1 项任务核对失败，请展开任务检查后重试。')).toBeDefined());
    expect(screen.getByText('有 1 项任务核对失败，请展开任务检查后重试。').closest('details')).toBeNull();
    expect(within(overview).queryByText(/需复核/)).toBeNull();
    expect(screen.getByText('布场核对').closest('details')!.open).toBe(false);
    expect(ui.updates).not.toHaveBeenCalled();
  });

  it('records a plan in Beijing time without changing the independent actual times', async () => {
    const task = { ...createOperation('签到', 'event'), actualStartedAt: '2026-10-08T01:00:00.123Z', actualFinishedAt: '2026-10-08T12:30:00.456+09:00' };
    const ui = livePanel(taskLayout(task)); openTask('签到'); await settled();
    fireEvent.change(screen.getByLabelText('计划开始'), { target: { value: '2026-10-08T08:00' } });
    fireEvent.change(screen.getByLabelText('计划结束'), { target: { value: '2026-10-08T08:30' } });
    fireEvent.click(screen.getByRole('button', { name: '保存任务' }));
    await waitFor(() => expect(ui.updates).toHaveBeenCalledOnce());
    const saved = ui.layout.eventOperations!.tasks[0];
    expect(Date.parse(saved.plannedStartAt!)).toBe(Date.parse('2026-10-08T08:00:00+08:00'));
    expect(Date.parse(saved.plannedEndAt!)).toBe(Date.parse('2026-10-08T08:30:00+08:00'));
    expect(saved.actualStartedAt).toBe(task.actualStartedAt); expect(saved.actualFinishedAt).toBe(task.actualFinishedAt);
  });

  it('keeps invalid time and evidence drafts until the operator fixes them', async () => {
    const ui = livePanel(taskLayout(createOperation('撤场交接', 'teardown'))); openTask('撤场交接'); await settled();
    fireEvent.change(screen.getByLabelText('计划开始'), { target: { value: '2026-10-08T22:00' } });
    fireEvent.change(screen.getByLabelText('计划结束'), { target: { value: '2026-10-08T21:00' } });
    fireEvent.click(screen.getByRole('button', { name: '保存任务' }));
    expect(ui.updates).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toContain('计划结束不能早于计划开始');
    expect((screen.getByLabelText('计划开始') as HTMLInputElement).value).toContain('22:00');
    expect((screen.getByLabelText('计划结束') as HTMLInputElement).value).toContain('21:00');
    fireEvent.change(screen.getByLabelText('计划结束'), { target: { value: '2026-10-09T00:30' } });
    fireEvent.change(screen.getByLabelText('证据链接'), { target: { value: 'file:///private-proof.txt' } });
    fireEvent.click(screen.getByRole('button', { name: '保存任务' }));
    expect(ui.updates).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toContain('HTTP');
    expect((screen.getByLabelText('证据链接') as HTMLTextAreaElement).value).toBe('file:///private-proof.txt');
    fireEvent.change(screen.getByLabelText('资料类型'), { target: { value: 'rehearsal' } });
    expect((screen.getByLabelText('证据链接') as HTMLTextAreaElement).value).toBe('file:///private-proof.txt');
    expect((screen.getByLabelText('计划结束') as HTMLInputElement).value).toContain('00:30');
    ui.updates.mockClear();
    fireEvent.change(screen.getByLabelText('证据链接'), { target: { value: 'https://example.com/proof' } });
    fireEvent.click(screen.getByRole('button', { name: '保存任务' }));
    await waitFor(() => expect(ui.updates).toHaveBeenCalledOnce());
  });

  it('retains the original actual timestamp when the browser reports an incomplete time entry', async () => {
    const task = { ...createOperation('到场登记', 'preparation'), actualStartedAt: '2026-10-08T01:00:00.123Z' };
    const ui = livePanel(taskLayout(task)); openTask('到场登记'); await settled();
    const input = screen.getByLabelText('实际开始') as HTMLInputElement;
    const originalValue = input.value;
    Object.defineProperty(input, 'validity', { configurable: true, value: { badInput: true } });
    fireEvent.change(input, { target: { value: '2026-10-09T10:00' } });
    expect(screen.getByRole('alert').textContent).toContain('原时间已保留');
    fireEvent.click(screen.getByRole('button', { name: '保存任务' }));
    expect(ui.updates).not.toHaveBeenCalled();
    expect(ui.layout.eventOperations!.tasks[0].actualStartedAt).toBe(task.actualStartedAt);
    Object.defineProperty(input, 'validity', { configurable: true, value: { badInput: false } });
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.change(input, { target: { value: originalValue } });
    fireEvent.click(screen.getByRole('button', { name: '保存任务' }));
    await waitFor(() => expect(ui.updates).toHaveBeenCalledOnce());
    expect(ui.layout.eventOperations!.tasks[0].actualStartedAt).toBe(task.actualStartedAt);
  });

  it('retains a removed association and does not attach a same-named replacement or confirm it', async () => {
    const task = { ...createOperation('布置检查', 'setup'), objectIds: [itemId], ownerName: '现场组', acceptance: '检查摆放', evidenceNote: '已经检查' };
    const ui = livePanel(taskLayout(task, true)); openTask('布置检查'); await settled();
    const replacement = makeItem({ id: 'replacement-chair', name: '签到椅' });
    ui.replace({ ...ui.layout, floors: [makeFloor({ items: [replacement] })] }); await settled();
    expect(screen.getByText('1 件关联物料已移除')).toBeDefined();
    expect((screen.getByLabelText('已移除的关联物料 · 1') as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText(/签到椅 · 1/, { selector: 'input' }) as HTMLInputElement).checked).toBe(false);
    fireEvent.change(screen.getByLabelText('任务状态'), { target: { value: 'accepted' } });
    fireEvent.click(screen.getByRole('button', { name: '确认完成' }));
    expect(ui.updates).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toContain('关联物料已移除');
    expect(ui.layout.eventOperations!.tasks[0].objectIds).toEqual([itemId]);
  });

  it('keeps the previous completion basis after changed conditions until explicit reconfirmation', async () => {
    const task = { ...createOperation('主持核对', 'event'), ownerName: '主持组', acceptance: '核对开场流程', status: 'accepted' as const, evidenceNote: '现场联排已核对' };
    const layout = taskLayout({ ...task, reviewedBasis: `sha256:${'0'.repeat(64)}` });
    layout.eventOperations!.tasks[0].reviewedBasis = await operationBasis(layout, task);
    const oldBasis = layout.eventOperations!.tasks[0].reviewedBasis;
    const ui = livePanel(layout);
    expect(screen.getByText('正在核对…')).toBeDefined();
    expect(screen.queryByText('已完成', { selector: '.sc-handoff-status' })).toBeNull();
    openTask('主持核对'); await settled();
    fireEvent.change(screen.getByLabelText('完成条件'), { target: { value: '补核对结束提示' } });
    fireEvent.click(screen.getByRole('button', { name: '保存任务' }));
    await waitFor(() => expect(ui.updates).toHaveBeenCalledOnce());
    expect(ui.layout.eventOperations!.tasks[0].reviewedBasis).toBe(oldBasis);
    await waitFor(() => expect(screen.getByRole('button', { name: '重新确认完成' })).toBeDefined());
    expect(screen.getByText('需复核')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: '重新确认完成' }));
    await waitFor(() => expect(ui.updates).toHaveBeenCalledTimes(2));
    expect(ui.layout.eventOperations!.tasks[0].reviewedBasis).not.toBe(oldBasis);
    expect(ui.layout.eventOperations!.tasks[0].evidenceNote).toBe(task.evidenceNote);
    expect(ui.layout.eventOperations!.tasks[0].actualFinishedAt).toBeNull();
    await waitFor(() => expect(screen.queryByRole('button', { name: '重新确认完成' })).toBeNull());
  });

  it('undoes a task deletion and loads the labelled rehearsal only on explicit request', async () => {
    const task = createOperation('准备资料', 'preparation');
    const ui = livePanel(taskLayout(task)); openTask('准备资料'); await settled();
    expect(screen.queryByRole('button', { name: '载入演练任务示例' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '删除任务' }));
    expect(ui.layout.eventOperations!.tasks).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: '撤销删除任务' }));
    expect(ui.layout.eventOperations!.tasks[0].id).toBe(task.id);
    openTask('准备资料'); fireEvent.click(screen.getByRole('button', { name: '删除任务' }));
    fireEvent.click(screen.getByRole('button', { name: '载入演练任务示例' }));
    expect(ui.layout.eventOperations!.dataKind).toBe('rehearsal');
    expect(ui.layout.eventOperations!.tasks).toHaveLength(6);
    expect(new Set(ui.layout.eventOperations!.tasks.map(value => value.phase)).size).toBe(4);
    for (const saved of ui.layout.eventOperations!.tasks) {
      expect(saved.title).toContain('演练'); expect(saved.status).toBe('todo');
      expect(saved.ownerName).toBe(''); expect(saved.plannedStartAt).toBeNull();
      expect(saved.actualFinishedAt).toBeNull(); expect(saved.evidenceNote).toBe(''); expect(saved.reviewedBasis).toBeUndefined();
    }
  });
});
