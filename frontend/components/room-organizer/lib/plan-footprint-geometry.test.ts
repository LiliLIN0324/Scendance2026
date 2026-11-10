import { describe, expect, it } from 'vitest';
import { facilityFootprint, facilityProp, planFootprintShapes, planPropKind, planShellFrame } from './plan-footprint-geometry';
import type { SitePlanData } from '../../../../supabase/functions/_shared/site-plan';

/**
 * 2D 规划 → 3D 地面的几何换算（P2-g 对位）。这里锁死三件事：
 * 1) 平面 ENU（x 东、y 北）与壳体（x 东、z 南）的换轴，北沿对 z=0；
 * 2) 设施占地矩形按平面朝向旋转，面积与边长不因旋转变化；
 * 3) 颜色/透明度取 2D 同一套 token，缺字段时用语义色兜底。
 */

const square = [
  { x: 0, y: 0 },
  { x: 20, y: 0 },
  { x: 20, y: 10 },
  { x: 0, y: 10 },
];

function makePlan(partial: Partial<SitePlanData> = {}): SitePlanData {
  return {
    schemaVersion: 1,
    boundary: square,
    zones: [],
    facilities: [],
    routes: [],
    nodes: [],
    workers: [],
    ...partial,
  } as SitePlanData;
}

describe('planShellFrame', () => {
  it('外接框铺满场地：西北角落 (0,0)，东北角落到 x=width，南沿落到 z=depth', () => {
    const frame = planShellFrame(square, { width: 40, depth: 20 })!;
    expect(frame.toShell({ x: 0, y: 10 })).toEqual({ x: 0, z: 0 });
    expect(frame.toShell({ x: 20, y: 10 })).toEqual({ x: 40, z: 0 });
    expect(frame.toShell({ x: 0, y: 0 })).toEqual({ x: 0, z: 20 });
    expect(frame.toShell({ x: 20, y: 0 })).toEqual({ x: 40, z: 20 });
    expect(frame.scaleX).toBe(2);
    expect(frame.scaleZ).toBe(2);
  });

  it('平面坐标带负值时按外接框平移，不产生负壳体坐标', () => {
    const shifted = square.map(point => ({ x: point.x - 100, y: point.y - 50 }));
    const frame = planShellFrame(shifted, { width: 20, depth: 10 })!;
    expect(frame.toShell({ x: -100, y: -40 })).toEqual({ x: 0, z: 0 });
    expect(frame.toShell({ x: -80, y: -50 })).toEqual({ x: 20, z: 10 });
  });

  it('场地框小于平面外接框时是等比缩到框内（scale<1）', () => {
    const frame = planShellFrame(square, { width: 10, depth: 5 })!;
    expect(frame.scaleX).toBe(0.5);
    expect(frame.scaleZ).toBe(0.5);
    expect(frame.toShell({ x: 20, y: 10 })).toEqual({ x: 10, z: 0 });
  });

  it('顶点不足或外接框退化返回 null（宁可不画也不要摊错位置）', () => {
    expect(planShellFrame([{ x: 0, y: 0 }, { x: 1, y: 1 }], { width: 10, depth: 10 })).toBeNull();
    expect(planShellFrame([{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }], { width: 10, depth: 10 })).toBeNull();
    expect(planShellFrame(square, { width: 0, depth: 10 })).toBeNull();
  });
});

describe('facilityFootprint', () => {
  const frame = planShellFrame(square, { width: 20, depth: 10 })!;

  it('不旋转时四角就是占地矩形，中心落在映射点上', () => {
    const points = facilityFootprint(
      { position: { x: 10, y: 5 }, rotationDeg: 0, size: { width: 4, depth: 2 } },
      frame,
    );
    const xs = points.map(point => point.x);
    const zs = points.map(point => point.z);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(4, 5);
    expect(Math.max(...zs) - Math.min(...zs)).toBeCloseTo(2, 5);
    const centerX = (Math.max(...xs) + Math.min(...xs)) / 2;
    const centerZ = (Math.max(...zs) + Math.min(...zs)) / 2;
    expect(centerX).toBeCloseTo(10, 5);
    expect(centerZ).toBeCloseTo(5, 5);
  });

  it('转 90° 后长宽在壳体里互换，面积不变', () => {
    const points = facilityFootprint(
      { position: { x: 10, y: 5 }, rotationDeg: 90, size: { width: 4, depth: 2 } },
      frame,
    );
    const xs = points.map(point => point.x);
    const zs = points.map(point => point.z);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(2, 5);
    expect(Math.max(...zs) - Math.min(...zs)).toBeCloseTo(4, 5);
  });

  it('倾斜的设施四角仍在场地框内（不越界）', () => {
    const points = facilityFootprint(
      { position: { x: 0.2, y: 9.8 }, rotationDeg: 45, size: { width: 6, depth: 3 } },
      frame,
    );
    for (const point of points) {
      expect(point.x).toBeGreaterThanOrEqual(0);
      expect(point.x).toBeLessThanOrEqual(frame.width);
      expect(point.z).toBeGreaterThanOrEqual(0);
      expect(point.z).toBeLessThanOrEqual(frame.depth);
    }
  });
});

describe('planFootprintShapes', () => {
  it('分区、动线、点位各自带语义色；显式 color 优先', () => {
    const shapes = planFootprintShapes(makePlan({
      zones: [
        { id: 'z1', semantic: 'stage', name: '主舞台', polygon: square, notes: '' },
        { id: 'z2', semantic: 'parking', name: '停车', polygon: square, color: '#123456', notes: '' },
      ],
      routes: [
        { id: 'r1', kind: 'vehicle', name: '车行', points: [{ x: 0, y: 0 }, { x: 20, y: 0 }], oneWay: false, notes: '' },
      ],
      nodes: [{ id: 'n1', kind: 'exit', name: '东出口', position: { x: 20, y: 5 }, notes: '' }],
      workers: [{ id: 'w1', role: '引导', count: 6, position: { x: 5, y: 5 }, notes: '' }],
    } as unknown as SitePlanData), { width: 20, depth: 10 })!;
    expect(shapes.zones[0]!.color).toBe('#c98a2c');
    expect(shapes.zones[1]!.color).toBe('#123456');
    expect(shapes.zones[0]!.opacity).toBeCloseTo(0.22, 5);
    expect(shapes.routes[0]!.color).toBe('#c98a2c');
    expect(shapes.nodes[0]!.color).toBe('#c0392b');
    expect(shapes.workers[0]!.color).toBe('#5e7fa6');
    expect(shapes.workers[0]!.label).toBe('引导 · 6 人');
  });

  it('透明度按 token 区间夹取，超过 0.6 也压回上限', () => {
    const shapes = planFootprintShapes(makePlan({
      zones: [{ id: 'z1', semantic: 'audience', name: '观众', polygon: square, opacity: 0.95, notes: '' }],
    } as unknown as SitePlanData), { width: 20, depth: 10 })!;
    expect(shapes.zones[0]!.opacity).toBe(0.6);
  });

  it('边界按壳体尺寸铺满，设施数量/顺序原样保留', () => {
    const shapes = planFootprintShapes(makePlan({
      facilities: [
        { id: 'f1', templateId: 'tent', name: '帐篷', position: { x: 5, y: 5 }, rotationDeg: 0, size: { width: 3, depth: 3 }, notes: '' },
        { id: 'f2', templateId: 'table', name: '桌', position: { x: 15, y: 5 }, rotationDeg: 0, size: { width: 2, depth: 1 }, notes: '' },
      ],
    } as unknown as SitePlanData), { width: 20, depth: 10 })!;
    expect(shapes.facilities.map(facility => facility.id)).toEqual(['f1', 'f2']);
    const xs = shapes.boundary.map(point => point.x);
    expect(Math.min(...xs)).toBeCloseTo(0, 5);
    expect(Math.max(...xs)).toBeCloseTo(20, 5);
  });

  it('边界退化时整份图形返回 null', () => {
    expect(planFootprintShapes(makePlan({ boundary: [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }] }), { width: 10, depth: 10 })).toBeNull();
  });
});

describe('设施 → 3D 物件（planPropKind / facilityProp）', () => {
  it('八个内置模板各自落到对的 3D 物件类型', () => {
    const cases: Array<[string, string]> = [
      ['booth-2x2', 'kiosk'],
      ['tent-3x3', 'tent'],
      ['medical-tent-4x3', 'tent'],
      ['food-truck-6x2.5', 'foodTruck'],
      ['stage-platform-8x6', 'stage'],
      ['toilet-2.4x1.2', 'toilet'],
      ['security-post-1.5x1.5', 'post'],
      ['trash-point-1.2x1.2', 'bin'],
    ];
    for (const [templateId, kind] of cases) {
      expect(planPropKind(templateId)).toBe(kind);
    }
  });

  it('自定义模板按关键词归类，完全不认识的落到 misc', () => {
    expect(planPropKind('marquee-5x5')).toBe('tent');
    expect(planPropKind('main-stage-deck')).toBe('stage');
    expect(planPropKind('wc-block')).toBe('toilet');
    expect(planPropKind('catering-trailer')).toBe('foodTruck');
    expect(planPropKind('waste-bay')).toBe('bin');
    expect(planPropKind('mystery-box')).toBe('misc');
  });

  it('尺寸与朝向换算到壳体，且底面积给最小可辨认尺度', () => {
    const frame = planShellFrame(square, { width: 20, depth: 10 })!; // 正好 1:1
    const prop = facilityProp({
      id: 'f1',
      templateId: 'stage-platform-8x6',
      name: '主舞台',
      position: { x: 6, y: 8 },
      rotationDeg: 15,
      size: { width: 8, depth: 6 },
    }, frame);
    expect(prop.kind).toBe('stage');
    expect(prop.label).toBe('主舞台');
    expect(prop.width).toBeCloseTo(8, 5);
    expect(prop.depth).toBeCloseTo(6, 5);
    expect(prop.rotationDeg).toBe(15);
    // 西北角 (0,10) 是壳体原点，所以 (6,8) → x=6、z=2。
    expect(prop.center.x).toBeCloseTo(6, 5);
    expect(prop.center.z).toBeCloseTo(2, 5);

    const tiny = facilityProp({
      id: 'f2',
      templateId: 'trash-point-1.2x1.2',
      name: '垃圾桶',
      position: { x: 1, y: 1 },
      rotationDeg: 0,
      size: { width: 0.2, depth: 0.2 },
    }, frame);
    expect(tiny.width).toBe(0.6);
    expect(tiny.depth).toBe(0.6);
  });

  it('planFootprintShapes 同时给出占地图形与 3D 物件，且一一对应', () => {
    const shapes = planFootprintShapes(makePlan({
      facilities: [
        { id: 'f1', templateId: 'tent-3x3', name: '后勤帐篷', position: { x: 5, y: 5 }, rotationDeg: 90, size: { width: 3, depth: 3 }, notes: '' },
        { id: 'f2', templateId: 'toilet-2.4x1.2', name: '移动洗手间', position: { x: 12, y: 4 }, rotationDeg: 0, size: { width: 2.4, depth: 1.2 }, notes: '' },
      ],
    } as unknown as SitePlanData), { width: 20, depth: 10 })!;
    expect(shapes.props.map(prop => prop.id)).toEqual(['f1', 'f2']);
    expect(shapes.props.map(prop => prop.kind)).toEqual(['tent', 'toilet']);
    expect(shapes.props[0]!.rotationDeg).toBe(90);
    expect(shapes.facilities.map(facility => facility.id)).toEqual(shapes.props.map(prop => prop.id));
  });
});