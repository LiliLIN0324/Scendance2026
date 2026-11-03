'use client';

/**
 * 左轨四格各自「有没有活儿」。
 *
 * 总控一直在线；Bingo / 空间 / 物料 平时休眠着：这条线有活儿（生成在跑、等你确认）或者出过错，
 * 状态点才亮。出错要爆红——别让人以为它还好好活着。
 *
 * 同一格可能有不止一个来源（环境取回和生成场景都在空间这格），所以按来源分开记：
 * 谁报的活儿谁负责撤，谁也不碰别人的。
 */

export type LaneId = 'door' | 'bingo' | 'space' | 'material';

/** idle = 没事干；busy = 在跑；ask = 等你确认；warn = 出错。 */
export type LaneActivity = 'idle' | 'busy' | 'ask' | 'warn';

export interface LaneActivityState {
  activity: LaneActivity;
  /** 一句人话，爆红时写清出了什么事。 */
  note: string;
}

const EMPTY: LaneActivityState = { activity: 'idle', note: '' };

/** 谁更严重：出错 > 在跑 > 等你确认 > 没事干。 */
const SEVERITY: Record<LaneActivity, number> = { idle: 0, ask: 1, busy: 2, warn: 3 };

const sources: Record<LaneId, Record<string, LaneActivityState>> = {
  door: {}, bingo: {}, space: {}, material: {},
};
const combined: Record<LaneId, LaneActivityState> = {
  door: EMPTY, bingo: EMPTY, space: EMPTY, material: EMPTY,
};
const listeners = new Set<() => void>();

function recompute(lane: LaneId): void {
  let best: LaneActivityState = EMPTY;
  for (const state of Object.values(sources[lane])) {
    if (SEVERITY[state.activity] > SEVERITY[best.activity]) best = state;
  }
  combined[lane] = best;
}

export function subscribeLaneActivity(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function getLaneActivity(lane: LaneId): LaneActivityState {
  return combined[lane] ?? EMPTY;
}

/** 这条线有活儿了。source 是谁报的，活儿撤了也得由它撤。 */
export function setLaneActivity(lane: LaneId, source: string, activity: LaneActivity, note = ''): void {
  sources[lane][source] = { activity, note };
  recompute(lane);
  for (const listener of listeners) listener();
}

/** 这条线上这摊活儿干完了。别的来源不受影响。 */
export function clearLaneActivity(lane: LaneId, source: string): void {
  if (!(source in sources[lane])) return;
  delete sources[lane][source];
  recompute(lane);
  for (const listener of listeners) listener();
}
