import { describe, expect, it } from 'vitest';
import type { PlanPoint } from '../../../../supabase/functions/_shared/site-plan';
import { migrateLayoutToPlan } from './plan-layout-migration';
import { makeFloor, makeItem, makeLayout, makeUnplacedItem } from './__testfixtures__/fixtures';

/** 10×8 m 平面边界（x 东、y 北）；壳体 20×16，两轴缩放 2。 */
const BOUNDARY: PlanPoint[] = [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
  { x: 10, y: 8 },
  { x: 0, y: 8 },
];

const SHELL = { width: 20, height: 16 };

/** 固定 id 生成器，便于快照断言。 */
function sequentialIds(): () => string {
  let n = 0;
  return () => `u-${++n}`;
}

describe('plan-layout-migration（旧室内布局 → plan 实体）', () => {
  it('分区矩形迁成四点闭合环，语义按映射表对齐 plan 九类', () => {
    const layout = makeLayout({
      ...SHELL,
      floors: [makeFloor({
        zones: [
          { id: 'z-checkin', name: '签到区', color: '#3d8fa8', zoneType: 'checkin', x: 2, z: 2, w: 4, d: 4 },
          { id: 'z-round', name: '圆桌区', color: '#7fb69a', zoneType: 'roundtable', x: 2, z: 2, w: 4, d: 4 },
          { id: 'z-photo', name: '打卡区', color: '#8b9aa6', zoneType: 'photo', x: 2, z: 2, w: 4, d: 4 },
          { id: 'z-none', name: '无名类型区', color: '#8b9aa6', x: 2, z: 2, w: 4, d: 4 },
        ],
      })],
    });

    const result = migrateLayoutToPlan(layout, BOUNDARY, sequentialIds());

    expect(result.zones).toHaveLength(4);
    const byId = Object.fromEntries(result.zones.map(z => [z.name, z]));
    expect(byId['签到区']!.semantic).toBe('checkin');
    expect(byId['圆桌区']!.semantic).toBe('audience');
    expect(byId['打卡区']!.semantic).toBe('reserved');
    expect(byId['无名类型区']!.semantic).toBe('reserved');
    // 颜色直带（十六进制）；四点环：NW→NE→SE→SW，坐标经边界逆变换
    const checkin = byId['签到区']!;
    expect(checkin.color).toBe('#3d8fa8');
    expect(checkin.polygon).toEqual([
      { x: 1, y: 7 },
      { x: 3, y: 7 },
      { x: 3, y: 5 },
      { x: 1, y: 5 },
    ]);
  });

  it('person 物件迁成人员点位（count=1），非 person 不进 workers', () => {
    const layout = makeLayout({
      ...SHELL,
      floors: [makeFloor({
        items: [
          makeItem({ id: 'p1', type: 'person', name: '引导员', position: { x: 2, z: 4 }, color: '#b3628c' }),
          makeItem({ id: 'c1', type: 'chair', name: '椅子', position: { x: 1, z: 1 } }),
        ],
      })],
    });

    const result = migrateLayoutToPlan(layout, BOUNDARY, sequentialIds());

    expect(result.workers).toHaveLength(1);
    const worker = result.workers[0]!;
    expect(worker.role).toBe('引导员');
    expect(worker.count).toBe(1);
    expect(worker.position).toEqual({ x: 1, y: 6 });
    expect(worker.color).toBe('#b3628c');
  });

  it('人员行走动线迁成步行路线，闭环=双向、折返=单向', () => {
    const loop = makeLayout({
      ...SHELL,
      floors: [makeFloor({
        items: [makeItem({
          id: 'p-loop', type: 'person', name: '巡游员', position: { x: 2, z: 2 },
          walkRoute: { points: [{ x: 2, z: 2 }, { x: 6, z: 6 }] },
        })],
      })],
    });
    const loopResult = migrateLayoutToPlan(loop, BOUNDARY, sequentialIds());
    expect(loopResult.routes).toHaveLength(1);
    expect(loopResult.routes[0]!).toMatchObject({
      kind: 'pedestrian',
      oneWay: false,
      points: [{ x: 1, y: 7 }, { x: 3, y: 5 }],
    });

    const oneWay = makeLayout({
      ...SHELL,
      floors: [makeFloor({
        items: [makeItem({
          id: 'p-ow', type: 'person', name: '引路员', position: { x: 2, z: 2 },
          walkRoute: { points: [{ x: 2, z: 2 }, { x: 6, z: 6 }], loop: false },
        })],
      })],
    });
    const oneWayResult = migrateLayoutToPlan(oneWay, BOUNDARY, sequentialIds());
    expect(oneWayResult.routes[0]!.oneWay).toBe(true);
  });

  it('缺落点的人员与退化动线进 skipped，不留半成品', () => {
    const layout = makeLayout({
      ...SHELL,
      floors: [makeFloor({
        items: [
          makeUnplacedItem({ id: 'p-nopos', type: 'person', name: '无落点' }),
          makeItem({
            id: 'p-route-bad', type: 'person', name: '坏动线', position: { x: 2, z: 2 },
            walkRoute: { points: [{ x: 2, z: 2 }] },
          }),
        ],
      })],
    });

    const result = migrateLayoutToPlan(layout, BOUNDARY, sequentialIds());

    // 坏动线那个人仍有落点，落成点位；只其动线退化。无落点人员不进 workers。
    expect(result.workers).toHaveLength(1);
    expect(result.workers[0]!.id).toBe('u-1');
    expect(result.routes).toHaveLength(0);
    expect(result.skipped.map(s => `${s.source}:${s.sourceId}`)).toEqual([
      'worker:p-nopos',
      'route:p-route-bad',
    ]);
  });

  it('边界退化时退成壳体坐标直接翻轴（z 南 → y 北）', () => {
    const layout = makeLayout({
      ...SHELL,
      floors: [makeFloor({
        items: [makeItem({ id: 'p1', type: 'person', name: '引导员', position: { x: 2, z: 4 } })],
      })],
    });

    const result = migrateLayoutToPlan(layout, [{ x: 0, y: 0 }], sequentialIds());

    expect(result.workers[0]!.position).toEqual({ x: 2, y: -4 });
  });

  it('多楼层分区/人员平铺合并到同一批实体', () => {
    const layout = makeLayout({
      ...SHELL,
      floors: [
        makeFloor({ id: 'f1', zones: [{ id: 'z1', name: '一区', color: '#8b9aa6', zoneType: 'reserved', x: 2, z: 2, w: 3, d: 3 }] }),
        makeFloor({ id: 'f2', items: [makeItem({ id: 'p1', type: 'person', name: '二层岗', position: { x: 2, z: 4 } })] }),
      ],
    });

    const result = migrateLayoutToPlan(layout, BOUNDARY, sequentialIds());

    expect(result.zones).toHaveLength(1);
    expect(result.workers).toHaveLength(1);
  });
});
