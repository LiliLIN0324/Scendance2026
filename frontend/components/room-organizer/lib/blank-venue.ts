import { preserveCurrentActivity } from '../../../lib/production-plan';
import { BLANK_VENUE_SIZE } from '../../../lib/workspace-api';
import { backendSceneToLayout } from './backend-adapter';
import { buildVenueShell } from './venue-shell';
import type { RoomLayout } from './types';

/** 空地卡与左栏文字链共用同一块空地：12 × 8 m，立完就能说「改成 15×10」调。 */
export const BLANK_VENUE = BLANK_VENUE_SIZE;

/**
 * 空白场地不是一张新图纸，而是编辑器自己立得起来的矩形壳：四面外墙 + 正面主入口。
 * 活动需求、任务与物料交接跟着人原来填的走，桌椅这类布置清掉。
 */
export function createBlankVenue(before: RoomLayout): RoomLayout {
  const scene = buildVenueShell({
    widthM: BLANK_VENUE.width, depthM: BLANK_VENUE.depth,
    indoorOutdoor: 'indoor', scaleOrigin: 'typed',
  });
  return preserveCurrentActivity(before, backendSceneToLayout(scene, {
    name: before.name, ...(before.id ? { projectId: before.id } : {}),
  }));
}

/**
 * 活动行业口径的「硬装空房」：宴会厅 / 发布会小厅常见的 18 × 12 m、净高 5 m，
 * 正面留 2.4 m 双开主入口。只出壳体和硬装面（墙、地面、踢脚线、门洞、灯光），
 * 不带任何桌椅软装——立完就能直接往上布置。
 */
export const HARD_FINISH_HALL = { width: 18, depth: 12, height: 5, entranceWidthM: 2.4 } as const;

export function createHardFinishHall(before: RoomLayout): RoomLayout {
  const scene = buildVenueShell({
    widthM: HARD_FINISH_HALL.width, depthM: HARD_FINISH_HALL.depth,
    heightM: HARD_FINISH_HALL.height, entranceWidthM: HARD_FINISH_HALL.entranceWidthM,
    indoorOutdoor: 'indoor', scaleOrigin: 'typed',
  });
  return preserveCurrentActivity(before, backendSceneToLayout(scene, {
    name: before.name, ...(before.id ? { projectId: before.id } : {}),
  }));
}
