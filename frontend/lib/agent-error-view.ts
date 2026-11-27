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
  message: '这次没有拿到结果，原问题已保留。',
  stamp: '智能理解',
  tone: 'warn',
};

/** 按后端失败状态出四档视图；未知/抖动类默认落到「智能理解」warn。 */
export function agentErrorView(status: string | null | undefined): AgentErrorView {
  switch (status) {
    case 'invalid':
      return {
        message: '这次请求未通过校验，可能涉及输入、上下文或客户端与服务端版本。问题已保留；请重试，仍失败时需检查请求详情。',
        stamp: '请求未通过校验',
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
    // 2026-11-18（#6）：超时原来与 provider_error、未知状态共用兜底档，
    // 四类阻塞（未登录 / 功能关闭 / 额度不足 / 超时）在界面上分不出来，
    // 「分别验」根本无从下手。后端早就把 timeout 单列了，这里补上对应的一档。
    case 'timeout':
      return {
        message: '服务商这次没在时限内返回，本次未执行；请稍后重试，或把这一句拆短一点再试。',
        stamp: '响应超时',
        tone: 'warn',
      };
    case 'provider_error':
      return {
        message: '服务商未返回可用结果；本次结果未知，可能仍在处理或计费。',
        stamp: '服务商异常',
        tone: 'warn',
      };
    default:
      return FALLBACK_VIEW;
  }
}
