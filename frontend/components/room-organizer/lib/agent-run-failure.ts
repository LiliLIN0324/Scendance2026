/** User-facing text is based only on the server's explicit run error code. */
export function agentRunFailureMessage(code: string | undefined): string {
  switch (code) {
    case 'AGENT_DEADLINE':
      return '本次任务达到运行时限，未返回可用候选。请先核对任务状态，再决定下一步。';
    case 'PROVIDER_TIMEOUT':
      return '模型服务响应超时，未返回可用候选。请先核对任务状态，再决定下一步。';
    case 'AGENT_NO_VALID_CANDIDATE':
      return '本次没有生成通过检查的候选，请查看任务提示并调整需求后再试。';
    default:
      return '本次任务未完成，未生成可用候选，原因尚未确定。请先核对任务状态，再决定下一步。';
  }
}
