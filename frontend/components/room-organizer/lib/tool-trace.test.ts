import { describe, expect, it } from 'vitest';
import { finishLocalLayoutRun, getAgentRun, pushLocalLayoutStep, resetAgentRun } from '../panels/agent-chat-store';
import { toolChipStatus, toolStatusWord, toolTraceRows } from './tool-trace';

describe('tool trace', () => {
  it('marks a live line as running and a failed attempt as error', () => {
    expect(toolChipStatus('正在调用云端工具')).toBe('running');
    expect(toolChipStatus('已尝试：正在调用云端工具')).toBe('error');
    expect(toolChipStatus(null)).toBeNull();
    expect(toolStatusWord('running')).toBe('进行中');
    expect(toolStatusWord('done')).toBe('已完成');
    expect(toolStatusWord('error')).toBe('未完成');
  });

  it('turns receipts into short rows and does not keep raw tool names', () => {
    const rows = toolTraceRows({
      isRunning: true,
      events: [
        { seq: 1, tool: 'get_scene', stage: 'finished', outcome: 'success' },
        { seq: 2, tool: 'prepare_seating_candidate', stage: 'started', outcome: null },
        { seq: 3, tool: 'validate_candidate', stage: 'finished', outcome: 'failed' },
        { seq: 4, tool: 'secret_tool', stage: 'finished', outcome: 'unknown' },
      ],
    });
    expect(rows.map(row => [row.name, row.status, row.result])).toEqual([
      ['读取场景', 'done', '工具结果已返回'],
      ['试排课桌椅', 'running', '正在调用工具'],
      ['检查候选', 'error', '工具没有完成'],
      ['处理任务', 'done', '结果待核对'],
    ]);
    expect(JSON.stringify(rows)).not.toContain('secret_tool');
  });

  it('keeps preview, confirm, and apply on one local timeline', () => {
    resetAgentRun();
    pushLocalLayoutStep('preview', 'running');
    pushLocalLayoutStep('preview', 'done');
    pushLocalLayoutStep('validate', 'done');
    pushLocalLayoutStep('confirm', 'done');
    pushLocalLayoutStep('applied', 'done');
    finishLocalLayoutRun();
    const rows = toolTraceRows({ isRunning: getAgentRun().isRunning, events: [], steps: getAgentRun().stepLog });
    expect(rows.map(row => row.name)).toEqual(['出预览', '核对重叠', '确认布置', '已落画布']);
    expect(rows.every(row => row.status === 'done')).toBe(true);
    resetAgentRun();
    pushLocalLayoutStep('preview', 'done');
    pushLocalLayoutStep('confirm', 'error', '椅子和圆桌叠在一起');
    const failed = toolTraceRows({ isRunning: getAgentRun().isRunning, events: [], steps: getAgentRun().stepLog });
    expect(failed.map(row => [row.name, row.status, row.result])).toEqual([
      ['出预览', 'done', '出预览'],
      ['确认布置', 'error', '椅子和圆桌叠在一起'],
    ]);
    resetAgentRun();
  });

  it('uses observed steps only when there is no receipt', () => {
    const rows = toolTraceRows({
      isRunning: true,
      events: [],
      steps: [{ toolName: 'list_items' }, { toolName: 'layBanquet', itemCount: 10 }],
    });
    expect(rows).toEqual([
      { id: 's-0-list_items', name: '查看场地', status: 'done', result: '已观察到' },
      { id: 's-1-layBanquet', name: '摆放物件', status: 'running', result: '正在调用工具' },
    ]);
  });
});
