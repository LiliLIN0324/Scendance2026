import { preserveCurrentActivity } from '../../../lib/production-plan';
import { backendSceneToLayout } from './backend-adapter';
import { buildVenueShell } from './venue-shell';
import type { RoomLayout } from './types';

/** 空地卡与左栏文字链共用同一块空地：12 × 8 m，立完就能说「改成 15×10」调。 */
export const BLANK_VENUE = { width: 12, depth: 8 } as const;

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

export type MapVenuePick = { name: string; location: string; width: number; depth: number };

/**
 * 高德圈画的户外场地：外接矩形定宽深，outdoor 壳没有墙体，边界就是圈画的形状语义。
 * 地址与名称写进场地名，简报里能追溯「这块地是哪儿」。
 */
export function createMapVenue(before: RoomLayout, pick: MapVenuePick): RoomLayout {
  const width = Math.min(500, Math.max(2, Math.round(pick.width * 10) / 10));
  const depth = Math.min(500, Math.max(2, Math.round(pick.depth * 10) / 10));
  const scene = buildVenueShell({
    widthM: width, depthM: depth,
    indoorOutdoor: 'outdoor', scaleOrigin: 'typed',
  });
  return preserveCurrentActivity(before, backendSceneToLayout(scene, {
    name: pick.name || before.name, ...(before.id ? { projectId: before.id } : {}),
  }));
}
