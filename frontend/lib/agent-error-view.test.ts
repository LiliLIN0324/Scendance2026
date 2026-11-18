import { describe, expect, it } from 'vitest';
import { agentErrorView } from './agent-error-view';

describe('agentErrorView 四档归类', () => {
  it('invalid 归为输入需调整（muted）', () => {
    const view = agentErrorView('invalid');
    expect(view.stamp).toBe('输入需调整');
    expect(view.tone).toBe('muted');
    expect(view.message).toContain('链接、敏感信息');
  });

  it('disabled 与 unavailable 都归为暂未启用（muted）', () => {
    for (const status of ['disabled', 'unavailable'] as const) {
      const view = agentErrorView(status);
      expect(view.stamp).toBe('暂未启用');
      expect(view.tone).toBe('muted');
      expect(view.message).toContain('活动问答暂未启用');
    }
  });

  it('quota_exhausted 归为额度不足（warn）', () => {
    const view = agentErrorView('quota_exhausted');
    expect(view.stamp).toBe('额度不足');
    expect(view.tone).toBe('warn');
    expect(view.message).toContain('额度已用完或欠费');
  });

  it('timeout 单列一档（响应超时），不再与 provider_error 共用兜底', () => {
    // 2026-11-18（#6）：四类阻塞（未登录 / 功能关闭 / 额度不足 / 超时）要在界面上分得开，
    // 否则「分别验」无从下手。后端早就单列 timeout，前端这里补上对应的一档。
    const view = agentErrorView('timeout');
    expect(view.stamp).toBe('响应超时');
    expect(view.tone).toBe('warn');
    expect(view.message).toContain('时限内返回');
    expect(view.message).not.toContain('服务商可能仍在处理或计费');
  });

  it('provider_error / 未知状态仍落到智能理解（warn）', () => {
    for (const status of ['provider_error', undefined, 'nope', null]) {
      const view = agentErrorView(status);
      expect(view.stamp).toBe('智能理解');
      expect(view.tone).toBe('warn');
      expect(view.message).toContain('服务商可能仍在处理或计费');
    }
  });

  it('四类阻塞各有各的落点，不会互相撞档', () => {
    const stamps = [
      agentErrorView('disabled').stamp,
      agentErrorView('unavailable').stamp,
      agentErrorView('quota_exhausted').stamp,
      agentErrorView('timeout').stamp,
    ];
    expect(new Set(stamps).size).toBe(3); // disabled 与 unavailable 同一档，其余各一档
    expect(stamps).not.toContain('智能理解');
  });
});
