/**
 * 运行的阶段化进度：把「第 3/6 次模型调用」换成「第 2/4 阶段 · 定落点」。
 *
 * 为什么换：轮数是引擎的内部账，用户读不出「还要多久、在干什么」。谷地工坊的做法是
 * 阶段名（"第 2/4 阶段：先固定背景板再排桌椅"）——它描述的是工作推进到哪，不是机器
 * 转了几圈。幕景一次运行最多 6 轮，轮数照实写在后面，但前面必须先是阶段。
 *
 * 阶段的归属由「工具调用落在哪一段工作」决定，不由轮数决定：同一轮里可以既读场地又定落点。
 * 阶段只前进不后退——返回上一段读细节是细化，不是退回原点，界面上不该看到进度倒流。
 */
/**
 * 四个阶段的固定次序。新增阶段时这里就是唯一需要改的地方——
 * 阶段名、序号、说明都从这张表派生，界面上不另写一份数字。
 */
export const AGENT_PHASES = ['survey', 'locate', 'compose', 'deliver'] as const;
export type AgentPhase = (typeof AGENT_PHASES)[number];

const ORDER: AgentPhase[] = [...AGENT_PHASES];

/** 阶段总数：界面上写「第 N/4」，不要在两处各写一个数字。 */
export const AGENT_PHASE_COUNT = ORDER.length;

const LABELS: Record<AgentPhase, string> = {
  survey: '看现状',
  locate: '定落点',
  compose: '出方案',
  deliver: '交付',
};

/** 阶段的一句话说明：用户点开运行条能知道这一段具体在做什么。 */
const DETAILS: Record<AgentPhase, string> = {
  survey: '读场地、结构与可用资源',
  locate: '算合法落点、建缺的模型',
  compose: '试算方案、改材质',
  deliver: '整理候选，交给用户选',
};

export function phaseLabel(phase: AgentPhase): string {
  return LABELS[phase];
}

export function phaseDetail(phase: AgentPhase): string {
  return DETAILS[phase];
}

/** 从 1 开始的阶段序号。 */
export function phaseIndex(phase: AgentPhase): number {
  const index = ORDER.indexOf(phase);
  return index < 0 ? 1 : index + 1;
}

/**
 * 推进阶段：只接受更靠后的阶段。
 *
 * 模型常常「校验 → 回头再看一眼局部 → 再校验」，若按最后一次工具算阶段，进度会 3→1→3
 * 地往回跳。这里保留已到达的最远阶段，回头读细节不算退步。
 */
export function advancePhase(current: AgentPhase, next: AgentPhase): AgentPhase {
  return ORDER.indexOf(next) > ORDER.indexOf(current) ? next : current;
}

/**
 * 一轮开始时的进度行。
 *
 * 例：`第 2/4 阶段 · 定落点 · 第 3/6 轮`
 * 轮数放在最后并保留：它是真实的预算读数，用户据此判断「快没轮了」，但它不充当主标题。
 */
export function progressLine(phase: AgentPhase, turn: number, totalTurns: number): string {
  const safeTurn = Number.isFinite(turn) ? Math.max(1, Math.floor(turn)) : 1;
  const safeTotal = Number.isFinite(totalTurns) ? Math.max(safeTurn, Math.floor(totalTurns)) : safeTurn;
  return `第 ${phaseIndex(phase)}/${AGENT_PHASE_COUNT} 阶段 · ${LABELS[phase]} · 第 ${safeTurn}/${safeTotal} 轮`;
}
