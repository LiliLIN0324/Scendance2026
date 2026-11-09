/** Composer process strip. Layout and tool turns stay visible, including after a failure. */

export type ProcessFailure = 'understanding' | 'preview' | 'cloud_tool';

export function composeProcessStrip(input: {
  understanding: boolean;
  generating: boolean;
  cloudRunning: boolean;
  cloudRound: number;
  cloudTool: boolean;
  failed: ProcessFailure | null;
}): string | null {
  if (input.cloudRunning) return `云端第 ${Math.max(1, Math.floor(input.cloudRound) || 1)} 轮…`;
  if (input.generating && input.cloudTool) return '正在调用云端工具';
  if (input.generating) return '正在生成布置预览';
  if (input.understanding) return '正在理解活动需求…';
  if (input.failed === 'understanding') return '已尝试：正在理解…';
  if (input.failed === 'preview') return '已尝试：正在生成布置预览';
  if (input.failed === 'cloud_tool') return '已尝试：正在调用云端工具';
  return null;
}

/** Drop utterances this turn understood or turned into a preview. Other chips stay. */
export function chipsAfterFulfilled(chips: readonly string[], fulfilled: readonly string[]): string[] {
  const done = new Set(fulfilled.map(item => item.trim()).filter(Boolean));
  return chips.filter(item => !done.has(item));
}
