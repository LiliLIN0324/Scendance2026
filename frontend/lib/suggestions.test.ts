import { describe, expect, it } from 'vitest';
import { generateSuggestions } from './suggestions';

describe('generateSuggestions', () => {
  it('中老年受众 + 签到/休息区：至少 2 条，含轮椅或 1.5m 提醒', () => {
    const list = generateSuggestions({
      audience: '面向中老年人',
      zoneTypes: ['checkin', 'rest'],
    });
    expect(list.length).toBeGreaterThanOrEqual(2);
    const joined = list.map((s) => s.title + s.reason).join('|');
    expect(joined).toMatch(/轮椅|1\.5m/);
  });

  it('中老年受众但没画 zone：仍给 1 条通用轮椅建议', () => {
    const list = generateSuggestions({
      audience: '中老年人茶话会',
      zoneTypes: [],
    });
    expect(list.length).toBeGreaterThanOrEqual(1);
    const joined = list.map((s) => s.title + s.reason).join('|');
    expect(joined).toMatch(/轮椅|1\.5m/);
  });

  it('商务客户答谢晚宴：给通道提醒，但不出现轮椅/阴凉侧建议', () => {
    const list = generateSuggestions({
      audience: '企业客户答谢晚宴',
      zoneTypes: ['checkin', 'roundtable'],
    });
    expect(list.length).toBeGreaterThanOrEqual(1);
    const joined = list.map((s) => s.title + s.reason).join('|');
    expect(joined).not.toContain('轮椅');
    expect(joined).not.toContain('阴凉');
  });

  it('亲子市集 + 休息区：给孩子缓冲建议', () => {
    const list = generateSuggestions({
      audience: '亲子市集',
      zoneTypes: ['rest'],
    });
    expect(list.length).toBeGreaterThanOrEqual(1);
    const joined = list.map((s) => s.title + s.reason).join('|');
    expect(joined).toContain('孩子');
  });

  it('空受众 + 空 zone：返回 []', () => {
    const list = generateSuggestions({
      audience: '',
      zoneTypes: [],
    });
    expect(list).toEqual([]);
  });

  it('普通活动 + 签到区：给 1 条 1.2m 通道提醒，不带轮椅建议', () => {
    const list = generateSuggestions({
      audience: '普通活动',
      zoneTypes: ['checkin'],
    });
    expect(list.length).toBe(1);
    const joined = list.map((s) => s.title + s.reason).join('|');
    expect(joined).toMatch(/1\.2m/);
    expect(joined).not.toContain('轮椅');
  });

  it('场地短边 6m + 圆桌区：给局促提醒', () => {
    const list = generateSuggestions({
      audience: '',
      zoneTypes: ['roundtable'],
      roomShortSideM: 6,
    });
    expect(list.length).toBeGreaterThanOrEqual(1);
    const joined = list.map((s) => s.title + s.reason).join('|');
    expect(joined).toMatch(/8m|轮椅/);
  });

  it('返回数组长度 ≤ 3 且无重复 title', () => {
    const list = generateSuggestions({
      audience: '面向中老年人亲子客户答谢，签到休息圆桌都要',
      zoneTypes: ['checkin', 'rest', 'roundtable'],
      roomShortSideM: 6,
    });
    expect(list.length).toBeLessThanOrEqual(3);
    const titles = list.map((s) => s.title);
    expect(new Set(titles).size).toBe(titles.length);
  });
});
