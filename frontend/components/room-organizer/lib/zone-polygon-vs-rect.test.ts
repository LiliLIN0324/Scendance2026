import { describe, expect, it } from 'vitest';
import { makeItem, makeUnplacedItem } from './__testfixtures__/fixtures';
import {
  itemsInZoneRing,
  ringArea,
  ringStats,
  zoneContainsRing,
  type RingPlacedItem,
} from './zone-polygon';
import { itemsInZone, zoneArea, zoneContains, zoneStats, rectToZoneRing } from './zones';
import type { RoomZone } from './types';
import type { PlanPoint } from '../../../../supabase/functions/_shared/site-plan';

/**
 * D5-3 矩形过渡版 ↔ 多边形版口径对照基线。
 *
 * 两套几何分属不同帧：矩形是房间中心帧 `{x,z,w,d}`，多边形是 plan 西北角帧
 * `{x,y}`。这里在同一抽象 footprint 上对照归属/面积/统计读数，钉住：
 * - 两边都按中心点归属；未摆放物件两边都剔除；
 * - 边界 inclusive：压在边/顶点上的点两边都算在内；
 * - 轴对齐矩形的鞋带面积 = w × d；统计读数一致。
 *
 * 帧换算（z↔y、房间中心 ↔ plan 西北角）属适配层，本对照测试只做坐标映射，
 * 不在几何模块里反解矩形。
 */
const rectZone: RoomZone = { id: 'r', name: '对照区', color: '#3b82f6', polygon: rectToZoneRing({ x: 0, z: 0, w: 4, d: 3 })! };
const ring: PlanPoint[] = [
  { x: 0, y: 0 },
  { x: 4, y: 0 },
  { x: 4, y: 3 },
  { x: 0, y: 3 },
];

// 抽象点：矩形帧 z ↔ 多边形帧 y，x 相同。
const points: Array<{ label: string; x: number; z: number; inside: boolean }> = [
  { label: '内点', x: 1, z: 1, inside: true },
  { label: '西边边界', x: 0, z: 1, inside: true },
  { label: '南边边界', x: 2, z: 0, inside: true },
  { label: '顶点', x: 4, z: 3, inside: true },
  { label: '西边外', x: -1, z: 1, inside: false },
  { label: '北边外', x: 2, z: 4, inside: false },
  { label: '东边外', x: 5, z: 2, inside: false },
];

function toRingItem(item: ReturnType<typeof makeItem>): RingPlacedItem {
  return {
    id: item.id,
    ...(item.price !== undefined ? { price: item.price } : {}),
    ...(item.position ? { position: { x: item.position.x, y: item.position.z } } : {}),
  };
}

describe('D5-3 矩形/多边形归属口径对照', () => {
  it.each(points)('$label：矩形与多边形判定一致', ({ x, z, inside }) => {
    expect(zoneContains(rectZone, { x, z })).toBe(inside);
    expect(zoneContainsRing(ring, { x, y: z })).toBe(inside);
  });

  it('两边都按中心点归属、未摆放剔除、保序', () => {
    const rectItems = [
      makeItem({ id: 'in', price: 800, position: { x: 1, z: 1 } }),
      makeItem({ id: 'out', position: { x: 4.6, z: 1 } }),
      makeUnplacedItem({ id: 'unplaced' }),
      makeItem({ id: 'free', position: { x: 2, z: 1 } }),
    ];
    const ringItems = rectItems.map(toRingItem);

    expect(itemsInZone(rectZone, rectItems).map(item => item.id)).toEqual(['in', 'free']);
    expect(itemsInZoneRing(ring, ringItems).map(item => item.id)).toEqual(['in', 'free']);
  });

  it('面积与统计读数一致（面积 w×d，价格缺省 0）', () => {
    expect(zoneArea(rectZone)).toBeCloseTo(12, 6);
    expect(ringArea(ring)).toBeCloseTo(12, 6);

    const rectItems = [
      makeItem({ id: 'in', price: 800, position: { x: 1, z: 1 } }),
      makeItem({ id: 'out', price: 1200, position: { x: 8, z: 8 } }),
      makeItem({ id: 'free', position: { x: 2, z: 1 } }),
      makeUnplacedItem({ id: 'unplaced' }),
    ];
    const ringItems = rectItems.map(toRingItem);

    expect(zoneStats(rectZone, rectItems)).toEqual({ itemCount: 2, cost: 800, area: 12 });
    expect(ringStats(ring, ringItems)).toEqual({ itemCount: 2, cost: 800, area: 12 });
  });
});
