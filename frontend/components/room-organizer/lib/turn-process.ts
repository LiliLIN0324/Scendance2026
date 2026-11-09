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

const LAYOUT_CHIP = /围着坐|大家围着|围成|围坐|围一圈|圆桌|布置|摆一下|摆一版|出一版|先出/;
const EDIT_CHIP = /挪|移动|删除|删掉|旋转|放大|缩小|加一把|加一张|导出|清单/;

/** A layout preview also retires earlier seating chips. Named edits stay. */
export function chipsAfterLayoutPreview(chips: readonly string[], fulfilled: readonly string[]): string[] {
  const exact = chipsAfterFulfilled(chips, fulfilled);
  const layout = fulfilled.some(text => LAYOUT_CHIP.test(text.replace(/\s+/g, '')) || /出方案|摆/.test(text.replace(/\s+/g, '')));
  if (!layout) return exact;
  return exact.filter(chip => {
    const compact = chip.replace(/\s+/g, '');
    if (EDIT_CHIP.test(compact)) return true;
    return !LAYOUT_CHIP.test(compact);
  });
}
