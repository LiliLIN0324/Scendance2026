import { describe, expect, it } from 'vitest';
import { generateSuggestions, generateZonePrompts, defaultZoneRect } from './suggestions';

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

  // ---- 第 12 批：对抗用例 D / E ----

  it('D. 老人 audience + 签到区 → 建议含「1.5m」或「轮椅」', () => {
    const list = generateSuggestions({
      audience: '面向中老年长辈的社区茶话会',
      zoneTypes: ['checkin'],
    });
    expect(list.length).toBeGreaterThanOrEqual(1);
    const joined = list.map((s) => s.title + s.reason).join('|');
    expect(joined).toMatch(/轮椅|1\.5m/);
  });

  it('E. 商务 audience + 签到区 → 建议不含「轮椅」「1.5m」', () => {
    const list = generateSuggestions({
      audience: '企业客户答谢晚宴',
      zoneTypes: ['checkin', 'roundtable'],
    });
    expect(list.length).toBeGreaterThanOrEqual(1);
    const joined = list.map((s) => s.title + s.reason).join('|');
    expect(joined).not.toContain('轮椅');
    expect(joined).not.toMatch(/1\.5m/);
  });
});

describe('generateZonePrompts（主对话主动提示）', () => {
  it('中老年 + 空 zone：至少推签到区+休息区', () => {
    const list = generateZonePrompts({ audience: '面向中老年人', zoneTypes: [] });
    const types = list.map((p) => p.zoneType);
    expect(types).toContain('checkin');
    expect(types).toContain('rest');
  });

  it('已经画了签到区 → 不重复推签到区', () => {
    const list = generateZonePrompts({ audience: '面向中老年人', zoneTypes: ['checkin'] });
    expect(list.some((p) => p.zoneType === 'checkin')).toBe(false);
  });

  it('商务晚宴 + 空 zone：推签到区+圆桌区', () => {
    const list = generateZonePrompts({ audience: '企业客户答谢晚宴', zoneTypes: [] });
    const types = list.map((p) => p.zoneType);
    expect(types).toContain('checkin');
    expect(types).toContain('roundtable');
  });

  it('普通活动 + 空 zone：只推签到区', () => {
    const list = generateZonePrompts({ audience: '普通市集', zoneTypes: [] });
    expect(list.map((p) => p.zoneType)).toEqual(['checkin']);
  });
});

describe('defaultZoneRect（一键落区默认位）', () => {
  it('checkin 在场地前侧（z>0）', () => {
    const r = defaultZoneRect('checkin', { width: 12, height: 8 });
    expect(r.z).toBeGreaterThan(0);
  });
  it('rest 在场地深处（z<0）', () => {
    const r = defaultZoneRect('rest', { width: 12, height: 8 });
    expect(r.z).toBeLessThan(0);
  });
  it('roundtable 在场地正中', () => {
    const r = defaultZoneRect('roundtable', { width: 12, height: 8 });
    expect(r.x).toBe(0);
    expect(r.z).toBe(0);
  });
});
