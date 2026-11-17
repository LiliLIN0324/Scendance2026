import { describe, expect, it } from 'vitest';
import { layoutBanquetSuites, parseSuiteDemand, pickSuiteFurniture } from './arrange-suite';

const boundary = [
  { x: 0, y: 0 },
  { x: 20, y: 0 },
  { x: 20, y: 14 },
  { x: 0, y: 14 },
];

describe('套装需求解析', () => {
  it('认「6 组洽谈，4 人一桌」', () => {
    expect(parseSuiteDemand('6 组洽谈，4 人一桌，留 2 米通道')).toEqual({ groups: 6, perTable: 4, aisleM: 2 });
  });

  it('缺组数或缺每桌人数就不算套装', () => {
    expect(parseSuiteDemand('30 人观礼要能坐')).toBeNull();
    expect(parseSuiteDemand('6 组洽谈')).toBeNull();
    expect(parseSuiteDemand('4 人一桌')).toBeNull();
  });

  it('每桌人数超出 2–12 不合理，直接拒绝', () => {
    expect(parseSuiteDemand('3 组 1 人一桌')).toBeNull();
    expect(parseSuiteDemand('3 组 20 人一桌')).toBeNull();
  });
});

describe('套装排布', () => {
  it('6 组 4 人一桌 → 6 桌 24 椅，全部落在边界内', () => {
    const layout = layoutBanquetSuites({ boundary, groups: 6, perTable: 4 });
    expect(layout.tables).toHaveLength(6);
    expect(layout.seats).toHaveLength(24);
    for (const point of [...layout.tables, ...layout.seats]) {
      expect(point.x).toBeGreaterThan(0);
      expect(point.x).toBeLessThan(20);
      expect(point.y).toBeGreaterThan(0);
      expect(point.y).toBeLessThan(14);
    }
  });

  it('椅子绕桌均分，与桌心距离一致', () => {
    const layout = layoutBanquetSuites({ boundary, groups: 1, perTable: 4, tableSize: 1, seatSize: 0.5 });
    const table = layout.tables[0]!;
    const distances = layout.seats.map(seat => Math.hypot(seat.x - table.x, seat.y - table.y));
    for (const distance of distances) expect(distance).toBeCloseTo(distances[0]!, 6);
    expect(distances[0]!).toBeGreaterThan(0.75);
  });

  it('邻桌不重叠：桌心距至少一个占位单元', () => {
    const layout = layoutBanquetSuites({ boundary, groups: 6, perTable: 4, tableSize: 1, seatSize: 0.5, gap: 1.2 });
    for (let i = 0; i < layout.tables.length; i += 1) {
      for (let j = i + 1; j < layout.tables.length; j += 1) {
        const a = layout.tables[i]!;
        const b = layout.tables[j]!;
        expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThanOrEqual(2.0);
      }
    }
  });

  it('放不下就返回空，不硬塞', () => {
    const layout = layoutBanquetSuites({ boundary: [{ x: 0, y: 0 }, { x: 3, y: 0 }, { x: 3, y: 3 }], groups: 6, perTable: 4 });
    expect(layout.tables).toEqual([]);
    expect(layout.seats).toEqual([]);
  });
});

describe('套装选型', () => {
  const catalogue = [
    { name: '单门立式冷冻柜', kind: 'table', width: 0.6, depth: 0.6 },
    { name: '圆餐桌', kind: 'table', width: 1.2, depth: 1.2 },
    { name: '折叠椅', kind: 'seat', width: 0.55, depth: 0.53 },
    { name: '长凳', kind: 'seat', width: 1.8, depth: 0.4 },
  ];

  it('不会被「冷冻柜」冒充当桌子', () => {
    expect(pickSuiteFurniture(catalogue).table?.name).toBe('圆餐桌');
  });

  it('座椅按尺寸挑，长凳不抢小椅', () => {
    expect(pickSuiteFurniture(catalogue).seat?.name).toBe('折叠椅');
  });

  it('没有名字合适的桌子时退回能力表，不返回空', () => {
    const only = catalogue.filter(item => item.name !== '圆餐桌');
    expect(pickSuiteFurniture(only).table?.name).toBe('单门立式冷冻柜');
  });
});
