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

  it('provider_error / timeout / 未知状态都落到智能理解（warn）', () => {
    for (const status of ['provider_error', 'timeout', undefined, 'nope', null]) {
      const view = agentErrorView(status);
      expect(view.stamp).toBe('智能理解');
      expect(view.tone).toBe('warn');
      expect(view.message).toContain('服务商可能仍在处理或计费');
    }
  });
});
