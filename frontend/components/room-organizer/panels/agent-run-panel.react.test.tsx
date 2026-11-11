// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  appendAgentStep,
  appendAgentRunEvents,
  clearAgentSteerNotes,
  closeAgentStep,
  endAgentRun,
  getAgentRun,
  pushAgentSteerNote,
  setAgentPhase,
  setAgentSteerDelivered,
  setAgentThoughtCount,
  startAgentRun,
} from './agent-chat-store';
import { AgentRunPanel } from './agent-run-panel';

beforeEach(() => {
  startAgentRun('layout');
  setAgentThoughtCount(0);
});

afterEach(() => {
  endAgentRun();
  cleanup();
});

describe('运行时账本（store）', () => {
  it('setAgentThoughtCount 是绝对值，不是 +1', () => {
    setAgentThoughtCount(3);
    expect(getAgentRun().thoughtCount).toBe(3);
    setAgentThoughtCount(3);
    expect(getAgentRun().thoughtCount).toBe(3);
    setAgentThoughtCount(5);
    expect(getAgentRun().thoughtCount).toBe(5);
  });

  it('closeAgentStep 把这一步的耗时写回最后一条', () => {
    appendAgentStep({ toolName: '正在读取当前场景', durationMs: 0, isReadonly: true, startedAt: 1000 });
    closeAgentStep(1200);
    expect(getAgentRun().stepLog.at(-1)?.durationMs).toBe(1200);
  });

  it('没有步骤时 closeAgentStep 不炸', () => {
    expect(() => closeAgentStep(500)).not.toThrow();
    expect(getAgentRun().stepLog).toHaveLength(0);
  });

  it('startAgentRun 记下这一轮属于哪张脸，并清掉上一轮', () => {
    appendAgentStep({ toolName: '旧的一步', durationMs: 10, isReadonly: true, startedAt: 1 });
    startAgentRun('space');
    const run = getAgentRun();
    expect(run.scope).toBe('space');
    expect(run.stepLog).toHaveLength(0);
    expect(run.thoughtCount).toBe(0);
    expect(run.isRunning).toBe(true);
  });
});

describe('AgentRunPanel', () => {
  it('账本里没有真实运行时就不占版面', () => {
    endAgentRun();
    const { container } = render(<AgentRunPanel scope="layout"/>);
    expect(container.innerHTML).toBe('');
  });

  it('头部用的是云端给的真实轮数与真实步骤', () => {
    setAgentThoughtCount(4);
    appendAgentStep({ toolName: '正在读取当前场景', durationMs: 1200, isReadonly: true, startedAt: Date.now() - 1200 });
    appendAgentStep({ toolName: '正在整理候选方案', durationMs: 800, isReadonly: true, startedAt: Date.now() - 800 });
    render(<AgentRunPanel scope="layout"/>);
    expect(screen.getByText('正在处理')).toBeTruthy();
    expect(screen.getByText(/已进行 4 轮模型调用/)).toBeTruthy();
    expect(screen.getByText('正在读取当前场景')).toBeTruthy();
    expect(screen.getByText('正在整理候选方案')).toBeTruthy();
  });

  it('主标题是阶段（云端给的真值），轮数降为副行', () => {
    setAgentPhase('locate');
    setAgentThoughtCount(3);
    appendAgentStep({ toolName: '正在检索模型资源', durationMs: 900, isReadonly: true, startedAt: Date.now() - 900 });
    render(<AgentRunPanel scope="layout"/>);
    expect(screen.getByText(/当前阶段：定落点/)).toBeTruthy();
    expect(screen.getByText(/已进行 3 轮模型调用/)).toBeTruthy();
  });

  it('拿不到阶段就不写阶段，也不拿轮数顶替', () => {
    setAgentPhase(null);
    setAgentThoughtCount(2);
    render(<AgentRunPanel scope="layout"/>);
    expect(screen.queryByText(/阶段 ·/)).toBeNull();
    expect(screen.getByText('正在处理')).toBeTruthy();
  });

  it('步骤流默认只显示最后 3 步，可以展开全部', () => {
    const labels=['正在读取当前场景','正在检索模型资源','正在读取局部平面','正在搜索可落点','正在检查方案'];
    for (const toolName of labels) appendAgentStep({ toolName, durationMs: 100, isReadonly: true, startedAt: Date.now() });
    render(<AgentRunPanel scope="layout"/>);
    expect(screen.queryByText(labels[0]!)).toBeNull();
    expect(screen.queryByText(labels[1]!)).toBeNull();
    expect(screen.getByText(labels[2]!)).toBeTruthy();
    expect(screen.getByText(labels[4]!)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '共观察到 5 条，展开全部' }));
    expect(screen.getByText(labels[0]!)).toBeTruthy();
    expect(screen.getByText(labels[1]!)).toBeTruthy();
  });

  it('别的脸的账不串进来', () => {
    startAgentRun('space');
    appendAgentStep({ toolName: '空间脸的一步', durationMs: 100, isReadonly: true, startedAt: Date.now() });
    const { container } = render(<AgentRunPanel scope="layout"/>);
    expect(container.innerHTML).toBe('');
    render(<AgentRunPanel scope="space"/>);
    expect(screen.getByText('空间脸的一步')).toBeTruthy();
  });

  it('controls=false 时不挂运行条三控件（不能挂没有真后端通道的假控件）', () => {
    render(<AgentRunPanel scope="layout" controls={false}/>);
    expect(screen.queryByRole('button', { name: '跑完这步停' })).toBeNull();
    expect(screen.queryByRole('button', { name: '停止' })).toBeNull();
  });

  it('跑完后这一趟仍留在场上，并说清轮数、步数与用时', () => {
    setAgentThoughtCount(3);
    appendAgentStep({ toolName: '正在检查方案', durationMs: 900, isReadonly: true, startedAt: Date.now() - 900 });
    endAgentRun();
    render(<AgentRunPanel scope="layout"/>);
    expect(screen.getByText('本次运行已结束')).toBeTruthy();
    expect(screen.getByText(/已进行 3 轮模型调用/)).toBeTruthy();
    expect(screen.getByText('正在检查方案')).toBeTruthy();
  });

  it('空结果出回执卡，不沉默结束', () => {
    endAgentRun({ emptyOutcome: true });
    render(<AgentRunPanel scope="layout"/>);
    expect(screen.getByText('本次没有返回可用候选。')).toBeTruthy();
  });

  it('执行过程可收起，明确记录可能不完整，不把模型原文或任意进度文本展示成过程', () => {
    appendAgentStep({toolName:'用户私密内容或非白名单文本',thought:'模型内部内容',durationMs:30,isReadonly:true,startedAt:Date.now()});
    render(<AgentRunPanel scope="layout"/>);
    expect(screen.getByText(/可能遗漏步骤/)).toBeTruthy();
    expect(screen.getByText('正在处理任务')).toBeTruthy();
    expect(screen.queryByText('用户私密内容或非白名单文本')).toBeNull();
    expect(screen.queryByText(/模型内部内容/)).toBeNull();
    expect(screen.queryByText(/耗时/)).toBeNull();
    fireEvent.click(screen.getByRole('button',{name:'收起执行过程'}));
    expect(screen.queryByRole('list',{name:'执行过程'})).toBeNull();
    fireEvent.click(screen.getByRole('button',{name:'查看执行过程'}));
    expect(screen.getByRole('list',{name:'执行过程'})).toBeTruthy();
  });
  it('renders real started/finished outcomes without treating start or unknown as success',()=>{
    appendAgentRunEvents([
      {seq:1,tool:'get_scene',stage:'started',outcome:null,errorCode:null},
      {seq:2,tool:'get_scene',stage:'finished',outcome:'success',errorCode:null},
      {seq:3,tool:'validate_candidate',stage:'finished',outcome:'unknown',errorCode:null},
    ]);
    appendAgentRunEvents([{seq:2,tool:'get_scene',stage:'finished',outcome:'success',errorCode:null}]);
    render(<AgentRunPanel scope="layout"/>);
    expect(screen.getByText(/已发起/)).toBeTruthy();expect(screen.getByText(/已返回结果/)).toBeTruthy();
    expect(screen.getByText(/结果待核对/)).toBeTruthy();expect(screen.getByText(/工具返回结果不代表安全或规范检查通过/)).toBeTruthy();
    expect(screen.getAllByText('读取场景')).toHaveLength(2);
    expect(getAgentRun().eventLog).toHaveLength(3);
    startAgentRun('layout');expect(getAgentRun().eventLog).toHaveLength(0);
  });
  it('distinguishes tool categories with decorative icons while keeping status readable',()=>{
    const tools=['get_scene','search_resources','find_free_areas','validate_candidate','submit_candidates','create_parametric_model'] as const;
    appendAgentRunEvents(tools.map((tool,index)=>({seq:index+1,tool,stage:'finished' as const,outcome:index===3?'failed' as const:'success' as const,errorCode:null})));
    render(<AgentRunPanel scope="layout"/>);fireEvent.click(screen.getByRole('button',{name:'共观察到 6 条，展开全部'}));
    const rows=within(screen.getByRole('list',{name:'执行过程'})).getAllByRole('listitem');
    expect(rows.map(row=>row.getAttribute('data-tool-category'))).toEqual(['venue','material','position','check','candidate','generation']);
    expect(rows.every(row=>row.querySelector('[aria-hidden="true"]'))).toBe(true);
    expect(within(rows[3]!).getByText(/未完成/)).toBeTruthy();
    expect(within(rows[4]!).getByText(/已返回结果/)).toBeTruthy();
  });

  it('改道备注的「已送达」是服务端绝对值，不是前端自己加', () => {
    setAgentSteerDelivered(2);
    expect(getAgentRun().steerDelivered).toBe(2);
    setAgentSteerDelivered(2);
    expect(getAgentRun().steerDelivered).toBe(2);
    expect(getAgentRun().steerNotes).toHaveLength(0);
  });

  it('已送达与待送达必须分成两截说，不能并成一个数', () => {
    setAgentSteerDelivered(1);
    pushAgentSteerNote('把舞台往左挪一米');
    render(<AgentRunPanel scope="layout"/>);
    expect(screen.getByText(/已送达 1 条改道备注/)).toBeTruthy();
    expect(screen.getByText(/还有 1 条待送达/)).toBeTruthy();
  });

  it('只有待送达时不说「已送达」，避免把写进输入框当成已生效', () => {
    pushAgentSteerNote('换成圆桌');
    render(<AgentRunPanel scope="layout"/>);
    expect(screen.queryByText(/已送达/)).toBeNull();
    expect(screen.getByText(/还有 1 条待送达/)).toBeTruthy();
  });

  it('送走之后待送达清零，只剩已送达读数', () => {
    setAgentSteerDelivered(3);
    pushAgentSteerNote('换成圆桌');
    clearAgentSteerNotes();
    render(<AgentRunPanel scope="layout"/>);
    expect(screen.getByText(/已送达 3 条改道备注/)).toBeTruthy();
    expect(screen.queryByText(/待送达/)).toBeNull();
  });

  it('流水行按结果出 running / success / failed 标记（… / ✓ / ×）', () => {
    appendAgentRunEvents([
      {seq:1,tool:'get_scene',stage:'started',outcome:null,errorCode:null},
      {seq:2,tool:'get_scene',stage:'finished',outcome:'success',errorCode:null},
      {seq:3,tool:'validate_candidate',stage:'finished',outcome:'failed',errorCode:null},
    ]);
    render(<AgentRunPanel scope="layout"/>);
    const rows = within(screen.getByRole('list',{name:'执行过程'})).getAllByRole('listitem');
    expect(rows.map(r => r.querySelector('.ap-run-tick')?.getAttribute('data-result')))
      .toEqual(['running','success','failed']);
    expect(rows[2]!.querySelector('.ap-run-tick')?.textContent).toBe('×');
  });

  it('放置类步骤有 itemCount 才挂数量胶囊，取不到不编数', () => {
    appendAgentStep({toolName:'prepare_seating_candidate',durationMs:500,isReadonly:false,itemCount:2,startedAt:Date.now()});
    appendAgentStep({toolName:'find_free_areas',durationMs:300,isReadonly:true,startedAt:Date.now()});
    render(<AgentRunPanel scope="layout"/>);
    expect(screen.getByText('2 个物品')).toBeTruthy();
    expect(screen.queryByText(/件/)).toBeNull();
  });

  it('紧急停止钮同样进确认行，焦点落在「取消」，不绕过确认直接停', () => {
    render(<AgentRunPanel scope="layout"/>);
    fireEvent.click(screen.getByRole('button',{name:'紧急停止'}));
    expect(screen.getByText('要停止这项工作吗？')).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole('button',{name:'取消'}));
    expect(getAgentRun().stopRequested).toBe(false);
    // 确认行真实绑定 Esc 取消：只有取消侧挂 kbd 小标，停止钮没有快捷键。
    expect(screen.getByText('Esc', {selector: '.ap-kbd'})).toBeTruthy();
    expect(screen.getByRole('button',{name:'停止'}).querySelector('.ap-kbd')).toBeNull();
  });

  it('已送达备注收成聚合条；含未完成时走粉调，可展开明细', () => {
    setAgentSteerDelivered(3);
    appendAgentRunEvents([{seq:1,tool:'validate_candidate',stage:'finished',outcome:'failed',errorCode:null}]);
    render(<AgentRunPanel scope="layout"/>);
    const bar = screen.getByText('3 条备注已送达').closest('.ap-run-aggregate');
    expect(bar).toBeTruthy();
    expect(bar!.getAttribute('data-tone')).toBe('warn');
    fireEvent.click(screen.getByRole('button',{name:/备注已送达/}));
    expect(screen.getByText(/未完成步骤 1 条/)).toBeTruthy();
  });

  it('结束后收尾卡说清保留改动数与两档撤销语义', () => {
    appendAgentStep({toolName:'layBanquet',durationMs:600,isReadonly:false,itemCount:3,startedAt:Date.now()-600});
    endAgentRun();
    render(<AgentRunPanel scope="layout"/>);
    expect(screen.getByText('地图上保留了 3 处改动。')).toBeTruthy();
    expect(screen.getByText('Ctrl+Z', {selector: '.ap-kbd'})).toBeTruthy();
    expect(screen.getByText(/是逐步撤销/)).toBeTruthy();
  });

  it('没有真实快捷键绑定的控件不挂 kbd 小标（紧急停止 / 跑完这步停 / 聚合条；确认行未开不出 Esc）', () => {
    setAgentSteerDelivered(2);
    appendAgentRunEvents([{seq:1,tool:'get_scene',stage:'finished',outcome:'success',errorCode:null}]);
    render(<AgentRunPanel scope="layout"/>);
    expect(screen.getByRole('button',{name:'紧急停止'}).querySelector('.ap-kbd')).toBeNull();
    expect(screen.getByRole('button',{name:/跑完这步停/}).querySelector('.ap-kbd')).toBeNull();
    const aggregate = screen.getByText(/备注已送达/).closest('.ap-run-aggregate');
    expect(aggregate).toBeTruthy();
    expect(within(aggregate! as HTMLElement).getByRole('button').querySelector('.ap-kbd')).toBeNull();
    expect(screen.queryByText('Esc', {selector: '.ap-kbd'})).toBeNull();
  });

  it('取不到改动数时收尾卡不写具体数量', () => {
    appendAgentStep({toolName:'list_items',durationMs:300,isReadonly:true,startedAt:Date.now()-300});
    endAgentRun();
    render(<AgentRunPanel scope="layout"/>);
    expect(screen.getByText('本轮没有在画布上留下改动。')).toBeTruthy();
    expect(screen.queryByText(/处改动/)).toBeNull();
  });
});
