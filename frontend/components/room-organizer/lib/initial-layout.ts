import { DEFAULT_ROOF } from './constants';
import type { FloorLayout, RoomLayout } from './types';

/**
 * The house every new session starts from. Lives in `lib/` so pure modules —
 * `restore-point.ts` decides "untouched" by comparing against it (#346) —
 * can read it; `hooks/layout-reducer.ts` re-exports it as the reducer's
 * initial state.
 */
export const INITIAL_GROUND_FLOOR: FloorLayout = {
  id: 'ground',
  name: '活动场地',
  height: 3,
  floorColor: '#f5f6f7',
  floorPattern: 'solid',
  // 2026-11-11 新主线（地理优先）：首屏不再预置桌椅绿植样板——先找场地、再在平面上规划，
  // 画布开局就是空的。INITIAL_LAYOUT 仍是「未改动过」的判定基线（restore-point 依赖它）。
  items: [],
};

export const INITIAL_LAYOUT: RoomLayout = {
  name: '周末共创工作坊',
  width: 10,
  height: 8,
  floors: [INITIAL_GROUND_FLOOR],
  roof: DEFAULT_ROOF,
  floorPlanOpacity: 0.5,
  floorPlanFitMode: 'stretch',
};
