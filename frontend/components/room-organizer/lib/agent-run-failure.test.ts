import { describe, expect, it } from 'vitest';
import { agentRunFailureMessage } from './agent-run-failure';

describe('Agent run failure messages', () => {
  it('reports a timeout only when the server explicitly reports a timeout', () => {
    expect(agentRunFailureMessage('AGENT_DEADLINE')).toContain('运行时限');
    expect(agentRunFailureMessage('PROVIDER_TIMEOUT')).toContain('响应超时');
    expect(agentRunFailureMessage('AGENT_FAILED')).toContain('原因尚未确定');
    expect(agentRunFailureMessage('MINIMAX_INVALID_TOOL_RESPONSE')).toContain('未生成可用候选');
    expect(agentRunFailureMessage(undefined)).not.toMatch(/超时|取消|网络/);
  });
  it('does not turn an unknown provider code into user-facing private text or a retry claim', () => {
    const result=agentRunFailureMessage('SECRET_PROVIDER_TEXT');
    expect(result).not.toContain('SECRET_PROVIDER_TEXT');
    expect(result).not.toMatch(/重试就好|自动重试|网络断/);
    expect(agentRunFailureMessage('AGENT_NO_VALID_CANDIDATE')).toContain('没有生成通过检查的候选');
  });
});
