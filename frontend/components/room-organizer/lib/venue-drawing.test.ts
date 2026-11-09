import { describe, expect, it } from 'vitest';
import {
  appendVertex,
  checkContour,
  checkFlowLine,
  MIN_POLYGON_AREA_M2,
  polygonAreaMeters2,
  polygonSelfIntersects,
  polylineLengthMeters,
  pointDistanceMeters,
  undoVertex,
  type DrawPoint,
} from './venue-drawing';

/** 约 10 m × 20 m 的矩形（平湖秋月那种一小块非矩形场地）。 */
const rectangle: DrawPoint[] = [
  { lng: 120.1, lat: 30.2 },
  { lng: 120.10092, lat: 30.2 },
  { lng: 120.10092, lat: 30.20018 },
  { lng: 120.1, lat: 30.20018 },
];

describe('venue-drawing 顶点收集', () => {
  it('追加顶点并按顺序保留', () => {
    const first = appendVertex([], { lng: 120.1, lat: 30.2 });
    expect(first.rejected).toBe(false);
    const second = appendVertex(first.points, { lng: 120.1005, lat: 30.2 });
    expect(second.points).toHaveLength(2);
    expect(second.points[1]!.lng).toBeCloseTo(120.1005, 6);
  });

  it('重复点击同一点被拒（双击闭合的第二下不产生第二个顶点）', () => {
    const first = appendVertex([], { lng: 120.1, lat: 30.2 });
    const again = appendVertex(first.points, { lng: 120.1, lat: 30.2 });
    expect(again.rejected).toBe(true);
    expect(again.points).toHaveLength(1);
  });

  it('非有限坐标被拒', () => {
    expect(appendVertex([], { lng: Number.NaN, lat: 30.2 }).rejected).toBe(true);
    expect(appendVertex([], { lng: 120.1, lat: Number.POSITIVE_INFINITY }).rejected).toBe(true);
  });

  it('撤销最后一个顶点，空草稿再撤销不报错', () => {
    expect(undoVertex([{ lng: 1, lat: 2 }, { lng: 3, lat: 4 }])).toHaveLength(1);
    expect(undoVertex([])).toHaveLength(0);
  });

  it('两点距离按米算：0.001° 纬度约 110.6 m', () => {
    const d = pointDistanceMeters({ lng: 120.1, lat: 30.2 }, { lng: 120.1, lat: 30.201 });
    expect(d).toBeGreaterThan(105);
    expect(d).toBeLessThan(115);
  });
});

describe('venue-drawing 轮廓校验', () => {
  it('点数不足时说明还缺几个点', () => {
    const check = checkContour([{ lng: 120.1, lat: 30.2 }]);
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.reason).toContain('3 个点');
  });

  it('面积为零（点都在一条线上）判为无效', () => {
    const collinear: DrawPoint[] = [
      { lng: 120.1, lat: 30.2 },
      { lng: 120.1005, lat: 30.2 },
      { lng: 120.101, lat: 30.2 },
    ];
    const check = checkContour(collinear);
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.reason).toContain('面积');
  });

  it('面积太小时给出具体平方米数', () => {
    const tiny: DrawPoint[] = [
      { lng: 120.1, lat: 30.2 },
      { lng: 120.100002, lat: 30.2 },
      { lng: 120.100002, lat: 30.200002 },
    ];
    const check = checkContour(tiny);
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.reason).toContain('m²');
  });

  it('自相交轮廓被判无效并说明穿模', () => {
    const bowtie: DrawPoint[] = [
      { lng: 120.1, lat: 30.2 },
      { lng: 120.101, lat: 30.201 },
      { lng: 120.101, lat: 30.2 },
      { lng: 120.1, lat: 30.201 },
    ];
    expect(polygonSelfIntersects(bowtie)).toBe(true);
    const check = checkContour(bowtie);
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.reason).toContain('穿模');
  });

  it('正常矩形轮廓通过校验，面积为正', () => {
    const check = checkContour(rectangle);
    expect(check.ok).toBe(true);
    if (check.ok) {
      expect(check.vertexCount).toBe(4);
      expect(check.areaM2).toBeGreaterThan(MIN_POLYGON_AREA_M2);
    }
    expect(polygonAreaMeters2(rectangle)).toBeGreaterThan(100);
  });

  it('非矩形轮廓（L 形）同样能通过——场地不该被逼成矩形', () => {
    const ell: DrawPoint[] = [
      { lng: 120.1, lat: 30.2 },
      { lng: 120.1009, lat: 30.2 },
      { lng: 120.1009, lat: 30.20008 },
      { lng: 120.1004, lat: 30.20008 },
      { lng: 120.1004, lat: 30.20018 },
      { lng: 120.1, lat: 30.20018 },
    ];
    const check = checkContour(ell);
    expect(check.ok).toBe(true);
    // L 形面积应明显小于其外接矩形
    expect(polygonAreaMeters2(ell)).toBeLessThan(polygonAreaMeters2([
      { lng: 120.1, lat: 30.2 },
      { lng: 120.1009, lat: 30.2 },
      { lng: 120.1009, lat: 30.20018 },
      { lng: 120.1, lat: 30.20018 },
    ]));
  });
});

describe('venue-drawing 流线校验', () => {
  it('少于 2 个点判无效', () => {
    const check = checkFlowLine([{ lng: 120.1, lat: 30.2 }]);
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.reason).toContain('2 个点');
  });

  it('折线长度按米累加', () => {
    const line: DrawPoint[] = [
      { lng: 120.1, lat: 30.2 },
      { lng: 120.1, lat: 30.201 },
    ];
    expect(polylineLengthMeters(line)).toBeGreaterThan(105);
  });
});
