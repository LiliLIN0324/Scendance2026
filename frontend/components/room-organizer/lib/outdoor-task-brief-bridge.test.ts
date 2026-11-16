import { describe, expect, it } from 'vitest';
import { briefFromTask, readyToResume, stageFromWait, taskFromBrief, waitFromStage } from './outdoor-task-brief-bridge';
import { placeSettled, rangeSettled, requireLogin } from './outdoor-pending-task';

const TEXT = '在杭州植物园玉泉鱼跃周边做两日市集，六个摊位，签到集章放进摊区，园路留 4 米贯通。';

describe('阶段换算', () => {
  it('已知阶段照实映射，未知阶段退回先选地点', () => {
    expect(waitFromStage('place')).toBe('place');
    expect(waitFromStage('range')).toBe('range');
    expect(waitFromStage('ready')).toBe('ready');
    expect(waitFromStage('design')).toBe('ready');
    expect(waitFromStage('login')).toBe('login');
    // 工作流以后加了新阶段名，也不能因此卡在“不知道下一步”
    expect(waitFromStage('whatever-new')).toBe('place');
    expect(waitFromStage('')).toBe('place');
  });

  it('反向往回写与正向一致', () => {
    for (const wait of ['place', 'range', 'ready', 'login'] as const) {
      expect(waitFromStage(stageFromWait(wait))).toBe(wait);
    }
  });
});

describe('从槽接回待办', () => {
  it('原话一字不改，阶段 range 说明地点已定', () => {
    const task = taskFromBrief({ text: TEXT, at: 1000, stage: 'range' }, 2000);
    expect(task.goal).toBe(TEXT);
    expect(task.waitingOn).toBe('range');
    expect(task.hasPlace).toBe(true);
    expect(task.next.kind).toBe('confirm_range');
  });

  it('阶段 place 时不算地点已定', () => {
    const task = taskFromBrief({ text: TEXT, at: 1000, stage: 'place' }, 2000);
    expect(task.hasPlace).toBe(false);
    expect(task.next.kind).toBe('pick_place');
    expect(task.constraints).toEqual([]);
  });

  it('未知阶段也不丢原话', () => {
    const task = taskFromBrief({ text: TEXT, at: 1000, stage: 'mystery' }, 2000);
    expect(task.goal).toBe(TEXT);
    expect(task.next.kind).toBe('pick_place');
  });
});

describe('写回槽', () => {
  it('阶段跟着进度走，原话不变', () => {
    const task = taskFromBrief({ text: TEXT, at: 1000, stage: 'place' }, 2000);
    const brief = briefFromTask(task, 3000);
    expect(brief).toEqual({ text: TEXT, at: 3000, stage: 'place' });
  });

  it('地点与范围都定了，写回的是 ready', () => {
    let task = taskFromBrief({ text: TEXT, at: 1000, stage: 'place' }, 2000);
    task = placeSettled(task, 2100);
    task = rangeSettled(task, 2200);
    expect(briefFromTask(task, 2300).stage).toBe('ready');
  });

  it('往返之后原话与等待条件都不漂移', () => {
    for (const stage of ['place', 'range', 'ready']) {
      const task = taskFromBrief({ text: TEXT, at: 1, stage }, 2);
      const back = taskFromBrief(briefFromTask(task, 3), 4);
      expect(back.goal).toBe(TEXT);
      expect(back.waitingOn).toBe(task.waitingOn);
    }
  });
});

describe('什么时候才真的接着发', () => {
  it('只有条件齐了才算可以发', () => {
    const base = taskFromBrief({ text: TEXT, at: 1, stage: 'place' }, 2);
    expect(readyToResume(base)).toBe(false);
    expect(readyToResume(rangeSettled(placeSettled(base, 3), 4))).toBe(true);
    expect(readyToResume(requireLogin(placeSettled(base, 3), 5))).toBe(false);
  });
});
