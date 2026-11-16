import { describe, expect, it } from 'vitest';
import {
  createPendingTask,
  describeTask,
  isCurrent,
  loginSettled,
  placeSettled,
  rangeSettled,
  requireLogin,
  reviseTask,
} from './outdoor-pending-task';

const GOAL = '在杭州植物园玉泉鱼跃周边做两日市集，六个摊位，签到集章放进摊区，园路留 4 米贯通。';

describe('一件待办始终只有一个下一步', () => {
  it('新建就等地点，目标原样保存', () => {
    const task = createPendingTask({ goal: GOAL, now: 1000 });
    expect(task.goal).toBe(GOAL);
    expect(task.waitingOn).toBe('place');
    expect(task.next).toEqual({ kind: 'pick_place', label: '在地图上选地点' });
    expect(task.hasPlace).toBe(false);
  });

  it('地点定了转圈范围，范围定了转接着做设计', () => {
    let task = createPendingTask({ goal: GOAL, now: 1000 });
    task = placeSettled(task, 1100);
    expect(task.next.kind).toBe('confirm_range');
    expect(task.hasPlace).toBe(true);
    task = rangeSettled(task, 1200);
    expect(task.waitingOn).toBe('ready');
    expect(task.next.kind).toBe('run_design');
    expect(task.goal).toBe(GOAL);
  });

  it('已经可以做设计时，再报一次地点或范围不会打回上一步', () => {
    let task = createPendingTask({ goal: GOAL, now: 1000 });
    task = placeSettled(task, 1100);
    task = rangeSettled(task, 1200);
    expect(placeSettled(task, 1300)).toBe(task);
    // 范围重复确认会推进 revision，但下一步不变
    const again = rangeSettled(task, 1300);
    expect(again.next.kind).toBe('run_design');
  });
});

describe('登录只拦模型那一段', () => {
  it('要登录时给出唯一动作，登录回来回到圈范围而不是重选地点', () => {
    let task = createPendingTask({ goal: GOAL, now: 1000 });
    task = placeSettled(task, 1100);
    task = requireLogin(task, 1200);
    expect(task.next.kind).toBe('login');
    task = loginSettled(task, 1300);
    expect(task.next.kind).toBe('confirm_range');
    expect(task.hasPlace).toBe(true);
  });

  it('还没选地点就要求登录，回来后仍从选地点开始', () => {
    let task = createPendingTask({ goal: GOAL, now: 1000 });
    task = requireLogin(task, 1100);
    task = loginSettled(task, 1200);
    expect(task.next.kind).toBe('pick_place');
  });

  it('不在等登录时，登录完成不改变状态', () => {
    const task = createPendingTask({ goal: GOAL, now: 1000 });
    expect(loginSettled(task, 1100)).toBe(task);
  });
});

describe('改写需求不丢这件事', () => {
  it('目标替换、约束合并去重，条件回到选地点', () => {
    let task = createPendingTask({ goal: GOAL, constraints: ['两日'], now: 1000 });
    task = placeSettled(task, 1100);
    task = reviseTask(task, { goal: '改成一日市集，八个摊位', constraints: ['八个摊位', '两日'], now: 1200 });
    expect(task.goal).toBe('改成一日市集，八个摊位');
    expect(task.constraints).toEqual(['两日', '八个摊位']);
    expect(task.next.kind).toBe('pick_place');
    expect(task.hasPlace).toBe(false);
  });

  it('只加约束时目标保持原话', () => {
    const task = reviseTask(createPendingTask({ goal: GOAL, now: 1000 }), { constraints: ['留 4 米主路'], now: 1100 });
    expect(task.goal).toBe(GOAL);
    expect(task.constraints).toEqual(['留 4 米主路']);
  });
});

describe('迟到的回包不贴错', () => {
  it('编号或 revision 不匹配就丢弃', () => {
    const task = createPendingTask({ goal: GOAL, now: 1000 });
    expect(isCurrent(task, { taskId: task.id, revision: task.revision })).toBe(true);
    expect(isCurrent(task, { taskId: 'pt-other', revision: task.revision })).toBe(false);
    expect(isCurrent(task, { taskId: task.id, revision: task.revision + 1 })).toBe(false);
    expect(isCurrent(null, { taskId: task.id, revision: task.revision })).toBe(false);
  });

  it('需求改过之后，旧回包即使编号相同也不算当前', () => {
    const task = createPendingTask({ goal: GOAL, now: 1000 });
    const staleResult = { taskId: task.id, revision: task.revision };
    const revised = reviseTask(task, { goal: '改成一日市集', now: 1100 });
    expect(isCurrent(revised, staleResult)).toBe(false);
  });

  it('换项目等于旧待办消失：新待办 id 不同', () => {
    const first = createPendingTask({ goal: GOAL, now: 1000 });
    const second = createPendingTask({ goal: GOAL, now: 1001 });
    expect(second.id).not.toBe(first.id);
    expect(isCurrent(second, { taskId: first.id, revision: first.revision })).toBe(false);
  });
});

describe('界面那句话', () => {
  it('目标加唯一动作，一行说完', () => {
    const task = placeSettled(createPendingTask({ goal: GOAL, now: 1000 }), 1100);
    expect(describeTask(task)).toBe(`${GOAL} · 下一步：确认活动范围`);
    expect(describeTask(task).split('下一步：')).toHaveLength(2);
  });
});
