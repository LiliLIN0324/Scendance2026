import { describe, expect, it } from 'vitest';
import {
  buildDefaultZoneRects,
  extractProposedZoneTypes,
  hasZoneApplyProposal,
  isAffirmativeIntent,
} from './auto-zone-apply';

describe('isAffirmativeIntent', () => {
  it('肯定短回复命中', () => {
    for (const t of ['好', '好的', '好啊', '可以', '行', '行吧', '圈吧', '帮我圈', 'ok', 'OK', 'Yes', '好。', '可以！', '好，']) {
      expect(isAffirmativeIntent(t)).toBe(true);
    }
  });
  it('否定/无关/长句不命中', () => {
    for (const t of ['不要', '再想想', '啥', '我不要', '好的，但是签到区往南挪', '请先告诉我尺寸', '']) {
      expect(isAffirmativeIntent(t)).toBe(false);
    }
  });
});

describe('hasZoneApplyProposal', () => {
  it('brief-agent 标准句命中', () => {
    expect(hasZoneApplyProposal('要不要我直接在 2D 上帮你把签到区和休息区先圈出来？回「好」就落。')).toBe(true);
    expect(hasZoneApplyProposal('我在门口圈一下？')).toBe(true);
    expect(hasZoneApplyProposal('先圈个休息区？')).toBe(true);
  });
  it('普通回复不命中', () => {
    expect(hasZoneApplyProposal('记下了：80 人发布会 · 12 × 9 m。先出一版预览。')).toBe(false);
    expect(hasZoneApplyProposal('')).toBe(false);
  });
});

describe('extractProposedZoneTypes', () => {
  it('默认含签到+休息', () => {
    expect(extractProposedZoneTypes('要不要我先在门口圈个签到区？顺便在场地深处留个休息区？'))
      .toEqual(['checkin', 'rest']);
  });
  it('提到圆桌/打卡时追加', () => {
    expect(extractProposedZoneTypes('要不要我直接在 2D 上帮你把签到区、休息区和圆桌区都先圈出来？'))
      .toEqual(['checkin', 'rest', 'roundtable']);
    expect(extractProposedZoneTypes('打卡区也一起圈')).toEqual(['checkin', 'rest', 'photo']);
  });
});

describe('buildDefaultZoneRects', () => {
  const room = { width: 12, height: 8 };

  it('给 [checkin, rest] 返回两个 rect 且都在房间内', () => {
    const rects = buildDefaultZoneRects(['checkin', 'rest'], room);
    expect(rects).toHaveLength(2);
    for (const { rect } of rects) {
      expect(rect.x - rect.width / 2).toBeGreaterThanOrEqual(-room.width / 2 - 1e-6);
      expect(rect.x + rect.width / 2).toBeLessThanOrEqual(room.width / 2 + 1e-6);
      expect(rect.z - rect.depth / 2).toBeGreaterThanOrEqual(-room.height / 2 - 1e-6);
      expect(rect.z + rect.depth / 2).toBeLessThanOrEqual(room.height / 2 + 1e-6);
    }
    // checkin 在南墙（z 正），rest 在北墙（z 负），纵向不应重叠。
    const checkin = rects.find(r => r.zoneType === 'checkin')!;
    const rest = rects.find(r => r.zoneType === 'rest')!;
    expect(checkin.rect.z).toBeGreaterThan(0);
    expect(rest.rect.z).toBeLessThan(0);
    // checkin 靠北的一边（z 较小那侧）必须仍在 rest 靠南的一边（z 较大那侧）之南（z 更大）。
    const checkinNorthEdge = checkin.rect.z - checkin.rect.depth / 2;
    const restSouthEdge = rest.rect.z + rest.rect.depth / 2;
    expect(checkinNorthEdge).toBeGreaterThan(restSouthEdge - 1e-6);
  });

  it('小圆角房间也不越界', () => {
    const small = { width: 4, height: 4 };
    const rects = buildDefaultZoneRects(['checkin', 'rest', 'roundtable'], small);
    for (const { rect } of rects) {
      expect(rect.x - rect.width / 2).toBeGreaterThanOrEqual(-small.width / 2 - 1e-6);
      expect(rect.x + rect.width / 2).toBeLessThanOrEqual(small.width / 2 + 1e-6);
      expect(rect.z - rect.depth / 2).toBeGreaterThanOrEqual(-small.height / 2 - 1e-6);
      expect(rect.z + rect.depth / 2).toBeLessThanOrEqual(small.height / 2 + 1e-6);
    }
  });

  it('同类型去重', () => {
    const rects = buildDefaultZoneRects(['checkin', 'checkin'], room);
    expect(rects).toHaveLength(1);
  });
});
