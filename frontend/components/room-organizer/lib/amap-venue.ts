import type { RoomLayout } from './types';
import { raiseVenue, replaceVenueWithShell } from './agent-proposal';

export type AmapPoint = { lng: number; lat: number };

/** 圈画多边形的外接矩形，按纬度换算成米：经度向 1° ≈ 111.32·cos(纬度) km，纬度向 1° ≈ 110.57 km。 */
export function polygonBboxMeters(polygon: AmapPoint[]): { width: number; depth: number } {
  if (polygon.length < 3) return { width: 0, depth: 0 };
  const lats = polygon.map(p => p.lat);
  const lngs = polygon.map(p => p.lng);
  const latMid = (Math.min(...lats) + Math.max(...lats)) / 2;
  const kmPerLat = 110.574;
  const kmPerLng = 111.32 * Math.cos((latMid * Math.PI) / 180);
  const width = (Math.max(...lngs) - Math.min(...lngs)) * kmPerLng * 1000;
  const depth = (Math.max(...lats) - Math.min(...lats)) * kmPerLat * 1000;
  return { width: Math.round(width * 10) / 10, depth: Math.round(depth * 10) / 10 };
}

/** AMap 多边形路径 → 圈画点列。 */
export function toPoints(path: { lng: number; lat: number }[] | AmapPoint[]): AmapPoint[] {
  return path.map(p => ({ lng: Number(p.lng), lat: Number(p.lat) }));
}

/**
 * 布置壳上限 100 米（MAX_ROOM_DIMENSION）：更大的真实场地圈画取其中一块规划区，真实尺寸写进名称。
 * 立壳走 raiseVenue/replaceVenueWithShell，和「改成 15×10」同一条路径——旧物料放得下就留在原地，
 * 放不下才撤掉，并回报撤了几件（不能悄悄把布置清零）。
 */
export function createVenueFromPick(
  before: RoomLayout,
  pick: { name: string; location: string; polygon: AmapPoint[] },
): { layout: RoomLayout; cleared: number } {
  const { width, depth } = polygonBboxMeters(pick.polygon);
  const safeWidth = Math.min(100, Math.max(2, Math.round(width * 10) / 10));
  const safeDepth = Math.min(100, Math.max(2, Math.round(depth * 10) / 10));
  const oversized = width > 100 || depth > 100;
  const scaleNote = oversized ? ` · 规划区 ${safeWidth}×${safeDepth}m（真实范围 ${Math.round(width)}×${Math.round(depth)}m）` : '';
  const input = {
    base: before, floorIndex: 0, widthM: safeWidth, depthM: safeDepth,
    indoorOutdoor: 'outdoor' as const, scaleOrigin: 'typed' as const,
  };
  const plan = (before.scenePreset || before.backendSceneV2 ? replaceVenueWithShell(input) : null) ?? raiseVenue(input);
  if (!plan) throw new Error('这块场地是有内墙或图纸证据的真实结构，先在结构里清出一块矩形空地，再来圈画。');
  const name = [pick.name, pick.location].filter(Boolean).join(' · ') + scaleNote || before.name;
  return { layout: { ...plan.layout, name }, cleared: plan.cleared };
}
