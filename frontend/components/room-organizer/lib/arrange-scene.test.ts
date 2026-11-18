import { describe, expect, it } from 'vitest';
import { layoutAudience, layoutAudienceFacing, layoutStalls, parseSceneDemand } from './arrange-scene';

const boundary = [
  { x: 0, y: 0 },
  { x: 20, y: 0 },
  { x: 20, y: 14 },
  { x: 0, y: 14 },
];

describe('场景套装解析', () => {
  it('观礼区：人数 + 通道', () => {
    expect(parseSceneDemand('30 人观礼要能坐，留 2 米通道')).toEqual({ kind: 'audience', count: 30, aisleM: 2 });
  });

  it('摊位带：数量 + 通道', () => {
    expect(parseSceneDemand('8 个摊位沿通道两侧，通道 2.5 米')).toEqual({ kind: 'stalls', count: 8, aisleM: 2.5, stallLayout: 'two-sided' });
    expect(parseSceneDemand('6 个摊位，单侧一排')).toEqual({ kind: 'stalls', count: 6, aisleM: null, stallLayout: 'single' });
  });

  it('套餐说法不抢宴会套装', () => {
    expect(parseSceneDemand('6 组洽谈，4 人一桌')).toBeNull();
  });

  it('没数量就不出场景', () => {
    expect(parseSceneDemand('摆几个摊位')).toBeNull();
    expect(parseSceneDemand('观礼区要能坐')).toBeNull();
  });
});

describe('观礼区排布', () => {
  it('30 座成排，全部面向舞台（180°）', () => {
    const seats = layoutAudience({ boundary, count: 30, aisleM: 2 });
    expect(seats).toHaveLength(30);
    expect(seats.every(seat => seat.rotationDeg === 180)).toBe(true);
    for (const seat of seats) {
      expect(seat.x).toBeGreaterThan(0);
      expect(seat.x).toBeLessThan(20);
      expect(seat.y).toBeGreaterThan(0);
      expect(seat.y).toBeLessThan(14);
    }
  });

  it('前排让出通道净宽', () => {
    const aisle = 2;
    const seats = layoutAudience({ boundary, count: 12, aisleM: aisle });
    const front = Math.min(...seats.map(seat => seat.y)) - 0.53 / 2;
    expect(front).toBeGreaterThanOrEqual(aisle);
  });

  it('放不下返回空', () => {
    expect(layoutAudience({ boundary: [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 1 }], count: 30 })).toEqual([]);
  });
});

describe('摊位带排布', () => {
  it('8 个摊位两列，摊口朝中央通道', () => {
    const stalls = layoutStalls({ boundary, count: 8, stallWidth: 2, stallDepth: 2, aisleM: 2.4 });
    expect(stalls).toHaveLength(8);
    expect(stalls.slice(0, 4).every(stall => stall.rotationDeg === 90)).toBe(true);
    expect(stalls.slice(4).every(stall => stall.rotationDeg === 270)).toBe(true);
    for (const stall of stalls) {
      expect(stall.x).toBeGreaterThan(0);
      expect(stall.x).toBeLessThan(20);
      expect(stall.y).toBeGreaterThan(0);
      expect(stall.y).toBeLessThan(14);
    }
  });

  it('两列之间留出通道净宽', () => {
    const aisle = 2.4;
    const stalls = layoutStalls({ boundary, count: 8, stallWidth: 2, stallDepth: 2, aisleM: aisle });
    const left = stalls.filter(stall => stall.rotationDeg === 90).map(stall => stall.x + 1);
    const right = stalls.filter(stall => stall.rotationDeg === 270).map(stall => stall.x - 1);
    expect(Math.min(...right) - Math.max(...left)).toBeCloseTo(aisle);
  });

  it('放不下返回空', () => {
    expect(layoutStalls({ boundary: [{ x: 0, y: 0 }, { x: 3, y: 0 }, { x: 3, y: 3 }], count: 20 })).toEqual([]);
  });

  it('单侧：只排一列，摊口统一朝通道', () => {
    const stalls = layoutStalls({ boundary, count: 5, stallWidth: 2, stallDepth: 2, layout: 'single' });
    expect(stalls).toHaveLength(5);
    expect(stalls.every(stall => stall.rotationDeg === 90)).toBe(true);
    expect(new Set(stalls.map(stall => stall.x)).size).toBe(1);
  });

  it('避让建筑：右侧被占时全排到左侧', () => {
    const blocked = [{ x: 12.2, y: 7, width: 2.4, depth: 13 }];
    const stalls = layoutStalls({ boundary, count: 4, stallWidth: 2, stallDepth: 2, blocked });
    expect(stalls).toHaveLength(4);
    expect(stalls.every(stall => stall.rotationDeg === 90)).toBe(true);
    expect(stalls.every(stall => stall.x < 10)).toBe(true);
  });

  it('背靠背：两列贴背，摊口朝外', () => {
    const stalls = layoutStalls({ boundary, count: 6, stallWidth: 2, stallDepth: 2, layout: 'back-to-back' });
    expect(stalls).toHaveLength(6);
    expect(stalls.slice(0, 3).every(stall => stall.rotationDeg === 270)).toBe(true);
    expect(stalls.slice(3).every(stall => stall.rotationDeg === 90)).toBe(true);
    expect(stalls[3].x - stalls[0].x).toBeCloseTo(2);
  });
});

describe('舞台锚点观礼区', () => {
  it('舞台在前场（y 小）：看席在其后，面向舞台（180°）', () => {
    const stage = { x: 10, y: 2, width: 8, depth: 3 };
    const seats = layoutAudienceFacing({ boundary, count: 30, stage, aisleM: 2 });
    expect(seats).toHaveLength(30);
    expect(seats.every(seat => seat.rotationDeg === 180)).toBe(true);
    const stageBottom = stage.y + stage.depth / 2;
    expect(Math.min(...seats.map(seat => seat.y - 0.53 / 2))).toBeGreaterThanOrEqual(stageBottom + 2);
  });

  it('舞台在右侧：看席在左侧，面向 +x（90°）', () => {
    const stage = { x: 18, y: 7, width: 3, depth: 6 };
    const seats = layoutAudienceFacing({ boundary, count: 12, stage });
    expect(seats.length).toBeGreaterThan(0);
    expect(seats.every(seat => seat.rotationDeg === 90)).toBe(true);
    expect(Math.max(...seats.map(seat => seat.x))).toBeLessThan(stage.x - stage.width / 2);
  });

  it('舞台在顶部：看席在其下，面向 +y（0°）', () => {
    const stage = { x: 10, y: 12.5, width: 10, depth: 2 };
    const seats = layoutAudienceFacing({ boundary, count: 20, stage });
    expect(seats.length).toBeGreaterThan(0);
    expect(seats.every(seat => seat.rotationDeg === 0)).toBe(true);
  });

  it('四周都放不下就返回空', () => {
    const stage = { x: 10, y: 7, width: 18, depth: 12 };
    expect(layoutAudienceFacing({ boundary, count: 30, stage })).toEqual([]);
  });
});
