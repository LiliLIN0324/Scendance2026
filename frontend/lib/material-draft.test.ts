import { describe, expect, it } from 'vitest';
import { eventOperationsSchema } from '../../supabase/functions/_shared/event-operations-contract';
import { productionPlanSchema } from '../../supabase/functions/_shared/production-plan-contract';
import { makeLayout } from '../components/room-organizer/lib/__testfixtures__/fixtures';
import { appendMaterialTasks, draftMaterialTasks } from './material-draft';

const scope = 'material-draft-project';
const taskId = 'b2000000-0000-4000-8000-000000000001';
const acquisitionId = 'b2000000-0000-4000-8000-000000000002';
const otherAcquisitionId = 'b2000000-0000-4000-8000-000000000003';

const plan = (acquisitions: unknown[], dataKind = 'rehearsal') =>
  productionPlanSchema.parse({ dataKind, acquisitions });
const operations = (dataKind = 'rehearsal', tasks: unknown[] = []) =>
  eventOperationsSchema.parse({ dataKind, tasks });

describe('材料起草（P1-0）', () => {
  it('没有制作计划时不凭空起草', () => {
    expect(draftMaterialTasks(makeLayout({ id: scope }))).toEqual([]);
  });

  it('只按已有需求起草，不补数量、价格、供应商或时间', () => {
    const layout = makeLayout({ id: scope,
      eventOperations: operations(),
      productionPlan: plan([{ id: acquisitionId, title: '主背景喷绘', method: 'fabrication', objectIds: ['obj-1'] }]) });
    const drafts = draftMaterialTasks(layout);
    expect(drafts).toHaveLength(1);
    expect(drafts[0]!.acquisitionId).toBe(acquisitionId);
    expect(drafts[0]!.task).toMatchObject({ title: '制作：主背景喷绘', phase: 'preparation', status: 'todo',
      objectIds: ['obj-1'], plannedStartAt: null, plannedEndAt: null, acceptance: '',
      contractorName: '' });
    expect(drafts[0]!.task).not.toHaveProperty('contactName');
    expect(drafts[0]!.task).not.toHaveProperty('contactPhone');
    expect(drafts[0]!.task).not.toHaveProperty('price');
    expect(drafts[0]!.reason).toBe('该需求尚无对应任务');
  });

  it('需求已关联现存任务时不重复起草', () => {
    const layout = makeLayout({ id: scope,
      eventOperations: operations('rehearsal', [{ id: taskId, title: '搭背景', phase: 'setup' }]),
      productionPlan: plan([{ id: acquisitionId, title: '主背景喷绘', taskIds: [taskId] },
        { id: otherAcquisitionId, title: '签到台租赁', method: 'rental' }]) });
    const drafts = draftMaterialTasks(layout);
    expect(drafts.map(draft => draft.acquisitionId)).toEqual([otherAcquisitionId]);
    expect(drafts[0]!.task.title).toBe('租赁：签到台租赁');
  });

  it('关联任务已不存在时仍起草，并说明原关联失效', () => {
    const layout = makeLayout({ id: scope,
      eventOperations: operations(),
      productionPlan: plan([{ id: acquisitionId, title: '主背景喷绘', taskIds: [taskId] }]) });
    const drafts = draftMaterialTasks(layout);
    expect(drafts).toHaveLength(1);
    expect(drafts[0]!.reason).toBe('原关联任务已不在活动安排中');
  });

  it('制作与活动资料性质不同时拒绝起草', () => {
    const layout = makeLayout({ id: scope,
      eventOperations: operations('rehearsal'),
      productionPlan: plan([{ id: acquisitionId, title: '主背景喷绘' }], 'real') });
    expect(() => draftMaterialTasks(layout)).toThrow('制作资料与活动安排性质不同，请先核对。');
  });

  it('追加草案保留资料性质，同编号不会写两次', () => {
    const layout = makeLayout({ id: scope,
      eventOperations: operations('rehearsal'),
      productionPlan: plan([{ id: acquisitionId, title: '主背景喷绘' }]) });
    const drafts = draftMaterialTasks(layout);
    const once = appendMaterialTasks(layout.eventOperations!, drafts);
    const twice = appendMaterialTasks(once, drafts);
    expect(once.tasks.map(task => task.title)).toEqual(['准备：主背景喷绘']);
    expect(twice.tasks).toEqual(once.tasks);
    expect(twice.dataKind).toBe('rehearsal');
  });

  it('超长需求标题截到 120 字，不破坏任务契约', () => {
    const layout = makeLayout({ id: scope,
      eventOperations: operations(),
      productionPlan: plan([{ id: acquisitionId, title: '背'.repeat(119) }]) });
    const draft = draftMaterialTasks(layout)[0]!;
    expect(draft.task.title).toHaveLength(120);
    expect(draft.task.title.startsWith('准备：')).toBe(true);
  });
});
