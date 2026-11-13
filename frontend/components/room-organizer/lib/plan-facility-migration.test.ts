import { describe, expect, it } from 'vitest';
import type { PlanPoint } from '../../../../supabase/functions/_shared/site-plan';
import { migrateFacilities } from './plan-facility-migration';
import { makeFloor, makeItem, makeLayout, makeUnplacedItem } from './__testfixtures__/fixtures';

/** 10×8 m 平面边界；壳体 20×16，两轴缩放 2。 */
const BOUNDARY: PlanPoint[] = [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
  { x: 10, y: 8 },
  { x: 0, y: 8 },
];

const SHELL = { width: 20, height: 16 };

function sequentialIds(): () => string {
  let n = 0;
  return () => `u-${++n}`;
}

describe('plan-facility-migration（室内物件 → plan 设施）', () => {
  it('builtin 直连内置模板：厕位模板尺寸与坐标逆变换、角度取反换算', () => {
    const layout = makeLayout({
      ...SHELL,
      floors: [makeFloor({
        items: [makeItem({
          id: 't1', type: 'toilet', name: '洗手间', position: { x: 2, z: 4 },
          rotation: Math.PI / 2, color: '#3d8fa8',
        })],
      })],
    });

    const result = migrateFacilities(layout, BOUNDARY, sequentialIds());

    expect(result.facilities).toHaveLength(1);
    const facility = result.facilities[0]!;
    expect(facility.templateId).toBe('toilet-2.4x1.2');
    expect(facility.position).toEqual({ x: 1, y: 6 });
    expect(facility.size).toEqual({ width: 2.4, depth: 1.2 });
    expect(facility.rotationDeg).toBeCloseTo(-90, 5);
    expect(facility.name).toBe('洗手间');
    expect(facility.color).toBe('#3d8fa8');
  });

  it('oneplan 对齐条目保留 slug，纯函数层走兜底 2×2 尺寸', () => {
    const layout = makeLayout({
      ...SHELL,
      floors: [makeFloor({
        items: [makeItem({ id: 'c1', type: 'chair', name: '折叠椅', position: { x: 2, z: 2 } })],
      })],
    });

    const result = migrateFacilities(layout, BOUNDARY, sequentialIds());

    expect(result.facilities[0]!.templateId).toBe('oneplan:scale:chair');
    expect(result.facilities[0]!.size).toEqual({ width: 2, depth: 2 });
  });

  it('纯室内家居回落 misc 占位，兜底尺寸 2×2', () => {
    const layout = makeLayout({
      ...SHELL,
      floors: [makeFloor({
        items: [makeItem({ id: 'b1', type: 'bed', name: '双人床', position: { x: 2, z: 2 } })],
      })],
    });

    const result = migrateFacilities(layout, BOUNDARY, sequentialIds());

    expect(result.facilities[0]!.templateId).toBe('misc');
    expect(result.facilities[0]!.size).toEqual({ width: 2, depth: 2 });
  });

  it('墙体/隔断/门窗/人员进 skipped，不建 facility', () => {
    const layout = makeLayout({
      ...SHELL,
      floors: [makeFloor({
        items: [
          makeItem({ id: 'p1', type: 'partition', position: { x: 2, z: 2 } }),
          makeItem({ id: 'f1', type: 'fence', position: { x: 2, z: 2 } }),
          makeItem({ id: 'd1', type: 'door', position: { x: 2, z: 2 } }),
          makeItem({ id: 'w1', type: 'window', position: { x: 2, z: 2 } }),
          makeItem({ id: 'person1', type: 'person', name: '引导员', position: { x: 2, z: 2 } }),
        ],
      })],
    });

    const result = migrateFacilities(layout, BOUNDARY, sequentialIds());

    expect(result.facilities).toHaveLength(0);
    expect(result.skipped.map(s => s.sourceId)).toEqual(['p1', 'f1', 'd1', 'w1', 'person1']);
    expect(result.skipped.every(s => s.reason.length > 0)).toBe(true);
  });

  it('缺落点物料进 skipped，不留半成品', () => {
    const layout = makeLayout({
      ...SHELL,
      floors: [makeFloor({ items: [makeUnplacedItem({ id: 'x1', type: 'chair', name: '未落位' })] })],
    });

    const result = migrateFacilities(layout, BOUNDARY, sequentialIds());

    expect(result.facilities).toHaveLength(0);
    expect(result.skipped).toEqual([{ sourceId: 'x1', reason: '物料缺少落点' }]);
  });

  it('多楼层物料平铺合并到同一批设施', () => {
    const layout = makeLayout({
      ...SHELL,
      floors: [
        makeFloor({ id: 'f1', items: [makeItem({ id: 'a1', type: 'table', position: { x: 2, z: 2 } })] }),
        makeFloor({ id: 'f2', items: [makeItem({ id: 'a2', type: 'fridge', position: { x: 6, z: 6 } })] }),
      ],
    });

    const result = migrateFacilities(layout, BOUNDARY, sequentialIds());

    expect(result.facilities).toHaveLength(2);
  });
});
