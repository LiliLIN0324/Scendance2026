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
