import type { RoomLayout } from './types';
import { preserveCurrentActivity } from '../../../lib/production-plan';
import { backendSceneToLayout } from './backend-adapter';
import { buildVenueShell } from './venue-shell';

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

/** 布置壳上限 100 米（MAX_ROOM_DIMENSION）；更大的真实场地圈画取其中一块规划区，真实尺寸写进名称。 */
export function createVenueFromPick(before: RoomLayout, pick: { name: string; location: string; polygon: AmapPoint[] }): RoomLayout {
  const { width, depth } = polygonBboxMeters(pick.polygon);
  const safeWidth = Math.min(100, Math.max(2, Math.round(width * 10) / 10));
  const safeDepth = Math.min(100, Math.max(2, Math.round(depth * 10) / 10));
  const oversized = width > 100 || depth > 100;
  const scaleNote = oversized ? ` · 规划区 ${safeWidth}×${safeDepth}m（真实范围 ${Math.round(width)}×${Math.round(depth)}m）` : '';
  const scene = buildVenueShell({ widthM: safeWidth, depthM: safeDepth, indoorOutdoor: 'outdoor', scaleOrigin: 'typed' });
  const name = [pick.name, pick.location].filter(Boolean).join(' · ') + scaleNote || before.name;
  return preserveCurrentActivity(before, backendSceneToLayout(scene, {
    name, ...(before.id ? { projectId: before.id } : {}),
  }));
}
