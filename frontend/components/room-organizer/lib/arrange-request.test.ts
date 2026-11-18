import { describe, expect, it } from 'vitest';
import {
  layoutGrid,
  parseArrangeDemand,
  rankArrangeCandidates,
  selectArrangeCandidates,
  type ArrangeItem,
} from './arrange-request';

const boundary = [
  { x: 0, y: 0 },
  { x: 12, y: 0 },
  { x: 12, y: 8 },
  { x: 0, y: 8 },
];

describe('需求解析', () => {
  it('抽人数、能力、材质、通道净宽', () => {
    expect(parseArrangeDemand('30 人观礼，要能坐，前面留 2 米通道，椅子用深木')).toEqual({
      count: 30,
      capability: 'seat',
      material: 'walnut',
      aisleM: 2,
      scene: null,
    });
  });

  it('没写的信息不猜', () => {
    const parsed = parseArrangeDemand('摆几个摊位');
    expect(parsed.count).toBeNull();
    expect(parsed.capability).toBeNull();
    expect(parsed.material).toBeNull();
    expect(parsed.aisleM).toBeNull();
  });

  it('识别交谈 / 操作与场景词', () => {
    expect(parseArrangeDemand('两个接待台').capability).toBe('talk');
    expect(parseArrangeDemand('放一台自助取号机').capability).toBe('operate');
    expect(parseArrangeDemand('婚礼 20 人').scene).toBe('婚礼');
  });

  it('材质词归一到预设 id', () => {
    expect(parseArrangeDemand('全部拉丝钢').material).toBe('steel');
    expect(parseArrangeDemand('要黑金属').material).toBe('metal');
    expect(parseArrangeDemand('玻璃面').material).toBe('glass');
  });
});

const items: ArrangeItem[] = [
  { slug: 'sofa-wide', name: '三人沙发', width: 2.2, depth: 0.9, kind: 'seat' },
  { slug: 'chair-55', name: '餐椅', width: 0.55, depth: 0.55, kind: 'seat' },
  { slug: 'bench-long', name: '长凳', width: 1.8, depth: 0.45, kind: 'seat' },
  { slug: 'atm-1', name: 'ATM', width: 0.9, depth: 0.7, kind: 'operate' },
  { slug: 'deco-1', name: '装饰柱', width: 0.4, depth: 0.4, kind: 'none' },
];

describe('选物料', () => {
  it('只出能力匹配的物料，占地越接近越靠前', () => {
    const picked = selectArrangeCandidates(items, {
      count: 10, capability: 'seat', material: null, aisleM: null, scene: null,
    });
    expect(picked[0]!.slug).toBe('chair-55');
    expect(picked.every(item => item.kind === 'seat')).toBe(true);
    expect(picked.some(item => item.slug === 'deco-1')).toBe(false);
  });

  it('能力缺失时不出货，交给调用方追问', () => {
    expect(selectArrangeCandidates(items, {
      count: null, capability: null, material: null, aisleM: null, scene: null,
    })).toEqual([]);
  });
});

describe('网格排布', () => {
  it('30 把椅子全部落在边界内', () => {
    const placements = layoutGrid({ boundary, count: 30, width: 0.55, depth: 0.55 });
    expect(placements).toHaveLength(30);
    for (const point of placements) {
      expect(point.x).toBeGreaterThan(0);
      expect(point.x).toBeLessThan(12);
      expect(point.y).toBeGreaterThan(0);
      expect(point.y).toBeLessThan(8);
    }
  });

  it('预留通道时，最前一行让出净宽', () => {
    const aisle = 2;
    const placements = layoutGrid({ boundary, count: 12, width: 0.55, depth: 0.55, aisleM: aisle });
    const front = Math.min(...placements.map(point => point.y)) - 0.55 / 2;
    expect(front).toBeGreaterThanOrEqual(aisle);
  });

  it('边界放不下就返回空，不硬塞', () => {
    expect(layoutGrid({ boundary: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }], count: 10, width: 0.55, depth: 0.55 }))
      .toEqual([]);
    expect(layoutGrid({ boundary: [], count: 5, width: 0.55, depth: 0.55 })).toEqual([]);
  });

  it('同一行等距，行距为深度 + 间距', () => {
    const placements = layoutGrid({ boundary, count: 6, width: 0.55, depth: 0.55, gap: 0.6 });
    const row = placements.slice(0, 2);
    expect(row[1]!.x - row[0]!.x).toBeCloseTo(0.55 + 0.6);
  });
});

describe('候选语义排序（v1）', () => {
  const catalogue: ArrangeItem[] = [
    { slug: 'stool', name: '纹身师工作凳', width: 0.555, depth: 0.53, kind: 'seat' },
    { slug: 'chair', name: '礼堂椅', width: 0.62, depth: 0.6, kind: 'seat' },
    { slug: 'bench', name: '长凳', width: 1.8, depth: 0.45, kind: 'seat' },
  ];
  const demand = { count: 30, capability: 'seat' as const, material: null, aisleM: 2, scene: null };

  it('观礼时礼堂椅压过尺寸更接近的纹身凳', () => {
    const ranked = rankArrangeCandidates(catalogue, demand, 3, '30 人观礼要能坐，留 2 米通道');
    expect(ranked[0]!.item.slug).toBe('chair');
    const stool = ranked.find(entry => entry.item.slug === 'stool')!;
    expect(stool.score).toBeGreaterThan(ranked[0]!.score);
    expect(stool.reason).toContain('用途不相关');
  });

  it('每条候选都带可复核的理由', () => {
    const ranked = rankArrangeCandidates(catalogue, demand, 3, '观礼');
    expect(ranked.length).toBeGreaterThan(0);
    for (const entry of ranked) expect(entry.reason.length).toBeGreaterThan(0);
  });

  it('没有原话时也能按名称排掉不相关用途', () => {
    const picked = rankArrangeCandidates(catalogue, demand, 1);
    expect(picked[0]!.item.slug).toBe('chair');
    expect(picked[0]!.reason).toContain('尺寸接近');
  });

  it('候选数量受 limit 约束', () => {
    expect(rankArrangeCandidates(catalogue, demand, 2, '观礼')).toHaveLength(2);
  });

  it('换一批跳过已经给出的前几条，先后顺序不变', () => {
    const first = rankArrangeCandidates(catalogue, demand, 3, '观礼');
    const next = rankArrangeCandidates(catalogue, demand, 1, '观礼', 1);
    expect(next[0]!.item.slug).toBe(first[1]!.item.slug);
    expect(rankArrangeCandidates(catalogue, demand, 3, '观礼', 9)).toEqual([]);
  });
});
