/**
 * 纯前端「停滞」判据。
 *
 * 后端运行器已有「打转」判据（连续两轮无进展 / 同一错误码在同一目标重复会触发 stop），
 * 但这些信号只存在于回执与日志里，运行面板拿不到。这里不依赖后端新增字段，仅凭面板
 * 每次轮询留下的进度快照（轮次 / 阶段 / 改动数）推断「智能体似乎在同一处打转」。
 *
 * 纯函数、无 IO、无随机：同一份输入永远给出同一份输出，便于单测。
 */

/** 一次轮询留下的一格进度快照。三个信号都可选——拿不到就不参与比较。 */
export interface StallSnapshot {
  /** 模型调用轮数（云端 callCount 的绝对值）。 */
  round?: number;
  /** 阶段名（云端 phase 的真值，如 survey / locate / compose / deliver）。 */
  phase?: string;
  /** 这一趟实际改动的格数；前端没有该字段时用步骤数代理。 */
  changedCells?: number;
  /** 采样时间戳（毫秒，epoch）。 */
  ts: number;
}

export interface StallResult {
  stalled: boolean;
  /** 停滞时的机器可读原因，便于日志与单测；界面中文文案由组件另写。 */
  reason?: string;
}

/** 连续多少次轮询毫无进展就判「停滞」。 */
export const STALL_POLLS = 2;

/**
 * prev → next 算不算「往前走了一步」。
 * 轮次 / 改动数必须严格变多才算前进；阶段只要变了（服务端只前进不后退）就算前进。
 */
function advanced(prev: StallSnapshot, next: StallSnapshot): boolean {
  const roundUp = prev.round !== undefined && next.round !== undefined && next.round > prev.round;
  const cellsUp = prev.changedCells !== undefined && next.changedCells !== undefined && next.changedCells > prev.changedCells;
  const phaseMove = next.phase !== prev.phase;
  return roundUp || cellsUp || phaseMove;
}

/**
 * 从最近往回数连续无进展的轮询次数，达到 {@link STALL_POLLS} 次即判停滞。
 *
 * `history` 必须是按时间从旧到新排好的快照序列（面板按采样顺序 push）。
 * 序列不足 N+1 格时还凑不齐「连续 N 次无进展」，直接判不停滞。
 */
export function detectStall(history: StallSnapshot[]): StallResult {
  if (history.length < STALL_POLLS + 1) return { stalled: false };

  const recent = history.slice(-(STALL_POLLS + 1));
  let unchangedPolls = 0;
  for (let i = recent.length - 1; i >= 1; i -= 1) {
    if (advanced(recent[i - 1], recent[i])) break;
    unchangedPolls += 1;
  }

  if (unchangedPolls >= STALL_POLLS) return { stalled: true, reason: 'no-progress' };
  return { stalled: false };
}
