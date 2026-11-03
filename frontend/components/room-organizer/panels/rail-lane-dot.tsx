'use client';

import { useSyncExternalStore } from 'react';
import { getLaneActivity, subscribeLaneActivity, type LaneActivity, type LaneId } from '../lib/lane-status';

/** 左轨状态点的五色：休眠灰、在线绿、进行中蓝、待办赭、出错红。 */
export type RailTone = 'idle' | 'ok' | 'busy' | 'ask' | 'warn';

/**
 * 醒着 = 有活儿，或者这一格正开着；没事干就是休眠（灰）。
 * 总控例外：它一直在线，只有出错才爆红。
 */
export function railTone(lane: LaneId, activity: LaneActivity, open: boolean): RailTone {
  if (activity !== 'idle') return activity;
  return lane === 'door' || open ? 'ok' : 'idle';
}

/**
 * 左轨那枚 9px 状态点。它是左轨唯一允许的点缀（design-spec §一.4）。
 * tone 显式给的时候用它（比如 Bingo 直接读 agent 的状态），否则按这条线的活儿算。
 */
export function RailLaneDot({ lane, open = false, tone }: {
  lane: LaneId;
  /** 这一格的面板正开着吗。 */
  open?: boolean;
  tone?: RailTone;
}): JSX.Element {
  const state = useSyncExternalStore(
    subscribeLaneActivity,
    () => getLaneActivity(lane),
    () => getLaneActivity(lane),
  );
  return <span className={`sc-rail-dot is-${tone ?? railTone(lane, state.activity, open)}`} aria-hidden="true"/>;
}
