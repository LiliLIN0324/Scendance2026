/**
 * 聊天/理解链失败状态 → 错误卡文案、标签与语气。
 * 与后端 assistant-chat fail 枚举对齐；聊天链与户外链共用同一口径，避免两份文案漂移。
 */
export type AgentErrorStatus =
  | 'disabled'
  | 'invalid'
  | 'unavailable'
  | 'timeout'
  | 'provider_error'
  | 'quota_exhausted';

export type AgentErrorTone = 'warn' | 'muted';

export interface AgentErrorView {
  message: string;
  stamp: string;
  tone: AgentErrorTone;
}

const FALLBACK_VIEW: AgentErrorView = {
  message: '这次问答没有完成；服务商可能仍在处理或计费，请核对后再试。',
  stamp: '智能理解',
  tone: 'warn',
};

/** 按后端失败状态出四档视图；未知/抖动类默认落到「智能理解」warn。 */
export function agentErrorView(status: string | null | undefined): AgentErrorView {
  switch (status) {
    case 'invalid':
      return {
        message: '问题或近期对话中含链接、敏感信息或超出长度，请调整后再试。',
        stamp: '输入需调整',
        tone: 'muted',
      };
    case 'disabled':
    case 'unavailable':
      return { message: '活动问答暂未启用，问题已保留。', stamp: '暂未启用', tone: 'muted' };
    case 'quota_exhausted':
      return {
        message: '该模型额度已用完或欠费，请在上方切换其它模型，或联系管理员充值。',
        stamp: '额度不足',
        tone: 'warn',
      };
    default:
      return FALLBACK_VIEW;
  }
}
