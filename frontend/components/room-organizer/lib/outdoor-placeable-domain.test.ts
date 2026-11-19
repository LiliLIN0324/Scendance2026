import { describe, expect, it } from "vitest";
import {
  computePlaceableDomain,
  type PlaceableDomainInput,
} from "./outdoor-placeable-domain";
import { planRingsOverlap } from "./site-plan-editing";

const rect = (
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): { x: number; y: number }[] => [
  { x: x0, y: y0 },
  { x: x1, y: y0 },
  { x: x1, y: y1 },
  { x: x0, y: y1 },
];

function base(overrides: Partial<PlaceableDomainInput>): PlaceableDomainInput {
  return { boundary: rect(0, 0, 100, 100), ...overrides };
}

describe("docs/47 B1 可布置域计算", () => {
  it("凸形矩形场地：可用面积与真值误差 <5%（整数/非整数/小场地三档）", () => {
    const cases: Array<[number, number]> = [
      [100, 100],
      [97.7, 97.9],
      [40.3, 35.7],
      [10, 10.5],
    ];
    for (const [w, h] of cases) {
      const domain = computePlaceableDomain({ boundary: rect(0, 0, w, h) });
      const truth = w * h;
      const err = Math.abs(domain.areaM2 - truth) / truth;
      expect(err, `${w}×${h} 面积误差 ${err}`).toBeLessThan(0.05);
      // 边界总面积是鞋带公式，必须精确。
      expect(Math.abs(domain.boundaryAreaM2 - truth)).toBeLessThan(0.01);
    }
  });

  it("凹形 L 场地：凹口不计入可用面积，最大内接矩形取最大臂", () => {
    // 40×40 凹掉东北角 20×20：真面积 1200，最大轴对齐内接矩形 40×20=800。
    const boundary = [
      { x: 0, y: 0 },
      { x: 40, y: 0 },
      { x: 40, y: 20 },
      { x: 20, y: 20 },
      { x: 20, y: 40 },
      { x: 0, y: 40 },
    ];
    const domain = computePlaceableDomain({ boundary });
    expect(Math.abs(domain.areaM2 - 1200) / 1200).toBeLessThan(0.05);
    expect(domain.maxRect).not.toBeNull();
    expect(Math.abs(domain.maxRect!.areaM2 - 800) / 800).toBeLessThan(0.03);
    // 凹口内（30,30）必须不可布置。
    const cols = domain.cols,
      rows = domain.rows;
    const gx = Math.floor((30 - domain.originX) / domain.resolutionM);
    const gy = Math.floor((30 - domain.originY) / domain.resolutionM);
    expect(gx).toBeGreaterThanOrEqual(0);
    expect(gx).toBeLessThan(cols);
    expect(gy).toBeGreaterThanOrEqual(0);
    expect(gy).toBeLessThan(rows);
    expect(domain.cells[gy * cols + gx]).toBe(0);
  });

  it("带障碍场地：建筑足迹与水域 hard 块都从可布置域里扣掉", () => {
    const domain = computePlaceableDomain(
      base({
        buildings: [rect(45, 45, 55, 55)],
        hardBlocks: [rect(90, 0, 100, 20)],
      }),
    );
    // 真值 10000 − 建筑 100 − 水域 200 = 9700。
    expect(Math.abs(domain.areaM2 - 9700) / 9700).toBeLessThan(0.02);
    // 100×100 里避开中央 10×10 建筑与东北水域的最大内接矩形是 100×45=4500（北侧）。
    expect(domain.maxRect).not.toBeNull();
    expect(Math.abs(domain.maxRect!.areaM2 - 4500) / 4500).toBeLessThan(0.05);
    // 建筑中心格不可布置。
    const gx = Math.floor((50 - domain.originX) / domain.resolutionM);
    const gy = Math.floor((50 - domain.originY) / domain.resolutionM);
    expect(domain.cells[gy * domain.cols + gx]).toBe(0);
  });

  it("道路走廊缓冲从可布置域扣除；走廊超出边界的部分不多扣", () => {
    const inside = computePlaceableDomain(
      base({ corridorLines: [[{ x: 0, y: 50 }, { x: 100, y: 50 }]] }),
    );
    expect(Math.abs(inside.areaM2 - 9700) / 9700).toBeLessThan(0.02);
    const beyond = computePlaceableDomain(
      base({ corridorLines: [[{ x: 0, y: 50 }, { x: 150, y: 50 }]] }),
    );
    expect(Math.abs(beyond.areaM2 - inside.areaM2)).toBeLessThan(1);
  });

  it("可布置多边形集合：矩形互不重叠、恰好盖住自由格、不盖禁区格", () => {
    const domain = computePlaceableDomain(
      base({
        buildings: [rect(45, 45, 55, 55)],
        hardBlocks: [rect(90, 0, 100, 20)],
        corridorLines: [[{ x: 0, y: 50 }, { x: 100, y: 50 }]],
      }),
    );
    expect(domain.rects.length).toBeGreaterThan(0);
    for (const r of domain.rects) {
      expect(r.polygon.length).toBe(4);
      expect(r.areaM2).toBeGreaterThan(0);
    }
    for (let a = 0; a < domain.rects.length; a++)
      for (let b = a + 1; b < domain.rects.length; b++)
        expect(
          planRingsOverlap(domain.rects[a]!.polygon, domain.rects[b]!.polygon),
          `rect#${a} 与 rect#${b} 重叠`,
        ).toBe(false);
    // 每个 free 格被恰好一个矩形盖住；blocked 格不被任何矩形盖住。
    const covered = new Set<number>();
    for (let j = 0; j < domain.rows; j++) {
      for (let i = 0; i < domain.cols; i++) {
        const idx = j * domain.cols + i;
        const cx = domain.originX + (i + 0.5) * domain.resolutionM;
        const cy = domain.originY + (j + 0.5) * domain.resolutionM;
        const hits = domain.rects.filter((r) => {
          const [p0, , p2] = r.polygon;
          return (
            cx >= p0!.x &&
            cx <= p2!.x &&
            cy >= p0!.y &&
            cy <= p2!.y
          );
        });
        if (domain.cells[idx] === 1) {
          expect(hits.length, `free 格 (${i},${j}) 被盖 ${hits.length} 次`).toBe(1);
          covered.add(idx);
        } else {
          expect(hits.length, `禁区格 (${i},${j}) 被矩形盖住`).toBe(0);
        }
      }
    }
    expect(covered.size).toBeGreaterThan(0);
  });

  it("退化输入：轮廓不完整明确报错；退化障碍跳过；全堵如实为零而不是编数", () => {
    expect(() =>
      computePlaceableDomain({ boundary: [{ x: 0, y: 0 }, { x: 10, y: 10 }] }),
    ).toThrow(/活动范围/);
    // 障碍环 <3 点：整条丢弃，不猜。
    const domain = computePlaceableDomain(base({ buildings: [rect(45, 45, 60, 60).slice(0, 2)] }));
    expect(Math.abs(domain.areaM2 - 10000) / 10000).toBeLessThan(0.05);
    // 建筑盖满全场的场地：面积 0、无矩形、无最大内接矩形。
    const blocked = computePlaceableDomain(base({ buildings: [rect(0, 0, 100, 100)] }));
    expect(blocked.areaM2).toBe(0);
    expect(blocked.rects).toEqual([]);
    expect(blocked.maxRect).toBeNull();
  });

  it("resolutionM=2 粗网格：面积指标仍与真值误差 <5%，网格密度减半", () => {
    const fine = computePlaceableDomain(base({}));
    const coarse = computePlaceableDomain(base({ resolutionM: 2 }));
    expect(coarse.resolutionM).toBe(2);
    expect(coarse.cols * 2).toBe(fine.cols);
    expect(Math.abs(coarse.areaM2 - 10000) / 10000).toBeLessThan(0.05);
  });
});
