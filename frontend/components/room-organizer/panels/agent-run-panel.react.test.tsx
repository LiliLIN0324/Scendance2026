// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  appendAgentStep,
  clearAgentSteerNotes,
  closeAgentStep,
  endAgentRun,
  getAgentRun,
  pushAgentSteerNote,
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

  it('头部用的是云端给的真实思考条数与真实步骤', () => {
    setAgentThoughtCount(4);
    appendAgentStep({ toolName: '正在读取当前场景', durationMs: 1200, isReadonly: true, startedAt: Date.now() - 1200 });
    appendAgentStep({ toolName: '正在整理候选方案', durationMs: 800, isReadonly: true, startedAt: Date.now() - 800 });
    render(<AgentRunPanel scope="layout"/>);
    expect(screen.getByText(/正在思考 · 4 条思考/)).toBeTruthy();
    expect(screen.getByText('正在读取当前场景')).toBeTruthy();
    expect(screen.getByText('正在整理候选方案')).toBeTruthy();
  });

  it('步骤流默认只显示最后 3 步，可以展开全部', () => {
    for (let i = 1; i <= 5; i += 1) {
      appendAgentStep({ toolName: `第 ${i} 步`, durationMs: 100, isReadonly: true, startedAt: Date.now() });
    }
    render(<AgentRunPanel scope="layout"/>);
    expect(screen.queryByText('第 1 步')).toBeNull();
    expect(screen.queryByText('第 2 步')).toBeNull();
    expect(screen.getByText('第 3 步')).toBeTruthy();
    expect(screen.getByText('第 5 步')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '共 5 步，展开全部' }));
    expect(screen.getByText('第 1 步')).toBeTruthy();
    expect(screen.getByText('第 2 步')).toBeTruthy();
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
    expect(screen.getByText(/这一趟走完了 · 3 条思考 · 1 步/)).toBeTruthy();
    expect(screen.getByText('正在检查方案')).toBeTruthy();
  });

  it('空结果出回执卡，不沉默结束', () => {
    endAgentRun({ emptyOutcome: true });
    render(<AgentRunPanel scope="layout"/>);
    expect(screen.getByText('没做成。')).toBeTruthy();
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
});
