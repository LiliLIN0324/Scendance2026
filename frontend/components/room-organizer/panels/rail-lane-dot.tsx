'use client';

import { useSyncExternalStore } from 'react';
import { getLaneActivity, subscribeLaneActivity, type LaneActivity, type LaneId } from '../lib/lane-status';

/** 左轨状态点的颜色：休眠不画点，在线绿、进行中蓝、待办赭、出错红。 */
export type RailTone = 'idle' | 'ok' | 'busy' | 'ask' | 'warn';

/**
 * 醒着 = 有活儿，或者这一格正开着；没事干就是休眠，休眠不给颜色。
 * 活动例外：它一直在线，只有出错才爆红。
 */
export function railTone(lane: LaneId, activity: LaneActivity, open: boolean): RailTone {
  if (activity !== 'idle') return activity;
  return lane === 'door' || open ? 'ok' : 'idle';
}

/**
 * 左轨状态点已从轨上撤下（2026-11-18）。
 * 绿点没有产品说明，也不表示未读条数，所以工作台不再挂这枚 9px 圆点。
 * 车道忙闲仍记在 lane-status 里，供面板自己用；这里不要再画回角标。
 */
export function RailLaneDot({ lane, open = false, tone }: {
  lane: LaneId;
  /** 这一格的面板正开着吗。 */
  open?: boolean;
  tone?: RailTone;
}): JSX.Element | null {
  const state = useSyncExternalStore(
    subscribeLaneActivity,
    () => getLaneActivity(lane),
    () => getLaneActivity(lane),
  );
  const current = tone ?? railTone(lane, state.activity, open);
  return current === 'idle' ? null : <span className={`sc-rail-dot is-${current}`} aria-hidden="true"/>;
}
